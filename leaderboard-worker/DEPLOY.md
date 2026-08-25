# 순위표 서버 배포

게임은 정적 사이트(GitHub Pages)라 DB를 직접 못 쓴다. 이 Worker 가 대신 DB에 접근하므로
**게임 페이지에는 어떤 키도 들어가지 않는다.**

## 1. 준비

```bash
npm install -g wrangler
wrangler login            # 브라우저가 열린다
```

## 2. D1 데이터베이스 생성

```bash
cd leaderboard-worker
wrangler d1 create toegeun
```

출력에 나오는 `database_id` 를 `wrangler.toml` 의 `PASTE_DATABASE_ID_HERE` 자리에 붙여넣는다.

## 3. 테이블 만들기

```bash
wrangler d1 execute toegeun --remote --file=./schema.sql
```

## 4. 레이트리밋 솔트 설정 (선택이지만 권장)

```bash
wrangler secret put SALT      # 아무 랜덤 문자열
```

## 5. 배포

```bash
wrangler deploy
```

끝나면 `https://toegeun-leaderboard.<계정>.workers.dev` 같은 주소가 출력된다.
**이 주소를 게임에 알려주면 순위표가 원격으로 전환된다** —
`leave-on-time/index.html` 에서 `LB.url` 한 줄만 채우면 된다:

```js
const LB = {
  url: 'https://toegeun-leaderboard.xxx.workers.dev',
```

## 6. 확인

```bash
curl 'https://.../top?n=5'
curl 'https://.../top?n=5&role=pm'          # 직군 탭
curl 'https://.../top?n=5&lang=kotlin'      # 언어 탭
curl -X POST https://.../score -H 'content-type: application/json' \
     -d '{"pid":"0123456789abcdef","nick":"칼퇴요정#a1f","lv":3,"score":12000,
          "seed":"ABC","role":"pm","lang":"policy"}'
```

## 서버가 막아주는 것

| 검증 | 내용 |
|---|---|
| 오리진 | `ALLOW_ORIGIN` 외의 사이트에서 온 브라우저 요청 거부 |
| 닉네임 형식 | 한글/영숫자 2~20자 + `#` + 16진수 3자. XSS 문자열 자체가 통과 못 함 |
| 레벨 범위 | 1~99 |
| 점수 개연성 | `20000×LV + 250×LV×(LV+1)` 초과 거부 |
| 팩 | `role` ∈ {dev, pm}, `lang` ∈ {js, kotlin, swift, policy}. 둘 다 있거나 둘 다 없어야 함 |
| 지갑 | `rev` 1~1e9 · `data` 4KB 이하 · JSON 객체여야 함 (배열·null·숫자 거부) · 3초 레이트리밋 |
| 도배 | 같은 IP 5초에 1회 (IP 는 해시로만 저장) |
| 삭제/수정 | API 자체에 경로가 없음 — 조회와 제출만 존재 |

## 막아주지 못하는 것

게임이 브라우저에서 돌기 때문에 **개연성 범위 안의 가짜 점수는 넣을 수 있다.**
완전히 막으려면 서버가 플레이를 재검증해야 하고, 그건 시드 + 입력 로그를 보내
Worker 에서 재시뮬레이션하는 방식이다 (시드 기반 난수는 이미 준비돼 있다).
사내 재미용 순위표 수준에서는 위 검증으로 충분하다.

## 마이그레이션 기록

스키마가 바뀔 때마다 `migrate-00N-*.sql` 을 추가한다. `--file` 은 D1 의 `/import` API 를
쓰는데 인증 오류가 나는 경우가 있어, 실무에서는 같은 SQL 을 `--command` 로 한 줄에 넣어 실행했다.

| 파일 | 내용 |
|---|---|
| `migrate-001-pid.sql` | 순위표 기본키를 닉네임 → pid 로 전환 (기존 기록 보존) |
| `migrate-002-posts.sql` | 익명게시판 `posts` 테이블 추가 |
| `migrate-003-pid-fullhex.sql` | pid 를 닉네임 전체 hex 로 재계산 (앞 16자만 쓰면 충돌) |
| `migrate-004-pack.sql` | 팩별 순위 `pack_scores` 추가 + 옛 기록을 `dev:js` 로 백필 (`scores` 는 손대지 않음) |
| `migrate-005-wallet.sql` | 지갑·인벤토리 `wallet` 테이블 추가 (pid 기준, 통 JSON + rev) |

### migrate-004 는 순서가 중요하다

`pack_scores` 는 **새 테이블**이라 기존 42행을 건드리지 않지만,
새 Worker 가 이 테이블에 INSERT 하므로 **마이그레이션을 Worker 배포보다 먼저** 실행해야 한다.

```bash
wrangler d1 execute toegeun --remote --file=./migrate-004-pack.sql   # 1
wrangler deploy                                                      # 2
git push                                                             # 3 (게임)
```

거꾸로 하면 `/score` 가 `scores` INSERT 는 성공하고 `pack_scores` INSERT 에서 터진다.
점수는 남고 응답만 500 이 되는 **절반만 성공한 상태**라 증상이 헷갈린다.

백필은 `scores` → `pack_scores(dev, js)` upsert 라 **순서가 뒤집혀도, 두 번 돌려도 안전하다**
(최고점만 남는다). 팩 도입 전 콘텐츠가 JavaScript 하나뿐이었으므로 `dev:js` 라벨이 사실에 맞다.
클라이언트 `readBoard()` 도 role 없는 로컬 행을 같은 기준으로 읽는다 — **한쪽만 바꾸면
서버가 살아있을 때와 죽었을 때 다른 목록이 나온다.**

확인:
```bash
curl -s 'https://.../top?n=50&lang=js'    | python3 -m json.tool | head
curl -s 'https://.../top?n=50'            | python3 -m json.tool | head   # total 이 같아야 한다
```

**실행 전 반드시 백업.** `/import` 를 쓰지 않으므로 인증 문제와 무관하다.

```bash
wrangler d1 execute toegeun --remote --command "SELECT * FROM scores" --json > backup-scores.json
```

백업 파일에는 다른 사용자들의 기록이 들어있어 `.gitignore` 로 제외한다.

### 배운 것

- D1 의 `--command` 는 여러 문장을 **트랜잭션으로** 처리한다. 중간에 실패하면 전부 롤백된다.
- SQLite 의 `ALTER TABLE ... RENAME TO` 는 **인덱스를 같은 이름으로 함께 이동**시킨다.
  새 인덱스를 만들기 전에 기존 인덱스를 `DROP` 해야 이름 충돌이 없다.
- 이관용 pid 를 닉네임 해시의 앞부분만 잘라 쓰면 안 된다. 한글은 글자당 3바이트라
  16자(8바이트)로는 2.7자밖에 담기지 않아 앞 글자가 겹치는 닉네임끼리 충돌한다.
