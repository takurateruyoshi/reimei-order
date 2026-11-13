// Apps Script をウェブアプリとしてデプロイしたときのURL（…/exec）。
// null のままだとデモモード（このブラウザ内だけで動く）になる。
export const API_URL = "https://script.google.com/macros/s/AKfycbyVtG0vOdCXOFVW_DbV4xJrXpbddkdoRSmDKGK11NXDYX-hyyyJN8i3Afv1msSt2mY__g/exec";

// 中継サーバー（Cloudflare）。同じ瞬間の注文をまとめて送る。止まっているときは自動で API_URL に直接つなぐ。
// null にすると中継を使わない
export const RELAY_URL = "https://reimei-relay.takurateruyoshi.workers.dev/";

// Google Cloud で作った OAuth クライアントID（スプレッドシートの「設定」にも同じ値を入れる）
export const GOOGLE_CLIENT_ID = "104829123262-vqbgml8nc61bb2rtkj10f29f0b8fcmsb.apps.googleusercontent.com";

// 学部生のログイン画面で大学のアカウントを優先表示するためのドメイン
export const STUDENT_DOMAIN = "stu.musashino-u.ac.jp";

// スタッフ画面に出す「スプレッドシートを開く」のリンク
export const SHEET_URL = "https://docs.google.com/spreadsheets/d/1I73Ej2PfDypj-bOOmnCJkDUm5-g29ymYWTEhDTp0zc8/edit";

export const SHOP_NAME = "ドリンクスタンド";
