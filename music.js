/* ═══════════════════════════════════════════════════════════════════════
   music.js — 가사 없는 배경음 10가지
   ───────────────────────────────────────────────────────────────────────
   음원 파일이 하나도 없습니다. 전부 브라우저가 «그 자리에서 만들어» 냅니다.

   왜 그렇게 했나
     · 남의 음원을 올려 두면 저작권 문제가 생깁니다
     · 파일이 없으니 용량 0, 끊김 없음, 몇 시간이든 반복
     · 매번 조금씩 다르게 연주되어 지겹지 않습니다

   붙이는 법 (ai-chat.js 다음 줄):
       <script src="./music.js" defer></script>

   바깥에서:
       Music.play("rain")   Music.stop()   Music.toggle()
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
"use strict";

if (window.Music) return;

/* ═══════════════ 곡 목록 ═══════════════ */

const TRACKS = [
  // ── 소음 계열 ─────────────────────────────────────────
  { id:"white", name:"백색소음",   icon:"⚪", tag:"소음",
    desc:"모든 소리가 고르게 섞인 «쉬—». 주변 말소리를 덮는 데 가장 셉니다." },
  { id:"pink",  name:"핑크소음",   icon:"🌸", tag:"소음",
    desc:"높은 소리를 덜어낸 백색소음. 오래 들어도 귀가 덜 피곤합니다." },
  { id:"brown", name:"빗소리",     icon:"🌧", tag:"소음",
    desc:"낮은 쪽만 남긴 소음. 창밖에 비 오는 소리에 가깝습니다." },
  { id:"wave",  name:"파도",       icon:"🌊", tag:"소음",
    desc:"천천히 밀려왔다 빠지는 소리. 12초에 한 번씩 숨을 쉽니다." },

  // ── 집중 주파수(바이노럴 비트) ────────────────────────
  { id:"theta", name:"세타 6Hz",   icon:"🌀", tag:"집중", phones:true,
    desc:"가장 느립니다. 멍하니 풀어 두거나 잠들기 전에." },
  { id:"alpha", name:"알파 10Hz",  icon:"🎯", tag:"집중", phones:true,
    desc:"긴장을 풀고 차분히 읽을 때. 무난한 기본값." },
  { id:"beta",  name:"베타 18Hz",  icon:"⚡", tag:"집중", phones:true,
    desc:"잠이 올 때 깨우는 쪽. 계산·정리 작업에." },
  { id:"gamma", name:"감마 40Hz",  icon:"✨", tag:"집중", phones:true,
    desc:"가장 빠릅니다. 짧게 몰아칠 때만 쓰세요." },

  // ── 음악 계열 ─────────────────────────────────────────
  { id:"edm",     name:"EDM",     icon:"🎛", tag:"음악",
    desc:"느린 하우스. 킥·베이스·아르페지오가 계속 조금씩 바뀝니다." },
  { id:"jazz",    name:"재즈",    icon:"🎷", tag:"음악",
    desc:"ii–V–I 를 도는 로즈 피아노와 워킹 베이스. 브러시 드럼." },
  { id:"fantasy", name:"판타지",  icon:"🧝", tag:"음악",
    desc:"하프 아르페지오와 현악 패드. 넓게 울립니다." },
];

/* ═══════════════ 소리 만드는 곳 ═══════════════ */

let ctx = null, master = null, verb = null, verbGain = null, meter = null;
let node = null;              // 지금 울리고 있는 것 { stop() }
let CUR = null;               // 지금 곡 id
let VOL = load("music:vol", 0.5);
let timer = null, timerEnd = 0;

function load(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } }
function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }

function boot() {
  if (ctx) return ctx;
  ctx = new (window.AudioContext || window.webkitAudioContext)();

  master = ctx.createGain();
  master.gain.value = VOL;
  master.connect(ctx.destination);

  // 소리가 실제로 나오는지 재는 계기 — 화면의 표시등에도 씁니다
  meter = ctx.createAnalyser();
  meter.fftSize = 512;
  master.connect(meter);

  // 울림(리버브) — 임펄스도 직접 만들어 씁니다
  verb = ctx.createConvolver();
  verb.buffer = makeImpulse(2.6, 2.4);
  verbGain = ctx.createGain();
  verbGain.gain.value = 0.34;
  verb.connect(verbGain);
  verbGain.connect(master);

  return ctx;
}

