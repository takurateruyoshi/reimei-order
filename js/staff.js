import { SHOP_NAME, SHEET_URL } from "./config.js";
import { call, newId, popRedirectToken, DEMO, savedStaffKey, saveStaffKey, renderGoogleButton } from "./api.js";
import { scanOrderQR, scanStudentCard } from "./scan.js";
import { esc, pad, yen, lineName, cupSVG, stockGauge, groupMenu, ID_ICON, COIN_ICON, pullToRefresh, fitText } from "./ui.js";

const $ = (id) => document.getElementById(id);
$("shop").textContent = SHOP_NAME;
if (DEMO) $("demo").hidden = false;
if (SHEET_URL) { $("sheetLink").href = SHEET_URL; $("sheetLink").hidden = false; }

let key = savedStaffKey();
let st = null, orders = [], tab = "kitchen";
let counter = { cart: {}, sid: "", freeLeft: null };
let lastSnap = "";

const toast = (msg) => {
  const t = $("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (t.hidden = true), 2400);
};
const byCode = (code) => st?.menu.find((m) => m.code === code);

// ---------- ログイン ----------
// Googleで一度ログインすると合言葉（staffKey）をもらい、このスマホに3日間残る。
// 確認している間はログイン画面に戻さず、枠だけの「読み込み中」画面で待つ
const EMAIL_KEY = "reimei-order-staff-email";
function showLoading() {
  $("gate").hidden = true;
  $("main").hidden = false;
  $("main").classList.add("loading");
  $("state").className = "banner";
  $("state").textContent = "読み込んでいます…";
  $("colNew").html = `<div class="ocard sk-card"></div>`.repeat(3);
}
// 読み込みは順番に見せる：①お店の状態（受付・日付・メニュー）→ ②注文一覧。
// ①は誰でも読める軽いデータなので先に出し、②が届いたら一覧を埋める
let ordersLoaded = false;
async function enter() {
  showLoading();
  call("state").then((s) => {
    if (ordersLoaded) return;
    st = s;
    $("main").classList.remove("loading");   // 受付の切り替えなどは先に使える
    render();
    $("state").textContent += "　注文を読み込んでいます…";
  }).catch(() => {});
  try {
    const r = await call("staffList", { staffKey: key });   // スタッフかどうかの確認もこれで兼ねる
    ordersLoaded = true;
    let email = "";
    try { email = localStorage.getItem(EMAIL_KEY) || ""; } catch {}
    $("who").hidden = false;
    $("who").html = `<span>${esc(email)}</span><button type="button" id="out">ログアウト</button>`;
    $("out").onclick = () => { saveStaffKey(null); location.reload(); };
    apply(r);
    $("main").classList.remove("loading");
    // 最新にするのは「下に引っぱったとき」と「アプリに戻ってきたとき」だけ。
    // パソコンで書いた注文の整理とチェック（maintain）も、そのときに一覧とは別に行う
    const maintain = () => call("maintain", { staffKey: key }).catch(() => {});
    maintain();
    const pull = () => Promise.all([refresh(), maintain()]);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) pull(); });
    pullToRefresh(pull, () => !$("cSheet").hidden || !!document.querySelector(".scan-bg"));
  } catch (e) {
    if (e.network) {   // 電波が無いだけなら、読み込み中のまま待って送り直す
      $("netOff").hidden = false;
      setTimeout(enter, 3000);
      return;
    }
    saveStaffKey(null);
    key = null;
    showLogin(e.message === "notStaff" ? "このアカウントはスタッフに登録されていません（スプレッドシートの「スタッフ」シート）" : "");
  }
}
function showLogin(msg) {
  $("main").hidden = true;
  $("gate").hidden = false;
  $("gateErr").hidden = !msg;
  if (msg) $("gateErr").textContent = msg;
  renderGoogleButton($("gbtn"), { student: false, onToken: loginWith });
}
async function loginWith(t) {
  showLoading();
  try {
    const me = await call("me", { idToken: t });
    if (!me.isStaff) return showLogin("このアカウントはスタッフに登録されていません（スプレッドシートの「スタッフ」シート）");
    key = me.staffKey;
    saveStaffKey(key);
    try { localStorage.setItem(EMAIL_KEY, me.email); } catch {}
    enter();
  } catch {
    showLogin("ログインできませんでした");
  }
}

