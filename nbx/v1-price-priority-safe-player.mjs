import { RequestState, candidateAllowed, finiteNumber, prependGamClick } from "./v1-safe-core.mjs";

const TERMINALS = new Set(["filled", "passed-back", "no-fill", "cancelled", "error"]);
const DEFAULT_IMA_SDK_URL = "https://imasdk.googleapis.com/js/sdkloader/ima3.js";
let imaSdkPromise;

window.NexBannerPricePrioritySafe = { mount };

async function mount(target, directConfig) {
  const startedAt = Date.now();
  const requestId = makeId();
  let config;
  try {
    config = await loadConfig(directConfig);
  } catch (error) {
    config = normalize(directConfig);
    config.configError = error?.message || "config-error";
  }
  config = applyProductionProfile(config);
  config.requestId = requestId;
  config.maxAuctionCycles = 1;
  config.internalRefresh = false;
  config.allowVpaid = config.allowVpaid === true;
  const root = shell(target, config);
  const machine = new RequestState(requestId, ({ state, detail }) => {
    root.dataset.nbxState = state;
    if (TERMINALS.has(state)) {
      track(config, "terminal_state", { terminalState: state, reason: detail.reason || "" });
    }
  });
  root.__nbxRequestState = machine;

  track(config, "gam_creative_entry", { layer: "gam-entry" });
  track(config, "ad_request", { layer: "gam-entry" });
  if (config.configError) track(config, "config_error", { layer: "config", reason: config.configError });
  machine.transition("waiting-for-viewability");
  track(config, "viewability_wait_start", { layer: "viewability" });

  waitForViewability(root, config, machine, async (qualified, reason) => {
    if (machine.isTerminal()) return;
    if (!qualified) track(config, "viewability_timeout", { layer: "viewability", reason });
    if (!qualified && !config.auctionOnViewabilityTimeout) {
      track(config, "request_cancelled_not_viewable", { layer: "viewability", reason });
      machine.transition("cancelled", { reason });
      return;
    }
    if (qualified) track(config, "viewability_qualified", { layer: "viewability" });
    try {
      await runAuction(root, config, machine, startedAt);
    } catch (error) {
      track(config, "request_error", { layer: "player", reason: error?.message || "request-error" });
      if (!machine.isTerminal()) machine.transition("error", { reason: error?.message || "request-error" });
    }
  });
}

async function loadConfig(base) {
  if (!base.configId) return normalize(base);
  const url = new URL(`${base.apiBase}/api/v1/config/${encodeURIComponent(base.configId)}`);
  if (base.configVersion) url.searchParams.set("v", base.configVersion);
  const response = await fetch(url, { credentials: "omit", cache: "no-cache" });
  if (!response.ok) throw new Error(`config-http-${response.status}`);
  const remote = await response.json();
  const runtimeVpaidChoice = base.vpaidExplicit ? base.allowVpaid === true : remote.allowVpaid === true;
  return normalize({
    ...base,
    ...remote,
    vastDemand: base.vpaidExplicit
      ? array(remote.vastDemand || base.vastDemand).map((item) => ({ ...item, allowVpaid: runtimeVpaidChoice }))
      : remote.vastDemand || base.vastDemand,
    allowVpaid: runtimeVpaidChoice,
    vpaidMode: runtimeVpaidChoice ? base.vpaidMode : remote.vpaidMode || base.vpaidMode,
    vpaidStartTimeoutMs: runtimeVpaidChoice ? base.vpaidStartTimeoutMs : remote.vpaidStartTimeoutMs || base.vpaidStartTimeoutMs,
    sliderScriptUrl: base.sliderScriptUrl || remote.sliderScriptUrl || "",
    sliderName: base.sliderName || remote.sliderName || "Slider",
    sliderScriptId: base.sliderScriptId || remote.sliderScriptId || "",
    sliderTimeoutMs: base.sliderTimeoutMs || remote.sliderTimeoutMs || 8000,
    sliderCpm: base.sliderCpm ?? remote.sliderCpm ?? 0,
    gamClickMacro: base.gamClickMacro || remote.gamClickMacro || "",
    gamCachebuster: base.gamCachebuster || remote.gamCachebuster || "",
    cachebuster: base.cachebuster || remote.cachebuster || ""
  });
}

