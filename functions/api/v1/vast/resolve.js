import { resolveVast } from "./resolver-core.mjs";

const DEFAULT_ALLOWED_HOSTS = [
  "servg.playstream.media",
  "pubads.g.doubleclick.net",
  "googleads.g.doubleclick.net",
  "securepubads.g.doubleclick.net",
].join(",");

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  return handle(context, {
    source: url.searchParams.get("source"),
    sourceName: url.searchParams.get("source_name"),
    cpm: url.searchParams.get("cpm"),
    allowVpaid: url.searchParams.get("allow_vpaid") === "1",
    cachebuster: url.searchParams.get("cb"),
  });
}

export async function onRequestPost(context) {
  let body;
  try { body = await context.request.json(); } catch (_) { return json({ ok: false, error: "invalid_request" }, 400); }
  return handle(context, body);
}

async function handle(context, input) {
  try {
    if (!input.source) return json({ ok: false, error: "missing_source" }, 400);
    const resolved = await resolveVast(input.source, {
      sourceName: input.sourceName,
      cpm: input.cpm,
      allowVpaid: input.allowVpaid === true,
      cachebuster: input.cachebuster,
      allowedHosts: context.env.NEXBANNER_VAST_ALLOWED_HOSTS || DEFAULT_ALLOWED_HOSTS,
      requireAllowlist: context.env.NEXBANNER_VAST_REQUIRE_ALLOWLIST !== "false",
      maxDepth: context.env.NEXBANNER_VAST_MAX_WRAPPER_DEPTH || 5,
      perHopTimeoutMs: context.env.NEXBANNER_VAST_HOP_TIMEOUT_MS || 1500,
      totalTimeoutMs: context.env.NEXBANNER_VAST_TOTAL_TIMEOUT_MS || 5000,
    });
    return json({ ok: true, ...resolved }, 200, { "cache-control": "private, no-store" });
  } catch (error) {
    return json({ ok: false, error: error.code || error.message || "vast_resolver_error" }, error.status || 500);
  }
}

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...extra, ...corsHeaders() },
  });
}
function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
  };
}
