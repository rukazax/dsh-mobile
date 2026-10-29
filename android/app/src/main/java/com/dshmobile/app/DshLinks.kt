package com.dshmobile.app

import android.net.Uri
import java.net.URI
import java.net.URISyntaxException

/**
 * Validation helpers for the LAN gateway address and for `dshm://pair` links.
 *
 * Nothing here touches the network; it only turns user input / QR payloads into a
 * canonical origin that [DshApi] and the WebView can use.
 */
object DshLinks {

    const val SCHEME: String = "dshm"

    private const val HOST_PAIR: String = "pair"
    private const val DEFAULT_GATEWAY_PORT: Int = 3081
    private const val HTTP_PORT: Int = 80
    private const val HTTPS_PORT: Int = 443

    sealed class UrlResult {
        data class Ok(val baseUrl: String) : UrlResult()
        data class Invalid(val reason: Reason) : UrlResult()

        enum class Reason {
            EMPTY,
            BAD_SCHEME,
            BAD_HOST,
            BAD_PORT,
        }
    }

    /** Payload of `dshm://pair?url=...&code=...` (both fields are optional). */
    data class PairLink(val serverUrl: String?, val code: String?)

    /**
     * Accepts `192.168.1.10`, `192.168.1.10:3081`, `http://192.168.1.10:3081/`
     * or `https://dsh.example:8443`, and returns a canonical origin without path,
     * query or fragment. A missing port means the gateway default 3081 for http and
     * 443 for https.
     */
    fun normalizeServerUrl(raw: String): UrlResult {
        val input = raw.trim()
        if (input.isEmpty()) return UrlResult.Invalid(UrlResult.Reason.EMPTY)

        val withScheme = if (input.contains("://")) input else "http://$input"
        val uri = try {
            URI(withScheme)
        } catch (e: URISyntaxException) {
            return UrlResult.Invalid(UrlResult.Reason.BAD_HOST)
        }

        val scheme = uri.scheme?.lowercase() ?: return UrlResult.Invalid(UrlResult.Reason.BAD_SCHEME)
        if (scheme != "http" && scheme != "https") {
            return UrlResult.Invalid(UrlResult.Reason.BAD_SCHEME)
        }

        val host = uri.host?.takeIf { it.isNotBlank() }
            ?: return UrlResult.Invalid(UrlResult.Reason.BAD_HOST)

        val port = uri.port
        if (port != -1 && (port < 1 || port > 65535)) {
            return UrlResult.Invalid(UrlResult.Reason.BAD_PORT)
        }

        val canonicalPort = when {
            port != -1 && port != defaultPortFor(scheme) -> ":$port"
            port == -1 && scheme == "http" -> ":$DEFAULT_GATEWAY_PORT"
            else -> ""
        }
        // IPv6 literals need brackets when they come back without them.
        val hostPart = if (host.contains(':') && !host.startsWith("[")) "[$host]" else host
        return UrlResult.Ok("$scheme://$hostPart$canonicalPort")
    }

    /** Returns null when [uri] is not a `dshm://pair` link. */
    fun parsePairLink(uri: Uri?): PairLink? {
        if (uri == null) return null
        if (uri.scheme?.lowercase() != SCHEME) return null
        if (uri.host?.lowercase() != HOST_PAIR) return null
        return try {
            val rawServer = uri.getQueryParameter("url")
                ?: uri.getQueryParameter("server")
                ?: uri.getQueryParameter("base")
            val rawCode = uri.getQueryParameter("code")
                ?: uri.getQueryParameter("pairingCode")
                ?: uri.getQueryParameter("c")
            val serverUrl = when (val normalized = normalizeServerUrl(rawServer.orEmpty())) {
                is UrlResult.Ok -> normalized.baseUrl
                is UrlResult.Invalid -> null
            }
            val code = rawCode?.trim()?.uppercase()?.takeIf { it.isNotEmpty() }
            PairLink(serverUrl = serverUrl, code = code)
        } catch (e: Exception) {
            // Malformed external links must never crash the wrapper.
            null
        }
    }

    /** True when [pageUrl] is same scheme + host + port as the configured gateway. */
    fun sameServer(pageUrl: String?, baseUrl: String?): Boolean {
        if (pageUrl.isNullOrBlank() || baseUrl.isNullOrBlank()) return false
        val page = try {
            URI(pageUrl)
        } catch (e: URISyntaxException) {
            return false
        }
        val base = try {
            URI(baseUrl)
        } catch (e: URISyntaxException) {
            return false
        }
        val pageScheme = page.scheme ?: return false
        val baseScheme = base.scheme ?: return false
        if (!pageScheme.equals(baseScheme, ignoreCase = true)) return false
        val pageHost = page.host ?: return false
        val baseHost = base.host ?: return false
        if (!pageHost.equals(baseHost, ignoreCase = true)) return false
        return effectivePort(page) == effectivePort(base)
    }

    private fun effectivePort(uri: URI): Int =
        if (uri.port != -1) {
            uri.port
        } else if ("https".equals(uri.scheme, ignoreCase = true)) {
            HTTPS_PORT
        } else {
            HTTP_PORT
        }

    private fun defaultPortFor(scheme: String): Int =
        if (scheme == "https") HTTPS_PORT else HTTP_PORT
}