function normalize(config) {
  return {
    ...config,
    vastDemand: array(config.vastDemand),
    prebidDemand: array(config.prebidDemand),
    displayScriptDemand: array(config.displayScriptDemand),
    adserverScriptDemand: array(config.adserverScriptDemand),
    adserverHtmlDemand: array(config.adserverHtmlDemand),
    ortbDemand: array(config.ortbDemand),
    viewabilityThreshold: finiteNumber(config.viewabilityThreshold, 0.5),
    viewabilityTimeMs: finiteNumber(config.viewabilityTimeMs, 1000),
    viewabilityWaitTimeoutMs: finiteNumber(config.viewabilityWaitTimeoutMs, 15000),
    auctionOnViewabilityTimeout: config.auctionOnViewabilityTimeout === true,
    auctionBudgetMs: Math.min(10000, Math.max(1000, finiteNumber(config.auctionBudgetMs, 10000))),
    vastStageTimeoutMs: Math.min(10000, Math.max(1000, finiteNumber(config.vastStageTimeoutMs, 10000))),
    globalHardStopMs: Math.min(25000, Math.max(10000, finiteNumber(config.globalHardStopMs, 25000))),
    passbackTimeoutMs: Math.min(5000, Math.max(500, finiteNumber(config.passbackTimeoutMs, 5000))),
    enablePassback: config.enablePassback === true,
    collapseOnPassbackFailure: config.collapseOnPassbackFailure === true,
    rejectBelowGamRate: config.rejectBelowGamRate !== false,
    minimumInternalCpm: finiteNumber(config.minimumInternalCpm, 0),
    gamLineItemCpm: finiteNumber(config.gamLineItemCpm, 0),
    priceMismatchTolerance: finiteNumber(config.priceMismatchTolerance, 0),
    vastResolverUrl: config.vastResolverUrl || `${config.apiBase}/api/v1/vast/resolve`,
    serverSideVastResolution: config.serverSideVastResolution !== false,
    legacyBrowserVastFallback: config.legacyBrowserVastFallback === true,
    sliderScriptUrl: config.sliderScriptUrl || "",
    sliderName: config.sliderName || "Slider",
    sliderScriptId: config.sliderScriptId || "",
    sliderTimeoutMs: Math.min(5000, Math.max(500, finiteNumber(config.sliderTimeoutMs, 5000))),
    sliderCpm: finiteNumber(config.sliderCpm, 0),
    vpaidMode: String(config.vpaidMode || "insecure").toLowerCase() === "enabled" ? "enabled" : "insecure",
    vpaidStartTimeoutMs: finiteNumber(config.vpaidStartTimeoutMs, 15000),
    imaSdkUrl: config.imaSdkUrl || DEFAULT_IMA_SDK_URL
  };
}

function applyProductionProfile(config) {
  if (String(config.configId || "").toLowerCase() !== "moneycontrol.com") return config;
  const playstream = array(config.vastDemand).find((item) =>
    /servg\.playstream\.media\/api\/adserver61\/vast/i.test(String(item?.endpoint || item?.url || ""))
  );
  return normalize({
    ...config,
    vastDemand: playstream ? [{ ...playstream, name: "Playstream", allowVpaid: false, timeoutMs: 10000 }] : [],
    prebidDemand: [],
    displayScriptDemand: [],
    ortbDemand: [],
    sliderScriptUrl: "https://display.b-cdn.net/scripts/loader.js?file=6a60a9bb5a723c4751c108a6-6a60aa7a5a723c4751c109a2",
    sliderScriptId: "6a60aa7a5a723c4751c109a2",
    sliderName: "Slider",
    sliderTimeoutMs: 5000,
    adserverScriptDemand: [],
    adserverHtmlDemand: [{ name: "Nexbid GAM Moneycontrol", frameUrl: "https://nexbid.uk/nbx/gam-moneycontrol-wrapper.html", floorCpm: 0, timeoutMs: 5000 }],
    allowVpaid: false,
    auctionBudgetMs: 10000,
    vastStageTimeoutMs: 10000,
    passbackTimeoutMs: 5000,
    globalHardStopMs: 25000,
    enablePassback: false
  });
}

function waitForViewability(root, config, machine, done) {
  let qualifiedTimer = 0;
  let finished = false;
  const finish = (qualified, reason) => {
    if (finished || machine.isTerminal()) return;
    finished = true;
    clearTimeout(qualifiedTimer);
    clearTimeout(waitTimer);
    observer?.disconnect();
    document.removeEventListener("visibilitychange", onVisibility);
    done(qualified, reason);
  };
  const reset = () => { clearTimeout(qualifiedTimer); qualifiedTimer = 0; };
  const qualify = () => {
    if (document.visibilityState !== "visible" || qualifiedTimer) return;
    qualifiedTimer = window.setTimeout(() => finish(true, ""), config.viewabilityTimeMs);
  };
  const onVisibility = () => {
    if (document.visibilityState !== "visible") reset();
    else if (root.__nbxIntersectionRatio >= config.viewabilityThreshold) qualify();
  };
  const waitTimer = window.setTimeout(() => finish(false, "viewability-timeout"), config.viewabilityWaitTimeoutMs);
  let observer = null;
  document.addEventListener("visibilitychange", onVisibility);
  machine.addCleanup(() => {
    reset();
    clearTimeout(waitTimer);
    observer?.disconnect();
    document.removeEventListener("visibilitychange", onVisibility);
  });
  if (!("IntersectionObserver" in window)) {
    if (document.visibilityState === "visible") qualify();
    return;
  }
  observer = new IntersectionObserver((entries) => {
    const entry = entries[0];
    root.__nbxIntersectionRatio = entry?.intersectionRatio || 0;
    if (entry?.isIntersecting && entry.intersectionRatio >= config.viewabilityThreshold && document.visibilityState === "visible") qualify();
    else reset();
  }, { threshold: [0, config.viewabilityThreshold, 1] });
  observer.observe(root);
}

