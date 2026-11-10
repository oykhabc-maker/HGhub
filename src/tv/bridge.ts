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
