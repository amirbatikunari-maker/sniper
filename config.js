/* ─────────────────────────────────────────────
   Supabase 값 (뷰어·업로더용)
   Supabase 대시보드 → Project Settings → API
   ⚠ service_role 키는 절대 넣지 말 것.

   Worker 주소 (PDF 변환용)
   기존에 쓰시던 주소 그대로입니다.
   ───────────────────────────────────────────── */
window.APP_CONFIG = {
  SUPABASE_URL: "https://nfyyctinvlytykucbgzk.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_tRyg8GTus9I2_wt-VSmaRA_6gbU-lt5",
  APP_TITLE: "기출 해설 노트",
  CONFIG_VERSION: "v228",

  WORKER_URL:        "https://gichul-ai.amirbatikunari.workers.dev",
  WORKER_BACKUP_URL: "",

// ... (아래쪽 생략) ...
  /* ─────────────────────────────────────────────
     AI 대화 상자
     ─────────────────────────────────────────────
     AI_WORKER_URL — 새로 배포한 AI 중계 Worker 주소.
       `npx wrangler deploy` 를 마치면 터미널에 찍히는 주소를 그대로 넣으세요.
       예: https://sniper-ai.amirbatikunari.workers.dev

     AI_APP_KEY — Worker 에 APP_KEY 시크릿을 등록했을 때만 채웁니다.
       ⚠ 이 값은 브라우저에서 보이므로 «비밀» 이 아닙니다.
         지나가던 사람이 주소만 알고 함부로 쓰는 걸 막는 문고리일 뿐,
         진짜 자물쇠는 Worker 의 ALLOWED_ORIGINS 입니다.

     AI_APP_NAME — 대화 기록을 앱별로 나눠 담는 이름표.
     ───────────────────────────────────────────── */
AI_WORKER_URL: "https://gichul-ai.amirbatikunari.workers.dev",
/* APP_KEY는 공개 소스에 넣지 않습니다. Worker 시크릿으로만 관리하세요. */
AI_APP_KEY: "",
  ADMIN_EMAILS:  ["amirbatikunari@gmail.com"],
  AI_APP_NAME:   "viewer",

  /* 해설 배치(explain-batch.html)가 쓰는 주소. 위 워커와 같은 곳입니다. */
  CLAUDE_WORKER_URL: "https://gichul-ai.amirbatikunari.workers.dev",
  CLAUDE_APP_KEY:    "",

  /* AI 를 쓸 수 있는 계정. AI 는 물어볼 때마다 요금이 붙으므로
     로그인한 사람만 쓰게 막아 둡니다.
     ⚠ 이 목록은 «화면을 잠그는» 용도일 뿐입니다.
       실제 차단은 Worker 의 REQUIRE_AUTH / ALLOWED_EMAILS 가 합니다.
     비워 두면 «로그인한 사람이면 누구나» 가 됩니다. */
  AI_ALLOWED_EMAILS: ["amirbatikunari@gmail.com"],
};

/* 오프라인/외부 CDN 차단 대비: supabase-js가 늦거나 내려가도 화면 자체는 살아 있게 둡니다.
   실제 Supabase 라이브러리가 로드되면 이 대체 객체는 만들지 않습니다. */
(function ensureSupabaseFallback(){
  if (window.supabase || !window.APP_CONFIG?.SUPABASE_URL) return;
  const offlineError = { message:'Supabase 라이브러리를 사용할 수 없습니다. 오프라인 상태에서는 화면과 로컬 기능만 사용할 수 있습니다.', code:'SUPABASE_OFFLINE' };
  const query = () => {
    const q = {
      select(){return q}, insert(){return q}, update(){return q}, upsert(){return q}, delete(){return q}, eq(){return q}, neq(){return q}, in(){return q}, or(){return q}, and(){return q}, ilike(){return q}, order(){return q}, limit(){return q}, range(){return q}, single(){return Promise.resolve({data:null,error:offlineError})}, maybeSingle(){return Promise.resolve({data:null,error:offlineError})},
      then(resolve,reject){ return Promise.resolve({data:null,error:offlineError}).then(resolve,reject) }, catch(reject){ return Promise.resolve({data:null,error:offlineError}).catch(reject) }
    };
    return q;
  };
  window.supabase = {
    createClient(){
      return {
        auth:{
          async getSession(){return {data:{session:null},error:offlineError}},
          async getUser(){return {data:{user:null},error:offlineError}},
          async signInWithPassword(){return {data:null,error:offlineError}},
          async signUp(){return {data:null,error:offlineError}},
          async signOut(){return {error:offlineError}},
          onAuthStateChange(){return {data:{subscription:{unsubscribe(){}}}}}
        },
        from(){return query()},
        storage:{from(){return {upload:async()=>({data:null,error:offlineError}),download:async()=>({data:null,error:offlineError}),remove:async()=>({data:null,error:offlineError}),list:async()=>({data:[],error:offlineError})}}}
      };
    }
  };
})();
