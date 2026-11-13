// 黎明祭モバイルオーダーの中継サーバー。
// ・注文：同じ瞬間に届いた注文をまとめて1回で Apps Script に送る（順番待ちとシートへの書き込みが1回で済む）
// ・メニューの残り（state）と更新番号（rev）：短い間だけ覚えておき、同時に来た問い合わせを1回にまとめる
// ・それ以外：そのまま Apps Script に渡す
const WINDOW_MS = 300;      // 最初の注文が届いてから、まとめて送るまで待つ時間
const MAX_BATCH = 50;       // 1回に送る注文の数
const TTL = { state: 2000, rev: 1000 };
const BUSY = { error: "混み合っています（lock）" };   // アプリはこの言葉を見て自動で送り直す

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
const json = (text, status = 200) => new Response(text, { status, headers: { "Content-Type": "application/json; charset=utf-8", ...CORS } });

async function toGas(env, body) {
  const r = await fetch(env.GAS_URL, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body, redirect: "follow" });
  const text = await r.text();
  if (!text.startsWith("{")) throw new Error("gas " + r.status);   // Google の混雑ページなど
  return text;
}

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (req.method !== "POST") return json(JSON.stringify({ ok: true, relay: true }));
    const body = await req.text();
    let p;
    try { p = JSON.parse(body); } catch { return json(JSON.stringify({ error: "bad" }), 400); }
    if (p.action === "order" || p.action in TTL) {
      const hub = env.HUB.get(env.HUB.idFromName("main"));
      return hub.fetch("https://hub/", { method: "POST", body });
    }
    try { return json(await toGas(env, body)); } catch { return json(JSON.stringify(BUSY)); }
  },
};

export class Hub {
  constructor(state, env) {
    this.env = env;
    this.queue = [];          // まだ送っていない注文 { p, done }
    this.timer = null;
    this.sending = false;
    this.memo = {};           // action → { at, text }
    this.inflight = {};       // action → Promise<text>
  }

  async fetch(req) {
    const body = await req.text();
    const p = JSON.parse(body);
    if (p.action === "order") return json(JSON.stringify(await this.enqueue(p)));
    return json(await this.read(p.action, body));
  }

  // ---------- 読み出し：同時に来た問い合わせは1回にまとめ、短い間は覚えておく ----------
  async read(action, body) {
    const m = this.memo[action];
    if (m && Date.now() - m.at < TTL[action]) return m.text;
    if (!this.inflight[action]) {
      this.inflight[action] = toGas(this.env, body)
        .then((text) => { this.memo[action] = { at: Date.now(), text }; return text; })
        .catch(() => JSON.stringify(BUSY))
        .finally(() => { delete this.inflight[action]; });
    }
    return this.inflight[action];
  }

  // ---------- 注文：少し待って、まとめて送る ----------
  enqueue(p) {
    delete p.action;
    return new Promise((done) => {
      this.queue.push({ p, done });
      if (!this.timer && !this.sending) this.timer = setTimeout(() => this.flush(), WINDOW_MS);
    });
  }

  async flush() {
    this.timer = null;
    if (this.sending || !this.queue.length) return;
    this.sending = true;
    const batch = this.queue.splice(0, MAX_BATCH);
    try {
      const text = await toGas(this.env, JSON.stringify({ action: "orderBatch", orders: batch.map((b) => b.p) }));
      const d = JSON.parse(text);
      if (d.error || !Array.isArray(d.results)) batch.forEach((b) => b.done(d.error ? { error: d.error } : BUSY));
      else batch.forEach((b, i) => b.done(d.results[i] || BUSY));
      this.memo = {};   // 残りの数が変わったので、覚えていたメニューは捨てる
    } catch {
      batch.forEach((b) => b.done(BUSY));   // 届かなかったときはアプリが同じ番号で送り直す（二重にならない）
    } finally {
      this.sending = false;
      // 送っている間に届いた注文は、すぐ次のまとまりとして送る
      if (this.queue.length) this.flush();
    }
  }
}
