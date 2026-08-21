/**
 * 퇴근 스쿨버스 — 순위표 API
 *
 * GET  /top?n=10&nick=닉  ->  { rows:[{nick,lv,score}], myRank, total }
 * POST /score  { nick, lv, score, seed }  ->  { ok:true }
 *
 * 설계 원칙
 *  - 개인정보를 저장하지 않는다. 닉네임은 클라이언트가 만든 랜덤 문자열이고,
 *    IP 는 레이트리밋용으로 해시만 남긴다.
 *  - 정적 사이트라 클라이언트 조작을 완전히 막을 수는 없다. 대신 서버에서
 *    형식·범위·개연성·속도를 검증해 터무니없는 값과 도배를 걸러낸다.
 */

const CORS = origin => ({
  'access-control-allow-origin': origin,
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type',
});
const json = (data, status, origin) => new Response(JSON.stringify(data), {
  status: status || 200,
  headers: { 'content-type': 'application/json; charset=utf-8',
             'cache-control': 'no-store', ...CORS(origin) },
});

// 닉네임 형식: 한글/영숫자 2~20자 + '#' + 16진수 3자. 형식 밖은 전부 거부한다.
const NICK_RE = /^[0-9A-Za-z가-힣]{2,10}#[0-9a-f]{3}$/;
// 숨은 고유 ID — 이게 신원이고 닉네임은 표시용 라벨이다.
// 신규는 16자 랜덤. pid 도입 전 사용자는 '닉네임 전체의 UTF-8 hex' 를 쓰기 때문에 길이가 가변이다.
// (앞부분만 잘라 쓰면 앞 글자가 겹치는 닉네임끼리 같은 pid 가 되어 서로의 기록을 덮어쓴다)
const PID_RE = /^[0-9a-f]{16,80}$/;

// 레벨별 이론상 상한. 정상 플레이보다 넉넉하지만 999999 같은 값은 막는다.
const maxScore = lv => 20000 * lv + 250 * lv * (lv + 1);

