package app.oficina.android

import android.app.Application
import android.util.Base64
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.util.UUID

data class Mensaje(val deUsuario: Boolean, val texto: String, val error: Boolean = false) {
    /** los audios llevan la misma marca que en la web (grabadora.js): la oficina los muestra con el micrófono */
    val voz: Boolean get() = deUsuario && texto.startsWith(MARCA_VOZ)
    val visible: String get() = if (voz) texto.removePrefix(MARCA_VOZ) else texto
}

data class CharlaGuardada(val session: String, val titulo: String, val ultimo: String, val ts: Long)

const val MARCA_VOZ = "(nota de voz) "

enum class Grabacion { NADA, GRABANDO, TRANSCRIBIENDO }

/** Estado de la app: la oficina vinculada, quién atiende la secretaría y la charla abierta con ella. */
class Charla(app: Application) : AndroidViewModel(app) {
    private val prefs = Prefs(app)
    private fun api() = Api(prefs.base ?: throw ErrorOficina("No hay una oficina vinculada."))

    var base by mutableStateOf(prefs.base)
        private set
    var secretaria by mutableStateOf(prefs.secretariaId?.let { it to (prefs.secretariaNombre ?: "Secretaría") })
        private set
    var oficina by mutableStateOf<String?>(null)
        private set
    var busto by mutableStateOf(prefs.busto())
        private set

    var session by mutableStateOf<String?>(null)
        private set
    var mensajes by mutableStateOf<List<Mensaje>>(emptyList())
        private set
    var enviando by mutableStateOf(false)
        private set
    /** lo último que está haciendo mientras responde (`/api/chat/vivo`) */
    var vivo by mutableStateOf<String?>(null)
        private set
    var error by mutableStateOf<String?>(null)
    var conectando by mutableStateOf(false)
        private set
    var charlas by mutableStateOf<List<CharlaGuardada>?>(null)
        private set

    var grabacion by mutableStateOf(Grabacion.NADA)
        private set
    var segundos by mutableIntStateOf(0)
        private set
    /** sube cada vez que hay que poner el cursor en el campo de escribir (widget «Escribir») */
    var pedirTeclado by mutableIntStateOf(0)
        private set

    private var grabadora: Grabadora? = null
    private var reloj: Job? = null

    init {
        if (base != null) viewModelScope.launch { cargar(abrirUltima = true) }
    }

    // ── vincular ──────────────────────────────────────────────────────────────────────────────────────────────────

    fun vincular(texto: String) {
        val b = Api.normalizar(texto)
        if (b == null) { error = "Eso no parece una dirección. Escaneá el QR de Ajustes › Celular en la compu."; return }
        viewModelScope.launch {
            conectando = true
            error = null
            try {
                val estado = io { Api(b).get("/api/estado") }
                if (estado.optJSONObject("oficina") == null) throw ErrorOficina("La compu no tiene ninguna oficina abierta.")
                prefs.base = b
                base = b
                cargar(abrirUltima = true)
            } catch (e: ErrorOficina) {
                error = e.message
            } finally {
                conectando = false
            }
        }
    }

    fun desvincular() {
        prefs.olvidar()
        base = null; secretaria = null; busto = null; oficina = null
        session = null; mensajes = emptyList(); charlas = null
        WidgetSecretaria.refrescar(getApplication())
    }

    /** Lee la oficina y quién atiende la secretaría; si cambió su apariencia, vuelve a dibujar el busto del widget. */
    private suspend fun cargar(abrirUltima: Boolean) {
        try {
            val of = io { api().get("/api/oficina") }.optJSONObject("oficina") ?: JSONObject()
            oficina = of.optString("nombre").ifBlank { null }
            val id = of.optJSONObject("secretaria")?.optString("agente")?.ifBlank { null }
            if (id == null) {
                secretaria = null
                prefs.secretariaId = null; prefs.secretariaNombre = null
                error = "Esta oficina no tiene secretaría. Contratala desde la compu, en Ajustes › Secretaría."
                WidgetSecretaria.refrescar(getApplication())
                return
            }
            val agentes = io { api().get("/api/agentes") }.optJSONArray("agentes")
            var ag: JSONObject? = null
            for (i in 0 until (agentes?.length() ?: 0)) agentes!!.getJSONObject(i).let { if (it.optString("id") == id) ag = it }
            val nombre = ag?.optString("nombre")?.ifBlank { null } ?: "Secretaría"
            secretaria = id to nombre
            prefs.secretariaId = id
            prefs.secretariaNombre = nombre

            val avatar = ag?.optJSONObject("avatar")
            val firma = id + "|" + (avatar?.toString() ?: "")
            if (firma != prefs.firmaRetrato || prefs.busto() == null) {
                Retrato.pintar(getApplication(), avatar, id)?.let {
                    prefs.guardarBusto(it.busto)
                    prefs.color = it.color
                    prefs.firmaRetrato = firma
                    busto = it.busto
                }
            }
            WidgetSecretaria.refrescar(getApplication())
            if (abrirUltima && session == null && !enviando) abrirUltima()
        } catch (e: ErrorOficina) {
            error = e.message
        }
    }

    /** Al volver a la app: refresca la charla abierta (la respuesta pudo llegar mientras no mirabas). */
    fun alVolver() {
        if (base == null) return
        viewModelScope.launch {
            cargar(abrirUltima = false)
            val s = session
            if (s != null && !enviando) recargar(s)
        }
    }

    // ── charlas ───────────────────────────────────────────────────────────────────────────────────────────────────

    /** Charla nueva con la secretaría (lo que hacen los botones del widget). */
    fun nueva() {
        if (enviando) return
        session = UUID.randomUUID().toString()
        mensajes = emptyList()
        error = null
    }

    fun escribirNueva() { nueva(); pedirTeclado++ }

