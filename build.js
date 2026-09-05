/* ═══════════════════════════════════════════════════════════════════
   sniper — 새로 만들기 (build)
   ───────────────────────────────────────────────────────────────────
   v18 에서 바뀐 것

   1) 첨부가 사진만이 아닙니다.
      파일·폴더·zip 아무거나 받습니다. 텍스트/코드 파일은 브라우저가
      직접 읽어서 프롬프트 안에 «본문» 으로 넣고, 사진만 예전처럼
      base64 로 보냅니다. zip 은 여기서 풀어서 안의 파일을 꺼냅니다.
      → Worker 를 고치지 않아도 동작합니다.

   2) Ctrl+V 붙여넣기 · 드래그해서 놓기 가 됩니다.
      사진 장수 제한도 4 → 8 로 늘렸습니다(모델이 받는 한계에 맞춤).

   3) 결과를 «여러 파일» 로 받습니다.
      모델에게 파일 구분 표시를 쓰게 시키고(아래 FILE_RE), 프론트가
      갈라서 index.html / style.css / app.js … 로 만듭니다.
      GitHub 에 그대로 올릴 수 있게 ZIP 으로 내려받습니다.
      미리보기는 iframe 이 남의 blob 을 못 읽기 때문에, css/js 를
      html 안으로 «합쳐서» 보여줍니다(파일 자체는 나뉜 채로 남습니다).

   4) Claude 를 고를 수 있습니다.
      단, 이건 Worker 에 경로가 있어야 합니다 → worker-ai-build-claude.js
      를 sniper-ai 에 붙여넣고 배포하세요. 안 붙였으면 아래 build() 가
      친절한 오류를 대신 띄웁니다.

   5) 왼쪽에 파일 목록, 코드 옆에 미니맵.
      첨부한 zip 안의 파일도 눌러서 바로 볼 수 있습니다.

   6) 휴대폰에서도 씁니다. 좁아지면 대화/파일/결과 탭으로 갈립니다.
   ═══════════════════════════════════════════════════════════════════ */
(function(){
'use strict';

const CFG = window.APP_CONFIG || {};
const $  = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

const sb = (window.supabase && CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY)
  ? window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, { auth:{ persistSession:true, autoRefreshToken:true } })
  : null;

/* ── 한계값 ─────────────────────────────────────────────────────── */
const MAX_IMAGES        = 8;        // 사진 장수
const MAX_IMAGE_BYTES    = 4*1024*1024;
const MAX_CHARS_PER_FILE = 24000;   // 파일 하나에서 읽어 보낼 최대 글자
const MAX_TOTAL_CHARS    = 220000;  // 첨부 텍스트 전부 합쳐서
const MAX_ZIP_ENTRIES    = 300;

/* 텍스트로 읽을 확장자 */
const TEXT_EXT = new Set(('html htm css js mjs cjs jsx ts tsx json jsonc md txt csv tsv svg xml yml yaml toml ini env '+
  'sql py rb php go rs java kt swift c h cpp hpp cs sh bash bat ps1 vue astro svelte graphql lock conf cfg gitignore '+
  'editorconfig prettierrc eslintrc log').split(' '));
const IMAGE_EXT = new Set(['png','jpg','jpeg','webp','gif','bmp','avif']);
/* 넣어봐야 토큰만 먹는 것들 */
const IGNORE_RE = /(^|\/)(node_modules|\.git|\.svn|dist|build|out|\.next|\.nuxt|\.cache|coverage|vendor|__pycache__|\.venv)\//i;
const IGNORE_FILE_RE = /(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|\.min\.(js|css)$|\.map$|\.DS_Store$)/i;

/* 결과 파일 구분 표시 — 모델에게 이 형식을 강제합니다 */
const FILE_RE = /<<<FILE:\s*([^\n>]+?)\s*>>>\r?\n?([\s\S]*?)(?:<<<ENDFILE>>>|(?=<<<FILE:)|$)/g;

/* ── 상태 ───────────────────────────────────────────────────────── */
let me = null;
let history = [];        // [{role,content,files?}]
let project = {};        // { 'index.html': '...', 'assets/app.js': '...' }
let attachments = [];    // {id,path,kind:'text'|'image',mime,text?,data?,size,use}
let styleHints = new Set();
let openFile = null;     // {source:'made'|'att', key}
let busy = false;
let seq = 0;

const HINT_TEXT = {
  tight:   '넓은 화면에서 좌우 여백이 과하지 않게 한다. 본문 컨테이너 max-width 는 1400px 이상으로 잡고, 화면 폭을 충분히 채운다.',
  light:   '배경은 밝은 색으로 한다. 어두운(다크) 테마는 쓰지 않는다.',
  legible: '본문 글자는 15px 이상, 줄간격 1.6 이상. 옅은 회색 위 옅은 회색 글씨처럼 대비가 낮은 조합은 쓰지 않는다.',
  mobile:  '휴대폰 세로 화면(390px)에서도 가로 스크롤 없이 읽히게 반응형으로 만든다.',
  onepage: '스크롤을 최소화하고 핵심 내용을 첫 화면 안에 담는다.',
};

const DEFAULT_MODEL = {
  openai:    'gpt-5.6-terra',
  gemini:    'gemini-3.7-flash',
  anthropic: 'claude-sonnet-4-6',
};

/* ── 잡동사니 ───────────────────────────────────────────────────── */
function esc(s){ return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function ext(p){ const m = String(p||'').toLowerCase().match(/\.([a-z0-9]+)$/); return m ? m[1] : ''; }
function baseName(p){ return String(p||'').split('/').pop(); }
function kb(n){ return n < 1024 ? n+'B' : n < 1024*1024 ? (n/1024).toFixed(n<10240?1:0)+'K' : (n/1048576).toFixed(1)+'M'; }
function approxTokens(chars){ return Math.round(chars/3); }
function slug(s){ return String(s||'page').trim().toLowerCase().replace(/[^a-z0-9가-힣]+/g,'-').replace(/^-|-$/g,'').slice(0,28) || 'page'; }
function normPath(p){
  return String(p||'').replace(/\\/g,'/').replace(/^\.?\//,'').replace(/^\/+/,'')
    .split('/').filter(x => x && x !== '.' && x !== '..').join('/');
}

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

/* ═══════════════════════════════════════════════════════════════════
   저장 / 복구
   ─────────────────────────────────────────────────────────────────
   첨부는 «텍스트만» 저장합니다. 사진까지 담으면 localStorage 5MB 를
   금방 넘겨서 저장이 통째로 실패합니다. 넘칠 땐 조용히 포기합니다.
   ═══════════════════════════════════════════════════════════════════ */
const LSKEY = 'sniper.build.state.v2';
function saveState(){
  try{
    const light = attachments
      .filter(a => a.kind === 'text')
      .map(a => ({ id:a.id, path:a.path, kind:'text', text:a.text, size:a.size, use:a.use }));
    const payload = {
      prompt: $('#prompt').value, refUrl: $('#refUrl').value,
      tier: $('#tier').value, provider: $('#provider').value,
      outputMode: $('#outputMode').value, modelOverride: $('#modelOverride').value,
      hints: [...styleHints], history, project,
    };
    const total = JSON.stringify(light).length;
    if(total < 400000) payload.attachments = light;
    localStorage.setItem(LSKEY, JSON.stringify(payload));
  }catch{ try{ localStorage.removeItem(LSKEY); }catch{} }
}
function loadState(){
  try{
    const s = JSON.parse(localStorage.getItem(LSKEY) || 'null');
    if(!s) return;
    $('#prompt').value = s.prompt || '';
    $('#refUrl').value = s.refUrl || '';
    if(s.tier) $('#tier').value = s.tier;
    if(s.provider) $('#provider').value = s.provider;
    if(s.outputMode) $('#outputMode').value = s.outputMode;
    $('#modelOverride').value = s.modelOverride || '';
    styleHints = new Set(Array.isArray(s.hints) ? s.hints : []);
    history = Array.isArray(s.history) ? s.history : [];
    project = (s.project && typeof s.project === 'object') ? s.project : {};
    attachments = Array.isArray(s.attachments) ? s.attachments.map(a => ({...a, id: a.id || (++seq)})) : [];
    seq = attachments.reduce((m,a) => Math.max(m, +a.id||0), 0);
  }catch{}
}

/* ═══════════════════════════════════════════════════════════════════
   로그인
   ═══════════════════════════════════════════════════════════════════ */
async function boot(){
  loadState();
  renderChatLog(); renderChips(); renderAttTree(); renderMadeTree();
  if(Object.keys(project).length) applyPreview();

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
  }catch(e){ err.hidden = false; err.textContent = e.message || String(e); }
}
async function getToken(){ return (await sb.auth.getSession()).data?.session?.access_token || ''; }

/* ═══════════════════════════════════════════════════════════════════
   첨부
   ═══════════════════════════════════════════════════════════════════ */
function readAsText(file){
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result || ''));
    r.onerror = rej;
    r.readAsText(file);
  });
}
function readAsBase64(file){
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1] || '');
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