function apply(r) {
  // 変わったときだけ描き直す（押している途中のボタンが消えないように）
  const snap = JSON.stringify(r);
  if (snap === lastSnap) return;
  lastSnap = snap;
  st = r.state;
  orders = r.orders.sort((a, b) => a.no - b.no);
  render();
}
async function refresh() {
  try {
    apply(await call("staffList", { staffKey: key }));
    $("netOff").hidden = true;
  } catch (e) {
    if (e.network) $("netOff").hidden = false;
    if (e.message === "notStaff") { saveStaffKey(null); location.reload(); }
  }
}
async function act(payload, msg) {
  try { await call(payload.action, { ...payload, staffKey: key }); if (msg) toast(msg); }
  catch { toast("うまくいきませんでした。もう一度押してください"); }
  lastSnap = "";
  refresh();
}

// ---------- 操作 ----------
// 「渡した」は押し間違い防止で2回押す（1回目で赤くなり、3秒以内にもう一度押すと完了）
let armed = null, armTimer = null;
$("colNew").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-give]");
  if (!b) return;
  const id = b.dataset.give;
  if (armed !== id) {
    armed = id;
    clearTimeout(armTimer);
    armTimer = setTimeout(() => { armed = null; render(); }, 3000);
    return render();
  }
  armed = null;
  clearTimeout(armTimer);
  const o = orders.find((x) => x.id === id);
  if (o) o.status = "done";   // 先に一覧から消しておく
  render();
  try {
    const r = await call("pickup", { staffKey: key, id });
    toast(r.result === "already" ? "もう受け渡し済みでした" : `${o?.studentId || "No." + pad(o?.no)} 受け渡し完了`);
  } catch {
    if (o) o.status = "new";
    toast("記録できませんでした。もう一度押してください");
  }
  lastSnap = "";
  refresh();
});
// アプリの中でカメラを開いてお客さんのQRを読み、受け渡しの画面へ
$("scanQR").onclick = async () => {
  const r = await scanOrderQR();
  if (!r) return;
  if (r.error) return toast(r.error);
  location.href = `pickup.html?o=${encodeURIComponent(r.orderId)}${DEMO ? "&demo" : ""}`;
};
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
  if (!b) return;
  st.day = Number(b.dataset.day);   // 押したらすぐ画面に反映し、保存は後ろで行う
  render();
  act({ action: "setConfig", day: st.day }, `${st.day}日目にしました`);
});
$("openSw").onclick = () => {
  st.open = !st.open;
  render();
  act({ action: "setConfig", open: st.open }, st.open ? "受付を始めました" : "受付を止めました");
};
$("soldOut").addEventListener("click", (e) => {
  const b = e.target.closest("[data-sold]");
  if (!b) return;
  const m = byCode(b.dataset.sold);
  m.soldOut = !m.soldOut;
  render();
  act({ action: "setConfig", soldOut: { [m.code]: m.soldOut } }, m.soldOut ? "売り切れにしました" : "販売中に戻しました");
});

