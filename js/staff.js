import { SHOP_NAME, SHEET_URL } from "./config.js";
import { call, newId, popRedirectToken, DEMO, savedStaffKey, saveStaffKey, renderGoogleButton } from "./api.js";
import { startQRStream, scanStudentCard } from "./scan.js";
import { esc, pad, yen, lineName, tempCls, autoUpdate, cupSVG, stockGauge, groupMenu, ID_ICON, COIN_ICON, pullToRefresh, fitText } from "./ui.js";

const $ = (id) => document.getElementById(id);
$("shop").textContent = SHOP_NAME;
if (DEMO) $("demo").hidden = false;
if (SHEET_URL) { $("sheetLink").href = SHEET_URL; $("sheetLink").hidden = false; }

let key = savedStaffKey();
let st = null, orders = [], tab = "kitchen";
let counter = { cart: {}, sid: "", freeLeft: null };
let lastSnap = "";
let maker = false;   // 製造の担当（スプレッドシート「スタッフ」の C列にチェック）だけ「製造」タブを出す

// パソコン（横幅1100px以上）では「受け渡し」と「店頭で注文」を左右に並べて同時に出す
const pcMQ = matchMedia("(min-width: 1100px)");
const isPC = () => pcMQ.matches;
pcMQ.addEventListener("change", () => render());

