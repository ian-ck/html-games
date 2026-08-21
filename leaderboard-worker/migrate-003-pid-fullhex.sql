-- pid 를 '닉네임 전체 hex' 로 다시 계산한다.
--
-- migrate-001 은 hex(nick) 의 앞 16자(8바이트 ≈ 한글 2.7자)만 썼다.
-- 생성 닉네임이 '수식어+명사' 조합이라 앞 글자가 겹치기 쉬워서
-- '유령과장#aa2' 와 '유령고수#507' 이 같은 pid 로 계산돼 한 행이 사라졌다.
-- 전체 hex 는 닉네임과 1:1 이라 충돌이 원리적으로 없다.

UPDATE scores SET pid = lower(hex(nick));

-- migrate-001 충돌로 사라진 행 복구 (백업 backup-scores.json 기준)
INSERT OR IGNORE INTO scores (pid, nick, lv, score, seed, at)
VALUES ('ec9ca0eba0b9eab3a0ec889823353037', '유령고수#507', 1, 1918, 'HCLBNW', 1787284466114);
