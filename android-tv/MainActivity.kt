package com.hghub.huangguo

import android.os.Bundle
import android.view.KeyEvent
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  private var web: WebView? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  override fun onWebViewCreate(webView: WebView) {
    web = webView
    // 电视上视频由遥控器触发播放，不该被 Chromium 的自动播放策略静音
    webView.settings.mediaPlaybackRequiresUserGesture = false
  }

  /**
   * 有些電視盒的 WebView 會把方向鍵當成自己的焦點導航吃掉，keydown 送不到 JS
   * （實測 Google TV Streamer / Android 14：數字鍵正常、方向鍵完全沒反應）。
   * 這裡攔下來交給 window.__tvKey()，由前端合成 keydown，
   * 焦點引擎與播放器就都走同一條路徑。
   */
  override fun dispatchKeyEvent(event: KeyEvent): Boolean {
    val code = event.keyCode
    val isDpad = code == KeyEvent.KEYCODE_DPAD_UP || code == KeyEvent.KEYCODE_DPAD_DOWN ||
      code == KeyEvent.KEYCODE_DPAD_LEFT || code == KeyEvent.KEYCODE_DPAD_RIGHT ||
      code == KeyEvent.KEYCODE_DPAD_CENTER || code == KeyEvent.KEYCODE_ENTER
    if (isDpad) {
      if (event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0) {
        web?.evaluateJavascript("window.__tvKey && window.__tvKey($code)", null)
      }
      return true
    }
    return super.dispatchKeyEvent(event)
  }
}