async function runAuction(root, config, machine, startedAt) {
  if (!machine.transition("auctioning")) return;
  machine.auctionCycles += 1;
  const auctionStarted = Date.now();
  config.__vastDeadline = auctionStarted + config.vastStageTimeoutMs;
  const hardStopTimer = window.setTimeout(() => {
    if (machine.isTerminal()) return;
    clear(root);
    track(config, "auction_hard_stop", { layer: "auction", reason: "global-25s-deadline" });
    if (machine.state === "auctioning" || machine.state === "rendering" || machine.state === "running-passback") machine.transition("no-fill", { reason: "global-25s-deadline" });
  }, config.globalHardStopMs);
  machine.addCleanup(() => clearTimeout(hardStopTimer));
  track(config, "auction_started", { layer: "auction" });
  const candidates = await collectCandidates(config, machine);
  if (machine.isTerminal()) return;
  const stageRank = (candidate) => candidate.layer === "vast" ? 0 : candidate.layer === "slider" ? 1 : 2;
  const ordered = candidates.sort((a, b) =>
    stageRank(a) - stageRank(b) || b.cpm - a.cpm || a.priority - b.priority);

  for (const candidate of ordered) {
    if (machine.isTerminal()) return;
    const price = candidateAllowed(candidate, config);
    if (!price.allowed) {
      track(config, "price_mismatch", {
        layer: candidate.layer,
        partnerName: candidate.partnerName,
        cpm: price.internalCpm,
        gamCpm: price.gamCpm,
        internalCpm: price.internalCpm,
        reason: `required-${price.requiredCpm}`
      });
      continue;
    }
    track(config, "winner_selected", { layer: candidate.layer, partnerName: candidate.partnerName, cpm: candidate.cpm });
    if (candidate.layer === "slider") {
      track(config, "slider_render_start", { layer: "slider", partnerName: candidate.partnerName });
    }
    if (machine.state === "auctioning" && !machine.transition("rendering")) return;
    let result;
    try {
      result = await renderCandidate(root, config, machine, candidate);
    } catch (error) {
      track(config, "render_error", {
        layer: candidate.layer,
        partnerName: candidate.partnerName,
        reason: error?.message || "render-error"
      });
      result = { filled: false, reason: error?.message || "render-error" };
    }
    if (machine.isTerminal()) return;
    if (result.filled) {
      if (candidate.layer === "slider") {
        track(config, "slider_rendered", { layer: "slider", partnerName: candidate.partnerName });
      }
      finishPaidRequest(config, machine, candidate, startedAt, auctionStarted);
      return;
    }
    if (candidate.layer === "slider") {
      track(config, "slider_failed", { layer: "slider", partnerName: candidate.partnerName, reason: result.reason || "slider-no-fill" });
    }
    array(candidate.errorUrls).forEach(pixel);
  }
  await runPassback(root, config, machine, startedAt, auctionStarted);
}

