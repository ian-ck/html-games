-- 지갑·인벤토리를 pid 기준으로 서버에 둔다.
--
-- 왜 필요한가 — 코인과 아이템은 '진행도'다. 점수 한 줄 날아가는 것과 체감이 다르다.
-- localStorage 에만 두면 캐시를 지우거나 브라우저를 바꾸는 순간 전부 사라진다.
--
-- 왜 통 JSON 인가 — 서버가 아이템 카탈로그를 알 필요가 없게 하려고.
-- 컬럼으로 쪼개면 의상·장비를 추가할 때마다 클라이언트와 Worker 양쪽을 고쳐야 하고,
-- 그건 이 저장소가 이미 한 번 데인 함정이다(CLAUDE.md 「깨뜨리면 안 되는 것」 1번).
-- 서버는 크기·형식만 보고 내용은 클라이언트가 해석한다.
--
-- rev 는 단조 증가 카운터다. 클라이언트가 저장할 때마다 +1 하고,
-- 서버는 rev 가 기존 값 이상일 때만 덮어쓴다 (오래된 탭이 최신 지갑을 되돌리지 못하게).
--
-- ⚠️ 이 테이블은 위조를 막지 못한다. 점수와 같은 클라이언트 신뢰 모델이다.
--    목적은 무결성이 아니라 영속성이다.
CREATE TABLE IF NOT EXISTS wallet (
  pid  TEXT PRIMARY KEY,
  rev  INTEGER NOT NULL DEFAULT 0,
  data TEXT NOT NULL,               -- JSON: coins / owned / stock / gear / outfit / baseLook / pack
  at   INTEGER NOT NULL
);
