/**
 * dsh-mobile-spike — the smallest REAL DeepSeek Harness (DSH) plugin that proves
 * the mechanics the `dsh-mobile` product plugin needs, on this exact DSH version
 * (0.2.1-rc.2, Cordis 4.0.5):
 *
 *   1. it mounts in-process in the running DSH host (Cordis `apply(ctx, config)`),
 *   2. it logs on mount (ctx.logger, exported to a file so a headless test run
 *      can quote real log lines — the shipped web profile has no console exporter),
 *   3. it registers EXACT HTTP routes on the native DSH loopback origin
 *      (`ctx.webServer.register({ kind: 'exact', path, handler })`),
 *   4. it authenticates those routes as the DSH owner through
 *      `ctx.connection.requestRejection(req)` (401 before DSH browser auth,
 *      403 for an untrusted Host/Origin),
 *   5. it starts its own out-of-band `node:http` listener (the future LAN port),
 *   6. it releases BOTH listeners on dispose through `ctx.effect` disposers.
 *
 * Zero npm dependencies: node:http, node:fs, node:path, node:os, node:util only,
 * plus whatever services the host already provides (read with ctx.inject/ctx.get).
 *
 * Not a product: this package exists to verify the plugin contract. It logs the
 * evidence (mount, route registration, listener address, dispose) so a test run
 * can diff expectations against real output.
 */
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { homedir, networkInterfaces } from "node:os";
import { dirname, join } from "node:path";
import { format } from "node:util";

const PLUGIN = "dsh-mobile-spike";
const MOUNTED_AT = new Date().toISOString();

/** Non-internal IPv4 LAN candidates — the DSH host exposes no service for this. */
function lanAddresses() {
  const out = [];
  for (const [name, addresses] of Object.entries(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === "IPv4" && !address.internal) out.push({ iface: name, address: address.address });
    }
  }
  return out;
}

/** Effective DSH runtime version, read from the installation anchor the host provides. */
function dshRuntimeVersion(ctx) {
  try {
    const anchor = ctx.get("profileContext")?.installAnchor;
    if (typeof anchor === "string") return JSON.parse(readFileSync(anchor, "utf8")).version ?? null;
  } catch {
    /* fall through */
  }
  return null;
}

/** Which services this in-process host actually mounts (presence probe, no activation). */
function serviceInventory(ctx) {
  const names = [
    "webServer", "connection", "settings", "credentials", "storageDomain", "storage", "storageJson",
    "web", "agents", "sessionController", "sessions", "sessionQuery", "sessionPersistence",
    "approval", "userQuestions", "jobs", "workspaceRegistry", "attachments", "commands", "llm",
    "agentPresets", "skills", "tokenMeter", "profileContext",
  ];
  const out = {};
  for (const name of names) {
    try {
      out[name] = ctx.get(name) !== undefined;
    } catch {
      out[name] = false;
    }
  }
  return out;
}

/** `<DSH_HOME>/logs/dsh-mobile-spike.log`; DSH_HOME defaults to ~/.dsh. */
function resolveLogFile() {
  const home = process.env.DSH_HOME?.trim() === "" || process.env.DSH_HOME === undefined
    ? join(homedir(), ".dsh")
    : process.env.DSH_HOME;
  return join(home, "logs", `${PLUGIN}.log`);
}

/**
 * Capture this plugin's own logger records into a file. The stock web profile
 * mounts no console logger exporter (Cordis' built-in exporter only buffers),
 * so without this a headless test sees no log lines at all. Filtering by the
 * logger NAME keeps other plugins' records out of the fixture's file.
 */
function attachFileLogExporter(ctx, logFile) {
  ctx.effect(() => {
    try {
      mkdirSync(dirname(logFile), { recursive: true });
    } catch {
      /* best effort: logging must never fail activation */
    }
    return ctx.logger.exporter({
      levels: { default: 4 }, // accept every level; the name filter below narrows it
      formatters: {},
      export(message) {
        if (message.name !== PLUGIN) return;
        const line = `${new Date(message.ts).toISOString()} ${message.type.toUpperCase()} ${message.name}: ${format(...message.args)}\n`;
        try {
          appendFileSync(logFile, line);
        } catch {
          /* best effort */
        }
      },
    });
  }, `${PLUGIN}: file log exporter`);
}