async function collectCandidates(config, machine) {
  const tasks = [];
  array(config.vastDemand).forEach((item, index) => {
    tasks.push(vastCandidate(config, machine, item, index));
  });
  array(config.prebidDemand).forEach((item, index) => tasks.push(jsonCandidate(config, machine, item, "prebid", 100 + index)));
  array(config.ortbDemand).forEach((item, index) => tasks.push(jsonCandidate(config, machine, item, "ortb", 300 + index)));
  if (config.sliderScriptUrl) {
    track(config, "partner_request", { layer: "slider", partnerName: config.sliderName });
    tasks.push(Promise.resolve({
      adType: "html",
      html: `<script async id="${escapeAttribute(config.sliderScriptId)}" type="text/javascript" src="${escapeAttribute(safeHttpUrl(config.sliderScriptUrl))}"><\/script>`,
      scriptUrl: config.sliderScriptUrl,
      partnerName: config.sliderName,
      layer: "slider",
      cpm: config.sliderCpm,
      priority: 0,
      timeoutMs: config.sliderTimeoutMs,
      frameUrl: String(config.configId || "").toLowerCase() === "moneycontrol.com" ? "https://nexbid.uk/nbx/slider-moneycontrol-wrapper.html" : ""
    }));
  }
  const tagItems = [
    ...array(config.displayScriptDemand).map((item) => ({ ...item, tagType: "script" })),
    ...array(config.adserverScriptDemand).map((item) => ({ ...item, tagType: "script" })),
    ...array(config.adserverHtmlDemand).map((item) => ({ ...item, tagType: "html" }))
  ];
  tagItems.forEach((item, index) => {
    track(config, "partner_request", { layer: "adserver", partnerName: item.name || "Adserver" });
    tasks.push(Promise.resolve({
      adType: item.tagType === "html" ? "html" : "script",
      html: decode(item.html || ""),
      scriptUrl: item.endpoint || item.url || "",
      partnerName: item.name || "Adserver",
      layer: "adserver",
      cpm: finiteNumber(item.floorCpm, 0),
      priority: 200 + index,
      timeoutMs: finiteNumber(item.timeoutMs, config.passbackTimeoutMs),
      frameUrl: item.frameUrl || ""
    }));
  });
  return new Promise((resolve) => {
    const results = [];
    let pending = tasks.length;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve(results);
    };
    const timer = setTimeout(finish, config.auctionBudgetMs);
    if (!tasks.length) return finish();
    tasks.forEach((task) => {
      Promise.resolve(task).then((candidate) => {
        if (!finished && candidate) results.push(candidate);
      }).catch(() => {}).finally(() => {
        pending -= 1;
        if (!pending) finish();
      });
    });
  });
}

async function vastCandidate(config, machine, item, index) {
  const partnerName = item.name || "VAST";
  track(config, "partner_request", { layer: "vast", partnerName });
  const source = item.endpoint || item.url || "";
  let ad;
  try {
    if (!config.serverSideVastResolution) throw new Error("server-vast-disabled");
    const url = new URL(config.vastResolverUrl);
    url.searchParams.set("source", source);
    url.searchParams.set("source_name", partnerName);
    url.searchParams.set("cpm", finiteNumber(item.floorCpm, 0));
    url.searchParams.set("allow_vpaid", item.allowVpaid === true && config.allowVpaid === true ? "1" : "0");
    url.searchParams.set("cb", config.gamCachebuster || config.cachebuster || String(Date.now()));
    const response = await fetch(url, { credentials: "omit", cache: "no-cache" });
    if (!response.ok) throw new Error(`vast-resolver-${response.status}`);
    ad = await response.json();
  } catch (error) {
    if (!config.legacyBrowserVastFallback) throw error;
    track(config, "vast_browser_fallback", { layer: "vast", partnerName, reason: error?.message || "resolver-error" });
    ad = await resolveVastInBrowser(source, {
      allowVpaid: item.allowVpaid === true && config.allowVpaid === true,
      cachebuster: config.gamCachebuster || config.cachebuster || String(Date.now()),
      cpm: finiteNumber(item.floorCpm, 0)
    });
  }
  if (machine.isTerminal()) throw new Error("late-vast-callback");
  track(config, "candidate_received", { layer: "vast", partnerName, cpm: ad.cpm });
  return { ...ad, vastTagUrl: source, partnerName, layer: "vast", cpm: finiteNumber(ad.cpm, item.floorCpm), priority: index };
}

async function resolveVastInBrowser(source, options, depth = 0, seen = new Set()) {
  if (depth > 3) throw new Error("vast-wrapper-limit");
  const sourceUrl = safeHttpUrl(expandVastMacros(source, options.cachebuster));
  if (seen.has(sourceUrl)) throw new Error("vast-wrapper-loop");
  seen.add(sourceUrl);
  const response = await fetch(sourceUrl, { credentials: "omit", cache: "no-cache" });
  if (!response.ok) throw new Error(`vast-browser-${response.status}`);
  const xml = new DOMParser().parseFromString(await response.text(), "application/xml");
  if (xml.querySelector("parsererror")) throw new Error("vast-invalid-xml");
  const wrapper = xml.querySelector("VASTAdTagURI")?.textContent?.trim();
  if (wrapper) return resolveVastInBrowser(new URL(expandVastMacros(wrapper, options.cachebuster), sourceUrl).toString(), options, depth + 1, seen);

  const media = Array.from(xml.querySelectorAll("MediaFile")).map((node) => {
    const type = String(node.getAttribute("type") || "").toLowerCase();
    const framework = String(node.getAttribute("apiFramework") || "").toLowerCase();
    const vpaid = framework === "vpaid" || type === "application/javascript";
    const compatible = /^video\/(mp4|webm|ogg)$/i.test(type) || /mpegurl/i.test(type);
    if (!compatible && !(options.allowVpaid && vpaid)) return null;
    return {
      url: new URL(node.textContent.trim(), sourceUrl).toString(),
      type,
      vpaid,
      width: finiteNumber(node.getAttribute("width"), 0),
      height: finiteNumber(node.getAttribute("height"), 0)
    };
  }).filter(Boolean).sort((a, b) => Number(a.vpaid) - Number(b.vpaid) ||
    Number(b.width === 300 && b.height === 250) - Number(a.width === 300 && a.height === 250))[0];
  if (!media) throw new Error("vast-no-media");
  const tracking = {};
  xml.querySelectorAll("Tracking").forEach((node) => {
    const event = node.getAttribute("event");
    if (!event || !node.textContent.trim()) return;
    (tracking[event] ||= []).push(new URL(node.textContent.trim(), sourceUrl).toString());
  });
  const click = xml.querySelector("ClickThrough")?.textContent?.trim() || "";
  return {
    adType: media.vpaid ? "vpaid-js" : "vast-video",
    mediaUrl: media.url,
    mediaType: media.type,
    adParameters: xml.querySelector("AdParameters")?.textContent?.trim() || "",
    clickUrl: click ? new URL(click, sourceUrl).toString() : "",
    impressionUrls: Array.from(xml.querySelectorAll("Impression")).map((node) => new URL(node.textContent.trim(), sourceUrl).toString()),
    tracking,
    cpm: options.cpm
  };
}

