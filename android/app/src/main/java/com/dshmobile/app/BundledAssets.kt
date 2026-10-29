package com.dshmobile.app

import android.content.Context
import java.io.IOException

/**
 * Access to the optional PWA snapshot bundled in `app/src/main/assets/www`.
 *
 * Those assets are produced by `android/scripts/sync-web.ps1` (or by CI) from
 * `packages/dsh-mobile/web`; a fresh checkout only contains `assets/www/README.txt`.
 * The loader probes for `www/index.html`, so the placeholder is never mistaken for a PWA.
 */
object BundledAssets {

    /** WebView URL of the bundled entry point. */
    const val ASSET_URL: String = "file:///android_asset/www/index.html"

    /** Prefix that identifies URLs served from inside the APK. */
    const val ASSET_PREFIX: String = "file:///android_asset/"

    private const val ENTRY_PATH = "www/index.html"

    fun isAvailable(context: Context): Boolean =
        try {
            context.assets.open(ENTRY_PATH).use { true }
        } catch (e: IOException) {
            false
        }
}
