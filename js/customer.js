import { SHOP_NAME } from "./config.js";
import { call, newId, cachedState, popRedirectToken, DEMO, resetDemo, savedToken, saveToken, renderGoogleButton } from "./api.js";
import { scanStudentCard } from "./scan.js";
import SNAPSHOT from "./menu-snapshot.js";
import { pullToRefresh, esc, pad, yen, lineName, cupSVG, stockGauge, groupMenu, STEP_ICONS, ID_ICON, COIN_ICON } from "./ui.js";

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
  if (r.error) { const el = !$("gate").hidden && $("gateErr") ? $("gateErr") : $("sheetErr"); el.textContent = r.error; el.hidden = false; return; }
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
  // カードをタップするとカートに1杯入る。カートに入っているカードは「−」で1杯へる
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
let slot = null, editTime = false;
try { slot = sessionStorage.getItem("reimei-order-slot"); } catch {}
// デモでは ?demo&now=12:00 のように時刻を決めて、受け取り時間の動きを試せる
const NOW_TEST = DEMO && /^\d{1,2}:\d{2}$/.test(new URLSearchParams(location.search).get("now") || "") ? new URLSearchParams(location.search).get("now").padStart(5, "0") : null;
const nowHHMM = () => NOW_TEST || new Date().toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Tokyo" });
// 締め切り（受け取り時間の◯分前）を過ぎた枠と、いっぱいの枠は選べない
const cutoffHHMM = () => {
  const [h, m] = nowHHMM().split(":").map(Number);
  const t = h * 60 + m + (st?.cutoff ?? 10);
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
};
const slotLeft = (t) => st?.slotLeft?.[t] ?? 99;
const openSlots = () => (st?.slots || []).filter((t) => t >= cutoffHHMM() && slotLeft(t) >= Math.max(1, cartQty()));
// 受け取り時間は一覧から選ぶ（受付中／残りわずか／満／受付終了 を表示）
const endOf = (t) => { const [h, m] = t.split(":").map(Number), e = h * 60 + m + 15; return `${String(Math.floor(e / 60)).padStart(2, "0")}:${String(e % 60).padStart(2, "0")}`; };
function slotStatus(t) {
  if (t < cutoffHHMM()) return ["closed", "受付終了"];
  const left = slotLeft(t);
  if (left < Math.max(1, cartQty())) return ["full", "満"];
  if (left <= 5) return ["few", `残りわずか（${left}）`];
  return ["open", "受付中"];
}
// 時間ごとにまとめ、開いた時間の中から選ぶ（選べる時間だけ丸ボタンで出す）
let openHour = null;
// 注文は「ログイン → 受け取り時間 → メニュー」の順に進む
let guest = false;
try { guest = sessionStorage.getItem("reimei-order-guest") === "1"; } catch {}
const STEPS3 = ["商品", "ログイン", "受け取り時間", "確認"];
const stepBar = (i) => `<ol class="steps3">${STEPS3.map((t, k) => `<li class="${k < i ? "done" : k === i ? "now" : ""}"><b>${k + 1}</b>${t}</li>`).join("")}</ol>`;
function gateStep() {
  if (!st || st.snapshot || !st.open) return null;
  if (!me?.isStudent && !guest) return "login";
  if (!slot || !openSlots().includes(slot)) return openSlots().length ? "time" : null;
  return null;
}
function renderGate(step) {
  const g = $("gate");
  g.hidden = !step;
  if (!step) return;
  if (step === "login") {
    g.html = `${stepBar(0)}
      <h2 class="gh">ログイン</h2>
      <p class="gs">学部生は1日${st.freeLimit || 0}杯無料。大学のGoogleアカウントか学生証で確認します</p>
      <div id="gbtn2" data-keep></div>
      <button class="gbtn card wide" type="button" id="byCard2">${ID_ICON}学生証を読み取る</button>
      ${st.allowGeneral ? `<button class="link" type="button" id="asGuest2">一般の方（ログインせずに注文）</button>` : `<p class="gs">一般の方は店頭の列にお並びください</p>`}
      <p class="err" id="gateErr" hidden></p>`;
    $("byCard2").onclick = scanCard;
    $("asGuest2")?.addEventListener("click", () => { guest = true; try { sessionStorage.setItem("reimei-order-guest", "1"); } catch {} render(); });
    if (!$("gbtn2").childElementCount) renderGoogleButton($("gbtn2"), {
      student: true,
      beforeLeave: () => { try { sessionStorage.setItem(LOGIN_KEEP, JSON.stringify({ cart, slot })); } catch {} },
      onToken: async (t) => {
        token = t; saveToken(t);
        await loadMe();
        if (!me?.isStudent) { token = null; me = null; saveToken(null); $("gateErr").textContent = ERR.notStudent; $("gateErr").hidden = false; return; }
        render();
      },
    });
    return;
  }
  g.html = `${stepBar(1)}
    <h2 class="gh">受け取り時間</h2>
    <p class="tnow" id="gnow"></p>
    <ul class="tlist inline" id="glist"></ul>`;
  renderTimes($("glist"), $("gnow"));
}

