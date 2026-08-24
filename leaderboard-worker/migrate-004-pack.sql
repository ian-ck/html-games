-- 직군·언어 팩별 순위표.
--
-- scores 는 손대지 않는다. 그 테이블은 '전체' 탭이고 pid 하나에 한 행(역대 최고점)이다.
-- 한 사람이 여러 팩을 뛸 수 있으므로 팩별 최고점은 별도 테이블에 (pid, role, lang) 로 남긴다.
-- scores 의 PK 를 바꾸는 방식은 살아있는 42행을 재생성해야 해서 택하지 않았다.
--
-- 옛 기록은 아래에서 dev:js 로 백필한다 (그때 콘텐츠가 JS 하나뿐이었으므로 사실에 맞다).
-- 재실행해도 안전하다 (CREATE ... IF NOT EXISTS + 최고점 유지 upsert).
CREATE TABLE IF NOT EXISTS pack_scores (
  pid   TEXT NOT NULL,
  role  TEXT NOT NULL,             -- dev | pm
  lang  TEXT NOT NULL,             -- js | kotlin | swift | policy
  nick  TEXT NOT NULL,
  lv    INTEGER NOT NULL,
  score INTEGER NOT NULL,
  seed  TEXT,
  at    INTEGER NOT NULL,
  PRIMARY KEY (pid, role, lang)
);
CREATE INDEX IF NOT EXISTS idx_pack_role ON pack_scores(role, score DESC);
CREATE INDEX IF NOT EXISTS idx_pack_lang ON pack_scores(lang, score DESC);

-- 옛 기록을 dev:js 로 이관.
--
-- 팩 선택이 생기기 전에는 커밋 문장도 버그 코드도 **JavaScript 판 하나뿐**이었다
-- (consol.log / improt React / const arr = [1,2,3; ...). 그래서 dev:js 라벨이 추정이 아니라 사실이다.
-- 팩이 여러 개가 된 뒤의 기록에는 절대 이 가정을 쓰면 안 된다.
--
-- Worker 와 같은 upsert 를 써서 순서·재실행에 안전하게 만든다.
-- 이 스크립트를 Worker 배포 뒤에 돌려도 이미 들어온 실제 dev:js 기록을 낮은 값으로 덮지 않는다.
INSERT INTO pack_scores (pid, role, lang, nick, lv, score, seed, at)
SELECT pid, 'dev', 'js', nick, lv, score, seed, at FROM scores
-- WHERE true 는 장식이 아니다. INSERT ... SELECT 뒤의 ON CONFLICT 는 SQLite 파서가
-- 애매해져서 'near DO: syntax error' 를 낸다. WHERE 절이 경계를 만들어준다.
WHERE true
ON CONFLICT(pid, role, lang) DO UPDATE SET
  nick  = excluded.nick,
  lv    = CASE WHEN excluded.score > pack_scores.score THEN excluded.lv   ELSE pack_scores.lv   END,
  seed  = CASE WHEN excluded.score > pack_scores.score THEN excluded.seed ELSE pack_scores.seed END,
  at    = CASE WHEN excluded.score > pack_scores.score THEN excluded.at   ELSE pack_scores.at   END,
  score = MAX(pack_scores.score, excluded.score);
