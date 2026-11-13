// 読み取りだけの負荷テスト：N台のスマホが2秒ごとに「変更あった？」を聞き続ける状態を再現（シートには何も書かない）
const URL_ = process.argv[2], N = +process.argv[3] || 30, SEC = +process.argv[4] || 60, EVERY = +process.argv[5] || 2000;
const lat = []; let ok = 0, ng = 0; const errs = {};
async function one() {
  const t = Date.now();
  try {
    const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), 20000);
    const r = await fetch(URL_, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ action: "rev" }), signal: ctrl.signal });
    clearTimeout(to);
    const d = await r.json();
    if (d.error) throw new Error(d.error);
    ok++; lat.push(Date.now() - t);
  } catch (e) { ng++; const k = String(e.message || e).slice(0, 60); errs[k] = (errs[k] || 0) + 1; }
}
const end = Date.now() + SEC * 1000;
await Promise.all(Array.from({ length: N }, async (_, i) => {
  await new Promise((r) => setTimeout(r, Math.random() * EVERY));
  while (Date.now() < end) { const t = Date.now(); await one(); await new Promise((r) => setTimeout(r, Math.max(0, EVERY - (Date.now() - t)))); }
}));
lat.sort((a, b) => a - b); const q = (p) => lat[Math.floor(lat.length * p)] ?? "-";
console.log(JSON.stringify({ clients: N, every: EVERY, sec: SEC, ok, ng, rate: (ok / (ok + ng) * 100).toFixed(1) + "%", p50: q(.5), p90: q(.9), p99: q(.99), max: lat.at(-1), errs }));
