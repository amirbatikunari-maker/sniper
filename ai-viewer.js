/* ═══════════════════════════════════════════════════════════════════════
   ai-viewer.js — 기출 뷰어와 AI 대화 상자를 이어 주는 얇은 다리
   ───────────────────────────────────────────────────────────────────────
   하는 일 두 가지뿐입니다.
     1) 문항 헤더에 «AI» 단추를 하나 끼워 넣는다
     2) 질문을 보낼 때, 지금 화면에 떠 있는 문항을 읽어서 같이 보낸다

   기존 index.html / practice.html 의 코드는 한 줄도 건드리지 않습니다.
   화면(DOM)만 읽기 때문에, 나중에 뷰어를 고쳐도 잘 따라갑니다.

   붙이는 법 — ai-chat.js «다음» 줄에:
       <script src="./ai-viewer.js" defer></script>
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
"use strict";

const $$ = (s, r = document) => [...r.querySelectorAll(s)];

/* ── 지금 화면 한가운데 있는 문항 찾기 ────────────────────────────────
   좌우로 넘기는 구조라 «화면 가운데에 걸친 슬라이드» 가 지금 보는 문항이다. */
function activeSlide() {
  const slides = $$("#track .slide, .slide[data-i]");
  if (!slides.length) return document.querySelector(".qcard")?.closest("div") || null;

  const mid = window.innerWidth / 2, midY = window.innerHeight / 2;
  let best = null, bestD = Infinity;
  for (const s of slides) {
    const r = s.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    const d = Math.abs((r.left + r.right) / 2 - mid) + Math.abs((r.top + r.bottom) / 2 - midY);
    if (d < bestD) { bestD = d; best = s; }
  }
  return best;
}

