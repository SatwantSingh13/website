import { RequestState, candidateAllowed, finiteNumber, prependGamClick } from "./v1-safe-core.mjs";

const TERMINALS = new Set(["filled", "passed-back", "no-fill", "cancelled", "error"]);

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
  return normalize({
    ...base,
    ...remote,
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
    auctionBudgetMs: finiteNumber(config.auctionBudgetMs, 1200),
    passbackTimeoutMs: finiteNumber(config.passbackTimeoutMs, 2000),
    enablePassback: config.enablePassback === true,
    collapseOnPassbackFailure: config.collapseOnPassbackFailure === true,
    rejectBelowGamRate: config.rejectBelowGamRate !== false,
    minimumInternalCpm: finiteNumber(config.minimumInternalCpm, 0),
    gamLineItemCpm: finiteNumber(config.gamLineItemCpm, 0),
    priceMismatchTolerance: finiteNumber(config.priceMismatchTolerance, 0),
    vastResolverUrl: config.vastResolverUrl || `${config.apiBase}/api/v1/vast/resolve`,
    serverSideVastResolution: config.serverSideVastResolution !== false,
    legacyBrowserVastFallback: config.legacyBrowserVastFallback === true
  };
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
  track(config, "auction_started", { layer: "auction" });
  const candidates = await collectCandidates(config, machine);
  if (machine.isTerminal()) return;
  const ordered = candidates.sort((a, b) => b.cpm - a.cpm || a.priority - b.priority);

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
      finishPaidRequest(config, machine, candidate, startedAt, auctionStarted);
      return;
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
      timeoutMs: finiteNumber(item.timeoutMs, config.passbackTimeoutMs)
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
  return { ...ad, partnerName, layer: "vast", cpm: finiteNumber(ad.cpm, item.floorCpm), priority: index };
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

function expandVastMacros(value, cachebuster) {
  return String(value || "")
    .replace(/\[(?:CACHEBUSTING|CACHEBUSTER)\]|%%CACHEBUSTER%%|\[RANDOM\]/gi, encodeURIComponent(String(cachebuster || Date.now())));
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
  return new Promise((resolve) => {
    clear(root);
    const frame = document.createElement("iframe");
    const token = makeId();
    let settled = false;
    frame.width = config.width;
    frame.height = config.height;
    frame.title = "Advertisement";
    frame.setAttribute("frameborder", "0");
    frame.setAttribute("scrolling", "no");
    frame.setAttribute("sandbox", "allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox");
    let timer = 0;
    const cleanup = () => {
      clearTimeout(timer);
      window.removeEventListener("message", listener);
    };
    const finish = (filled, reason) => {
      if (settled) return;
      settled = true;
      if (!filled) cleanup();
      else {
        clearTimeout(timer);
        timer = setTimeout(cleanup, 120000);
      }
      resolve({ filled, reason });
    };
    const listener = (event) => {
      const data = event.data || {};
      if (event.source !== frame.contentWindow || data.token !== token || data.type !== "nbx-vpaid") return;
      if (data.event === "started") finish(true, "");
      else if (data.event === "complete") {
        track(config, "video_complete", { layer: "vast", partnerName: ad.partnerName });
        cleanup();
      } else if (data.event === "error") finish(false, data.reason || "vpaid-error");
    };
    timer = setTimeout(() => finish(false, "vpaid-timeout"), Math.max(1000, finiteNumber(ad.timeoutMs, 4000)));
    window.addEventListener("message", listener);
    root.appendChild(frame);
    frame.srcdoc = vpaidDocument(ad, config, token);
  });
}

function vpaidDocument(ad, config, token) {
  const media = JSON.stringify(safeHttpUrl(ad.mediaUrl));
  const params = JSON.stringify(String(ad.adParameters || ""));
  const tokenJson = JSON.stringify(token);
  return `<!doctype html><html><head><meta charset="utf-8"><style>html,body,#slot,video{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}</style></head><body><div id="slot"><video id="video" muted playsinline></video></div><script>(function(){var token=${tokenJson},ad,done=false;function send(event,reason){parent.postMessage({type:"nbx-vpaid",token:token,event:event,reason:reason||""},"*")}function fail(e){if(done)return;done=true;send("error",String(e&&e.message||e))}function sub(name,fn){try{ad.subscribe(fn,name,window)}catch(e){}}function boot(){try{if(typeof getVPAIDAd!=="function")throw Error("missing-getVPAIDAd");ad=getVPAIDAd();if(!ad||!ad.handshakeVersion("2.0"))throw Error("vpaid-handshake");sub("AdLoaded",function(){try{ad.startAd()}catch(e){fail(e)}});sub("AdStarted",function(){send("started")});sub("AdImpression",function(){send("started")});sub("AdVideoComplete",function(){send("complete")});sub("AdStopped",function(){send("complete")});sub("AdError",fail);ad.initAd(${Number(config.width)},${Number(config.height)},"normal",-1,{AdParameters:${params}},{slot:document.getElementById("slot"),videoSlot:document.getElementById("video"),videoSlotCanAutoPlay:true})}catch(e){fail(e)}}var s=document.createElement("script");s.src=${media};s.onload=boot;s.onerror=function(){fail("vpaid-script-load")};document.head.appendChild(s)})();<\/script></body></html>`;
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
      resolve({ filled: !machine.isTerminal() });
    }, { once: true });
    video.addEventListener("timeupdate", () => {
      if (!video.duration) return;
      const ratio = video.currentTime / video.duration;
      if (ratio >= 0.25) fire("firstQuartile");
      if (ratio >= 0.5) fire("midpoint");
      if (ratio >= 0.75) fire("thirdQuartile");
    });
    video.addEventListener("ended", () => fire("complete"), { once: true });
    video.addEventListener("error", () => resolve({ filled: false, reason: "video-error" }), { once: true });
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
    video.play().catch(() => resolve({ filled: false, reason: "autoplay-blocked" }));
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
    frame.setAttribute("sandbox", "allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox");
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
    frame.srcdoc = frameDocument(body, token, timeout);
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
