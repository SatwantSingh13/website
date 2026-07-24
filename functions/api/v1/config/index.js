export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function onRequestPost(context) {
  try {
    const store = context.env.NEXBANNER_CONFIGS;
    if (!store || !store.put) {
      return json({ ok: false, error: "missing_NEXBANNER_CONFIGS_binding" }, 500);
    }
    let body = await context.request.json();
    if (body.legacyConfigId) {
      const legacyId = validateLegacyConfigId(body.legacyConfigId);
      let legacy = await store.get(legacyId, "json");
      if (!legacy && legacyId !== legacyId.toLowerCase()) {
        legacy = await store.get(legacyId.toLowerCase(), "json");
      }
      if (!legacy) return json({ ok: false, error: "legacy_config_not_found" }, 404);
      body = { ...legacy, ...body, setup: { ...(legacy.setup || legacy), ...(body.setup || {}) } };
    }
    const configId = sanitizeConfigId(body.configId || placementConfigId(body) || domainConfigId(body) || makeConfigId());
    const existing = await store.get(configId, "json");
    const configVersion = Math.max(1, Number(existing?.configVersion || 0) + 1);
    const config = normalizeConfig(configId, { ...body, configVersion });

    await store.put(configId, JSON.stringify(config));
    cacheConfig(context, configId, config);

    return json({
      ok: true,
      configId,
      configVersion,
      tag: shortTag(configId, config),
    });
  } catch (error) {
    return json({ ok: false, error: error.message || "invalid_config" }, 400);
  }
}

function cacheConfig(context, configId, config) {
  if (typeof caches === "undefined") return;
  const url = new URL(context.request.url);
  url.pathname = `${url.pathname.replace(/\/$/, "")}/${encodeURIComponent(configId)}`;
  url.search = "";
  const response = new Response(JSON.stringify(config), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=30, s-maxage=300, stale-while-revalidate=120",
      "etag": configEtag(config),
      "x-nexbanner-cache": "warm",
      ...corsHeaders(),
    },
  });
  const versioned = new URL(url);
  versioned.searchParams.set("v", String(config.configVersion || 1));
  context.waitUntil(Promise.all([
    caches.default.put(new Request(url.toString()), response.clone()),
    caches.default.put(new Request(versioned.toString()), response),
  ]));
}