function makeImpulse(seconds, decay) {
  const n = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < n; i++)
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay);
  }
  return buf;
}

/* 2초짜리 잡음 조각을 만들어 이어 붙여 돌린다 — 메모리를 아끼는 방법 */
function noiseBuffer(kind) {
  const n = ctx.sampleRate * 2;
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);

  if (kind === "white") {
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;

  } else if (kind === "pink") {
    // Voss-McCartney 근사 — 1/f 특성
    let b0=0,b1=0,b2=0,b3=0,b4=0,b5=0,b6=0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886*b0 + w*0.0555179;
      b1 = 0.99332*b1 + w*0.0750759;
      b2 = 0.96900*b2 + w*0.1538520;
      b3 = 0.86650*b3 + w*0.3104856;
      b4 = 0.55000*b4 + w*0.5329522;
      b5 = -0.7616*b5 - w*0.0168980;
      d[i] = (b0+b1+b2+b3+b4+b5+b6 + w*0.5362) * 0.11;
      b6 = w * 0.115926;
    }

  } else {  // brown — 낮은 쪽만 남는다
    let last = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    }
  }
  return buf;
}

function noiseSource(kind) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(kind);
  src.loop = true;
  return src;
}

/* ═══════════════ 소음 계열 ═══════════════ */

function playNoise(kind) {
  const src = noiseSource(kind === "wave" ? "brown" : kind);
  const g = ctx.createGain();
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";

  if (kind === "white") { lp.frequency.value = 12000; g.gain.value = 0.13; }
  else if (kind === "pink") { lp.frequency.value = 8000; g.gain.value = 0.30; }
  else { lp.frequency.value = 1400; g.gain.value = 0.42; }   // brown / wave

  src.connect(lp); lp.connect(g); g.connect(master);
  g.gain.setValueAtTime(0, ctx.currentTime);
  g.gain.linearRampToValueAtTime(kind === "white" ? 0.13 : kind === "pink" ? 0.30 : 0.42, ctx.currentTime + 1.4);
  src.start();

  // 파도는 12초 주기로 밀려왔다 빠진다
  let lfo = null, lfoGain = null;
  if (kind === "wave") {
    lfo = ctx.createOscillator();
    lfo.frequency.value = 1 / 12;
    lfoGain = ctx.createGain();
    lfoGain.gain.value = 900;
    lfo.connect(lfoGain);
    lfoGain.connect(lp.frequency);
    lp.frequency.value = 1100;
    lfo.start();
  }

  return { stop(t) {
    g.gain.cancelScheduledValues(t);
    g.gain.setTargetAtTime(0, t, 0.5);
    setTimeout(() => { try { src.stop(); lfo?.stop(); } catch {} }, 1800);
  } };
}

/* ═══════════════ 집중 주파수(바이노럴 비트) ═══════════════
   왼쪽 귀와 오른쪽 귀에 아주 조금 다른 높이의 소리를 들려주면
   그 «차이» 만큼의 느린 맥놀이가 머릿속에서 만들어집니다.
   반드시 이어폰·헤드폰이 필요합니다(스피커로는 그냥 섞여 버립니다). */

function playBinaural(beatHz) {
  const carrier = 180;                       // 밑바탕이 되는 높이
  const out = ctx.createGain();
  out.gain.value = 0;
  out.connect(master);
  out.connect(verb);

  const sides = [-1, 1].map((pan, i) => {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = carrier + (i === 0 ? 0 : beatHz);

    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (p) { p.pan.value = pan; osc.connect(p); p.connect(out); }
    else osc.connect(out);

    osc.start();
    return osc;
  });

  // 순수한 삐— 소리만 있으면 금방 지치므로, 아주 옅은 핑크소음을 깔아 준다
  const bed = noiseSource("pink");
  const bedG = ctx.createGain();
  bedG.gain.value = 0.055;
  const bedLp = ctx.createBiquadFilter();
  bedLp.type = "lowpass"; bedLp.frequency.value = 3000;
  bed.connect(bedLp); bedLp.connect(bedG); bedG.connect(master);
  bed.start();

  out.gain.setValueAtTime(0, ctx.currentTime);
  out.gain.linearRampToValueAtTime(0.10, ctx.currentTime + 2.5);

  return { stop(t) {
    out.gain.cancelScheduledValues(t);
    out.gain.setTargetAtTime(0, t, 0.4);
    bedG.gain.setTargetAtTime(0, t, 0.4);
    setTimeout(() => { try { sides.forEach(o => o.stop()); bed.stop(); } catch {} }, 1600);
  } };
}

