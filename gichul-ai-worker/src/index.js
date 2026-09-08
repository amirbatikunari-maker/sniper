/* ═══════════════════════════════════════════════════════════════
   gichul-ai — Claude(Anthropic) 단일 중계 워커
   기존 두 워커(sniper-backend · sniper-ai)를 통째로 대신함.

   ── 왜 이렇게 만들었나 ─────────────────────────────────────
   앱 곳곳(index / practice / interview / ingest / ai-explain / ai-chat)이
   이미 정해진 형식으로 워커를 부르고 있음. 그 형식을 그대로 받아 주고
   속만 Claude 로 바꾸면 «화면 파일은 한 줄도 안 고쳐도» 됨.
   그래서 이 워커는 옛 형식을 그대로 흉내 냄.

   ── 경로 ────────────────────────────────────────────────
   POST /get-data    Gemini 형식 그대로 받음 → Claude 로 번역해서 답함
                     쓰는 곳: index · practice · interview · ingest · ai-explain
   GET  /ai/models   모델 목록. ai-chat.js 가 뜨자마자 부름
   POST /ai/chat     대화. SSE 로 흘려보냄 (data: {"delta":"…"})
                     쓰는 곳: ai-chat.js
   POST /explain     해설 배치 전용. 정해진 틀(JSON)로 답함
   GET  /health      상태 확인

   ── 시크릿 (npx wrangler secret put) ────────────────────
   ANTHROPIC_API_KEY   필수
   APP_KEY             선택. 넣으면 헤더 x-app-key 와 대조

   ── 변수 ([vars] in wrangler.toml) ──────────────────────
   MODEL_BEST / MODEL_MID / MODEL_FAST   등급별 모델 id
   ALLOWED_ORIGINS                       쉼표로 구분한 허용 주소
   ═══════════════════════════════════════════════════════════════ */

const API = "https://api.anthropic.com/v1/messages";
const VER = "2023-06-01";

/* 사고량 — «낮음» 이 기본.
   생각 토큰이 그대로 요금이라, 답이 이미 주어진 일(해설·변환)에는 길게 생각시킬 이유가 없음. */
const EFFORT = { off: 0, low: 1024, mid: 4000, high: 10000 };

/* 이미지 한 장 상한. 넘으면 그 장만 빼고 진행함 */
const IMG_MAX = 4.6 * 1024 * 1024;

const tiers = env => ({
  /* v202 — 기본값을 실제로 있는 모델로. 변수를 안 넣어도 돌아감.
     MODEL 하나만 넣으면 셋 다 그걸 씀. */
  best: env.MODEL_BEST || env.MODEL || "claude-opus-5",
  mid:  env.MODEL_MID  || env.MODEL || "claude-opus-5",
  fast: env.MODEL_FAST || env.MODEL || "claude-opus-5"
});

/* ─── 공통 ─────────────────────────────────────────────── */
function cors(env, req){
  const origin = req.headers.get("Origin") || "";
  const list = (env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
  const allow = list.length === 0 ? "*" : (list.includes(origin) ? origin : "");
  const h = {
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-app-key, Authorization",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
  if (allow) h["Access-Control-Allow-Origin"] = allow;
  return h;
}
const json = (b, s, h) => new Response(JSON.stringify(b), {
  status: s, headers: { "Content-Type": "application/json; charset=utf-8", ...h }
});

function b64size(s){ return Math.floor((String(s || "").length * 3) / 4); }

/* Anthropic 호출 — 429·5xx 만 지수 백오프로 다시 시도 */
async function call(env, payload, tries = 3){
  let wait = 1200, last = null;
  for (let i = 0; i < tries; i++){
    const res = await fetch(API, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": VER
      },
      body: JSON.stringify(payload)
    });
    if (res.ok) return res;
    const text = await res.text();
    last = { status: res.status, detail: text.slice(0, 600) };
    if (res.status !== 429 && res.status < 500) break;
    const ra = Number(res.headers.get("retry-after"));
    await new Promise(r => setTimeout(r, ra ? ra * 1000 : wait));
    wait *= 2;
  }
  const e = new Error(last ? `Anthropic ${last.status} — ${last.detail}` : "Anthropic 무응답");
  e.upstream = last;
  throw e;
}

