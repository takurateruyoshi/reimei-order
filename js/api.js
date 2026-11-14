// サーバー（Apps Script）とのやりとり。API_URL が無ければブラウザ内のデモサーバーを使う。
import { API_URL, RELAY_URL, GOOGLE_CLIENT_ID, STUDENT_DOMAIN } from "./config.js";

export const DEMO = !API_URL || new URLSearchParams(location.search).has("demo");

// 通信できなかったとき（電波なし・タイムアウト）は err.network = true になる
const netError = () => Object.assign(new Error("network"), { network: true });
const BUSY = /ロック|lock|同時に実行中|too many/i;
export async function call(action, payload = {}) {
  if (DEMO) {
    if (!navigator.onLine) throw netError();
    return demoCall(action, payload);
  }
  let d;
  for (let i = 0; ; i++) {
    try {
      d = await post(action, payload);
    } catch {
      throw netError();
    }
    // 注文が重なって順番待ちが時間切れになったとき（サーバーが混んでいるとき）は、少し待って同じ内容を送り直す。
    // 注文には番号（clientId）が付いているので、二重にはならない
    if (!BUSY.test(d.error || "")) break;
    if (i >= 2) throw Object.assign(netError(), { busy: true });
    await new Promise((ok) => setTimeout(ok, 1500 + Math.random() * 2500));
  }
  if (d.error) throw new Error(d.error);
  if (action === "state") saveState(d);
  return d;
}

// 1回送る。まず中継サーバーへ。中継に届かない・返事がおかしいときは、そのまま Apps Script に直接送り、
// しばらく（2分）は中継を使わない。注文には番号（clientId）が付いているので、両方に届いても二重にはならない
let relayOffUntil = 0;
async function post(action, payload) {
  const body = JSON.stringify({ action, ...payload });
  if (RELAY_URL && Date.now() > relayOffUntil) {
    try {
      return await send(RELAY_URL, body, 30000);
    } catch {
      const d = await send(API_URL, body, 30000);   // ここでも届かなければ電波がない（中継のせいではない）
      relayOffUntil = Date.now() + 120000;
      return d;
    }
  }
  return send(API_URL, body, 30000);
}
async function send(url, body, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body, signal: ctrl.signal });
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

// 最後に読んだメニューなどを覚えておき、次に開いたときはまずそれを出す（そのあとすぐ最新に入れかえる）
const STATE_KEY = "reimei-order-state";
function saveState(d) { try { localStorage.setItem(STATE_KEY, JSON.stringify(d)); } catch {} }
export function cachedState() { try { return JSON.parse(localStorage.getItem(STATE_KEY)); } catch { return null; } }
// ms ごとに「更新番号」だけ確かめ、変わったときに onChange を呼ぶ（画面が隠れている間は止める）
export function watchRev(onChange, ms = 2000) {
  let last = null, busy = false;
  const tick = async () => {
    if (busy || document.hidden) return;
    busy = true;
    try {
      const { rev } = await call("rev");
      if (last !== null && rev !== last) await onChange();
      last = rev;
    } catch {} finally { busy = false; }
  };
  tick();
  setInterval(tick, ms);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { last = null; onChange(); tick(); } });
}
export const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => (b % 36).toString(36)).join("") + Date.now().toString(36).slice(-4);

