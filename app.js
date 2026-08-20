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

/* ═══════════════ 강조색 — 대비 자동 맞추기 ═══════════════
   어떤 색을 골라도 글자가 읽히도록, 색의 «밝기» 를 재서
     · 강조색 위에 얹을 글자색(--on-accent)
     · 연한 강조 배경(--accent-soft) 과 그 위 글자색(--accent-ink)
   을 계산해 둡니다. */

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

/* 두 색의 명암비 (1 = 똑같음, 21 = 검정 대 흰색). 4.5 넘으면 본문으로 읽을 만합니다. */
function contrast(a, b) {
  const x = luma(a), y = luma(b);
  return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
}

/* fg 를 bg 위에서 읽힐 때까지 조금씩 어둡게(또는 밝게) 끌어당깁니다.
   임계값을 미리 정해 두는 대신 실제로 재면서 맞추므로, 어떤 색을 골라도 통합니다. */
function readable(fg, bg, dark, need = 4.6) {
  const pull = dark ? "#FFFFFF" : "#000000";
  let c = fg;
  for (let i = 0; i < 18 && contrast(c, bg) < need; i++) c = blend(c, pull, .11);
  return c;
}

function applyAccent(hex, dark) {
  const root = document.documentElement;
  root.style.setProperty("--accent", hex);

  // 강조색 «위» 글자 — 흰색과 먹색 중 더 잘 보이는 쪽
  const ink0 = "#0B1220";
  root.style.setProperty("--on-accent",
    contrast("#FFFFFF", hex) >= contrast(ink0, hex) ? "#FFFFFF" : ink0);

  // 연한 강조 배경
  const soft = dark ? blend(hex, "#141A22", .87) : blend(hex, "#FFFFFF", .90);
  root.style.setProperty("--accent-soft", soft);

  // 그 연한 배경 위 글자색 — 읽힐 때까지 조정
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
  document.title = (document.body.dataset.page === "post" && document.title !== "sniper")
    ? document.title : (s.title || "sniper");
}

window.matchMedia?.("(prefers-color-scheme: dark)")
  .addEventListener?.("change", () => { if (SETTINGS.theme === "auto") applySettings(); });

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
  loadSettings, saveSettings, applySettings, applyAccent, luma, blend, contrast,
  blocksToHtml, blocksToText, inlineHtml, embedSrc,
  uploadImage, uploadFile, shrink,
  deletePosts, setPostStatus,
  loadKatex, renderMath,
  $, $$, esc, safeUrl, fmtDate, fmtSize, slugify, toast, qs, ask,
};
})();