function countImages(){ return attachments.filter(a => a.kind === 'image').length; }
function totalTextChars(){ return attachments.filter(a => a.kind === 'text' && a.use).reduce((n,a) => n + a.text.length, 0); }

function addText(path, text, note){
  path = normPath(path) || 'file.txt';
  if(attachments.some(a => a.kind === 'text' && a.path === path)) return false;
  let t = String(text || '');
  let cut = '';
  if(t.length > MAX_CHARS_PER_FILE){
    t = t.slice(0, MAX_CHARS_PER_FILE);
    cut = `\n\n… (파일이 길어서 앞 ${MAX_CHARS_PER_FILE.toLocaleString()}자만 보냅니다)`;
  }
  attachments.push({ id: ++seq, path, kind:'text', mime:'text/plain', text: t + cut, size: t.length, use:true, note: note||'' });
  return true;
}
/* 모델이 읽는 사진 형식은 png·jpeg·gif·webp 뿐입니다.
   bmp·avif·tiff 나 휴대폰 스크린샷처럼 큰 사진은 여기서 줄이고 바꿔
   보냅니다. 크기를 줄이면 토큰도 같이 줄어듭니다. */
const MODEL_IMAGE_MIME = new Set(['image/png','image/jpeg','image/gif','image/webp']);
const MAX_IMAGE_EDGE = 1600;

async function normalizeImage(file){
  const mime = file.type || '';
  if(MODEL_IMAGE_MIME.has(mime) && file.size <= 1_500_000){
    return { data: await readAsBase64(file), mime, size: file.size };
  }
  let bmp;
  try{ bmp = await createImageBitmap(file); }
  catch{
    if(MODEL_IMAGE_MIME.has(mime)) return { data: await readAsBase64(file), mime, size: file.size };
    throw new Error(`${file.name} 은(는) 브라우저가 못 읽는 사진 형식이라 뺐습니다.`);
  }
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width*scale)), h = Math.max(1, Math.round(bmp.height*scale));
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const g = cv.getContext('2d');
  /* 투명한 곳은 흰색으로 — jpeg 는 투명을 모릅니다 */
  const keepAlpha = mime === 'image/png' || mime === 'image/gif';
  if(!keepAlpha){ g.fillStyle = '#fff'; g.fillRect(0,0,w,h); }
  g.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  const outMime = keepAlpha ? 'image/png' : 'image/jpeg';
  const url = cv.toDataURL(outMime, 0.85);
  const data = url.split(',')[1] || '';
  return { data, mime: outMime, size: Math.round(data.length*0.75) };
}

async function addImage(file, path){
  if(countImages() >= MAX_IMAGES){ setStatus(`사진은 최대 ${MAX_IMAGES}장까지 보냅니다. 나머지는 뺐습니다.`, true); return false; }
  if(file.size > MAX_IMAGE_BYTES*4){ setStatus(`${file.name} 은(는) 너무 커서 뺐습니다.`, true); return false; }
  const img = await normalizeImage(file);
  if(img.size > MAX_IMAGE_BYTES){ setStatus(`${file.name} 은(는) 줄여도 4MB 를 넘어 뺐습니다.`, true); return false; }
  attachments.push({
    id: ++seq, path: normPath(path || file.name) || 'image.png', kind:'image',
    mime: img.mime, data: img.data, size: img.size, use:true,
  });
  return true;
}