/* 답에서 글자만 긁어모음 (thinking 블록은 버림) */
const textOf = out => (out.content || [])
  .filter(c => c.type === "text").map(c => c.text).join("").trim();

/* ═══════════════════════════════════════════════════════════════
   1. /get-data — Gemini 형식 흉내
   ═══════════════════════════════════════════════════════════════ */
function fromGemini(body){
  const msgs = [];
  let dropped = 0;

  for (const c of (body.contents || [])){
    const role = c.role === "model" ? "assistant" : "user";
    const blocks = [];
    for (const p of (c.parts || [])){
      if (p.text != null && String(p.text) !== ""){
        blocks.push({ type: "text", text: String(p.text) });
        continue;
      }
      const inl = p.inline_data || p.inlineData;
      if (inl && inl.data){
        const mt = (inl.mime_type || inl.mimeType || "image/jpeg").split(";")[0];
        if (b64size(inl.data) > IMG_MAX){ dropped++; continue; }
        if (!/^image\/(jpeg|png|gif|webp)$/.test(mt)){ dropped++; continue; }
        blocks.push({ type: "image", source: { type: "base64", media_type: mt, data: inl.data } });
      }
    }
    if (blocks.length) msgs.push({ role, content: blocks });
  }

  /* Claude 는 user 로 시작해야 하고, 같은 역할이 붙어 있으면 안 됨 */
  while (msgs.length && msgs[0].role !== "user") msgs.shift();
  const merged = [];
  for (const m of msgs){
    const prev = merged[merged.length - 1];
    if (prev && prev.role === m.role) prev.content.push(...m.content);
    else merged.push(m);
  }
  return { messages: merged, dropped };
}

async function getData(req, env, H){
  const body = await req.json();
  const g = body.generationConfig || {};
  const { messages, dropped } = fromGemini(body);
  if (!messages.length) return json({ detail: "contents 가 비어 있습니다" }, 400, H);

  /* responseMimeType: application/json 이면 순수 JSON 만 뱉게 못 박음.
     ingest 의 PDF 변환이 이걸 씀 — 앞뒤에 설명이 붙으면 JSON.parse 가 깨짐. */
  const wantJson = /json/i.test(g.responseMimeType || "");
  const sys = wantJson
    ? "출력은 오직 JSON 하나여야 한다. 코드펜스(```), 머리말, 꼬리말, 설명을 절대 붙이지 않는다. 여는 중괄호나 대괄호로 시작해서 닫는 짝으로 끝난다."
    : undefined;

  const T = tiers(env);
  const model = body.model || T.best;
  const max = Math.min(Math.max(Number(g.maxOutputTokens) || 4096, 256), 32000);

  const payload = {
    model, max_tokens: max,
    messages,
    ...(sys ? { system: sys } : {}),
    ...(g.temperature != null ? { temperature: Math.min(Math.max(g.temperature, 0), 1) } : {})
  };

  const res = await call(env, payload);
  const out = await res.json();
  let text = textOf(out);

  /* 모델이 그래도 펜스를 씌우는 경우가 있어 한 번 벗겨 줌 */
  if (wantJson){
    const m = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
    if (m) text = m[1].trim();
  }

  return json({
    candidates: [{
      content: { parts: [{ text }] },
      finishReason: out.stop_reason === "max_tokens" ? "MAX_TOKENS" : "STOP"
    }],
    finishReason: out.stop_reason === "max_tokens" ? "MAX_TOKENS" : "STOP",
    usage: { in: out.usage?.input_tokens || 0, out: out.usage?.output_tokens || 0 },
    usedModel: model,
    ...(dropped ? { note: `이미지 ${dropped}장은 너무 크거나 형식이 맞지 않아 뺐습니다` } : {})
  }, 200, H);
}

