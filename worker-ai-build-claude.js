/* ═══════════════════════════════════════════════════════════════════
   sniper-ai Worker — /ai/build 에 Claude 를 붙이는 조각
   ───────────────────────────────────────────────────────────────────
   이 파일은 «블로그 저장소에서는 쓰이지 않습니다».
   Cloudflare 의 sniper-ai Worker(src/index.js)에 붙여 넣는 부품입니다.

   왜 Worker 를 고쳐야 하나
     API 키는 브라우저에 두면 안 되므로 GPT·Gemini 처럼 Claude 도
     Worker 가 대신 불러 줘야 합니다. 새로 만들기 화면의 나머지 기능
     (파일 첨부·zip·여러 파일 출력·미니맵)은 전부 브라우저에서 끝나므로
     Worker 를 안 고쳐도 그대로 돕니다. Claude 만 이게 필요합니다.

   붙이는 법 — 3단계
     1) 키 넣기 (한 번만)
          npx wrangler secret put ANTHROPIC_API_KEY
     2) src/index.js 안, /ai/build 를 처리하는 곳에서
        provider 를 갈라 쓰는 부분에 한 줄 추가:

          if (payload.provider === "anthropic") {
            return streamAnthropicBuild(payload, env, corsHeaders);
          }
          // ↓ 기존 openai / gemini 처리는 그대로 둡니다

     3) 이 파일 내용을 src/index.js 맨 아래에 붙여넣고 배포.
          npx wrangler deploy

   프론트(build.js)와의 약속
     받는 것 : { provider, model, tier, prompt, reference_url,
                 current_code, history[], files[{data,mime,name}], output }
     주는 것 : text/event-stream 으로  data: {"delta":"…"}
               끝나면            data: [DONE]
               문제가 나면        data: {"error":"…"}
     — 기존 GPT·Gemini 경로와 «똑같은» 형식입니다. 프론트는 구분하지 않습니다.
   ═══════════════════════════════════════════════════════════════════ */

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

/* 등급별 출력 길이. 여러 파일로 뱉을 땐 넉넉해야 중간에 잘리지 않습니다. */
const MAX_TOKENS = { fast: 8000, balanced: 16000, quality: 24000 };

/* 브라우저가 못 보내는 사진 형식은 여기서 걸러냅니다 */
const OK_IMAGE = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

/* ── 시스템 프롬프트 ────────────────────────────────────────────────
   출력 «형식» 규약은 프론트가 사용자 글 끝에 붙여 보냅니다.
   여기서는 형식을 다시 말하지 않습니다 — 두 군데서 다른 말을 하면
   모델이 그 사이에서 헤맵니다. 여기서는 «태도» 만 정합니다.        */
function systemPrompt(payload) {
  return [
    "당신은 완성된 정적 웹페이지를 만드는 프론트엔드 개발자입니다.",
    "설명이나 사과 없이, 요청받은 파일 내용만 출력합니다.",
    "빌드 도구 없이 브라우저에서 바로 열리는 코드만 씁니다. 외부 라이브러리가 필요하면 CDN <script> 로 씁니다.",
    "한국어 UI 로 만들고, 실제로 눌리는 버튼과 실제로 채워진 예시 데이터를 넣습니다. 자리표시자(lorem ipsum)는 쓰지 않습니다.",
    "접근성 기본은 지킵니다 — 키보드 초점이 보이고, 색 대비가 충분하고, 휴대폰에서 가로 스크롤이 생기지 않게.",
    payload.current_code
      ? "이미 만들어 둔 코드가 함께 옵니다. 요청한 부분만 고치고 나머지는 그대로 두되, 파일은 항상 전체 내용으로 다시 출력합니다."
      : "",
  ].filter(Boolean).join("\n");
}

/* ── 참고 사이트 읽기 ───────────────────────────────────────────────
   브라우저에서 남의 사이트를 직접 fetch 하면 CORS 로 막히므로 Worker 가
   대신 읽습니다. 사설망 주소는 막습니다 — 안 막으면 이 Worker 가 내부망을
   훑는 도구로 쓰일 수 있습니다(SSRF).                                */
function isPrivateHost(host) {
  const h = host.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".internal")) return true;
  if (/^\[?::1\]?$/.test(h)) return true;
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b] = [ +m[1], +m[2] ];
  return a === 10 || a === 127 || a === 0
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 169 && b === 254);
}
async function readReference(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return "";
    if (isPrivateHost(u.hostname)) return "";
    const res = await fetch(u.toString(), {
      redirect: "follow",
      headers: { "user-agent": "sniper-build/1.0" },
      cf: { cacheTtl: 300 },
    });
    if (!res.ok) return "";
    const type = res.headers.get("content-type") || "";
    if (!/text\/html|text\/plain/i.test(type)) return "";
    const html = (await res.text()).slice(0, 400000);
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return text.slice(0, 6000);
  } catch {
    return "";
  }
}

