export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function onRequestGet(context) {
  const store = context.env.NEXBANNER_EVENTS || context.env.NEXBANNER_CONFIGS;
  if (!store || !store.get) {
    return json({ ok: false, error: "missing_NEXBANNER_EVENTS_or_NEXBANNER_CONFIGS_binding" }, 500);
  }

  const url = new URL(context.request.url);
  const date = url.searchParams.get("date") || new Date().toISOString().slice(0, 10);
  const configId = url.searchParams.get("config_id") || "";
  const publisherId = url.searchParams.get("publisher_id") || "";
  const publisherDomain = url.searchParams.get("publisher_domain") || "";
  const placementId = url.searchParams.get("placement_id") || "";

  let key = `summary:${date}:all`;
  if (configId) key = `summary:${date}:config:${configId}`;
  else if (publisherDomain) key = `summary:${date}:domain:${publisherDomain}`;
  else if (publisherId && placementId) key = `summary:${date}:placement:${publisherId}:${placementId}`;
  else if (publisherId) key = `summary:${date}:publisher:${publisherId}`;

  const summary = await store.get(key, "json");
  return json({
    ok: true,
    date,
    key,
    summary: summary || emptySummary(key),
  });
}

function emptySummary(key) {
  return {
    key,
    adRequests: 0,
    measuredRequests: 0,
    filledRequests: 0,
    viewableRequests: 0,
    deliveredAds: 0,
    impressions: 0,
    clicks: 0,
    noFill: 0,
    errors: 0,
    cycles: 0,
    cpmTotal: 0,
    revenueEstimate: 0,
    impressionRevenue: 0,
    layers: {},
    partners: {},
    versions: {},
    updatedAt: "",
  };
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
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "content-type",
  };
}
