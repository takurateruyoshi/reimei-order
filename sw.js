// 一度開いたページをスマホに保存しておき、電波が弱い・圏外のときもすぐ開けるようにする。
// 自分のページ（画面・JS・CSS）は、つながるときは毎回最新を取りに行き、圏外や応答が遅いときだけ保存した物を出す。
// 版が決まっている部品・字体は保存した物を使う。注文のやりとり（Apps Script）は保存しない。
const CACHE = "reimei-v3";
const NET_WAIT = 4000;
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
  if (!isShell(url) || url.pathname.endsWith("/test.html") || url.searchParams.has("nocache")) return;
  const own = url.origin === location.origin;
  e.respondWith(
    caches.open(CACHE).then(async (c) => {
      const hit = () => c.match(req, { ignoreSearch: own });
      if (!own) {
        const h = await hit();
        if (h) return h;
        const r = await fetch(req);
        if (r.ok || r.type === "opaque") c.put(req, r.clone());
        return r;
      }
      // 自分のページ：最新を優先（HTTPの保存も通さない）。NET_WAIT 待っても来なければ保存した物
      const fresh = fetch(req, { cache: "no-cache" }).then((r) => { if (r.ok) c.put(req, r.clone()); return r; });
      const timeout = new Promise((ok) => setTimeout(ok, NET_WAIT));
      const first = await Promise.race([fresh.catch(() => null), timeout]);
      if (first) return first;
      return (await hit()) || fresh;
    })
  );
});
