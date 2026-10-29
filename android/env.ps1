# DSH Mobile — local Android toolchain environment.
#
# Dot-source this file in a PowerShell session before building:
#
#   . .\android\env.ps1
#   cd android
#   gradle assembleDebug
#
# The same variables are also persisted at user scope, so a NEW terminal usually
# needs nothing at all. This script exists for reproducibility and for shells that
# were started before the toolchain was installed.

$jdk = Join-Path $env:LOCALAPPDATA 'Programs\jdk-17'
$gradle = Join-Path $env:LOCALAPPDATA 'Programs\gradle-8.9'
$sdk = Join-Path $env:LOCALAPPDATA 'Android\Sdk'

foreach ($entry in @(
    @{ Name = 'JAVA_HOME'; Value = $jdk; Path = 'bin' },
    @{ Name = 'ANDROID_HOME'; Value = $sdk; Path = 'platform-tools' },
    @{ Name = 'ANDROID_SDK_ROOT'; Value = $sdk; Path = $null },
    @{ Name = 'GRADLE_HOME'; Value = $gradle; Path = 'bin' }
)) {
    if (-not (Test-Path $entry.Value)) {
        Write-Warning "$($entry.Name) target missing: $($entry.Value)"
        continue
    }
    Set-Item -Path "Env:$($entry.Name)" -Value $entry.Value
    if ($entry.Path) {
        $bin = Join-Path $entry.Value $entry.Path
        if ($env:PATH -notlike "*$bin*") {
            $env:PATH = "$bin;$env:PATH"
        }
    }
}

# cmdline-tools (sdkmanager, avdmanager, lint) and platform-tools (adb).
foreach ($bin in @(
    (Join-Path $sdk 'cmdline-tools\latest\bin'),
    (Join-Path $sdk 'platform-tools')
)) {
    if ((Test-Path $bin) -and ($env:PATH -notlike "*$bin*")) {
        $env:PATH = "$bin;$env:PATH"
    }
}

Write-Host "JAVA_HOME     = $env:JAVA_HOME"
Write-Host "ANDROID_HOME  = $env:ANDROID_HOME"
Write-Host "GRADLE_HOME   = $env:GRADLE_HOME"
if (Test-Path (Join-Path $env:JAVA_HOME 'bin\java.exe')) {
    Write-Host ("java          = " + (& (Join-Path $env:JAVA_HOME 'bin\java.exe') -version 2>&1 | Select-Object -First 1))
}
if (Test-Path (Join-Path $env:GRADLE_HOME 'bin\gradle.bat')) {
    Write-Host ("gradle        = " + (& (Join-Path $env:GRADLE_HOME 'bin\gradle.bat') --version 2>&1 | Select-String '^Gradle ' | ForEach-Object { $_.Line }))
}