function normalizeConfig(configId, body) {
  const setup = body.setup || {};
  const productVersion = body.productVersion || "Version 1";
  const commercialV1 = productVersion === "Version 1 Commercial Unified Auction" || body.preset === "v1-commercial-unified-auction";
  const safePricePriority = productVersion === "Version 1 Price Priority Safe" || body.preset === "gam-price-priority-production-safe";
  const isVersion2 = productVersion === "Version 2 Testing";
  const isNexSticky = productVersion === "NexSticky";
  const fallbackImageUrl = body.remnantImageUrl
    || body.displayImageUrl
    || setup.remnantImageUrl
    || setup.displayImageUrl
    || (isVersion2 ? "https://nexbid.b-cdn.net/assets/nexbid-test-display-300x250.png" : "");
  const demand = Array.isArray(body.demand) ? body.demand : [];
  const vast = Array.isArray(body.vast) ? body.vast : [];
  const legacyVast = Array.isArray(body.vastDemand) ? body.vastDemand : [];
  const displayTags = Array.isArray(body.displayTags) ? body.displayTags :
    (Array.isArray(body.displayScriptDemand) ? body.displayScriptDemand : []);
  const prebid = Array.isArray(body.prebid) ? body.prebid :
    (Array.isArray(body.prebidDemand) ? body.prebidDemand : []);
  const adserverTags = Array.isArray(body.adserverTags) ? body.adserverTags : [
    ...(Array.isArray(body.adserverScriptDemand) ? body.adserverScriptDemand : []).map((item) => ({ ...item, tagType: "script" })),
    ...(Array.isArray(body.adserverHtmlDemand) ? body.adserverHtmlDemand : []).map((item) => ({ ...item, tagType: "html" })),
  ];
  const apiBase = trimSlash(safeUrl(setup.apiBase || "https://nexbid.uk"));
  const vastDemand = demand.filter((item) => item.type === "vast").concat(vast, legacyVast);
  const prebidDemand = (commercialV1 ? [] : prebid).map((item) => ({
    name: item.name || "",
    endpoint: endpointOf(item) || `${apiBase}/api/v1/auction`,
    params: item.params || "",
    floorCpm: item.floorCpm || "",
    timeoutMs: item.timeoutMs || "",
  })).filter((item) => item.endpoint || item.params);
  const vastDemandItems = vastDemand.map((item) => ({
    name: item.name || "",
    endpoint: endpointOf(item),
    configuredBidCpm: item.configuredBidCpm || "",
    floorCpm: item.floorCpm || "",
    currency: item.currency || (commercialV1 ? "USD" : ""),
    timeoutMs: item.timeoutMs || "",
    allowVpaid: safePricePriority ? item.allowVpaid === true : item.allowVpaid !== false,
  })).filter((item) => item.endpoint);
  const displayScriptDemand = displayTags.map((item) => ({
    name: item.name || "",
    endpoint: endpointOf(item),
    configuredBidCpm: item.configuredBidCpm || "",
    floorCpm: item.floorCpm || "",
    currency: item.currency || (commercialV1 ? "USD" : ""),
    timeoutMs: item.timeoutMs || "",
  })).filter((item) => item.endpoint);
  const adserverScriptDemand = adserverTags
    .filter((item) => item.tagType === "script")
    .map((item) => ({
      name: item.name || "",
      endpoint: endpointOf(item),
      configuredBidCpm: item.configuredBidCpm || "",
      floorCpm: item.floorCpm || "",
      currency: item.currency || (commercialV1 ? "USD" : ""),
      timeoutMs: item.timeoutMs || "",
    }))
    .filter((item) => item.endpoint);
  const adserverHtmlDemand = adserverTags
    .filter((item) => item.tagType === "html")
    .map((item) => ({
      name: item.name || "",
      html: normalizeHtmlPayload(item.html || ""),
      configuredBidCpm: item.configuredBidCpm || "",
      floorCpm: item.floorCpm || "",
      currency: item.currency || (commercialV1 ? "USD" : ""),
      timeoutMs: item.timeoutMs || "",
    }))
    .filter((item) => item.html);
  const ortbEndpoints = demand
    .filter((item) => !commercialV1 && item.type === "ortb")
    .map(endpointOf)
    .filter(Boolean);
  const ortbDemand = demand
    .filter((item) => !commercialV1 && item.type === "ortb")
    .map((item) => ({
      name: item.name || "",
      endpoint: endpointOf(item),
      floorCpm: item.floorCpm || "",
      timeoutMs: item.timeoutMs || "",
    }))
    .concat(!commercialV1 && Array.isArray(body.ortbDemand) ? body.ortbDemand.map((item) => ({
      name: item.name || "",
      endpoint: endpointOf(item),
      floorCpm: item.floorCpm || "",
      timeoutMs: item.timeoutMs || "",
    })) : [])
    .filter((item) => item.endpoint);
  const displayDemand = demand
    .filter((item) => item.type === "display")
    .concat(Array.isArray(body.displayDemand) ? body.displayDemand : [])
    .map((item) => ({
      name: item.name || "",
      endpoint: endpointOf(item),
      timeoutMs: item.timeoutMs || "",
    }))
    .filter((item) => item.endpoint);

  return {
    configId,
    configVersion: Number(body.configVersion || 1),
    productVersion,
    rotationMode: commercialV1 ? "version-1-commercial-unified-auction" :
      safePricePriority ? "gam-price-priority-production-safe" : (body.rotationMode || "version-1-viewable-rotation"),
    publisherId: setup.publisherId || "",
    publisherDomain: setup.publisherDomain || "",
    placementId: setup.placementId || (isNexSticky ? "bottom-sticky" : ""),
    width: Number(setup.width || (isNexSticky ? 320 : 300)),
    height: Number(setup.height || (isNexSticky ? 50 : 250)),
    mode: "video-first",
    vastDemand: vastDemandItems,
    vastTags: vastDemandItems.map((item) => item.endpoint),
    prebidDemand,
    prebidEndpoint: (prebidDemand[0] || {}).endpoint || (isVersion2 ? `${apiBase}/api/v1/auction` : ""),
    prebidParams: (prebidDemand[0] || {}).params || "",
    displayScriptDemand,
    displayScriptUrls: displayScriptDemand.map((item) => item.endpoint),
    adserverScriptDemand,
    adserverScriptUrls: adserverScriptDemand.map((item) => item.endpoint),
    adserverHtmlDemand,
    adserverHtmlTags: adserverHtmlDemand.map((item) => item.html),
    displayDemand,
    displayEndpoint: (displayDemand[0] || {}).endpoint || "",
    ortbDemand,
    ortbEndpoints,
    ortbEndpoint: ortbEndpoints[0] || (isVersion2 ? `${apiBase}/api/v1/auction` : ""),
    auctionEndpoint: isVersion2 ? `${apiBase}/api/v1/auction` : "",
    trackUrl: `${apiBase}/api/v1/track`,
    vastResolverUrl: `${apiBase}/api/v1/vast/resolve`,
    serverSideVastResolution: safePricePriority ? true : body.serverSideVastResolution !== false,
    legacyBrowserVastFallback: safePricePriority ? false : body.legacyBrowserVastFallback === true,
    maxAuctionCycles: commercialV1 || safePricePriority ? 1 : Number(body.maxAuctionCycles || 1),
    internalRefresh: commercialV1 || safePricePriority ? false : body.internalRefresh === true,
    auctionBudgetMs: Number(body.auctionBudgetMs || setup.auctionBudgetMs || 1200),
    auctionTimeoutMs: Number(body.auctionTimeoutMs || setup.auctionTimeoutMs || (commercialV1 ? 900 : 1200)),
    partnerTimeoutMs: Number(body.partnerTimeoutMs || setup.partnerTimeoutMs || (commercialV1 ? 750 : 1200)),
    bidTtlMs: Number(body.bidTtlMs || setup.bidTtlMs || 5000),
    viewabilityThreshold: Number(body.viewabilityThreshold ?? setup.viewabilityThreshold ?? (commercialV1 ? 0.3 : safePricePriority ? 0.5 : 0.2)),
    viewabilityTimeMs: Number(body.viewabilityTimeMs ?? setup.viewabilityTimeMs ?? (commercialV1 ? 200 : safePricePriority ? 1000 : 0)),
    viewabilityWaitTimeoutMs: Number(body.viewabilityWaitTimeoutMs ?? setup.viewabilityWaitTimeoutMs ?? 15000),
    auctionOnViewabilityTimeout: body.auctionOnViewabilityTimeout === true,
    enablePassback: safePricePriority ? body.enablePassback !== false : body.enablePassback === true,
    passbackHtml: sanitizeHtmlPayload(body.passbackHtml || setup.passbackHtml || ""),
    passbackScriptUrl: safeUrl(body.passbackScriptUrl || setup.passbackScriptUrl || ""),
    passbackTimeoutMs: Number(body.passbackTimeoutMs || setup.passbackTimeoutMs || 2000),
    collapseOnPassbackFailure: body.collapseOnPassbackFailure === true,
    gamLineItemCpm: Number(body.gamLineItemCpm || setup.gamLineItemCpm || 0),
    minimumInternalCpm: Number(body.minimumInternalCpm || setup.minimumInternalCpm || 0),
    currency: String(commercialV1 ? "USD" : (body.currency || setup.currency || "INR")).toUpperCase().slice(0, 3),
    rejectBelowGamRate: safePricePriority ? body.rejectBelowGamRate !== false : body.rejectBelowGamRate === true,
    priceMismatchTolerance: Number(body.priceMismatchTolerance || setup.priceMismatchTolerance || 0),
    gamClickMacro: String(body.gamClickMacro || setup.gamClickMacro || ""),
    gamCachebuster: String(body.gamCachebuster || setup.gamCachebuster || ""),
    allowVpaid: safePricePriority ? body.allowVpaid === true : body.allowVpaid !== false,
    rotationMs: commercialV1 ? 0 : Number(body.rotationMs || setup.rotationMs || 10000),
    displayImageUrl: safeUrl(body.displayImageUrl || setup.displayImageUrl || ""),
    remnantImageUrl: safeUrl(fallbackImageUrl),
    logoText: "N",
    clickUrl: "https://nexbid.uk",
  };
}

