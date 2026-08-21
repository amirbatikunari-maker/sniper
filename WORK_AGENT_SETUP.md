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

## 실행 스크립트 승인 (v15)

`.bat .cmd .ps1 .sh .vbs .psm1` 을 AI 가 만들거나 고치려 하면 적용이 한 번 멈춥니다.
기록창에 파일 내용이 찍히니 **읽어 보고** 승인하세요.
이 파일들은 나중에 `npm run …` 이나 `node` 로 실행될 수 있습니다.

승인은 그 경로들에만 유효하고 1회용이며 2분 뒤 만료됩니다.
자동 적용을 켜 두어도 이 확인은 건너뛰지 않습니다.

## Gemini 로 작업하기 (v15)

Worker 에 `GEMINI_API_KEY` 를 넣어 두면 Work 모델 목록에 Gemini 가 함께 나옵니다.
Gemini 를 고르면 자동 조절도 Gemini 안에서만 모델을 바꿉니다.

Gemini 는 이전 응답을 이어받는 기능이 없어 단계마다 새로 시작합니다.
긴 맥락이 중요한 작업은 GPT 가, 비용이 중요한 작업은 Gemini 가 유리합니다.
