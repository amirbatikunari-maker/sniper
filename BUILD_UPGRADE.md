# 새로 만들기 v18 — 적용 안내

## 바뀐 파일

| 파일 | 무엇 |
|---|---|
| `build.html` | 파일 목록 칸, 미니맵, 휴대폰 탭, Claude 선택 |
| `build.js` | 첨부·zip·붙여넣기·여러 파일 출력·미니맵 (거의 새로 씀) |
| `build.css` | 3칸 배치, 트리, 미니맵, 좁은 화면 |
| `sw.js` | 캐시 이름 v15 → v18, build 파일 3개 추가 |
| `CHANGELOG.md` | v18 항목 |
| `worker-ai-build-claude.js` | **새 파일. 블로그에선 안 씀 — Worker 용** |

## 1단계 — 블로그 (Worker 없이 바로 됨)

위 파일들을 저장소에 덮어쓰고 올리면 끝입니다. **이 시점에서 이미:**

- 파일·폴더·zip 첨부, Ctrl+V, 드래그해서 놓기
- 사진 8장
- 여러 파일 결과 + ZIP 내려받기
- 파일 트리 · 미니맵
- 휴대폰

이 전부 됩니다. 브라우저 안에서 끝나는 일이라 Worker 를 몰라도 됩니다.
GPT·Gemini 는 예전 그대로 돕니다.

> `sw.js` 캐시 이름을 안 올리면 예전 `build.js` 가 캐시에서 계속 나옵니다.
> 이미 v18 로 올려 뒀으니, 배포 후 한 번 새로고침하면 갈립니다.

## 2단계 — Claude (Worker 배포 필요)

Claude 만 API 키가 필요해서 Worker 를 거쳐야 합니다.

```bash
# sniper-ai 저장소에서
npx wrangler secret put ANTHROPIC_API_KEY
```

`worker-ai-build-claude.js` 내용을 `src/index.js` 맨 아래에 붙여넣고,
`/ai/build` 를 처리하는 곳에서 provider 를 가르는 자리에 한 줄 추가합니다.

```js
if (payload.provider === "anthropic") {
  return streamAnthropicBuild(payload, env, corsHeaders);
}
// ↓ 기존 openai / gemini 처리는 손대지 않습니다
```

```bash
npx wrangler deploy
```

안 붙인 상태에서 Claude 를 고르면 화면이 「Worker 에 Claude 경로가 아직 없습니다」
라고 알려 줍니다. 다른 기능은 그대로 씁니다.

## 쓰는 법

**참고할 저장소를 통째로 주고 싶을 때** — `gichul-viewer-main.zip` 을 대화창에
끌어다 놓으면 안의 `.html/.css/.js` 를 읽어 목록에 뿌립니다. 무거운 파일은
체크를 꺼서 빼세요. 옆에 토큰 수가 뜹니다. 20만 자를 넘기면 빨갛게 경고합니다.

**결과를 GitHub 에 올릴 때** — 「여러 파일 (GitHub용)」로 두고 만든 뒤
`ZIP 받기`. 압축을 풀어 저장소에 올리고 Settings → Pages 에서 브랜치를 고르면
바로 열립니다. `.nojekyll` 은 넣어 뒀습니다.

**여백·가독성** — 매번 타이핑하지 말고 칩을 눌러 두세요. 눌러 둔 칩은
다음 요청에도 계속 붙어 갑니다. 미리보기 폭 버튼(📱 ▭ ⬛)으로 실제로
어떻게 보이는지 바꿔 가며 확인할 수 있습니다.

## 알아 둘 것

- **미리보기는 css·js 를 html 안으로 합쳐서 보여 줍니다.** 격리한 iframe 이
  부모가 만든 blob: 주소를 못 읽어서 그렇습니다. 내려받는 파일은 나뉜 채입니다.
  그래서 미리보기가 멀쩡해도 «파일이 실제로 연결됐는지» 는 ZIP 을 풀어
  확인하는 게 확실합니다.
- **`<script type="module">` 은 쓰지 말라고 모델에 시켜 뒀습니다.** 합칠 때
  `import` 가 깨지기 때문입니다. 모델이 어기면 미리보기만 이상하고 파일은 정상입니다.
- **첨부한 사진은 저장되지 않습니다.** 텍스트 첨부와 대화·만든 파일만
  localStorage 에 남습니다. 사진까지 담으면 5MB 한도를 넘겨 저장이 통째로 실패합니다.
- `Ctrl/⌘+Enter` 로 만들기.
