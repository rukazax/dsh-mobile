# Isolated DSH test instance — verified recipe

A second DeepSeek Harness process, booted from the **extracted shipped app**,
with its own `DSH_HOME` under `research/`, serving on a non-production port, so
plugins can be installed and exercised without touching the live GUI.

**Isolation rules (hard):**

- The live Desktop app listens on **127.0.0.1:59912** and owns
  `C:\Users\<user>\.dsh\profiles\desktop`. Never edit, stop or restart it.
- The test instance uses `DSH_HOME=research\dshtest`, `--profile web`,
  `--port 18080`, and the spike's own listener on `127.0.0.1:18099`.
- Everything the test writes stays under `research\dshtest` (plus pnpm's store,
  see §8).

Verified on 2026-10-23 against DSH **0.2.1-rc.2** (extracted from
`C:\Users\<user>\AppData\Local\Programs\DeepSeek Harness\resources\app.asar` to
`research\app\dsh`).

---

## 0. Paths used below

```powershell
$node  = "C:\Users\<user>\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
$bin   = "C:\Users\<user>\Documents\deepseek-harness\harness\research\app\dsh\node_modules\@deepseek-ai\dsh\lib\bin.js"
$home  = "C:\Users\<user>\Documents\deepseek-harness\harness\research\dshtest"
$probe = "C:\Users\<user>\Documents\deepseek-harness\harness\research\tools\probe.mjs"
$pnpmShimDir = "C:\Users\<user>\Documents\deepseek-harness\harness\research\tools"
```

Bundled Node is **v24.21.0**; it is not on `PATH`. The bundled pnpm is
**11.28.5** at
`C:\Users\<user>\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm`.

---

## 1. Boot the instance

```powershell
$env:DSH_HOME = $home
& $node $bin --profile web --no-open --port 18080
```

Run this as a **background job** (the process must keep running).

Observed first output (the token is freshly minted on every boot — this one is
dead now, the process was stopped):

```
dsh web: http://127.0.0.1:18080/?token=ynlwhM7tJ8idy06JCdYptK9-Cygzh0I89rXCBBolPK8
```

The profile is auto-initialized on first boot from the shipped template
(`@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-web-app`,
`research/app/dsh/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js:551-557`).
`research/dshtest` already exists in this workspace; a fresh one is created
automatically by the launcher on first use.

To confirm it is up:

```powershell
netstat -ano | Select-String ":18080\s+.*LISTENING"
#   TCP    127.0.0.1:18080        0.0.0.0:0              LISTENING       <pid>
```

**If `EADDRINUSE` appears**, a previous instance is still running. Find and stop
it (§7), then boot again. Do **not** reuse the old token — each boot mints a new
one.

---

## 2. Authenticate (launch token → browser cookie)

The HTTP carrier accepts the token **only on the root exchange**
(`research/app/dsh/node_modules/@deepseek-ai/dsh-client-connection/README.md:41`).
The real browser flow is: open the printed `?token=...` URL once, receive a
signed `Set-Cookie`, get redirected to `./`, then use the cookie. Because
Windows PowerShell 5.1's `Invoke-WebRequest` throws on 4xx/3xx and has no
`-SkipHttpErrorCheck`, the probe script uses Node's `fetch` with
`redirect: 'manual'` and prints status/headers/body exactly.

```powershell
& $node $probe root "http://127.0.0.1:18080"
```

Observed (no cookie):

```
### GET / (anonymous)
status: 401 Unauthorized
headers: {"content-type":"text/plain; charset=utf-8","cache-control":"no-store"}
body length: 68
body: dsh web authentication required; reopen the URL printed by dsh web.
```

Exchange the printed token:

```powershell
& $node $probe pair "http://127.0.0.1:18080" "<TOKEN-FROM-THE-dsh-web-LINE>"
```

Observed (real output, token redacted to `<TOKEN>` here only; the original is in
the transcript logs):

