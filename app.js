/* ═══════════════════════════════════════════════════════════════════════
   app.js — sniper 의 뼈대
   세 화면(목록·글보기·글쓰기)이 함께 쓰는 것들만 모아 둔 파일입니다.
     · Supabase 연결과 로그인
     · 테마 · 배경 설정 (읽기/저장/적용)
     · 블록 → HTML 그리기
     · 자잘한 도우미
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
"use strict";

const CFG = window.APP_CONFIG || {};

/* ═══════════════ Supabase ═══════════════ */

const sb = (window.supabase && CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY)
  ? window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true },
    })
  : null;

let ME = null;                                   // 지금 로그인한 사람

async function refreshMe() {
  if (!sb) return null;
  try {
    const { data } = await sb.auth.getSession();
    ME = data?.session?.user || null;
  } catch { ME = null; }
  document.documentElement.dataset.admin = canEdit() ? "1" : "0";
  return ME;
}

function canEdit() {
  if (!ME) return false;
  const list = CFG.ADMIN_EMAILS || [];
  if (!list.length) return true;                 // 목록을 안 정했으면 로그인만으로 통과
  return list.map(s => s.toLowerCase()).includes((ME.email || "").toLowerCase());
}

async function signIn(email, password) {
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
  await refreshMe();
}

async function signOut() { await sb?.auth.signOut(); await refreshMe(); }

/* ═══════════════ 도우미 ═══════════════ */

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* 링크 주소가 진짜 http(s) 인지 본다 — javascript: 같은 걸 막는다 */
function safeUrl(u) {
  try {
    const x = new URL(u, location.href);
    return /^https?:$/.test(x.protocol) ? x.href : "#";
  } catch { return "#"; }
}

