package com.hghub.huangguo

import android.os.Bundle
import android.view.KeyEvent
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  private var web: WebView? = null
  private var nativePlaybackActive = false

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }


  override fun onResume() {
    super.onResume()
    /* 原生播放器關掉後回到 WebView：等同按一次返回鍵，回到上一層 */
    if (nativePlaybackActive) {
      nativePlaybackActive = false
      web?.evaluateJavascript(
        "window.__hgNativeClosed && window.__hgNativeClosed()",
        null
      )
    }
  }

  override fun onWebViewCreate(webView: WebView) {
    web = webView
    // 电视上视频由遥控器触发播放，不该被 Chromium 的自动播放策略静音
    webView.settings.mediaPlaybackRequiresUserGesture = false
    // release 版不能 run-as 讀 app 私有目錄，前端日誌同時丟到 logcat（tag=HGTV）
    webView.addJavascriptInterface(object {
      @JavascriptInterface
      fun log(msg: String) {
        android.util.Log.i("HGTV", msg)
      }
    }, "HGLog")
    // 電視版原生播放器：JS 給播放網址，原生 Activity 用 ExoPlayer 播
    webView.addJavascriptInterface(object {
      @JavascriptInterface
      fun play(url: String, startMs: Int) {
        runOnUiThread {
          nativePlaybackActive = true
          startActivity(
            android.content.Intent(this@MainActivity, PlayerActivity::class.java)
              .putExtra("url", url)
              .putExtra("startMs", startMs.toLong())
          )
        }
      }
      @JavascriptInterface
      fun load(url: String, label: String?, startMs: Int) {
        runOnUiThread { PlayerActivity.current?.loadUrl(url, label, startMs.toLong()) }
      }
      /* 播完且前端確認「沒有下一集」時由 JS 呼叫 */
      @JavascriptInterface
      fun close() {
        runOnUiThread { PlayerActivity.current?.finish() }
      }
      /* 前端查得到目前這台是不是原生播放器模式（Fire TV） */
      @JavascriptInterface
      fun active(): Boolean = PlayerActivity.current != null
    }, "HGPlayer")
    /* 除錯用：`adb shell am start ... --ez forceNative true` 可在模擬器上
       強制走原生播放器路徑，驗證切集/續播邏輯（不影響正式行為）。 */
    webView.addJavascriptInterface(object {
      @JavascriptInterface
      fun forceNative(): Boolean = intent?.getBooleanExtra("forceNative", false) == true
    }, "HGEnv")
    /* 原生播放器 → 前端：切集、之後的其他互動都走這裡 */
    TvBridge.send = { js -> runOnUiThread { webView.evaluateJavascript(js, null) } }
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


  object TvBridge {
    /** MainActivity 建立 WebView 後填入；PlayerActivity 用它呼叫前端 */
    @Volatile
    var send: ((String) -> Unit)? = null
  }
}