/* 화면에 그려진 글자를 사람이 읽는 순서 그대로 뽑아낸다 */
function textOf(node) {
  if (!node) return "";
  return node.innerText.replace(/ /g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function readQuestion() {
  const slide = activeSlide();
  if (!slide) return null;

  const no    = textOf(slide.querySelector(".qno")) || "";
  const sum   = textOf(slide.querySelector(".qsum")) || "";
  const part  = textOf(slide.querySelector(".part")) || "";
  const qtext = textOf(slide.querySelector(".qtext")) || "";

  const choices = $$(".ch", slide).map((c, i) => {
    const t = textOf(c.querySelector(".t"));
    return `${i + 1}) ${t}${c.classList.contains("ok") ? "   ← 정답" : ""}`;
  });

  // 해설은 길 수 있어 앞부분만
  const exp = textOf(slide.querySelector(".sheet-host, .exp, .explain")) ||
              textOf(slide.querySelector(".splitcols > :last-child"));

  if (!qtext && !choices.length) return null;

  const subj = textOf(document.querySelector("#subjTitle, .subjname, #title")) || "";
  const label = [subj, no ? `${no}번` : "", sum].filter(Boolean).join(" · ").slice(0, 60);

  const text = [
    subj  ? `과목/회차: ${subj}` : "",
    no    ? `문항 번호: ${no}번` : "",
    part  ? `분류: ${part}` : "",
    qtext ? `\n[문제]\n${qtext}` : "",
    choices.length ? `\n[보기]\n${choices.join("\n")}` : "",
    exp   ? `\n[화면에 있는 해설]\n${exp.slice(0, 3000)}` : "",
  ].filter(Boolean).join("\n");

  return {
    label: label || "문항",
    text,
    system: "사용자는 자격증 기출문제를 공부하는 중입니다. " +
            "아래 화면 내용을 근거로 답하되, 화면에 없는 내용을 지어내지 마세요. " +
            "풀이는 '왜 그 답인지' 를 한 줄로 먼저 말하고, 그 다음 근거를 씁니다. " +
            "오답 보기는 왜 틀렸는지 한 줄씩 짚어 주세요.",
    kind: "question",
    no, subject: subj,
  };
}

/* 문항이 아니면(자료함·면접 화면 등) 화면에서 보이는 글이라도 넘긴다 */
function readFallback() {
  const main = document.querySelector("main, #app, .pane.on, body");
  const t = textOf(main).slice(0, 4000);
  if (!t) return null;
  return { label: document.title, text: t, kind: "page" };
}

function context() {
  return readQuestion() || readFallback();
}

/* ── 문항 헤더에 AI 단추 끼우기 ──────────────────────────────────── */

const BTN_CSS = `
.qai{flex:none;width:30px;height:30px;margin-left:2px;border-radius:8px;
  border:1px solid var(--rule,#dde2e9);background:transparent;color:var(--accent,#1D4ED8);
  font:700 11px/1 var(--font-d,system-ui);cursor:pointer;display:flex;align-items:center;justify-content:center}
.qai:active{background:var(--accent-soft,#E4ECFD)}
.aiq-menu{position:fixed;z-index:10000;background:var(--card,#fff);border:1px solid var(--rule,#dde2e9);
  border-radius:12px;box-shadow:0 12px 34px -18px rgba(0,0,0,.6);padding:6px;min-width:200px;
  display:flex;flex-direction:column;gap:2px}
.aiq-menu button{text-align:left;padding:9px 11px;border:0;border-radius:8px;background:transparent;
  color:var(--ink,#10233D);font:600 13.5px/1.35 var(--font-d,system-ui);cursor:pointer}
.aiq-menu button:active{background:var(--accent-soft,#E4ECFD)}
`;

const PROMPTS = [
  ["이 문항 풀이해 줘",   "이 문항의 정답이 왜 정답인지, 나머지 보기는 왜 틀렸는지 설명해 줘."],
  ["쉬운 말로 다시",       "이 문항에 나오는 개념을 처음 배우는 사람에게 설명하듯 쉬운 말로 풀어 줘."],
  ["관련 개념 정리",       "이 문항이 묻는 핵심 개념을 표로 정리해 주고, 자주 같이 나오는 개념도 알려 줘."],
  ["비슷한 문제 만들어 줘", "이 문항과 같은 개념을 묻는 4지선다 문제 3개를 정답·해설과 함께 만들어 줘."],
  ["암기 요령",            "이 문항의 내용을 시험장에서 떠올릴 수 있게 짧은 암기 요령으로 만들어 줘."],
];

function openMenu(anchor) {
  document.querySelector(".aiq-menu")?.remove();
  const m = document.createElement("div");
  m.className = "aiq-menu";
  m.innerHTML = PROMPTS.map(([t], i) => `<button data-i="${i}">${t}</button>`).join("") +
                `<button data-i="free">✎ 직접 물어보기</button>`;
  document.body.appendChild(m);

  const r = anchor.getBoundingClientRect();
  m.style.top  = Math.min(r.bottom + 6, window.innerHeight - m.offsetHeight - 10) + "px";
  m.style.left = Math.max(8, Math.min(r.left - 150, window.innerWidth - m.offsetWidth - 8)) + "px";

  m.onclick = e => {
    const b = e.target.closest("button"); if (!b) return;
    m.remove();
    if (b.dataset.i === "free") window.AIChat?.open();
    else window.AIChat?.ask(PROMPTS[+b.dataset.i][1]);
  };
  setTimeout(() => document.addEventListener("pointerdown", function off(ev) {
    if (!m.contains(ev.target)) { m.remove(); document.removeEventListener("pointerdown", off); }
  }), 0);
}

function addButtons(root = document) {
  for (const head of $$(".qhead", root)) {
    if (head.querySelector(".qai")) continue;
    const b = document.createElement("button");
    b.className = "qai";
    b.type = "button";
    b.title = "이 문항을 AI 에게 묻기";
    b.textContent = "AI";
    b.onclick = e => { e.stopPropagation(); openMenu(b); };
    // 삭제 단추 앞에 넣어 오른쪽 끝을 어지럽히지 않는다
    const del = head.querySelector(".delx");
    del ? head.insertBefore(b, del) : head.appendChild(b);
  }
}

/* ── 시작 ──────────────────────────────────────────────────────── */

function start() {
  if (!window.AIChat) { setTimeout(start, 200); return; }

  const st = document.createElement("style");
  st.textContent = BTN_CSS;
  document.head.appendChild(st);

  window.AIChat.setContextProvider(context);

  addButtons();
  // 뷰어는 문항을 그때그때 그리므로, 새로 그려질 때마다 단추를 다시 끼운다
  new MutationObserver(() => addButtons())
    .observe(document.body, { childList: true, subtree: true });

  // 키보드: A 를 누르면 대화창
  document.addEventListener("keydown", e => {
    if (e.key !== "a" && e.key !== "A") return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    e.preventDefault();
    window.AIChat.open();
  });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
else start();
})();
