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
curl -X POST https://.../score -H 'content-type: application/json' \
     -d '{"nick":"칼퇴요정#a1f","lv":3,"score":12000,"seed":"ABC"}'
```

## 서버가 막아주는 것

| 검증 | 내용 |
|---|---|
| 오리진 | `ALLOW_ORIGIN` 외의 사이트에서 온 브라우저 요청 거부 |
| 닉네임 형식 | 한글/영숫자 2~20자 + `#` + 16진수 3자. XSS 문자열 자체가 통과 못 함 |
| 레벨 범위 | 1~99 |
| 점수 개연성 | `20000×LV + 250×LV×(LV+1)` 초과 거부 |
| 도배 | 같은 IP 5초에 1회 (IP 는 해시로만 저장) |
| 삭제/수정 | API 자체에 경로가 없음 — 조회와 제출만 존재 |

## 막아주지 못하는 것

게임이 브라우저에서 돌기 때문에 **개연성 범위 안의 가짜 점수는 넣을 수 있다.**
완전히 막으려면 서버가 플레이를 재검증해야 하고, 그건 시드 + 입력 로그를 보내
Worker 에서 재시뮬레이션하는 방식이다 (시드 기반 난수는 이미 준비돼 있다).
사내 재미용 순위표 수준에서는 위 검증으로 충분하다.
