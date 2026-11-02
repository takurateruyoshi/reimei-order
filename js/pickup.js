// お客さんのQRを読み取ったスタッフのスマホで開くページ。開いた時点で受け渡しを記録する。
import { call, cachedState, popRedirectToken, savedStaffKey, saveStaffKey, renderGoogleButton } from "./api.js";
import { scanOrderQR } from "./scan.js";
import { esc, pad, yen, cupSVG, ID_ICON, COIN_ICON } from "./ui.js";

const $ = (id) => document.getElementById(id);
const id = new URLSearchParams(location.search).get("o");
let key = savedStaffKey();
let colors = {};

const OK = `<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7" class="line"/></svg>`;
const NG = `<svg viewBox="0 0 24 24"><path d="M7 7l10 10M17 7L7 17" class="line"/></svg>`;
const time = (ms) => new Date(ms).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });

function show(r) {
  const o = r.order;
  const head = {
    ok: ["ok", OK, "受け渡し完了"],
    already: ["already", NG, "もう受け渡し済みです"],
    cancel: ["cancel", NG, "取り消された注文です"],
  }[r.result];
  const need = [
    o.free ? `<span class="need-big id">${ID_ICON}学生証を確認</span>` : "",
    o.total ? `<span class="need-big cash">${COIN_ICON}${yen(o.total)}を受け取る</span>` : "",
  ].join("");
  $("result").html = `<div class="pk ${head[0]}">
    <div class="pk-mark">${head[1]}</div>
    <h2>${head[2]}</h2>
    ${r.result === "already" ? `<p class="muted">${time(o.pickedAt)} に ${esc(o.pickedBy)} が記録</p>` : ""}
    <div class="show-no"><small>注文番号</small>${pad(o.no)}</div>
    ${o.slot ? `<div class="show-slot"><small>受け取り時間</small>${esc(o.slot)}</div>` : ""}
    <ul class="big-items">${o.lines.map((l) => `<li>${cupSVG({ ...l, color: colors[l.code] })}<div><b>${esc(l.name)}</b>${l.variant ? `<span>${esc(l.variant)}</span>` : ""}</div><em>×${l.qty}</em></li>`).join("")}</ul>
    ${r.result === "ok" && o.studentId ? `<div class="sid check"><small>学生証の番号と同じか確認</small>${esc(o.studentId)}</div>` : ""}
    ${r.result === "ok" ? `<div class="needs">${need}</div><button class="link" type="button" id="undo">間違えたので戻す</button>` : ""}
    <button class="go wide scan-btn" type="button" id="next">次のQRを読み取る</button>
    <a class="btn" href="staff.html${location.search.includes("demo") ? "?demo" : ""}">スタッフ画面へ</a>
  </div>`;
  $("next").onclick = nextScan;
  $("result").hidden = false;
  $("loading").hidden = true;
  if (r.result === "ok") { try { navigator.vibrate?.(150); } catch {} }
  $("undo")?.addEventListener("click", async () => {
    await call("setStatus", { staffKey: key, id, status: "new" });
    $("result").html = `<div class="pk"><h2>受け渡し前に戻しました</h2><a class="btn" href="staff.html">スタッフ画面へ</a></div>`;
  });
}

async function nextScan() {
  const r = await scanOrderQR();
  if (!r) return;
  if (r.error) { $("loading").hidden = false; $("loading").textContent = r.error; return; }
  location.replace(`pickup.html?o=${encodeURIComponent(r.orderId)}${location.search.includes("demo") ? "&demo" : ""}`);
}

async function run() {
  if (!id) { $("loading").textContent = "QRコードが正しくありません"; return; }
  try {
    // 色は前回のメニューから。受け渡しの記録はすぐに送る
    (cachedState()?.menu || []).forEach((m) => (colors[m.code] = m.color));
    show(await call("pickup", { staffKey: key, id }));
  } catch (e) {
    if (e.message === "notStaff") { saveStaffKey(null); key = null; login(); return; }
    $("loading").textContent = e.network ? "電波が届きません。まだ記録されていないので、つながってからもう一度読み取ってください"
      : e.message === "notFound" ? "この注文は見つかりません" : "記録できませんでした。もう一度読み取ってください";
  }
}

function login(msg) {
  $("loading").hidden = true;
  $("gate").hidden = false;
  $("gateErr").hidden = !msg;
  if (msg) $("gateErr").textContent = msg;
  renderGoogleButton($("gbtn"), { student: false, onToken: loginWith });
}
async function loginWith(t) {
  $("gate").hidden = true;
  $("loading").hidden = false;
  try {
    const me = await call("me", { idToken: t });
    if (!me.isStaff) return login("このアカウントはスタッフに登録されていません");
    key = me.staffKey;
    saveStaffKey(key);
    run();
  } catch {
    login("ログインできませんでした");
  }
}

const back = popRedirectToken();
if (back) loginWith(back); else if (key) run(); else login();