    private suspend fun abrirUltima() {
        val id = secretaria?.first ?: return
        try {
            val r = io { api().get("/api/historial", mapOf("agent" to id)) }
            val s = r.optString("session").ifBlank { null }
            if (s != null && session == null) { session = s; mensajes = leer(r) }
        } catch (_: ErrorOficina) {}
    }

    fun abrir(s: String) {
        charlas = null
        session = s
        mensajes = emptyList()
        viewModelScope.launch { recargar(s) }
    }

    private suspend fun recargar(s: String) {
        val id = secretaria?.first ?: return
        try {
            val r = io { api().get("/api/historial", mapOf("agent" to id, "session" to s)) }
            if (session == s && !enviando) mensajes = leer(r)
        } catch (e: ErrorOficina) { error = e.message }
    }

    private fun leer(r: JSONObject): List<Mensaje> {
        val a = r.optJSONArray("msgs") ?: return emptyList()
        return (0 until a.length()).map { a.getJSONObject(it) }.map {
            Mensaje(it.optString("r") == "u", it.optString("t"), it.optBoolean("e"))
        }
    }

    fun verCharlas() {
        val id = secretaria?.first ?: return
        viewModelScope.launch {
            try {
                val a = io { api().get("/api/sesiones", mapOf("agent" to id)) }.optJSONArray("sesiones")
                charlas = (0 until (a?.length() ?: 0)).map { a!!.getJSONObject(it) }.map {
                    CharlaGuardada(it.optString("session"), it.optString("titulo"), it.optString("ultimo"), it.optLong("ts"))
                }
            } catch (e: ErrorOficina) { error = e.message }
        }
    }

    fun cerrarCharlas() { charlas = null }

    // ── mandar ────────────────────────────────────────────────────────────────────────────────────────────────────

    fun enviar(texto: String) {
        val t = texto.trim()
        val id = secretaria?.first ?: return
        if (t.isEmpty() || enviando) return
        val s = session ?: UUID.randomUUID().toString().also { session = it }
        mensajes = mensajes + Mensaje(true, t)
        enviando = true
        vivo = null
        error = null
        val seguir = viewModelScope.launch { seguirVivo(id, s) }
        viewModelScope.launch {
            try {
                val r = io {
                    api().post("/api/chat", JSONObject().put("agent", id).put("message", t).put("session", s), espera = 15 * 60_000)
                }
                if (session == s) mensajes = mensajes + Mensaje(false, r.optString("reply"))
            } catch (e: ErrorOficina) {
                error = e.message
            } finally {
                seguir.cancel()
                enviando = false
                vivo = null
                if (session == s) recargar(s)
            }
        }
    }

    private suspend fun seguirVivo(id: String, s: String) {
        while (coroutineContextActivo()) {
            delay(800)
            try {
                val r = io { api().get("/api/chat/vivo", mapOf("agent" to id), espera = 5_000) }
                if (r.optBoolean("activo") && r.optString("session") == s) vivo = resumirPasos(r)
            } catch (_: ErrorOficina) {}
        }
    }

    private suspend fun coroutineContextActivo() = kotlin.coroutines.coroutineContext.isActive

    private fun resumirPasos(r: JSONObject): String? {
        val pasos = r.optJSONArray("pasos") ?: return null
        if (pasos.length() == 0) return null
        val p = pasos.getJSONObject(pasos.length() - 1)
        return when (p.optString("t")) {
            "texto" -> p.optString("c").trim().lines().lastOrNull { it.isNotBlank() }?.take(140)
            "herramienta" -> "Usando " + p.optString("nombre").removePrefix("mcp__hq__").replace('_', ' ') +
                (p.optString("objetivo").ifBlank { null }?.let { " · $it" } ?: "") + "…"
            "archivo" -> "Trabajando en " + p.optString("nombre") + "…"
            else -> null
        }
    }

    fun cancelar() {
        val id = secretaria?.first ?: return
        viewModelScope.launch { try { io { api().post("/api/chat/cancelar", JSONObject().put("agent", id)) } } catch (_: ErrorOficina) {} }
    }

    // ── audio ─────────────────────────────────────────────────────────────────────────────────────────────────────

    fun grabar() {
        if (grabacion != Grabacion.NADA || enviando) return
        val g = Grabadora { viewModelScope.launch { mandarAudio() } }
        try {
            g.empezar()
        } catch (e: Exception) {
            error = e.message ?: "No pude usar el micrófono."
            return
        }
        grabadora = g
        grabacion = Grabacion.GRABANDO
        segundos = 0
        reloj = viewModelScope.launch { while (isActive) { delay(250); segundos = g.segundos } }
    }

    fun cancelarAudio() {
        reloj?.cancel()
        grabadora?.cancelar()
        grabadora = null
        grabacion = Grabacion.NADA
    }

    fun mandarAudio() {
        val g = grabadora ?: return
        grabadora = null
        reloj?.cancel()
        viewModelScope.launch {
            val wav = io { g.terminar() }
            if (wav == null) { grabacion = Grabacion.NADA; error = "El audio quedó vacío."; return@launch }
            grabacion = Grabacion.TRANSCRIBIENDO
            try {
                val r = io {
                    api().post("/api/audio/transcribir", JSONObject().put("wav", Base64.encodeToString(wav, Base64.NO_WRAP)), espera = 5 * 60_000)
                }
                grabacion = Grabacion.NADA
                enviar(MARCA_VOZ + r.optString("texto"))
            } catch (e: ErrorOficina) {
                grabacion = Grabacion.NADA
                error = e.message
            }
        }
    }

    override fun onCleared() { grabadora?.cancelar() }

    private suspend fun <T> io(f: () -> T): T = withContext(Dispatchers.IO) { f() }
}