function expandVastMacros(value, cachebuster, config = {}) {
  const pageUrl = String(config.publisherPageUrl || document.referrer || window.location.href);
  const width = String(config.width || 300);
  const height = String(config.height || 250);
  return String(value || "")
    .replace(/\[(?:CACHEBUSTING|CACHEBUSTER)\]|%%CACHEBUSTER%%|%%CACHE_BUSTER%%|\[RANDOM\]/gi, encodeURIComponent(String(cachebuster || Date.now())))
    .replace(/%%WIDTH%%/gi, encodeURIComponent(width))
    .replace(/%%HEIGHT%%/gi, encodeURIComponent(height))
    .replace(/%%REFERRER_URL_ESC_ESC%%/gi, encodeURIComponent(encodeURIComponent(pageUrl)))
    .replace(/%%REFERRER_URL_ESC%%/gi, encodeURIComponent(pageUrl));
}

async function jsonCandidate(config, machine, item, layer, priority) {
  const partnerName = item.name || layer;
  track(config, "partner_request", { layer, partnerName });
  const response = await fetch(item.endpoint, { credentials: "omit", cache: "no-cache" });
  if (!response.ok) throw new Error(`${layer}-http-${response.status}`);
  const ad = await response.json();
  if (machine.isTerminal()) throw new Error(`late-${layer}-callback`);
  if (!ad || !(ad.imageUrl || ad.html || ad.scriptUrl || ad.mediaUrl)) throw new Error(`${layer}-no-fill`);
  track(config, "candidate_received", { layer, partnerName, cpm: ad.cpm });
  return { ...ad, partnerName, layer, cpm: finiteNumber(ad.cpm, item.floorCpm), priority };
}

async function renderCandidate(root, config, machine, candidate) {
  if (machine.isTerminal()) return { filled: false };
  if (candidate.adType === "vpaid-js") {
    if (!config.allowVpaid) return { filled: false, reason: "vpaid-disabled" };
    return renderVpaid(root, config, machine, candidate);
  }
  if (candidate.mediaUrl && candidate.adType !== "vpaid-js") return renderVideo(root, config, machine, candidate);
  if (candidate.imageUrl) return renderImage(root, config, machine, candidate);
  if (candidate.html || candidate.scriptUrl) return renderFrame(root, config, machine, candidate);
  return { filled: false, reason: "unsupported-candidate" };
}

