(function () {
  "use strict";

  var script = document.currentScript;
  if (!script) return;

  var payload = readPayload(script);
  if (!payload) return;

  var slot = findSlot(script, payload);
  if (!slot) return;

  slot.style.width = payload.width + "px";
  slot.style.height = payload.height + "px";
  slot.style.overflow = "hidden";
  slot.style.position = "relative";

  track(payload, "prebid_render_start");
  loadNexBanner(payload, slot);

  function readPayload(node) {
    try {
      return JSON.parse(decodeURIComponent(node.getAttribute("data-nexbid-prebid") || ""));
    } catch (_) {
      return null;
    }
  }

  function findSlot(node, data) {
    var previous = node.previousElementSibling;
    if (previous && previous.className && String(previous.className).indexOf("nexbid-prebid-slot") >= 0) {
      return previous;
    }

    var fallback = document.createElement("div");
    fallback.className = "nexbid-prebid-slot";
    fallback.style.width = data.width + "px";
    fallback.style.height = data.height + "px";
    node.parentNode.insertBefore(fallback, node);
    return fallback;
  }

  function loadNexBanner(data, target) {
    var config = {
      configId: data.configId || "",
      publisherId: data.publisherId || "",
      publisherDomain: data.publisherDomain || "",
      placementId: data.placementId || "",
      apiBase: data.apiBase || "https://nexbid.uk",
      width: data.width || 300,
      height: data.height || 250,
      rotationMode: data.productVersion === 2
        ? "realtime-viewable-bidding"
        : "version-1-viewable-rotation",
      mode: data.mode || "video-first",
      trackUrl: trimSlash(data.apiBase || "https://nexbid.uk") + "/api/v1/track",
      logoText: "N",
      timeoutMs: 1800
    };

    if (window.NexBannerPlayer && window.NexBannerPlayer.mount) {
      window.NexBannerPlayer.mount(target, config);
      track(data, "prebid_render_mount");
      return;
    }

    var player = document.createElement("script");
    player.async = true;
    player.src = trimSlash(data.apiBase || "https://nexbid.uk") + playerPath(data);
    player.onload = function () {
      if (window.NexBannerPlayer && window.NexBannerPlayer.mount) {
        window.NexBannerPlayer.mount(target, config);
        track(data, "prebid_render_mount");
      } else {
        track(data, "prebid_render_error", { reason: "missing_player" });
      }
    };
    player.onerror = function () {
      track(data, "prebid_render_error", { reason: "player_load_failed" });
    };
    document.head.appendChild(player);
  }

  function playerPath(data) {
    return data.productVersion === 2
      ? "/nexbanner/version-2-testing/src/nexbanner-player.js"
      : "/nbx/player-v1.js";
  }

  function track(data, event, extra) {
    var apiBase = trimSlash(data.apiBase || "https://nexbid.uk");
    var url = apiBase + "/api/v1/track?event=" + encodeURIComponent(event)
      + "&layer=prebid"
      + "&config_id=" + encodeURIComponent(data.configId || "")
      + "&publisher_id=" + encodeURIComponent(data.publisherId || "")
      + "&publisher_domain=" + encodeURIComponent(data.publisherDomain || "")
      + "&placement_id=" + encodeURIComponent(data.placementId || "")
      + "&cpm=" + encodeURIComponent(data.cpm || "");
    if (extra && extra.reason) url += "&reason=" + encodeURIComponent(extra.reason);

    var img = new Image();
    img.src = url;
  }

  function trimSlash(value) {
    return String(value || "").replace(/\/+$/, "");
  }
})();