// 通信できないあいだの受け渡しの記録は、この端末に貯めておき、つながったら順に送る。
// 店頭の注文は、通信できないときは受けない（紙で受け付けてもらう）
const Q_KEY = "reimei-staff-queue", LAST_KEY = "reimei-staff-last";
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
let queue = load(Q_KEY, []).filter((x) => x.kind === "pickup");   // { kind: "pickup", id, via }
const LASTOK_KEY = "reimei-staff-lastok";
const remainingOf = (m) => (m?.remaining == null ? null : m.remaining);
const viewOf = (m) => m;
const saveQueue = () => save(Q_KEY, queue);

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
    maker = !!r.maker;
    apply(r);
    save(LASTOK_KEY, Date.now());
    $("main").classList.remove("loading");
    startAuto();
    // 最新にするのは「下に引っぱったとき」と「アプリに戻ってきたとき」だけ。
    // パソコンで書いた注文の整理とチェック（maintain）も、そのときに一覧とは別に行う
    const maintain = () => call("maintain", { staffKey: key }).catch(() => {});
    maintain();
    const pull = () => Promise.all([refresh(), maintain()]);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) pull(); });
    pullToRefresh(pull, () => !$("cSheet").hidden || !!document.querySelector(".scan-bg"));
  } catch (e) {
    if (e.network) {   // 電波が無いだけなら、前回の一覧で始めて、つながるまで送り直す
      $("netOff").hidden = false;
      const last = load(LAST_KEY, null);
      if (last && !ordersLoaded) {
        ordersLoaded = true;
        apply(last);
        $("main").classList.remove("loading");
        startAuto();
      }
      if (!last) setTimeout(enter, 3000);
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
  save(LAST_KEY, r);
  st = r.state;
  orders = r.orders.sort((a, b) => a.no - b.no);
  render();
}
async function refresh() {
  try {
    await flushQueue();
    const d = await call("staffList", { staffKey: key });
    staffNotice = d.staffNotice || "";
    maker = !!d.maker;
    apply(d);
    save(LASTOK_KEY, Date.now());
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
  toast((await handOver(id, "button")).msg);
});

// 受け渡しを記録する（「渡した」2回目・カメラでQRを読んだとき）。結果の文を返す
// via：どうやって渡したか（qr＝注文のQR／card＝学生証／button＝「渡した」）。スタッフ操作記録に残る
async function handOver(id, via = "button") {
  const o = orders.find((x) => x.id === id);
  const before = o?.status;
  if (o) o.status = "done";   // 先に一覧から消しておく
  render();
  try {
    const r = await call("pickup", { staffKey: key, id, via });
    const ro = { ...(o || {}), ...(r.order || {}) };
    lastSnap = "";
    refresh();
    if (r.result === "cancel") return { ok: false, o: ro, msg: `${numLabel(ro)} は取り消された注文です` };
    if (r.result === "already") return { ok: false, o: ro, msg: `${numLabel(ro)} はもう受け渡し済みです` };
    return { ok: true, o: ro, msg: `${numLabel(ro)} 受け渡し完了` };
  } catch (e) {
    if (e.network) {
      queue.push({ kind: "pickup", id, via });
      saveQueue();
      render();
      return { ok: true, o, msg: `${numLabel(o)} 受け渡し完了（つながったら記録します）` };
    }
    if (o) o.status = before || "new";
    render();
    return { ok: false, o, msg: e.message === "notFound" ? "この注文は見つかりません" : "記録できませんでした。もう一度読み取ってください" };
  }
}

// ---------- 受け渡しの上のカメラ（開いている間ずっとQRを読む） ----------
let cam = null, camBusy = false, camWant = true, camMsgTimer = null;
try { camWant = localStorage.getItem("reimei-cam") !== "off"; } catch {}
const CAM_IDLE = "お客さんのQRか、学生証のバーコードを枠に向けてください";
async function camSync() {
  const on = camWant && ordersLoaded && tab === "kitchen" && !document.hidden && !$("main").hidden;
  $("cam").classList.toggle("off", !camWant);
  $("camTog").textContent = camWant ? "カメラを止める" : "カメラをつける";
  if (on && !cam && !camBusy) {
    camBusy = true;
    $("camMsg").textContent = "カメラを準備しています…";
    const c = await startQRStream($("cam"), onQR, onCard);
    camBusy = false;
    if (c.error) { $("camMsg").textContent = c.error; return; }
    cam = c;
    $("camMsg").textContent = CAM_IDLE;
    camSync();   // 準備している間に別のタブへ移っていたら止める
  } else if (!on && cam) {
    cam.stop();
    cam = null;
    if (!camWant) $("camMsg").textContent = "カメラは止まっています";
  }
}
// 学生証のバーコードを読んだとき：その学籍番号のまだ渡していない注文を、全部受け渡し済みにする
async function onCard(sid) {
  const mine = orders.filter((o) => o.status !== "done" && o.status !== "cancel" && String(o.studentId || "") === sid);
  if (!mine.length) return camShow(false, `学籍番号 ${sid.slice(0, 2)}…${sid.slice(-2)} の、まだ渡していない注文はありません`);
  camShow(null, "記録しています…");
  const rs = [];
  for (const o of mine) rs.push(await handOver(o.id, "card"));
  const ok = rs.filter((r) => r.ok);
  const cash = ok.reduce((a, r) => a + (r.o?.total || 0), 0);
  camShow(ok.length > 0, (ok.length ? ok.map((r) => numLabel(r.o)).join("・") + " 受け渡し完了" + (cash ? `　${yen(cash)}を受け取る` : "") : "") + rs.filter((r) => !r.ok).map((r) => "　" + r.msg).join(""));
}
function camShow(ok, msg) {
  clearTimeout(camMsgTimer);
  $("camMsg").className = "cam-msg" + (ok === null ? "" : ok ? " ok" : " ng");
  $("camMsg").textContent = msg;
  if (ok !== null) camMsgTimer = setTimeout(() => { $("camMsg").className = "cam-msg"; $("camMsg").textContent = CAM_IDLE; }, 5000);
}
async function onQR(id) {
  clearTimeout(camMsgTimer);
  $("camMsg").className = "cam-msg";
  $("camMsg").textContent = "記録しています…";
  const r = await handOver(id, "qr");
  const needs = r.ok && r.o ? [r.o.free ? "学生証を確認" : "", r.o.total ? `${yen(r.o.total)}を受け取る` : ""].filter(Boolean).join("・") : "";
  $("camMsg").className = "cam-msg " + (r.ok ? "ok" : "ng");
  $("camMsg").textContent = r.msg + (needs ? "　" + needs : "");
  camMsgTimer = setTimeout(() => { $("camMsg").className = "cam-msg"; $("camMsg").textContent = CAM_IDLE; }, 5000);
}
$("camTog").onclick = () => {
  camWant = !camWant;
  try { localStorage.setItem("reimei-cam", camWant ? "on" : "off"); } catch {}
  camSync();
};
document.addEventListener("visibilitychange", () => camSync());
// 製造：「作った」→ できあがり／「作る方に戻す」→ 受付
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-made]");
  if (!b) return;
  const o = orders.find((x) => x.id === b.dataset.made);
  if (o) o.status = b.dataset.to;   // 先に画面を動かす
  render();
  act({ action: "setStatus", id: b.dataset.made, status: b.dataset.to }, b.dataset.to === "ready" ? `${pad(o?.no)} できあがり` : `${pad(o?.no)} を作る方に戻しました`);
});
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
// 緊急連絡：お客さん向け（guest）とスタッフ向け（staff）を別々に出す／消す
let staffNotice = "";
async function sendNotice(kind, text) {
  const btns = document.querySelectorAll("[data-notice],[data-notice-clear]");
  btns.forEach((b) => (b.disabled = true));
  try {
    await call("setConfig", { staffKey: key, [kind === "staff" ? "staffNotice" : "notice"]: text });
    if (kind === "staff") staffNotice = text; else st.notice = text;
    $(kind === "staff" ? "staffNoticeIn" : "noticeIn").value = "";
    toast((kind === "staff" ? "スタッフ向け" : "お客さん向け") + (text ? "の緊急連絡を出しました" : "の緊急連絡を消しました"));
  } catch { toast("うまくいきませんでした。もう一度押してください"); }
  btns.forEach((b) => (b.disabled = false));
  lastSnap = "";
  render();
  refresh();
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-notice]"), c = e.target.closest("[data-notice-clear]");
  if (b) {
    const t = $(b.dataset.notice === "staff" ? "staffNoticeIn" : "noticeIn").value.trim();
    if (!t) return toast("連絡の文を入れてください");
    sendNotice(b.dataset.notice, t);
  }
  if (c) sendNotice(c.dataset.noticeClear, "");
});
// 注文をすべて消す：押し間違いを防ぐため2回押す（1回目で赤くなり、3秒以内にもう一度）
let resetArmed = false, resetTimer = null;
$("resetOrders").onclick = async () => {
  const b = $("resetOrders");
  if (!resetArmed) {
    resetArmed = true;
    b.classList.add("armed");
    b.textContent = "もう一度押すと消えます（3秒以内）";
    resetTimer = setTimeout(() => { resetArmed = false; b.classList.remove("armed"); b.textContent = "注文をすべて消す"; }, 3000);
    return;
  }
  clearTimeout(resetTimer);
  resetArmed = false;
  b.classList.remove("armed");
  b.disabled = true;
  b.textContent = "消しています…";
  try {
    const r = await call("resetOrders", { staffKey: key });
    toast(`${r.count}件の注文を消しました（「消した注文」シートに控え）`);
  } catch { toast("消せませんでした。もう一度押してください"); }
  b.disabled = false;
  b.textContent = "注文をすべて消す";
  lastSnap = "";
  refresh();
};
$("openSw").onclick = () => {
  st.open = !st.open;
  render();
  act({ action: "setConfig", open: st.open }, st.open ? "受付を始めました" : "受付を止めました");
};
$("soldOut").addEventListener("click", (e) => {
  // モバイルだけの売り切れ（お客さんの画面だけ止める）
  const mb = e.target.closest("[data-msold]");
  if (mb) {
    const m = byCode(mb.dataset.msold);
    m.mobileSoldOut = !m.mobileSoldOut;
    render();
    act({ action: "setConfig", mobileSoldOut: { [m.code]: m.mobileSoldOut } }, m.mobileSoldOut ? "モバイルで売り切れにしました" : "モバイルで販売中に戻しました");
    return;
  }
  const b = e.target.closest("[data-sold]");
  if (!b) return;
  const m = byCode(b.dataset.sold);
  m.soldOut = !m.soldOut;
  render();
  act({ action: "setConfig", soldOut: { [m.code]: m.soldOut } }, m.soldOut ? "店頭で売り切れにしました" : "店頭で販売中に戻しました");
});

