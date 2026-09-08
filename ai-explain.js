/* ══════════════════════════════════════════════════════════════
   ai-explain.js  ·  «끌어서 고르면 AI 가 그 자리를 풀어 준다»
   ──────────────────────────────────────────────────────────────
   어디서 도나
     · 실기뷰어(practice.html) — 일반 보기 · 한눈에 보기
     · 필기뷰어(index.html)   — 문제 · 보기 · 해설 · 쉬운 풀이
   무엇을 하나
     ① 글을 끌어 고르면 뜨는 띠에 «🤖 AI» 단추를 끼워 넣는다.
     ② 누르면 고른 자리가 «무슨 뜻인지 · 어느 식에서 나왔는지» 를 물어본다.
     ③ 답이 오면 «주석에 넣을까요?» 를 묻고, 넣으면 그 자리에 주석으로 남는다.
        실기 쪽은 원래 쓰던 주석함에 그대로 들어가고,
        필기 쪽은 이 파일이 따로 들고 있는 주석함에 남는다(둘 다 이 기기에).
   ══════════════════════════════════════════════════════════════ */
(function(){
'use strict';
if(window.__aiExplain) return;

const $  = (s,r=document)=>r.querySelector(s);
const $$ = (s,r=document)=>[...r.querySelectorAll(s)];
const CFG = window.APP_CONFIG || {};
const ENDPOINTS = [CFG.WORKER_URL, CFG.WORKER_BACKUP_URL].filter(Boolean);
/* ★ 배포 주소는 «/practice» 로 확장자가 없다. 예전 검사는 «practice.html» 만 봐서
   실기뷰어에서도 필기뷰어용 길(문서 전체를 지켜보는 감시자)이 돌고 있었다. */
const PRAC = /(^|\/)practice(\.html)?$/i.test(location.pathname) || !!document.getElementById('ovl');
const esc = s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/* ── 글자 세는 법 — 실기 쪽 주석함과 «똑같은» 규칙이어야 자리가 안 밀린다 ── */
const SKIP='.ann-badge,.annlist,.aiann-list,script,style,summary,.plabel,.ansbtn,.plab';
const ATOM='.katex-display,.katex';
function units(root){
  const out=[];
  (function walk(n){
    for(const ch of n.childNodes){
      if(ch.nodeType===3){ if(ch.nodeValue&&ch.nodeValue.length) out.push({n:ch,len:ch.nodeValue.length,atom:false}); continue; }
      if(ch.nodeType!==1) continue;
      if(ch.matches?.(SKIP)) continue;
      if(ch.matches?.(ATOM)){ out.push({n:ch,len:1,atom:true}); continue; }
      walk(ch);
    }
  })(root);
  return out;
}
const textOf = root=>units(root).map(u=>u.atom?' ':u.n.nodeValue).join('');
function offsetOf(root,container,offset,bias){
  const us=units(root); let off=0;
  for(const u of us){
    /* 수식 덩어리 안을 가리키면 — 시작은 덩어리 앞, 끝은 덩어리 뒤로 붙인다.
       그래야 «수식만» 골라도 길이가 0 이 되지 않는다. */
    if(u.atom){ if(u.n===container||u.n.contains?.(container)) return bias==='e'?off+1:off; off+=1; continue; }
    if(u.n===container) return off+Math.min(offset,u.len);
    off+=u.len;
  }
  return off;
}
function wrapRange(root,s,e,make,badge){
  const us=units(root); let off=0; const jobs=[];
  for(const u of us){
    const a=Math.max(s,off), b=Math.min(e,off+u.len);
    if(b>a) jobs.push({u,from:a-off,to:b-off});
    off+=u.len; if(off>=e) break;
  }
  let last=null;
  for(const j of jobs){
    if(j.u.atom){
      const el=j.u.n, par=el.parentNode; if(!par) continue;
      const w=make(); par.insertBefore(w,el); w.appendChild(el); last=w; continue;
    }
    let node=j.u.n;
    try{
      if(j.to<node.nodeValue.length) node.splitText(j.to);
      if(j.from>0) node=node.splitText(j.from);
    }catch(x){ continue }
    const w=make(), par=node.parentNode; if(!par) continue;
    par.insertBefore(w,node); w.appendChild(node); last=w;
  }
  if(badge&&last) last.appendChild(badge());
  return !!last;
}

/* ── 지금 고른 자리 ── */
const blockOf = el => el?.closest?.('[data-ann]') || el?.closest?.('[data-hl][data-qid]') || null;
let LAST=null;      // {el,s,e,text,rect,kind}
function readSel(){
  const s=getSelection(); if(!s||s.isCollapsed||!s.rangeCount) return null;
  const r=s.getRangeAt(0);
  let n=r.commonAncestorContainer; if(n.nodeType===3) n=n.parentElement;
  const el=blockOf(n); if(!el) return null;
  const a=offsetOf(el,r.startContainer,r.startOffset,'s'), b=offsetOf(el,r.endContainer,r.endOffset,'e');
  const s0=Math.min(a,b), e0=Math.max(a,b);
  if(e0-s0<1) return null;
  return { el, s:s0, e:e0, text:String(r).replace(/\s+/g,' ').trim(),
           rect:r.getBoundingClientRect(), kind: el.dataset.ann?'ann':'hl' };
}
let selT=0;
document.addEventListener('selectionchange',()=>{
  clearTimeout(selT);
  selT=setTimeout(()=>{ const v=readSel(); if(v) LAST=v; },120);
});

/* ── 띠에 단추 끼우기 ── */
const BTN='<span class="aix-ico">🤖</span> AI';
function inject(){
  const bars=[$('.annbar'), $('#hlbar')].filter(Boolean);
  bars.forEach(bar=>{
    if($('.aix-btn',bar)) return;
    const b=document.createElement('button');
    b.type='button'; b.className='aix-btn'; b.id='aixAsk'; b.title='고른 부분을 AI 가 풀어 줍니다';
    b.innerHTML=BTN;
    const x=$('[data-a="x"]',bar);
    if(x) bar.insertBefore(b,x.previousElementSibling?.classList?.contains('sep')?x.previousElementSibling:x);
    else bar.appendChild(b);
    ['click','pointerup'].forEach(ev=>b.addEventListener(ev,e=>{
      e.preventDefault(); e.stopPropagation();
      if(ev==='pointerup'){ b.__t=Date.now(); return ask(); }
      if(Date.now()-(b.__t||0)<500) return;   /* pointerup 과 click 이 겹쳐 두 번 도는 것 방지 */
      ask();
    }));
  });
}
/* 띠는 첫 화면에서 한 번 만들어진다 — 30초만 살피고 그만둔다(늘 도는 시계를 줄인다) */
const injT=setInterval(inject,900); inject();
setTimeout(()=>clearInterval(injT),30000);

/* ── 물어보기 ── */
function ctxOf(el){
  let c=el;
  for(let i=0;i<6 && c?.parentElement;i++){
    if((c.innerText||'').trim().length>500) break;
    c=c.parentElement;
    if(c===document.body){ c=el; break }
  }
  return (c.innerText||'').replace(/\n{3,}/g,'\n\n').trim().slice(0,3000);
}
function areaName(el){
  const k=el.dataset.ann||''; const a=k.split('|')[1]||el.dataset.hl||'';
  return ({q:'문제',a:'답안',e:'쉬운 풀이',x:'해설',ez:'쉬운 풀이'})[a] || (/^c\d/.test(a)?'보기':'본문');
}
function prompt_(sel){
  return `너는 자격증 기출을 가르치는 선생이다. 학생이 아래 «고른 부분» 에서 막혔다.

[문항 맥락 — 참고용, 잘려 있을 수 있다]
${ctxOf(sel.el)}

[고른 부분 — ${areaName(sel.el)}]
${sel.text}

[할 일]
1. **무엇인가** — 고른 부분이 무엇을 가리키는지 한 줄로.
2. **어디서 나왔나** — 어떤 원리·정의·공식에서 나온 식(값)인지 유도 과정을 단계로. 중간 식을 생략하지 마라.
3. **기호와 단위** — 나오는 기호가 각각 무엇이고 단위가 무엇인지.
4. **헷갈리는 곳** — 여기서 흔히 틀리는 것 한두 가지.

수식은 $ ... $ 안에 LaTeX 로 쓴다. 표는 쓰지 마라.
쉬운 말로, 열 줄 안쪽으로 짧게 써라.`;
}
async function callAI(text){
  if(!ENDPOINTS.length) throw new Error('config.js 에 WORKER_URL 이 없습니다');
  const body={ contents:[{role:'user',parts:[{text}]}],
               generationConfig:{ temperature:0.3, maxOutputTokens:1600 } };
  let last='';
  for(const base of ENDPOINTS){
    const ac=new AbortController(); const t=setTimeout(()=>ac.abort(),90000);
    try{
      const res=await fetch(base.replace(/\/$/,'')+'/get-data',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify(body),signal:ac.signal});
      const d=await res.json();
      if(!res.ok){ last=d.detail||('HTTP '+res.status); continue; }
      const out=d.candidates?.[0]?.content?.parts?.[0]?.text||'';
      if(out.trim()) return out.trim();
      last='빈 응답이 왔습니다';
    }catch(e){ last=e.name==='AbortError'?'응답이 너무 오래 걸립니다':e.message; }
    finally{ clearTimeout(t); }
  }
  throw new Error(last||'서버가 응답하지 않습니다');
}

/* ── 작은 마크다운 ── */
function mdLite(t){
  const lines=esc(String(t||'')).split('\n'); let out='',ul=false;
  const close=()=>{ if(ul){ out+='</ul>'; ul=false } };
  for(const raw of lines){
    const x=raw.trim(); if(!x){ close(); continue }
    if(/^#{1,6}\s/.test(x)){ close(); out+='<h4>'+inl(x.replace(/^#+\s/,''))+'</h4>'; continue }
    if(/^[-*]\s/.test(x)||/^\d+[.)]\s/.test(x)){ if(!ul){ out+='<ul>'; ul=true } out+='<li>'+inl(x.replace(/^([-*]|\d+[.)])\s/,''))+'</li>'; continue }
    close(); out+='<p>'+inl(x)+'</p>';
  }
  close(); return out;
}
const inl=x=>x.replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>').replace(/`([^`]+)`/g,'<code>$1</code>');
function tex(el){
  if(!window.renderMathInElement) return;
  try{ renderMathInElement(el,{delimiters:[
    {left:'$$',right:'$$',display:true},{left:'$',right:'$',display:false},
    {left:'\\[',right:'\\]',display:true},{left:'\\(',right:'\\)',display:false}
  ],throwOnError:false,ignoredTags:['script','style','textarea','pre','code']}); }catch(e){}
}

