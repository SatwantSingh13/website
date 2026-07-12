export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const layer = url.searchParams.get("layer") || "premium-display";
  const origin = `${url.protocol}//${url.host}`;
  const prebidCpm = cpmFrom(url.searchParams.get("pb"), 0.55);
  const ortbCpm = cpmFrom(url.searchParams.get("adx"), 0.12);

  if (layer === "prebid" || layer === "premium-display") {
    return json({
      adType: "display",
      imageUrl: `${origin}/nexbid-ad-assets/banner-1.png`,
      clickUrl: "https://nexbid.uk",
      impressionUrl: `${origin}/api/v1/track?event=partner_impression&layer=${layer}&cpm=${layer === "prebid" ? prebidCpm : 0.42}`,
      cpm: layer === "prebid" ? prebidCpm : 0.42,
      currency: "USD",
      layer,
      buyer: "nexbanner-final-demo",
    });
  }

  if (layer === "remnant-ortb") {
    return json({
      adType: "display",
      imageUrl: `${origin}/nexbid-ad-assets/banner-2.png`,
      clickUrl: "https://nexbid.uk",
      impressionUrl: `${origin}/api/v1/track?event=partner_impression&layer=remnant-ortb&cpm=${ortbCpm}`,
      cpm: ortbCpm,
      currency: "USD",
      layer,
      buyer: "nexbanner-final-remnant",
    });
  }

  return json({}, 204);
}

function cpmFrom(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed / 10 : fallback;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...corsHeaders() },
  });
}

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "content-type",
  };
}

