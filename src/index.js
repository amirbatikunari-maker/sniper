/* ═══════════════════════════════════════════════════════════════════════
   sniper-ai — AI 중계 Worker

   블로그 화면(ai-chat.js)이 부르는 창구는 딱 두 개입니다.

     GET  /ai/models   어떤 모델을 쓸 수 있는지 알려 줍니다
     POST /ai/chat     질문을 받아 OpenAI·Gemini 에 넘기고, 답을 조금씩 흘려보냅니다

   API 키는 브라우저에 절대 내려가지 않습니다. 이 Worker 안에서만 씁니다.

   ── 배포 ─────────────────────────────────────────────────────────────
     npx wrangler secret put OPENAI_API_KEY
     npx wrangler secret put GEMINI_API_KEY
     npx wrangler secret put APP_KEY          ← 선택
     npx wrangler deploy
   ═══════════════════════════════════════════════════════════════════════ */

/* 쓸 수 있는 모델 목록. 새 모델이 나오면 여기만 고치면 화면이 따라옵니다. */
const CATALOG = {
  openai: [
    { id: "gpt-4.1",       label: "GPT-4.1 · 무난" },
    { id: "gpt-4.1-mini",  label: "GPT-4.1 mini · 빠름" },
    { id: "gpt-4o",        label: "GPT-4o · 사진 잘 봄" },
    { id: "o4-mini",       label: "o4-mini · 따져 묻기" },
  ],
  gemini: [
    { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash · 빠름" },
    { id: "gemini-2.5-pro",   label: "Gemini 2.5 Pro · 꼼꼼" },
  ],
};
const DEFAULTS = { openai: "gpt-4.1-mini", gemini: "gemini-2.5-flash" };

/* ═══════════════ 문 앞 검사 ═══════════════ */

function originOf(req) {
  return req.headers.get("Origin") || "";
}

function corsHeaders(req, env) {
  const list = String(env.ALLOWED_ORIGINS || "")
    .split(",").map(s => s.trim()).filter(Boolean);
  const o = originOf(req);

  // 목록이 비어 있으면 전부 허용(개발용). 채워져 있으면 그 안에 있어야 합니다.
  const allow = !list.length ? (o || "*") : (list.includes(o) ? o : "");

  const h = {
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-app-key, Authorization",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
  if (allow) h["Access-Control-Allow-Origin"] = allow;
  return h;
}

function jsonRes(obj, status, req, env) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...corsHeaders(req, env),
    },
  });
}

/* 암구호(APP_KEY) 를 넣어 뒀다면 맞는지 봅니다. */
function appKeyOk(req, env) {
  if (!env.APP_KEY) return true;
  return req.headers.get("x-app-key") === env.APP_KEY;
}

/* 로그인한 사람만 쓰게 해 둔 경우, Supabase 에 토큰을 직접 물어봅니다.
   브라우저 쪽을 아무리 조작해도 여기서 걸립니다. */
async function whoIs(req, env) {
  if (String(env.REQUIRE_AUTH || "") !== "1") return { ok: true, email: null };

  const auth = req.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return { ok: false, why: "로그인이 필요합니다." };
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY)
    return { ok: false, why: "Worker 에 SUPABASE_URL / SUPABASE_ANON_KEY 가 없습니다." };

  let user;
  try {
    const r = await fetch(env.SUPABASE_URL.replace(/\/+$/, "") + "/auth/v1/user", {
      headers: { Authorization: "Bearer " + token, apikey: env.SUPABASE_ANON_KEY },
    });
    if (!r.ok) return { ok: false, why: "로그인이 만료됐습니다. 다시 로그인해 주세요." };
    user = await r.json();
  } catch {
    return { ok: false, why: "로그인 확인에 실패했습니다." };
  }

  const email = (user?.email || "").toLowerCase();
  const allowed = String(env.ALLOWED_EMAILS || "")
    .split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
  if (allowed.length && !allowed.includes(email))
    return { ok: false, why: "이 계정은 AI 를 쓸 수 없습니다." };

  return { ok: true, email };
}

