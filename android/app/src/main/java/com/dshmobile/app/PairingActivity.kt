package com.dshmobile.app

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.view.View
import android.view.inputmethod.EditorInfo
import android.widget.Button
import android.widget.EditText
import android.widget.ProgressBar
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import kotlin.concurrent.thread

/**
 * First-run pairing screen.
 *
 * Flow: PC address (+ optional 8-character code) -> `GET /api/v1/hello` probe ->
 * persist the canonical origin in SharedPreferences -> load the PWA from the gateway.
 * The probe is unauthenticated by contract and deliberately does NOT consume the
 * one-time pairing code (`POST /pair` stays with the web app, which owns the token).
 * The address and the optional code are forwarded to the PWA as `?url=&code=`; the
 * PWA's pairing dialog reads them from `location.search` and opens prefilled.
 */
class PairingActivity : ComponentActivity() {

    private lateinit var store: ServerStore
    private lateinit var rootView: View
    private lateinit var serverInput: EditText
    private lateinit var codeInput: EditText
    private lateinit var statusText: TextView
    private lateinit var progress: ProgressBar
    private lateinit var connectButton: Button
    private lateinit var offlineButton: Button

    @Volatile
    private var probeInFlight: Boolean = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        store = ServerStore(this)

        enableEdgeToEdge()
        WindowCompat.getInsetsController(window, window.decorView).apply {
            isAppearanceLightStatusBars = false
            isAppearanceLightNavigationBars = false
        }

        setContentView(R.layout.activity_pairing)
        bindViews()
        applyWindowInsets()
        prefillFromIntent(intent)

        connectButton.setOnClickListener { attemptConnect() }
        offlineButton.setOnClickListener { openBundledCopy() }
        codeInput.setOnEditorActionListener { _, actionId, _ ->
            if (actionId == EditorInfo.IME_ACTION_DONE) {
                attemptConnect()
                true
            } else {
                false
            }
        }
    }

    private fun bindViews() {
        rootView = findViewById(R.id.pairing_root)
        serverInput = findViewById(R.id.server_input)
        codeInput = findViewById(R.id.code_input)
        statusText = findViewById(R.id.status_text)
        progress = findViewById(R.id.pairing_progress)
        connectButton = findViewById(R.id.connect_button)
        offlineButton = findViewById(R.id.offline_button)
    }

    private fun applyWindowInsets() {
        ViewCompat.setOnApplyWindowInsetsListener(rootView) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            // adjustResize + edge-to-edge: handle the IME inset ourselves so the form
            // scrolls above the keyboard while the background still paints edge-to-edge.
            view.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, ime.bottom))
            insets
        }
    }

    private fun prefillFromIntent(intent: Intent?) {
        val prefillUrl = intent?.getStringExtra(EXTRA_PREFILL_URL)
        val prefillCode = intent?.getStringExtra(EXTRA_PREFILL_CODE)
        val address = prefillUrl ?: store.serverBase
        if (!address.isNullOrBlank()) serverInput.setText(address)
        if (!prefillCode.isNullOrBlank()) codeInput.setText(prefillCode)
        val focusTarget = if (address.isNullOrBlank()) serverInput else codeInput
        focusTarget.requestFocus()
    }

    private fun attemptConnect() {
        if (probeInFlight) return

        val rawAddress = serverInput.text?.toString().orEmpty()
        var normalizedBase: String? = null
        when (val normalized = DshLinks.normalizeServerUrl(rawAddress)) {
            is DshLinks.UrlResult.Ok -> normalizedBase = normalized.baseUrl
            is DshLinks.UrlResult.Invalid -> {
                showError(errorMessageFor(normalized.reason))
                return
            }
        }
        val baseUrl = normalizedBase ?: return

        val code = codeInput.text?.toString()?.trim()?.uppercase().orEmpty()
        if (code.isNotEmpty() && code.length != PAIRING_CODE_LENGTH) {
            showError(getString(R.string.pair_error_code_length))
            return
        }

        probeInFlight = true
        setBusy(true)
        statusText.visibility = View.GONE

        thread {
            val result = DshApi.probeHello(baseUrl)
            runOnUiThread {
                // The activity may have been recreated (e.g. folded while probing);
                // drop a stale result instead of touching destroyed views.
                if (isFinishing || isDestroyed) return@runOnUiThread
                probeInFlight = false
                setBusy(false)
                when (result) {
                    is ProbeResult.Ok -> {
                        store.serverBase = baseUrl
                        store.hostName = result.hello.hostName
                        store.offlineMode = false
                        startMainActivity(code.ifEmpty { null })
                    }
                    is ProbeResult.HttpError -> showError(
                        getString(R.string.pair_error_http, result.status),
                    )
                    is ProbeResult.Failure -> showError(describeFailure(result))
                }
            }
        }
    }

    private fun errorMessageFor(reason: DshLinks.UrlResult.Reason): String = when (reason) {
        DshLinks.UrlResult.Reason.EMPTY -> getString(R.string.pair_error_empty_server)
        DshLinks.UrlResult.Reason.BAD_SCHEME -> getString(R.string.pair_error_bad_scheme)
        DshLinks.UrlResult.Reason.BAD_HOST -> getString(R.string.pair_error_bad_host)
        DshLinks.UrlResult.Reason.BAD_PORT -> getString(R.string.pair_error_bad_port)
    }

    private fun describeFailure(failure: ProbeResult.Failure): String = when (failure.kind) {
        ProbeResult.Kind.NETWORK -> getString(R.string.pair_error_network)
        ProbeResult.Kind.INVALID_RESPONSE -> getString(R.string.pair_error_invalid_response)
        ProbeResult.Kind.UNSUPPORTED -> getString(R.string.pair_error_unsupported, failure.message)
    }

    private fun setBusy(busy: Boolean) {
        connectButton.isEnabled = !busy
        offlineButton.isEnabled = !busy
        progress.visibility = if (busy) View.VISIBLE else View.GONE
        if (busy) statusText.visibility = View.GONE
    }

    private fun showError(message: String) {
        statusText.text = message
        statusText.visibility = View.VISIBLE
    }

    private fun openBundledCopy() {
        if (!BundledAssets.isAvailable(this)) {
            showError(getString(R.string.offline_not_available))
            return
        }
        store.offlineMode = true
        startMainActivity(null)
    }

    private fun startMainActivity(pairCode: String?) {
        val intent = Intent(this, MainActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            if (pairCode != null) putExtra(MainActivity.EXTRA_PAIR_CODE, pairCode)
        }
        startActivity(intent)
        finish()
    }

    companion object {
        private const val EXTRA_PREFILL_URL = "prefill_url"
        private const val EXTRA_PREFILL_CODE = "prefill_code"
        private const val PAIRING_CODE_LENGTH = 8

        fun createIntent(context: Context, prefillUrl: String?, prefillCode: String?): Intent =
            Intent(context, PairingActivity::class.java).apply {
                if (!prefillUrl.isNullOrBlank()) putExtra(EXTRA_PREFILL_URL, prefillUrl)
                if (!prefillCode.isNullOrBlank()) putExtra(EXTRA_PREFILL_CODE, prefillCode)
            }
    }
}
