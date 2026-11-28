package app.oficina.android

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.SystemClock
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import org.json.JSONObject
import kotlin.concurrent.thread

/**
 * Avisos de la oficina como avisos de esta app, sin Chrome ni servicios de Google. Chrome no reconoce la app como dueña de
 * la dirección de Tailscale (no puede verificar assetlinks.json en un host privado), así que el Web Push salía como aviso
 * de Chrome. En su lugar, mientras los avisos estén prendidos, este servicio deja un pedido abierto con la oficina
 * (GET /api/push/nativo/esperar, backend/src/push.ts) que vuelve en cuanto hay algo para avisar o a los ~45 s, y vuelve a
 * preguntar. Android exige que un servicio así muestre un aviso fijo («Conectada a la oficina», en un canal silencioso).
 *
 * Se prende desde la oficina web (Más › Avisos en este teléfono → oficina-android://avisos-prender, AjustesAvisos.kt),
 * al abrir la app y al reiniciar el teléfono si estaba prendido. Se apaga solo cuando la oficina dice que este teléfono
 * ya no está anotado (404).
 */
class AvisosNativos : Service() {
    @Volatile private var corriendo = false
    private var hilo: Thread? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (!Prefs(this).avisosActivos) { stopSelf(); return START_NOT_STICKY }
        crearCanales(this)
        val tipo = if (Build.VERSION.SDK_INT >= 34) ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE else 0
        try {
            ServiceCompat.startForeground(this, ID_FIJO, fijo("Conectando con la oficina…"), tipo)
        } catch (_: Exception) {
            // Android no deja arrancarlo ahora (p. ej. desde segundo plano): se vuelve a intentar al abrir la app
            stopSelf()
            return START_NOT_STICKY
        }
        if (hilo?.isAlive != true) {
            corriendo = true
            hilo = thread(name = "avisos-oficina") { bucle() }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        corriendo = false
        hilo?.interrupt()
        super.onDestroy()
    }

