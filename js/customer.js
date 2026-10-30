import { SHOP_NAME } from "./config.js";
import { call, DEMO, resetDemo, savedToken, saveToken, renderGoogleButton } from "./api.js";
import { esc, pad, yen, lineName, cupSVG, stockGauge, groupMenu, STEP_ICONS, ID_ICON, COIN_ICON } from "./ui.js";

const $ = (id) => document.getElementById(id);
const STEPS = [["new", "受付"], ["making", "作っています"], ["ready", "できあがり"]];
const TICKETS_KEY = "reimei-order-tickets";
const ERR = {
  notStudent: "大学のGoogleアカウント（学部生）でログインしてください",
  closed: "ただいま受付を停止しています",
  soldOut: "売り切れのドリンクがあります。選び直してください",
  tooMany: "1回に頼める杯数をこえています",
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
async function loadMe() {
  if (!token) { me = null; return; }
  try { me = await call("me", { idToken: token }); }
  catch { me = null; token = null; saveToken(null); }
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
  const minus = e.target.closest("[data-minus]");
  const row = e.target.closest("[data-code]");
  if (!row || row.disabled) return;
  const code = row.dataset.code;
  const m = byCode(code);
  if (minus) {
    cart[code] = Math.max(0, (cart[code] || 0) - 1);
  } else {
    if (cartQty() >= st.maxQty) return toast(`1回の注文は${st.maxQty}杯までです`);
    if (m.remaining !== null && (cart[code] || 0) >= m.remaining) return toast("これ以上は残っていません");
    cart[code] = (cart[code] || 0) + 1;
  }
  render();
});

$("toCheckout").onclick = () => { $("sheetErr").hidden = true; $("sheet").hidden = false; renderSheet(); };
$("closeSheet").onclick = () => ($("sheet").hidden = true);
$("sheet").addEventListener("click", (e) => { if (e.target === $("sheet")) $("sheet").hidden = true; });

$("tickets").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-cancel]");
  if (!b) return;
  const t = tickets.find((x) => x.id === b.dataset.cancel);
  try { await call("cancel", t); toast("取り消しました"); } catch { toast("もう作り始めているので取り消せません"); }
  pollTickets(); loadState(); loadMe();
});

async function placeOrder(asStudent) {
  const btn = document.querySelector("#pick .go");
  if (btn) btn.disabled = true;
  try {
    const r = await call("order", {
      items: cartLines().map((l) => ({ code: l.code, qty: l.qty })),
      ...(asStudent ? { idToken: token } : {}),
    });
    tickets.unshift({ id: r.id, secret: r.secret });
    try { localStorage.setItem(TICKETS_KEY, JSON.stringify(tickets)); } catch {}
    cart = {};
    $("sheet").hidden = true;
    toast(`注文しました（番号 ${pad(r.no)}）`);
    scrollTo({ top: 0, behavior: "smooth" });
    await Promise.all([pollTickets(), loadMe(), loadState()]);
  } catch (e) {
    $("sheetErr").textContent = errMsg(e);
    $("sheetErr").hidden = false;
    if (btn) btn.disabled = false;
    loadState();
  }
}