/* ── 판 ── */
let panel=null;
function makePanel(){
  if(panel) return panel;
  panel=document.createElement('div'); panel.className='aix-panel';
  panel.innerHTML=`<div class="aix-h"><b>AI 풀이</b><span class="aix-q"></span>
      <button type="button" class="aix-x" data-close aria-label="닫기">✕</button></div>
    <div class="aix-b"></div>
    <div class="aix-f">
      <button type="button" class="go" data-note hidden>💬 주석에 추가</button>
      <button type="button" data-copy hidden>복사</button>
      <button type="button" data-again hidden>다시</button>
      <button type="button" data-close>닫기</button>
    </div>`;
  document.body.appendChild(panel);
  panel.addEventListener('click',e=>{ if(e.target.closest('[data-close]')) close(); });
  return panel;
}
const close=()=>{ panel?.classList.remove('on'); document.body.classList.remove('aix-open'); };

let BUSY=false;
async function ask(){
  const sel=readSel()||LAST;
  if(!sel){ alert('먼저 설명이 필요한 부분을 끌어서 골라 주세요.'); return }
  LAST=sel;
  if(BUSY) return; BUSY=true;
  const p=makePanel();
  $('.aix-q',p).textContent='“'+sel.text.slice(0,60)+(sel.text.length>60?'…':'')+'”';
  $('.aix-b',p).innerHTML='<div class="aix-wait">읽고 있습니다… 10~25초쯤 걸립니다.</div>';
  $$('.aix-f button[hidden]',p).forEach(b=>b.hidden=true);
  ['[data-note]','[data-copy]','[data-again]'].forEach(s=>{ const b=$(s,p); if(b) b.hidden=true; });
  p.classList.add('on'); document.body.classList.add('aix-open');
  document.querySelector('.annbar')?.classList.remove('on');
  document.querySelector('#hlbar')?.classList.remove('on');
  try{
    const md=await callAI(prompt_(sel));
    const body=$('.aix-b',p);
    body.innerHTML=mdLite(md); tex(body);
    const note=$('[data-note]',p), copy=$('[data-copy]',p), again=$('[data-again]',p);
    note.hidden=copy.hidden=again.hidden=false;
    note.textContent='💬 주석에 추가';
    note.onclick=()=>{ saveNote(sel,md); note.textContent='✓ 주석에 넣었습니다'; note.disabled=true; };
    copy.onclick=()=>{ navigator.clipboard?.writeText(md); copy.textContent='복사됨'; setTimeout(()=>copy.textContent='복사',1200); };
    again.onclick=()=>{ BUSY=false; ask(); };
  }catch(e){
    $('.aix-b',p).innerHTML='<div class="aix-wait">풀지 못했습니다 — '+esc(e.message||e)+'</div>';
  }finally{ BUSY=false; }
}
window.__aiExplainAsk = ask;

