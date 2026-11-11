package com.hghub.huangguo

import android.app.Activity
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.KeyEvent
import android.view.WindowManager
import android.widget.Toast
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.hls.HlsMediaSource
import androidx.media3.ui.PlayerView

/**
 * 電視版原生播放器。
 *
 * 為什麼需要它：Fire TV（Amazon WebView 138 / Fire OS 9）上，Chromium 會跟
 * MediaCodec 要 1920x1080x3 = 6.2 MB 的影像表面，但 AWV 的表面卡在 1 MB
 * （`failed to set min buffer size … is still 1048576`），結果是
 * **解碼器有畫面幀、requestVideoFrameCallback 也在跳，但螢幕全黑**。
 * 同一份程式碼在模擬器與 Google TV Streamer 上正常，屬於 AWV 的硬體解碼缺陷。
 *
 * 因此電視版把播放交給 ExoPlayer（系統原生解碼路徑，Amazon 自家的播放器也走這條），
 * WebView 只負責 UI。網址沿用 Rust 那邊的 HLS 代理（/hls?u=…），
 * 鑑權與分片改寫邏輯完全不用重做。
 *
 * 與前端的契約（tv31 起）：
 *   - 每 1 秒回報「播放位置 / 總長 / 是否在播」→ window.__hgNativeTick(posMs, durMs, 0|1)
 *     前端用它寫觀看記錄（續播靠這個）與進度條。
 *   - 播完不再自己 finish()，先問前端 → window.__hgNativeEnded()
 *     前端算出下一集就呼叫 HGPlayer.load(新網址)，沒有下一集才 HGPlayer.close()。
 *     前端 5 秒內沒回應才自行關閉（避免卡在片尾黑畫面）。
 *   - 續播：play/load 都帶 startMs，等 STATE_READY 才 seek（prepare 前 seek 會被吃掉）。
 */
class PlayerActivity : Activity() {
  private var player: ExoPlayer? = null
  private var dataSource: DefaultHttpDataSource.Factory? = null
  private var playerView: PlayerView? = null
  /** 準備好之後要跳到的位置（續播）；0 = 從頭 */
  private var pendingSeekMs = 0L
  /** 已播完、等前端決定要不要換集 */
  private var endedPending = false
  private val handler = Handler(Looper.getMainLooper())

  /** 每秒回報播放位置給 WebView（前端存觀看記錄、顯示進度） */
  private val ticker = object : Runnable {
    override fun run() {
      val exo = player
      if (exo != null) {
        val pos = if (exo.currentPosition > 0) exo.currentPosition else 0L
        val dur = if (exo.duration > 0) exo.duration else 0L
        val playing = if (exo.isPlaying) 1 else 0
        report("window.__hgNativeTick&&window.__hgNativeTick($pos,$dur,$playing)")
      }
      handler.postDelayed(this, 1000)
    }
  }

  /** 播完後前端沒回應（例如 JS 掛了）的保險：5 秒後自己關掉 */
  private val endFallback = Runnable {
    if (endedPending) finish()
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

    val url = intent.getStringExtra("url")
    if (url.isNullOrBlank()) {
      finish()
      return
    }
    pendingSeekMs = intent.getLongExtra("startMs", 0L)

    val view = PlayerView(this).apply {
      useController = true
      controllerAutoShow = true
      controllerShowTimeoutMs = 4000
      setShowBuffering(PlayerView.SHOW_BUFFERING_WHEN_PLAYING)
      setKeepContentOnPlayerReset(true)
    }
    setContentView(view)
    playerView = view

    val dataSource = DefaultHttpDataSource.Factory()
      .setUserAgent("Mozilla/5.0 (Linux; Android 9; AFTKA) AppleWebKit/537.36 HGhubTV")
      .setConnectTimeoutMs(15000)
      .setReadTimeoutMs(20000)
      .setAllowCrossProtocolRedirects(true)
    this.dataSource = dataSource

    val exo = ExoPlayer.Builder(this).build()
    player = exo
    view.player = exo
    exo.setMediaSource(HlsMediaSource.Factory(dataSource).createMediaSource(MediaItem.fromUri(Uri.parse(url))))
    exo.addListener(object : Player.Listener {
      override fun onPlaybackStateChanged(state: Int) {
        when (state) {
          Player.STATE_READY -> {
            /* 續播一定要等 READY：BUFFERING 期間 seek 會被下一次 prepare 蓋掉 */
            if (pendingSeekMs > 0) {
              exo.seekTo(pendingSeekMs)
              pendingSeekMs = 0
            }
            endedPending = false
          }
          Player.STATE_ENDED -> {
            endedPending = true
            /* 先問前端有沒有下一集；不要在這裡 finish()——那會直接掉回列表，
               使用者看到的就是「播完一集就結束、快播完時按下也切不了集」。 */
            report("window.__hgNativeEnded&&window.__hgNativeEnded()")
            handler.removeCallbacks(endFallback)
            handler.postDelayed(endFallback, 5000)
          }
        }
      }
    })
    exo.prepare()
    exo.playWhenReady = true
    current = this
  }

