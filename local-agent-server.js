const http = require('http');
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const HOST = '127.0.0.1';
const PORT = 8788;
const VERSION = 'v16';
const MAX_BODY = 2 * 1024 * 1024;
const MAX_FILE = 800 * 1024;
const MAX_APPLY_FILE = 1.6 * 1024 * 1024;
const MAX_READ_TOTAL = 7 * 1024 * 1024;
const MAX_HISTORY = 50;
const SAFE_EXT = /\.(html?|css|js|mjs|cjs|json|md|txt|xml|svg|toml|yml|yaml|ts|tsx|jsx|vue|svelte|py|ps1|bat|cmd|sh|vbs|psm1|astro)$/i;
// 실행 스크립트는 읽기/색인까지만 허용하고 AI 쓰기 대상에서는 제외한다.
// (AI가 .bat/.ps1 을 쓰고 npm/npx/node 로 실행시키는 경로를 끊기 위함)
const NO_WRITE_EXT = /\.(ps1|bat|cmd|sh|vbs|psm1)$/i;
const SECRET_NAME = /(^|\/)(?:\.env(?:\.[^\/]*)?|credentials?(?:\.[^\/]*)?|secrets?(?:\.[^\/]*)?|service[-_]?account(?:\.[^\/]*)?|.*\.(?:pem|key|p12|pfx))$/i;
const SECRET_CONTENT = /(sk-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{20,}|sb_(?:publishable|secret)_[A-Za-z0-9_-]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|service[_-]?role[_-]?key|secret[_-]?key|password\s*[:=])/i;
const MAX_TREE_FILES = 2500;
const MAX_TREE_DEPTH = 18;
const MAX_SEARCH_RESULTS = 80;
const MAX_SEARCH_SNIPPET = 700;
const MAX_GIT_OUTPUT = 350 * 1024;
const MAX_INDEX_FILES = 800;
const MAX_INDEX_SYMBOLS = 4000;
const MAX_INDEX_SNIPPET = 180;

const IGNORES = new Set(['node_modules','.git','.wrangler','dist','build','coverage','.next','.cache','.venv','venv','.turbo','.svelte-kit','.astro','.parcel-cache']);
const ALLOWED_CMDS = new Set(['npm','npx','pnpm','yarn','bun','node','git']);
const ALLOWED_GIT = new Set(['status','diff','check-ignore','rev-parse','show-ref']);
const SESSION_COOKIE = 'sniper_agent';
const SESSIONS = new Map();
const ROOT_LOCKS = new Map();
const OP_LOCKS = new Set();
const APPROVALS = new Map();
const APPROVAL_TTL = 2 * 60 * 1000;
const SCRIPT_APPROVALS = new Map();
const AUDIT_MAX = 600;
const MAX_CMD_OUTPUT = 700 * 1024;
const WORK_STATE_DIR = path.join(process.env.LOCALAPPDATA || process.env.APPDATA || process.env.HOME || __dirname, 'sniper-work-agent', 'sessions');
const SESSION_TTL = 12 * 60 * 60 * 1000;
const SESSION_IDLE_TTL = 2 * 60 * 60 * 1000;
const SUPABASE_URL = String(process.env.SNIPER_SUPABASE_URL || '').replace(/\/+$/,'');
const SUPABASE_ANON_KEY = String(process.env.SNIPER_SUPABASE_ANON_KEY || '');
const ALLOWED_EMAILS = new Set(String(process.env.SNIPER_WORK_EMAILS || '').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean));

const HISTORY = new Map(); // root -> [{id, createdAt, message, changes:[{path,old,new,oldHash,newHash}]}]
const LAST_APPLIED = new Map();
const HISTORY_DIR = path.join(process.env.LOCALAPPDATA || process.env.APPDATA || process.env.HOME || __dirname, 'sniper-work-agent', 'history');
function historyFile(root){ return path.join(HISTORY_DIR, crypto.createHash('sha256').update(root,'utf8').digest('hex') + '.json'); }
function stateFile(root,email='unknown'){ return path.join(WORK_STATE_DIR, crypto.createHash('sha256').update(String(email)+'::'+root,'utf8').digest('hex') + '.json'); }
async function loadWorkState(root,email='unknown'){ try { const raw=await fs.readFile(stateFile(root,email),'utf8'); const j=JSON.parse(raw); if(Date.now()-new Date(j.updatedAt||0).getTime()>30*24*60*60*1000) return {version:1,updatedAt:new Date().toISOString(),state:{}}; return j; } catch { return {version:1,updatedAt:new Date().toISOString(),state:{}}; } }
async function saveWorkState(root,state,email='unknown'){ await fs.mkdir(WORK_STATE_DIR,{recursive:true}); const payload={version:1,updatedAt:new Date().toISOString(),state}; await fs.writeFile(stateFile(root,email),JSON.stringify(payload,null,2),'utf8'); return payload; }
function projectMemoryFile(root){ return path.join(WORK_STATE_DIR,'memory-'+crypto.createHash('sha256').update(root,'utf8').digest('hex')+'.json'); }
async function loadProjectMemory(root){ try{ return JSON.parse(await fs.readFile(projectMemoryFile(root),'utf8')); }catch{return {version:1,updatedAt:new Date().toISOString(),rules:'',constraints:'',stack:[],notes:[]};} }
async function saveProjectMemory(root,memory){ const payload={version:1,updatedAt:new Date().toISOString(),rules:String(memory?.rules||'').slice(0,12000),constraints:String(memory?.constraints||'').slice(0,12000),stack:Array.isArray(memory?.stack)?memory.stack.slice(0,30).map(String):[],notes:Array.isArray(memory?.notes)?memory.notes.slice(-100).map(x=>({ts:x.ts||new Date().toISOString(),text:String(x.text||'').slice(0,1000)})):[]}; await fs.mkdir(WORK_STATE_DIR,{recursive:true}); await fs.writeFile(projectMemoryFile(root),JSON.stringify(payload,null,2),'utf8'); return payload; }
async function loadHistory(root){ if(HISTORY.has(root)) return HISTORY.get(root); try { const raw=await fs.readFile(historyFile(root),'utf8'); const parsed=JSON.parse(raw); const arr=Array.isArray(parsed?.items)?parsed.items.slice(-MAX_HISTORY):[]; HISTORY.set(root,arr); return arr; } catch { HISTORY.set(root,[]); return []; } }
async function auditLog(root, entry){
  try {
    const dir = path.join(process.env.LOCALAPPDATA || process.env.APPDATA || process.env.HOME || __dirname, 'sniper-work-agent', 'audit');
    await fs.mkdir(dir,{recursive:true});
    const file = path.join(dir, crypto.createHash('sha256').update(root,'utf8').digest('hex') + '.jsonl');
    const item={ts:new Date().toISOString(),...entry};
    await fs.appendFile(file,JSON.stringify(item)+'\n','utf8');
  } catch(e) { console.warn('audit log failed:',e.message||e); }
}
async function readAudit(root){
  try {
    const dir = path.join(process.env.LOCALAPPDATA || process.env.APPDATA || process.env.HOME || __dirname, 'sniper-work-agent', 'audit');
    const file = path.join(dir, crypto.createHash('sha256').update(root,'utf8').digest('hex') + '.jsonl');
    const raw=await fs.readFile(file,'utf8');
    return raw.split(/\r?\n/).filter(Boolean).slice(-AUDIT_MAX).map(x=>JSON.parse(x));
  } catch { return []; }
}
async function persistHistory(root){ try { await fs.mkdir(HISTORY_DIR,{recursive:true}); const arr=HISTORY.get(root)||[]; await fs.writeFile(historyFile(root),JSON.stringify({version:1,root,items:arr},null,2),'utf8'); } catch(e) { console.warn('history persistence failed:',e.message||e); } }

