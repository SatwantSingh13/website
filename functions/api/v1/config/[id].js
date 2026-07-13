export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function onRequestGet(context) {
  const id = context.params.id;
  const store = context.env.NEXBANNER_CONFIGS;
  const cache = typeof caches !== "undefined" ? caches.default : null;
  const cacheKey = new Request(context.request.url, { method: "GET" });

  if (!store || !store.get) {
    return json({ error: "missing_NEXBANNER_CONFIGS_binding" }, 500);
  }

  if (cache) {
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
  }

  const value = await store.get(id);
  if (!value) return json({ error: "config_not_found" }, 404);

  const response = new Response(value, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=30, s-maxage=300, stale-while-revalidate=600",
      "x-nexbanner-cache": "miss",
      ...corsHeaders(),
    },
  });
  if (cache) context.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
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
