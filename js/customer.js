import { SHOP_NAME } from "./config.js";
import { call, newId, watchRev, cachedState, DEMO, resetDemo, savedToken, saveToken, renderGoogleButton } from "./api.js";
import { scanStudentCard } from "./scan.js";
import { esc, pad, yen, lineName, cupSVG, stockGauge, groupMenu, STEP_ICONS, ID_ICON, COIN_ICON } from "./ui.js";

const $ = (id) => document.getElementById(id);
const STEPS = [["new", "受付"], ["making", "作っています"], ["ready", "できあがり"]];
const TICKETS_KEY = "reimei-order-tickets";
const ERR = {
  notStudent: "大学のGoogleアカウント（学部生）でログインしてください",
  closed: "ただいま受付を停止しています",
  soldOut: "売り切れのドリンクがあります。選び直してください",
  tooMany: "1回に頼める杯数をこえています",
  badSlot: "その受け取り時間はもう選べません。選び直してください",
  slotFull: "その受け取り時間はいっぱいになりました。ほかの時間を選んでください",
  dayFull: "本日のモバイルオーダーは売り切れました",
  studentOnly: "モバイルオーダーは学生専用です。店頭の列にお並びください",
  auth: "もう一度ログインしてください",
};
const errMsg = (e) => ERR[e?.message] || "うまくいきませんでした。もう一度試してください";

$("shop").textContent = SHOP_NAME;
if (DEMO) { $("demo").hidden = false; $("reset").onclick = resetDemo; }

let st = null;            // お店の状態（メニュー・受付など）
let cart = {};            // { コード: 杯数 }
let me = null;            // ログイン中の学部生
let token = savedToken();
let orders = [];
let tickets = [];
try { tickets = JSON.parse(localStorage.getItem(TICKETS_KEY)) || []; } catch {}
let lastReady = new Set();

const toast = (msg) => {
  const t = $("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (t.hidden = true), 2600);
};
const byCode = (code) => st?.menu.find((m) => m.code === code);
const cartQty = () => Object.values(cart).reduce((a, n) => a + n, 0);
const cartLines = () => Object.entries(cart).filter(([, n]) => n > 0).map(([code, qty]) => ({ ...byCode(code), qty })).filter((l) => l.code);

// ---------- 読み込み ----------
async function loadState() {
  try {
    st = await call("state");
    // 売り切れになったものはカートから外す
    for (const code of Object.keys(cart)) {
      const m = byCode(code);
      if (!m || m.soldOut) delete cart[code];
      else if (m.remaining !== null && cart[code] > m.remaining) cart[code] = m.remaining;
    }
    $("loading").hidden = true;
    render();
  } catch {
    $("loading").textContent = "読み込めませんでした。電波を確認してください";
  }
}
// 学生証で登録した学籍番号（手で直す欄は作らない）
const CARD_KEY = "reimei-order-card";
let cardSid = null;
try { cardSid = localStorage.getItem(CARD_KEY); } catch {}
const saveCard = (v) => { cardSid = v; try { v ? localStorage.setItem(CARD_KEY, v) : localStorage.removeItem(CARD_KEY); } catch {} };

async function loadMe() {
  if (token) {
    try { me = await call("me", { idToken: token }); return; }
    catch { token = null; saveToken(null); }
  }
  if (cardSid) {
    try { me = { ...(await call("sidInfo", { studentId: cardSid })), isStudent: true, byCard: true }; return; }
    catch { saveCard(null); }
  }
  me = null;
}
async function scanCard() {
  const r = await scanStudentCard();
  if (!r) return;
  if (r.error) { $("sheetErr").textContent = r.error; $("sheetErr").hidden = false; return; }
  token = null; saveToken(null);
  saveCard(r.studentId);
  await loadMe();
  $("sheetErr").hidden = true;
  toast(`学籍番号 ${r.studentId} で登録しました`);
  render();
}
async function pollTickets() {
  if (!tickets.length) { orders = []; renderTickets(); return; }
  try {
    orders = (await call("status", { tickets })).orders.sort((a, b) => b.no - a.no);
    // 受け取り済み・取消は少しだけ残して消す
    const keep = new Set(orders.filter((o) => o.status !== "cancel").slice(0, 5).map((o) => o.id));
    tickets = tickets.filter((t) => keep.has(t.id));
    try { localStorage.setItem(TICKETS_KEY, JSON.stringify(tickets)); } catch {}
    renderTickets();
  } catch {}
}

// ---------- 操作 ----------
$("menu").addEventListener("click", (e) => {
  // 行をタップするとカートに1杯入る。カートに入っている行は、左の番号が「−」になり、そこを押すと1杯へる
  const row = e.target.closest("[data-code]");
  if (!row || row.disabled) return;
  const code = row.dataset.code;
  if (e.target.closest("[data-dec-row]")) {
    cart[code] = Math.max(0, (cart[code] || 0) - 1);
    if (!cart[code]) delete cart[code];
    return render();
  }
  const m = byCode(code);
  if (cartQty() >= st.maxQty) return toast(`1回の注文は${st.maxQty}杯までです`);
  if (m.remaining !== null && (cart[code] || 0) >= m.remaining) return toast("これ以上は残っていません");
  cart[code] = (cart[code] || 0) + 1;
  render();
});

$("toCheckout").onclick = () => { $("sheetErr").hidden = true; $("sheet").hidden = false; renderSheet(); };
$("closeSheet").onclick = () => ($("sheet").hidden = true);
$("lines").addEventListener("click", (e) => {
  const b = e.target.closest("[data-dec]");
  if (!b) return;
  cart[b.dataset.dec] = Math.max(0, (cart[b.dataset.dec] || 0) - 1);
  if (!cart[b.dataset.dec]) delete cart[b.dataset.dec];
  render();
  if (!cartQty()) $("sheet").hidden = true;
});
$("sheet").addEventListener("click", (e) => { if (e.target === $("sheet")) $("sheet").hidden = true; });

$("tickets").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-cancel]");
  if (!b) return;
  const t = tickets.find((x) => x.id === b.dataset.cancel);
  try { await call("cancel", t); toast("取り消しました"); } catch { toast("もう作り始めているので取り消せません"); }
  pollTickets(); loadState(); loadMe();
});

