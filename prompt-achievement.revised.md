이 저장소(업적 라이브러리, Life Hub 목적지 id `achievement`)에서 Life Board(https://github.com/KINGJNU-sakayume/board)에 보낼 **보드 타일**을 정하고, 그 데이터를 만들어 Life Hub에 올리는 코드를 추가해 주세요. README도 함께 갱신합니다.

## 먼저 읽을 것
1. 보드 디자인 규칙 docs/DESIGN.md, 2. 규격 v1 docs/TILES.md(검증: board js/schema.js, 허용 출처: js/config.js), 3. 후보 docs/CANDIDATES.md 「업적 라이브러리」 절 (모두 https://github.com/KINGJNU-sakayume/board/blob/main/ 아래)
4. 이 저장소: README, `src/lib/appState.js`(저장 형식 v2), `src/context/AppContext.jsx`(평가 결과 `isEarned/earnedAt/progress/target`), `src/utils/achievementEvaluator.js`, `src/utils/achievementText.js`, `src/lifehub/remote.js`·`LifeHub.jsx`·`remote.test.js`. AGENTS.md·CLAUDE.md는 없습니다.

## 이 앱의 사실 (코드로 확인함)
- 기록 `{id, categoryId, date(YYYY-MM-DD, 로컬), value, unit, memo, photoUrl, tags}`에는 **시각이 없습니다.** 업적 달성일(`earnedAt`)도 날짜뿐입니다. 직접 체크 업적은 `manualEarnedAt`.
- 기본 업적 1410개(숨김 `isHidden` 22, 직접 체크 `manual` 600). 달성 여부는 저장하지 않고 `AppContext`가 매번 계산합니다.
- 예시·체험 모드는 **없습니다.** 백업 불러오기·초기화는 있습니다.
- 제안(`proposals`)은 저장 전에는 메모리에만 있고 `state.achievements`에 없습니다. 보드에는 **저장된 업적만** 보내므로 제안 상태를 입력으로 받지 않습니다.
- `remote.js`의 `api()`는 401/403이면 토큰을 지웁니다. `tokenRequest`는 `invalid_grant`면 토큰을 지웁니다.
- README의 개수(카테고리 71·업적 786)는 낡았습니다. 갱신하면서 바로잡아 주세요.

## 진행 순서
1. 후보 4개(`recent`·`trophy`·`next`·`activity`)를 아래 규칙으로 점검해 표로 정리(타일 필드 → 앱 데이터 출처)하고, 앱 데이터로 더 만들 수 있는 좋은 타일(예: `streak` 연속 기록)이 있으면 더합니다. 원칙은 거시 통계보다 **최근 흐름**입니다.
   - 최근 취득: 취득일이 가장 늦은 업적. 같은 날이면 기록 기반(결합·메타 업적이 아닌 것) → 높은 등급 → id 순(앱 토스트 규칙과 같게). 숨김 업적은 앱에서도 취득 전에만 가려지므로 **미취득 숨김만** 제외(취득한 숨김은 포함). 소급 입력한 기록으로 달성한 업적은 입력 시점이 아니라 **달성 날짜**로 판정됨에 유의.
   - 트로피: 최근 취득 업적의 카테고리. 칸은 그 카테고리에 **직접 속한** 업적(미취득 숨김은 칸 수에서도 제외 — 개수로 존재가 드러나지 않게), 채움은 그중 취득 수. 업적이 0개면 타일을 뺍니다(`total`은 1~60).
   - 다음 목표: 미취득·숨김 아님(숨김은 취득 전이라 항상 제외)·`error` 없음·`manual` 아님·진행>0 중 진행률(`progress/target`)이 가장 높은 것(동률은 낮은 등급 → id). 진행 문구는 `achievementText.js` 재사용.
   - 마지막 활동: 날짜가 가장 늦은 기록(같은 날은 `records` 뒤쪽). 미래 날짜는 제외. **보낼 수 있는 것: 카테고리 이름·날짜·값·단위. 보내지 않는 것: memo·tags·photoUrl·기록 id.**
2. 표를 보여주고 **만들 타일, 처음부터 보일 타일(`default`), 허용 크기(`sizes`)와 처음 크기(`size`), '이 기기에서 보드에 올리기' 기본값**을 제가 고르게 합니다. 각 항목에 추천값을 표시하고(기본값 추천: 끔 + 연결 직후 안내 한 줄. 켬이면 백업을 복원한 두 번째 기기가 덮을 수 있음), 개인정보 범위(위 보내는 필드)도 함께 확인합니다. 제가 고르기 전에는 구현하지 마세요.
3. 고른 타일로 `buildBoardTiles({ achievements, records, categories }, now)`(순수 함수, 네트워크·저장소·무작위 없음, 같은 입력=같은 출력)를 추가합니다. `achievements`는 평가 결과가 붙은 것을 받아 재평가하지 않습니다(1410개 계산 중복 방지). `now`의 형식(ms 숫자 또는 `YYYY-MM-DD`)을 하나로 정해 문서화하고, 날짜 판단은 입력 `now`로만 합니다.
   - 타일 `id`는 후보 표의 id, 한 번 정하면 변경 금지. 이 앱의 후보(line·cells·num)는 표지가 없으므로 `cover`·`accent`는 보내지 않습니다. 사진·메모는 보내지 않습니다.
   - `href`는 `https://kingjnu-sakayume.github.io/achievement/`만(앱은 HashRouter라 딥링크는 `#/경로` 형태, 루트 주소만 써도 됨). 목록 전체 UTF-8 64 KiB 이하.
   - 글자 길이는 board `js/schema.js` 기준으로 함수 안에서 자릅니다: `label` 80, `title` 160, type·line의 `sub` 80(sleeve·hero의 `sub`만 160), `pill` 20, `name` 30, 큰 숫자 `value` 12, `unit` 8, `foot` `k`·`v` 10. 사용자가 만든 이름은 길 수 있으니 **이모지(서러게이트 쌍)를 반으로 자르지 말고**, 자른 뒤 `trim`해 빈 글자면 필드를 뺍니다(`""`·공백만 있으면 타일째 거절).
   - 날짜는 `11/5`처럼 쓰고 "어제·오늘" 같은 말은 쓰지 않습니다(타일 글자는 앱을 다시 열 때까지 남음).
   - 데이터가 없으면 타일을 뺍니다(line·cells에는 `muted` 행이 없습니다. `muted`는 행 속성).
4. 지어낸 값으로 된 예시 상태의 **예시 출력 JSON**을 `board/sample.json`에 둡니다(실제 기록·개인 데이터·토큰 금지).
5. 테스트(`src/` 아래에 둡니다. vitest는 `src/**/*.test.js`만 실행): board `js/schema.js`를 `src/board/vendor/schema.js`로 복사(맨 위에 출처 커밋과 날짜 주석). `validateManifest(manifest, { imageOrigins, linkOrigins })`에 **policy(값은 board `js/config.js`와 같게)를 꼭 넘기고**, `ok`만 보지 말고 **`errors`가 비었는지와 남은 타일 수가 입력과 같은지** 확인합니다. 빈 상태, `sizes`/`size`, id 고정, 길이 자르기, 빈 글자 빼기, 같은 입력=같은 출력, 미취득 숨김 업적·memo·tags 미포함, 같은 날 여러 건의 순서.
6. **Life Hub에 올리기** (Hub 쪽은 배포됨: life-hub `docs/P7_BOARD.md` 5장)
   - 요청: `PUT https://life-hub-api.213303.workers.dev/achievement/v1/board`, 헤더 `Authorization: Bearer <기존 토큰>`, `Content-Type: application/json`, 본문은 위 함수의 manifest. 연결할 때 요청하는 `SCOPE`에 `achievement:board`를 더합니다(`public/lifehub-client.json`에는 scope 선언이 없어 바꿀 것 없음).
   - **요청 함수를 따로 두세요.** 토큰 읽기·갱신은 기존 `accessToken()`을 **공유**하되 **진행 중인 갱신은 하나로 합칩니다**(보드 업로드와 기존 `sync`가 동시에 갱신해 `invalid_grant` → 토큰 삭제가 나지 않게). 403에서는 `insufficient_scope`를 **먼저** 확인합니다(`WWW-Authenticate`를 JS가 못 읽으면 응답 본문의 `error`로 대체). 맞으면 토큰을 지우지 말고 '재연결 필요' 플래그를 저장해 **업로드를 멈추고**, 설정의 Life Hub 섹션(기존 공통 규격)에 "보드에 올리려면 Life Hub에 다시 연결" 안내만 띄웁니다. 재연결로 새 토큰을 받으면 플래그를 풉니다. 401이 갱신 뒤에도 계속이거나 다른 403이면 기존 규칙(연결 해제).
   - 응답: `200`은 성공(`{ unchanged: true }`·`{ ignored: true }`도 성공). `400`·`413`은 이 앱 쪽 버그이니 개발자 콘솔에만 남기고 **그 sha를 기억해 같은 내용은 다시 보내지 않습니다**(내용이 바뀌면 다시 시도. 기기 시계가 5분 넘게 빠르면 `generated_at` 때문에 `400`이 날 수 있음). 네트워크 오류·`5xx`는 다음 기회에.
   - 빈도: **시도 기준** 10분에 한 번 이하(실패 재시도 포함). 타일에 영향을 주는 변화가 있으면 마지막 시도에서 10분이 지났으면 바로, 아니면 10분이 차는 때 한 번. '보낼 것 있음'은 localStorage에 두고 다음에 앱을 열 때 바로 보냅니다. **여러 탭**(이 앱은 `storage` 이벤트로 탭을 맞춥니다)이 같은 마지막 시도 시각을 공유하고 보내기 직전에 다시 확인합니다. 내용 비교는 마지막 성공 본문의 sha256(`generated_at` 빼고, `deps.sha256` 재사용)으로 하고 같으면 보내지 않습니다.
   - 하루 한 번: 앱을 열 때와 **화면이 다시 보일 때(`visibilitychange`)** 마지막 성공이 하루보다 오래됐으면 **내용이 같아도** 한 번 보냅니다(보드의 '오래됨' 14일은 Hub가 받은 시각 기준).
   - `generated_at`은 올리는 순간의 시각이되 직전 값보다 작아지지 않게 합니다(`uploadCategoryRefs`의 `max(now, last+1)` 방식).
   - 올리지 않는 경우: Life Hub에 연결돼 있지 않을 때, 토글이 꺼져 있을 때, **기록이 하나도 없고 취득한 업적도 없을 때**(새 기기가 빈 목록으로 덮지 않게), '재연결 필요' 상태일 때.
   - **여러 기기**: Hub는 앱마다 최신 목록 하나만 보관합니다. 설정에 **'이 기기에서 보드에 올리기'**(기기별, localStorage)를 두고 꺼져 있으면 올리지 않습니다. 기본값은 2단계에서 정합니다.
   - 마지막 성공 sha·시각·'보낼 것 있음'·'재연결 필요'는 localStorage에 둡니다(개인 데이터 아님). 업로드 실패가 앱의 다른 기능을 막지 않게 합니다.
   - 테스트(가짜 `deps`, `remote.test.js` 방식): 저장·unchanged·ignored·insufficient_scope(토큰 유지, 이후 업로드 중단, 재연결 후 해제)·다른 403(기존 규칙)·400(같은 sha 재시도 없음)·5xx 뒤 10분 제한·sha 같으면 안 보냄·하루 지나면 같아도 보냄·'보낼 것 있음'이 다음 실행에서 나감·두 탭 중복 없음·동시 갱신에도 토큰 유지·시계 되감김·토글 꺼짐·미연결·기록/취득 0개에서 안 보냄.
7. README에 「보드 타일」 절을 추가합니다: 어떤 타일을 왜, 크기, 기본 여부, 데이터 출처, 언제 올리는지, 어느 기기에서 올리는지, 다시 연결이 필요한 경우, **보내는 필드와 보내지 않는 필드**. 업로드 후 사실과 어긋나는 문장("서버에는 제안만 있고…", "기록 내용은 보내지 않습니다")과 설정 화면 안내 문구도 함께 고칩니다.

## 하지 말 것
- Hub에 이 앱의 기록 자체를 올리기. 올리는 것은 보드용 목록(manifest)뿐입니다. memo·tags·photoUrl·기록 id·미취득 숨김 업적은 목록에 넣지 않습니다.
- 보드 업로드의 실패나 권한 부족을 이유로 Life Hub 토큰을 지우거나 연결을 끊기(위 insufficient_scope 규칙).
- 보드 화면 코드나 CSS를 이 저장소에 만들기.
- 새 색·테마색 정하기, HTML 조각 보내기.
- board 저장소나 다른 저장소 고치기.

## 끝나면 알려 줄 것
- 고른 타일 표(id, 이름, 톤·형태, 크기, 기본, 데이터 출처)
- 예시 출력 JSON 경로와 규격 검사 결과(`errors` 개수, 타일 수)
- 업로드 연결 방식(언제, 어느 기기에서 올리는지)과 테스트 결과, 배포 후 다시 연결이 필요한지
- 이 저장소의 기존 검사(`npm test`, `npm run build`) 결과
- board·life-hub 쪽에 요청할 것(허용 출처 추가, 규격에 없는 필드, Hub 403 응답의 `WWW-Authenticate`가 CORS로 노출되는지, 갱신 토큰이 회전하는지 확인 결과)
