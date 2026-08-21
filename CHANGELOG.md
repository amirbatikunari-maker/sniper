# sniper — 변경 기록

## v15 (현재)

**화면 정리**
- 왼쪽 위 중복 제거. 제목 아래 한 줄(`tagline`)을 프로필 카드에서도 쓰고 있어
  같은 문구가 두 번 나왔습니다. 프로필용 `owner_role` 을 따로 만들어 갈랐습니다.
  이제 «설정»과 «프로필 고치기»에서 각각 수정합니다.
- 설정에 「프로필 카드 보이기/숨기기」, 「제목 아래 한 줄 보이기/숨기기」 추가.
- 맨 아래 «직접 만들어 쓰는 기록장» 하드코딩 문구 삭제 → 설정에서 입력.
  비워 두면 아무것도 안 나옵니다.
- 왼쪽 사이드바 폭을 오른쪽 AI 패널 폭(`--aiw`, 376px)에 묶었습니다.
  한 곳만 고치면 좌우가 같이 움직입니다. 모바일 서랍은 270px 그대로.

**허용 Origin 확정**
- 실제 배포 주소가 `https://sniper-web.pages.dev` 로 확인되어 기본값에 반영했습니다.

**Work Agent 에 Gemini 추가**
- `/agent/run` 이 GPT 와 Gemini 를 모두 씁니다. 모델 ID 가 `gemini-` 로 시작하면
  Gemini 경로로 갑니다 (`generateContent` + `responseSchema`).
- OpenAI JSON Schema 의 `additionalProperties`/`strict` 는 Gemini 가 모르므로 걷어내고 보냅니다.
  스키마를 거부하면 스키마 없이 한 번 더 시도합니다.
- Gemini 에는 이어붙일 응답 ID 가 없어 각 단계가 무상태로 돕니다 (`id: null`).
  Work 화면은 이미 `if(j.id)` 로 막고 있어 그대로 동작합니다.
- 추론 단계는 `thinkingBudget` 으로 옮깁니다 (low 2048 … max 32768).
- `/ai/models` 의 `agentModels` 에 Gemini 모델이 함께 나옵니다
  (Worker 에 `GEMINI_API_KEY` 가 있을 때만).
- **자동 조절이 공급자를 갈아치우지 않습니다.** Gemini 를 골라두면 자동 조절도
  Gemini 안에서만 모델을 바꿉니다. 예전에는 GPT 로 되돌아갔습니다.

**위험 실행 스크립트: 쓰기와 실행 분리**
- `.bat .cmd .ps1 .sh .vbs .psm1` 은 이제 «막기»가 아니라 «2차 승인» 방식입니다.
- AI 가 이런 파일을 만들거나 고치려 하면 서버가 409 `SCRIPT_APPROVAL_REQUIRED` 로 막고
  승인번호를 돌려줍니다. Work 화면은 내용을 기록창에 찍고 확인을 받은 뒤에만 다시 보냅니다.
- 승인번호는 **그 경로들에만** 유효하고, **1회용**이며, 2분 뒤 만료됩니다.
- 자동 적용을 켜 놨어도 이 확인은 건너뛰지 않습니다.

**Origin 문제 진단 개선**
- 거부된 Origin 을 실제 값과 함께 화면·응답에 남깁니다
  (`ORIGIN_NOT_ALLOWED` + 허용 목록). 어느 주소를 넣어야 하는지 바로 보입니다.
- ⚠ 기본 허용 목록은 «추측»입니다. 배포한 블로그 주소가 다르면 반드시 지정하세요:
  `set SNIPER_WORK_ORIGINS=https://실제-블로그주소,http://127.0.0.1:5500`

**공용 파일 일원화**
- `shared/ai-chat.js` 가 유일한 원본입니다. `tools/sync-shared.sh` 로 블로그·뷰어에 복사합니다.
- 양쪽 파일 맨 위에 «직접 고치지 말 것» 안내를 넣었습니다.

