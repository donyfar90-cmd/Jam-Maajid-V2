package id.jammasjid.digital

import android.Manifest
import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import android.webkit.GeolocationPermissions
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import fi.iki.elonen.NanoHTTPD
import org.json.JSONObject
import java.io.File

class MainActivity : Activity() {
    private lateinit var server: LocalServer
    private var fileUploadCallback: ValueCallback<Array<Uri>>? = null

    companion object {
        private const val REQ_PICK_IMAGE = 1001
        private const val REQ_LOCATION = 1002
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Layar tetap menyala dan mode fullscreen
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        @Suppress("DEPRECATION")
        window.decorView.systemUiVisibility = 5894 or 1024 or 512

        // Minta izin lokasi GPS (untuk koordinat jadwal salat otomatis)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
                requestPermissions(
                    arrayOf(
                        Manifest.permission.ACCESS_FINE_LOCATION,
                        Manifest.permission.ACCESS_COARSE_LOCATION
                    ),
                    REQ_LOCATION
                )
            }
        }

        // Jalankan server lokal NanoHTTPD
        server = LocalServer(this)
        server.start(NanoHTTPD.SOCKET_READ_TIMEOUT, false)

        // Konfigurasi WebView
        val webView = WebView(this)
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            allowFileAccess = true
            setGeolocationEnabled(true)
            mediaPlaybackRequiresUserGesture = false
        }

        webView.webViewClient = WebViewClient()

        // Tangani pemilihan foto dari galeri & izin GPS dari halaman web
        webView.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                webView: WebView?,
                filePathCallback: ValueCallback<Array<Uri>>?,
                fileChooserParams: FileChooserParams?
            ): Boolean {
                fileUploadCallback?.onReceiveValue(null)
                fileUploadCallback = filePathCallback

                val intent = Intent(Intent.ACTION_GET_CONTENT).apply {
                    addCategory(Intent.CATEGORY_OPENABLE)
                    type = "image/*"
                    putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
                }

                return try {
                    @Suppress("DEPRECATION")
                    startActivityForResult(
                        Intent.createChooser(intent, "Pilih Foto Latar"),
                        REQ_PICK_IMAGE
                    )
                    true
                } catch (e: Exception) {
                    fileUploadCallback = null
                    false
                }
            }

            override fun onGeolocationPermissionsShowPrompt(
                origin: String?,
                callback: GeolocationPermissions.Callback?
            ) {
                callback?.invoke(origin, true, false)
            }
        }

        setContentView(webView)
        webView.loadUrl("http://127.0.0.1:8081/")
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQ_PICK_IMAGE) {
            val results = mutableListOf<Uri>()
            if (resultCode == RESULT_OK && data != null) {
                val clipData = data.clipData
                if (clipData != null) {
                    for (i in 0 until clipData.itemCount) {
                        clipData.getItemAt(i).uri?.let { results.add(it) }
                    }
                } else {
                    data.data?.let { results.add(it) }
                }
            }
            fileUploadCallback?.onReceiveValue(results.toTypedArray())
            fileUploadCallback = null
        }
    }

    override fun onDestroy() {
        try {
            server.stop()
        } catch (_: Exception) {
        }
        super.onDestroy()
    }
}

class LocalServer(private val activity: Activity) : NanoHTTPD(8081) {
    private val configFile = File(activity.filesDir, "settings.json")
    private val defaults = JSONObject(
        """{"mosque":"Masjid Baitul Ghofar","location":"Surabaya","timezone":"Asia/Jakarta","text":"Selamat datang di masjid kami. Mohon luruskan dan rapatkan shaf.","times":{"Subuh":"04:20","Syuruq":"05:40","Dzuhur":"11:40","Ashar":"15:00","Maghrib":"17:35","Isya":"18:45"},"iqamah":{"Subuh":10,"Dzuhur":10,"Ashar":10,"Maghrib":5,"Isya":10},"offset":{"Subuh":0,"Dzuhur":0,"Ashar":0,"Maghrib":0,"Isya":0}}"""
    )

    private fun readConfig(): JSONObject = try {
        JSONObject(configFile.readText())
    } catch (_: Exception) {
        defaults
    }

    override fun serve(session: IHTTPSession): Response {
        if (session.method == Method.POST && session.uri == "/api/settings") {
            val body = HashMap<String, String>()
            session.parseBody(body)
            val data = JSONObject(body["postData"] ?: "{}")
            configFile.writeText(data.toString(2))
            return newFixedLengthResponse(Response.Status.OK, "application/json", "{\"ok\":true}")
        }
        if (session.uri == "/api/settings") {
            return newFixedLengthResponse(
                Response.Status.OK,
                "application/json",
                readConfig().toString()
            )
        }
        val path = if (session.uri == "/" || session.uri == "/admin") {
            "index.html"
        } else {
            session.uri.trimStart('/')
        }
        return try {
            val stream = activity.assets.open(path)
            newChunkedResponse(Response.Status.OK, mime(path), stream)
        } catch (_: Exception) {
            newFixedLengthResponse(Response.Status.NOT_FOUND, "text/plain", "File tidak ditemukan")
        }
    }

    private fun mime(p: String) = when {
        p.endsWith(".html") -> "text/html; charset=utf-8"
        p.endsWith(".css") -> "text/css"
        p.endsWith(".js") -> "application/javascript"
        p.endsWith(".png") -> "image/png"
        p.endsWith(".jpg") || p.endsWith(".jpeg") -> "image/jpeg"
        p.endsWith(".webp") -> "image/webp"
        else -> "text/plain"
    }
}

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action
        if (action == Intent.ACTION_BOOT_COMPLETED ||
            action == "android.intent.action.QUICKBOOT_POWERON" ||
            action == "com.htc.intent.action.QUICKBOOT_POWERON"
        ) {
            val launchIntent = Intent(context, MainActivity::class.java).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(launchIntent)
        }
    }
}
