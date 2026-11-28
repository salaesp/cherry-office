package app.oficina.android

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning
import kotlinx.coroutines.launch

/** Vincular la app con una oficina: el QR de Ajustes › Celular en la compu, o la dirección a mano. */
@Composable
fun PantallaVincular(actual: String?, alVincular: (String) -> Unit, alDesvincular: () -> Unit) {
    val ctx = LocalContext.current
    val alcance = rememberCoroutineScope()
    var direccion by rememberSaveable { mutableStateOf("") }
    var vinculada by rememberSaveable { mutableStateOf(actual) }
    var probando by rememberSaveable { mutableStateOf(false) }
    var error by rememberSaveable { mutableStateOf<String?>(null) }

    fun probar(texto: String) {
        val b = Api.normalizar(texto)
        if (b == null) { error = "Eso no parece una dirección. Escaneá el QR de Ajustes › Celular en la compu."; return }
        alcance.launch {
            probando = true; error = null
            try {
                Secretaria.probar(b)
                alVincular(b)
            } catch (e: ErrorOficina) {
                error = e.message
            } finally {
                probando = false
            }
        }
    }

    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Column(
            Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().imePadding().padding(24.dp),
            verticalArrangement = Arrangement.Center,
        ) {
            Text(if (vinculada == null) "Vinculá tu oficina" else "Cambiar de oficina", fontSize = 26.sp, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(10.dp))
            Text(
                "En la compu, abrí Oficina › Ajustes › Celular y escaneá el QR. Hace falta Tailscale prendido en la compu y en " +
                    "este celular, con la misma cuenta.",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            vinculada?.let {
                Spacer(Modifier.height(10.dp))
                Text("Ahora: $it", fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Spacer(Modifier.height(24.dp))
            Button(
                onClick = {
                    val op = GmsBarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build()
                    GmsBarcodeScanning.getClient(ctx, op).startScan()
                        .addOnSuccessListener { c -> c.rawValue?.let { probar(it) } }
                        .addOnFailureListener { error = "No pude abrir el lector de QR. Escribí la dirección abajo." }
                },
                enabled = !probando,
                modifier = Modifier.fillMaxWidth().height(52.dp),
                shape = RoundedCornerShape(16.dp),
            ) {
                Icon(Icons.Default.QrCodeScanner, null)
                Spacer(Modifier.size(8.dp))
                Text("Escanear el QR", fontWeight = FontWeight.Bold)
            }
            Spacer(Modifier.height(20.dp))
            Text("O escribí la dirección", color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 13.sp)
            Spacer(Modifier.height(6.dp))
            OutlinedTextField(
                value = direccion,
                onValueChange = { direccion = it },
                placeholder = { Text("compu.tu-red.ts.net") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.None, imeAction = ImeAction.Go),
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(14.dp),
            )
            Spacer(Modifier.height(10.dp))
            OutlinedButton(
                onClick = { probar(direccion) },
                enabled = !probando && direccion.isNotBlank(),
                modifier = Modifier.fillMaxWidth().height(48.dp),
                shape = RoundedCornerShape(14.dp),
            ) {
                if (probando) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp) else Text("Conectar")
            }
            if (vinculada != null) {
                Spacer(Modifier.height(6.dp))
                TextButton(onClick = { alDesvincular(); vinculada = null }, modifier = Modifier.fillMaxWidth()) {
                    Text("Desvincular este celular", color = MaterialTheme.colorScheme.error)
                }
            }
            error?.let {
                Spacer(Modifier.height(16.dp))
                Text(it, color = MaterialTheme.colorScheme.error)
            }
        }
    }
}
