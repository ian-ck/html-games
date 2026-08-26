/**
 * 퇴근 스쿨버스 — 순위표 API
 *
 * GET  /top?n=10&pid=...&role=dev|pm&lang=js|kotlin|swift|policy
 *          ->  { rows:[{nick,lv,score}], myRank, total }
 *          role/lang 이 없으면 전체(scores), 있으면 팩별(pack_scores) 순위다.
 * POST /score  { pid, nick, lv, score, seed, role, lang }  ->  { ok:true }
 *
 * GET  /content                    ->  { packs: { 'dev:js': {bugs,commits,slacks}, ... } }
 *   팩 문항. 전 팩을 한 번에 준다 — 팩을 바꿀 때마다 재요청하지 않게.
 *   개수가 12/6/8 이 아니면 클라이언트가 번들된 기본 배열로 되돌린다.
 *
 * GET  /wallet?pid=...              ->  { rev, data }   (없으면 rev:0, data:null)
 * POST /wallet { pid, rev, data }   ->  { ok:true, rev }
 *   지갑·인벤토리. 서버는 아이템 카탈로그를 모른다 — 크기·형식만 보고 내용은 클라이언트가 해석한다.
 *   목적은 무결성이 아니라 **영속성**이다 (캐시를 지워도 pid 만 있으면 되찾는다).
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

// 직군·언어 팩. 클라이언트의 PACKS 키와 짝이 맞아야 한다 — 한쪽만 늘리면 조용히 400 이 된다.
const ROLES = ['dev', 'pm', 'design'];
const LANGS = ['js', 'kotlin', 'swift', 'java', 'policy', 'design'];

// 지갑 JSON 크기 상한. 의상·장비가 늘어도 여유 있는 값이다.
const WALLET_MAX = 4096;

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

      // 탭 필터 — role/lang 중 하나만 온다. 둘 다 없으면 전체 순위(scores).
      const fRole = (url.searchParams.get('role') || '').toLowerCase();
      const fLang = (url.searchParams.get('lang') || '').toLowerCase();
      if (fRole && !ROLES.includes(fRole)) return json({ error: 'bad role' }, 400, allow);
      if (fLang && !LANGS.includes(fLang)) return json({ error: 'bad lang' }, 400, allow);

      // 전체는 scores(pid 당 한 행), 팩별은 pack_scores(pid+role+lang 당 한 행)를 본다.
      // tbl·cond 는 위 화이트리스트에서만 나오므로 문자열로 이어도 안전하다.
      const tbl  = (fRole || fLang) ? 'pack_scores' : 'scores';
      const cond = fRole ? ' WHERE role = ?' : fLang ? ' WHERE lang = ?' : '';
      const args = (fRole || fLang) ? [fRole || fLang] : [];

      const top = await env.DB.prepare(
        'SELECT nick, lv, score FROM ' + tbl + cond + ' ORDER BY score DESC, at ASC LIMIT ?'
      ).bind(...args, n).all();

      const cnt = await env.DB.prepare(
        'SELECT COUNT(*) AS c FROM ' + tbl + cond
      ).bind(...args).first();

      // 내 순위는 pid 로 찾는다 (닉네임은 바뀔 수 있으므로). 순위도 같은 탭 필터 안에서 센다.
      let myRank = 0;
      const pid = (url.searchParams.get('pid') || '').toLowerCase();
      if (PID_RE.test(pid)) {
        const and = cond ? cond + ' AND' : ' WHERE';
        const mine = await env.DB.prepare(
          'SELECT MAX(score) AS score FROM ' + tbl + and + ' pid = ?'
        ).bind(...args, pid).first();
        if (mine && mine.score != null) {
          const above = await env.DB.prepare(
            'SELECT COUNT(*) AS c FROM ' + tbl + and + ' score > ?'
          ).bind(...args, mine.score).first();
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
      // 팩은 없어도 받는다 — 팩 도입 전 클라이언트(GitHub Pages 캐시 최대 10분)가 아직 돌 수 있다.
      // 없으면 '전체' 순위에만 들어간다. 팩 도입 전 기록은 migrate-004 가 dev:js 로 백필했다.
      const role  = String(body?.role ?? '').toLowerCase();
      const lang  = String(body?.lang ?? '').toLowerCase();

      if (!PID_RE.test(pid))                         return json({ error: 'bad pid' }, 400, allow);
      if (role && !ROLES.includes(role))             return json({ error: 'bad role' }, 400, allow);
      if (lang && !LANGS.includes(lang))             return json({ error: 'bad lang' }, 400, allow);
      if (!!role !== !!lang)                         return json({ error: 'bad pack' }, 400, allow);
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

      // 팩별 순위 — 같은 사람이 여러 팩을 뛸 수 있으므로 (pid, role, lang) 마다 최고점을 따로 남긴다.
      if (role && lang) {
        await env.DB.prepare(
          `INSERT INTO pack_scores (pid, role, lang, nick, lv, score, seed, at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(pid, role, lang) DO UPDATE SET
             nick  = excluded.nick,
             lv    = CASE WHEN excluded.score > pack_scores.score THEN excluded.lv   ELSE pack_scores.lv   END,
             seed  = CASE WHEN excluded.score > pack_scores.score THEN excluded.seed ELSE pack_scores.seed END,
             at    = CASE WHEN excluded.score > pack_scores.score THEN excluded.at   ELSE pack_scores.at   END,
             score = MAX(pack_scores.score, excluded.score)`
        ).bind(pid, role, lang, nick, lv, score, seed, now).run();
      }

      // 오래된 레이트리밋 기록 청소 (드물게)
      if (Math.random() < 0.02)
        await env.DB.prepare('DELETE FROM rate WHERE at < ?').bind(now - 86400000).run();

      return json({ ok: true }, 200, allow);
    }

    /* ── 팩 문항 ── */
    if (url.pathname === '/content' && req.method === 'GET') {
      // slot 순서가 곧 문항 순서다. 같은 시드가 같은 문제를 내려면 이 정렬이 고정이어야 한다.
      const r = await env.DB.prepare(
        'SELECT pack, kind, slot, a, b, c, d FROM content ORDER BY pack, kind, slot'
      ).all();
      const packs = {};
      for (const row of (r.results || [])) {
        const p = packs[row.pack] || (packs[row.pack] = { bugs: [], commits: [], slacks: [] });
        if (row.kind === 'bug')         p.bugs.push({ bad: row.a, fix: row.b, err: row.c, tok: row.d || '' });
        else if (row.kind === 'commit') p.commits.push(row.a);
        else if (row.kind === 'slack')  p.slacks.push([row.a, row.b]);
      }
      return new Response(JSON.stringify({ packs }), {
        // 문항은 모두에게 같다. 1분 캐시면 SQL 로 고쳐도 곧 반영되고 D1 부하도 준다.
        headers: { 'content-type': 'application/json; charset=utf-8',
                   'cache-control': 'public, max-age=60', ...CORS(allow) },
      });
    }

    /* ── 지갑 조회 ── */
    if (url.pathname === '/wallet' && req.method === 'GET') {
      const pid = (url.searchParams.get('pid') || '').toLowerCase();
      if (!PID_RE.test(pid)) return json({ error: 'bad pid' }, 400, allow);
      const r = await env.DB.prepare('SELECT rev, data FROM wallet WHERE pid = ?').bind(pid).first();
      return json({ rev: r?.rev || 0, data: r?.data || null }, 200, allow);
    }

    /* ── 지갑 저장 ── */
    if (url.pathname === '/wallet' && req.method === 'POST') {
      let body;
      try { body = await req.json(); } catch { return json({ error: 'bad json' }, 400, allow); }

      const pid  = String(body?.pid ?? '').toLowerCase();
      const rev  = Math.trunc(Number(body?.rev));
      const data = String(body?.data ?? '');

      if (!PID_RE.test(pid))                              return json({ error: 'bad pid' }, 400, allow);
      if (!Number.isFinite(rev) || rev < 1 || rev > 1e9)  return json({ error: 'bad rev' }, 400, allow);
      if (data.length > WALLET_MAX)                       return json({ error: 'too big' }, 400, allow);
      // 내용은 해석하지 않지만 JSON 은 맞아야 한다 — 쓰레기가 쌓이면 조회가 통째로 깨진다
      try { const o = JSON.parse(data); if (!o || typeof o !== 'object' || Array.isArray(o)) throw 0; }
      catch { return json({ error: 'bad data' }, 400, allow); }

      const ip = 'w:' + await hash((req.headers.get('cf-connecting-ip') || '?') + '|' + (env.SALT || 'toegeun'));
      const now = Date.now();
      const last = await env.DB.prepare('SELECT at FROM rate WHERE ip = ?').bind(ip).first();
      if (last && now - last.at < 3000) return json({ error: 'too fast' }, 429, allow);
      await env.DB.prepare(
        'INSERT INTO rate (ip, at) VALUES (?, ?) ON CONFLICT(ip) DO UPDATE SET at = excluded.at'
      ).bind(ip, now).run();

      // rev 가 서버 값 이상일 때만 덮어쓴다 — 오래 열려 있던 탭이 최신 지갑을 되돌리지 못하게
      await env.DB.prepare(
        `INSERT INTO wallet (pid, rev, data, at) VALUES (?, ?, ?, ?)
         ON CONFLICT(pid) DO UPDATE SET
           rev = excluded.rev, data = excluded.data, at = excluded.at
         WHERE excluded.rev >= wallet.rev`
      ).bind(pid, rev, data, now).run();

      const cur = await env.DB.prepare('SELECT rev FROM wallet WHERE pid = ?').bind(pid).first();
      return json({ ok: true, rev: cur?.rev || 0 }, 200, allow);
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