function allowedOrigins() {
  return String(process.env.SNIPER_WORK_ORIGINS || 'https://sniper.amirbatikunari.workers.dev,https://sniper.pages.dev,https://gichul-viewer.pages.dev,http://localhost:5500,http://127.0.0.1:5500')
    .split(',').map(s=>s.trim()).filter(Boolean);
}
function parseCookies(req){ const raw=String(req.headers.cookie||''); const out={}; for(const part of raw.split(';')){ const i=part.indexOf('='); if(i>0) out[part.slice(0,i).trim()]=decodeURIComponent(part.slice(i+1).trim()); } return out; }
function newSession(email){ const token=crypto.randomBytes(32).toString('hex'); const now=Date.now(); SESSIONS.set(token,{email,createdAt:now,lastSeenAt:now,root:null,realRoot:null,projectId:null}); return token; }
function setCookie(token){ return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${SESSION_TTL/1000}; HttpOnly; Secure; SameSite=None`; }
function corsHeaders(req) {
  const origin = req.headers.origin || '';
  const allowed = allowedOrigins();
  const h = {
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,x-agent-token',
    'Access-Control-Max-Age': '600',
    'Vary': 'Origin',
    'Access-Control-Allow-Credentials': 'true',
  };
  if (allowed.includes(origin)) {
    h['Access-Control-Allow-Origin'] = origin;
    // https 페이지에서 로컬 주소를 부를 때 크롬이 요구하는 사설망 접근 허용
    if (req.headers['access-control-request-private-network']) h['Access-Control-Allow-Private-Network'] = 'true';
  }
  return h;
}
function send(res, status, obj, req) {
  const headers = {'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', ...corsHeaders(req)};
  if (obj?.__setCookie) { headers['Set-Cookie']=setCookie(obj.__setCookie); delete obj.__setCookie; }
  res.writeHead(status, headers);
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve,reject)=>{
    let b='';
    req.on('data', c=>{
      b += c;
      if (b.length > MAX_BODY) { reject(new Error('요청 본문이 너무 큽니다.')); req.destroy(); }
    });
    req.on('end', ()=>{ try { resolve(b ? JSON.parse(b) : {}); } catch(e) { reject(e); } });
    req.on('error', reject);
  });
}
function safeRoot(root) {
  if (!root || !path.isAbsolute(root)) throw new Error('절대 경로가 필요합니다.');
  return path.resolve(root);
}
function safePath(root, rel) {
  const r = safeRoot(root);
  if (!rel || path.isAbsolute(rel)) throw new Error('상대 경로만 사용할 수 있습니다.');
  const p = path.resolve(r, rel);
  if (p !== r && !p.startsWith(r + path.sep)) throw new Error('프로젝트 루트 밖의 경로입니다.');
  return p;
}
function normalizeRel(rel) { return String(rel || '').replaceAll('\\','/').replace(/^\.\//,''); }
function validateRel(rel) {
  const n = normalizeRel(rel);
  if (!n || n.split('/').some(x => x === '..')) throw new Error(`잘못된 경로입니다: ${rel}`);
  if (SECRET_NAME.test(n)) throw new Error(`비밀/자격증명 파일은 Work Agent에서 직접 다룰 수 없습니다: ${rel}`);
  if (!SAFE_EXT.test(n)) throw new Error(`허용되지 않은 파일 형식입니다: ${rel}`);
  return n;
}
async function assertRoot(root) {
  const r = safeRoot(root);
  const lst = await fs.lstat(r).catch(()=>null);
  if (!lst?.isDirectory()) throw new Error('프로젝트 폴더가 존재하지 않습니다.');
  if (lst.isSymbolicLink()) throw new Error('프로젝트 루트 자체는 심볼릭 링크일 수 없습니다.');
  return r;
}
async function realRootPath(root){
  const r = safeRoot(root);
  const real = await fs.realpath(r);
  return path.resolve(real);
}
async function assertInsideRealRoot(root, target){
  const rr = await realRootPath(root);
  const parent = await fs.realpath(path.dirname(target));
  const candidate = path.resolve(parent, path.basename(target));
  if (candidate !== rr && !candidate.startsWith(rr + path.sep)) throw new Error('실제 경로 기준으로 프로젝트 루트 밖입니다.');
}
async function assertNotSymlink(target){
  try {
    const st = await fs.lstat(target);
    if (st.isSymbolicLink()) throw new Error('심볼릭 링크 파일은 직접 수정할 수 없습니다.');
  } catch(e){ if(e?.code!=='ENOENT') throw e; }
}
async function walk(root, dir='', out=[], depth=0) {
  if (depth > MAX_TREE_DEPTH) throw new Error(`프로젝트가 너무 깊습니다. ${MAX_TREE_DEPTH}단계 이내로 정리하세요.`);
  const abs = safePath(root, dir || '.');
  for (const ent of await fs.readdir(abs,{withFileTypes:true})) {
    if (IGNORES.has(ent.name)) continue;
    const rel = path.posix.join(dir.replaceAll(path.sep,'/'),ent.name).replace(/^\.\//,'');
    if (ent.isDirectory()) await walk(root,rel,out,depth+1);
    else if (SAFE_EXT.test(ent.name) && !SECRET_NAME.test(rel)) {
      out.push(rel);
      if (out.length > MAX_TREE_FILES) throw new Error(`파일이 너무 많습니다. 최대 ${MAX_TREE_FILES}개까지 지원합니다.`);
    }
  }
  return out.sort();
}
async function readFile(root, rel) {
  const n = validateRel(rel);
  const p = safePath(root, n);
  const st = await fs.stat(p);
  if (!st.isFile()) throw new Error(`${n}: 파일이 아닙니다.`);
  if (st.size > MAX_FILE) throw new Error(`${n}: ${MAX_FILE/1024}KB 초과`);
  return fs.readFile(p,'utf8');
}
function looksSecretText(text){ return SECRET_CONTENT.test(String(text||'')); }
function redactForAi(text){
  let s=String(text||'');
  s=s.replace(/(sk-[A-Za-z0-9_-]{12})[A-Za-z0-9_-]{8,}/g,'$1…REDACTED');
  s=s.replace(/(AIza[0-9A-Za-z_-]{12})[0-9A-Za-z_-]{8,}/g,'$1…REDACTED');
  s=s.replace(/(sb_(?:publishable|secret)_[A-Za-z0-9_-]{12})[A-Za-z0-9_-]{8,}/g,'$1…REDACTED');
  s=s.replace(/(-----BEGIN [^-]+ PRIVATE KEY-----)[\s\S]*?(-----END [^-]+ PRIVATE KEY-----)/g,'$1\n[REDACTED PRIVATE KEY]\n$2');
  return s;
}
async function searchProject(root, query, paths){
  const q=String(query||'').trim();
  if(!q) return [];
  const terms=q.toLowerCase().split(/[^a-z0-9가-힣_$.-]+/i).filter(x=>x.length>=2).slice(0,12);
  if(!terms.length) return [];
  const candidates=Array.isArray(paths)&&paths.length ? paths.map(validateRel).slice(0,500) : await walk(root);
  const out=[];
  for(const rel of candidates){
    if(out.length>=MAX_SEARCH_RESULTS) break;
    let txt; try{txt=await readFile(root,rel);}catch{continue;}
    const low=txt.toLowerCase();
    let score=0, idx=-1;
    for(const t of terms){ let p=low.indexOf(t); if(p>=0){score += t.length>=4?3:1; if(idx<0)idx=p;} }
    if(score<=0) continue;
    const start=Math.max(0,idx-220), end=Math.min(txt.length,idx+MAX_SEARCH_SNIPPET);
    const before=txt.slice(0,start); const line=before.split(/\r?\n/).length;
    out.push({path:rel,score,line,snippet:redactForAi(txt.slice(start,end)),secretDetected:looksSecretText(txt)});
  }
  return out.sort((a,b)=>b.score-a.score || a.path.localeCompare(b.path)).slice(0,MAX_SEARCH_RESULTS);
}
function extractSymbols(rel, text) {
  const ext=path.extname(rel).toLowerCase();
  const lines=String(text||'').split(/\r?\n/);
  const out=[];
  const push=(kind,name,line)=>{ if(!name || out.length>=MAX_INDEX_SYMBOLS) return; out.push({kind,name,line,snippet:lines[Math.max(0,line-1)]?.slice(0,MAX_INDEX_SNIPPET)||''}); };
  for(let i=0;i<lines.length;i++){
    const line=lines[i];
    if(['.js','.mjs','.cjs','.ts','.tsx','.jsx'].includes(ext)){ 
      let m=line.match(/\b(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/); if(m) push('function',m[1],i+1);
      m=line.match(/\b(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/); if(m) push('class',m[1],i+1);
      m=line.match(/\b(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/); if(m) push('function',m[1],i+1);
      m=line.match(/\b(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/); if(m) push('variable',m[1],i+1);
      m=line.match(/\b(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/); if(m) push('interface',m[1],i+1);
      m=line.match(/\b(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*=/); if(m) push('type',m[1],i+1);
      for(const mm of line.matchAll(/(?:import|export)\s+[^;]*?\s+from\s+["']([^"']+)["']/g)) push('import',mm[1],i+1);
    } else if(/\.py$/.test(ext)) {
      let m=line.match(/^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/); if(m) push('function',m[1],i+1);
      m=line.match(/^\s*class\s+([A-Za-z_]\w*)/); if(m) push('class',m[1],i+1);
      m=line.match(/^\s*(?:from|import)\s+([^#]+)/); if(m) push('import',m[1].trim(),i+1);
    } else if(/\.(html?|vue|svelte|astro)$/.test(ext)) {
      let m=line.match(/<script[^>]*>/i); if(m) push('script',m[0],i+1);
      m=line.match(/<([a-z][\w-]*)\b/i); if(m) push('tag',m[1],i+1);
    } else if(/\.css$/.test(ext)) {
      let m=line.match(/([^{}]+)\{/); if(m) push('selector',m[1].trim().slice(0,80),i+1);
    }
  }
  return out;
}
async function projectIndex(root, paths){
  const candidates=Array.isArray(paths)&&paths.length?paths.map(validateRel).slice(0,MAX_INDEX_FILES):await walk(root);
  const files=[], symbols=[], imports=[];
  for(const rel of candidates.slice(0,MAX_INDEX_FILES)){
    let text; try{text=await readFile(root,rel);}catch{continue;}
    const sy=extractSymbols(rel,text);
    const im=sy.filter(x=>x.kind==='import').map(x=>({path:rel,source:x.name,line:x.line}));
    symbols.push(...sy.filter(x=>x.kind!=='import').map(x=>({path:rel,...x})));
    imports.push(...im);
    files.push({path:rel,bytes:Buffer.byteLength(text,'utf8'),lines:String(text).split(/\r?\n/).length,secretDetected:looksSecretText(text)});
    if(symbols.length>=MAX_INDEX_SYMBOLS) break;
  }
  return {version:1,files,symbols:symbols.slice(0,MAX_INDEX_SYMBOLS),imports:imports.slice(0,MAX_INDEX_SYMBOLS),truncated:candidates.length>MAX_INDEX_FILES};
}
async function projectInfo(root){
  const info={root,git:false,packageManager:null,packageScripts:{},files:0};
  try{await fs.stat(path.join(root,'.git'));info.git=true}catch{}
  const managers=[['pnpm-lock.yaml','pnpm'],['yarn.lock','yarn'],['package-lock.json','npm'],['bun.lockb','bun']];
  for(const [file,name] of managers){try{await fs.stat(path.join(root,file));info.packageManager=name;break}catch{}}
  try{const pkg=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));info.packageManager ||= 'npm';info.packageScripts=pkg.scripts||{};}catch{}
  try{info.files=(await walk(root)).length}catch{}
  const has=s=>Object.prototype.hasOwnProperty.call(info.packageScripts,s);
  const pm=info.packageManager||'npm';
  const runScript=name => pm==='npm' ? `npm run ${name}` : pm==='yarn' ? `yarn ${name}` : pm==='pnpm' ? `pnpm ${name}` : pm==='bun' ? `bun run ${name}` : `npm run ${name}`;
  const testCmd = pm==='npm' ? 'npm test' : pm==='yarn' ? 'yarn test' : pm==='pnpm' ? 'pnpm test' : pm==='bun' ? 'bun test' : 'npm test';
  info.verifyPresets={fast:has('lint')?[runScript('lint')]:has('test')?[testCmd]:['git diff --check'],standard:[...(has('lint')?[runScript('lint')]:[]),...(has('test')?[testCmd]:[]),...(has('build')?[runScript('build')]:[]),'git diff --check'],full:[...(has('typecheck')?[runScript('typecheck')]:[]),...(has('lint')?[runScript('lint')]:[]),...(has('test')?[testCmd]:[]),...(has('build')?[runScript('build')]:[]),'git diff --check']};
  if(!info.verifyPresets.standard.length) info.verifyPresets.standard=['git diff --check'];
  if(!info.verifyPresets.full.length) info.verifyPresets.full=['git diff --check'];
  return info;
}

async function existsText(root, rel) {
  const n = validateRel(rel), p = safePath(root,n);
  try {
    const st = await fs.stat(p);
    if (!st.isFile()) return null;
    return await fs.readFile(p,'utf8');
  } catch { return null; }
}
async function writeFile(root, rel, content) {
  const n = validateRel(rel), p = safePath(root,n);
  await fs.mkdir(path.dirname(p),{recursive:true});
  await assertInsideRealRoot(root,p);
  await assertNotSymlink(p);
  const tmp = p + `.sniper-tmp-${process.pid}-${crypto.randomBytes(5).toString('hex')}`;
  await fs.writeFile(tmp,String(content),'utf8');
  await fs.rename(tmp,p);
}
async function sha256Text(value) {
  return crypto.createHash('sha256').update(value ?? '', 'utf8').digest('hex');
}
async function captureChanges(root, changes) {
  const snap=[];
  for (const raw of changes) {
    if (!raw?.path) continue;
    const n = validateRel(raw.path);
    const old = await existsText(root,n);
    snap.push({path:n,old,new:null,oldHash:old===null?null:await sha256Text(old),newHash:null});
  }
  return snap;
}
async function currentHash(root, rel) {
  const value = await existsText(root,rel);
  return value === null ? null : await sha256Text(value);
}
async function addHistory(root, changes, message='') {
  await loadHistory(root);
  const id = `${Date.now().toString(36)}-${crypto.randomBytes(5).toString('hex')}`;
  const arr = HISTORY.get(root) || [];
  arr.push({id, createdAt:new Date().toISOString(), message:String(message||'').slice(0,200), changes});
  while (arr.length > MAX_HISTORY) arr.shift();
  HISTORY.set(root, arr);
  LAST_APPLIED.set(root,id);
  await persistHistory(root);
  return id;
}
async function rollbackHistory(root, item) {
  const conflicts=[];
  for (const c of item.changes) {
    const nowHash = await currentHash(root,c.path);
    if (nowHash !== c.newHash) conflicts.push({path:c.path,expected:c.newHash,current:nowHash});
  }
  if (conflicts.length) {
    const err = new Error('현재 파일이 변경되어 안전한 롤백을 중단했습니다. 먼저 충돌 파일을 확인하세요.');
    err.code='ROLLBACK_CONFLICT'; err.conflicts=conflicts; throw err;
  }
  for (const c of item.changes) {
    const p = safePath(root,c.path);
    if (c.old === null) await fs.rm(p,{force:true});
    else await writeFile(root,c.path,c.old);
  }
}
function git(root,args) {
  return new Promise(resolve=>execFile('git',args,{cwd:root,windowsHide:true,maxBuffer:12*1024*1024},(e,stdout,stderr)=>resolve({ok:!e,code:e?.code??0,stdout:clipOutput(String(stdout||''),MAX_GIT_OUTPUT),stderr:clipOutput(String(stderr||''),MAX_GIT_OUTPUT)})));
}
function clipOutput(value,limit=MAX_CMD_OUTPUT){ const s=String(value||''); return s.length<=limit ? s : s.slice(0,limit)+'\n… [출력 일부 생략]'; }
function run(root,cmd,args,timeout=120000) {
  return new Promise(resolve=>execFile(cmd,args,{cwd:root,windowsHide:true,maxBuffer:16*1024*1024,timeout},(e,stdout,stderr)=>resolve({ok:!e&&!e.killed,code:e?.code??0,stdout:clipOutput(stdout),stderr:clipOutput(stderr),timedOut:!!e?.killed})));
}
async function verifySupabaseToken(accessToken){
  if(!SUPABASE_URL || !SUPABASE_ANON_KEY) return {ok:false,why:'Local Agent의 Supabase 설정이 없습니다.'};
  if(!accessToken || accessToken.length<20) return {ok:false,why:'유효한 Supabase 세션 토큰이 없습니다.'};
  try{
    const r=await fetch(SUPABASE_URL + '/auth/v1/user',{headers:{Authorization:'Bearer '+accessToken,apikey:SUPABASE_ANON_KEY}});
    if(!r.ok) return {ok:false,why:'Supabase 로그인 세션이 만료됐습니다. 블로그에서 다시 로그인하세요.'};
    const u=await r.json();
    const email=String(u?.email||'').toLowerCase();
    if(ALLOWED_EMAILS.size && !ALLOWED_EMAILS.has(email)) return {ok:false,why:'이 계정은 Work Agent 사용 권한이 없습니다.'};
    return {ok:true,email};
  }catch(e){ return {ok:false,why:'Supabase 로그인 확인에 실패했습니다.'}; }
}
// 쿠키가 cross-site 로 막히는 환경(배포된 https 페이지 → http://127.0.0.1)을 위해
// 헤더 토큰도 함께 받는다. 토큰은 프로세스 메모리에만 존재하며 브라우저는 저장하지 않는다.
function sessionToken(req){ return String(req.headers['x-agent-token']||'').trim() || parseCookies(req)[SESSION_COOKIE] || ''; }
function sessionOf(req){ const token=sessionToken(req); const s=SESSIONS.get(token); if(!s)return null; const now=Date.now(); if(now-(s.createdAt||now)>SESSION_TTL || now-(s.lastSeenAt||s.createdAt||now)>SESSION_IDLE_TTL){SESSIONS.delete(token);return null;} s.lastSeenAt=now; return {token,...s}; }
function originAllowed(req) { return allowedOrigins().includes(req.headers.origin || ''); }
function auth(req,res) {
  if (!originAllowed(req)) { send(res,403,{error:'허용되지 않은 Work Origin입니다.',code:'ORIGIN_NOT_ALLOWED',origin:req.headers.origin||'',allowedOrigins:allowedOrigins()},req); return null; }
  const s=sessionOf(req);
  if(!s){ send(res,401,{error:'Local Agent 세션이 없습니다. Work를 새로고침하세요.'},req); return null; }
  return s;
}
async function sessionRootOk(session,root){ if(!session.root||!root)return true; const sameLogical=path.resolve(session.root)===path.resolve(root); if(!sameLogical)return false; const rr=await realRootPath(root); return !session.realRoot || rr===session.realRoot; }
function operationKey(session,root){ return `${session.email||'unknown'}::${path.resolve(root)}`; }
function acquireOp(key){ if(OP_LOCKS.has(key)) throw Object.assign(new Error('현재 이 프로젝트에서 다른 Work 작업이 실행 중입니다. 잠시 기다려주세요.'),{code:'OP_BUSY'}); OP_LOCKS.add(key); }
function releaseOp(key){ OP_LOCKS.delete(key); }

function purgeApprovals(){ const now=Date.now(); for(const [id,a] of APPROVALS){ if(now-a.createdAt>APPROVAL_TTL) APPROVALS.delete(id); } for(const [id,a] of SCRIPT_APPROVALS){ if(now-a.createdAt>APPROVAL_TTL) SCRIPT_APPROVALS.delete(id); } }
function createApproval(session,root,cmd,args){ purgeApprovals(); const id=crypto.randomBytes(18).toString('hex'); APPROVALS.set(id,{createdAt:Date.now(),token:session.token,email:session.email,root:path.resolve(root),cmd,args}); return id; }
function consumeApproval(session,root,approvalId,cmd,args){ purgeApprovals(); const a=APPROVALS.get(String(approvalId||'')); if(!a||a.token!==session.token||a.root!==path.resolve(root)||a.cmd!==cmd||JSON.stringify(a.args)!==JSON.stringify(args)) return false; APPROVALS.delete(String(approvalId)); return true; }
function createScriptApproval(session,root,paths){ const id=crypto.randomBytes(18).toString('hex'); SCRIPT_APPROVALS.set(id,{token:session.token,email:session.email,root:path.resolve(root),paths:[...paths].sort(),createdAt:Date.now()}); return id; }
function consumeScriptApproval(session,root,approvalId,paths){ const id=String(approvalId||''); const a=SCRIPT_APPROVALS.get(id); if(!a) return false; if(Date.now()-a.createdAt>APPROVAL_TTL){SCRIPT_APPROVALS.delete(id);return false;} const same=a.token===session.token && a.email===session.email && a.root===path.resolve(root) && JSON.stringify(a.paths)===JSON.stringify([...paths].sort()); if(same) SCRIPT_APPROVALS.delete(id); return same; }

async function main(req,res) {
  if (req.method === 'OPTIONS') return send(res,204,{},req);
  try {
    const url = new URL(req.url,`http://${HOST}:${PORT}`);
    if (url.pathname === '/health') return send(res,200,{ok:true,service:'sniper-local-agent',port:PORT,version:VERSION,auth:'supabase+cookie',approvalTTL:APPROVAL_TTL,rootBinding:'logical+realpath',features:{projectIndex:true,preconditionGuard:true,atomicWrite:true,audit:true,rollback:true,scriptWriteApproval:true},node:process.version,platform:process.platform,git:await git(process.cwd(),['--version']),sessions:SESSIONS.size},req);
    if (url.pathname === '/session' && req.method === 'POST') {
      if (!originAllowed(req)) return send(res,403,{error:'허용되지 않은 Work Origin입니다.',code:'ORIGIN_NOT_ALLOWED',origin:req.headers.origin||'',allowedOrigins:allowedOrigins()},req);
      const body=await readBody(req);
      const ver=await verifySupabaseToken(String(body.access_token||''));
      if(!ver.ok) return send(res,401,{error:ver.why},req);
      const old=sessionOf(req); if(old) SESSIONS.delete(old.token);
      const token=newSession(ver.email||null);
      return send(res,200,{ok:true,version:VERSION,email:ver.email||null,token,__setCookie:token},req);
    }
    if (url.pathname === '/session' && req.method === 'DELETE') {
      if (!originAllowed(req)) return send(res,403,{error:'허용되지 않은 Work Origin입니다.',code:'ORIGIN_NOT_ALLOWED',origin:req.headers.origin||'',allowedOrigins:allowedOrigins()},req);
      const sess=sessionOf(req); if(sess) SESSIONS.delete(sess.token);
      return send(res,200,{ok:true},req);
    }
    const session=auth(req,res);
    if (!session) return;
    const body = await readBody(req);
    const root = body.root ? await assertRoot(body.root) : null;
    if (!root) return send(res,400,{error:'root 경로가 필요합니다.'},req);
    if(!(await sessionRootOk(session,root))) return send(res,409,{error:'현재 Work 세션은 다른 프로젝트 또는 다른 실제 경로에 묶여 있습니다. 로그아웃/재로그인 후 다시 연결하세요.',code:'ROOT_LOCKED'},req);
    if(!session.root) { session.root=root; session.realRoot=await realRootPath(root); session.projectId=crypto.createHash('sha256').update(session.realRoot,'utf8').digest('hex').slice(0,16); await auditLog(root,{action:'bind-root',email:session.email||null,projectId:session.projectId}); }
    if(session.realRoot && await realRootPath(root)!==session.realRoot) return send(res,409,{error:'프로젝트 실제 경로가 변경되었습니다. 안전을 위해 세션을 다시 연결하세요.',code:'ROOT_REALPATH_CHANGED'},req);

    if (url.pathname === '/tree') return send(res,200,{files:await walk(root)},req);
    if (url.pathname === '/project-info') return send(res,200,await projectInfo(root),req);
    if (url.pathname === '/project-index' && req.method === 'POST') {
      const index=await projectIndex(root,body.paths);
      await auditLog(root,{action:'project-index',email:session.email||null,files:index.files.length,symbols:index.symbols.length});
      return send(res,200,{index},req);
    }
    if (url.pathname === '/search' && req.method === 'POST') {
      const results=await searchProject(root,body.query,body.paths);
      return send(res,200,{results},req);
    }
    if (url.pathname === '/fingerprints' && req.method === 'POST') { const paths=Array.isArray(body.paths)?body.paths.map(validateRel):[]; const out={}; for(const rel of paths){ const v=await existsText(root,rel); out[rel]=v===null?null:await sha256Text(v); } return send(res,200,{hashes:out},req); }
    if (url.pathname === '/diff-preview' && req.method === 'POST') {
      const changes=Array.isArray(body.changes)?body.changes:[];
      const out=[];
      for (const ch of changes.slice(0,100)) {
        const n=validateRel(ch.path); const before=(await existsText(root,n))??''; const after=String(ch.content??'');
        const a=before.split('\n'), b=after.split('\n');
        const max=Math.min(Math.max(a.length,b.length),1200), rows=[];
        let i=0;
        while(i<max){ if(a[i]===b[i]){rows.push({type:'ctx',line:i+1,text:a[i]??''});} else { if(i<a.length)rows.push({type:'del',line:i+1,text:a[i]??''}); if(i<b.length)rows.push({type:'add',line:i+1,text:b[i]??''}); } i++; if(rows.length>5000)break; }
        out.push({path:n,operation:ch.operation||'replace',rows,truncated:rows.length>=5000});
      }
      return send(res,200,{files:out},req);
    }
    if (url.pathname === '/read') {
      const paths = Array.isArray(body.paths) ? body.paths : [];
      if (paths.length > 150) throw new Error('한 번에 최대 150개 파일까지만 읽을 수 있습니다.');
      const files=[]; let total=0;
      for (const p of paths) { const n=validateRel(p); const content=await readFile(root,n); total += Buffer.byteLength(content); if (total>MAX_READ_TOTAL) break; files.push({path:n,content:redactForAi(content),redacted:looksSecretText(content)}); }
      return send(res,200,{files,truncated:files.length<paths.length},req);
    }
    if (url.pathname === '/apply') {
      const opKey=operationKey(session,root); acquireOp(opKey);
      try {
      const changes=Array.isArray(body.changes)?body.changes:[];
      if (!changes.length) return send(res,400,{error:'적용할 변경이 없습니다.'},req);
      if (changes.length>100) throw new Error('한 번에 최대 100개 변경까지만 적용할 수 있습니다.');
      const normalized=changes.map(ch=>({...ch,path:validateRel(ch.path),operation:ch.operation==='delete'?'delete':'replace'}));
      const scriptPaths=normalized.filter(ch=>ch.operation!=='delete' && NO_WRITE_EXT.test(ch.path)).map(ch=>ch.path);
      if(scriptPaths.length){
        const approvalId=String(body.scriptApprovalId||'');
        if(!consumeScriptApproval(session,root,approvalId,scriptPaths)){
          const issued=createScriptApproval(session,root,scriptPaths);
          return send(res,409,{error:'실행 가능한 스크립트 파일은 2차 승인이 필요합니다.',code:'SCRIPT_APPROVAL_REQUIRED',needsScriptApproval:true,scriptPaths,issuedScriptApprovalId:issued,approvalExpiresInMs:APPROVAL_TTL},req);
        }
      }
      if (normalized.some(ch=>ch.operation!=='delete' && Buffer.byteLength(String(ch.content??''),'utf8')>MAX_APPLY_FILE)) throw new Error('생성/수정 파일이 너무 큽니다.');
      // Safety: refuse mixing with pre-existing git changes unless explicitly allowed.
      const preconditions = body.preconditions && typeof body.preconditions==='object' ? body.preconditions : {};
      const preconditionMismatches=[];
      for (const ch of normalized) {
        if (!Object.prototype.hasOwnProperty.call(preconditions,ch.path)) continue;
        const now=await currentHash(root,ch.path);
        const expected=preconditions[ch.path] ?? null;
        if(now!==expected) preconditionMismatches.push({path:ch.path,expected,current:now});
      }
      if(preconditionMismatches.length) return send(res,409,{error:'AI가 읽은 이후 파일이 변경되었습니다. 변경된 파일을 다시 읽고 패치를 재생성하세요.',code:'PATCH_PRECONDITION_FAILED',conflicts:preconditionMismatches},req);
      const allowMixed = body.allowMixed === true;
      const statusBefore = await git(root,['status','--porcelain','--',...normalized.map(x=>x.path)]);
      if (!allowMixed && statusBefore.ok && statusBefore.stdout.trim()) {
        return send(res,409,{error:'AI 적용 대상 파일에 기존 Git 변경사항이 있습니다. 먼저 커밋/스태시하거나 "기존 변경과 섞어 적용"을 허용하세요.',dirty:statusBefore.stdout},req);
      }
      const snap=await captureChanges(root,normalized);
      try {
        for (const ch of normalized) {
          if (ch.operation==='delete') await fs.rm(safePath(root,ch.path),{force:true});
          else await writeFile(root,ch.path,String(ch.content??''));
        }
      } catch (e) {
        // Best-effort atomic recovery on partial failure.
        for (const s of snap) {
          try { if (s.old===null) await fs.rm(safePath(root,s.path),{force:true}); else await writeFile(root,s.path,s.old); } catch {}
        }
        throw new Error(`적용 중 실패하여 변경을 복구했습니다: ${e.message||e}`);
      }
      for (const s of snap) s.new = await existsText(root,s.path), s.newHash = s.new===null?null:await sha256Text(s.new);
      const id=await addHistory(root,snap,body.message||'AI patch');
      await auditLog(root,{action:'apply',email:session.email||null,historyId:id,paths:normalized.map(x=>x.path),mixed:allowMixed});
      return send(res,200,{ok:true,changed:normalized.length,historyId:id,paths:normalized.map(x=>x.path),mixed:allowMixed},req);
      } finally { releaseOp(opKey); }
    }
    if (url.pathname === '/history') {
      const items=(await loadHistory(root)).map(x=>({id:x.id,createdAt:x.createdAt,message:x.message,files:x.changes.length,canRollback:true}));
      return send(res,200,{items},req);
    }
    if (url.pathname === '/work-state' && req.method === 'GET') return send(res,200,await loadWorkState(root,session.email||'unknown'),req);
    if (url.pathname === '/audit' && req.method === 'GET') return send(res,200,{items:await readAudit(root)},req);
    if (url.pathname === '/work-state' && req.method === 'POST') return send(res,200,await saveWorkState(root,body.state||{},session.email||'unknown'),req);
    if (url.pathname === '/project-memory' && req.method === 'GET') return send(res,200,{memory:await loadProjectMemory(root)},req);
    if (url.pathname === '/project-memory' && req.method === 'POST') { const m=await saveProjectMemory(root,body.memory||{}); await auditLog(root,{action:'project-memory-save',email:session.email||null}); return send(res,200,{memory:m},req); }
    if (url.pathname === '/rollback') {
      const id=String(body.id||LAST_APPLIED.get(root)||'');
      const item=(await loadHistory(root)).find(x=>x.id===id);
      if (!item) throw new Error('해당 변경 기록을 찾지 못했습니다.');
      const requested = Array.isArray(body.paths)&&body.paths.length ? new Set(body.paths.map(validateRel)) : null;
      const subset = requested ? {...item,changes:item.changes.filter(c=>requested.has(c.path))} : item;
      const conflicts=[]; const safe=[];
      for(const c of subset.changes){ const nowHash=await currentHash(root,c.path); if(nowHash!==c.newHash) conflicts.push({path:c.path,expected:c.newHash,current:nowHash}); else safe.push(c); }
      if (body.partial && safe.length){ for(const c of safe){ const p=safePath(root,c.path); if(c.old===null) await fs.rm(p,{force:true}); else await writeFile(root,c.path,c.old); } }
      else if(conflicts.length){ return send(res,409,{error:'현재 파일이 변경된 항목은 롤백을 건너뛰었습니다.',code:'ROLLBACK_CONFLICT',conflicts,safePaths:safe.map(c=>c.path),partialAvailable:true},req); }
      else { for(const c of safe){ const p=safePath(root,c.path); if(c.old===null) await fs.rm(p,{force:true}); else await writeFile(root,c.path,c.old); } }
      LAST_APPLIED.set(root,''); await persistHistory(root);
      await auditLog(root,{action:'rollback',email:session.email||null,id,restored:safe.map(x=>x.path),skipped:conflicts.map(x=>x.path)});
      return send(res,200,{ok:true,restored:safe.length,skipped:conflicts.length,id,conflicts},req);
    }
    if (url.pathname === '/git/status') return send(res,200,{result:await git(root,['status','--short'])},req);
    if (url.pathname === '/git/diff') return send(res,200,{result:await git(root,['diff','--no-ext-diff','--unified=80'])},req);
    if (url.pathname === '/git/checkpoint') {
      const paths=Array.isArray(body.paths)?body.paths.map(validateRel):[];
      if (!paths.length) throw new Error('체크포인트 대상 파일이 없습니다.');
      const latest=(await loadHistory(root)).slice().reverse().find(x=>x.changes.some(c=>paths.includes(c.path)));
      if (latest && !body.allowMixed) {
        const mismatches=[];
        for (const rel of paths) {
          const ch=latest.changes.find(c=>c.path===rel);
          if (!ch) continue;
          const now=await currentHash(root,rel);
          if (now!==ch.newHash) mismatches.push(rel);
        }
        if(mismatches.length) throw new Error(`AI 적용 이후 추가 변경이 감지되었습니다. 섞어 커밋하지 않으려면 확인 후 allowMixed를 사용하세요: ${mismatches.join(', ')}`);
      }
      const add=await git(root,['add','--',...paths]);
      if (!add.ok) return send(res,200,{add,commit:{ok:false,code:add.code,stdout:'',stderr:'git add 실패'}},req);
      const msg=String(body.message||'sniper WORK checkpoint').slice(0,120);
      const commit=await git(root,['commit','-m',msg]);
      await auditLog(root,{action:'git-checkpoint',email:session.email||null,paths,message:msg,ok:commit.ok});
      return send(res,200,{add,commit,paths},req);
    }
    if (url.pathname === '/git/branch' && req.method === 'POST') {
      const name=String(body.name||'').trim().replace(/[^A-Za-z0-9._\/-]/g,'-');
      if(!name || name.length>80) throw new Error('브랜치 이름이 올바르지 않습니다.');
      const current=(await git(root,['rev-parse','--abbrev-ref','HEAD'])).stdout.trim();
      const existing=await git(root,['show-ref','--verify','--quiet',`refs/heads/${name}`]);
      if(existing.ok) return send(res,200,{ok:true,branch:name,created:false,current},req);
      const made=await git(root,['switch','-c',name]);
      await auditLog(root,{action:'git-branch',email:session.email||null,branch:name,ok:made.ok});
      return send(res,made.ok?200:400,{ok:made.ok,branch:name,created:made.ok,result:made},req);
    }
    if (url.pathname === '/run') {
      const cmd=String(body.cmd||'').trim(); const args=Array.isArray(body.args)?body.args.map(String):[];
      if (!ALLOWED_CMDS.has(cmd)) return send(res,400,{error:'허용되지 않은 명령입니다.'},req);
      if (cmd==='git'&&!ALLOWED_GIT.has(args[0])) return send(res,400,{error:'git run은 읽기 전용 명령만 허용됩니다.'},req);
      const sub = String(args[0]||'');
      const safeScript = new Set(['test','lint','build','typecheck','check','format:check','ci','preview','start']);
      const safe = (cmd==='git') || ((cmd==='npm'||cmd==='pnpm'||cmd==='yarn'||cmd==='bun') && ((sub==='test'&&args.length===1)|| (sub==='run'&&safeScript.has(String(args[1]||''))) || (cmd==='yarn'&&safeScript.has(sub)) || (cmd==='bun'&&sub==='test')));
      const risky = !safe || cmd==='npx' || cmd==='node';
      if(risky){
        const approvalId=String(body.approvalId||'');
        if(!consumeApproval(session,root,approvalId,cmd,args)){
          const created=createApproval(session,root,cmd,args);
          return send(res,409,{error:`보호된 명령(${[cmd,...args].join(' ')})은 실행 전 승인이 필요합니다.`,code:'COMMAND_APPROVAL_REQUIRED',command:[cmd,...args].join(' '),needsApproval:true,approvalId,issuedApprovalId:created,approvalExpiresInMs:APPROVAL_TTL},req);
        }
      }
      const bin={npm:process.platform==='win32'?'npm.cmd':'npm',npx:process.platform==='win32'?'npx.cmd':'npx',pnpm:process.platform==='win32'?'pnpm.cmd':'pnpm',yarn:process.platform==='win32'?'yarn.cmd':'yarn',node:process.execPath,git:'git'}[cmd];
      const timeout=Math.min(Math.max(Number(body.timeout)||120000,1000),300000);
      const result=await run(root,bin,args,timeout);
      await auditLog(root,{action:'run',email:session.email||null,command:[cmd,...args].join(' '),ok:result.ok,code:result.code});
      return send(res,200,{command:[cmd,...args].join(' '),result},req);
    }
    return send(res,404,{error:'not found'},req);
  } catch(e) {
    return send(res,400,{error:e.message||String(e)},req);
  }
}
http.createServer(main).listen(PORT,HOST,()=>{
  console.log(`sniper local agent ${VERSION}: http://${HOST}:${PORT}`);
  console.log(`Work origins: ${allowedOrigins().join(', ')}`);
  console.log('Agent token is per-process and available only to allowed Origins.');
});
