// サーバー（Apps Script）とのやりとり。API_URL が無ければブラウザ内のデモサーバーを使う。
import { API_URL, GOOGLE_CLIENT_ID, STUDENT_DOMAIN } from "./config.js";

export const DEMO = !API_URL;

export async function call(action, payload = {}) {
  if (DEMO) return demoCall(action, payload);
  const r = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action, ...payload }),
  });
  const d = await r.json();
  if (d.error) throw new Error(d.error);
  return d;
}

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
export async function renderGoogleButton(el, { student, onToken }) {
  el.innerHTML = "";
  if (DEMO) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "gbtn";
    b.textContent = student ? "（デモ）大学のGoogleでログイン" : "（デモ）Googleでログイン";
    b.onclick = () => onToken(student ? `demo:s${Date.now() % 100000}@${STUDENT_DOMAIN}` : "demo:staff@example.com");
    el.append(b);
    return;
  }
  await loadGis();
  google.accounts.id.initialize({
    client_id: GOOGLE_CLIENT_ID,
    callback: (r) => onToken(r.credential),
    ...(student ? { hd: STUDENT_DOMAIN } : {}),
    auto_select: false,
    ux_mode: "popup",
  });
  google.accounts.id.renderButton(el, { theme: "outline", size: "large", shape: "pill", text: "signin_with", locale: "ja" });
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
function demoSave(s) { try { localStorage.setItem(K, JSON.stringify(s)); } catch {} }
export function resetDemo() { localStorage.removeItem(K); sessionStorage.clear(); location.reload(); }

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
    const o = (map[r.id] ??= { id: r.id, no: r.no, day: r.day, time: r.time, type: r.type, email: r.email, byStaff: r.byStaff, status: r.status, secret: r.secret, lines: [], total: 0, free: 0 });
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
  const pub = () => ({ ...c, menu: demoMenu(s) });
  const staff = () => { if (!demoUser(p.idToken)?.isStaff) fail("notStaff"); };
  const freeLeft = (email) => Math.max(0, c.freeLimit - s.rows
    .filter((r) => r.email === email && r.status !== "cancel" && (c.freeScope === "total" || r.day === c.day))
    .reduce((a, r) => a + r.free, 0));

  switch (action) {
    case "state": return pub();
    case "me": {
      const u = demoUser(p.idToken);
      if (!u) fail("auth");
      return { ...u, freeLeft: u.isStudent ? freeLeft(u.email) : 0 };
    }
    case "order": {
      let type = "general", email = "", free = 0, byStaff = false;
      if (p.asStaff) {
        staff(); byStaff = true;
        if (p.type === "student") { type = "student"; free = c.freeLimit; }
      } else {
        if (!c.open) fail("closed");
        if (p.idToken) {
          const u = demoUser(p.idToken);
          if (!u?.isStudent) fail("notStudent");
          type = "student"; email = u.email; free = freeLeft(u.email);
        }
      }
      const menu = Object.fromEntries(demoMenu(s).map((m) => [m.code, m]));
      const items = (p.items || []).filter((i) => i.qty > 0);
      const totalQty = items.reduce((a, i) => a + i.qty, 0);
      if (!totalQty) fail("empty");
      if (!byStaff && totalQty > c.maxQty) fail("tooMany");
      for (const i of items) {
        const m = menu[i.code];
        if (!m || m.soldOut || (m.remaining !== null && m.remaining < i.qty)) fail("soldOut");
      }
      const no = Math.max(0, ...s.rows.filter((r) => r.day === c.day).map((r) => r.no)) + 1;
      const id = Math.random().toString(36).slice(2, 10);
      const secret = Math.random().toString(36).slice(2);
      let used = 0, total = 0;
      for (const i of items) {
        const m = menu[i.code];
        const f = Math.min(i.qty, free - used);
        used += f;
        total += (i.qty - f) * c.price;
        s.rows.push({ no, day: c.day, time: Date.now(), type, email, code: m.code, name: m.name, variant: m.variant, qty: i.qty, free: f, amount: (i.qty - f) * c.price, status: "new", byStaff, id, secret });
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
