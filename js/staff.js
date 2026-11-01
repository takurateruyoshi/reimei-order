import { SHOP_NAME, SHEET_URL } from "./config.js";
import { call, DEMO, savedStaffKey, saveStaffKey, renderGoogleButton } from "./api.js";
import { esc, pad, yen, lineName, cupSVG, stockGauge, ID_ICON, COIN_ICON } from "./ui.js";

const $ = (id) => document.getElementById(id);
$("shop").textContent = SHOP_NAME;
if (DEMO) $("demo").hidden = false;
if (SHEET_URL) { $("sheetLink").href = SHEET_URL; $("sheetLink").hidden = false; }

let key = savedStaffKey();
let st = null, orders = [], tab = "kitchen";
let counter = { type: "student", cart: {} };
let timer = null;

const toast = (msg) => {
  const t = $("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (t.hidden = true), 2400);
};
const byCode = (code) => st?.menu.find((m) => m.code === code);

// ---------- ログイン ----------
// Googleで一度ログインすると合言葉（staffKey）をもらい、このスマホに3日間残る
async function enter() {
  try {
    const me = await call("staffMe", { staffKey: key });
    $("gate").hidden = true;
    $("main").hidden = false;
    $("who").hidden = false;
    $("who").innerHTML = `<span>${esc(me.email)}</span><button type="button" id="out">ログアウト</button>`;
    $("out").onclick = () => { saveStaffKey(null); location.reload(); };
    await refresh();
    timer = setInterval(refresh, 3000);
  } catch {
    saveStaffKey(null);
    key = null;
    showLogin();
  }
}
function showLogin(msg) {
  $("gateErr").hidden = !msg;
  if (msg) $("gateErr").textContent = msg;
  renderGoogleButton($("gbtn"), {
    student: false,
    onToken: async (t) => {
      try {
        const me = await call("me", { idToken: t });
        if (!me.isStaff) return showLogin("このアカウントはスタッフに登録されていません（スプレッドシートの「設定」→スタッフ）");
        key = me.staffKey;
        saveStaffKey(key);
        enter();
      } catch {
        showLogin("ログインできませんでした");
      }
    },
  });
}
if (key) enter(); else showLogin();

async function refresh() {
  try {
    const r = await call("staffList", { staffKey: key });
    st = r.state;
    orders = r.orders.sort((a, b) => a.no - b.no);
    render();
  } catch (e) {
    if (e.message === "notStaff") { clearInterval(timer); saveStaffKey(null); location.reload(); }
  }
}
async function act(payload, msg) {
  try { await call(payload.action, { ...payload, staffKey: key }); if (msg) toast(msg); }
  catch { toast("うまくいきませんでした"); }
  refresh();
}

// ---------- 操作 ----------
$("tabs").addEventListener("click", (e) => {
  const b = e.target.closest("[data-tab]");
  if (b) { tab = b.dataset.tab; render(); }
});
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-set]");
  if (!b) return;
  b.disabled = true;
  const o = orders.find((x) => x.id === b.dataset.id);
  if (o) o.status = b.dataset.set;   // 先に画面を進めておく
  render();
  act({ action: "setStatus", id: b.dataset.id, status: b.dataset.set }, b.dataset.set === "done" ? `${pad(b.dataset.no)} 受け渡し完了` : "");
});
$("daySeg").addEventListener("click", (e) => {
  const b = e.target.closest("[data-day]");
  if (b) act({ action: "setConfig", day: Number(b.dataset.day) }, `${b.dataset.day}日目にしました`);
});
$("openSw").onclick = () => act({ action: "setConfig", open: !st.open }, st.open ? "受付を止めました" : "受付を始めました");
$("soldOut").addEventListener("click", (e) => {
  const b = e.target.closest("[data-sold]");
  if (!b) return;
  const m = byCode(b.dataset.sold);
  act({ action: "setConfig", soldOut: { [m.code]: !m.soldOut } });
});

$("cType").addEventListener("click", (e) => {
  const b = e.target.closest("[data-type]");
  if (b) { counter.type = b.dataset.type; render(); }
});
$("cCodes").addEventListener("click", (e) => {
  const b = e.target.closest("[data-code]");
  if (b) { counter.cart[b.dataset.code] = (counter.cart[b.dataset.code] || 0) + 1; render(); }
});
$("cLines").addEventListener("click", (e) => {
  const b = e.target.closest("[data-dec]");
  if (b) { counter.cart[b.dataset.dec] -= 1; if (counter.cart[b.dataset.dec] <= 0) delete counter.cart[b.dataset.dec]; render(); }
});
$("cGo").onclick = async () => {
  $("cGo").disabled = true;
  try {
    const r = await call("order", {
      asStaff: true, staffKey: key, type: counter.type,
      items: Object.entries(counter.cart).map(([code, qty]) => ({ code, qty })),
    });
    $("cResult").innerHTML = `番号 <b class="big-no" style="font-size:32px">${pad(r.no)}</b>${r.total ? `　${yen(r.total)} 受け取る` : ""}`;
    counter.cart = {};
  } catch (e) {
    toast(e.message === "soldOut" ? "売り切れがあります" : "注文を入れられませんでした");
  }
  refresh();
};

