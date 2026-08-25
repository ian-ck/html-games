# 작업 안내 (퇴근 스쿨버스)

브라우저에서 도는 탑다운 픽셀 스텔스 게임 + Cloudflare 순위표/게시판.
빌드 도구 없음. `leave-on-time/index.html` 단일 파일에 HTML·CSS·JS가 전부 들어있다.

설계 세부와 밸런스 표는 [`ARCHITECTURE.md`](ARCHITECTURE.md) 참고. **맵이나 밸런스를 건드리기 전에 읽을 것.**

## 구성

```
index.html                  허브 (게임 목록)
leave-on-time/index.html    게임 본체 (~1,950줄, 단일 파일)
leave-on-time/assets/       스프라이트 (furniture 42 / characters 3 / 직접 그린 4)
leaderboard-worker/         Cloudflare Worker + D1 (순위표·익명게시판 API)
```

## 배포 — 두 갈래다

| 대상 | 방법 | 결과 |
|---|---|---|
| 게임·허브 | `git push` (main) | GitHub Pages 자동 빌드, 약 20~60초 |
| D1 스키마 | `wrangler d1 execute toegeun --remote --file=migrate-00N-*.sql` | 즉시 |
| 순위표 API | `cd leaderboard-worker && wrangler deploy` | 즉시 |

**순서가 있다: 마이그레이션 → Worker → 게임.** 거꾸로 하면 새 Worker 가 없는 테이블에
INSERT 해서 500 을 낸다. `scores` 쪽은 이미 커밋되어 있어 점수는 남고 응답만 실패하는
**절반만 성공한 상태**가 되므로 증상이 헷갈린다.

- 게임: https://ian-ck.github.io/html-games/leave-on-time/
- API: https://toegeun-leaderboard.ian-ck-games.workers.dev

**둘은 독립이다.** Worker만 배포하고 게임을 push하지 않으면(또는 반대) 스키마가 어긋나 조용히 깨진다.
실제로 클라이언트가 `pid`를 보내는데 Worker가 옛 검증을 쓰고 있어 모든 점수 제출이 거부된 적이 있다.
**양쪽을 바꿨으면 양쪽을 다 배포하고, 배포 후 실제 엔드포인트로 확인할 것.**

### ⚠️ 캐시 10분

GitHub Pages 응답이 `cache-control: max-age=600`이다. 배포가 끝나도 브라우저는 최대 10분간 옛 파일을 쓴다.
"푸시했는데 왜 그대로지?"의 대부분이 이것. 확인할 땐 **`Cmd+Shift+R`** 또는 주소에 `?x=1`.
남에게 공유할 땐 10분 뒤에.

## 로컬 실행

```bash
cd html-games && python3 -m http.server 8765
# http://localhost:8765/leave-on-time/
```

`file://`로 열어도 동작한다(애셋 로딩 확인함). 다만 Worker의 CORS 허용 목록에
`http://localhost:8765`가 들어있으므로 **순위표까지 테스트하려면 이 포트를 쓸 것.**

## 테스트 — 여기서 여러 번 데였다

### 브라우저 자동화의 함정

1. **`element.click()`으로 클릭을 검증하지 말 것.**
   mousedown/mouseup을 건너뛰기 때문에 실제 클릭에서만 나는 버그를 못 잡는다.
   헤더 버튼이 사람 손으로는 절대 안 눌리는 버그를 이 방식으로 여러 번 "통과"시켰다.
   반드시 CDP로 진짜 마우스 이벤트를 쏠 것:
   ```python
   cdp("Input.dispatchMouseEvent", type="mousePressed",  x=X, y=Y, button="left", clickCount=1)
   time.sleep(0.12)                      # 사람 클릭은 50~150ms
   cdp("Input.dispatchMouseEvent", type="mouseReleased", x=X, y=Y, button="left", clickCount=1)
   ```

2. **탭이 백그라운드면 `requestAnimationFrame`이 멈춘다.**
   게임 루프·타이머·DOM 갱신이 전부 정지한다. 그 상태에서 DOM이나 **캔버스 픽셀**을 읽으면
   **얼어붙은 옛 프레임**이 나온다. 실제로 이걸로 없는 버그를 하나 만들어냈다 —
   옷을 갈아입힌 뒤 캔버스에서 새 색이 0px 나와서 렌더 버그로 오진했는데,
   캔버스가 옷 갈아입기 전 프레임에 멈춰 있던 것이었다.

   **측정 직전에 rAF 가 살아있는지 먼저 확인할 것.** 숨은 탭에서는 이 호출이 타임아웃한다:
   ```python
   js("(()=>new Promise(r=>requestAnimationFrame(()=>r(1))))()")   # 타임아웃 = 루프 정지
   print(js("document.visibilityState"))                            # 'hidden' 이면 측정 무효
   ```
   `Page.bringToFront` 는 사용자 창을 빼앗으므로 **남의 기계에서는 함부로 쓰지 말 것.**
   사용자가 브라우저를 쓰는 순간 탭이 뒤로 가고 그 시점부터 모든 측정이 거짓이 된다.

   **캔버스 픽셀 대신 순수 함수로 검증할 수 있으면 그쪽이 낫다.** 위 오진은
   같은 색 매핑을 Python(PIL)으로 재현해 두 케이스가 동일함을 보이는 것으로 5초에 끝났다.

