/* ═══════════════════════════════════════════════════════════════════════
   ai-plus.js — AI 대화 상자에 모자란 것들을 덧대는 파일

   ai-chat.js 는 손대지 않습니다. 이 파일은 바깥에서 얹기만 합니다.

     1. 수식      $…$ · $$…$$ · \(…\) · \[…\] 를 진짜 수식으로 그림
     2. 파일 회신  답을 .md / .html / .txt 로 내려받기, 표는 .csv 로
     3. 복사       답 전체 · 코드 덩어리 · 표를 한 번에 복사
     4. 본문 넣기  글쓰기 화면이면 답을 그대로 글에 꽂아 줌
     5. 지시문     표·수식·형식을 제대로 쓰라고 AI 에게 미리 일러 둠

   붙이는 법 (ai-chat.js «다음» 줄):
       <script src="./ai-plus.js" defer></script>
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
"use strict";

if (window.__aiPlus) return;
window.__aiPlus = true;

/* ═══════════════ 0. 자잘한 도우미 ═══════════════ */

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

function note(msg, bad) {
  if (window.App?.toast) return App.toast(msg, bad ? "err" : "ok");
  console.log(msg);
}

function stamp() {
  const d = new Date(), p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

function download(name, text, mime = "text/plain;charset=utf-8") {
  const blob = new Blob(["\ufeff" + text], { type: mime });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 400);
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    note("복사했습니다");
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); note("복사했습니다"); }
    catch { note("복사하지 못했습니다", true); }
    ta.remove();
  }
}

/* ═══════════════ 1. 모양새 ═══════════════ */

const CSS = `
.aip-bar{display:flex;gap:5px;flex-wrap:wrap;margin:7px 0 2px;padding-left:2px}
.aip-bar button{
  border:1px solid var(--rule,#2A323C);background:var(--card,#161B22);color:var(--ink-2,#9BA7B4);
  font:600 11px/1.2 var(--font,system-ui);padding:4px 9px;border-radius:7px;cursor:pointer;
  display:inline-flex;align-items:center;gap:4px}
.aip-bar button:hover{border-color:var(--accent,#1D4ED8);color:var(--accent,#1D4ED8)}
.aip-bar .sep{flex-basis:100%;height:0}

.aip-mini{
  position:absolute;right:6px;top:6px;z-index:3;display:flex;gap:4px;opacity:0;transition:opacity .12s}
.aip-hold:hover .aip-mini{opacity:1}
.aip-mini button{
  border:1px solid var(--rule,#2A323C);background:var(--card,#161B22);color:var(--ink-2,#9BA7B4);
  font:600 10.5px/1.2 var(--font,system-ui);padding:3px 7px;border-radius:6px;cursor:pointer}
.aip-mini button:hover{border-color:var(--accent,#1D4ED8);color:var(--accent,#1D4ED8)}
.aip-hold{position:relative}

.aic-bub .katex{font-size:1.02em}
.aic-bub .katex-display{margin:.7em 0;overflow-x:auto;overflow-y:hidden;padding:2px 0}
.aip-mathfail{color:#F87171;font-family:ui-monospace,monospace;font-size:.9em}

.aic-bub table{display:table}
.aip-tblwrap{overflow-x:auto;margin:.6em 0}
`;

function style() {
  if ($("#aipCss")) return;
  const s = document.createElement("style");
  s.id = "aipCss";
  s.textContent = CSS;
  document.head.appendChild(s);
}

/* ═══════════════ 2. 수식 그리기 ═══════════════ */

