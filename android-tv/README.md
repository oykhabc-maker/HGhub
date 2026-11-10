# android-tv/ — 電視版原生覆蓋層

`src-tauri/gen/android` 被 `.gitignore` 忽略，每次 `pnpm tauri android init` 都會重生，
所以電視版的原生改動（DPAD 橋接、電視 banner、獨立 applicationId）放在這裡，
由 `apply.mjs` 在 init 之後套回去。

## 用法

```bash
pnpm install
pnpm tauri android init --ci     # 產生 src-tauri/gen/android
node android-tv/apply.mjs        # 套用電視版原生改動（可重複執行）
```

之後照平常建置：

```bash
# 模擬器（x86_64）
pnpm tauri android build --target x86_64 --debug --apk

# 交付給電視盒（arm64 + armv7 通用包）
pnpm tauri android build --target aarch64 --target armv7 --apk
```

## 內容

| 檔案 | 作用 |
| --- | --- |
| `MainActivity.kt` | `dispatchKeyEvent` 攔 DPAD 交給 JS（部分電視盒 WebView 會吃掉方向鍵）；`mediaPlaybackRequiresUserGesture = false` 讓自動播放不被消音 |
| `tv_banner.png` | 320×180 Android TV 桌面 banner |
| `apply.mjs` | 複製上面兩個檔，並改 `AndroidManifest.xml`（`android:banner`）與 `build.gradle.kts`（`applicationId`） |

## 為什麼要改 applicationId

官方版 `com.hghub.huangguo` 用作者自己的簽章，簽章不同無法覆蓋安裝（`UPDATE_INCOMPATIBLE`）。
改成 `com.oykh.hghubtv` 就能與官方版並存；要上架或改成自己的包名，直接改 `apply.mjs` 裡的 `APP_ID`。

## 注意

- `release` APK 是 **unsigned**，需自己 `zipalign -f 4` + `apksigner sign`，否則裝不上。
- `versionCode` 在 `src-tauri/tauri.conf.json` 的 `bundle.android.versionCode`。