$("cCodes").addEventListener("click", (e) => {
  const b = e.target.closest("[data-code]");
  if (!b || b.disabled) return;
  const code = b.dataset.code, m = byCode(code);
  if (e.target.closest("[data-dec-row]")) {
    counter.cart[code] = Math.max(0, (counter.cart[code] || 0) - 1);
    if (!counter.cart[code]) delete counter.cart[code];
  } else {
    const left = remainingOf(m);
    const over = m.soldOut || (left !== null && (counter.cart[code] || 0) >= left);
    if (over && !counter.over?.has(code)) {
      if (!confirm(`${lineName(m)} は売り切れ（在庫なし）になっています。\n作れることを確かめてから注文しますか？`)) return;
      (counter.over ||= new Set()).add(code);
    }
    counter.cart[code] = (counter.cart[code] || 0) + 1;
    if (isPC()) $("cDone").hidden = true;   // 次の注文に入ったら、前の番号の表示は消す
  }
  render();
});
// 店頭の注文：下のバー →「注文へ」→ 学部生か一般かを選ぶ。学部生は学籍番号が必要（学生証の読み取りか手入力）
const cOpen = () => { $("cErr").hidden = true; $("cDone").hidden = true; $("cSheet").classList.remove("done"); $("cSheet").hidden = false; renderCounterSheet(); };
const cClose = () => { $("cDone").hidden = true; $("cSheet").classList.remove("done"); if (isPC()) render(); else $("cSheet").hidden = true; };
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
  counter.sidVia = "typed";
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
  counter.sidVia = "scan";
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
function resetCounter() {
  counter.cid = null;
  counter.over = new Set();
  counter.cart = {};
  counter.sid = "";
  counter.freeLeft = null;
  $("cSid").value = "";
}
// 注文を送っている間は、もう一度押せないようにする（学籍番号の確認の返事で、ボタンが押せる状態に戻らないように）。
// 同じ注文には同じ番号（clientId）を付けるので、万一2回届いても1件として記録される
let ordering = false;
async function counterOrder(type) {
  if (ordering) return;
  ordering = true;
  $("cErr").hidden = true;
  const btn = type === "student" ? $("cAsStu") : $("cAsGen");
  $("cAsStu").disabled = $("cAsGen").disabled = true;
  // 押せたことが分かるように、押したボタンを「登録しています…」のままにする（終わったら番号の画面に変わる）
  const label = btn.textContent;
  btn.classList.add("busy");
  btn.textContent = "登録しています…";
  counter.cid ||= newId();
  const payload = {
    asStaff: true, type, clientId: counter.cid, force: true,
    ...(type === "student" ? { studentId: counter.sid, sidVia: counter.sidVia || "typed" } : {}),
    items: Object.entries(counter.cart).map(([code, qty]) => ({ code, qty })),
  };
  try {
    if (navigator.onLine === false) throw Object.assign(new Error("offline"), { network: true });          // 端末がネットなしと分かっているときは待たない
    const r = await call("order", { ...payload, staffKey: key });
    resetCounter();
    $("cDone").hidden = false;
    $("cDone").html = `<div class="show-no"><small>呼び出し番号</small>${pad(r.no)}</div>${r.free ? `<div class="need-big id">無料 ${r.free}杯（学生証を確認）</div>` : ""}${r.total ? `<div class="need-big cash">${yen(r.total)} を受け取る</div>` : ""}<button class="go wide" type="button" id="cAgain">次の注文へ</button>`;
    $("cAgain").onclick = cClose;
    render();
    lastSnap = "";
    refresh();
  } catch (e) {
    if (e.busy) {
      // サーバーが混んでいるだけ（ネットは切れていない）。押し直してもらう
      $("cErr").textContent = "混み合っています。少し待ってもう一度押してください";
      $("cErr").hidden = false;
    } else if (e.network) {
      // 通信できない：アプリでは受けない。紙で受け付けてもらう
      $("cErr").textContent = "通信できません。この注文は紙に書いて受け付けてください（つながったら、ワンタッチ注文のシートに入れる）";
      $("cErr").hidden = false;
    } else {
      // サーバーが断った（売り切れなど）＝記録されていない。次は新しい番号で送る
      counter.cid = null;
      $("cErr").textContent = { soldOut: "売り切れがあります", needSid: "学籍番号を7桁で入れてください" }[e.message] || "注文を入れられませんでした";
      $("cErr").hidden = false;
    }
  }
  ordering = false;
  btn.classList.remove("busy");
  btn.textContent = label;
  btn.disabled = false;
  renderCounterSheet();
}

