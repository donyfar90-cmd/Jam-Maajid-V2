package id.jammasjid.digital

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.GeolocationPermissions
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import fi.iki.elonen.NanoHTTPD
import org.json.JSONObject
import java.io.File
import java.net.Inet4Address
import java.net.NetworkInterface

class MainActivity : Activity() {
    private lateinit var server: LocalServer
    private lateinit var webView: WebView
    private lateinit var statusBarText: TextView
    private var fileUploadCallback: ValueCallback<Array<Uri>>? = null

    companion object {
        private const val REQ_PICK_IMAGE = 1001
        private const val REQ_LOCATION = 1002
        const val PREFS_NAME = "smart_masjid_prefs"
        const val KEY_AUTO_START_ASKED = "auto_start_asked"
        const val KEY_AUTO_START_ENABLED = "auto_start_enabled"
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        @Suppress("DEPRECATION")
        window.decorView.systemUiVisibility = 5894 or 1024 or 512

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

        server = LocalServer(this)
        server.start(NanoHTTPD.SOCKET_READ_TIMEOUT, false)

        val rootLayout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#0F172A"))
        }

        val topBar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setBackgroundColor(Color.parseColor("#1E293B"))
            setPadding(24, 12, 24, 12)
        }

        statusBarText = TextView(this).apply {
            setTextColor(Color.parseColor("#E2E8F0"))
            textSize = 13f
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        }

        val autoStartBtn = Button(this).apply {
            text = "Atur Auto-Start"
            textSize = 12f
            setBackgroundColor(Color.parseColor("#10B981"))
            setTextColor(Color.parseColor("#052E16"))
            setOnClickListener { showAutoStartDialog(forceShow = true) }
        }

        val reloadBtn = Button(this).apply {
            text = "Muat Ulang"
            textSize = 12f
            setBackgroundColor(Color.parseColor("#334155"))
            setTextColor(Color.WHITE)
            val lp = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
            lp.marginStart = 12
            layoutParams = lp
            setOnClickListener { webView.reload() }
        }

        topBar.addView(statusBarText)
        topBar.addView(autoStartBtn)
        topBar.addView(reloadBtn)

        webView = WebView(this).apply {
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                0,
                1f
            )
            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                databaseEnabled = true
                allowFileAccess = true
                setGeolocationEnabled(true)
                mediaPlaybackRequiresUserGesture = false
            }
            webViewClient = WebViewClient()
            webChromeClient = object : WebChromeClient() {
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
        }

        rootLayout.addView(topBar)
        rootLayout.addView(webView)
        setContentView(rootLayout)

        updateStatusBar()
        webView.loadUrl("http://127.0.0.1:8081/")

        webView.postDelayed({
            showAutoStartDialog(forceShow = false)
        }, 700)
    }

    private fun updateStatusBar() {
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val enabled = prefs.getBoolean(KEY_AUTO_START_ENABLED, false)
        val ip = getDeviceIpAddress()
        val labelAuto = if (enabled) "AKTIF" else "NONAKTIF"
        statusBarText.text = "Remote HP: http://$ip:8081/remote  |  Auto-Start: $labelAuto"
    }

    private fun showAutoStartDialog(forceShow: Boolean) {
        if (isFinishing || isDestroyed) return
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val alreadyAsked = prefs.getBoolean(KEY_AUTO_START_ASKED, false)
        if (!forceShow && alreadyAsked) return

        val currentEnabled = prefs.getBoolean(KEY_AUTO_START_ENABLED, false)
        AlertDialog.Builder(this)
            .setTitle("Pengaturan Auto-Start TV")
            .setMessage(
                "Apakah Smart Masjid ingin otomatis tampil saat TV Android menyala?\n\n" +
                    "Status saat ini: ${if (currentEnabled) "Aktif" else "Tidak Aktif"}"
            )
            .setCancelable(true)
            .setPositiveButton("Ya, Auto-Start") { _, _ ->
                prefs.edit()
                    .putBoolean(KEY_AUTO_START_ASKED, true)
                    .putBoolean(KEY_AUTO_START_ENABLED, true)
                    .apply()
                updateStatusBar()
            }
            .setNegativeButton("Tidak") { _, _ ->
                prefs.edit()
                    .putBoolean(KEY_AUTO_START_ASKED, true)
                    .putBoolean(KEY_AUTO_START_ENABLED, false)
                    .apply()
                updateStatusBar()
            }
            .show()
    }

    fun getDeviceIpAddress(): String {
        try {
            val interfaces = NetworkInterface.getNetworkInterfaces()
            while (interfaces.hasMoreElements()) {
                val intf = interfaces.nextElement()
                if (!intf.isUp || intf.isLoopback) continue
                val addrs = intf.inetAddresses
                while (addrs.hasMoreElements()) {
                    val addr = addrs.nextElement()
                    if (!addr.isLoopbackAddress && addr is Inet4Address) {
                        val ip = addr.hostAddress ?: ""
                        if (!ip.startsWith("127.")) return ip
                    }
                }
            }
        } catch (_: Exception) {
        }
        return try {
            @Suppress("DEPRECATION")
            val wifiManager = applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
            val ipInt = wifiManager.connectionInfo.ipAddress
            if (ipInt != 0) {
                String.format(
                    "%d.%d.%d.%d",
                    ipInt and 0xff,
                    ipInt shr 8 and 0xff,
                    ipInt shr 16 and 0xff,
                    ipInt shr 24 and 0xff
                )
            } else {
                "127.0.0.1"
            }
        } catch (_: Exception) {
            "127.0.0.1"
        }
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

class LocalServer(private val activity: MainActivity) : NanoHTTPD("0.0.0.0", 8081) {
    private val configFile = File(activity.filesDir, "settings.json")
    private val defaults = JSONObject(
        """{"mosque":"Masjid Baitul Ghofar","location":"Surabaya","timezone":"Asia/Jakarta","text":"Selamat datang di masjid kami. Mohon luruskan dan rapatkan shaf.","times":{"Subuh":"04:20","Syuruq":"05:40","Dzuhur":"11:40","Ashar":"15:00","Maghrib":"17:35","Isya":"18:45"},"iqamah":{"Subuh":10,"Dzuhur":10,"Ashar":10,"Maghrib":5,"Isya":10},"offset":{"Subuh":0,"Dzuhur":0,"Ashar":0,"Maghrib":0,"Isya":0}}"""
    )

    private fun readConfig(): JSONObject = try {
        JSONObject(configFile.readText())
    } catch (_: Exception) {
        defaults
    }

    private fun jsonResponse(status: Response.IStatus, content: String): Response {
        return newFixedLengthResponse(status, "application/json; charset=utf-8", content).apply {
            addHeader("Access-Control-Allow-Origin", "*")
            addHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            addHeader("Access-Control-Allow-Headers", "Content-Type")
        }
    }

    override fun serve(session: IHTTPSession): Response {
        if (session.method == Method.OPTIONS) {
            return jsonResponse(Response.Status.OK, "{}")
        }

        if (session.uri == "/api/ip") {
            val ip = activity.getDeviceIpAddress()
            return jsonResponse(Response.Status.OK, """{"ip":"$ip","port":8081,"remoteUrl":"http://$ip:8081/remote"}""")
        }

        if (session.method == Method.POST && session.uri == "/api/settings") {
            val body = HashMap<String, String>()
            session.parseBody(body)
            val data = JSONObject(body["postData"] ?: "{}")
            configFile.writeText(data.toString(2))
            activity.runOnUiThread {
                try {
                    activity.findViewById<WebView>(android.R.id.content)
                } catch (_: Exception) {
                }
            }
            return jsonResponse(Response.Status.OK, """{"ok":true}""")
        }

        if (session.uri == "/api/settings") {
            return jsonResponse(Response.Status.OK, readConfig().toString())
        }

        if (session.uri == "/remote") {
            return try {
                val stream = activity.assets.open("remote.html")
                newChunkedResponse(Response.Status.OK, "text/html; charset=utf-8", stream).apply {
                    addHeader("Access-Control-Allow-Origin", "*")
                }
            } catch (_: Exception) {
                newFixedLengthResponse(Response.Status.OK, "text/html; charset=utf-8", builtInRemoteHtml).apply {
                    addHeader("Access-Control-Allow-Origin", "*")
                }
            }
        }

        val path = when (session.uri) {
            "/", "/admin" -> "index.html"
            else -> session.uri.trimStart('/')
        }

        return try {
            val stream = activity.assets.open(path)
            newChunkedResponse(Response.Status.OK, mime(path), stream).apply {
                addHeader("Access-Control-Allow-Origin", "*")
            }
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

    private val builtInRemoteHtml = """
<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Remote Jam Masjid Digital</title>
  <style>
    * { box-sizing: border-box; font-family: system-ui, -apple-system, sans-serif; }
    body { margin: 0; background: #0f172a; color: #f8fafc; padding: 14px; }
    .wrap { max-width: 640px; margin: 0 auto; }
    h1 { font-size: 1.25rem; margin: 0 0 4px; }
    .sub { color: #94a3b8; font-size: 0.85rem; margin-bottom: 14px; }
    .card { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 14px; margin-bottom: 12px; }
    .card h2 { font-size: 0.98rem; margin: 0 0 8px; }
    label { display: block; font-size: 0.8rem; color: #cbd5e1; margin: 8px 0 3px; }
    input, textarea { width: 100%; padding: 9px 10px; border-radius: 8px; border: 1px solid #475569; background: #0f172a; color: #f8fafc; }
    textarea { min-height: 68px; resize: vertical; }
    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
    .row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
    button { border: none; border-radius: 8px; padding: 10px 14px; font-weight: 600; cursor: pointer; background: #10b981; color: #052e16; }
    button.sec { background: #334155; color: #f8fafc; }
    .status { margin-top: 10px; padding: 10px; border-radius: 8px; background: #090e1a; border: 1px solid #334155; font-size: 0.85rem; white-space: pre-line; }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>Remote Pengaturan Jam Masjid</h1>
    <div class="sub">Terhubung ke server NanoHTTPD (port 8081) lewat Wi-Fi lokal</div>
    <div class="card">
      <h2>1. Alamat Perangkat</h2>
      <label for="baseUrl">URL Server Android</label>
      <input id="baseUrl" type="text" />
      <div class="row"><button type="button" class="sec" onclick="loadSettings()">Ambil Data Saat Ini</button></div>
    </div>
    <div class="card">
      <h2>2. Profil & Running Text</h2>
      <label for="mosque">Nama Masjid</label><input id="mosque" type="text" />
      <div class="grid-2">
        <div><label for="location">Lokasi / Kota</label><input id="location" type="text" /></div>
        <div><label for="timezone">Zona Waktu</label><input id="timezone" type="text" /></div>
      </div>
      <label for="text">Teks Berjalan (Running Text)</label><textarea id="text"></textarea>
    </div>
    <div class="card">
      <h2>3. Jadwal Waktu (HH:MM)</h2>
      <div class="grid-2">
        <div><label for="t_Subuh">Subuh</label><input id="t_Subuh" type="time" /></div>
        <div><label for="t_Syuruq">Syuruq</label><input id="t_Syuruq" type="time" /></div>
        <div><label for="t_Dzuhur">Dzuhur</label><input id="t_Dzuhur" type="time" /></div>
        <div><label for="t_Ashar">Ashar</label><input id="t_Ashar" type="time" /></div>
        <div><label for="t_Maghrib">Maghrib</label><input id="t_Maghrib" type="time" /></div>
        <div><label for="t_Isya">Isya</label><input id="t_Isya" type="time" /></div>
      </div>
    </div>
    <div class="card">
      <h2>4. Iqamah & Offset (Menit)</h2>
      <div class="grid-3">
        <div><label for="iq_Subuh">Iqamah Subuh</label><input id="iq_Subuh" type="number" /></div>
        <div><label for="iq_Dzuhur">Iqamah Dzuhur</label><input id="iq_Dzuhur" type="number" /></div>
        <div><label for="iq_Ashar">Iqamah Ashar</label><input id="iq_Ashar" type="number" /></div>
        <div><label for="iq_Maghrib">Iqamah Maghrib</label><input id="iq_Maghrib" type="number" /></div>
        <div><label for="iq_Isya">Iqamah Isya</label><input id="iq_Isya" type="number" /></div>
      </div>
      <div class="grid-3">
        <div><label for="off_Subuh">Offset Subuh</label><input id="off_Subuh" type="number" /></div>
        <div><label for="off_Dzuhur">Offset Dzuhur</label><input id="off_Dzuhur" type="number" /></div>
        <div><label for="off_Ashar">Offset Ashar</label><input id="off_Ashar" type="number" /></div>
        <div><label for="off_Maghrib">Offset Maghrib</label><input id="off_Maghrib" type="number" /></div>
        <div><label for="off_Isya">Offset Isya</label><input id="off_Isya" type="number" /></div>
      </div>
      <div class="row"><button type="button" onclick="saveSettings()">Simpan ke Perangkat</button></div>
      <div id="status" class="status">Siap digunakan.</div>
    </div>
  </div>
  <script>
    const PRAYERS = ['Subuh', 'Dzuhur', 'Ashar', 'Maghrib', 'Isya'];
    const ALL_TIMES = ['Subuh', 'Syuruq', 'Dzuhur', 'Ashar', 'Maghrib', 'Isya'];
    const urlInput = document.getElementById('baseUrl');
    const statusEl = document.getElementById('status');
    urlInput.value = (location.protocol.startsWith('http') && location.host) ? location.origin : 'http://192.168.1.10:8081';
    const baseUrl = () => urlInput.value.trim().replace(/\/+$/, '');
    const setStatus = msg => { statusEl.textContent = msg; };
    function fillForm(cfg) {
      document.getElementById('mosque').value = cfg.mosque || '';
      document.getElementById('location').value = cfg.location || '';
      document.getElementById('timezone').value = cfg.timezone || 'Asia/Jakarta';
      document.getElementById('text').value = cfg.text || '';
      const times = cfg.times || {};
      ALL_TIMES.forEach(k => { document.getElementById('t_' + k).value = times[k] || ''; });
      const iq = cfg.iqamah || {}, off = cfg.offset || {};
      PRAYERS.forEach(k => {
        document.getElementById('iq_' + k).value = iq[k] ?? 10;
        document.getElementById('off_' + k).value = off[k] ?? 0;
      });
    }
    function buildPayload() {
      const times = {}, iqamah = {}, offset = {};
      ALL_TIMES.forEach(k => { times[k] = document.getElementById('t_' + k).value || '00:00'; });
      PRAYERS.forEach(k => {
        iqamah[k] = Number(document.getElementById('iq_' + k).value || 0);
        offset[k] = Number(document.getElementById('off_' + k).value || 0);
      });
      return {
        mosque: document.getElementById('mosque').value.trim(),
        location: document.getElementById('location').value.trim(),
        timezone: document.getElementById('timezone').value.trim() || 'Asia/Jakarta',
        text: document.getElementById('text').value,
        times, iqamah, offset
      };
    }
    async function loadSettings() {
      setStatus('Mengambil data...');
      try {
        const res = await fetch(baseUrl() + '/api/settings');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        fillForm(await res.json());
        setStatus('Data berhasil dimuat.');
      } catch (e) { setStatus('Gagal memuat: ' + e.message); }
    }
    async function saveSettings() {
      setStatus('Menyimpan...');
      try {
        const res = await fetch(baseUrl() + '/api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildPayload())
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        setStatus('Pengaturan tersimpan ke settings.json!');
      } catch (e) { setStatus('Gagal menyimpan: ' + e.message); }
    }
  </script>
</body>
</html>
""".trimIndent()
}

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action
        if (action == Intent.ACTION_BOOT_COMPLETED ||
            action == "android.intent.action.QUICKBOOT_POWERON" ||
            action == "com.htc.intent.action.QUICKBOOT_POWERON"
        ) {
            val prefs = context.getSharedPreferences(MainActivity.PREFS_NAME, Context.MODE_PRIVATE)
            val autoStartEnabled = prefs.getBoolean(MainActivity.KEY_AUTO_START_ENABLED, false)
            if (!autoStartEnabled) return

            val launchIntent = Intent(context, MainActivity::class.java).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(launchIntent)
        }
    }
}
