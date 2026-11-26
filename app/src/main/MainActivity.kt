package id.jammasjid.digital

import android.app.Activity
import android.os.Bundle
import android.webkit.WebView
import android.webkit.WebViewClient
import android.view.WindowManager
import fi.iki.elonen.NanoHTTPD
import org.json.JSONObject
import org.json.JSONArray
import java.io.File
import java.util.Base64

class MainActivity : Activity() {
 private lateinit var server: LocalServer
 override fun onCreate(savedInstanceState: Bundle?) {
  super.onCreate(savedInstanceState)
  window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
  window.decorView.systemUiVisibility = 5894 or 1024 or 512
  server = LocalServer(this); server.start(NanoHTTPD.SOCKET_READ_TIMEOUT, false)
  val w=WebView(this); w.settings.javaScriptEnabled=true; w.settings.domStorageEnabled=true; w.settings.mediaPlaybackRequiresUserGesture=false; w.webViewClient=WebViewClient(); setContentView(w); w.loadUrl("http://127.0.0.1:8080/")
 }
 override fun onDestroy(){ try{server.stop()}catch(_:Exception){}; super.onDestroy() }
}
class LocalServer(private val activity: Activity): NanoHTTPD(8080) {
 private val configFile = File(activity.filesDir,"settings.json")
 private val mediaDir = File(activity.filesDir,"media").apply { mkdirs() }
 private val defaults = JSONObject("""{"mosque":"Masjid Baitul Ghofar","location":"Surabaya","timezone":"Asia/Jakarta","text":"Selamat datang di masjid kami. Mohon luruskan dan rapatkan shaf.","announcement":"","report":"","slides":[],"youtube":"","times":{"Subuh":"04:20","Syuruq":"05:40","Dzuhur":"11:40","Ashar":"15:00","Maghrib":"17:35","Isya":"18:45"},"iqamah":{"Subuh":10,"Dzuhur":10,"Ashar":10,"Maghrib":5,"Isya":10},"offset":{"Subuh":0,"Dzuhur":0,"Ashar":0,"Maghrib":0,"Isya":0}}""")
 private fun readConfig(): JSONObject = try { JSONObject(configFile.readText()) } catch(_:Exception){ defaults }
 override fun serve(session: IHTTPSession): Response {
  if(session.method==Method.POST && session.uri=="/api/settings") { val body=HashMap<String,String>(); session.parseBody(body); val data=JSONObject(body["postData"]?:"{}"); configFile.writeText(data.toString(2)); return newFixedLengthResponse(Response.Status.OK,"application/json", "{\"ok\":true}") }
  if(session.uri=="/api/settings") return newFixedLengthResponse(Response.Status.OK,"application/json",readConfig().toString())
  if(session.method==Method.POST && session.uri=="/api/upload") { try { val body=HashMap<String,String>(); session.parseBody(body); val data=JSONObject(body["postData"]?:"{}"); val name=data.optString("name","slide.jpg").replace(Regex("[^A-Za-z0-9._-]"),"_"); val b64=data.optString("data").substringAfter(",",data.optString("data")); val bytes=Base64.getDecoder().decode(b64); val out=File(mediaDir,name); out.writeBytes(bytes); val cfg=readConfig(); val slides=cfg.optJSONArray("slides")?:JSONArray(); if((0 until slides.length()).none{slides.optString(it)==name}) slides.put(name); cfg.put("slides",slides); configFile.writeText(cfg.toString(2)); return newFixedLengthResponse(Response.Status.OK,"application/json",JSONObject().put("ok",true).put("name",name).toString()) } catch(e:Exception){ return newFixedLengthResponse(Response.Status.BAD_REQUEST,"application/json",JSONObject().put("ok",false).put("error",e.message?:"Upload error").toString()) } }
  if(session.uri.startsWith("/media/")){ val f=File(mediaDir,session.uri.substringAfterLast('/')); if(f.exists()) return newFixedLengthResponse(Response.Status.OK,mime(f.name),f.inputStream()) }
  val path=if(session.uri=="/"||session.uri=="/admin") "index.html" else session.uri.trimStart('/')
  return try { val stream=activity.assets.open(path); newChunkedResponse(Response.Status.OK,mime(path),stream) } catch(_:Exception){newFixedLengthResponse(Response.Status.NOT_FOUND,"text/plain","File tidak ditemukan")}
 }
 private fun mime(p:String)=when { p.endsWith(".html")->"text/html; charset=utf-8"; p.endsWith(".css")->"text/css; charset=utf-8"; p.endsWith(".js")->"application/javascript; charset=utf-8"; p.endsWith(".jpg")||p.endsWith(".jpeg")->"image/jpeg"; p.endsWith(".png")->"image/png"; p.endsWith(".webp")->"image/webp"; else->"application/octet-stream" }
}