$("cCodes").addEventListener("click", (e) => {
  const b = e.target.closest("[data-code]");
  if (!b || b.disabled) return;
  const code = b.dataset.code, m = byCode(code);
  if (e.target.closest("[data-dec-row]")) {
    counter.cart[code] = Math.max(0, (counter.cart[code] || 0) - 1);
    if (!counter.cart[code]) delete counter.cart[code];
  } else {
    if (m?.remaining !== null && m?.remaining !== undefined && (counter.cart[code] || 0) >= m.remaining) return toast("これ以上は残っていません");
    counter.cart[code] = (counter.cart[code] || 0) + 1;
  }
  render();
});
// 店頭の注文：下のバー →「注文へ」→ 学部生か一般かを選ぶ。学部生は学籍番号が必要（学生証の読み取りか手入力）
const cOpen = () => { $("cErr").hidden = true; $("cDone").hidden = true; $("cSheet").hidden = false; renderCounterSheet(); };
const cClose = () => { $("cSheet").hidden = true; };
$("cNext").onclick = cOpen;
$("cClose").onclick = cClose;
$("cSheet").addEventListener("click", (e) => { if (e.target === $("cSheet")) cClose(); });
$("cLines").addEventListener("click", (e) => {
  const b = e.target.closest("[data-dec]");
  if (!b) return;
  counter.cart[b.dataset.dec] -= 1;
  if (counter.cart[b.dataset.dec] <= 0) delete counter.cart[b.dataset.dec];
  render();
  if (!Object.keys(counter.cart).length) cClose(); else renderCounterSheet();
});
let sidTimer = null;
$("cSid").addEventListener("input", () => {
  $("cSid").value = $("cSid").value.replace(/\D/g, "").slice(0, 7);
  counter.sid = $("cSid").value;
  counter.freeLeft = null;
  renderCounterSheet();
  clearTimeout(sidTimer);
  if (counter.sid.length === 7) sidTimer = setTimeout(lookupSid, 200);
});
$("cScan").onclick = async () => {
  const r = await scanStudentCard();
  if (!r) return;
  if (r.error) return toast(r.error);
  $("cSid").value = counter.sid = r.studentId;
  lookupSid();
};
async function lookupSid() {
  const sid = counter.sid;
  $("cSidInfo").textContent = "確認しています…";
  try {
    const r = await call("sidInfo", { studentId: sid });
    if (counter.sid !== sid) return;
    counter.freeLeft = r.freeLeft;
  } catch { counter.freeLeft = null; }
  renderCounterSheet();
}
async function counterOrder(type) {
  $("cErr").hidden = true;
  const btn = type === "student" ? $("cAsStu") : $("cAsGen");
  btn.disabled = true;
  try {
    const r = await call("order", {
      asStaff: true, staffKey: key, type, clientId: newId(),
      ...(type === "student" ? { studentId: counter.sid } : {}),
      items: Object.entries(counter.cart).map(([code, qty]) => ({ code, qty })),
    });
    counter.cart = {};
    counter.sid = "";
    counter.freeLeft = null;
    $("cSid").value = "";
    $("cDone").hidden = false;
    $("cDone").html = `<div class="show-no"><small>注文番号</small>${pad(r.no)}</div>${r.free ? `<div class="need-big id">無料 ${r.free}杯（学生証を確認）</div>` : ""}${r.total ? `<div class="need-big cash">${yen(r.total)} を受け取る</div>` : ""}<button class="go wide" type="button" id="cAgain">次の注文へ</button>`;
    $("cAgain").onclick = cClose;
    render();
    lastSnap = "";
    refresh();
  } catch (e) {
    $("cErr").textContent = { soldOut: "売り切れがあります", needSid: "学籍番号を7桁で入れてください" }[e.message] || (e.network ? "通信できません。もう一度押してください" : "注文を入れられませんでした");
    $("cErr").hidden = false;
  }
  btn.disabled = false;
}
$("cAsStu").onclick = () => counterOrder("student");
$("cAsGen").onclick = () => counterOrder("general");

