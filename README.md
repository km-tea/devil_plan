# 데블스 플랜 · 교실 두뇌 게임

데블스 플랜의 게임을 차용해 **초등 6학년 교육과정(수학)과 연계**한 웹앱입니다.
GitHub(코드) → Netlify(화면 + 서버 함수) → Neon(데이터베이스) 로 구성됩니다. 빌드 과정이 없어 그대로 배포됩니다.

현재 게임: **기억 포커** (2인 / 컴퓨터 연습)
- 힌트 = 문제 풀이: **분수의 나눗셈 · 소수의 나눗셈 · 비례배분** (방 만들 때 종류 선택, 기본은 모두 섞어서)
- 컴퓨터 연습: 항상 최선을 고르지 않고 **만들 수 있는 족보 중 확률로 결과가 나옴**. 난이도 쉬움/보통/어려움 (어려울수록 높은 족보 확률 ↑)
  - 확률 조정: `netlify/functions/lib/games/memory-poker/bot.js` 의 `WEIGHTS`
- 태블릿(가로/세로): 왼쪽 카드판 + 오른쪽 족보표·타이머·선택칸·버튼이 한 화면에 보이도록 배치 (폰은 위→아래 한 줄)

## 배포 순서
1. **GitHub**: 이 폴더 전체를 새 저장소에 올립니다.
2. **Neon**: 프로젝트를 만들고 *Connection string*을 복사합니다. 호스트에 `-pooler`가 붙은 주소를 쓰세요. (테이블은 첫 요청 때 자동 생성됩니다)
3. **Netlify**: *Add new site → Import from GitHub* 로 저장소를 연결합니다. (설정은 `netlify.toml`에 들어 있어 그대로 두면 됩니다)
4. **환경변수**: Netlify → Site configuration → Environment variables 에 `DATABASE_URL` = Neon 주소를 추가하고 다시 배포합니다.
   (Netlify의 Neon 연동 기능을 쓰면 `NETLIFY_DATABASE_URL`이 자동으로 들어가며, 이 경우도 그대로 동작합니다.)
5. 태블릿 2대로 접속해 확인: 한쪽이 **방 만들기** → 4자리 번호 → 다른 쪽이 **번호로 입장**.

## 구조
```
public/                      화면 (index.html, css, js)
  js/core.js                 공통: 게임 목록, 방 만들기/입장, 서버 동기화, 타이머
  js/games/memory-poker.js   기억 포커 화면
netlify/functions/
  api.js                     API 입구 (모든 요청이 여기로)
  lib/rooms.js               방 생성/입장/상태 저장 (모든 게임 공통)
  lib/games/index.js         게임 등록부
  lib/games/memory-poker/    규칙(rules) · 문제 생성(questions) · 컴퓨터(bot) · 진행(index)
test/                        자동 테스트 (npm install 후 npm test)
```

## 서버 안정성 설계
- **방마다 독립된 한 줄**(rooms 테이블)이라 방이 많아도 서로 영향이 없습니다.
- **낙관적 잠금**: 두 학생이 동시에 눌러도 서로의 변경을 덮어쓰지 않고 자동 재시도합니다.
- **짧은 응답**: 바뀐 게 없으면 아주 작은 응답만 보냅니다. 폴링 간격은 1.5~2.5초이며 학생마다 조금씩 어긋나게 해 한꺼번에 몰리지 않습니다. 탭이 숨겨지면 8초, 오류가 나면 점점 느려집니다.
- **Neon HTTP 드라이버**: 요청마다 연결을 유지하지 않아 연결 수 제한에 걸리지 않습니다.
- **서버 기준 시각**: 타이머는 서버가 기준이라 태블릿 시계가 달라도 공정합니다.
- **숨겨진 정보**: 암기 단계 이후에는 16장의 정체와 상대의 선택을 학생 기기로 보내지 않습니다.
- 3시간 지난 방은 자동 정리됩니다. 방 번호는 4자리(0000~9999)라 동시에 열 수 있는 방은 최대 1만 개입니다.

## 새 게임 추가하기
1. `netlify/functions/lib/games/<새게임>/index.js` — 규칙 모듈 (`create / join / advance / handle / view / stableForPoll`, 기억 포커 참고)
2. `netlify/functions/lib/games/index.js` 에 한 줄 등록
3. `public/js/games/<새게임>.js` — `App.registerGame({...})` 로 화면 등록, `index.html`에 script 한 줄 추가

## 학습 기록
- `answer_logs`: 힌트 문제 풀이 기록 (이름, 문제, 정오답)
- `game_results`: 게임 결과 기록