/* ═══════════════════════════════════════════════════════════════
   2. /ai/models — ai-chat.js 가 기대하는 형식
   ai-chat.js 는 catalog 를 openai · gemini 두 칸으로만 읽음.
   화면 파일을 안 고치려고 양쪽에 Claude 를 넣어 둠.
   고르는 이름만 다르고 실제로는 전부 Claude 임.
   ═══════════════════════════════════════════════════════════════ */
function models(env, H){
  const T = tiers(env);
  const set = [
    { id: T.best, label: "Claude · 최고급" },
    { id: T.mid,  label: "Claude · 균형" },
    { id: T.fast, label: "Claude · 빠름" }
  ];
  return json({
    catalog: { openai: set, gemini: set },
    defaults: { openai: T.mid, gemini: T.mid },
    provider: "anthropic"
  }, 200, H);
}

/* ═══════════════════════════════════════════════════════════════
   3. /ai/chat — SSE 로 흘려보냄
   ai-chat.js 는 `data: {"delta":"…"}` 만 읽음. 그 형식을 지킴.
   ═══════════════════════════════════════════════════════════════ */
function toClaudeMsgs(list){
  const out = [];
  for (const m of (list || [])){
    const role = m.role === "assistant" ? "assistant" : "user";
    const blocks = [];
    for (const f of (m.files || [])){
      if (!f.data) continue;
      const mt = String(f.mime || "").split(";")[0];
      if (b64size(f.data) > IMG_MAX) continue;
      if (/^image\/(jpeg|png|gif|webp)$/.test(mt)){
        blocks.push({ type: "image", source: { type: "base64", media_type: mt, data: f.data } });
      } else if (mt === "application/pdf"){
        blocks.push({ type: "document", source: { type: "base64", media_type: mt, data: f.data } });
      }
    }
    const t = String(m.content || "").trim();
    if (t) blocks.push({ type: "text", text: t });
    if (blocks.length) out.push({ role, content: blocks });
  }
  while (out.length && out[0].role !== "user") out.shift();
  const merged = [];
  for (const m of out){
    const prev = merged[merged.length - 1];
    if (prev && prev.role === m.role) prev.content.push(...m.content);
    else merged.push(m);
  }
  return merged.length ? merged : [{ role: "user", content: [{ type: "text", text: "안녕하세요" }] }];
}

