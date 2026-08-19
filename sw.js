/* 앱 껍데기는 캐시, 글 내용은 네트워크 우선.
   새로 배포하면 바로 반영되도록 HTML 은 항상 네트워크를 먼저 본다. */
const SHELL = "sniper-shell-v3";
const FILES = ["./","./index.html","./post.html","./write.html",
               "./style.css","./app.js","./config.js","./ai-chat.js","./ai-plus.js","./music.js",
               "./manifest.json","./icon.svg"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== SHELL).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  if(e.request.method !== "GET") return;
  const url = new URL(e.request.url);

  // Supabase 조회·AI 중계는 캐시하지 않는다
  if(url.pathname.includes("/rest/v1/") || url.pathname.includes("/ai/")) return;
  if(url.hostname.includes("supabase")) return;

  const isHTML = e.request.mode === "navigate" || url.pathname.endsWith(".html")
                 || url.pathname === "/" || url.pathname.endsWith("/");
  if(isHTML && url.origin === location.origin){
    e.respondWith(fetch(e.request)
      .then(r => { if(r.ok) caches.open(SHELL).then(c => c.put(e.request, r.clone())); return r; })
      .catch(() => caches.match(e.request).then(hit => hit || caches.match("./index.html"))));
    return;
  }

  e.respondWith(caches.match(e.request).then(hit => {
    if(hit) return hit;
    return fetch(e.request).then(r => {
      if(r.ok && (url.origin === location.origin || url.host.includes("jsdelivr")))
        caches.open(SHELL).then(c => c.put(e.request, r.clone()));
      return r;
    }).catch(() => new Response("", { status: 504 }));
  }));
});