/* zip 은 여기서 풀어서 안을 봅니다 — Worker 는 zip 을 모릅니다 */
async function addZip(file){
  if(!window.JSZip) throw new Error('zip 을 읽는 라이브러리를 못 불러왔습니다. 인터넷 연결을 확인하세요.');
  const zip = await window.JSZip.loadAsync(file);
  const names = Object.keys(zip.files).filter(n => !zip.files[n].dir);

  /* GitHub 에서 받은 zip 은 이미 안에 폴더가 한 겹 있습니다. 거기에
     zip 이름을 또 붙이면 gichul-viewer-main/gichul-viewer-main/... 이
     됩니다. 안에 이미 뿌리 폴더가 하나면 그걸 그대로 씁니다. */
  const tops = new Set(names.map(n => normPath(n).split('/')[0]));
  const nested = tops.size === 1 && names.every(n => normPath(n).includes('/'));
  const root = nested ? '' : file.name.replace(/\.zip$/i,'');

  let taken = 0, skipped = 0;
  for(const name of names){
    if(taken >= MAX_ZIP_ENTRIES){ skipped++; continue; }
    const p = normPath(name);
    if(!p || IGNORE_RE.test('/'+p) || IGNORE_FILE_RE.test(p)){ skipped++; continue; }
    const e = ext(p);
    if(!TEXT_EXT.has(e)){ skipped++; continue; }
    const text = await zip.files[name].async('string');
    if(addText((root ? root + '/' : '') + p, text)) taken++;
  }
  return { taken, skipped, total: names.length };
}

