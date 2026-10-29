# Capture real UI screenshots of the DSH Mobile PWA with headless Chrome.
# Chromium needs named pipes, so this script must run with full access.
$ErrorActionPreference = 'Continue'
$chrome = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
$root = 'C:\Users\<user>\Documents\deepseek-harness\harness'
$web = Join-Path $root 'packages\dsh-mobile\web'
$out = Join-Path $root 'docs\guide\screens'
$profile = Join-Path $root 'research\tmp\chrome-shots'
$py = 'C:\Users\<user>\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe'
New-Item -ItemType Directory -Force -Path $out, $profile | Out-Null

$listening = Test-NetConnection 127.0.0.1 -Port 8765 -InformationLevel Quiet -WarningAction SilentlyContinue
if (-not $listening) {
  Start-Process -FilePath $py -ArgumentList '-m', 'http.server', '8765', '--bind', '127.0.0.1' -WorkingDirectory $web -WindowStyle Hidden
  Start-Sleep -Seconds 2
}

function Shot([string]$name, [int]$w, [int]$h, [string]$url) {
  $file = Join-Path $out $name
  Remove-Item $file -ErrorAction SilentlyContinue
  $args = @(
    '--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-background-networking', '--hide-scrollbars',
    '--force-device-scale-factor=2', '--virtual-time-budget=8000',
    "--user-data-dir=$profile", "--window-size=$w,$h", "--screenshot=$file", $url
  )
  & $chrome @args 2>$null | Out-Null
  if (Test-Path $file) {
    $size = (Get-Item $file).Length
    Write-Output ("{0,-24} {1,8} bytes" -f $name, $size)
  } else {
    Write-Output ("{0,-24} FAILED" -f $name)
  }
}

$base = 'http://127.0.0.1:8765/'
Shot '01-sessions.png'      390 844 "${base}?demo=1#/sessions"
Shot '02-chat.png'          390 844 "${base}?demo=1#/s/s-demo-1"
Shot '03-approval.png'      390 844 "${base}?demo=1#/s/s-demo-2"
Shot '04-question.png'      390 844 "${base}?demo=1#/s/s-demo-6"
Shot '05-settings.png'      390 844 "${base}?demo=1#/settings"
Shot '06-pair.png'          390 844 "${base}?demo=0#/pair"
Shot '07-foldable-lab.png' 1180 820 "${base}?demo=1&lab=1"
Shot '08-chat-light.png'    390 844 "${base}?demo=1&theme=light#/s/s-demo-3"

# Stop the preview server if we started it.
if (-not $listening) {
  Get-CimInstance Win32_Process -Filter "Name = 'python.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like '*http.server*8765*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}
Write-Output 'shots done'