/** Last-resort evidence line: the logger exporter is torn down in the same disposal pass. */
function appendEvidence(logFile, text) {
  try {
    appendFileSync(logFile, `${new Date().toISOString()} INFO ${PLUGIN}: ${text}\n`);
  } catch {
    /* best effort */
  }
}

/** @param {import('node:http').ServerResponse} res */
function sendJson(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(text),
  });
  res.end(text);
}

function sendHtml(res, status, html) {
  const text = String(html);
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(text),
  });
  res.end(text);
}

/**
 * Owner authentication for a route registered directly on ctx.webServer.
 * DSH's own `/api` bridge never sees this route, so the plugin applies the same
 * admission the Connection service applies: `requestRejection()` returns a
 * 401/403 status for an unauthenticated or untrusted request, or `undefined`
 * for an owner request carrying the signed DSH browser cookie.
 *
 * Returns 503 when the `connection` service is absent: a composition without
 * the Web bundle has no browser cookie to check, so fail closed.
 */
function ownerRejection(ctx, req) {
  let connection;
  try {
    connection = ctx.get("connection");
  } catch {
    connection = undefined;
  }
  if (connection === undefined || typeof connection.requestRejection !== "function") {
    return 503;
  }
  try {
    return connection.requestRejection(req);
  } catch {
    return 503;
  }
}

/**
 * Cordis plugin entry point. An async `apply` is supported: DSH awaits the
 * returned promise and treats a rejection as an activation failure (optional
 * rows log a warning, required rows stop startup — app-boot's failure table).
 */
