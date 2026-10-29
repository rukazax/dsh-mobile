# DSH plugin authoring — version-specific reference (DSH 0.2.1-rc.2)

Everything below was checked against the **shipped, installed** DeepSeek Harness
app extracted at `research/app/dsh` (the extraction of
`C:\Users\<user>\AppData\Local\Programs\DeepSeek Harness\resources\app.asar`),
and most claims were re-verified by running the `dsh-mobile-spike` fixture in an
isolated test instance (`research/dshtest`). Citations are
`path:line` against this workspace; observed output is quoted verbatim.

| Fact | Value | Source |
|---|---|---|
| DSH runtime version | **0.2.1-rc.2** | `research/app/dsh/package.json`; `getDshRuntimeVersion()` `research/app/dsh/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js:266-275`; also returned by the spike as `"appVersion":"0.2.1-rc.2"` |
| Cordis | **4.0.5** | `research/app/dsh/node_modules/@deepseek-ai/cordis/package.json` |
| Schemastery | **3.18.5** | `research/app/dsh/node_modules/@deepseek-ai/schemastery/package.json` |
| Bundled Node | **v24.21.0** | `node --version`; spike `/spike` body |
| Desktop profile | `C:\Users\<user>\.dsh\profiles\desktop` (Electron-owned) | `research/app/dsh/node_modules/@deepseek-ai/dsh/README.md:20` |
| Web profile root (test) | `research/dshtest/profiles/web` | this run |

> The shipped packages in this extraction have **no `lib/types/**/*.d.ts`** files
> (only `lib/*.js`, even though package manifests list `.d.ts` under `files`).
> The built JS carries the JSDoc, so citations below use READMEs + `lib/index.js`.
> Where the skill's `references/host-plugin.md` says "installed packages ship
> `lib/types/**/*.d.ts`", that is **not true for this asar extraction** — use
> README + `lib/index.js` instead.

---

## 1. Plugin package layout

### 1.1 A "bundle" is a package that declares `dsh.bundle.patch`

> "A bundle is a package whose `package.json` declares `dsh.bundle.patch`; the
> YAML patch inserts plugin entries." — `.../dsh-agent-preset/skills/cordis-plugin-development/references/host-plugin.md:3`

For a **Host-only** plugin (what `dsh-mobile` needs) the minimum is:

```json
{
  "name": "dsh-mobile-spike",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./lib/index.js",
    "./cordis.patch.yml": "./cordis.patch.yml",
    "./package.json": "./package.json"
  },
  "files": ["lib", "cordis.patch.yml"],
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
}
```

- `type: "module"` + one ESM entry (`main` or `exports."."`) — this is what both
  real third-party plugins do (`C:\Users\<user>\.dsh\profiles\desktop\node_modules\dsh-codex-connect\package.json`
  and `...\@goodandready\dsh-russian-lang\package.json`).
- `dsh.bundle.patch` may be **one path or an ordered list** of patch files
  (`.../dsh-app-boot/README.md:50`); the shipped `dsh-web-app` lists five
  (`.../dsh-web-app/package.json` → `dsh.bundle.patch`).
- The reference template for a Host-only plugin is exactly this shape
  (`.../skills/cordis-plugin-development/references/host-plugin.md:7-27`).
