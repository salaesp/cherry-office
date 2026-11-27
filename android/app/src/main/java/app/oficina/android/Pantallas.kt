package app.oficina.android

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning

@Composable
fun App(charla: Charla, grabar: () -> Unit, abrirOficina: () -> Unit) {
    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        if (charla.base == null) PantallaVincular(charla) else PantallaChat(charla, grabar, abrirOficina)
    }
}

// ── vincular ──────────────────────────────────────────────────────────────────────────────────────────────────────

@Composable
private fun PantallaVincular(charla: Charla) {
    val ctx = LocalContext.current
    var direccion by rememberSaveable { mutableStateOf("") }
    Column(
        Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().imePadding().padding(24.dp),
        verticalArrangement = Arrangement.Center,
    ) {
        Text("Vinculá tu oficina", fontSize = 26.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(10.dp))
        Text(
            "En la compu, abrí Oficina › Ajustes › Celular y escaneá el QR. Hace falta Tailscale prendido en la compu y en " +
                "este celular, con la misma cuenta.",
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(24.dp))
        Button(
            onClick = {
                val op = GmsBarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build()
                GmsBarcodeScanning.getClient(ctx, op).startScan()
                    .addOnSuccessListener { c -> c.rawValue?.let { charla.vincular(it) } }
                    .addOnFailureListener { charla.error = "No pude abrir el lector de QR. Escribí la dirección abajo." }
            },
            enabled = !charla.conectando,
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
            onClick = { charla.vincular(direccion) },
            enabled = !charla.conectando && direccion.isNotBlank(),
            modifier = Modifier.fillMaxWidth().height(48.dp),
            shape = RoundedCornerShape(14.dp),
        ) {
            if (charla.conectando) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp) else Text("Conectar")
        }
        charla.error?.let {
            Spacer(Modifier.height(16.dp))
            Text(it, color = MaterialTheme.colorScheme.error)
        }
    }
}