**등급(tier) 값 수정 — 실제로 안 먹던 버그**
- `ai-chat.js` 는 등급을 «균형/최고급/빠름» 한글로 비교하는데 Worker 가
  `medium/high/low` 를 보내고 있었습니다. 라벨 우연 일치로 균형·빠름만 먹고
  **최고급을 눌러도 Sol 로 안 바뀌었습니다.** 실제 브라우저로 확인해 잡았습니다.

## v14 (현재)

**고친 것 — 이게 없으면 실제로 안 돌아갔던 것들**

1. **AI 대화가 404 였습니다.**
   `ai-chat.js`(블로그·뷰어 공용)는 `/ai/chat` 을 부르는데, 워커에는 `/ai/health`,
   `/ai/models`, `/agent/run` 밖에 없었습니다. `/ai/chat` 을 새로 넣었습니다.
   - OpenAI Responses API 스트리밍 + Gemini `streamGenerateContent` 둘 다 지원
   - 이미지·PDF 첨부 전달
   - 응답은 `ai-chat.js` 가 파싱하는 SSE 형식 (`data: {"delta":"…"}` → `data: [DONE]`)
2. **Gemini 목록이 비어 있었습니다.** `/ai/models` 가 `gemini: []` 를 반환해
   "GPT/Gemini 바꿔 쓰기" 가 사실상 GPT 전용이었습니다.
   이제 Gemini API 에 모델 목록을 직접 물어봐 채웁니다(30분 캐시, 실패 시 고정 목록).
   새 Gemini 모델이 나와도 코드를 고칠 필요가 없습니다.
3. **Work Agent 세션 쿠키가 안 붙었습니다.**
   `SameSite=Lax` 라 배포된 https 페이지 → `http://127.0.0.1:8788` 요청에서 쿠키가 빠졌고,
   사실상 `http://127.0.0.1:5500` 에서 열 때만 동작했습니다.
   - 쿠키를 `Secure; SameSite=None` 으로 변경
   - `/session` 이 토큰을 함께 반환하고, Work 화면이 **메모리에만** 들고
     `x-agent-token` 헤더로 보냅니다 (localStorage 저장 안 함)
4. **사설망 접근 프리플라이트.** https 페이지에서 로컬 주소를 부를 때 크롬이 요구하는
   `Access-Control-Allow-Private-Network` 응답 헤더를 추가했습니다.
5. **허용 Origin 정리.** Local Agent 기본값에 sniper 주소가 빠져 있었습니다(뷰어 주소만 있었음).
   워커 `ALLOWED_ORIGINS` 도 같이 맞췄습니다.

**막은 것**

6. **AI 가 실행 스크립트를 못 쓰게.** `.bat/.ps1/.cmd/.sh` 는 읽기·색인까지만 허용하고
   쓰기 대상에서 제외했습니다. 실행 명령에 `npm/npx/node` 가 있어서,
   AI 가 스크립트를 만들고 그걸 실행시키는 경로가 열려 있었습니다.

**정리**

7. `Work` 화면이 `/ai/models` 의 `agentModels`(추론단계 지원 모델)를 쓰도록 분리.
   대화용 모델과 에이전트용 모델이 섞이지 않습니다.
8. 서비스워커 캐시 이름 `sniper-shell-v13` → `v14`. 이전엔 v12 로 멈춰 있어
   새 배포가 반영되지 않을 수 있었습니다.
9. `CHANGELOG_V11/12/13.md` 를 이 파일 하나로 합치고,
   중복 파일 `wrangler-ai.toml.txt` 를 삭제했습니다
   (실제 워커 설정은 `sniper-ai-worker/wrangler.toml`).

## v7–v13 요약

- v7~v9: Local Agent 인증(Supabase + HttpOnly 세션), 프로젝트 루트 바인딩, 검증 프로필,
  심볼릭 링크 탈출 차단, atomic write, 작업 동시 실행 잠금.
- v8: 적용 전 파일 SHA-256 precondition 검사, 비밀값 파일·내용 차단, 파일별 선택 적용.
- v12: realpath 바인딩, 프로젝트 규칙 저장, 비용/품질 전략, AI 컨텍스트 비밀값 마스킹.
- v13: 프로젝트 구조 인덱스(`/project-index`), 세션 복원 범위 확대, stage 별 JSON Schema 강화.