3. **`js()` 반환값 판정을 조심할 것.** 문자열 `"false"`를 참으로 읽어 두 번 오진했다.
   `json.loads(js("JSON.stringify(...)"))`로 받을 것.

4. **하버니스의 현재 탭이 옮겨 다닌다.** 사용자가 브라우저를 쓰면 대상이 바뀐다.
   한 번의 호출 안에서 `new_tab()` → 검증 → 정리까지 끝낼 것.
   `Page.bringToFront` 는 사용자의 작업 창을 빼앗는다 — **여러 케이스를 한 호출로 묶어서**
   포커스 탈취 횟수를 최소로. 반복 라운드가 필요하면 원격 브라우저를 먼저 제안할 것.

5. **비교 검증은 기준값을 매번 초기화할 것.** 직전 테스트가 남긴 값 때문에
   "변화 없음"을 실패로 오독한 적이 있다.

### 맵을 건드렸으면 경로 검사

가구를 놓거나 옮기면 **동선이 막힐 수 있다.** 시야 차단물을 옮기다 엘베 통로를 막은 적이 있다.
NPC 경로만 보지 말고 **플레이어 도달 가능성**을 BFS로 검사할 것 —
플레이어 반경 14px 원이 지나갈 수 있는지, 6개 시작 지점에서 17개 미션 지점
(책상 12 + 사물함/쓰레기통/싱크대/화장실/엘베) 전부에 닿는지.
사물함 후보 3곳 × 랜덤 배치 조합을 모두 확인할 것.

### 콘솔 디버그 훅

```js
__dbg()          // 상태 전체 (플레이어·NPC·시드·pid·자리 배치·점수·팩·할일 완료여부)
__tp(x, y)       // 순간이동 — 결정적 테스트의 핵심
__clock(초)      // 마감 시간 조작
__adv()          // 다음 레벨 / 재시작
__coin(n)        // 코인 지급
__giveAll()      // 의상·장비 전부 + 소모품 9개씩 — 상점/효과 테스트용
```

URL 파라미터: `?day=6` `?goto=err|sink|cup|desk|locker|trash|wc|elev` `&bug=0~11` `?seed=abc`
`?pack=dev:js|dev:kotlin|dev:swift|pm:policy` (직군·언어 팩 고정)
게임 화면에는 노출하지 않는다(푸터에서 뺐음).

## 깨뜨리면 안 되는 것

1. **클라이언트와 Worker의 닉네임 정규식은 같아야 한다.**
   지금 둘 다 `2~10자 + #16진수3자`. 한쪽만 바꾸면 조용히 거부되거나 우회된다.

2. **직군·언어 팩의 배열 길이를 맞출 것 — `bugs` 12개, `commits` 6개.**
   `rEvt()` 로 인덱싱하므로 길이가 다르면 같은 시드가 팩마다 다른 문제를 낸다.
   같은 슬롯 번호는 팩끼리 같은 난이도여야 한다(팩 주석의 `SLOTS` 계약).
   글자수는 15~40자 밴드 — par 이 글자수의 함수라서 벗어나면 팩끼리 점수가 어긋난다.
   ```bash
   # 12/6 규격 + par 캘리브레이션 확인
   python3 - <<'EOF'
   import io,re
   s=io.open('leave-on-time/index.html',encoding='utf-8').read()
   blk=s[s.index('const DEV_COMMON'):s.index('const tLabel')]
   for m in re.finditer(r"^'([\w:]+)':", blk, re.M):
       b=blk[m.start():]; nxt=re.search(r"\n'[\w:]+':", b)
       b=b[:nxt.start()] if nxt else b
       nb=len(re.findall(r'\{bad:', b))
       cs=b.index('commits:['); nc=len(re.findall(r"'[^']*'", b[cs:b.index(chr(10)+'  ],',cs)]))
       print(m.group(1), 'bugs',nb, 'commits',nc, '✅' if (nb,nc)==(12,6) else '❌')
   EOF
   ```

3. **`ascii:true` 팩에 한글을 쓰지 말 것.** 입력창이 한글을 걸러내므로 문제가 입력 불가가 된다.
   반대로 `ascii:false`(기획자) 팩에서 필터를 켜면 입력이 통째로 지워진다.
   `ASCII_MODE` 는 `P.ascii` 를 본다 — kind 로 하드코딩하지 말 것.

