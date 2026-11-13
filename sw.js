// 一度開いたページをスマホに保存しておき、電波が弱い・圏外のときもすぐ開けるようにする。
// 画面の部品は「保存してある物をすぐ出し、裏で最新に入れかえる」。注文のやりとり（Apps Script）は保存しない。
const CACHE = "reimei-v1";
const SHELL = [
  "./", "index.html", "staff.html", "pickup.html", "privacy.html",
  "css/style.css",
  "js/config.js", "js/api.js", "js/ui.js", "js/scan.js", "js/customer.js", "js/staff.js", "js/pickup.js", "js/menu-snapshot.js",
  "https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => Promise.allSettled(SHELL.map((u) => c.add(u)))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

const isShell = (url) =>
  url.origin === location.origin ||
  /^(cdn\.jsdelivr\.net|unpkg\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)$/.test(url.hostname);

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (!isShell(url) || url.pathname.endsWith("/test.html")) return;
  e.respondWith(
    caches.open(CACHE).then(async (c) => {
      const hit = await c.match(req, { ignoreSearch: url.origin === location.origin });
      const fresh = fetch(req).then((r) => { if (r.ok || r.type === "opaque") c.put(req, r.clone()); return r; });
      if (hit) { e.waitUntil(fresh.catch(() => {})); return hit; }
      return fresh;
    })
  );
});