function fmtDate(v) {
  if (!v) return "";
  const d = new Date(v), now = new Date();
  const day = 86400000, gap = (now - d) / day;
  if (gap < 1 && d.getDate() === now.getDate()) return "오늘 " + d.toTimeString().slice(0, 5);
  if (gap < 2) return "어제";
  if (d.getFullYear() === now.getFullYear())
    return `${d.getMonth() + 1}월 ${d.getDate()}일`;
  return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`;
}

/* 제목 → 주소에 쓸 이름. 한글은 그대로 두고 공백만 정리한다. */
function slugify(s) {
  return String(s || "").trim().toLowerCase()
    .replace(/[\s/\\?#&=+%]+/g, "-")
    .replace(/[^\p{L}\p{N}\-_]/gu, "")
    .replace(/-{2,}/g, "-").replace(/^-|-$/g, "")
    .slice(0, 60) || "글-" + Date.now().toString(36);
}

function toast(msg, kind = "ok") {
  let t = $("#toast");
  if (!t) {
    t = document.createElement("div");
    t.id = "toast";
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.dataset.kind = kind;
  t.classList.add("on");
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove("on"), kind === "err" ? 4800 : 2200);
}

const qs = (k) => new URLSearchParams(location.search).get(k);

/* ═══════════════ 화면 설정(테마·배경) ═══════════════ */

const DEFAULT_SETTINGS = {
  title: CFG.SITE_TITLE || "sniper",
  tagline: "쓰고 모으고 물어보는 곳",
  theme: "auto",          // auto | light | dark
  accent: "#1D4ED8",
  bg_kind: "plain",       // plain | gradient | image | pattern
  bg_value: "",
  bg_blur: 0,
  bg_dim: 0,
  font: "pretendard",     // pretendard | serif | mono
  width: "narrow",        // narrow | wide
};

const GRADIENTS = {
  "새벽":   "linear-gradient(160deg,#dbeafe 0%,#ede9fe 48%,#fce7f3 100%)",
  "종이":   "linear-gradient(180deg,#f7f5f0 0%,#eceae3 100%)",
  "숲":     "linear-gradient(160deg,#dcfce7 0%,#d1fae5 50%,#e0f2fe 100%)",
  "노을":   "linear-gradient(160deg,#fee2e2 0%,#fed7aa 50%,#fef3c7 100%)",
  "밤바다": "linear-gradient(160deg,#0f172a 0%,#12263f 55%,#0b1a2e 100%)",
  "먹지":   "linear-gradient(180deg,#111827 0%,#1f2937 100%)",
};

const PATTERNS = {
  "모눈":   `repeating-linear-gradient(0deg,var(--rule) 0 1px,transparent 1px 24px),
             repeating-linear-gradient(90deg,var(--rule) 0 1px,transparent 1px 24px)`,
  "점":     `radial-gradient(var(--rule) 1px, transparent 1px)`,
  "줄노트": `repeating-linear-gradient(0deg,transparent 0 27px,var(--rule) 27px 28px)`,
};

let SETTINGS = { ...DEFAULT_SETTINGS };

function localSettings() {
  try { return JSON.parse(localStorage.getItem("blog:settings") || "null"); } catch { return null; }
}

async function loadSettings() {
  const cached = localSettings();
  if (cached) { SETTINGS = { ...DEFAULT_SETTINGS, ...cached }; applySettings(); }

  if (!sb) { applySettings(); return SETTINGS; }
  try {
    const { data } = await sb.from("blog_settings").select("value").eq("key", "site").single();
    if (data?.value) {
      SETTINGS = { ...DEFAULT_SETTINGS, ...data.value, ...(cached?.__local ? cached : {}) };
      try { localStorage.setItem("blog:settings", JSON.stringify(SETTINGS)); } catch {}
    }
  } catch {}
  applySettings();
  return SETTINGS;
}

async function saveSettings(patch) {
  SETTINGS = { ...SETTINGS, ...patch };
  applySettings();
  try { localStorage.setItem("blog:settings", JSON.stringify(SETTINGS)); } catch {}
  if (!sb || !canEdit()) return;
  const { error } = await sb.from("blog_settings")
    .upsert({ key: "site", value: SETTINGS, updated_at: new Date().toISOString() });
  if (error) toast("설정을 서버에 못 옮겼습니다: " + error.message, "err");
}

function prefersDark() {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches;
}

function applySettings() {
  const s = SETTINGS, root = document.documentElement;

  const dark = s.theme === "dark" || (s.theme === "auto" && prefersDark());
  root.dataset.theme = dark ? "dark" : "light";
  root.dataset.font  = s.font  || "pretendard";
  root.dataset.width = s.width || "narrow";
  root.style.setProperty("--accent", s.accent || "#1D4ED8");

  // 배경은 본문 뒤에 깔린 한 겹(.bgLayer)에만 그린다 — 글자가 흐려지지 않게.
  let layer = $("#bgLayer");
  if (!layer) {
    layer = document.createElement("div");
    layer.id = "bgLayer";
    document.body.prepend(layer);
  }

  let img = "", size = "auto", color = "";
  if (s.bg_kind === "gradient") img = GRADIENTS[s.bg_value] || s.bg_value || "";
  else if (s.bg_kind === "image" && s.bg_value) img = `url("${safeUrl(s.bg_value)}")`;
  else if (s.bg_kind === "pattern") {
    img = PATTERNS[s.bg_value] || "";
    size = s.bg_value === "점" ? "22px 22px" : "auto";
  }

  layer.style.backgroundImage = img;
  layer.style.backgroundSize = s.bg_kind === "image" ? "cover" : size;
  layer.style.backgroundPosition = "center";
  layer.style.backgroundAttachment = s.bg_kind === "image" ? "fixed" : "scroll";
  layer.style.filter = s.bg_blur ? `blur(${s.bg_blur}px)` : "";
  layer.style.opacity = String(1 - (s.bg_dim || 0) / 100);
  if (color) layer.style.backgroundColor = color;

  const t = $("#siteTitle");   if (t) t.textContent = s.title || "sniper";
  const g = $("#siteTagline"); if (g) g.textContent = s.tagline || "";
  document.title = (document.body.dataset.page === "post" && document.title !== "sniper")
    ? document.title : (s.title || "sniper");
}

window.matchMedia?.("(prefers-color-scheme: dark)")
  .addEventListener?.("change", () => { if (SETTINGS.theme === "auto") applySettings(); });

/* ═══════════════ 블록 → HTML ═══════════════
   에디터는 글을 «블록 목록» 으로 저장합니다. 읽기 화면에서는 그걸 다시 그려야 합니다.
   여기서 만든 HTML 은 저장할 때 body_html 로도 함께 넣어 두므로,
   나중에 에디터를 바꿔도 예전 글이 그대로 보입니다. */

function inlineHtml(s) {
  // 에디터가 넣어 주는 꾸밈표(b/i/u/mark/code/a)만 남기고 나머지는 글자로 만든다
  const allow = /<\/?(b|strong|i|em|u|s|mark|code|br)>/gi;
  let out = esc(s || "");
  out = out.replace(/&lt;(\/?(?:b|strong|i|em|u|s|mark|code|br))&gt;/gi, "<$1>");
  out = out.replace(/&lt;a\s+href=&quot;([^&"]+)&quot;[^&]*&gt;/gi,
    (_, u) => `<a href="${safeUrl(u.replace(/&amp;/g, "&"))}" target="_blank" rel="noopener">`);
  out = out.replace(/&lt;\/a&gt;/gi, "</a>");
  void allow;
  return out;
}

function blocksToHtml(data) {
  const blocks = data?.blocks || [];
  const out = [];

  for (const b of blocks) {
    const d = b.data || {};
    switch (b.type) {
      case "header": {
        const lv = Math.min(Math.max(+d.level || 2, 2), 4);
        out.push(`<h${lv} id="h-${b.id || Math.random().toString(36).slice(2, 7)}">${inlineHtml(d.text)}</h${lv}>`);
        break;
      }
      case "paragraph":
        if ((d.text || "").trim()) out.push(`<p>${inlineHtml(d.text)}</p>`);
        break;
      case "list": {
        const tag = d.style === "ordered" ? "ol" : "ul";
        const li = (items) => (items || []).map(it => {
          const txt = typeof it === "string" ? it : it.content;
          const kids = (typeof it === "object" && it.items?.length)
            ? `<${tag}>${li(it.items)}</${tag}>` : "";
          return `<li>${inlineHtml(txt)}${kids}</li>`;
        }).join("");
        out.push(`<${tag}>${li(d.items)}</${tag}>`);
        break;
      }
      case "checklist":
        out.push(`<ul class="checklist">` + (d.items || []).map(it =>
          `<li class="${it.checked ? "done" : ""}"><span class="box">${it.checked ? "✔" : ""}</span>${inlineHtml(it.text)}</li>`
        ).join("") + `</ul>`);
        break;
      case "quote":
        out.push(`<blockquote>${inlineHtml(d.text)}${d.caption ? `<cite>${inlineHtml(d.caption)}</cite>` : ""}</blockquote>`);
        break;
      case "code":
        out.push(`<pre><code>${esc(d.code)}</code></pre>`);
        break;
      case "delimiter":
        out.push(`<hr>`);
        break;
      case "image": {
        const u = d.file?.url || d.url;
        if (!u) break;
        out.push(`<figure class="fig${d.stretched ? " wide" : ""}">
          <img src="${esc(safeUrl(u))}" alt="${esc(d.caption || "")}" loading="lazy" decoding="async">
          ${d.caption ? `<figcaption>${inlineHtml(d.caption)}</figcaption>` : ""}
        </figure>`);
        break;
      }
      case "table": {
        const rows = d.content || [];
        if (!rows.length) break;
        const head = d.withHeadings ? rows[0] : null;
        const body = d.withHeadings ? rows.slice(1) : rows;
        out.push(`<div class="tblwrap"><table>` +
          (head ? `<thead><tr>${head.map(c => `<th>${inlineHtml(c)}</th>`).join("")}</tr></thead>` : "") +
          `<tbody>${body.map(r => `<tr>${r.map(c => `<td>${inlineHtml(c)}</td>`).join("")}</tr>`).join("")}</tbody>` +
          `</table></div>`);
        break;
      }
      case "warning":
        out.push(`<div class="callout"><b>${inlineHtml(d.title)}</b><div>${inlineHtml(d.message)}</div></div>`);
        break;
      case "raw":
        out.push(`<pre><code>${esc(d.html)}</code></pre>`);
        break;
      default:
        if (d.text) out.push(`<p>${inlineHtml(d.text)}</p>`);
    }
  }
  return out.join("\n");
}

/* 검색·미리보기에 쓸 맨글자 */
function blocksToText(data) {
  const tmp = document.createElement("div");
  tmp.innerHTML = blocksToHtml(data);
  return tmp.textContent.replace(/\s+/g, " ").trim();
}

/* ═══════════════ 그림 올리기 ═══════════════ */

async function shrink(file, max = 1800, quality = .85) {
  if (!/^image\//.test(file.type) || /gif|svg/.test(file.type)) return file;
  try {
    const bmp = await createImageBitmap(file);
    if (Math.max(bmp.width, bmp.height) <= max && file.size < 700 * 1024) return file;
    const s = max / Math.max(bmp.width, bmp.height);
    const w = Math.round(bmp.width * Math.min(s, 1)), h = Math.round(bmp.height * Math.min(s, 1));
    const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
    cv.getContext("2d").drawImage(bmp, 0, 0, w, h);
    const blob = await new Promise(r => cv.toBlob(r, "image/jpeg", quality));
    return blob || file;
  } catch { return file; }
}

async function uploadImage(file, folder = "posts") {
  if (!sb) throw new Error("Supabase 연결이 없습니다.");
  const small = await shrink(file);
  const ext = (small.type.split("/")[1] || "jpg").replace("jpeg", "jpg");
  const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await sb.storage.from("blog").upload(path, small, {
    contentType: small.type, upsert: false, cacheControl: "31536000",
  });
  if (error) throw new Error(error.message);
  return { url: sb.storage.from("blog").getPublicUrl(path).data.publicUrl, path };
}

/* ═══════════════ 로그인 상자 ═══════════════ */

function loginBox() {
  if ($("#loginOv")) return;
  const ov = document.createElement("div");
  ov.id = "loginOv";
  ov.className = "ov";
  ov.innerHTML = `
    <div class="ovbox">
      <h3>${ME ? "로그인됨" : "로그인"}</h3>
      ${ME ? `
        <p class="muted">${esc(ME.email || "")}${canEdit() ? "" : " · 글쓰기 권한이 없는 계정입니다"}</p>
        <div class="row"><button class="btn" id="lgOut">로그아웃</button>
        <button class="btn ghost" id="lgClose">닫기</button></div>
      ` : `
        <input id="lgEm" type="email" placeholder="이메일" autocomplete="username">
        <input id="lgPw" type="password" placeholder="비밀번호" autocomplete="current-password">
        <div class="row"><button class="btn" id="lgIn">들어가기</button>
        <button class="btn ghost" id="lgClose">닫기</button></div>
        <p class="muted sm">Supabase → Authentication → Users 에 만든 계정으로 들어옵니다.</p>
      `}
      <p class="err" id="lgErr" hidden></p>
    </div>`;
  document.body.appendChild(ov);

  const close = () => ov.remove();
  ov.onclick = e => { if (e.target === ov) close(); };
  $("#lgClose", ov).onclick = close;
  $("#lgOut", ov)?.addEventListener("click", async () => { await signOut(); close(); location.reload(); });

  $("#lgIn", ov)?.addEventListener("click", async () => {
    const err = $("#lgErr", ov);
    err.hidden = true;
    try {
      await signIn($("#lgEm", ov).value.trim(), $("#lgPw", ov).value);
      close(); location.reload();
    } catch (e) { err.hidden = false; err.textContent = e.message; }
  });
  $("#lgPw", ov)?.addEventListener("keydown", e => { if (e.key === "Enter") $("#lgIn", ov).click(); });
}

/* ═══════════════ 바깥으로 내보내기 ═══════════════ */

/* ═══════════════ 오프라인 대비 ═══════════════
   글쓰기 화면은 캐시가 끼어들면 헷갈리므로 목록·글보기에서만 켠다. */
if ("serviceWorker" in navigator && document.body?.dataset.page !== "write" &&
    location.protocol.startsWith("http"))
  window.addEventListener("load", () =>
    navigator.serviceWorker.register("./sw.js").catch(() => {}));

window.App = {
  sb, CFG,
  get me() { return ME; },
  get settings() { return SETTINGS; },
  GRADIENTS, PATTERNS, DEFAULT_SETTINGS,
  refreshMe, canEdit, signIn, signOut, loginBox,
  loadSettings, saveSettings, applySettings,
  blocksToHtml, blocksToText, inlineHtml,
  uploadImage, shrink,
  $, $$, esc, safeUrl, fmtDate, slugify, toast, qs,
};
})();
