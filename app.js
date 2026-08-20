/* ═══════════════════════════════════════════════════════════════════════
   app.js — sniper 의 뼈대 (v3)
   세 화면(목록·글보기·글쓰기)이 함께 쓰는 것들
     · Supabase 연결과 로그인
     · 테마 · 배경 설정
     · 블록 → HTML  (수식 · 파일 · 동영상 · 정렬 포함)
     · 글 지우기 · 카테고리 다루기
     · KaTeX 불러오기
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

let ME = null;

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
  if (!list.length) return true;
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
    return `${d.getMonth() + 1}.${d.getDate()}`;
  return `${String(d.getFullYear()).slice(2)}.${d.getMonth() + 1}.${d.getDate()}`;
}

function fmtSize(n) {
  n = +n || 0;
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + " KB";
  return (n / 1048576).toFixed(1) + " MB";
}

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

/* 확인 창 — confirm 보다 눈에 띄고, 위험한 것은 빨갛게 */
function ask(title, body, okLabel = "확인", danger = false) {
  return new Promise(resolve => {
    const ov = document.createElement("div");
    ov.className = "ov";
    ov.innerHTML = `<div class="ovbox" style="max-width:400px">
      <h3>${esc(title)}</h3>
      ${body ? `<p class="muted">${body}</p>` : ""}
      <div class="row" style="justify-content:flex-end;margin-top:16px">
        <button class="btn ghost" data-no>그만두기</button>
        <button class="btn${danger ? " danger" : ""}" data-yes>${esc(okLabel)}</button>
      </div></div>`;
    document.body.appendChild(ov);
    const end = v => { ov.remove(); resolve(v); };
    ov.onclick = e => { if (e.target === ov) end(false); };
    $("[data-no]", ov).onclick = () => end(false);
    $("[data-yes]", ov).onclick = () => end(true);
    $("[data-yes]", ov).focus();
  });
}

/* ═══════════════ 화면 설정(테마·배경) ═══════════════ */

const DEFAULT_SETTINGS = {
  title: CFG.SITE_TITLE || "sniper",
  tagline: "쓰고 모으고 물어보는 곳",
  theme: "auto",
  accent: "#1D4ED8",
  bg_kind: "plain",
  bg_value: "",
  bg_blur: 0,
  bg_dim: 0,
  font: "pretendard",
  width: "narrow",
  view: "rows",           // rows | cards
  sort: "new",            // new | old | views | title

  // 왼쪽 위 프로필
  avatar_url: "",
  owner_name: "",
  owner_bio: "",
  owner_links: [],        // [{label, url}]

  // 맨 아래 만든이 줄
  footer_on: true,
  footer_text: "",

  // AI 창을 오른쪽에 붙박이로 둘지
  ai_dock: false,
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

/* ═══════════════ 강조색 — 대비를 재서 글자색을 정합니다 ═══════════════ */

function toRgb(hex) {
  let h = String(hex || "").trim().replace("#", "");
  if (h.length === 3) h = h.split("").map(c => c + c).join("");
  if (!/^[0-9a-f]{6}$/i.test(h)) h = "1D4ED8";
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
}

function toHex(rgb) {
  return "#" + rgb.map(v =>
    Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
}

/* 사람 눈이 느끼는 밝기 (0 = 검정, 1 = 흰색) */
function luma(hex) {
  const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); };
  const [r, g, b] = toRgb(hex).map(f);
  return .2126 * r + .7152 * g + .0722 * b;
}

function blend(a, b, amt) {
  const A = toRgb(a), B = toRgb(b);
  return toHex(A.map((v, i) => v + (B[i] - v) * amt));
}

/* 두 색의 명암비 (1 = 똑같음, 21 = 검정 대 흰색). 4.5 넘으면 읽을 만합니다. */
function contrast(a, b) {
  const x = luma(a), y = luma(b);
  return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
}

/* fg 를 bg 위에서 읽힐 때까지 조금씩 끌어당깁니다.
   임계값을 미리 정해 두는 대신 실제로 재면서 맞추므로 어떤 색이든 통합니다. */