```
### GET /?token=<launch token> (exchange)
URL: http://127.0.0.1:18080/?token=<TOKEN>
status: 303 See Other
headers: {"cache-control":"no-store","location":"./"}
set-cookie[0]: dsh-auth-nYduc6zqJtTw0rGulDUeNAWD2-FAK_qKy1Gi2RPQrqw=v1.eyJ2ZXJzaW9uIjoxLCJhdXRob3JpdHkiOiIxMjcuMC4wLjE6MTgwODAiLCJpc3N1ZWRBdCI6MTc5Mjc0Nzg4MTgwMSwiZXhwaXJlc0F0IjoxNzk1MzM5ODgxODAxfQ.F8QPf0oydtJLtIQkgFMEn4de8jw3VLP6yMxut5sb3Kg; Max-Age=2592000; Path=/; Expires=Sun, 22 Nov 2026 09:31:21 GMT; HttpOnly; SameSite=Strict
set-cookie count: 1
body length: 0
body:
(cookie saved to ...\research\tools\.probe-cookie.json: dsh-auth-...=v1...)
```

Notes on the exact behavior observed:

- The index exchange answers **`303 See Other`** (not 302) with
  `location: ./`. (`/connect` for API callers is a different flow and is not
  used here.)
- The cookie name embeds the normalized authority:
  `dsh-auth-<base64url("127.0.0.1:18080")>`.
- Cookie attributes: `Max-Age=2592000` (30 days), `Path=/`, `HttpOnly`,
  `SameSite=Strict`; `Secure` appears only when the listener serves TLS.
- A wrong/stale token does not set a cookie.
- The probe stores the cookie in `research\tools\.probe-cookie.json` so later
  commands can reuse it (`pair` overwrites it; delete the file to force a fresh
  exchange).

Then verify the cookie works:

```powershell
& $node $probe get "http://127.0.0.1:18080" "/" --body
```

Observed:

```
### GET / (with cookie)
status: 200 OK
headers: {"content-type":"text/html; charset=utf-8"}
body length: 37448
body: <!doctype html> ... (SPA index)
```

---

## 3. Install the spike plugin into the TEST profile

Never run this against `--profile desktop`; this recipe is scoped to
`DSH_HOME=research\dshtest`.

`dsh plugin` resolves the executable name **`pnpm`** through `PATH`
(`research/app/dsh/node_modules/@deepseek-ai/dsh-plugin-manager/lib/types/operations.js:330,380`).
Only the bundled pnpm exists on this machine, so a 5-line shim is prepended:
`research/tools/pnpm.cmd` runs the bundled Node against
`...\pnpm\bin\pnpm.mjs`.

```powershell
$env:DSH_HOME = $home
$env:PATH     = "$pnpmShimDir;" + $env:PATH

& $node $bin plugin --profile web add `
  "link:C:\Users\<user>\Documents\deepseek-harness\harness\research\plugin-spike"
```

Observed (real output):

```
[WARN] The store at C:\Users\<user>\AppData\Local\pnpm\store\v11 is not used because packages cannot be hard linked from it into this project. Using the store at C:\Users\<user>\Documents\deepseek-harness\harness\.pnpm-store\v11 instead. Set storeDir to choose the store.
Already up to date

dependencies:
+ dsh-mobile-spike 0.1.0 <- ..\..\..\plugin-spike

