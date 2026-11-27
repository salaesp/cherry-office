package app.oficina.android

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.core.content.ContextCompat

class MainActivity : ComponentActivity() {
    private val charla: Charla by viewModels()
    private var grabarAlTenerPermiso = false

    private val pedirMic = registerForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
        if (ok && grabarAlTenerPermiso) charla.grabar()
        else if (!ok) charla.error = "Sin permiso de micrófono no puedo grabarle un audio."
        grabarAlTenerPermiso = false
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            Tema {
                App(
                    charla = charla,
                    grabar = { grabar() },
                    abrirOficina = { abrirOficina() },
                )
            }
        }
        if (savedInstanceState == null) atender(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        atender(intent)
    }

    override fun onResume() {
        super.onResume()
        charla.alVolver()
    }

    /** Los botones del widget (y los atajos del ícono): siempre una charla nueva con la secretaría. */
    private fun atender(i: Intent?) {
        when (i?.action) {
            WidgetSecretaria.ESCRIBIR -> charla.escribirNueva()
            WidgetSecretaria.AUDIO -> { charla.nueva(); grabar() }
        }
    }

    private fun grabar() {
        if (charla.base == null) return
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
            charla.grabar()
        } else {
            grabarAlTenerPermiso = true
            pedirMic.launch(Manifest.permission.RECORD_AUDIO)
        }
    }

    /** La oficina completa: la versión para celular que ya existe (la PWA), en el navegador. */
    private fun abrirOficina() {
        val b = charla.base ?: return
        startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("$b/?movil=1#/bandeja")))
    }
}