function endpointOf(item) {
  return safeUrl(item.endpoint || item.url || item.tag || "");
}

function shortTag(configId, config) {
  const cdnScript = scriptForProduct(config.productVersion);
  return [
    `<script src="${cdnScript}"`,
    `  data-config-id="${configId}"`,
    `  data-publisher-id="${escapeAttr(config.publisherId || "")}"`,
    `  data-publisher-domain="${escapeAttr(config.publisherDomain || "")}"`,
    `  data-placement-id="${escapeAttr(config.placementId || "")}"`,
    `  data-width="${Number(config.width || 300)}"`,
    `  data-height="${Number(config.height || 250)}"`,
    `  data-config-version="${Number(config.configVersion || 1)}"`,
    `  data-gam-click="%%CLICK_URL_UNESC%%"`,
    `  data-gam-cachebuster="%%CACHEBUSTER%%"`,
    `  data-api-base="https://nexbid.uk"></script>`,
  ].join("\n");
}

function scriptForProduct(productVersion) {
  if (productVersion === "Version 1 Commercial Unified Auction") return "https://nexbid.uk/nbx/v1.js?v=20260724-6";
  if (productVersion === "Version 1 Price Priority Safe") return "https://nexbid.uk/nbx/v1-price-priority-safe.js?v=20260724-1";
  if (productVersion === "Version 2 Testing") return "https://nexbid.uk/nexbanner/version-2-testing/src/nexbanner-gam.js";
  if (productVersion === "NexSticky") return "https://nexbid.uk/nexsticky/final/src/nexsticky-gam.js";
  return "https://nexbid.uk/nbx/v1.js?v=20260713-5";
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

function placementConfigId(body) {
  const setup = body.setup || {};
  const safe = body.productVersion === "Version 1 Price Priority Safe" || body.preset === "gam-price-priority-production-safe";
  if (!safe) return "";
  const domain = normalizeDomain(setup.publisherDomain);
  const placement = String(setup.placementId || "").trim();
  if (!domain || !placement) return "";
  return `${domain}--${sanitizePart(placement)}--${Number(setup.width || 300)}x${Number(setup.height || 250)}--v1`;
}

function sanitizeConfigId(value) {
  const result = String(value || "").trim().toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/^-+|-+$/g, "")
    .slice(0, 180);
  if (!result || result.includes("..") || result.startsWith(".")) throw new Error("invalid_config_id");
  return result;
}