async function addFile(file, relPath){
  const path = normPath(relPath || file.webkitRelativePath || file.name);
  if(IGNORE_RE.test('/'+path) || IGNORE_FILE_RE.test(path)) return 'skip';
  const e = ext(path);
  if(e === 'zip'){
    const r = await addZip(file);
    return `zip:${r.taken}/${r.total}`;
  }
  if(IMAGE_EXT.has(e) || /^image\//.test(file.type||'')) return (await addImage(file, path)) ? 'image' : 'skip';
  if(TEXT_EXT.has(e) || /^text\//.test(file.type||'') || !e){
    const text = await readAsText(file);
    if(/\u0000/.test(text.slice(0,2000))) return 'skip';   // 바이너리
    return addText(path, text) ? 'text' : 'dup';
  }
  return 'skip';
}

async function addFiles(list){
  let n = 0, zipInfo = '', skipped = 0;
  for(const item of list){
    try{
      const r = await addFile(item.file, item.path);
      if(r === 'skip' || r === 'dup') skipped++;
      else if(String(r).startsWith('zip:')) { zipInfo = r.slice(4); n++; }
      else n++;
    }catch(e){ setStatus(e.message || String(e), true); }
  }
  /* 체크된 것 = 실제로 보내는 것 이어야 합니다.
     한도를 넘으면 큰 파일부터 꺼서 둘을 맞춥니다(다시 켤 수 있습니다). */
  const dropped = trimToBudget();

  renderAttTree(); saveState();
  const bits = [];
  if(n) bits.push(`${n}개 첨부`);
  if(zipInfo) bits.push(`zip 안에서 ${zipInfo}개 읽음`);
  if(skipped) bits.push(`${skipped}개는 건너뜀`);
  const chars = totalTextChars();
  if(chars) bits.push(`보낼 텍스트 ${chars.toLocaleString()}자 ≈ ${approxTokens(chars).toLocaleString()}토큰`);
  if(dropped) bits.push(`용량이 넘쳐 큰 파일 ${dropped}개는 체크를 꺼 뒀습니다 — 필요하면 다시 켜세요`);
  setStatus(bits.join(' · '), !!dropped);
}

function trimToBudget(){
  let total = totalTextChars();
  if(total <= MAX_TOTAL_CHARS) return 0;
  const on = attachments.filter(a => a.kind === 'text' && a.use).sort((a,b) => b.text.length - a.text.length);
  let off = 0;
  for(const a of on){
    if(total <= MAX_TOTAL_CHARS) break;
    a.use = false; total -= a.text.length; off++;
  }
  return off;
}

/* 폴더째 드래그 — DataTransferItem 을 재귀로 훑습니다 */
async function walkEntry(entry, prefix, out){
  if(!entry) return;
  const path = (prefix ? prefix + '/' : '') + entry.name;
  if(entry.isFile){
    const file = await new Promise((res,rej) => entry.file(res,rej));
    out.push({ file, path });
    return;
  }
  if(entry.isDirectory){
    if(IGNORE_RE.test('/'+path+'/')) return;
    const reader = entry.createReader();
    for(;;){
      const batch = await new Promise((res,rej) => reader.readEntries(res,rej));
      if(!batch.length) break;
      for(const e of batch) await walkEntry(e, path, out);
    }
  }
}

/* ── 첨부 목록 그리기 ───────────────────────────────────────────── */
function buildTreeData(paths){
  const root = { dirs:new Map(), files:[] };
  for(const item of paths){
    const parts = item.path.split('/');
    let node = root;
    for(let i=0;i<parts.length-1;i++){
      if(!node.dirs.has(parts[i])) node.dirs.set(parts[i], { dirs:new Map(), files:[] });
      node = node.dirs.get(parts[i]);
    }
    node.files.push(item);
  }
  return root;
}
function renderTreeHTML(node, depth, mode){
  let html = '';
  for(const [name, sub] of node.dirs){
    html += `<details ${depth < 1 ? 'open' : ''}><summary>${esc(name)}</summary><div class="kids">${renderTreeHTML(sub, depth+1, mode)}</div></details>`;
  }
  for(const f of node.files){
    const on = openFile && openFile.source === mode && openFile.key === f.key;
    if(mode === 'att'){
      html += `<div class="row ${on?'on':''} ${f.use?'':'off'}">`
        + `<input type="checkbox" data-use="${esc(f.key)}" ${f.use?'checked':''} title="보낼지 여부">`
        + (f.kind === 'image' ? `<img class="thumb" src="data:${esc(f.mime)};base64,${f.data}" alt="">` : '')
        + `<button class="nm" data-open="${esc(f.key)}" title="${esc(f.path)}">${esc(baseName(f.path))}</button>`
        + `<span class="sz">${kb(f.size)}</span>`
        + `<button class="rm" data-rm="${esc(f.key)}" aria-label="빼기">×</button></div>`;
    }else{
      html += `<div class="row ${on?'on':''}">`
        + `<button class="nm" data-open="${esc(f.key)}" title="${esc(f.path)}">${esc(baseName(f.path))}</button>`
        + `<span class="sz">${kb(f.size)}</span></div>`;
    }
  }
  return html;
}

function renderAttTree(){
  const box = $('#attTree');
  const items = attachments.map(a => ({ ...a, key:String(a.id) }));
  $('#attCount').textContent = items.length ? `${items.length}개 · ${approxTokens(totalTextChars()).toLocaleString()}토큰` : '';
  $('#tabFileCount').textContent = items.length ? `(${items.length})` : '';
  if(!items.length){
    box.innerHTML = `<div class="treeEmpty">아직 없습니다.<br>파일·폴더·zip 을 대화창에 끌어다 놓거나 Ctrl+V 로 붙여넣으세요.<br>zip 은 여기서 풀어서 안의 코드를 읽습니다.</div>`;
    return;
  }
  box.innerHTML = renderTreeHTML(buildTreeData(items), 0, 'att');
  box.querySelectorAll('[data-use]').forEach(el => el.onchange = () => {
    const a = attachments.find(x => String(x.id) === el.dataset.use);
    if(a) a.use = el.checked;
    renderAttTree(); saveState();
  });
  box.querySelectorAll('[data-rm]').forEach(el => el.onclick = () => {
    attachments = attachments.filter(x => String(x.id) !== el.dataset.rm);
    if(openFile && openFile.source === 'att' && openFile.key === el.dataset.rm) openFile = null;
    renderAttTree(); saveState();
  });
  box.querySelectorAll('[data-open]').forEach(el => el.onclick = () => showAttachment(el.dataset.open));
}

function renderMadeTree(){
  const box = $('#madeTree');
  const keys = Object.keys(project).sort();
  $('#madeCount').textContent = keys.length ? `${keys.length}개` : '';
  const has = keys.length > 0;
  $('#btnZip').disabled = !has;
  $('#btnOpenTab').disabled = !has;
  if(!has){ box.innerHTML = `<div class="treeEmpty">만들면 여기에 파일이 뜹니다.<br>눌러서 코드와 미니맵을 볼 수 있습니다.</div>`; return; }
  const items = keys.map(k => ({ path:k, key:k, size:project[k].length }));
  box.innerHTML = renderTreeHTML(buildTreeData(items), 0, 'made');
  box.querySelectorAll('[data-open]').forEach(el => el.onclick = () => showProjectFile(el.dataset.open));
}

/* ═══════════════════════════════════════════════════════════════════
   대화 로그
   ═══════════════════════════════════════════════════════════════════ */
function renderChatLog(){
  const box = $('#chatLog');
  if(!history.length){
    box.innerHTML = '<div class="empty">만들고 싶은 걸 설명하고 “만들기”를 누르면 결과가 오른쪽에 뜹니다. 참고할 파일은 아무거나 끌어다 놓거나 Ctrl+V 로 붙여넣으세요.</div>';
    return;
  }
  box.innerHTML = history.map(h => {
    const files = h.files ? `<span class="msgFiles">첨부 ${esc(h.files)}</span>` : '';
    return h.role === 'user'
      ? `<div class="chatMsg user">${esc(h.content).slice(0,600)}${files}</div>`
      : `<div class="chatMsg assistant">${esc(h.content)}</div>`;
  }).join('');
  box.scrollTop = box.scrollHeight;
}

function renderChips(){
  $$('#styleChips .chip').forEach(c => c.setAttribute('aria-pressed', styleHints.has(c.dataset.hint) ? 'true' : 'false'));
}

/* ═══════════════════════════════════════════════════════════════════
   보낼 글 만들기
   ─────────────────────────────────────────────────────────────────
   Worker 의 시스템 프롬프트는 못 건드리므로, 형식 규약을 사용자 쪽
   글 끝에 붙여서 «사용자 지시» 로 강제합니다.
   ═══════════════════════════════════════════════════════════════════ */
const CONTRACT_MULTI = `
━━━ 출력 형식 (반드시 이대로) ━━━
결과는 아래 형식의 파일 블록만 출력한다. 인사말·설명·요약·마크다운 코드펜스(\`\`\`) 금지.

<<<FILE: index.html>>>
(파일 전체 내용)
<<<ENDFILE>>>
<<<FILE: assets/style.css>>>
(파일 전체 내용)
<<<ENDFILE>>>

규칙
1. 첫 블록은 반드시 index.html 이다.
2. 경로는 저장소 루트 기준 상대경로만 쓴다. 앞에 / 나 ../ 를 붙이지 않는다.
3. 고친 파일만이 아니라 프로젝트의 모든 파일을 매번 전체 내용으로 다시 출력한다. "생략", "이하 동일" 금지.
4. HTML 은 <link rel="stylesheet" href="./assets/style.css"> 처럼 상대경로로 연결한다.
5. <script type="module"> 과 import/export 는 쓰지 않는다. 일반 <script src="..."></script> 만 쓴다.
6. 외부 라이브러리는 CDN <script> 로만 쓴다. npm·vite·webpack 같은 빌드 도구가 필요한 코드는 만들지 않는다.
7. 마지막 블록으로 README.md 를 넣는다 — 무엇을 만든 페이지인지, 파일 구성, GitHub Pages 로 여는 법.
8. 파일은 8개 이하로 유지한다.`;

const CONTRACT_SINGLE = `
━━━ 출력 형식 (반드시 이대로) ━━━
파일 하나짜리 완성된 HTML 문서만 출력한다. CSS·JS 는 <style>/<script> 안에 넣는다.
설명·마크다운 코드펜스(\`\`\`) 금지. 첫 글자는 <!doctype html> 이다.`;

function attachmentBlock(){
  const texts = attachments.filter(a => a.kind === 'text' && a.use);
  if(!texts.length) return '';
  let total = 0;
  const parts = [];
  for(const a of texts){
    if(total + a.text.length > MAX_TOTAL_CHARS){ parts.push(`(용량 때문에 ${a.path} 이하는 생략)`); break; }
    total += a.text.length;
    parts.push(`--- FILE: ${a.path} ---\n${a.text}\n--- END: ${a.path} ---`);
  }
  return `\n━━━ 참고 파일 ━━━\n아래는 내가 이미 가지고 있는 파일들이다. 구조·이름·말투를 참고하되, 요청한 것만 만든다.\n\n${parts.join('\n\n')}`;
}
function hintBlock(){
  const hs = [...styleHints].map(h => HINT_TEXT[h]).filter(Boolean);
  return hs.length ? `\n━━━ 스타일 요청 ━━━\n${hs.map(h => '- ' + h).join('\n')}` : '';
}
function serializeProject(){
  const keys = Object.keys(project);
  if(!keys.length) return '';
  if(keys.length === 1 && keys[0] === 'index.html') return project['index.html'];
  return keys.map(k => `<<<FILE: ${k}>>>\n${project[k]}\n<<<ENDFILE>>>`).join('\n');
}

/* ═══════════════════════════════════════════════════════════════════
   결과 가르기
   ═══════════════════════════════════════════════════════════════════ */
function stripFence(s){
  return String(s||'').trim()
    .replace(/^```[a-z0-9]*\r?\n?/i, '')
    .replace(/\r?\n?```\s*$/, '')
    .trim();
}
function parseFiles(raw){
  const text = String(raw || '');
  const out = {};

  /* 1순위 — 우리가 시킨 표시 */
  FILE_RE.lastIndex = 0;
  let m;
  while((m = FILE_RE.exec(text))){
    const p = normPath(m[1]);
    if(!p) continue;
    out[p] = stripFence(m[2]);
  }
  if(Object.keys(out).length) return out;

  /* 2순위 — ```html path/to/file 처럼 파일명을 붙인 코드펜스 */
  const fence = /```[a-z0-9]*\s+([\w./-]+\.[a-z0-9]{1,6})\s*\r?\n([\s\S]*?)```/gi;
  while((m = fence.exec(text))){
    const p = normPath(m[1]);
    if(p) out[p] = m[2].trim();
  }
  if(Object.keys(out).length) return out;

  /* 3순위 — 그냥 HTML 한 덩어리 */
  const one = stripFence(text);
  if(one) out['index.html'] = one;
  return out;
}

/* ═══════════════════════════════════════════════════════════════════
   미리보기 — css/js 를 html 안으로 합칩니다
   ─────────────────────────────────────────────────────────────────
   sandbox 로 격리한 iframe 은 «부모가 만든» blob: 주소를 못 읽습니다
   (origin 이 달라짐). 그래서 링크를 따라가는 대신 내용을 넣습니다.
   파일 자체는 나뉜 채로 남으니 ZIP·GitHub 에는 영향이 없습니다.
   ═══════════════════════════════════════════════════════════════════ */
function findFile(href){
  const want = normPath(String(href||'').split(/[?#]/)[0]);
  if(!want) return null;
  if(project[want] != null) return want;
  const low = want.toLowerCase();
  return Object.keys(project).find(k => k.toLowerCase() === low)
      || Object.keys(project).find(k => k.toLowerCase().endsWith('/'+low))
      || null;
}
function entryFile(){
  return findFile('index.html') || Object.keys(project).find(k => /\.html?$/i.test(k)) || Object.keys(project)[0] || null;
}
function inlineDoc(){
  const entry = entryFile();
  if(!entry) return '';
  let html = project[entry] || '';

  html = html.replace(/<link\b[^>]*>/gi, tag => {
    if(!/stylesheet/i.test(tag)) return tag;
    const href = (tag.match(/href\s*=\s*["']([^"']+)["']/i) || [])[1];
    const key = findFile(href);
    return key ? `<style>\n${project[key]}\n</style>` : tag;
  });

  html = html.replace(/<script\b([^>]*)\bsrc\s*=\s*["']([^"']+)["']([^>]*)>\s*<\/script>/gi, (tag, a, src) => {
    const key = findFile(src);
    if(!key) return tag;
    const body = project[key].replace(/<\/script>/gi, '<\\/script>');
    return `<script>\n${body}\n</script>`;
  });

  /* 상대경로 svg 는 그대로 심어 줍니다(아이콘이 깨지는 걸 막으려고) */
  html = html.replace(/<img\b[^>]*src\s*=\s*["']([^"']+\.svg)["'][^>]*>/gi, (tag, src) => {
    const key = findFile(src);
    if(!key) return tag;
    return `<span style="display:inline-block">${project[key]}</span>`;
  });

  /* 격리된 iframe 안에서는 localStorage 를 만지면 예외가 납니다.
     만든 페이지가 «저장» 기능을 쓰면 거기서 통째로 멈추므로,
     미리보기에서만 쓰는 임시 저장소를 먼저 끼워 넣습니다.
     내려받는 파일에는 이 코드가 들어가지 않습니다. */
  const shim = `<script>(function(){try{window.localStorage.getItem("_probe");return}catch(e){}
var mk=function(){var m={};return{getItem:function(k){return Object.prototype.hasOwnProperty.call(m,k)?m[k]:null},
setItem:function(k,v){m[k]=String(v)},removeItem:function(k){delete m[k]},clear:function(){m={}},
key:function(i){return Object.keys(m)[i]||null},get length(){return Object.keys(m).length}}};
try{Object.defineProperty(window,"localStorage",{value:mk(),configurable:true})}catch(e){}
try{Object.defineProperty(window,"sessionStorage",{value:mk(),configurable:true})}catch(e){}})();<\/script>`;
  return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, m => m + shim) : shim + html;
}
function applyPreview(){
  const has = Object.keys(project).length > 0;
  $('#previewFrame').srcdoc = has ? inlineDoc() : '';
  $('#previewEmpty').hidden = has;
  renderMadeTree();
}

/* ═══════════════════════════════════════════════════════════════════
   코드 보기 + 미니맵
   ═══════════════════════════════════════════════════════════════════ */
function openCodePanel(title, text, isImageHtml){
  $('#codePanel').hidden = false;
  $('#codeTitle').textContent = title;
  const pre = $('#codeView');
  if(isImageHtml){
    pre.innerHTML = text;
    $('#minimapBox').style.display = 'none';
    $('#codeMeta').textContent = '';
  }else{
    pre.textContent = text;
    $('#minimapBox').style.display = '';
    const lines = text.split('\n').length;
    $('#codeMeta').textContent = `${lines.toLocaleString()}줄 · ${text.length.toLocaleString()}자 · ≈${approxTokens(text.length).toLocaleString()}토큰`;
    pre.scrollTop = 0;
    drawMinimap();
  }
  if(window.matchMedia('(max-width:980px)').matches) setPane('view');
}
function showProjectFile(key){
  if(project[key] == null) return;
  openFile = { source:'made', key };
  renderMadeTree(); renderAttTree();
  openCodePanel(key, project[key], false);
}
function showAttachment(id){
  const a = attachments.find(x => String(x.id) === String(id));
  if(!a) return;
  openFile = { source:'att', key:String(a.id) };
  renderAttTree(); renderMadeTree();
  if(a.kind === 'image'){
    openCodePanel(a.path, `<img src="data:${esc(a.mime)};base64,${a.data}" alt="" style="max-width:100%;border-radius:8px">`, true);
  }else{
    openCodePanel(a.path, a.text, false);
  }
}

function lineColor(t){
  if(t[0] === '<') return '#4c7fe0';
  if(t.startsWith('//') || t.startsWith('/*') || t.startsWith('*') || t.startsWith('#')) return '#c3c8d1';
  if(/^[.#@:]|^\w[\w-]*\s*\{|:\s*[^;]+;/.test(t)) return '#a273cf';
  if(/\b(function|const|let|var|class|return|if|for|await|async)\b/.test(t)) return '#3f9c74';
  return '#7a828e';
}
function drawMinimap(){
  const pre = $('#codeView'), cv = $('#minimap'), box = $('#minimapBox');
  if(!cv || !box || box.style.display === 'none') return;
  const W = box.clientWidth, H = box.clientHeight;
  if(!W || !H) return;
  const dpr = window.devicePixelRatio || 1;
  cv.width = Math.round(W*dpr); cv.height = Math.round(H*dpr);
  const g = cv.getContext('2d');
  g.setTransform(dpr,0,0,dpr,0,0);
  g.clearRect(0,0,W,H);

  const lines = (pre.textContent || '').split('\n');
  const step = Math.min(3, H / Math.max(lines.length, 1));
  const stride = Math.max(1, Math.round(1 / Math.max(step, 0.05) / 4));
  const usable = W - 8;
  for(let i=0;i<lines.length;i+=stride){
    const raw = lines[i], t = raw.trim();
    if(!t) continue;
    const y = i*step;
    if(y > H) break;
    const indent = Math.min(raw.length - raw.trimStart().length, 28);
    const x = 4 + indent*0.9;
    const w = Math.max(1, Math.min(usable - indent*0.9, (Math.min(t.length,100)/100) * (usable - indent*0.9)));
    g.fillStyle = lineColor(t);
    g.fillRect(x, y, w, Math.max(step*0.72, 0.7));
  }
  syncMinimapView();
}
function syncMinimapView(){
  const pre = $('#codeView'), box = $('#minimapBox'), view = $('#mmView');
  if(!pre || !box || !view || box.style.display === 'none') return;
  const H = box.clientHeight;
  const sh = pre.scrollHeight || 1;
  const ratio = pre.clientHeight / sh;
  /* 스크롤할 게 없으면 «지금 보는 곳» 표시는 뜻이 없으니 숨깁니다 */
  view.style.display = ratio >= 0.999 ? 'none' : '';
  view.style.height = Math.max(6, Math.min(1, ratio)*H) + 'px';
  view.style.top = (pre.scrollTop / sh) * H + 'px';
}
function minimapJump(e){
  const pre = $('#codeView'), box = $('#minimapBox');
  const r = box.getBoundingClientRect();
  const y = (e.clientY - r.top) / r.height;
  pre.scrollTop = y * pre.scrollHeight - pre.clientHeight/2;
}

/* ═══════════════════════════════════════════════════════════════════
   만들기
   ═══════════════════════════════════════════════════════════════════ */
async function build(){
  if(busy) return;
  const userText = $('#prompt').value.trim();
  if(!userText) return setStatus('무엇을 만들지 설명을 입력하세요.', true);
  if(!sb) return setStatus('Supabase 설정이 없습니다.', true);
  if(!CFG.AI_WORKER_URL) return setStatus('config.js 에 AI_WORKER_URL 이 없습니다.', true);

  const provider = $('#provider').value;
  const multi = $('#outputMode').value === 'multi';
  const model = $('#modelOverride').value.trim() || DEFAULT_MODEL[provider] || DEFAULT_MODEL.openai;

  const images = attachments.filter(a => a.kind === 'image' && a.use).slice(0, MAX_IMAGES);
  const textCount = attachments.filter(a => a.kind === 'text' && a.use).length;
  const fileNote = [images.length ? `사진 ${images.length}장` : '', textCount ? `파일 ${textCount}개` : ''].filter(Boolean).join(' · ');

  const fullPrompt = [
    userText,
    attachmentBlock(),
    hintBlock(),
    multi ? CONTRACT_MULTI : CONTRACT_SINGLE,
  ].filter(Boolean).join('\n');

  setBusy(true); setStatus('만드는 중…');
  history.push({ role:'user', content: userText + (Object.keys(project).length ? '  (이어서 수정)' : ''), files: fileNote });
  renderChatLog();

  try{
    const token = await getToken();
    const base = (CFG.AI_WORKER_URL || '').replace(/\/+$/,'');
    const payload = {
      provider, model,
      tier: $('#tier').value,
      prompt: fullPrompt,
      reference_url: $('#refUrl').value.trim(),
      current_code: serializeProject(),
      history: history.slice(0,-1).slice(-8).map(h => ({ role:h.role, content:h.content })),
      files: images.map(f => ({ data:f.data, mime:f.mime, name:baseName(f.path) })),
      output: multi ? 'multi-file' : 'single-file',
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
      if(provider === 'anthropic' && /provider|model|unknown|unsupported|지원/i.test(msg)){
        msg = 'Worker 에 Claude 경로가 아직 없습니다. worker-ai-build-claude.js 를 sniper-ai 에 붙여넣고 배포한 뒤 다시 시도하세요. (원래 오류: ' + msg + ')';
      }
      throw new Error(msg);
    }
    if(!res.body) throw new Error('스트리밍 응답을 받을 수 없습니다.');

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '', acc = '', lastTick = 0;

    for(;;){
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
          else if(typeof o.text === 'string') acc += o.text;
          else if(o.error) throw new Error(o.error);
        }
      }
      const now = Date.now();
      if(now - lastTick > 250){
        lastTick = now;
        setStatus(`만드는 중… ${acc.length.toLocaleString()}자`);
      }
    }

    const files = parseFiles(acc);
    const keys = Object.keys(files);
    if(!keys.length) throw new Error('결과를 받지 못했습니다. 다시 시도하거나 “한 파일 HTML” 로 바꿔 보세요.');

    project = files;
    openFile = null;
    applyPreview();
    history.push({ role:'assistant', content:`${keys.length}개 파일을 만들었습니다 — ${keys.join(', ')}\n이어서 고칠 부분을 설명하면 계속 다듬습니다.` });
    renderChatLog();
    setStatus(`완료 · ${keys.length}개 파일`);
    $('#prompt').value = '';
  }catch(e){
    setStatus(e.message || String(e), true);
    history.pop(); renderChatLog();
  }finally{
    setBusy(false);
    saveState();
  }
}

/* ═══════════════════════════════════════════════════════════════════
   내려받기
   ═══════════════════════════════════════════════════════════════════ */
function saveBlob(blob, name){
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}
function titleOf(){
  const html = project[entryFile()] || '';
  return (html.match(/<title>([^<]*)<\/title>/i) || [])[1] || 'sniper-build';
}
async function downloadZip(){
  const keys = Object.keys(project);
  if(!keys.length) return;
  if(keys.length === 1 && /\.html?$/i.test(keys[0])){
    return saveBlob(new Blob([project[keys[0]]], {type:'text/html'}), `${slug(titleOf())}.html`);
  }
  if(!window.JSZip) return setStatus('zip 라이브러리를 못 불러왔습니다. 파일을 하나씩 저장하세요.', true);
  const zip = new window.JSZip();
  for(const k of keys) zip.file(k, project[k]);
  zip.file('.nojekyll', '');   // GitHub Pages 가 _로 시작하는 폴더를 버리지 않게
  const blob = await zip.generateAsync({ type:'blob' });
  saveBlob(blob, `${slug(titleOf())}-${Date.now()}.zip`);
  setStatus('ZIP 을 받았습니다. 압축을 풀어 GitHub 저장소에 그대로 올리면 됩니다.');
}
/* 새 탭도 격리해서 엽니다.
   blob: 주소는 이 블로그와 같은 출처라서, 그냥 열면 만들어진 코드가
   내 로그인 토큰(localStorage)을 읽을 수 있습니다. 껍데기 한 장을
   띄우고 그 안의 sandbox iframe 에 내용을 넣어 그 길을 끊습니다. */
function openInTab(){
  const doc = inlineDoc();
  if(!doc) return;
  const attr = doc.replace(/&/g,'&amp;').replace(/"/g,'&quot;');
  const shell = `<!doctype html><meta charset="utf-8"><title>${esc(titleOf())}</title>`
    + `<style>html,body{margin:0;height:100%;background:#fff}iframe{border:0;display:block;width:100%;height:100%}</style>`
    + `<iframe sandbox="allow-scripts allow-forms allow-popups allow-modals" srcdoc="${attr}"></iframe>`;
  const url = URL.createObjectURL(new Blob([shell], {type:'text/html'}));
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/* ═══════════════════════════════════════════════════════════════════
   화면 전환(좁은 화면)
   ═══════════════════════════════════════════════════════════════════ */
function setPane(name){
  document.body.dataset.pane = name;
  $$('#paneTabs button').forEach(b => b.setAttribute('aria-pressed', b.dataset.pane === name ? 'true' : 'false'));
  if(name === 'view') setTimeout(drawMinimap, 60);
}

/* ═══════════════════════════════════════════════════════════════════
   붙이기
   ═══════════════════════════════════════════════════════════════════ */
function bind(){
  $('#btnLogin').onclick = login;
  $('#loginPassword').onkeydown = e => { if(e.key === 'Enter') login(); };
  $('#btnLoginBack').onclick = () => location.href = './index.html';
  $('#btnBlog').onclick = () => location.href = './index.html';
  $('#btnLogout').onclick = async () => { await sb?.auth.signOut(); location.href = './index.html'; };

  $('#btnBuild').onclick = build;
  $('#prompt').addEventListener('keydown', e => {
    if((e.metaKey || e.ctrlKey) && e.key === 'Enter'){ e.preventDefault(); build(); }
  });

  $('#btnNewChat').onclick = () => {
    if((history.length || Object.keys(project).length) && !confirm('지금까지 대화와 만든 파일을 지우고 새로 시작할까요? (첨부는 남습니다)')) return;
    history = []; project = {}; openFile = null;
    $('#prompt').value = '';
    renderChatLog(); applyPreview();
    $('#codePanel').hidden = true;
    setStatus(''); saveState();
  };

  /* 파일 고르기 */
  $('#btnPickFiles').onclick = () => $('#pickFiles').click();
  $('#btnPickFolder').onclick = () => $('#pickFolder').click();
  const onPick = async e => {
    const files = [...(e.target.files || [])].map(f => ({ file:f, path: f.webkitRelativePath || f.name }));
    e.target.value = '';
    if(files.length) await addFiles(files);
  };
  $('#pickFiles').onchange = onPick;
  $('#pickFolder').onchange = onPick;
  $('#btnClearAtt').onclick = () => {
    if(!attachments.length) return;
    if(!confirm('첨부한 파일을 모두 뺄까요?')) return;
    attachments = []; openFile = null; renderAttTree(); saveState(); setStatus('');
  };

  /* 드래그해서 놓기 — 폴더도 됩니다 */
  const zone = $('#paneChat');
  ['dragenter','dragover'].forEach(t => zone.addEventListener(t, e => {
    e.preventDefault(); zone.classList.add('dragover');
  }));
  ['dragleave','drop'].forEach(t => zone.addEventListener(t, e => {
    if(t === 'dragleave' && zone.contains(e.relatedTarget)) return;
    zone.classList.remove('dragover');
  }));
  zone.addEventListener('drop', async e => {
    e.preventDefault();
    const dt = e.dataTransfer;
    const out = [];
    const items = [...(dt.items || [])];
    const entries = items.map(it => it.webkitGetAsEntry && it.webkitGetAsEntry()).filter(Boolean);
    if(entries.length){
      setStatus('파일을 읽는 중…');
      for(const en of entries) await walkEntry(en, '', out);
    }else{
      for(const f of [...(dt.files || [])]) out.push({ file:f, path:f.name });
    }
    if(out.length) await addFiles(out);
  });

  /* Ctrl+V — 사진도, 파일도, 긴 코드도 */
  document.addEventListener('paste', async e => {
    if($('#app').hidden) return;
    const dt = e.clipboardData;
    if(!dt) return;
    const files = [...(dt.files || [])];
    if(files.length){
      e.preventDefault();
      await addFiles(files.map(f => ({ file:f, path:f.name })));
      return;
    }
    const items = [...(dt.items || [])].filter(i => i.kind === 'file');
    if(items.length){
      e.preventDefault();
      const list = items.map(i => i.getAsFile()).filter(Boolean)
        .map((f,i) => ({ file:f, path: f.name || `붙여넣기-${Date.now()}-${i}.png` }));
      await addFiles(list);
      return;
    }
    /* 입력칸 밖에서 긴 텍스트를 붙이면 파일로 받습니다 */
    const text = dt.getData('text/plain') || '';
    const inField = ['TEXTAREA','INPUT'].includes(document.activeElement?.tagName);
    if(!inField && text.length > 800){
      e.preventDefault();
      addText(`붙여넣기-${new Date().toISOString().slice(11,19).replace(/:/g,'')}.txt`, text);
      renderAttTree(); saveState();
      setStatus(`붙여넣은 텍스트 ${text.length.toLocaleString()}자를 파일로 첨부했습니다.`);
    }
  });

  /* 스타일 칩 */
  $$('#styleChips .chip').forEach(c => c.onclick = () => {
    styleHints.has(c.dataset.hint) ? styleHints.delete(c.dataset.hint) : styleHints.add(c.dataset.hint);
    renderChips(); saveState();
  });

  /* 미리보기 폭 */
  $$('#widthBar button').forEach(b => b.onclick = () => {
    $$('#widthBar button').forEach(x => x.setAttribute('aria-pressed','false'));
    b.setAttribute('aria-pressed','true');
    const wrap = $('#previewWrap');
    wrap.classList.remove('narrow','mid');
    if(b.dataset.w !== 'full') wrap.classList.add(b.dataset.w);
  });

  /* 코드 패널 */
  $('#btnViewCode').onclick = () => {
    const p = $('#codePanel');
    if(p.hidden){
      const key = entryFile();
      if(key) showProjectFile(key); else { p.hidden = false; openCodePanel('코드','아직 만든 게 없습니다.',false); }
    }else{ p.hidden = true; }
  };
  $('#btnCloseCode').onclick = () => { $('#codePanel').hidden = true; };
  $('#btnCopyCode').onclick = async () => {
    try{ await navigator.clipboard.writeText($('#codeView').textContent || ''); setStatus('복사했습니다.'); }
    catch{ setStatus('복사가 막혔습니다. 코드를 직접 선택해 복사하세요.', true); }
  };
  $('#btnSaveOne').onclick = () => {
    const name = $('#codeTitle').textContent || 'file.txt';
    saveBlob(new Blob([$('#codeView').textContent || ''], {type:'text/plain'}), baseName(name));
  };
  $('#btnZip').onclick = downloadZip;
  $('#btnOpenTab').onclick = openInTab;

  /* 미니맵 */
  $('#codeView').addEventListener('scroll', syncMinimapView, { passive:true });
  $('#minimapBox').addEventListener('click', minimapJump);
  let mmDrag = false;
  $('#minimapBox').addEventListener('pointerdown', e => { mmDrag = true; minimapJump(e); });
  window.addEventListener('pointermove', e => { if(mmDrag) minimapJump(e); });
  window.addEventListener('pointerup', () => { mmDrag = false; });
  window.addEventListener('resize', () => { drawMinimap(); });

  /* 탭 */
  $$('#paneTabs button').forEach(b => b.onclick = () => setPane(b.dataset.pane));

  /* 저장 */
  ['prompt','refUrl','modelOverride'].forEach(id => $('#'+id).addEventListener('input', saveState));
  ['tier','provider','outputMode'].forEach(id => $('#'+id).addEventListener('change', saveState));
  $('#provider').addEventListener('change', () => {
    const p = $('#provider').value;
    $('#modelOverride').placeholder = `모델 직접 입력(기본 ${DEFAULT_MODEL[p] || '-'})`;
  });
  $('#provider').dispatchEvent(new Event('change'));
}

bind();
boot();
})();