function renderTimes(listEl = $("tlist"), nowEl = $("tnow")) {
  nowEl.textContent = `いま ${nowHHMM()}　各時間の${st?.cutoff ?? 10}分前に締め切り`;
  const hours = {};
  for (const t of st?.slots || []) (hours[t.slice(0, 2)] ||= []).push(t);
  const okOf = (t) => ["open", "few"].includes(slotStatus(t)[0]);
  if (!openHour || !(hours[openHour] || []).some(okOf)) openHour = (slot && slot.slice(0, 2)) || Object.keys(hours).find((h) => hours[h].some(okOf)) || null;
  listEl.html = Object.entries(hours).map(([h, ts]) => {
    const ok = ts.filter(okOf);
    const shown = ts.filter((t) => slotStatus(t)[0] !== "closed");   // 締め切り前の時間（売り切れも含めて見せる）
    const open = h === openHour && ok.length;
    const why = ok.length ? "" : shown.length ? "売り切れ" : "受付終了";
    return `<li class="hgroup ${open ? "open" : ""} ${ok.length ? "" : "none"}">
      <button type="button" class="hhead" ${ok.length ? `data-hour="${h}"` : "disabled"} aria-expanded="${!!open}">${Number(h)}:00〜${why ? `<span class="why">${why}</span>` : `<span class="chev" aria-hidden="true"></span>`}</button>
      ${open ? `<div class="hslots">${shown.map((t) => {
        const st2 = slotStatus(t)[0], full = st2 === "full";
        const range = `${Number(t.slice(0, 2))}:${t.slice(3)} 〜 ${Number(endOf(t).slice(0, 2))}:${endOf(t).slice(3)}`;
        return `<button type="button" class="tr2 ${full ? "full" : ""}" ${full ? "disabled" : `data-slot="${t}"`} aria-pressed="${slot === t}"><span class="radio" aria-hidden="true"></span><span class="tw">${range}</span>${full ? `<span class="sold">売り切れ</span>` : st2 === "few" ? `<span class="few">残り${slotLeft(t)}</span>` : ""}</button>`;
      }).join("")}</div>` : ""}
    </li>`;
  }).join("");
}
const openTimes = () => { $("tico").innerHTML = cupSVG(st?.menu?.[0] || {}); openHour = null; renderTimes(); $("tsheet").hidden = false; $("tlist").querySelector(".hgroup.open")?.scrollIntoView({ block: "start" }); };
document.addEventListener("click", (e) => { if (e.target.closest("[data-open-times]")) { editTime = true; openHour = null; render(); } });
document.addEventListener("click", (e) => {
  const box = e.target.closest("#tlist, #glist");
  if (!box) return;
  const hb = e.target.closest("[data-hour]");
  if (hb) { openHour = openHour === hb.dataset.hour ? null : hb.dataset.hour; return box.id === "glist" ? render() : renderTimes(); }
  const b = e.target.closest("[data-slot]");
  if (!b) return;
  slot = b.dataset.slot;
  editTime = false;
  try { sessionStorage.setItem("reimei-order-slot", slot); } catch {}
  $("tsheet").hidden = true;
  $("sheetErr").hidden = true;
  render();
});
$("closeT").onclick = () => ($("tsheet").hidden = true);
$("tsheet").addEventListener("click", (e) => { if (e.target === $("tsheet")) $("tsheet").hidden = true; });

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
const STALE = ["soldOut", "badSlot", "slotFull", "dayFull"];
function showSending(text, cancellable = true) {
  $("sending").hidden = !text;
  if (text) $("sendingText").textContent = text;
  $("cancelSend").hidden = !cancellable;
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
    mode = "ticket";
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
      // 画面の更新を待つあいだに売り切れ・枠がいっぱいになっていたら、最新の状況を読み込んでから選び直してもらう
      if (STALE.includes(e.message)) {
        showSending("最新の状況を読み込んでいます…", false);
        await loadState().catch(() => {});
      }
      showSending(null);
      if (e.message === "soldOut") {
        // 商品がなくなった → メニューに戻り、売り切れになった商品を見せる
        $("sheet").hidden = true;
        mode = "order";
        render();
        $("menu").scrollIntoView({ block: "start", behavior: "smooth" });
        toast(ERR.soldOut);
        return;
      }
      if (["slotFull", "badSlot", "dayFull"].includes(e.message)) { slot = null; editTime = true; openHour = null; }   // 時間がだめ → 時間の画面へ
      $("sheet").hidden = false;
      renderSheet();
      $("sheetErr").textContent = errMsg(e);
      $("sheetErr").hidden = false;
      if (!STALE.includes(e.message)) loadState();
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
// カードの名前は1行に収める（入りきらないときだけ文字を小さくする）
function fitNames() {
  document.querySelectorAll("#menu .vn, .big-items b").forEach((el) => {
    el.style.fontSize = "";
    let px = parseFloat(getComputedStyle(el).fontSize);
    const min = el.classList.contains("vn") ? 9 : 12;
    while (el.scrollWidth > el.clientWidth && px > min) el.style.fontSize = (px -= 0.5) + "px";
  });
}
addEventListener("resize", fitNames);
document.fonts?.ready.then(fitNames);   // 字体が届いたあとにもう一度合わせる

function render() {
  if (!st) return;
  $("closed").hidden = st.open && st.dayLeft !== 0;
  $("closedText").textContent = st.dayLeft === 0 && st.open ? "本日のモバイルオーダーは売り切れました" : "ただいま受付を停止しています";
  $("who").hidden = !me;
  if (me) {
    $("who").html = `<span>学部生 ${esc(me.studentId || "")}</span><button type="button" id="out">ログアウト</button>`;
    $("out").onclick = () => { token = null; me = null; saveToken(null); saveCard(null); guest = false; try { sessionStorage.removeItem("reimei-order-guest"); } catch {} render(); };
  }
  const scope = st.freeScope === "total" ? "期間中" : "1日";
  $("priceNote").textContent = st.snapshot ? "最新の売り切れ・残り数を確認しています…" : `1杯 ${yen(st.price)}` + (st.freeLimit ? `　学部生は${scope}${st.freeLimit}杯無料` : "");

  // 全部の飲み物を写真付きカードで3列に並べ、1画面に収める（スクロールせずに選べる）
  $("menu").html = `<div class="cards">${st.menu.map((m) => {
    const n = cart[m.code] || 0;
    return `<button type="button" class="card ${n ? "on" : ""} ${m.soldOut ? "out" : ""}" data-code="${m.code}" style="--tint:${m.color || "#999"}" ${m.soldOut || !st.open || st.snapshot ? "disabled" : ""}>
      <span class="pic">${cupSVG(m)}${n ? `<b class="cnt">×${n}</b>` : ""}${m.soldOut ? `<em class="soldout">売り切れ</em>` : ""}<small class="code">${esc(m.code)}</small></span>
      <span class="nm"><small>${esc(m.variant ? m.name : "")}</small><b class="vn">${esc(m.variant || m.name)}</b></span>
      <span class="ft">${n ? `<span class="dec" data-dec-row aria-label="1杯へらす">−</span>` : m.stock != null && !m.soldOut ? `<span class="left ${m.remaining <= 3 ? "low" : ""}">のこり${m.remaining}</span>` : ""}<span class="add" aria-hidden="true">＋</span></span>
    </button>`;
  }).join("")}</div>`;
  fitNames();

  const anyOpen = openSlots().length > 0;
  $("tbar").dataset.off = "1";   // 受け取り時間はログインのあとに選ぶ
  $("tbar").hidden = $("tbar").dataset.off === "1";
  $("tbar").html = slot
    ? `<svg class="ti" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg><span class="tl"><small>受け取り時間</small>${slot}〜${endOf(slot)}</span><span class="tch">変更</span>`
    : anyOpen
      ? `<svg class="ti" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg><span class="tl"><small>受け取り時間</small>まだ選んでいません</span><span class="tch">選ぶ ›</span>`
      : `<svg class="ti" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg><span class="tl"><small>受け取り時間</small>今日の受付は終わりました</span><span class="tch"></span>`;
  if (!$("tsheet").hidden) renderTimes();

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
  // 商品 → ログイン → 受け取り時間 → 確認
  const step = !me?.isStudent && !guest ? 1 : !slot || editTime || !openSlots().includes(slot) ? 2 : 3;
  $("sheetTitle").textContent = ["", "ログイン", "受け取り時間", "注文の確認"][step];
  $("sheetSteps").html = stepBar(step);
  $("sheet").querySelector(".sheet").classList.toggle("tall", step === 2);   // 時間選択は画面いっぱいに大きく出す
  $("lines").html = lines.map((l) => `<li>${cupSVG(l)}<span class="code">${esc(l.code)}</span><span class="nm">${esc(lineName(l))}</span><b>×${l.qty}</b><button type="button" class="mini" data-dec="${esc(l.code)}">1杯へらす</button></li>`).join("");
  if (step === 2) {
    $("slots").html = openSlots().length || (st.slots || []).some((t) => t >= cutoffHHMM())
      ? `<p class="tnow" id="gnow"></p><ul class="tlist inline" id="glist"></ul>`
      : `<p class="err">今日の受け取り時間は終わりました</p>`;
    if ($("glist")) renderTimes($("glist"), $("gnow"));
    $("pick").html = "";
    return;
  }
  $("slots").html = step === 3
    ? `<button type="button" class="tpick on" data-open-times><span class="tw"><small class="tlab">受け取り時間</small>${slot}<small>〜${endOf(slot)}</small></span><span class="tch">変更</span></button>`
    : "";
  const general = q * st.price;
  if (guest && !me?.isStudent) {
    $("pick").html = `<div class="pay-sum"><div class="tagp paid">${COIN_ICON}一般</div><div class="big">${yen(general)}</div><small>受け取りのとき現金で払ってください</small></div>
      <button class="go wide" type="button" id="confirm">この内容で注文する</button>`;
    $("confirm").onclick = () => placeOrder(false);
    return;
  }
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
        <button class="go" type="button" id="asGuest">一般の方として進む</button>
        <small>受け取りのとき現金で</small>
      </div>` : `<div class="opt-card"><div class="tagp paid">${COIN_ICON}一般の方</div><small>モバイルオーダーは学生専用です。店頭の列にお並びください</small></div>`}
    </div>`;
  $("asGuest")?.addEventListener("click", () => { guest = true; try { sessionStorage.setItem("reimei-order-guest", "1"); } catch {} render(); });
  $("byCard").onclick = scanCard;
  if (!$("gbtn").childElementCount) renderGoogleButton($("gbtn"), {
    student: true,
    // Googleのページへ移る前に、カートと受け取り時間を覚えておく
    beforeLeave: () => { try { sessionStorage.setItem(LOGIN_KEEP, JSON.stringify({ cart, slot })); } catch {} },
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
  activeCount = active.length;
  const past = orders.filter((o) => o.status === "done").slice(0, 2);
  $("tickets").html = active.map((o, i) => {
    const idx = STEPS.findIndex(([s]) => s === o.status);
    const ready = o.status === "ready";
    const need = [
      o.free ? `<span class="need-big id">${ID_ICON}学生証を見せる</span>` : "",
      o.total ? `<span class="need-big cash">${COIN_ICON}${yen(o.total)}を払う</span>` : "",
    ].join("");
    return `<article class="show ${ready ? "ready" : ""}">
      <p class="show-hint">この画面を店員さんに見せてね</p>
      <div class="show-top">
        ${o.slot ? `<div class="show-slot"><small>受け取り時間</small>${esc(o.slot)}</div>` : ""}
        <div class="show-no">注文番号 ${pad(o.no)}${active.length > 1 ? `　${i + 1}/${active.length}` : ""}</div>
      </div>
      <ul class="big-items n${Math.min(o.lines.length, 4)}">${o.lines.map((l) => `<li>${cupSVG({ ...l, color: byCode(l.code)?.color })}<div><b>${esc(l.name)}</b>${l.variant ? `<span>${esc(l.variant)}</span>` : ""}</div><em>×${l.qty}</em></li>`).join("")}</ul>
      <div class="show-foot">
        <div class="show-info">
          ${o.studentId ? `<div class="sid"><small>学籍番号（この番号で呼びます）</small>${esc(o.studentId)}</div>` : ""}
          <div class="needs">${need}</div>
        </div>
        <div class="qr" aria-label="受け渡し用のQRコード">${qrSVG(pickupURL(o.id))}</div>
      </div>
      ${o.status === "new" ? `<button class="link" type="button" data-cancel="${esc(o.id)}">注文を取り消す</button>` : ""}
    </article>`;
  }).join("");
  $("tickets").classList.toggle("many", active.length > 1);

  const readyIds = new Set(active.filter((o) => o.status === "ready").map((o) => o.id));
  for (const id of readyIds) if (!lastReady.has(id)) { try { navigator.vibrate?.([200, 100, 200]); } catch {} }
  lastReady = readyIds;
  fitNames();
  applyMode();
}

// 受け取り待ちの注文があるときは「受け取り」と「注文する」を切り替える（どちらも1画面に収める）
let mode = null, activeCount = 0;
function applyMode() {
  const has = activeCount > 0;
  const t = has && (mode || "ticket") === "ticket";   // 受け取り待ちがあれば、開いたときは受け取り画面から
  $("tcount").textContent = has ? activeCount : "";
  $("tickets").hidden = !t;
  const step = null;   // 手順は注文の確認シートの中で進める
  renderGate(step);
  const off = t || !!step;
  for (const id of ["priceNote", "tbar", "menu"]) $(id).hidden = off || (id === "tbar" && $(id).dataset.off === "1");
  $("bar").hidden = off || !cartQty();
  // 左下の矢印で注文に戻る／右下のボタンで受け取り画面へ
  $("navBack").hidden = !t;
  $("navTicket").hidden = t || !has;
  $("navTicket").classList.toggle("up", !$("bar").hidden);
}
$("navBack").onclick = () => { mode = "order"; applyMode(); scrollTo({ top: 0 }); };
$("navTicket").onclick = () => { mode = "ticket"; applyMode(); scrollTo({ top: 0 }); };

// Googleから戻ってきたら、カートと受け取り時間を戻して、注文の確認画面を開き直す
const LOGIN_KEEP = "reimei-order-before-login";
const backToken = popRedirectToken();
if (backToken) {
  token = backToken;
  saveToken(backToken);
  try { const k = JSON.parse(sessionStorage.getItem(LOGIN_KEEP)) || {}; cart = k.cart || {}; slot = k.slot || null; } catch {}
  try { sessionStorage.removeItem(LOGIN_KEEP); } catch {}
}

// 前回のメニューがあれば先に出しておく（数秒後に最新に入れかわる）
// 初めてなら見本のメニューを出し、確認が終わるまで注文は押せないようにしておく
st = cachedState() || { ...SNAPSHOT, snapshot: true };
$("loading").hidden = true;
render();
await Promise.all([loadState(), loadMe(), pollTickets()]);
if (backToken) {
  if (!me?.isStudent) { token = null; me = null; saveToken(null); }
  if (cartQty()) { $("sheet").hidden = false; renderSheet(); }
  if (!me) { $("sheetErr").textContent = ERR.notStudent; $("sheetErr").hidden = false; }
  render();
}
if (pending) sendPending();   // 送っている途中で画面を閉じても、開き直せば続きから送る
render();
// 最新にするのは「画面を下に引っぱったとき」と「アプリに戻ってきたとき」だけ（自動の問い合わせはしない）。
// その間に売り切れても、注文時にサーバーが確かめて最新を読み直す
const refresh = () => Promise.all([loadState(), pollTickets()]);
document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
pullToRefresh(refresh, () => !$("sheet").hidden || !$("tsheet").hidden);