async function chat(req, env, H){
  const body = await req.json();
  const T = tiers(env);
  const tier = String(body.tier || "");
  const model = body.model ||
    (/최고|best/i.test(tier) ? T.best : /빠름|fast/i.test(tier) ? T.fast : T.mid);

  const payload = {
    model,
    max_tokens: Math.min(Number(body.max_tokens) || 8000, 32000),
    stream: true,
    messages: toClaudeMsgs(body.messages),
    ...(body.system ? { system: String(body.system) } : {})
  };

  const sse = {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    ...H
  };

  let up;
  try { up = await call(env, payload); }
  catch (e){
    const s = new ReadableStream({ start(c){
      c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ error: e.message })}\n\n`));
      c.close();
    }});
    return new Response(s, { status: 200, headers: sse });
  }

  /* Anthropic 의 SSE 를 ai-chat.js 가 읽는 형식으로 바꿔 흘림 */
  const stream = new ReadableStream({
    async start(ctrl){
      const enc = new TextEncoder(), dec = new TextDecoder();
      const send = o => ctrl.enqueue(enc.encode(`data: ${JSON.stringify(o)}\n\n`));
      const reader = up.body.getReader();
      let buf = "";
      try{
        while (true){
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let cut;
          while ((cut = buf.indexOf("\n\n")) !== -1){
            const block = buf.slice(0, cut); buf = buf.slice(cut + 2);
            for (const line of block.split("\n")){
              if (!line.startsWith("data:")) continue;
              const raw = line.slice(5).trim();
              if (!raw) continue;
              let o; try { o = JSON.parse(raw); } catch { continue; }
              if (o.type === "content_block_delta" && o.delta?.type === "text_delta"){
                send({ delta: o.delta.text });
              } else if (o.type === "error"){
                send({ error: o.error?.message || "모델 오류" });
              }
              /* thinking_delta 는 화면에 안 보냄 — 생각 과정은 안 보여 줌 */
            }
          }
        }
        ctrl.enqueue(enc.encode("data: [DONE]\n\n"));
      }catch(e){
        send({ error: e.message || "스트림이 끊겼습니다" });
      }finally{ ctrl.close(); }
    }
  });
  return new Response(stream, { status: 200, headers: sse });
}

/* ═══════════════════════════════════════════════════════════════
   4. /explain — 해설 배치 전용. 틀을 못 박음
   ═══════════════════════════════════════════════════════════════ */
const TOOL = {
  name: "write_solution",
  description: "전기기사 실기 한 문항의 해설을 정해진 칸에 나눠 적는다.",
  input_schema: {
    type: "object",
    required: ["gist", "given", "steps", "answer"],
    properties: {
      gist:    { type: "string", description: "한 줄 요지 — 무엇을 묻는 문제인가" },
      given:   { type: "array", items: { type: "string" }, description: "문제에 주어진 값" },
      formula: { type: "array", items: { type: "string" }, description: "쓰는 공식. KaTeX 문법, $ 없이" },
      steps:   { type: "array", description: "풀이 단계", items: { type: "object", required: ["say"],
                 properties: { say: { type: "string" }, math: { type: "string" } } } },
      answer:  { type: "string", description: "최종 답. 답안지 표기를 그대로" },
      unit:    { type: "string", description: "단위. 없으면 빈 문자열" },
      trap:    { type: "string", description: "흔한 실수 한 가지" },
      tags:    { type: "array", items: { type: "string" }, description: "과목·주제 꼬리표 2~4개" }
    }
  }
};
const SYS_SOL = [
  "너는 전기기사 실기 채점 기준을 아는 해설 작성자다.",
  "",
  "규칙",
  "- 답안지에 적힌 최종값·단위·유효숫자를 그대로 따른다. 반올림을 네 판단으로 바꾸지 않는다.",
  "- 답안지에 없는 값을 지어내지 않는다. 문제에서 읽히지 않는 수치는 given 에 넣지 않는다.",
  "- 도면(시퀀스·단선결선도) 문항이면 도면에서 읽은 기호와 결선을 말로 풀어 준다.",
  "- 문장은 개조식으로 짧게. '~함', '~임' 형태.",
  "- 수식은 KaTeX 문법으로 쓰되 $ 기호는 넣지 않는다. 앱이 감싼다.",
  "- 이미지가 흐리거나 잘려 확신이 안 서면 gist 첫머리에 '[확인필요] ' 를 붙인다.",
  "",
  "반드시 write_solution 도구로 답한다."
].join("\n");

/* ★ v224 — 그림을 «주소만» 넘기지 않는다. 워커가 직접 받아 base64 로 보낸다.
   ── 무슨 일이 있었나 ──
   여태는 주소에 token 이 붙은 «서명된» 것만 받아서 보내고, 공개 주소는
   { type:"image", source:{ type:"url", url } } 로 넘겨 Anthropic 더러
   직접 받아가라고 했다. 그런데 Supabase 공개 주소는 그렇게 넘기면
   Anthropic 이 통째로 거절한다 — 403 «Request not allowed».

   그래서 그림이 든 요청(해설 만들기·답 경계 찾기)만 전부 실패하고,
   글자만 보내는 /selftest 는 멀쩡했다. 키도 계정도 모델도 아무 문제 없었다.

   이제 서명 여부를 안 따지고 «항상» 받아서 실어 보낸다.
   받다 실패했을 때만 옛 방식(주소 넘기기)으로 물러선다.               */
async function imageBlock(url){
  if (!url) return null;
  const asUrl = () => ({ type: "image", source: { type: "url", url } });
  try{
    const res = await fetch(url);
    if (!res.ok) return asUrl();
    const buf = await res.arrayBuffer();
    if (!buf.byteLength) return asUrl();
    if (buf.byteLength > IMG_MAX) return null;      /* 너무 크면 아예 뺀다 */
    let bin = ""; const by = new Uint8Array(buf);
    for (let i = 0; i < by.length; i += 0x8000) bin += String.fromCharCode.apply(null, by.subarray(i, i + 0x8000));
    let mt = (res.headers.get("Content-Type") || "").split(";")[0].trim();
    /* Supabase 가 가끔 application/octet-stream 으로 준다. 그러면 Anthropic 이 안 받는다.
       주소 끝을 보고 고쳐 준다. */
    if (!/^image\/(jpeg|png|gif|webp)$/.test(mt)){
      const ext = (url.split("?")[0].match(/\.(\w+)$/) || [])[1];
      mt = ext === "png" ? "image/png"
         : ext === "gif" ? "image/gif"
         : ext === "webp" ? "image/webp"
         : "image/jpeg";
    }
    return { type: "image", source: { type: "base64", media_type: mt, data: btoa(bin) } };
  }catch(e){ return asUrl(); }
}

async function explain(req, env, H){
  const b = await req.json();
  const { q_url, a_url, q_text, a_text, year, session, no, points, subject } = b;
  if (!q_url && !q_text) return json({ error: "문제 이미지나 문제 글이 있어야 합니다" }, 400, H);
  if (!a_url && !a_text)
    return json({ error: "답이 없는 문항입니다. 답 슬롯을 먼저 채우세요.", code: "NO_ANSWER" }, 400, H);

  const parts = [];
  const head = [
    subject ? `과목: ${subject}` : null,
    (year && session) ? `회차: ${year}년 ${session}회` : null,
    no ? `문항 번호: ${no}번` : null,
    points ? `배점: ${points}점` : null
  ].filter(Boolean).join(" · ");
  if (head) parts.push({ type: "text", text: head });

  parts.push({ type: "text", text: "── 문제 ──" });
  const qi = await imageBlock(q_url); if (qi) parts.push(qi);
  if (q_text) parts.push({ type: "text", text: q_text });
  if (!qi && !q_text) return json({ error: "문제 이미지를 가져오지 못했습니다" }, 400, H);

  parts.push({ type: "text", text: "── 답안지 (이 값이 정답 기준임) ──" });
  const ai = await imageBlock(a_url); if (ai) parts.push(ai);
  if (a_text) parts.push({ type: "text", text: a_text });

  const T = tiers(env);
  const model = b.model || T.best;
  const budget = EFFORT[b.effort] ?? EFFORT.low;

  /* v209 — «생각(thinking)» 과 «이 도구를 반드시 써라(tool_choice: tool)» 는
     같이 쓸 수 없다. 둘 다 보내면 요청이 통째로 거절된다.
     해설은 틀이 고정돼야 하므로 도구 강제를 남기고 생각을 끈다.
     답안지가 이미 주어져 있어 생각이 없어도 결과 차이가 거의 없다. */
  const res = await call(env, {
    model, max_tokens: 4000, system: SYS_SOL,
    tools: [TOOL], tool_choice: { type: "tool", name: "write_solution" },
    messages: [{ role: "user", content: parts }]
  });
  const out = await res.json();
  const call_ = (out.content || []).find(c => c.type === "tool_use" && c.name === "write_solution");
  if (!call_) return json({ error: "정해진 틀로 답하지 않았습니다", said: textOf(out).slice(0, 400) }, 502, H);

  return json({ ok: true, sol: call_.input, model, effort: b.effort || "low", usage: out.usage || null }, 200, H);
}

/* ═══════════════════════════════════════════════════════════════
   5. /split-hint — 한 그림 안에서 «문제와 답의 경계» 를 찾아 준다

   복원본은 문제 바로 아래에 답이 같이 찍혀 있는 경우가 많다.
   자동 분할은 «답안 작성» 같은 머리글을 찾는데, 그런 표시가 없으면
   통째로 문제 슬롯에 들어가 답 슬롯이 빈 채로 남는다.

   여기서는 그림을 보고 «답이 시작되는 높이» 를 위에서부터의 비율(0~1)로
   돌려준다. 사람은 그 자리에 그어진 선을 눈으로 확인하고 손으로 미세조정만
   하면 된다. 자동으로 잘라 저장하지 않는다 — 잘못 자르면 되돌리기 번거롭다.
   ═══════════════════════════════════════════════════════════════ */
const CUT_TOOL = {
  name: "mark_cut",
  description: "문제 그림 안에서 답이 시작되는 높이를 표시한다.",
  input_schema: {
    type: "object",
    required: ["found"],
    properties: {
      found: { type: "boolean", description: "답이 이 그림 안에 같이 있으면 true" },
      y: { type: "number",
           description: "답이 시작되는 높이. 그림 맨 위가 0, 맨 아래가 1 인 비율. found 가 true 일 때만." },
      why: { type: "string", description: "그 자리로 본 근거 한 줄. 예: '(1) 이유 : 로 시작하는 줄'" }
    }
  }
};
const SYS_CUT = [
  "너는 전기기사 실기 복원본을 다루는 사람이다.",
  "그림 한 장 안에 문제와 답이 같이 찍혀 있는지 보고, 답이 시작되는 높이를 표시한다.",
  "",
  "답의 시작으로 보는 것",
  "- '(1)', '①', '▶', '답 :', '정답', '풀이' 로 시작하며 문제의 물음에 대응하는 줄",
  "- 문제 본문이 끝나고 들여쓰기·기호가 바뀌는 지점",
  "",
  "주의",
  "- 문제 안의 «조건 (1) (2)» 나 보기 항목은 답이 아니다. 물음이 끝난 뒤에 오는 것만 답이다.",
  "- 답이 안 보이면 found 를 false 로 한다. 억지로 자르지 않는다.",
  "- y 는 답의 첫 줄 «바로 위» 여백을 가리킨다.",
  "",
  "반드시 mark_cut 도구로 답한다."
].join("\n");

async function splitHint(req, env, H){
  const b = await req.json();
  const img = await imageBlock(b.url);
  if (!img) return json({ error: "그림을 가져오지 못했습니다" }, 400, H);

  /* 문제 그림이면 «답이 시작되는 자리», 답 그림이면 «문제가 끝나는 자리» 를 묻는다.
     답 슬롯에도 문제가 딸려 들어간 그림이 있어서 양쪽을 다 본다. */
  const ask = b.slot === "a"
    ? "이 그림은 «답» 자리에 들어간 것이다. 위쪽에 문제가 섞여 들어왔으면 답이 시작되는 높이를 표시해 줘. 처음부터 답만 있으면 found 를 false 로 해라."
    : "이 그림에서 답이 시작되는 높이를 표시해 줘.";
  const res = await call(env, {
    model: b.model || tiers(env).best,
    max_tokens: 700,
    system: SYS_CUT,
    tools: [CUT_TOOL],
    tool_choice: { type: "tool", name: "mark_cut" },
    messages: [{ role: "user", content: [
      { type: "text", text: ask },
      img
    ]}]
  });
  const out = await res.json();
  const c = (out.content || []).find(x => x.type === "tool_use" && x.name === "mark_cut");
  if (!c) return json({ error: "정해진 틀로 답하지 않았습니다" }, 502, H);

  const r = c.input || {};
  /* 너무 위나 너무 아래는 잘못 본 것으로 본다 */
  const y = Number(r.y);
  const ok = r.found === true && isFinite(y) && y > 0.08 && y < 0.95;
  return json({ ok, found: !!r.found, y: ok ? y : null, why: r.why || "",
                usage: out.usage || null }, 200, H);
}

/* ═══════════════════════════════════════════════════════════════ */
export default {
  async fetch(req, env){
    const H = cors(env, req);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: H });

    const path = new URL(req.url).pathname.replace(/\/+$/, "") || "/";
    const T = tiers(env);

    /* v209 — 자가진단.
       가장 짧은 요청 하나를 보내고 Anthropic 이 돌려준 것을 «그대로» 보여 준다.
       배치가 무더기로 실패할 때, 열쇠 문제인지 요청 모양 문제인지 여기서 갈린다. */
    if (path === "/selftest"){
      if (!env.ANTHROPIC_API_KEY)
        return json({ ok:false, where:"설정", why:"ANTHROPIC_API_KEY 가 없습니다" }, 200, H);
      const r = await fetch(API, {
        method:"POST",
        headers:{ "content-type":"application/json",
                  "x-api-key": env.ANTHROPIC_API_KEY,
                  "anthropic-version": VER },
        body: JSON.stringify({ model: T.best, max_tokens: 16,
          messages:[{ role:"user", content:"안녕. 한 글자만 답해." }] })
      });
      const body = await r.text();
      let parsed = null; try{ parsed = JSON.parse(body); }catch(e){}
      return json({
        ok: r.ok, status: r.status, model: T.best,
        keyHead: String(env.ANTHROPIC_API_KEY).slice(0,14) + "…",
        keyLen: String(env.ANTHROPIC_API_KEY).length,
        keyTrimmed: String(env.ANTHROPIC_API_KEY) === String(env.ANTHROPIC_API_KEY).trim(),
        upstream: parsed || body.slice(0,600)
      }, 200, H);
    }

    if (path === "/health" || path === "/")
      return json({ ok: true, provider: "anthropic", models: T, hasKey: !!env.ANTHROPIC_API_KEY }, 200, H);

    if (env.APP_KEY && req.headers.get("x-app-key") !== env.APP_KEY)
      return json({ error: "x-app-key 가 맞지 않습니다", detail: "x-app-key 가 맞지 않습니다" }, 401, H);

    if (path === "/ai/models") return models(env, H);

    if (!env.ANTHROPIC_API_KEY)
      return json({ error: "ANTHROPIC_API_KEY 가 없습니다", detail: "ANTHROPIC_API_KEY 가 없습니다" }, 500, H);
    if (req.method !== "POST")
      return json({ error: "POST 만 받습니다", detail: "POST 만 받습니다" }, 405, H);

    try{
      if (path === "/get-data") return await getData(req, env, H);
      if (path === "/ai/chat")  return await chat(req, env, H);
      if (path === "/explain")  return await explain(req, env, H);
      if (path === "/split-hint") return await splitHint(req, env, H);
      if (path === "/raw"){
        const b = await req.json();
        const r = await call(env, {
          model: b.model || T.best, max_tokens: b.max_tokens || 4000,
          system: b.system, messages: b.messages || []
        });
        return json(await r.json(), 200, H);
      }
    }catch(e){
      /* 옛 워커는 오류를 detail 로 돌려줬음. 화면들이 그걸 읽으므로 둘 다 담음 */
      return json({ error: e.message, detail: e.message, upstream: e.upstream || null }, 502, H);
    }

    return json({ error: "없는 경로입니다", detail: "/get-data · /ai/models · /ai/chat · /explain · /split-hint · /selftest · /health" }, 404, H);
  }
};
