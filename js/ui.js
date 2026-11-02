export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export const pad = (n) => String(n).padStart(3, "0");
export const yen = (n) => "¥" + Number(n).toLocaleString();
export const lineName = (l) => l.name + (l.variant ? `（${l.variant}）` : "");

// ドリンクのイラスト。m = { name, variant, color }。ホットはマグ＋湯気、それ以外はグラス＋氷。
export function cupSVG(m = {}, cls = "") {
  const v = m.variant || "";
  const c = m.color || "#999";
  const hot = v.includes("ホット");
  const cream = v.includes("クリーム") && !v.includes("なし");
  if (hot) {
    return `<svg class="cup ${cls}" viewBox="0 0 64 64" aria-hidden="true">
      <g class="steam"><path d="M22 14c-3-4 3-6 0-10"/><path d="M30 14c-3-4 3-6 0-10"/><path d="M38 14c-3-4 3-6 0-10"/></g>
      <path d="M12 24h34v20a12 12 0 0 1-12 12H24a12 12 0 0 1-12-12z" fill="${c}" class="body"/>
      <path d="M46 30h4a7 7 0 0 1 0 14h-5" class="line"/>
      ${cream ? `<path d="M13 24a16 9 0 0 1 32 0z" class="cream"/>` : `<path d="M12 24h34" class="line"/>`}
      <path d="M8 58h42" class="line"/>
    </svg>`;
  }
  const soda = (m.name || "").includes("ソーダ");
  return `<svg class="cup ${cls}" viewBox="0 0 64 64" aria-hidden="true">
    <path d="M38 4l-4 22" class="line straw"/>
    <path d="M18.6 24h26.8l-3.2 32H21.8z" fill="${c}"/>
    <rect x="23" y="30" width="8" height="8" rx="2" class="ice" transform="rotate(-12 27 34)"/>
    <rect x="33" y="35" width="8" height="8" rx="2" class="ice" transform="rotate(10 37 39)"/>
    ${soda ? `<circle cx="26" cy="48" r="1.5" class="bub"/><circle cx="36" cy="50" r="1.2" class="bub"/><circle cx="31" cy="44" r="1" class="bub"/>` : ""}
    ${cream ? `<path d="M17 24a15 11 0 0 1 30 0z" class="cream"/>${soda ? `<circle cx="37" cy="12" r="3.5" class="cherry"/>` : ""}` : ""}
    <path d="M16 14h32l-4 44H20z" class="line"/>
  </svg>`;
}

// 残りの数を小さなゲージで表す（用意した数が決まっている時だけ）
export function stockGauge(m) {
  if (m.stock == null || m.soldOut) return "";
  const r = m.remaining / m.stock;
  const cls = m.remaining <= 3 ? "low" : r <= 0.3 ? "mid" : "";
  return `<span class="gauge ${cls}" title="のこり ${m.remaining}"><i style="width:${Math.max(4, r * 100)}%"></i></span>`;
}

export const STEP_ICONS = {
  new: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" class="line"/><path d="M9 8h6M9 12h6" class="line"/></svg>`,
  making: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 9h12v6a5 5 0 0 1-5 5h-2a5 5 0 0 1-5-5z" class="line"/><path d="M17 11h1.5a2.5 2.5 0 0 1 0 5H17" class="line"/><g class="steam"><path d="M9 6c-1-1.5 1-2 0-3.5"/><path d="M13 6c-1-1.5 1-2 0-3.5"/></g></svg>`,
  ready: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z" class="line"/><path d="M10 21h4" class="line"/></svg>`,
};
export const ID_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="5" width="20" height="14" rx="2" class="line"/><circle cx="8" cy="12" r="2.5" class="line"/><path d="M13 10h5M13 14h4" class="line"/></svg>`;
export const COIN_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" class="line"/><path d="M8.5 7.5L12 12l3.5-4.5M12 12v5M9 13h6M9 15.5h6" class="line"/></svg>`;

// 名前ごとにまとめる（ココア → アイス/ホット/…）
export function groupMenu(menu) {
  const g = [];
  for (const m of menu) {
    let x = g.find((y) => y.name === m.name);
    if (!x) g.push((x = { name: m.name, color: m.color, items: [] }));
    x.items.push(m);
  }
  return g;
}

// 画面を作り直さずに、変わったところだけ書きかえる（全体を入れ替えると揺れたり、動きが最初に戻ったりするため）。
// data-keep の付いた要素の中身（Googleのログインボタンなど）はそのまま残す
export function morph(el, html) {
  if (el._html === html) return;
  el._html = html;
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  syncChildren(el, tpl.content);
}
function syncChildren(oldParent, newParent) {
  const olds = [...oldParent.childNodes], news = [...newParent.childNodes];
  news.forEach((n, i) => {
    const o = olds[i];
    if (!o) return oldParent.appendChild(n);
    if (o.nodeType !== n.nodeType || o.nodeName !== n.nodeName) return oldParent.replaceChild(n, o);
    if (o.nodeType === 3 || o.nodeType === 8) {
      if (o.nodeValue !== n.nodeValue) o.nodeValue = n.nodeValue;
      return;
    }
    syncAttrs(o, n);
    if (o.hasAttribute?.("data-keep")) return;
    syncChildren(o, n);
  });
  for (let i = olds.length - 1; i >= news.length; i--) oldParent.removeChild(olds[i]);
}
function syncAttrs(o, n) {
  for (const { name } of [...o.attributes]) if (!n.hasAttribute(name)) o.removeAttribute(name);
  for (const { name, value } of [...n.attributes]) if (o.getAttribute(name) !== value) o.setAttribute(name, value);
  if ("disabled" in o) o.disabled = n.hasAttribute("disabled");
}
// el.html = "..." と書くと、変わったところだけ書きかえる
Object.defineProperty(HTMLElement.prototype, "html", {
  set(v) { morph(this, v); },
  get() { return this.innerHTML; },
  configurable: true,
});