// 受け取り時間：今より後の枠だけ選べる
let slot = null;
const nowHHMM = () => new Date().toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Tokyo" });
// 締め切り（受け取り時間の◯分前）を過ぎた枠と、いっぱいの枠は選べない
const cutoffHHMM = () => {
  const [h, m] = nowHHMM().split(":").map(Number);
  const t = h * 60 + m + (st?.cutoff ?? 10);
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
};
const slotLeft = (t) => st?.slotLeft?.[t] ?? 99;
const openSlots = () => (st?.slots || []).filter((t) => t >= cutoffHHMM() && slotLeft(t) >= Math.max(1, cartQty()));
$("slots").addEventListener("click", (e) => {
  const b = e.target.closest("[data-slot]");
  if (b) { slot = b.dataset.slot; $("sheetErr").hidden = true; renderSheet(); }
});

async function placeOrder(asStudent) {
  if (!slot || !openSlots().includes(slot)) {
    $("sheetErr").textContent = "受け取り時間を選んでください";
    $("sheetErr").hidden = false;
    return;
  }
  // 送る内容に番号（clientId）を付けて保存しておき、届くまで同じ内容を送り直す。
  // スプレッドシートに書き込めたと返事が来てから、はじめて注文完了の画面を出す
  pending = {
    clientId: newId(),
    items: cartLines().map((l) => ({ code: l.code, qty: l.qty })),
    slot,
    ...(asStudent ? (token ? { idToken: token } : { studentId: cardSid }) : {}),
  };
  savePending();
  sendPending();
}

const PENDING_KEY = "reimei-order-pending";
let pending = null, sending = false, retryTimer = null;
try { pending = JSON.parse(localStorage.getItem(PENDING_KEY)); } catch {}
function savePending() {
  try { pending ? localStorage.setItem(PENDING_KEY, JSON.stringify(pending)) : localStorage.removeItem(PENDING_KEY); } catch {}
}
function showSending(text) {
  $("sending").hidden = !text;
  if (text) $("sendingText").textContent = text;
}
async function sendPending() {
  if (!pending || sending) return;
  sending = true;
  clearTimeout(retryTimer);
  $("sheet").hidden = true;
  showSending("スプレッドシートに登録しています…");
  try {
    const r = await call("order", pending);
    pending = null;
    savePending();
    showSending(null);
    tickets.unshift({ id: r.id, secret: r.secret });
    try { localStorage.setItem(TICKETS_KEY, JSON.stringify(tickets)); } catch {}
    cart = {};
    toast(`注文しました（番号 ${pad(r.no)}）`);
    scrollTo({ top: 0, behavior: "smooth" });
    await Promise.all([pollTickets(), loadMe(), loadState()]);
  } catch (e) {
    if (e.network) {
      showSending("電波が届きません。つながったら自動で送り直します（注文はまだ完了していません）");
      retryTimer = setTimeout(sendPending, 4000);
    } else {
      pending = null;
      savePending();
      showSending(null);
      $("sheet").hidden = false;
      renderSheet();
      $("sheetErr").textContent = errMsg(e);
      $("sheetErr").hidden = false;
      loadState();
    }
  } finally {
    sending = false;
  }
}
addEventListener("online", () => sendPending());
$("cancelSend").onclick = () => {
  clearTimeout(retryTimer);
  pending = null;
  savePending();
  showSending(null);
  toast("注文をやめました");
};

