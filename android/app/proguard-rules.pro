# Keep JS interface methods if a host bridge is ever added (defensive; minification is off today).
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Keep the WebView client classes referenced only from the manifest/instantiation.
-keep class com.dshmobile.app.** { *; }