/* ═══════════════ 연주용 도구 ═══════════════ */

const hz = (semitoneFromA4) => 440 * Math.pow(2, semitoneFromA4 / 12);

/* 음 이름 → 주파수. "C4" 처럼 씁니다. */
const NAMES = { C:-9, "C#":-8, D:-7, "D#":-6, E:-5, F:-4, "F#":-3, G:-2, "G#":-1, A:0, "A#":1, B:2 };
function n(name) {
  const m = /^([A-G]#?)(-?\d)$/.exec(name);
  if (!m) return 440;
  return hz(NAMES[m[1]] + (parseInt(m[2], 10) - 4) * 12);
}

const rnd = (a) => a[Math.floor(Math.random() * a.length)];

/* 한 음 울리기 */
function tone(t, freq, dur, opt = {}) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = opt.type || "sine";
  o.frequency.setValueAtTime(freq, t);

  const peak = opt.gain ?? 0.12;
  const atk = opt.attack ?? 0.012;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + atk);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

  let last = o;
  if (opt.filter) {
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.setValueAtTime(opt.filter, t);
    o.connect(f); last = f;
  }
  last.connect(g);
  g.connect(master);
  if (opt.verb) g.connect(verb);

  o.start(t); o.stop(t + dur + 0.05);
}

/* 드럼 — 소음과 사인파로 흉내 낸다 */
function kick(t, gain = 0.5) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.frequency.setValueAtTime(150, t);
  o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.34);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + 0.36);
}

function hat(t, gain = 0.08, dur = 0.05) {
  const s = ctx.createBufferSource();
  s.buffer = noiseBuffer("white");
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass"; hp.frequency.value = 7000;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  s.connect(hp); hp.connect(g); g.connect(master);
  s.start(t); s.stop(t + dur + 0.02);
}

function brush(t, gain = 0.055) {          // 재즈용 브러시 스네어
  const s = ctx.createBufferSource();
  s.buffer = noiseBuffer("pink");
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass"; bp.frequency.value = 2600; bp.Q.value = 0.7;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
  s.connect(bp); bp.connect(g); g.connect(master); g.connect(verb);
  s.start(t); s.stop(t + 0.25);
}

/* 박자를 미리 조금씩 예약해 두는 시계.
   브라우저 타이머는 정확하지 않아서, «조금 앞을» 미리 잡아 둡니다. */
function sequencer(bpm, beatsPerBar, onBeat) {
  const spb = 60 / bpm;
  let beat = 0;
  let next = ctx.currentTime + 0.15;

  const tick = () => {
    while (next < ctx.currentTime + 0.25) {
      onBeat(next, beat, Math.floor(beat / beatsPerBar));
      beat++;
      next += spb;
    }
  };
  tick();
  const h = setInterval(tick, 40);
  return { stop() { clearInterval(h); } };
}

/* ═══════════════ EDM ═══════════════ */

