plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "app.oficina.android"
    compileSdk = 35

    defaultConfig {
        applicationId = "app.oficina.android"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
    }

    // Clave de depuración fija (la de siempre de Android, contraseña «android»; no protege nada): así el APK que arma
    // GitHub Actions y el que arma cada compu se pueden instalar uno encima del otro sin desinstalar.
    signingConfigs {
        getByName("debug") {
            storeFile = file("debug.keystore")
            storePassword = "android"
            keyAlias = "androiddebugkey"
            keyPassword = "android"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        compose = true
    }
    sourceSets["main"].assets.srcDir(layout.buildDirectory.dir("generated/pixel"))
}

// El busto del widget se dibuja con el mismo código que la oficina pixel: se copia de oficina/ui/pixel/ en cada build.
val copiarPixel = tasks.register<Copy>("copiarPixel") {
    from(rootProject.file("../oficina/ui/pixel")) {
        include("personajes.js", "avatar.js")
    }
    into(layout.buildDirectory.dir("generated/pixel/pixel"))
}
tasks.named("preBuild") { dependsOn(copiarPixel) }

dependencies {
    val bom = platform("androidx.compose:compose-bom:2025.05.01")
    implementation(bom)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.activity:activity-compose:1.10.1")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.9.0")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.9.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    // Lector de QR de Google Play: no pide permiso de cámara y no suma la cámara a la app
    implementation("com.google.android.gms:play-services-code-scanner:16.1.0")
    testImplementation("junit:junit:4.13.2")
}
