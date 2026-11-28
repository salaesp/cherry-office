package app.oficina.android

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings

/**
 * Lo que la oficina web le pide a la app (oficina/ui/push.js), sin mostrar nada:
 * - oficina-android://avisos → los ajustes de avisos de ESTA app (no los de Chrome ni los de otra «Oficina»);
 * - oficina-android://avisos-prender → prende los avisos de la app (AvisosNativos) y, si Android puede frenarla para
 *   ahorrar batería, pide permiso para que no lo haga (si no, los avisos con el teléfono quieto llegan tarde).
 */
class AjustesAvisos : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        when (intent?.data?.host) {
            "avisos-prender" -> prender()
            else -> abrirAjustes()
        }
        finish()
    }

    private fun prender() {
        if (Prefs(this).base == null) return
        AvisosNativos.prender(this)
        val pm = getSystemService(PowerManager::class.java)
        if (!pm.isIgnoringBatteryOptimizations(packageName)) {
            try {
                startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName")))
            } catch (_: Exception) {}
        }
    }

    private fun abrirAjustes() {
        val ajustes = Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
            .putExtra(Settings.EXTRA_APP_PACKAGE, packageName)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try { startActivity(ajustes) } catch (_: Exception) {
            startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }
    }
}