/* ── 보낼 메시지 만들기 ──────────────────────────────────────────── */
async function buildMessages(payload) {
  const msgs = [];

  /* 지난 대화 — 텍스트만, 최근 8턴 */
  for (const h of (payload.history || []).slice(-8)) {
    const role = h.role === "assistant" ? "assistant" : "user";
    const content = String(h.content || "").slice(0, 4000);
    if (content) msgs.push({ role, content });
  }

  const parts = [];

  /* 사진 — Claude 는 base64 를 그대로 받습니다.
     못 읽는 형식에 png 라고 이름표만 바꿔 보내면 API 가 통째로 400 을
     냅니다. 그래서 «이름표를 고치지 않고» 건너뜁니다.
     (프론트가 png/jpeg 로 바꿔서 보내므로 여기까지 오는 일은 드뭅니다) */
  for (const f of (payload.files || []).slice(0, 8)) {
    if (!f.data || !OK_IMAGE.has(f.mime)) continue;
    parts.push({ type: "image", source: { type: "base64", media_type: f.mime, data: f.data } });
  }

  /* 지금까지 만든 코드 */
  if (payload.current_code) {
    parts.push({
      type: "text",
      text: "지금까지 만들어 둔 코드입니다:\n\n" + String(payload.current_code).slice(0, 400000),
    });
  }

  /* 참고 사이트 */
  if (payload.reference_url) {
    const ref = await readReference(payload.reference_url);
    if (ref) parts.push({ type: "text", text: "참고 사이트에서 읽어온 내용:\n\n" + ref });
  }

  /* 사용자 요청 — 출력 형식 규약이 이 안에 이미 들어 있습니다 */
  parts.push({ type: "text", text: String(payload.prompt || "") });

  msgs.push({ role: "user", content: parts });
  return msgs;
}

/* ── 본체 ──────────────────────────────────────────────────────────
   Anthropic 의 SSE 를 받아서, 프론트가 아는 {"delta":"…"} 로 바꿔 흘립니다. */
export async function streamAnthropicBuild(payload, env, extraHeaders = {}) {
  const headers = {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    ...extraHeaders,
  };
  const fail = (msg) =>
    new Response(`data: ${JSON.stringify({ error: msg })}\n\n`, { status: 200, headers });

  if (!env.ANTHROPIC_API_KEY) {
    return fail("Worker 에 ANTHROPIC_API_KEY 가 없습니다. npx wrangler secret put ANTHROPIC_API_KEY 로 넣으세요.");
  }

  let upstream;
  try {
    upstream = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: payload.model || "claude-sonnet-4-6",
        max_tokens: MAX_TOKENS[payload.tier] || MAX_TOKENS.balanced,
        system: systemPrompt(payload),
        messages: await buildMessages(payload),
        stream: true,
      }),
    });
  } catch (e) {
    return fail("Anthropic 에 연결하지 못했습니다: " + (e.message || String(e)));
  }

  if (!upstream.ok || !upstream.body) {
    let detail = `Anthropic 이 ${upstream.status} 로 답했습니다.`;
    try {
      const j = await upstream.json();
      if (j?.error?.message) detail = j.error.message;
    } catch {}
    return fail(detail);
  }

  const enc = new TextEncoder();
  const dec = new TextDecoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj) => controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));
      const reader = upstream.body.getReader();
      let buf = "";
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });

          /* SSE 는 빈 줄로 블록이 갈립니다 */
          let cut;
          while ((cut = buf.indexOf("\n\n")) !== -1) {
            const block = buf.slice(0, cut);
            buf = buf.slice(cut + 2);
            for (const line of block.split("\n")) {
              if (!line.startsWith("data:")) continue;
              const raw = line.slice(5).trim();
              if (!raw) continue;
              let o;
              try { o = JSON.parse(raw); } catch { continue; }

              if (o.type === "content_block_delta" && o.delta?.type === "text_delta") {
                send({ delta: o.delta.text });
              } else if (o.type === "error") {
                send({ error: o.error?.message || "Anthropic 스트림 오류" });
              }
              /* message_start / ping / message_stop 등은 흘려보냅니다 */
            }
          }
        }
        controller.enqueue(enc.encode("data: [DONE]\n\n"));
      } catch (e) {
        send({ error: e.message || String(e) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { status: 200, headers });
}

export default { streamAnthropicBuild };