// ---------- 表示 ----------
function render() {
  if (!st) return;
  $("closed").hidden = st.open && st.dayLeft !== 0;
  $("closedText").textContent = st.dayLeft === 0 && st.open ? "本日のモバイルオーダーは売り切れました" : "ただいま受付を停止しています";
  $("who").hidden = !me;
  if (me) {
    $("who").html = `<span>学部生 ${esc(me.studentId || "")}</span><button type="button" id="out">ログアウト</button>`;
    $("out").onclick = () => { token = null; me = null; saveToken(null); saveCard(null); render(); };
  }
  const scope = st.freeScope === "total" ? "期間中" : "1日";
  $("priceNote").textContent = `1杯 ${yen(st.price)}` + (st.freeLimit ? `　学部生は${scope}${st.freeLimit}杯無料` : "");

  $("menu").html = groupMenu(st.menu).map((g) => `
    <article class="dish">
      <div class="dish-head">${cupSVG(g.items[0])}<h3>${esc(g.name)}</h3></div>
      <div class="rows">${g.items.map((m) => {
        const n = cart[m.code] || 0;
        return `<button type="button" class="item-row ${n ? "on" : ""} ${m.soldOut ? "out" : ""}" data-code="${m.code}" ${m.soldOut || !st.open ? "disabled" : ""}>
          ${n ? `<span class="dec" data-dec-row aria-label="1杯へらす">−</span>` : `<span class="code">${esc(m.code)}</span>`}
          ${m.variant ? cupSVG(m, "sm") : ""}
          <span class="vname">${esc(m.variant || m.name)}${m.soldOut ? `<em>売り切れ</em>` : stockGauge(m)}</span>
          ${n ? `<span class="qty">×${n}</span>` : ""}
        </button>`;
      }).join("")}</div>
    </article>`).join("");

  const q = cartQty();
  $("bar").hidden = !q;
  if (q) {
    const lines = cartLines();
    $("cartCups").html = lines.flatMap((l) => Array(l.qty).fill(cupSVG(l))).slice(0, 5).join("");
    $("cartCount").textContent = `${q}杯`;
    const free = me?.isStudent ? Math.min(me.freeLeft, q) : 0;
    $("cartHint").textContent = me?.isStudent
      ? (free ? `無料${free}杯${q - free ? ` ＋ ${yen((q - free) * st.price)}` : ""}` : yen(q * st.price))
      : `一般 ${yen(q * st.price)}`;
  }
  if (!$("sheet").hidden) renderSheet();
  renderTickets();
}

function renderSheet() {
  const lines = cartLines();
  const q = cartQty();
  if (!q) { $("sheet").hidden = true; return; }
  $("lines").html = lines.map((l) => `<li>${cupSVG(l)}<span class="code">${esc(l.code)}</span><span class="nm">${esc(lineName(l))}</span><b>×${l.qty}</b><button type="button" class="mini" data-dec="${esc(l.code)}">1杯へらす</button></li>`).join("");
  const avail = openSlots();
  if (slot && !avail.includes(slot)) slot = null;
  $("slots").html = avail.length
    ? avail.map((t) => `<button type="button" class="slot" data-slot="${t}" aria-pressed="${slot === t}">${t}<small>のこり${slotLeft(t)}</small></button>`).join("")
    : `<p class="err">今日の受け取り時間は終わりました</p>`;
  const general = q * st.price;
  if (me?.isStudent) {
    const free = Math.min(me.freeLeft, q);
    const pay = (q - free) * st.price;
    const need = [free ? "学生証を見せて" : "", pay ? `${yen(pay)}を現金で払って` : ""].filter(Boolean).join("、");
    $("pick").html = `<div class="pay-sum">
        <div class="tagp free">${ID_ICON}学部生（${esc(me.byCard ? `学籍番号 ${me.studentId}` : me.email)}）</div>
        <div class="big">${[free ? `無料 ${free}杯` : "", pay ? yen(pay) : ""].filter(Boolean).join(" ＋ ")}</div>
        <small>受け取りのときに${need}ください</small>
      </div>
      <button class="go wide" type="button" id="confirm">この内容で注文する</button>`;
    $("confirm").onclick = () => placeOrder(true);
    return;
  }
  $("pick").html = `<div class="choose">
      <div class="opt-card">
        <div class="tagp free">${ID_ICON}学部生</div>
        <div class="big">${st.freeLimit ? `${Math.min(st.freeLimit, q)}杯無料` : yen(general)}</div>
        <div id="gbtn" data-keep></div>
        <button class="gbtn card" type="button" id="byCard">${ID_ICON}学生証を読み取る</button>
      </div>
      ${st.allowGeneral ? `<div class="opt-card">
        <div class="tagp paid">${COIN_ICON}一般</div>
        <div class="big">${yen(general)}</div>
        <button class="go" type="button" id="asGuest">注文する</button>
        <small>受け取りのとき現金で</small>
      </div>` : `<div class="opt-card"><div class="tagp paid">${COIN_ICON}一般の方</div><small>モバイルオーダーは学生専用です。店頭の列にお並びください</small></div>`}
    </div>`;
  $("asGuest")?.addEventListener("click", () => placeOrder(false));
  $("byCard").onclick = scanCard;
  if (!$("gbtn").childElementCount) renderGoogleButton($("gbtn"), {
    student: true,
    onToken: async (t) => {
      token = t;
      saveToken(t);
      $("pick").html = `<div class="pay-sum"><div class="spinner" aria-hidden="true"></div><small>大学のアカウントを確認しています…</small></div>`;
      await loadMe();
      if (!me?.isStudent) {
        token = null; me = null; saveToken(null);
        $("sheetErr").textContent = ERR.notStudent;
        $("sheetErr").hidden = false;
      } else {
        $("sheetErr").hidden = true;
      }
      render();
    },
  });
}

