-- 어뷰징 기록 제거 — 저점매수#17f (lv 99 / score 999999)
--
-- 현재 점수식으로 lv99 는 누적 이론최대 3,663,000 이지만
-- lv1 한 판의 이론최대가 6,100 이고 실제 최고 기록은 lv16 / 158,418 이다.
-- lv=99 AND score=999999 는 정상 플레이로 나올 수 없는 조합이라 이 세 조건으로만 지운다
-- (닉네임만으로 지우면 우연히 같은 닉을 뽑은 사람이 걸린다).
--
-- ⚠️ scores(전체 탭) 와 pack_scores(직군·언어 탭) 두 곳에 다 있다. 한쪽만 지우면 남는다.
-- ⚠️ 실행 전 백업: wrangler d1 execute toegeun --remote --command "SELECT * FROM scores" --json > backup-scores.json

-- 1) 먼저 확인 (지우기 전에 이 SELECT 부터 돌려볼 것)
--    SELECT pid, nick, lv, score, datetime(at/1000,'unixepoch','+9 hours') FROM scores
--      WHERE nick = '저점매수#17f' AND lv = 99 AND score = 999999;

DELETE FROM scores
  WHERE nick = '저점매수#17f' AND lv = 99 AND score = 999999;

DELETE FROM pack_scores
  WHERE nick = '저점매수#17f' AND lv = 99 AND score = 999999;
