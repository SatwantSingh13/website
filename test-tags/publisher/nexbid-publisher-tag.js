(function () {
  var currentScript = document.currentScript;
  if (!currentScript) return;

  function attr(name, fallback) {
    var value = currentScript.getAttribute(name);
    return value === null || value === "" ? fallback : value;
  }

  function numberAttr(name, fallback) {
    var value = Number(attr(name, fallback));
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }

  function resolveUrl(url) {
    return new URL(url, window.location.href).href;
  }

  var width = numberAttr("data-width", 300);
  var height = numberAttr("data-height", 250);
  var targetId = attr("data-target", "");
  var placement = targetId ? document.getElementById(targetId) : currentScript.parentElement;
  if (!placement) return;

  var vastUrl = attr("data-vast-url", "/test-tags/vast/nexbid-vast-tag.xml");
  var vastTimeoutMs = numberAttr("data-vast-timeout-ms", 12000);
  var demandRefreshMs = numberAttr("data-demand-refresh-ms", 7000);
  var clickUrl = attr("data-click-url", "https://nexbid.uk");

  var demandOneUrl = attr("data-demand-1-url", "/test-tags/display/display-300x250.js");
  var demandTwoUrl = attr("data-demand-2-url", "/test-tags/display/display-300x250.js");
  var demandOneImage = attr("data-demand-1-image-url", "/test-tags/assets/display-1.png");
  var demandTwoImage = attr("data-demand-2-image-url", "/test-tags/assets/display-2.png");

  placement.innerHTML = "";
  placement.style.width = width + "px";
  placement.style.height = height + "px";
  placement.style.overflow = "hidden";
  placement.style.background = "#000";
  placement.setAttribute("data-nexbid-status", "loading-vast");

  function clearPlacement() {
    while (placement.firstChild) placement.removeChild(placement.firstChild);
  }

  function loadDemand(scriptUrl, imageUrl, label) {
    clearPlacement();
    placement.style.background = "#fff";
    placement.setAttribute("data-nexbid-status", label);

    var frame = document.createElement("iframe");
    frame.title = "Nexbid ad demand";
    frame.width = String(width);
    frame.height = String(height);
    frame.setAttribute("scrolling", "no");
    frame.setAttribute("frameborder", "0");
    frame.style.cssText = "display:block;width:" + width + "px;height:" + height + "px;border:0;overflow:hidden";
    placement.appendChild(frame);

    var doc = frame.contentWindow.document;
    doc.open();
    doc.write(
      "<!doctype html><html><head><meta charset=\"utf-8\"><style>html,body{margin:0;padding:0;overflow:hidden;width:" +
        width +
        "px;height:" +
        height +
        "px}</style></head><body><div id=\"nexbid-inner-slot\"></div><script src=\"" +
        resolveUrl(scriptUrl) +
        "\" data-target=\"nexbid-inner-slot\" data-click-url=\"" +
        clickUrl +
        "\" data-image-url=\"" +
        resolveUrl(imageUrl) +
        "\"><\/script></body></html>"
    );
    doc.close();
  }

  function loadDemandWaterfall() {
    loadDemand(demandOneUrl, demandOneImage, "demand-1");
    if (demandTwoUrl) {
      window.setTimeout(function () {
        loadDemand(demandTwoUrl, demandTwoImage, "demand-2");
      }, demandRefreshMs);
    }
  }

  function showVideo(mediaUrl) {
    clearPlacement();
    placement.setAttribute("data-nexbid-status", "vast-video");

    var video = document.createElement("video");
    video.src = mediaUrl;
    video.width = width;
    video.height = height;
    video.muted = true;
    video.autoplay = true;
    video.playsInline = true;
    video.controls = true;
    video.style.cssText = "display:block;width:" + width + "px;height:" + height + "px;background:#000;object-fit:contain";

    var movedToDemand = false;
    function finishVideo() {
      if (movedToDemand) return;
      movedToDemand = true;
      loadDemandWaterfall();
    }

    video.addEventListener("ended", finishVideo);
    video.addEventListener("error", finishVideo);
    placement.appendChild(video);

    window.setTimeout(finishVideo, vastTimeoutMs);
    video.play().catch(finishVideo);
  }

  fetch(resolveUrl(vastUrl), { cache: "no-store" })
    .then(function (response) {
      if (!response.ok) throw new Error("VAST request failed");
      return response.text();
    })
    .then(function (vastXml) {
      var vastDoc = new DOMParser().parseFromString(vastXml, "application/xml");
      var mediaFiles = Array.prototype.slice.call(vastDoc.querySelectorAll("MediaFile"));
      var mediaFile =
        mediaFiles.find(function (node) {
          var type = node.getAttribute("type") || "";
          return type.indexOf("mp4") > -1 || type.indexOf("webm") > -1;
        }) || mediaFiles[0];
      var mediaUrl = mediaFile && mediaFile.textContent && mediaFile.textContent.trim();
      if (!mediaUrl) throw new Error("No VAST media file");
      showVideo(new URL(mediaUrl, resolveUrl(vastUrl)).href);
    })
    .catch(loadDemandWaterfall);
})();
