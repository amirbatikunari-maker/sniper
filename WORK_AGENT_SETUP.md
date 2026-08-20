# Work Agent 사용법

로컬 PC 의 실제 프로젝트 폴더를 AI 가 읽고 고치는 도구입니다.
브라우저(Work 화면) ↔ 내 PC 의 Local Agent ↔ Cloudflare Worker(AI) 3단 구조입니다.

## 시작

1. `sniper-ai-worker` 폴더에서 시크릿을 넣고 배포합니다.
   ```
   npx wrangler secret put OPENAI_API_KEY
   npx wrangler secret put GEMINI_API_KEY
   npx wrangler deploy
   ```
2. `local-agent-start.bat` 을 실행합니다. (`127.0.0.1:8788` 에서만 뜹니다)
3. Work 페이지를 허용된 주소에서 엽니다.
4. 프로젝트 **절대 경로**를 넣고 연결합니다.
5. 모델과 추론 단계를 고릅니다.
6. 처음에는 `파일 적용`으로 직접 검토하고, 익숙해지면 `검증 후 자동 적용·재수정`을 켭니다.

## 환경변수

| 변수 | 용도 |
|---|---|
| `SNIPER_WORK_ORIGINS` | Work 화면을 열 수 있는 주소(쉼표 구분) |
| `SNIPER_SUPABASE_URL` / `SNIPER_SUPABASE_ANON_KEY` | 로그인 토큰 검증 |
| `SNIPER_WORK_EMAILS` | 사용 허용 계정(비우면 로그인한 사람 전부) |

기본 허용 주소: sniper 배포 주소, gichul-viewer, `http://localhost:5500`, `http://127.0.0.1:5500`

## 안전장치

- Local Agent 는 `127.0.0.1` 에만 바인딩됩니다.
- 세션은 Supabase 로그인 검증을 거치며, 처음 연결한 프로젝트의 **실제 경로(realpath)** 에 고정됩니다.
- 프로젝트 루트 밖 경로, 심볼릭 링크 탈출, 허용되지 않은 확장자, 파일 크기 초과는 거부됩니다.
- `.env`, private key, credentials/secret 계열 파일은 탐색·적용 대상에서 제외됩니다.
- AI 에 넘기는 파일 내용은 비밀값처럼 보이면 마스킹됩니다.
- **실행 스크립트(`.bat/.ps1/.cmd/.sh`)는 AI 가 수정할 수 없습니다.** 읽기만 됩니다.
- AI 가 읽은 시점의 파일 SHA-256 을 기록하고, 그 사이 사람이 고쳤으면 적용을 거부합니다.
- 적용 대상에 기존 Git 변경이 있으면 기본적으로 거부합니다(`기존 변경과 섞어 적용`을 켜야 진행).
- 롤백은 충돌이 감지되면 파일을 강제로 덮지 않습니다.
- 변경 이력 최대 50개, 적용/명령 기록은 audit 로그로 남습니다.

## 주의

`npm run …` 같은 명령은 프로젝트가 정의한 임의 코드를 실행합니다.
신뢰하는 프로젝트에서만 쓰세요. `npx`/`node`/설치 계열은 Work 화면에서 1회 승인을 받습니다.

## 연결이 안 될 때

| 증상 | 확인할 것 |
|---|---|
| `허용되지 않은 Work Origin` | `SNIPER_WORK_ORIGINS` 에 지금 주소가 있는지 |
| `Local Agent 세션이 없습니다` | Local Agent 를 껐다 켜고 Work 화면 새로고침 |
| 요청이 아예 안 감 | 크롬 주소창의 사설망 접근 차단 아이콘 확인 |
| AI 응답 401 | 워커 `ALLOWED_EMAILS` 에 로그인 계정이 있는지 |


## v16 추가 사항

- Gemini Work Agent의 thinkingLevel/thinkingBudget 자동 선택.
- Gemini 일반 채팅 tier → thinking level 매핑.
- Gemini 모델 선택 시 Worker의 동적 모델 목록으로 검증.
- x-agent-token/Origin 오류 진단 보강.

## v15 추가 사항
- GPT/Gemini Work Agent 선택 지원. Gemini 모델을 선택하면 자동 조절도 Gemini 안에서 유지합니다.
- `.bat .cmd .ps1 .sh .vbs .psm1` 수정은 2차 승인이 필요합니다. 자동 적용도 이 검사를 건너뛰지 않습니다.
- 실제 배포 주소는 `SNIPER_WORK_ORIGINS` 환경 변수로 지정하세요. 예: `https://실제-sniper-블로그주소,http://localhost:5500,http://127.0.0.1:5500`
- `x-agent-token`과 HttpOnly cookie를 함께 사용합니다. 브라우저가 쿠키를 보내지 않는 상황에도 헤더 토큰으로 동작합니다.

## v17 자동 개발
- 비개발자용 `🚀 자동 개발 시작` 원클릭 실행 추가
- 자동 브랜치/검증/재수정/checkpoint
- 위험 스크립트와 보호 명령은 기존 승인 절차 유지
