const BLOCKED_HOSTS = new Set(["localhost", "localhost.localdomain", "metadata.google.internal"]);

export function validateVastUrl(value, options = {}) {
  let url;
  try { url = new URL(String(value || "")); } catch (_) { throw vastError("blocked_url", 400); }
  if (!["http:", "https:"].includes(url.protocol)) throw vastError("blocked_url", 400);
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (BLOCKED_HOSTS.has(hostname) || hostname.endsWith(".localhost") || isPrivateIp(hostname)) {
    throw vastError("blocked_url", 403);
  }
  const allowedHosts = normalizeAllowedHosts(options.allowedHosts);
  if (options.requireAllowlist !== false && (!allowedHosts.length || !allowedHosts.some((host) => hostname === host || hostname.endsWith(`.${host}`)))) {
    throw vastError("blocked_url", 403);
  }
  url.username = "";
  url.password = "";
  url.hash = "";
  return url;
}

export function isPrivateIp(hostname) {
  const h = String(hostname || "").replace(/^\[|\]$/g, "").toLowerCase();
  if (h.startsWith("::ffff:")) return isPrivateIp(h.slice(7));
  if (h === "::1" || h === "::" || h.startsWith("fe80:") || h.startsWith("fc") || h.startsWith("fd")) return true;
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(h)) return false;
  const parts = h.split(".").map(Number);
  if (parts.some((part) => part < 0 || part > 255)) return true;
  return parts[0] === 0 || parts[0] === 10 || parts[0] === 127 || parts[0] >= 224 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168) ||
    (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127);
}

export async function resolveVast(source, options = {}) {
  const maxDepth = clamp(options.maxDepth, 1, 10, 5);
  const totalTimeoutMs = clamp(options.totalTimeoutMs, 250, 15000, 5000);
  const deadline = Date.now() + totalTimeoutMs;
  const seen = new Set();
  const merged = { impressionUrls: [], errorUrls: [], tracking: {}, clickUrl: "" };
  let current = validateVastUrl(source, options);

  for (let depth = 0; depth <= maxDepth; depth += 1) {
    const key = current.toString();
    if (seen.has(key)) throw vastError("wrapper_loop", 422);
    seen.add(key);
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw vastError("timeout", 504);
    const xml = await fetchXml(current, {
      ...options,
      deadline,
      timeoutMs: Math.min(clamp(options.perHopTimeoutMs, 200, 5000, 1500), remaining)
    });
    mergeUrls(merged, parseVastMetadata(xml, current));

    const wrapper = firstTagText(xml, "VASTAdTagURI");
    if (wrapper) {
      if (depth >= maxDepth) throw vastError("wrapper_limit", 422);
      current = validateVastUrl(new URL(resolveMacros(wrapper, options), current).toString(), options);
      continue;
    }

    const media = selectMedia(xml, current, options.allowVpaid === true);
    if (!media) throw vastError("no_media", 422);
    const inline = parseVastMetadata(xml, current);
    mergeUrls(merged, inline);
    return {
      adType: media.vpaid ? "vpaid-js" : "vast-video",
      mediaUrl: media.url,
      mediaType: media.type,
      adParameters: firstTagText(xml, "AdParameters"),
      clickUrl: inline.clickUrl || merged.clickUrl || "",
      impressionUrls: unique(merged.impressionUrls),
      errorUrls: unique(merged.errorUrls),
      tracking: mapUnique(merged.tracking),
      sourceName: options.sourceName || "VAST",
      cpm: finite(options.cpm, 0),
      wrapperDepth: depth,
    };
  }
  throw vastError("wrapper_limit", 422);
}

async function fetchXml(url, options) {
  const redirectSeen = options.redirectSeen || new Set();
  if (redirectSeen.has(url.toString())) throw vastError("unsafe_redirect", 422);
  redirectSeen.add(url.toString());
  const redirectCount = Number(options.redirectCount || 0);
  if (redirectCount > 5) throw vastError("unsafe_redirect", 422);
  const remaining = options.deadline ? options.deadline - Date.now() : options.timeoutMs;
  if (remaining <= 0) throw vastError("timeout", 504);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(options.timeoutMs, remaining));
  try {
    const response = await (options.fetchImpl || fetch)(url, {
      redirect: "manual",
      headers: { accept: "application/xml,text/xml,*/*;q=0.1" },
      signal: controller.signal,
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw vastError("unsafe_redirect", 502);
      const next = validateVastUrl(new URL(location, url).toString(), options);
      return fetchXml(next, { ...options, redirectSeen, redirectCount: redirectCount + 1 });
    }
    if (!response.ok) throw vastError(`upstream_http_${response.status}`, 502);
    const text = await response.text();
    if (!/<VAST[\s>]/i.test(text) || /<parsererror/i.test(text)) throw vastError("invalid_xml", 422);
    return text;
  } catch (error) {
    if (error?.name === "AbortError") throw vastError("timeout", 504);
    throw error?.code ? error : vastError("fetch_failed", 502);
  } finally {
    clearTimeout(timer);
  }
}