function renderVpaid(root, config, machine, ad) {
  return loadImaSdk(config.imaSdkUrl).then(() => new Promise((resolve) => {
    clear(root);
    const modeName = config.vpaidMode === "enabled" ? "ENABLED" : "INSECURE";
    const video = document.createElement("video");
    const container = document.createElement("div");
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    video.autoplay = true;
    video.setAttribute("muted", "");
    video.setAttribute("playsinline", "");
    video.style.cssText = "display:block;width:100%;height:100%;object-fit:contain";
    container.style.cssText = "position:absolute;inset:0;width:100%;height:100%";
    root.appendChild(video);
    root.appendChild(container);

    const mode = config.vpaidMode === "enabled"
      ? google.ima.ImaSdkSettings.VpaidMode.ENABLED
      : google.ima.ImaSdkSettings.VpaidMode.INSECURE;
    google.ima.settings.setVpaidMode(mode);
    track(config, "vpaid_mode_selected", { layer: "vast", partnerName: ad.partnerName, reason: modeName });

    const display = new google.ima.AdDisplayContainer(container, video);
    const loader = new google.ima.AdsLoader(display);
    let manager = null;
    let settled = false;
    let started = false;
    let timer = 0;

    const destroy = () => {
      clearTimeout(timer);
      try { manager?.destroy(); } catch (_) {}
      try { loader.destroy(); } catch (_) {}
    };
    const finish = (filled, reason) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!filled) {
        destroy();
        clear(root);
      }
      resolve({ filled, reason });
    };
    const fail = (event) => {
      const error = event?.getError ? event.getError() : event;
      const code = error?.getErrorCode ? error.getErrorCode() : "unknown";
      const reason = `ima-${code}-${String(error?.toString?.() || error || "vpaid-error")}`;
      track(config, "vpaid_error", { layer: "vast", partnerName: ad.partnerName, reason });
      finish(false, reason);
    };

    loader.addEventListener(google.ima.AdsManagerLoadedEvent.Type.ADS_MANAGER_LOADED, (event) => {
      try {
        const settings = new google.ima.AdsRenderingSettings();
        settings.restoreCustomPlaybackStateOnAdBreakComplete = true;
        manager = event.getAdsManager(video, settings);
        manager.addEventListener(google.ima.AdErrorEvent.Type.AD_ERROR, fail);
        manager.addEventListener(google.ima.AdEvent.Type.LOADED, () => {
          track(config, "vpaid_loaded", { layer: "vast", partnerName: ad.partnerName, reason: modeName });
        });
        manager.addEventListener(google.ima.AdEvent.Type.STARTED, () => {
          started = true;
          track(config, "vpaid_mode_success", { layer: "vast", partnerName: ad.partnerName, reason: modeName });
          track(config, "video_start", { layer: "vast", partnerName: ad.partnerName });
          finish(true, "");
        });
        manager.addEventListener(google.ima.AdEvent.Type.FIRST_QUARTILE, () =>
          track(config, "video_firstQuartile", { layer: "vast", partnerName: ad.partnerName }));
        manager.addEventListener(google.ima.AdEvent.Type.MIDPOINT, () =>
          track(config, "video_midpoint", { layer: "vast", partnerName: ad.partnerName }));
        manager.addEventListener(google.ima.AdEvent.Type.THIRD_QUARTILE, () =>
          track(config, "video_thirdQuartile", { layer: "vast", partnerName: ad.partnerName }));
        manager.addEventListener(google.ima.AdEvent.Type.COMPLETE, () => {
          track(config, "video_complete", { layer: "vast", partnerName: ad.partnerName });
          destroy();
        });
        manager.init(config.width, config.height, google.ima.ViewMode.NORMAL);
        manager.start();
      } catch (error) {
        fail(error);
      }
    }, false);
    loader.addEventListener(google.ima.AdErrorEvent.Type.AD_ERROR, fail, false);

    const request = new google.ima.AdsRequest();
    request.adTagUrl = expandVastMacros(ad.vastTagUrl || "", config.gamCachebuster || config.cachebuster, config);
    request.linearAdSlotWidth = config.width;
    request.linearAdSlotHeight = config.height;
    request.nonLinearAdSlotWidth = config.width;
    request.nonLinearAdSlotHeight = config.height;
    request.setAdWillAutoPlay(true);
    request.setAdWillPlayMuted(true);

    timer = setTimeout(() => {
      if (started) return;
      track(config, "vpaid_timeout", { layer: "vast", partnerName: ad.partnerName, reason: modeName });
      finish(false, "vpaid-start-timeout");
    }, Math.max(10000, config.vpaidStartTimeoutMs));

    try {
      display.initialize();
      loader.requestAds(request);
    } catch (error) {
      fail(error);
    }
  })).catch((error) => {
    const reason = error?.message || "ima-sdk-load-error";
    track(config, "vpaid_error", { layer: "vast", partnerName: ad.partnerName, reason });
    return { filled: false, reason };
  });
}

function loadImaSdk(source) {
  if (window.google?.ima) return Promise.resolve(window.google.ima);
  if (imaSdkPromise) return imaSdkPromise;
  imaSdkPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.async = true;
    script.src = safeHttpUrl(source || DEFAULT_IMA_SDK_URL);
    script.onload = () => window.google?.ima ? resolve(window.google.ima) : reject(new Error("ima-sdk-unavailable"));
    script.onerror = () => reject(new Error("ima-sdk-load-error"));
    document.head.appendChild(script);
  });
  return imaSdkPromise;
}

function renderImage(root, config, machine, ad) {
  return new Promise((resolve) => {
    clear(root);
    const image = document.createElement("img");
    image.src = safeHttpUrl(ad.imageUrl);
    image.width = config.width;
    image.height = config.height;
    image.alt = "Advertisement";
    image.onload = () => resolve({ filled: !machine.isTerminal() });
    image.onerror = () => resolve({ filled: false, reason: "image-error" });
    const click = httpClick(ad.clickUrl, config.gamClickMacro);
    if (click) {
      const link = document.createElement("a");
      link.href = click;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.appendChild(image);
      root.appendChild(link);
    } else {
      root.appendChild(image);
    }
  });
}

