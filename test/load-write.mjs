// 書き込みの負荷テスト：注文を実際に送る。テスト用の学籍番号（99xxxxx）で入れるので、終わったらシートから消すこと。
// 使い方: node load-write.mjs <URL> <人数> <秒(0=同時)> <受け取り時間> <コード> <学籍番号の開始>
const [URL_, N_, SPREAD_, SLOT, CODE, SID0_] = process.argv.slice(2);
const N = +N_, SPREAD = +SPREAD_, SID0 = +SID0_;
const newId = () => "lt" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
async function post(body) {
  const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), 60000);
  try {
    const r = await fetch(URL_, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(body), signal: ctrl.signal });
    const t = await r.text();
    if (!t.startsWith("{")) return { error: "html " + r.status };
    return JSON.parse(t);
  } catch (e) { return { error: "net:" + (e.name === "AbortError" ? "timeout60s" : "fail") }; } finally { clearTimeout(to); }
}
const res = [];
await Promise.all(Array.from({ length: N }, async (_, i) => {
  await new Promise((r) => setTimeout(r, SPREAD ? (i / N) * SPREAD * 1000 : 0));
  const body = { action: "order", clientId: newId(), items: [{ code: CODE, qty: 1 }], slot: SLOT, studentId: String(SID0 + i) };
  const t0 = Date.now();
  let d = await post(body), tries = 1;
  // アプリと同じ：通信の失敗と「混み合っている」（順番待ちの時間切れ・同時実行が多すぎ）は、同じ番号（clientId）で送り直す
  const again = (e) => e && (e.startsWith("net:") || e.startsWith("html") || /ロック|lock|同時に実行中/i.test(e));
  while (again(d.error) && tries < 60) { await new Promise((r) => setTimeout(r, 2000 + Math.random() * 3000)); d = await post(body); tries++; }
  res.push({ ok: !d.error, err: d.error, no: d.no, ms: Date.now() - t0, tries });
}));
const ok = res.filter((r) => r.ok), ms = ok.map((r) => r.ms).sort((a, b) => a - b);
const q = (p) => (ms.length ? ms[Math.min(ms.length - 1, Math.floor(ms.length * p))] : null);
const errs = {}; res.filter((r) => !r.ok).forEach((r) => (errs[r.err] = (errs[r.err] || 0) + 1));
const nos = ok.map((r) => r.no);
console.log(JSON.stringify({ n: N, spreadSec: SPREAD, slot: SLOT, ok: ok.length, errs, p50: q(.5), p90: q(.9), max: ms.at(-1) ?? null, retried: res.filter((r) => r.tries > 1).length, maxTries: Math.max(...res.map((r) => r.tries)), dupNo: nos.length - new Set(nos).size }));
