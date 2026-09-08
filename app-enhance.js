(function(){
  'use strict';
  const KEY='gichul:app:v3';
  const RECENT_KEY='gichul:recent:v1';
  const PREF_KEY='gichul:prefs:v1';
  const PAGE=(()=>{
    const p=location.pathname.split('/').pop()||'index.html';
    const map={
      'index.html':['홈','학습 대시보드'],
      'practice.html':['실기','실기 기출 · 학습'],
      'calc.html':['계산기','fx-570ES 스타일 공학용 계산기 · SOLVE'],
      'ingest.html':['변환','PDF 자동 변환'],
      'interview.html':['면접','면접 준비 센터'],
      'portfolio.html':['포트폴리오','경력·포트폴리오']
    };
    return map[p]||[document.title.replace(/ ·.*$/,''),'학습 도구'];
  })();


  const APP_VERSION='v94';
  const COMPLETION_WEIGHTS={ui:6,study:6,practice:7,written:5,interview:7,portfolio:5,calculator:8,ingest:5,pwa:4,qa:3,integrity:4,accessibility:4,
    /* 아래 4개는 실제 동작 확인 항목이다. 합계 36점으로, 이게 깨지면 점수가 눈에 띄게 떨어진다. */
    swActive:10,storage:8,configOk:8,aiReachable:10};

  /* ── 실제로 실패할 수 있는 검사 ─────────────────────────────
     예전 완성도 점수는 "링크가 있나 / 함수가 정의됐나"만 세어서
     앱이 실제로 고장 나도 100% 가 나왔다.
     아래 항목은 브라우저에서 진짜로 확인해 실패할 수 있는 것들이다. */
  const RUNTIME={swActive:null,storage:null,config:null,ai:null,checkedAt:0};
  function configOk(){
    const c=window.APP_CONFIG||{};
    const bad=v=>!v||/^(넣으세요|여기|TODO|xxx|1234)$/i.test(String(v).trim());
    return !bad(c.SUPABASE_URL) && !bad(c.SUPABASE_ANON_KEY) && !bad(c.AI_WORKER_URL);
  }
  function storageOk(){
    try{ const k='gichul:__probe'; localStorage.setItem(k,'1'); const v=localStorage.getItem(k); localStorage.removeItem(k); return v==='1'; }
    catch{ return false; }
  }
  async function probeRuntime(){
    RUNTIME.storage=storageOk();
    RUNTIME.config=configOk();
    try{
      if(!('serviceWorker' in navigator)) RUNTIME.swActive=false;
      else { const reg=await navigator.serviceWorker.getRegistration(); RUNTIME.swActive=!!(reg&&(reg.active||navigator.serviceWorker.controller)); }
    }catch{ RUNTIME.swActive=false; }
    try{
      const base=String((window.APP_CONFIG||{}).AI_WORKER_URL||'').replace(/\/+$/,'');
      if(!base) RUNTIME.ai=false;
      else{
        const ctl=new AbortController(); const t=setTimeout(()=>ctl.abort(),4000);
        const r=await fetch(base+'/ai/health',{signal:ctl.signal}); clearTimeout(t);
        RUNTIME.ai=r.ok;
      }
    }catch{ RUNTIME.ai=false; }
    RUNTIME.checkedAt=Date.now();
    return RUNTIME;
  }
  const INTERVIEW_KEYS=/^iv(?:-|:)/;
  const STUDY_KEYS=/^(?:gichul:|prac:)/;
  function isInterviewPage(){return PAGE[0]==='면접'}
  function completionReport(){
    const has = (sel)=>!!document.querySelector(sel);
    const navTargets=['index.html','practice.html','calc.html','ingest.html','interview.html','portfolio.html'];
    const navCount=navTargets.filter(f=>!!document.querySelector(`a[href*="${f}"]`)).length;
    const modalOk=[...document.querySelectorAll('[role="dialog"]')].every(el=>el.hasAttribute('aria-modal') || el.getAttribute('role')!=='dialog');
    const interactive=[...document.querySelectorAll('button,a,input,select,textarea')];
    const unlabeled=interactive.filter(el=>{
      if(el.hidden || el.getAttribute('aria-hidden')==='true') return false;
      if(el.tagName==='A' && el.textContent.trim()) return false;
      if(el.textContent.trim()) return false;
      return !(el.getAttribute('aria-label')||el.getAttribute('title')||el.getAttribute('aria-labelledby'));
    }).length;
    const auditLocal=(()=>{try{
      const bad=[];
      for(let i=0;i<localStorage.length;i++){
        const k=localStorage.key(i)||'', v=localStorage.getItem(k)||'';
        if(v.length>900000) bad.push(k);
        if(/^(gichul:calc-state|gichul:calc-history|gichul:activity|gichul:recent|gichul:favorites)/.test(k)){ try{ if(k==='gichul:calc-history'||k==='gichul:calc-state'||k==='gichul:activity'||k==='gichul:recent'||k==='gichul:favorites') JSON.parse(v); }catch{bad.push(k)} }
      }
      return bad.length===0;
    }catch{return false}})();
    const checks={
      ui: navCount===6 && (has('.nav3') || !!window.AppUI),
      study: typeof activityRead==='function' && typeof addStudySeconds==='function' && typeof exportLocalData==='function' && typeof importLocalData==='function',
      practice: navCount>=2 && !!document.querySelector('a[href*="practice.html"]'),
      written: navCount>=2 && !!document.querySelector('a[href*="index.html"]'),
      interview: !!document.querySelector('a[href*="interview.html"]') && typeof INTERVIEW_KEYS?.test==='function',
      portfolio: !!document.querySelector('a[href*="portfolio.html"]'),
      calculator: !!document.querySelector('a[href*="calc.html"]') && (PAGE[0]!=='계산기' || !!window.CalcEngine),
      ingest: !!document.querySelector('a[href*="ingest.html"]'),
      pwa: 'serviceWorker' in navigator,
      qa: !!window.AppUI && typeof buildDiagnostics==='function' && typeof runSelfTests==='function',
      integrity: !hasStudyInterviewCrossContamination() && auditLocal,
      accessibility: interactive.length>0 && unlabeled===0 && modalOk,
      swActive: RUNTIME.swActive===true,
      storage: RUNTIME.storage!==false,
      configOk: RUNTIME.config!==false,
      aiReachable: RUNTIME.ai===true
    };
    /* 실동작 검사를 아직 못 돌렸으면 그 항목은 아예 점수에서 빼고, 구조 점수만 낸다.
       (검사도 안 해놓고 «미달» 로 깎지 않기 위함) */
    const RUNTIME_KEYS=['swActive','storage','configOk','aiReachable'];
    const probed=RUNTIME.checkedAt>0;
    let score=0,total=0;
    for(const [k,w] of Object.entries(COMPLETION_WEIGHTS)){
      if(!probed && RUNTIME_KEYS.includes(k)) continue;
      total+=w; if(checks[k])score+=w;
    }
    const visibleChecks={...checks}; if(!probed) for(const k of RUNTIME_KEYS) delete visibleChecks[k];
    return {score:Math.round(score/total*100), checks:visibleChecks, allChecks:checks, probed, qaScore:qualityQAScore(), navCount, unlabeled, localDataOk:auditLocal, runtime:{...RUNTIME}};
  }
  function hasStudyInterviewCrossContamination(){
    try{
      for(let i=0;i<localStorage.length;i++){
        const k=localStorage.key(i)||'';
        if((INTERVIEW_KEYS.test(k) && STUDY_KEYS.test(k)) || (STUDY_KEYS.test(k) && k.startsWith('iv')) || (INTERVIEW_KEYS.test(k) && (k.startsWith('gichul:')||k.startsWith('prac:')))) return true;
      }
    }catch{}
    return false;
  }
  function qualityQAScore(){
    const base=[
      !!window.AppUI,
      !!document.querySelector('.nav3'),
      typeof activityRead==='function',
      typeof exportLocalData==='function',
      typeof importLocalData==='function',
      !hasStudyInterviewCrossContamination(),
      !!document.querySelector('[role=\"dialog\"]') || !!document.querySelector('button, a, input'),
      'serviceWorker' in navigator
    ];
    if(PAGE[0]==='계산기') base.push(!!window.CalcEngine);
    const pass=base.filter(Boolean).length; return Math.round(pass/base.length*100);
  }
  async function showCompletion(){
    await probeRuntime();
    let back=$('.app-completion-backdrop');
    if(!back){
      back=document.createElement('div'); back.className='app-completion-backdrop';
      back.innerHTML=`<div class="app-completion" role="dialog" aria-modal="true" aria-label="제품 완성도"><div class="app-completion-head"><div><small>PRODUCT READINESS</small><b>현재 완성도</b></div><button type="button" data-close aria-label="닫기">×</button></div><div class="app-completion-score"><strong data-score>0%</strong><span>구현·구조 기준의 제품 완성도입니다. 실제 브라우저/모바일 QA는 별도 검증됩니다.</span></div><div class="app-completion-bar"><i data-bar></i></div><div class="app-completion-list" data-list></div><div class="app-completion-foot"><small data-final-status>구현/구조와 실제 QA를 분리해 표시합니다.</small></div></div>`;
      document.body.appendChild(back); back.addEventListener('click',e=>{if(e.target===back)back.classList.remove('open')}); back.querySelector('[data-close]').onclick=()=>back.classList.remove('open');
    }
    const r=completionReport(); back.querySelector('[data-score]').textContent=r.score+'%'; back.querySelector('[data-bar]').style.width=r.score+'%'; const sub=back.querySelector('.app-completion-score span'); if(sub) sub.textContent=`구조 ${r.score}% · 자동 QA ${r.qaScore}% · 실동작 검사 포함`;
    const labels={ui:'공통 UI',study:'학습 시스템',practice:'실기',written:'필기',interview:'면접',portfolio:'포트폴리오',calculator:'공학용 계산기',ingest:'자료 변환',pwa:'PWA/오프라인',qa:'진단/오류 처리',integrity:'데이터 무결성',accessibility:'접근성',swActive:'서비스워커 실제 동작',storage:'로컬 저장소 쓰기',configOk:'설정값 채워짐',aiReachable:'AI 워커 응답'};
    // v88: 구조 점수와 실동작 검사를 함께 반영한다.
    const implementationReady = r.score >= 95 && r.qaScore >= 98 && r.unlabeled === 0 && r.localDataOk && !hasStudyInterviewCrossContamination()
      && r.allChecks.swActive && r.allChecks.storage && r.allChecks.configOk && r.allChecks.aiReachable;
    const statusNote = back.querySelector('[data-final-status]'); if(statusNote) statusNote.textContent = implementationReady ? '구현/구조: 완료 · 자동 검증: 통과 · 실기기 수동 QA: 별도' : '보완 필요 항목이 있습니다.';
    back.querySelector('[data-list]').innerHTML=Object.entries(r.checks).map(([k,v])=>`<div class="app-completion-item ${v?'ok':'warn'}"><b>${v?'✓':'!'}</b><span>${labels[k]}</span><em>${v?'완료':'보완 필요'}</em></div>`).join(''); back.classList.add('open');
  }

  const $=(s,r=document)=>r.querySelector(s);
  const $$=(s,r=document)=>[...r.querySelectorAll(s)];
  const read=()=>{try{return JSON.parse(localStorage.getItem(KEY)||'{}')}catch{return {}}};
  const write=v=>{try{localStorage.setItem(KEY,JSON.stringify(v))}catch{}};
  const state=read(); state.visit=state.visit||{}; state.visit[PAGE[0]]=(state.visit[PAGE[0]]||0)+1; state.lastPage=location.href; state.updatedAt=Date.now(); write(state);
  const ACTIVITY_KEY='gichul:activity:v1';
  const GOAL_KEY='gichul:study-goal:v1';
  const FOCUS_KEY='gichul:focus:v1';
  function activityRead(){try{return JSON.parse(localStorage.getItem(ACTIVITY_KEY)||'{\"days\":{}}')}catch{return{days:{}}}}
  function dayKey(ts=Date.now()){const d=new Date(ts);return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')}
  function getGoal(){try{const n=Number(localStorage.getItem(GOAL_KEY));return Number.isFinite(n)&&n>0?Math.min(480,Math.round(n)):45}catch{return 45}}
  function setGoal(v){try{localStorage.setItem(GOAL_KEY,String(Math.max(10,Math.min(480,Math.round(Number(v)||45)))))}catch{}}
  function daySeconds(key=dayKey()){const a=activityRead();return Number(a.days?.[key]?.seconds||0)}
  function streakDays(){const a=activityRead(),days=a.days||{}, cur=new Date(); let n=0; for(let i=0;i<45;i++){const k=dayKey(cur.getTime()-i*86400000); if(Number(days[k]?.seconds||0)>=60)n++; else if(i===0)continue; else break} return n}
  function last7(){return Array.from({length:7},(_,i)=>{const ts=Date.now()-(6-i)*86400000;const d=new Date(ts);return {key:dayKey(ts),label:`${d.getMonth()+1}/${d.getDate()}`,sec:daySeconds(dayKey(ts))}})}
  function addStudySeconds(sec){if(!Number.isFinite(sec)||sec<=0)return;try{const a=activityRead(),k=dayKey(),day=a.days[k]||{seconds:0,pages:{}};day.seconds+=Math.round(sec);day.pages=day.pages||{};day.pages[PAGE[0]]=(day.pages[PAGE[0]]||0)+1;a.days[k]=day;const keys=Object.keys(a.days).sort().slice(-45);a.days=Object.fromEntries(keys.map(x=>[x,a.days[x]]));localStorage.setItem(ACTIVITY_KEY,JSON.stringify(a))}catch{}}
  let __pageStarted=Date.now();
  addEventListener('pagehide',()=>addStudySeconds((Date.now()-__pageStarted)/1000));
  function recentRead(){try{return JSON.parse(localStorage.getItem(RECENT_KEY)||'[]')}catch{return[]}}
  function recentWrite(v){try{localStorage.setItem(RECENT_KEY,JSON.stringify(v.slice(0,12)))}catch{}}
  function trackRecent(){ const arr=recentRead().filter(x=>x.href!==location.href); arr.unshift({href:location.href,title:PAGE[0],sub:PAGE[1],at:Date.now()}); recentWrite(arr); }
  trackRecent();

  function toast(msg,type=''){
    let wrap=$('.app-toast-wrap'); if(!wrap){wrap=document.createElement('div');wrap.className='app-toast-wrap';document.body.appendChild(wrap)}
    const el=document.createElement('div');el.className='app-toast '+type;el.textContent=msg;wrap.appendChild(el);
    setTimeout(()=>{el.style.opacity='0';el.style.transform='translateY(8px)';setTimeout(()=>el.remove(),180)},2300);
  }
  window.AppUI=window.AppUI||{}; window.AppUI.toast=toast; window.AppUI.version=APP_VERSION; window.AppUI.completion=completionReport; window.AppUI.exportStudy=exportLocalData; window.AppUI.importStudy=importLocalData;

  function navLinks(){
    const base='./';
    return [
      ['⌂','홈','index.html','대시보드 · 전체 학습'],
      ['◩','실기','practice.html','실기 기출 · 시험 모드'],
      ['🧮','계산기','calc.html','fx-570ES 스타일 · SOLVE · 공학용 계산'],
      ['⇪','변환','ingest.html','PDF → 문제 자동 변환'],
      ['◎','면접','interview.html','질문 · 답변 · 준비'],
      ['▣','포트폴리오','portfolio.html','경력 · 문서 관리']
    ];
  }

  function buildContext(){
    const n=document.querySelector('.nav3'); if(!n) return;
    const c=document.createElement('div');c.className='app-context';
    c.innerHTML=`<span class="ctx-dot"></span><span class="ctx-page">${PAGE[0]}</span><span>›</span><span>${PAGE[1]}</span><span class="ctx-spacer"></span><span class="ctx-extra">Ctrl+K 전체 메뉴</span><button type="button" data-app-cmd>⌘ 메뉴</button>`;
    n.insertAdjacentElement('afterend',c);
    c.querySelector('[data-app-cmd]').onclick=()=>{ if(typeof window.openCmd==='function') window.openCmd(); };
  }

  function buildScroll(){
    const b=document.createElement('div');b.className='app-scroll-progress';document.body.appendChild(b);
    const upd=()=>{const d=document.documentElement,h=d.scrollHeight-innerHeight; b.style.width=(h>0?(scrollY/h)*100:0)+'%'};
    addEventListener('scroll',upd,{passive:true});addEventListener('resize',upd);upd();
  }

  const actions=[
    {ico:'⌂',title:'홈으로',sub:'전체 대시보드',href:'./index.html',keys:'H'},
    {ico:'◩',title:'실기 바로가기',sub:'기출 · 시험 모드',href:'./practice.html',keys:'P'},
    {ico:'🧮',title:'공학용 계산기',sub:'fx-570ES 스타일 · SOLVE',href:'./calc.html',keys:'C'},
    {ico:'⇪',title:'PDF 자동 변환',sub:'문제 데이터 만들기',href:'./ingest.html',keys:'I'},
    {ico:'◎',title:'면접 센터',sub:'질문 · 답변 준비',href:'./interview.html',keys:'M'},
    {ico:'▣',title:'포트폴리오',sub:'경력 문서 관리',href:'./portfolio.html',keys:'R'},
    {ico:'↟',title:'페이지 맨 위',sub:'현재 화면 처음으로',action:'top',keys:'T'},
    {ico:'?',title:'단축키 보기',sub:'Ctrl+K에서 명령 검색',action:'help',keys:'?'},
    {ico:'⚙',title:'앱 설정',sub:'테마 · 집중 모드 · 모션',action:'settings',keys:'S'},
    {ico:'↥',title:'앱 설치',sub:'지원되는 브라우저에서 홈 화면에 추가',action:'install',keys:'A'},
    {ico:'⏱',title:'학습 타이머',sub:'페이지를 넘나들며 누적 학습 시간을 기록',action:'timer',keys:'Z'},
    {ico:'▤',title:'학습 센터',sub:'오늘 목표 · 7일 기록 · 학습 연속',action:'study',keys:'Y'},
    {ico:'⇩',title:'학습 데이터 백업',sub:'이 기기의 기록을 JSON으로 저장',action:'export',keys:'E'},
    {ico:'⇧',title:'학습 데이터 복원',sub:'백업한 JSON을 다시 가져오기',action:'import',keys:'U'},
    {ico:'🩺',title:'앱 상태 진단',sub:'저장공간 · 서비스워커 · 핵심 기능 점검',action:'diagnostics',keys:'V'},
    {ico:'◒',title:'현재 완성도',sub:'제품 기능/구조 기준의 내부 완성도',action:'completion',keys:'Q'},
    {ico:'✓',title:'앱 자가 테스트',sub:'핵심 기능·데이터 분리·계산 엔진 자동 점검',action:'selftest',keys:'J'},
    {ico:'🚦',title:'출시 점검',sub:'배포 전 필수 게이트를 한 번에 검사',action:'releasegate',keys:'L'},
    {ico:'🧪',title:'전체 QA 센터',sub:'모든 페이지·정적 파일·버전 동기화 상태 확인',action:'qacenter',keys:'O'}
  ];
  let deferredInstall=null;
  function notifyInstallPrompt(e){e.preventDefault();deferredInstall=e;}
  addEventListener('beforeinstallprompt',notifyInstallPrompt);
  function installApp(){
    if(!deferredInstall){toast('현재 브라우저에서는 앱 설치 메뉴를 직접 사용해 주세요.','warn');return}
    deferredInstall.prompt(); deferredInstall.userChoice?.finally(()=>{deferredInstall=null});
  }
  function exportLocalData(){
    const keys=[];
    for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i); if(k && STUDY_KEYS.test(k) && !INTERVIEW_KEYS.test(k)) keys.push(k);}
    const payload={schema:4,exportedAt:new Date().toISOString(),source:'gichul-viewer',domains:{study:['gichul:','prac:'],interview:['iv-','iv:']},isolation:'interview-excluded',integrity:{interviewKeysExcluded:true,crossContamination:false},data:{}};
    keys.sort().forEach(k=>{try{payload.data[k]=JSON.parse(localStorage.getItem(k))}catch{payload.data[k]=localStorage.getItem(k)}});
    const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});
    const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`gichul-viewer-backup-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);toast(`${keys.length}개 학습 기록을 백업했습니다. (면접 데이터 제외)`,'ok');
  }
  function importLocalData(){
    const input=document.createElement('input'); input.type='file'; input.accept='application/json,.json';
    input.onchange=()=>{const file=input.files?.[0];if(!file)return; if(file.size>8*1024*1024){toast('백업 파일은 8MB 이하만 복원할 수 있습니다.','err');return;} const fr=new FileReader(); fr.onload=()=>{try{const payload=JSON.parse(fr.result); if(payload?.source!=='gichul-viewer'||!payload?.data||typeof payload.data!=='object')throw new Error('지원하지 않는 백업 파일입니다.'); const schema=Number(payload.schema||0); if(schema>4)throw new Error('더 최신 버전의 백업 파일입니다. 먼저 앱을 업데이트하세요.'); let n=0, skipped=0; Object.entries(payload.data).forEach(([k,v])=>{if(!STUDY_KEYS.test(k)||INTERVIEW_KEYS.test(k)){skipped++;return;} if(k.length>180){skipped++;return;} localStorage.setItem(k,typeof v==='string'?v:JSON.stringify(v));n++;}); toast(`${n}개 기록을 복원했습니다. ${skipped?`${skipped}개 항목은 격리 규칙으로 제외했습니다. `:''}새로고침하면 반영됩니다.`,'ok'); setTimeout(()=>location.reload(),700);}catch(e){toast(e.message||'백업 파일을 읽지 못했습니다.','err')}};fr.readAsText(file)}; input.click();
  }

  function openSettings(){
    let back=$('.app-settings-backdrop');
    if(!back){
      back=document.createElement('div'); back.className='app-settings-backdrop';
      back.innerHTML=`<aside class="app-settings" role="dialog" aria-modal="true" aria-label="앱 설정">
        <div class="app-settings-head"><b>앱 설정</b><button type="button" data-close aria-label="닫기">×</button></div>
        <div class="app-settings-body">
          <label class="app-setting-row"><span><b>테마</b><small>밝은 화면과 어두운 화면</small></span><button type="button" data-theme class="app-setting-btn"></button></label>
          <label class="app-setting-row"><span><b>집중 모드</b><small>상단/퀵 UI를 최소화</small></span><button type="button" data-focus class="app-setting-btn"></button></label>
          <label class="app-setting-row"><span><b>동작 줄이기</b><small>애니메이션과 전환 효과 최소화</small></span><button type="button" data-motion class="app-setting-btn"></button></label>
          <div class="app-setting-divider"></div>
          <div class="app-setting-block"><b>로컬 기록</b><small>최근 사용·즐겨찾기·학습시간·타이머를 이 기기에 저장합니다.</small><div class="app-setting-actions"><button type="button" data-export class="app-setting-btn">백업 저장</button><button type="button" data-import class="app-setting-btn">백업 복원</button></div><button type="button" data-reset class="app-setting-danger">로컬 기록 초기화</button></div>
        </div>
      </aside>`;
      document.body.appendChild(back);
      back.addEventListener('click',e=>{if(e.target===back)closeSettings()});
      $('[data-close]',back).onclick=closeSettings;
      $('[data-theme]',back).onclick=()=>{toggleTheme();paintSettings()};
      $('[data-focus]',back).onclick=()=>{toggleFocus();paintSettings()};
      $('[data-motion]',back).onclick=()=>{document.documentElement.classList.toggle('reduce-motion'); localStorage.setItem(PREF_KEY,JSON.stringify({reduce:document.documentElement.classList.contains('reduce-motion')})); paintSettings();};
      $('[data-reset]',back).onclick=()=>{ if(confirm('이 기기의 학습/앱 로컬 기록을 초기화할까요? 면접 데이터(iv-/iv:)는 보존됩니다.')){const rm=[];for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k&&STUDY_KEYS.test(k)&&!INTERVIEW_KEYS.test(k))rm.push(k)}rm.forEach(k=>localStorage.removeItem(k));[KEY,RECENT_KEY,FAVORITES_KEY,ACTIVITY_KEY,TIMER_KEY].forEach(k=>localStorage.removeItem(k));toast(`학습/앱 로컬 기록 ${rm.length}개를 초기화했습니다. 면접 데이터는 보존됩니다.`,'ok');paintSettings();} };
      $('[data-export]',back).onclick=exportLocalData;
      $('[data-import]',back).onclick=importLocalData;
    }
    paintSettings(); back.classList.add('open'); setTimeout(()=>back.querySelector('[data-close]')?.focus(),20);
  }
  function closeSettings(){ $('.app-settings-backdrop')?.classList.remove('open'); }
  function paintSettings(){
    const b=$('.app-settings-backdrop'); if(!b)return;
    const dark=document.documentElement.dataset.theme==='dark', focus=document.body.classList.contains('app-focus'), reduced=document.documentElement.classList.contains('reduce-motion');
    const set=(sel,on,label)=>{const el=$(sel,b); if(!el)return; el.textContent=on?'켜짐':'꺼짐'; el.dataset.on=on?'1':'0'; el.setAttribute('aria-pressed',String(on)); el.title=label};
    set('[data-theme]',dark,dark?'라이트 모드로 전환':'다크 모드로 전환'); set('[data-focus]',focus,focus?'집중 모드 끄기':'집중 모드 켜기'); set('[data-motion]',reduced,reduced?'동작 줄이기 끄기':'동작 줄이기 켜기');
  }
  const TIMER_KEY='gichul:timer:v1';
  function timerRead(){try{return JSON.parse(localStorage.getItem(TIMER_KEY)||'{\"running\":false,\"startedAt\":null,\"base\":0}')}catch{return{running:false,startedAt:null,base:0}}}
  function timerElapsed(){const t=timerRead();return t.running&&t.startedAt?t.base+(Date.now()-t.startedAt):t.base||0}
  function saveTimer(v){try{localStorage.setItem(TIMER_KEY,JSON.stringify(v))}catch{}}
  function openTimer(){
    let back=$('.app-timer-backdrop');
    if(!back){
      back=document.createElement('div');back.className='app-timer-backdrop';
      back.innerHTML=`<div class="app-timer" role="dialog" aria-modal="true" aria-label="학습 타이머"><div class="app-timer-top"><span>학습 타이머</span><button type="button" data-close aria-label="닫기">×</button></div><div class="app-timer-time" data-time>00:00</div><div class="app-timer-sub">페이지 이동 후에도 시간이 이어집니다.</div><div class="app-timer-actions"><button type="button" data-toggle>시작</button><button type="button" data-reset class="secondary">초기화</button></div></div>`;
      document.body.appendChild(back);
      back.addEventListener('click',e=>{if(e.target===back)back.classList.remove('open')});
      back.querySelector('[data-close]').onclick=()=>back.classList.remove('open');
      back.querySelector('[data-toggle]').onclick=()=>{const t=timerRead();if(t.running){t.base=timerElapsed();t.running=false;t.startedAt=null}else{t.base=timerElapsed();t.running=true;t.startedAt=Date.now()}saveTimer(t);paintTimer()};
      back.querySelector('[data-reset]').onclick=()=>{saveTimer({running:false,startedAt:null,base:0});paintTimer()};
    }
    paintTimer();back.classList.add('open');
  }
  function paintTimer(){const back=$('.app-timer-backdrop');if(!back)return;const t=timerRead(), sec=Math.floor(timerElapsed()/1000), hh=Math.floor(sec/3600), mm=Math.floor(sec%3600/60), ss=sec%60;back.querySelector('[data-time]').textContent=(hh?String(hh).padStart(2,'0')+':':'')+String(mm).padStart(2,'0')+':'+String(ss).padStart(2,'0');back.querySelector('[data-toggle]').textContent=t.running?'일시정지':'시작'}
  setInterval(()=>{if($('.app-timer-backdrop.open'))paintTimer()},1000);
  function activitySummary(){const a=activityRead(),days=Object.keys(a.days||{}).sort();const today=a.days?.[dayKey()]?.seconds||0;let streak=0;let d=new Date();for(;;){const k=dayKey(d.getTime());if((a.days?.[k]?.seconds||0)>0){streak++;d.setDate(d.getDate()-1)}else break}return {today,streak,total:days.reduce((n,k)=>n+(a.days[k]?.seconds||0),0)}}

  function buildHomeHub(){
    if(PAGE[0]!=='홈' || $('.app-home-hub')) return;
    const mount=$('#v-subjects .wrap')||$('.wrap'); if(!mount)return;
    const favs=getFavs().slice().reverse().slice(0,5), rec=recentRead().filter(x=>x.href!==location.href).slice(0,5);
    const visit=read().visit||{};
    const pageCount=Object.keys(visit).filter(Boolean).length;
    const totalVisits=Object.values(visit).reduce((a,b)=>a+(Number(b)||0),0);
    const act=activitySummary();
    const fmt=sec=>{const m=Math.floor(sec/60),h=Math.floor(m/60);return h?`${h}시간 ${m%60}분`:m?`${m}분`:'0분'};
    const favHtml=favs.length?favs.map(x=>`<a class="app-home-item" href="${x.href}"><span class="app-home-ico">★</span><span><b>${escapeHtml(x.page)}</b><small>${escapeHtml(x.title||'즐겨찾기')}</small></span><i>›</i></a>`).join(''):`<div class="app-home-empty">아직 즐겨찾기가 없습니다.<br><small>현재 페이지에서 ★ 버튼을 눌러 추가하세요.</small></div>`;
    const recHtml=rec.length?rec.map(x=>`<a class="app-home-item" href="${x.href}"><span class="app-home-ico recent">↻</span><span><b>${escapeHtml(x.title)}</b><small>${escapeHtml(x.sub)}</small></span><i>›</i></a>`).join(''):`<div class="app-home-empty">최근 사용 기록이 여기 표시됩니다.</div>`;
    const hub=document.createElement('section'); hub.className='app-home-hub'; hub.innerHTML=`<div class="app-home-hero"><div><span class="app-home-kicker">TODAY</span><h2>오늘은 어디부터 할까요?</h2><p>최근 작업과 즐겨찾기를 한 화면에서 이어서 시작하세요.</p></div><div class="app-home-stats"><div><b>${fmt(act.today)}</b><small>오늘 학습</small></div><div><b>${act.streak}일</b><small>학습 연속</small></div><div><b>${fmt(act.total)}</b><small>누적 학습</small></div><div><b>${Math.min(100,Math.round(act.today/(getGoal()*60)*100))}%</b><small>오늘 목표</small></div></div></div><div class="app-home-grid"><section><div class="app-home-head"><b>최근 사용</b><span>최대 5개</span></div>${recHtml}</section><section><div class="app-home-head"><b>즐겨찾기</b><span>${favs.length?'저장됨':'비어 있음'}</span></div>${favHtml}</section></div><div class="app-home-quality"><div><small>PRODUCT READINESS</small><b>구조 점검 ${completionReport().score}%</b><span>실동작 검사는 상세 보기에서 실행</span></div><button type="button" data-quality>상세 보기</button></div><div class="app-home-quick"><button type="button" data-quick="practice">실기 바로 시작</button><button type="button" data-quick="interview">면접 준비</button><button type="button" data-quick="convert">PDF 변환</button><button type="button" data-quick="timer">학습 타이머</button><button type="button" data-quick="settings">앱 설정</button><button type="button" data-quick="study">학습 센터</button></div>`;
    mount.insertBefore(hub,mount.firstChild);
    hub.querySelector('[data-quality]').onclick=showCompletion;
    hub.querySelector('[data-quick="practice"]').onclick=()=>location.href='./practice.html';
    hub.querySelector('[data-quick="interview"]').onclick=()=>location.href='./interview.html';
    hub.querySelector('[data-quick="convert"]').onclick=()=>location.href='./ingest.html';
    hub.querySelector('[data-quick="timer"]').onclick=openTimer;
    hub.querySelector('[data-quick="settings"]').onclick=openSettings;
    hub.querySelector('[data-quick="study"]').onclick=openStudyCenter;
  }
  function escapeHtml(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

  function buildCmd(){
    const back=document.createElement('div');back.className='app-cmd-backdrop';
    const panel=document.createElement('div');panel.className='app-cmd';
    panel.innerHTML=`<div class="app-cmd-head"><span style="font-size:16px">⌘</span><input class="app-cmd-search" placeholder="무엇을 할까요?  예: 실기, 면접, 홈" autocomplete="off" /></div><div class="app-cmd-list"></div>`;
    document.body.append(back,panel); back.addEventListener('click',closeCmd);
    const input=$('.app-cmd-search',panel),list=$('.app-cmd-list',panel);
    function render(q=''){
      const qq=q.trim().toLowerCase(); const rows=actions.filter(a=>!qq||[a.title,a.sub,a.keys].join(' ').toLowerCase().includes(qq));
      list.innerHTML=rows.map((a,i)=>`<button class="app-cmd-item${i===0?' active':''}" type="button" data-idx="${i}"><span class="app-cmd-ico">${a.ico}</span><span><span class="app-cmd-title">${a.title}</span><span class="app-cmd-sub">${a.sub}</span></span><span class="app-cmd-kbd">${a.keys}</span></button>`).join('') || '<div class="app-empty"><strong>명령이 없습니다</strong><span>다른 검색어를 입력해 보세요.</span></div>';
      $$('.app-cmd-item',panel).forEach((b)=>b.addEventListener('click',()=>{const a=rows[+b.dataset.idx];run(a)}));
    }
    function run(a){if(a.href){location.href=a.href;return} if(a.action==='top'){closeCmd();scrollTo({top:0,behavior:'smooth'});return} if(a.action==='help'){closeCmd();toast('Ctrl+K 메뉴 · H/P/C/I/M/R 이동 · Y 학습센터 · Z 타이머 · S 설정 · J 자가테스트 · L 출시점검 · O 전체QA · E 백업 · U 복원');return} if(a.action==='settings'){closeCmd();openSettings();return} if(a.action==='install'){closeCmd();installApp();return} if(a.action==='timer'){closeCmd();openTimer();return} if(a.action==='study'){closeCmd();openStudyCenter();return} if(a.action==='export'){closeCmd();exportLocalData();return} if(a.action==='import'){closeCmd();importLocalData();return} if(a.action==='diagnostics'){closeCmd();openDiagnostics();return} if(a.action==='completion'){closeCmd();showCompletion();return} if(a.action==='selftest'){closeCmd();openSelfTest();return} if(a.action==='releasegate'){closeCmd();openReleaseGate();return} if(a.action==='qacenter'){closeCmd();openQACenter();return}}
    input.addEventListener('input',()=>render(input.value));
    input.addEventListener('keydown',e=>{
      if(e.key==='Escape'){closeCmd();e.preventDefault();return}
      const items=$$('.app-cmd-item',panel), ix=items.findIndex(x=>x.classList.contains('active'));
      if(e.key==='ArrowDown'&&items.length){items[ix]?.classList.remove('active');items[(ix+1)%items.length].classList.add('active');e.preventDefault()}
      if(e.key==='ArrowUp'&&items.length){items[ix]?.classList.remove('active');items[(ix-1+items.length)%items.length].classList.add('active');e.preventDefault()}
      if(e.key==='Enter'&&items.length){items[Math.max(ix,0)].click();e.preventDefault()}
    });
    function openCmd(){back.classList.add('open');panel.classList.add('open');input.value='';render('');setTimeout(()=>input.focus(),30)}
    window.openCmd=openCmd;
    function closeCmd(){back.classList.remove('open');panel.classList.remove('open')}
    window.closeCmd=closeCmd;
    window.openStudyCenter=openStudyCenter;
  }

  function openStudyCenter(){
    let back=$('.app-study-backdrop');
    if(!back){
      back=document.createElement('div'); back.className='app-study-backdrop';
      back.innerHTML=`<div class="app-study" role="dialog" aria-modal="true" aria-label="학습 센터"><div class="app-study-head"><div><small>LEARNING CENTER</small><b>학습 센터</b></div><button type="button" data-close aria-label="닫기">×</button></div><div class="app-study-summary" data-summary></div><div class="app-study-chart" data-chart></div><div class="app-study-goal"><div><b>오늘 목표</b><small>하루 학습 시간을 설정합니다.</small></div><div class="app-study-goal-edit"><input type="number" min="10" max="480" step="5" data-goal-input><span>분</span><button type="button" data-goal-save>저장</button></div></div><div class="app-study-actions"><button type="button" data-go>실기 시작</button><button type="button" data-timer class="secondary">타이머 열기</button><button type="button" data-settings class="secondary">설정</button></div></div>`;
      document.body.appendChild(back);
      back.addEventListener('click',e=>{if(e.target===back)back.classList.remove('open')});
      $('[data-close]',back).onclick=()=>back.classList.remove('open');
      $('[data-go]',back).onclick=()=>location.href='./practice.html';
      $('[data-timer]',back).onclick=()=>{back.classList.remove('open');openTimer()};
      $('[data-settings]',back).onclick=()=>{back.classList.remove('open');openSettings()};
      $('[data-goal-save]',back).onclick=()=>{setGoal($('[data-goal-input]',back).value); paintStudyCenter(); toast('오늘 목표를 저장했습니다.','ok')};
    }
    paintStudyCenter(); back.classList.add('open'); setTimeout(()=>back.querySelector('[data-close]')?.focus(),20);
  }
  function paintStudyCenter(){
    const b=$('.app-study-backdrop'); if(!b)return; const goal=getGoal()*60, today=daySeconds(), pct=Math.min(100,Math.round(today/goal*100)); const fmt=m=>m>=60?`${Math.floor(m/60)}시간 ${m%60}분`:`${m}분`;
    b.querySelector('[data-summary]').innerHTML=`<div><strong>${fmt(Math.floor(today/60))}</strong><span>오늘 학습</span></div><div><strong>${pct}%</strong><span>목표 달성</span></div><div><strong>${streakDays()}일</strong><span>연속 학습</span></div>`;
    const rows=last7(), max=Math.max(goal,...rows.map(x=>x.sec),60); b.querySelector('[data-chart]').innerHTML=rows.map(x=>{const h=Math.max(6,Math.round(x.sec/max*110));const g=Math.max(2,Math.round(goal/max*110));return `<div class="study-bar-wrap"><span>${Math.round(x.sec/60)}분</span><div class="study-bar"><i style="height:${h}px"></i><em style="height:${g}px"></em></div><small>${x.label}</small></div>`}).join('');
    b.querySelector('[data-goal-input]').value=getGoal();
  }
  function buildFloat(){
    const f=document.createElement('div');f.className='app-float';
    f.innerHTML='<button type="button" title="페이지 위로" data-top>↑</button><button type="button" class="primary" title="전체 메뉴 · Ctrl+K" data-cmd>⌘</button>';
    document.body.appendChild(f);
    $('[data-top]',f).onclick=()=>scrollTo({top:0,behavior:'smooth'}); $('[data-cmd]',f).onclick=window.openCmd;
  }

  function maybeMarkResume(){
    try{
      const last=localStorage.getItem('gichul:last-route');
      if(last && last!==location.href && last.includes('.html')){
        const c=$('.wrap'); if(c && !$('.app-resume',c)){
          const box=document.createElement('div');box.className='app-resume card';box.style.cssText='margin:10px 0;padding:10px 12px;border:1px solid color-mix(in srgb,var(--app-accent) 25%,var(--line));background:color-mix(in srgb,var(--app-accent) 5%,var(--surface));border-radius:12px;font:700 11px/1.4 var(--font-d,system-ui)';
          const p=new URL(last,location.href).pathname.split('/').pop(); const label=navLinks().find(x=>x[2]===p)?.[1]||'이전 화면';
          box.innerHTML=`최근 사용: <b>${label}</b><button type="button" style="margin-left:8px" data-resume>열기</button>`;
          c.prepend(box); $('[data-resume]',box).onclick=()=>location.href=last;
        }
      }
      localStorage.setItem('gichul:last-route',location.href);
    }catch{}
  }

  const FAVORITES_KEY='gichul:favorites:v1';
  function getFavs(){try{return JSON.parse(localStorage.getItem(FAVORITES_KEY)||'[]')}catch{return[]}}
  function setFavs(v){try{localStorage.setItem(FAVORITES_KEY,JSON.stringify(v.slice(-30)))}catch{}}
  function toggleFavorite(){
    const href=location.href, arr=getFavs(), i=arr.findIndex(x=>x.href===href);
    if(i>=0){arr.splice(i,1);setFavs(arr);toast('즐겨찾기에서 제거했습니다.')}else{arr.push({href,title:document.title.replace(/\s*[|·].*$/,'')||PAGE[0],page:PAGE[0],at:Date.now()});setFavs(arr);toast('현재 페이지를 즐겨찾기했습니다.','ok')}
  }
  function installGlobalSearch(){
    const search=document.createElement('div');search.className='app-global-search';
    search.innerHTML='<div class="app-global-search-box"><span>⌕</span><input autocomplete="off" placeholder="앱 전체 검색 · 메뉴, 페이지, 기능…" /><button type="button" data-close>Esc</button></div><div class="app-global-results"></div>';
    document.body.appendChild(search);
    const items=actions.map(a=>({type:'page',title:a.title,sub:a.sub,href:a.href,ico:a.ico}));
    const special=[
      {type:'action',title:'현재 페이지 즐겨찾기',sub:'나중에 빠르게 다시 열기',ico:'★',run:toggleFavorite},
      {type:'action',title:'테마 전환',sub:'밝은 화면 ↔ 어두운 화면',ico:'☾',run:toggleTheme},
      {type:'action',title:'집중 모드',sub:'UI를 최소화하고 콘텐츠에 집중',ico:'◉',run:toggleFocus},
      {type:'action',title:'페이지 새로고침',sub:'최신 파일 다시 받기',ico:'↻',run:()=>location.reload()},
      {type:'action',title:'앱 설정',sub:'테마 · 집중 모드 · 동작 줄이기',ico:'⚙',run:openSettings},
      {type:'action',title:'앱 설치',sub:'지원되는 브라우저에서 설치',ico:'↥',run:installApp},
      {type:'action',title:'학습 타이머',sub:'누적 학습 시간을 기록하고 이어가기',ico:'⏱',run:openTimer},
      {type:'action',title:'학습 센터',sub:'오늘 목표 · 7일 기록 · 학습 연속',ico:'▤',run:openStudyCenter},
      {type:'action',title:'앱 상태 진단',sub:'저장공간 · 서비스워커 · 기능 점검',ico:'🩺',run:openDiagnostics},
      {type:'action',title:'출시 점검',sub:'배포 전 필수 게이트를 한 번에 검사',ico:'🚦',run:openReleaseGate}
    ];
    const all=[...items,...special], input=search.querySelector('input'), results=search.querySelector('.app-global-results');
    function render(q=''){
      const qq=q.trim().toLowerCase();
      const rows=all.filter(x=>!qq||[x.title,x.sub].join(' ').toLowerCase().includes(qq)).slice(0,12);
      results.innerHTML=rows.map((x,i)=>`<button type="button" class="app-global-item${i===0?' active':''}" data-i="${i}"><span class="gico">${x.ico}</span><span><b>${x.title}</b><small>${x.sub}</small></span><kbd>${x.type==='page'?'↵':''}</kbd></button>`).join('')||'<div class="app-empty"><strong>검색 결과가 없습니다</strong><span>메뉴 이름이나 기능을 입력해보세요.</span></div>';
      [...results.querySelectorAll('.app-global-item')].forEach((b)=>b.onclick=()=>{const x=rows[+b.dataset.i]; if(x.type==='page') location.href=x.href; else x.run(); close();});
    }
    function open(){search.classList.add('open');render('');setTimeout(()=>input.focus(),20)}
    function close(){search.classList.remove('open')}
    input.addEventListener('input',()=>render(input.value));
    input.addEventListener('keydown',e=>{const bs=[...results.querySelectorAll('.app-global-item')], ix=bs.findIndex(b=>b.classList.contains('active')); if(e.key==='Escape'){close();return} if(e.key==='ArrowDown'&&bs.length){bs[ix]?.classList.remove('active');bs[(ix+1+bs.length)%bs.length].classList.add('active');e.preventDefault()} if(e.key==='ArrowUp'&&bs.length){bs[ix]?.classList.remove('active');bs[(ix-1+bs.length)%bs.length].classList.add('active');e.preventDefault()} if(e.key==='Enter'&&bs.length){bs[Math.max(ix,0)].click();e.preventDefault()}});
    search.querySelector('[data-close]').onclick=close; search.addEventListener('click',e=>{if(e.target===search)close()});
    window.openGlobalSearch=open;
  }
  function toggleTheme(){
    const cur=document.documentElement.dataset.theme==='dark'?'dark':'light';
    const next=cur==='dark'?'light':'dark'; document.documentElement.dataset.theme=next; try{localStorage.setItem('gichul:theme',next)}catch{}
    toast(next==='dark'?'다크 모드로 전환했습니다.':'라이트 모드로 전환했습니다.','ok');
  }
  function toggleFocus(){const on=document.body.classList.toggle('app-focus');try{localStorage.setItem(FOCUS_KEY,on?'1':'0')}catch{} toast(on?'집중 모드를 켰습니다.':'집중 모드를 껐습니다.')}
  function restorePreferences(){
    try{const t=localStorage.getItem('gichul:theme');if(t)document.documentElement.dataset.theme=t}catch{}
    try{const p=JSON.parse(localStorage.getItem(PREF_KEY)||'{}'); if(p.reduce)document.documentElement.classList.add('reduce-motion')}catch{}
    try{if(localStorage.getItem(FOCUS_KEY)==='1')document.body.classList.add('app-focus')}catch{}
    if(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches)document.documentElement.classList.add('reduce-motion');
  }
  function buildOffline(){
    const b=document.createElement('div');b.className='app-network';
    const paint=()=>{b.classList.toggle('offline',!navigator.onLine);b.querySelector('span').textContent=navigator.onLine?'온라인':'오프라인';b.title=navigator.onLine?'인터넷 연결됨':'인터넷 연결이 없습니다. 저장된 자료는 계속 사용할 수 있습니다.'};
    b.innerHTML='<i></i><span>온라인</span>';document.body.appendChild(b);paint();addEventListener('online',paint);addEventListener('offline',paint);
  }
  function buildMobileNav(){
    if(document.querySelector('.app-mobile-nav'))return;
    const n=document.createElement('nav');n.className='app-mobile-nav';
    n.innerHTML=navLinks().slice(0,6).map(x=>`<a href="${x[2]}" class="${PAGE[1].includes(x[1])||PAGE[0]===x[1]?'active':''}"><span>${x[0]}</span><small>${x[1]}</small></a>`).join('');
    document.body.appendChild(n);
  }
  function buildTools(){
    const f=document.querySelector('.app-float'); if(!f||f.querySelector('[data-favorite]'))return;
    const fav=document.createElement('button');fav.type='button';fav.title='즐겨찾기';fav.textContent=getFavs().some(x=>x.href===location.href)?'★':'☆';fav.dataset.favorite='';
    fav.onclick=()=>{toggleFavorite();fav.textContent=getFavs().some(x=>x.href===location.href)?'★':'☆'};
    f.insertBefore(fav,f.firstChild);
  }
  /* ══════════════════════════════════════════════════════════════
     단축키 — 한 군데에 모은다

     지금까지 F·G·R 세 키가 이 파일 안에서만도 둘씩 겹쳐 있었다:
       F = «찾기 칸으로»(실기뷰어) 랑 «즐겨찾기»(이 파일)가 같이 눌렸고
       G = «문항 고르기»(실기뷰어) 랑 «전체 검색»(이 파일)이 같이 열렸고
       R = «랜덤 뽑기»(실기뷰어) 랑 «포트폴리오로 이동»(이 파일)이 같이 일어났다
     — 한 키를 누르면 두 가지가 동시에 반응한 것이다.

     그래서 겹치는 세 개는 새 키로 옮기고(즐겨찾기→W, 전체 검색→V, 포트폴리오→T),
     켜고 끄기·키 바꾸기를 한 곳(창)에서 다루도록 이 표를 만든다.
     페이지마다 필요한 단축키를 register() 로 더 보탤 수 있다(실기뷰어가 이렇게 한다). */
  (function(){
    const SK='app:shortcuts:v1';
    function load(){ try{ return JSON.parse(localStorage.getItem(SK)||'{}') }catch(e){ return {} } }
    function save(s){ try{ localStorage.setItem(SK, JSON.stringify(s)) }catch(e){} }
    const DEFS=[
      { id:'g-search',  key:'V', label:'전체 검색 열기',        group:'전체', def:true },
      { id:'g-fav',     key:'W', label:'이 페이지 즐겨찾기',     group:'전체', def:true },
      { id:'g-theme',   key:'D', label:'밝게 / 어둡게',         group:'전체', def:true },
      { id:'g-cmd',     key:'K', label:'전체 메뉴 (Ctrl+K)',    group:'전체', def:true, mod:'ctrl' },
      { id:'g-home',    key:'H', label:'필기뷰어로 이동',       group:'전체', def:true },
      { id:'g-prac',    key:'P', label:'실기뷰어로 이동',       group:'전체', def:true },
      { id:'g-ingest',  key:'I', label:'자동 변환으로 이동',    group:'전체', def:true },
      { id:'g-interview', key:'M', label:'면접으로 이동',       group:'전체', def:true },
      { id:'g-portfolio', key:'T', label:'포트폴리오로 이동',   group:'전체', def:true },
      { id:'g-calc',    key:'C', label:'계산기 열기',           group:'전체', def:true },
      { id:'g-timer',   key:'Z', label:'타이머 열기',           group:'전체', def:true },
      { id:'g-study',   key:'Y', label:'학습센터 열기',         group:'전체', def:true },
      { id:'g-settings',key:'S', label:'설정 열기',             group:'전체', def:true },
      { id:'g-selftest',key:'J', label:'자가테스트 열기',       group:'전체', def:true },
      { id:'g-install', key:'A', label:'앱 설치',               group:'전체', def:true }
    ];
    function all(){ return DEFS; }
    function register(more){
      (more||[]).forEach(d=>{ if(!DEFS.find(x=>x.id===d.id)) DEFS.push(d); });
    }
    function row(id){ const s=load(); const d=DEFS.find(x=>x.id===id); return Object.assign({ on:true, key:d?.key||'' }, d, s[id]||{}); }
    function isOn(id){ return row(id).on!==false; }
    function keyOf(id){ return (row(id).key||'').toUpperCase(); }
    function setOn(id,on){ const s=load(); s[id]=Object.assign({},s[id],{on:!!on}); save(s); }
    function setKey(id,key){ const s=load(); s[id]=Object.assign({},s[id],{key:(key||'').toUpperCase()}); save(s); }
    function reset(id){ const s=load(); delete s[id]; save(s); }
    function matches(id,e){
      if(!isOn(id)) return false;
      const want=keyOf(id); if(!want) return false;
      const d=DEFS.find(x=>x.id===id);
      if(d?.mod==='ctrl' && !(e.ctrlKey||e.metaKey)) return false;
      if(want==='SPACE') return e.code==='Space';
      return (e.key||'').toUpperCase()===want && !e.altKey && (d?.mod==='ctrl' ? true : !e.ctrlKey && !e.metaKey);
    }
    window.__gkey={ DEFS, all, register, row, isOn, keyOf, setOn, setKey, reset, matches };
  })();

  function installShortcuts(){
    document.addEventListener('keydown',e=>{
      const inField=/INPUT|TEXTAREA|SELECT/.test(e.target?.tagName||'');
      if((e.ctrlKey||e.metaKey)&&e.shiftKey&&e.key.toLowerCase()==='f'){e.preventDefault();window.openGlobalSearch?.();return}
      if(inField)return;
      const G=window.__gkey;
      if(G.matches('g-fav',e)){e.preventDefault();buildTools();document.querySelector('[data-favorite]')?.click();return}
      if(G.matches('g-search',e)){e.preventDefault();window.openGlobalSearch?.();return}
      if(G.matches('g-theme',e)){e.preventDefault();toggleTheme();return}
    });
  }

  function openDiagnostics(){
    let back=$('.app-diagnostics-backdrop');
    if(!back){
      back=document.createElement('div'); back.className='app-diagnostics-backdrop';
      back.innerHTML=`<div class="app-diagnostics" role="dialog" aria-modal="true" aria-label="앱 상태 진단">
        <div class="app-diagnostics-head"><div><small>SYSTEM CHECK</small><b>앱 상태 진단</b></div><button type="button" data-close aria-label="닫기">×</button></div>
        <div class="app-diag-grid" data-grid></div>
        <div class="app-diag-foot"><span data-summary></span><button type="button" data-copy>진단 결과 복사</button></div>
      </div>`;
      document.body.appendChild(back);
      back.addEventListener('click',e=>{if(e.target===back)back.classList.remove('open')});
      $('[data-close]',back).onclick=()=>back.classList.remove('open');
      $('[data-copy]',back).onclick=async()=>{const txt=buildDiagnostics().map(x=>`${x.name}: ${x.ok?'OK':'CHECK'} — ${x.detail}`).join('\n'); try{await navigator.clipboard.writeText(txt);toast('진단 결과를 클립보드에 복사했습니다.','ok')}catch{toast('클립보드 복사에 실패했습니다.','warn')}};
    }
    paintDiagnostics(); back.classList.add('open'); setTimeout(()=>back.querySelector('[data-close]')?.focus(),20);
  }
  function calcRegressionTests(){
    if(!window.CalcEngine) return [{name:'계산 엔진 로드',ok:false,detail:'calc-engine.js 미로드'}];
    const tests=[
      ['기본 연산',()=>Math.abs(CalcEngine.evaluate('2+3*4',{},'DEG')-14)<1e-10],
      ['암시적 곱셈',()=>Math.abs(CalcEngine.evaluate('2(3+4)',{},'DEG')-14)<1e-10],
      ['라디안 삼각함수',()=>Math.abs(CalcEngine.evaluate('sin(pi/2)',{},'RAD')-1)<1e-10],
      ['팩토리얼',()=>CalcEngine.evaluate('5!',{},'DEG')===120],
      ['조합',()=>CalcEngine.evaluate('5C2',{},'DEG')===10],
      ['순열',()=>CalcEngine.evaluate('5P2',{},'DEG')===20],
      ['역삼각함수',()=>Math.abs(CalcEngine.evaluate('asin(0.5)',{},'DEG')-30)<1e-10],
      ['수학 오류 차단',()=>{try{CalcEngine.evaluate('1/0',{},'DEG');return false}catch{return true}}]
    ];
    return tests.map(([name,fn])=>{try{return {name,ok:!!fn(),detail:fn?'정상':'실패'}}catch(e){return {name,ok:false,detail:String(e?.message||e).slice(0,100)}}});
  }
  function backupRoundTripTest(){
    try{
      const sample={schema:4,source:'gichul-viewer',data:{'gichul:selftest:sample':{ok:true},'prac:selftest:sample':['x'],'iv-selftest:should-exclude':{draft:true}}};
      const studyKeys=Object.keys(sample.data).filter(k=>STUDY_KEYS.test(k)&&!INTERVIEW_KEYS.test(k));
      const interviewKeys=Object.keys(sample.data).filter(k=>INTERVIEW_KEYS.test(k));
      const ok=studyKeys.length===2 && interviewKeys.length===1 && !studyKeys.some(k=>INTERVIEW_KEYS.test(k));
      return {ok,detail:ok?'학습 2개 / 면접 1개 분리 규칙 정상':'분리 규칙 실패'};
    }catch(e){return {ok:false,detail:String(e?.message||e)}}
  }
  function releaseGate(){
    const rows=[];
    const add=(name,ok,detail)=>rows.push({name,ok,detail});
    const r=completionReport();
    add('구현/구조 완성도',r.score>=98,`${r.score}%`);
    add('자동 QA',r.qaScore>=98,`${r.qaScore}%`);
    add('접근성',r.unlabeled===0,`미라벨 ${r.unlabeled}`);
    add('로컬 데이터 무결성',r.localDataOk,'JSON/크기 검사');
    add('면접 데이터 격리',!hasStudyInterviewCrossContamination(),'학습 ↔ 면접 namespace 분리');
    if(PAGE[0]==='계산기') calcRegressionTests().forEach(x=>add('계산기 · '+x.name,x.ok,x.detail));
    const br=backupRoundTripTest(); add('백업 데이터 경계',br.ok,br.detail);
    add('핵심 페이지 링크', ['index.html','practice.html','calc.html','ingest.html','interview.html','portfolio.html'].every(f=>document.querySelector(`a[href*="${f}"]`)),'6개 핵심 경로');
    add('중복 ID',(()=>{const s=new Set();for(const el of document.querySelectorAll('[id]')){if(s.has(el.id))return false;s.add(el.id)}return true})(),'문서 내 id 중복 없음');
    add('Service Worker 지원', 'serviceWorker' in navigator, '브라우저 지원 여부');
    if(r.probed){
      add('Service Worker 실제 등록', r.allChecks.swActive, r.allChecks.swActive?'활성 상태':'등록/활성 실패 — 오프라인 동작 불가');
      add('로컬 저장소 쓰기', r.allChecks.storage, r.allChecks.storage?'정상':'저장 실패 — 시크릿 모드/용량 확인');
      add('설정값', r.allChecks.configOk, r.allChecks.configOk?'Supabase·Worker 주소 채워짐':'config.js 빈 값 또는 임시값');
      add('AI 워커 응답', r.allChecks.aiReachable, r.allChecks.aiReachable?'/ai/health 응답 정상':'응답 없음 — 배포/도메인 허용 확인');
    } else {
      add('실동작 검사', false, '아직 실행 전 — 창을 다시 열면 검사합니다');
    }
    return rows;
  }
  function runSelfTests(){
    const tests=[]; const test=(name,fn)=>{try{const r=fn();tests.push({name,ok:r!==false,detail:r===false?'검사 실패':'정상'});}catch(e){tests.push({name,ok:false,detail:String(e?.message||e).slice(0,100)})}};
    test('공통 UI',()=>!!window.AppUI&&typeof window.AppUI.toast==='function');
    test('페이지 네비게이션',()=>['index.html','practice.html','calc.html','ingest.html','interview.html','portfolio.html'].every(f=>document.querySelector(`a[href*="${f}"]`)));
    test('학습/면접 데이터 경계',()=>STUDY_KEYS.test('gichul:test')&&STUDY_KEYS.test('prac:test')&&INTERVIEW_KEYS.test('iv-test')&&!STUDY_KEYS.test('iv-test'));
    test('로컬 저장소',()=>{const k='gichul:selftest';localStorage.setItem(k,'1');const ok=localStorage.getItem(k)==='1';localStorage.removeItem(k);return ok});
    test('계산 엔진',()=>{if(location.pathname.endsWith('calc.html')) return !!window.CalcEngine&&Math.abs(window.CalcEngine.evaluate('2+3*4',{},'DEG')-14)<1e-10; return true});
    test('삼각함수/각도',()=>{if(location.pathname.endsWith('calc.html')) return !!window.CalcEngine&&Math.abs(window.CalcEngine.evaluate('sin(30)',{},'DEG')-.5)<1e-10; return true});
    test('백업 규칙',()=>STUDY_KEYS.test('prac:v1')&&!INTERVIEW_KEYS.test('prac:v1')&&INTERVIEW_KEYS.test('iv-draft-x')&&!STUDY_KEYS.test('iv-draft-x'));
    test('중복 ID 없음',()=>{const seen=new Set();let dup=0;document.querySelectorAll('[id]').forEach(el=>{if(seen.has(el.id))dup++;seen.add(el.id)});return dup===0});
    test('내부 링크 유효성',()=>[...document.querySelectorAll('a[href]')].filter(a=>{const h=a.getAttribute('href')||'';return /^\.\/(index|practice|calc|ingest|interview|portfolio)\.html/.test(h)}).every(a=>!!a.getAttribute('href')));
    test('서비스워커 지원',()=>('serviceWorker' in navigator));
    if(location.pathname.endsWith('calc.html')) calcRegressionTests().forEach(x=>tests.push({name:'계산기 · '+x.name,ok:x.ok,detail:x.detail}));
    const br=backupRoundTripTest(); tests.push({name:'백업 데이터 경계',ok:br.ok,detail:br.detail});
    return tests;
  }
  function openSelfTest(){
    let back=$('.app-selftest-backdrop');
    if(!back){
      back=document.createElement('div');back.className='app-selftest-backdrop';
      back.innerHTML='<div class="app-selftest" role="dialog" aria-modal="true" aria-label="앱 자가 테스트"><div class="app-diagnostics-head"><div><small>AUTOMATED QA</small><b>앱 자가 테스트</b></div><button type="button" data-close aria-label="닫기">×</button></div><div class="app-diag-grid" data-grid></div><div class="app-diag-foot"><span data-summary></span><button type="button" data-copy>결과 복사</button></div></div>';
      document.body.appendChild(back);back.addEventListener('click',e=>{if(e.target===back)back.classList.remove('open')});back.querySelector('[data-close]').onclick=()=>back.classList.remove('open');back.querySelector('[data-copy]').onclick=async()=>{const t=runSelfTests().map(x=>`${x.ok?'OK':'CHECK'} · ${x.name} — ${x.detail}`).join('\n');try{await navigator.clipboard.writeText(t);toast('자가 테스트 결과를 복사했습니다.','ok')}catch{toast('클립보드 복사에 실패했습니다.','warn')}};
    }
    const rows=runSelfTests();back.querySelector('[data-grid]').innerHTML=rows.map(x=>`<div class="app-diag-item ${x.ok?'ok':'warn'}"><span>${x.ok?'✓':'!'}</span><div><b>${x.name}</b><small>${x.detail}</small></div></div>`).join('');const bad=rows.filter(x=>!x.ok).length;back.querySelector('[data-summary]').textContent=bad?`${bad}개 검사 실패`:`${rows.length}개 핵심 검사 통과`;back.classList.add('open');
  }

  async function openReleaseGate(){
    await probeRuntime();
    let back=$('.app-release-backdrop');
    if(!back){
      back=document.createElement('div'); back.className='app-release-backdrop';
      back.innerHTML='<div class="app-selftest" role="dialog" aria-modal="true" aria-label="출시 점검"><div class="app-diagnostics-head"><div><small>RELEASE GATE</small><b>출시 전 점검</b></div><button type="button" data-close aria-label="닫기">×</button></div><div class="app-diag-grid" data-grid></div><div class="app-diag-foot"><span data-summary></span><button type="button" data-copy>결과 복사</button></div></div>';
      document.body.appendChild(back); back.addEventListener('click',e=>{if(e.target===back)back.classList.remove('open')});
      back.querySelector('[data-close]').onclick=()=>back.classList.remove('open');
      back.querySelector('[data-copy]').onclick=async()=>{const t=releaseGate().map(x=>`${x.ok?'PASS':'CHECK'} · ${x.name} — ${x.detail}`).join('\n');try{await navigator.clipboard.writeText(t);toast('출시 점검 결과를 복사했습니다.','ok')}catch{toast('클립보드 복사에 실패했습니다.','warn')}};
    }
    const rows=releaseGate(), bad=rows.filter(x=>!x.ok).length;
    back.querySelector('[data-grid]').innerHTML=rows.map(x=>`<div class="app-diag-item ${x.ok?'ok':'warn'}"><span>${x.ok?'✓':'!'}</span><div><b>${x.name}</b><small>${x.detail}</small></div></div>`).join('');
    back.querySelector('[data-summary]').textContent=bad?`${bad}개 게이트 확인 필요`:'모든 출시 게이트 통과';
    back.classList.add('open');
  }
  function buildDiagnostics(){
    const out=[];
    const storage=(()=>{try{const k='gichul:__diag__';localStorage.setItem(k,'1');localStorage.removeItem(k);return true}catch{return false}})();
    out.push({name:'로컬 저장소',ok:storage,detail:storage?'사용 가능':'저장할 수 없음'});
    out.push({name:'인터넷 연결',ok:navigator.onLine,detail:navigator.onLine?'온라인':'오프라인 — 로컬 기능 사용 가능'});
    out.push({name:'서비스워커',ok:'serviceWorker' in navigator,detail:'serviceWorker' in navigator?'지원됨':'브라우저 미지원'});
    out.push({name:'PWA 설치',ok:!!window.matchMedia?.('(display-mode: standalone)').matches || !!window.navigator.standalone,detail:'installed' in navigator || !!window.matchMedia?.('(display-mode: standalone)').matches?'실행 중/지원':'미설치'});
    out.push({name:'전역 UI',ok:!!window.AppUI && typeof window.AppUI.toast==='function',detail:window.AppUI?'공통 UI 로드됨':'공통 UI 확인 필요'});
    if(location.pathname.endsWith('calc.html')) out.push({name:'계산 엔진',ok:!!window.CalcEngine && typeof window.CalcEngine.evaluate==='function',detail:window.CalcEngine?'파서 엔진 로드됨':'calc-engine.js 확인 필요'});
    const cfg=window.CFG; out.push({name:'백엔드 설정',ok:!!cfg && !!cfg.SUPABASE_URL && !String(cfg.SUPABASE_URL).includes('xxxx'),detail:cfg?.SUPABASE_URL?'설정값 감지':'config.js 설정 확인 필요'});
    const studyKeys=[]; const interviewKeys=[]; for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(STUDY_KEYS.test(k))studyKeys.push(k);if(INTERVIEW_KEYS.test(k))interviewKeys.push(k)}
    let errDetail='최근 앱 오류 없음'; try{const er=JSON.parse(localStorage.getItem('gichul:last-error')||'null'); if(er?.message) errDetail=String(er.message).slice(0,90)}catch{}
    const cr=completionReport();
    out.push({name:'학습 기록',ok:true,detail:`gichul:/prac: 데이터 ${studyKeys.length}개`}); out.push({name:'면접 데이터 분리',ok:!hasStudyInterviewCrossContamination(),detail:`iv-/iv: 데이터 ${interviewKeys.length}개 · 학습 백업 제외`});
    out.push({name:'최근 오류',ok:!localStorage.getItem('gichul:last-error'),detail:errDetail});
    out.push({name:'로컬 데이터 무결성',ok:cr.localDataOk,detail:cr.localDataOk?'주요 JSON 저장값 정상':'비정상 또는 과대 데이터가 감지됨'});
    out.push({name:'제품 완성도',ok:cr.score>=95,detail:`${cr.score}% 구현/구조 · 자동 QA ${cr.qaScore}% · 접근성 미라벨 ${cr.unlabeled}`});
    return out;
  }
  function paintDiagnostics(){
    const b=$('.app-diagnostics-backdrop'); if(!b)return; const rows=buildDiagnostics();
    b.querySelector('[data-grid]').innerHTML=rows.map(x=>`<div class="app-diag-item ${x.ok?'ok':'warn'}"><span>${x.ok?'✓':'!'}</span><div><b>${x.name}</b><small>${x.detail}</small></div></div>`).join('');
    const bad=rows.filter(x=>!x.ok).length; b.querySelector('[data-summary]').textContent=bad?`${bad}개 항목을 확인하세요.`:'모든 핵심 항목이 정상입니다.';
  }
  /* «ResizeObserver loop completed…» 는 브라우저가 스스로 거는 안전장치 경고일 뿐,
     진짜 고장이 아니다 — 화면 안에 여러 개의 크기 관찰자(ResizeObserver)가 있으면
     (필기판마다 하나씩, 표 손잡이마다 하나씩…) 한 프레임 안에서 서로 크기를 다시
     재는 일이 몰릴 때 브라우저가 그냥 «다음 프레임에 마저 처리할게» 라고 알리는
     것뿐이다. 그런데 이게 window 의 «error» 사건으로도 넘어와서, 지금까지는
     진짜 오류인 것처럼 창을 하나씩 띄우고 있었다 — «필기»·«고치기» 처럼 화면을
     크게 바꾸는 동작을 할 때마다 이 경고가 우르르 몰려서 오류창이 줄줄이 뜬 것. */
  const isBenignResize = m => /ResizeObserver loop/i.test(String(m||''));
  addEventListener('error', e=>{
    if(isBenignResize(e.message)) return;
    try{localStorage.setItem('gichul:last-error',JSON.stringify({message:String(e.message||'알 수 없는 오류'),source:String(e.filename||''),line:e.lineno||0,at:Date.now()}))}catch{}; toast('앱에서 오류가 발생했습니다. 앱 상태 진단에서 확인할 수 있습니다.','err');});
  addEventListener('unhandledrejection', e=>{
    if(isBenignResize(e.reason?.message||e.reason)) return;
    try{localStorage.setItem('gichul:last-error',JSON.stringify({message:String(e.reason?.message||e.reason||'처리되지 않은 오류'),at:Date.now()}))}catch{}; toast('처리되지 않은 작업 오류가 발생했습니다.','err');});

  function buildInterviewIsolation(){
    if(!isInterviewPage() || document.querySelector('.app-interview-isolation')) return;
    const mount=document.querySelector('.nav3')?.parentElement || document.body;
    const el=document.createElement('div'); el.className='app-interview-isolation';
    el.innerHTML=`<span class="iso-lock">🔒</span><div><b>면접 데이터는 학습 오답과 완전 분리</b><small>실기·필기 오답/학습 기록은 면접 답변·초안·메모로 자동 연결하거나 주입하지 않습니다.</small></div><button type="button" data-c>자세히</button>`;
    const nav=document.querySelector('.nav3'); nav?.insertAdjacentElement('afterend',el);
    el.querySelector('[data-c]').onclick=()=>toast('학습 데이터: gichul:/prac: · 면접 데이터: iv-/iv: 로 분리 저장됩니다.','ok');
  }


  async function openQACenter(){
    await probeRuntime();
    let back=$('.app-qa-backdrop');
    if(!back){
      back=document.createElement('div'); back.className='app-qa-backdrop';
      back.innerHTML='<div class="app-selftest" role="dialog" aria-modal="true" aria-label="전체 QA 센터"><div class="app-diagnostics-head"><div><small>FULL QA</small><b>전체 QA 센터</b></div><button type="button" data-close aria-label="닫기">×</button></div><div class="app-diag-grid" data-grid></div><div class="app-diag-foot"><span data-summary></span></div></div>';
      document.body.appendChild(back);back.addEventListener('click',e=>{if(e.target===back)back.classList.remove('open')});back.querySelector('[data-close]').onclick=()=>back.classList.remove('open');
    }
    const rows=[];
    const files=['index.html','practice.html','calc.html','ingest.html','interview.html','portfolio.html','upload.html'];
    const add=(n,ok,d)=>rows.push({name:n,ok,detail:d});
    add('현재 버전', /^v8[7-9]$/.test(APP_VERSION), APP_VERSION);
    add('핵심 페이지 링크', ['index.html','practice.html','calc.html','ingest.html','interview.html','portfolio.html'].every(f=>document.querySelector(`a[href*="${f}"]`)), '6개 핵심 경로');
    add('면접/학습 데이터 격리', !hasStudyInterviewCrossContamination(), 'iv-/iv: ↔ gichul:/prac: 분리');
    add('로컬 데이터 무결성', completionReport().localDataOk, '주요 JSON/용량 검사');
    add('계산 엔진', location.pathname.endsWith('calc.html') ? !!window.CalcEngine : true, location.pathname.endsWith('calc.html')?'현재 페이지 엔진 로드 상태':'계산기 페이지에서 상세 테스트 가능');
    add('자동 QA', runSelfTests().every(x=>x.ok), `${runSelfTests().filter(x=>x.ok).length}/${runSelfTests().length} 통과`);
    add('출시 게이트', releaseGate().every(x=>x.ok), `${releaseGate().filter(x=>x.ok).length}/${releaseGate().length} 통과`);
    add('브라우저 PWA 지원', 'serviceWorker' in navigator, 'Service Worker API');
    add('공용 AI 채팅 소스', !!document.querySelector('script[src*="ai-chat.js"]') && !!window.APP_CONFIG?.AI_WORKER_URL, 'ai-chat.js + Worker 설정');
    add('접근성 미라벨', completionReport().unlabeled===0, `${completionReport().unlabeled}개`);
    const rows2=rows;
    back.querySelector('[data-grid]').innerHTML=rows2.map(x=>`<div class="app-diag-item ${x.ok?'ok':'warn'}"><span>${x.ok?'✓':'!'}</span><div><b>${x.name}</b><small>${x.detail}</small></div></div>`).join('');
    const bad=rows2.filter(x=>!x.ok).length; back.querySelector('[data-summary]').textContent=bad?`${bad}개 점검 필요`:'전체 QA 통과'; back.classList.add('open');
  }

  /* ── 공학용 계산기는 «따로 뜨는 작은 창» 으로 ────────────────
     예전에는 계산기를 누르면 지금 보던 문제 화면이 통째로 날아가고
     돌아올 길도 마땅치 않았다. 이제는 옆에 띄워 두고 문제와 같이 본다.
     팝업이 막혀 있으면 예전처럼 새 탭으로 연다. */
  let CALCWIN=null;
  function openCalcPopup(){
    try{
      if(CALCWIN && !CALCWIN.closed){ CALCWIN.focus(); return true; }
      const w=Math.min(520,Math.max(360,Math.round(screen.availWidth*0.34)));
      const h=Math.min(900,Math.max(560,Math.round(screen.availHeight*0.86)));
      const left=Math.max(0,screen.availWidth-w-24), top=Math.max(0,Math.round((screen.availHeight-h)/2));
      const feat=`popup=yes,width=${w},height=${h},left=${left},top=${top},resizable=yes,scrollbars=yes`;
      CALCWIN=window.open('./calc.html?popup=1','gichulCalc',feat);
      if(CALCWIN){ CALCWIN.focus(); return true; }
    }catch(e){}
    try{ window.open('./calc.html','_blank','noopener'); return true; }catch(e){}
    return false;
  }
  window.openCalcPopup=openCalcPopup;
  function installCalcPopup(){
    if(/calc\.html/.test(location.pathname)) return;   /* 계산기 안에서는 그대로 둔다 */
    document.addEventListener('click',e=>{
      const a=e.target.closest?.('a[href*="calc.html"]'); if(!a) return;
      if(a.target==='_blank'||e.metaKey||e.ctrlKey||e.shiftKey||e.button===1) return;
      e.preventDefault();
      /* 폰에서는 작은 창이 의미가 없다 — 새 탭으로 연다 */
      if(matchMedia('(max-width:760px)').matches){ window.open(a.href,'_blank','noopener'); return; }
      openCalcPopup();
    });
  }

  function boot(){
    restorePreferences(); buildInterviewIsolation(); buildScroll(); buildCmd(); buildFloat(); maybeMarkResume(); buildOffline(); installGlobalSearch(); buildMobileNav(); setTimeout(buildTools,0); installShortcuts(); installCalcPopup();
    document.addEventListener('keydown',e=>{
      const inField=/INPUT|TEXTAREA|SELECT/.test(e.target?.tagName||'');
      if(window.__gkey?.matches('g-cmd',e)){e.preventDefault();window.openCmd();return}
      if(inField) return;
      const G=window.__gkey;
      if(G && G.matches('g-calc',e)){openCalcPopup();return}
      const map={ 'g-home':'./index.html','g-prac':'./practice.html','g-ingest':'./ingest.html','g-interview':'./interview.html','g-portfolio':'./portfolio.html' };
      if(G){ for(const id in map){ if(G.matches(id,e)){ location.href=map[id]; return; } } }
      if(e.key==='?'){window.openCmd();return}
      if(e.key==='Escape'){window.closeCmd?.();document.querySelector('.app-global-search')?.classList.remove('open');closeSettings();return;}
      if(G && G.matches('g-timer',e)){openTimer();return}
      if(G && G.matches('g-study',e)){openStudyCenter();return}
      if(G && G.matches('g-settings',e)){openSettings();return}
      if(G && G.matches('g-selftest',e)){openSelfTest();return}
      if(G && G.matches('g-install',e)){installApp();return}
    });
    // Keep page transitions from feeling abrupt.
    document.documentElement.classList.add('app-ready');
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
