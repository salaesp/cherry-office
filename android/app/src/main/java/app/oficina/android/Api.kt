package app.oficina.android

import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/** Error de la oficina: el `error` que manda el backend (en español) o uno nuestro si no hubo respuesta. */
class ErrorOficina(mensaje: String, val status: Int = 0) : Exception(mensaje)

/**
 * Cliente mínimo de la API del backend (backend/API.md). Usa la misma dirección que la PWA (la de `tailscale serve`).
 * El servidor rechaza escrituras sin un `Origin` propio (servidor-dev.ts): como no somos un navegador, lo mandamos
 * nosotros con la misma dirección de la oficina.
 */
class Api(val base: String) {

    fun get(ruta: String, query: Map<String, String> = emptyMap(), espera: Int = 20_000): JSONObject {
        val q = if (query.isEmpty()) "" else "?" + query.entries.joinToString("&") {
            URLEncoder.encode(it.key, "UTF-8") + "=" + URLEncoder.encode(it.value, "UTF-8")
        }
        return pedir("GET", ruta + q, null, espera)
    }

    fun post(ruta: String, cuerpo: JSONObject, espera: Int = 30_000): JSONObject = pedir("POST", ruta, cuerpo, espera)

    private fun pedir(metodo: String, ruta: String, cuerpo: JSONObject?, espera: Int): JSONObject {
        val con = try {
            URL(base + ruta).openConnection() as HttpURLConnection
        } catch (e: Exception) {
            throw ErrorOficina("La dirección de la oficina no es válida.")
        }
        try {
            con.requestMethod = metodo
            con.connectTimeout = 10_000
            con.readTimeout = espera
            con.setRequestProperty("Accept", "application/json")
            if (cuerpo != null) {
                con.doOutput = true
                con.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                con.setRequestProperty("Origin", base)
                con.outputStream.use { it.write(cuerpo.toString().toByteArray(Charsets.UTF_8)) }
            }
            val status = con.responseCode
            val flujo = if (status >= 400) con.errorStream else con.inputStream
            val texto = flujo?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: ""
            val json = try { JSONObject(texto) } catch (e: Exception) { JSONObject() }
            if (status >= 400) {
                throw ErrorOficina(json.optString("error").ifBlank { "La oficina respondió con un error ($status)." }, status)
            }
            return json
        } catch (e: ErrorOficina) {
            throw e
        } catch (e: java.net.SocketTimeoutException) {
            throw ErrorOficina("La oficina tardó demasiado en contestar.")
        } catch (e: IOException) {
            throw ErrorOficina("No llego a la oficina. ¿Está prendida la compu con Oficina abierta y Tailscale prendido en el celular?")
        } finally {
            con.disconnect()
        }
    }

    companion object {
        /** De lo que dice el QR de Ajustes › Celular (`https://compu.red.ts.net/?movil=1#/bandeja`) o de lo que se
         *  escribe a mano, se queda con `https://host[:puerto]`. */
        fun normalizar(texto: String): String? {
            var t = texto.trim()
            if (t.isEmpty()) return null
            if (!t.contains("://")) t = "https://$t"
            return try {
                val u = URL(t)
                if (u.protocol != "https" && u.protocol != "http") return null
                if (u.host.isNullOrBlank()) return null
                u.protocol + "://" + u.host + (if (u.port > 0) ":" + u.port else "")
            } catch (e: Exception) {
                null
            }
        }
    }
}