/* ══ 주석에 넣기 ═════════════════════════════════════════════ */
function saveNote(sel,md){
  const body='[AI] '+String(md).replace(/\*\*/g,'').trim();
  /* ① 실기 — 원래 쓰던 주석함에 그대로 */
  const api=window.__pracAnnAPI;
  if(sel.kind==='ann' && api){
    try{
      api.setSel({ el:sel.el, key:sel.el.dataset.ann, s:sel.s, e:sel.e, rect:sel.rect });
      api.addNote(body);
      getSelection()?.removeAllRanges();
      return;
    }catch(e){}
  }
  /* ② 필기 — 이 파일이 들고 있는 주석함에 */
  const qid=sel.el.dataset.qid||'', key=sel.el.dataset.hl||sel.el.dataset.ann||'x';
  if(!qid) return;
  const bag=load();
  ((bag[qid] ||= {})[key] ||= []).push({ id:'x'+Date.now().toString(36), s:sel.s, e:sel.e, n:body });
  bag[qid][key].sort((a,b)=>a.s-b.s);
  save(bag);
  getSelection()?.removeAllRanges();
  paintAll(true);
}
const NKEY='gichul:ainote:v1';
const load=()=>{ try{ return JSON.parse(localStorage.getItem(NKEY)||'{}') }catch(e){ return {} } };
const save=v=>{ try{ localStorage.setItem(NKEY,JSON.stringify(v)) }catch(e){} };
function del(qid,key,id){ const b=load(); const a=(b[qid]||{})[key]||[]; b[qid][key]=a.filter(x=>x.id!==id); save(b); paintAll(true); }

