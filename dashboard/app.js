(function () {
  "use strict";

  var state = defaultState();
  try {
    window.localStorage.removeItem("nexbanner-dashboard-v1");
  } catch (_) {}
  state.demand = state.demand || [];
  state.displayTags = state.displayTags || [];
  state.prebid = state.prebid || [];
  state.adserverTags = state.adserverTags || [];

  var els = {
    publisherId: document.getElementById("publisherId"),
    publisherDomain: document.getElementById("publisherDomain"),
    placementId: document.getElementById("placementId"),
    width: document.getElementById("width"),
    height: document.getElementById("height"),
    cdnScript: document.getElementById("cdnScript"),
    apiBase: document.getElementById("apiBase"),
    demandForm: document.getElementById("demandForm"),
    demandName: document.getElementById("demandName"),
    demandType: document.getElementById("demandType"),
    demandEndpoint: document.getElementById("demandEndpoint"),
    floorCpm: document.getElementById("floorCpm"),
    timeoutMs: document.getElementById("timeoutMs"),
    demandNotice: document.getElementById("demandNotice"),
    demandList: document.getElementById("demandList"),
    displayTagForm: document.getElementById("displayTagForm"),
    displayTagName: document.getElementById("displayTagName"),
    displayTagUrl: document.getElementById("displayTagUrl"),
    displayTagFloor: document.getElementById("displayTagFloor"),
    displayTagTimeout: document.getElementById("displayTagTimeout"),
    displayTagNotice: document.getElementById("displayTagNotice"),
    displayTagList: document.getElementById("displayTagList"),
    prebidForm: document.getElementById("prebidForm"),
    prebidName: document.getElementById("prebidName"),
    prebidEndpoint: document.getElementById("prebidEndpoint"),
    prebidParams: document.getElementById("prebidParams"),
    prebidFloor: document.getElementById("prebidFloor"),
    prebidTimeout: document.getElementById("prebidTimeout"),
    prebidNotice: document.getElementById("prebidNotice"),
    prebidList: document.getElementById("prebidList"),
    adserverForm: document.getElementById("adserverForm"),
    adserverName: document.getElementById("adserverName"),
    adserverTagType: document.getElementById("adserverTagType"),
    adserverHtml: document.getElementById("adserverHtml"),
    adserverUrl: document.getElementById("adserverUrl"),
    adserverFloor: document.getElementById("adserverFloor"),
    adserverTimeout: document.getElementById("adserverTimeout"),
    adserverNotice: document.getElementById("adserverNotice"),
    adserverList: document.getElementById("adserverList"),
    ortbForm: document.getElementById("ortbForm"),
    ortbName: document.getElementById("ortbName"),
    ortbEndpoint: document.getElementById("ortbEndpoint"),
    ortbFloor: document.getElementById("ortbFloor"),
    ortbTimeout: document.getElementById("ortbTimeout"),
    ortbNotice: document.getElementById("ortbNotice"),
    ortbList: document.getElementById("ortbList"),
    tagOutput: document.getElementById("tagOutput"),
    generateTag: document.getElementById("generateTag"),
    saveConfig: document.getElementById("saveConfig"),
    generateShortTag: document.getElementById("generateShortTag"),
    copyTag: document.getElementById("copyTag"),
    saveConfigV2: document.getElementById("saveConfigV2"),
    generateShortTagV2: document.getElementById("generateShortTagV2"),
    copyTagV2: document.getElementById("copyTagV2"),
    tagOutputV2: document.getElementById("tagOutputV2"),
    reportScope: document.getElementById("reportScope"),
    reportConfigId: document.getElementById("reportConfigId"),
    refreshReport: document.getElementById("refreshReport"),
    autoRefreshReport: document.getElementById("autoRefreshReport"),
    metricAdRequests: document.getElementById("metricAdRequests"),
    metricFilledRequests: document.getElementById("metricFilledRequests"),
    metricFillRate: document.getElementById("metricFillRate"),
    metricEcpm: document.getElementById("metricEcpm"),
    reportTrackingNote: document.getElementById("reportTrackingNote"),
    partnerReportBody: document.getElementById("partnerReportBody"),
    reportOutput: document.getElementById("reportOutput"),
    exportConfig: document.getElementById("exportConfig")
  };
  var reportTimer = null;

  hydrate();
  renderDemand();
  renderDisplayTags();
  renderPrebid();
  renderAdserverTags();
  renderOrtb();
  generateTag();

  els.demandForm.addEventListener("submit", function (event) {
    event.preventDefault();
    var addedName = els.demandName.value.trim();
    state.demand.push({
      id: String(Date.now()) + Math.floor(Math.random() * 10000),
      name: addedName,
      type: els.demandType.value,
      endpoint: els.demandEndpoint.value.trim(),
      floorCpm: els.floorCpm.value.trim(),
      timeoutMs: els.timeoutMs.value.trim()
    });
    els.demandForm.reset();
    els.floorCpm.value = "0.10";
    els.timeoutMs.value = "800";
    saveFromForm();
    showNotice(els.demandNotice, addedName + " has been added.");
    renderDemand();
    generateTag();
  });

  els.displayTagForm.addEventListener("submit", function (event) {
    event.preventDefault();
    var addedName = els.displayTagName.value.trim();
    state.displayTags.push({
      id: String(Date.now()) + Math.floor(Math.random() * 10000),
      name: addedName,
      endpoint: els.displayTagUrl.value.trim(),
      floorCpm: els.displayTagFloor.value.trim(),
      timeoutMs: els.displayTagTimeout.value.trim()
    });
    els.displayTagForm.reset();
    els.displayTagFloor.value = "0.10";
    els.displayTagTimeout.value = "800";
    saveFromForm();
    showNotice(els.displayTagNotice, addedName + " has been added.");
    renderDisplayTags();
    generateTag();
  });

  els.prebidForm.addEventListener("submit", function (event) {
    event.preventDefault();
    var addedName = els.prebidName.value.trim();
    state.prebid.push({
      id: String(Date.now()) + Math.floor(Math.random() * 10000),
      name: addedName,
      endpoint: els.prebidEndpoint.value.trim(),
      params: els.prebidParams.value.trim(),
      floorCpm: els.prebidFloor.value.trim(),
      timeoutMs: els.prebidTimeout.value.trim()
    });
    els.prebidForm.reset();
    els.prebidFloor.value = "0.20";
    els.prebidTimeout.value = "900";
    saveFromForm();
    showNotice(els.prebidNotice, addedName + " has been added.");
    renderPrebid();
    generateTag();
  });

  els.adserverForm.addEventListener("submit", function (event) {
    event.preventDefault();
    var addedName = els.adserverName.value.trim();
    state.adserverTags.push({
      id: String(Date.now()) + Math.floor(Math.random() * 10000),
      name: addedName,
      tagType: els.adserverTagType.value,
      html: els.adserverHtml.value.trim(),
      endpoint: els.adserverUrl.value.trim(),
      floorCpm: els.adserverFloor.value.trim(),
      timeoutMs: els.adserverTimeout.value.trim()
    });
    els.adserverForm.reset();
    els.adserverFloor.value = "0.10";
    els.adserverTimeout.value = "900";
    saveFromForm();
    showNotice(els.adserverNotice, addedName + " has been added.");
    renderAdserverTags();
    generateTag();
  });

  els.ortbForm.addEventListener("submit", function (event) {
    event.preventDefault();
    var addedName = els.ortbName.value.trim();
    state.demand.push({
      id: String(Date.now()) + Math.floor(Math.random() * 10000),
      name: addedName,
      type: "ortb",
      endpoint: els.ortbEndpoint.value.trim(),
      floorCpm: els.ortbFloor.value.trim(),
      timeoutMs: els.ortbTimeout.value.trim()
    });
    els.ortbForm.reset();
    els.ortbFloor.value = "0.05";
    els.ortbTimeout.value = "700";
    saveFromForm();
    showNotice(els.ortbNotice, addedName + " has been added.");
    renderOrtb();
    generateTag();
  });

  [
    els.publisherId,
    els.publisherDomain,
    els.placementId,
    els.width,
    els.height,
    els.cdnScript,
    els.apiBase
  ].forEach(function (input) {
    input.addEventListener("input", function () {
      saveFromForm();
      generateTag();
    });
  });

  els.generateTag.addEventListener("click", generateTag);
  els.saveConfig.addEventListener("click", saveFinalConfig);
  els.generateShortTag.addEventListener("click", generateShortTag);
  els.saveConfigV2.addEventListener("click", saveVersion2Config);
  els.generateShortTagV2.addEventListener("click", generateShortTagV2);
  els.refreshReport.addEventListener("click", refreshReport);
  els.autoRefreshReport.addEventListener("click", toggleAutoRefreshReport);

  els.copyTag.addEventListener("click", function () {
    els.tagOutput.select();
    document.execCommand("copy");
    els.copyTag.textContent = "Copied";
    setTimeout(function () {
      els.copyTag.textContent = "Copy Tag";
    }, 1200);
  });

  els.copyTagV2.addEventListener("click", function () {
    els.tagOutputV2.select();
    document.execCommand("copy");
    els.copyTagV2.textContent = "Copied";
    setTimeout(function () {
      els.copyTagV2.textContent = "Copy Version 2 Tag";
    }, 1200);
  });

  els.exportConfig.addEventListener("click", function () {
    var blob = new Blob([JSON.stringify(buildConfig(), null, 2)], {
      type: "application/json"
    });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = "nexbanner-demand-config.json";
    link.click();
    URL.revokeObjectURL(url);
  });

  function hydrate() {
    if (!state.setup) return;
    Object.keys(state.setup).forEach(function (key) {
      if (els[key]) els[key].value = state.setup[key];
    });
  }

  function renderDemand() {
    els.demandList.innerHTML = "";

    var primaryDemand = state.demand.filter(function (item) {
      return item.type !== "ortb";
    });

    if (!primaryDemand.length) {
      var empty = document.createElement("p");
      empty.textContent = "No demand endpoints added yet.";
      empty.style.color = "#607083";
      els.demandList.appendChild(empty);
      return;
    }

    primaryDemand.forEach(function (item) {
      var node = document.createElement("div");
      node.className = "demand-item";
      node.innerHTML = [
        "<header>",
        "<div><strong>" + escapeHtml(item.name) + "</strong><div class=\"badge\">" + labelFor(item.type) + "</div></div>",
        "<button class=\"remove\" data-id=\"" + item.id + "\">Remove</button>",
        "</header>",
        "<code>" + escapeHtml(item.endpoint) + "</code>",
        "<small>Floor $" + escapeHtml(item.floorCpm || "0") + " CPM, timeout " + escapeHtml(item.timeoutMs || "800") + "ms</small>"
      ].join("");

      node.querySelector(".remove").addEventListener("click", function () {
        state.demand = state.demand.filter(function (existing) {
          return existing.id !== item.id;
        });
        saveFromForm();
        renderDemand();
        generateTag();
      });

      els.demandList.appendChild(node);
    });
  }

  function renderOrtb() {
    els.ortbList.innerHTML = "";

    var ortbDemand = state.demand.filter(function (item) {
      return item.type === "ortb";
    });

    if (!ortbDemand.length) {
      appendEmpty(els.ortbList, "No ORTB fallback endpoints added yet.");
      return;
    }

    ortbDemand.forEach(function (item) {
      var node = demandNode(item, "ORTB Fallback", item.endpoint);
      node.querySelector(".remove").addEventListener("click", function () {
        state.demand = state.demand.filter(function (existing) {
          return existing.id !== item.id;
        });
        saveFromForm();
        renderOrtb();
        generateTag();
      });
      els.ortbList.appendChild(node);
    });
  }

  function renderDisplayTags() {
    els.displayTagList.innerHTML = "";

    if (!state.displayTags.length) {
      var empty = document.createElement("p");
      empty.textContent = "No display JS tags added yet.";
      empty.style.color = "#607083";
      els.displayTagList.appendChild(empty);
      return;
    }

    state.displayTags.forEach(function (item) {
      var node = document.createElement("div");
      node.className = "demand-item";
      node.innerHTML = [
        "<header>",
        "<div><strong>" + escapeHtml(item.name) + "</strong><div class=\"badge\">Display JS Tag</div></div>",
        "<button class=\"remove\" data-id=\"" + item.id + "\">Remove</button>",
        "</header>",
        "<code>" + escapeHtml(item.endpoint) + "</code>",
        "<small>Floor $" + escapeHtml(item.floorCpm || "0") + " CPM, timeout " + escapeHtml(item.timeoutMs || "800") + "ms</small>"
      ].join("");

      node.querySelector(".remove").addEventListener("click", function () {
        state.displayTags = state.displayTags.filter(function (existing) {
          return existing.id !== item.id;
        });
        saveFromForm();
        renderDisplayTags();
        generateTag();
      });

      els.displayTagList.appendChild(node);
    });
  }

  function renderPrebid() {
    els.prebidList.innerHTML = "";

    if (!state.prebid.length) {
      appendEmpty(els.prebidList, "No Prebid parameters added yet.");
      return;
    }

    state.prebid.forEach(function (item) {
      var node = demandNode(item, "Prebid Params", item.endpoint || "Uses API Base /api/v1/auction");
      node.querySelector(".remove").addEventListener("click", function () {
        state.prebid = state.prebid.filter(function (existing) {
          return existing.id !== item.id;
        });
        saveFromForm();
        renderPrebid();
        generateTag();
      });
      els.prebidList.appendChild(node);
    });
  }

  function renderAdserverTags() {
    els.adserverList.innerHTML = "";

    if (!state.adserverTags.length) {
      appendEmpty(els.adserverList, "No Ad Manager / MI tags added yet.");
      return;
    }

    state.adserverTags.forEach(function (item) {
      var node = demandNode(item, "Ad Server JS", item.endpoint);
      node.querySelector(".remove").addEventListener("click", function () {
        state.adserverTags = state.adserverTags.filter(function (existing) {
          return existing.id !== item.id;
        });
        saveFromForm();
        renderAdserverTags();
        generateTag();
      });
      els.adserverList.appendChild(node);
    });
  }

  function generateTag() {
    var config = buildConfig();
    var vastTags = endpointsFor("vast");
    var display = firstEndpoint("display");
    var displayJsTags = endpointsFrom(state.displayTags);
    var adserverTags = endpointsFrom(state.adserverTags);
    var adserverHtmlTags = htmlTagsFrom(state.adserverTags);
    var prebid = state.prebid[0] || null;
    var prebidDemand = state.prebid.map(function (item) {
      return {
        name: item.name || "",
        endpoint: item.endpoint || "",
        params: item.params || ""
      };
    });
    var ortbEndpoints = endpointsFor("ortb");
    var apiBase = trimSlash(config.setup.apiBase);

    var lines = [
      '<div id="nexbanner-slot-%%CACHEBUSTER%%"></div>',
      "<script",
      '  src="' + config.setup.cdnScript + '"',
      '  data-target="nexbanner-slot-%%CACHEBUSTER%%"',
      '  data-publisher-id="' + config.setup.publisherId + '"',
      '  data-publisher-domain="' + config.setup.publisherDomain + '"',
      '  data-placement-id="' + config.setup.placementId + '"',
      '  data-width="' + config.setup.width + '"',
      '  data-height="' + config.setup.height + '"',
      '  data-mode="video-first"',
      vastTags.length ? '  data-vast-tags="' + vastTags.join("|") + '"' : '  data-vast-url="' + apiBase + "/api/v1/vast" + '"',
      '  data-auction-endpoint="' + apiBase + "/api/v1/auction" + '"',
      '  data-track-url="' + apiBase + "/api/v1/track" + '"',
      prebid && prebid.endpoint ? '  data-prebid-endpoint="' + prebid.endpoint + '"' : "",
      prebid && prebid.params ? '  data-prebid-params="' + encodeAttribute(prebid.params) + '"' : "",
      prebidDemand.length ? '  data-prebid-demand="' + encodeAttribute(encodeURIComponent(JSON.stringify(prebidDemand))) + '"' : "",
      displayJsTags.length ? '  data-display-script-urls="' + displayJsTags.join("|") + '"' : "",
      adserverTags.length ? '  data-adserver-script-urls="' + adserverTags.join("|") + '"' : "",
      adserverHtmlTags.length ? '  data-adserver-html-tags="' + adserverHtmlTags.join("|") + '"' : "",
      display ? '  data-display-endpoint="' + display.endpoint + '"' : "",
      ortbEndpoints.length ? '  data-ortb-endpoints="' + ortbEndpoints.join("|") + '"' : "",
      '  data-logo-text="N"',
      '  data-click-url="https://nexbid.uk">',
      "</script>"
    ].filter(Boolean);

    els.tagOutput.value = lines.join("\n");
  }

  function generateShortTag() {
    var config = buildConfig();
    var configId = config.configId || "SAVE-CONFIG-FIRST";
    els.tagOutput.value = [
      '<script',
      '  src="' + config.setup.cdnScript + '"',
      '  data-config-id="' + configId + '"',
      '  data-api-base="' + trimSlash(config.setup.apiBase) + '">',
      "</script>"
    ].join("\n");
  }

  function generateShortTagV2() {
    var config = buildVersion2Config();
    var configId = config.configId || "SAVE-VERSION-2-FIRST";
    els.tagOutputV2.value = [
      '<script',
      '  src="' + config.setup.cdnScript + '"',
      '  data-config-id="' + configId + '"',
      '  data-api-base="' + trimSlash(config.setup.apiBase) + '">',
      "</script>"
    ].join("\n");
  }

  function saveFinalConfig() {
    var config = buildConfig();
    var endpoint = trimSlash(config.setup.apiBase) + "/api/v1/config";

    els.saveConfig.textContent = "Saving...";
    fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(config)
    })
      .then(function (response) {
        if (!response.ok) throw new Error("save_failed");
        return response.json();
      })
      .then(function (result) {
        state.configId = result.configId;
        showNotice(els.demandNotice, "Final config " + result.configId + " has been saved.");
        els.tagOutput.value = result.tag || "";
      })
      .catch(function () {
        showNotice(els.demandNotice, "Config save failed. Check API/database connection.");
      })
      .finally(function () {
        els.saveConfig.textContent = "Save Final Config";
      });
  }

  function saveVersion2Config() {
    var config = buildVersion2Config();
    var endpoint = trimSlash(config.setup.apiBase) + "/api/v1/config";

    els.saveConfigV2.textContent = "Saving...";
    fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(config)
    })
      .then(function (response) {
        if (!response.ok) throw new Error("save_failed");
        return response.json();
      })
      .then(function (result) {
        state.configIdV2 = result.configId;
        showNotice(els.demandNotice, "Version 2 Testing config " + result.configId + " has been saved.");
        els.tagOutputV2.value = result.tag || "";
      })
      .catch(function () {
        showNotice(els.demandNotice, "Version 2 config save failed. Check API/database connection.");
      })
      .finally(function () {
        els.saveConfigV2.textContent = "Save Version 2 Testing Config";
      });
  }

  function buildConfig() {
    return {
      setup: {
        publisherId: els.publisherId.value.trim(),
        publisherDomain: els.publisherDomain.value.trim(),
        placementId: els.placementId.value.trim(),
        width: els.width.value.trim(),
        height: els.height.value.trim(),
        cdnScript: els.cdnScript.value.trim(),
        apiBase: els.apiBase.value.trim()
      },
      demand: state.demand,
      displayTags: state.displayTags,
      prebid: state.prebid,
      adserverTags: state.adserverTags,
      configId: domainConfigId(els.publisherDomain.value.trim(), "Version 1")
    };
  }

  function buildVersion2Config() {
    var config = buildConfig();
    config.productVersion = "Version 2 Testing";
    config.rotationMode = "realtime-viewable-bidding";
    config.setup.cdnScript = "https://nexbid.uk/nexbanner/version-2-testing/src/nexbanner-gam.js";
    config.rotationMs = 10000;
    config.configId = domainConfigId(config.setup.publisherDomain, "Version 2 Testing");
    return config;
  }

  function refreshReport() {
    var config = buildConfig();
    var url = new URL(trimSlash(config.setup.apiBase) + "/api/v1/report");
    var scope = els.reportScope.value;
    var reportConfigId = els.reportConfigId.value.trim();

    if (scope === "publisher") {
      url.searchParams.set("publisher_id", config.setup.publisherId);
    } else if (scope === "domain") {
      url.searchParams.set("publisher_domain", config.setup.publisherDomain);
    } else if (scope === "placement") {
      url.searchParams.set("publisher_id", config.setup.publisherId);
      url.searchParams.set("placement_id", config.setup.placementId);
    } else if (scope === "config" && reportConfigId) {
      url.searchParams.set("config_id", reportConfigId);
    }

    els.refreshReport.textContent = "Refreshing...";
    fetch(url.toString())
      .then(function (response) {
        if (!response.ok) throw new Error("report_failed");
        return response.json();
      })
      .then(function (result) {
        renderReport(result.summary || {});
        els.reportOutput.value = JSON.stringify(result, null, 2);
      })
      .catch(function () {
        els.reportOutput.value = "Report unavailable. Check NEXBANNER_EVENTS KV binding.";
      })
      .finally(function () {
        els.refreshReport.textContent = "Refresh Report";
      });
  }

  function renderReport(summary) {
    var adRequests = numberOr(summary.adRequests, 0);
    var measuredRequests = numberOr(summary.measuredRequests, 0);
    var filledRequests = numberOr(summary.filledRequests, 0);
    var impressions = numberOr(summary.impressions, 0);
    var impressionRevenue = numberOr(summary.impressionRevenue, 0);
    var fillRate = measuredRequests ? Math.round((filledRequests / measuredRequests) * 1000) / 10 : null;
    var ecpm = impressions && impressionRevenue > 0 ? (impressionRevenue / impressions) * 1000 : null;

    els.metricAdRequests.textContent = formatNumber(adRequests);
    els.metricFilledRequests.textContent = formatNumber(filledRequests);
    els.metricFillRate.textContent = fillRate === null ? "Waiting" : fillRate + "%";
    els.metricEcpm.textContent = ecpm === null ? "N/A" : "$" + ecpm.toFixed(2);
    els.reportTrackingNote.textContent = measuredRequests
      ? "Fill rate uses " + formatNumber(measuredRequests) + " fully measured request(s) received after partner tracking went live."
      : "Partner, fill-rate and eCPM measurement starts with the next live request. Earlier ad requests remain in the total only.";
    renderPartnerReport(summary.partners || {});
  }

  function renderPartnerReport(partners) {
    var rows = Object.keys(partners).map(function (name) {
      var partner = partners[name] || {};
      var requests = numberOr(partner.requests, 0);
      var impressions = numberOr(partner.impressions, 0);
      var revenue = numberOr(partner.revenueEstimate, 0);
      return {
        name: name,
        requests: requests,
        impressions: impressions,
        fillRate: requests ? (impressions / requests) * 100 : 0,
        ecpm: impressions && revenue > 0 ? (revenue / impressions) * 1000 : null
      };
    }).sort(function (a, b) {
      return b.impressions - a.impressions || b.requests - a.requests;
    });

    if (!rows.length) {
      els.partnerReportBody.innerHTML = '<tr><td colspan="5">Partner data will appear after the next live request.</td></tr>';
      return;
    }

    els.partnerReportBody.innerHTML = rows.map(function (row) {
      return "<tr>" +
        "<td>" + escapeHtml(row.name) + "</td>" +
        "<td>" + formatNumber(row.requests) + "</td>" +
        "<td>" + formatNumber(row.impressions) + "</td>" +
        "<td>" + row.fillRate.toFixed(1) + "%</td>" +
        "<td>" + (row.ecpm === null ? "N/A" : "$" + row.ecpm.toFixed(2)) + "</td>" +
        "</tr>";
    }).join("");
  }

  function toggleAutoRefreshReport() {
    if (reportTimer) {
      clearInterval(reportTimer);
      reportTimer = null;
      els.autoRefreshReport.textContent = "Auto Refresh Off";
      return;
    }

    refreshReport();
    reportTimer = setInterval(refreshReport, 5000);
    els.autoRefreshReport.textContent = "Auto Refresh On";
  }

  function saveFromForm() {
    state.setup = buildConfig().setup;
    state.setup = buildConfig().setup;
  }

  function defaultState() {
    return {
      setup: {},
      demand: [],
      displayTags: [],
      prebid: [],
      adserverTags: []
    };
  }

  function firstEndpoint(type) {
    return state.demand.find(function (item) {
      return item.type === type;
    });
  }

  function endpointsFor(type) {
    return state.demand
      .filter(function (item) { return item.type === type; })
      .map(function (item) { return item.endpoint; })
      .filter(Boolean);
  }

  function endpointsFrom(items) {
    return items
      .filter(function (item) { return (item.tagType || "script") === "script"; })
      .map(function (item) { return item.endpoint; })
      .filter(Boolean);
  }

  function htmlTagsFrom(items) {
    return items
      .filter(function (item) { return item.tagType === "html"; })
      .map(function (item) { return encodeURIComponent(item.html || ""); })
      .filter(Boolean);
  }

  function labelFor(type) {
    if (type === "vast") return "VAST Video";
    if (type === "ortb") return "ORTB Fallback";
    return "Display JSON";
  }

  function trimSlash(value) {
    return (value || "").replace(/\/+$/, "");
  }

  function domainConfigId(domain, version) {
    var cleanDomain = String(domain || "")
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .replace(/\/.*$/, "");

    if (!cleanDomain) return "";
    if (version === "Version 2 Testing") return cleanDomain + "-version-2-testing";
    return cleanDomain;
  }

  function numberOr(value, fallback) {
    var parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function formatNumber(value) {
    return String(Math.round(numberOr(value, 0))).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function encodeAttribute(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;");
  }

  function appendEmpty(parent, text) {
    var empty = document.createElement("p");
    empty.textContent = text;
    empty.style.color = "#607083";
    parent.appendChild(empty);
  }

  function demandNode(item, label, endpointText) {
    var node = document.createElement("div");
    node.className = "demand-item";
    node.innerHTML = [
      "<header>",
      "<div><strong>" + escapeHtml(item.name) + "</strong><div class=\"badge\">" + escapeHtml(label) + "</div></div>",
      "<button class=\"remove\" data-id=\"" + item.id + "\">Remove</button>",
      "</header>",
      "<code>" + escapeHtml(endpointText) + "</code>",
      "<small>Floor $" + escapeHtml(item.floorCpm || "0") + " CPM, timeout " + escapeHtml(item.timeoutMs || "800") + "ms</small>"
    ].join("");
    return node;
  }

  function showNotice(node, message) {
    node.textContent = message;
    node.classList.add("show");
  }
})();
