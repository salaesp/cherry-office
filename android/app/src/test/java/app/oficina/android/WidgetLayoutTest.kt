package app.oficina.android

import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Un widget solo puede usar las vistas que RemoteViews acepta (las que llevan @RemoteView). Con otra (por ejemplo
 * Space), el launcher muestra «No se puede cargar el widget» y el build no avisa nada.
 */
class WidgetLayoutTest {
    private val permitidas = setOf(
        "FrameLayout", "LinearLayout", "RelativeLayout", "GridLayout",
        "AnalogClock", "Button", "Chronometer", "ImageButton", "ImageView", "ProgressBar", "TextView", "TextClock",
        "ViewFlipper", "ListView", "GridView", "StackView", "AdapterViewFlipper", "ViewStub",
    )

    @Test
    fun elWidgetUsaSoloVistasPermitidas() {
        val xml = File("src/main/res/layout/widget_secretaria.xml").readText()
        val vistas = Regex("<([A-Za-z.]+)[\\s>/]").findAll(xml).map { it.groupValues[1] }.filter { it != "?xml" }.toSet()
        val malas = vistas - permitidas
        assertTrue("Vistas que un widget no acepta: $malas", malas.isEmpty())
    }
}
