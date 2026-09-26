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


/* ═══════════════════════════════════════════════════════════════
   /notion — 대화를 노션 페이지로 저장 (v236)

   브라우저는 노션 API 를 직접 부를 수 없음(노션이 막아 둠).
   그래서 워커가 대신 불러 줌. 크롬 확장(AI Exporter)이 되는 이유도 같음 —
   확장은 브라우저 밖에서 부르기 때문.

   ── 시크릿 ──────────────────────────────────────────────
   NOTION_TOKEN   notion.so/my-integrations 에서 만든 내부 통합 토큰 (ntn_…)
                  ※ 저장할 페이지를 그 통합과 «연결» 해 두어야 함
                    (노션 페이지 우상단 ⋯ → 연결 → 통합 이름 고르기)

   ── 받는 것 ────────────────────────────────────────────
   { parent: "페이지ID 32자리", title: "제목", markdown: "…" }
   ── 돌려주는 것 ────────────────────────────────────────
   { ok:true, id, url }        또는  { ok:false, need:"token" | error }
   ═══════════════════════════════════════════════════════════════ */
const NOTION_VER = "2022-06-28";

/* **굵게** · *기울임* · `코드` · [글](주소) 를 노션 리치텍스트로 */
function nRich(text){
  const out = [];
  const src = String(text || "");
  const re = /(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g;
  let i = 0, m;
  const push = (t, ann, link) => {
    if (!t) return;
    /* 노션은 한 조각에 2000자까지만 받음 */
    for (let k = 0; k < t.length; k += 1900){
      out.push({
        type: "text",
        text: { content: t.slice(k, k + 1900), link: link ? { url: link } : null },
        annotations: Object.assign({ bold:false, italic:false, code:false }, ann || {})
      });
    }
  };
  while ((m = re.exec(src))){
    push(src.slice(i, m.index));
    const t = m[0];
    if (t.startsWith("**"))      push(t.slice(2, -2), { bold:true });
    else if (t.startsWith("`"))  push(t.slice(1, -1), { code:true });
    else if (t.startsWith("[")){
      const g = t.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
      push(g[1], null, g[2]);
    }
    else                         push(t.slice(1, -1), { italic:true });
    i = m.index + t.length;
  }
  push(src.slice(i));
  return out.length ? out.slice(0, 90) : [{ type:"text", text:{ content:"" } }];
}

const nBlock = (type, extra) => ({ object:"block", type, [type]: extra });

/* 마크다운 → 노션 블록. 제목·문단·목록·인용·코드·구분선·표까지 */
function mdToBlocks(md){
  const lines = String(md || "").replace(/\r/g, "").split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++){
    let L = lines[i];

    /* 코드 덩어리 */
    if (/^\s*```/.test(L)){
      const lang = L.replace(/^\s*```/, "").trim().toLowerCase() || "plain text";
      const buf = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) buf.push(lines[i++]);
      out.push(nBlock("code", {
        rich_text: [{ type:"text", text:{ content: buf.join("\n").slice(0, 1900) } }],
        language: /^(js|javascript)$/.test(lang) ? "javascript"
                : /^(py|python)$/.test(lang) ? "python"
                : /^(html|css|sql|json|bash|shell|markdown)$/.test(lang) ? lang
                : "plain text"
      }));
      continue;
    }

    /* 표 — |…|…| 가 이어지는 동안 */
    if (/^\s*\|.*\|\s*$/.test(L)){
      const rows = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])){
        const cells = lines[i].trim().replace(/^\||\|$/g, "").split("|").map(c => c.trim());
        if (!cells.every(c => /^:?-{2,}:?$/.test(c))) rows.push(cells);
        i++;
      }
      i--;
      const w = Math.max(1, Math.min(20, ...rows.map(r => r.length).map(n => n || 1)));
      out.push(nBlock("table", {
        table_width: w,
        has_column_header: true,
        has_row_header: false,
        children: rows.slice(0, 90).map(r => nBlock("table_row", {
          cells: Array.from({ length: w }, (_, k) => nRich(r[k] || ""))
        }))
      }));
      continue;
    }

    if (!L.trim()) continue;

    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(L)){ out.push(nBlock("divider", {})); continue; }

    let m = L.match(/^(#{1,6})\s+(.*)$/);
    if (m){
      const lv = Math.min(3, m[1].length);
      out.push(nBlock("heading_" + lv, { rich_text: nRich(m[2]) }));
      continue;
    }

    m = L.match(/^\s*>\s?(.*)$/);
    if (m){ out.push(nBlock("quote", { rich_text: nRich(m[1]) })); continue; }

    m = L.match(/^\s*[-*+]\s+(.*)$/);
    if (m){ out.push(nBlock("bulleted_list_item", { rich_text: nRich(m[1]) })); continue; }

    m = L.match(/^\s*\d+[.)]\s+(.*)$/);
    if (m){ out.push(nBlock("numbered_list_item", { rich_text: nRich(m[1]) })); continue; }

    out.push(nBlock("paragraph", { rich_text: nRich(L) }));
  }
  return out.length ? out : [nBlock("paragraph", { rich_text: nRich("(비어 있음)") })];
}

/* 주소에서 32자리 ID 만 뽑음.
   «…/My-Page-1a2b…» 처럼 앞말에 a·e 같은 글자가 붙어 있으면
   앞에서부터 세면 한 칸씩 밀린다. 그래서 «맨 뒤 덩어리의 마지막 32자» 를 쓴다. */
