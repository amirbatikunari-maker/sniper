/* ═══════════════════════════════════════════════════════════════
   simple.js — 화면 간소화 (v205)

   실기뷰어(practice)와 자동변환(ingest)에 단추가 너무 많아서,
   «자주 쓰는 것만» 남기는 모드를 붙인다.

   ── 어떻게 ────────────────────────────────────────────────
   기능을 지우지 않는다. body 에 .simple 을 걸어 두고, 아래 목록에
   적힌 것만 감춘다. 메뉴 옆 «간단히 / 자세히» 로 언제든 되돌린다.
   선택은 이 기기에 남는다.

   ── 왜 지우지 않나 ────────────────────────────────────────
   지우면 그 단추를 잡는 다른 코드가 null 에서 터진다.
   감추기만 하면 코드는 그대로 돌고 화면만 조용해진다.

   ── 목록 고치는 법 ────────────────────────────────────────
   숨기고 싶은 게 더 있으면 ADV 에 id 만 더 적으면 된다.
   반대로 늘 보이게 하려면 그 id 를 목록에서 빼면 된다.
   ═══════════════════════════════════════════════════════════════ */
(function(){
"use strict";
if (window.__simpleUI) return;
window.__simpleUI = true;

const KEY = "app:simple";
const page = (location.pathname.split("/").pop() || "index.html").toLowerCase();

/* 간단히 모드에서 감출 것 — 화면별 */
/* 통째로 접을 블록 — 단추를 하나씩 세는 것보다 이쪽이 훨씬 깔끔하다.
   «2 · 자료함», «3 · PDF 가져오기» 는 이제 검수 화면·자동변환이 대신하고,
   .cvbar 는 변환·해설·잠금·진행바가 몰려 있는 관리용 띠다. */
const BLOCK = {
  "practice.html": [
    ".filters.cvbar", "#boxFiles", "#boxImport",
    /* v207 — 화면 밖에 떠 있던 것들 */
    ".bgm",                     /* 배경 음악 단추와 곡 목록 */
    ".app-float",               /* 오른쪽 아래 동그라미 묶음(위로·전체메뉴·★) — AI 단추만 남김 */
    '#pnav [data-jump]',        /* 처음·끝으로 */
    '#pnav [data-step="-10"]',  /* 10개씩 뛰기 — ‹이전 다음› 만 남김 */
    '#pnav [data-step="10"]'
  ],
  "ingest.html":   []
};

const ADV = {
  "practice.html": [
    /* 변환·해설 만들기 — 검수 화면에서 하면 되는 일 */
    /* 과목 관리 */
    "subAdd","subRen","subDel",
    /* 시험 모드·세션 — 쓸 때만 «자세히» 로 */
    "sessionStart","reviewWrong","reviewMarked","sessionClear","examClose",
    "dpResume","dpWrong","dpMore","studyReset",
    /* 잔가지 */
    "fRand","qRandom","qHelp","filterReset",
    "fImgFix","ovImgFix","ovReformat","ovRfStop","ovCvStop","ovJobX",
    "todoT","srcOnly","pjGo","bgmBtn"
  ],
  "ingest.html": [
    /* 기본 흐름(로그인 → 파일 → 변환 시작 → 올리기) 밖의 것 */
    "runImage","retry","reset","dl",
    "svgMode","hasExp"
  ]
};

/* v214 — 자동변환 탭은 practice.html?only=import 를 창 안에 끼워 넣는다.
   그 창이 보여 주려는 것이 바로 #boxFiles · #boxImport 인데, 여기서 그 둘을
   감춰 버려 «실기 변환» 칸이 통째로 비어 보였다. 그 창은 건드리지 않는다. */
if (location.search.includes("only=import")) return;

const LIST = ADV[page];
if (!LIST) return;                       /* 다른 화면은 건드리지 않음 */

/* ── 스타일 ─────────────────────────────────────── */
const css = document.createElement("style");
css.textContent = `
  body.simple [data-adv]{display:none!important}
  body.simple [data-advrow]{display:none!important}
  .simple-btn{
    margin-left:auto; font:600 12px/1 var(--font-d,system-ui);
    padding:6px 11px; border-radius:999px; cursor:pointer;
    border:1px solid var(--line,#d5dae2); background:transparent;
    color:var(--muted,#64748b); white-space:nowrap;
  }
  .simple-btn.on{
    background:var(--accent,#1f6feb); border-color:var(--accent,#1f6feb); color:#fff;
  }
  .nav3{align-items:center}
`;
document.head.appendChild(css);

/* ── 표시하기 ───────────────────────────────────── */
function mark(){
  (BLOCK[page] || []).forEach(sel =>
    document.querySelectorAll(sel).forEach(el => el.setAttribute("data-adv","1")));
  LIST.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.setAttribute("data-adv", "1");
  });
  /* 안에 있던 것이 전부 감춰져 텅 빈 줄은 그 줄째 감춘다.
     안 그러면 빈 테두리만 남아 오히려 지저분해진다. */
  document.querySelectorAll(".bar,.tools,.row,.btns,.chips,.toolbar,.deck,.panel,.filters")
    .forEach(row => {
      const kids = [...row.children];
      if (!kids.length) return;
      const shown = kids.filter(k => !k.hasAttribute("data-adv"));
      if (!shown.length) row.setAttribute("data-advrow", "1");
      else row.removeAttribute("data-advrow");
    });
}

/* ── 단추 ───────────────────────────────────────── */
function paint(on){
  document.body.classList.toggle("simple", on);
  const b = document.getElementById("simpleToggle");
  if (b){
    b.textContent = on ? "간단히" : "자세히";
    b.classList.toggle("on", on);
    b.title = on
      ? "지금은 자주 쓰는 것만 보이는 중 — 누르면 전부 보임"
      : "모든 단추가 보이는 중 — 누르면 간단히";
  }
}

function boot(){
  mark();

  const nav = document.querySelector(".nav3") || document.querySelector("nav");
  if (nav && !document.getElementById("simpleToggle")){
    const b = document.createElement("button");
    b.id = "simpleToggle"; b.type = "button"; b.className = "simple-btn";
    b.addEventListener("click", () => {
      const next = !document.body.classList.contains("simple");
      try{ localStorage.setItem(KEY, next ? "1" : "0"); }catch(e){}
      paint(next);
      if (next) mark();
    });
    nav.appendChild(b);
  }

  /* 처음 오는 사람은 «간단히» 로 시작한다 — 단추 67개를 한꺼번에
     보여 주는 것보다, 필요할 때 펼치게 하는 편이 낫다. */
  let on = true;
  try{ const v = localStorage.getItem(KEY); if (v !== null) on = v === "1"; }catch(e){}
  paint(on);

  /* 나중에 그려지는 단추도 잡는다 (문항을 다시 그릴 때 등) */
  const mo = new MutationObserver(() => {
    if (document.body.classList.contains("simple")) mark();
  });
  mo.observe(document.body, { childList:true, subtree:true });
}

if (document.readyState === "loading")
  document.addEventListener("DOMContentLoaded", boot);
else boot();
})();