// ---------- 表示 ----------
function ageBar(o) {
  const min = (Date.now() - o.time) / 60000;
  const cls = min >= 10 ? "late" : min >= 5 ? "warn" : "";
  return `<div class="age ${cls}" title="${Math.floor(min)}分経過"><i style="width:${Math.min(100, (min / 10) * 100)}%"></i></div>`;
}
const need = (o) => (o.free ? `<span class="need id">${ID_ICON}学生証</span>` : "") + (o.total ? `<span class="need cash">${COIN_ICON}${yen(o.total)}</span>` : "");

function card(o, btn) {
  return `<article class="ocard">
    <div class="no">${pad(o.no)}</div>
    <ul class="olines">${o.lines.map((l) => `<li>${cupSVG({ ...l, color: byCode(l.code)?.color })}<span class="code">${esc(l.code)}</span>${esc(lineName(l))}${l.qty > 1 ? ` <b>×${l.qty}</b>` : ""}</li>`).join("")}</ul>
    ${btn}
    <div class="sub">${need(o)}${ageBar(o)}${o.byStaff ? `<span class="mini">店頭</span>` : ""}</div>
  </article>`;
}
const list = (arr, fn) => (arr.length ? arr.map(fn).join("") : `<div class="empty">なし</div>`);

function render() {
  if (!st) return;
  const by = (s) => orders.filter((o) => o.status === s);
  const nNew = by("new"), nMaking = by("making"), nReady = by("ready");

  $("state").className = "banner" + (st.open ? "" : " closed");
  $("state").textContent = `${st.day}日目　${st.open ? "受付中" : "受付停止中"}`;
  for (const b of $("tabs").children) b.setAttribute("aria-selected", b.dataset.tab === tab);
  for (const p of document.querySelectorAll("[data-panel]")) p.hidden = p.dataset.panel !== tab;
  $("cKitchen").textContent = nNew.length + nMaking.length;
  $("cHandoff").textContent = nReady.length;

  $("colNew").innerHTML = list(nNew, (o) => card(o, `<button class="act" data-set="making" data-id="${o.id}">作る</button>`));
  $("colMaking").innerHTML = list(nMaking, (o) => card(o, `<button class="act dawn" data-set="ready" data-id="${o.id}">できた</button>`));
  $("colReady").innerHTML = list(nReady, (o) => card(o,
    `<div style="display:flex;flex-direction:column;gap:4px"><button class="act ok" data-set="done" data-id="${o.id}" data-no="${o.no}">渡した</button><button class="mini" data-set="making" data-id="${o.id}">戻す</button></div>`));

  // 店頭で注文
  for (const b of $("cType").children) b.setAttribute("aria-pressed", b.dataset.type === counter.type);
  $("cCodes").innerHTML = st.menu.map((m) => `<button type="button" class="codebtn" data-code="${m.code}" ${m.soldOut ? "disabled" : ""}>
    <span class="code">${esc(m.code)}</span>${cupSVG(m)}<small>${esc(m.variant || m.name)}</small></button>`).join("");
  const lines = Object.entries(counter.cart).map(([code, qty]) => ({ ...byCode(code), qty }));
  $("cLines").innerHTML = lines.map((l) => `<li>${cupSVG(l)}<span class="code">${esc(l.code)}</span><span class="nm">${esc(lineName(l))}</span><b>×${l.qty}</b><button type="button" class="mini" data-dec="${l.code}">−</button></li>`).join("");
  $("cGo").disabled = !lines.length;

  // 管理
  for (const b of $("daySeg").children) b.setAttribute("aria-pressed", Number(b.dataset.day) === st.day);
  $("openSw").setAttribute("aria-checked", !!st.open);
  $("openLabel").textContent = st.open ? "受付中（お客さんが注文できます）" : "受付停止中";
  $("soldOut").innerHTML = st.menu.map((m) => `<div class="row">${cupSVG(m)}<span class="code">${esc(m.code)}</span>
    <span style="flex:1;min-width:0">${esc(lineName(m))} ${m.remaining !== null ? `<small class="muted">のこり${m.remaining}</small>` : ""}${stockGauge(m)}</span>
    <button class="switch" role="switch" aria-checked="${!m.soldOut}" data-sold="${m.code}" aria-label="${esc(lineName(m))} 販売中"></button></div>`).join("");

  const valid = orders.filter((o) => o.status !== "cancel");
  const cups = (arr) => arr.reduce((a, o) => a + o.lines.reduce((b, l) => b + l.qty, 0), 0);
  const stu = valid.filter((o) => o.type === "student");
  const people = new Set(stu.filter((o) => o.email).map((o) => o.email)).size + stu.filter((o) => !o.email).length;
  $("tiles").innerHTML = [
    ["学部生（人）", people],
    ["無料（杯）", valid.reduce((a, o) => a + o.free, 0)],
    ["合計（杯）", cups(valid)],
    ["現金 受け取り済み", yen(valid.filter((o) => o.status === "done").reduce((a, o) => a + o.total, 0))],
  ].map(([k, v]) => `<div class="tile"><small>${k}</small><b>${v}</b></div>`).join("");
}
