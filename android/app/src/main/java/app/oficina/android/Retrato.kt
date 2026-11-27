package app.oficina.android

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.webkit.WebViewClient
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONObject
import kotlin.coroutines.resume

/**
 * Dibuja el busto pixel de un agente con el mismo código que la oficina (oficina/ui/pixel/personajes.js y avatar.js,
 * que el build copia a los assets) en un WebView que no se muestra. Devuelve el busto y el color de su ropa.
 */
object Retrato {
    class Resultado(val busto: Bitmap, val color: Int)

    @SuppressLint("SetJavaScriptEnabled")
    suspend fun pintar(ctx: Context, avatar: JSONObject?, semilla: String, tam: Int = 240): Resultado? = withTimeoutOrNull(15_000) {
        suspendCancellableCoroutine { cont ->
            val main = Handler(Looper.getMainLooper())
            main.post {
                val web = WebView(ctx.applicationContext)
                var listo = false
                fun cerrar(r: Resultado?) {
                    if (listo) return
                    listo = true
                    main.post { web.destroy() }
                    if (cont.isActive) cont.resume(r)
                }
                web.settings.javaScriptEnabled = true
                web.addJavascriptInterface(object {
                    @JavascriptInterface
                    fun listo(dataUrl: String, color: String) {
                        val r = try {
                            val bytes = Base64.decode(dataUrl.substringAfter(","), Base64.DEFAULT)
                            val bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
                            val c = try { Color.parseColor(color) } catch (_: Exception) { 0xFFC4473A.toInt() }
                            bmp?.let { Resultado(recortar(it), c) }
                        } catch (_: Exception) { null }
                        cerrar(r)
                    }
                    @JavascriptInterface
                    fun fallo() = cerrar(null)
                }, "Puente")
                web.webViewClient = object : WebViewClient() {
                    override fun onPageFinished(view: WebView, url: String) {
                        val av = JSONObject.quote((avatar ?: JSONObject()).toString())
                        view.evaluateJavascript("pintar($av, ${JSONObject.quote(semilla)}, $tam)", null)
                    }
                }
                web.loadUrl("file:///android_asset/retrato.html")
                cont.invokeOnCancellation { main.post { if (!listo) { listo = true; web.destroy() } } }
            }
        }
    }

    /** Saca el margen transparente de abajo, así el busto apoya en el borde de la tarjeta. */
    private fun recortar(b: Bitmap): Bitmap {
        var abajo = b.height - 1
        fila@ while (abajo > 0) {
            for (x in 0 until b.width) if (Color.alpha(b.getPixel(x, abajo)) != 0) break@fila
            abajo--
        }
        var arriba = 0
        fila@ while (arriba < abajo) {
            for (x in 0 until b.width) if (Color.alpha(b.getPixel(x, arriba)) != 0) break@fila
            arriba++
        }
        return Bitmap.createBitmap(b, 0, arriba, b.width, abajo - arriba + 1)
    }
}
