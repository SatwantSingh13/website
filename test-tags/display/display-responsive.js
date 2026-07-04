(function () {
  var script = document.currentScript;
  var targetId = script && script.getAttribute("data-target");
  var target = targetId ? document.getElementById(targetId) : script.parentElement;
  if (!target) return;

  var width = Number((script && script.getAttribute("data-width")) || 300);
  var height = Number((script && script.getAttribute("data-height")) || 250);
  var clickUrl = (script && script.getAttribute("data-click-url")) || "https://nexbid.com";
  var imageUrl = (script && script.getAttribute("data-image-url")) || "/examples/assets/programmatic-101.png";

  target.innerHTML = "";
  target.style.width = width + "px";
  target.style.height = height + "px";
  target.style.maxWidth = "100%";
  target.style.overflow = "hidden";
  target.style.background = "#fff";

  var link = document.createElement("a");
  link.href = clickUrl;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.style.cssText = "display:block;width:100%;height:100%;text-decoration:none;background:#fff";

  var img = document.createElement("img");
  img.src = imageUrl;
  img.alt = "Programmatic test banner";
  img.style.cssText = "display:block;width:100%;height:100%;object-fit:contain;border:0";

  link.appendChild(img);
  target.appendChild(link);
})();
