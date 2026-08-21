-- 점수: 닉네임당 최고 기록만 유지
CREATE TABLE IF NOT EXISTS scores (
  nick  TEXT PRIMARY KEY,
  lv    INTEGER NOT NULL,
  score INTEGER NOT NULL,
  seed  TEXT,
  at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_scores_score ON scores(score DESC);

-- 레이트리밋: 원본 IP 는 저장하지 않고 해시만 보관
CREATE TABLE IF NOT EXISTS rate (
  ip TEXT PRIMARY KEY,
  at INTEGER NOT NULL
);