let PBUSY=false, pT=0;
function paintAll(force){
  if(PRAC) return;                       /* 실기는 제 주석함이 알아서 그린다 */
  if(PBUSY) return; PBUSY=true;
  try{
    const bag=load();
    $$('[data-hl][data-qid]').forEach(el=>{
      const qid=el.dataset.qid, key=el.dataset.hl;
      const ms=(bag[qid]||{})[key]||[];
      const sig=ms.map(m=>m.id+m.s+'-'+m.e).join(',');
      if(!force && el.dataset.aixSig===sig) return;
      el.dataset.aixSig=sig;
      $$('.aiann-list',el).forEach(x=>x.remove());
      $$('mark.aiann',el).forEach(m=>{ const p=m.parentNode; while(m.firstChild) p.insertBefore(m.firstChild,m); p.removeChild(m); });
      $$('sup.aiann-b',el).forEach(x=>x.remove());
      el.normalize?.();
      if(!ms.length) return;
      let no=0; const num=new Map();
      ms.forEach(m=>{ num.set(m.id,++no) });
      ms.slice().sort((a,b)=>b.s-a.s).forEach(m=>{
        wrapRange(el,m.s,m.e,()=>{
          const w=document.createElement('mark'); w.className='aiann';
          w.dataset.aixid=m.id; w.dataset.aixq=qid; w.dataset.aixk=key; w.title=m.n.slice(0,120); return w;
        },()=>{
          const b=document.createElement('sup'); b.className='aiann-b';
          b.textContent=num.get(m.id); b.dataset.aixid=m.id; b.dataset.aixq=qid; b.dataset.aixk=key; return b;
        });
      });
      const box=document.createElement('div'); box.className='aiann-list';
      box.innerHTML='<div class="h">AI 주석</div>'+ms.map(m=>
        `<div class="it" data-aixid="${m.id}" data-aixq="${qid}" data-aixk="${key}">`+
        `<b>${num.get(m.id)}</b><span>${esc(m.n)}</span></div>`).join('');
      el.appendChild(box);
      tex(box);
    });
  }finally{ setTimeout(()=>{ PBUSY=false },60); }
}
if(!PRAC){
  document.addEventListener('click',e=>{
    const t=e.target.closest('mark.aiann,sup.aiann-b,.aiann-list .it'); if(!t) return;
    e.preventDefault(); e.stopPropagation();
    const {aixid,aixq,aixk}=t.dataset;
    const m=((load()[aixq]||{})[aixk]||[]).find(x=>x.id===aixid); if(!m) return;
    const p=makePanel();
    $('.aix-q',p).textContent='주석';
    $('.aix-b',p).innerHTML=mdLite(m.n); tex($('.aix-b',p));
    const note=$('[data-note]',p), copy=$('[data-copy]',p), again=$('[data-again]',p);
    copy.hidden=again.hidden=true; note.hidden=false; note.disabled=false;
    note.textContent='🗑 이 주석 지우기';
    note.onclick=()=>{ del(aixq,aixk,aixid); close(); };
    p.classList.add('on'); document.body.classList.add('aix-open');
  },true);
  const mo=new MutationObserver(()=>{ clearTimeout(pT); pT=setTimeout(()=>paintAll(false),160); });
  addEventListener('load',()=>{ mo.observe(document.body,{childList:true,subtree:true}); paintAll(true); });
  setTimeout(()=>{ try{ mo.observe(document.body,{childList:true,subtree:true}) }catch(e){} paintAll(true); },1200);
}