Done in 764ms using pnpm v11.28.5
=== exit code: 0 ===
```

No registry access is needed for a local `link:` package with no dependencies.
After a successful run the plugin manager's `reconcile()` appends the bundle to
the profile manifest (`.../dsh-plugin-manager/lib/types/operations.js:95-124`),
so `research\dshtest\profiles\web\package.json` becomes:

```json
{
  "name": "dsh-profile-web",
  "private": true,
  "dependencies": {
    "dsh-mobile-spike": "link:C:/Users/<user>/Documents/deepseek-harness/harness/research/plugin-spike"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "dsh-mobile-spike"
      ]
    }
  }
}
```

No manual manifest edit was needed. To install the real plugin later, repeat
with `link:<...\packages\dsh-mobile>` (or a registry spec) against a test
profile.

### Reinstall / uninstall

```powershell
& $node $bin plugin --profile web add "link:<new path>"    # replace the link
& $node $bin plugin --profile web remove dsh-mobile-spike  # remove dependency
# then remove "dsh-mobile-spike" from dsh.profile.bundles by hand (or use the
# Web Plugins page) — the CLI `remove` does not reconcile the bundle list.
```

---

## 4. Verify the running plugin

The instance picks the new bundle up **live** (the `web` template enables HMR;
`dsh-app-boot/README.md:63`). In our run the install happened while the instance
was running, and the plugin mounted within ~1 s — no restart. Evidence from
`<DSH_HOME>\logs\dsh-mobile-spike.log` (the fixture attaches its own logger
exporter; the stock web profile has no console exporter, so nothing appears on
stdout/stderr):

```
2026-10-23T09:28:26.984Z INFO dsh-mobile-spike: apply() start pid=56264 dshHome=...\research\dshtest node=v24.21.0 logFile=...\research\dshtest\logs\dsh-mobile-spike.log
2026-10-23T09:28:26.985Z INFO dsh-mobile-spike: MOUNTED at 2026-10-23T09:28:26.819Z
2026-10-23T09:28:27.844Z INFO dsh-mobile-spike: own listener READY on http://127.0.0.1:18099
2026-10-23T09:28:27.845Z INFO dsh-mobile-spike: apply() complete
2026-10-23T09:28:27.848Z INFO dsh-mobile-spike: registering exact route GET /spike on http://127.0.0.1:18080
2026-10-23T09:28:27.851Z INFO dsh-mobile-spike: registering exact route GET /spike/pair on http://127.0.0.1:18080
2026-10-23T09:28:27.852Z INFO dsh-mobile-spike: web routes registered
```

(`apply() complete` can appear a few milliseconds *before* the routes register,
because `ctx.inject(['webServer'], …)` mounts a child fiber asynchronously.
Give the product plugin its own readiness signal; do not assume routes exist the
instant `apply` resolves.)

### 4.1 Exact loopback route, with and without the DSH cookie

```powershell
& $node $probe get  "http://127.0.0.1:18080" "/spike" --body
& $node $probe anon "http://127.0.0.1:18080" "/spike" --body
```

Observed with the cookie:

```
### GET /spike (with cookie)
status: 200 OK
headers: {"content-type":"application/json; charset=utf-8","content-length":"311","cache-control":"no-store"}
body: {"ok":true,"from":"dsh-mobile-spike","authenticated":"owner","mountedAt":"2026-10-23T09:24:28.319Z","pid":53852,"dshHome":"...\\research\\dshtest","webServerOrigin":"http://127.0.0.1:18080","webServerPort":18080,"webServerProtocol":"http:","node":"v24.21.0"}
```

Observed without the cookie:

```
### GET /spike (without cookie)
status: 401 Unauthorized
headers: {"content-type":"application/json; charset=utf-8","content-length":"36","cache-control":"no-store"}
body: {"ok":false,"error":"auth-required"}
```

That 401 is produced by the plugin calling
`ctx.connection.requestRejection(req)` (the same admission DSH's own `/api`
uses), not by the web server — proof the route-owner authentication pattern
works.

### 4.2 Pairing-page pattern (`/m/pair` shape)

```powershell
& $node $probe get  "http://127.0.0.1:18080" "/spike/pair" --body
& $node $probe anon "http://127.0.0.1:18080" "/spike/pair" --body
```

Observed with cookie: `200 OK`, `text/html; charset=utf-8`, a self-contained
page that fetches `/spike` same-origin (the DSH cookie travels automatically).
Without cookie: `401` JSON. This is the cheap, verified replacement for a
client-bundle slot entry (see plugin-authoring.md §9).

### 4.3 The plugin's own out-of-band listener

```powershell
& $node $probe ping "http://127.0.0.1:18099" --body
```

Observed:

```
### GET /ping (own listener, no DSH auth)
status: 200 OK
headers: {"content-type":"application/json; charset=utf-8","content-length":"114","cache-control":"no-store"}
body: {"ok":true,"pong":true,"from":"dsh-mobile-spike","mountedAt":"2026-10-23T09:30:51.594Z","pid":2620,"uptimeSec":32}
```

No DSH auth applies here: this socket is the plugin's own `node:http` server,
the shape of the future LAN listener on :3081. In the product it must
authenticate device tokens itself.

### 4.4 Environment / service inventory (one request)

With the cookie, `/spike` also returns the facts a mobile plugin needs. Real
body from the final run (`probe get ... --body`, 1519 bytes):

```json
{
  "ok": true,
  "from": "dsh-mobile-spike",
  "authenticated": "owner",
  "mountedAt": "2026-10-23T09:31:51.823Z",
  "pid": 52172,
  "dshHome": "C:\\Users\\<user>\\Documents\\deepseek-harness\\harness\\research\\dshtest",
  "appVersion": "0.2.1-rc.2",
  "webServerOrigin": "http://127.0.0.1:18080",
  "webServerPort": 18080,
  "webServerProtocol": "http:",
  "node": "v24.21.0",
  "lanAddresses": [
    { "iface": "tun2", "address": "192.168.1.11" },
    { "iface": "Ethernet", "address": "192.168.1.10" }
  ],
  "services": {
    "webServer": true, "connection": true, "settings": true, "credentials": true,
    "storageDomain": true, "storage": true, "storageJson": false,
    "web": true, "agents": true, "sessionController": true, "sessions": true,
    "sessionQuery": true, "sessionPersistence": true, "approval": true,
    "userQuestions": true, "jobs": true, "workspaceRegistry": true,
    "attachments": true, "commands": true, "llm": true, "agentPresets": true,
    "skills": true, "tokenMeter": true, "profileContext": true
  },
  "profileContext": {
    "name": "web",
    "dir": "...\\research\\dshtest\\profiles\\web",
    "home": "...\\research\\dshtest",
    "patchPath": "...\\research\\dshtest\\profiles\\web\\cordis.patch.yml",
    "installAnchor": "...\\research\\app\\dsh\\node_modules\\@deepseek-ai\\dsh\\package.json",
    "cwd": "...\\harness",
    "startedBundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-mobile-spike"]
  }
}
```

This is how `appVersion`, LAN candidates and the service map in
`plugin-authoring.md` §8 were obtained.

---

## 5. Dispose / re-enable test (HMR, no restart)

The plugin owns a mount effect, two route effects and one own-listener effect.
Disabling the row in the **test profile's** patch file makes DSH HMR unload it.
Edit `research\dshtest\profiles\web\cordis.patch.yml` to:

```yaml
- id: dsh-mobile-spike
  name: dsh-mobile-spike
  disabled: true
