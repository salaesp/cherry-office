package app.oficina.android

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.widget.RemoteViews

/**
 * Widget 2×2 «sale del marco» (bocetos/widget-android/tarjeta.html, opción D): la tarjeta se tiñe con el color de
 * la ropa de la secretaría, su busto pixel se asoma por arriba y va solo su nombre. «Escribir» y «Hablar» abren
 * una charla nueva con ella; tocar el busto abre la app en la última charla.
 */
class WidgetSecretaria : AppWidgetProvider() {

    override fun onUpdate(ctx: Context, mgr: AppWidgetManager, ids: IntArray) {
        val v = vistas(ctx)
        ids.forEach { mgr.updateAppWidget(it, v) }
    }

    companion object {
        const val ESCRIBIR = "app.oficina.android.ESCRIBIR"
        const val AUDIO = "app.oficina.android.AUDIO"

        /** Vuelve a dibujar todos los widgets puestos (al vincular, o si cambió la secretaría o su apariencia). */
        fun refrescar(ctx: Context) {
            val mgr = AppWidgetManager.getInstance(ctx)
            val ids = mgr.getAppWidgetIds(ComponentName(ctx, WidgetSecretaria::class.java))
            if (ids.isNotEmpty()) {
                val v = vistas(ctx)
                ids.forEach { mgr.updateAppWidget(it, v) }
            }
        }

        private fun abrir(ctx: Context, accion: String?, codigo: Int): PendingIntent {
            val i = Intent(ctx, MainActivity::class.java).apply {
                action = accion ?: Intent.ACTION_MAIN
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            }
            return PendingIntent.getActivity(ctx, codigo, i, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        }

        private fun vistas(ctx: Context): RemoteViews {
            val p = Prefs(ctx)
            val v = RemoteViews(ctx.packageName, R.layout.widget_secretaria)
            // la tarjeta va un tono más clara que la ropa: si fuera igual, el busto se perdería contra el fondo
            val color = tarjeta(p.color)
            v.setInt(R.id.w_marco, "setColorFilter", color)
            p.busto()?.let { v.setImageViewBitmap(R.id.w_busto, it) }
            v.setTextViewText(R.id.w_nombre, p.secretariaNombre ?: if (p.base == null) "Vinculá tu oficina" else ctx.getString(R.string.app_name))

            // ropa clara (blanca, amarilla): letras oscuras y botón de hablar negro
            if (claro(color)) {
                val tinta = 0xFF1D1D1F.toInt()
                v.setTextColor(R.id.w_nombre, tinta)
                v.setTextColor(R.id.w_escribir_txt, tinta)
                v.setInt(R.id.w_escribir_ico, "setColorFilter", tinta)
                v.setInt(R.id.w_escribir, "setBackgroundResource", R.drawable.w_boton_trans_oscuro)
                v.setInt(R.id.w_hablar, "setBackgroundResource", R.drawable.w_boton_negro)
                v.setTextColor(R.id.w_hablar_txt, Color.WHITE)
                v.setInt(R.id.w_hablar_ico, "setColorFilter", Color.WHITE)
            } else {
                v.setTextColor(R.id.w_nombre, Color.WHITE)
                v.setTextColor(R.id.w_escribir_txt, Color.WHITE)
                v.setInt(R.id.w_escribir_ico, "setColorFilter", Color.WHITE)
                v.setInt(R.id.w_escribir, "setBackgroundResource", R.drawable.w_boton_trans)
                v.setInt(R.id.w_hablar, "setBackgroundResource", R.drawable.w_boton_blanco)
                v.setTextColor(R.id.w_hablar_txt, 0xFF1D1D1F.toInt())
                v.setInt(R.id.w_hablar_ico, "setColorFilter", 0xFF1D1D1F.toInt())
            }

            v.setOnClickPendingIntent(R.id.w_escribir, abrir(ctx, ESCRIBIR, 1))
            v.setOnClickPendingIntent(R.id.w_hablar, abrir(ctx, AUDIO, 2))
            v.setOnClickPendingIntent(R.id.w_abrir, abrir(ctx, null, 3))
            return v
        }

        fun tarjeta(ropa: Int): Int {
            fun m(c: Int) = (c + (255 - c) * 0.3).toInt()
            return Color.rgb(m(Color.red(ropa)), m(Color.green(ropa)), m(Color.blue(ropa)))
        }

        fun claro(c: Int): Boolean {
            val l = (0.299 * Color.red(c) + 0.587 * Color.green(c) + 0.114 * Color.blue(c)) / 255
            return l > 0.68
        }
    }
}
