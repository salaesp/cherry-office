package app.oficina.android

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import java.io.File

/** Lo que la app recuerda: la oficina vinculada y lo que el widget necesita para dibujarse sin red. */
class Prefs(private val ctx: Context) {
    private val sp = ctx.getSharedPreferences("oficina", Context.MODE_PRIVATE)

    var base: String?
        get() = sp.getString("base", null)
        set(v) = sp.edit().putString("base", v).apply()

    var secretariaId: String?
        get() = sp.getString("sec_id", null)
        set(v) = sp.edit().putString("sec_id", v).apply()

    var secretariaNombre: String?
        get() = sp.getString("sec_nombre", null)
        set(v) = sp.edit().putString("sec_nombre", v).apply()

    /** color de la ropa de la secretaría (la tarjeta del widget se tiñe con él) */
    var color: Int
        get() = sp.getInt("sec_color", 0xFFC4473A.toInt())
        set(v) = sp.edit().putInt("sec_color", v).apply()

    /** firma del avatar ya dibujado, para no volver a dibujarlo si no cambió */
    var firmaRetrato: String?
        get() = sp.getString("sec_firma", null)
        set(v) = sp.edit().putString("sec_firma", v).apply()

    /** id de este teléfono para los avisos de la app (la oficina lo anota como `nativo:<id>`, backend/src/push.ts) */
    val dispositivo: String
        get() = sp.getString("dispositivo", null) ?: java.util.UUID.randomUUID().toString().also { sp.edit().putString("dispositivo", it).apply() }

    /** los avisos de la app están prendidos (AvisosNativos corre) */
    var avisosActivos: Boolean
        get() = sp.getBoolean("avisos_activos", false)
        set(v) = sp.edit().putBoolean("avisos_activos", v).apply()

    /** hasta dónde ya se trajeron avisos, y de qué arranque de la oficina */
    var avisosDesde: String
        get() = sp.getString("avisos_desde", "0") ?: "0"
        set(v) = sp.edit().putString("avisos_desde", v).apply()
    var avisosEpoca: String
        get() = sp.getString("avisos_epoca", "") ?: ""
        set(v) = sp.edit().putString("avisos_epoca", v).apply()

    private val archivoBusto get() = File(ctx.filesDir, "busto.png")

    fun guardarBusto(b: Bitmap) {
        archivoBusto.outputStream().use { b.compress(Bitmap.CompressFormat.PNG, 100, it) }
    }

    fun busto(): Bitmap? = archivoBusto.takeIf { it.exists() }?.let { BitmapFactory.decodeFile(it.path) }

    fun olvidar() {
        sp.edit().clear().apply()
        archivoBusto.delete()
    }
}
