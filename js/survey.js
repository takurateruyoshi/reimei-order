// スタッフアンケート：スタッフ画面と同じログイン（保存してある staffKey）で答える。
// 画面の写真をタップして「どこが」を指してもらい、結果は担当ごとに2つ並べて比べられる
import { call, savedStaffKey, DEMO } from "./api.js";
import { esc } from "./ui.js";

const $ = (id) => document.getElementById(id);
const key = DEMO ? "demo-key" : savedStaffKey();

const ROLES = ["受け渡し", "店頭の注文", "製造", "会計", "管理", "シート操作", "その他"];
const DAYS = ["1日目", "2日目", "両日"];
const HOURS = ["午前（〜12時）", "昼（12〜14時）", "午後（14時〜）"];
const FEATURES = [
  ["qr", "QRでの受け渡し"],
  ["card", "学生証のバーコードでの受け渡し"],
  ["give", "「渡した」ボタン（2回押し）"],
  ["counter", "店頭で注文（学籍番号の入力・読み取り）"],
  ["make", "製造タブ"],
  ["admin", "管理（売り切れ・受付・モバイル枠）"],
  ["sheet", "ワンタッチ注文・シートでの修正"],
  ["bell", "新しい注文の音"],
  ["speed", "画面の速さ（反映までの時間）"],
];
const KINDS = [
  { k: "hard", label: "使いにくい", mark: "✕", color: "#c0392b" },
  { k: "unclear", label: "分かりにくい", mark: "?", color: "#d9701f" },
  { k: "bug", label: "不具合", mark: "!", color: "#6b4bb8" },
  { k: "good", label: "よかった", mark: "○", color: "#2e7d5b" },
];
const kindOf = (k) => KINDS.find((x) => x.k === k) || KINDS[0];
const SCREENS = [
  ["客", "c-menu", "メニュー"], ["客", "c-time", "受け取り時間"], ["客", "c-confirm", "注文の確認"], ["客", "c-ticket", "QRの画面"], ["客", "c-done", "受け渡し完了"],
  ["スタッフ", "s-kitchen", "受け渡し（カメラ）"], ["スタッフ", "s-armed", "「渡した」ボタン"], ["スタッフ", "s-counter", "店頭で注文"], ["スタッフ", "s-sheet", "店頭の確認"], ["スタッフ", "s-done", "店頭の番号表示"],
  ["スタッフ", "s-admin", "管理"], ["スタッフ", "s-menu", "売り切れのスイッチ"], ["スタッフ", "s-offline", "圏外のとき"],
  ["シート", "g-quick", "ワンタッチ注文"], ["シート", "g-stock", "メニュー（在庫）"], ["シート", "g-order", "注文シート"], ["シート", "g-notice", "緊急連絡"],
];
const screenName = (id) => (SCREENS.find((s) => s[1] === id) || [, , id])[2];
const isWide = (id) => id.startsWith("g-");
const imgOf = (id) => `img/survey/${id}.jpg`;

