(function(){
'use strict';
const CFG = window.APP_CONFIG || {};
const $ = s => document.querySelector(s);
const sb = (window.supabase && CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY)
  ? window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, { auth:{ persistSession:true, autoRefreshToken:true } })
  : null;

let me = null;
let history = [];       // [{role, content}] — 텍스트만 보관(다음 요청에 맥락으로 보냄)
let currentCode = '';   // 지금까지 만든 최신 HTML
let pendingImages = []; // [{data(base64, 접두어 없음), mime, name}]
let busy = false;

function esc(s){ return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

/* ── 상태 저장(이미지는 용량 때문에 저장하지 않음) ─────────── */
function saveState(){
  try{
    localStorage.setItem('sniper.build.state', JSON.stringify({
      prompt: $('#prompt').value,
      refUrl: $('#refUrl').value,
      tier: $('#tier').value,
      provider: $('#provider').value,
      history, currentCode,
    }));
  }catch{}
}
function loadState(){
  try{
    const s = JSON.parse(localStorage.getItem('sniper.build.state')||'null');
    if(!s) return;
    $('#prompt').value = s.prompt||'';
    $('#refUrl').value = s.refUrl||'';
    if(s.tier) $('#tier').value = s.tier;
    if(s.provider) $('#provider').value = s.provider;
    history = Array.isArray(s.history) ? s.history : [];
    currentCode = s.currentCode || '';
    renderChatLog();
    if(currentCode) applyPreview(currentCode);
  }catch{}
}

/* ── 로그인 ───────────────────────────────────────────── */
async function boot(){
  loadState();
  if(!sb) return showLogin();
  const { data } = await sb.auth.getSession();
  me = data?.session?.user || null;
  if(!me) return showLogin();
  $('#loginPage').hidden = true; $('#app').hidden = false;
  $('#userPill').textContent = me.email || '로그인됨';
}
function showLogin(){ $('#loginPage').hidden = false; $('#app').hidden = true; }
async function login(){
  const err = $('#loginError'); err.hidden = true;
  try{
    if(!sb) throw new Error('Supabase 설정이 없습니다.');
    const { error } = await sb.auth.signInWithPassword({ email: $('#loginEmail').value.trim(), password: $('#loginPassword').value });
    if(error) throw error;
    location.reload();
  }catch(e){ err.hidden=false; err.textContent = e.message || String(e); }
}
async function getToken(){ return (await sb.auth.getSession()).data?.session?.access_token || ''; }

function setStatus(t, isErr){
  const el = $('#statusText');
  el.textContent = t || '';
  el.classList.toggle('err', !!isErr);
}
function setBusy(v){
  busy = v;
  $('#btnBuild').disabled = v;
  $('#btnBuild').textContent = v ? '만드는 중…' : '만들기 ▶';
}

/* ── 이미지 첨부 ──────────────────────────────────────────*/
function fileToBase64(file){
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}
function renderRefFiles(){
  const box = $('#refFiles');
  box.innerHTML = pendingImages.map((f,i) => `<span class="refChip">${esc(f.name)}<button data-rm="${i}" aria-label="빼기">×</button></span>`).join('');
  box.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { pendingImages.splice(+b.dataset.rm,1); renderRefFiles(); });
}

/* ── 대화 로그 ────────────────────────────────────────────*/
function renderChatLog(){
  const box = $('#chatLog');
  if(!history.length){ box.innerHTML = '<div class="empty">설명을 쓰고 "만들기"를 누르면 오른쪽에 결과가 뜹니다.</div>'; return; }
  box.innerHTML = history.map(h => h.role === 'user'
    ? `<div class="chatMsg user">${esc(h.content).slice(0,400)}</div>`
    : `<div class="chatMsg assistant">${esc(h.content)}</div>`
  ).join('');
  box.scrollTop = box.scrollHeight;
}

/* ── 미리보기 ─────────────────────────────────────────────*/
function applyPreview(code){
  const frame = $('#previewFrame');
  frame.srcdoc = code || '';
  $('#previewEmpty').hidden = !!code;
  $('#codeView').textContent = code || '';
  $('#btnDownload').disabled = !code;
  $('#btnOpenTab').disabled = !code;
}
function cleanCode(text){
  let s = String(text||'').trim();
  s = s.replace(/^```[a-z]*\n?/i, '').replace(/```\s*$/,'').trim();
  return s;
}

/* ── 만들기 요청(SSE) ──────────────────────────────────────*/
async function build(){
  if(busy) return;
  const prompt = $('#prompt').value.trim();
  if(!prompt) return setStatus('무엇을 만들지 설명을 입력하세요.', true);
  if(!sb) return setStatus('Supabase 설정이 없습니다.', true);
  if(!CFG.AI_WORKER_URL) return setStatus('config.js 에 AI_WORKER_URL 이 없습니다.', true);

  setBusy(true); setStatus('만드는 중…');
  history.push({ role:'user', content: prompt + (currentCode ? ' (이어서 수정)' : '') });
  renderChatLog();

  try{
    const token = await getToken();
    const base = (CFG.AI_WORKER_URL||'').replace(/\/+$/,'');
    const payload = {
      provider: $('#provider').value,
      model: $('#provider').value === 'gemini' ? 'gemini-3.7-flash' : 'gpt-5.6-terra',
      tier: $('#tier').value,
      prompt,
      reference_url: $('#refUrl').value.trim(),
      current_code: currentCode || '',
      history: history.slice(0,-1).slice(-8),
      files: pendingImages.map(f => ({ data:f.data, mime:f.mime, name:f.name })),
    };

    const res = await fetch(base + '/ai/build', {
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        ...(CFG.AI_APP_KEY ? {'x-app-key':CFG.AI_APP_KEY} : {}),
        ...(token ? {'Authorization':'Bearer '+token} : {}),
      },
      body: JSON.stringify(payload),
    });

    if(!res.ok){
      let msg = `서버가 ${res.status}로 답했습니다.`;
      try{ msg = (await res.json()).error || msg; }catch{}
      throw new Error(msg);
    }
    if(!res.body) throw new Error('스트리밍 응답을 받을 수 없습니다.');

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '', acc = '';
    while(true){
      const { done, value } = await reader.read();
      if(done) break;
      buf += dec.decode(value, { stream:true });
      let cut;
      while((cut = buf.indexOf('\n\n')) !== -1){
        const block = buf.slice(0, cut);
        buf = buf.slice(cut+2);
        for(const line of block.split('\n')){
          if(!line.startsWith('data:')) continue;
          const raw = line.slice(5).trim();
          if(!raw || raw === '[DONE]') continue;
          let o; try{ o = JSON.parse(raw); }catch{ continue; }
          if(o.delta) acc += o.delta;
          else if(o.error) throw new Error(o.error);
        }
      }
    }

    const code = cleanCode(acc);
    if(!code) throw new Error('결과를 받지 못했습니다.');
    currentCode = code;
    applyPreview(code);
    history.push({ role:'assistant', content:'만들었습니다. 이어서 고칠 부분을 설명하면 계속 다듬을 수 있습니다.' });
    renderChatLog();
    setStatus('완료');
    $('#prompt').value = '';
    pendingImages = []; renderRefFiles();
  }catch(e){
    setStatus(e.message || String(e), true);
    history.pop(); renderChatLog();
  }finally{
    setBusy(false);
    saveState();
  }
}