function renderVideo(root, config, machine, ad) {
  return new Promise((resolve) => {
    clear(root);
    let settled = false;
    let startTimer = 0;
    const finish = (result) => { if (settled) return; settled = true; clearTimeout(startTimer); resolve(result); };
    const remaining = Math.max(0, finiteNumber(config.__vastDeadline, Date.now()) - Date.now());
    if (!remaining) { resolve({ filled: false, reason: "vast-stage-timeout" }); return; }
    startTimer = window.setTimeout(() => finish({ filled: false, reason: "vast-stage-timeout" }), remaining);
    const video = document.createElement("video");
    video.src = safeHttpUrl(ad.mediaUrl);
    video.width = config.width;
    video.height = config.height;
    video.muted = true;
    video.playsInline = true;
    video.autoplay = true;
    video.controls = true;
    const fired = new Set();
    const fire = (name) => {
      if (fired.has(name)) return;
      fired.add(name);
      array(ad.tracking?.[name]).forEach(pixel);
      track(config, `video_${name}`, { layer: "vast", partnerName: ad.partnerName });
    };
    video.addEventListener("playing", () => {
      fire("start");
      finish({ filled: !machine.isTerminal() });
    }, { once: true });
    video.addEventListener("timeupdate", () => {
      if (!video.duration) return;
      const ratio = video.currentTime / video.duration;
      if (ratio >= 0.25) fire("firstQuartile");
      if (ratio >= 0.5) fire("midpoint");
      if (ratio >= 0.75) fire("thirdQuartile");
    });
    video.addEventListener("ended", () => fire("complete"), { once: true });
    video.addEventListener("error", () => finish({ filled: false, reason: "video-error" }), { once: true });
    const click = httpClick(ad.clickUrl, config.gamClickMacro);
    if (click) {
      const link = document.createElement("a");
      link.href = click;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.appendChild(video);
      root.appendChild(link);
    } else {
      root.appendChild(video);
    }
    video.play().catch(() => finish({ filled: false, reason: "autoplay-blocked" }));
  });
}

function renderFrame(root, config, machine, ad) {
  return new Promise((resolve) => {
    clear(root);
    const frame = document.createElement("iframe");
    frame.width = config.width;
    frame.height = config.height;
    frame.title = "Advertisement";
    frame.setAttribute("scrolling", "no");
    frame.setAttribute("frameborder", "0");
    frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox");
    const token = makeId();
    const timeout = Math.max(500, finiteNumber(ad.timeoutMs, 2000));
    const listener = (event) => {
      if (event.source !== frame.contentWindow || event.data?.token !== token || machine.isTerminal()) return;
      cleanup();
      resolve({ filled: event.data.filled === true, reason: event.data.reason || "" });
    };
    const cleanup = () => {
      clearTimeout(timer);
      window.removeEventListener("message", listener);
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve({ filled: false, reason: "creative-timeout" });
    }, timeout + 250);
    machine.addCleanup(cleanup);
    window.addEventListener("message", listener);
    root.appendChild(frame);
    const body = ad.html || `<script src="${escapeAttribute(safeHttpUrl(ad.scriptUrl))}"><\/script>`;
    if (ad.frameUrl) {
      const frameUrl = new URL(safeHttpUrl(ad.frameUrl));
      frameUrl.searchParams.set("token", token);
      frameUrl.searchParams.set("cb", String(Date.now()));
      frame.src = frameUrl.toString();
    } else {
      frame.srcdoc = frameDocument(body, token, timeout);
    }
  });
}

async function runPassback(root, config, machine, startedAt, auctionStarted) {
  if (!config.enablePassback || !(config.passbackHtml || config.passbackScriptUrl)) {
    finishNoFill(root, config, machine, "all-demand-no-fill", startedAt, auctionStarted);
    return;
  }
  if (!machine.startPassback()) return;
  track(config, "passback_request", { layer: "passback" });
  try {
    const result = await renderFrame(root, config, machine, {
      html: decode(config.passbackHtml || ""),
      scriptUrl: config.passbackScriptUrl,
      timeoutMs: config.passbackTimeoutMs
    });
    if (machine.isTerminal()) return;
    if (result.filled) {
      track(config, "passback_fill", { layer: "passback" });
      machine.transition("passed-back", { reason: "passback-fill" });
      return;
    }
    track(config, "passback_no_fill", { layer: "passback", reason: result.reason });
    finishNoFill(root, config, machine, result.reason || "passback-no-fill", startedAt, auctionStarted);
  } catch (error) {
    track(config, "passback_error", { layer: "passback", reason: error?.message || "passback-error" });
    finishNoFill(root, config, machine, "passback-error", startedAt, auctionStarted);
  }
}

