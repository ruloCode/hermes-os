package expo.modules.hermesrecorder

import android.Manifest
import android.annotation.SuppressLint
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.MediaRecorder
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import kotlin.math.log10

/**
 * Dueño ÚNICO de la grabación de juntas, fuera de React.
 *
 * expo-audio colgaba el recorder del árbol de React (un hook): si la pantalla
 * o la Activity se recreaban, o el rescate de huérfanas movía el archivo, la
 * junta se rompía (2026-10-08: NoSuchFileException al detener). Aquí la
 * grabación vive en un singleton del proceso + un foreground service de tipo
 * micrófono, y su estado se escribe a disco (SharedPreferences) en cada cambio.
 *
 * Tres reglas:
 *  1. Se graba en AAC ADTS: frames sin índice al final. Si el proceso muere a
 *     mitad (Android lo mata, el usuario pulsa "Detener" en el Task Manager),
 *     lo escrito hasta ese segundo se puede reproducir. Un M4A sin `moov`
 *     quedaba inservible.
 *  2. Se graba en `files/recordings-live/` — una carpeta que el JS no toca —
 *     y al detener se mueve a `files/recordings/` (la que lista la app).
 *  3. Al arrancar el proceso, una grabación "activa" sin recorder vivo es una
 *     junta interrumpida: se rescata CON su proyecto (no como huérfana).
 */
@SuppressLint("StaticFieldLeak") // solo guarda el applicationContext
object RecorderCore {
  private const val PREFS = "hermes_recorder"
  private const val KEY_ACTIVE = "active"
  private const val KEY_FINISHED = "finished"
  const val CHANNEL_ID = "hermes_meeting_recording"
  const val NOTIFICATION_ID = 7341

  // Voz para transcribir: mono 44,1 kHz a 64 kbps ≈ 29 MB por hora (el preset
  // HIGH_QUALITY de expo-audio grababa estéreo a 128 kbps: el doble).
  private const val SAMPLE_RATE = 44_100
  private const val BIT_RATE = 64_000
  /** Amplitud (0..32767) por encima de la cual se considera que hay sonido. */
  private const val SOUND_THRESHOLD = 700

  private var ctx: Context? = null
  private var recorder: MediaRecorder? = null
  private var active: JSONObject? = null
  private var wakeLock: PowerManager.WakeLock? = null
  private val main = Handler(Looper.getMainLooper())

  /** true cuando el service confirmó startForeground (sobrevive al fondo). */
  @Volatile var foreground = false
    private set
  @Volatile var foregroundError: String? = null
    private set
  private var level = 0.0
  private var silenced = false
  private var lastSoundAt = 0L
  private var lastError: String? = null
  /** Error al iniciar el módulo (se muestra en vez de cerrar la app). */
  @Volatile var initError: String? = null

  private val listeners = mutableSetOf<(Map<String, Any?>) -> Unit>()

  fun init(context: Context) {
    if (ctx == null) ctx = context.applicationContext
    try {
      recoverInterrupted()
    } catch (e: Throwable) {
      initError = "No pude rescatar la grabación interrumpida: ${e.message ?: e.javaClass.simpleName}"
    }
  }

  /** Estado mínimo cuando state() falla: la app abre y muestra el motivo. */
  fun safeIdleState(error: String): Map<String, Any?> = mapOf(
    "status" to "idle",
    "id" to null,
    "project" to null,
    "projectName" to null,
    "startedAt" to null,
    "elapsedMs" to 0.0,
    "level" to 0.0,
    "silencedByOtherApp" to false,
    "silentForMs" to 0.0,
    "background" to false,
    "backgroundError" to null,
    "error" to error,
    "bytes" to 0.0,
    "finished" to emptyList<Map<String, Any?>>(),
  )

  fun addListener(l: (Map<String, Any?>) -> Unit) = synchronized(listeners) { listeners.add(l) }
  fun removeListener(l: (Map<String, Any?>) -> Unit) = synchronized(listeners) { listeners.remove(l) }

