package com.dshmobile.app

import android.annotation.SuppressLint
import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.net.Uri
import android.net.http.SslError
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.PermissionRequest
import android.webkit.RenderProcessGoneDetail
import android.webkit.SslErrorHandler
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.PopupMenu
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.updateLayoutParams
import androidx.core.view.updatePadding

/**
 * The whole Android client: a single, full-window WebView that loads either
 *
 *  1. the remote PWA served by the DSH gateway (`http://<pc>:3081/`), or
 *  2. the optional PWA snapshot bundled from `assets/www` (offline fallback).
 *
 * Loading strategy is remote-first on purpose: the page then shares the API origin,
 * so Bearer-token requests, cookies, localStorage and SSE all work without CORS or
 * a second origin. The bundled copy is an explicit fallback (menu / error panel) and
 * cannot perform authenticated API calls because `file://` is a different origin.
 *
 * Foldables: the activity declares `configChanges` and `resizeableActivity`, so
 * folding/unfolding does not recreate the WebView. The WebView fills the window
 * (including the hinge area) and the PWA does segment layout in CSS.
 */
class MainActivity : ComponentActivity() {

    private lateinit var store: ServerStore
    private lateinit var rootView: View
    private lateinit var webView: WebView
    private lateinit var progressBar: ProgressBar
    private lateinit var topChrome: LinearLayout
    private lateinit var warningBanner: LinearLayout
    private lateinit var offlineChip: TextView
    private lateinit var menuButton: TextView
    private lateinit var errorPanel: LinearLayout
    private lateinit var errorDetail: TextView
    private lateinit var errorOfflineButton: Button

    private var warningDismissed: Boolean = false
    private var fileChooserCallback: ValueCallback<Array<Uri>>? = null

    private val fileChooserLauncher: ActivityResultLauncher<Intent> =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            val callback = fileChooserCallback
            fileChooserCallback = null
            if (callback == null) return@registerForActivityResult
            if (result.resultCode != RESULT_OK) {
                callback.onReceiveValue(null)
                return@registerForActivityResult
            }
            val data = result.data
            var uris: Array<Uri>? = null
            if (data != null) {
                val clip = data.clipData
                if (clip != null && clip.itemCount > 0) {
                    uris = Array(clip.itemCount) { index -> clip.getItemAt(index).uri }
                } else {
                    val single = data.data
                    if (single != null) uris = arrayOf(single)
                }
            }
            callback.onReceiveValue(uris)
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        store = ServerStore(this)
        warningDismissed = savedInstanceState?.getBoolean(STATE_WARNING_DISMISSED) ?: false

        val deepLink = DshLinks.parsePairLink(intent?.data)

        // First run: always pair (or explicitly open the offline copy) before showing the PWA.
        if (!store.hasServer() && !store.offlineMode) {
            openPairing(deepLink?.serverUrl, deepLink?.code)
            return
        }

        enableEdgeToEdge()
        WindowCompat.getInsetsController(window, window.decorView).apply {
            isAppearanceLightStatusBars = false
            isAppearanceLightNavigationBars = false
        }

        setContentView(R.layout.activity_main)
        bindViews()
        configureWebView()
        applyWindowInsets()
        setupMenu()
        setupBackNavigation()

        val restoredState = savedInstanceState?.getBundle(STATE_WEBVIEW)
        val restored = if (restoredState != null) webView.restoreState(restoredState) else null
        if (restored == null) {
            loadInitialContent(intent?.getStringExtra(EXTRA_PAIR_CODE))
        } else {
            progressBar.visibility = View.GONE
            updateChromeForCurrentUrl(webView.url)
        }

        // A dshm:// link that launched the already-configured app opens pairing on top.
        if (deepLink != null) {
            openPairing(deepLink.serverUrl, deepLink.code)
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        val deepLink = DshLinks.parsePairLink(intent.data)
        if (deepLink != null) {
            openPairing(deepLink.serverUrl, deepLink.code)
            return
        }
        loadInitialContent(intent.getStringExtra(EXTRA_PAIR_CODE))
    }

    private fun bindViews() {
        rootView = findViewById(R.id.root)
        webView = findViewById(R.id.web_view)
        progressBar = findViewById(R.id.progress)
        topChrome = findViewById(R.id.top_chrome)
        warningBanner = findViewById(R.id.warning_banner)
        offlineChip = findViewById(R.id.offline_chip)
        menuButton = findViewById(R.id.menu_button)
        errorPanel = findViewById(R.id.error_panel)
        errorDetail = findViewById(R.id.error_detail)
        errorOfflineButton = findViewById(R.id.error_offline)

        findViewById<View>(R.id.warning_dismiss).setOnClickListener {
            warningDismissed = true
            updateChromeForCurrentUrl(webView.url)
        }
        findViewById<View>(R.id.error_retry).setOnClickListener {
            loadInitialContent(null)
        }
        findViewById<View>(R.id.error_change_pc).setOnClickListener {
            openPairing(null, null)
        }
        errorOfflineButton.setOnClickListener {
            loadBundled()
        }
    }