// ── chat ──────────────────────────────────────────────────────────────────────────────────────────────────────────

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun PantallaChat(charla: Charla, grabar: () -> Unit, abrirOficina: () -> Unit) {
    val nombre = charla.secretaria?.second ?: "Secretaría"
    var menu by remember { mutableStateOf(false) }
    val lista = rememberLazyListState()
    val cantidad = charla.mensajes.size + (if (charla.enviando) 1 else 0)
    LaunchedEffect(cantidad, charla.vivo) { if (cantidad > 0) lista.animateScrollToItem(cantidad - 1) }

    Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().imePadding()) {
        // cabecera: busto, nombre y oficina
        Row(Modifier.fillMaxWidth().padding(start = 14.dp, end = 4.dp, top = 6.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Busto(charla, 40)
            Column(Modifier.weight(1f).padding(start = 10.dp)) {
                Text(nombre, fontWeight = FontWeight.Bold, fontSize = 17.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                charla.oficina?.let { Text(it, fontSize = 12.5.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1) }
            }
            IconButton(onClick = { charla.nueva() }, enabled = !charla.enviando) { Icon(Icons.Default.Add, "Charla nueva") }
            Box {
                IconButton(onClick = { menu = true }) { Icon(Icons.Default.MoreVert, "Más") }
                DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                    DropdownMenuItem(text = { Text("Charlas anteriores") }, onClick = { menu = false; charla.verCharlas() })
                    DropdownMenuItem(text = { Text("Abrir la oficina completa") }, onClick = { menu = false; abrirOficina() })
                    DropdownMenuItem(text = { Text("Desvincular este celular") }, onClick = { menu = false; charla.desvincular() })
                }
            }
        }
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

        Box(Modifier.weight(1f).fillMaxWidth()) {
            if (charla.mensajes.isEmpty() && !charla.enviando) {
                Vacio(charla, nombre)
            } else {
                LazyColumn(state = lista, contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(charla.mensajes) { Burbuja(it) }
                    if (charla.enviando) item { Pensando(nombre, charla.vivo, charla::cancelar) }
                }
            }
        }

        charla.error?.let {
            Row(
                Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.error.copy(alpha = .1f)).padding(horizontal = 14.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(it, color = MaterialTheme.colorScheme.error, fontSize = 13.sp, modifier = Modifier.weight(1f))
                IconButton(onClick = { charla.error = null }, modifier = Modifier.size(32.dp)) { Icon(Icons.Default.Close, "Cerrar", Modifier.size(18.dp)) }
            }
        }

        CajaEscribir(charla, nombre, grabar)
    }

    charla.charlas?.let { lista ->
        ModalBottomSheet(onDismissRequest = { charla.cerrarCharlas() }) {
            Text("Charlas con $nombre", fontWeight = FontWeight.Bold, fontSize = 17.sp, modifier = Modifier.padding(horizontal = 20.dp, vertical = 6.dp))
            if (lista.isEmpty()) Text("Todavía no hay charlas.", Modifier.padding(20.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
            LazyColumn(Modifier.heightIn(max = 520.dp), contentPadding = PaddingValues(bottom = 24.dp)) {
                items(lista) { c ->
                    Column(Modifier.fillMaxWidth().clickable { charla.abrir(c.session) }.padding(horizontal = 20.dp, vertical = 10.dp)) {
                        Text(c.titulo.removePrefix(MARCA_VOZ), fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(c.ultimo.removePrefix(MARCA_VOZ), fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
            }
        }
    }
}

@Composable
private fun Busto(charla: Charla, tam: Int) {
    Box(Modifier.size(tam.dp).clip(RoundedCornerShape(12.dp)).background(Color(Prefs(LocalContext.current).color).copy(alpha = .22f)), contentAlignment = Alignment.BottomCenter) {
        charla.busto?.let {
            Image(it.asImageBitmap(), null, Modifier.fillMaxSize().padding(top = 3.dp), contentScale = ContentScale.Fit, filterQuality = FilterQuality.None)
        }
    }
}

@Composable
private fun Vacio(charla: Charla, nombre: String) {
    Column(Modifier.fillMaxSize().padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        Busto(charla, 96)
        Spacer(Modifier.height(14.dp))
        Text("¿Qué necesitás?", fontSize = 22.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(6.dp))
        Text(
            "Escribile o dejale un audio a $nombre. Si es para otro de la oficina, se lo pasa.",
            color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 14.sp,
        )
    }
}

@Composable
private fun Burbuja(m: Mensaje) {
    val propio = m.deUsuario
    Row(Modifier.fillMaxWidth(), horizontalArrangement = if (propio) Arrangement.End else Arrangement.Start) {
        Surface(
            color = when {
                m.error -> MaterialTheme.colorScheme.error.copy(alpha = .1f)
                propio -> MaterialTheme.colorScheme.primary
                else -> MaterialTheme.colorScheme.surfaceVariant
            },
            contentColor = if (propio && !m.error) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurface,
            shape = RoundedCornerShape(18.dp, 18.dp, if (propio) 6.dp else 18.dp, if (propio) 18.dp else 6.dp),
            modifier = Modifier.widthIn(max = 320.dp),
        ) {
            Row(Modifier.padding(horizontal = 13.dp, vertical = 9.dp)) {
                if (m.voz) Icon(Icons.Default.Mic, "Audio", Modifier.size(16.dp).padding(top = 2.dp).alpha(.7f))
                if (m.voz) Spacer(Modifier.size(5.dp))
                Text(if (propio) AnnotatedString(m.visible) else markdown(m.visible), fontSize = 15.sp, lineHeight = 21.sp)
            }
        }
    }
}

@Composable
private fun Pensando(nombre: String, vivo: String?, cancelar: () -> Unit) {
    val t = rememberInfiniteTransition(label = "pensando")
    val a by t.animateFloat(.35f, 1f, infiniteRepeatable(tween(700), RepeatMode.Reverse), label = "alfa")
    Row(verticalAlignment = Alignment.CenterVertically) {
        Surface(color = MaterialTheme.colorScheme.surfaceVariant, shape = RoundedCornerShape(18.dp, 18.dp, 18.dp, 6.dp), modifier = Modifier.weight(1f, fill = false)) {
            Column(Modifier.padding(horizontal = 13.dp, vertical = 9.dp)) {
                Text("$nombre está respondiendo…", fontSize = 13.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.alpha(a))
                vivo?.let { Text(it, fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis) }
            }
        }
        IconButton(onClick = cancelar) { Icon(Icons.Default.Stop, "Detener") }
    }
}

/** Caja de escribir como la de la web (píldora + un botón grande que es micrófono o enviar). */
@Composable
private fun CajaEscribir(charla: Charla, nombre: String, grabar: () -> Unit) {
    var texto by rememberSaveable { mutableStateOf("") }
    val foco = remember { FocusRequester() }
    val teclado = LocalSoftwareKeyboardController.current
    LaunchedEffect(charla.pedirTeclado) {
        if (charla.pedirTeclado > 0) { foco.requestFocus(); teclado?.show() }
    }

    Row(Modifier.fillMaxWidth().padding(10.dp), verticalAlignment = Alignment.Bottom) {
        when (charla.grabacion) {
            Grabacion.GRABANDO -> {
                val t = rememberInfiniteTransition(label = "rec")
                val a by t.animateFloat(.3f, 1f, infiniteRepeatable(tween(600), RepeatMode.Reverse), label = "rec-alfa")
                Surface(color = MaterialTheme.colorScheme.surfaceVariant, shape = RoundedCornerShape(26.dp), modifier = Modifier.weight(1f).height(52.dp)) {
                    Row(Modifier.padding(start = 6.dp, end = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                        IconButton(onClick = { charla.cancelarAudio() }) { Icon(Icons.Default.Close, "Cancelar") }
                        Box(Modifier.size(10.dp).alpha(a).clip(CircleShape).background(Color(0xFFD23A33)))
                        Spacer(Modifier.size(8.dp))
                        Text("Para $nombre", modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text("%d:%02d".format(charla.segundos / 60, charla.segundos % 60), fontFamily = FontFamily.Monospace)
                    }
                }
                Spacer(Modifier.size(8.dp))
                BotonRedondo(Icons.AutoMirrored.Filled.Send, "Mandar el audio") { charla.mandarAudio() }
            }
            Grabacion.TRANSCRIBIENDO -> {
                Surface(color = MaterialTheme.colorScheme.surfaceVariant, shape = RoundedCornerShape(26.dp), modifier = Modifier.weight(1f).height(52.dp)) {
                    Row(Modifier.padding(horizontal = 18.dp), verticalAlignment = Alignment.CenterVertically) {
                        CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                        Spacer(Modifier.size(10.dp))
                        Text("Transcribiendo en la compu…")
                    }
                }
            }
            Grabacion.NADA -> {
                TextField(
                    value = texto,
                    onValueChange = { texto = it },
                    placeholder = { Text("Escribile a $nombre") },
                    modifier = Modifier.weight(1f).heightIn(min = 52.dp, max = 160.dp).focusRequester(foco),
                    shape = RoundedCornerShape(26.dp),
                    colors = TextFieldDefaults.colors(
                        focusedContainerColor = MaterialTheme.colorScheme.surfaceVariant,
                        unfocusedContainerColor = MaterialTheme.colorScheme.surfaceVariant,
                        focusedIndicatorColor = Color.Transparent,
                        unfocusedIndicatorColor = Color.Transparent,
                        disabledIndicatorColor = Color.Transparent,
                    ),
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
                    enabled = charla.secretaria != null,
                )
                Spacer(Modifier.size(8.dp))
                if (texto.isBlank()) {
                    BotonRedondo(Icons.Default.Mic, "Grabar un audio", enabled = !charla.enviando && charla.secretaria != null) { grabar() }
                } else {
                    BotonRedondo(Icons.AutoMirrored.Filled.Send, "Enviar", enabled = !charla.enviando) {
                        charla.enviar(texto); texto = ""
                    }
                }
            }
        }
    }
}

@Composable
private fun BotonRedondo(icono: androidx.compose.ui.graphics.vector.ImageVector, desc: String, enabled: Boolean = true, onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        enabled = enabled,
        shape = CircleShape,
        color = MaterialTheme.colorScheme.primary,
        contentColor = MaterialTheme.colorScheme.onPrimary,
        modifier = Modifier.size(52.dp).alpha(if (enabled) 1f else .4f),
    ) {
        Box(contentAlignment = Alignment.Center) { Icon(icono, desc) }
    }
}

/** Markdown mínimo para las respuestas: títulos, viñetas, **negrita** y `código`. */
private fun markdown(t: String): AnnotatedString = buildAnnotatedString {
    t.lines().forEachIndexed { i, crudo ->
        if (i > 0) append('\n')
        var l = crudo
        val titulo = Regex("^#{1,6}\\s+").find(l)
        if (titulo != null) {
            withStyle(SpanStyle(fontWeight = FontWeight.Bold)) { append(l.substring(titulo.range.last + 1)) }
            return@forEachIndexed
        }
        Regex("^(\\s*)[-*]\\s+").find(l)?.let { l = it.groupValues[1] + "• " + l.substring(it.range.last + 1) }
        var k = 0
        val marca = Regex("\\*\\*(.+?)\\*\\*|`([^`]+)`")
        for (m in marca.findAll(l)) {
            append(l.substring(k, m.range.first))
            if (m.groupValues[1].isNotEmpty()) withStyle(SpanStyle(fontWeight = FontWeight.Bold)) { append(m.groupValues[1]) }
            else withStyle(SpanStyle(fontFamily = FontFamily.Monospace, background = Color(0x1F808080))) { append(m.groupValues[2]) }
            k = m.range.last + 1
        }
        append(l.substring(k))
    }
}