  private fun emit() {
    val s = state()
    val ls = synchronized(listeners) { listeners.toList() }
    ls.forEach { runCatching { it(s) } }
  }

  // ── Persistencia ────────────────────────────────────────────────────

  private fun prefs() = ctx!!.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  private fun saveActive() {
    // commit() y no apply(): si el proceso muere un instante después, el
    // estado tiene que estar en disco para rescatar la junta.
    prefs().edit().apply {
      if (active == null) remove(KEY_ACTIVE) else putString(KEY_ACTIVE, active.toString())
    }.commit()
  }

  private fun finishedList(): JSONArray =
    runCatching { JSONArray(prefs().getString(KEY_FINISHED, "[]")) }.getOrDefault(JSONArray())

  private fun addFinished(entry: JSONObject) {
    val list = finishedList()
    list.put(entry)
    prefs().edit().putString(KEY_FINISHED, list.toString()).commit()
  }

  /** El JS ya indexó estas grabaciones terminadas: salen del diario. */
  fun ack(ids: List<String>) {
    val list = finishedList()
    val keep = JSONArray()
    for (i in 0 until list.length()) {
      val e = list.getJSONObject(i)
      if (e.optString("id") !in ids) keep.put(e)
    }
    prefs().edit().putString(KEY_FINISHED, keep.toString()).commit()
  }

  private fun recordingsDir(): File = File(ctx!!.filesDir, "recordings").apply { mkdirs() }
  private fun liveDir(): File = File(ctx!!.filesDir, "recordings-live").apply { mkdirs() }

  /** Mismo formato que `stamp()` de recordings.ts (UTC, AAAA-MM-DD-HH-MM). */
  private fun stamp(ms: Long): String =
    SimpleDateFormat("yyyy-MM-dd-HH-mm", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }
      .format(Date(ms))

  private fun finalName(project: String, startedAt: Long): File {
    val base = "reunion-$project-${stamp(startedAt)}"
    var f = File(recordingsDir(), "$base.aac")
    var n = 2
    while (f.exists()) f = File(recordingsDir(), "$base-$n.aac").also { n++ }
    return f
  }

  /** Mueve el archivo vivo a recordings/ y lo anota como terminado. */
  private fun finalize(a: JSONObject, durationMs: Long, reason: String, error: String?): JSONObject? {
    val live = File(a.getString("livePath"))
    if (!live.exists() || live.length() == 0L) {
      live.delete()
      return null
    }
    val dest = finalName(a.getString("project"), a.getLong("startedAt"))
    if (!live.renameTo(dest)) {
      // renameTo en el mismo volumen no debería fallar; si falla, copiar.
      live.copyTo(dest, overwrite = false)
      live.delete()
    }
    val entry = JSONObject().apply {
      put("id", a.getString("id"))
      put("project", a.getString("project"))
      put("projectName", a.optString("projectName"))
      put("path", dest.absolutePath)
      put("uri", "file://" + dest.absolutePath)
      put("filename", dest.name)
      put("sizeBytes", dest.length())
      put("durationMs", durationMs)
      put("startedAt", a.getLong("startedAt"))
      put("endedAt", System.currentTimeMillis())
      put("reason", reason)
      if (error != null) put("error", error)
    }
    addFinished(entry)
    return entry
  }

  /**
   * Proceso nuevo con una grabación "activa" en disco = el proceso anterior
   * murió grabando. El ADTS escrito hasta ese momento se rescata.
   */
  private fun recoverInterrupted() {
    if (recorder != null) return
    val raw = prefs().getString(KEY_ACTIVE, null) ?: return
    val a = runCatching { JSONObject(raw) }.getOrNull()
    prefs().edit().remove(KEY_ACTIVE).commit()
    if (a == null) return
    val live = File(a.optString("livePath"))
    // Duración aproximada: última escritura del archivo − arranque − pausas.
    val end = if (live.exists()) live.lastModified() else System.currentTimeMillis()
    val paused = a.optLong("pausedTotal") + if (a.optLong("pausedAt") > 0) end - a.optLong("pausedAt") else 0
    val dur = (end - a.getLong("startedAt") - paused).coerceAtLeast(0)
    finalize(a, dur, "interrupted", "La app se cerró mientras grababa; se guardó hasta ese momento.")
  }

