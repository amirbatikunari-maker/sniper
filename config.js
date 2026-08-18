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

  /* AI 중계 Worker — `npx wrangler deploy` 하면 나오는 주소 */
  AI_WORKER_URL: "https://sniper.amirbatikunari.workers.dev/",     // 예: https://sniper-ai.amirbatikunari.workers.dev
  AI_APP_KEY:    "",     // Worker 에 APP_KEY 를 등록했을 때만
  AI_APP_NAME:   "blog",

  /* 글쓰기·설정 화면을 열 수 있는 계정(Supabase Authentication 에 만든 이메일).
     AI 대화도 같은 계정으로 잠깁니다 — 물어볼 때마다 요금이 붙기 때문입니다.
     비워 두면 «로그인한 사람이면 누구나» 쓸 수 있게 됩니다.
     ⚠ 이건 화면을 잠그는 용도이고, 실제 차단은 Worker 가 합니다. */
  ADMIN_EMAILS: ["amirbatikunari@gmail.com"],
};
