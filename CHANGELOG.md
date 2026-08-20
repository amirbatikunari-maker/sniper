
## v16 — 현재

- Work Agent: GPT + Gemini Agent pipeline 지원
- Gemini Agent: 단계별 JSON 출력 + thinking budget, 이전 response는 provider별로 안전하게 처리
- 위험 스크립트(`.bat/.cmd/.ps1/.sh/.vbs/.psm1`) 쓰기 2차 승인 추가
- Local Agent: `x-agent-token` 인증 경로와 PNA preflight 유지
- Origin 거부 시 실제 Origin/허용 목록을 진단 응답에 포함
- 블로그/뷰어 공용 `shared/ai-chat.js` + 동기화 스크립트 추가
- AI tier 라벨을 UI의 `빠름/균형/최고급`과 Worker가 동일하게 사용
# sniper — 변경 기록

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

## v16
- Gemini 자동 단계 조절을 모델 계열 안에서 유지하고 pro/flash 후보를 선택.
- Local Agent Origin 거부 응답에 실제 origin/허용 목록을 포함.
- 공용 ai-chat.js를 viewer/blog 양쪽에 동기화.
- Worker/agent 계약 테스트 도구 추가.


## v17 — 원클릭 자동 개발
- 비개발자용 `🚀 자동 개발 시작` 원클릭 모드 추가
- 자동으로 분석 → 설계 → 수정 → 실검증 → 실패 시 재수정
- 성공 시 Git 작업 브랜치 생성 + checkpoint 자동 저장
- 위험 스크립트(`.bat/.cmd/.ps1/.sh...`)는 기존 2차 승인 유지
- 파일 선택이 비어 있으면 안전한 코드 파일을 자동 선택
- STANDARD 검증을 자동 기본값으로 사용
- 고급 수동 제어는 접어두고 기본 화면을 단순화
- Local Agent 기본 허용 Origin에 `https://sniper-web.pages.dev` 추가