  // ── Grabación ───────────────────────────────────────────────────────

  private fun elapsedMs(now: Long = System.currentTimeMillis()): Long {
    val a = active ?: return 0
    val pausedAt = a.optLong("pausedAt")
    val paused = a.optLong("pausedTotal") + if (pausedAt > 0) now - pausedAt else 0
    return (now - a.getLong("startedAt") - paused).coerceAtLeast(0)
  }

  private fun isPaused() = (active?.optLong("pausedAt") ?: 0L) > 0

  fun hasRecordPermission(): Boolean =
    ContextCompat.checkSelfPermission(ctx!!, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED

  @Synchronized
  fun start(id: String, project: String, projectName: String): Map<String, Any?> {
    val c = ctx ?: throw IllegalStateException("Grabador sin contexto")
    if (recorder != null) throw IllegalStateException("Ya hay una grabación en curso.")
    if (!hasRecordPermission()) throw IllegalStateException("Sin permiso de micrófono no puedo grabar.")
    val file = File(liveDir(), "$id.aac")
    val r = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) MediaRecorder(c) else @Suppress("DEPRECATION") MediaRecorder()
    try {
      r.setAudioSource(MediaRecorder.AudioSource.MIC)
      r.setOutputFormat(MediaRecorder.OutputFormat.AAC_ADTS)
      r.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
      r.setAudioChannels(1)
      r.setAudioSamplingRate(SAMPLE_RATE)
      r.setAudioEncodingBitRate(BIT_RATE)
      r.setOutputFile(file.absolutePath)
      r.setOnErrorListener { _, what, extra -> onRecorderError("error del grabador ($what/$extra)") }
      r.prepare()
      r.start()
    } catch (e: Exception) {
      runCatching { r.release() }
      file.delete()
      throw IllegalStateException("No pude abrir el micrófono: ${e.message ?: e.javaClass.simpleName}")
    }
    recorder = r
    val now = System.currentTimeMillis()
    active = JSONObject().apply {
      put("id", id)
      put("project", project)
      put("projectName", projectName)
      put("livePath", file.absolutePath)
      put("startedAt", now)
      put("pausedTotal", 0L)
      put("pausedAt", 0L)
    }
    saveActive()
    lastSoundAt = now
    lastError = null
    silenced = false
    acquireWakeLock()
    startService(RecorderService.ACTION_START)
    main.removeCallbacks(tick)
    main.post(tick)
    emit()
    return state()
  }

  @Synchronized
  fun pause() {
    val a = active ?: return
    val r = recorder ?: return
    if (isPaused()) return
    runCatching { r.pause() }.onFailure { lastError = "No pude pausar: ${it.message}"; emit(); return }
    a.put("pausedAt", System.currentTimeMillis())
    saveActive()
    refreshNotification()
    emit()
  }

  @Synchronized
  fun resume() {
    val a = active ?: return
    val r = recorder ?: return
    if (!isPaused()) return
    runCatching { r.resume() }.onFailure { lastError = "No pude reanudar: ${it.message}"; emit(); return }
    val now = System.currentTimeMillis()
    a.put("pausedTotal", a.optLong("pausedTotal") + now - a.optLong("pausedAt"))
    a.put("pausedAt", 0L)
    lastSoundAt = now
    saveActive()
    refreshNotification()
    emit()
  }

