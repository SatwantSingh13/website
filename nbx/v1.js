(function () {
  "use strict";

  var script = document.currentScript;
  if (!script) return;

  var config = readConfig(script);
  var target = resolveTarget(config, script);
  if (!target) return;

  preloadConfig(config);
  containFramedCreative(config);
  target.style.width = config.width + "px";
  target.style.height = config.height + "px";
  target.style.maxWidth = "100%";
  target.style.boxSizing = "border-box";
  target.style.overflow = "hidden";

  loadPlayer(script.src, function () {
    if (!window.NexBannerPlayer) return;
    window.NexBannerPlayer.mount(target, config);
  });

  function readConfig(node) {
    var data = node.dataset || {};
    return {
      publisherId: data.publisherId || "",
      publisherDomain: data.publisherDomain || "",
      placementId: data.placementId || "",
      configId: data.configId || "",
      configEndpoint: data.configEndpoint || "",
      apiBase: data.apiBase || "https://nexbid.uk",
      target: data.target || "",
      width: numberOr(data.width, 300),
      height: numberOr(data.height, 250),
      mode: data.mode || "video-first",
      rotationMs: numberOr(data.rotationMs, 10000),
      vastUrl: data.vastUrl || "",
      vastTags: splitList(data.vastTags),
      videoUrl: data.videoUrl || "",
      auctionEndpoint: data.auctionEndpoint || "",
      prebidEndpoint: data.prebidEndpoint || "",
      prebidParams: data.prebidParams || "",
      prebidDemand: parseJson(data.prebidDemand, []),
      displayEndpoint: data.displayEndpoint || "",
      displayScriptUrl: data.displayScriptUrl || "",
      displayScriptUrls: splitList(data.displayScriptUrls),
      adserverScriptUrls: splitList(data.adserverScriptUrls),
      adserverHtmlTags: splitList(data.adserverHtmlTags),
      ortbEndpoint: data.ortbEndpoint || "",
      ortbEndpoints: splitList(data.ortbEndpoints),
      displayImageUrl: data.displayImageUrl || "",
      remnantImageUrl: data.remnantImageUrl || "",
      clickUrl: data.clickUrl || "",
      logoUrl: data.logoUrl || "",
      logoText: data.logoText || "N",
      trackUrl: data.trackUrl || trimSlash(data.apiBase || "https://nexbid.uk") + "/api/v1/track",
      impressionUrl: data.impressionUrl || "",
      errorUrl: data.errorUrl || "",
      timeoutMs: numberOr(data.timeoutMs, 1800),
      configTimeoutMs: numberOr(data.configTimeoutMs, 3000),
      cachebuster: String(Date.now()) + Math.floor(Math.random() * 1000000)
    };
  }

  function preloadConfig(config) {
    if (!config.configId || !window.fetch) return;

    var endpoint = config.configEndpoint ||
      trimSlash(config.apiBase) + "/api/v1/config/" + encodeURIComponent(config.configId);
    var pending = fetch(endpoint, { credentials: "omit" }).then(function (response) {
      if (!response.ok) throw new Error("config-http-" + response.status);
      return response.json();
    });

    Object.defineProperty(config, "__configPromise", {
      configurable: false,
      enumerable: false,
      value: pending
    });
  }

  function resolveTarget(config, node) {
    if (config.target) {
      var found = document.getElementById(config.target);
      if (found) return found;
    }

    var fallback = document.createElement("div");
    fallback.id = "nexbanner-slot-" + config.cachebuster;
    node.parentNode.insertBefore(fallback, node);
    return fallback;
  }

  function containFramedCreative(config) {
    var framed = false;
    try { framed = window.self !== window.top; } catch (_) { framed = true; }
    if (!framed || window.innerWidth > config.width + 32) return;

    document.documentElement.style.margin = "0";
    document.documentElement.style.padding = "0";
    document.documentElement.style.overflow = "hidden";
    document.body.style.margin = "0";
    document.body.style.padding = "0";
    document.body.style.overflow = "hidden";
  }

  function loadPlayer(currentScriptUrl, done) {
    if (window.NexBannerPlayer) {
      done();
      return;
    }

    var loaderUrl = new URL(currentScriptUrl, window.location.href);
    var playerUrl = new URL("player-v1.js", loaderUrl);
    var version = loaderUrl.searchParams.get("v") || "20260713-2";
    playerUrl.searchParams.set("v", version);
    var playerScript = document.createElement("script");
    playerScript.async = true;
    playerScript.src = playerUrl.toString();
    playerScript.onload = done;
    playerScript.onerror = done;
    document.head.appendChild(playerScript);
  }

  function numberOr(value, fallback) {
    var parsed = parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function splitList(value) {
    return String(value || "")
      .split("|")
      .map(function (item) { return item.trim(); })
      .filter(Boolean);
  }

  function parseJson(value, fallback) {
    if (!value) return fallback;
    try {
      return JSON.parse(decodeURIComponent(value));
    } catch (_) {
      return fallback;
    }
  }
  function trimSlash(value) {
    return String(value || "").replace(/\/+$/, "");
  }
})();

