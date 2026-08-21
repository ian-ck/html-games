-- 점수: 숨은 고유 ID(pid)가 기본키. 닉네임은 표시용이라 언제든 바뀐다.
-- 닉네임을 키로 쓰면 이름을 바꿀 때마다 새 행이 생겨 같은 사람이 여러 번 등장한다.
CREATE TABLE IF NOT EXISTS scores (
  pid   TEXT PRIMARY KEY,          -- 16자리 16진수, 클라이언트가 처음 1회 생성
  nick  TEXT NOT NULL,             -- 표시용 닉네임 (변경 가능)
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

-- 익명게시판: 한 줄 코멘트. 대댓글 없음.
CREATE TABLE IF NOT EXISTS posts (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  pid  TEXT NOT NULL,               -- 작성자 신원 (본인 삭제용, 화면에 노출하지 않음)
  nick TEXT NOT NULL,               -- 작성 당시 닉네임
  body TEXT NOT NULL,
  at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_posts_at ON posts(at DESC);