function validateLegacyConfigId(value) {
  const result = String(value || "").trim();
  if (!result || result.length > 180 || !/^[A-Za-z0-9._-]+$/.test(result) ||
      result.includes("..") || result.startsWith(".")) {
    throw new Error("invalid_config_id");
  }
  return result;
}

function sanitizePart(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "placement";
}

function normalizeDomain(value) {
  return String(value || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
}

function safeUrl(value) {
  if (!value) return "";
  const url = new URL(String(value));
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("unsafe_url");
  return url.toString();
}

function sanitizeHtmlPayload(value) {
  let html = String(value || "");
  if (!html.includes("<") && /%(?:3C|3E|22|27)/i.test(html)) {
    try { html = decodeURIComponent(html); } catch (_) {}
  }
  if (html.length > 100000) throw new Error("passback_html_too_large");
  if (/<(?:base|meta)\b[^>]*(?:http-equiv\s*=\s*["']?refresh|href\s*=)/i.test(html)) throw new Error("unsafe_passback_html");
  return encodeURIComponent(html);
}

function normalizeHtmlPayload(value) {
  let html = String(value || "");
  if (!html.includes("<") && /%(?:3C|3E|22|27)/i.test(html)) {
    try { html = decodeURIComponent(html); } catch (_) {}
  }
  if (html.length > 100000) throw new Error("creative_html_too_large");
  return encodeURIComponent(html);
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

function trimSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}
