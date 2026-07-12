export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function onRequestGet(context) {
  const id = context.params.id;
  const store = context.env.NEXBANNER_CONFIGS;

  if (!store || !store.get) {
    return json({ error: "missing_NEXBANNER_CONFIGS_binding" }, 500);
  }

  const value = await store.get(id);
  if (!value) return json({ error: "config_not_found" }, 404);

  return new Response(value, {
    headers: { "content-type": "application/json; charset=utf-8", ...corsHeaders() },
  });
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

