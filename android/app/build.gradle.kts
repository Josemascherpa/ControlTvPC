plugins {
    id("com.android.application")
}

// El Cine es la app que ya existe en ui/ (la misma que abre la notebook). Se compila con
// `npm run build:typescript` en la raíz del repo y se empaqueta tal cual dentro del APK.
val uiDir = rootProject.file("../ui")

android {
    namespace = "ar.com.josemascherpa.cinetv"

    compileSdk {
        version = release(36) {
            minorApiLevel = 1
        }
    }

    defaultConfig {
        applicationId = "ar.com.josemascherpa.cinetv"
        minSdk = 24
        targetSdk = 36
        versionCode = 3
        versionName = "1.2"
    }

    signingConfigs {
        // Llave fija del APK (queda en el repo para que las actualizaciones se instalen encima).
        create("release") {
            storeFile = rootProject.file("keystore/cinetv.jks")
            storePassword = "cinetv"
            keyAlias = "cinetv"
            keyPassword = "cinetv"
        }
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
        release {
            signingConfig = signingConfigs.getByName("release")
            optimization {
                enable = false
            }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    sourceSets {
        // Los archivos del Cine viajan dentro del APK (index.html, css, js, fuentes y hls.js).
        getByName("main").assets.srcDir(uiDir)
    }
}

// Falla temprano, con un mensaje claro, si el Cine todavía no está compilado.
val cineMain = File(uiDir, "js/web/cine/main.js")
val cineBridge = File(uiDir, "js/web/tv/bridge.js")
tasks.register("checkCineAssets") {
    val missing = listOf(cineMain, cineBridge).filterNot { it.exists() }.map { it.absolutePath }
    val where = missing.joinToString("\n")
    doLast {
        if (missing.isNotEmpty()) {
            throw GradleException(
                "Falta compilar el Cine. No existen:\n$where\n" +
                    "Corré 'npm run build:typescript' en la raíz del repo (o android/compilar-apk.ps1)."
            )
        }
    }
}
tasks.named("preBuild") {
    dependsOn("checkCineAssets")
}