/* ═══════════════ 주고받는 형식 맞추기 ═══════════════ */

/* 화면이 보내는 messages 를 OpenAI 형식으로.
   files 는 [{mime, data(base64), name}] 형태로 옵니다. */
function toOpenAI(messages, system) {
  const out = [];
  if (system) out.push({ role: "system", content: system });

  for (const m of messages || []) {
    const files = m.files || [];
    if (!files.length) {
      out.push({ role: m.role, content: m.content || "" });
      continue;
    }
    const parts = [];
    if (m.content) parts.push({ type: "text", text: m.content });
    for (const f of files) {
      if (/^image\//.test(f.mime || "")) {
        parts.push({ type: "image_url", image_url: { url: `data:${f.mime};base64,${f.data}` } });
      } else {
        // PDF 등은 file 형태로 (지원 안 되면 이름만이라도 알려 준다)
        parts.push({ type: "text", text: `[붙임 파일: ${f.name || "이름 없음"} (${f.mime})]` });
      }
    }
    out.push({ role: m.role, content: parts });
  }
  return out;
}

/* Gemini 형식으로. Gemini 는 assistant 를 model 이라고 부릅니다. */
function toGemini(messages) {
  return (messages || []).map(m => {
    const parts = [];
    if (m.content) parts.push({ text: m.content });
    for (const f of m.files || []) {
      if (f.data) parts.push({ inline_data: { mime_type: f.mime, data: f.data } });
    }
    return { role: m.role === "assistant" ? "model" : "user", parts: parts.length ? parts : [{ text: "" }] };
  });
}

/* 화면은 «data: {"delta":"..."}» 줄만 이해합니다. 거기에 맞춰 흘려보냅니다. */
function sseLine(obj) {
  return new TextEncoder().encode("data: " + JSON.stringify(obj) + "\n\n");
}
const SSE_DONE = new TextEncoder().encode("data: [DONE]\n\n");

function sseHeaders(req, env) {
  return {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
    ...corsHeaders(req, env),
  };
}

/* ═══════════════ OpenAI ═══════════════ */

async function streamOpenAI({ model, system, messages }, env, req) {
  if (!env.OPENAI_API_KEY) throw new Error("Worker 에 OPENAI_API_KEY 가 없습니다.");

  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + env.OPENAI_API_KEY,
    },
    body: JSON.stringify({
      model,
      messages: toOpenAI(messages, system),
      stream: true,
    }),
  });

  if (!r.ok || !r.body) {
    let why = `OpenAI 가 ${r.status} 로 답했습니다.`;
    try { why = (await r.json())?.error?.message || why; } catch {}
    throw new Error(why);
  }

  const { readable, writable } = new TransformStream();
  const w = writable.getWriter();

  (async () => {
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });

        let cut;
        while ((cut = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, cut).trim();
          buf = buf.slice(cut + 1);
          if (!line.startsWith("data:")) continue;
          const raw = line.slice(5).trim();
          if (!raw || raw === "[DONE]") continue;
          try {
            const o = JSON.parse(raw);
            const d = o?.choices?.[0]?.delta?.content;
            if (d) await w.write(sseLine({ delta: d }));
          } catch {}
        }
      }
      await w.write(SSE_DONE);
    } catch (e) {
      try { await w.write(sseLine({ error: String(e.message || e) })); } catch {}
    } finally {
      try { await w.close(); } catch {}
    }
  })();

  return new Response(readable, { headers: sseHeaders(req, env) });
}

/* ═══════════════ Gemini ═══════════════ */

