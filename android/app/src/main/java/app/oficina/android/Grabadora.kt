package app.oficina.android

import android.annotation.SuppressLint
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.concurrent.thread

/**
 * Graba PCM de 16 bits, 16 kHz mono, y lo entrega como WAV: lo mismo que manda la grabadora de la interfaz web
 * (oficina/ui/grabadora.js) a `POST /api/audio/transcribir`. Tope de 5 minutos, como el backend.
 */
class Grabadora(private val alTope: () -> Unit) {
    private val tasa = 16_000
    private var rec: AudioRecord? = null
    private var hilo: Thread? = null
    private val datos = ByteArrayOutputStream()
    @Volatile private var grabando = false

    val segundos: Int get() = synchronized(datos) { datos.size() / (tasa * 2) }

    @SuppressLint("MissingPermission")   // se pide antes de llamar
    fun empezar() {
        val min = AudioRecord.getMinBufferSize(tasa, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
        val r = AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, tasa, AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT, maxOf(min, tasa))
        if (r.state != AudioRecord.STATE_INITIALIZED) {
            r.release()
            throw IllegalStateException("No pude usar el micrófono.")
        }
        rec = r
        synchronized(datos) { datos.reset() }
        grabando = true
        r.startRecording()
        hilo = thread(name = "grabadora") {
            val buf = ByteArray(3200)
            while (grabando) {
                val n = r.read(buf, 0, buf.size)
                if (n > 0) synchronized(datos) { datos.write(buf, 0, n) }
                if (segundos >= 300) { grabando = false; alTope() }
            }
        }
    }

    private fun parar() {
        grabando = false
        hilo?.join(1000)
        hilo = null
        rec?.let { try { it.stop() } catch (_: Exception) {}; it.release() }
        rec = null
    }

    fun cancelar() { parar(); synchronized(datos) { datos.reset() } }

    /** Termina y devuelve el WAV, o null si quedó demasiado corto (el backend pide al menos 0,3 s). */
    fun terminar(): ByteArray? {
        parar()
        val pcm = synchronized(datos) { datos.toByteArray().also { datos.reset() } }
        if (pcm.size < tasa * 2 * 3 / 10) return null
        return wav(pcm)
    }

    private fun wav(pcm: ByteArray): ByteArray {
        val c = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN)
        c.put("RIFF".toByteArray()).putInt(36 + pcm.size).put("WAVE".toByteArray())
        c.put("fmt ".toByteArray()).putInt(16).putShort(1).putShort(1).putInt(tasa).putInt(tasa * 2).putShort(2).putShort(16)
        c.put("data".toByteArray()).putInt(pcm.size)
        return c.array() + pcm
    }
}