export async function apply(ctx, config) {
  const cfg = config ?? {};
  const host = typeof cfg.host === "string" ? cfg.host : "127.0.0.1";
  const port = Number.isInteger(cfg.port) ? cfg.port : 18099;
  const logFile = resolveLogFile();
  attachFileLogExporter(ctx, logFile);
  const log = ctx.logger(PLUGIN);

  log.info(`apply() start pid=${process.pid} dshHome=${process.env.DSH_HOME ?? "(unset)"} node=${process.version} logFile=${logFile}`);

  // (b) proof of mount: an effect whose disposer logs the unmount.
  ctx.effect(() => {
    log.info(`MOUNTED at ${MOUNTED_AT}`);
    return async () => {
      log.info("DISPOSED (mount effect)");
    };
  }, `${PLUGIN}: mount marker`);

  // (c) exact routes on the EXISTING DSH web server (the loopback origin the
  //     user's browser already uses, e.g. http://127.0.0.1:18080). `ctx.inject`
  //     keeps the plugin inactive-but-waiting in a composition without it, and
  //     its child fiber owns the registrations below.
  ctx.inject(["webServer"], (webCtx) => {
    const origin = () => {
      try {
        return webCtx.webServer.getOrigin();
      } catch {
        return "(not bound)";
      }
    };

    webCtx.effect(() => {
      log.info(`registering exact route GET /spike on ${origin()}`);
      return webCtx.webServer.register({
        kind: "exact",
        path: "/spike",
        handler: (req, res) => {
          if (req.method !== "GET" && req.method !== "HEAD") {
            log.info(`${req.method} /spike -> 405`);
            return sendJson(res, 405, { ok: false, error: "method-not-allowed" });
          }
          const rejection = ownerRejection(webCtx, req);
          if (rejection !== undefined) {
            log.info(`${req.method} /spike -> ${rejection} (not the DSH owner)`);
            return sendJson(res, rejection, {
              ok: false,
              error: rejection === 401 ? "auth-required" : "forbidden",
            });
          }
          log.info(`${req.method} /spike -> 200 (authenticated owner)`);
          const profileContext = ctx.get("profileContext");
          sendJson(res, 200, {
            ok: true,
            from: PLUGIN,
            authenticated: "owner",
            mountedAt: MOUNTED_AT,
            pid: process.pid,
            dshHome: process.env.DSH_HOME ?? null,
            appVersion: dshRuntimeVersion(webCtx),
            webServerOrigin: origin(),
            webServerPort: webCtx.webServer.port,
            webServerProtocol: webCtx.webServer.protocol,
            node: process.version,
            lanAddresses: lanAddresses(),
            services: serviceInventory(webCtx),
            profileContext: profileContext === undefined ? null : {
              name: profileContext.name,
              dir: profileContext.dir,
              home: profileContext.home,
              patchPath: profileContext.patchPath,
              installAnchor: profileContext.installAnchor,
              cwd: profileContext.cwd,
              startedBundles: profileContext.startedBundles,
            },
          });
        },
      });
    }, `${PLUGIN}: /spike route`);

    // (c-bis) the /m/pair approach: a small self-contained HTML page served by
    // the SAME exact-route mechanism on the native DSH origin, authenticated by
    // the same browser cookie. It fetches its data same-origin, so no token or
    // plugin client bundle is needed. (The real /m/pair page is served by
    // dsh-mobile the same way.)
    webCtx.effect(() => {
      log.info(`registering exact route GET /spike/pair on ${origin()}`);
      return webCtx.webServer.register({
        kind: "exact",
        path: "/spike/pair",
        handler: (req, res) => {
          if (req.method !== "GET" && req.method !== "HEAD") {
            return sendJson(res, 405, { ok: false, error: "method-not-allowed" });
          }
          const rejection = ownerRejection(webCtx, req);
          if (rejection !== undefined) {
            log.info(`${req.method} /spike/pair -> ${rejection}`);
            return sendJson(res, rejection, { ok: false, error: rejection === 401 ? "auth-required" : "forbidden" });
          }
          log.info(`${req.method} /spike/pair -> 200 (pairing page)`);
          sendHtml(res, 200, `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>dsh-mobile-spike pairing</title>
<body style="font:14px/1.4 system-ui;margin:2rem">
<h1>dsh-mobile-spike</h1>
<p>This page was served by the plugin on the native DSH loopback origin and is
authenticated by the existing DSH browser cookie.</p>
<pre id="out">fetching /spike …</pre>
<script>
fetch('/spike', { headers: { accept: 'application/json' } })
  .then((r) => r.json())
  .then((j) => { document.getElementById('out').textContent = JSON.stringify(j, null, 2) })
  .catch((e) => { document.getElementById('out').textContent = 'error: ' + e })
</script>`);
        },
      });
    }, `${PLUGIN}: /spike/pair route`);

    log.info("web routes registered");
  });

  // (d) the plugin's OWN listener — a second node:http server that does not touch
  //     ctx.webServer at all. This is the shape of the future LAN listener on
  //     port 3081. DSH imposes no restriction; the plugin owns the socket.
  const ownServer = createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://x").pathname;
    if (req.method === "GET" && path === "/ping") {
      log.info("GET /ping -> 200 (own listener)");
      return sendJson(res, 200, {
        ok: true,
        pong: true,
        from: PLUGIN,
        mountedAt: MOUNTED_AT,
        pid: process.pid,
        uptimeSec: Math.round(process.uptime()),
      });
    }
    log.info(`${req.method} ${path} -> 404 (own listener)`);
    sendJson(res, 404, { ok: false, error: "not-found" });
  });

  const listening = new Promise((resolve, reject) => {
    ownServer.once("error", reject);
    ownServer.listen(port, host, () => {
      ownServer.off("error", reject);
      const address = ownServer.address();
      const boundPort = address !== null && typeof address === "object" ? address.port : port;
      log.info(`own listener READY on http://${host}:${boundPort}`);
      resolve();
    });
  });

  // (e) cleanup: the disposer runs on plugin unload / profile reload / shutdown.
  //     Both the own socket and the web routes above are owned by effects, so
  //     nothing survives a dispose.
  ctx.effect(() => {
    return async () => {
      log.info(`dispose -> closing own listener ${host}:${port}`);
      await new Promise((resolve) => ownServer.close(() => resolve()));
      appendEvidence(logFile, `own listener CLOSED on ${host}:${port}`);
    };
  }, `${PLUGIN}: own listener lifetime`);

  await listening;
  log.info("apply() complete");
}