async function streamGemini({ model, system, messages }, env, req) {
  if (!env.GEMINI_API_KEY) throw new Error("Worker 에 GEMINI_API_KEY 가 없습니다.");

  const url = "https://generativelanguage.googleapis.com/v1beta/models/"
    + encodeURIComponent(model) + ":streamGenerateContent?alt=sse&key="
    + encodeURIComponent(env.GEMINI_API_KEY);

  const body = { contents: toGemini(messages) };
  if (system) body.systemInstruction = { parts: [{ text: system }] };

  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!r.ok || !r.body) {
    let why = `Gemini 가 ${r.status} 로 답했습니다.`;
    try { why = (await r.json())?.error?.message || why; } catch {}
    throw new Error(why);
  }

  const { readable, writable } = new TransformStream();
  const w = writable.getWriter();

  (async () => {
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });

        let cut;
        while ((cut = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, cut).trim();
          buf = buf.slice(cut + 1);
          if (!line.startsWith("data:")) continue;
          const raw = line.slice(5).trim();
          if (!raw) continue;
          try {
            const o = JSON.parse(raw);
            const parts = o?.candidates?.[0]?.content?.parts || [];
            for (const p of parts) if (p.text) await w.write(sseLine({ delta: p.text }));
          } catch {}
        }
      }
      await w.write(SSE_DONE);
    } catch (e) {
      try { await w.write(sseLine({ error: String(e.message || e) })); } catch {}
    } finally {
      try { await w.close(); } catch {}
    }
  })();

  return new Response(readable, { headers: sseHeaders(req, env) });
}

/* ═══════════════ 들어오는 문 ═══════════════ */

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (req.method === "OPTIONS")
      return new Response(null, { status: 204, headers: corsHeaders(req, env) });

    // 살아 있는지 확인용
    if (path === "/" || path === "/ai" || path === "/ai/health")
      return jsonRes({
        ok: true,
        service: "sniper-ai",
        endpoints: ["/ai/models", "/ai/chat"],
        openai: !!env.OPENAI_API_KEY,
        gemini: !!env.GEMINI_API_KEY,
        requireAuth: String(env.REQUIRE_AUTH || "") === "1",
      }, 200, req, env);

    if (!appKeyOk(req, env))
      return jsonRes({ error: "암구호(x-app-key)가 맞지 않습니다." }, 401, req, env);

    /* ── 모델 목록 ── */
    if (path === "/ai/models" && req.method === "GET") {
      const catalog = {
        openai: env.OPENAI_API_KEY ? CATALOG.openai : [],
        gemini: env.GEMINI_API_KEY ? CATALOG.gemini : [],
      };
      if (!catalog.openai.length && !catalog.gemini.length)
        return jsonRes({ error: "Worker 에 OPENAI_API_KEY / GEMINI_API_KEY 가 하나도 없습니다." }, 500, req, env);
      return jsonRes({ catalog, defaults: DEFAULTS }, 200, req, env);
    }

    /* ── 대화 ── */
    if (path === "/ai/chat" && req.method === "POST") {
      const gate = await whoIs(req, env);
      if (!gate.ok) return jsonRes({ error: gate.why }, 401, req, env);

      let body;
      try { body = await req.json(); }
      catch { return jsonRes({ error: "요청 형식이 올바르지 않습니다." }, 400, req, env); }

      const provider = body.provider === "gemini" ? "gemini" : "openai";
      const known = CATALOG[provider].map(m => m.id);
      const model = known.includes(body.model) ? body.model : DEFAULTS[provider];

      if (!Array.isArray(body.messages) || !body.messages.length)
        return jsonRes({ error: "보낼 내용이 없습니다." }, 400, req, env);

      const args = { model, system: body.system || "", messages: body.messages };
      try {
        return provider === "gemini"
          ? await streamGemini(args, env, req)
          : await streamOpenAI(args, env, req);
      } catch (e) {
        return jsonRes({ error: String(e.message || e) }, 502, req, env);
      }
    }

    return jsonRes({ error: "그런 창구는 없습니다: " + path }, 404, req, env);
  },
};
