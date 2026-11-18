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

// 時間帯（15分ごと、日本時間）の名前。例 "2026-11-21 10:15"
const bucketOf = (t) => {
  const d = new Date(t + 9 * 3600e3);
  const m = d.getUTCMinutes();
  return d.toISOString().slice(0, 10) + " " + String(d.getUTCHours()).padStart(2, "0") + ":" + String(m - (m % 15)).padStart(2, "0");
};
const STATS_EVERY = 120000;   // 2分ごとにまとめてスプレッドシートに書く

export class Hub {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.stats = new Map();   // 時間帯 → { opens: 画面を開いた回数, orders: 注文数, vids: 利用者（端末）の集まり }
    this.dirty = new Set();   // まだ書いていない時間帯
    this.queue = [];          // まだ送っていない注文 { p, done }
    this.timer = null;
    this.sending = false;
    this.memo = {};           // action → { at, text }
    this.inflight = {};       // action → Promise<text>
  }

  async fetch(req) {
    const body = await req.text();
    const p = JSON.parse(body);
    const vid = typeof p.vid === "string" ? p.vid.slice(0, 20) : "";
    if (p.action === "order") {
      const r = await this.enqueue(p);
      if (!r.error) this.record("order", vid);
      return json(JSON.stringify(r));
    }
    if (p.action === "state") this.record("open", vid);
    return json(await this.read(p.action, body));
  }

  // ---------- 時間帯ごとの利用者数の記録（名前や学籍番号は持たない。端末ごとのでたらめな番号だけ） ----------
  record(kind, vid) {
    const b = bucketOf(Date.now());
    let s = this.stats.get(b);
    if (!s) { s = { opens: 0, orders: 0, vids: new Set() }; this.stats.set(b, s); }
    if (kind === "open") s.opens++;
    if (kind === "order") s.orders++;
    if (vid) s.vids.add(vid);
    this.dirty.add(b);
    this.state.storage.getAlarm().then((a) => { if (a == null) this.state.storage.setAlarm(Date.now() + STATS_EVERY); }).catch(() => {});
  }
  async alarm() {
    if (!this.env.STATS_KEY || !this.dirty.size) return;
    const rows = [...this.dirty].map((b) => { const s = this.stats.get(b); return [b, s.opens, s.vids.size, s.orders]; });
    this.dirty.clear();
    try {
      const t = await toGas(this.env, JSON.stringify({ action: "stats", key: this.env.STATS_KEY, rows }));
      if (JSON.parse(t).error) throw new Error(t);
    } catch {
      rows.forEach((r) => this.dirty.add(r[0]));   // 書けなかったら次の回にもう一度
      this.state.storage.setAlarm(Date.now() + STATS_EVERY);
    }
    // 古い時間帯は捨てる（今日と昨日の分だけ残す）
    const keep = bucketOf(Date.now() - 86400e3).slice(0, 10);
    for (const b of this.stats.keys()) if (b.slice(0, 10) < keep) this.stats.delete(b);
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
      // スタッフ（店頭）の注文は、待っているモバイルの注文より先に送る（次のまとまりの先頭に入れる）
      if (p.asStaff) {
        const i = this.queue.findIndex((x) => !x.p.asStaff);
        this.queue.splice(i < 0 ? this.queue.length : i, 0, { p, done });
      } else this.queue.push({ p, done });
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