const nId = v => {
  const t = String(v || "").replace(/-/g, "").split(/[?#]/)[0];
  const runs = t.match(/[0-9a-fA-F]{32,}/g);
  if (!runs) return "";
  const r = runs[runs.length - 1];
  return r.slice(r.length - 32).toLowerCase();
};

async function notionSave(req, env, H){
  if (!env.NOTION_TOKEN)
    return json({ ok:false, need:"token",
      error:"NOTION_TOKEN 이 없습니다 — 워커 시크릿에 넣어 주세요" }, 200, H);

  const b = await req.json().catch(() => ({}));
  const parent = nId(b.parent);
  if (!parent)
    return json({ ok:false, error:"노션 페이지 주소(ID)를 읽지 못했습니다" }, 400, H);

  const blocks = mdToBlocks(b.markdown);
  const head = {
    "content-type": "application/json",
    "authorization": "Bearer " + env.NOTION_TOKEN,
    "Notion-Version": NOTION_VER
  };
  const title = String(b.title || "AI 대화").slice(0, 190);

  /* 부모가 페이지인지 데이터베이스인지 모르므로 페이지로 먼저 시도하고,
     아니라고 하면 데이터베이스로 한 번 더 시도함 */
  async function create(kind){
    const body = kind === "database_id"
      ? { parent:{ database_id: parent },
          properties:{ title:{ title:[{ text:{ content: title } }] } },
          children: blocks.slice(0, 100) }
      : { parent:{ page_id: parent },
          properties:{ title:{ title:[{ text:{ content: title } }] } },
          children: blocks.slice(0, 100) };
    const r = await fetch("https://api.notion.com/v1/pages", {
      method:"POST", headers: head, body: JSON.stringify(body)
    });
    return { r, d: await r.json().catch(() => ({})) };
  }

  let { r, d } = await create("page_id");
  if (!r.ok && /database|is a database/i.test(JSON.stringify(d)))
    ({ r, d } = await create("database_id"));

  if (!r.ok)
    return json({ ok:false, status:r.status,
      error: (d && d.message) || ("노션이 거절했습니다 (" + r.status + ")") }, 200, H);

  /* 100개가 넘으면 나눠 붙임 */
  for (let i = 100; i < blocks.length; i += 100){
    await fetch("https://api.notion.com/v1/blocks/" + d.id + "/children", {
      method:"PATCH", headers: head,
      body: JSON.stringify({ children: blocks.slice(i, i + 100) })
    });
  }

  return json({ ok:true, id:d.id, url:d.url || "", blocks:blocks.length }, 200, H);
}

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
/* ★ v252 — 칸을 크게 늘렸다.
   여태 해설은 «식 쓰고 숫자 넣고 답» 이 전부라, 그 과목을 배운 적 없는 사람은
   왜 그 식을 쓰는지, 기호가 무엇인지, 단위가 왜 그렇게 변하는지를 알 수 없었다.
   background(먼저 알아야 할 것) · read(문제 읽는 법) · symbols(기호 뜻) ·
   steps[].why / calc(왜 · 숫자 대입) · why_answer · check(검산) 를 새로 받는다.
   화면(review·explain-batch)은 «있는 칸만» 찍으므로 옛 워커와도 섞여 돌아간다. */
const TOOL = {
  name: "write_solution",
  description: "전기기사 실기 한 문항의 해설을 정해진 칸에 나눠 적는다. 전기를 배운 적 없는 사람이 혼자 읽고 이해할 만큼 자세히.",
  input_schema: {
    type: "object",
    required: ["kind", "sub_count", "gist", "background", "given", "symbols", "steps", "answer"],
    properties: {
      sub_count:  { type: "integer", description: "문제에 있는 소문항 수. (1)(2) 두 개면 2, 소문항이 없으면 1. steps 를 쓰기 «전에» 문제를 보고 센다" },
      kind:       { type: "string", enum: ["계산", "나열", "단답", "서술", "회로·시퀀스", "표·선정"],
                    description: "문제 유형. 계산=숫자로 값을 구함 · 나열=~을 N가지 쓰시오 · 단답=명칭·약호·용어 · 서술=이유·방법을 글로 · 회로·시퀀스=회로·접점·동작 · 표·선정=계산 뒤 표·규격에서 고름" },
      gist:       { type: "string", description: "한 줄 요지 — 무엇을 묻는 문제인가" },
      background: { type: "array", items: { type: "string" },
                    description: "풀기 전에 알아야 할 배경. 전기를 처음 보는 사람 기준으로 3~6개. 한 개가 배열 원소 하나" },
      given:      { type: "array", items: { type: "string" },
                    description: "문제에 나온 숫자·조건을 «빠짐없이 전부». 한 개가 배열 원소 하나. '이름 = 숫자 단위 (뜻)' 꼴" },
      symbols:    { type: "array", description: "식에 나오는 기호",
                    items: { type: "object", required: ["sym", "mean"], properties: {
                      sym:  { type: "string", description: "기호. KaTeX, $ 없이" },
                      mean: { type: "string", description: "무슨 뜻인지 쉬운 말로" },
                      unit: { type: "string", description: "단위" },
                      val:  { type: "string", description: "이 문제에서의 값" },
                      say:  { type: "string", description: "읽는 발음 한글. 예: V_s '브이 에스', \\cos\\theta '코사인 세타', \\%Z '퍼센트 제트'" } } } },
      steps:      { type: "array", minItems: 1, description: "★ 반드시 채운다(비우면 틀린 답). 풀이 단계. 문제에 (1)(2)(3) 같은 소문항이 있으면 «소문항마다 한 단계» 를 만들고 하나도 빠뜨리지 않는다. 소문항이 없으면 계산 순서대로 4~8개. 한 단계는 아래 다섯 줄로",
                    items: { type: "object", required: ["say"], properties: {
                      say:   { type: "string", description: "이 단계의 이름. 소문항이면 '(2) 배선 가닥수 구하기' 처럼 소문항 번호로 시작한다" },
                      ans:   { type: "string", description: "이 단계가 소문항 하나를 끝내면 그 소문항의 답(답안지 표기 그대로). 단답·서술·나열형은 단계마다 반드시. 아니면 빈 문자열" },
                      sym:   { type: "string", description: "①부호식 — 기호만으로 세운 식. 조건으로 식이 바뀌면 \\xrightarrow{X=0} 으로 잇는다. KaTeX, $ 없이" },
                      plain: { type: "string", description: "②해설식 — ①과 «생김새가 똑같은 식». 기호 자리에만 한글 이름을 넣는다. ①이 분수면 여기도 \\dfrac, ①이 \\times 면 여기도 \\times, ①이 \\sqrt{} 면 여기도 \\sqrt{}. '나누기'·'곱하기'·'루트3'·'그 다음'·'~를 곱함' 같은 말로 풀어쓴 «문장» 은 절대 금지 — 그건 why 칸이 할 일. 한글은 \\text{} 안에. KaTeX, $ 없이" },
                      num:   { type: "string", description: "③숫자대입식 — 숫자를 넣고 계산해 결과까지. 단위는 뒤에 \\,[\\text{옴}] 처럼 한글로. KaTeX, $ 없이" },
                      unit:  { type: "string", description: "④단위계산식 — 숫자 대신 «단위» 만 넣어 결과 단위가 맞는지 보이는 식. 예: [\\text{옴}] = \\dfrac{[\\text{볼트}] \\times [\\text{볼트}]}{[\\text{와트}]}. KaTeX, $ 없이" },
                      why:   { type: "string", description: "⑤왜 — 이 식을 왜 쓰는지 한글 3~6문장. 수식·기호·달러표시를 넣지 않는다. 값은 '저항 0.945옴' 처럼 글로 쓴다" } } } },
      answer:     { type: "string", description: "최종 답. 소문항이 있으면 '(1) …' 줄, '(2) …' 줄 처럼 줄을 나눠 모두 적는다. 답안지 표기를 그대로" },
      unit:       { type: "string", description: "단위. 답이 한 값일 때만. 소문항이 여럿이면 빈 문자열" },
      check:     { type: "string", description: "답이 맞는지 거꾸로 확인하는 법. 한글 문장으로만. 수식·백슬래시를 쓰지 않고 '70제곱밀리미터로 되짚으면 저항 0.779옴' 처럼 값을 글로 쓴다" },
      trap:      { type: "string", description: "흔한 실수. 한글 문장으로만. 수식·백슬래시를 쓰지 않는다" },
      memo:      { type: "string", description: "외우는 요령 한 줄. 한글로만. 필요 없으면 빈 문자열" },
      why_answer: { type: "string", description: "왜 이 답인가 — 단답·서술형에서 뜻 풀이와 근거. 한글 문장 3~6개" },
      items:      { type: "array", description: "나열형 답의 항목. 답안지 순서대로",
                    items: { type: "object", required: ["word"], properties: {
                      word: { type: "string", description: "항목 이름 (답안지 표기 그대로)" },
                      mean: { type: "string", description: "쉬운 말로 한 줄 뜻" },
                      why:  { type: "string", description: "왜 이것이 답인지 · 무엇을 하는 것인지 2~4문장" } } } },
      keys:       { type: "array", items: { type: "string" }, description: "서술형 채점 포인트 — 답안에 꼭 들어가야 할 핵심어·문장" },
      mnemo:      { type: "object", description: "두문자. 답이 낱말 3개 이상 나열될 때만. 계산·표·선정 답에는 넣지 않는다",
                    properties: {
                      code: { type: "string", description: "항목마다 앞 글자 하나씩 이은 것. 예: '단피엠차'" },
                      map:  { type: "array", description: "code 한 글자마다 한 줄. 순서 = code 순서",
                              items: { type: "object", required: ["h", "word"], properties: {
                                h:    { type: "string", description: "그 글자 하나" },
                                word: { type: "string", description: "그 글자가 뜻하는 항목" } } } },
                      say:  { type: "string", description: "code 를 외우기 쉬운 한 문장 (없으면 빈 문자열)" } } },
      mnemos:     { type: "array", description: "소문항이 둘 이상이고 저마다 여러 개를 쓰라고 하면(예: (1) 장점 4가지 (2) 단점 2가지) 소문항마다 두문자 하나씩. 이때 mnemo 는 비운다",
                    items: { type: "object", required: ["label", "code", "map"], properties: {
                      label: { type: "string", description: "소문항 번호와 이름. 예: '(1) 장점', '(2) 단점'" },
                      code:  { type: "string", description: "그 소문항 항목의 앞 글자를 이은 것" },
                      map:   { type: "array", items: { type: "object", required: ["h", "word"], properties: {
                                 h: { type: "string" }, word: { type: "string" } } } },
                      say:   { type: "string", description: "외우기 쉬운 한 문장 (없으면 빈 문자열)" } } } },
      tags:       { type: "array", items: { type: "string" }, description: "과목·주제 꼬리표 2~4개" }
    }
  }
};
const SYS_SOL = [
  "너는 전기기사 실기 채점 기준을 아는 해설 작성자다.",
  "읽는 사람은 전기를 전공하지 않았고, 이 단원을 처음 본다고 여긴다.",
  "",
  "소문항이 있는 문제 — 이걸 가장 자주 틀린다",
  "- 문제에 (1) (2) (3) (4) 처럼 물음이 여러 개면, 그 «하나하나» 를 풀이 단계로 만든다. 하나도 건너뛰지 않는다.",
  "- say 를 소문항 번호로 시작한다. 예: '(1) 기구 그림기호 그리기', '(2) 배선 가닥수 구하기'.",
  "- 계산이 없는 소문항(기호 그리기·명칭 쓰기 등)은 sym·num·unit 을 비우고 why 에 «무엇을 왜 그렇게 답하는지» 를 자세히 쓴다.",
  "-   예: 3로 스위치는 검은 동그라미에 아래첨자 3 을 붙여 그림. 단극 스위치와 구분하려고 붙이는 표시임.",
  "- 계산이 있는 소문항만 sym·plain·num·unit 을 채운다.",
  "- answer 에는 소문항 번호를 붙여 줄을 나눠 «전부» 적는다.",
  "- 답안지에 소문항이 넷이면 풀이 단계도 최소 넷이어야 한다. 세면서 확인한다.",
  "- 소문항 하나를 끝내는 단계에는 ans 에 그 소문항 답을 적는다. 화면은 «단계 이름 → 답 → 식 → 왜» 순서로 보여 준다.",
  "",
  "문제 유형(kind) — 먼저 정하고, 그 유형에 «필요한 칸만» 채운다",
  "- 계산      : background · given · symbols · steps(식 네 줄 + why) · answer · unit · check · trap",
  "- 표·선정    : background · given · symbols · steps(«계산해서 값 구하기» 단계 + «표에서 바로 위 값 고르기» 단계) · answer · check · trap",
  "- 회로·시퀀스 : background · symbols(접점·기기 기호와 역할) · steps(동작 순서 — say·ans·why, 식이 있을 때만 식 줄) · answer · trap",
  "- 단답      : steps(소문항마다 say·ans·why, 식 줄 없음) · answer · memo · trap.  given · symbols · check 는 넣지 않는다",
  "- 나열      : steps(say·ans·why) · items(항목마다 뜻·왜) · mnemo(두문자) · answer · trap.  symbols · check 는 넣지 않는다",
  "- 서술      : background · steps(say·ans(모범 답안 문장)·why) · keys(채점 포인트) · answer · trap.  symbols · check 는 넣지 않는다",
  "- 소문항 유형이 섞이면 가장 비중이 큰 유형으로 정하고, 나머지 소문항도 그 칸들 안에서 푼다.",
  "",
  "유형 가르는 법 — 문제 끝말과 답의 생김새로 정한다",
  "- 답에 계산한 숫자가 하나라도 있으면 «단답» 도 «나열» 도 아니다.",
  "- '표에서 선정하시오 · 규격을 고르시오' → 표·선정. 계산해서 나온 값으로 표를 고르는 문제도 표·선정이다.",
  "-   예: 단락전류를 구해 표에서 정격차단전류를 고르고 차단용량을 계산해 표에서 선정 → 표·선정",
  "- '구하시오 · 계산하시오' 이고 답이 숫자 → 계산",
  "- '~을 N가지 쓰시오 · 열거하시오 · 종류를 쓰시오' 이고 답이 낱말 여러 개 → 나열",
  "- '명칭 · 약호 · 용어 · 기호의 이름을 쓰시오' 이고 답이 낱말 하나(소문항마다 하나) → 단답",
  "- '이유 · 목적 · 방법 · 차이 · 특징을 설명하시오' 이고 답이 문장 → 서술",
  "- 시퀀스 회로 · 접점 · 타임차트 · 동작 순서 · 논리식 → 회로·시퀀스",
  "- 사용자가 유형을 정해 보냈으면(아래 «정해 준 유형») 그 유형을 따른다.",
  "- 답이 낱말 3개 이상 나열되면 mnemo(두문자)를 넣는다. code 는 항목마다 앞 글자 하나 — 답안지 순서 그대로.",
  "- 소문항이 둘 이상이고 저마다 «N가지» 를 쓰라고 하면(예: (1) 장점 4가지 (2) 단점 2가지) mnemo 대신 mnemos 에 «소문항마다» 하나씩 넣는다. 하나도 빠뜨리지 않는다.",
  "-   각 묶음의 항목 수 = 문제가 요구한 가지 수. 답안지에 더 많이 적혀 있으면 채점에 가장 흔히 쓰는 것부터 그 수만큼.",
  "-   items 도 모든 소문항 항목을 빠짐없이 넣고, word 앞에 소문항 번호를 붙인다. 예: '(2) 에너지 밀도가 낮음'",
  "",
  "형광펜 (==핵심==)",
  "- 답안에 반드시 들어가야 할 핵심어·문구, 채점에서 점수가 걸리는 표현은 ==이렇게== 감싼다.",
  "- why · ans · background · trap · why_answer · items 에 쓴다. 한 칸에 1~3곳. 식 네 칸(sym·plain·num·unit)에는 쓰지 않는다.",
  "",
  "약어",
  "- 영문 약어(MOF, SR, OS, VCB, LA, CT, PT, ZCT, OCR, DS, ASS, COS 등)는 처음 나올 때 반드시 «약어(영문 원말, 한글 이름)» 로 푼다.",
  "-   예: MOF(Metering Out Fit, 계기용 변성기) · SR(Series Reactor, 직렬 리액터) · OS(Oil Switch, 유입 개폐기)",
  "- 그 뒤로는 약어만 써도 된다. 영문 원말이 확실하지 않으면 지어내지 말고 한글 이름만 적는다.",
  "",
  "지켜야 할 것",
  "- 답안지에 적힌 최종값·단위·유효숫자를 그대로 따른다. 반올림을 네 판단으로 바꾸지 않는다.",
  "- 답안지에 없는 값을 지어내지 않는다.",
  "- 이미지가 흐리거나 잘려 확신이 안 서면 gist 첫머리에 '[확인필요] ' 를 붙인다.",
  "- 도구의 칸을 채울 때 <item> · <step> 같은 표를 쓰지 않는다. 목록은 배열 원소 하나에 한 개씩 넣는다.",
  "- 한 칸에 해설 전체를 몰아 넣지 않는다. 칸마다 그 칸의 내용만 넣는다.",
  "",
  "풀이 한 단계 — 이름 하나에 다섯 줄. 순서를 지킨다",
  "- say   : 그 단계의 이름. 한글 한 줄.",
  "- sym   : ①부호식. 기호만으로 세운 식. 조건으로 식이 바뀌면 화살표 위에 조건을 얹는다.",
  "-   예: e = \\dfrac{P}{V_{r}}(R + X\\tan\\theta) \\xrightarrow{X=0} e = \\dfrac{P}{V_{r}}R",
  "- plain : ②해설식. ①과 «생김새가 똑같은 식». 기호 자리에만 한글 이름을 갈아 끼운다.",
  "-   ★ 이것은 «식» 이지 «문장» 이 아니다. 이 말들을 쓰면 틀린 것이다 —",
  "-     '나누기' '곱하기' '루트3' '그 다음' '~를 곱함' '~로 나눈 값'.",
  "-     나누기는 \\dfrac 으로, 곱하기는 \\times 로, 루트는 \\sqrt{} 로 ①에 있던 모양 그대로 둔다.",
  "-     ①에 분수가 둘이면 ②에도 분수가 둘이어야 한다. 하나로 뭉치거나 줄글로 풀지 않는다.",
  "-     말로 풀어쓴 설명은 why 칸에서 한다. 여기에 겹쳐 쓰지 않는다.",
  "-   예(분수 하나): \\text{전선저항} = \\dfrac{\\text{전압강하} \\times \\text{수전단전압}}{\\text{부하전력}}",
  "-   예(분수 둘) ① i_{p} = \\dfrac{P}{\\sqrt{3} V_{1}} \\times \\dfrac{1}{n_{1}}",
  "-   예(분수 둘) ② \\text{변류기1차전류} = \\dfrac{\\text{변압기정격용량}}{\\sqrt{3} \\times \\text{1차전압}} \\times \\dfrac{1}{\\text{변류비}}",
  "-   나쁜 예(이렇게 오면 틀린 것): \\text{변류기1차전류} = \\text{변압기정격용량 나누기 (루트3 곱하기 1차전압) 그 다음 변류비의 2차전류를 곱함}",
  "- num   : ③숫자대입식. 숫자를 넣고 결과까지. 단위는 뒤에 한글로.",
  "-   예: R = \\dfrac{300 \\times 6300}{2000 \\times 10^{3}} = 0.945\\,[\\text{옴}]",
  "- unit  : ④단위계산식. 숫자 대신 «단위» 만 넣어 결과 단위가 맞는지 보인다.",
  "-   예: [\\text{옴}] = \\dfrac{[\\text{볼트}] \\times [\\text{볼트}]}{[\\text{와트}]}",
  "-   예: [\\text{제곱밀리미터}] = [\\text{옴}\\cdot\\text{제곱밀리미터}/\\text{미터}] \\times \\dfrac{[\\text{미터}]}{[\\text{옴}]}",
  "- why   : ⑤왜 이 식을 쓰는지. 한글 3~6문장.",
  "",
  "글 칸에는 수식을 넣지 않는다 — 이걸 어기면 화면이 깨진다",
  "- why · check · trap · memo · background · given 은 «글» 칸이다. 여기에는 백슬래시(\\)도 달러($)도 쓰지 않는다.",
  "- 값을 말할 때는 글로 쓴다. '저항 0.945옴', '단면적 57.72제곱밀리미터', '전압강하 300볼트'.",
  "- 수식은 오직 sym · plain · num · unit 네 칸에만 넣는다.",
  "",
  "수식(KaTeX) 쓰는 법 — 어기면 화면이 깨진다",
  "- 분수는 \\dfrac{위}{아래}. (1/58) 처럼 빗금으로 쓰지 않는다.",
  "- 아래첨자는 V_{s}, V_{r}, Q_{c} 꼴. Vs 로 붙여 쓰지 않는다.",
  "- 수식 안 한글은 \\text{} 안에만. '이므로' 같은 잇는 말은 아예 넣지 말고 why 로 뺀다.",
  "- 천 단위 쉼표를 쓰지 않는다. 6600 으로 쓴다.",
  "- 단위는 \\,[\\mathrm{V}] 꼴. \\quad · \\; · \\hspace · \\text 로 빈칸을 만들지 않는다.",
  "- ×, ÷, √ 대신 \\times · \\div · \\sqrt{} 를 쓴다.",
  "",
  "부호 칸",
  "- symbols 에는 식에 나온 기호를 빠짐없이. 뜻·단위·이 문제에서의 값까지.",
  "- symbols 마다 say 에 읽는 발음을 한글로. 예: V_s '브이 에스', I_s '아이 에스', \\theta '세타', \\%Z '퍼센트 제트'.",
  "",
  "주어진 값",
  "- given 에는 문제에 나온 숫자·조건을 하나도 빼지 않는다. 역률·전압·저항·리액턴스·거리·용량 등 전부.",
  "",
  "말투",
  "- 개조식. '~함', '~임', '~됨'. '~합니다' 는 쓰지 않는다.",
  "- 다만 설명은 충분히 길게 쓴다.",
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
/* ★ v228 — «주소로 물러서기» 를 없앴다.
     받다 실패하면 옛 방식(주소 넘기기)으로 물러섰는데, 그 길이 바로 403 을 부른다.
     물러선 자리에서 또 403 이 나니 «왜 실패했는지» 가 영영 안 보였다.
     이제 물러서지 않고 «못 받았다» 고 밝힌다. 까닭도 같이 적는다. */
async function imageBlock(url){
  if (!url) return null;
  try{
    const res = await fetch(url);
    if (!res.ok) throw new Error(`그림 주소가 ${res.status} 를 돌려줬습니다`);
    const buf = await res.arrayBuffer();
    if (!buf.byteLength) throw new Error("그림이 비어 있습니다");
    if (buf.byteLength > IMG_MAX)
      throw new Error(`그림이 너무 큽니다 (${Math.round(buf.byteLength/1024)}KB)`);
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
  }catch(e){
    const err = new Error(`그림을 못 받았습니다 — ${e.message || e}`);
    err.imgUrl = url;
    throw err;
  }
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
  let qi = null, ai = null;
  try{
    qi = await imageBlock(q_url);
    ai = await imageBlock(a_url);
  }catch(e){
    /* 그림을 못 받은 것을 «Anthropic 이 막았다» 로 뭉뚱그리면 엉뚱한 데를 판다 */
    return json({ error: e.message, code: "IMG_FETCH", url: e.imgUrl || null }, 502, H);
  }
  if (qi) parts.push(qi);
  if (q_text) parts.push({ type: "text", text: q_text });
  if (!qi && !q_text) return json({ error: "문제 이미지를 가져오지 못했습니다" }, 400, H);

  parts.push({ type: "text", text: "── 답안지 (이 값이 정답 기준임) ──" });
  if (ai) parts.push(ai);
  if (a_text) parts.push({ type: "text", text: a_text });

  const T = tiers(env);
  const model = b.model || T.best;

  /* v209 — «생각(thinking)» 과 «이 도구를 반드시 써라(tool_choice: tool)» 는
     같이 쓸 수 없다. 둘 다 보내면 요청이 통째로 거절된다.
     해설은 틀이 고정돼야 하므로 도구 강제를 남기고 생각을 끈다.
     답안지가 이미 주어져 있어 생각이 없어도 결과 차이가 거의 없다. */
  /* ★ v252 — 상세도(depth). 화면에서 고른 값이 그대로 온다.
     4000 토큰으로는 배경·기호·단계별 이유까지 담으면 중간에 잘렸다. */
  /* ★ v281 — full 12000 → 20000. 표가 큰 문제를 자세히 쓰면 12000 에서 잘려 뒤 소문항이 사라졌다 */
  const DEPTH = { low: 3000, mid: 6000, full: 20000 };
  const depth = DEPTH[b.depth] ? b.depth : (b.depth ? "full" : "full");
  const maxTok = b.max_tokens || DEPTH[depth];
  const ask = depth === "low"
    ? "짧게 요점만 적는다."
    : depth === "mid"
      ? "보통 길이로 적되, 기호 뜻과 숫자 대입 과정은 빠뜨리지 않는다."
      : "아주 자세히 적는다. 전기를 처음 보는 사람이 이 해설만 읽고 혼자 이해할 수 있어야 한다. 길이를 아끼지 않는다.";
  parts.push({ type: "text", text: "── 어떻게 적을까 ──\n" + ask });
  /* ★ v278 — 화면에서 사람이 유형을 골라 보냈으면 그 틀로 */
  const KINDS = ["계산", "나열", "단답", "서술", "회로·시퀀스", "표·선정"];
  if (b.kind && KINDS.includes(String(b.kind)))
    parts.push({ type: "text", text: `── 정해 준 유형 ──\n이 문항은 «${b.kind}» 유형이다. kind 를 «${b.kind}» 로 하고 그 유형의 칸을 채운다.` });

  const ask1 = async (extra, mt) => {
    const res = await call(env, {
      model, max_tokens: mt || maxTok, system: SYS_SOL,
      tools: [TOOL], tool_choice: { type: "tool", name: "write_solution" },
      messages: [{ role: "user", content: extra ? parts.concat([{ type: "text", text: extra }]) : parts }]
    });
    const out = await res.json();
    const c = (out.content || []).find(x => x.type === "tool_use" && x.name === "write_solution");
    return { out, sol: c ? fixSol(c.input) : null };
  };
  const T0 = Date.now();
  let { out, sol } = await ask1();
  if (!sol) return json({ error: "정해진 틀로 답하지 않았습니다", said: textOf(out).slice(0, 400) }, 502, H);

  /* ★ v280 — 칸이 깨져 왔거나(steps 를 JSON 글자로) 소문항 수보다 단계가 모자라면 한 번만 다시 받는다 */
  let retried = false;
  /* 소문항 수 — 모델이 센 sub_count 와 답에 적힌 (n) 중 큰 쪽 */
  const needOf = s => Math.max(Number(s.sub_count) || 0, subCount(s.answer));
  /* 단계 이름의 (n) 으로 어느 소문항을 다뤘는지 센다 */
  const covered = s => new Set((Array.isArray(s.steps) ? s.steps : [])
    .map(x => String((x && x.say) || "").match(/^\s*\(\s*(\d{1,2})\s*\)/)).filter(Boolean).map(m => m[1])).size;
  /* ★ v297 — 원칙 검사: 유형마다 «반드시 있어야 할 칸» 을 하나하나 본다.
     여태는 «steps 가 아예 없나» 만 봤다 — 풀이·주어진 값·식 네 줄이 빠져도 그대로 저장됐다. */
  const probs = s => {
    const P = [];
    if (!s) return ["답을 정해진 틀로 주지 않았다"];
    const A = k => Array.isArray(s[k]) ? s[k] : [];
    const kind = String(s.kind || "");
    const calc = kind === "계산" || kind === "표·선정";
    const steps = A("steps").filter(x => x && typeof x === "object");
    const n = Math.max(1, needOf(s));
    if (!steps.length) P.push("steps(풀이 단계)가 비었다 — 소문항마다 한 단계씩, 객체 배열로 반드시 넣는다");
    else if (steps.length < n) P.push(`소문항이 ${n}개인데 풀이 단계가 ${steps.length}개뿐이다`);
    if (n > 1 && covered(s) < n) P.push(`단계 이름(say)이 (1)~(${n}) 소문항을 다 다루지 않았다 — ${covered(s)}개만`);
    if (!String(s.answer || "").trim()) P.push("answer 가 비었다");
    if (calc){
      if (A("given").length < 2) P.push("given(주어진 값)이 모자란다 — 문제에 나온 숫자·조건(용량·역률·전압·거리 등)을 하나도 빼지 말고 전부");
      if (!A("symbols").length) P.push("symbols(부호)가 비었다 — 식에 나온 기호를 뜻·단위·이 문제 값·읽는 법까지");
      if (!A("background").length) P.push("background(먼저 알아야 할 것)가 비었다");
      const four = steps.filter(x => ["sym", "plain", "num", "unit"].every(k => String(x[k] || "").trim()));
      /* 표·선정의 «표에서 바로 위 값 고르기» 단계는 식이 없는 게 정상 — 네 줄 빈칸 검사는 계산형만 */
      const half = kind !== "계산" ? [] : steps.filter(x => String(x.num || "").trim() && !["sym", "plain", "unit"].every(k => String(x[k] || "").trim()));
      if (!four.length) P.push("계산 문제인데 식 네 줄(sym 부호식 · plain 해설식 · num 숫자대입식 · unit 단위식)을 다 갖춘 단계가 하나도 없다 — 계산하는 단계마다 네 줄을 모두");
      else if (half.length) P.push(`숫자를 넣은 단계 ${half.length}개에 부호식·해설식·단위식 중 빈 줄이 있다 — 네 줄을 모두`);
      if (!String(s.check || "").trim()) P.push("check(검산)가 비었다");
    }
    if (steps.some(x => !String(x.why || "").trim())) P.push("why(왜)가 빈 단계가 있다 — 단계마다 3~6문장");
    if (["단답", "서술", "나열"].includes(kind) && steps.some(x => !String(x.ans || "").trim())) P.push("단답·서술·나열형인데 ans(그 소문항 답)가 빈 단계가 있다");
    return P;
  };
  const score = s => s ? -probs(s).length * 10 + covered(s) / 100 + (Array.isArray(s.steps) ? s.steps.length / 1000 : 0) : -999;
  /* 최대 두 번 더 — 빠진 것을 짚어서. 화면이 10분에 끊으므로 3분 30초가 지났으면 더 받지 않음 */
  for (let k = 0; k < 2; k++){
    if (Date.now() - T0 > 210000) break;
    const cut = out.stop_reason === "max_tokens";
    const P = probs(sol);
    if (!cut && !P.length) break;
    retried = true;
    const why = (cut ? ["직전 답이 길이 한도에서 잘렸다. background · check · trap 은 짧게 줄이고, steps 는 끝까지 적는다."] : [])
      .concat(P.map(x => "- " + x)).join("\n");
    const again = await ask1("── 직전 답에서 원칙을 어긴 곳 — 이번엔 모두 고쳐서 처음부터 다시 적는다 ──\n" + why, cut ? 32000 : undefined);
    if (again.sol && score(again.sol) >= score(sol)){ sol = again.sol; out = again.out; }
  }
  const problems = probs(sol);

  return json({ ok: true, sol, model, depth, retried, problems,
                effort: b.effort || "low", stop: out.stop_reason || null,
                usage: out.usage || null }, 200, H);
}

/* 답에 적힌 소문항 수 — (1)(2)(3) 만 센다.
   ★ v297 — 예전엔 ①②③ 도 셌다. 그런데 ①②③ 은 «3가지 쓰시오» 같은 나열형 답의 «항목» 번호라,
     소문항이 하나뿐인 나열형이 «소문항 3개인데 단계가 (1)(2)(3) 을 안 다뤘다» 로 늘 걸려
     다시 받기(요금)만 되풀이하고 저장도 안 됐다. 소문항 표기는 (1)(2) 뿐이다. */
function subCount(ans){
  const t = String(ans || "");
  const a = new Set((t.match(/\(\s*(\d{1,2})\s*\)/g) || []).map(x => x.replace(/\D/g, "")));
  return a.size;
}
/* 모델이 배열 칸을 «JSON 글자» 로 적어 보낼 때 풀어 준다.
   수식 백슬래시(\dfrac · \times)나 줄바꿈 때문에 그냥은 안 읽히는 것을 손봐서 읽는다. */
function looseJson(x){
  const fixBs = y => y.replace(/\\\\|\\(?:(?=[A-Za-z]{2,})(?!u[0-9a-fA-F]{4})|(?!["\\/bfnrtu]))/g, m => m.length === 2 ? m : "\\\\");
  for (const y of [x, fixBs(x), fixBs(x).replace(/\r?\n/g, " "), fixBs(x).replace(/\r?\n/g, " ").replace(/,\s*([\]}])/g, "$1")]){
    try { return JSON.parse(y); } catch (e) {}
  }
  return undefined;
}
function fixSol(sol){
  if (!sol || typeof sol !== "object") return sol;
  const toArr = v => {
    if (Array.isArray(v)) return v.flatMap(e => (typeof e === "string" && /^\s*\{[\s\S]*\}\s*$/.test(e)) ? toArr(e) : [e]);
    if (typeof v !== "string") return v;
    const t = v.trim();
    if (/^\[[\s\S]*\]$/.test(t)){ const j = looseJson(t); if (Array.isArray(j)) return j; }
    if (/^\{[\s\S]*\}$/.test(t)){
      const j = looseJson(t); if (j && typeof j === "object") return Array.isArray(j) ? j : [j];
      const k = looseJson("[" + t + "]"); if (Array.isArray(k)) return k;
    }
    return v;
  };
  for (const k of ["steps", "symbols", "items", "given", "background", "keys", "tags", "mnemos"]) if (k in sol) sol[k] = toArr(sol[k]);
  if (typeof sol.mnemo === "string" && /^\s*\{/.test(sol.mnemo)){ const j = looseJson(sol.mnemo.trim()); if (j && typeof j === "object") sol.mnemo = j; }
  return sol;
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
  let img = null;
  try{ img = await imageBlock(b.url); }
  catch(e){ return json({ error: e.message, code: "IMG_FETCH", url: e.imgUrl || null }, 502, H); }
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

    /* v230 — 어느 나라 기지에서 도는지 본다.
       열쇠도 모델도 멀쩡한데 403 이 나면, 워커가 «Anthropic 이 막은 지역»
       기지(HKG 등)에서 돌고 있는 것이다. 그건 코드로는 못 고친다. */
    if (path === "/whereami"){
      const cf = req.cf || {};
      const colo = cf.colo || "?";
      const 막힌곳 = ["HKG"];
      return json({
        기지: colo,
        나라: cf.country || "?",
        판정: 막힌곳.includes(colo)
          ? `${colo} 기지는 Anthropic 이 막는 지역입니다 — 403 의 원인입니다.`
          : `${colo} 기지는 보통 허용됩니다.`,
        빌드: "v298"
      }, 200, H);
    }

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

      /* ★ v228 — 그림도 한 장 보내 본다.
           글자만 보내던 시절의 /selftest 는 «다 멀쩡함» 이라고 했다.
           정작 실패하는 해설·경계찾기는 «그림» 을 보내는데 그 길을 안 봤으니,
           키도 계정도 멀쩡한데 왜 403 인지 알 길이 없었다.
           1×1 점 하나를 실어 보내 그림 길이 열려 있는지 같이 본다. */
      const DOT = "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a"
        + "HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAA"
        + "AAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";
      let vision = null;
      try{
        const rv = await fetch(API, {
          method:"POST",
          headers:{ "content-type":"application/json",
                    "x-api-key": env.ANTHROPIC_API_KEY,
                    "anthropic-version": VER },
          body: JSON.stringify({ model: T.best, max_tokens: 16, messages:[{ role:"user", content:[
            { type:"image", source:{ type:"base64", media_type:"image/jpeg", data: DOT } },
            { type:"text", text:"한 글자만 답해." }
          ]}]})
        });
        const vb = await rv.text();
        let vp = null; try{ vp = JSON.parse(vb); }catch(e){}
        vision = { ok: rv.ok, status: rv.status, upstream: vp || vb.slice(0,400) };
      }catch(e){ vision = { ok:false, why:String(e.message || e) }; }

      return json({
        ok: r.ok && vision.ok, status: r.status, model: T.best,
        글자만: r.ok ? "통과" : `막힘 (${r.status})`,
        그림까지: vision.ok ? "통과" : `막힘 (${vision.status || "?"})`,
        판정: r.ok && !vision.ok
          ? "키·계정은 멀쩡한데 그림이 막혔습니다. 워커가 옛 판일 수 있습니다 — index.js 를 다시 붙여넣고 Deploy 하세요."
          : (!r.ok ? "키·계정 쪽 문제입니다." : "다 멀쩡합니다."),
        keyHead: String(env.ANTHROPIC_API_KEY).slice(0,14) + "…",
        keyLen: String(env.ANTHROPIC_API_KEY).length,
        keyTrimmed: String(env.ANTHROPIC_API_KEY) === String(env.ANTHROPIC_API_KEY).trim(),
        빌드: "v298",
        기지: (req.cf && req.cf.colo) || "?",
        upstream: parsed || body.slice(0,600),
        vision
      }, 200, H);
    }

    if (path === "/health" || path === "/")
      return json({ ok: true, provider: "anthropic", models: T, hasKey: !!env.ANTHROPIC_API_KEY, 기지: (req.cf && req.cf.colo) || "?", 빌드: "v298" }, 200, H);

    if (env.APP_KEY && req.headers.get("x-app-key") !== env.APP_KEY)
      return json({ error: "x-app-key 가 맞지 않습니다", detail: "x-app-key 가 맞지 않습니다" }, 401, H);

    if (path === "/ai/models") return models(env, H);

    /* 노션 저장은 Anthropic 키가 필요 없음 — 키 검사보다 앞에 둠 */
    if (path === "/notion"){
      if (req.method !== "POST")
        return json({ ok:false, error:"POST 만 받습니다" }, 405, H);
      try{ return await notionSave(req, env, H); }
      catch(e){ return json({ ok:false, error:String(e.message || e) }, 200, H); }
    }

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

    return json({ error: "없는 경로입니다", detail: "/get-data · /ai/models · /ai/chat · /explain · /split-hint · /notion · /selftest · /whereami · /health" }, 404, H);
  }
};