let katexP = null;
function katex() {
  if (window.katex) return Promise.resolve(window.katex);
  if (window.App?.loadKatex) return App.loadKatex();
  if (katexP) return katexP;
  katexP = new Promise((res, rej) => {
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
  return katexP;
}

const RX = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\$(?!\s)([^$\n]+?)(?<!\s)\$|\\\(([\s\S]+?)\\\)/g;

function hasMath(s) {
  return /\$[^$\n]/.test(s) || s.includes("\\[") || s.includes("\\(");
}

/* 한 덩어리 통째로 수식인 문단은 «가운데 크게» 그린다 */
function wholeBlockTex(el) {
  const t = (el.textContent || "").trim();
  let m = t.match(/^\$\$([\s\S]+)\$\$$/) || t.match(/^\\\[([\s\S]+)\\\]$/);
  return m ? m[1] : null;
}

async function drawMath(root) {
  if (!root || root.dataset.aipMath === "1") return;

  const blocky = $$("p,li,div", root).filter(el => !el.closest("code,pre,.katex"));
  const jobs = [];

  for (const el of blocky) {
    const tex = wholeBlockTex(el);
    if (tex) {
      const holder = document.createElement("div");
      el.replaceWith(holder);
      jobs.push({ node: holder, tex, display: true });
    }
  }

  // 글자 사이에 낀 수식
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      if (!n.nodeValue || !hasMath(n.nodeValue)) return NodeFilter.FILTER_REJECT;
      if (n.parentElement?.closest("code,pre,.katex,.aip-bar,.aip-mini")) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const texts = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) texts.push(n);

  for (const n of texts) {
    const src = n.nodeValue;
    RX.lastIndex = 0;
    let m, last = 0;
    const frag = document.createDocumentFragment();
    while ((m = RX.exec(src))) {
      const tex = m[1] ?? m[2] ?? m[3] ?? m[4];
      if (!tex || !tex.trim()) continue;
      if (m.index > last) frag.appendChild(document.createTextNode(src.slice(last, m.index)));
      const span = document.createElement("span");
      frag.appendChild(span);
      jobs.push({ node: span, tex, display: m[1] != null || m[2] != null });
      last = m.index + m[0].length;
    }
    if (!jobs.length && !frag.childNodes.length) continue;
    if (last === 0) continue;
    if (last < src.length) frag.appendChild(document.createTextNode(src.slice(last)));
    n.parentNode?.replaceChild(frag, n);
  }

  if (!jobs.length) { root.dataset.aipMath = "1"; return; }

  let K;
  try { K = await katex(); }
  catch { jobs.forEach(j => j.node.textContent = j.tex); root.dataset.aipMath = "1"; return; }

  for (const j of jobs) {
    try {
      K.render(j.tex, j.node, { displayMode: j.display, throwOnError: false, errorColor: "#F87171" });
    } catch {
      j.node.className = "aip-mathfail";
      j.node.textContent = j.tex;
    }
  }
  root.dataset.aipMath = "1";
}

/* ═══════════════ 3. 표 · 코드 다루기 ═══════════════ */

function tableToCsv(tbl) {
  const q = s => {
    s = (s ?? "").replace(/\s+/g, " ").trim();
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [...tbl.querySelectorAll("tr")]
    .map(tr => [...tr.children].map(td => q(td.textContent)).join(","))
    .join("\r\n");
}

function tableToMd(tbl) {
  const rows = [...tbl.querySelectorAll("tr")]
    .map(tr => [...tr.children].map(td => (td.textContent || "").replace(/\s+/g, " ").trim()));
  if (!rows.length) return "";
  const head = rows[0], rest = rows.slice(1);
  return [
    "| " + head.join(" | ") + " |",
    "| " + head.map(() => "---").join(" | ") + " |",
    ...rest.map(r => "| " + r.join(" | ") + " |"),
  ].join("\n");
}

/* 표·코드마다 오른쪽 위에 작은 단추를 얹는다 */
function decorateParts(bub) {
  $$("table", bub).forEach((tbl, i) => {
    if (tbl.dataset.aip === "1") return;
    tbl.dataset.aip = "1";
    const wrap = document.createElement("div");
    wrap.className = "aip-tblwrap aip-hold";
    tbl.replaceWith(wrap);
    wrap.appendChild(tbl);
    const bar = document.createElement("div");
    bar.className = "aip-mini";
    bar.innerHTML = `<button data-c>복사</button><button data-csv>CSV</button>`;
    wrap.appendChild(bar);
    $("[data-c]", bar).onclick = () => copy(tableToMd(tbl));
    $("[data-csv]", bar).onclick = () => {
      download(`표-${stamp()}${i ? "-" + (i + 1) : ""}.csv`, tableToCsv(tbl), "text/csv;charset=utf-8");
      note("CSV 로 내려받았습니다");
    };
  });

  $$("pre", bub).forEach(pre => {
    if (pre.dataset.aip === "1") return;
    pre.dataset.aip = "1";
    pre.classList.add("aip-hold");
    const bar = document.createElement("div");
    bar.className = "aip-mini";
    bar.innerHTML = `<button data-c>복사</button><button data-save>저장</button>`;
    pre.appendChild(bar);
    const code = () => pre.querySelector("code")?.textContent ?? pre.textContent;
    $("[data-c]", bar).onclick = () => copy(code());
    $("[data-save]", bar).onclick = () => {
      download(`코드-${stamp()}.txt`, code());
      note("파일로 내려받았습니다");
    };
  });
}

/* ═══════════════ 4. 답 아래 단추 띠 ═══════════════ */

/* 화면에 그려진 답을 다시 마크다운 비슷하게 되돌린다 */
function toMarkdown(bub) {
  const walk = (n, depth = 0) => {
    if (n.nodeType === 3) return n.nodeValue;
    if (n.nodeType !== 1) return "";
    const tag = n.tagName.toLowerCase();
    if (n.classList?.contains("aip-bar") || n.classList?.contains("aip-mini")) return "";
    if (n.classList?.contains("katex")) {
      const tex = n.querySelector("annotation")?.textContent;
      return tex ? `$${tex}$` : n.textContent;
    }
    const kids = () => [...n.childNodes].map(c => walk(c, depth)).join("");
    switch (tag) {
      case "br": return "\n";
      case "h1": case "h2": case "h3": case "h4":
        return "\n" + "#".repeat(+tag[1]) + " " + kids() + "\n";
      case "p": return "\n" + kids() + "\n";
      case "strong": case "b": return "**" + kids() + "**";
      case "em": case "i": return "*" + kids() + "*";
      case "code":
        return n.closest("pre") ? kids() : "`" + kids() + "`";
      case "pre": return "\n```\n" + n.textContent.replace(/\s+$/,"") + "\n```\n";
      case "blockquote": return "\n> " + kids().trim().replace(/\n/g, "\n> ") + "\n";
      case "hr": return "\n---\n";
      case "a": return `[${kids()}](${n.getAttribute("href") || ""})`;
      case "ul": case "ol": {
        const ord = tag === "ol";
        return "\n" + [...n.children].map((li, i) =>
          "  ".repeat(depth) + (ord ? `${i + 1}. ` : "- ") + walk(li, depth + 1).trim()).join("\n") + "\n";
      }
      case "li": return kids();
      case "table": return "\n" + tableToMd(n) + "\n";
      default: return kids();
    }
  };
  return walk(bub).replace(/\n{3,}/g, "\n\n").trim();
}

const HTML_SHELL = (title, inner) => `<!DOCTYPE html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css">
<style>
body{max-width:760px;margin:40px auto;padding:0 20px;
  font:16px/1.75 -apple-system,"Segoe UI",system-ui,sans-serif;color:#111827}
table{border-collapse:collapse;width:100%;margin:1em 0;font-size:14.5px}
th,td{border:1px solid #D1D5DB;padding:7px 10px;text-align:left;vertical-align:top}
th{background:#F3F4F6}
pre{background:#F3F4F6;padding:13px 15px;border-radius:9px;overflow-x:auto;
  font:13px/1.6 ui-monospace,monospace}
code{background:#F3F4F6;padding:1px 5px;border-radius:4px;font:.9em ui-monospace,monospace}
pre code{background:none;padding:0}
blockquote{margin:1em 0;padding-left:1em;border-left:3px solid #93C5FD;color:#374151}
img{max-width:100%}
</style></head><body>${inner}</body></html>`;

function cleanClone(bub) {
  const c = bub.cloneNode(true);
  $$(".aip-bar,.aip-mini", c).forEach(x => x.remove());
  $$("[data-aip]", c).forEach(x => x.removeAttribute("data-aip"));
  return c;
}

function addBar(row, bub) {
  if (row.dataset.aipBar === "1") return;
  row.dataset.aipBar = "1";

  const bar = document.createElement("div");
  bar.className = "aip-bar";

  const onWrite = document.body.dataset.page === "write" && typeof window.__blogInsertHtml === "function";
  const hasTable = !!bub.querySelector("table");

  bar.innerHTML =
    `<button data-a="copy">복사</button>` +
    `<button data-a="md">.md</button>` +
    `<button data-a="html">.html</button>` +
    `<button data-a="txt">.txt</button>` +
    (hasTable ? `<button data-a="csv">표 CSV</button>` : "") +
    (onWrite ? `<button data-a="into">본문에 넣기</button>` : "");

  row.appendChild(bar);

  const title = () => (App?.settings?.title || "AI 답") + " " + stamp();

  bar.onclick = async e => {
    const b = e.target.closest("[data-a]");
    if (!b) return;
    const md = () => toMarkdown(bub);
    switch (b.dataset.a) {
      case "copy": return copy(md());
      case "md":   download(`AI-${stamp()}.md`, md(), "text/markdown;charset=utf-8");
                   return note("마크다운으로 내려받았습니다");
      case "txt":  download(`AI-${stamp()}.txt`, bub.innerText.trim());
                   return note("텍스트로 내려받았습니다");
      case "html": download(`AI-${stamp()}.html`, HTML_SHELL(title(), cleanClone(bub).innerHTML), "text/html;charset=utf-8");
                   return note("HTML 로 내려받았습니다");
      case "csv": {
        const tables = $$("table", bub);
        if (!tables.length) return;
        tables.forEach((t, i) =>
          download(`표-${stamp()}${tables.length > 1 ? "-" + (i + 1) : ""}.csv`,
            tableToCsv(t), "text/csv;charset=utf-8"));
        return note(`표 ${tables.length}개를 CSV 로 내려받았습니다`);
      }
      case "into": {
        const ok = await window.__blogInsertHtml(cleanClone(bub).innerHTML);
        return note(ok ? "본문 끝에 넣었습니다" : "넣을 내용이 없습니다", !ok);
      }
    }
  };
}

/* ═══════════════ 5. 답이 끝났는지 지켜보기 ═══════════════ */

const timers = new WeakMap();

function settle(row) {
  const bub = row.querySelector(".aic-bub");
  if (!bub) return;
  if (bub.querySelector(".aic-dots")) return;      // 아직 받아 오는 중
  if (!(bub.textContent || "").trim()) return;

  clearTimeout(timers.get(row));
  timers.set(row, setTimeout(async () => {
    if (bub.querySelector(".aic-dots")) return;
    delete bub.dataset.aipMath;                    // 새로 그려졌으면 다시 훑는다
    await drawMath(bub);
    decorateParts(bub);
    addBar(row, bub);
  }, 550));
}

function watch() {
  const log = $(".aic-log");
  if (!log || log.dataset.aip === "1") return;
  log.dataset.aip = "1";

  const mo = new MutationObserver(muts => {
    const rows = new Set();
    for (const m of muts) {
      const r = (m.target.nodeType === 1 ? m.target : m.target.parentElement)?.closest?.(".aic-row.ai");
      if (r) rows.add(r);
      m.addedNodes?.forEach(n => {
        if (n.nodeType === 1 && n.classList?.contains("aic-row") && n.classList.contains("ai")) rows.add(n);
      });
    }
    rows.forEach(settle);
  });
  mo.observe(log, { childList: true, subtree: true, characterData: true });

  $$(".aic-row.ai", log).forEach(settle);
}

/* ═══════════════ 6. AI 에게 미리 일러 둘 말 ═══════════════ */

const RULES = `
[답 형식 규칙]
· 비교·항목·수치·점검표처럼 «칸으로 나뉘는 내용» 은 반드시 마크다운 표로 주세요. 줄글로 늘어놓지 마세요.
· 수식은 TeX 로 쓰세요. 문장 안이면 $…$, 따로 한 줄이면 $$…$$ 로 감쌉니다. 그대로 그려집니다.
· 코드·설정값·명령어는 \`\`\` 로 감싼 코드 덩어리로 주세요. 언어 이름을 붙여 주세요.
· 문서·대장·목록처럼 «파일로 받아 갈 만한 것» 은 통째로 하나의 코드 덩어리나 표로 주세요. 사용자가 그대로 내려받습니다.
· 표에는 단위를 열 이름에 적으세요. (예: 유량 (m³/h))
· 길어지면 소제목(##)으로 나누세요.
`;

const MARK = "[답 형식 규칙]";

function teach() {
  if (!window.AIChat || AIChat.__aipWrapped) return;
  const orig = AIChat.setContext.bind(AIChat);
  AIChat.setContext = ctx => {
    const c = { ...(ctx || {}) };
    if (!(c.system || "").includes(MARK))
      c.system = (c.system ? c.system + "\n" : "") + RULES;
    return orig(c);
  };
  AIChat.__aipWrapped = true;

  // 화면 쪽에서 이미 context 를 넣어 둔 뒤일 수 있으므로 한 번 다시 얹는다
  const cur = AIChat.context;
  AIChat.setContext(cur ? { ...cur } : { label: "", text: "", system: "" });
}

/* ═══════════════ 7. 시작 ═══════════════ */

function boot() {
  style();
  teach();
  watch();
}

let tries = 0;
const wait = setInterval(() => {
  if (window.AIChat || tries++ > 60) {
    clearInterval(wait);
    boot();
    // AI 창은 처음 열 때 만들어지므로, 열릴 때 한 번 더 붙인다
    const again = setInterval(() => { if ($(".aic-log")) { watch(); clearInterval(again); } }, 400);
    setTimeout(() => clearInterval(again), 60000);
    document.addEventListener("click", () => setTimeout(watch, 300), true);
  }
}, 150);

})();
