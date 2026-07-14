export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function onRequestPost(context) {
  try {
    const body = await context.request.json();
    const configId = body.configId || domainConfigId(body) || makeConfigId();
    const config = normalizeConfig(configId, body);

    const store = context.env.NEXBANNER_CONFIGS;
    if (!store || !store.put) {
      return json({ ok: false, error: "missing_NEXBANNER_CONFIGS_binding" }, 500);
    }

    await store.put(configId, JSON.stringify(config));

    return json({
      ok: true,
      configId,
      tag: shortTag(configId, config),
    });
  } catch (error) {
    return json({ ok: false, error: error.message || "invalid_config" }, 400);
  }
}

function normalizeConfig(configId, body) {
  const setup = body.setup || {};
  const productVersion = body.productVersion || "Version 1";
  const isVersion2 = productVersion === "Version 2 Testing";
  const isNexSticky = productVersion === "NexSticky";
  const fallbackImageUrl = body.remnantImageUrl
    || body.displayImageUrl
    || setup.remnantImageUrl
    || setup.displayImageUrl
    || (isVersion2 ? "https://nexbid.b-cdn.net/assets/nexbid-test-display-300x250.png" : "");
  const demand = Array.isArray(body.demand) ? body.demand : [];
  const vast = Array.isArray(body.vast) ? body.vast : [];
  const displayTags = Array.isArray(body.displayTags) ? body.displayTags : [];
  const prebid = Array.isArray(body.prebid) ? body.prebid : [];
  const adserverTags = Array.isArray(body.adserverTags) ? body.adserverTags : [];
  const apiBase = trimSlash(setup.apiBase || "https://nexbid.uk");
  const vastDemand = demand.filter((item) => item.type === "vast").concat(vast);
  const prebidDemand = prebid.map((item) => ({
    name: item.name || "",
    endpoint: endpointOf(item) || `${apiBase}/api/v1/auction`,
    params: item.params || "",
    floorCpm: item.floorCpm || "",
    timeoutMs: item.timeoutMs || "",
  })).filter((item) => item.endpoint || item.params);
  const vastDemandItems = vastDemand.map((item) => ({
    name: item.name || "",
    endpoint: endpointOf(item),
    floorCpm: item.floorCpm || "",
    timeoutMs: item.timeoutMs || "",
    allowVpaid: item.allowVpaid !== false,
  })).filter((item) => item.endpoint);
  const displayScriptDemand = displayTags.map((item) => ({
    name: item.name || "",
    endpoint: endpointOf(item),
    floorCpm: item.floorCpm || "",
    timeoutMs: item.timeoutMs || "",
  })).filter((item) => item.endpoint);
  const adserverScriptDemand = adserverTags
    .filter((item) => item.tagType === "script")
    .map((item) => ({
      name: item.name || "",
      endpoint: endpointOf(item),
      floorCpm: item.floorCpm || "",
      timeoutMs: item.timeoutMs || "",
    }))
    .filter((item) => item.endpoint);
  const adserverHtmlDemand = adserverTags
    .filter((item) => item.tagType === "html")
    .map((item) => ({
      name: item.name || "",
      html: encodeURIComponent(item.html || ""),
      floorCpm: item.floorCpm || "",
      timeoutMs: item.timeoutMs || "",
    }))
    .filter((item) => item.html);
  const ortbEndpoints = demand
    .filter((item) => item.type === "ortb")
    .map(endpointOf)
    .filter(Boolean);
  const ortbDemand = demand
    .filter((item) => item.type === "ortb")
    .map((item) => ({
      name: item.name || "",
      endpoint: endpointOf(item),
      floorCpm: item.floorCpm || "",
      timeoutMs: item.timeoutMs || "",
    }))
    .filter((item) => item.endpoint);

  return {
    configId,
    productVersion,
    rotationMode: body.rotationMode || "version-1-viewable-rotation",
    publisherId: setup.publisherId || "",
    publisherDomain: setup.publisherDomain || "",
    placementId: setup.placementId || (isNexSticky ? "bottom-sticky" : ""),
    width: Number(setup.width || (isNexSticky ? 320 : 300)),
    height: Number(setup.height || (isNexSticky ? 50 : 250)),
    mode: "video-first",
    vastDemand: vastDemandItems,
    vastTags: vastDemandItems.map((item) => item.endpoint),
    prebidDemand,
    prebidEndpoint: (prebidDemand[0] || {}).endpoint || "",
    prebidParams: (prebidDemand[0] || {}).params || "",
    displayScriptDemand,
    displayScriptUrls: displayScriptDemand.map((item) => item.endpoint),
    adserverScriptDemand,
    adserverScriptUrls: adserverScriptDemand.map((item) => item.endpoint),
    adserverHtmlDemand,
    adserverHtmlTags: adserverHtmlDemand.map((item) => item.html),
    displayEndpoint: endpointOf(demand.find((item) => item.type === "display") || {}) || "",
    ortbDemand,
    ortbEndpoints,
    ortbEndpoint: ortbEndpoints[0] || "",
    auctionEndpoint: "",
    trackUrl: `${apiBase}/api/v1/track`,
    rotationMs: Number(body.rotationMs || setup.rotationMs || 10000),
    displayImageUrl: body.displayImageUrl || setup.displayImageUrl || "",
    remnantImageUrl: fallbackImageUrl,
    logoText: "N",
    clickUrl: "https://nexbid.uk",
  };
}

function endpointOf(item) {
  return item.endpoint || item.url || item.tag || "";
}

function shortTag(configId, config) {
  const cdnScript = scriptForProduct(config.productVersion);
  return [
    `<script src="${cdnScript}"`,
    `  data-config-id="${configId}"`,
    `  data-publisher-id="${escapeAttr(config.publisherId || "")}"`,
    `  data-publisher-domain="${escapeAttr(config.publisherDomain || "")}"`,
    `  data-placement-id="${escapeAttr(config.placementId || "")}"`,
    `  data-api-base="https://nexbid.uk"></script>`,
  ].join("\n");
}

function scriptForProduct(productVersion) {
  if (productVersion === "Version 2 Testing") return "https://nexbid.uk/nexbanner/version-2-testing/src/nexbanner-gam.js";
  if (productVersion === "NexSticky") return "https://nexbid.uk/nexsticky/final/src/nexsticky-gam.js";
  return "https://nexbid.uk/nexbanner/final/src/nexbanner-gam.js";
}

function escapeAttr(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

function makeConfigId() {
  return `NBX-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 10000)}`;
}

function domainConfigId(body) {
  const setup = body.setup || {};
  const domain = String(setup.publisherDomain || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");

  if (!domain) return "";
  if (body.productVersion === "Version 2 Testing") return `${domain}-version-2-testing`;
  if (body.productVersion === "NexSticky") return `${domain}-nexsticky`;
  return domain;
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

function trimSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}
