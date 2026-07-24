export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function onRequestGet(context) {
  let id;
  try {
    id = validateConfigId(context.params.id);
  } catch (_) {
    return json({ error: "invalid_config_id" }, 400);
  }
  const store = context.env.NEXBANNER_CONFIGS;
  const cache = typeof caches !== "undefined" ? caches.default : null;
  const cacheKey = new Request(context.request.url, { method: "GET" });

  if (!store || !store.get) {
    return json({ error: "missing_NEXBANNER_CONFIGS_binding" }, 500);
  }

  if (cache) {
    const cached = await cache.match(cacheKey);
    if (cached) {
      if (context.request.headers.get("if-none-match") === cached.headers.get("etag")) {
        return new Response(null, { status: 304, headers: cached.headers });
      }
      return cached;
    }
  }

  let value = await store.get(id);
  if (!value && id !== id.toLowerCase()) value = await store.get(id.toLowerCase());
  if (!value) return json({ error: "config_not_found" }, 404);

  const config = JSON.parse(value);
  const etag = configEtag(config);
  if (context.request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: { etag, ...corsHeaders() } });
  }
  const response = new Response(JSON.stringify(config), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=30, s-maxage=60, stale-while-revalidate=120",
      etag,
      "x-nexbanner-cache": "miss",
      ...corsHeaders(),
    },
  });
  if (cache) context.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

function validateConfigId(value) {
  const result = String(value || "").trim();
  if (!result || result.length > 180 || !/^[A-Za-z0-9._-]+$/.test(result) ||
      result.includes("..") || result.startsWith(".")) {
    throw new Error("invalid_config_id");
  }
  return result;
}

function configEtag(config) {
  const input = JSON.stringify(config);
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `"nbx-${config.configVersion || 1}-${(hash >>> 0).toString(16)}"`;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...corsHeaders() },
  });
}

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
  };
}
