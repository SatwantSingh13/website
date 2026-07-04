(function () {
  var script = document.currentScript;
  var targetId = script && script.getAttribute("data-target");
  var target = targetId ? document.getElementById(targetId) : script.parentElement;
  if (!target) return;

  var clickUrl = (script && script.getAttribute("data-click-url")) || "https://nexbid.com";
  var imageUrl = (script && script.getAttribute("data-image-url")) || "/examples/assets/programmatic-101.png";
  var imageUrl2 = script && script.getAttribute("data-image-url-2");
  var refreshMs = Number((script && script.getAttribute("data-refresh-ms")) || 0);

  target.innerHTML = "";
  target.style.width = "300px";
  target.style.height = "250px";
  target.style.overflow = "hidden";
  target.style.background = "#fff";

  var link = document.createElement("a");
  link.href = clickUrl;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.style.cssText = "display:block;width:300px;height:250px;text-decoration:none;background:#fff";

  var img = document.createElement("img");
  img.src = imageUrl;
  img.alt = "Programmatic test banner";
  img.width = 300;
  img.height = 250;
  img.style.cssText = "display:block;width:300px;height:250px;object-fit:contain;border:0";

  link.appendChild(img);
  target.appendChild(link);

  if (imageUrl2 && refreshMs > 0) {
    window.setTimeout(function () {
      img.src = imageUrl2;
      target.setAttribute("data-refresh-complete", "true");
    }, refreshMs);
  }
})();
