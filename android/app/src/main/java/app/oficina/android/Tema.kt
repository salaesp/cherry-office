package app.oficina.android

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

/** Los colores de la interfaz web (oficina/ui/estilo.css): sobria, neutra, con el negro como acento. */
private val Claro = lightColorScheme(
    primary = Color(0xFF1D1D1F), onPrimary = Color.White,
    background = Color(0xFFF2F0EC), onBackground = Color(0xFF1D1D1F),
    surface = Color(0xFFF2F0EC), onSurface = Color(0xFF1D1D1F),
    surfaceVariant = Color.White, onSurfaceVariant = Color(0xFF6D6962),
    surfaceContainer = Color.White, surfaceContainerHigh = Color.White, surfaceContainerLow = Color(0xFFF8F7F4),
    outline = Color(0xFFD3CFC7), outlineVariant = Color(0xFFE4E1DB),
    error = Color(0xFFB3362C),
)
private val Oscuro = darkColorScheme(
    primary = Color(0xFFF1F1F2), onPrimary = Color(0xFF1B1B1D),
    background = Color(0xFF19191B), onBackground = Color(0xFFF1F1F2),
    surface = Color(0xFF19191B), onSurface = Color(0xFFF1F1F2),
    surfaceVariant = Color(0xFF232326), onSurfaceVariant = Color(0xFFA3A3A8),
    surfaceContainer = Color(0xFF232326), surfaceContainerHigh = Color(0xFF2A2A2E), surfaceContainerLow = Color(0xFF1E1E21),
    outline = Color(0xFF45454A), outlineVariant = Color(0xFF333337),
    error = Color(0xFFE0675D),
)

@Composable
fun Tema(contenido: @Composable () -> Unit) {
    MaterialTheme(colorScheme = if (isSystemInDarkTheme()) Oscuro else Claro, content = contenido)
}
