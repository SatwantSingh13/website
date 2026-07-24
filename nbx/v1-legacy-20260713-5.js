(function () {
  "use strict";

  var script = document.currentScript;
  if (!script) return;
  var data = script.dataset || {};
  var config = {
    configId: data.configId || "",
    configVersion: data.configVersion || "",
    publisherId: data.publisherId || "",
    publisherDomain: data.publisherDomain || "",
    placementId: data.placementId || "",
    width: number(data.width, 300),
    height: number(data.height, 250),
    apiBase: trim(data.apiBase || "https://nexbid.uk"),
    target: data.target || "",
    gamClickMacro: data.gamClick || "",
    gamCachebuster: data.gamCachebuster || "",
    passbackHtml: data.passbackHtml || "",
    passbackScriptUrl: data.passbackScriptUrl || "",
    passbackTimeoutMs: number(data.passbackTimeoutMs, 2000),
    enablePassback: boolean(data.enablePassback, false),
    collapseOnPassbackFailure: boolean(data.collapseOnPassbackFailure, false),
    viewabilityThreshold: decimal(data.viewabilityThreshold, 0.5),
    viewabilityTimeMs: number(data.viewabilityTimeMs, 1000),
    viewabilityWaitTimeoutMs: number(data.viewabilityWaitTimeoutMs, 15000),
    auctionOnViewabilityTimeout: boolean(data.auctionOnViewabilityTimeout, false),
    serverSideVastResolution: boolean(data.serverSideVastResolution, true),
    legacyBrowserVastFallback: boolean(data.legacyBrowserVastFallback, true),
    gamLineItemCpm: decimal(data.gamLineItemCpm, 0),
    minimumInternalCpm: decimal(data.minimumInternalCpm, 0),
    currency: data.currency || "INR",
    rejectBelowGamRate: boolean(data.rejectBelowGamRate, true),
    priceMismatchTolerance: decimal(data.priceMismatchTolerance, 0),
    allowVpaid: boolean(data.allowVpaid, false),
    cachebuster: data.gamCachebuster || String(Date.now())
  };

  var target = config.target ? document.getElementById(config.target) : null;
  if (!target) {
    target = document.createElement("div");
    target.id = "nbx-safe-" + Math.random().toString(36).slice(2);
    script.parentNode.insertBefore(target, script);
  }
  containFramedCreative(config);
  target.style.cssText = "width:" + config.width + "px;height:" + config.height + "px;max-width:100%;overflow:hidden;box-sizing:border-box;background:transparent";

  var player = new URL("v1-price-priority-safe-player.mjs", script.src);
  player.searchParams.set("v", "20260724-3");
  var module = document.createElement("script");
  module.type = "module";
  module.src = player.toString();
  module.onload = function () {
    if (window.NexBannerPricePrioritySafe) window.NexBannerPricePrioritySafe.mount(target, config);
  };
  module.onerror = function () { target.setAttribute("data-nbx-state", "error"); };
  document.head.appendChild(module);

  function number(value, fallback) {
    var parsed = parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  function decimal(value, fallback) {
    var parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  function boolean(value, fallback) {
    if (value === undefined || value === "") return fallback;
    return String(value).toLowerCase() === "true";
  }
  function containFramedCreative(value) {
    var framed = false;
    try { framed = window.self !== window.top; } catch (_) { framed = true; }
    if (!framed || window.innerWidth > value.width + 32) return;
    document.documentElement.style.cssText += ";margin:0;padding:0;overflow:hidden";
    if (document.body) document.body.style.cssText += ";margin:0;padding:0;overflow:hidden";
  }
  function trim(value) { return String(value || "").replace(/\/+$/, ""); }
})();
