export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const origin = `${url.protocol}//${url.host}`;
  const vast = `<?xml version="1.0" encoding="UTF-8"?>
<VAST version="4.2">
  <Ad id="nexbanner-final-vast">
    <InLine>
      <AdSystem>NexBanner</AdSystem>
      <AdTitle>NexBanner Final Video</AdTitle>
      <Impression><![CDATA[${origin}/api/v1/track?event=partner_impression&layer=premium-vast&cpm=1.25]]></Impression>
      <Creatives>
        <Creative id="nexbanner-final-video" sequence="1">
          <Linear>
            <Duration>00:00:07</Duration>
            <MediaFiles>
              <MediaFile delivery="progressive" type="video/webm" width="1280" height="720" bitrate="700" scalable="true" maintainAspectRatio="true"><![CDATA[${origin}/nexbid-ad-assets/nexbid-vast-tags.webm]]></MediaFile>
            </MediaFiles>
          </Linear>
        </Creative>
      </Creatives>
    </InLine>
  </Ad>
</VAST>`;

  return new Response(vast, {
    headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "no-store", ...corsHeaders() },
  });
}

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "content-type",
  };
}

