# HGhub TV（遙控器）改造說明

這個 fork 只做一件事：讓 HGhub 在 Android TV / 電視盒上用**遙控器**操作。
上游（`Minireel/HGhub`、`zxsos/HGhub`）的資料抓取、播放、UI 一律不動。

## 為什麼要改

在 Android TV 上實測原版 APK（v1.2.14，x86_64 模擬器 1920×1080）：

| 操作 | 結果 |
|---|---|
| 分類頁按 5 次 DPAD_DOWN | 逐像素比對 `mean diff = 0.00` → 完全沒反應（沒焦點、沒捲動） |
| 按 OK | 沒有任何反白，直接跳進某一部劇開始播 |
| 按返回 | 直接回到電視桌面（根頁面直接 exit） |
| 按數字 2 / 3 | 切到「搜索」/「分類」→ 證明按鍵有進到 JS |

結論：缺的不是按鍵通道，而是**焦點層**。

## 改了什麼

新增（全部在 `src/tv/`）：

- `tvMode.ts` — 判斷是否電視（Android 且 UA 無 `Mobile`，或長邊 ≥ 900）、
  持久化開關（`localStorage.hghub_tv_mode`）、真的收到方向鍵就自動開啟。
- `focus.ts` — 遙控器焦點引擎：
  - 方向鍵 → 以幾何最近鄰找下一個可聚焦元素（垂直移動看水平重疊、反之亦然）
  - `Enter` / 空白 → 點擊當前焦點
  - 有 `[data-tv-overlay]` 時只在彈層內移動
  - 播放器標記 `[data-tv-playing]` 時方向鍵交還播放器
  - 焦點框只由 `.tv-focus` 畫（單一高亮）
- `bridge.ts` — 原生按鍵橋接：部分電視盒（實測 Google TV Streamer / Android 14）的 WebView
  會把方向鍵當成自己的焦點導航吃掉，`keydown` 根本送不到 JS（數字鍵卻正常）。
  `MainActivity.dispatchKeyEvent` 攔下 DPAD 後呼叫 `window.__tvKey(code)`，
  由前端合成一次 `keydown`，焦點引擎與播放器都走同一條路。
- `TvMode.tsx` — 掛載引擎、換頁後焦點歸位、電視每次啟動停在「分類」。

改動的既有檔案：

- `src/App.tsx` — 掛 `<TvMode/>`；電視模式的返回鍵階層：
  面板 → 登入框 → 頁面堆疊 → 回「分類」→ 連按兩次才退出。
- `src/components/Feed.tsx` — `Enter` 播放/暫停；根節點標記 `data-tv-playing`。
- `src/components/ui.tsx` — `Sheet` / `Modal` 開啟時加 `data-tv-overlay`（焦點陷阱）。
- `src/pages/Settings.tsx` — 「電視模式（遙控器）」開關。
- `src-tauri/gen/android/.../MainActivity.kt` — `dispatchKeyEvent` 的 DPAD 攔截（見上）。
  **這個檔在 `gen/` 裡，重跑 `tauri android init` 會被蓋掉，要一併還原。**
- `src/index.css` — `.tv-focus` 焦點框、底欄高度 64px、電視字級/卡片尺寸放大。

## 電視版差異（相對上游）

- **開機帶聲**：上游 `muteOnStartup` 預設 `true`（每次啟動靜音），電視版改為預設不靜音，
  並用 `hghub_unmute_v1` 做一次性遷移（舊安裝也會被改過來），之後完全尊重使用者在
  設定裡的選擇。
- **允許帶聲自動播放**：`MainActivity.onWebViewCreate` 設
  `settings.mediaPlaybackRequiresUserGesture = false`，否則 Chromium 會把自動播放的影片靜音。
- 每次開播寫一行 `[aud] sound vol=0.70 paused=false` 到 debug.log，日後查「沒聲音」不用猜。

## 遙控器操作對照

