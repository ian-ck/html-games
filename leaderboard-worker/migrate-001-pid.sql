-- 닉네임 기본키 → pid 기본키. 기존 기록을 보존한다.
--
-- 기존 행에는 pid 가 없다. 그래서 닉네임의 UTF-8 바이트 앞 16자에서 결정적으로 만들어 낸다.
-- 클라이언트도 pid 가 없고 닉네임만 있는 사용자에게 똑같은 계산을 적용하므로,
-- 기존 플레이어가 다시 접속하면 옛 기록에 그대로 이어붙는다.
--
-- 주의: SQLite 는 ALTER TABLE RENAME 시 인덱스를 같은 이름으로 함께 옮긴다.
--       그래서 새 인덱스를 만들기 전에 기존 인덱스를 먼저 지워야 이름 충돌이 없다.

DROP INDEX IF EXISTS idx_scores_score;

ALTER TABLE scores RENAME TO scores_old;

CREATE TABLE scores (
  pid   TEXT PRIMARY KEY,
  nick  TEXT NOT NULL,
  lv    INTEGER NOT NULL,
  score INTEGER NOT NULL,
  seed  TEXT,
  at    INTEGER NOT NULL
);

-- 앞 16자가 겹치는 닉네임이 있으면 점수 오름차순 + OR REPLACE 로 높은 점수가 남는다
INSERT OR REPLACE INTO scores (pid, nick, lv, score, seed, at)
SELECT lower(substr(hex(nick) || '0000000000000000', 1, 16)), nick, lv, score, seed, at
FROM scores_old
ORDER BY score ASC;

CREATE INDEX idx_scores_score ON scores(score DESC);

DROP TABLE scores_old;