function renderCounterSheet() {
  if ($("cSheet").hidden || !st) return;
  const lines = Object.entries(counter.cart).map(([code, qty]) => ({ ...byCode(code), qty }));
  const q = lines.reduce((a, l) => a + l.qty, 0);
  $("cLines").html = lines.map((l) => `<li>${cupSVG(l)}<span class="code">${esc(l.code)}</span><span class="nm">${esc(lineName(l))}</span><b>×${l.qty}</b><button type="button" class="mini" data-dec="${esc(l.code)}">1杯へらす</button></li>`).join("");
  $("cGenPrice").textContent = yen(q * st.price);
  const ok = /^\d{7}$/.test(counter.sid || "");
  $("cAsStu").disabled = !ok || !q;
  $("cAsGen").disabled = !q;
  if (!ok) $("cSidInfo").textContent = "学籍番号を入れると無料の杯数が出ます";
  else if (counter.freeLeft !== null && counter.freeLeft !== undefined) {
    const free = Math.min(counter.freeLeft, q), pay = (q - free) * st.price;
    $("cSidInfo").textContent = [free ? `無料 ${free}杯` : "無料は使用済み", pay ? `${yen(pay)}` : ""].filter(Boolean).join(" ＋ ");
  }
}

// ---------- 表示 ----------
function ageBar(o) {
  const min = (Date.now() - o.time) / 60000;
  const cls = min >= 10 ? "late" : min >= 5 ? "warn" : "";
  return `<div class="age ${cls}" title="${Math.floor(min)}分経過"><i style="width:${Math.min(100, (min / 10) * 100)}%"></i></div>`;
}
const need = (o) => (o.free ? `<span class="need id">${ID_ICON}学生証</span>` : "") + (o.total ? `<span class="need cash">${COIN_ICON}${yen(o.total)}</span>` : "");

function card(o, btn) {
  return `<article class="ocard ${o.problem ? "bad" : ""}">${o.problem ? `<div class="bad-why">⚠ ${esc(o.problem)}</div>` : ""}
    <div class="no">${o.studentId ? `<span class="call">${esc(o.studentId)}</span><small>No.${pad(o.no)}</small>` : pad(o.no)}</div>
    <ul class="olines">${o.lines.map((l) => `<li>${cupSVG({ ...l, color: byCode(l.code)?.color })}<span class="code">${esc(l.code)}</span>${esc(lineName(l))}${l.qty > 1 ? ` <b>×${l.qty}</b>` : ""}</li>`).join("")}</ul>
    ${btn}
    <div class="sub">${need(o)}${ageBar(o)}${o.byStaff ? `<span class="mini">店頭</span>` : ""}</div>
  </article>`;
}
const list = (arr, fn) => (arr.length ? arr.map(fn).join("") : `<div class="empty">なし</div>`);

