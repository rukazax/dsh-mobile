#!/usr/bin/env node
/**
 * probe.mjs — dependency-free HTTP probe for the ISOLATED DSH test instance
 * (never point this at the live app on 127.0.0.1:59912).
 *
 * Why a script: stock Windows PowerShell 5.1 Invoke-WebRequest has no
 * -SkipHttpErrorCheck, so it throws on the 401/302 responses this probe must
 * observe exactly. Node 24's global fetch (undici) reports status, headers and
 * Set-Cookie without throwing, and needs no install.
 *
 * Usage:
 *   node probe.mjs root  <base>                       GET / without a cookie
 *   node probe.mjs pair  <base> <token>               GET /?token=... (cookie exchange)
 *   node probe.mjs get   <base> <path> [--body]       GET <path> WITH the saved cookie
 *   node probe.mjs anon  <base> <path> [--body]       GET <path> WITHOUT the cookie
 *   node probe.mjs full  <base> <token> [paths...]    exchange then probe each path with the cookie
 *   node probe.mjs ping  <base>                       GET <base>/ping, no cookie (own listener)
 *
 * The cookie from `pair`/`full` is kept in tools/.probe-cookie.json so separate
 * invocations can reuse it. Redirects are never followed automatically.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const JAR = join(HERE, ".probe-cookie.json");

/** One request, redirects disabled. Returns `{ error }` instead of throwing when the socket is closed. */
async function request(url, cookie) {
  const headers = { "accept": "*/*", "user-agent": "dsh-mobile-probe/0.1" };
  if (cookie) headers.cookie = cookie;
  try {
    const res = await fetch(url, { redirect: "manual", headers });
    const text = await res.text();
    return { res, text };
  } catch (error) {
    return { error };
  }
}

function reportNetworkError(label, error) {
  console.log(`### ${label}`);
  console.log(`fetch failed: ${error?.message ?? error}`);
  if (error?.cause?.code) console.log(`cause: ${error.cause.code}`);
  console.log("");
}

function headersOf(res, names) {
  const out = {};
  for (const name of names) {
    const v = res.headers.get(name);
    if (v !== null) out[name] = v;
  }
  return out;
}

function cookieFrom(res) {
  const raw = res.headers.getSetCookie?.() ?? [];
  if (raw.length === 0) return undefined;
  // "<name>=<value>; Path=/; HttpOnly; SameSite=Strict; Max-Age=..."
  const pair = raw[0].split(";")[0].trim();
  return pair;
}

function logResponse(label, res, text, showBody) {
  console.log(`### ${label}`);
  console.log(`URL: ${res.url}`);
  console.log(`status: ${res.status} ${res.statusText}`);
  console.log(`headers: ${JSON.stringify(headersOf(res, ["content-type", "content-length", "cache-control", "location"]))}`);
  const setCookie = res.headers.getSetCookie?.() ?? [];
  if (setCookie.length > 0) {
    console.log(`set-cookie[0]: ${setCookie[0]}`);
    console.log(`set-cookie count: ${setCookie.length}`);
  }
  console.log(`body length: ${text.length}`);
  if (showBody || text.length <= 600) {
    console.log(`body: ${text.length > 4000 ? `${text.slice(0, 4000)}…` : text}`);
  } else {
    console.log(`body preview: ${text.slice(0, 300)}…`);
  }
  console.log("");
}

function saveCookie(cookie) {
  writeFileSync(JAR, JSON.stringify({ cookie }, null, 2));
  console.log(`(cookie saved to ${JAR}: ${cookie})`);
}
function loadCookie() {
  try {
    return JSON.parse(readFileSync(JAR, "utf8")).cookie;
  } catch {
    return undefined;
  }
}

const [cmd, ...args] = process.argv.slice(2);
const base = (args[0] ?? "http://127.0.0.1:18080").replace(/\/$/, "");
const wantBody = args.includes("--body");

/** Request + print, or print the network error (e.g. the own listener is closed). */
async function probe(label, url, cookie) {
  const result = await request(url, cookie);
  if (result.error !== undefined) return reportNetworkError(label, result.error);
  logResponse(label, result.res, result.text, wantBody);
  return result;
}

switch (cmd) {
  case "root": {
    await probe("GET / (anonymous)", `${base}/`);
    break;
  }
  case "pair": {
    const token = args[1];
    if (token === undefined) {
      console.error("usage: node probe.mjs pair <base> <token>");
      process.exit(2);
    }
    const result = await probe("GET /?token=<launch token> (exchange)", `${base}/?token=${encodeURIComponent(token)}`);
    const cookie = result?.res === undefined ? undefined : cookieFrom(result.res);
    if (cookie !== undefined) saveCookie(cookie);
    else console.log("(no Set-Cookie: launch token rejected, or no response)");
    break;
  }
  case "get": case "anon": {
    const path = args[1] ?? "/";
    const cookie = cmd === "get" ? loadCookie() : undefined;
    await probe(`GET ${path} (${cmd === "get" ? "with cookie" : "without cookie"})`, `${base}${path}`, cookie);
    break;
  }
  case "ping": {
    await probe("GET /ping (own listener, no DSH auth)", `${base}/ping`);
    break;
  }
  case "full": {
    const token = args[1];
    const paths = args.slice(2).filter((p) => p.startsWith("/"));
    await probe("GET / (anonymous)", `${base}/`);
    const exchange = await probe("GET /?token=<launch token> (exchange)", `${base}/?token=${encodeURIComponent(token)}`);
    const cookie = exchange?.res === undefined ? undefined : cookieFrom(exchange.res);
    if (cookie !== undefined) saveCookie(cookie);
    await probe("GET / (with cookie)", `${base}/`, cookie);
    for (const path of paths) {
      await probe(`GET ${path} (with cookie)`, `${base}${path}`, cookie);
    }
    break;
  }
  default:
    console.error("usage: node probe.mjs <root|pair|get|anon|ping|full> <base> [...]");
    process.exit(2);
}

