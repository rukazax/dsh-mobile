// Root build script: plugin versions are declared in gradle/libs.versions.toml
// and applied per-module. Nothing else belongs here for a single-module app.
plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.kotlin.android) apply false
}