// ---------- 表示 ----------
function render() {
  if (!st) return;
  $("closed").hidden = st.open;
  $("who").hidden = !me;
  if (me) {
    $("who").innerHTML = `<span>学部生</span><button type="button" id="out">ログアウト</button>`;
    $("out").onclick = () => { token = null; me = null; saveToken(null); render(); };
  }
  const scope = st.freeScope === "total" ? "期間中" : "1日";
  $("priceNote").innerHTML =
    `<span class="tagp paid">${COIN_ICON}1杯 ${yen(st.price)}</span>` +
    (st.freeLimit ? `<span class="tagp free">${ID_ICON}学部生は${scope}${st.freeLimit}杯無料</span>` : "");

  $("menu").innerHTML = groupMenu(st.menu).map((g) => `
    <article class="dish">
      <div class="dish-head">${cupSVG(g.items[0])}<h3>${esc(g.name)}</h3></div>
      <div class="rows">${g.items.map((m) => {
        const n = cart[m.code] || 0;
        return `<button type="button" class="item-row ${n ? "on" : ""} ${m.soldOut ? "out" : ""}" data-code="${m.code}" ${m.soldOut || !st.open ? "disabled" : ""}>
          <span class="code">${esc(m.code)}</span>
          ${m.variant ? cupSVG(m, "sm") : ""}
          <span class="vname">${esc(m.variant || m.name)}${m.soldOut ? `<em>売り切れ</em>` : stockGauge(m)}</span>
          ${n ? `<span class="minus" data-minus aria-label="1つ減らす">−</span><span class="qty">${n}</span>` : ""}
          <span class="plus" aria-hidden="true">＋</span>
        </button>`;
      }).join("")}</div>
    </article>`).join("");

  const q = cartQty();
  $("bar").hidden = !q;
  if (q) {
    const lines = cartLines();
    $("cartCups").innerHTML = lines.flatMap((l) => Array(l.qty).fill(cupSVG(l))).slice(0, 5).join("");
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
  $("lines").innerHTML = lines.map((l) => `<li>${cupSVG(l)}<span class="code">${esc(l.code)}</span><span class="nm">${esc(lineName(l))}</span><b>×${l.qty}</b></li>`).join("");
  const general = q * st.price;
  if (me?.isStudent) {
    const free = Math.min(me.freeLeft, q);
    const pay = (q - free) * st.price;
    const need = [free ? "学生証を見せて" : "", pay ? `${yen(pay)}を現金で払って` : ""].filter(Boolean).join("、");
    $("pick").innerHTML = `<div class="pay-sum">
        <div class="tagp free">${ID_ICON}学部生（${esc(me.email)}）</div>
        <div class="big">${[free ? `無料 ${free}杯` : "", pay ? yen(pay) : ""].filter(Boolean).join(" ＋ ")}</div>
        <small>受け取りのときに${need}ください</small>
      </div>
      <button class="go wide" type="button" id="confirm">この内容で注文する</button>`;
    $("confirm").onclick = () => placeOrder(true);
    return;
  }
  $("pick").innerHTML = `<div class="choose">
      <div class="opt-card">
        <div class="tagp free">${ID_ICON}学部生</div>
        <div class="big">${st.freeLimit ? `${Math.min(st.freeLimit, q)}杯無料` : yen(general)}</div>
        <div id="gbtn"></div>
      </div>
      <div class="opt-card">
        <div class="tagp paid">${COIN_ICON}一般</div>
        <div class="big">${yen(general)}</div>
        <button class="go" type="button" id="asGuest">注文する</button>
        <small>受け取りのとき現金で</small>
      </div>
    </div>`;
  $("asGuest").onclick = () => placeOrder(false);
  renderGoogleButton($("gbtn"), {
    student: true,
    onToken: async (t) => {
      token = t;
      saveToken(t);
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

function renderTickets() {
  const active = orders.filter((o) => ["new", "making", "ready"].includes(o.status));
  const past = orders.filter((o) => o.status === "done").slice(0, 2);
  $("tickets").innerHTML = active.map((o) => {
    const idx = STEPS.findIndex(([s]) => s === o.status);
    const ready = o.status === "ready";
    const need = [o.free ? `<span class="tagp free">${ID_ICON}学生証</span>` : "", o.total ? `<span class="tagp paid">${COIN_ICON}${yen(o.total)} 現金</span>` : ""].join("");
    return `<article class="ticket ${ready ? "ready" : ""}">
      <div class="no"><small>注文番号</small>${pad(o.no)}</div>
      <div class="what">${o.lines.map((l) => `<span class="ln">${cupSVG({ ...l, color: byCode(l.code)?.color })}${esc(lineName(l))}${l.qty > 1 ? ` ×${l.qty}` : ""}</span>`).join("")}</div>
      <div class="need-row">${need}</div>
      <div class="steps">
        <div class="bar-fill" style="width:${idx * 34}%"></div>
        ${STEPS.map(([s, t], i) => `<div class="step ${i < idx ? "done" : ""} ${i === idx ? "now" : ""} ${s === "ready" ? "bell" : ""}"><i>${STEP_ICONS[s]}</i>${t}</div>`).join("")}
      </div>
      ${ready ? `<div class="show">カウンターで受け取ってください</div>` : ""}
      ${o.status === "new" ? `<button class="link" type="button" data-cancel="${esc(o.id)}">取り消す</button>` : ""}
    </article>`;
  }).join("") + past.map((o) => `<article class="ticket past"><div class="no">${pad(o.no)}</div><div class="what">受け取り済み</div></article>`).join("");

  const readyIds = new Set(active.filter((o) => o.status === "ready").map((o) => o.id));
  for (const id of readyIds) if (!lastReady.has(id)) { try { navigator.vibrate?.([200, 100, 200]); } catch {} }
  lastReady = readyIds;
}

await Promise.all([loadState(), loadMe(), pollTickets()]);
render();
setInterval(pollTickets, 5000);
setInterval(loadState, 20000);
