(function () {
  "use strict";

  var script = document.currentScript;
  if (!script) return;

  var source = new URL(script.src, window.location.href);
  var release = source.searchParams.get("v") || "20260713-5";
  var loaderName = release === "20260724-6"
    ? "v1-commercial-20260724-6.js"
    : "v1-legacy-20260713-5.js";
  var loader = document.createElement("script");
  var loaderUrl = new URL(loaderName, source);

  Array.prototype.forEach.call(script.attributes || [], function (attribute) {
    if (attribute.name.toLowerCase() === "src") return;
    loader.setAttribute(attribute.name, attribute.value);
  });
  loader.async = true;
  loaderUrl.searchParams.set("v", release);
  loader.src = loaderUrl.toString();
  loader.onerror = function () {
    if (script.parentNode) script.parentNode.setAttribute("data-nbx-loader-error", release);
  };
  script.parentNode.insertBefore(loader, script.nextSibling);
})();