  /** Detiene y deja la grabación en recordings/ + diario. null = vacía. */
  @Synchronized
  fun stop(reason: String = "stopped"): Map<String, Any?>? {
    val a = active ?: return null
    val r = recorder
    main.removeCallbacks(tick)
    val dur = elapsedMs()
    var err: String? = null
    if (r != null) {
      // stop() lanza si no llegó audio (p.ej. <1 s): el ADTS escrito sigue
      // siendo legible, así que igual se finaliza.
      try { r.stop() } catch (e: RuntimeException) { err = "el grabador no cerró limpio: ${e.message}" }
      runCatching { r.release() }
    }
    recorder = null
    active = null
    saveActive()
    val entry = finalize(a, dur, reason, err ?: if (reason == "error") lastError else null)
    releaseWakeLock()
    stopService()
    level = 0.0
    silenced = false
    emit()
    return entry?.let { jsonToMap(it) }
  }

  /** Descarta la grabación en curso sin guardarla (el "Cancelar" de los primeros segundos). */
  @Synchronized
  fun cancel() {
    val a = active ?: return
    main.removeCallbacks(tick)
    recorder?.let { r -> runCatching { r.stop() }; runCatching { r.release() } }
    recorder = null
    active = null
    saveActive()
    File(a.getString("livePath")).delete()
    releaseWakeLock()
    stopService()
    level = 0.0
    emit()
  }

  private fun onRecorderError(msg: String) {
    main.post {
      lastError = msg
      // El archivo hasta este punto vale: se cierra como interrumpida.
      stop("error")
    }
  }

  private val tick = object : Runnable {
    override fun run() {
      val r = recorder ?: return
      val now = System.currentTimeMillis()
      if (!isPaused()) {
        val amp = runCatching { r.maxAmplitude }.getOrDefault(0)
        level = if (amp <= 0) 0.0 else ((20 * log10(amp / 32767.0) + 50) / 50).coerceIn(0.0, 1.0)
        if (amp > SOUND_THRESHOLD) lastSoundAt = now
        // Android 10+: si una llamada u otra app toma el micrófono, seguimos
        // "grabando" pero llega silencio. Hay que decirlo, no esconderlo.
        val nowSilenced = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q &&
          runCatching { r.activeRecordingConfiguration?.isClientSilenced == true }.getOrDefault(false)
        if (nowSilenced != silenced) {
          silenced = nowSilenced
          refreshNotification()
        }
      } else {
        level = 0.0
      }
      emit()
      main.postDelayed(this, 200)
    }
  }

  fun state(): Map<String, Any?> {
    val a = active
    val now = System.currentTimeMillis()
    val finished = finishedList()
    val list = (0 until finished.length()).map { jsonToMap(finished.getJSONObject(it)) }
    return mapOf(
      "status" to when {
        a == null -> "idle"
        isPaused() -> "paused"
        else -> "recording"
      },
      "id" to a?.optString("id"),
      "project" to a?.optString("project"),
      "projectName" to a?.optString("projectName"),
      "startedAt" to a?.optLong("startedAt")?.toDouble(),
      "elapsedMs" to elapsedMs(now).toDouble(),
      "level" to level,
      "silencedByOtherApp" to silenced,
      "silentForMs" to (if (a != null && !isPaused()) (now - lastSoundAt).toDouble() else 0.0),
      "background" to foreground,
      "backgroundError" to foregroundError,
      "error" to (lastError ?: initError),
      "bytes" to (a?.let { File(it.getString("livePath")).length().toDouble() } ?: 0.0),
      "finished" to list,
    )
  }

  private fun jsonToMap(o: JSONObject): Map<String, Any?> =
    o.keys().asSequence().associateWith { k ->
      when (val v = o.get(k)) {
        is Long -> v.toDouble()
        is Int -> v.toDouble()
        JSONObject.NULL -> null
        else -> v
      }
    }

  // ── Service + notificación ──────────────────────────────────────────

  private fun startService(action: String) {
    val c = ctx ?: return
    val intent = Intent(c, RecorderService::class.java).setAction(action)
    try {
      ContextCompat.startForegroundService(c, intent)
      foregroundError = null
    } catch (e: Exception) {
      // ForegroundServiceStartNotAllowedException & cía: la grabación sigue,
      // pero NO va a sobrevivir al fondo. La UI lo dice tal cual.
      foreground = false
      foregroundError = "Android no dejó iniciar el servicio en segundo plano: ${e.message ?: e.javaClass.simpleName}"
    }
  }

