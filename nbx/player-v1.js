(function () {
  "use strict";

  window.NexBannerPlayer = { mount: mount };

  function mount(target, config) {
    config.requestId = config.requestId || makeRequestId();
    config.__requestFilledTracked = false;
    track(config, "ad_request", { layer: "gam-entry" });
    loadConfig(config)
      .then(function (resolvedConfig) {
        preconnectDemand(resolvedConfig);
        var root = buildShell(target, resolvedConfig);
        startViewableRotation(root, resolvedConfig);
      })
      .catch(function () {
        preconnectDemand(config);
        var root = buildShell(target, config);
        track(config, "config_error", { layer: "config" });
        startViewableRotation(root, config);
      });
  }

  function loadConfig(config) {
    if (!config.configId) return Promise.resolve(config);

    var endpoint = config.configEndpoint ||
      trimSlash(config.apiBase || "https://nexbid.uk") + "/api/v1/config/" + encodeURIComponent(config.configId);
    var remoteConfig = config.__configPromise || fetch(endpoint, { credentials: "omit" })
      .then(function (response) {
        if (!response.ok) throw new Error("config-http-" + response.status);
        return response.json();
      });

    return withTimeout(remoteConfig, config.configTimeoutMs || 3000)
      .then(function (remoteConfig) {
        return mergeConfig(config, remoteConfig || {});
      });
  }

  function mergeConfig(base, remote) {
    var merged = {};
    Object.keys(base || {}).forEach(function (key) { merged[key] = base[key]; });
    Object.keys(remote || {}).forEach(function (key) {
      if (remote[key] !== undefined && remote[key] !== null && remote[key] !== "") merged[key] = remote[key];
    });
    merged.vastTags = listFrom(merged.vastTags);
    merged.vastDemand = arrayFrom(merged.vastDemand);
    merged.displayScriptUrls = listFrom(merged.displayScriptUrls);
    merged.displayScriptDemand = arrayFrom(merged.displayScriptDemand);
    merged.adserverScriptUrls = listFrom(merged.adserverScriptUrls);
    merged.adserverScriptDemand = arrayFrom(merged.adserverScriptDemand);
    merged.adserverHtmlTags = listFrom(merged.adserverHtmlTags);
    merged.adserverHtmlDemand = arrayFrom(merged.adserverHtmlDemand);
    merged.prebidDemand = arrayFrom(merged.prebidDemand);
    merged.ortbDemand = arrayFrom(merged.ortbDemand);
    merged.ortbEndpoints = listFrom(merged.ortbEndpoints);
    return merged;
  }

  function startViewableRotation(root, config) {
    var state = {
      active: true,
      visible: false,
      timer: null,
      currentLayer: "",
      running: true,
      pendingRestart: false,
      durationMs: numberValue(config.rotationMs, 10000),
      minRenderMs: Math.max(5000, numberValue(config.minRenderMs, 5000)),
      hasRenderedAd: false,
      renderStartedAt: 0
    };
    root.__nbxRotation = state;

    state.advance = function (reason) {
      if (reason) track(config, "rotation_advance", { layer: state.currentLayer, reason: reason });
      clearTimer(state);
      state.nextIndex = (state.nextIndex || 0) + 1;
      waitForMinimumRender(state, function () {
        runRotationStep(root, config, state, state.nextIndex);
      });
    };

    function markVisible() {
      if (state.visible) return;
      state.visible = true;
      track(config, "viewable_start", { layer: "viewability" });
      if (state.pendingRestart && !state.running) {
        state.pendingRestart = false;
        state.nextIndex = 0;
        startHybridCycle(root, config, state);
      }
    }

    function markHidden() {
      if (!state.visible) return;
      state.visible = false;
      if (!state.running) {
        clearTimer(state);
        state.pendingRestart = true;
      }
      track(config, "viewable_pause", { layer: "viewability" });
    }

    if (!("IntersectionObserver" in window)) {
      state.visible = true;
    } else {
      var observer = new IntersectionObserver(function (entries) {
        var entry = entries[0];
        if (entry && entry.isIntersecting && entry.intersectionRatio >= 0.5) markVisible();
        else markHidden();
      }, { threshold: [0, 0.5, 1] });

      observer.observe(root);
    }

    state.nextIndex = 0;
    track(config, "waterfall_initial_request", { layer: "vast" });
    startHybridCycle(root, config, state);
  }

  function startHybridCycle(root, config, state) {
    if (!state.active) return;
    state.running = true;
    state.currentLayer = "vast";
    state.nextIndex = 0;
    state.cycleId = (state.cycleId || 0) + 1;
    var cycleId = state.cycleId;
    var graceMs = Math.max(0, numberValue(config.vastGraceMs, 800));

    setStatus(root, "", true);

    var vastOutcome = fetchVast(config)
      .then(function (vast) {
        if (!vast || !vast.mediaUrl) throw new Error("no-valid-vast");
        warmVastMedia(vast, config);
        return { ad: vast, error: null };
      })
      .catch(function (error) {
        track(config, "video_no_fill", { layer: "vast", reason: error.message });
        return { ad: null, error: error };
      });

    var displayOutcome = fetchPreparedDisplay(config);
    var grace = new Promise(function (resolve) {
      window.setTimeout(function () { resolve({ type: "grace" }); }, graceMs);
    });

    Promise.race([
      vastOutcome.then(function (outcome) { return { type: "vast", outcome: outcome }; }),
      grace
    ]).then(function (decision) {
      if (!state.active || state.cycleId !== cycleId) return;

      function useVast(outcome) {
        if (!state.active || state.cycleId !== cycleId) return;
        if (outcome && outcome.ad) {
          renderPreparedVideo(root, config, state, outcome.ad, displayOutcome, cycleId);
        } else {
          displayOutcome.then(useDisplay);
        }
      }

      function useDisplay(prepared) {
        if (!state.active || state.cycleId !== cycleId) return;
        if (prepared && prepared.ad) {
          renderPreparedDisplay(root, config, state, prepared, vastOutcome, cycleId);
          return;
        }

        vastOutcome.then(function (outcome) {
          if (!state.active || state.cycleId !== cycleId) return;
          if (outcome.ad) {
            renderPreparedVideo(root, config, state, outcome.ad, Promise.resolve(prepared), cycleId);
          } else {
            runRotationStep(root, config, state, 4);
          }
        });
      }

      if (decision.type === "vast") {
        useVast(decision.outcome);
        return;
      }

      Promise.race([
        vastOutcome.then(function (outcome) { return { type: "vast", value: outcome }; }),
        displayOutcome.then(function (prepared) { return { type: "display", value: prepared }; })
      ]).then(function (ready) {
        if (ready.type === "vast") useVast(ready.value);
        else useDisplay(ready.value);
      });
    });
  }

  function fetchPreparedDisplay(config) {
    return fetchPrebidDecision(config)
      .then(function (ad) {
        return { ad: ad, name: "prebid", layerIndex: 1, nextIndex: 2 };
      })
      .catch(function (error) {
        track(config, "prebid_no_fill", { layer: "prebid", reason: error.message });
        return fetchAdserverDecision(config).then(function (ad) {
          return { ad: ad, name: "adserver", layerIndex: 2, nextIndex: 3 };
        });
      })
      .catch(function (error) {
        track(config, "adserver_no_fill", { layer: "adserver", reason: error.message });
        return fetchRemnantDecision(config).then(function (ad) {
          return { ad: ad, name: "ortb", layerIndex: 3, nextIndex: 4 };
        });
      })
      .catch(function (error) {
        track(config, "final_no_fill", { layer: "ortb", reason: error.message });
        return { ad: null, name: "", layerIndex: 3, nextIndex: 4 };
      });
  }

  function renderPreparedVideo(root, config, state, vast, displayOutcome, cycleId) {
    if (!state.active || state.cycleId !== cycleId) return;
    state.currentLayer = "vast";
    state.nextIndex = 0;
    track(config, "rotation_layer_filled", { layer: "vast", cpm: vast.cpm || vast.nbxRankCpm || "" });

    renderVideo(root, config, vast, function () {
      if (!state.active || state.cycleId !== cycleId) return;
      displayOutcome.then(function (prepared) {
        if (!state.active || state.cycleId !== cycleId) return;
        if (prepared && prepared.ad) {
          renderPreparedDisplay(root, config, state, prepared, null, cycleId);
        } else {
          runRotationStep(root, config, state, 4);
        }
      });
    });
  }

  function renderPreparedDisplay(root, config, state, prepared, pendingVastOutcome, cycleId) {
    if (!state.active || state.cycleId !== cycleId) return;
    state.currentLayer = prepared.name;
    state.nextIndex = prepared.layerIndex;
    renderDisplay(root, config, prepared.ad);
    track(config, "rotation_layer_filled", {
      layer: prepared.name,
      cpm: prepared.ad.cpm || prepared.ad.nbxRankCpm || ""
    });

    clearTimer(state);
    state.timer = window.setTimeout(function () {
      if (!state.active || state.cycleId !== cycleId) return;
      if (!pendingVastOutcome) {
        runRotationStep(root, config, state, prepared.nextIndex);
        return;
      }

      pendingVastOutcome.then(function (outcome) {
        if (!state.active || state.cycleId !== cycleId) return;
        if (!outcome.ad) {
          runRotationStep(root, config, state, prepared.nextIndex);
          return;
        }

        state.currentLayer = "vast";
        state.nextIndex = Math.max(0, prepared.nextIndex - 1);
        track(config, "rotation_layer_filled", { layer: "vast", cpm: outcome.ad.cpm || outcome.ad.nbxRankCpm || "" });
        renderVideo(root, config, outcome.ad, function () {
          if (!state.active || state.cycleId !== cycleId) return;
          runRotationStep(root, config, state, prepared.nextIndex);
        });
      });
    }, Math.max(state.durationMs, state.minRenderMs));
  }

  function runRotationStep(root, config, state, index) {
    if (!state.active) return;
    state.running = true;

    var layers = [
      {
        name: "vast",
        status: "Running VAST auction",
        noFill: "video_no_fill",
        fetch: function () { return fetchVast(config); },
        render: function (vast, done) { renderVideo(root, config, vast, done); },
        waitForDone: true
      },
      {
        name: "prebid",
        status: "Running Prebid auction",
        noFill: "prebid_no_fill",
        fetch: function () { return fetchPrebidDecision(config); },
        render: function (ad) { renderDisplay(root, config, ad); }
      },
      {
        name: "adserver",
        status: "Running GAM / MI / JS layer",
        noFill: "adserver_no_fill",
        fetch: function () { return fetchAdserverDecision(config); },
        render: function (ad) { renderDisplay(root, config, ad); },
        holdMs: Math.max(30000, numberValue(config.adserverHoldMs, 30000))
      },
      {
        name: "ortb",
        status: "Running ORTB fallback auction",
        noFill: "final_no_fill",
        fetch: function () { return fetchRemnantDecision(config); },
        render: function (ad) { renderDisplay(root, config, ad); }
      }
    ];

    if (index >= layers.length) {
      track(config, "rotation_cycle_complete", { layer: "rotation" });
      state.running = false;
      state.nextIndex = 0;
      if (state.visible) {
        state.timer = window.setTimeout(function () {
          startHybridCycle(root, config, state);
        }, 300);
      } else {
        state.pendingRestart = true;
      }
      return;
    }

    var layer = layers[index];
    state.currentLayer = layer.name;
    state.nextIndex = index;
    setStatus(root, layer.status, true);

    layer.fetch()
      .then(function (ad) {
        if (!state.active) return;
        if (!ad) throw new Error("empty-" + layer.name);
        layer.render(ad, function () {
          if (!state.active) return;
          waitForMinimumRender(state, function () {
            runRotationStep(root, config, state, index + 1);
          });
        });
        track(config, "rotation_layer_filled", { layer: layer.name, cpm: ad.cpm || ad.nbxRankCpm || "" });
        if (layer.waitForDone) return;
        state.timer = window.setTimeout(function () {
          runRotationStep(root, config, state, index + 1);
        }, holdDuration(layer, state));
      })
      .catch(function (error) {
        if (!state.active) return;
        track(config, layer.noFill, { layer: layer.name, reason: error.message });
        runRotationStep(root, config, state, index + 1);
      });
  }

  function clearTimer(state) {
    if (state.timer) window.clearTimeout(state.timer);
    state.timer = null;
  }

  function markRenderStart(root) {
    if (root.__nbxRotation) {
      root.__nbxRotation.hasRenderedAd = true;
      root.__nbxRotation.renderStartedAt = Date.now();
    }
  }

  function waitForMinimumRender(state, callback) {
    var elapsed = Date.now() - (state.renderStartedAt || Date.now());
    var waitMs = Math.max(0, state.minRenderMs - elapsed);
    if (!waitMs) {
      callback();
      return;
    }
    clearTimer(state);
    state.timer = window.setTimeout(callback, waitMs);
  }

  function holdDuration(layer, state) {
    return Math.max(numberValue(layer.holdMs, state.durationMs), state.durationMs, state.minRenderMs);
  }

  function runVideoFirst(root, config) {
    setStatus(root, "Checking video demand");
    fetchVast(config)
      .then(function (vast) {
        if (!vast || !vast.mediaUrl) throw new Error("no-valid-vast");
        renderVideo(root, config, vast);
      })
      .catch(function (error) {
        track(config, "video_no_fill", { reason: error.message });
        runPrebid(root, config);
      });
  }

  function runPrebid(root, config) {
    setStatus(root, "Checking Prebid demand");
    fetchPrebidDecision(config)
      .then(function (ad) {
        if (!ad) throw new Error("no-prebid-ad");
        renderDisplay(root, config, ad);
      })
      .catch(function (error) {
        track(config, "prebid_no_fill", { reason: error.message });
        runAdserver(root, config);
      });
  }

  function runAdserver(root, config) {
    setStatus(root, "Checking ad server demand");
    fetchAdserverDecision(config)
      .then(function (ad) {
        if (!ad) throw new Error("no-adserver-ad");
        renderDisplay(root, config, ad);
      })
      .catch(function (error) {
        track(config, "adserver_no_fill", { reason: error.message });
        runRemnant(root, config);
      });
  }

  function runDisplay(root, config) {
    setStatus(root, "Checking display demand");
    fetchDisplayDecision(config)
      .then(function (ad) {
        if (!ad) throw new Error("no-display-ad");
        renderDisplay(root, config, ad);
      })
      .catch(function (error) {
        track(config, "display_no_fill", { reason: error.message });
        runRemnant(root, config);
      });
  }

  function runRemnant(root, config) {
    setStatus(root, "Checking final fallback");
    fetchRemnantDecision(config)
      .then(function (ad) {
        if (!ad) throw new Error("no-remnant-ad");
        renderDisplay(root, config, ad);
      })
      .catch(function (error) {
        track(config, "final_no_fill", { reason: error.message });
        renderNoAd(root, config);
      });
  }

  function fetchVast(config) {
    if (config.videoUrl) {
      return Promise.resolve({
        mediaUrl: resolveUrl(config.videoUrl, window.location.href),
        clickUrl: config.clickUrl,
        impressionUrl: config.impressionUrl,
        tracking: {},
        layer: "premium-vast-demo"
      });
    }

    var vastTags = auctionItems(config.vastDemand, "endpoint");
    listFrom(config.vastTags).forEach(function (url) {
      vastTags.push({ endpoint: url, timeoutMs: config.timeoutMs });
    });
    if (config.vastUrl) vastTags.push({ endpoint: config.vastUrl, timeoutMs: config.timeoutMs });
    vastTags = uniqueDemand(vastTags, "endpoint");
    if (!vastTags.length) return Promise.reject(new Error("missing-vast-url"));

    return auctionVastTags(vastTags, config);
  }

  function auctionVastTags(vastTags, config) {
    return Promise.all(vastTags.map(function (vastItem, index) {
      return fetchVastTag(vastItem, config)
        .then(function (vast) {
          vast.sourceName = vastItem.name || "VAST";
          vast.cpm = numberValue(vastItem.floorCpm, numberValue(vastItem.priority, 0));
          return {
            vast: vast,
            index: index,
            rank: numberValue(vastItem.floorCpm, numberValue(vastItem.priority, 0))
          };
        })
        .catch(function (error) {
          track(config, "vast_tag_failed", {
            layer: "premium-vast",
            partnerName: vastItem.name || "VAST",
            reason: error.message
          });
          return null;
        });
    })).then(function (results) {
      var winners = results.filter(Boolean).sort(function (a, b) {
        return b.rank - a.rank || a.index - b.index;
      });
      if (!winners.length) throw new Error("all-vast-no-fill");
      return winners[0].vast;
    });
  }

  function fetchVastTag(vastItem, config) {
    var vastTmax = numberValue(vastItem.timeoutMs, config.timeoutMs || 1800);
    var vastUrl = expandMacros(vastItem.endpoint || vastItem, config, vastTmax);
    track(config, "partner_request", {
      layer: "vast",
      partnerName: vastItem.name || "VAST"
    });

    return withTimeout(fetch(vastUrl, { credentials: "omit" }), vastTmax)
      .then(function (response) {
        if (!response.ok) throw new Error("vast-http-" + response.status);
        return response.text();
      })
      .then(function (xmlText) {
        var xml = new DOMParser().parseFromString(xmlText, "text/xml");
        if (xml.querySelector("parsererror")) throw new Error("vast-parse-error");

        var media = supportedVastMedia(xml);
        if (!media) throw new Error("vast-no-supported-video-media");

        return {
          mediaUrl: resolveUrl(media.url, vastUrl),
          mediaType: media.type,
          clickUrl: firstText(xml, "ClickThrough") || config.clickUrl,
          impressionUrl: firstText(xml, "Impression"),
          tracking: trackingEvents(xml),
          layer: "premium-vast",
          sourceUrl: vastUrl
        };
      });
  }

  function fetchPrebidDecision(config) {
    var demand = arrayFrom(config.prebidDemand).map(function (item) {
      return {
        endpoint: item.endpoint || config.auctionEndpoint,
        params: item.params || ""
      };
    });

    if (config.prebidEndpoint) {
      demand.push({ endpoint: config.prebidEndpoint, params: config.prebidParams || "" });
    }
    if (config.auctionEndpoint && config.prebidParams) {
      demand.push({ endpoint: config.auctionEndpoint, params: config.prebidParams });
    }

    demand = auctionItems(demand, "endpoint");
    if (!demand.length) return Promise.reject(new Error("missing-prebid-demand"));
    return auctionJsonDemand(demand, config, "prebid");
  }

  function fetchAdserverDecision(config) {
    var scripts = auctionItems(config.displayScriptDemand, "endpoint")
      .concat(auctionItems(config.adserverScriptDemand, "endpoint"));
    listFrom(config.displayScriptUrls).forEach(function (url) {
      scripts.push({ endpoint: url, floorCpm: 0 });
    });
    listFrom(config.adserverScriptUrls).forEach(function (url) {
      scripts.push({ endpoint: url, floorCpm: 0 });
    });
    scripts = auctionItems(scripts, "endpoint");
    var htmlTags = auctionItems(config.adserverHtmlDemand, "html");
    listFrom(config.adserverHtmlTags).forEach(function (html) {
      htmlTags.push({ html: html, floorCpm: 0 });
    });
    htmlTags = auctionItems(htmlTags, "html");

    if (config.displayScriptUrl) scripts.unshift({ endpoint: config.displayScriptUrl, floorCpm: 0 });

    var candidates = htmlTags.map(function (item) {
      return {
        adType: "adserver-html",
        html: decodePayload(item.html),
        layer: "adserver-html-tag",
        sourceName: item.name || "MI HTML",
        cpm: numberValue(item.floorCpm, 0),
        timeoutMs: numberValue(item.timeoutMs, config.timeoutMs)
      };
    }).concat(scripts.map(function (item) {
      return {
        adType: "display-js",
        scriptUrl: item.endpoint || item,
        layer: "adserver-js-tag",
        sourceName: item.name || "Display JS",
        cpm: numberValue(item.floorCpm, 0),
        timeoutMs: numberValue(item.timeoutMs, config.timeoutMs)
      };
    }));

    if (!candidates.length) return Promise.reject(new Error("missing-adserver-tags"));

    var cursor = numberValue(config.__adserverCursor, 0);
    config.__adserverCursor = cursor + 1;
    var selected = candidates[cursor % candidates.length];
    track(config, "partner_request", {
      layer: "adserver",
      partnerName: selected.sourceName
    });
    return Promise.resolve(selected);
  }

  function tryScriptTags(scripts, index) {
    if (index >= scripts.length) return Promise.reject(new Error("all-adserver-tags-failed"));
    return Promise.resolve({
      adType: "display-js",
      scriptUrl: scripts[index],
      layer: index === 0 ? "display-js-tag" : "adserver-js-tag"
    });
  }

  function fetchDisplayDecision(config) {
    if (config.displayScriptUrl) {
      return Promise.resolve({
        adType: "display-js",
        scriptUrl: config.displayScriptUrl,
        clickUrl: config.clickUrl,
        layer: "display-js-tag"
      });
    }

    if (config.auctionEndpoint) return jsonEndpoint(config.auctionEndpoint, config, "premium-display");
    if (config.displayEndpoint) return jsonEndpoint(config.displayEndpoint, config, "premium-display");
    if (!config.displayImageUrl) return Promise.reject(new Error("missing-display-demand"));
    return Promise.resolve({
      adType: "display",
      imageUrl: config.displayImageUrl,
      clickUrl: config.clickUrl,
      impressionUrl: config.impressionUrl,
      layer: "premium-display-demo"
    });
  }

  function fetchRemnantDecision(config) {
    var demand = auctionItems(config.ortbDemand, "endpoint");
    var endpoints = demand.slice();
    listFrom(config.ortbEndpoints).forEach(function (endpoint) { endpoints.push(endpoint); });
    if (config.ortbEndpoint) endpoints.push(config.ortbEndpoint);
    if (config.auctionEndpoint) endpoints.push(config.auctionEndpoint);
    endpoints = uniqueDemand(endpoints.map(function (item) {
      return typeof item === "string" ? { endpoint: item, timeoutMs: config.timeoutMs } : item;
    }), "endpoint");
    if (endpoints.length) {
      return auctionJsonDemand(endpoints.map(function (item) {
        return { name: item.name, endpoint: item.endpoint, params: "", timeoutMs: item.timeoutMs, floorCpm: item.floorCpm };
      }), config, "remnant-ortb").catch(function (error) {
        if (!config.remnantImageUrl) throw error;
        track(config, "remnant_auction_no_fill", { layer: "remnant-ortb", reason: error.message });
        return {
          adType: "display",
          imageUrl: config.remnantImageUrl,
          clickUrl: config.clickUrl,
          layer: "remnant-house"
        };
      });
    }
    if (!config.remnantImageUrl) return Promise.reject(new Error("missing-remnant-demand"));
    return Promise.resolve({
      adType: "display",
      imageUrl: config.remnantImageUrl,
      clickUrl: config.clickUrl,
      layer: "remnant-demo"
    });
  }

  function auctionJsonDemand(demand, config, layer) {
    var bids = demand.map(function (item) {
      var partnerName = item.name || layer;
      track(config, "partner_request", { layer: layer, partnerName: partnerName });
      return jsonEndpoint(item.endpoint, config, layer, item.params, item.timeoutMs)
        .then(function (ad) {
          ad.nbxEndpoint = item.endpoint;
          ad.nbxRankCpm = numberValue(ad.cpm, item.floorCpm);
          ad.sourceName = ad.sourceName || partnerName;
          return ad;
        })
        .catch(function (error) {
          track(config, layer + "_endpoint_failed", { layer: layer, reason: error.message });
          return null;
        });
    });

    return Promise.all(bids).then(function (ads) {
      var winners = ads.filter(Boolean).sort(function (a, b) {
        return numberValue(b.nbxRankCpm, 0) - numberValue(a.nbxRankCpm, 0);
      });
      if (!winners.length) throw new Error("all-" + layer + "-no-fill");
      return winners[0];
    });
  }

  function jsonEndpoint(endpoint, config, layer, prebidParams, timeoutMs) {
    var tmax = numberValue(timeoutMs, config.timeoutMs || 1800);
    var url = new URL(expandMacros(endpoint, config, tmax), window.location.href);
    url.searchParams.set("publisher_id", config.publisherId);
    url.searchParams.set("publisher_domain", config.publisherDomain || domainFromPage());
    url.searchParams.set("placement_id", config.placementId);
    url.searchParams.set("w", config.width);
    url.searchParams.set("h", config.height);
    url.searchParams.set("cb", config.cachebuster);
    url.searchParams.set("tmax", tmax);
    url.searchParams.set("layer", layer);
    url.searchParams.set("page", safePageUrl());
    if (layer === "prebid" && (prebidParams || config.prebidParams)) {
      url.searchParams.set("prebid_params", prebidParams || config.prebidParams);
    }

    return withTimeout(fetch(url.toString(), { credentials: "omit" }), tmax)
      .then(function (response) {
        if (!response.ok) throw new Error(layer + "-http-" + response.status);
        return response.json();
      })
      .then(function (ad) {
        if (!ad || (!ad.imageUrl && !ad.html && !ad.scriptUrl)) throw new Error(layer + "-empty");
        ad.layer = ad.layer || layer;
        return ad;
      });
  }

  function renderVideo(root, config, vast, onDone) {
    clear(root);
    markRenderStart(root);

    var link = document.createElement("a");
    link.href = vast.clickUrl || config.clickUrl || "#";
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.className = "nbx-click";

    var video = vast.__nbxPreloadedVideo || document.createElement("video");
    vast.__nbxPreloadedVideo = null;
    if (!video.src) video.src = vast.mediaUrl;
    video.width = config.width;
    video.height = config.height;
    video.muted = true;
    video.autoplay = true;
    video.playsInline = true;
    video.controls = false;
    video.preload = "auto";
    video.className = "nbx-video";

    var label = document.createElement("div");
    label.className = "nbx-label";
    label.textContent = "Ad";

    var fired = {};
    video.addEventListener("playing", function () {
      if (!fired.impression) {
        fired.impression = true;
        recordDeliveredImpression(config, vast.layer, vast.sourceName || "VAST", vast.cpm || vast.nbxRankCpm || "");
        pixel(vast.impressionUrl);
      }
      fireOnce(fired, "start", vast, config);
    });
    video.addEventListener("timeupdate", function () {
      var ratio = video.duration ? video.currentTime / video.duration : 0;
      if (ratio >= 0.25) fireOnce(fired, "firstQuartile", vast, config);
      if (ratio >= 0.5) fireOnce(fired, "midpoint", vast, config);
      if (ratio >= 0.75) fireOnce(fired, "thirdQuartile", vast, config);
    });
    video.addEventListener("ended", function () {
      fireOnce(fired, "complete", vast, config);
      if (typeof onDone === "function") onDone();
    });
    video.addEventListener("error", function () {
      track(config, "video_error", { layer: vast.layer });
      advanceRotation(root, "video_error");
    });

    link.appendChild(video);
    root.appendChild(link);
    root.appendChild(brandBadge(config));
    root.appendChild(label);

    var playResult = video.play();
    if (playResult && typeof playResult.catch === "function") {
      playResult.catch(function () {
        track(config, "autoplay_blocked", { layer: vast.layer });
        advanceRotation(root, "autoplay_blocked");
      });
    }
  }

  function renderDisplay(root, config, ad) {
    clear(root);
    markRenderStart(root);

    if (ad.html) {
      var frame = document.createElement("iframe");
      frame.title = "NexBanner ad";
      frame.width = config.width;
      frame.height = config.height;
      frame.setAttribute("scrolling", "no");
      frame.setAttribute("frameborder", "0");
      frame.className = "nbx-frame";
      root.appendChild(frame);
      watchAdFrame(root, frame, config, ad);
      var html = [
        "<!doctype html>",
        "<html><head><meta charset=\"utf-8\">",
        "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">",
        "<style>",
        "html,body{margin:0!important;padding:0!important;width:" + config.width + "px;height:" + config.height + "px;overflow:hidden;background:transparent}",
        "#gpt-passback{margin:0!important;padding:0!important;width:" + config.width + "px;height:" + config.height + "px;overflow:hidden}",
        "iframe{display:block;margin:0;border:0;max-width:100%}",
        "</style></head><body>",
        frameMonitorScript(frame.__nbxMonitorToken, ad.html.indexOf("googletag") >= 0, ad.timeoutMs || config.timeoutMs),
        ad.html,
        "</body></html>"
      ].join("");
      frame.contentWindow.document.open();
      frame.contentWindow.document.write(html);
      frame.contentWindow.document.close();
      root.appendChild(brandBadge(config));
      return;
    }

    if (ad.scriptUrl) {
      renderDisplayScript(root, config, ad);
      return;
    }

    var link = document.createElement("a");
    link.href = ad.clickUrl || config.clickUrl || "#";
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.className = "nbx-click";

    var image = document.createElement("img");
    image.src = ad.imageUrl;
    image.width = config.width;
    image.height = config.height;
    image.alt = "Advertisement";
    image.className = "nbx-image";
    image.onload = function () {
      recordDeliveredImpression(
        config,
        ad.layer || "display",
        ad.sourceName || ad.layer || "Display",
        ad.cpm || ad.nbxRankCpm || ""
      );
      pixel(ad.impressionUrl);
    };
    image.onerror = function () {
      track(config, "display_error", { layer: ad.layer || "display" });
      advanceRotation(root, "display_error");
    };

    link.appendChild(image);
    root.appendChild(link);
    root.appendChild(brandBadge(config));
  }

  function renderDisplayScript(root, config, ad) {
    var frame = document.createElement("iframe");
    frame.title = "NexBanner display tag";
    frame.width = config.width;
    frame.height = config.height;
    frame.setAttribute("scrolling", "no");
    frame.setAttribute("frameborder", "0");
    frame.className = "nbx-frame";
    root.appendChild(frame);
    watchAdFrame(root, frame, config, ad);

    var safeScriptUrl = escapeAttribute(expandMacros(ad.scriptUrl, config, ad.timeoutMs || config.timeoutMs));
    var html = [
      "<!doctype html>",
      "<html><head><meta charset=\"utf-8\">",
      "<style>html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;background:transparent}</style>",
      "</head><body>",
      frameMonitorScript(frame.__nbxMonitorToken, false, ad.timeoutMs || config.timeoutMs),
      "<script src=\"" + safeScriptUrl + "\"><\\/script>",
      "</body></html>"
    ].join("");

    frame.contentWindow.document.open();
    frame.contentWindow.document.write(html);
    frame.contentWindow.document.close();
    root.appendChild(brandBadge(config));
  }

  function renderNoAd(root, config) {
    clear(root);
    root.className += " nbx-empty";
    track(config, "no_ad", { layer: "empty" });
  }

  function advanceRotation(root, reason) {
    if (root.__nbxRotation && typeof root.__nbxRotation.advance === "function") {
      root.__nbxRotation.advance(reason);
    }
  }

  function buildShell(target, config) {
    target.innerHTML = "";
    var root = document.createElement("div");
    root.className = "nbx-root";
    root.style.width = config.width + "px";
    root.style.height = config.height + "px";

    var style = document.createElement("style");
    style.textContent = [
      ".nbx-root{position:relative;overflow:hidden;background:transparent;color:#102033;font-family:Arial,Helvetica,sans-serif;line-height:1;}",
      ".nbx-click{display:block;width:100%;height:100%;text-decoration:none;color:inherit;}",
      ".nbx-video,.nbx-image,.nbx-frame{display:block;width:100%;height:100%;border:0;object-fit:cover;}",
      ".nbx-label{position:absolute;top:6px;right:6px;background:rgba(0,0,0,.62);color:#fff;font-size:10px;padding:3px 5px;border-radius:3px;}",
      ".nbx-brand{position:absolute;top:6px;left:6px;z-index:2;width:28px;height:28px;border-radius:7px;background:rgba(255,255,255,.92);box-shadow:0 2px 8px rgba(0,0,0,.18);display:flex;align-items:center;justify-content:center;overflow:hidden;font-weight:700;font-size:16px;color:#1769e0;letter-spacing:0;}",
      ".nbx-brand img{display:block;width:100%;height:100%;object-fit:contain;}",
      ".nbx-status{position:absolute;inset:0;background:transparent;}",
      ".nbx-empty{background:transparent;}"
    ].join("");

    target.appendChild(style);
    target.appendChild(root);
    return root;
  }

  function brandBadge(config) {
    var badge = document.createElement("div");
    badge.className = "nbx-brand";
    badge.title = "NexBanner";

    if (config.logoUrl) {
      var image = document.createElement("img");
      image.src = config.logoUrl;
      image.alt = "Nexbid";
      image.onerror = function () { badge.textContent = config.logoText || "N"; };
      badge.appendChild(image);
      return badge;
    }

    badge.textContent = config.logoText || "N";
    return badge;
  }

  function setStatus(root, message, preserveRenderedAd) {
    if (preserveRenderedAd && root.__nbxRotation && root.__nbxRotation.hasRenderedAd) return;
    clear(root);
    var status = document.createElement("div");
    status.className = "nbx-status";
    status.setAttribute("aria-hidden", "true");
    root.appendChild(status);
  }

  function warmVastMedia(vast, config) {
    if (!vast || !vast.mediaUrl || vast.__nbxPreloadedVideo) return vast;
    var video = document.createElement("video");
    video.src = vast.mediaUrl;
    video.width = config.width;
    video.height = config.height;
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    try { video.load(); } catch (_) {}
    vast.__nbxPreloadedVideo = video;
    return vast;
  }

  function preconnectDemand(config) {
    var urls = [];
    arrayFrom(config.vastDemand).forEach(function (item) { if (item.endpoint) urls.push(item.endpoint); });
    listFrom(config.vastTags).forEach(function (url) { urls.push(url); });
    arrayFrom(config.adserverScriptDemand).forEach(function (item) { if (item.endpoint) urls.push(item.endpoint); });
    listFrom(config.adserverScriptUrls).forEach(function (url) { urls.push(url); });

    var origins = {};
    urls.forEach(function (value) {
      try {
        var origin = new URL(value, window.location.href).origin;
        if (!origin || origins[origin]) return;
        origins[origin] = true;
        var link = document.createElement("link");
        link.rel = "preconnect";
        link.href = origin;
        link.crossOrigin = "anonymous";
        document.head.appendChild(link);
      } catch (_) {}
    });
  }

  function clear(root) {
    if (typeof root.__nbxFrameCleanup === "function") root.__nbxFrameCleanup();
    root.__nbxFrameCleanup = null;
    while (root.firstChild) root.removeChild(root.firstChild);
  }

  function watchAdFrame(root, frame, config, ad) {
    var token = makeRequestId();
    var completed = false;
    frame.__nbxMonitorToken = token;

    function cleanup() {
      window.removeEventListener("message", onMessage);
      if (root.__nbxFrameCleanup === cleanup) root.__nbxFrameCleanup = null;
    }

    function onMessage(event) {
      var data = event.data || {};
      if (completed || event.source !== frame.contentWindow) return;
      if (data.type !== "nexbanner-frame-result" || data.token !== token) return;
      completed = true;
      cleanup();

      if (data.filled) {
        recordDeliveredImpression(
          config,
          ad.layer || "display",
          ad.sourceName || ad.layer || "Display",
          ad.cpm || ad.nbxRankCpm || ""
        );
        pixel(ad.impressionUrl);
        return;
      }

      track(config, "partner_no_fill", {
        layer: ad.layer || "display",
        partnerName: ad.sourceName || ad.layer || "Display",
        reason: data.reason || "partner-empty"
      });
      advanceRotation(root, data.reason || "partner_no_fill");
    }

    window.addEventListener("message", onMessage);
    root.__nbxFrameCleanup = cleanup;
  }

  function frameMonitorScript(token, expectsGpt, timeoutMs) {
    var timeout = Math.max(2500, Math.min(8000, numberValue(timeoutMs, 4000) + 1200));
    var tokenJson = JSON.stringify(token);
    return [
      "<script>(function(){",
      "var done=false,start=Date.now(),expectsGpt=" + (expectsGpt ? "true" : "false") + ";",
      "function finish(filled,reason){if(done)return;done=true;parent.postMessage({type:'nexbanner-frame-result',token:" + tokenJson + ",filled:!!filled,reason:reason||''},'*');}",
      "if(expectsGpt){window.googletag=window.googletag||{cmd:[]};window.googletag.cmd.push(function(){window.googletag.pubads().addEventListener('slotRenderEnded',function(e){finish(!e.isEmpty,e.isEmpty?'gpt-empty':'');});});}",
      "var poll=setInterval(function(){if(done){clearInterval(poll);return;}if(!expectsGpt&&Date.now()-start>350){var n=document.querySelectorAll('iframe,img,video,canvas,object,embed');for(var i=0;i<n.length;i++){var r=n[i].getBoundingClientRect();if(r.width>10&&r.height>10){finish(true,'');break;}}}},250);",
      "setTimeout(function(){clearInterval(poll);finish(false,expectsGpt?'gpt-timeout':'creative-timeout');}," + timeout + ");",
      "})();<\\/script>"
    ].join("");
  }

  function supportedVastMedia(xml) {
    var nodes = xml.querySelectorAll("MediaFile");
    for (var index = 0; index < nodes.length; index += 1) {
      var node = nodes[index];
      var type = String(node.getAttribute("type") || "").toLowerCase();
      var apiFramework = String(node.getAttribute("apiFramework") || "").toLowerCase();
      var url = String(node.textContent || "").trim();
      var isVideo = type.indexOf("video/") === 0 || type.indexOf("mpegurl") >= 0;
      if (url && isVideo && apiFramework !== "vpaid") return { url: url, type: type };
    }
    return null;
  }

  function withTimeout(promise, timeoutMs) {
    var timeout;
    var timer = new Promise(function (_, reject) {
      timeout = window.setTimeout(function () { reject(new Error("timeout")); }, timeoutMs);
    });
    return Promise.race([promise, timer]).finally(function () { window.clearTimeout(timeout); });
  }

  function firstText(xml, selector) {
    var node = xml.querySelector(selector);
    return node && node.textContent ? node.textContent.trim() : "";
  }

  function trackingEvents(xml) {
    var events = {};
    var nodes = xml.querySelectorAll("Tracking[event]");
    Array.prototype.forEach.call(nodes, function (node) {
      var event = node.getAttribute("event");
      if (!events[event]) events[event] = [];
      events[event].push((node.textContent || "").trim());
    });
    return events;
  }

  function fireOnce(fired, eventName, vast, config) {
    if (fired[eventName]) return;
    fired[eventName] = true;
    track(config, "video_" + eventName, { layer: vast.layer });
    (vast.tracking[eventName] || []).forEach(pixel);
  }

  function track(config, eventName, data) {
    var payload = data || {};
    var endpoint = config.trackUrl || (eventName.indexOf("error") >= 0 ? config.errorUrl : "");
    if (!endpoint) return;

    var url = new URL(endpoint, window.location.href);
    url.searchParams.set("event", eventName);
    url.searchParams.set("config_id", config.configId || "");
    url.searchParams.set("product_version", config.productVersion || "");
    url.searchParams.set("rotation_mode", config.rotationMode || "");
    url.searchParams.set("publisher_id", config.publisherId);
    url.searchParams.set("publisher_domain", config.publisherDomain || domainFromPage());
    url.searchParams.set("placement_id", config.placementId);
    url.searchParams.set("request_id", config.requestId || "");
    url.searchParams.set("layer", payload.layer || "");
    url.searchParams.set("partner_name", payload.partnerName || "");
    url.searchParams.set("reason", payload.reason || "");
    url.searchParams.set("cpm", payload.cpm || "");
    url.searchParams.set("w", config.width);
    url.searchParams.set("h", config.height);
    url.searchParams.set("cb", String(Date.now()) + Math.floor(Math.random() * 100000));
    pixel(url.toString());
  }

  function recordDeliveredImpression(config, layer, partnerName, cpm) {
    if (!config.__requestFilledTracked) {
      config.__requestFilledTracked = true;
      track(config, "request_filled", {
        layer: layer,
        partnerName: partnerName,
        cpm: cpm
      });
    }
    track(config, "impression", {
      layer: layer,
      partnerName: partnerName,
      cpm: cpm
    });
  }

  function makeRequestId() {
    return "nbx-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }

  function pixel(url) {
    if (!url) return;
    var image = new Image();
    image.src = expandMacros(url, {});
  }

  function resolveUrl(value, base) {
    try { return new URL(value, base).toString(); } catch (_) { return value; }
  }

  function listFrom(value) {
    if (Array.isArray(value)) return value.filter(Boolean);
    return String(value || "")
      .split("|")
      .map(function (item) { return item.trim(); })
      .filter(Boolean);
  }

  function arrayFrom(value) {
    return Array.isArray(value) ? value.filter(Boolean) : [];
  }

  function uniqueList(value) {
    var seen = {};
    return listFrom(value).filter(function (item) {
      if (seen[item]) return false;
      seen[item] = true;
      return true;
    });
  }

  function uniqueDemand(items, endpointKey) {
    var seen = {};
    return arrayFrom(items).filter(function (item) {
      var key = item && (item[endpointKey] || item);
      if (!key || seen[key]) return false;
      seen[key] = true;
      return true;
    });
  }

  function auctionItems(items, endpointKey) {
    var seen = {};
    return arrayFrom(items)
      .filter(function (item) {
        return item && item[endpointKey] && !seen[item[endpointKey]];
      })
      .map(function (item) {
        seen[item[endpointKey]] = true;
        return item;
      })
      .sort(function (a, b) {
        return numberValue(b.floorCpm, 0) - numberValue(a.floorCpm, 0);
      });
  }

  function numberValue(value, fallback) {
    var parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function escapeAttribute(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;");
  }

  function decodePayload(value) {
    try {
      return decodeURIComponent(value);
    } catch (_) {
      return value;
    }
  }

  function expandMacros(value, config, tmax) {
    var output = String(value || "");
    if (!output) return output;

    var pageUrl = safePageUrl();
    var cachebuster = String(Date.now()) + Math.floor(Math.random() * 1000000);
    var width = config && config.width ? config.width : 300;
    var height = config && config.height ? config.height : 250;
    var domain = config && config.publisherDomain ? config.publisherDomain : domainFromPage();
    var timeout = numberValue(tmax, config && config.timeoutMs ? config.timeoutMs : 1800);
    var replacements = {
      "%%CACHEBUSTER%%": cachebuster,
      "%%CACHE_BUSTER%%": cachebuster,
      "%%RANDOM%%": cachebuster,
      "%%TIMESTAMP%%": cachebuster,
      "%%WIDTH%%": width,
      "%%HEIGHT%%": height,
      "%%TMAX%%": timeout,
      "%%TIMEOUT%%": timeout,
      "%%DOMAIN%%": domain,
      "%%PAGE_URL%%": pageUrl,
      "%%REFERRER_URL%%": pageUrl,
      "%%REFERRER_URL_ESC%%": encodeURIComponent(pageUrl),
      "%%REFERRER_URL_ESC_ESC%%": encodeURIComponent(encodeURIComponent(pageUrl))
    };

    Object.keys(replacements).forEach(function (macro) {
      output = output.split(macro).join(replacements[macro]);
    });
    return output;
  }

  function safePageUrl() {
    try { return window.top.location.href; } catch (_) { return document.referrer || window.location.href; }
  }

  function domainFromPage() {
    try { return new URL(safePageUrl()).hostname; } catch (_) { return ""; }
  }

  function trimSlash(value) {
    return String(value || "").replace(/\/+$/, "");
  }
})();