function playEdm() {
  const bpm = 118, per = 4;
  // 화음 진행 넷 — 한 마디씩 돈다
  const chords = [
    ["A2", ["A3","C4","E4"]],
    ["F2", ["F3","A3","C4"]],
    ["C2", ["C3","E3","G3"]],
    ["G2", ["G2","B3","D4"]],
  ];

  const seq = sequencer(bpm, per, (t, beat, bar) => {
    const step = beat % per;
    const [bass, ch] = chords[bar % chords.length];

    kick(t, 0.52);                                    // 4/4 — 매 박마다
    hat(t + (60/bpm)/2, 0.05);                        // 엇박 하이햇
    if (step % 2 === 1) hat(t, 0.028, 0.03);

    // 베이스 — 박마다 짧게
    tone(t, n(bass), 0.34, { type:"sawtooth", gain:0.14, filter:340, attack:0.005 });

    // 아르페지오 — 16분음표로 화음을 훑는다
    const six = (60/bpm)/4;
    for (let i = 0; i < 4; i++) {
      if (Math.random() < 0.18) continue;             // 가끔 쉬어서 기계 같지 않게
      const f = n(ch[(step*4 + i) % ch.length]) * (Math.random() < 0.15 ? 2 : 1);
      tone(t + i*six, f, 0.20, { type:"square", gain:0.045, filter:2600, verb:true });
    }

    // 마디 첫 박에 패드 한 겹
    if (step === 0)
      ch.forEach(nm => tone(t, n(nm)/2, (60/bpm)*4, {
        type:"sawtooth", gain:0.028, filter:900, attack:0.35, verb:true }));
  });
  return { stop() { seq.stop(); } };
}

/* ═══════════════ 재즈 ═══════════════ */

function playJazz() {
  const bpm = 96, per = 4;
  // ii – V – I 를 조를 바꿔 가며 돈다
  const prog = [
    { root:"D3",  ch:["F3","A3","C4","E4"] },   // Dm7
    { root:"G2",  ch:["B3","D4","F4","A4"] },   // G7
    { root:"C3",  ch:["E3","G3","B3","D4"] },   // Cmaj7
    { root:"C3",  ch:["E3","G3","A3","D4"] },   // C6/9
    { root:"A2",  ch:["C3","E3","G3","B3"] },   // Am7
    { root:"D3",  ch:["F#3","A3","C4","E4"] },  // D7
    { root:"G2",  ch:["B2","D3","F3","A3"] },   // G7
    { root:"C3",  ch:["E3","G3","B3","D4"] },   // Cmaj7
  ];
  const scale = ["C3","D3","E3","F3","G3","A3","A#3","B3","C4"];

  const seq = sequencer(bpm, per, (t, beat, bar) => {
    const step = beat % per;
    const cell = prog[bar % prog.length];
    const spb = 60 / bpm;

    // 워킹 베이스 — 박마다 한 음씩 걸어간다
    const walk = step === 0 ? cell.root : rnd(scale);
    tone(t, n(walk) / 2, spb * 0.9, { type:"triangle", gain:0.12, filter:420, attack:0.01 });

    // 라이드 심벌 — 딴, 따라단
    brush(t, 0.05);
    if (step % 2 === 1) brush(t + spb * 0.66, 0.03);

    // 로즈 피아노 화음 — 1·3박에 살짝 어긋나게(사람 손처럼)
    if (step === 0 || step === 2) {
      cell.ch.forEach((nm, i) => {
        tone(t + i * 0.012 + (Math.random() * 0.02), n(nm), spb * 1.9, {
          type:"sine", gain:0.052, attack:0.02, verb:true });
      });
    }

    // 가끔 멜로디 한 음
    if (Math.random() < 0.3)
      tone(t + spb * (Math.random() < .5 ? 0.5 : 0.75), n(rnd(cell.ch)) * 2, 0.5, {
        type:"sine", gain:0.045, attack:0.03, verb:true });
  });
  return { stop() { seq.stop(); } };
}

/* ═══════════════ 판타지 ═══════════════ */

