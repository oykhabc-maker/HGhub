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

// 4) applicationId：與官方版並存，避免簽章不同蓋不過去
const gradlePath = path.join(gen, "app/build.gradle.kts");
let gradle = fs.readFileSync(gradlePath, "utf8");
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
