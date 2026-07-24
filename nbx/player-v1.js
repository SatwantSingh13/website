(function () {
  "use strict";

  window.NexBannerPlayer = { mount: mount };

  function mount(target, config) {
    config.requestId = config.requestId || makeRequestId();
    config.__requestFilledTracked = false;
    loadConfig(config)
      .then(function (resolvedConfig) {
        var root = buildShell(target, resolvedConfig);
        initCheckDivIsInViewPort(root, function () {
          track(resolvedConfig, "ad_request", { layer: "gam-entry" });
          preconnectDemand(resolvedConfig);
          startViewableRotation(root, resolvedConfig);
        });
      })
      .catch(function () {
        var root = buildShell(target, config);
        initCheckDivIsInViewPort(root, function () {
          track(config, "ad_request", { layer: "gam-entry" });
          preconnectDemand(config);
          track(config, "config_error", { layer: "config" });
          startViewableRotation(root, config);
        });
      });
  }

  function initCheckDivIsInViewPort(element, callback, visiblePercentage, delay) {
    if (!element || typeof callback !== "function") return;

    var percentage = numberValue(visiblePercentage, 0.2);
    var waitMs = Math.max(0, numberValue(delay, 0));
    var timer = null;
    var called = false;
    var observer = null;

    function runOnce() {
      if (called) return;
      called = true;
      if (timer) window.clearTimeout(timer);
      timer = null;
      if (observer) observer.disconnect();
      callback();
    }

    if (!("IntersectionObserver" in window)) {
      runOnce();
      return;
    }

    observer = new IntersectionObserver(function (entries) {
      var entry = entries[0];
      var isVisible = entry && entry.isIntersecting && entry.intersectionRatio >= percentage;

      if (!isVisible) {
        if (timer) window.clearTimeout(timer);
        timer = null;
        return;
      }

      if (called || timer) return;
      if (waitMs > 0) {
        timer = window.setTimeout(runOnce, waitMs);
      } else {
        runOnce();
      }
    }, { root: null, threshold: percentage });

    observer.observe(element);
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
      visible: true,
      timer: null,
      currentLayer: "",
      running: true,
      pendingRestart: false,
      auctionAttempt: 0,
      maxAuctionAttempts: Math.max(1, numberValue(config.maxAuctionAttempts, 2)),
      auctionBudgetMs: Math.max(300, numberValue(config.auctionBudgetMs, 1200)),
      auctionRetryDelayMs: Math.max(0, numberValue(config.auctionRetryDelayMs, 2000)),
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
      state.cycleId = (state.cycleId || 0) + 1;
      state.running = false;
      clearTimer(state);
      state.pendingRestart = true;
      track(config, "viewable_pause", { layer: "viewability" });
    }

    if (!("IntersectionObserver" in window)) {
      state.visible = true;
    } else {
      var observer = new IntersectionObserver(function (entries) {
        var entry = entries[0];
        if (entry && entry.isIntersecting && entry.intersectionRatio >= 0.2) markVisible();
        else markHidden();
      }, { threshold: [0, 0.2, 1] });

      observer.observe(root);
    }

    state.nextIndex = 0;
    track(config, "viewable_start", { layer: "viewability" });
    track(config, "waterfall_initial_request", { layer: "vast" });
    startHybridCycle(root, config, state);
  }

  function startHybridCycle(root, config, state) {
    if (!state.active || !state.visible) {
      state.pendingRestart = true;
      return;
    }
    state.running = true;
    state.currentLayer = "parallel-auction";
    state.nextIndex = 0;
    state.cycleId = (state.cycleId || 0) + 1;
    var cycleId = state.cycleId;
    state.auctionAttempt = (state.auctionAttempt || 0) + 1;

    setStatus(root, "", true);
    track(config, "auction_cycle_start", {
      layer: "parallel-auction",
      reason: "attempt-" + state.auctionAttempt
    });

    collectParallelDemand(config, state.auctionBudgetMs).then(function (winner) {
      if (!state.active || !state.visible || state.cycleId !== cycleId) return;
      if (!winner || !winner.ad) {
        scheduleAuctionRetry(root, config, state, cycleId, "parallel-auction-no-fill");
        return;
      }

      state.currentLayer = winner.layer;
      renderAuctionWinner(root, config, state, winner, cycleId, function (filled, reason) {
        if (!state.active || state.cycleId !== cycleId) return;
        if (filled) {
          state.running = false;
          state.auctionAttempt = 0;
          track(config, "rotation_layer_filled", {
            layer: winner.layer,
            partnerName: winner.ad.sourceName || "",
            cpm: winner.rank || ""
          });
          return;
        }
        scheduleAuctionRetry(root, config, state, cycleId, reason || "winner-render-no-fill");
      });
    });
  }

  function collectParallelDemand(config, budgetMs) {
    var results = [];
    var settled = 0;
    var finished = false;
    var tasks = [
      demandTask("vast", 0, fetchVast(config), function (ad) {
        if (ad && ad.mediaUrl) warmVastMedia(ad, config);
        return ad;
      }),
      demandTask("prebid", 1, fetchPrebidDecision(config)),
      demandTask("adserver", 2, fetchAdserverDecision(config)),
      demandTask("ortb", 3, fetchRemnantDecision(config))
    ];

    return new Promise(function (resolve) {
      var timer = window.setTimeout(finish, budgetMs);

      function finish() {
        if (finished) return;
        finished = true;
        window.clearTimeout(timer);
        results.sort(function (a, b) {
          return b.rank - a.rank || a.priority - b.priority;
        });
        resolve(results[0] || null);
      }

      tasks.forEach(function (task) {
        task.then(function (result) {
          if (!finished && result && result.ad) results.push(result);
        }).catch(function () {}).then(function () {
          settled += 1;
          if (settled === tasks.length) finish();
        });
      });
    });
  }

  function demandTask(layer, priority, promise, prepare) {
    return promise.then(function (ad) {
      if (prepare) ad = prepare(ad);
      if (!ad) throw new Error("empty-" + layer);
      return {
        ad: ad,
        layer: layer,
        priority: priority,
        rank: auctionCandidateRank(ad)
      };
    }).catch(function () {
      return null;
    });
  }

  function auctionCandidateRank(ad) {
    if (ad && ad.adType === "adserver-sequence") {
      return arrayFrom(ad.candidates).reduce(function (highest, candidate) {
        return Math.max(highest, numberValue(candidate.cpm, 0));
      }, 0);
    }
    return numberValue(ad && (ad.cpm || ad.nbxRankCpm), 0);
  }

  function renderAuctionWinner(root, config, state, winner, cycleId, done) {
    var ad = winner.ad;
    if (winner.layer === "vast") {
      renderVideo(root, config, ad, function () {
        if (state.cycleId === cycleId) done(true, "");
      });
      return;
    }

    renderDisplay(root, config, ad, function (result) {
      if (state.cycleId !== cycleId) return;
      done(!!(result && result.filled), result && result.reason);
    });

    if (ad.adType !== "adserver-sequence" && !ad.html && !ad.scriptUrl && !ad.imageUrl) {
      done(false, "unsupported-auction-winner");
    }
  }

  function scheduleAuctionRetry(root, config, state, cycleId, reason) {
    if (!state.active || state.cycleId !== cycleId) return;
    state.running = false;
    track(config, "auction_cycle_no_fill", {
      layer: "parallel-auction",
      reason: reason || "no-fill"
    });

    if (!state.visible) {
      state.pendingRestart = true;
      return;
    }
    if (state.auctionAttempt >= state.maxAuctionAttempts) {
      state.auctionAttempt = 0;
      track(config, "rotation_cycle_complete", { layer: "parallel-auction", reason: "retry-limit" });
      renderNoAd(root, config);
      return;
    }

    clearTimer(state);
    state.timer = window.setTimeout(function () {
      if (!state.active || !state.visible || state.cycleId !== cycleId) return;
      startHybridCycle(root, config, state);
    }, state.auctionRetryDelayMs);
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
    if (prepared.ad.adType === "adserver-sequence") {
      renderDisplay(root, config, prepared.ad, function () {
        if (!state.active || state.cycleId !== cycleId) return;
        if (!pendingVastOutcome) {
          runRotationStep(root, config, state, prepared.nextIndex);
          return;
        }
        pendingVastOutcome.then(function (outcome) {
          if (!state.active || state.cycleId !== cycleId) return;
          if (outcome && outcome.ad) {
            renderPreparedVideo(
              root,
              config,
              state,
              outcome.ad,
              Promise.resolve({ ad: null, nextIndex: 4 }),
              cycleId
            );
          } else {
            runRotationStep(root, config, state, prepared.nextIndex);
          }
        });
      });
      return;
    }

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
        render: function (ad, done) { renderDisplay(root, config, ad, done); },
        waitForDone: true
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
        if (ad.adType !== "adserver-sequence") {
          track(config, "rotation_layer_filled", { layer: layer.name, cpm: ad.cpm || ad.nbxRankCpm || "" });
        }
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
        var vpaid = !media && vastItem.allowVpaid !== false ? supportedVpaidMedia(xml) : null;
        if (!media && !vpaid) throw new Error("vast-no-supported-video-media");

        return {
          adType: vpaid ? "vpaid-js" : "vast-video",
          mediaUrl: resolveUrl((vpaid || media).url, vastUrl),
          mediaType: (vpaid || media).type,
          adParameters: vpaid ? firstText(xml, "AdParameters") : "",
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

    var htmlCandidates = htmlTags.map(function (item) {
      return {
        adType: "adserver-html",
        html: decodePayload(item.html),
        demandKey: "html:" + decodePayload(item.html),
        layer: "adserver-html-tag",
        sourceName: item.name || "MI HTML",
        cpm: numberValue(item.floorCpm, 0),
        timeoutMs: numberValue(item.timeoutMs, config.timeoutMs)
      };
    }).sort(function (a, b) {
      return Number(a.html.indexOf("googletag") >= 0) - Number(b.html.indexOf("googletag") >= 0);
    });
    var scriptCandidates = scripts.map(function (item) {
      return {
        adType: "display-js",
        scriptUrl: item.endpoint || item,
        demandKey: "script:" + (item.endpoint || item),
        layer: "adserver-js-tag",
        sourceName: item.name || "Display JS",
        cpm: numberValue(item.floorCpm, 0),
        timeoutMs: numberValue(item.timeoutMs, config.timeoutMs)
      };
    });
    var candidates = scriptCandidates.concat(htmlCandidates);

    if (!candidates.length) return Promise.reject(new Error("missing-adserver-tags"));

    candidates = uniqueDemand(candidates, "demandKey");
    return Promise.resolve({
      adType: "adserver-sequence",
      layer: "adserver",
      candidates: candidates
    });
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
          track(config, layer + "_endpoint_failed", {
            layer: layer,
            partnerName: partnerName,
            reason: error.message
          });
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
    if (vast.adType === "vpaid-js") {
      renderVpaid(root, config, vast, onDone);
      return;
    }

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

  function renderDisplay(root, config, ad, onResult) {
    if (ad.adType === "adserver-sequence") {
      renderAdserverSequence(root, config, ad.candidates || [], onResult);
      return;
    }

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
      watchAdFrame(root, frame, config, ad, onResult);
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
      renderDisplayScript(root, config, ad, onResult);
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
      if (typeof onResult === "function") onResult({ filled: true, partnerName: ad.sourceName });
    };
    image.onerror = function () {
      track(config, "display_error", { layer: ad.layer || "display" });
      if (typeof onResult === "function") onResult({ filled: false, partnerName: ad.sourceName, reason: "display_error" });
      else advanceRotation(root, "display_error");
    };

    link.appendChild(image);
    root.appendChild(link);
    root.appendChild(brandBadge(config));
  }

  function renderDisplayScript(root, config, ad, onResult) {
    var frame = document.createElement("iframe");
    frame.title = "NexBanner display tag";
    frame.width = config.width;
    frame.height = config.height;
    frame.setAttribute("scrolling", "no");
    frame.setAttribute("frameborder", "0");
    frame.className = "nbx-frame";
    root.appendChild(frame);
    watchAdFrame(root, frame, config, ad, onResult);

    var safeScriptUrl = escapeAttribute(expandMacros(ad.scriptUrl, config, ad.timeoutMs || config.timeoutMs));
    var html = [
      "<!doctype html>",
      "<html><head><meta charset=\"utf-8\">",
      "<style>html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;background:transparent}</style>",
      "</head><body>",
      frameMonitorScript(frame.__nbxMonitorToken, false, ad.timeoutMs || config.timeoutMs),
      // Syntax error fixed 2026-07-23: split the closing tag so document.write receives valid HTML.
      "<script src=\"" + safeScriptUrl + "\"></scr" + "ipt>",
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

  function renderVpaid(root, config, vast, onDone) {
    clear(root);

    var frame = document.createElement("iframe");
    var token = makeRequestId();
    var finished = false;
    var started = false;
    var startTimeoutMs = Math.max(3000, numberValue(config.vpaidStartTimeoutMs, 8000));
    var maxDurationMs = Math.max(30000, numberValue(config.vpaidMaxDurationMs, 120000));
    var timeout = window.setTimeout(function () { finish("vpaid-start-timeout"); }, startTimeoutMs);

    frame.title = "NexBanner VPAID ad";
    frame.width = config.width;
    frame.height = config.height;
    frame.className = "nbx-frame";
    frame.setAttribute("scrolling", "no");
    frame.setAttribute("frameborder", "0");
    frame.setAttribute("sandbox", "allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox");

    function cleanup() {
      window.clearTimeout(timeout);
      window.removeEventListener("message", onMessage);
      if (root.__nbxFrameCleanup === cleanup) root.__nbxFrameCleanup = null;
    }

    function finish(reason) {
      if (finished) return;
      finished = true;
      cleanup();
      if (reason && reason !== "complete") {
        track(config, "vpaid_error", {
          layer: vast.layer || "premium-vast",
          partnerName: vast.sourceName || "VPAID",
          reason: reason
        });
      }
      if (typeof onDone === "function") onDone();
      else advanceRotation(root, reason || "vpaid_complete");
    }

    function onMessage(event) {
      var data = event.data || {};
      if (finished || event.source !== frame.contentWindow || data.token !== token) return;
      if (data.type !== "nexbanner-vpaid") return;

      if (data.event === "started" && !started) {
        started = true;
        window.clearTimeout(timeout);
        timeout = window.setTimeout(function () { finish("vpaid-duration-timeout"); }, maxDurationMs);
        markRenderStart(root);
        recordDeliveredImpression(
          config,
          vast.layer || "premium-vast",
          vast.sourceName || "VPAID",
          vast.cpm || vast.nbxRankCpm || ""
        );
        pixel(vast.impressionUrl);
        fireOnce({}, "start", vast, config);
        return;
      }

      if (data.event === "complete") {
        fireOnce({}, "complete", vast, config);
        finish("complete");
      } else if (data.event === "error") {
        finish(data.reason || "vpaid-error");
      }
    }

    window.addEventListener("message", onMessage);
    root.__nbxFrameCleanup = cleanup;
    root.appendChild(frame);
    root.appendChild(brandBadge(config));

    var mediaUrlJson = jsonForInlineScript(vast.mediaUrl);
    var adParametersJson = jsonForInlineScript(vast.adParameters || "");
    var tokenJson = jsonForInlineScript(token);
    frame.srcdoc = [
      "<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">",
      "<style>html,body,#slot{margin:0;padding:0;width:100%;height:100%;overflow:hidden;background:transparent}video{position:absolute;width:100%;height:100%;object-fit:contain}</style>",
      "</head><body><div id=\"slot\"><video id=\"videoSlot\" muted playsinline></video></div><script>(function(){",
      "var token=" + tokenJson + ",done=false,started=false,ad=null;",
      "function send(event,reason){parent.postMessage({type:'nexbanner-vpaid',token:token,event:event,reason:reason||''},'*');}",
      "function finish(event,reason){if(done)return;done=true;send(event,reason);}",
      "function subscribe(name,fn){try{ad.subscribe(fn,name,window);}catch(e){}}",
      "function boot(){try{if(typeof window.getVPAIDAd!=='function')throw new Error('missing-getVPAIDAd');ad=window.getVPAIDAd();if(!ad)throw new Error('missing-vpaid-object');var version=ad.handshakeVersion('2.0');if(!version)throw new Error('vpaid-handshake-failed');",
      "subscribe('AdLoaded',function(){try{ad.startAd();}catch(e){finish('error','vpaid-start-failed');}});",
      "subscribe('AdStarted',function(){if(!started){started=true;send('started');}});subscribe('AdImpression',function(){if(!started){started=true;send('started');}});",
      "subscribe('AdVideoComplete',function(){finish('complete');});subscribe('AdStopped',function(){finish('complete');});subscribe('AdSkipped',function(){finish('complete');});",
      "subscribe('AdError',function(message){finish('error',String(message||'vpaid-ad-error'));});",
      "var slot=document.getElementById('slot'),videoSlot=document.getElementById('videoSlot');",
      "ad.initAd(" + Number(config.width) + "," + Number(config.height) + ",'normal',-1,{AdParameters:" + adParametersJson + "},{slot:slot,videoSlot:videoSlot,videoSlotCanAutoPlay:true});",
      "}catch(e){finish('error',String(e&&e.message||e));}}",
      "var script=document.createElement('script');script.async=true;script.src=" + mediaUrlJson + ";script.onload=boot;script.onerror=function(){finish('error','vpaid-script-load-failed');};document.head.appendChild(script);",
      "})();<\/script></body></html>"
    ].join("");
  }

  function preloadVpaidScript(vast) {
    if (!vast || !vast.mediaUrl || vast.__nbxVpaidPreloadStarted) return;
    vast.__nbxVpaidPreloadStarted = true;
    var link = document.createElement("link");
    link.rel = "preload";
    link.as = "script";
    link.href = vast.mediaUrl;
    link.crossOrigin = "anonymous";
    document.head.appendChild(link);
  }

  function warmVastMedia(vast, config) {
    if (!vast || !vast.mediaUrl || vast.adType === "vpaid-js" || vast.__nbxPreloadedVideo) return vast;
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
    if (root.__nbxSequenceTimer) window.clearTimeout(root.__nbxSequenceTimer);
    root.__nbxSequenceTimer = null;
    if (typeof root.__nbxFrameCleanup === "function") root.__nbxFrameCleanup();
    root.__nbxFrameCleanup = null;
    while (root.firstChild) root.removeChild(root.firstChild);
  }

  function watchAdFrame(root, frame, config, ad, onResult) {
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
        if (typeof onResult === "function") onResult({ filled: true, partnerName: ad.sourceName });
        return;
      }

      track(config, "partner_no_fill", {
        layer: ad.layer || "display",
        partnerName: ad.sourceName || ad.layer || "Display",
        reason: data.reason || "partner-empty"
      });
      if (typeof onResult === "function") {
        onResult({ filled: false, partnerName: ad.sourceName, reason: data.reason || "partner_no_fill" });
      } else {
        advanceRotation(root, data.reason || "partner_no_fill");
      }
    }

    window.addEventListener("message", onMessage);
    root.__nbxFrameCleanup = cleanup;
  }

  function renderAdserverSequence(root, config, candidates, onDone) {
    var queue = arrayFrom(candidates);
    var index = 0;
    var holdMs = Math.max(5000, numberValue(config.minRenderMs, 5000));

    function finish() {
      if (typeof onDone === "function") onDone({ filled: false, complete: true });
    }

    function next() {
      if (index >= queue.length) {
        finish();
        return;
      }

      var candidate = queue[index];
      index += 1;
      track(config, "partner_request", {
        layer: "adserver",
        partnerName: candidate.sourceName || "MI"
      });

      renderDisplay(root, config, candidate, function (result) {
        if (result && result.filled) {
          if (typeof onDone === "function") {
            onDone({ filled: true, complete: true, partnerName: result.partnerName || candidate.sourceName });
            return;
          }
          root.__nbxSequenceTimer = window.setTimeout(next, holdMs);
          return;
        }
        next();
      });
    }

    if (!queue.length) {
      finish();
      return;
    }
    next();
  }

  function frameMonitorScript(token, expectsGpt, timeoutMs) {
    var timeout = Math.max(2500, Math.min(8000, numberValue(timeoutMs, 4000) + 1200));
    var tokenJson = JSON.stringify(token);
    return [
      "<script>(function(){",
      "var done=false,start=Date.now(),expectsGpt=" + (expectsGpt ? "true" : "false") + ";",
      "function finish(filled,reason){if(done)return;done=true;parent.postMessage({type:'nexbanner-frame-result',token:" + tokenJson + ",filled:!!filled,reason:reason||''},'*');}",
      "if(expectsGpt){window.googletag=window.googletag||{cmd:[]};window.googletag.cmd.push(function(){window.googletag.pubads().addEventListener('slotRenderEnded',function(e){finish(!e.isEmpty,e.isEmpty?'gpt-empty':'');});});}",
      "function visibleCreative(){var n=document.body.querySelectorAll('*');for(var i=0;i<n.length;i++){var e=n[i],tag=e.tagName;if(tag==='SCRIPT'||tag==='STYLE'||tag==='LINK'||tag==='META')continue;var r=e.getBoundingClientRect(),s=getComputedStyle(e);if(r.width<=10||r.height<=10||s.display==='none'||s.visibility==='hidden'||Number(s.opacity)===0)continue;if(/^(IFRAME|IMG|VIDEO|CANVAS|OBJECT|EMBED)$/.test(tag)||s.backgroundImage!=='none'||String(e.textContent||'').trim())return true;}return false;}",
      "var poll=setInterval(function(){if(done){clearInterval(poll);return;}if(!expectsGpt&&Date.now()-start>350&&visibleCreative())finish(true,'');},250);",
      "setTimeout(function(){clearInterval(poll);finish(false,expectsGpt?'gpt-timeout':'creative-timeout');}," + timeout + ");",
      // Syntax error fixed 2026-07-23: avoid emitting the invalid <\/script> sequence.
      "})();</scr" + "ipt>"
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

  function supportedVpaidMedia(xml) {
    var nodes = xml.querySelectorAll("MediaFile");
    for (var index = 0; index < nodes.length; index += 1) {
      var node = nodes[index];
      var type = String(node.getAttribute("type") || "").toLowerCase();
      var apiFramework = String(node.getAttribute("apiFramework") || "").toLowerCase();
      var url = String(node.textContent || "").trim();
      var isJavaScript = type.indexOf("javascript") >= 0 || /\.js(?:[?#]|$)/i.test(url);
      if (url && apiFramework === "vpaid" && isJavaScript) return { url: url, type: type };
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
    sendTrackingEvent(url.toString());
  }

  function sendTrackingEvent(url) {
    if (!url) return;
    if (window.fetch) {
      fetch(url, { method: "GET", credentials: "omit", keepalive: true })
        .catch(function () { pixel(url); });
      return;
    }
    pixel(url);
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
    var pending = window.__nbxTrackingPixels = window.__nbxTrackingPixels || [];
    pending.push(image);
    function release() {
      var index = pending.indexOf(image);
      if (index >= 0) pending.splice(index, 1);
    }
    image.onload = release;
    image.onerror = release;
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

  function jsonForInlineScript(value) {
    return JSON.stringify(String(value || "")).replace(/</g, "\\u003c");
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

