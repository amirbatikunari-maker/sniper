# v224 — 해설이 안 뽑히던 진짜 이유

## 증상

```
해설 실패 — Anthropic 403 — {"error":{"type":"forbidden","message":"Request not allowed"}}
8번  실패 — Anthropic 403 — {"error":{"type":"forbidden","message":"Request not allowed"}}
```

「해설 뽑기」와 「답 빈 문항 자동으로 나누기」가 **전부** 실패.
문제·답 넣기는 잘 됨(그건 DB 작업이라 AI 안 씀).

## 키도 계정도 모델도 멀쩡했음

`/selftest` 를 찔러 보니 **아무 문제 없었음.**

```json
{"ok":true,"status":200,"model":"claude-opus-5",
 "keyHead":"sk-ant-api03-K…","keyLen":108,"keyTrimmed":true,
 "upstream":{"content":[{"type":"text","text":"네"}],"stop_reason":"end_turn"}}
```

**여기가 갈림길이었음.** `/selftest` 는 글자만 보내고, 실패하는 두 곳은 **그림을 보냄.**

## 원인 — 그림을 「주소만」 넘기고 있었음

```js
const signed = u.searchParams.has("token") || /\/sign\//.test(u.pathname);
if (!signed) return { type:"image", source:{ type:"url", url } };   // ← 여기
```

Supabase 그림 주소는 이렇게 생겼음.

```
https://…/storage/v1/object/public/qfig/prac/1/2026_2_01_q.jpg?t=1757...
```

- `token` 이 아니라 `t` 라서 → `searchParams.has("token")` 는 **false**
- 경로가 `/object/public/` 이라 `/sign/` 도 **false**

→ **「서명 안 된 주소」로 판정** → 워커가 그림을 직접 안 받고
**Anthropic 더러 그 주소로 직접 받아가라**고 넘김.

Anthropic 은 그 요청을 통째로 거절함 — **403 「Request not allowed」**.

## 고친 것

**서명 여부를 안 따지고 항상 워커가 받아서 base64 로 실어 보냄.**

```js
async function imageBlock(url){
  const res = await fetch(url);
  …
  return { type:"image", source:{ type:"base64", media_type:mt, data:btoa(bin) } };
}
```

받다 실패했을 때만 옛 방식(주소 넘기기)으로 물러섬.

**덤으로 하나 더** — Supabase 가 가끔 `application/octet-stream` 으로 주는데
그러면 Anthropic 이 안 받음. 주소 끝(`.jpg`·`.png`)을 보고 고쳐서 보냄.

---

## ★ 워커를 다시 배포해야 함

이건 **사이트 파일이 아니라 워커**임. zip 만 올려서는 안 바뀜.

```bash
cd gichul-ai-worker
npx wrangler deploy
```

또는 Cloudflare 대시보드에서 `gichul-ai` 워커의 `src/index.js` 를 새 것으로 교체.

배포한 뒤 확인:

1. 검수 화면에서 문항 하나 골라 **「해설 뽑기」** 한 번
2. 되면 **「해설 배치」** 로 401개 + 문제집 715개 전량

