package com.dshmobile.app

import org.json.JSONException
import org.json.JSONObject
import java.io.IOException
import java.net.ConnectException
import java.net.HttpURLConnection
import java.net.SocketException
import java.net.SocketTimeoutException
import java.net.URL
import java.net.UnknownHostException

/** Parsed `GET /api/v1/hello` response (mobile API protocol 1). */
data class HelloResult(
    val protocol: Int,
    val hostName: String,
    val appVersion: String,
)

/** Result of probing a candidate gateway address. */
sealed class ProbeResult {
    data class Ok(val hello: HelloResult) : ProbeResult()
    data class HttpError(val status: Int) : ProbeResult()
    data class Failure(val kind: Kind, val message: String) : ProbeResult()

    enum class Kind {
        NETWORK,
        INVALID_RESPONSE,
        UNSUPPORTED,
    }
}

/**
 * Blocking HTTP client for the unauthenticated handshake only.
 *
 * The web app owns all authenticated traffic (it has the device token); this probe
 * exists so the pairing screen can distinguish "wrong address" from "wrong plugin or
 * protocol version" before the PWA is loaded. HttpURLConnection is used on purpose:
 * no OkHttp/Retrofit dependency is needed for a single GET.
 */
object DshApi {

    private const val CONNECT_TIMEOUT_MS = 6000
    private const val READ_TIMEOUT_MS = 6000
    private const val SUPPORTED_PROTOCOL = 1

    fun probeHello(baseUrl: String): ProbeResult {
        val endpoint = baseUrl.trimEnd('/') + "/api/v1/hello"
        var connection: HttpURLConnection? = null
        try {
            val conn = (URL(endpoint).openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"
                connectTimeout = CONNECT_TIMEOUT_MS
                readTimeout = READ_TIMEOUT_MS
                useCaches = false
                instanceFollowRedirects = false
                setRequestProperty("Accept", "application/json")
            }
            connection = conn

            val status = conn.responseCode
            if (status != HttpURLConnection.HTTP_OK) {
                return ProbeResult.HttpError(status)
            }

            val body = conn.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
            val json = JSONObject(body)
            val protocol = json.optInt("protocol", -1)
            if (protocol != SUPPORTED_PROTOCOL) {
                return ProbeResult.Failure(ProbeResult.Kind.UNSUPPORTED, "protocol=$protocol")
            }

            return ProbeResult.Ok(
                HelloResult(
                    protocol = protocol,
                    hostName = json.optString("hostName", ""),
                    appVersion = json.optString("appVersion", ""),
                ),
            )
        } catch (e: SocketTimeoutException) {
            return ProbeResult.Failure(ProbeResult.Kind.NETWORK, "timeout")
        } catch (e: UnknownHostException) {
            return ProbeResult.Failure(ProbeResult.Kind.NETWORK, "unknown-host")
        } catch (e: ConnectException) {
            return ProbeResult.Failure(ProbeResult.Kind.NETWORK, "connect-refused")
        } catch (e: SocketException) {
            return ProbeResult.Failure(ProbeResult.Kind.NETWORK, "socket")
        } catch (e: IOException) {
            return ProbeResult.Failure(ProbeResult.Kind.NETWORK, e.message ?: "io")
        } catch (e: JSONException) {
            return ProbeResult.Failure(ProbeResult.Kind.INVALID_RESPONSE, "json")
        } finally {
            connection?.disconnect()
        }
    }
}
