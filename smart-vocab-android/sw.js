/* 오프라인 동작용 서비스 워커.
 * 앱 파일을 고친 뒤 올릴 때는 아래 VERSION 숫자만 올리면 폰에 '업데이트' 안내가 뜹니다. */
const VERSION = "sv-4.7.0";
const FILES = [
  "./", "./index.html", "./core.js", "./app.js", "./manifest.webmanifest",
  "./icons/icon-192.png", "./icons/icon-512.png", "./icons/maskable-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (e) => { if (e.data === "skipWaiting") self.skipWaiting(); });

// 캐시 우선 → 없으면 네트워크 (단어장 데이터는 IndexedDB에 있으므로 여기와 무관)
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request))
  );
});