function playFantasy() {
  const bpm = 66, per = 4;
  // 오래된 이야기 같은 진행 (에올리안)
  const prog = [
    ["A2", ["A3","C4","E4","G4"]],
    ["F2", ["F3","A3","C4","E4"]],
    ["G2", ["G3","B3","D4","F4"]],
    ["E2", ["E3","G3","B3","D4"]],
  ];

  const seq = sequencer(bpm, per, (t, beat, bar) => {
    const step = beat % per;
    const [root, ch] = prog[bar % prog.length];
    const spb = 60 / bpm;

    // 현악 패드 — 마디마다 길게 깔린다
    if (step === 0) {
      tone(t, n(root) / 2, spb * 4.4, { type:"sawtooth", gain:0.035, filter:700, attack:1.1, verb:true });
      ch.forEach(nm => tone(t, n(nm) / 2, spb * 4.4, {
        type:"triangle", gain:0.026, attack:1.3, verb:true }));
    }

    // 하프 — 화음을 위아래로 훑는다
    const notes = step % 2 === 0 ? ch : [...ch].reverse();
    notes.forEach((nm, i) => {
      if (Math.random() < 0.12) return;
      const oct = Math.random() < 0.25 ? 2 : 1;
      tone(t + i * (spb / 5), n(nm) * oct, 1.5, {
        type:"triangle", gain:0.05, attack:0.006, verb:true });
    });

    // 아주 가끔 종소리 하나
    if (Math.random() < 0.10)
      tone(t + spb * 0.5, n(rnd(ch)) * 4, 3.2, { type:"sine", gain:0.035, attack:0.01, verb:true });
  });
  return { stop() { seq.stop(); } };
}

/* ═══════════════ 켜고 끄기 ═══════════════ */

const MAKERS = {
  white:  () => playNoise("white"),
  pink:   () => playNoise("pink"),
  brown:  () => playNoise("brown"),
  wave:   () => playNoise("wave"),
  theta:  () => playBinaural(6),
  alpha:  () => playBinaural(10),
  beta:   () => playBinaural(18),
  gamma:  () => playBinaural(40),
  edm:    playEdm,
  jazz:   playJazz,
  fantasy:playFantasy,
};

async function play(id) {
  if (!MAKERS[id]) return;
  boot();
  if (ctx.state === "suspended") await ctx.resume();

  stop();
  CUR = id;
  node = MAKERS[id]();
  save("music:last", id);
  paint();
}

function stop() {
  if (node) { try { node.stop(ctx.currentTime); } catch {} node = null; }
  CUR = null;
  paint();
}

function toggle(id) { (CUR === id) ? stop() : play(id); }

function setVol(v) {
  VOL = Math.max(0, Math.min(1, v));
  save("music:vol", VOL);
  if (master) master.gain.setTargetAtTime(VOL, ctx.currentTime, 0.05);
}

function setTimerMin(min) {
  clearTimeout(timer); timer = null; timerEnd = 0;
  if (!min) { paint(); return; }
  timerEnd = Date.now() + min * 60000;
  timer = setTimeout(() => {
    // 갑자기 뚝 끊기지 않게 15초에 걸쳐 줄인다
    if (master) master.gain.setTargetAtTime(0, ctx.currentTime, 5);
    setTimeout(() => { stop(); if (master) master.gain.value = VOL; }, 16000);
    timerEnd = 0; timer = null;
  }, min * 60000);
  paint();
}

/* ═══════════════ 화면 ═══════════════ */