function render() {
  if (!st) return;
  const waiting = orders.filter((o) => ["new", "making", "ready"].includes(o.status));

  $("state").className = "banner" + (st.open ? "" : " closed");
  $("state").textContent = st.open ? "受付中" : "受付停止中";
  for (const b of $("tabs").children) b.setAttribute("aria-selected", b.dataset.tab === tab);
  for (const p of document.querySelectorAll("[data-panel]")) p.hidden = p.dataset.panel !== tab;
  $("cKitchen").textContent = waiting.length;
  // 受け取り時間ごとにまとめる（店頭で入れた注文は「今すぐ」）
  const bySlot = {};
  for (const o of waiting) (bySlot[o.slot || "今すぐ"] ??= []).push(o);
  const keys = Object.keys(bySlot).sort((a, b) => (a === "今すぐ" ? -1 : b === "今すぐ" ? 1 : a.localeCompare(b)));
  if (!ordersLoaded) {
    $("colNew").html = `<div class="ocard sk-card"></div>`.repeat(3);
  } else $("colNew").html = keys.length
    ? keys.map((k) => `<h3 class="slot-head">${esc(k)}<span>${bySlot[k].reduce((a, o) => a + o.lines.reduce((b, l) => b + l.qty, 0), 0)}杯</span></h3>${bySlot[k].map((o) => card(o, `<button type="button" class="give ${armed === o.id ? "armed" : ""}" data-give="${esc(o.id)}">${armed === o.id ? "もう一度で完了" : "渡した"}</button>`)).join("")}`).join("")
    : `<div class="empty">なし</div>`;

  // 店頭で注文
  // お客さん画面と同じカード（3列）
  $("cCodes").html = `<div class="cards">${st.menu.map((m) => {
    const n = counter.cart[m.code] || 0;
    return `<button type="button" class="card ${n ? "on" : ""} ${m.soldOut ? "out" : ""}" data-code="${m.code}" style="--tint:${m.color || "#999"}" ${m.soldOut ? "disabled" : ""}>
      <span class="pic">${cupSVG(m)}${n ? `<b class="cnt">×${n}</b>` : ""}${m.soldOut ? `<em class="soldout">売り切れ</em>` : ""}<small class="code">${esc(m.code)}</small></span>
      <span class="nm"><small>${esc(m.variant ? m.name : "")}</small><b class="vn">${esc(m.variant || m.name)}</b></span>
      <span class="ft">${n ? `<span class="dec" data-dec-row aria-label="1杯へらす">−</span>` : m.stock != null && !m.soldOut ? `<span class="left ${m.remaining <= 3 ? "low" : ""}">のこり${m.remaining}</span>` : ""}<span class="add" aria-hidden="true">＋</span></span>
    </button>`;
  }).join("")}</div>`;
  fitText("#cCodes .vn", 9);
  // 下のバー（店頭で注文のタブでカートに何か入っているときだけ）
  const cl = Object.entries(counter.cart).map(([code, qty]) => ({ ...byCode(code), qty }));
  const cq = cl.reduce((a, l) => a + l.qty, 0);
  $("cBar").hidden = tab !== "counter" || !cq;
  if (cq) {
    $("cCups").html = cl.flatMap((l) => Array(l.qty).fill(cupSVG(l))).slice(0, 5).join("");
    $("cCount").textContent = `${cq}杯`;
  }
  renderCounterSheet();

  // 管理
  for (const b of $("daySeg").children) b.setAttribute("aria-pressed", Number(b.dataset.day) === st.day);
  $("openSw").setAttribute("aria-checked", !!st.open);
  $("openLabel").textContent = st.open ? "受付中（お客さんが注文できます）" : "受付停止中";
  $("soldOut").html = st.menu.map((m) => `<div class="row">${cupSVG(m)}<span class="code">${esc(m.code)}</span>
    <span style="flex:1;min-width:0">${esc(lineName(m))} ${m.remaining !== null ? `<small class="muted">のこり${m.remaining}</small>` : ""}${stockGauge(m)}</span>
    <button class="switch" role="switch" aria-checked="${!m.soldOut}" data-sold="${m.code}" aria-label="${esc(lineName(m))} 販売中"></button></div>`).join("");

  const valid = orders.filter((o) => o.status !== "cancel");
  const cups = (arr) => arr.reduce((a, o) => a + o.lines.reduce((b, l) => b + l.qty, 0), 0);
  const stu = valid.filter((o) => o.type === "student");
  const people = new Set(stu.filter((o) => o.email).map((o) => o.email)).size + stu.filter((o) => !o.email).length;
  $("tiles").html = [
    ["学部生（人）", people],
    ["無料（杯）", valid.reduce((a, o) => a + o.free, 0)],
    ["合計（杯）", cups(valid)],
    ["モバイル残り（今日）", `${st.dayLeft ?? "-"} / ${st.dayCap ?? "-"}`],
    ["現金 受け取り済み", yen(valid.filter((o) => o.status === "done").reduce((a, o) => a + o.total, 0))],
  ].map(([k, v]) => `<div class="tile"><small>${k}</small><b>${v}</b></div>`).join("");
}

// Googleから戻ってきたときは、そのまま読み込み画面へ
const back = popRedirectToken();
if (back) loginWith(back); else if (key) enter(); else showLogin();
