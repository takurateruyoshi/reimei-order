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
    // 死活監視用：Cloudflare → Apps Script → シート まで通るか確かめる（UptimeRobot などが5分ごとに開く）
    // 通れば「OK reimei」（200）、どこかで止まっていれば「NG」（503）
    if (req.method === "GET" && new URL(req.url).pathname === "/health") {
      try {
        const d = JSON.parse(await toGas(env, JSON.stringify({ action: "state" })));
        if (d.error || !Array.isArray(d.menu) || !d.menu.length) throw new Error("bad");
        return new Response("OK reimei", { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
      } catch {
        return new Response("NG", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
      }
    }
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
      if (!r.error) await this.record("order", vid);
      return json(JSON.stringify(r));
    }
    if (p.action === "state") await this.record("open", vid);
    return json(await this.read(p.action, body));
  }

  // ---------- 時間帯ごとの利用者数の記録（名前や学籍番号は持たない。端末ごとのでたらめな番号だけ） ----------
  // 中継サーバーはしばらく使われないと眠って中身を忘れるので、数は保存領域（storage）に書いておく
  async record(kind, vid) {
    try {
      const st = this.state.storage;
      const b = bucketOf(Date.now()), k = "s:" + b;
      const s = (await st.get(k)) || { opens: 0, orders: 0, vids: [] };
      if (kind === "open") s.opens++;
      if (kind === "order") s.orders++;
      if (vid && !s.vids.includes(vid)) s.vids.push(vid);
      const dirty = (await st.get("dirty")) || [];
      if (!dirty.includes(b)) dirty.push(b);
      await st.put({ [k]: s, dirty });
      if ((await st.getAlarm()) == null) await st.setAlarm(Date.now() + STATS_EVERY);
    } catch {}
  }
  async alarm() {
    const st = this.state.storage;
    const dirty = (await st.get("dirty")) || [];
    if (!this.env.STATS_KEY || !dirty.length) return;
    const rows = [];
    for (const b of dirty) { const s = await st.get("s:" + b); if (s) rows.push([b, s.opens, s.vids.length, s.orders]); }
    try {
      const t = await toGas(this.env, JSON.stringify({ action: "stats", key: this.env.STATS_KEY, rows }));
      if (JSON.parse(t).error) throw new Error(t);
      const left = ((await st.get("dirty")) || []).filter((b) => !dirty.includes(b) || b === bucketOf(Date.now()));
      await st.put("dirty", left);
    } catch {
      await st.setAlarm(Date.now() + STATS_EVERY);   // 書けなかったら次の回にもう一度
      return;
    }
    // 古い時間帯は捨てる（昨日より前）
    const keep = bucketOf(Date.now() - 86400e3).slice(0, 10);
    const all = await st.list({ prefix: "s:" });
    const old = [...all.keys()].filter((k) => k.slice(2, 12) < keep);
    if (old.length) await st.delete(old);
    if (((await st.get("dirty")) || []).length) await st.setAlarm(Date.now() + STATS_EVERY);
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