// 貯まっている受け渡しの記録を、古い順に送る
let flushing = false;
async function flushQueue() {
  if (flushing || !queue.length) return;
  flushing = true;
  try {
    while (queue.length) {
      const x = queue[0];
      try { await call("pickup", { staffKey: key, id: x.id, via: x.via, late: true }); }
      catch (e) { if (e.network) throw e; }

      queue.shift();
      saveQueue();
    }
  } finally {
    flushing = false;
    render();
  }
}
// パソコン：15秒ごとに最新にする（貯まった分もこのとき送る）。スマホは今までどおり「下に引く」とき
let autoTimer = null;
function startAuto() {
  if (autoTimer) return;
  autoTimer = setInterval(() => { if (isPC() || queue.length) refresh(); }, 15000);
  addEventListener("online", () => refresh());
}
const numLabel = (o) => pad(o?.no);
$("cAsStu").onclick = () => counterOrder("student");
$("cAsGen").onclick = () => counterOrder("general");

function renderCounterSheet() {
  if ($("cSheet").hidden || !st) return;
  const lines = Object.entries(counter.cart).map(([code, qty]) => ({ ...byCode(code), qty }));
  const q = lines.reduce((a, l) => a + l.qty, 0);
  $("cLines").html = !q ? `<li class="muted">メニューの商品を押すと、ここに入ります</li>` : lines.map((l) => `<li>${cupSVG(l)}<span class="code">${esc(l.code)}</span><span class="nm">${esc(lineName(l))}</span><b>×${l.qty}</b><button type="button" class="mini" data-dec="${esc(l.code)}">1杯へらす</button></li>`).join("");
  $("cGenPrice").textContent = yen(q * st.price);
  const ok = /^\d{7}$/.test(counter.sid || "");
  $("cAsStu").disabled = ordering || !ok || !q;
  $("cAsGen").disabled = ordering || !q;
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

// お客さん画面のメニューと同じカード型（上に飲み物の絵、下に呼び出し番号・内容・「渡した」）
function card(o, btn) {
  const tint = byCode(o.lines[0]?.code)?.color || "#999";
  return `<article class="ocard2 ${o.problem ? "bad" : ""}" style="--tint:${tint}">
    <div class="opic">${o.lines.map((l) => `<span class="ocup">${cupSVG({ ...l, color: byCode(l.code)?.color })}${l.qty > 1 ? `<b>×${l.qty}</b>` : ""}</span>`).join("")}${o.byStaff ? `<small class="otag">店頭</small>` : ""}</div>
    ${o.problem ? `<div class="bad-why">⚠ ${esc(o.problem)}</div>` : ""}
    <div class="obody">
      <div class="ono">${pad(o.no)}</div>
      <ul class="olist">${o.lines.map((l) => `<li><span class="code">${esc(l.code)}</span>${nameHtml(l)}${l.qty > 1 ? ` <b>×${l.qty}</b>` : ""}</li>`).join("")}</ul>
      <div class="oneed">${need(o)}</div>
      ${ageBar(o)}
    </div>
    ${btn}
  </article>`;
}
// 名前のうち「アイス」「ホット」の部分だけ文字の色を変える
const nameHtml = (l) => esc(l.name) + (l.variant ? `（<span class="${tempCls(l.variant)}">${esc(l.variant)}</span>）` : "");
// 製造タブのカード：番号・受け取り時間・ドリンク（アイス／ホットを大きく）
function makeCard(o, ready) {
  return `<article class="mk-card ${ready ? "done" : ""}">
    <div class="mk-top"><b class="mk-no">${pad(o.no)}</b><span class="mk-slot">${esc(o.slot || "今すぐ")}</span></div>
    <ul class="mk-lines">${o.lines.map((l) => `<li>${cupSVG({ ...l, color: byCode(l.code)?.color })}<span class="nm">${nameHtml(l)}</span><b class="q">×${l.qty}</b></li>`).join("")}</ul>
    ${ready ? `<button type="button" class="link-btn" data-made="${esc(o.id)}" data-to="new">作る方に戻す</button>` : `<button type="button" class="go mk-btn" data-made="${esc(o.id)}" data-to="ready">作った</button>`}
  </article>`;
}
const list = (arr, fn) => (arr.length ? arr.map(fn).join("") : `<div class="empty">なし</div>`);

function render() {
  if (!st) return;
  const pc = isPC();
  document.body.classList.toggle("pc", pc);
  if (pc && tab === "counter") tab = "kitchen";
  // パソコンでは注文の欄を下から出すシートではなく、メニューの上（右の列の一番上）に常に置く
  const home = pc ? document.querySelector('[data-panel="counter"]') : document.body;
  if ($("cSheet").parentElement !== home) { if (pc) home.prepend($("cSheet")); else home.append($("cSheet")); }
  const pendingPick = new Set(queue.filter((x) => x.kind === "pickup").map((x) => x.id));
  const all = orders.map((o) => (pendingPick.has(o.id) ? { ...o, status: "done" } : o));
  const waiting = all.filter((o) => ["new", "making", "ready"].includes(o.status));

  // スタッフ画面の一番上にはスタッフ向けの緊急連絡を出す（お客さん向けは「管理」で確認できる）
  $("notice").hidden = !staffNotice;
  $("noticeText").textContent = staffNotice;
  $("noticeNow").textContent = st.notice ? "いま出ている：" + st.notice : "いまは出ていません";
  $("staffNoticeNow").textContent = staffNotice ? "いま出ている：" + staffNotice : "いまは出ていません";
  $("state").className = "banner" + (st.open ? "" : " closed");
  $("state").textContent = st.open ? "受付中" : "受付停止中";
  for (const b of $("tabs").children) b.setAttribute("aria-selected", b.dataset.tab === tab);
  if (!maker && tab === "make") tab = "kitchen";
  $("tabs").querySelector('[data-tab="make"]').hidden = !maker;
  const solo = tab === "admin" || tab === "make";   // パソコンでも、この2つは1つだけ大きく出す
  for (const p of document.querySelectorAll("[data-panel]")) p.hidden = pc ? (solo ? p.dataset.panel !== tab : ["admin", "make"].includes(p.dataset.panel)) : p.dataset.panel !== tab;
  if (maker) {
    // 受け取り時間の早い順（店頭の「今すぐ」が先）。「作った」を押すと「できあがり」へ移り、お客さんの画面にも「できあがり」と出る
    const order = (a, b) => (a.slot || "00:00").localeCompare(b.slot || "00:00") || a.no - b.no;
    const todo = waiting.filter((o) => o.status !== "ready").sort(order), ready = waiting.filter((o) => o.status === "ready").sort(order);
    $("cMake").textContent = todo.length;
    $("mkTodo").html = todo.length ? todo.map((o) => makeCard(o, false)).join("") : `<div class="empty">作るものはありません</div>`;
    $("mkReady").html = ready.length ? ready.map((o) => makeCard(o, true)).join("") : `<div class="empty">なし</div>`;
  }
  const unsent = queue.length;
  $("queueInfo").hidden = !unsent;
  $("queueInfo").textContent = `まだ送れていない受け渡し ${unsent}件（つながったら自動で送ります）`;
  $("cKitchen").textContent = waiting.length;
  // 受け取り時間ごとにまとめる（店頭で入れた注文は「今すぐ」）
  const bySlot = {};
  for (const o of waiting) (bySlot[o.slot || "今すぐ"] ??= []).push(o);
  const keys = Object.keys(bySlot).sort((a, b) => (a === "今すぐ" ? -1 : b === "今すぐ" ? 1 : a.localeCompare(b)));
  if (!ordersLoaded) {
    $("colNew").html = `<div class="ocards">${`<div class="ocard2 sk-card"></div>`.repeat(4)}</div>`;
  } else $("colNew").html = keys.length
    ? keys.map((k) => `<h3 class="slot-head">${esc(k)}<span>${bySlot[k].reduce((a, o) => a + o.lines.reduce((b, l) => b + l.qty, 0), 0)}杯</span></h3><div class="ocards">${bySlot[k].map((o) => card(o, `<button type="button" class="give ${armed === o.id ? "armed" : ""}" data-give="${esc(o.id)}">${armed === o.id ? "もう一度で完了" : "渡した"}</button>`)).join("")}</div>`).join("")
    : `<div class="empty">なし</div>`;

  // 店頭で注文
  // お客さん画面と同じカード（3列）
  $("cCodes").html = `<div class="cards">${st.menu.map(viewOf).map((m) => {
    const n = counter.cart[m.code] || 0;
    return `<button type="button" class="card ${n ? "on" : ""} ${m.soldOut ? "out" : ""}" data-code="${m.code}" style="--tint:${m.color || "#999"}">
      <span class="pic">${cupSVG(m)}${n ? `<b class="cnt">×${n}</b>` : ""}${m.soldOut ? `<em class="soldout">売り切れ</em>` : ""}<small class="code">${esc(m.code)}</small></span>
      <span class="nm"><small>${esc(m.variant ? m.name : "")}</small><b class="vn ${tempCls(m.variant)}">${esc(m.variant || m.name)}</b></span>
      <span class="ft">${n ? `<span class="dec" data-dec-row aria-label="1杯へらす">−</span>` : m.stock != null && !m.soldOut ? `<span class="left ${m.remaining <= 3 ? "low" : ""}">のこり${m.remaining}</span>` : ""}<span class="add" aria-hidden="true">＋</span></span>
    </button>`;
  }).join("")}</div>`;
  fitText("#cCodes .vn", 9);
  // 下のバー（店頭で注文のタブでカートに何か入っているときだけ）
  const cl = Object.entries(counter.cart).map(([code, qty]) => ({ ...byCode(code), qty }));
  const cq = cl.reduce((a, l) => a + l.qty, 0);
  $("cBar").hidden = pc || tab !== "counter" || !cq;
  if (pc) $("cSheet").hidden = tab === "admin";
  // 注文を入れた直後（番号を出している間）は、学部生・一般の選択などを隠して番号だけを見せる
  $("cSheet").classList.toggle("done", !$("cDone").hidden && !cq);
  $("cSheet").classList.toggle("empty", pc && !cq && $("cDone").hidden);
  if (cq) {
    $("cCups").html = cl.flatMap((l) => Array(l.qty).fill(cupSVG(l))).slice(0, 5).join("");
    $("cCount").textContent = `${cq}杯`;
  }
  renderCounterSheet();

  camSync();

  // 管理
  for (const b of $("daySeg").children) b.setAttribute("aria-pressed", Number(b.dataset.day) === st.day);
  $("openSw").setAttribute("aria-checked", !!st.open);
  $("openLabel").textContent = st.open ? "受付中（お客さんが注文できます）" : "受付停止中";
  $("soldOut").html = st.menu.map(viewOf).map((m) => `<div class="row">${cupSVG(m)}<span class="code">${esc(m.code)}</span>
    <span style="flex:1;min-width:0">${esc(lineName(m))} ${m.remaining !== null ? `<small class="muted">のこり${m.remaining}</small>` : ""}${m.mobileLeft != null ? ` <small class="muted">（モバイル枠のこり${m.mobileLeft}/${m.mobileCap}）</small>` : ""}${stockGauge(m)}</span>
    <span class="sw2"><small>店頭</small><button class="switch" role="switch" aria-checked="${!m.soldOut}" data-sold="${m.code}" aria-label="${esc(lineName(m))} 店頭で販売中"></button></span>
    <span class="sw2"><small>モバイル</small><button class="switch" role="switch" aria-checked="${!m.mobileSoldOut}" data-msold="${m.code}" aria-label="${esc(lineName(m))} モバイルで販売中"></button></span></div>`).join("");

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

// 新しい版が出たら、注文や操作の途中でないときに自動で読み込み直す
autoUpdate(() => !ordering && !Object.keys(counter.cart).length && !armed && !resetArmed && !camBusy && document.querySelector(".scan-bg") === null);
// Googleから戻ってきたときは、そのまま読み込み画面へ
const back = popRedirectToken();
if (back) loginWith(back); else if (key) enter(); else showLogin();