function finishPaidRequest(config, machine, ad, startedAt, auctionStarted) {
  if (!machine.recordDelivery()) return;
  const now = Date.now();
  track(config, "render_confirmed", { layer: ad.layer, partnerName: ad.partnerName, cpm: ad.cpm, timeToFirstRenderMs: now - startedAt });
  track(config, "request_filled", { layer: ad.layer, partnerName: ad.partnerName, cpm: ad.cpm, auctionLatencyMs: now - auctionStarted });
  track(config, "impression", { layer: ad.layer, partnerName: ad.partnerName, cpm: ad.cpm });
  array(ad.impressionUrls || ad.impressionUrl).forEach(pixel);
  machine.transition("filled", { partnerName: ad.partnerName });
}

function finishNoFill(root, config, machine, reason, startedAt, auctionStarted) {
  if (config.collapseOnPassbackFailure) {
    root.style.width = "0";
    root.style.height = "0";
    root.style.display = "none";
  } else clear(root);
  track(config, "final_no_fill", { layer: "empty", reason, auctionLatencyMs: Date.now() - auctionStarted, timeToFirstRenderMs: Date.now() - startedAt });
  if (machine.state === "running-passback" || machine.state === "auctioning" || machine.state === "rendering") {
    machine.transition("no-fill", { reason });
  }
}

function track(config, event, data = {}) {
  const endpoint = config.trackUrl || `${config.apiBase}/api/v1/track`;
  const url = new URL(endpoint);
  const values = {
    event,
    config_id: config.configId || "",
    product_version: "Version 1 Price Priority Safe",
    publisher_id: config.publisherId || "",
    publisher_domain: config.publisherDomain || "",
    placement_id: config.placementId || "",
    request_id: config.requestId || "",
    layer: data.layer || "",
    partner_name: data.partnerName || "",
    cpm: data.cpm ?? "",
    reason: data.reason || "",
    terminal_state: data.terminalState || "",
    auction_latency_ms: data.auctionLatencyMs ?? "",
    time_to_first_render_ms: data.timeToFirstRenderMs ?? "",
    gam_cpm: data.gamCpm ?? config.gamLineItemCpm ?? "",
    internal_cpm: data.internalCpm ?? "",
    cb: `${Date.now()}${Math.floor(Math.random() * 10000)}`
  };
  Object.entries(values).forEach(([key, value]) => url.searchParams.set(key, String(value)));
  fetch(url, { method: "GET", credentials: "omit", keepalive: true }).catch(() => pixel(url.toString()));
}

function frameDocument(body, token, timeout) {
  const tokenJson = JSON.stringify(token);
  return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;background:transparent}iframe,img,video,canvas,object,embed{max-width:100%;max-height:100%}</style></head><body><script>(function(){var done=false,start=Date.now();function finish(filled,reason){if(done)return;done=true;parent.postMessage({token:${tokenJson},filled:!!filled,reason:reason||""},"*")}function visible(){var a=document.body.querySelectorAll("*");for(var i=0;i<a.length;i++){var e=a[i];if(/^(SCRIPT|STYLE|LINK|META)$/.test(e.tagName))continue;var r=e.getBoundingClientRect(),s=getComputedStyle(e);if(r.width>10&&r.height>10&&s.display!=="none"&&s.visibility!=="hidden"&&Number(s.opacity)!==0)return true}return false}var poll=setInterval(function(){if(visible()){clearInterval(poll);finish(true,"")}},100);setTimeout(function(){clearInterval(poll);finish(false,"creative-timeout")},${Number(timeout)});})();<\/script>${body}</body></html>`;
}

function shell(target, config) {
  target.innerHTML = "";
  const root = document.createElement("div");
  root.className = "nbx-safe-root";
  root.style.cssText = `position:relative;width:${config.width}px;height:${config.height}px;overflow:hidden;background:transparent`;
  target.appendChild(root);
  return root;
}

function clear(root) { while (root.firstChild) root.removeChild(root.firstChild); }
function array(value) { return Array.isArray(value) ? value.filter(Boolean) : value ? [value] : []; }
function decode(value) { try { return decodeURIComponent(value || ""); } catch (_) { return String(value || ""); } }
function safeHttpUrl(value) {
  const url = new URL(String(value || ""), window.location.href);
  if (!/^https?:$/.test(url.protocol)) throw new Error("unsafe-url");
  return url.toString();
}
function httpClick(value, macro) {
  const raw = String(value || "").trim();
  if (!/^https?:\/\//i.test(raw)) return "";
  return prependGamClick(raw, macro);
}
function escapeAttribute(value) { return String(value || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;"); }
function pixel(value) { if (!value) return; const image = new Image(); image.src = String(value); }
function makeId() { return `nbx-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`; }
