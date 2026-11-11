/* ============================================================
   電視模式（Android TV / 電視盒）
   ------------------------------------------------------------
   為什麼不需要改原生端：
   遙控器的方向鍵 / OK 鍵在 WebView 裡就是一般的 keydown（ArrowUp…
   Enter），實測按「2」會直接切到「搜索」分頁，證明按鍵有進到 JS。
   所以電視模式只要三件事：
     1. 判斷「這台是電視」→ 開模式
     2. 自己實作焦點移動（瀏覽器預設不會用方向鍵移動 DOM 焦點）
     3. 返回鍵的階層（在 App.tsx 的 back 處理裡）

   偵測方式（不依賴原生 API）：
     - Android 且 UA 不含 "Mobile" → 幾乎一定是 TV / 盒子
     - 或 CSS 像素的長邊 >= 900（橫放的大螢幕）
     - 保險：真的收到方向鍵 / OK 鍵時，立刻開電視模式並記住
   ============================================================ */
import { isAndroid } from "../api";

const KEY = "hghub_tv_mode"; // "on" | "off"；沒有值 = 自動判斷

let enabled = false;
let initialized = false;
const subs = new Set<(v: boolean) => void>();

function autoDetect(): boolean {
  if (!isAndroid) return false;
  try {
    const ua = navigator.userAgent;
    /* Fire TV 的 UA 帶 "Mobile"，光看 Mobile 會誤判成手機；
       認得裝置系列名比較可靠。 */
    if (/AFT[A-Z]|AmazonWebView|Amazon ?Fire|BRAVIA|Google ?TV|Android ?TV/i.test(ua)) return true;
    if (!/Mobile/i.test(ua)) return true;
    const w = Math.max(window.screen?.width || 0, window.screen?.height || 0);
    return w >= 900;
  } catch {
    return false;
  }
}

export function initTvMode(): boolean {
  if (initialized) return enabled;
  initialized = true;
  let saved: string | null = null;
  try { saved = localStorage.getItem(KEY); } catch { /* ignore */ }
  enabled = saved === "on" ? true : saved === "off" ? false : autoDetect();
  return enabled;
}

export function tvOn(): boolean {
  if (!initialized) initTvMode();
  return enabled;
}

export function setTvMode(on: boolean) {
  initTvMode();
  try { localStorage.setItem(KEY, on ? "on" : "off"); } catch { /* ignore */ }
  if (enabled === on) return;
  enabled = on;
  subs.forEach((fn) => fn(on));
}

export function subscribeTv(fn: (v: boolean) => void): () => void {
  subs.add(fn);
  return () => { subs.delete(fn); };
}

/** 真的收到遙控器按鍵 → 這台就是電視，不必再猜 */
export function armRemoteWatcher(): () => void {
  if (!isAndroid) return () => {};
  const keys = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Enter"]);
  const fn = (e: KeyboardEvent) => {
    if (enabled) return;
    if (!keys.has(e.key)) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
    setTvMode(true);
  };
  window.addEventListener("keydown", fn, true);
  return () => window.removeEventListener("keydown", fn, true);
}
