package app.oficina.android

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.browser.trusted.TrustedWebActivityIntentBuilder
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.google.androidbrowserhelper.trusted.TwaLauncher

/**
 * La app es la oficina web del celular abierta en Chrome como Trusted Web Activity: pantalla completa, sin barra de
 * direcciones, y los avisos de la oficina (Web Push, backend/src/push.ts) llegan como avisos de esta app
 * (DelegationService en el manifest). Lo nativo es lo que la web no puede: el widget, vincular con el QR y los atajos.
 */
class MainActivity : ComponentActivity() {
    private var lanzador: TwaLauncher? = null
    private var abierta = false
    private var pendiente: String? = null

    private val pedirAvisos = registerForActivityResult(ActivityResultContracts.RequestPermission()) {
        pendiente?.let { abrir(it) }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        atender(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        atender(intent)
    }

    /** Volvieron desde la oficina (Atrás): esta pantalla no tiene nada que mostrar, se cierra. */
    override fun onRestart() {
        super.onRestart()
        if (abierta) finish()
    }

    override fun onDestroy() {
        lanzador?.destroy()
        super.onDestroy()
    }

    private fun atender(i: Intent?) {
        val prefs = Prefs(this)
        if (prefs.base == null || i?.action == VINCULAR) { mostrarVincular(); return }
        Secretaria.actualizar(this)
        AvisosNativos.asegurar(this)
        abrir(
            when (i?.action) {
                ABRIR -> i.getStringExtra(RUTA)?.takeIf { it.startsWith("#/") } ?: "#/bandeja/hoy"
                WidgetSecretaria.ESCRIBIR -> "#/secretaria/escribir"
                WidgetSecretaria.AUDIO -> "#/secretaria/hablar"
                else -> "#/bandeja/hoy"
            }
        )
    }

    private fun abrir(ruta: String) {
        val base = Prefs(this).base ?: return
        // Android 13+: el permiso de avisos se pide una vez, antes de abrir la oficina
        if (Build.VERSION.SDK_INT >= 33 && pendiente == null &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED &&
            !getSharedPreferences("oficina", MODE_PRIVATE).getBoolean("avisos_pedidos", false)
        ) {
            getSharedPreferences("oficina", MODE_PRIVATE).edit().putBoolean("avisos_pedidos", true).apply()
            pendiente = ruta
            pedirAvisos.launch(Manifest.permission.POST_NOTIFICATIONS)
            return
        }
        pendiente = null
        // Chrome si está: la librería elige el navegador predeterminado, y no todos le pasan los avisos a la app
        val l = lanzador ?: TwaLauncher(this, chrome()).also { lanzador = it }
        // avisosApp: si Android tiene prendidos los avisos de esta app; la web lo usa para explicar un «bloqueado» de Chrome
        val avisos = if (NotificationManagerCompat.from(this).areNotificationsEnabled()) "si" else "no"
        val diag = Uri.encode("navegador=${l.providerPackage} " + Delegacion.diagnostico(this))
        // avisosId: con él la web prende los avisos de la app (AvisosNativos) en vez de los de Chrome
        val id = Uri.encode(Prefs(this).dispositivo)
        l.launch(TrustedWebActivityIntentBuilder(Uri.parse("$base/?movil=1&avisosApp=$avisos&avisosId=$id&avisosDiag=$diag$ruta")), null, null, null)
        abierta = true
    }

    /** Chrome estable, si está instalado y habilitado; si no, null (la librería elige). */
    private fun chrome(): String? = try {
        if (packageManager.getApplicationInfo(CHROME, 0).enabled) CHROME else null
    } catch (_: Exception) { null }

    private fun mostrarVincular() {
        abierta = false
        setContent {
            Tema {
                PantallaVincular(
                    actual = Prefs(this).base,
                    alVincular = { base ->
                        Prefs(this).base = base
                        Secretaria.actualizar(this)
                        abrir("#/bandeja/hoy")
                    },
                    alDesvincular = {
                        Prefs(this).olvidar()
                        WidgetSecretaria.refrescar(this)
                    },
                )
            }
        }
    }

    companion object {
        const val VINCULAR = "app.oficina.android.VINCULAR"
        /** abrir la oficina en [RUTA] (al tocar un aviso de AvisosNativos) */
        const val ABRIR = "app.oficina.android.ABRIR"
        const val RUTA = "ruta"
        private const val CHROME = "com.android.chrome"
    }
}