/* ── 모양 ── */
const css=document.createElement('style');
css.textContent=`
.aix-btn{border:1px solid var(--line,#e2e8f0);background:linear-gradient(180deg,#eef4ff,#e2ecff);
  color:#1d4ed8;border-radius:7px;height:26px;padding:0 9px;cursor:pointer;
  font:800 10.5px/1 var(--font-d,system-ui);white-space:nowrap}
.aix-btn:hover{border-color:#93b4f5}
#hlbar .aix-btn{height:auto;padding:7px 10px;font-size:11.5px}
@media(max-width:820px),(pointer:coarse){ .annbar .aix-btn{height:36px;padding:0 11px;font-size:12px;border-radius:9px} }

.aix-panel{position:fixed;z-index:100050;display:none;right:14px;bottom:14px;
  width:min(420px,calc(100vw - 28px));max-height:min(72vh,620px);
  flex-direction:column;border-radius:14px;overflow:hidden;
  background:var(--surface,#fff);border:1px solid var(--line,#d7dee8);
  box-shadow:0 22px 60px rgba(15,23,42,.3)}
.aix-panel.on{display:flex}
.aix-h{flex:none;display:flex;align-items:center;gap:7px;padding:9px 11px;
  border-bottom:1px solid var(--line,#e2e8f0);background:var(--surface-2,#f7f9fc)}
.aix-h b{font:800 12px/1 var(--font-d,system-ui);color:var(--ink,#0f172a);flex:none}
.aix-q{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  font:500 10.5px/1.3 var(--font-d,system-ui);color:var(--muted,#64748b)}
.aix-x{flex:none;border:0;background:transparent;cursor:pointer;font-size:13px;color:var(--muted,#64748b)}
.aix-b{flex:1;min-height:0;overflow:auto;padding:11px 12px;
  font:500 12.5px/1.65 var(--font-d,system-ui);color:var(--ink,#0f172a)}
.aix-b h4{margin:9px 0 3px;font:800 12px/1.4 var(--font-d,system-ui)}
.aix-b p{margin:0 0 6px}
.aix-b ul{margin:0 0 7px;padding-left:17px}
.aix-b li{margin:0 0 3px}
.aix-b code{background:var(--surface-2,#f1f5f9);border-radius:4px;padding:0 3px}
.aix-wait{color:var(--muted,#64748b);font-size:11.5px}
.aix-f{flex:none;display:flex;gap:5px;padding:8px 10px;border-top:1px solid var(--line,#e2e8f0);
  background:var(--surface-2,#f7f9fc)}
.aix-f button{flex:1;height:31px;border:1px solid var(--line,#e2e8f0);border-radius:8px;
  background:var(--surface,#fff);color:var(--ink,#0f172a);cursor:pointer;
  font:700 11px/1 var(--font-d,system-ui)}
.aix-f button.go{background:#1d4ed8;border-color:#1d4ed8;color:#fff}
.aix-f button:disabled{opacity:.6;cursor:default}
@media(max-width:820px){
  .aix-panel{left:8px;right:8px;bottom:calc(8px + env(safe-area-inset-bottom));width:auto;max-height:76vh}
  .aix-f button{height:38px;font-size:12.5px}
}
body.aix-open .annbar,body.aix-open .hlbar{display:none!important}

mark.aiann{background:color-mix(in srgb,#bcdcff 70%,transparent);border-bottom:1.6px solid #2563eb;
  border-radius:3px;padding:0 1px;cursor:pointer;box-decoration-break:clone;-webkit-box-decoration-break:clone}
sup.aiann-b{display:inline-block;min-width:14px;height:14px;margin-left:2px;padding:0 3px;border-radius:7px;
  background:#2563eb;color:#fff;font:800 9px/14px var(--font-m,monospace);text-align:center;cursor:pointer}
.aiann-list{margin-top:8px;padding-top:6px;border-top:1px dashed var(--rule,#e2e8f0)}
.aiann-list .h{font:800 9px/1 var(--font-m,monospace);letter-spacing:.1em;color:#2563eb;margin-bottom:5px}
.aiann-list .it{display:flex;gap:6px;align-items:flex-start;margin:0 0 4px;cursor:pointer;
  font:500 11px/1.55 var(--font-d,system-ui);color:var(--ink-2,#475569)}
.aiann-list .it b{flex:none;min-width:14px;height:14px;border-radius:7px;background:#2563eb;color:#fff;
  font:800 9px/14px var(--font-m,monospace);text-align:center}
`;
document.head.appendChild(css);

window.__aiExplain=true;
})();
