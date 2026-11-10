package com.hghub.huangguo

import android.app.Activity
import android.net.Uri
import android.os.Bundle
import android.view.KeyEvent
import android.view.WindowManager
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
 */
class PlayerActivity : Activity() {
  private var player: ExoPlayer? = null
  private var playerView: PlayerView? = null
  private var ended = false

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

    val url = intent.getStringExtra("url")
    if (url.isNullOrBlank()) {
      finish()
      return
    }

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

    val exo = ExoPlayer.Builder(this).build()
    player = exo
    view.player = exo
    exo.setMediaSource(HlsMediaSource.Factory(dataSource).createMediaSource(MediaItem.fromUri(Uri.parse(url))))
    exo.addListener(object : Player.Listener {
      override fun onPlaybackStateChanged(state: Int) {
        if (state == Player.STATE_ENDED) finish()
      }
    })
    exo.prepare()
    exo.playWhenReady = true
    ended = false
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

  override fun onPause() {
    super.onPause()
    player?.pause()
  }

  override fun onDestroy() {
    ended = true
    playerView?.player = null
    player?.release()
    player = null
    super.onDestroy()
  }
}