function download(){
  if(!currentCode) return;
  const blob = new Blob([currentCode], { type:'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'sniper-build-' + Date.now() + '.html';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function bind(){
  $('#btnLogin').onclick = login;
  $('#loginPassword').onkeydown = e => { if(e.key==='Enter') login(); };
  $('#btnLoginBack').onclick = () => location.href = './index.html';
  $('#btnBlog').onclick = () => location.href = './index.html';
  $('#btnLogout').onclick = async () => { await sb?.auth.signOut(); location.href = './index.html'; };

  $('#btnBuild').onclick = build;
  $('#btnNewChat').onclick = () => {
    if(history.length && !confirm('지금까지 대화와 결과를 지우고 새로 시작할까요?')) return;
    history = []; currentCode = ''; pendingImages = [];
    $('#prompt').value=''; $('#refUrl').value='';
    renderChatLog(); renderRefFiles(); applyPreview('');
    saveState();
  };

  $('#btnPickImages').onclick = () => $('#pickImages').click();
  $('#pickImages').onchange = async (e) => {
    const files = [...(e.target.files||[])];
    e.target.value = '';
    for(const f of files){
      if(pendingImages.length >= 4){ setStatus('사진은 최대 4장까지 첨부할 수 있습니다.', true); break; }
      try{
        const data = await fileToBase64(f);
        pendingImages.push({ data, mime:f.type||'image/png', name:f.name||'image.png' });
      }catch{}
    }
    renderRefFiles();
  };

  $('#btnViewCode').onclick = () => {
    const p = $('#codePanel');
    p.hidden = !p.hidden;
    $('#btnViewCode').textContent = p.hidden ? '코드 보기' : '코드 접기';
  };
  $('#btnDownload').onclick = download;
  $('#btnOpenTab').onclick = () => {
    if(!currentCode) return;
    const blob = new Blob([currentCode], { type:'text/html' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 6e4);
  };

  ['prompt','refUrl'].forEach(id => $('#'+id).addEventListener('input', saveState));
  $('#tier').addEventListener('change', saveState);
  $('#provider').addEventListener('change', saveState);
}

bind();
boot();
})();