4. **시드 난수 스트림을 섞지 말 것.**
   `rMap`(맵 배치, 레벨 시작에 한 번만 소비) / `rEvt`(이벤트) 분리가 핵심이다.
   `rMap`이 플레이 방식과 무관하게 같은 배치를 내야 **데일리 챌린지·멀티플레이**가 가능하다.
   거품·효과음 같은 연출은 `Math.random()` 그대로 둘 것.

   **팩 키는 시드 파생식에 넣지 말 것.** 같은 시드는 어느 팩에서든 같은 배치여야 한다.

5. **원격 문자열은 반드시 `esc()`로 escape.**
   순위표 닉네임과 게시판 본문은 남이 쓴 값이다. `innerHTML`에 그냥 넣으면 XSS.

6. **매 프레임 `innerHTML`을 쓰지 말 것.** 반드시 `setHTML(node, key, html)`을 쓴다.
   내용이 같으면 DOM을 건드리지 않는다. 이걸 어기면 그 안의 버튼이 초당 60회 파괴·재생성되어
   **click 이벤트가 아예 발생하지 않는다.**

7. **CSS를 편집했으면 중괄호 균형을 검사할 것.**
   앵커 텍스트를 잘못 복제해 닫히지 않은 규칙이 생겨 **그 뒤 75개 규칙이 통째로 무효화**된 적이 있다.
   증상이 "왜 이 스타일만 안 먹지"로 나타난다.
   ```bash
   python3 -c "s=open('leave-on-time/index.html',encoding='utf-8').read(); c=s[s.index('<style>')+7:s.index('</style>')]; print(sum((ch=='{')-(ch=='}') for ch in c))"
   ```
   `0`이 아니면 깨진 것.

8. **한글은 `.normalize('NFC')`로 정규화할 것.** 플랫폼마다 정규화가 달라
   같은 닉네임이 다른 바이트가 되면 순위 조회가 조용히 실패한다.
   **기획자 팩의 정답 비교도 같은 이유로 NFC 정규화 후에 한다** (`submitTyping`).
   안 하면 눈으로 똑같은 문장을 치고도 "오타"로 거부된다.

9. **캐릭터 외형: 원본 `IMG.ch1` 을 치환하지 말 것.**
   순회 동료가 `ch1`/`ch2` 를 쓴다. 원본을 고치면 동료들 옷이 같이 바뀐다.
   `buildLook()` 이 오프스크린 canvas 로 `IMG.me` 를 따로 굽고 플레이어만 그걸 쓴다.
   **아웃라인 `#2e222f` 은 전 부위가 공유하므로 색 램프에 절대 넣지 말 것** — 실루엣이 무너진다.

10. **입력칸 없는 모달을 만들면 전역 키를 막을 것.**
   전역 keydown 이 `Space`/`Enter` 로 `advance()` 를 호출한다. 막지 않으면
   타이틀에서 모달을 열어둔 채 Space 를 누르면 판이 시작된다.
   게시판은 입력칸이 `stopPropagation()` 해서 우연히 막히지만, 장비창은 명시적으로 막았다.

11. **순위표 탭의 서버 필터와 로컬 폴백 필터를 같이 고칠 것.**
   `LBTABS` 의 `q`(서버 쿼리)와 `f`(localStorage 필터)가 한 줄에 나란히 있다.
   한쪽만 고치면 서버가 살아있을 때와 죽었을 때 다른 목록이 나와 버그로 보이지 않는다.

## 애셋

- 가구 — [Free Furniture Office Equipment Set](https://stcrbcn.itch.io/furniture-office-set) by Antea · **CC BY 4.0 (표기 의무)**
- 캐릭터 — [Free Pixel Characters Pack 32x32](https://kettoman.itch.io/free-pixel-characters-pack-32x32) by Kettoman
- `assets/furniture-extra/` 4개는 직접 만든 것 (머그컵 신규 / 컵 지운 책상 / 초록·빨강 모니터)

크레딧이 **게임 푸터와 허브 하단 두 곳**에 있다. CC BY 4.0이라 지우면 안 된다.

## 커밋하지 말 것

`.gitignore`에 있지만 확인 습관을 들일 것 — public 레포다.

- `leaderboard-worker/.wrangler/` — 계정 ID와 계정명(개인 이메일 기반)이 들어있다
- `backup-*.json` — 다른 사용자들의 기록
- `.DS_Store`

`wrangler.toml`의 `database_id`는 **비밀이 아니다**(식별자일 뿐, 접근에는 계정 토큰이 필요).
`SALT`는 `wrangler secret`으로만 관리하며 레포에 없다.
