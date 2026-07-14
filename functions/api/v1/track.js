export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const event = {
    ts: new Date().toISOString(),
    event: url.searchParams.get("event") || "unknown",
    configId: url.searchParams.get("config_id") || "",
    productVersion: url.searchParams.get("product_version") || "",
    rotationMode: url.searchParams.get("rotation_mode") || "",
    publisherId: url.searchParams.get("publisher_id") || "",
    publisherDomain: url.searchParams.get("publisher_domain") || "",
    placementId: url.searchParams.get("placement_id") || "",
    layer: url.searchParams.get("layer") || "",
    requestId: url.searchParams.get("request_id") || "",
    partnerName: url.searchParams.get("partner_name") || "",
    cpm: url.searchParams.get("cpm") || "",
    reason: url.searchParams.get("reason") || "",
  };

  const store = eventStore(context.env);
  if (store && store.put) {
    const key = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await Promise.all([
      store.put(key, JSON.stringify(event), { expirationTtl: 60 * 60 * 24 * 30 }),
      writeExactMarkers(store, event),
      updateCounters(store, event),
    ]);
  }

  const pixel = Uint8Array.from([71,73,70,56,57,97,1,0,1,0,128,0,0,255,255,255,0,0,0,33,249,4,1,0,0,0,0,44,0,0,0,0,1,0,1,0,0,2,2,68,1,0,59]);
  return new Response(pixel, {
    headers: { "content-type": "image/gif", "cache-control": "no-store", ...corsHeaders() },
  });
}

async function writeExactMarkers(store, event) {
  if (!event.configId || !event.requestId) return;
  const date = event.ts.slice(0, 10);
  const scope = encodeURIComponent(event.configId);
  const request = encodeURIComponent(event.requestId);
  const options = {
    expirationTtl: 60 * 60 * 24 * 30,
    metadata: {
      ts: event.ts,
      partnerName: event.partnerName || "",
      layer: event.layer || "",
      cpm: Number(event.cpm || 0) || 0,
      event: event.event || "",
      reason: event.reason || "",
    },
  };

  if (event.event === "ad_request") {
    await store.put(`exact:${date}:${scope}:request:${request}`, "1", options);
  } else if (event.event === "request_filled") {
    await store.put(`exact:${date}:${scope}:filled:${request}`, "1", options);
  } else if (event.event === "impression") {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await store.put(`exact:${date}:${scope}:delivery:${suffix}`, "1", options);
  } else if (event.event === "partner_request" && event.partnerName) {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await store.put(`exact:${date}:${scope}:partner-request:${suffix}`, "1", options);
  } else if (event.partnerName && (event.event === "partner_no_fill" || event.event.includes("error") || event.event.includes("failed") || event.event.includes("no_fill"))) {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await store.put(`exact:${date}:${scope}:diagnostic:${suffix}`, "1", options);
  }
}

function eventStore(env) {
  return env.NEXBANNER_EVENTS || env.NEXBANNER_CONFIGS || null;
}

async function updateCounters(store, event) {
  const date = event.ts.slice(0, 10);
  const keys = [
    `summary:${date}:all`,
    `summary:${date}:publisher:${event.publisherId || "unknown"}`,
    `summary:${date}:domain:${event.publisherDomain || "unknown"}`,
    `summary:${date}:placement:${event.publisherId || "unknown"}:${event.placementId || "unknown"}`,
  ];

  if (event.configId) keys.push(`summary:${date}:config:${event.configId}`);

  await Promise.all(keys.map((key) => incrementSummary(store, key, event)));
}

async function incrementSummary(store, key, event) {
  const current = await store.get(key, "json");
  const summary = current || {
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

  const layer = event.layer || "unknown";
  const partnerName = event.partnerName || "";
  summary.layers[layer] = summary.layers[layer] || { requests: 0, fills: 0, impressions: 0, noFill: 0, errors: 0, cpmTotal: 0 };
  summary.partners = summary.partners || {};
  if (partnerName) {
    summary.partners[partnerName] = summary.partners[partnerName] || {
      requests: 0,
      impressions: 0,
      noFill: 0,
      errors: 0,
      cpmTotal: 0,
      revenueEstimate: 0,
    };
    if (summary.partners[partnerName].noFill === undefined) summary.partners[partnerName].noFill = 0;
    if (summary.partners[partnerName].errors === undefined) summary.partners[partnerName].errors = 0;
  }
  if (event.productVersion) summary.versions[event.productVersion] = (summary.versions[event.productVersion] || 0) + 1;

  if (summary.adRequests === undefined) summary.adRequests = 0;
  if (summary.measuredRequests === undefined) summary.measuredRequests = 0;
  if (summary.filledRequests === undefined) summary.filledRequests = 0;
  if (summary.impressionRevenue === undefined) summary.impressionRevenue = 0;
  if (event.event === "ad_request") {
    summary.adRequests += 1;
    if (event.requestId) summary.measuredRequests += 1;
  }
  if (event.event === "request_filled") summary.filledRequests += 1;
  if (event.event === "partner_request" && partnerName) summary.partners[partnerName].requests += 1;
  if (event.event === "viewable_start") summary.viewableRequests += 1;
  if (event.event === "rotation_layer_filled" || event.event === "realtime_winner") {
    summary.deliveredAds += 1;
    summary.layers[layer].fills += 1;
  }
  if (event.event === "impression") {
    summary.impressions += 1;
    summary.layers[layer].impressions += 1;
    if (partnerName) summary.partners[partnerName].impressions += 1;
  }
  if (event.event === "click") summary.clicks += 1;
  if (event.event.indexOf("no_fill") >= 0 || event.event === "no_ad") {
    summary.noFill += 1;
    summary.layers[layer].noFill += 1;
    if (partnerName) summary.partners[partnerName].noFill += 1;
  }
  if (event.event.indexOf("error") >= 0 || event.event.indexOf("failed") >= 0) {
    summary.errors += 1;
    summary.layers[layer].errors += 1;
    if (partnerName) summary.partners[partnerName].errors += 1;
  }
  if (event.event === "rotation_cycle_complete") summary.cycles += 1;
  if (event.event.indexOf("request") >= 0 || event.event === "viewable_start") summary.layers[layer].requests += 1;

  const cpm = Number(event.cpm || 0);
  if (Number.isFinite(cpm) && cpm > 0) {
    summary.cpmTotal += cpm;
    summary.layers[layer].cpmTotal += cpm;
    if (event.event === "impression" || event.event === "rotation_layer_filled") {
      summary.revenueEstimate += cpm / 1000;
    }
    if (event.event === "impression") summary.impressionRevenue += cpm / 1000;
    if (event.event === "impression" && partnerName) {
      summary.partners[partnerName].cpmTotal += cpm;
      summary.partners[partnerName].revenueEstimate += cpm / 1000;
    }
  }

  summary.updatedAt = event.ts;
  await store.put(key, JSON.stringify(summary), { expirationTtl: 60 * 60 * 24 * 30 });
}

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "content-type",
  };
}
