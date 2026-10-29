plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
}

android {
    namespace = "com.dshmobile.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.dshmobile.app"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"

        // Only the languages this wrapper actually ships strings for.
        resourceConfigurations += listOf("en", "ru")
    }

    buildTypes {
        debug {
            isMinifyEnabled = false
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
        release {
            isMinifyEnabled = false
            isShrinkResources = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
            // Deliberately unsigned: CI publishes app-release-unsigned.apk.
            // There is no Play Store signing configuration in this repository.
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    lint {
        // These sources were produced on a machine without the Android SDK, so Android
        // Lint was never executed. Lint must not be able to block the first CI build;
        // run `gradle :app:lintDebug` locally (or in a separate job) to inspect it.
        checkReleaseBuilds = false
        abortOnError = false
    }

    buildFeatures {
        buildConfig = false
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.ktx)
    implementation(libs.androidx.webkit)
}
