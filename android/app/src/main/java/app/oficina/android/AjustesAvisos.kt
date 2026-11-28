package app.oficina.android

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.provider.Settings

/**
 * Abre los ajustes de avisos de ESTA app (no los de Chrome ni los de otra «Oficina», como la PWA instalada desde Chrome).
 * La oficina web lo pide con intent://avisos#Intent;scheme=oficina-android;package=app.oficina.android;end cuando Chrome
 * dice que los avisos están bloqueados (oficina/ui/push.js). No muestra nada: abre los ajustes y se cierra.
 */
class AjustesAvisos : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val ajustes = Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
            .putExtra(Settings.EXTRA_APP_PACKAGE, packageName)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try { startActivity(ajustes) } catch (_: Exception) {
            startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, android.net.Uri.parse("package:$packageName")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }
        finish()
    }
}