// 受け渡し用のQR：スタッフのスマホで読み取ると受け取りが記録される
function pickupURL(id) {
  const u = new URL("pickup.html", location.href);
  u.search = "";
  u.searchParams.set("o", id);
  if (DEMO) u.searchParams.set("demo", "");
  return u.href;
}
function qrSVG(text) {
  if (typeof qrcode !== "function") return "";
  const q = qrcode(0, "M");
  q.addData(text);
  q.make();
  return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
}

function renderTickets() {
  const active = orders.filter((o) => ["new", "making", "ready"].includes(o.status));
  const past = orders.filter((o) => o.status === "done").slice(0, 2);
  $("tickets").html = active.map((o) => {
    const idx = STEPS.findIndex(([s]) => s === o.status);
    const ready = o.status === "ready";
    const need = [
      o.free ? `<span class="need-big id">${ID_ICON}学生証を見せる</span>` : "",
      o.total ? `<span class="need-big cash">${COIN_ICON}${yen(o.total)}を払う</span>` : "",
    ].join("");
    return `<article class="show ${ready ? "ready" : ""}">
      <p class="show-hint">この画面を店員さんに見せてね</p>
      <div class="show-no"><small>注文番号</small>${pad(o.no)}</div>
      ${o.slot ? `<div class="show-slot"><small>受け取り時間</small>${esc(o.slot)}</div>` : ""}
      <ul class="big-items">${o.lines.map((l) => `<li>${cupSVG({ ...l, color: byCode(l.code)?.color })}<div><b>${esc(l.name)}</b>${l.variant ? `<span>${esc(l.variant)}</span>` : ""}</div><em>×${l.qty}</em></li>`).join("")}</ul>
      <div class="qr" aria-label="受け渡し用のQRコード">${qrSVG(pickupURL(o.id))}</div>
      <div class="needs">${need}</div>
      ${o.studentId ? `<div class="sid"><small>学籍番号（この番号で呼びます）</small>${esc(o.studentId)}</div>` : ""}
      ${o.status === "new" ? `<button class="link" type="button" data-cancel="${esc(o.id)}">注文を取り消す</button>` : ""}
    </article>`;
  }).join("") + past.map((o) => `<p class="past">${pad(o.no)}　受け取り済み</p>`).join("");

  const readyIds = new Set(active.filter((o) => o.status === "ready").map((o) => o.id));
  for (const id of readyIds) if (!lastReady.has(id)) { try { navigator.vibrate?.([200, 100, 200]); } catch {} }
  lastReady = readyIds;
}

// 前回のメニューがあれば先に出しておく（数秒後に最新に入れかわる）
st = cachedState();
if (st) { $("loading").hidden = true; render(); }
await Promise.all([loadState(), loadMe(), pollTickets()]);
if (pending) sendPending();   // 送っている途中で画面を閉じても、開き直せば続きから送る
render();
// 変更があったときだけ読み直す（念のため30秒ごとにも確認）
watchRev(() => Promise.all([loadState(), pollTickets()]));
setInterval(() => { loadState(); pollTickets(); }, 30000);
