package com.dshmobile.app

import android.content.Context
import android.content.SharedPreferences

/**
 * Non-secret wrapper settings.
 *
 * Only the LAN base URL, the last seen host name and the offline-mode flag are stored
 * here. The device token issued by `POST /api/v1/pair` belongs to the web app
 * (localStorage / IndexedDB on the gateway origin) and is never copied into native
 * preferences. Because no secret is stored, plain SharedPreferences is a deliberate
 * choice: androidx.security-crypto would add a Tink dependency for no real gain here.
 * WebView storage itself is excluded from cloud backup via android:allowBackup="false".
 */
class ServerStore(context: Context) {

    private val prefs: SharedPreferences =
        context.applicationContext.getSharedPreferences(FILE_NAME, Context.MODE_PRIVATE)

    var serverBase: String?
        get() = prefs.getString(KEY_SERVER_BASE, null)
        set(value) {
            val editor = prefs.edit()
            if (value.isNullOrBlank()) {
                editor.remove(KEY_SERVER_BASE)
            } else {
                editor.putString(KEY_SERVER_BASE, value)
            }
            editor.apply()
        }

    var hostName: String?
        get() = prefs.getString(KEY_HOST_NAME, null)
        set(value) {
            prefs.edit().putString(KEY_HOST_NAME, value).apply()
        }

    var offlineMode: Boolean
        get() = prefs.getBoolean(KEY_OFFLINE_MODE, false)
        set(value) {
            prefs.edit().putBoolean(KEY_OFFLINE_MODE, value).apply()
        }

    fun hasServer(): Boolean = !serverBase.isNullOrBlank()

    companion object {
        private const val FILE_NAME = "dsh_mobile_prefs"
        private const val KEY_SERVER_BASE = "server_base"
        private const val KEY_HOST_NAME = "host_name"
        private const val KEY_OFFLINE_MODE = "offline_mode"
    }
}