- Display metadata (`locale/*.json` with `meta.title`/`meta.description`, an
  `icon` export) and `dsh.client` are **optional** for a Host-only plugin; the
  checklist is `host-plugin.md:29-55`. A disposable test fixture may omit them
  ("A disposable test fixture or an explicitly requested metadata-free package
  may omit resources, but explain each omission" — `host-plugin.md:55`).
  `dsh-mobile-spike` omits them deliberately for that reason.

### 1.2 `cordis.patch.yml` row shape

The patch is a top-level YAML **array of loader patch entries**. The two forms
that matter:

```yaml
# insert a new row (this is how a bundle adds its own plugin)
- insert:
    - id: dsh-mobile-spike          # stable row id used by later layers/HMR
      name: dsh-mobile-spike        # package name resolvable from the profile
      config:                        # optional; replaces the whole config of the row
        host: 127.0.0.1
        port: 18099

# override / disable an existing row by id (e.g. a profile-layer tweak)
- id: ui-settings
  config:
    enabled: true
- id: some-row
  disabled: true
```

Facts:
- A patch replaces the targeted row's **whole** `config`; restate every key you
  keep — `.../dsh-app-boot/README.md:61` and the header comment of
  `.../dsh-web-app/cordis.patch.yml`.
- `!!js` expressions are allowed and are evaluated at boot
  (`dsh-app-boot/README.md:61`; the web bundle uses
  `host: !!js ctx.webStartup.host ?? '127.0.0.1'` in
  `.../dsh-web-app/cordis.patch.yml`).
- Inserted plugin names may be **absolute filesystem paths, file URLs, or
  package specifiers** (`dsh-app-boot/README.md:65`).
- Patch loaders convert patch-relative `./`/`../` paths to file URLs inside
  `insert` rows (`dsh-app-boot/README.md:65`).
- Order of layers (see §2) is why a user's `cordis.patch.yml` can override a
  bundle's row: `.../dsh/README.md:41-44`.

### 1.3 Plugin entry export shapes (Cordis)

`host-plugin.md:57-64` names exactly two accepted forms, **do not mix them**:

```js
// Form A — function plugin (used by dsh-mobile-spike)
export function apply(ctx, config) { /* ... */ }
export const inject = ['webServer']        // optional service dependencies
export const Config = z.object({ /* ... */ })  // optional schemastery schema
```

```js
// Form B — a Cordis Service class as the default export
import { Service } from '@deepseek-ai/cordis'
export default class MyService extends Service {
  constructor(ctx, config) { super(ctx, 'myService') }
}
```

Real examples in this version:
- `dsh-codex-connect/lib/index.js:13106-13108` exports `name = "llm-openai-codex"`,
  `inject = ["llm"]`, and a `Config` at `:13120`; its `apply` is defined at
  `:13187` and exported at the end of the file.
- `@goodandready/dsh-russian-lang/lib/index.js:60-75` exports `Config` and
  `:104` exports `apply(ctx, config)`.
- Cordis's own contract: `ctx.plugin()` starts a plugin, `inject` names required
  services, effects/listeners/services are removed on fiber disposal —
  `.../cordis/README.md:33-67`.
- An async `apply()` is supported; a rejected promise is an activation failure
  with well-defined semantics (`dsh-app-boot/README.md:98-111`, row
  "Asynchronous `apply()` throws": optional rows warn, required rows stop startup).

### 1.4 Config schema (Schemastery)

- Declare `export const Config = Schema.object({...})` (`z`/`Schema` imported
  from `@deepseek-ai/schemastery`; real plugins do `import z from
  "@deepseek-ai/schemastery"` — `dsh-codex-connect/lib/index.js:6`).
- The Loader validates the row's `config` against `Config` at activation; query
  an installed plugin's JSON Schema with `Config.listConfigs` rather than
  guessing (`host-plugin.md:64`).
- Schemastery basics: `Schema.object/string/number/boolean/array/dict/union`,
  `.required()`, `.default()`, `.description()`, `.transform()`, shorthand
  (`.../schemastery/README.md:42-50`, `:239-268`, `:285-306`).
- **`.volatile()`** fields arrive in `config` as references read with `.get()`,
  not as plain values — `.../schemastery/README.md:391-393`. DSH's own
  plugins unwrap them (`plainConfig` in `dsh-russian-lang/lib/index.js:51-58`)
  and the Settings UI only edits volatile fields
  (`.../dsh-settings/README.md:33`).
- **A Config export is optional.** Without it the Loader passes the row's raw
  config object to `apply(ctx, config)`. `dsh-mobile-spike` deliberately has no
  `Config` (zero dependencies, no `@deepseek-ai/schemastery` import) and reads
  `config.host`/`config.port` directly — verified by the running instance
  (`/spike` shows the row's `port: 18099` took effect).
- For the product plugin, export `Config` so users can tune
  `lanPort`, `host`, `pairingTtlSec`, etc. from `cordis.patch.yml`; that is also
  the only supported settings surface (see §8.3).

### 1.5 Compatibility: `engines.dsh`, peer deps, `compatibility.json`

- Before a profile imports a plugin, DSH compares its declared requirement with
  `getDshRuntimeVersion()` (= `0.2.1-rc.2` here):
  - if `engines.dsh` is present, that range alone decides and peers are ignored;
  - otherwise **every** `@deepseek-ai/dsh` / `@deepseek-ai/dsh-*` range in
    `peerDependencies` must match;
  - a manifest with neither imposes no constraint.
  — `.../dsh-app-boot/README.md:52`.
- `compatibility.json` is **not** a plugin-package file. It is the **profile's**
  exact-version exemption file (`$DSH_HOME/profiles/<name>/compatibility.json`,
  `{ "package@version": ["dsh-version", ...] }`) for plugins that refuse to load
  (`dsh-app-boot/README.md:56`; `.../dsh-plugin-manager/README.md:67+`). The
  installed `dsh-codex-connect` ships a `compatibility.json` used by its own
  packaging/CI, but the runtime consumer is the profile file.
- A plugin with neither `engines.dsh` nor DSH peer deps installs without any
  version gate — that is why `dsh-mobile-spike` (no engines/peers) installed
  cleanly on 0.2.1-rc.2. For the real `dsh-mobile`, declare
  `"engines": { "dsh": "^0.2.1-rc.2" }` or matching peers once the target
  version is frozen; remember **installation and startup both enforce it**.

### 1.6 Verified minimal package (the spike)

`research/plugin-spike/`:

```
dsh-mobile-spike/
├── package.json          # dsh.bundle.patch -> ./cordis.patch.yml
├── cordis.patch.yml      # - insert: [{ id: dsh-mobile-spike, name: dsh-mobile-spike, config: {host, port} }]
└── lib/index.js          # export async function apply(ctx, config)
```

It mounts, logs, registers exact routes, starts its own listener and cleans up —
see `research/plugin-authoring.md` §5-§7 and `research/test-instance.md` for the
observed run. A product plugin has the same shape plus `Config`, `locale/*.json`
and optionally `client.js`.

---

## 2. How profile bundles compose

A profile is a directory `$DSH_HOME/profiles/<name>` with:

- `package.json` — dependencies plus the ordered bundle list:

  ```json
  {
    "name": "dsh-profile-web",
    "private": true,
    "dependencies": { "dsh-mobile-spike": "link:C:/.../research/plugin-spike" },
    "dsh": { "profile": { "bundles": [
      "@deepseek-ai/dsh-base",
      "@deepseek-ai/dsh-web-app",
      "dsh-mobile-spike"
    ] } }
  }
  ```

- `cordis.patch.yml` — the user's own patch layer (an empty profile keeps `[]`).
- `cordis.yml` — the composed root config file; documentation is explicit that
  you edit `cordis.patch.yml`, not this file
  (`research/dshtest/profiles/web/cordis.yml`; `.../dsh/README.md:37-48`).

The tree composes over an empty root, in this order
(`.../dsh/README.md:41-44`):

1. each bundle's patch, in `dsh.profile.bundles` order;
2. the profile's `cordis.patch.yml`;
3. `$DSH_HOME/cordis.patch.yml` (home-level, therefore outranks the profile);
4. `--patch` overlay files, in argv order.

Bundle resolution: named bundles resolve **from the dsh installation first**
(`dsh-base`, `dsh-web-app`, …), then from the profile's `node_modules`, where
pnpm installs out-of-tree plugins (`.../dsh/README.md:46`). Third-party plugin
packages are therefore plain dependencies of the profile.

Shipped templates (auto-initialized on first use):
`web = ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"]`
(`.../dsh-app-boot/lib/index.js:551-557`) — exactly what the isolated test
profile had before the spike was added.

**HMR:** the `web` template enables live configuration reload; `dsh-hmr` watches
the profile manifest and both patch files and recomposes through one serialized
reload (`dsh-app-boot/README.md:63`; row `hmr` in
`.../dsh-base/cordis.patch.yml` is enabled whenever `ctx.get('profileContext')`
exists). This was verified live: adding a bundle to the profile while the
instance was running mounted the plugin **without restart**, and toggling the
row to `disabled: true` unloaded it (§7.3, `research/test-instance.md`).
Without HMR, changes require a restart (`.../dsh-plugin-manager/README.md:14`).

**Inspect before booting:**
- `dsh --profile web --dump-config` prints the composed entry tree with source
  layers (`.../dsh/README.md:48`);
- `dsh --profile web --dump-config-schema` prints JSON Schema for entries and
  patches; it imports plugin modules, so only run it on trusted profiles
  (`.../dsh/README.md:48`, `dsh-app-boot/README.md:77-81`).

---

## 3. Installing a local-path plugin (test profile only)

### 3.1 The supported command

```sh
dsh plugin --profile <name> <pnpm args...>
```

> "`dsh plugin --profile <name> <pnpm args>` — Manage a profile's plugins by
> forwarding to pnpm in the profile directory." — `.../dsh/README.md:18`

For a local directory, the argument is a path spec; `link:` keeps a symlink so
source edits need no reinstall (and is what the Plugin Manager uses for
development installs — `.../dsh-plugin-manager/README.md:52`).

What happens internally (verified by reading the built CLI and by running it):

1. `runPluginCommand()` initializes the profile from its shipped template if
   missing, takes the profile write lock and forwards the args to pnpm
   (`.../dsh-plugin-manager/lib/types/operations.js:591-601`).
2. Before pnpm runs, a named `add`/`install` spec is checked against the DSH
   runtime: a **path** spec is read from its own `package.json`
   (`.../dsh-plugin-manager/lib/types/operations.js:152-179`,
   `.../dsh-plugin-manager/README.md:67+`).
3. pnpm runs in the profile directory with the **CLI's environment** (inherited
   PATH; service calls use a scrubbed env) —
   `.../dsh-plugin-manager/lib/types/operations.js:330`.
4. After a successful run, `reconcile()` appends every newly installed package
   that declares `dsh.bundle.patch` to `package.json.dsh.profile.bundles` — no
   manual manifest edit is needed (`.../dsh-plugin-manager/lib/types/operations.js:95-124`).
   Packages without `dsh.bundle` produce the warning
   `"... declares no dsh.bundle — installed as a plain dependency, not a profile layer"`.

⚠ The DSH CLI itself resolves the executable name `pnpm` through `PATH`. On this
machine only the bundled pnpm exists
(`C:\Users\<user>\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm`),
so `research/tools/pnpm.cmd` is a tiny shim; prepend that directory to `PATH`.

### 3.2 Exact test-profile installation (what was run)

```powershell
$env:DSH_HOME = "C:\Users\<user>\Documents\deepseek-harness\harness\research\dshtest"
$env:PATH      = "C:\Users\<user>\Documents\deepseek-harness\harness\research\tools;" + $env:PATH
& "C:\Users\<user>\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" `
  "C:\Users\<user>\Documents\deepseek-harness\harness\research\app\dsh\node_modules\@deepseek-ai\dsh\lib\bin.js" `
  plugin --profile web add "link:C:\Users\<user>\Documents\deepseek-harness\harness\research\plugin-spike"
```

Observed (real output):

```
[WARN] The store at C:\Users\<user>\AppData\Local\pnpm\store\v11 is not used because
packages cannot be hard linked from it into this project. Using the store at
C:\Users\<user>\Documents\deepseek-harness\harness\.pnpm-store\v11 instead. ...
Already up to date
dependencies:
+ dsh-mobile-spike 0.1.0 <- ..\..\..\plugin-spike
Done in 764ms using pnpm v11.28.5
=== exit code: 0 ===
```

Resulting `research/dshtest/profiles/web/package.json` (verbatim):

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

The only expected side effect outside `research/` is pnpm's
`<workspace>\.pnpm-store\v11` (see test-instance.md §7). The install itself is
in `research/dshtest`.

### 3.3 Installing into the **desktop** profile safely (do not do it yet)

The desktop profile is special:

- `dsh` boot/config-dump **rejects** the `desktop` profile name; the npm CLI also
  rejects plugin-management requests for it. Only the **Desktop-installed
  command** may manage that profile
  (`.../dsh/README.md:20`; `.../dsh/lib/plugin-BiveYA7h.js:11`).
- Desktop package operations are **owned by the Desktop shell** —
  `.../dsh-plugin-manager/README.md:146`.
- The Desktop-installed command is
  `...\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd`, which runs Electron
  as Node against `app.asar\dsh\node_modules\@deepseek-ai\dsh-desktop-host\lib\cli.js`
  with `ELECTRON_RUN_AS_NODE=1` (read from the installed file; 243 bytes).
- `dsh plugin --profile desktop` refuses to run while the app's profile is
  missing and expects it to be initialized once by the app:
  *"Open DeepSeek Harness Desktop once to initialize its profile, then fully
  quit it before running dsh plugin --profile desktop."* —
  `.../dsh/lib/plugin-BiveYA7h.js:10-12`.

Safe order for the product release (not exercised here — out of isolation scope):

1. Fully quit DeepSeek Harness (tray → Quit; verify port `59912` is gone).
2. From a normal shell, use the **Desktop command** (not the npm `dsh`):
   `& "...\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop add "link:C:\...\packages\dsh-mobile"`
   (or the final registry spec).
3. Relaunch the app. Alternatively install from the app's **Plugins** page,
   which calls the same `plugin_manager.install_bundle` operation and is the
   user-facing supported surface (`dsh-plugin-manager/README.md:31`).
4. **Never** hand-edit `C:\Users\<user>\.dsh\profiles\desktop\package.json` or
   `cordis.patch.yml`; the app owns that directory.

**Restart caveat:** with HMR, a newly selected bundle can mount live, but
*replacing* installed JavaScript requires a restart: "replacing an installed
package requires restart to load a fresh JavaScript module generation"
(`host-plugin.md:70`; `dsh-plugin-manager/README.md:100`). We also observed that
Node keeps the **module instance** across an HMR unload/remount of an unchanged
linked package: after `disabled: true` → `[]` the plugin's `apply` ran again but
its module-level `MOUNTED_AT` constant kept the first boot's timestamp
(`/spike` body + log lines in test-instance.md §6). Therefore `dsh-mobile` must
not keep state in module-level constants that must reset on reload, and shipping
a code change to an installed plugin needs a Desktop restart (or a fresh link
generation).

---

## 4. Entry API details that matter for `dsh-mobile`

### 4.1 `ctx`, `inject`, `ctx.get`, `ctx.inject`

- `apply(ctx, config)` receives the plugin's **own fiber context**. Its logger,
  effects and child fibers die with the plugin.
- Optional service dependencies belong in the exported `inject` array (or a
  `ctx.inject([...], cb)` child) so the plugin stays inactive-but-waiting in
  compositions without them instead of throwing
  (`.../skills/.../references/practices.md:20`).
- `ctx.get('name')` is a non-blocking lookup (returns `undefined` when absent);
  our spike uses it for `connection`, `profileContext` and the service map.
- `ctx.inject(['webServer'], (webCtx) => { ... })` creates a child fiber that
  runs when the service exists and owns the registrations made in it. It does
  **not** block `apply`: our log shows `apply() complete` 2 ms *before*
  `registering exact route GET /spike`, so a route may appear a tick after the
  plugin's own readiness signal. `dsh-mobile` should register its routes first
  and treat the pair endpoint as ready when both listeners report bound.

### 4.2 Effects and disposal

- `ctx.effect(callback, label)` runs `callback` immediately and treats its
  returned function (or promise of a function, or generator of functions) as
  the disposer (`.../cordis/lib/index.js:1169-1246`; `cordis/README.md:65-67`).
- Disposers run on plugin unload, profile recomposition, `--patch` reload and
  process shutdown. "Registrations are effects owned by a context" —
  `practices.md:8`.
- Pattern used by the spike (verified):

  ```js
  ctx.effect(() => {
    const server = createServer(handler)
    server.listen(port, host)
    return async () => { await new Promise(r => server.close(r)) }
  }, 'dsh-mobile: LAN listener')
  ```

- Route registration is itself an effect-returning call:
  `webCtx.effect(() => webCtx.webServer.register({...}), label)`
  (`dsh-host-webserver/lib/index.js:326-333` returns the disposer).
- Disposal order is not a guarantee to rely on for log output: our fixture's
  logger exporter was torn down in the same disposal pass, so the last
  `log.info("own listener CLOSED")` line was dropped; the fixture writes that
  final evidence line directly to its log file. **Do not assume a logger write
  in a disposer is observable.**

### 4.3 Logging (important operational gotcha)

- Cordis's built-in logger only **buffers** messages (last 1000 per process);
  the stock **web profile mounts no console exporter** —
  `.../cordis/lib/index.js:582-605`. Mounting the spike produced *no* log line
  on stdout/stderr; we had to attach `ctx.logger.exporter(...)` and write to a
  file (`<DSH_HOME>/logs/dsh-mobile-spike.log`).
- For `dsh-mobile`, attach a small file exporter (or use `ctx.logger` only for
  in-process diagnostics) and log: host origin, LAN bind, pairing issued,
  device token accepted/rejected, SSE connect/disconnect, dispose. That is the
  only support evidence available on a user's machine.
- Named loggers: `ctx.logger('dsh-mobile')`; the exporter receives
  `{ sn, ts, type, level, name, args }` (`cordis/lib/index.js:454-487`).

### 4.4 Service class (for a stateful plugin)

For `dsh-mobile`, a default-exported `Service` subclass is the better shape when
you want `ctx.mobile` to be injectable and to hold device/pairing state:

```js
import { Service } from '@deepseek-ai/cordis'

export default class MobileService extends Service {
  constructor(ctx, config) { super(ctx, 'mobile'); /* ... */ }
}
```

The `WebServer` service itself is `class WebServer extends Service` with
`super(ctx, 'webServer')` and an async `[Service.init]()` that listens
(`dsh-host-webserver/lib/index.js:249-291`, `:377-378`); `ctx.effect` inside a
service is the documented lifecycle tool (`cordis/README.md:33-56`). A function
plugin is fine for the proof; the product plugin should use a Service so
`ctx.mobile` can be read by other plugins and the pairing/device state has one
owner.

---

## 5. HTTP routes on `ctx.webServer`

### 5.1 Contract

```js
const dispose = ctx.webServer.register({
  kind: 'exact',            // or 'prefix'
  path: '/spike',           // exact path, or a prefix root for 'prefix'
  handler: (req, res) => { /* owns the raw node response */ },
})
```

- `register(route)` adds a named `exact` or `prefix` route and returns a
  disposer; a duplicate `(kind, path)` **throws**
  (`dsh-host-webserver/lib/index.js:326-333`,
  `.../dsh-host-webserver/README.md:59-61`).
- Matching is: exact table first, then longest prefix, then the one fallback
  (`lib/index.js:495-504`, README:61).
- The handler is a raw `node:http` `(req, res)` pair and **owns the complete
  response lifecycle** — no return value, no framework. A throwing handler is
  answered 400 (or the socket is destroyed if headers are out) and logged as a
  warning; it never exits the process (`README.md:69-71`).
- `registerFallback(handler)` claims the single fallback seat; a second
  registration throws. In the shipped Web composition the fallback is the SPA
  dist server (`README.md:63-65`;
  `dsh-host-frontend-static/lib/index.js:87`).
- Static assets under the Web origin are public; the index/SPA root is
  authenticated by `ctx.connection.authorizeIndex`
  (`dsh-client-connection/README.md:41`).

Verified: our exact route answers while the SPA fallback owns everything else;
after the plugin was unloaded, `GET /spike` fell through to the fallback and
returned `404` even with `Accept: text/html` (the dist server does not claim
arbitrary paths).

### 5.2 Who authenticates? The route owner.

`ctx.webServer` is a **plain route registry with no authentication**:

> "No server-wide authentication or origin policy — route owners such as
> `dsh-client-connection` enforce their own request policy."
> — `.../dsh-host-webserver/README.md:130`

Routes outside `/api` get **no automatic admission**. Our spike calls the
Connection service itself, which is exactly what `dsh-codex-connect` does for
its plugin-owned routes (`dsh-codex-connect/lib/index.js:4429-4445`,
`:4929-4951`).

### 5.3 Owner admission (`ctx.connection`)

```js
const connection = ctx.get('connection')          // mounted by the web/desktop bundles
const status = connection.requestRejection(req)   // undefined | 401 | 403
// or, if you need the Peer object:
const admission = connection.admit(req)           // { peer } | { rejection: 401|403 }
```

- `admit(request)` "checks trust and browser or API authentication and returns
  the credential's live Peer or a rejection"
  (`dsh-client-connection/README.md:49`); implementation:
  `dsh-client-connection/lib/index.js:742-750`.
- `requestRejection()` applies the same Host/Origin fence first and returns only
  the status (`lib/index.js:736-740`).
- Semantics: **403** = untrusted Host/Origin (DNS-rebinding/cross-site fence);
  **401** = trusted but not authenticated. Exact routes answer 403 to a
  non-owner Peer (`README.md:49`).
- The trust fence accepts loopback hosts, the listener's own bind IP, and
  `trustedHosts`; an attached `Origin` must match
  (`dsh-client-connection/README.md:47`).
- `connection` is optional in a composition: fail closed (503) when absent.

**The browser cookie flow, observed on the test instance:**

1. `GET /` without a cookie →
   `401 Unauthorized`, `content-type: text/plain`, body
   `dsh web authentication required; reopen the URL printed by dsh web.`
2. `GET /?token=<launch token>` (the exact tokenized URL `dsh web:` prints) →
   `303 See Other`, `location: ./`, one `Set-Cookie`:

   ```
   dsh-auth-<base64url(authority)>=v1.<base64url(payload)>.<hmac>
   ; Max-Age=2592000; Path=/; Expires=...; HttpOnly; SameSite=Strict
   ```

   The cookie name embeds the normalized authority (`127.0.0.1:18080`) and the
   payload is signed; docs describe it as an authority-bound signed cookie
   (`dsh-client-connection/README.md:41-45`).
3. `GET /` with that cookie → `200 text/html` (37 KB SPA index).
4. `GET /spike` with that cookie → `200 application/json` from our handler;
   without it → `401` from our handler (proof the route owner's admission
   works).

The token is accepted **only at the root exchange** (`GET /`, and `/connect`
for API callers); the HTTP carrier accepts "no Authorization-header token"
(`dsh-client-connection/README.md:41`). A same-origin `fetch()` from the
pairing page automatically carries the cookie — that is the basis of the
`/m/pair` + `/m/pair.json` design.

### 5.4 Alternative: exact Fetch routes

If you want a `Response`-returning API instead of raw `req/res`:

```js
ctx.connection.fetch.register({
  path: '/m/pair.json',
  methods: ['GET'],
  requestBody: 'buffered',
  fetch: (request) => new Response(JSON.stringify({...}), { headers: {...} }),
})
```

`ctx.connection.fetch` is an exact Fetch-route registry scoped to the reading
context; it is served through the `/api` bridge, and non-owner Peers get 403
automatically (`dsh-client-connection/lib/index.js:820-854`,
`README.md:49`). Trade-off: it rides the Typert/HTTP bridge and request-body
policy, which is more machinery than a plain route needs. For `/m/pair` the raw
`ctx.webServer` route is the simpler, proven path.

---

## 6. A plugin starting its own listener (the LAN port)

### 6.1 No DSH restriction

Installed Host plugins run **in-process and outside the workspace sandbox**:

> "Profile changes persist across sessions, and installed Host code executes
> in-process outside the workspace sandbox."
> — `.../dsh-plugin-manager/README.md:31`

The `dsh-host-webserver` wildcard-bind rejection applies only to **that**
service's `host` config (`.../dsh-host-webserver/README.md:29-35`), not to a
plugin's own `node:http` server. `dsh-mobile` may therefore bind its own LAN
address/port (default 3081) and serves both PWA and mobile API from it — this
is the architecture the Lead chose, and nothing in DSH prevents it.

### 6.2 Lifecycle pattern (verified)

```js
import { createServer } from 'node:http'

const server = createServer((req, res) => { /* ... */ })

const ready = new Promise((resolve, reject) => {
  server.once('error', reject)
  server.listen(port, host, () => { server.off('error', reject); resolve() })
})

ctx.effect(() => () => new Promise((resolve) => server.close(() => resolve())),
           'dsh-mobile: LAN listener')

await ready   // inside async apply(): a bind failure fails activation
```

- Own the socket; register the disposer as an effect.
- Await the bind inside `apply` so a port conflict is an activation failure the
  user can see, instead of async noise (log/report the exact `EADDRINUSE`).
- Node's `server.close()` waits for open connections; also track SSE/WebSocket
  sockets and destroy them on dispose (the shipped `WebServer` does the same for
  upgraded sockets — `dsh-host-webserver/lib/index.js:492`, `README.md:104-113`).
  A long-lived SSE stream must be closed explicitly or `close()` never callback.
- Keep state out of module-level constants (see §3.3 HMR note).

### 6.3 Observed evidence

`dsh-mobile-spike` bound `127.0.0.1:18099`, answered `GET /ping` with

```json
{"ok":true,"pong":true,"from":"dsh-mobile-spike","mountedAt":"...","pid":2620,"uptimeSec":32}
```

and on `disabled: true` + HMR unload:

```
2026-10-23T09:24:54.571Z INFO dsh-mobile-spike: dispose -> closing own listener 127.0.0.1:18099
2026-10-23T09:24:54.575Z INFO dsh-mobile-spike: own listener CLOSED on 127.0.0.1:18099
```

`GET http://127.0.0.1:18099/ping` → `fetch failed: cause: ECONNREFUSED`, and the
web route fell back to `404`. Re-enabling the row remounted everything live.
Full transcript: `research/test-instance.md`.

### 6.4 Security is the plugin's job on its own listener

DSH's browser-trust fence and cookie auth do **not** cover a plugin's own
socket. `dsh-mobile` must implement, on port 3081:

- device-token authentication (`Authorization: Bearer …`, hashes persisted),
- the pairing code path with TTL and attempt limit,
- rate limiting / lockout (mobile-api.md §2 asks for 429 after 10 failures),
- TLS if the PWA path is required (§11.1).

---

## 7. Persisting small state (device tokens, pairing codes)

Three supported mechanisms; pick one, don't invent another.

### 7.1 `ctx.credentials` records — recommended for secrets/tokens

`ctx.credentials` is mounted in the web/desktop compositions (verified `true`).
A plugin addresses records by `<scope>/<id>` (its registered name + an id):

```js
import { credentialKey } from '@deepseek-ai/dsh-credentials'

const key = credentialKey('dsh-mobile', 'devices')
const hit = await ctx.credentials.readRecord(key)          // CredentialRecord | undefined
await ctx.credentials.modifyRecord(key, async (current) => ({
  kind: 'grant',
  payload: { devices: { ... } },                            // arbitrary JSON
}))
await ctx.credentials.deleteRecord(key)
```

- Durable, exclusive read-modify-write, cross-process locking, no file handling
  — `.../dsh-credentials/README.md:63-81`.
- `modifyRecord` is the only write path; returning `undefined` leaves it
  unchanged; `listRecords()` never returns values
  (`.../dsh-credentials/README.md:129-138`).
- Store **SHA-256 hashes** of device tokens plus device metadata, exactly as
  mobile-api.md §2 specifies — never raw tokens at rest.
- The local provider persists under `$DSH_HOME/.credentials.yaml`. The
  service is optional in a composition: inject/check it, and fail over to §7.3.

### 7.2 `ctx.storageDomain` — typed KV records

The base bundle mounts the storage stack (`ctx.storageDomain` verified `true`).
Domains are declared with `defineDomain({ name, version, tables })` using **zod**
schemas and opened via `ctx.storageDomain.open(spec)`; reads are synchronous,
writes durable, `domain/changed` events fire — `.../dsh-storage-domain/README.md:34-58`.
The JSON backend stores inspectable files under a configured `root`
(`.../dsh-storage-json/README.md:36-52`). Cost: a zod dependency and a domain
schema/version lifecycle; overkill for a handful of device records unless you
want the change events or the typed tables.

### 7.3 Plain JSON under `$DSH_HOME` — zero dependency

`resolveDshHome()` gives the effective home (`$DSH_HOME` or `~/.dsh`; explicit
config wins, blank env is ignored) and `dshHomePath('dsh-mobile','devices.json')`
joins a child path — `.../dsh-home-paths/README.md:16-30`. It is a **library**
dependency (`@deepseek-ai/dsh-home-paths`), so either declare the peer or
re-implement the 5-line resolution (`process.env.DSH_HOME ?? ~/.dsh`) as the
spike does.

Write with `writeFileAtomic()` (and `withFileLock()` if two processes could
write) from `@deepseek-ai/dsh-atomic-write` — atomic temp-file + rename, which
is what the shipped plugins use for exactly this (`dsh-codex-connect/lib/index.js:18`,
`:4930-4932` for the `$DSH_HOME`-adjacent state file). Recommended layout:

```
<DSH_HOME>\dsh-mobile\devices.json      # { version:1, devices:[{id,name,hash,addedAt}] }
<DSH_HOME>\dsh-mobile\pairing.json      # transient code state (or keep in memory)
```

Keep pairing codes in memory (they are short-TTL and process-local), persist only
the device registry.

### 7.4 What NOT to do

Do **not** append session events for plugin state: readers accept unknown stored
events only with `ignorable: true`, and `Session.append()` cannot set it; use the
session log only for model-visible facts and a storage service for plugin-owned
data — `practices.md:21`.

---

## 8. Reading environment facts (LAN IP, version, settings)

### 8.1 LAN IP

**No DSH service exposes network interfaces.** We grepped every `@deepseek-ai/*`
built package for `os.networkInterfaces` / `networkInterfaces` — zero matches.
Use Node directly:

```js
import { networkInterfaces } from 'node:os'

const candidates = Object.entries(networkInterfaces()).flatMap(([iface, list]) =>
  (list ?? []).filter(a => a.family === 'IPv4' && !a.internal)
              .map(a => ({ iface, address: a.address })))
```

Observed on this machine inside the plugin:
`[{"iface":"tun2","address":"192.168.1.11"},{"iface":"Ethernet","address":"192.168.1.10"}]`
— i.e. a VPN interface and the real LAN. The pairing page must show **all**
candidates (and let the phone pick / let the user copy one); never guess a
single "the LAN IP". Keep the listener on the concrete address the user picks
(or `0.0.0.0` only if you accept that risk — DSH's own server refuses wildcard
binds, a plugin may choose otherwise, but the mobile API's auth then protects
every interface).

### 8.2 Effective DSH version

- Canonical helper: `getDshRuntimeVersion()` from `@deepseek-ai/dsh-app-boot` —
  reads `@deepseek-ai/dsh-app-boot/package.json` in both source and bundled
  installations (`.../dsh-app-boot/lib/index.js:266-275`,
  `README.md:131`). In this install it returns `0.2.1-rc.2`.
- Dependency-free equivalent proven in the spike: read
  `ctx.get('profileContext').installAnchor` (a path to
  `.../@deepseek-ai/dsh/package.json`) and parse its `version`.
- `process.env.DSH_CLIENT_VERSION` exists only in desktop product analytics
  config (`.../dsh-web-app/cordis.patch.yml` rows), so do not rely on it.

### 8.3 Settings

There is **no global "read app settings" service**. DSH settings are the union
of each plugin's `Config`, edited through the Settings UI; `dsh-settings` only
exposes *volatile* fields of active profile entries and refuses writes that a
higher patch layer overrides — `.../dsh-settings/README.md:33-39`. For
`dsh-mobile`:

- declare your own `Config` (port, host, pairing TTL, TLS paths, …) and read the
  second `apply` argument — that is the supported way users configure you;
- do not read other plugins' configs; there is no supported API for it.

### 8.4 What `profileContext` gives a plugin (observed)

The launcher provides `profileContext` (`.../dsh/lib/profile-boot-C14i-8IN.js:290-301`);
the spike returned it verbatim:

```json
{
  "name": "web",
  "dir": "...\\research\\dshtest\\profiles\\web",
  "home": "...\\research\\dshtest",
  "patchPath": "...\\research\\dshtest\\profiles\\web\\cordis.patch.yml",
  "installAnchor": "...\\research\\app\\dsh\\node_modules\\@deepseek-ai\\dsh\\package.json",
  "cwd": "...\\harness",
  "startedBundles": ["@deepseek-ai/dsh-base","@deepseek-ai/dsh-web-app","dsh-mobile-spike"]
}
```

Use it for diagnostics in `/hello` (`hostName`, `appVersion`, home) — but note
`home` is an absolute machine path; think before sending it to a phone.

### 8.5 Service presence map (in-process, observed in the web profile)

`/spike` probed `ctx.get(name) !== undefined`:

| Service | Present | Notes for `dsh-mobile` |
|---|---|---|
| `webServer` | ✅ | register `/m/pair`, `/m/pair.json` |
| `connection` | ✅ | `admit`/`requestRejection` for the pair page |
| `agents` | ✅ | live agent registry |
| `sessionController` | ✅ | `list`, `page`, `prompt`, `cancel`, … (see §10) |
| `sessions` | ✅ | live session registry |
| `sessionQuery` | ✅ | session listing/search |
| `sessionPersistence` | ✅ | durable event reads |
| `approval` | ✅ | `dsh-user-approval` registers **`approval`**, not `userApproval` |
| `userQuestions` | ✅ | human questions |
| `jobs` | ✅ | background job roster |
| `workspaceRegistry` | ✅ | `dsh-workspace` registers **`workspaceRegistry`** |
| `attachments`, `commands`, `llm`, `agentPresets`, `skills`, `tokenMeter` | ✅ | available if needed |
| `settings`, `credentials`, `storage`, `storageDomain`, `web`, `profileContext` | ✅ | storage/credentials as in §7 |
| `storageJson` | ❌ | backend registers `storage.backend.json`, not a plain `storageJson` service; route a domain to `json` if you use storage |

Names come from the built packages (e.g. `sessionController` at
`.../dsh-api-session-controller/lib/index.js:2952`, `approval` in
`dsh-user-approval/lib/index.js`, `workspaceRegistry` in
`dsh-workspace/lib/index.js`). The same map is expected on Desktop because its
composition is also base + web-app (the desktop host itself uses
`ctx.webServer` and `ctx.connection` — `.../dsh-desktop-host/lib/index.js:342-346`);
it was **not** probed on the live desktop process (isolation rule).

---

## 9. Can a plugin add a small client UI entry?

### 9.1 Mechanism (doable, not free)

A UI plugin adds a browser half through `dsh.client` + a `./client` export:

```json
{
  "exports": { ".": "./lib/index.js", "./client": "./client.js", ... },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": { "platform": "web", "immediately": true, "inject": ["@deepseek-ai/dsh-client-ui-conversation"] }
  }
}
```

```js
// client.js — plain JS, no build tool required
window.__ModuleLoader__.load({
  id: '@local/my-decoration',
  factory(require) {
    const React = require('react')
    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
          name: 'conversation.composer.dock', id: 'my-decoration', order: 5,
        }, Component))
      },
    }
  },
})
```

Sources: `.../skills/.../references/ui-plugin.md:1-13`,
`.../skills/.../templates/decoration/{package.json,client.js}`, and a real
package's `dsh.client.inject` list in
`C:\Users\<user>\.dsh\profiles\desktop\node_modules\dsh-codex-connect\package.json`.

Constraints worth knowing before choosing this for `dsh-mobile`:
- React comes from the page module table; no duplicate React (`ui-plugin.md:9`).
- Slot ids/options must be discovered from the running client, not guessed
  (`ui-plugin.md:11`); a plain-JS plugin has no type check and a throwing
  component blanks its slot entry (`practices.md:35`).
- Do **not** serve an HTML page from the Host and embed it in an iframe — an
  iframe loses theme/locale (`practices.md:33`).
- Display metadata (`locale/*.json`, icon) is mandatory for a shipped plugin
  (`host-plugin.md:29-55`).

### 9.2 Recommendation for `dsh-mobile`: the `/m/pair` page, not a slot entry

A pairing page is a **top-level navigation** on the loopback origin, not an
embedded iframe, so the iframe objection does not apply. The cheap, verified
recipe:

1. Exact route `GET /m/pair` on `ctx.webServer` → self-contained HTML
   (inline CSS/JS, no build step, no client bundle).
2. Exact route `GET /m/pair.json` (or inline server-side rendering) → the LAN
   URL candidates, one-time code, TTL, device list — authenticated by
   `ctx.connection.requestRejection`.
3. The page's `fetch('/m/pair.json')` carries the DSH cookie automatically.

The spike implements exactly this shape at `/spike` + `/spike/pair`; both
returned `200` with the cookie and `401` without it.

A client UI entry would only add value for (a) a persistent "Devices" settings
page, or (b) a one-click "Open pairing" button in the sidebar. If wanted later,
the Slot to target would be found via `cordis_inspect_query` `Slots.listSubTree`
and the plugin would need `dsh.client` + `client.js` + locale/icon. Not needed
for v1.

---

## 10. In-process owner access to session data (desktop-level assumption check)

`docs/mobile-api.md` assumes the plugin talks to `ctx.sessionController` /
`ctx.agent` / `ctx.userApproval` directly. What we verified:

- `ctx.sessionController` **is mounted** as `sessionController`
  (`super(ctx, 'sessionController', { namespace: 'session' })`,
  `.../dsh-api-session-controller/lib/index.js:2952`).
- Its methods are `@Remote`-decorated for the wire (`list` `:3061`, `page`
  `:1475`, `prompt`/`cancel`/`control` likewise at `:2676-2700`), but the
  methods are ordinary class methods and are callable in-process.
- Access filtering explicitly allows the owner and **outside a Remote call**:

  ```js
  allows(resource) {
    const invocation = this.ctx.invocation
    const principal = principalOf(invocation)
    if (invocation === void 0 || principal === void 0) return true
    ...
  }
  ```
  — `.../dsh-api-remote-access/lib/index.js:252-255` (doc comment:
  "true for the owner and outside a Remote call").

So an in-process plugin calling `ctx.sessionController.list(undefined, signal)`
is treated as the owner and gets unfiltered results. **Caveat:** this is a
code-level reading, not an exercised path; the spike did not call session
methods (it only reported service presence). A follow-up spike should call
`sessionController.list`, `page`, and a prompt/cancel on a throwaway session to
confirm request/response shapes and that no `ctx.invocation` is required.
That is the single largest unverified risk in the mobile design and is called
out to the Lead.

For device-side approvals/questions the correct service names are
`approval` and `userQuestions` (not `userApproval`).

---

## 11. Contradictions / risks vs `docs/mobile-api.md` assumptions

1. **PWA service worker over plain LAN HTTP is impossible.** mobile-api.md §2
   already states this ("Для установки PWA (service worker) нужен HTTPS или
   localhost; APK-обёртка работает и по HTTP"). Confirm the product plan: plain
   HTTP on :3081 can serve the PWA UI and the SSE API to a browser tab, but
   **cannot** register the service worker / be installed as a PWA. Options:
   ship the APK wrapper (cleartext allowed) or configure TLS
   (`cert/key` paths in the plugin Config, serve `node:https` on the LAN
   listener). No DSH blocker; just don't promise installable-PWA over HTTP.
2. **`/m/pair` on the native origin is feasible — now verified.** Exact route
   registration before the SPA fallback works, and DSH's cookie authenticates
   same-origin fetches. The Desktop host also mounts `webServer` +
   `connection` (`dsh-desktop-host/lib/index.js:342-346`), so the same page works
   in the Electron-hosted GUI; the live desktop process was not touched.
3. **`ctx.webServer` cannot bind the LAN port.** Its host comes from
   `webStartup`/deployment config and wildcard bounds are rejected
   (`dsh-host-webserver/README.md:29-35`). The architecture's separate LAN
   listener is not optional — it is the only way to reach the phone. Verified
   a plugin-owned listener binds freely.
4. **Desktop install path differs from every other profile.** The npm CLI
   rejects `--profile desktop`; use the app's Plugins page or the bundled
   `resources\runtime\cli\bin\dsh.cmd` while Desktop is fully quit; a JS-change
   needs a restart (`dsh/README.md:20`, `plugin.js:10-12`,
   `dsh-plugin-manager/README.md:100`, `:146`). Do not hand-edit the desktop
   profile.
5. **No console logs in the shipped profiles.** `ctx.logger` writes go to an
   in-memory buffer only (`cordis/lib/index.js:582-605`); a support-facing plugin
   needs its own exporter/log file or every diagnostic is invisible.
6. **HMR remount does not reload the module.** Top-level state persisted across
   `disabled`/re-enable in our test; plugin state must be apply-scoped and code
   updates need a restart (`dsh-plugin-manager/README.md:100`).
7. **Route path ownership is exclusive.** `register()` throws on a duplicate
   exact path (`dsh-host-webserver/lib/index.js:326-333`). Reserve `/m/pair` /
   `/m/pair.json` and verify no other plugin claims them (`--dump-config` +
   Plugin inventory). Prefix `/m` would be risky; use exact paths or a dedicated
   prefix such as `/m/` registered once (longest-prefix matching).
8. **Plugin LAN endpoint is outside DSH's trust fence.** No cookie, no
   Host/Origin checks on the plugin's own socket — device-token auth, pairing
   code limits, CORS decisions and rate limiting are entirely the plugin's
   responsibility (mobile-api.md §2 already specifies them).

---

## 12. `dsh-mobile` skeleton implied by all of the above

```
packages/dsh-mobile/
├── package.json          # name, type:module, exports {., ./cordis.patch.yml, ./locale/*.json, ./client(optional)},
│                         # dsh.bundle.patch, engines.dsh "^0.2.1-rc.2"
├── cordis.patch.yml      # - insert: [{ id: dsh-mobile, name: dsh-mobile, config: {...} }]
├── locale/en.json        # meta.title/description (required for shipped bundles)
├── icon.svg              # required for shipped bundles
└── lib/index.js          # apply(ctx, config):
                          #   - Config (schemastery): host/port, pairingTtlSec, tls, maxDevices
                          #   - ctx.effect own node:http(s) listener on LAN (PWA + /api/v1/*)
                          #   - ctx.inject(['webServer','connection','credentials'|...]): /m/pair, /m/pair.json
                          #   - device registry persisted via ctx.credentials record or $DSH_HOME JSON
                          #   - all disposers owned by ctx.effect; own logger exporter
```

Verification gates before calling it done:

1. `dsh plugin --profile <test> add link:<dir>` succeeds; bundle appears in
   `dsh.profile.bundles`.
2. Boot the test instance; `/m/pair` returns 200 HTML with the cookie and 401
   without; `/m/pair.json` lists LAN candidates.
3. Pair a real device: `POST /api/v1/hello` and `/health` from the phone.
4. Disable the row → own listener closed (ECONNREFUSED), routes 404; re-enable →
   remount. Restart instance → device tokens survive.
5. Restart the **desktop** app after installing into the desktop profile and
   repeat 2-4 there (only after the user approves touching the desktop profile).