    // ---------------------------------------------------------------- WebView setup

    @SuppressLint("SetJavaScriptEnabled")
    private fun configureWebView() {
        webView.setBackgroundColor(getColor(R.color.dsh_background))
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            useWideViewPort = true
            loadWithOverviewMode = false
            mediaPlaybackRequiresUserGesture = true
            // The remote page is http:// itself, so mixed content only matters for the
            // bundled file:// copy. Compatibility mode keeps that copy working without
            // globally allowing insecure subresources.
            mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
            allowFileAccess = true // needed to serve assets/www in bundled mode
            allowContentAccess = true
            allowFileAccessFromFileURLs = false
            allowUniversalAccessFromFileURLs = false
            builtInZoomControls = false
            displayZoomControls = false
            userAgentString = userAgentString + " DSHMobile/" + appVersionName()
        }

        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(webView, false)
        }

        webView.setWebViewClient(DshWebViewClient())
        webView.setWebChromeClient(DshWebChromeClient())
        WebView.setWebContentsDebuggingEnabled(isDebuggable())
    }

    private inner class DshWebViewClient : WebViewClient() {

        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
            handleUri(request.url)

        override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
            progressBar.visibility = View.VISIBLE
            updateChromeForCurrentUrl(url)
        }

        override fun onPageFinished(view: WebView, url: String?) {
            progressBar.visibility = View.GONE
            updateChromeForCurrentUrl(url)
        }

        override fun onReceivedError(
            view: WebView,
            request: WebResourceRequest,
            error: WebResourceError,
        ) {
            if (!request.isForMainFrame) return
            showConnectionError(error.errorCode, error.description?.toString())
        }

        override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) {
            // Never bypass TLS errors: a LAN gateway must present a chain this device trusts.
            handler.cancel()
            showConnectionError(null, getString(R.string.error_ssl))
        }

        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
            // Chromium renderers get killed by aggressive OEM memory managers; rebuild
            // the WebView instead of letting the whole app crash.
            runOnUiThread { rebuildWebViewAfterCrash() }
            return true
        }
    }

    private inner class DshWebChromeClient : WebChromeClient() {

        override fun onProgressChanged(view: WebView, newProgress: Int) {
            if (newProgress >= 100) {
                progressBar.visibility = View.GONE
            } else {
                progressBar.visibility = View.VISIBLE
                progressBar.progress = newProgress
            }
        }

        override fun onShowFileChooser(
            webView: WebView,
            filePathCallback: ValueCallback<Array<Uri>>,
            fileChooserParams: WebChromeClient.FileChooserParams,
        ): Boolean {
            fileChooserCallback?.onReceiveValue(null)
            fileChooserCallback = filePathCallback
            val chooserIntent = try {
                fileChooserParams.createIntent()
            } catch (e: Exception) {
                null
            }
            if (chooserIntent == null) {
                fileChooserCallback = null
                filePathCallback.onReceiveValue(null)
                return false
            }
            return try {
                fileChooserLauncher.launch(chooserIntent)
                true
            } catch (e: ActivityNotFoundException) {
                fileChooserCallback = null
                filePathCallback.onReceiveValue(null)
                false
            }
        }

        override fun onPermissionRequest(request: PermissionRequest) {
            // v1 declares no camera/microphone permission (no QR scanner yet).
            request.deny()
        }
    }

    // ------------------------------------------------------------------ navigation

    private fun handleUri(uri: Uri): Boolean {
        val scheme = uri.scheme?.lowercase() ?: return false
        return when (scheme) {
            DshLinks.SCHEME -> {
                val link = DshLinks.parsePairLink(uri)
                if (link == null) {
                    Toast.makeText(this, R.string.deep_link_unknown, Toast.LENGTH_SHORT).show()
                } else {
                    openPairing(link.serverUrl, link.code)
                }
                true
            }
            "http", "https" -> {
                val base = store.serverBase
                if (base != null && DshLinks.sameServer(uri.toString(), base)) {
                    false // stay inside the gateway origin
                } else {
                    openExternally(uri)
                    true
                }
            }
            "file" -> !uri.toString().startsWith(BundledAssets.ASSET_PREFIX)
            "about", "javascript", "data", "blob" -> false
            else -> {
                openExternally(uri)
                true
            }
        }
    }

    private fun openExternally(uri: Uri) {
        try {
            // Plain ACTION_VIEW: androidx.browser (Custom Tabs) is intentionally not a
            // dependency; the system browser is good enough for external links.
            startActivity(Intent(Intent.ACTION_VIEW, uri))
        } catch (e: ActivityNotFoundException) {
            Toast.makeText(
                this,
                getString(R.string.error_no_app_for_link, uri.toString()),
                Toast.LENGTH_SHORT,
            ).show()
        }
    }

    private fun setupBackNavigation() {
        onBackPressedDispatcher.addCallback(
            this,
            object : OnBackPressedCallback(true) {
                override fun handleOnBackPressed() {
                    if (webView.canGoBack()) {
                        webView.goBack()
                        return
                    }
                    val current = webView.url
                    if (current != null &&
                        current.startsWith(BundledAssets.ASSET_PREFIX) &&
                        store.hasServer()
                    ) {
                        // Leave the offline copy and try the PC once before exiting.
                        store.offlineMode = false
                        loadInitialContent(null)
                        return
                    }
                    finish()
                }
            },
        )
    }

    // -------------------------------------------------------------------- loading

    private fun loadInitialContent(pairCode: String?) {
        val base = store.serverBase
        if (store.offlineMode || base == null) {
            if (BundledAssets.isAvailable(this)) {
                loadBundled()
                return
            }
            if (base != null) {
                loadUrl(buildRemoteUrl(base, pairCode))
                return
            }
            openPairing(null, null)
            return
        }
        loadUrl(buildRemoteUrl(base, pairCode))
    }

    private fun buildRemoteUrl(base: String, pairCode: String?): String {
        val root = if (base.endsWith("/")) base else "$base/"
        // Hand the gateway address (and the code, when the user typed one) to the PWA's
        // own pairing dialog: js/pair.js reads ?url= and ?code= via readDeepLink() and
        // prefills the form, so the user only confirms the connection. The native screen
        // has already validated the address with GET /api/v1/hello and has NOT consumed
        // the one-time pairing code. Unknown parameters are ignored by the PWA.
        val query = StringBuilder()
        query.append("url=").append(Uri.encode(base))
        if (!pairCode.isNullOrBlank()) {
            query.append("&code=").append(Uri.encode(pairCode))
        }
        return root + "?" + query
    }

    private fun loadUrl(url: String) {
        hideError()
        progressBar.visibility = View.VISIBLE
        updateChromeForCurrentUrl(url)
        webView.loadUrl(url)
    }

    private fun loadBundled() {
        if (!BundledAssets.isAvailable(this)) {
            Toast.makeText(this, R.string.offline_not_available, Toast.LENGTH_LONG).show()
            return
        }
        hideError()
        progressBar.visibility = View.VISIBLE
        updateChromeForCurrentUrl(BundledAssets.ASSET_URL)
        webView.loadUrl(BundledAssets.ASSET_URL)
    }

    private fun hideError() {
        errorPanel.visibility = View.GONE
    }

    private fun updateChromeForCurrentUrl(url: String?) {
        val isBundled = url != null && url.startsWith(BundledAssets.ASSET_PREFIX)
        offlineChip.visibility = if (isBundled) View.VISIBLE else View.GONE
        val isCleartext = url != null && url.startsWith("http://")
        warningBanner.visibility = if (isCleartext && !warningDismissed) View.VISIBLE else View.GONE
    }

    private fun showConnectionError(code: Int?, detail: String?) {
        progressBar.visibility = View.GONE
        errorPanel.visibility = View.VISIBLE
        errorOfflineButton.visibility =
            if (BundledAssets.isAvailable(this)) View.VISIBLE else View.GONE
        errorDetail.text = buildString {
            if (code != null) {
                append(getString(R.string.error_code, code))
                append('\n')
            }
            append(detail ?: getString(R.string.error_panel_detail_default))
        }
    }

    private fun rebuildWebViewAfterCrash() {
        if (isFinishing || isDestroyed) return
        try {
            (webView.parent as? ViewGroup)?.removeView(webView)
            webView.stopLoading()
            webView.destroy()
        } catch (e: Exception) {
            // The old renderer is already gone; teardown errors are not actionable.
        }
        recreate()
    }

    // ---------------------------------------------------------------------- chrome

    private fun setupMenu() {
        menuButton.setOnClickListener {
            PopupMenu(this, menuButton).apply {
                menu.add(0, MENU_ID_CHANGE_PC, 0, R.string.menu_change_pc)
                menu.add(0, MENU_ID_RELOAD, 1, R.string.menu_reload)
                val bundled = webView.url?.startsWith(BundledAssets.ASSET_PREFIX) == true
                menu.add(
                    0,
                    MENU_ID_OFFLINE_TOGGLE,
                    2,
                    if (bundled) R.string.menu_back_to_pc else R.string.menu_open_offline,
                )
                menu.add(0, MENU_ID_ABOUT, 3, R.string.menu_about)
                setOnMenuItemClickListener { item ->
                    when (item.itemId) {
                        MENU_ID_CHANGE_PC -> {
                            openPairing(null, null)
                            true
                        }
                        MENU_ID_RELOAD -> {
                            reloadCurrent()
                            true
                        }
                        MENU_ID_OFFLINE_TOGGLE -> {
                            toggleBundled()
                            true
                        }
                        MENU_ID_ABOUT -> {
                            showAboutDialog()
                            true
                        }
                        else -> false
                    }
                }
                show()
            }
        }
    }

    private fun reloadCurrent() {
        if (webView.url.isNullOrBlank()) {
            loadInitialContent(null)
            return
        }
        hideError()
        webView.reload()
    }

    private fun toggleBundled() {
        val bundled = webView.url?.startsWith(BundledAssets.ASSET_PREFIX) == true
        if (bundled) {
            store.offlineMode = false
            val base = store.serverBase
            if (base == null) {
                openPairing(null, null)
                return
            }
            loadUrl(buildRemoteUrl(base, null))
            return
        }
        if (!BundledAssets.isAvailable(this)) {
            Toast.makeText(this, R.string.offline_not_available, Toast.LENGTH_LONG).show()
            return
        }
        store.offlineMode = true
        loadBundled()
    }

    private fun showAboutDialog() {
        AlertDialog.Builder(this)
            .setTitle(R.string.menu_about)
            .setMessage(getString(R.string.about_message, appVersionName()))
            .setPositiveButton(android.R.string.ok, null)
            .show()
    }

    private fun applyWindowInsets() {
        ViewCompat.setOnApplyWindowInsetsListener(rootView) { _, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            // The WebView keeps drawing edge-to-edge; only wrapper chrome is inset.
            topChrome.updatePadding(top = bars.top)
            progressBar.updateLayoutParams<FrameLayout.LayoutParams> { topMargin = bars.top }
            menuButton.updateLayoutParams<FrameLayout.LayoutParams> {
                topMargin = bars.top + dp(4)
            }
            errorPanel.updatePadding(bottom = bars.bottom + dp(24))
            insets
        }
    }

    // ------------------------------------------------------------------- lifecycle

    override fun onPause() {
        super.onPause()
        if (::webView.isInitialized) webView.onPause()
    }

    override fun onResume() {
        super.onResume()
        if (::webView.isInitialized) webView.onResume()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        outState.putBoolean(STATE_WARNING_DISMISSED, warningDismissed)
        if (::webView.isInitialized) {
            val webViewState = Bundle()
            webView.saveState(webViewState)
            outState.putBundle(STATE_WEBVIEW, webViewState)
        }
    }

    override fun onDestroy() {
        fileChooserCallback?.onReceiveValue(null)
        fileChooserCallback = null
        if (::webView.isInitialized) {
            (webView.parent as? ViewGroup)?.removeView(webView)
            webView.stopLoading()
            webView.destroy()
        }
        super.onDestroy()
    }

    // --------------------------------------------------------------------- helpers

    private fun openPairing(prefillUrl: String?, prefillCode: String?) {
        startActivity(PairingActivity.createIntent(this, prefillUrl, prefillCode))
        if (!store.hasServer() && !store.offlineMode) finish()
    }

    private fun isDebuggable(): Boolean =
        (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0

    @Suppress("DEPRECATION")
    private fun appVersionName(): String =
        try {
            packageManager.getPackageInfo(packageName, 0).versionName ?: "unknown"
        } catch (e: PackageManager.NameNotFoundException) {
            "unknown"
        }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    companion object {
        const val EXTRA_PAIR_CODE: String = "pair_code"

        private const val STATE_WEBVIEW = "webview_state"
        private const val STATE_WARNING_DISMISSED = "warning_dismissed"
        private const val MENU_ID_CHANGE_PC = 1
        private const val MENU_ID_RELOAD = 2
        private const val MENU_ID_OFFLINE_TOGGLE = 3
        private const val MENU_ID_ABOUT = 4
    }
}
