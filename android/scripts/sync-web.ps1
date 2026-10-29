#Requires -Version 5.1
<#
.SYNOPSIS
    Bundles the DSH Mobile PWA (packages/dsh-mobile/web) into the Android app assets.

.DESCRIPTION
    Copies the static PWA into android/app/src/main/assets/www so the APK can start
    without the PC being reachable. The synced tree is a build artifact: it is
    gitignored and produced by this script. CI performs the same copy with `cp -a`
    (see .github/workflows/android.yml).

    The wrapper uses the bundled copy as a fallback only (menu item / connection error
    panel), because a file:// page cannot call the authenticated HTTP API of the
    gateway without CORS changes. See docs/android.md.

.PARAMETER Source
    PWA directory. Defaults to <repo>/packages/dsh-mobile/web.

.PARAMETER Destination
    Asset directory. Defaults to <android>/app/src/main/assets/www.

.PARAMETER Clean
    Delete the destination before copying (recommended after files were removed
    from the PWA).

.EXAMPLE
    pwsh -File android/scripts/sync-web.ps1

.EXAMPLE
    pwsh -File android/scripts/sync-web.ps1 -Clean -Source C:\src\web
#>
[CmdletBinding()]
param(
    [string]$Source = (Join-Path $PSScriptRoot '..\..\packages\dsh-mobile\web'),
    [string]$Destination = (Join-Path $PSScriptRoot '..\app\src\main\assets\www'),
    [switch]$Clean
)

$ErrorActionPreference = 'Stop'

$sourcePath = [System.IO.Path]::GetFullPath($Source)
$destinationPath = [System.IO.Path]::GetFullPath($Destination)

$driveRoot = [System.IO.Path]::GetPathRoot($destinationPath)
if ([string]::IsNullOrEmpty($destinationPath) -or $destinationPath -eq $driveRoot) {
    [Console]::Error.WriteLine("Refusing to use a filesystem root as the destination: '$destinationPath'.")
    exit 1
}

if (-not (Test-Path -LiteralPath $sourcePath -PathType Container)) {
    [Console]::Error.WriteLine("PWA directory not found: $sourcePath")
    [Console]::Error.WriteLine('The wrapper still works without it: the APK loads the page from the DSH gateway.')
    [Console]::Error.WriteLine('Build the PWA in packages/dsh-mobile/web first.')
    exit 1
}

$entryFile = Join-Path $sourcePath 'index.html'
if (-not (Test-Path -LiteralPath $entryFile -PathType Leaf)) {
    [Console]::Error.WriteLine("index.html not found in $sourcePath; refusing to bundle an incomplete PWA.")
    exit 1
}

if ($Clean -and (Test-Path -LiteralPath $destinationPath)) {
    Remove-Item -LiteralPath $destinationPath -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $destinationPath | Out-Null

# robocopy gives reliable recursive copy + excludes. Codes 0-7 are success.
$robocopyArgs = @(
    $sourcePath
    $destinationPath
    '/E'
    '/NFL'
    '/NDL'
    '/NJH'
    '/NJS'
    '/NP'
    '/XD'
    '.git'
    'node_modules'
    'tests'
    'test'
    '/XF'
    '*.map'
    '*.md'
    '.DS_Store'
    'package.json'
    'package-lock.json'
)
$null = robocopy @robocopyArgs
$robocopyExit = $LASTEXITCODE
if ($robocopyExit -ge 8) {
    [Console]::Error.WriteLine("robocopy failed with exit code $robocopyExit")
    exit 1
}
# robocopy returns 0-7 for success; do not leak that into the script's exit code.
$global:LASTEXITCODE = 0

$files = @(Get-ChildItem -LiteralPath $destinationPath -Recurse -File)
$totalBytes = ($files | Measure-Object -Property Length -Sum).Sum
if ($null -eq $totalBytes) { $totalBytes = 0 }
$totalMb = [math]::Round($totalBytes / 1MB, 2)

Write-Host "Synced $($files.Count) files ($totalMb MB)"
Write-Host "  from: $sourcePath"
Write-Host "  to:   $destinationPath"
Write-Host 'Rebuild the APK to bundle this snapshot: cd android; gradle assembleDebug'
Write-Host 'Note: app/src/main/assets/www is a build artifact and is gitignored.'
exit 0