export function parseVastMetadata(xml, baseUrl) {
  const impressions = allTagText(xml, "Impression").map((url) => safeResolved(url, baseUrl));
  const errors = allTagText(xml, "Error").map((url) => safeResolved(url, baseUrl));
  const clickUrl = firstTagText(xml, "ClickThrough");
  const tracking = {};
  const regex = /<Tracking\b([^>]*)>([\s\S]*?)<\/Tracking>/gi;
  let match;
  while ((match = regex.exec(xml))) {
    const event = /\bevent\s*=\s*["']([^"']+)["']/i.exec(match[1])?.[1];
    const value = cleanXmlText(match[2]);
    if (!event || !value) continue;
    (tracking[event] ||= []).push(safeResolved(value, baseUrl));
  }
  return {
    impressionUrls: impressions.filter(Boolean),
    errorUrls: errors.filter(Boolean),
    clickUrl: clickUrl ? safeResolved(clickUrl, baseUrl) : "",
    tracking,
  };
}

export function selectMedia(xml, baseUrl, allowVpaid) {
  const regex = /<MediaFile\b([^>]*)>([\s\S]*?)<\/MediaFile>/gi;
  const choices = [];
  let match;
  while ((match = regex.exec(xml))) {
    const attrs = match[1];
    const type = attribute(attrs, "type").toLowerCase();
    const framework = attribute(attrs, "apiFramework").toLowerCase();
    const value = cleanXmlText(match[2]);
    if (!value) continue;
    const vpaid = framework === "vpaid" || type === "application/javascript";
    const compatible = /^video\/(mp4|webm|ogg)$/i.test(type) || /mpegurl/i.test(type);
    if (!compatible && !(allowVpaid && vpaid)) continue;
    const resolved = safeResolved(value, baseUrl);
    if (!resolved) continue;
    choices.push({
      url: resolved,
      type,
      vpaid,
      bitrate: finite(attribute(attrs, "bitrate"), 0),
      width: finite(attribute(attrs, "width"), 0),
      height: finite(attribute(attrs, "height"), 0),
    });
  }
  choices.sort((a, b) => Number(a.vpaid) - Number(b.vpaid) || scoreMedia(b) - scoreMedia(a));
  return choices[0] || null;
}

export function resolveMacros(value, options = {}) {
  const cachebuster = encodeURIComponent(String(options.cachebuster || Date.now()));
  return cleanXmlText(value)
    .replace(/\[(?:CACHEBUSTING|CACHEBUSTER)\]|%%CACHEBUSTER%%/gi, cachebuster)
    .replace(/\[RANDOM\]/gi, cachebuster);
}

function mergeUrls(target, source) {
  target.impressionUrls.push(...source.impressionUrls);
  target.errorUrls.push(...source.errorUrls);
  if (source.clickUrl) target.clickUrl = source.clickUrl;
  Object.entries(source.tracking).forEach(([event, urls]) => {
    (target.tracking[event] ||= []).push(...urls);
  });
}
function firstTagText(xml, tag) { return cleanXmlText(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i").exec(xml)?.[1] || ""); }
function allTagText(xml, tag) {
  const values = [], regex = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi");
  let match;
  while ((match = regex.exec(xml))) values.push(cleanXmlText(match[1]));
  return values.filter(Boolean);
}
function cleanXmlText(value) { return String(value || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").trim(); }
function attribute(text, name) { return new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i").exec(text)?.[1] || ""; }
function safeResolved(value, base) {
  try {
    const url = new URL(value, base);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : "";
  } catch (_) {
    return "";
  }
}
function normalizeAllowedHosts(value) { return String(value || "").split(",").map((v) => v.trim().toLowerCase()).filter(Boolean); }
function unique(values) { return [...new Set(values.filter(Boolean))]; }
function mapUnique(value) { return Object.fromEntries(Object.entries(value).map(([key, values]) => [key, unique(values)])); }
function scoreMedia(media) { return (media.width === 300 && media.height === 250 ? 100000 : 0) + Math.min(media.bitrate, 5000); }
function finite(value, fallback) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function clamp(value, min, max, fallback) { return Math.min(max, Math.max(min, finite(value, fallback))); }
function vastError(code, status) { const error = new Error(code); error.code = code; error.status = status; return error; }
