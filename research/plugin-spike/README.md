# dsh-mobile-spike

Minimal **real** DSH plugin used to verify the plugin contract of the installed
DeepSeek Harness (`@deepseek-ai/dsh` **0.2.1-rc.2**, Cordis **4.0.5**, Node
**v24.21.0**) before the product plugin `dsh-mobile` is written.

What it proves, all in `lib/index.js`:

| # | Claim | Mechanism |
|---|---|---|
| a | mounts in-process in the running DSH host | bundle package (`dsh.bundle.patch` + `cordis.patch.yml` insert row) whose entry exports `async apply(ctx, config)` |
| b | logs on mount | `ctx.logger('dsh-mobile-spike')` + a `ctx.logger.exporter()` writing `<DSH_HOME>/logs/dsh-mobile-spike.log` + mount/dispose effects |
| c | serves `GET /spike` JSON on the native DSH origin | `ctx.inject(['webServer'], webCtx => webCtx.effect(() => webCtx.webServer.register({ kind: 'exact', path: '/spike', handler })))` |
| c‑bis | serves a self-contained pairing-style page `GET /spike/pair` | same exact-route mechanism; the page `fetch('/spike')` same-origin, authenticated by the DSH browser cookie (the `/m/pair` pattern) |
| c‑auth | authenticates those routes as the DSH owner | `ctx.connection.requestRejection(req)` → `401` / `403`; `undefined` for the owner cookie |
| d | starts its own `node:http` listener | `http.createServer(...).listen(18099, '127.0.0.1')` — no DSH API involved (LAN-listener shape) |
| e | cleans up on dispose | `ctx.effect` disposers close the own listener; route registrations are effects; observed `ECONNREFUSED` + `DISPOSED` log |

Extra evidence in `GET /spike` (with the cookie): `appVersion` (from
`profileContext.installAnchor`), `lanAddresses` (`os.networkInterfaces()`),
mounted-service inventory, and the `profileContext` fields. Zero npm
dependencies: ESM + `node:http`, `node:fs`, `node:os`, `node:path`, `node:util`.

## Layout

```
dsh-mobile-spike/
├── package.json          # type:module, dsh.bundle.patch => ./cordis.patch.yml
├── cordis.patch.yml      # - insert: [{ id: dsh-mobile-spike, name: dsh-mobile-spike, config: {host, port} }]
├── lib/index.js          # apply(ctx, config) — the five numbered steps in its header
└── README.md
```

No `locale/` or `icon` on purpose: this is a disposable test fixture, and the
authoring checklist allows a fixture to omit display resources if that is
explained (`.../skills/cordis-plugin-development/references/host-plugin.md:55`).
A shipped `dsh-mobile` bundle must include `locale/en.json` `meta.title` /
`meta.description` and an `icon` export.

## Install into a TEST profile (never the desktop profile)

```powershell
$env:DSH_HOME = "C:\Users\<user>\Documents\deepseek-harness\harness\research\dshtest"
$env:PATH     = "C:\Users\<user>\Documents\deepseek-harness\harness\research\tools;" + $env:PATH
& "C:\Users\<user>\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" `
  "C:\Users\<user>\Documents\deepseek-harness\harness\research\app\dsh\node_modules\@deepseek-ai\dsh\lib\bin.js" `
  plugin --profile web add "link:C:\Users\<user>\Documents\deepseek-harness\harness\research\plugin-spike"
```

`dsh plugin` forwards to pnpm in the profile directory and, after success, the
plugin manager appends the bundle to `package.json` →
`dsh.profile.bundles`. The `web` template's HMR mounts the plugin in a running
instance without restart.

## Verify

```powershell
$probe = "...\research\tools\probe.mjs"   # dependency-free fetch probe
# boot (see ../test-instance.md), then use the printed token:
& $node $probe pair "http://127.0.0.1:18080" "<TOKEN>"
& $node $probe get  "http://127.0.0.1:18080" "/spike" --body   # 200 JSON
& $node $probe anon "http://127.0.0.1:18080" "/spike"          # 401 JSON
& $node $probe get  "http://127.0.0.1:18080" "/spike/pair"     # 200 HTML
& $node $probe ping "http://127.0.0.1:18099"                   # 200 JSON, no DSH auth
Get-Content "$env:DSH_HOME\logs\dsh-mobile-spike.log"          # mount/dispose evidence
```

Full command-by-command evidence: `../test-instance.md`.
Authoring contract behind every mechanism: `../plugin-authoring.md`.
