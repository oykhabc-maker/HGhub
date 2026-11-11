#!/usr/bin/env node
/**
 * 把電視版的原生改動套進 `src-tauri/gen/android`（這個目錄被 .gitignore 忽略，
 * 每次 `pnpm tauri android init` 都會重生，所以改動留在 android-tv/ 再由這支腳本套回去）。
 *
 * 用法：
 *   pnpm tauri android init --ci
 *   node android-tv/apply.mjs
 *
 * 可重複執行（idempotent）。
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const gen = path.join(root, "src-tauri/gen/android");
const app = path.join(gen, "app/src/main");

if (!fs.existsSync(app)) {
  console.error("找不到 src-tauri/gen/android，請先執行：pnpm tauri android init --ci");
  process.exit(1);
}

const log = (m) => console.log(`[tv] ${m}`);

// 1) MainActivity：DPAD 橋接 + 允許帶聲自動播放
const pkgDir = path.join(app, "java/com/hghub/huangguo");
fs.mkdirSync(pkgDir, { recursive: true });
fs.copyFileSync(path.join(root, "android-tv/MainActivity.kt"), path.join(pkgDir, "MainActivity.kt"));
log("MainActivity.kt 已套用（DPAD 橋接 + mediaPlaybackRequiresUserGesture=false）");

// 1b) 原生播放器（Fire TV 的 Amazon WebView 解碼只出聲不出影）
fs.copyFileSync(path.join(root, "android-tv/PlayerActivity.kt"), path.join(pkgDir, "PlayerActivity.kt"));
log("PlayerActivity.kt 已套用（ExoPlayer 原生播放器）");

// 1c) 明文放行 loopback（原生播放器要讀 http://127.0.0.1:17650 的 HLS 代理）
const xmlDir = path.join(app, "res/xml");
fs.mkdirSync(xmlDir, { recursive: true });
fs.copyFileSync(path.join(root, "android-tv/network_security_config.xml"), path.join(xmlDir, "network_security_config.xml"));
log("network_security_config.xml 已放入 res/xml（只放行 localhost/127.0.0.1 明文）");

// 2) 電視桌面的 banner
const bannerDir = path.join(app, "res/drawable-nodpi");
fs.mkdirSync(bannerDir, { recursive: true });
fs.copyFileSync(path.join(root, "android-tv/tv_banner.png"), path.join(bannerDir, "tv_banner.png"));
log("tv_banner.png 已放入 res/drawable-nodpi");

// 3) Manifest：<application android:banner="...">
const manifestPath = path.join(app, "AndroidManifest.xml");
let manifest = fs.readFileSync(manifestPath, "utf8");
if (!manifest.includes("android:banner")) {
  /* 直接插在 <application 之後，不要用會吃到前後空白的 regex，否則會多出空行 */
  manifest = manifest.replace("<application", '<application\n        android:banner="@drawable/tv_banner"');
  fs.writeFileSync(manifestPath, manifest);
  log("AndroidManifest.xml 已加上 android:banner");
} else {
  log("AndroidManifest.xml 已有 banner，略過");
}

// 3b) Manifest：註冊 PlayerActivity + 指向 networkSecurityConfig
if (!manifest.includes("PlayerActivity")) {
  manifest = manifest.replace(
    /(<\/activity>\s*)(<provider)/,
    `$1
        <activity
            android:name=".PlayerActivity"
            android:configChanges="orientation|keyboardHidden|keyboard|screenSize|locale|smallestScreenSize|screenLayout|uiMode"
            android:exported="false"
            android:screenOrientation="landscape"
            android:theme="@android:style/Theme.Black.NoTitleBar.Fullscreen" />

        $2`,
  );
  log("AndroidManifest.xml 已註冊 PlayerActivity");
}
if (!manifest.includes("networkSecurityConfig")) {
  manifest = manifest.replace(
    'android:usesCleartextTraffic="${usesCleartextTraffic}"',
    'android:usesCleartextTraffic="${usesCleartextTraffic}"\n        android:networkSecurityConfig="@xml/network_security_config"',
  );
  log("AndroidManifest.xml 已指向 networkSecurityConfig");
}
if (manifest !== fs.readFileSync(manifestPath, "utf8")) fs.writeFileSync(manifestPath, manifest);

// 4) applicationId：與官方版並存，避免簽章不同蓋不過去
const gradlePath = path.join(gen, "app/build.gradle.kts");
let gradle = fs.readFileSync(gradlePath, "utf8");

// 3c) Gradle：Media3 依賴（原生播放器；必須放在 gradle/gradlePath 宣告之後）
if (!gradle.includes("media3")) {
  gradle = gradle.replace(
    'implementation("androidx.webkit:webkit:1.14.0")',
    'implementation("androidx.webkit:webkit:1.14.0")\n    implementation("androidx.media3:media3-exoplayer:1.4.1")\n    implementation("androidx.media3:media3-exoplayer-hls:1.4.1")\n    implementation("androidx.media3:media3-ui:1.4.1")\n    implementation("androidx.media3:media3-datasource:1.4.1")',
  );
  fs.writeFileSync(gradlePath, gradle);
  log("build.gradle.kts 已加入 Media3 依賴");
}

const APP_ID = "com.oykh.hghubtv";
if (!gradle.includes(`applicationId = "${APP_ID}"`)) {
  if (/applicationId\s*=\s*"[^"]+"/.test(gradle)) {
    gradle = gradle.replace(/applicationId\s*=\s*"[^"]+"/, `applicationId = "${APP_ID}"`);
  } else {
    gradle = gradle.replace(/namespace\s*=\s*"[^"]+"/, (m) => `${m}\n    applicationId = "${APP_ID}"`);
  }
  fs.writeFileSync(gradlePath, gradle);
  log(`build.gradle.kts applicationId → ${APP_ID}`);
} else {
  log(`build.gradle.kts applicationId 已是 ${APP_ID}`);
}

log("完成。建置：pnpm tauri android build --target aarch64 --target armv7 --apk");
