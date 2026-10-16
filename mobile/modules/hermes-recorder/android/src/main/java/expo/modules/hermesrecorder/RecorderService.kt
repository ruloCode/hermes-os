package expo.modules.hermesrecorder

import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

/**
 * Foreground service de tipo micrófono: es lo que le dice a Android "esta app
 * está grabando a propósito, no la mates" y lo que permite seguir capturando
 * el micrófono con Hermes en segundo plano o con la pantalla bloqueada.
 * La grabación en sí vive en RecorderCore; el service solo la sostiene y
 * atiende los botones de la notificación.
 */
class RecorderService : Service() {
  companion object {
    const val ACTION_START = "com.rulocode.hermes.recorder.START"
    const val ACTION_PAUSE = "com.rulocode.hermes.recorder.PAUSE"
    const val ACTION_RESUME = "com.rulocode.hermes.recorder.RESUME"
    const val ACTION_STOP = "com.rulocode.hermes.recorder.STOP"
  }

  override fun onCreate() {
    super.onCreate()
    RecorderCore.init(this)
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    // startForegroundService exige startForeground en ≤5 s pase lo que pase:
    // se llama SIEMPRE primero, aunque la acción sea detener.
    try {
      val n = RecorderCore.buildNotification(this)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        startForeground(RecorderCore.NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
      } else {
        startForeground(RecorderCore.NOTIFICATION_ID, n)
      }
      RecorderCore.onForeground(true)
    } catch (e: Exception) {
      RecorderCore.onForeground(false, "Android no dejó mantener la grabación en segundo plano: ${e.message ?: e.javaClass.simpleName}")
    }

    when (intent?.action) {
      ACTION_PAUSE -> RecorderCore.pause()
      ACTION_RESUME -> RecorderCore.resume()
      ACTION_STOP -> RecorderCore.stop("notification")
    }
    if (!RecorderCore.isActive()) {
      stopForegroundCompat()
      stopSelf()
    }
    return START_NOT_STICKY
  }

  // Deslizar Hermes desde Recientes: la junta sigue (stopWithTask=false).
  override fun onTaskRemoved(rootIntent: Intent?) {
    super.onTaskRemoved(rootIntent)
  }

  override fun onDestroy() {
    stopForegroundCompat()
    RecorderCore.onForeground(false)
    super.onDestroy()
  }

  private fun stopForegroundCompat() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
      stopForeground(STOP_FOREGROUND_REMOVE)
    } else {
      @Suppress("DEPRECATION") stopForeground(true)
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null
}