const CSS = `
.mus-fab{position:fixed;right:14px;bottom:calc(76px + env(safe-area-inset-bottom));z-index:65;
  width:44px;height:44px;border-radius:50%;border:1px solid var(--rule,#dde2e9);
  background:var(--card,#fff);color:var(--ink,#111827);font-size:18px;cursor:pointer;
  box-shadow:var(--shadow,0 8px 24px -16px #000);display:flex;align-items:center;justify-content:center}
.mus-fab.on{background:var(--accent,#1D4ED8);border-color:var(--accent,#1D4ED8);color:#fff}
.mus-fab .ring{position:absolute;inset:-4px;border-radius:50%;border:2px solid var(--accent,#1D4ED8);
  opacity:0;animation:musRing 2.4s ease-out infinite}
.mus-fab.on .ring{opacity:1}
@keyframes musRing{0%{transform:scale(.85);opacity:.55}100%{transform:scale(1.25);opacity:0}}

.mus-ov{position:fixed;inset:0;z-index:110;display:none}
.mus-ov.on{display:block}
.mus-veil{position:absolute;inset:0;background:rgba(9,14,22,.4);backdrop-filter:blur(2px)}
.mus-box{position:absolute;left:0;right:0;bottom:0;max-height:86dvh;overflow-y:auto;
  background:var(--card,#fff);color:var(--ink,#111827);border-radius:18px 18px 0 0;
  border-top:1px solid var(--rule,#e5e7eb);padding:16px 16px calc(18px + env(safe-area-inset-bottom))}
@media(min-width:620px){.mus-box{left:auto;right:16px;bottom:16px;width:400px;border-radius:16px;
  border:1px solid var(--rule,#e5e7eb);max-height:78dvh}}

.mus-head{display:flex;align-items:center;gap:9px;margin-bottom:4px}
.mus-head h3{margin:0;font:700 16px/1.3 var(--font,system-ui);margin-right:auto}
.mus-x{width:32px;height:32px;border-radius:9px;border:1px solid var(--rule,#e5e7eb);
  background:transparent;color:inherit;cursor:pointer}
.mus-now{font:600 12px/1.5 var(--font,system-ui);color:var(--ink-2,#6B7280);margin:0 0 12px;min-height:18px}

.mus-group{font:700 11px/1 var(--font,system-ui);color:var(--ink-3,#9CA3AF);
  letter-spacing:.08em;margin:14px 0 7px}
.mus-list{display:grid;grid-template-columns:1fr 1fr;gap:7px}
.mus-item{display:flex;gap:9px;align-items:flex-start;text-align:left;padding:10px 11px;
  border-radius:11px;border:1px solid var(--rule,#e5e7eb);background:var(--paper,#f6f7f9);
  color:inherit;cursor:pointer;font:inherit}
.mus-item:active{transform:scale(.985)}
.mus-item.on{background:var(--accent,#1D4ED8);border-color:var(--accent,#1D4ED8);color:#fff}
.mus-item .em{font-size:17px;line-height:1.2}
.mus-item b{display:block;font:700 13px/1.35 var(--font,system-ui)}
.mus-item span{display:block;font:500 10.5px/1.45 var(--font,system-ui);opacity:.72;margin-top:2px}

.mus-row{display:flex;align-items:center;gap:10px;margin-top:16px}
.mus-row label{font:600 12px/1 var(--font,system-ui);color:var(--ink-2,#6B7280);flex:none;width:38px}
.mus-row input[type=range]{flex:1;accent-color:var(--accent,#1D4ED8)}
.mus-times{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}
.mus-times button{padding:6px 11px;border-radius:999px;border:1px solid var(--rule,#e5e7eb);
  background:transparent;color:var(--ink-2,#6B7280);font:600 12px/1.2 var(--font,system-ui);cursor:pointer}
.mus-times button.on{background:var(--accent,#1D4ED8);border-color:var(--accent,#1D4ED8);color:#fff}
.mus-note{font:500 11.5px/1.6 var(--font,system-ui);color:var(--ink-2,#6B7280);
  margin-top:14px;padding-top:12px;border-top:1px solid var(--rule,#e5e7eb)}

/* 배경음 창이 열려 있는 동안에는 떠 있는 동그라미들을 치운다 */
body:has(.mus-ov.on) .mus-fab,
body:has(.mus-ov.on) .aic-fab{display:none}
`;

let ui = {};