    private fun bucle() {
        val prefs = Prefs(this)
        val inicio = SystemClock.elapsedRealtime()
        var pausa = 5_000L
        var estado: Boolean? = null
        while (corriendo) {
            val base = prefs.base ?: break
            try {
                val r = Api(base).get(
                    "/api/push/nativo/esperar",
                    mapOf("id" to prefs.dispositivo, "desde" to prefs.avisosDesde, "epoca" to prefs.avisosEpoca),
                    espera = 75_000,
                )
                if (estado != true) { actualizarFijo("Conectada a la oficina"); estado = true }
                pausa = 5_000L
                prefs.avisosEpoca = r.optString("epoca")
                prefs.avisosDesde = r.optLong("ultimo").toString()
                val ms = r.optJSONArray("mensajes")
                for (i in 0 until (ms?.length() ?: 0)) mostrar(ms!!.getJSONObject(i))
            } catch (e: ErrorOficina) {
                if (e.status == 404) {
                    // recién prendido desde la web, la oficina puede no haberlo anotado todavía
                    if (SystemClock.elapsedRealtime() - inicio < GRACIA) { if (!dormir(3_000)) break; continue }
                    prefs.avisosActivos = false
                    break
                }
                if (estado != false) { actualizarFijo("Sin conexión con la oficina: vuelvo a probar sola"); estado = false }
                if (!dormir(pausa)) break
                pausa = (pausa * 2).coerceAtMost(60_000L)
            } catch (e: Exception) {
                if (!dormir(pausa)) break
            }
        }
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun dormir(ms: Long): Boolean = try { Thread.sleep(ms); corriendo } catch (_: InterruptedException) { false }

    private fun fijo(texto: String) = NotificationCompat.Builder(this, CANAL_FIJO)
        .setSmallIcon(R.drawable.ic_aviso)
        .setContentTitle("Avisos de la oficina")
        .setContentText(texto)
        .setOngoing(true)
        .setSilent(true)
        .setPriority(NotificationCompat.PRIORITY_MIN)
        .setContentIntent(abrirApp(this, "#/bandeja/hoy", 0))
        .build()

    private fun actualizarFijo(texto: String) = notificar(this, null, ID_FIJO, fijo(texto))

    private fun mostrar(m: JSONObject) {
        val tag = m.optString("tag").ifBlank { "oficina" }
        val ruta = m.optString("url").substringAfter('#', "").let { if (it.startsWith("/")) "#$it" else "#/bandeja/hoy" }
        val b = NotificationCompat.Builder(this, CANAL_AVISOS)
            .setSmallIcon(R.drawable.ic_aviso)
            .setContentTitle(m.optString("titulo").ifBlank { "Oficina" })
            .setContentText(m.optString("texto"))
            .setStyle(NotificationCompat.BigTextStyle().bigText(m.optString("texto")))
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setContentIntent(abrirApp(this, ruta, tag.hashCode()))
        val permiso = m.optString("permiso")
        if (permiso.isNotBlank() && m.optBoolean("acciones")) {
            b.addAction(0, "Permitir", AccionAviso.intento(this, permiso, "una_vez", tag))
            b.addAction(0, "No", AccionAviso.intento(this, permiso, "rechazar", tag))
        }
        notificar(this, tag, ID_AVISO, b.build())
    }

    companion object {
        const val CANAL_FIJO = "conexion"
        const val CANAL_AVISOS = "avisos"
        const val ID_FIJO = 1
        const val ID_AVISO = 2
        private const val GRACIA = 120_000L

        fun prender(ctx: Context) {
            Prefs(ctx).avisosActivos = true
            ContextCompat.startForegroundService(ctx, Intent(ctx, AvisosNativos::class.java))
        }

        /** Si los avisos estaban prendidos y hay oficina vinculada, que el servicio esté corriendo. */
        fun asegurar(ctx: Context) {
            val p = Prefs(ctx)
            if (p.avisosActivos && p.base != null) {
                try { ContextCompat.startForegroundService(ctx, Intent(ctx, AvisosNativos::class.java)) } catch (_: Exception) {}
            }
        }

        fun crearCanales(ctx: Context) {
            if (Build.VERSION.SDK_INT < 26) return
            val nm = ctx.getSystemService(NotificationManager::class.java)
            nm.createNotificationChannel(NotificationChannel(CANAL_AVISOS, "Avisos de la oficina", NotificationManager.IMPORTANCE_HIGH)
                .apply { description = "Permisos, preguntas, entregas y respuestas que te esperan" })
            nm.createNotificationChannel(NotificationChannel(CANAL_FIJO, "Conexión con la oficina", NotificationManager.IMPORTANCE_MIN)
                .apply { description = "El aviso fijo que Android pide mientras la app espera avisos. Se puede silenciar." })
        }

        fun abrirApp(ctx: Context, ruta: String, codigo: Int): PendingIntent = PendingIntent.getActivity(
            ctx, codigo,
            Intent(ctx, MainActivity::class.java).setAction(MainActivity.ABRIR).putExtra(MainActivity.RUTA, ruta),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

        fun notificar(ctx: Context, tag: String?, id: Int, n: android.app.Notification) {
            if (Build.VERSION.SDK_INT >= 33 &&
                ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
            try { NotificationManagerCompat.from(ctx).notify(tag, id, n) } catch (_: SecurityException) {}
        }
    }
}

/** «Permitir» / «No» desde el aviso de un permiso: lo contesta sin abrir la app (como sw.js). */
class AccionAviso : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        val permiso = intent.getStringExtra("permiso") ?: return
        val decision = intent.getStringExtra("decision") ?: return
        val tag = intent.getStringExtra("tag")
        val base = Prefs(ctx).base ?: return
        val fin = goAsync()
        thread {
            try {
                Api(base).post("/api/permisos/" + java.net.URLEncoder.encode(permiso, "UTF-8"), JSONObject().put("decision", decision))
                NotificationManagerCompat.from(ctx).cancel(tag, AvisosNativos.ID_AVISO)
            } catch (_: Exception) {
            } finally { fin.finish() }
        }
    }

    companion object {
        fun intento(ctx: Context, permiso: String, decision: String, tag: String): PendingIntent = PendingIntent.getBroadcast(
            ctx, (tag + decision).hashCode(),
            Intent(ctx, AccionAviso::class.java).putExtra("permiso", permiso).putExtra("decision", decision).putExtra("tag", tag),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
    }
}

/** Al prender el teléfono o actualizar la app: si los avisos estaban prendidos, vuelve a esperarlos. */
class ArranqueAvisos : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED || intent.action == Intent.ACTION_MY_PACKAGE_REPLACED) AvisosNativos.asegurar(ctx)
    }
}
