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
  const resolvedSummary = summary || emptySummary(key);
  if (configId) resolvedSummary.exact = await exactMetrics(store, date, configId);
  return json({
    ok: true,
    date,
    key,
    summary: resolvedSummary,
  });
}

async function exactMetrics(store, date, configId) {
  if (!store.list) return { enabled: false };
  const prefix = `exact:${date}:${encodeURIComponent(configId)}:`;
  const [requests, filled, deliveries, partnerRequests] = await Promise.all([
    listAll(store, `${prefix}request:`),
    listAll(store, `${prefix}filled:`),
    listAll(store, `${prefix}delivery:`),
    listAll(store, `${prefix}partner-request:`),
  ]);
  const partners = {};
  let impressionRevenue = 0;
  let exactSince = "";

  requests.concat(filled, deliveries, partnerRequests).forEach((item) => {
    const metadata = item.metadata || {};
    if (metadata.ts && (!exactSince || metadata.ts < exactSince)) exactSince = metadata.ts;
  });
  deliveries.forEach((item) => {
    const metadata = item.metadata || {};
    const partnerName = metadata.partnerName || "Unknown";
    const cpm = Number(metadata.cpm || 0) || 0;
    partners[partnerName] = partners[partnerName] || { requests: 0, impressions: 0, noFill: 0, errors: 0, cpmTotal: 0, revenueEstimate: 0 };
    partners[partnerName].impressions += 1;
    partners[partnerName].cpmTotal += cpm;
    partners[partnerName].revenueEstimate += cpm / 1000;
    impressionRevenue += cpm / 1000;
  });
  partnerRequests.forEach((item) => {
    const partnerName = item.metadata?.partnerName || "Unknown";
    partners[partnerName] = partners[partnerName] || { requests: 0, impressions: 0, noFill: 0, errors: 0, cpmTotal: 0, revenueEstimate: 0 };
    partners[partnerName].requests += 1;
  });

  return {
    enabled: true,
    exactSince,
    adRequests: requests.length,
    filledRequests: filled.length,
    impressions: deliveries.length,
    impressionRevenue,
    fillRate: requests.length ? (filled.length / requests.length) * 100 : 0,
    ecpm: deliveries.length && impressionRevenue > 0 ? (impressionRevenue / deliveries.length) * 1000 : null,
    partners,
  };
}

async function listAll(store, prefix) {
  const keys = [];
  let cursor;
  do {
    const page = await store.list({ prefix, limit: 1000, cursor });
    keys.push(...(page.keys || []));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return keys;
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