| 按鍵 | 瀏覽頁 | 播放中 |
|---|---|---|
| 上下左右 | 移動焦點 | 上下切集、左右 ±5 秒 |
| OK | 進入 / 播放 | 播放 / 暫停 |
| 返回 | 上一層；分類根頁連按兩次退出 | 關面板 → 回上一層 |
| 1 / 2 / 3 / 4 | 首頁 / 搜索 / 分類 / 我的 | 同左 |

## 建置（NAS）

```bash
export PATH=$HOME/.cargo/bin:$PATH
export ANDROID_HOME=$HOME/Android
export NDK_HOME=$HOME/Android/ndk/27.0.12077973
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
export ANDROID_SDK_ROOT=$HOME/Android

pnpm install
pnpm tauri android init --ci          # 首次：產生 src-tauri/gen/android
pnpm tauri android build --target x86_64 --debug --apk     # 模擬器測試
pnpm tauri android build --target aarch64 --target armv7 --apk   # 交付（通用）
```

首次 Rust for Android 編譯約 10–20 分鐘；之後增量 1–3 分鐘。

## 注意

- 上游每天發版（1.2.11 → 1.2.14 同一天），跟版時只需處理上面 5 個既有檔案，
  新增的 `src/tv/` 不會衝突。
- 授權是 PolyForm Noncommercial 1.0.0：自用/修改可以，不得商業化散布。
- 播放源與接口都由上游維護；上游若改接口，這個 fork 只跟上游同步即可。

## 原生播放器（Fire TV 有聲無影的解方）

**症狀**：Fire TV Stick 4K Max（Fire OS 9 / Amazon WebView 138）播放時有聲音、沒有畫面。

**證據**（`adb logcat`）：
```
create MediaCodec video decoder, mime video/avc, decoder name OMX.MTK.VIDEO.DECODER.AVC
E/ACodec: failed to set min buffer size to 6220800 (is still 1048576)
W/chromium: Video renderer video frame queue is empty → TransitionToHaveNothing
```
用 `requestVideoFrameCallback` 探針確認：**影像幀其實有解出來**（4 秒 90 幀、1280x720、readyState=4、
圖層可見且沒被任何元素蓋住），但 AWV 把解碼表面卡在 1 MB，送不上螢幕。
同一份程式碼在 Android TV 模擬器（x86_64）與 Google TV Streamer 上畫面正常，
所以這是 Amazon WebView 的硬體解碼缺陷，不是應用層程式碼問題。

**做法**：電視版新增 `PlayerActivity`（Media3 / ExoPlayer），播放時改走系統解碼路徑：

- 前端在 `VideoSurface` 偵測 `nativePlayerAvailable()`（UA 含 `AmazonWebView` / `AFT….`）後，
  不再自己 attach hls.js，而是呼叫 `window.HGPlayer.play(url)`。
- 網址沿用 Rust 的 loopback HLS 代理 `http://127.0.0.1:17650/hls?u=…`
  （`src-tauri/src/linux_http.rs` 原本只給 Linux 用，Android 也一起啟用）——
  Tauri 的自定義協議 `hg.localhost` 只有 WebView 認得，原生播放器拿不到。
- `AndroidManifest.xml` 需要 `networkSecurityConfig` 放行 `localhost/127.0.0.1` 的明文
  （Android 9+ 預設擋，ExoPlayer 會報 `Cleartext HTTP traffic … not permitted`）。
- 遙控器：OK 叫出控制列、左右 ±10 秒、播放/暫停鍵切換、返回先收控制列再按一次離開。
  離開後 `MainActivity.onResume` 會叫前端模擬一次 `Escape`，回到原本那一頁。

**v1 限制**：原生播放器只播當前這一集；切集仍回 App 用上下鍵選。
要在播放器內切集，需要把整季的播放網址一起傳給原生端（多幾十個 API 請求），下一版再做。
