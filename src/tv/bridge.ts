/* ============================================================
   遙控器原生橋接
   ------------------------------------------------------------
   有些電視盒（實測 Google TV Streamer / Android 14）的 WebView 會把
   方向鍵當成自己的焦點導航吃掉，keydown 根本不會送到 JS；數字鍵卻
   正常。做法是由 MainActivity.dispatchKeyEvent 攔下來，呼叫這裡的
   `window.__tvKey(code)`，再由我們自己合成一次 keydown。
   合成事件會同時經過焦點引擎與播放器的既有處理器，行為完全一致。
   ============================================================ */

const CODE_MAP: Record<number, string> = {
  19: "ArrowUp",
  20: "ArrowDown",
  21: "ArrowLeft",
  22: "ArrowRight",
  23: "Enter",
  66: "Enter",
};

export function installRemoteBridge() {
  const w = window as unknown as { __tvKey?: (code: number) => string };
  w.__tvKey = (code: number) => {
    const key = CODE_MAP[code];
    if (!key) return "pass";
    window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    return "handled";
  };
}


type NativePlayer = {
  play: (url: string, startMs: number) => void;
  load?: (url: string, label: string | null, startMs: number) => void;
  close?: () => void;
};

/** 原生播放器（ExoPlayer）是否可用：Fire TV 的 Amazon WebView 解不出畫面時走這條 */
export function nativePlayerAvailable(): boolean {
  const b = (window as unknown as { HGPlayer?: NativePlayer }).HGPlayer;
  if (!b || typeof b.play !== "function") return false;
  /* 只在 Fire TV（Amazon WebView）強制走原生：它的硬體解碼路徑只出聲不出影。
     其他電視盒（Google TV Streamer 等）WebView 播放正常，保留原本的播放器 UI
     （詳情/選集/評論面板都在 WebView 裡）。
     HGEnv.forceNative() 只在 adb 帶 --ez forceNative true 時為 true，
     用來在模擬器上驗證原生播放器路徑。 */
  const force = (window as unknown as { HGEnv?: { forceNative?: () => boolean } }).HGEnv;
  if (force && typeof force.forceNative === "function") {
    try { if (force.forceNative()) return true; } catch { /* ignore */ }
  }
  return /AmazonWebView|AFT[A-Z]/i.test(navigator.userAgent);
}

/** Rust 端 loopback 代理（src-tauri/src/linux_http.rs 的 ORIGIN），
 *  電視版原生播放器只認真的 http://，Tauri 自定義協議它拿不到。 */
export const NATIVE_MEDIA_ORIGIN = "http://127.0.0.1:17650";

/** 原生播放器是否已經開著（開著就一直用 load 原地換集，不要疊第二個 Activity） */
let launched = false;
let epLabel = "";
/** 最後送給原生播放器的網址：頁面「變成看得見」時用它判斷要不要補開播放器 */
let lastUrl = "";

export function nativeSessionUrl(): string {
  return lastUrl;
}

/** 播放器上要顯示的集數標籤（原生播放器用 Toast 顯示） */
export function setNativeLabel(label: string) {
  epLabel = label;
}

/** 原生播放器關掉後由 MainActivity 標記，避免重複 startActivity */
export function nativeClosed() {
  launched = false;
  lastUrl = "";
}

/**
 * @param startSec 續播起點（秒）。原生端等 STATE_READY 才 seek，
 *                 所以剛進去就先播 0 秒再跳，不會被 prepare 蓋掉。
 */
export function nativePlayUrl(url: string, startSec = 0): boolean {
  const b = (window as unknown as { HGPlayer?: NativePlayer }).HGPlayer;
  if (!b) return false;
  const startMs = Math.max(0, Math.round((Number.isFinite(startSec) ? startSec : 0) * 1000));
  try {
    if (launched && typeof b.load === "function") b.load(url, epLabel, startMs);
    else {
      b.play(url, startMs);
      launched = true;
    }
    lastUrl = url;
    return true;
  } catch {
    return false;
  }
}

/** 播完且前端確認沒有下一集：關掉原生播放器（會回到 WebView 上一層） */
export function nativeClose(): boolean {
  const b = (window as unknown as { HGPlayer?: NativePlayer }).HGPlayer;
  if (!b || typeof b.close !== "function") return false;
  try { b.close(); return true; } catch { return false; }
}

/* 原生播放器關閉後（MainActivity.onResume）回到 WebView：等同按一次返回鍵 */
(window as unknown as { __hgNativeClosed?: () => void }).__hgNativeClosed = () => {
  nativeClosed();
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
};

/** @deprecated 用 nativePlayUrl（會判斷是否已在播放中） */
export const nativePlay = nativePlayUrl;
