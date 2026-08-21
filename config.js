/* ═══════════════════════════════════════════════════════════════
   sniper — 설정값 한 곳
   ───────────────────────────────────────────────────────────────
   ⚠ 여기 적는 값은 브라우저 소스에서 그대로 보입니다.
     GPT · Gemini 키는 «절대» 여기 넣지 마세요. 그건 Worker 몫입니다.
     Supabase 의 publishable/anon 키는 원래 공개용이라 괜찮습니다.
   ═══════════════════════════════════════════════════════════════ */
window.APP_CONFIG = {
  SITE_TITLE: "sniper",

  SUPABASE_URL:      "https://nfyyctinvlytykucbgzk.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_tRyg8GTus9I2_wt-VSmaRA_6gbU-lt5",

  /* AI 중계 Worker 주소 — 블로그 화면(sniper)이 아니라
     «sniper-ai» Worker 의 주소입니다. 둘을 헷갈리면 AI 가 통째로 안 됩니다. */
  AI_WORKER_URL: "https://sniper-ai.amirbatikunari.workers.dev",
  /* APP_KEY는 공개 소스에 넣지 않습니다. Worker에서 자체적으로 관리하세요. */
  AI_APP_KEY:    "",
  AI_APP_NAME:   "blog",

  /* 글쓰기·설정 화면을 열 수 있는 계정(Supabase Authentication 에 만든 이메일).
     AI 대화도 같은 계정으로 잠깁니다 — 물어볼 때마다 요금이 붙기 때문입니다.
     비워 두면 «로그인한 사람이면 누구나» 쓸 수 있게 됩니다.
     ⚠ 이건 화면을 잠그는 용도이고, 실제 차단은 Worker 가 합니다. */
  ADMIN_EMAILS: ["amirbatikunari@gmail.com"],
};

/* supabase-js 를 못 불러왔을 때 쓰는 대체 객체 (뷰어와 같은 방식).
   오프라인이나 CDN 차단 상황에서 화면 전체가 멈추지 않도록 «조용히 실패» 합니다. */
window.makeOfflineSupabase = function (label) {
  const err = { message: "서버에 연결할 수 없습니다. 인터넷 연결을 확인하세요.", offline: true };
  const chain = () => new Proxy({}, {
    get(_t, k) {
      if (k === "then") return (resolve) => resolve({ data: null, error: err });
      if (k === "catch" || k === "finally") return () => chain();
      return () => chain();
    }
  });
  const fail = async () => ({ data: null, error: err });
  console.warn("[" + (label || "app") + "] supabase-js 를 불러오지 못했습니다. 서버 기능 없이 동작합니다.");
  return {
    __offline: true,
    auth: {
      getSession:         async () => ({ data: { session: null }, error: null }),
      getUser:            async () => ({ data: { user: null }, error: null }),
      signInWithPassword: fail,
      signUp:             fail,
      signOut:            async () => ({ error: null }),
      onAuthStateChange:  () => ({ data: { subscription: { unsubscribe() {} } } })
    },
    from: () => chain(),
    rpc:  () => chain(),
    storage: {
      from: () => ({
        upload: fail, remove: fail, download: fail,
        createSignedUrl: fail, getPublicUrl: () => ({ data: { publicUrl: "" } })
      })
    }
  };
};