```

Wait ~3 s, then:

```powershell
& $node $probe ping "http://127.0.0.1:18099"
& $node $probe get  "http://127.0.0.1:18080" "/spike"
Get-Content "$home\logs\dsh-mobile-spike.log" -Tail 6
```

Observed:

```
### GET /ping (own listener, no DSH auth)
fetch failed: fetch failed
cause: ECONNREFUSED

### GET /spike (with cookie)
status: 404 Not Found      # route removed; now the SPA fallback's answer
```

```
2026-10-23T09:24:54.571Z INFO dsh-mobile-spike: dispose -> closing own listener 127.0.0.1:18099
2026-10-23T09:24:54.573Z INFO dsh-mobile-spike: DISPOSED (mount effect)
2026-10-23T09:24:54.575Z INFO dsh-mobile-spike: own listener CLOSED on 127.0.0.1:18099
```

Restore the patch to `[]` and the plugin remounts live:

```
2026-10-23T09:25:12.611Z INFO dsh-mobile-spike: apply() start pid=53852 ...
2026-10-23T09:25:12.612Z INFO dsh-mobile-spike: MOUNTED at 2026-10-23T09:24:28.319Z
...
### GET /ping ... status: 200 OK   (uptime continues — same process)
### GET /spike ... status: 200 OK
```

**Observed HMR property worth remembering:** the module-level `MOUNTED_AT`
constant kept the **first** value after remount (`09:24:28.319Z`), i.e. Node
reuses the cached ESM module; HMR re-runs `apply` but does not reload the
JavaScript. Code changes need an instance (or Desktop) restart.

---

## 6. Restarting the instance (fresh token)

```powershell
# 1. stop (see §7)
# 2. optionally reset the fixture evidence log
Remove-Item "$home\logs\dsh-mobile-spike.log" -Force -ErrorAction SilentlyContinue
# 3. boot again exactly as in §1 and read the NEW token line
```

A second, fully clean instance can be obtained by removing `research\dshtest`
entirely and booting again (the launcher re-initializes the profile from the
shipped template, and the spike would then need reinstalling). That is safe
because the directory is inside `research\`, but it discards the installed
spike link and credentials — recreate them with §3.

---

## 7. Stop the instance

Find the PID listening on 18080 and stop only that process:

```powershell
$line = netstat -ano | Select-String "127.0.0.1:18080\s+.*LISTENING" | Select-Object -First 1
if ($line) {
  $pidNum = [int](($line.Line -split '\s+')[-1])
  Stop-Process -Id $pidNum -Force
}
netstat -ano | Select-String ":18080\s+.*LISTENING|:18099\s+.*LISTENING"
# (no output = both ports closed)
```

Never blanket-kill `node.exe` processes: the live Desktop app also runs Node
(Electron) and must keep running. Verify the live app is untouched:

```powershell
netstat -ano | Select-String ":59912\s+.*LISTENING"
#   TCP    127.0.0.1:59912        0.0.0.0:0              LISTENING       15520
```

---

## 8. Known environment artifacts (not product bugs)

- **pnpm store outside `research/`**: `dsh plugin` produced
  `harness\.pnpm-store\v11` at the workspace root (pnpm could not hard-link the
  default `%LOCALAPPDATA%\pnpm\store` into this project). It is a cache; it can
  be removed when no pnpm operation is running (`Remove-Item -Recurse -Force
  .pnpm-store` from the workspace root), but leaving it is harmless.
- **`spill-local` warning** (`EPERM: mkdtemp ... \Temp\dsh-d4XCtK\...`) appeared
  on two boots in this session when the harness sandbox's temp directory had
  been deleted externally. It disables only the spill-file plugin; the test
  instance and the spike are unaffected. Recreating the directory or rebooting
  the harness clears it.
- **No console log output** from a `dsh web` instance for plugin `ctx.logger`
  messages — the shipped web profile mounts no console exporter. Use the
  fixture's file log (`<DSH_HOME>\logs\dsh-mobile-spike.log`) as evidence.
- `research\tools\.probe-cookie.json` holds the last test session's cookie; it
  is disposable and expires with its 30-day Max-Age.

---

## 9. Reproduction checklist

1. `netstat` for 18080/18099 — free them by stopping any stale test instance.
2. Boot with `DSH_HOME=research\dshtest`, `--profile web --no-open --port 18080`.
3. Read the printed `dsh web: http://127.0.0.1:18080/?token=...` line.
4. `probe root` → 401; `probe pair <token>` → 303 + cookie; `probe get /` → 200.
5. Prepended pnpm shim + `dsh plugin --profile web add link:<spike>` → exit 0,
   bundle appended.
6. Wait for HMR; `probe ping` on 18099 → 200; `probe get /spike` → 200 JSON;
   `probe anon /spike` → 401; `probe get /spike/pair` → 200 HTML.
7. Toggle `disabled: true` in the test profile patch; `probe ping` → ECONNREFUSED,
   `/spike` → 404, log shows dispose lines. Restore `[]`; everything returns.
8. Stop the PID on 18080; confirm 59912 (live app) still listens.
