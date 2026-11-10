import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { AppProvider } from "./store";
import { invoke } from "@tauri-apps/api/core";
import "./index.css";
import { initPlaybackLog, installPlaybackPageEvents, tracePlayback } from "./playbackDiagnostics";
import { initAutoLine } from "./autoLine";
import { APP_VERSION, LOCAL, logLine, platform, webviewVersion } from "./api";
import Hls from "hls.js";
installPlaybackPageEvents();
void initPlaybackLog();
/* 自动选线：启动时比一次 com / ai，之后跟着网络变化复查 */
initAutoLine();
/* 环境指纹：写进始终记录的 debug.log。用户复制诊断时不用再自报版本、平台、内核版本 */
logLine(
  `[env] ver=${APP_VERSION} platform=${platform} webview=${webviewVersion} ` +
    `engine=${Hls.isSupported() ? "hls.js" : "native"} ` +
    `mss=${"MediaSource" in window ? "y" : "n"} media=${LOCAL} ` +
    `screen=${screen.width}x${screen.height} dpr=${devicePixelRatio} lang=${navigator.language}`,
);

/* 环境指纹也进结构化日志（开诊断后不会只有一行空跑） */
tracePlayback("app.env", {
  ver: APP_VERSION, platform, webview: webviewVersion,
  engine: Hls.isSupported() ? "hls.js" : "native",
  media_source: "MediaSource" in window, managed_media_source: "ManagedMediaSource" in window,
  media_scheme: LOCAL.split(":")[0], screen: `${screen.width}x${screen.height}`,
  dpr: devicePixelRatio, lang: navigator.language,
});
/* 运行期错误统一落到 debug.log，便于自查 */
function report(kind: string, msg: string) {
  invoke("debug_log", { msg: `[${kind}] ${msg}` }).catch(() => {});
  tracePlayback(`app.${kind}`, { detail: msg });
}
window.addEventListener("error", (e) => {
  report("error", `${e.message} @ ${e.filename}:${e.lineno}:${e.colno}`);
});
window.addEventListener("unhandledrejection", (e) => {
  report("reject", String((e.reason && (e.reason.stack || e.reason.message)) || e.reason));
});

/* iOS: WKWebView 工具栏收起/键盘弹出后 layout viewport 高度可能不更新，
   页面底部会留一截空白（旋转一下才恢复的根源）。
   把 html 高度钉在可视高度上，并在旋转后重新校准。 */
if (platform === "ios" && window.visualViewport) {
  const apply = () => {
    const h = window.visualViewport?.height;
    if (h) document.documentElement.style.height = `${h}px`;
  };
  apply();
  window.visualViewport.addEventListener("resize", apply);
  window.addEventListener("orientationchange", () => setTimeout(apply, 150));
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </React.StrictMode>,
);