  private fun stopService() {
    val c = ctx ?: return
    runCatching { c.stopService(Intent(c, RecorderService::class.java)) }
    foreground = false
  }

  internal fun onForeground(ok: Boolean, error: String? = null) {
    foreground = ok
    foregroundError = error
    emit()
  }

  internal fun isActive() = active != null

  private fun acquireWakeLock() {
    val pm = ctx?.getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return
    if (wakeLock?.isHeld == true) return
    wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "hermes:meeting-recording").apply {
      setReferenceCounted(false)
      acquire(6 * 60 * 60 * 1000L) // tope de 6 h: una junta olvidada no drena la batería para siempre
    }
  }

  private fun releaseWakeLock() {
    runCatching { if (wakeLock?.isHeld == true) wakeLock?.release() }
    wakeLock = null
  }

  fun ensureChannel(c: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val nm = c.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (nm.getNotificationChannel(CHANNEL_ID) != null) return
    nm.createNotificationChannel(
      NotificationChannel(CHANNEL_ID, "Grabación de reuniones", NotificationManager.IMPORTANCE_LOW).apply {
        description = "Visible mientras Hermes graba una junta"
        setShowBadge(false)
        setSound(null, null)
        enableVibration(false)
      },
    )
  }

  private fun fmt(ms: Long): String {
    val s = ms / 1000
    val h = s / 3600
    val m = (s % 3600) / 60
    val sec = s % 60
    return if (h > 0) String.format(Locale.US, "%d:%02d:%02d", h, m, sec) else String.format(Locale.US, "%d:%02d", m, sec)
  }

  fun buildNotification(c: Context): android.app.Notification {
    ensureChannel(c)
    val a = active
    val paused = isPaused()
    val name = a?.optString("projectName")?.takeIf { it.isNotBlank() } ?: a?.optString("project") ?: ""
    val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    val open = c.packageManager.getLaunchIntentForPackage(c.packageName)?.let {
      it.flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_NEW_TASK
      PendingIntent.getActivity(c, 0, it, flags)
    }
    fun action(act: String, req: Int) = PendingIntent.getService(
      c, req, Intent(c, RecorderService::class.java).setAction(act), flags,
    )
    val elapsed = elapsedMs()
    return NotificationCompat.Builder(c, CHANNEL_ID)
      .setSmallIcon(R.drawable.hermes_rec_notification)
      .setColor(0xFFE5484D.toInt())
      .setContentTitle(if (paused) "En pausa · $name" else "Grabando · $name")
      .setContentText(
        when {
          silenced -> "⚠ Otra app o una llamada tiene el micrófono: no entra audio"
          paused -> "Pausada en ${fmt(elapsed)} — toca Reanudar para seguir"
          else -> "Puedes usar otras apps. Toca para volver a Hermes."
        },
      )
      .setUsesChronometer(!paused)
      .setWhen(System.currentTimeMillis() - elapsed)
      .setShowWhen(!paused)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setSilent(true)
      .setCategory(NotificationCompat.CATEGORY_STOPWATCH)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
      .setContentIntent(open)
      .addAction(
        0,
        if (paused) "Reanudar" else "Pausar",
        action(if (paused) RecorderService.ACTION_RESUME else RecorderService.ACTION_PAUSE, 1),
      )
      .addAction(0, "Detener y guardar", action(RecorderService.ACTION_STOP, 2))
      .build()
  }

  private fun refreshNotification() {
    val c = ctx ?: return
    if (active == null) return
    if (Build.VERSION.SDK_INT >= 33 &&
      ContextCompat.checkSelfPermission(c, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
    ) return
    runCatching { NotificationManagerCompat.from(c).notify(NOTIFICATION_ID, buildNotification(c)) }
  }
}
