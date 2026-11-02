// 学生証の左下のバーコード（NW-7、中身は「A＋学籍番号7桁＋A」）をカメラで読み取る。
// 読み取った番号だけを使い、手で入力・修正する欄は作らない。

export const parseCard = (text) => (String(text).trim().match(/^[A-D]?(\d{7})[A-D]?$/i) || [])[1] || null;

let reader = null, hints = null;
const canvas = document.createElement("canvas");
const ctx = canvas.getContext("2d", { willReadFrequently: true });

function getReader() {
  if (!reader) {
    hints = new Map();
    hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [ZXing.BarcodeFormat.CODABAR]);
    hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
    reader = new ZXing.MultiFormatReader();
  }
  return reader;
}

// 画像の一部（割合で指定）を切り出して読む。バーコードが小さく写っていても読めるよう、枠の部分を優先する
const CROPS = [
  [0.1, 0.3, 0.8, 0.4],   // 案内の枠
  [0, 0.25, 1, 0.5],
  [0, 0.5, 0.6, 0.5],     // カード全体が写ったときの左下
  [0, 0, 1, 1],
];
export function decodeFrame(src, w, h) {
  for (const [x, y, cw, ch] of CROPS) {
    const sw = w * cw, sh = h * ch;
    const scale = Math.min(1, 1280 / sw);
    canvas.width = Math.round(sw * scale);
    canvas.height = Math.round(sh * scale);
    ctx.drawImage(src, w * x, h * y, sw, sh, 0, 0, canvas.width, canvas.height);
    try {
      const bmp = new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(new ZXing.HTMLCanvasElementLuminanceSource(canvas)));
      const sid = parseCard(getReader().decode(bmp, hints).getText());
      if (sid) return sid;
    } catch {}
  }
  return null;
}

export function scanStudentCard() {
  return new Promise(async (resolve) => {
    if (typeof ZXing === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      resolve({ error: "このスマホではカメラが使えません" });
      return;
    }
    const bg = document.createElement("div");
    bg.className = "scan-bg";
    bg.innerHTML = `<div class="scan">
      <p class="scan-title">学生証の左下のバーコードを枠に合わせてね</p>
      <div class="scan-view"><video playsinline muted autoplay></video><div class="scan-frame"></div></div>
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
        const sid = decodeFrame(video, video.videoWidth, video.videoHeight);
        if (sid) {
          try { navigator.vibrate?.(120); } catch {}
          finish({ studentId: sid });
          return;
        }
      }
      timer = setTimeout(tick, 200);
    };
    tick();
  });
}