function build() {
  const st = document.createElement("style");
  st.textContent = CSS;
  document.head.appendChild(st);

  const fab = document.createElement("button");
  fab.className = "mus-fab";
  fab.type = "button";
  fab.title = "배경음";
  fab.innerHTML = `<span class="ring"></span><span class="ic">♪</span>`;
  fab.onclick = () => ov.classList.add("on");
  document.body.appendChild(fab);

  const ov = document.createElement("div");
  ov.className = "mus-ov";
  ov.innerHTML = `
    <div class="mus-veil"></div>
    <div class="mus-box" role="dialog" aria-label="배경음">
      <div class="mus-head">
        <h3>배경음</h3>
        <button class="mus-x" data-stop title="끄기">■</button>
        <button class="mus-x" data-close title="닫기">✕</button>
      </div>
      <p class="mus-now"></p>
      <div class="mus-body"></div>
      <div class="mus-row">
        <label>소리</label>
        <input type="range" min="0" max="100" value="${Math.round(VOL*100)}">
      </div>
      <div class="mus-times">
        <span style="font:600 12px/2 var(--font,system-ui);color:var(--ink-2,#6B7280);margin-right:2px">끄기 예약</span>
        ${[0,15,30,60,120].map(m =>
          `<button data-min="${m}">${m ? m+"분" : "안 함"}</button>`).join("")}
      </div>
      <p class="mus-note">
        음원 파일이 아니라 브라우저가 직접 만들어 내는 소리입니다 — 저작권 걱정 없이 몇 시간이든 틀어 두셔도 됩니다.<br>
        <b>집중</b> 항목은 좌우 귀에 다른 소리를 들려주는 방식이라 <b>이어폰이 꼭 필요합니다</b>.
        효과는 사람마다 다르고 학계에서도 의견이 갈립니다 — 잘 맞으면 쓰시고, 아니면 소음 쪽이 무난합니다.
        어떤 소리든 오래 크게 듣는 것은 귀에 좋지 않으니 볼륨은 낮게 두세요.
      </p>
    </div>`;
  document.body.appendChild(ov);

  ov.querySelector(".mus-veil").onclick = () => ov.classList.remove("on");
  ov.querySelector("[data-close]").onclick = () => ov.classList.remove("on");
  ov.querySelector("[data-stop]").onclick = () => stop();
  ov.querySelector("input[type=range]").oninput = e => setVol(e.target.value / 100);
  ov.querySelectorAll("[data-min]").forEach(b => b.onclick = () => setTimerMin(+b.dataset.min));

  // 곡 목록 — 갈래별로 묶어서
  const body = ov.querySelector(".mus-body");
  const groups = ["소음", "집중", "음악"];
  body.innerHTML = groups.map(gname => `
    <div class="mus-group">${gname}${gname === "집중" ? " · 이어폰 필요" : ""}</div>
    <div class="mus-list">
      ${TRACKS.filter(t => t.tag === gname).map(t => `
        <button class="mus-item" data-t="${t.id}">
          <span class="em">${t.icon}</span>
          <span><b>${t.name}</b><span>${t.desc}</span></span>
        </button>`).join("")}
    </div>`).join("");

  body.querySelectorAll("[data-t]").forEach(b => b.onclick = () => toggle(b.dataset.t));

  ui = { fab, ov, body, now: ov.querySelector(".mus-now") };
  paint();
}

function paint() {
  if (!ui.fab) return;
  ui.fab.classList.toggle("on", !!CUR);
  ui.fab.querySelector(".ic").textContent = CUR ? "♫" : "♪";

  ui.body.querySelectorAll("[data-t]").forEach(b =>
    b.classList.toggle("on", b.dataset.t === CUR));

  const t = TRACKS.find(x => x.id === CUR);
  ui.now.textContent = t
    ? `${t.icon} ${t.name} 재생 중${timerEnd ? ` · ${Math.ceil((timerEnd - Date.now())/60000)}분 뒤 꺼짐` : ""}`
    : "";

  ui.ov.querySelectorAll("[data-min]").forEach(b => {
    const on = timerEnd
      ? +b.dataset.min && Math.abs((timerEnd - Date.now())/60000 - +b.dataset.min) < 1.2
      : +b.dataset.min === 0;
    b.classList.toggle("on", !!on);
  });
}

setInterval(() => { if (CUR && timerEnd) paint(); }, 30000);

/* 탭이 뒤로 가면 소리를 살짝 줄인다(완전히 끄지는 않는다 — 공부하다 창을 옮기니까) */
document.addEventListener("visibilitychange", () => {
  if (!master || !CUR) return;
  master.gain.setTargetAtTime(document.hidden ? VOL * 0.6 : VOL, ctx.currentTime, 0.4);
});

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", build);
else build();

/* 지금 얼마나 소리가 나고 있는지(0~1). 잘 나오는지 확인할 때 씁니다. */
function level() {
  if (!meter) return 0;
  const buf = new Float32Array(meter.fftSize);
  meter.getFloatTimeDomainData(buf);
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  return Math.sqrt(sum / buf.length);
}

window.Music = {
  play, stop, toggle, setVol, setTimerMin, level,
  get current() { return CUR; },
  tracks: TRACKS,
  open() { ui.ov?.classList.add("on"); },
};
})();
