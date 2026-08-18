/* ═══════════════════════════════════════════════════════════════════════
   ai-chat.js — 안정화 전체 교체본
   뷰어 / 블로그 공용 AI 대화창
   ═══════════════════════════════════════════════════════════════════════ */

(function () {
"use strict";

if (window.AIChat) return;


/* ═══════════════════════════════════════════════════════════════════════
   0. 기본 설정
   ═══════════════════════════════════════════════════════════════════════ */

const CFG  = window.APP_CONFIG || {};
const BASE = (CFG.AI_WORKER_URL || "").replace(/\/+$/, "");
const KEY  = CFG.AI_APP_KEY || "";
const APP  = CFG.AI_APP_NAME ||
  (location.pathname.includes("sniper") ? "blog" : "viewer");


/* 브라우저별 장치 ID */
const DEVICE = (() => {
  try {
    let v = localStorage.getItem("ai:device");

    if (!v) {
      v = crypto.randomUUID
        ? crypto.randomUUID()
        : String(Math.random()).slice(2);

      localStorage.setItem("ai:device", v);
    }

    return v;
  } catch {
    return "anon";
  }
})();


/* Supabase */
const sb =
  (window.supabase &&
   CFG.SUPABASE_URL &&
   CFG.SUPABASE_ANON_KEY)
    ? (
        window.__aiSb ||= window.supabase.createClient(
          CFG.SUPABASE_URL,
          CFG.SUPABASE_ANON_KEY
        )
      )
    : null;


/* ═══════════════════════════════════════════════════════════════════════
   1. 로그인
   ═══════════════════════════════════════════════════════════════════════ */

const ALLOWED =
  (CFG.AI_ALLOWED_EMAILS ||
   CFG.ADMIN_EMAILS ||
   []).map(
     x => String(x).toLowerCase()
   );

let USER = null;
let TOKEN = null;

async function readSession() {
  if (!sb) {
    USER = null;
    TOKEN = null;
    return null;
  }

  try {
    const { data } = await sb.auth.getSession();
    const ses = data?.session || null;

    USER  = ses?.user || null;
    TOKEN = ses?.access_token || null;
  } catch {
    USER = null;
    TOKEN = null;
  }

  return USER;
}

function allowed() {
  if (!USER) return false;
  if (!ALLOWED.length) return true;

  return ALLOWED.includes(
    (USER.email || "").toLowerCase()
  );
}

async function doLogin(email, password) {
  if (!sb) {
    throw new Error(
      "Supabase 연결이 없습니다. config.js를 확인해 주세요."
    );
  }

  const { error } =
    await sb.auth.signInWithPassword({
      email,
      password
    });

  if (error) {
    throw new Error(
      /invalid/i.test(error.message)
        ? "이메일이나 비밀번호가 맞지 않습니다."
        : error.message
    );
  }

  await readSession();

  if (!allowed()) {
    await sb.auth.signOut();
    await readSession();

    throw new Error(
      "이 계정에는 AI 사용 권한이 없습니다."
    );
  }
}

async function doLogout() {
  try {
    await sb?.auth.signOut();
  } catch {}

  await readSession();
}


/* ═══════════════════════════════════════════════════════════════════════
   2. 모델
   ═══════════════════════════════════════════════════════════════════════ */

let CATALOG = {

  openai: [
    {
      id: "gpt-5.6-sol",
      label: "GPT · 최고급"
    },
    {
      id: "gpt-5.6-terra",
      label: "GPT · 균형"
    },
    {
      id: "gpt-5.6-luna",
      label: "GPT · 빠름"
    }
  ],

  gemini: [
    {
      id: "gemini-3.5-flash",
      label: "Gemini · 최고급"
    },
    {
      id: "gemini-3.6-flash",
      label: "Gemini · 균형"
    },
    {
      id: "gemini-3.5-flash-lite",
      label: "Gemini · 빠름"
    }
  ]

};

let DEFAULTS = {
  openai: "gpt-5.6-terra",
  gemini: "gemini-3.6-flash"
};

const TIER = [
  "균형",
  "최고급",
  "빠름"
];


const state = {

  mode: load(
    "ai:mode",
    "auto"
  ),

  tier: load(
    "ai:tier",
    "균형"
  ),

  model: null,

  thread: null,

  msgs: [],

  files: [],

  ctx: null,

  ctxFn: null,

  busy: false,

  abort: null

};


function load(k, d) {
  try {
    return localStorage.getItem(k) || d;
  } catch {
    return d;
  }
}

function save(k, v) {
  try {
    localStorage.setItem(k, v);
  } catch {}
}


function pickFrom(provider, tier) {

  const list =
    CATALOG[provider] || [];

  const exact =
    list.find(
      m =>
        m &&
        m.id &&
        (m.label || "").includes(tier)
    );

  if (exact) {
    return exact.id;
  }

  const first =
    list.find(
      m => m && m.id
    );

  if (first) {
    return first.id;
  }

  return DEFAULTS[provider] || "";
}


/* ═══════════════════════════════════════════════════════════════════════
   자동 모델 선택
   ═══════════════════════════════════════════════════════════════════════ */

function autoPick(text, files) {

  const t =
    (text || "").toLowerCase();

  const hasImage =
    files.some(
      f => /^image\//i.test(f.mime)
    );

  const hasDoc =
    files.some(
      f => !/^image\//i.test(f.mime)
    );

  const long =
    (text || "").length > 700;

  const coding =
    /코드|코딩|디버그|오류|버그|javascript|typescript|python|sql|html|css|react|node|api|알고리즘|정규식|자바/
      .test(t);

  const heavy =
    /분석|검토|설계|계산|증명|비교|정리해|보고서|근거|왜|이유|오답|풀이|해설|전략/
      .test(t);

  const quick =
    /번역|요약해?줘|맞아|뜻|무슨 ?뜻|용어|한 ?줄/
      .test(t) &&
    !heavy &&
    !coding;


  /*
    이미지 / PDF / 문서
    → Gemini
  */
  if (hasImage || hasDoc) {

    const tier =
      heavy || long
        ? "최고급"
        : "균형";

    return {
      provider: "gemini",
      model: pickFrom(
        "gemini",
        tier
      ),
      tier
    };
  }


  /*
    코드 / 복잡한 분석
    → GPT 최고급
  */
  if (coding || heavy || long) {

    return {
      provider: "openai",
      model: pickFrom(
        "openai",
        "최고급"
      ),
      tier: "최고급"
    };
  }


  /*
    짧은 질문
    → Gemini 빠름
  */
  if (quick) {

    return {
      provider: "gemini",
      model: pickFrom(
        "gemini",
        "빠름"
      ),
      tier: "빠름"
    };
  }


  /*
    일반 질문
    → GPT 균형
  */
  return {
    provider: "openai",
    model: pickFrom(
      "openai",
      "균형"
    ),
    tier: "균형"
  };
}


function resolveModel(text) {

  if (state.mode === "auto") {
    return autoPick(
      text,
      state.files
    );
  }

  const provider =
    state.mode;

  return {
    provider,
    model: pickFrom(
      provider,
      state.tier
    ),
    tier: state.tier
  };
}


/* Worker에서 모델 목록 가져오기 */

async function loadCatalog() {

  if (!BASE) return;

  try {

    const r =
      await fetch(
        BASE + "/ai/models",
        {
          headers:
            KEY
              ? {
                  "x-app-key": KEY
                }
              : {}
        }
      );

    if (!r.ok) return;

    const d =
      await r.json();

    if (d.catalog) {
      CATALOG = d.catalog;
    }

    if (d.defaults) {
      DEFAULTS = d.defaults;
    }

    renderModelBar();
    renderHint();

  } catch {}
}


/* ═══════════════════════════════════════════════════════════════════════
   3. CSS
   ═══════════════════════════════════════════════════════════════════════ */

const CSS = `

.aic-fab{
  position:fixed;
  right:14px;
  bottom:calc(14px + env(safe-area-inset-bottom));
  z-index:9998;
  width:52px;
  height:52px;
  border-radius:50%;
  border:1px solid var(--rule,#d5dae2);
  background:var(--accent,#1D4ED8);
  color:#fff;
  font:600 13px/1 var(--font-d,system-ui);
  box-shadow:0 6px 22px -8px rgba(0,0,0,.5);
  cursor:pointer;
  display:flex;
  align-items:center;
  justify-content:center
}

.aic-fab:active{
  transform:scale(.94)
}

.aic-fab[hidden]{
  display:none
}

.aic-wrap{
  position:fixed;
  inset:0;
  z-index:9999;
  display:none
}

.aic-wrap.on{
  display:block
}

.aic-veil{
  position:absolute;
  inset:0;
  background:rgba(10,18,30,.38);
  backdrop-filter:blur(2px)
}

.aic-panel{
  position:absolute;
  right:0;
  top:0;
  bottom:0;
  width:min(460px,100%);
  background:var(--card,#fff);
  color:var(--ink,#10233D);
  display:flex;
  flex-direction:column;
  border-left:1px solid var(--rule,#d5dae2);
  box-shadow:-18px 0 40px -30px rgba(0,0,0,.6)
}

@media(max-width:560px){

  .aic-panel{
    width:100%;
    top:auto;
    height:88dvh;
    border-radius:16px 16px 0 0;
    border-left:0;
    border-top:1px solid var(--rule,#d5dae2)
  }

}

.aic-head{
  display:flex;
  align-items:center;
  gap:8px;
  padding:10px 12px;
  border-bottom:1px solid var(--rule,#e2e6ec);
  flex:0 0 auto
}

.aic-title{
  font:700 15px/1.2 var(--font-d,system-ui);
  margin-right:auto
}

.aic-ico{
  width:34px;
  height:34px;
  border-radius:9px;
  border:1px solid var(--rule,#e2e6ec);
  background:transparent;
  color:inherit;
  cursor:pointer;
  font-size:15px;
  display:flex;
  align-items:center;
  justify-content:center
}

.aic-bar{
  display:flex;
  gap:6px;
  padding:8px 12px;
  border-bottom:1px solid var(--rule,#e2e6ec);
  overflow-x:auto;
  flex:0 0 auto;
  scrollbar-width:none
}

.aic-bar::-webkit-scrollbar{
  display:none
}

.aic-chip{
  flex:0 0 auto;
  padding:5px 11px;
  border-radius:999px;
  border:1px solid var(--rule,#dfe3ea);
  background:transparent;
  color:var(--ink-2,#5A6B7F);
  font:600 12px/1.3 var(--font-d,system-ui);
  cursor:pointer;
  white-space:nowrap
}

.aic-chip.on{
  background:var(--accent,#1D4ED8);
  border-color:var(--accent,#1D4ED8);
  color:#fff
}

.aic-sep{
  flex:0 0 auto;
  width:1px;
  background:var(--rule,#e2e6ec);
  margin:2px 3px
}

.aic-log{
  flex:1 1 auto;
  overflow-y:auto;
  padding:14px 12px 4px;
  display:flex;
  flex-direction:column;
  gap:12px;
  -webkit-overflow-scrolling:touch;
  overscroll-behavior:contain
}

.aic-row{
  display:flex;
  flex-direction:column;
  gap:5px;
  max-width:100%
}

.aic-row.me{
  align-items:flex-end
}

.aic-bub{
  max-width:92%;
  padding:9px 12px;
  border-radius:14px;
  font:400 14.5px/1.68 var(--font-b,system-ui);
  word-break:break-word;
  white-space:normal
}

.aic-row.me .aic-bub{
  background:var(--accent-soft,#E4ECFD);
  border-bottom-right-radius:5px
}

.aic-row.ai .aic-bub{
  background:var(--paper,#f3f5f8);
  border:1px solid var(--rule,#e6eaf0);
  border-bottom-left-radius:5px
}

.aic-bub p{
  margin:.42em 0
}

.aic-bub h1,
.aic-bub h2,
.aic-bub h3{
  margin:.7em 0 .3em;
  font-weight:700
}

.aic-bub ul,
.aic-bub ol{
  margin:.4em 0;
  padding-left:1.25em
}

.aic-bub li{
  margin:.16em 0
}

.aic-bub code{
  font:500 .9em/1.5 var(--font-m,ui-monospace);
  background:rgba(125,140,160,.16);
  padding:1px 5px;
  border-radius:5px
}

.aic-bub pre{
  background:rgba(125,140,160,.13);
  padding:10px 12px;
  border-radius:10px;
  overflow-x:auto
}

.aic-bub pre code{
  background:none;
  padding:0
}

.aic-bub table{
  border-collapse:collapse;
  margin:.5em 0;
  font-size:.92em;
  width:100%
}

.aic-bub th,
.aic-bub td{
  border:1px solid var(--rule,#dde2e9);
  padding:4px 8px;
  text-align:left
}

.aic-bub blockquote{
  border-left:3px solid var(--rule,#cfd6e0);
  margin:.5em 0;
  padding:.1em 0 .1em .8em;
  color:var(--ink-2,#5A6B7F)
}

.aic-meta{
  font:500 11px/1 var(--font-m,ui-monospace);
  color:var(--ink-2,#8894a5);
  padding:0 4px
}

.aic-thumbs{
  display:flex;
  gap:6px;
  flex-wrap:wrap;
  padding:0 4px
}

.aic-thumb{
  width:60px;
  height:60px;
  border-radius:9px;
  object-fit:cover;
  border:1px solid var(--rule,#dde2e9)
}

.aic-fileTag{
  display:inline-flex;
  align-items:center;
  gap:5px;
  padding:4px 9px;
  border-radius:8px;
  background:var(--paper,#f0f2f6);
  border:1px solid var(--rule,#dde2e9);
  font:600 11.5px/1.3 var(--font-d,system-ui)
}

.aic-foot{
  flex:0 0 auto;
  border-top:1px solid var(--rule,#e2e6ec);
  padding:8px 10px calc(8px + env(safe-area-inset-bottom));
  background:var(--card,#fff)
}

.aic-tray{
  display:flex;
  gap:6px;
  flex-wrap:wrap;
  margin-bottom:6px
}

.aic-tray:empty{
  display:none
}

.aic-pill{
  display:inline-flex;
  align-items:center;
  gap:6px;
  padding:4px 6px 4px 9px;
  border-radius:999px;
  background:var(--paper,#f0f2f6);
  border:1px solid var(--rule,#dde2e9);
  font:600 11.5px/1.3 var(--font-d,system-ui);
  max-width:210px
}

.aic-pill span{
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap
}

.aic-pill b{
  cursor:pointer;
  color:var(--ink-2,#8894a5);
  font-weight:700
}

.aic-inputRow{
  display:flex;
  align-items:flex-end;
  gap:6px
}

.aic-ta{
  flex:1 1 auto;
  resize:none;
  max-height:34dvh;
  min-height:44px;
  padding:10px 12px;
  border-radius:12px;
  border:1px solid var(--rule,#dde2e9);
  background:var(--paper,#f7f8fa);
  color:inherit;
  font:400 15px/1.5 var(--font-b,system-ui);
  outline:none
}

.aic-send{
  flex:0 0 auto;
  width:44px;
  height:44px;
  border-radius:12px;
  border:0;
  background:var(--accent,#1D4ED8);
  color:#fff;
  font-size:17px;
  cursor:pointer
}

.aic-hint{
  font:500 11px/1.5 var(--font-d,system-ui);
  color:var(--ink-2,#8894a5);
  padding:5px 3px 0
}

.aic-err{
  margin:6px 12px;
  padding:8px 11px;
  border-radius:9px;
  background:#fdecec;
  border:1px solid #f3c4c2;
  color:#8d2420;
  font:500 12.5px/1.55 var(--font-d,system-ui)
}

.aic-lock{
  display:flex;
  flex-direction:column;
  gap:9px;
  padding:6px 2px
}

.aic-lock h4{
  margin:0;
  font:700 15.5px/1.4 var(--font-d,system-ui)
}

.aic-lock input{
  padding:10px 12px;
  border-radius:10px;
  border:1px solid var(--rule,#dde2e9);
  background:var(--paper,#f7f8fa);
  color:inherit;
  font:400 15px/1.4 var(--font-b,system-ui);
  outline:none
}

.aic-lock button{
  padding:10px 14px;
  border-radius:10px;
  border:0;
  background:var(--accent,#1D4ED8);
  color:#fff;
  font:600 14px/1.2 var(--font-d,system-ui);
  cursor:pointer
}

.aic-who{
  font:600 11px/1 var(--font-m,ui-monospace);
  color:var(--ink-2,#8894a5);
  max-width:120px;
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap
}

.aic-dots::after{
  content:"";
  animation:aicDots 1.1s steps(4,end) infinite
}

@keyframes aicDots{
  0%{content:""}
  25%{content:"·"}
  50%{content:"··"}
  75%{content:"···"}
}

`;


/* ═══════════════════════════════════════════════════════════════════════
   4. DOM
   ═══════════════════════════════════════════════════════════════════════ */

let el = {};

function build() {

  const st =
    document.createElement("style");

  st.textContent = CSS;
  document.head.appendChild(st);


  const fab =
    document.createElement("button");

  fab.className =
    "aic-fab";

  fab.type =
    "button";

  fab.title =
    "AI에게 묻기";

  fab.textContent =
    "AI";

  fab.onclick =
    open;

  document.body.appendChild(fab);


  const wrap =
    document.createElement("div");

  wrap.className =
    "aic-wrap";

  wrap.innerHTML = `

    <div class="aic-veil"></div>

    <div
      class="aic-panel"
      role="dialog"
      aria-label="AI 대화"
    >

      <div class="aic-head">

        <div class="aic-title">
          AI에게 묻기
        </div>

        <span
          class="aic-who"
          id="aicWho"
        ></span>

        <button
          class="aic-ico"
          data-act="user"
          title="계정"
        >👤</button>

        <button
          class="aic-ico"
          data-act="history"
          title="지난 대화"
        >🕘</button>

        <button
          class="aic-ico"
          data-act="new"
          title="새 대화"
        >✚</button>

        <button
          class="aic-ico"
          data-act="close"
          title="닫기"
        >✕</button>

      </div>

      <div class="aic-bar"></div>

      <div class="aic-log"></div>

      <div class="aic-foot">

        <div class="aic-tray"></div>

        <div class="aic-inputRow">

          <button
            class="aic-ico"
            data-act="attach"
            title="사진·파일 붙이기"
          >📎</button>

          <textarea
            class="aic-ta"
            rows="1"
            placeholder="무엇이든 물어보세요"
          ></textarea>

          <button
            class="aic-send"
            title="보내기"
          >➤</button>

        </div>

        <div class="aic-hint"></div>

      </div>

      <input
        type="file"
        multiple
        hidden
        accept="image/*,.pdf,.txt,.md,.csv,.json,.js,.ts,.py,.sql,.html,.css,.log"
      >

    </div>
  `;

  document.body.appendChild(wrap);


  el = {

    fab,

    wrap,

    panel:
      wrap.querySelector(".aic-panel"),

    veil:
      wrap.querySelector(".aic-veil"),

    bar:
      wrap.querySelector(".aic-bar"),

    log:
      wrap.querySelector(".aic-log"),

    tray:
      wrap.querySelector(".aic-tray"),

    ta:
      wrap.querySelector(".aic-ta"),

    send:
      wrap.querySelector(".aic-send"),

    hint:
      wrap.querySelector(".aic-hint"),

    file:
      wrap.querySelector(
        'input[type="file"]'
      )
  };


  el.veil.onclick =
    close;

  wrap.querySelector(
    '[data-act="close"]'
  ).onclick =
    close;

  wrap.querySelector(
    '[data-act="new"]'
  ).onclick =
    newThread;

  wrap.querySelector(
    '[data-act="history"]'
  ).onclick =
    showHistory;


  wrap.querySelector(
    '[data-act="user"]'
  ).onclick =
    async () => {

      if (USER && allowed()) {

        if (
          !confirm(
            `${USER.email}에서 로그아웃할까요?`
          )
        ) {
          return;
        }

        if (state.busy) {
          stop();
        }

        await doLogout();

        newThread();
      }

      await refreshGate();
    };


  wrap.querySelector(
    '[data-act="attach"]'
  ).onclick =
    () => el.file.click();


  el.file.onchange =
    e => {

      attachFiles(
        e.target.files
      );

      e.target.value =
        "";
    };


  el.send.onclick =
    () => {

      if (state.busy) {
        stop();
      } else {
        send();
      }

    };


  el.ta.addEventListener(
    "input",
    () => {

      el.ta.style.height =
        "auto";

      el.ta.style.height =
        Math.min(
          el.ta.scrollHeight,
          window.innerHeight * .34
        ) + "px";

      renderHint();
    }
  );


  el.ta.addEventListener(
    "keydown",
    e => {

      /*
        Ctrl+Enter / Cmd+Enter
      */
      if (
        e.key === "Enter" &&
        (e.ctrlKey || e.metaKey)
      ) {

        e.preventDefault();

        send();
      }

    }
  );


  /*
    붙여넣기
  */
  el.panel.addEventListener(
    "paste",
    e => {

      const fs =
        [...(
          e.clipboardData?.files || []
        )];

      if (fs.length) {

        e.preventDefault();

        attachFiles(fs);
      }

    }
  );


  /*
    드래그앤드롭
  */
  el.panel.addEventListener(
    "dragover",
    e =>
      e.preventDefault()
  );

  el.panel.addEventListener(
    "drop",
    e => {

      if (
        e.dataTransfer?.files?.length
      ) {

        e.preventDefault();

        attachFiles(
          e.dataTransfer.files
        );
      }

    }
  );


  document.addEventListener(
    "keydown",
    e => {

      if (
        e.key === "Escape" &&
        el.wrap.classList.contains("on")
      ) {
        close();
      }

    }
  );


  renderModelBar();
  renderHint();
}


/* ═══════════════════════════════════════════════════════════════════════
   5. 모델 UI
   ═══════════════════════════════════════════════════════════════════════ */

function renderModelBar() {

  if (!el.bar) return;

  const modes = [
    ["auto", "자동"],
    ["openai", "GPT"],
    ["gemini", "Gemini"]
  ];

  let html =
    modes.map(
      ([k, t]) => `
        <button
          class="aic-chip${state.mode === k ? " on" : ""}"
          data-mode="${k}"
        >${t}</button>
      `
    ).join("");


  if (state.mode !== "auto") {

    html +=
      `<div class="aic-sep"></div>` +

      TIER.map(
        t => `
          <button
            class="aic-chip${state.tier === t ? " on" : ""}"
            data-tier="${t}"
          >${t}</button>
        `
      ).join("");
  }


  el.bar.innerHTML =
    html;


  el.bar
    .querySelectorAll(
      "[data-mode]"
    )
    .forEach(
      b => {

        b.onclick =
          () => {

            state.mode =
              b.dataset.mode;

            save(
              "ai:mode",
              state.mode
            );

            renderModelBar();
            renderHint();
          };

      }
    );


  el.bar
    .querySelectorAll(
      "[data-tier]"
    )
    .forEach(
      b => {

        b.onclick =
          () => {

            state.tier =
              b.dataset.tier;

            save(
              "ai:tier",
              state.tier
            );

            renderModelBar();
            renderHint();
          };

      }
    );

}


function renderHint() {

  if (!el.hint) return;

  if (!BASE) {

    el.hint.innerHTML =
      `⚠ config.js에 <b>AI_WORKER_URL</b>을 넣어 주세요.`;

    return;
  }

  const p =
    resolveModel(
      el.ta?.value || ""
    );


  el.hint.textContent =
    state.mode === "auto"

      ? `자동 — ${p.model || "Worker 모델"}`
      
      : (
          p.model ||
          "Worker 모델"
        );
}


/* ═══════════════════════════════════════════════════════════════════════
   6. 첨부 파일
   ═══════════════════════════════════════════════════════════════════════ */

const IMG =
  /^image\//i;

const TEXTY =
  /\.(txt|md|csv|json|js|ts|jsx|tsx|py|sql|html|css|log|ya?ml|ini|conf|sh)$/i;


function fileToBase64(file) {

  return new Promise(
    (resolve, reject) => {

      const r =
        new FileReader();

      r.onload =
        () =>
          resolve(
            String(r.result)
              .split(",")[1] || ""
          );

      r.onerror =
        reject;

      r.readAsDataURL(file);
    }
  );
}


async function shrinkImage(
  file,
  max = 1400,
  quality = .82
) {

  try {

    const bmp =
      await createImageBitmap(file);


    if (
      Math.max(
        bmp.width,
        bmp.height
      ) <= max &&
      file.size <
        900 * 1024
    ) {

      return file;
    }


    const scale =
      max /
      Math.max(
        bmp.width,
        bmp.height
      );


    const w =
      Math.round(
        bmp.width * scale
      );

    const h =
      Math.round(
        bmp.height * scale
      );


    const cv =
      document.createElement(
        "canvas"
      );

    cv.width =
      w;

    cv.height =
      h;


    cv.getContext(
      "2d"
    ).drawImage(
      bmp,
      0,
      0,
      w,
      h
    );


    const blob =
      await new Promise(
        resolve =>
          cv.toBlob(
            resolve,
            "image/jpeg",
            quality
          )
      );


    return blob
      ? new File(
          [blob],
          file.name.replace(
            /\.\w+$/,
            ""
          ) + ".jpg",
          {
            type:
              "image/jpeg"
          }
        )
      : file;

  } catch {

    return file;
  }
}


/* ═══════════════════════════════════════════════════════════════════════
   PDF.js
   ═══════════════════════════════════════════════════════════════════════ */

let pdfjsReady =
  null;


function loadPdfjs() {

  if (window.pdfjsLib) {
    return Promise.resolve(
      window.pdfjsLib
    );
  }


  return (
    pdfjsReady ||=
      new Promise(
        (resolve, reject) => {

          const s =
            document.createElement(
              "script"
            );

          s.src =
            "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js";


          s.onload =
            () => {

              window.pdfjsLib
                .GlobalWorkerOptions
                .workerSrc =
                  "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";

              resolve(
                window.pdfjsLib
              );
            };


          s.onerror =
            reject;

          document.head.appendChild(s);
        }
      )
  );
}


async function pdfToText(
  file,
  maxPages = 30
) {

  const lib =
    await loadPdfjs();


  const buf =
    await file.arrayBuffer();


  const doc =
    await lib
      .getDocument({
        data: buf
      })
      .promise;


  const total =
    Math.min(
      doc.numPages,
      maxPages
    );


  const out = [];


  for (
    let i = 1;
    i <= total;
    i++
  ) {

    const page =
      await doc.getPage(i);


    const tc =
      await page.getTextContent();


    out.push(
      `— ${i}쪽 —\n` +
      tc.items
        .map(
          t => t.str
        )
        .join(" ")
    );
  }


  if (
    doc.numPages >
    total
  ) {

    out.push(
      `(전체 ${doc.numPages}쪽 중 ${total}쪽까지만 읽었습니다)`
    );
  }


  return out.join(
    "\n\n"
  );
}


async function attachFiles(list) {

  const files =
    [...list];


  for (
    const f of files
  ) {

    const id =
      Math.random()
        .toString(36)
        .slice(2);


    const item = {

      id,

      name:
        f.name,

      mime:
        f.type ||
        "application/octet-stream",

      size:
        f.size,

      status:
        "읽는 중"

    };


    state.files.push(
      item
    );

    renderTray();


    try {

      if (
        IMG.test(f.type)
      ) {

        const small =
          await shrinkImage(f);

        item.mime =
          small.type;

        item.data =
          await fileToBase64(
            small
          );

        item.preview =
          URL.createObjectURL(
            small
          );

        item.status =
          "";


      } else if (
        /pdf$/i.test(f.type) ||
        /\.pdf$/i.test(f.name)
      ) {

        item.text =
          await pdfToText(f);

        item.kind =
          "text";

        item.status =
          item.text.trim()
            ? ""
            : "글자를 못 찾음(사진 PDF일 수 있어요)";


      } else if (
        TEXTY.test(f.name) ||
        /^text\//.test(f.type)
      ) {

        item.text =
          (
            await f.text()
          ).slice(
            0,
            200000
          );

        item.kind =
          "text";

        item.status =
          "";


      } else {

        item.status =
          "지원하지 않는 형식";

        item.bad =
          true;
      }


    } catch (e) {

      item.status =
        "읽기 실패: " +
        (e.message || e);

      item.bad =
        true;
    }


    renderTray();
  }
}


function renderTray() {

  if (!el.tray) return;


  el.tray.innerHTML =
    state.files.map(
      f => `
        <span
          class="aic-pill"
          title="${esc(f.name)}"
        >
          ${
            f.preview
              ? `
                <img
                  src="${f.preview}"
                  style="
                    width:20px;
                    height:20px;
                    border-radius:4px;
                    object-fit:cover
                  "
                >
              `
              : "📄"
          }

          <span>
            ${esc(f.name)}
            ${
              f.status
                ? " · " +
                  esc(f.status)
                : ""
            }
          </span>

          <b data-rm="${f.id}">
            ✕
          </b>

        </span>
      `
    ).join("");


  el.tray
    .querySelectorAll(
      "[data-rm]"
    )
    .forEach(
      b => {

        b.onclick =
          () => {

            state.files =
              state.files.filter(
                f =>
                  f.id !==
                  b.dataset.rm
              );

            renderTray();
            renderHint();
          };

      }
    );
}


/* ═══════════════════════════════════════════════════════════════════════
   7. Markdown
   ═══════════════════════════════════════════════════════════════════════ */

function esc(s) {

  return String(
    s ?? ""
  ).replace(
    /[&<>"']/g,
    c => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[c])
  );
}


function md(src) {

  const blocks = [];

  let s =
    esc(src || "");


  s =
    s.replace(
      /```(\w*)\n?([\s\S]*?)```/g,
      (_, lang, code) => {

        blocks.push(
          `<pre><code data-lang="${lang}">${
            code.replace(
              /\n$/,
              ""
            )
          }</code></pre>`
        );

        return (
          "" +
          (blocks.length - 1) +
          ""
        );
      }
    );


  s =
    s.replace(
      /`([^`\n]+)`/g,
      "<code>$1</code>"
    );

  s =
    s.replace(
      /\*\*([^*\n]+)\*\*/g,
      "<strong>$1</strong>"
    );

  s =
    s.replace(
      /(^|[^*])\*([^*\n]+)\*/g,
      "$1<em>$2</em>"
    );

  s =
    s.replace(
      /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener">$1</a>'
    );


  const out = [];

  let list = null;
  let para = [];
  let table = null;


  function flushPara() {

    if (!para.length)
      return;

    out.push(
      `<p>${para.join("<br>")}</p>`
    );

    para = [];
  }


  function flushList() {

    if (!list)
      return;

    out.push(
      `</${list}>`
    );

    list =
      null;
  }


  function flushTable() {

    if (!table)
      return;

    out.push(
      `<table>${table.join("")}</table>`
    );

    table =
      null;
  }


  function flushAll() {

    flushPara();
    flushList();
    flushTable();
  }


  for (
    const raw
    of s.split("\n")
  ) {

    const line =
      raw.trimEnd();


    if (
      /^\d+$/.test(
        line.trim()
      )
    ) {

      flushAll();

      out.push(
        line.trim()
      );

      continue;
    }


    if (!line.trim()) {

      flushAll();

      continue;
    }


    let m;


    if (
      (m =
        line.match(
          /^(#{1,4})\s+(.*)$/
        ))
    ) {

      flushAll();

      const h =
        Math.min(
          m[1].length + 1,
          4
        );

      out.push(
        `<h${h}>${m[2]}</h${h}>`
      );


    } else if (
      /^\s*[-*\u2022]\s+/.test(
        line
      )
    ) {

      flushPara();
      flushTable();

      if (list !== "ul") {
        flushList();
        out.push("<ul>");
        list = "ul";
      }

      out.push(
        `<li>${
          line.replace(
            /^\s*[-*\u2022]\s+/,
            ""
          )
        }</li>`
      );


    } else if (
      /^\s*\d+[.)]\s+/.test(
        line
      )
    ) {

      flushPara();
      flushTable();

      if (list !== "ol") {
        flushList();
        out.push("<ol>");
        list = "ol";
      }

      out.push(
        `<li>${
          line.replace(
            /^\s*\d+[.)]\s+/,
            ""
          )
        }</li>`
      );


    } else if (
      /^&gt;\s?/.test(
        line
      )
    ) {

      flushAll();

      out.push(
        `<blockquote>${
          line.replace(
            /^&gt;\s?/,
            ""
          )
        }</blockquote>`
      );


    } else if (
      /^\s*\|.*\|\s*$/.test(
        line
      )
    ) {

      flushPara();
      flushList();


      const cells =
        line
          .trim()
          .replace(
            /^\||\|$/g,
            ""
          )
          .split("|")
          .map(
            c => c.trim()
          );


      if (
        cells.every(
          c =>
            /^:?-{2,}:?$/.test(c)
        )
      ) {
        continue;
      }


      const head =
        table === null;

      const tag =
        head
          ? "th"
          : "td";

      if (head)
        table = [];


      table.push(
        `<tr>${
          cells
            .map(
              c =>
                `<${tag}>${c}</${tag}>`
            )
            .join("")
        }</tr>`
      );


    } else if (
      /^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(
        line
      )
    ) {

      flushAll();

      out.push("<hr>");


    } else {

      flushList();
      flushTable();

      para.push(
        line.trim()
      );
    }
  }


  flushAll();


  return out
    .join("\n")
    .replace(
      /(\d+)/g,
      (_, i) =>
        blocks[+i] || ""
    );
}


/* ═══════════════════════════════════════════════════════════════════════
   8. 화면 렌더링
   ═══════════════════════════════════════════════════════════════════════ */

function bubble(
  role,
  html,
  meta
) {

  const row =
    document.createElement(
      "div"
    );

  row.className =
    "aic-row " +
    (
      role === "user"
        ? "me"
        : "ai"
    );


  row.innerHTML =
    (
      meta
        ? `
          <div class="aic-meta">
            ${esc(meta)}
          </div>
        `
        : ""
    ) +
    `
      <div class="aic-bub">
        ${html}
      </div>
    `;


  el.log.appendChild(
    row
  );


  scroll();


  return row.querySelector(
    ".aic-bub"
  );
}


function scroll() {

  requestAnimationFrame(
    () => {
      el.log.scrollTop =
        el.log.scrollHeight;
    }
  );
}


function showErr(msg) {

  const d =
    document.createElement(
      "div"
    );

  d.className =
    "aic-err";

  d.textContent =
    msg;

  el.log.appendChild(
    d
  );

  scroll();
}


/*
  ★★★★★ 핵심 수정 ★★★★★

  AI 생성 중에는 절대 전체 대화를 다시 그리지 않는다.
*/
function redraw() {

  if (state.busy)
    return;


  el.log.innerHTML =
    "";


  if (!state.msgs.length) {

    const c =
      currentContext();


    const ctxLine =
      c?.label
        ? `
          <p style="color:var(--ink-2,#8894a5)">
            지금 보고 있는 것:
            <b>${esc(c.label)}</b>
            — 그대로 물어보시면 됩니다.
          </p>
        `
        : "";


    bubble(
      "assistant",
      `
        <p>
          <b>무엇을 도와드릴까요?</b>
        </p>

        ${ctxLine}

        <ul>

          <li>
            사진·PDF를 붙이면
            읽고 분석해 드립니다.
          </li>

          <li>
            위쪽에서
            <b>GPT / Gemini</b>를
            선택할 수 있습니다.
          </li>

          <li>
            <b>자동</b>으로 두면
            질문 성격에 따라
            모델을 자동 선택합니다.
          </li>

        </ul>
      `
    );

    return;
  }


  for (
    const m of state.msgs
  ) {

    const thumbs =
      (m.files || [])
        .filter(
          f => f.preview
        )
        .map(
          f =>
            `<img
              class="aic-thumb"
              src="${f.preview}"
            >`
        )
        .join("");


    const tags =
      (m.files || [])
        .filter(
          f => !f.preview
        )
        .map(
          f =>
            `<span class="aic-fileTag">
              📄 ${esc(f.name)}
            </span>`
        )
        .join(" ");


    const b =
      bubble(
        m.role === "user"
          ? "user"
          : "assistant",
        md(m.content),
        m.meta
      );


    if (
      thumbs ||
      tags
    ) {

      const holder =
        document.createElement(
          "div"
        );

      holder.className =
        "aic-thumbs";

      holder.innerHTML =
        thumbs + tags;


      b.parentElement.insertBefore(
        holder,
        b
      );
    }
  }


  scroll();
}


/* ═══════════════════════════════════════════════════════════════════════
   9. Context
   ═══════════════════════════════════════════════════════════════════════ */

function currentContext() {

  if (state.ctxFn) {

    try {
      return (
        state.ctxFn() ||
        state.ctx
      );
    } catch {
      return state.ctx;
    }
  }

  return state.ctx;
}


function buildSystem() {

  let s = `

당신은 이 웹앱의 한국어 AI 실무 조수입니다.

답변 원칙:

1. 질문의 핵심부터 답합니다.
2. 불필요하게 장황하게 설명하지 않습니다.
3. 모르는 것은 추측해서 단정하지 않습니다.
4. 숫자와 단위는 정확하게 표현합니다.
5. 현재 화면과 첨부파일을 우선적으로 참고합니다.
6. 코드 질문이면 실제 수정 위치와 수정 방법을 구체적으로 말합니다.
7. 질문이 짧으면 답변도 짧게 합니다.
8. 복잡한 문제는 단계적으로 정리합니다.
9. 한국어로 답합니다.

`;


  const ctx =
    currentContext();


  if (ctx?.system) {
    s +=
      "\n\n" +
      ctx.system;
  }


  if (ctx?.text) {

    s +=
      "\n\n[사용자가 지금 보고 있는 화면]\n" +
      String(
        ctx.text
      ).slice(
        0,
        6000
      );
  }


  return s;
}


/* ═══════════════════════════════════════════════════════════════════════
   10. 서버 전송 형식
   ═══════════════════════════════════════════════════════════════════════ */

function toWire(msgs) {

  return msgs.map(
    m => {

      let content =
        m.content || "";

      const files = [];


      for (
        const f of
        (m.files || [])
      ) {

        if (f.bad)
          continue;


        if (
          f.kind === "text" &&
          f.text
        ) {

          content +=
            `\n\n[붙임 · ${f.name}]\n${f.text}`;


        } else if (
          f.data
        ) {

          files.push({

            mime:
              f.mime,

            data:
              f.data,

            name:
              f.name
          });
        }
      }


      return {
        role:
          m.role,

        content,

        files
      };
    }
  );
}


/* ═══════════════════════════════════════════════════════════════════════
   11. 보내기
   ═══════════════════════════════════════════════════════════════════════ */

async function send(preset) {

  if (state.busy)
    return;


  const text =
    (
      preset ??
      el.ta.value
    ).trim();


  const files =
    state.files.filter(
      f => !f.bad
    );


  if (
    !text &&
    !files.length
  ) {
    return;
  }


  if (!BASE) {

    showErr(
      "config.js에 AI_WORKER_URL이 없습니다."
    );

    return;
  }


  /*
    로그인 확인
  */
  await readSession();


  if (!allowed()) {

    await refreshGate(
      "로그인이 풀렸습니다. 다시 들어와 주세요."
    );

    return;
  }


  /*
    ★★★★★
    여기부터 busy=true.

    이후 refreshGate/redraw가
    대화를 덮지 못하게 한다.
  */
  state.busy =
    true;


  const pick =
    resolveModel(
      text
    );


  /*
    첨부파일을 메시지에 고정
  */
  const sentFiles =
    files.map(
      f => ({
        ...f
      })
    );


  /*
    ★ 사용자 질문을 먼저 state에 저장
  */
  state.msgs.push({

    role:
      "user",

    content:
      text,

    files:
      sentFiles

  });


  state.files =
    [];

  el.ta.value =
    "";

  el.ta.style.height =
    "auto";

  renderTray();


  /*
    ★ redraw()를 쓰지 않는다.
    사용자 메시지를 직접 그린다.
  */

  const userThumbs =
    sentFiles
      .filter(
        f => f.preview
      )
      .map(
        f =>
          `<img
            class="aic-thumb"
            src="${f.preview}"
          >`
      )
      .join("");


  const userTags =
    sentFiles
      .filter(
        f => !f.preview
      )
      .map(
        f =>
          `<span class="aic-fileTag">
            📄 ${esc(f.name)}
          </span>`
      )
      .join(" ");


  const userBubble =
    bubble(
      "user",
      md(text)
    );


  if (
    userThumbs ||
    userTags
  ) {

    const holder =
      document.createElement(
        "div"
      );

    holder.className =
      "aic-thumbs";

    holder.innerHTML =
      userThumbs +
      userTags;


    userBubble.parentElement.insertBefore(
      holder,
      userBubble
    );
  }


  const meta =
    `${
      pick.provider === "openai"
        ? "GPT"
        : "Gemini"
    } · ${
      pick.model ||
      "Worker 기본 모델"
    }`;


  const bub =
    bubble(
      "assistant",
      `<span class="aic-dots"></span>`,
      meta
    );


  el.send.textContent =
    "■";

  el.send.title =
    "멈추기";


  const ctrl =
    new AbortController();

  state.abort =
    ctrl;


  let acc =
    "";


  try {

    const res =
      await fetch(
        BASE + "/ai/chat",
        {

          method:
            "POST",

          signal:
            ctrl.signal,

          headers: {

            "Content-Type":
              "application/json",

            ...(KEY
              ? {
                  "x-app-key":
                    KEY
                }
              : {}),

            ...(TOKEN
              ? {
                  "Authorization":
                    "Bearer " +
                    TOKEN
                }
              : {})

          },


          body:
            JSON.stringify({

              provider:
                pick.provider,

              model:
                pick.model,

              system:
                buildSystem(),

              messages:
                toWire(
                  state.msgs
                ),

              stream:
                true

            })

        }
      );


    if (!res.ok) {

      let msg =
        `서버가 ${res.status}로 답했습니다.`;

      try {
        msg =
          (await res.json()).error ||
          msg;
      } catch {}


      if (
        res.status === 401 ||
        res.status === 403
      ) {

        bub.parentElement.remove();

        state.msgs.pop();

        state.busy =
          false;

        await refreshGate(
          msg
        );

        return;
      }


      throw new Error(
        msg
      );
    }


    if (!res.body) {

      throw new Error(
        "스트리밍 응답을 받을 수 없습니다."
      );
    }


    const reader =
      res.body.getReader();

    const dec =
      new TextDecoder();

    let buf =
      "";


    while (true) {

      const {
        done,
        value
      } =
        await reader.read();


      if (done)
        break;


      buf +=
        dec.decode(
          value,
          {
            stream: true
          }
        );


      let cut;


      while (
        (cut =
          buf.indexOf("\n\n")) !== -1
      ) {

        const block =
          buf.slice(
            0,
            cut
          );


        buf =
          buf.slice(
            cut + 2
          );


        for (
          const line of
          block.split("\n")
        ) {

          if (
            !line.startsWith(
              "data:"
            )
          ) {
            continue;
          }


          const raw =
            line
              .slice(5)
              .trim();


          if (
            !raw ||
            raw === "[DONE]"
          ) {
            continue;
          }


          let o;


          try {
            o =
              JSON.parse(
                raw
              );
          } catch {
            continue;
          }


          if (o.error) {
            throw new Error(
              o.error
            );
          }


          if (o.delta) {

            acc +=
              o.delta;


            /*
              ★ 스트리밍 중에는
              redraw() 절대 호출 안 함.
            */
            bub.innerHTML =
              md(acc);

            scroll();
          }
        }
      }
    }


    if (!acc.trim()) {

      bub.innerHTML =
        `
          <p style="color:var(--ink-2,#8894a5)">
            답이 비어 있습니다.
            다시 물어봐 주세요.
          </p>
        `;
    }


    /*
      AI 답변 확정
    */
    state.msgs.push({

      role:
        "assistant",

      content:
        acc,

      meta
    });


    await persist(
      pick
    );


  } catch (e) {

    if (
      e.name ===
      "AbortError"
    ) {

      bub.innerHTML =
        md(acc) +
        `
          <p style="color:var(--ink-2,#8894a5)">
            — 여기서 멈췄습니다.
          </p>
        `;


      if (
        acc.trim()
      ) {

        state.msgs.push({

          role:
            "assistant",

          content:
            acc,

          meta
        });


        await persist(
          pick
        );
      }


    } else {

      bub.parentElement.remove();

      showErr(
        e.message ||
        String(e)
      );


      /*
        실패한 질문만 제거
      */
      state.msgs.pop();
    }


  } finally {

    state.busy =
      false;

    state.abort =
      null;

    el.send.textContent =
      "➤";

    el.send.title =
      "보내기";

    renderHint();
  }
}


function stop() {

  if (state.abort) {
    state.abort.abort();
  }
}


/* ═══════════════════════════════════════════════════════════════════════
   12. 저장
   ═══════════════════════════════════════════════════════════════════════ */

async function persist(pick) {

  const title =
    (
      state.msgs.find(
        m =>
          m.role ===
          "user"
      )?.content ||
      "새 대화"
    ).slice(
      0,
      60
    );


  /*
    LocalStorage
  */
  try {

    localStorage.setItem(
      "ai:last:" + APP,

      JSON.stringify({

        title,

        at:
          Date.now(),

        msgs:
          state.msgs
            .map(
              m => ({
                role:
                  m.role,

                content:
                  m.content,

                meta:
                  m.meta
              })
            )
            .slice(-40)

      })
    );

  } catch {}


  if (!sb)
    return;


  try {

    /*
      새 Thread
    */
    if (!state.thread) {

      const {
        data
      } =
        await sb
          .from(
            "ai_threads"
          )
          .insert({

            device_id:
              DEVICE,

            app:
              APP,

            title,

            context:
              currentContext() ||
              null

          })
          .select(
            "id"
          )
          .single();


      state.thread =
        data?.id ||
        null;


      if (
        !state.thread
      ) {
        return;
      }


      await sb
        .from(
          "ai_messages"
        )
        .insert(
          state.msgs.map(
            m =>
              rowOf(
                m,
                pick
              )
          )
        );


      return;
    }


    /*
      이어지는 대화
    */
    await sb
      .from(
        "ai_messages"
      )
      .insert(
        state.msgs
          .slice(-2)
          .map(
            m =>
              rowOf(
                m,
                pick
              )
          )
      );

  } catch {}
}


function rowOf(
  m,
  pick
) {

  return {

    thread_id:
      state.thread,

    role:
      m.role,

    content:
      m.content || "",

    provider:
      m.role === "assistant"
        ? pick.provider
        : null,

    model:
      m.role === "assistant"
        ? pick.model
        : null,

    attachments:
      (m.files || []).length
        ? m.files.map(
            f => ({
              name:
                f.name,

              mime:
                f.mime,

              size:
                f.size
            })
          )
        : null
  };
}


/* ═══════════════════════════════════════════════════════════════════════
   13. 히스토리
   ═══════════════════════════════════════════════════════════════════════ */

async function showHistory() {

  if (state.busy)
    return;


  el.log.innerHTML =
    "";


  const back =
    document.createElement(
      "button"
    );

  back.className =
    "aic-chip";

  back.textContent =
    "← 대화로 돌아가기";

  back.style.margin =
    "0 0 8px";


  back.onclick =
    redraw;


  el.log.appendChild(
    back
  );


  if (!sb) {

    let last =
      null;


    try {

      last =
        JSON.parse(
          localStorage.getItem(
            "ai:last:" + APP
          ) ||
          "null"
        );

    } catch {}


    bubble(
      "assistant",

      last
        ? `
          <p>
            Supabase 연결이 없어
            <b>마지막 대화 한 벌</b>만
            갖고 있습니다.
          </p>

          <p>
            <b>
              ${esc(last.title)}
            </b>
          </p>
        `
        : `
          <p>
            저장된 대화가 없습니다.
          </p>
        `
    );


    return;
  }


  const {
    data,
    error
  } =
    await sb
      .from(
        "ai_threads"
      )
      .select(
        "id,title,updated_at,context"
      )
      .eq(
        "device_id",
        DEVICE
      )
      .eq(
        "app",
        APP
      )
      .order(
        "updated_at",
        {
          ascending:
            false
        }
      )
      .limit(
        40
      );


  if (error) {

    showErr(
      "기록을 못 읽었습니다: " +
      error.message
    );

    return;
  }


  if (!data?.length) {

    bubble(
      "assistant",
      "<p>아직 저장된 대화가 없습니다.</p>"
    );

    return;
  }


  const list =
    document.createElement(
      "div"
    );

  list.style.cssText =
    "display:flex;flex-direction:column;gap:6px";


  list.innerHTML =
    data.map(
      t => `
        <button
          class="aic-chip"
          data-t="${t.id}"
          style="
            text-align:left;
            border-radius:10px;
            padding:9px 12px;
            white-space:normal
          "
        >
          <div style="font-weight:700">
            ${esc(
              t.title ||
              "제목 없음"
            )}
          </div>

          <div
            style="
              opacity:.65;
              font-size:11px;
              margin-top:2px
            "
          >
            ${
              new Date(
                t.updated_at
              ).toLocaleString(
                "ko-KR"
              )
            }
          </div>

        </button>
      `
    ).join("");


  el.log.appendChild(
    list
  );


  list
    .querySelectorAll(
      "[data-t]"
    )
    .forEach(
      b => {

        b.onclick =
          () =>
            openThread(
              b.dataset.t
            );
      }
    );
}


async function openThread(id) {

  if (state.busy)
    return;


  const {
    data,
    error
  } =
    await sb
      .from(
        "ai_messages"
      )
      .select(
        "role,content,model,provider"
      )
      .eq(
        "thread_id",
        id
      )
      .order(
        "id"
      );


  if (error) {

    showErr(
      error.message
    );

    return;
  }


  state.thread =
    id;


  state.msgs =
    (data || []).map(
      m => ({

        role:
          m.role,

        content:
          m.content,

        meta:
          m.role === "assistant" &&
          m.model

            ? `${
                m.provider === "openai"
                  ? "GPT"
                  : "Gemini"
              } · ${m.model}`

            : null

      })
    );


  redraw();
}


function newThread() {

  if (state.busy)
    return;


  state.thread =
    null;

  state.msgs =
    [];

  state.files =
    [];

  renderTray();
  redraw();
}


/* ═══════════════════════════════════════════════════════════════════════
   14. 로그인 화면
   ═══════════════════════════════════════════════════════════════════════ */

function drawLock(msg) {

  el.log.innerHTML =
    "";


  const box =
    document.createElement(
      "div"
    );

  box.className =
    "aic-lock";


  box.innerHTML = `

    <h4>
      로그인
    </h4>

    <input
      id="aicEm"
      type="email"
      placeholder="이메일"
      autocomplete="username"
    >

    <input
      id="aicPw"
      type="password"
      placeholder="비밀번호"
      autocomplete="current-password"
    >

    <button id="aicIn">
      들어가기
    </button>

    <p
      id="aicErr"
      style="color:#c0392b"
    ></p>

  `;


  el.log.appendChild(
    box
  );


  if (msg) {

    box.querySelector(
      "#aicErr"
    ).textContent =
      msg;
  }


  const go =
    async () => {

      const err =
        box.querySelector(
          "#aicErr"
        );

      err.textContent =
        "확인하는 중…";


      try {

        await doLogin(

          box
            .querySelector(
              "#aicEm"
            )
            .value
            .trim(),

          box
            .querySelector(
              "#aicPw"
            )
            .value
        );


        await refreshGate();

      } catch (e) {

        err.textContent =
          e.message;
      }
    };


  box.querySelector(
    "#aicIn"
  ).onclick =
    go;


  box.querySelector(
    "#aicPw"
  ).onkeydown =
    e => {

      if (
        e.key ===
        "Enter"
      ) {
        go();
      }

    };


  setTimeout(
    () =>
      box
        .querySelector(
          "#aicEm"
        )
        .focus({
          preventScroll:
            true
        }),
    60
  );
}


/* ═══════════════════════════════════════════════════════════════════════
   15. Gate
   ═══════════════════════════════════════════════════════════════════════ */

async function refreshGate(msg) {

  await readSession();

  const ok =
    allowed();


  el.wrap.querySelector(
    ".aic-foot"
  ).style.display =
    ok
      ? ""
      : "none";


  el.bar.style.display =
    ok
      ? ""
      : "none";


  el.wrap
    .querySelector(
      '[data-act="history"]'
    )
    .style.display =
      ok
        ? ""
        : "none";


  el.wrap
    .querySelector(
      '[data-act="new"]'
    )
    .style.display =
      ok
        ? ""
        : "none";


  const who =
    el.wrap.querySelector(
      "#aicWho"
    );


  who.textContent =
    ok
      ? (
          USER?.email ||
          ""
        )
      : "";


  el.wrap
    .querySelector(
      '[data-act="user"]'
    )
    .textContent =
      ok
        ? "🔓"
        : "👤";


  if (!ok) {

    /*
      생성 중에는 대화를 건드리지 않는다.
    */
    if (!state.busy) {
      drawLock(msg);
    }

    return false;
  }


  /*
    ★ 생성 중에는 redraw 금지
  */
  if (!state.busy) {

    redraw();
    renderHint();


    setTimeout(
      () => {

        if (
          el.ta &&
          !state.busy &&
          el.wrap.classList.contains("on")
        ) {

          el.ta.focus({
            preventScroll:
              true
          });
        }

      },
      60
    );

  } else {

    renderHint();

  }


  return true;
}


/* ═══════════════════════════════════════════════════════════════════════
   16. 외부 API
   ═══════════════════════════════════════════════════════════════════════ */

function open() {

  el.wrap.classList.add(
    "on"
  );

  el.fab.hidden =
    true;


  /*
    refreshGate를 await하지 않는다.
    사용자가 바로 타이핑해도 send에서 다시 세션 확인한다.
  */
  refreshGate();
}


function close() {

  /*
    닫는다고 대화 삭제 안 함
  */
  el.wrap.classList.remove(
    "on"
  );

  el.fab.hidden =
    false;
}


const AIChat = {

  open,

  close,

  new:
    newThread,


  ask(text) {

    open();

    setTimeout(
      () => send(text),
      100
    );

  },


  fill(text) {

    open();

    setTimeout(
      () => {

        el.ta.value =
          text;

        el.ta.dispatchEvent(
          new Event("input")
        );

        el.ta.focus();

      },
      100
    );

  },


  setContext(ctx) {

    state.ctx =
      ctx || null;

    renderHint();
  },


  setContextProvider(fn) {

    state.ctxFn =
      typeof fn === "function"
        ? fn
        : null;
  },


  attachFiles,


  get context() {

    return currentContext();

  }

};


/* ═══════════════════════════════════════════════════════════════════════
   17. 초기화
   ═══════════════════════════════════════════════════════════════════════ */

if (
  document.readyState ===
  "loading"
) {

  document.addEventListener(
    "DOMContentLoaded",
    () => {

      build();

      loadCatalog();

    }
  );

} else {

  build();

  loadCatalog();

}


window.AIChat =
  AIChat;


})();
