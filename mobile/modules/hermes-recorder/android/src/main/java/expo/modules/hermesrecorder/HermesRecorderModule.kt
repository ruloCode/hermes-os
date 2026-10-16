package expo.modules.hermesrecorder

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.core.app.NotificationManagerCompat
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class RecorderException(message: String) : CodedException(message)

/** Puente JS ↔ RecorderCore. El estado llega por el evento `onStatus` (~5/s grabando). */
class HermesRecorderModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw RecorderException("Sin contexto de Android")

  private val listener: (Map<String, Any?>) -> Unit = { state -> sendEvent("onStatus", state) }

  override fun definition() = ModuleDefinition {
    Name("HermesRecorder")
    Events("onStatus")

    // Nada de lo que pase aquí puede tumbar el arranque de la app: si el
    // rescate de una grabación interrumpida falla, se reporta en getState().
    OnCreate {
      try {
        RecorderCore.init(context)
      } catch (e: Throwable) {
        RecorderCore.initError = "No pude iniciar el grabador: ${e.message ?: e.javaClass.simpleName}"
      }
      RecorderCore.addListener(listener)
    }

    OnDestroy {
      RecorderCore.removeListener(listener)
    }

    Function("getState") {
      try {
        RecorderCore.state()
      } catch (e: Throwable) {
        RecorderCore.safeIdleState("getState falló: ${e.message ?: e.javaClass.simpleName}")
      }
    }

    AsyncFunction("start") { id: String, project: String, projectName: String ->
      try {
        RecorderCore.start(id, project, projectName)
      } catch (e: Exception) {
        throw RecorderException(e.message ?: "No pude iniciar la grabación.")
      }
    }

    AsyncFunction("pause") { RecorderCore.pause() }
    AsyncFunction("resume") { RecorderCore.resume() }
    AsyncFunction("stop") { RecorderCore.stop("stopped") }
    AsyncFunction("cancel") { RecorderCore.cancel() }
    Function("ack") { ids: List<String> -> RecorderCore.ack(ids) }

    // ── Chequeo previo: lo que decide si la junta sobrevive al fondo ──
    Function("checks") {
      val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
      mapOf(
        "microphone" to RecorderCore.hasRecordPermission(),
        "notifications" to NotificationManagerCompat.from(context).areNotificationsEnabled(),
        "batteryUnrestricted" to pm.isIgnoringBatteryOptimizations(context.packageName),
        "manufacturer" to Build.MANUFACTURER,
        "sdk" to Build.VERSION.SDK_INT,
        "freeBytes" to context.filesDir.freeSpace.toDouble(),
      )
    }

    // Diálogo del sistema "¿Permitir que Hermes se ejecute siempre en segundo plano?"
    @SuppressLint("BatteryLife")
    Function("requestBatteryUnrestricted") {
      val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
        .setData(Uri.parse("package:${context.packageName}"))
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      try {
        context.startActivity(intent)
      } catch (_: Exception) {
        context.startActivity(
          Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        )
      }
    }

    Function("openNotificationSettings") {
      val intent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
      } else {
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).setData(Uri.parse("package:${context.packageName}"))
      }
      context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    Function("openAppSettings") {
      context.startActivity(
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
          .setData(Uri.parse("package:${context.packageName}"))
          .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
      )
    }
  }
}
