package app.oficina.android

import android.content.Context
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

/**
 * Lo que el widget necesita de la oficina: quién atiende la secretaría, su nombre y su busto pixel. Se pide cada vez
 * que se abre la app y queda guardado (Prefs), así el widget se dibuja sin red.
 */
object Secretaria {
    private val alcance = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    /** Pone al día el widget en segundo plano; si la oficina no responde, queda lo último que se supo. */
    fun actualizar(ctx: Context) {
        val app = ctx.applicationContext
        alcance.launch { try { actualizarYa(app) } catch (_: ErrorOficina) {} }
    }

    /** Devuelve el nombre de la oficina abierta en la compu (para comprobar que la dirección anda). */
    suspend fun probar(base: String): String? = withContext(Dispatchers.IO) {
        val estado = Api(base).get("/api/estado")
        val of = estado.optJSONObject("oficina") ?: throw ErrorOficina("La compu no tiene ninguna oficina abierta.")
        of.optString("nombre").ifBlank { null }
    }

    private suspend fun actualizarYa(ctx: Context) {
        val p = Prefs(ctx)
        val api = Api(p.base ?: return)
        val of = withContext(Dispatchers.IO) { api.get("/api/oficina") }.optJSONObject("oficina") ?: JSONObject()
        val id = of.optJSONObject("secretaria")?.optString("agente")?.ifBlank { null }
        if (id == null) {
            p.secretariaId = null; p.secretariaNombre = null
            WidgetSecretaria.refrescar(ctx)
            return
        }
        val agentes = withContext(Dispatchers.IO) { api.get("/api/agentes") }.optJSONArray("agentes")
        var ag: JSONObject? = null
        for (i in 0 until (agentes?.length() ?: 0)) agentes!!.getJSONObject(i).let { if (it.optString("id") == id) ag = it }
        p.secretariaId = id
        p.secretariaNombre = ag?.optString("nombre")?.ifBlank { null } ?: "Secretaría"

        val avatar = ag?.optJSONObject("avatar")
        val firma = id + "|" + (avatar?.toString() ?: "")
        if (firma != p.firmaRetrato || p.busto() == null) {
            Retrato.pintar(ctx, avatar, id)?.let {
                p.guardarBusto(it.busto)
                p.color = it.color
                p.firmaRetrato = firma
            }
        }
        WidgetSecretaria.refrescar(ctx)
    }
}
