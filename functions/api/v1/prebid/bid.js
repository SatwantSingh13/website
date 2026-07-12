const TEST_PUBLISHER_ID = 'nexbid-test';
const TEST_PLACEMENT_ID = 'banner-300x250';
const DEFAULT_TIMEOUT_MS = 1200;

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function onRequestPost(context) {
  try {
    const body = await readJson(context.request);
    const bids = Array.isArray(body.bids) ? body.bids.filter(validIncomingBid) : [];
    if (!bids.length) return json({ bidder: 'nexbid', bids: [] });

    const testBids = bids.filter(isApprovedTestBid).map(testBidResponse);
    const productionRequests = bids.filter((bid) => !isApprovedTestBid(bid));
    const productionBids = await requestProductionBids(context.env, body, productionRequests);

    return json({
      bidder: 'nexbid',
      bids: [...testBids, ...sanitizeBackendBids(productionBids, productionRequests)]
    });
  } catch (_) {
    return json({ bidder: 'nexbid', bids: [] });
  }
}

async function requestProductionBids(env, originalRequest, bids) {
  const endpoint = env && env.NEXBID_PREBID_AUCTION_URL;
  if (!bids.length || !isHttpsUrl(endpoint)) return [];

  const timeoutMs = auctionTimeout(originalRequest.timeout);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers = {
      'content-type': 'application/json',
      'x-nexbid-gateway-version': '1'
    };
    if (env.NEXBID_PREBID_AUCTION_TOKEN) {
      headers.authorization = `Bearer ${env.NEXBID_PREBID_AUCTION_TOKEN}`;
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ...originalRequest, bids }),
      signal: controller.signal
    });
    if (!response.ok) return [];

    const result = await response.json();
    return Array.isArray(result && result.bids) ? result.bids : [];
  } catch (_) {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

function sanitizeBackendBids(bids, requests) {
  const allowedIds = new Set(requests.map((bid) => bid.requestId));

  return bids.filter((bid) => {
    return bid &&
      allowedIds.has(bid.requestId) &&
      numberValue(bid.cpm) > 0 &&
      numberValue(bid.width) > 0 &&
      numberValue(bid.height) > 0 &&
      /^[A-Z]{3}$/.test(bid.currency || '') &&
      isNonEmptyString(bid.ad) &&
      Array.isArray(bid.advertiserDomains) &&
      bid.advertiserDomains.some(isNonEmptyString);
  }).map((bid) => ({
    requestId: bid.requestId,
    cpm: numberValue(bid.cpm),
    currency: bid.currency,
    width: numberValue(bid.width),
    height: numberValue(bid.height),
    ttl: numberValue(bid.ttl) > 0 ? numberValue(bid.ttl) : 300,
    netRevenue: bid.netRevenue !== false,
    creativeId: isNonEmptyString(bid.creativeId) ? bid.creativeId : `nexbid-${bid.requestId}`,
    advertiserDomains: bid.advertiserDomains.filter(isNonEmptyString),
    ad: bid.ad,
    ...(isNonEmptyString(bid.dealId) ? { dealId: bid.dealId } : {})
  }));
}

function isApprovedTestBid(bid) {
  return bid.test === true &&
    bid.publisherId === TEST_PUBLISHER_ID &&
    bid.placementId === TEST_PLACEMENT_ID;
}

function testBidResponse(bid) {
  const [width, height] = firstSize(bid.sizes);
  return {
    requestId: bid.requestId,
    cpm: 0.5,
    currency: 'USD',
    width,
    height,
    ttl: 60,
    netRevenue: true,
    creativeId: 'nexbid-prebid-test-banner',
    advertiserDomains: ['nexbid.uk'],
    ad: testCreative(width, height)
  };
}

function testCreative(width, height) {
  return `<div style="box-sizing:border-box;width:${width}px;height:${height}px;display:flex;align-items:center;justify-content:center;background:#071a3a;color:#fff;font:600 18px Arial,sans-serif;border:2px solid #10a8e5">NexBid Prebid Test</div>`;
}

function validIncomingBid(bid) {
  return bid &&
    isNonEmptyString(bid.requestId) &&
    isNonEmptyString(bid.publisherId) &&
    isNonEmptyString(bid.placementId) &&
    Array.isArray(bid.sizes);
}

function firstSize(sizes) {
  const size = (sizes || []).find((item) => {
    return Array.isArray(item) && numberValue(item[0]) > 0 && numberValue(item[1]) > 0;
  });
  return size ? [numberValue(size[0]), numberValue(size[1])] : [300, 250];
}

async function readJson(request) {
  const text = await request.text();
  return text ? JSON.parse(text) : {};
}

function auctionTimeout(value) {
  const requested = numberValue(value) || DEFAULT_TIMEOUT_MS;
  return Math.max(100, Math.min(requested - 50, 1500));
}

function isHttpsUrl(value) {
  try {
    return new URL(value).protocol === 'https:';
  } catch (_) {
    return false;
  }
}

function numberValue(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...corsHeaders()
    }
  });
}

function corsHeaders() {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type'
  };
}