const toast = (msg) => {
  const t = $("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (t.hidden = true), 2600);
};

// ---------- 答える ----------
const ans = { roles: new Set(), days: "", hours: new Set(), ratings: {}, pins: [] };
let screen = SCREENS[0][1];

function chips(el, list, isOn, onTap) {
  el.innerHTML = list.map((v) => `<button type="button" class="chip" aria-pressed="${isOn(v)}">${esc(v)}</button>`).join("");
  el.onclick = (e) => {
    const b = e.target.closest(".chip");
    if (!b) return;
    onTap(list[[...el.children].indexOf(b)]);
    chips(el, list, isOn, onTap);
  };
}
const toggle = (set, v) => (set.has(v) ? set.delete(v) : set.add(v));

function renderRates() {
  $("rates").innerHTML = FEATURES.map(([k, label]) => {
    const v = ans.ratings[k] ?? null;
    return `<div class="rate"><span class="rate-name">${esc(label)}</span><div class="rate-btns" data-k="${k}">
      ${[0, 1, 2, 3, 4, 5].map((n) => `<button type="button" data-n="${n}" aria-pressed="${n === 0 ? v === null : v === n}">${n === 0 ? "—" : n}</button>`).join("")}
    </div></div>`;
  }).join("");
}
$("rates").addEventListener("click", (e) => {
  const b = e.target.closest("[data-n]");
  if (!b) return;
  const k = b.parentElement.dataset.k, n = Number(b.dataset.n);
  if (n === 0) delete ans.ratings[k]; else ans.ratings[k] = n;
  renderRates();
});

function renderShots() {
  const groups = [...new Set(SCREENS.map((s) => s[0]))];
  $("shots").innerHTML = groups.map((g) => `<div class="shot-group"><small>${g === "客" ? "お客さんの画面" : g === "スタッフ" ? "スタッフ画面" : "スプレッドシート"}</small><div class="shot-row">
    ${SCREENS.filter((s) => s[0] === g).map(([, id, name]) => {
      const n = ans.pins.filter((p) => p.screen === id).length;
      return `<button type="button" class="shot ${isWide(id) ? "w" : ""}" data-screen="${id}" aria-pressed="${id === screen}"><img src="${imgOf(id)}" alt="" loading="lazy"><span>${esc(name)}</span>${n ? `<b>${n}</b>` : ""}</button>`;
    }).join("")}</div></div>`).join("");
}
$("shots").addEventListener("click", (e) => {
  const b = e.target.closest("[data-screen]");
  if (!b) return;
  screen = b.dataset.screen;
  renderShots();
  renderStage();
});

function pinHtml(p, i, extra = "") {
  const k = kindOf(p.kind);
  return `<span class="pin ${extra}" style="left:${p.x * 100}%;top:${p.y * 100}%;--c:${k.color}" title="${esc(k.label)}${p.text ? "：" + esc(p.text) : ""}">${i == null ? k.mark : i + 1}</span>`;
}
function renderStage() {
  $("stageShot").src = imgOf(screen);
  $("stageShot").alt = screenName(screen);
  $("stageImg").classList.toggle("w", isWide(screen));
  $("stageImg").querySelectorAll(".pin").forEach((e) => e.remove());
  ans.pins.forEach((p, i) => { if (p.screen === screen) $("stageImg").insertAdjacentHTML("beforeend", pinHtml(p, i)); });
  $("pinList").innerHTML = ans.pins.map((p, i) => {
    const k = kindOf(p.kind);
    return `<li><span class="pin static" style="--c:${k.color}">${i + 1}</span><span><b>${esc(screenName(p.screen))}</b>　${esc(k.label)}${p.text ? `<br><small>${esc(p.text)}</small>` : ""}</span><button type="button" class="ghost" data-del="${i}">消す</button></li>`;
  }).join("");
}
$("pinList").addEventListener("click", (e) => {
  const b = e.target.closest("[data-del]");
  if (!b) return;
  ans.pins.splice(Number(b.dataset.del), 1);
  renderShots();
  renderStage();
});

// タップした場所に印を付ける（種類とひとことを聞く）
let draft = null, draftKind = "hard";
$("stageImg").addEventListener("click", (e) => {
  if (e.target.closest(".pin")) return;
  const r = $("stageShot").getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
  if (x < 0 || x > 1 || y < 0 || y > 1) return;
  draft = { screen, x: +x.toFixed(4), y: +y.toFixed(4) };
  $("stageImg").insertAdjacentHTML("beforeend", pinHtml({ ...draft, kind: draftKind }, null, "draft"));
  $("popText").value = "";
  renderKinds();
  $("pop").hidden = false;
  setTimeout(() => $("popText").focus(), 50);
});
function renderKinds() {
  $("popKinds").innerHTML = KINDS.map((k) => `<button type="button" class="chip" data-kind="${k.k}" aria-pressed="${k.k === draftKind}" style="--c:${k.color}"><i>${k.mark}</i>${k.label}</button>`).join("");
}
$("popKinds").addEventListener("click", (e) => {
  const b = e.target.closest("[data-kind]");
  if (!b) return;
  draftKind = b.dataset.kind;
  renderKinds();
  const d = $("stageImg").querySelector(".pin.draft");
  if (d) { d.style.setProperty("--c", kindOf(draftKind).color); d.textContent = kindOf(draftKind).mark; }
});
const closePop = () => { $("pop").hidden = true; draft = null; renderStage(); };
$("popCancel").onclick = closePop;
$("popOk").onclick = () => {
  if (draft) ans.pins.push({ ...draft, kind: draftKind, text: $("popText").value.trim().slice(0, 300) });
  closePop();
  renderShots();
};

$("send").onclick = async () => {
  const b = $("send");
  if (!ans.roles.size) { $("err").textContent = "担当した仕事を1つ以上選んでください"; $("err").hidden = false; return; }
  $("err").hidden = true;
  b.disabled = true;
  b.textContent = "送っています…";
  try {
    await call("surveySubmit", {
      staffKey: key, roles: [...ans.roles], days: ans.days, hours: [...ans.hours].join("・"), ratings: ans.ratings, pins: ans.pins,
      texts: { good: $("tGood").value, trouble: $("tTrouble").value, wish: $("tWish").value, other: $("tOther").value },
    });
    try { localStorage.setItem("reimei-survey-done", "1"); } catch {}
    $("answer").hidden = true;
    $("thanks").hidden = false;
    scrollTo(0, 0);
  } catch (e) {
    $("err").textContent = e.message === "notStaff" ? "ログインが切れています。スタッフ画面でログインし直してください" : "送れませんでした。電波を確かめて、もう一度押してください";
    $("err").hidden = false;
  }
  b.disabled = false;
  b.textContent = "送る";
};

// ---------- 結果を比べる ----------
let res = null;
const GROUPS = ["全員", ...ROLES];
const inGroup = (g) => (r) => g === "全員" || (r.roles || []).includes(g);

async function loadResults() {
  $("resCount").textContent = "読み込んでいます…";
  try {
    res = await call("surveyResults", { staffKey: key });
    renderResults();
  } catch {
    $("resCount").textContent = "読み込めませんでした。もう一度開いてください";
  }
}
function renderResults() {
  const A = $("grpA").value, B = $("grpB").value;
  const ra = res.responses.filter(inGroup(A)), rb = res.responses.filter(inGroup(B));
  const pa = res.pins.filter(inGroup(A)), pb = res.pins.filter(inGroup(B));
  $("resCount").textContent = `回答 ${res.responses.length}人（A：${A} ${ra.length}人　B：${B} ${rb.length}人）`;
  $("legA").textContent = A;
  $("legB").textContent = B;

  const avg = (list, k) => {
    const v = list.map((r) => r.ratings?.[k]).filter((n) => n >= 1 && n <= 5);
    return v.length ? { m: v.reduce((a, n) => a + n, 0) / v.length, n: v.length } : null;
  };
  const bar = (x, cls) => x
    ? `<div class="bar ${cls}"><span class="track"><i style="width:${(x.m / 5) * 100}%"></i></span><b>${x.m.toFixed(1)}</b><small>${x.n}人</small></div>`
    : `<div class="bar ${cls} none"><span class="track"></span><b>—</b><small>回答なし</small></div>`;
  $("resRates").innerHTML = FEATURES.map(([k, label]) => `<div class="rrow"><span class="rate-name">${esc(label)}</span><div class="bars">${bar(avg(ra, k), "a")}${bar(avg(rb, k), "b")}</div></div>`).join("");

  $("kindLegend").innerHTML = KINDS.map((k) => `<span><i class="pin static" style="--c:${k.color}">${k.mark}</i>${k.label}</span>`).join("");
  // 指摘の多い画面から並べる。指摘のない画面は「すべての画面」を押したときだけ出す
  const cnt = (id) => pa.filter((p) => p.screen === id).length + pb.filter((p) => p.screen === id).length;
  const list = SCREENS.filter(([, id]) => showAll || cnt(id) > 0).sort((x, y) => cnt(y[1]) - cnt(x[1]));
  $("allShots").textContent = showAll ? "指摘のある画面だけにする" : `すべての画面を見る（${SCREENS.length}）`;
  $("resShots").innerHTML = (list.length ? "" : `<p class="muted">まだ指摘はありません</p>`) + list.map(([, id, name]) => {
    const a = pa.filter((p) => p.screen === id), b = pb.filter((p) => p.screen === id);
    const side = (list) => `<div class="cmp-img ${isWide(id) ? "w" : ""}"><img src="${imgOf(id)}" alt="" loading="lazy">${list.map((p) => pinHtml(p, null, "sm")).join("")}</div>`;
    return `<button type="button" class="cmp-cell" data-zoom="${id}"><span class="cmp-name">${esc(name)}<small>A ${a.length}・B ${b.length}</small></span><div class="cmp-pair">${side(a)}${side(b)}</div></button>`;
  }).join("");

  const texts = (f) => res.responses.filter(inGroup(A)).map((r) => r.texts?.[f]).filter((t) => t && t.trim());
  $("resTexts").innerHTML = `<h2>ひとこと（A：${esc(A)}）</h2>` + [["good", "よかったこと"], ["trouble", "困ったこと"], ["wish", "来年ほしい機能"], ["other", "その他"]]
    .map(([f, label]) => { const t = texts(f); return `<h3>${label}<small>${t.length}件</small></h3>${t.length ? `<ul class="tlist">${t.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : `<p class="muted">まだありません</p>`}`; }).join("");
}
let showAll = false;
$("allShots").onclick = () => { showAll = !showAll; renderResults(); };
$("resShots").addEventListener("click", (e) => {
  const b = e.target.closest("[data-zoom]");
  if (!b) return;
  const id = b.dataset.zoom, A = $("grpA").value, B = $("grpB").value;
  const list = (g) => res.pins.filter((p) => p.screen === id && inGroup(g)(p));
  const side = (g, cls) => {
    const ps = list(g);
    return `<div class="zoom-side"><h4 class="${cls}">${esc(g)}<small>${ps.length}件</small></h4><div class="cmp-img ${isWide(id) ? "w" : ""}"><img src="${imgOf(id)}" alt="">${ps.map((p, i) => pinHtml(p, i)).join("")}</div>
      <ol class="zlist">${ps.map((p, i) => `<li><span class="pin static" style="--c:${kindOf(p.kind).color}">${i + 1}</span>${esc(kindOf(p.kind).label)}${p.text ? `：${esc(p.text)}` : ""}</li>`).join("")}</ol></div>`;
  };
  $("zoomTitle").textContent = screenName(id);
  $("zoomBody").innerHTML = side(A, "la") + side(B, "lb");
  $("zoom").hidden = false;
});
$("zoomClose").onclick = () => ($("zoom").hidden = true);
$("zoom").addEventListener("click", (e) => { if (e.target === $("zoom")) $("zoom").hidden = true; });

function setupGroups() {
  const opt = (sel) => GROUPS.map((g) => `<option${g === sel ? " selected" : ""}>${esc(g)}</option>`).join("");
  $("grpA").innerHTML = opt("全員");
  $("grpB").innerHTML = opt("受け渡し");
  $("grpA").onchange = $("grpB").onchange = () => res && renderResults();
}

// ---------- 切り替え ----------
function show(view) {
  document.querySelectorAll("[data-view]").forEach((b) => b.setAttribute("aria-selected", b.dataset.view === view));
  $("answer").hidden = view !== "answer" || $("thanks").hidden === false;
  $("results").hidden = view !== "results";
  if (view === "results") { $("thanks").hidden = true; $("answer").hidden = true; loadResults(); }
  if (view === "answer" && !$("thanks").hidden) $("answer").hidden = true;
}
document.querySelector(".sv-tabs").addEventListener("click", (e) => {
  const b = e.target.closest("[data-view]");
  if (!b) return;
  if (b.dataset.view === "answer") $("thanks").hidden = true;
  show(b.dataset.view);
});
$("toResults").onclick = () => show("results");

if (!key) {
  $("gate").hidden = false;
  document.querySelector(".sv-tabs").hidden = true;
} else {
  chips($("roles"), ROLES, (v) => ans.roles.has(v), (v) => toggle(ans.roles, v));
  chips($("days"), DAYS, (v) => ans.days === v, (v) => (ans.days = ans.days === v ? "" : v));
  chips($("hours"), HOURS, (v) => ans.hours.has(v), (v) => toggle(ans.hours, v));
  renderRates();
  renderShots();
  renderStage();
  setupGroups();
  show(location.hash === "#results" ? "results" : "answer");
}