async function hash(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].slice(0, 8).map(x => x.toString(16).padStart(2, '0')).join('');
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    // ALLOW_ORIGIN 은 쉼표로 여러 개 지정할 수 있다 (배포용 + 로컬 개발용)
    const list = (env.ALLOW_ORIGIN || '*').split(',').map(v => v.trim()).filter(Boolean);
    const any = list.includes('*');
    const origin = req.headers.get('origin');
    const allow = any ? '*' : (origin && list.includes(origin)) ? origin : (list[0] || '*');

    if (req.method === 'OPTIONS')
      return new Response(null, { status: 204, headers: { ...CORS(allow), 'access-control-max-age': '86400' } });

    if (origin && !any && !list.includes(origin))
      return json({ error: 'forbidden origin' }, 403, allow);

    /* ── 순위표 조회 ── */
    if (url.pathname === '/top' && req.method === 'GET') {
      const n = Math.min(50, Math.max(1, parseInt(url.searchParams.get('n') || '10', 10) || 10));

      const top = await env.DB.prepare(
        'SELECT nick, lv, score FROM scores ORDER BY score DESC, at ASC LIMIT ?'
      ).bind(n).all();

      const cnt = await env.DB.prepare('SELECT COUNT(*) AS c FROM scores').first();

      // 내 순위는 pid 로 찾는다 (닉네임은 바뀔 수 있으므로)
      let myRank = 0;
      const pid = (url.searchParams.get('pid') || '').toLowerCase();
      if (PID_RE.test(pid)) {
        const me = await env.DB.prepare('SELECT score FROM scores WHERE pid = ?').bind(pid).first();
        if (me) {
          const above = await env.DB.prepare(
            'SELECT COUNT(*) AS c FROM scores WHERE score > ?'
          ).bind(me.score).first();
          myRank = (above?.c || 0) + 1;
        }
      }
      return json({ rows: top.results || [], myRank, total: cnt?.c || 0 }, 200, allow);
    }

    /* ── 점수 제출 ── */
    if (url.pathname === '/score' && req.method === 'POST') {
      let body;
      try { body = await req.json(); } catch { return json({ error: 'bad json' }, 400, allow); }

      const pid   = String(body?.pid ?? '').toLowerCase();
      const nick  = String(body?.nick ?? '').normalize('NFC').trim();
      const lv    = Math.trunc(Number(body?.lv));
      const score = Math.trunc(Number(body?.score));
      const seed  = String(body?.seed ?? '').slice(0, 16);

      if (!PID_RE.test(pid))                         return json({ error: 'bad pid' }, 400, allow);
      if (!NICK_RE.test(nick))                       return json({ error: 'bad nick' }, 400, allow);
      if (!Number.isFinite(lv) || lv < 1 || lv > 99) return json({ error: 'bad lv' }, 400, allow);
      if (!Number.isFinite(score) || score < 1)      return json({ error: 'bad score' }, 400, allow);
      if (score > maxScore(lv))                      return json({ error: 'implausible score' }, 400, allow);

      // 같은 IP 는 5초에 한 번만 (해시로만 대조)
      const ip = await hash((req.headers.get('cf-connecting-ip') || '?') + '|' + (env.SALT || 'toegeun'));
      const now = Date.now();
      const last = await env.DB.prepare('SELECT at FROM rate WHERE ip = ?').bind(ip).first();
      if (last && now - last.at < 5000) return json({ error: 'too fast' }, 429, allow);
      await env.DB.prepare(
        'INSERT INTO rate (ip, at) VALUES (?, ?) ON CONFLICT(ip) DO UPDATE SET at = excluded.at'
      ).bind(ip, now).run();

      // pid 당 한 행. 닉네임은 항상 최신으로 갱신하고 점수는 최고값만 유지한다.
      await env.DB.prepare(
        `INSERT INTO scores (pid, nick, lv, score, seed, at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(pid) DO UPDATE SET
           nick  = excluded.nick,
           lv    = CASE WHEN excluded.score > scores.score THEN excluded.lv   ELSE scores.lv   END,
           seed  = CASE WHEN excluded.score > scores.score THEN excluded.seed ELSE scores.seed END,
           at    = CASE WHEN excluded.score > scores.score THEN excluded.at   ELSE scores.at   END,
           score = MAX(scores.score, excluded.score)`
      ).bind(pid, nick, lv, score, seed, now).run();

      // 오래된 레이트리밋 기록 청소 (드물게)
      if (Math.random() < 0.02)
        await env.DB.prepare('DELETE FROM rate WHERE at < ?').bind(now - 86400000).run();

      return json({ ok: true }, 200, allow);
    }

    /* ── 익명게시판: 목록 ── */
    if (url.pathname === '/posts' && req.method === 'GET') {
      const n = Math.min(100, Math.max(1, parseInt(url.searchParams.get('n') || '30', 10) || 30));
      // 커서 페이지네이션 — before 보다 작은 id 를 가져온다 (id 는 AUTOINCREMENT 라 안정적)
      const before = Math.trunc(Number(url.searchParams.get('before') || 0));
      const r = before > 0
        ? await env.DB.prepare(
            'SELECT id, nick, body, at FROM posts WHERE id < ? ORDER BY id DESC LIMIT ?'
          ).bind(before, n).all()
        : await env.DB.prepare(
            'SELECT id, nick, body, at FROM posts ORDER BY id DESC LIMIT ?'
          ).bind(n).all();
      return json({ rows: r.results || [] }, 200, allow);
    }

    /* ── 익명게시판: 작성 ── */
    if (url.pathname === '/post' && req.method === 'POST') {
      let body;
      try { body = await req.json(); } catch { return json({ error: 'bad json' }, 400, allow); }

      const pid  = String(body?.pid ?? '').toLowerCase();
      const nick = String(body?.nick ?? '').normalize('NFC').trim();
      // 한 줄 코멘트 — 줄바꿈·제어문자는 공백으로 눌러 담는다
      const text = String(body?.body ?? '').normalize('NFC')
        .replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();

      if (!PID_RE.test(pid))            return json({ error: 'bad pid' }, 400, allow);
      if (!NICK_RE.test(nick))          return json({ error: 'bad nick' }, 400, allow);
      if (text.length < 1)              return json({ error: 'empty' }, 400, allow);
      if (text.length > 140)            return json({ error: 'too long' }, 400, allow);

      // 도배 방지 — 점수 제출과 별도 카운터('p:' 접두사)
      const ip = 'p:' + await hash((req.headers.get('cf-connecting-ip') || '?') + '|' + (env.SALT || 'toegeun'));
      const now = Date.now();
      const last = await env.DB.prepare('SELECT at FROM rate WHERE ip = ?').bind(ip).first();
      if (last && now - last.at < 10000) return json({ error: 'too fast' }, 429, allow);
      await env.DB.prepare(
        'INSERT INTO rate (ip, at) VALUES (?, ?) ON CONFLICT(ip) DO UPDATE SET at = excluded.at'
      ).bind(ip, now).run();

      await env.DB.prepare('INSERT INTO posts (pid, nick, body, at) VALUES (?, ?, ?, ?)')
        .bind(pid, nick, text, now).run();
      return json({ ok: true }, 200, allow);
    }

    /* ── 익명게시판: 본인 글 삭제 ── */
    if (url.pathname === '/post/del' && req.method === 'POST') {
      let body;
      try { body = await req.json(); } catch { return json({ error: 'bad json' }, 400, allow); }
      const pid = String(body?.pid ?? '').toLowerCase();
      const id  = Math.trunc(Number(body?.id));
      if (!PID_RE.test(pid))                     return json({ error: 'bad pid' }, 400, allow);
      if (!Number.isFinite(id) || id < 1)        return json({ error: 'bad id' }, 400, allow);
      // pid 가 일치하는 글만 지워진다 — 남의 글은 건드릴 수 없다
      const r = await env.DB.prepare('DELETE FROM posts WHERE id = ? AND pid = ?').bind(id, pid).run();
      return json({ ok: true, deleted: r.meta?.changes || 0 }, 200, allow);
    }

    return json({ error: 'not found' }, 404, allow);
  },
};
