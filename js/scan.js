// アプリの中でカメラを開いて読み取る。
// ・学生証の左下のバーコード（NW-7、中身は「A＋学籍番号7桁＋A」）→ 学籍番号。手で入力・修正する欄は作らない
// ・お客さんの画面のQRコード → 注文ID

export const parseCard = (text) => (String(text).trim().match(/^[A-D]?(\d{7})[A-D]?$/i) || [])[1] || null;
export const parseOrderQR = (text) => {
  try { return new URL(String(text)).searchParams.get("o"); } catch { return null; }
};

const canvas = document.createElement("canvas");
const ctx = canvas.getContext("2d", { willReadFrequently: true });
const readers = {};
function reader(format) {
  if (!readers[format]) {
    const hints = new Map();
    hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [ZXing.BarcodeFormat[format]]);
    hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
    readers[format] = { r: new ZXing.MultiFormatReader(), hints };
  }
  return readers[format];
}

// 画像の一部（割合で指定）を切り出して読む。バーコードが小さく写っていても読めるよう、枠の部分を優先する
const CROPS = [
  [0.1, 0.3, 0.8, 0.4],   // 案内の枠
  [0, 0.25, 1, 0.5],
  [0, 0.5, 0.6, 0.5],     // カード全体が写ったときの左下
  [0, 0, 1, 1],
];
function decodeWith(format, parse, src, w, h, crops) {
  const { r, hints } = reader(format);
  for (const [x, y, cw, ch] of crops) {
    const sw = w * cw, sh = h * ch;
    const scale = Math.min(1, 1280 / sw);
    canvas.width = Math.round(sw * scale);
    canvas.height = Math.round(sh * scale);
    ctx.drawImage(src, w * x, h * y, sw, sh, 0, 0, canvas.width, canvas.height);
    try {
      const bmp = new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(new ZXing.HTMLCanvasElementLuminanceSource(canvas)));
      const v = parse(r.decode(bmp, hints).getText());
      if (v) return v;
    } catch {}
  }
  return null;
}
export const decodeFrame = (src, w, h) => decodeWith("CODABAR", parseCard, src, w, h, CROPS);
export const decodeOrderFrame = (src, w, h) => decodeWith("QR_CODE", parseOrderQR, src, w, h, [[0.15, 0.1, 0.7, 0.8], [0, 0, 1, 1]]);

// 読み取りの部品（約100KB）は、カメラを使うときに初めて読み込む（最初にページを開くのを軽くするため）
let zx = null;
const loadZXing = () => zx ||= typeof ZXing !== "undefined" ? Promise.resolve() : new Promise((ok) => {
  const s = document.createElement("script");
  s.src = "https://unpkg.com/@zxing/library@0.21.3/umd/index.min.js";
  s.onload = ok; s.onerror = () => { zx = null; ok(); };
  document.head.append(s);
});

function scan({ title, frame, decode }) {
  return new Promise(async (resolve) => {
    await loadZXing();
    if (typeof ZXing === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      resolve({ error: "このスマホではカメラが使えません" });
      return;
    }
    const bg = document.createElement("div");
    bg.className = "scan-bg";
    bg.innerHTML = `<div class="scan">
      <p class="scan-title">${title}</p>
      <div class="scan-view"><video playsinline muted autoplay></video><div class="scan-frame ${frame}"></div></div>
      <button type="button" class="btn">やめる</button>
    </div>`;
    document.body.append(bg);
    const video = bg.querySelector("video");

    let stream = null, timer = null, finished = false;
    const finish = (result) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
      bg.remove();
      resolve(result);
    };
    bg.querySelector("button").onclick = () => finish(null);

    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1920 } }, audio: false });
    } catch {
      finish({ error: "カメラを使えませんでした。ブラウザの設定でカメラを許可してください" });
      return;
    }
    video.srcObject = stream;
    await video.play().catch(() => {});

    const tick = () => {
      if (finished) return;
      if (video.videoWidth) {
        const v = decode(video, video.videoWidth, video.videoHeight);
        if (v) {
          try { navigator.vibrate?.(120); } catch {}
          finish({ value: v });
          return;
        }
      }
      timer = setTimeout(tick, 200);
    };
    tick();
  });
}

export async function scanStudentCard() {
  const r = await scan({ title: "学生証の左下のバーコードを枠に合わせてね", frame: "", decode: decodeFrame });
  return r && (r.value ? { studentId: r.value } : r);
}

// お客さんの画面のQRを読み取って、注文IDを返す
export async function scanOrderQR() {
  const r = await scan({
    title: "お客さんの画面のQRコードを枠に合わせてください",
    frame: "square",
    decode: decodeOrderFrame,
  });
  return r && (r.value ? { orderId: r.value } : r);
}

// 画面の中に埋め込んで、QRをずっと読み続ける（スタッフ画面の「受け渡し」の上）。
// onCard を渡すと、学生証のバーコード（学籍番号）も読む。
// 同じものを続けて読んだときは、5秒間は2回目を無視する。止めるときは返り値の stop() を呼ぶ
const CARD_CROPS = [[0, 0.2, 1, 0.6], [0, 0, 1, 1]];
export async function startQRStream(box, onOrder, onCard) {
  await loadZXing();
  if (typeof ZXing === "undefined" || !navigator.mediaDevices?.getUserMedia) return { error: "このスマホではカメラが使えません", stop() {} };
  let stream = null, timer = null, stopped = false, last = "", lastAt = 0;
  const stop = () => {
    stopped = true;
    clearTimeout(timer);
    stream?.getTracks().forEach((t) => t.stop());
    box.querySelector("video")?.remove();
  };
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1280 } }, audio: false });
  } catch {
    return { error: "カメラを使えませんでした。ブラウザの設定でカメラを許可してください", stop };
  }
  if (stopped) { stream.getTracks().forEach((t) => t.stop()); return { stop }; }
  const video = document.createElement("video");
  video.setAttribute("playsinline", ""); video.muted = true; video.autoplay = true;
  box.prepend(video);
  video.srcObject = stream;
  await video.play().catch(() => {});
  const tick = () => {
    if (stopped) return;
    if (video.videoWidth) {
      const w = video.videoWidth, h = video.videoHeight;
      const q = decodeOrderFrame(video, w, h);
      const sid = !q && onCard ? decodeWith("CODABAR", parseCard, video, w, h, CARD_CROPS) : null;
      const v = q || (sid && "card:" + sid);
      if (v && !(v === last && Date.now() - lastAt < 5000)) {
        last = v; lastAt = Date.now();
        try { navigator.vibrate?.(120); } catch {}
        if (q) onOrder(q); else onCard(sid);
      }
    }
    timer = setTimeout(tick, 250);
  };
  tick();
  return { stop };
}