function readable(fg, bg, dark, need = 4.6) {
  const pull = dark ? "#FFFFFF" : "#000000";
  let c = fg;
  for (let i = 0; i < 18 && contrast(c, bg) < need; i++) c = blend(c, pull, .11);
  return c;
}

function applyAccent(hex, dark) {
  const root = document.documentElement;
  root.style.setProperty("--accent", hex);

  const ink0 = "#0B1220";
  root.style.setProperty("--on-accent",
    contrast("#FFFFFF", hex) >= contrast(ink0, hex) ? "#FFFFFF" : ink0);

  const soft = dark ? blend(hex, "#141A22", .87) : blend(hex, "#FFFFFF", .90);
  root.style.setProperty("--accent-soft", soft);
  root.style.setProperty("--accent-ink", readable(hex, soft, dark));

  const m = document.querySelector('meta[name="theme-color"]');
  if (m) m.content = dark ? "#0C1016" : "#F4F5F7";
}

function applySettings() {
  const s = SETTINGS, root = document.documentElement;

  const dark = s.theme === "dark" || (s.theme === "auto" && prefersDark());
  root.dataset.theme = dark ? "dark" : "light";
  root.dataset.font  = s.font  || "pretendard";
  root.dataset.width = s.width || "narrow";
  applyAccent(s.accent || "#1D4ED8", dark);

  let layer = $("#bgLayer");
  if (!layer) {
    layer = document.createElement("div");
    layer.id = "bgLayer";
    document.body.prepend(layer);
  }

  let img = "", size = "auto";
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

  $$("#siteTitle").forEach(t => t.textContent = s.title || "sniper");
  $$("#siteTagline").forEach(g => g.textContent = s.tagline || "");
  try { drawProfile(); drawMadeBy(); } catch {}
  document.title = (document.body.dataset.page === "post" && document.title !== "sniper")
    ? document.title : (s.title || "sniper");
}

window.matchMedia?.("(prefers-color-scheme: dark)")
  .addEventListener?.("change", () => { if (SETTINGS.theme === "auto") applySettings(); });

/* ═══════════════ 카테고리 나무 ═══════════════
   parent_id 로 이어진 목록을 «부모 → 자식» 순서로 펴 줍니다.
   depth 가 붙어 나오므로 화면에서는 들여쓰기만 하면 됩니다. */
function catTree(list) {
  const rows = [...(list || [])];
  const kids = new Map();
  for (const c of rows) {
    const k = c.parent_id == null ? "root" : String(c.parent_id);
    if (!kids.has(k)) kids.set(k, []);
    kids.get(k).push(c);
  }
  const ord = a => (a || []).sort((x, y) =>
    (x.sort_order ?? 0) - (y.sort_order ?? 0) || (x.name || "").localeCompare(y.name || "", "ko"));

  const out = [];
  const walk = (key, depth) => {
    for (const c of ord(kids.get(key) || [])) {
      if (depth > 3) continue;
      out.push({ ...c, depth });
      walk(String(c.id), depth + 1);
    }
  };
  walk("root", 0);

  // 부모가 사라진 고아는 맨 뒤에 붙여 잃어버리지 않게 합니다
  const seen = new Set(out.map(c => String(c.id)));
  for (const c of rows) if (!seen.has(String(c.id))) out.push({ ...c, depth: 0 });
  return out;
}

/* 어떤 카테고리와 그 아래 모든 자식의 id */
function catBranch(list, id) {
  const out = [String(id)];
  for (const k of (list || []).filter(c => String(c.parent_id) === String(id)))
    out.push(...catBranch(list, k.id));
  return out;
}

/* ═══════════════ KaTeX (수식) ═══════════════ */