// ---------- Googleログイン ----------
const TOKEN_KEY = "reimei-order-token";
const jwtExp = (t) => {
  try { return JSON.parse(atob(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).exp * 1000; } catch { return 0; }
};
export function savedToken() {
  try {
    const t = sessionStorage.getItem(TOKEN_KEY);
    if (!t) return null;
    if (t.startsWith("demo:")) return t;
    return jwtExp(t) > Date.now() + 60000 ? t : null;
  } catch { return null; }
}
export function saveToken(t) {
  try { t ? sessionStorage.setItem(TOKEN_KEY, t) : sessionStorage.removeItem(TOKEN_KEY); } catch {}
}

// スタッフの合言葉（QRを読み取るスマホでも使えるよう localStorage に置く）
const STAFF_KEY = "reimei-order-staff";
export function savedStaffKey() {
  try { return localStorage.getItem(STAFF_KEY); } catch { return null; }
}
export function saveStaffKey(k) {
  try { k ? localStorage.setItem(STAFF_KEY, k) : localStorage.removeItem(STAFF_KEY); } catch {}
}

let gisLoaded = null;
function loadGis() {
  gisLoaded ??= new Promise((ok, ng) => {
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.onload = ok;
    s.onerror = ng;
    document.head.append(s);
  });
  return gisLoaded;
}

// el の中にGoogleのログインボタンを出す。ログインできたら onToken(idToken)
// Googleログインは、別ウィンドウではなく同じ画面でGoogleのページへ移り、選んだら戻ってくる方式。
// （スマホやLINEの中のブラウザでは、別ウィンドウ方式だとアカウントを選んだあと白い画面で止まることがあるため）
const NONCE_KEY = "reimei-order-nonce";
const backURL = () => location.origin + location.pathname.replace(/index\.html$/, "");
let pendingToken = null;
(function takeRedirectToken() {
  if (!location.hash.includes("id_token=")) return;
  const h = new URLSearchParams(location.hash.slice(1));
  const t = h.get("id_token");
  history.replaceState(null, "", location.pathname + location.search);
  let nonce = null;
  try { nonce = sessionStorage.getItem(NONCE_KEY); sessionStorage.removeItem(NONCE_KEY); } catch {}
  try {
    const p = JSON.parse(atob(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    if (nonce && p.nonce === nonce) pendingToken = t;
  } catch {}
})();
// Googleから戻ってきたときのトークン（1回だけ取り出せる）
export function popRedirectToken() { const t = pendingToken; pendingToken = null; return t; }

function goGoogle(student) {
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("");
  try { sessionStorage.setItem(NONCE_KEY, nonce); } catch {}
  const q = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID, redirect_uri: backURL(), response_type: "id_token",
    scope: "openid email", nonce, prompt: "select_account",
  });
  if (student) q.set("hd", STUDENT_DOMAIN);
  location.href = "https://accounts.google.com/o/oauth2/v2/auth?" + q;
}

// el の中に「Googleでログイン」ボタンを出す。ログインできたら onToken(idToken)。
// beforeLeave は Googleのページへ移る直前に呼ぶ（カートなどを覚えておくため）
export async function renderGoogleButton(el, { student, onToken, beforeLeave }) {
  el.innerHTML = "";
  const b = document.createElement("button");
  b.type = "button";
  b.className = "gbtn google";
  b.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.7z"/><path fill="#34A853" d="M12 24c3.2 0 6-1.1 7.9-2.9l-3.9-3c-1.1.7-2.4 1.2-4 1.2-3.1 0-5.7-2.1-6.6-4.9h-4v3.1A12 12 0 0 0 12 24z"/><path fill="#FBBC05" d="M5.4 14.4a7.2 7.2 0 0 1 0-4.7V6.6h-4a12 12 0 0 0 0 10.8l4-3z"/><path fill="#EA4335" d="M12 4.8c1.7 0 3.3.6 4.5 1.8l3.4-3.4A12 12 0 0 0 1.4 6.6l4 3.1C6.3 6.9 8.9 4.8 12 4.8z"/></svg><span>${
    DEMO ? "（デモ）" : ""}${student ? "大学のGoogleでログイン" : "Googleでログイン"}</span>`;
  b.onclick = () => {
    if (DEMO) return onToken(student ? `demo:s${Date.now() % 100000}@${STUDENT_DOMAIN}` : "demo:staff@example.com");
    beforeLeave?.();
    goGoogle(student);
  };
  el.append(b);
}

// ---------- デモサーバー ----------
const K = "reimei-order-demo2";
const ST = ["new", "making", "ready", "done"];
const DEMO_MENU = [
  [11, "ココア", "アイス", "#7a4b33", 1, 1], [12, "ココア", "ホット", "#7a4b33", 1, 1], [13, "ココア", "ホット＋クリーム", "#7a4b33", 1, 1],
  [21, "コーヒー", "アイス", "#3b2418", 1, 1], [22, "コーヒー", "ホット", "#3b2418", 1, 1], [23, "コーヒー", "ホット＋クリーム", "#3b2418", 1, 1],
  [31, "メロンソーダ", "クリームあり", "#3fbf5f", 1, 1], [32, "メロンソーダ", "クリームなし", "#3fbf5f", 1, 1],
  [41, "ストレートティー", "", "#b5652b", 1, 0], [51, "レモンティー", "", "#e0a72e", 0, 1],
].map(([code, name, variant, color, d1, d2]) => ({ code: String(code), name, variant, color, d1: !!d1, d2: !!d2, stock: code === 31 ? 8 : null, soldOut: false }));

function demoLoad() {
  try { const s = JSON.parse(localStorage.getItem(K)); if (s) return s; } catch {}
  return {
    config: { day: 1, open: true, freeLimit: 1, freeScope: "day", price: 100, maxQty: 5 },
    menu: DEMO_MENU, rows: [],
  };
}
function demoSave(s) { s.rev = (s.rev || 0) + 1; try { localStorage.setItem(K, JSON.stringify(s)); } catch {} }
export function resetDemo() { localStorage.removeItem(K); localStorage.removeItem(STAFF_KEY); sessionStorage.clear(); location.reload(); }

function demoUser(token) {
  if (!token?.startsWith("demo:")) return null;
  const email = token.slice(5);
  return { email, isStudent: email.endsWith("@" + STUDENT_DOMAIN), isStaff: email === "staff@example.com" };
}
function demoMenu(s) {
  const c = s.config;
  return s.menu.filter((m) => (c.day === 1 ? m.d1 : m.d2)).map((m) => {
    const used = s.rows.filter((r) => r.day === c.day && r.code === m.code && r.status !== "cancel").reduce((a, r) => a + r.qty, 0);
    const remaining = m.stock == null ? null : Math.max(0, m.stock - used);
    return { code: m.code, name: m.name, variant: m.variant, color: m.color, stock: m.stock, remaining, soldOut: m.soldOut || remaining === 0 };
  });
}
function demoGroup(rows) {
  const map = {};
  for (const r of rows) {
    const o = (map[r.id] ??= { id: r.id, no: r.no, day: r.day, time: r.time, type: r.type, email: r.email, byStaff: r.byStaff, status: r.status, secret: r.secret, lines: [], total: 0, free: 0, pickedBy: r.by || "", pickedAt: r.at || 0, studentId: r.sid || "", slot: r.slot || "" });
    o.lines.push({ code: r.code, name: r.name, variant: r.variant, qty: r.qty });
    o.total += r.amount;
    o.free += r.free;
    if (r.status === "cancel") o.status = "cancel";
    else if (o.status !== "cancel" && ST.indexOf(r.status) < ST.indexOf(o.status)) o.status = r.status;
  }
  return Object.values(map);
}
const fail = (c) => { throw new Error(c); };

async function demoCall(action, p) {
  await new Promise((r) => setTimeout(r, 150));
  const s = demoLoad();
  const c = s.config;
  const slots = [];
  for (let t = 10 * 60 + 15; t <= 17 * 60; t += 15) slots.push(`${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`);
  const cups = (f) => s.rows.filter((r) => r.day === c.day && r.status !== "cancel" && f(r)).reduce((a, r) => a + r.qty, 0);
  const cap = { dayCap: c.day === 1 ? 600 : 400, slotCap: c.day === 1 ? 40 : 30, cutoff: 10, allowGeneral: !!c.allowGeneral };
  const pub = () => ({
    ...c, ...cap, slots, menu: demoMenu(s),
    dayLeft: Math.max(0, cap.dayCap - cups(() => true)),
    slotLeft: Object.fromEntries(slots.map((t) => [t, Math.max(0, cap.slotCap - cups((r) => r.slot === t))])),
  });
  const staff = () => { if (p.staffKey !== "demo-key" && !demoUser(p.idToken)?.isStaff) fail("notStaff"); };
  const sidOfEmail = (e) => String(e || "").split("@")[0].replace(/^s/i, "");
  const freeLeft = (sid) => Math.max(0, c.freeLimit - s.rows
    .filter((r) => sid && r.sid === sid && r.status !== "cancel" && (c.freeScope === "total" || r.day === c.day))
    .reduce((a, r) => a + r.free, 0));

  switch (action) {
    case "rev": return { rev: String(s.rev || 0) };
    case "state": return pub();
    case "me": {
      const u = demoUser(p.idToken);
      if (!u) fail("auth");
      return { ...u, staffKey: u.isStaff ? "demo-key" : null, studentId: u.isStudent ? sidOfEmail(u.email) : "", freeLeft: u.isStudent ? freeLeft(sidOfEmail(u.email)) : 0 };
    }
    case "sidInfo":
      if (!/^\d{7}$/.test(p.studentId)) fail("badCard");
      return { studentId: p.studentId, freeLeft: freeLeft(p.studentId) };
    case "maintain":
      staff();
      return { ok: true };
    case "staffMe":
      staff();
      return { email: "staff@example.com" };
    case "pickup": {
      staff();
      const rows = s.rows.filter((r) => r.id === p.id);
      if (!rows.length) fail("notFound");
      const { secret, ...o } = demoGroup(rows)[0];
      if (o.status === "cancel") return { order: o, result: "cancel" };
      if (o.status === "done") return { order: o, result: "already" };
      const at = Date.now();
      rows.forEach((r) => Object.assign(r, { status: "done", by: "staff@example.com", at }));
      demoSave(s);
      return { order: { ...o, status: "done", pickedBy: "staff@example.com", pickedAt: at }, result: "ok" };
    }
    case "order": {
      if (p.clientId) {
        const done = demoGroup(s.rows.filter((r) => r.id === p.clientId))[0];
        if (done) return { id: done.id, secret: done.secret, no: done.no, total: done.total, free: done.free };
      }
      let type = "general", email = "", free = 0, byStaff = false, cardSid = "";
      if (p.asStaff) {
        staff(); byStaff = true;
        if (p.type === "student") {
          if (!/^\d{7}$/.test(String(p.studentId || ""))) fail("needSid");
          type = "student"; cardSid = String(p.studentId); free = freeLeft(cardSid);
        }
      } else {
        if (!c.open) fail("closed");
        if (p.idToken) {
          const u = demoUser(p.idToken);
          if (!u?.isStudent) fail("notStudent");
          type = "student"; email = u.email; free = freeLeft(sidOfEmail(u.email));
        } else if (p.studentId) {
          if (!/^\d{7}$/.test(p.studentId)) fail("badCard");
          type = "student"; cardSid = p.studentId; free = freeLeft(cardSid);
        }
      }
      const menu = Object.fromEntries(demoMenu(s).map((m) => [m.code, m]));
      const items = (p.items || []).filter((i) => i.qty > 0);
      const totalQty = items.reduce((a, i) => a + i.qty, 0);
      if (!totalQty) fail("empty");
      if (!byStaff && totalQty > c.maxQty) fail("tooMany");
      if (!byStaff && !slots.includes(p.slot)) fail("badSlot");
      if (!byStaff && type !== "student" && !cap.allowGeneral) fail("studentOnly");
      if (!byStaff && type === "student" && !cap.allowGeneral && totalQty > free) fail("usedFree");
      if (!byStaff && cups(() => true) + totalQty > cap.dayCap) fail("dayFull");
      if (!byStaff && cups((r) => r.slot === p.slot) + totalQty > cap.slotCap) fail("slotFull");
      for (const i of items) {
        const m = menu[i.code];
        if (!m || m.soldOut || (m.remaining !== null && m.remaining < i.qty)) fail("soldOut");
      }
      const no = Math.max(0, ...s.rows.filter((r) => r.day === c.day).map((r) => r.no)) + 1;
      const id = p.clientId || Math.random().toString(36).slice(2, 10);
      const secret = Math.random().toString(36).slice(2);
      let used = 0, total = 0;
      for (const i of items) {
        const m = menu[i.code];
        const f = Math.min(i.qty, free - used);
        used += f;
        total += (i.qty - f) * c.price;
        s.rows.push({ no, day: c.day, time: Date.now(), type, email, code: m.code, name: m.name, variant: m.variant, qty: i.qty, free: f, amount: (i.qty - f) * c.price, status: "new", byStaff, id, secret, sid: cardSid || (email ? sidOfEmail(email) : ""), slot: p.slot || "" });
      }
      demoSave(s);
      return { id, secret, no, total, free: used };
    }
    case "status": {
      const want = Object.fromEntries((p.tickets || []).map((t) => [t.id, t.secret]));
      return { orders: demoGroup(s.rows).filter((o) => want[o.id] === o.secret).map(({ secret, email, ...o }) => o) };
    }
    case "cancel": {
      const rows = s.rows.filter((r) => r.id === p.id && r.secret === p.secret);
      if (!rows.length || rows.some((r) => r.status !== "new")) fail("cannotCancel");
      rows.forEach((r) => (r.status = "cancel"));
      demoSave(s);
      return { ok: true };
    }
    case "staffList":
      staff();
      return { state: pub(), orders: demoGroup(s.rows.filter((r) => r.day === c.day)).map(({ secret, ...o }) => o) };
    case "setStatus":
      staff();
      s.rows.forEach((r) => { if (r.id === p.id && r.status !== "cancel") r.status = p.status; });
      demoSave(s);
      return { ok: true };
    case "setConfig":
      staff();
      if (p.day) c.day = Number(p.day);
      if (typeof p.open === "boolean") c.open = p.open;
      if (p.soldOut) s.menu.forEach((m) => { if (m.code in p.soldOut) m.soldOut = !!p.soldOut[m.code]; });
      demoSave(s);
      return { ok: true };
  }
  fail("unknown");
}

// 一度開いたページをスマホに保存（電波が弱くても開けるように）
if ("serviceWorker" in navigator && !DEMO) navigator.serviceWorker.register("sw.js").catch(() => {});
