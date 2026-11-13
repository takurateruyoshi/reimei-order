// 同じ内容の通信を「間隔をあけて」または「同時に」送り、かかった時間と返事をまとめる
// 使い方: node time-calls.mjs <URL> <回数> <間隔ms(0=同時)> '<JSONの本体。{i} は番号に置きかわる>'
const [URL_, N_, GAP_, BODY] = process.argv.slice(2);
const N = +N_, GAP = +GAP_;
async function one(i) {
  const t = Date.now();
  try {
    const r = await fetch(URL_, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: BODY.replaceAll("{i}", String(i)).replaceAll("{r}", Math.random().toString(36).slice(2, 10)) });
    const x = await r.text();
    const d = x.startsWith("{") ? JSON.parse(x) : { error: "html " + r.status };
    return { ms: Date.now() - t, res: d.error ? "err:" + d.error.slice(0, 24) : "ok" };
  } catch (e) { return { ms: Date.now() - t, res: "net" }; }
}
const out = [];
if (GAP) for (let i = 0; i < N; i++) { out.push(await one(i)); await new Promise((r) => setTimeout(r, GAP)); }
else out.push(...(await Promise.all(Array.from({ length: N }, (_, i) => one(i)))));
const ms = out.map((o) => o.ms).sort((a, b) => a - b), by = {};
out.forEach((o) => (by[o.res] = (by[o.res] || 0) + 1));
console.log(JSON.stringify({ n: N, gap: GAP, p50: ms[Math.floor(N / 2)], min: ms[0], max: ms.at(-1), by }));