let katexLoading = null;
function loadKatex() {
  if (window.katex) return Promise.resolve(window.katex);
  if (katexLoading) return katexLoading;
  katexLoading = new Promise((res, rej) => {
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css";
    document.head.appendChild(css);
    const js = document.createElement("script");
    js.src = "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js";
    js.onload = () => res(window.katex);
    js.onerror = () => rej(new Error("수식 도구를 못 불렀습니다"));
    document.head.appendChild(js);
  });
  return katexLoading;
}

/* 화면 안의 .math[data-tex] 를 실제 수식으로 바꿔 그린다 */
async function renderMath(root = document) {
  const nodes = $$("[data-tex]:not([data-tex-done])", root);
  if (!nodes.length) return;
  let K;
  try { K = await loadKatex(); } catch { return; }
  for (const n of nodes) {
    try {
      K.render(n.dataset.tex, n, {
        displayMode: n.dataset.display === "1",
        throwOnError: false,
        errorColor: "#B91C1C",
      });
      n.dataset.texDone = "1";
    } catch {
      n.textContent = n.dataset.tex;
      n.dataset.texDone = "1";
    }
  }
}

/* ═══════════════ 블록 → HTML ═══════════════ */

function inlineHtml(s) {
  let out = esc(s || "");
  out = out.replace(/&lt;(\/?(?:b|strong|i|em|u|s|mark|code|br))&gt;/gi, "<$1>");
  out = out.replace(/&lt;a\s+href=&quot;([^&"]+)&quot;[^&]*&gt;/gi,
    (_, u) => `<a href="${safeUrl(u.replace(/&amp;/g, "&"))}" target="_blank" rel="noopener">`);
  out = out.replace(/&lt;\/a&gt;/gi, "</a>");
  // 본문 안 $…$ 수식
  out = out.replace(/\$([^$\n]{1,300})\$/g,
    (_, tex) => `<span class="math-i" data-tex="${esc(tex)}">${esc(tex)}</span>`);
  return out;
}

function alignOf(b) {
  const a = b?.tunes?.alignment?.alignment || b?.tunes?.anyTuneName?.alignment;
  return (a && a !== "left") ? ` data-align="${esc(a)}"` : "";
}

/* 동영상 주소 → 심어 넣을 주소 */
function embedSrc(url) {
  try {
    const u = new URL(url);
    const h = u.hostname.replace(/^www\./, "");
    if (h === "youtu.be") return "https://www.youtube.com/embed/" + u.pathname.slice(1);
    if (h.endsWith("youtube.com")) {
      const v = u.searchParams.get("v");
      if (v) return "https://www.youtube.com/embed/" + v;
      if (u.pathname.startsWith("/shorts/")) return "https://www.youtube.com/embed/" + u.pathname.split("/")[2];
      if (u.pathname.startsWith("/embed/")) return u.href;
    }
    if (h.endsWith("vimeo.com")) return "https://player.vimeo.com/video/" + u.pathname.split("/").filter(Boolean).pop();
    if (h.endsWith("naver.com") && u.pathname.includes("/embed/")) return u.href;
    return "";
  } catch { return ""; }
}

function blocksToHtml(data) {
  const blocks = data?.blocks || [];
  const out = [];

  for (const b of blocks) {
    const d = b.data || {};
    const al = alignOf(b);
    switch (b.type) {
      case "header": {
        const lv = Math.min(Math.max(+d.level || 2, 2), 4);
        out.push(`<h${lv}${al} id="h-${b.id || Math.random().toString(36).slice(2, 7)}">${inlineHtml(d.text)}</h${lv}>`);
        break;
      }
      case "paragraph":
        if ((d.text || "").trim()) out.push(`<p${al}>${inlineHtml(d.text)}</p>`);
        break;
      case "list": {
        const tag = d.style === "ordered" ? "ol" : "ul";
        const li = (items) => (items || []).map(it => {
          const txt = typeof it === "string" ? it : it.content;
          const kids = (typeof it === "object" && it.items?.length)
            ? `<${tag}>${li(it.items)}</${tag}>` : "";
          return `<li>${inlineHtml(txt)}${kids}</li>`;
        }).join("");
        out.push(`<${tag}${al}>${li(d.items)}</${tag}>`);
        break;
      }
      case "checklist":
        out.push(`<ul class="checklist">` + (d.items || []).map(it =>
          `<li class="${it.checked ? "done" : ""}"><span class="box">${it.checked ? "✔" : ""}</span>${inlineHtml(it.text)}</li>`
        ).join("") + `</ul>`);
        break;
      case "quote":
        out.push(`<blockquote${al}>${inlineHtml(d.text)}${d.caption ? `<cite>${inlineHtml(d.caption)}</cite>` : ""}</blockquote>`);
        break;
      case "code":
        out.push(`<pre><code>${esc(d.code)}</code></pre>`);
        break;
      case "delimiter":
        out.push(`<hr>`);
        break;
      case "math": {
        const tex = d.tex || d.text || "";
        if (!tex.trim()) break;
        out.push(`<div class="math" data-tex="${esc(tex)}" data-display="1">${esc(tex)}</div>`);
        break;
      }
      case "image": {
        const u = d.file?.url || d.url;
        if (!u) break;
        out.push(`<figure class="fig${d.stretched ? " wide" : ""}">
          <img src="${esc(safeUrl(u))}" alt="${esc(d.caption || "")}" loading="lazy" decoding="async">
          ${d.caption ? `<figcaption>${inlineHtml(d.caption)}</figcaption>` : ""}
        </figure>`);
        break;
      }
      case "attaches": {
        const f = d.file || {};
        if (!f.url) break;
        const ext = (f.extension || (f.name || "").split(".").pop() || "file").slice(0, 4);
        out.push(`<a class="attach" href="${esc(safeUrl(f.url))}" download target="_blank" rel="noopener">
          <span class="ext">${esc(ext)}</span>
          <span class="nm">${esc(d.title || f.name || "첨부 파일")}</span>
          <span class="sz">${f.size ? esc(fmtSize(f.size)) : ""}</span></a>`);
        break;
      }
      case "embed": {
        const src = d.embed || embedSrc(d.source || "");
        if (!src) { if (d.source) out.push(`<p><a href="${esc(safeUrl(d.source))}" target="_blank" rel="noopener">${esc(d.source)}</a></p>`); break; }
        out.push(`<figure class="fig"><div class="embed"><iframe src="${esc(safeUrl(src))}"
          allow="accelerometer;autoplay;clipboard-write;encrypted-media;gyroscope;picture-in-picture"
          allowfullscreen loading="lazy"></iframe></div>
          ${d.caption ? `<figcaption>${inlineHtml(d.caption)}</figcaption>` : ""}</figure>`);
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

function blocksToText(data) {
  const tmp = document.createElement("div");
  tmp.innerHTML = blocksToHtml(data);
  return tmp.textContent.replace(/\s+/g, " ").trim();
}

/* ═══════════════ 파일 올리기 ═══════════════ */

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

/* 그림이 아닌 파일(PDF·한글·엑셀 등)은 줄이지 않고 그대로 올린다 */
async function uploadFile(file, folder = "files") {
  if (!sb) throw new Error("Supabase 연결이 없습니다.");
  const safe = (file.name || "file").replace(/[^\w.\-가-힣]/g, "_").slice(-60);
  const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 6)}-${safe}`;
  const { error } = await sb.storage.from("blog").upload(path, file, {
    contentType: file.type || "application/octet-stream", upsert: false, cacheControl: "31536000",
  });
  if (error) throw new Error(error.message);
  return {
    url: sb.storage.from("blog").getPublicUrl(path).data.publicUrl,
    name: file.name, size: file.size,
    extension: (file.name.split(".").pop() || "").toLowerCase(),
  };
}

/* ═══════════════ 글 다루기 ═══════════════ */

async function deletePosts(ids) {
  if (!sb) throw new Error("Supabase 연결이 없습니다.");
  const list = [].concat(ids);
  const { error } = await sb.from("blog_posts").delete().in("id", list);
  if (error) throw new Error(error.message);
  return list.length;
}

async function setPostStatus(ids, status) {
  const list = [].concat(ids);
  const patch = { status };
  if (status === "published") patch.published_at = new Date().toISOString();
  const { error } = await sb.from("blog_posts").update(patch).in("id", list);
  if (error) throw new Error(error.message);
}

/* ═══════════════ 왼쪽 위 프로필 · 맨 아래 만든이 · AI 붙박이 ═══════════════ */

function initials(name) {
  const n = String(name || "").trim();
  if (!n) return "·";
  const parts = n.split(/\s+/);
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : n.slice(0, 2)).toUpperCase();
}

function drawProfile(box) {
  box = box || $("#profile");
  if (!box) return;
  const s = SETTINGS;
  const name = s.owner_name || s.title || "";
  const av = s.avatar_url
    ? `<img class="pfAv" src="${esc(safeUrl(s.avatar_url))}" alt="">`
    : `<span class="pfAv">${esc(initials(name))}</span>`;

  box.innerHTML = `
    <div class="pfTop">
      ${av}
      <div class="pfWho">
        <div class="pfName">${esc(name || "이름 없음")}</div>
        ${s.tagline ? `<div class="pfRole">${esc(s.tagline)}</div>` : ""}
      </div>
    </div>
    ${s.owner_bio ? `<p class="pfBio">${esc(s.owner_bio)}</p>` : ""}
    ${(s.owner_links || []).length ? `<div class="pfLinks">${
      s.owner_links.filter(l => l && l.url).slice(0, 5).map(l =>
        `<a href="${esc(safeUrl(l.url))}" target="_blank" rel="noopener">${esc(l.label || l.url)}</a>`
      ).join("")}</div>` : ""}
    <button class="pfEdit" id="pfEdit">프로필 고치기</button>`;

  const btn = $("#pfEdit", box);
  if (btn) btn.onclick = profileBox;
}

/* 프로필 고치는 창 */
function profileBox() {
  if (!canEdit()) return toast("로그인해야 고칠 수 있습니다.", "err");
  const s = SETTINGS;
  const ov = document.createElement("div");
  ov.className = "ov";
  ov.innerHTML = `<div class="ovbox">
    <h3>프로필</h3>

    <label>사진</label>
    <div class="row" style="align-items:center;margin-bottom:4px">
      <span class="pfAv" id="pvAv" style="width:52px;height:52px">${esc(initials(s.owner_name || s.title))}</span>
      <button class="btn ghost sm" id="pfPick">기기에서 고르기</button>
      <button class="btn ghost sm" id="pfClear">빼기</button>
      <input type="file" id="pfFile" accept="image/*" hidden>
    </div>
    <input id="pfUrl" placeholder="또는 사진 주소(https://…)" value="${esc(s.avatar_url || "")}">

    <label>이름</label>
    <input id="pfName" placeholder="예: 조준원" value="${esc(s.owner_name || "")}">

    <label>한 줄 소개 (이름 아래 작게)</label>
    <input id="pfRole" placeholder="예: 데이터센터 기계설비" value="${esc(s.tagline || "")}">

    <label>소개 글 (사이드바에 세 줄까지)</label>
    <textarea id="pfBio" rows="3" placeholder="무엇을 기록하는 곳인지 짧게">${esc(s.owner_bio || "")}</textarea>

    <label>링크 (한 줄에 하나 · «이름 | 주소»)</label>
    <textarea id="pfLinks" rows="3" placeholder="GitHub | https://github.com/…">${
      esc((s.owner_links || []).map(l => `${l.label || ""} | ${l.url || ""}`).join("\n"))}</textarea>

    <div class="row" style="justify-content:flex-end;margin-top:16px">
      <button class="btn ghost" id="pfNo">닫기</button>
      <button class="btn" id="pfOk">저장</button>
    </div>
  </div>`;
  document.body.appendChild(ov);
  ov.onclick = e => { if (e.target === ov) ov.remove(); };
  $("#pfNo", ov).onclick = () => ov.remove();

  const preview = () => {
    const u = $("#pfUrl", ov).value.trim();
    const av = $("#pvAv", ov);
    av.outerHTML = u
      ? `<img class="pfAv" id="pvAv" src="${esc(safeUrl(u))}" style="width:52px;height:52px" alt="">`
      : `<span class="pfAv" id="pvAv" style="width:52px;height:52px">${esc(initials($("#pfName", ov).value || ""))}</span>`;
  };
  $("#pfUrl", ov).oninput = preview;
  $("#pfPick", ov).onclick = () => $("#pfFile", ov).click();
  $("#pfClear", ov).onclick = () => { $("#pfUrl", ov).value = ""; preview(); };
  $("#pfFile", ov).onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      toast("올리는 중…");
      const { url } = await uploadImage(f, "profile");
      $("#pfUrl", ov).value = url; preview();
    } catch (err) { toast(err.message, "err"); }
  };

  $("#pfOk", ov).onclick = async () => {
    const links = $("#pfLinks", ov).value.split("\n").map(line => {
      const [a, b] = line.split("|");
      const url = (b ?? a ?? "").trim();
      if (!url) return null;
      const label = (b ? a : "").trim() || url.replace(/^https?:\/\//, "").split("/")[0];
      return { label, url };
    }).filter(Boolean).slice(0, 6);

    await saveSettings({
      avatar_url: $("#pfUrl", ov).value.trim(),
      owner_name: $("#pfName", ov).value.trim(),
      tagline:    $("#pfRole", ov).value.trim(),
      owner_bio:  $("#pfBio", ov).value.trim(),
      owner_links: links,
    });
    ov.remove();
    toast("프로필을 바꿨습니다");
  };
}

/* 맨 아래 만든이 줄 */
function drawMadeBy(box) {
  box = box || $("#madeby");
  if (!box) return;
  const s = SETTINGS;
  if (s.footer_on === false) { box.innerHTML = ""; return; }

  const site = s.title || "sniper";
  const who = (s.owner_name || "").trim();
  const mark = (site.trim()[0] || "S").toUpperCase();

  box.innerHTML = `
    <span class="mbMark"><span class="mbDot">${esc(mark)}</span>${esc(site)}</span>
    <span>${who ? esc(who) + " 가 " : ""}직접 만들어 쓰는 기록장</span>
    ${s.footer_text ? `<span>· ${esc(s.footer_text)}</span>` : ""}
    <span class="mbSp"></span>
    <a href="./about.html">소개</a>
    <span>© ${new Date().getFullYear()}</span>`;
}

/* AI 창을 오른쪽에 붙박이로 */
function applyDock() {
  const on = !!SETTINGS.ai_dock && window.innerWidth >= 1180;
  document.body.classList.toggle("aiDock", on);
  const b = $("#btnDock");
  if (b) b.classList.toggle("on", !!SETTINGS.ai_dock);
  if (on && window.AIChat?.open) { try { window.AIChat.open(); } catch {} }
}

function initDock() {
  const b = $("#btnDock");
  if (b) b.onclick = async () => {
    await saveSettings({ ai_dock: !SETTINGS.ai_dock });
    applyDock();
    toast(SETTINGS.ai_dock ? "AI 를 오른쪽에 붙였습니다" : "AI 를 떼어 냈습니다");
  };
  window.addEventListener("resize", applyDock);
  let n = 0;
  const t = setInterval(() => { if (window.AIChat || n++ > 40) { clearInterval(t); applyDock(); } }, 200);
}

/* ═══════════════ 로그인 상자 ═══════════════ */

function loginBox() {
  if ($("#loginOv")) return;
  const ov = document.createElement("div");
  ov.id = "loginOv";
  ov.className = "ov";
  ov.innerHTML = `
    <div class="ovbox" style="max-width:400px">
      <h3>${ME ? "로그인됨" : "로그인"}</h3>
      ${ME ? `
        <p class="muted">${esc(ME.email || "")}${canEdit() ? "" : " · 글쓰기 권한이 없는 계정입니다"}</p>
        <div class="row" style="justify-content:flex-end"><button class="btn ghost" id="lgClose">닫기</button>
        <button class="btn" id="lgOut">로그아웃</button></div>
      ` : `
        <input id="lgEm" type="email" placeholder="이메일" autocomplete="username">
        <input id="lgPw" type="password" placeholder="비밀번호" autocomplete="current-password">
        <div class="row" style="justify-content:flex-end"><button class="btn ghost" id="lgClose">닫기</button>
        <button class="btn" id="lgIn">들어가기</button></div>
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

/* ═══════════════ 오프라인 대비 ═══════════════ */
/* ── 오프라인 / 새 버전 표시 ───────────────────────────── */
function installNetBadge(){
  if(document.getElementById("netBadge")) return;
  const b=document.createElement("div"); b.id="netBadge"; b.className="netBadge"; b.setAttribute("role","status"); b.hidden=navigator.onLine; b.textContent="오프라인 · 저장된 화면을 사용 중"; document.body.appendChild(b);
  window.addEventListener("online",()=>{b.hidden=true;}); window.addEventListener("offline",()=>{b.hidden=false;});
}
installNetBadge();
if ("serviceWorker" in navigator && location.protocol.startsWith("http"))
  window.addEventListener("load", async () => {
    try{
      const reg=await navigator.serviceWorker.register("./sw.js");
      reg.update?.();
      reg.addEventListener("updatefound",()=>{
        const w=reg.installing; if(!w)return;
        w.addEventListener("statechange",()=>{
          if(w.state==='installed' && navigator.serviceWorker.controller){
            const b=document.createElement('button'); b.className='swUpdate'; b.textContent='새 버전이 있습니다 · 새로고침'; b.onclick=()=>location.reload(); document.body.appendChild(b);
          }
        });
      });
    }catch{}
  });

function lazyLoadMedia(root=document){
  root.querySelectorAll('img:not([loading])').forEach(img=>img.setAttribute('loading','lazy'));
  root.querySelectorAll('iframe:not([loading])').forEach(x=>x.setAttribute('loading','lazy'));
}
window.addEventListener('load',()=>lazyLoadMedia());

window.App = {
  sb, CFG,
  get me() { return ME; },
  get settings() { return SETTINGS; },
  GRADIENTS, PATTERNS, DEFAULT_SETTINGS,
  refreshMe, canEdit, signIn, signOut, loginBox,
  drawProfile, profileBox, drawMadeBy, applyDock, initDock, initials,
  loadSettings, saveSettings, applySettings, applyAccent, luma, blend, contrast,
  blocksToHtml, blocksToText, inlineHtml, embedSrc,
  catTree, catBranch,
  uploadImage, uploadFile, shrink,
  deletePosts, setPostStatus,
  loadKatex, renderMath,
  $, $$, esc, safeUrl, fmtDate, fmtSize, slugify, toast, qs, ask,
};
})();




/* v9 UX: scroll restore + lightweight search helpers */
(function(){
  try {
    const key=`sniper:scroll:${location.pathname}${location.search}`;
    if('scrollRestoration' in history) history.scrollRestoration='manual';
    window.addEventListener('load',()=>{
      const y=Number(sessionStorage.getItem(key)||0);
      if(y) requestAnimationFrame(()=>scrollTo(0,y));
    });
    let t=0;
    window.addEventListener('scroll',()=>{
      clearTimeout(t);
      t=setTimeout(()=>sessionStorage.setItem(key,String(scrollY)),180);
    },{passive:true});
  } catch {}
  window.addEventListener('keydown',e=>{
    if((e.ctrlKey||e.metaKey)&&e.key==='k'){
      e.preventDefault();
      document.querySelector('#cmdPal')?.removeAttribute('hidden');
      document.querySelector('#cmdInput')?.focus();
    }
    if(e.key==='/' && !/input|textarea|select/i.test(document.activeElement?.tagName||'')){
      e.preventDefault();
      document.querySelector('#q')?.focus();
    }
  });
})();
