package app.oficina.android

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.browser.trusted.TrustedWebActivityCallbackRemote
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.google.androidbrowserhelper.trusted.DelegationService
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * El DelegationService de android-browser-helper (Chrome le pregunta acá si la oficina puede mandar avisos y los avisos
 * Web Push salen como de esta app), anotando qué preguntó Chrome y qué se le contestó. Con eso [diagnostico] arma un
 * resumen que MainActivity le pasa a la web (?avisosDiag=…) para mostrarlo si Chrome dice que los avisos están bloqueados.
 */
class Delegacion : DelegationService() {
    override fun onExtraCommand(commandName: String, args: Bundle, callbackRemote: TrustedWebActivityCallbackRemote?): Bundle? {
        val r = super.onExtraCommand(commandName, args, callbackRemote)
        val canal = args.getString("notificationChannelName")
        val estado = when (r?.getInt("permissionStatus", -1)) { 0 -> "ALLOW"; 1 -> "BLOCK"; 2 -> "ASK"; else -> if (r?.containsKey("notificationPermissionRequestPendingIntent") == true) "pedido" else "-" }
        anotar(this, "$commandName($canal)=$estado")
        return r
    }

    override fun onAreNotificationsEnabled(channelName: String): Boolean {
        val r = super.onAreNotificationsEnabled(channelName)
        anotar(this, "areNotificationsEnabled($channelName)=$r")
        return r
    }

    companion object {
        private const val CLAVE = "diag_avisos"

        private fun anotar(ctx: Context, que: String) {
            val sp = ctx.getSharedPreferences("oficina", Context.MODE_PRIVATE)
            val hora = SimpleDateFormat("dd/MM HH:mm", Locale.ROOT).format(Date())
            val lista = (sp.getString(CLAVE, "") ?: "").split(" | ").filter { it.isNotBlank() }.takeLast(5) + "$hora $que"
            sp.edit().putString(CLAVE, lista.joinToString(" | ")).apply()
        }

        /** Estado de los avisos según Android y lo último que preguntó Chrome, en una línea. */
        fun diagnostico(ctx: Context): String {
            val nm = NotificationManagerCompat.from(ctx)
            val permiso = if (Build.VERSION.SDK_INT >= 33)
                (ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED).toString() else "n/a"
            val canales = if (Build.VERSION.SDK_INT >= 26) nm.notificationChannels.joinToString(",") { "${it.id}:${it.importance}" } else "n/a"
            val chrome = ctx.getSharedPreferences("oficina", Context.MODE_PRIVATE).getString(CLAVE, null) ?: "Chrome nunca preguntó"
            return "android${Build.VERSION.SDK_INT} app=${nm.areNotificationsEnabled()} permiso=$permiso canales=[$canales] chrome: $chrome"
        }
    }
}