  /** 由 JS 端呼叫：原地換集，不再新開 Activity */
  fun loadUrl(url: String, label: String?, startMs: Long) {
    val exo = player ?: return
    val ds = dataSource ?: return
    handler.removeCallbacks(endFallback)
    endedPending = false
    pendingSeekMs = if (startMs > 0) startMs else 0L
    /* 一定要用 HlsMediaSource 明確指定型別：代理網址是 /hls?u=…（沒有 .m3u8 副檔名），
       交給預設的 ProgressiveMediaSource 會報「None of the available extractors could read the stream」。 */
    exo.setMediaSource(
      HlsMediaSource.Factory(ds).createMediaSource(MediaItem.fromUri(Uri.parse(url)))
    )
    exo.prepare()
    exo.playWhenReady = true
    playerView?.hideController()
    if (!label.isNullOrBlank()) {
      Toast.makeText(this, label, Toast.LENGTH_SHORT).show()
    }
  }

  /**
   * 上下鍵要在 dispatchKeyEvent 攔：PlayerView 有自己的焦點導航，
   * onKeyDown 根本收不到方向鍵（實測按了完全沒反應）。
   */
  override fun dispatchKeyEvent(event: KeyEvent): Boolean {
    if (event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0) {
      when (event.keyCode) {
        KeyEvent.KEYCODE_DPAD_UP -> {
          report("window.__hgEpStep&&window.__hgEpStep(-1)")
          return true
        }
        KeyEvent.KEYCODE_DPAD_DOWN -> {
          report("window.__hgEpStep&&window.__hgEpStep(1)")
          return true
        }
      }
    }
    return super.dispatchKeyEvent(event)
  }

  override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
    val exo = player ?: return super.onKeyDown(keyCode, event)
    when (keyCode) {
      // 播放器面板顯示時，返回鍵先收面板；再按一次才離開
      KeyEvent.KEYCODE_BACK -> {
        val v = playerView
        if (v != null && v.isControllerFullyVisible) {
          v.hideController()
          return true
        }
        finish()
        return true
      }
      KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, KeyEvent.KEYCODE_HEADSETHOOK -> {
        if (exo.isPlaying) exo.pause() else exo.play()
        return true
      }
      KeyEvent.KEYCODE_DPAD_LEFT -> {
        exo.seekBack()
        playerView?.showController()
        return true
      }
      KeyEvent.KEYCODE_DPAD_RIGHT -> {
        exo.seekForward()
        playerView?.showController()
        return true
      }
    }
    return super.onKeyDown(keyCode, event)
  }

  override fun onResume() {
    super.onResume()
    handler.removeCallbacks(ticker)
    handler.post(ticker)
  }

  override fun onPause() {
    super.onPause()
    handler.removeCallbacks(ticker)
    player?.pause()
  }

  override fun onDestroy() {
    handler.removeCallbacksAndMessages(null)
    if (current === this) current = null
    playerView?.player = null
    player?.release()
    player = null
    super.onDestroy()
  }

  private fun report(js: String) {
    MainActivity.TvBridge.send?.invoke(js)
  }

  companion object {
    /** 供 MainActivity 的 HGPlayer.load() 取得目前播放中的實例 */
    @Volatile
    var current: PlayerActivity? = null
  }
}
