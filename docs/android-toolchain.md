# Android-тулчейн на этой машине

Установлено и проверено: **сборка APK выполняется локально**, без Android Studio и без CI.

## Что установлено

| Компонент | Версия | Путь |
|---|---|---|
| JDK (Eclipse Temurin) | 17.0.20.1+1 | `C:\Users\<user>\AppData\Local\Programs\jdk-17` |
| Android SDK | platform-tools 37.0.1, `platforms;android-35`, `build-tools;35.0.0`, cmdline-tools 12.0 | `C:\Users\<user>\AppData\Local\Android\Sdk` |
| Gradle | 8.9 | `C:\Users\<user>\AppData\Local\Programs\gradle-8.9` |
| Gradle wrapper | 8.9 (`gradlew.bat` + `gradle-wrapper.jar`) | `android/` (JAR в `.gitignore`) |
| adb | 37.0.1 | в составе platform-tools |
| Android Lint | в составе cmdline-tools | `lint.bat`, `gradlew :app:lintDebug` |

Переменные окружения записаны в **пользовательские** (`HKCU\Environment`):
`JAVA_HOME`, `ANDROID_HOME`, `ANDROID_SDK_ROOT`, `GRADLE_HOME`, а в `PATH` добавлены
`%JAVA_HOME%\bin`, `%ANDROID_HOME%\platform-tools`, `%ANDROID_HOME%\cmdline-tools\latest\bin`,
`%GRADLE_HOME%\bin`. Новый терминал подхватывает их автоматически; для уже открытого —
`. .\android\env.ps1`.

Занято на диске: JDK ~303 МБ, SDK ~536 МБ, Gradle ~144 МБ, кэш Gradle ~1.05 ГБ.
Установочные архивы удалены после распаковки.

## Сборка

```powershell
. .\android\env.ps1          # необязательно в новом терминале
cd android
.\gradlew.bat assembleDebug  # APK: app/build/outputs/apk/debug/app-debug.apk
.\gradlew.bat assembleRelease
.\gradlew.bat :app:lintDebug # отчёт: app/build/reports/lint-results-debug.html
.\gradlew.bat wrapper        # перегенерировать wrapper при необходимости
```

Альтернатива без wrapper: `gradle assembleDebug` (Gradle 8.9 есть в PATH).

## Результаты (проверено)

```
gradle assembleDebug assembleRelease  → BUILD SUCCESSFUL (72 задачи)
gradlew.bat assembleDebug            → BUILD SUCCESSFUL (wrapper скачал дистрибутив)
```

| Артефакт | Размер | SHA-256 |
|---|---|---|
| `app-debug.apk` (с bundled PWA) | 2.25 МБ | `1E6547BD7CAA5B2D708A15014983AF64A07B85CE90447400C5A0A2FF62BAA2B4` |
| `app-release-unsigned.apk` | 1.74 МБ | `25188AB4862E3B24418F5572B8D72166ADE3537A9DFCDB45AA9ABAED5CB6CD8B` |

- `aapt2 dump badging`: `com.dshmobile.app.debug`, minSdk 26, targetSdk 35, compileSdk 35,
  `INTERNET`, label `DSH Mobile` (ru/en).
- Lint: **0 ошибок, 26 предупреждений** (только «доступны новые версии AGP/зависимостей»).
- В APK лежит bundled PWA: `assets/www/index.html`, `js/main.js`, `styles/layout.css` и ещё 23 файла.

## Исправлено в ходе первой сборки

1. `MainActivity.onNewIntent(Intent?)` не переопределял `ComponentActivity.onNewIntent(Intent)` —
   сигнатура исправлена на `onNewIntent(intent: Intent)`.
2. Android Lint `NewApi`: `windowLightNavigationBar` и `windowLayoutInDisplayCutoutMode`
   требуют API 27 при minSdk 26 — атрибуты вынесены в `res/values-v27/themes.xml`.

## Устройство / эмулятор

Подключённых устройств нет (`adb devices` пуст). Для проверки на телефоне:

```powershell
adb install -r android\app\build\outputs\apk\debug\app-debug.apk
```

Эмулятор (если нужен) ставится отдельно:

```powershell
sdkmanager "emulator" "system-images;android-35;google_apis;x86_64"
avdmanager create avd -n dsh35 -k "system-images;android-35;google_apis;x86_64"
emulator -avd dsh35
```

Android Studio (IDE, не требуется для CLI-сборки) — по желанию:

```powershell
winget install --id Google.AndroidStudio -e
```
