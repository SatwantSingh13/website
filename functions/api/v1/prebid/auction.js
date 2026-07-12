const DEFAULT_TIMEOUT_MS = 900;
const MAX_TIMEOUT_MS = 1400;

export async function onRequestPost(context) {
  try {
    if (!authorized(context.request, context.env)) return json({ bids: [] }, 401);

    const upstream = context.env && context.env.NEXBID_ORTB_URL;
    if (!isHttpUrl(upstream)) return json({ bids: [] });

    const body = await context.request.json();
    const bids = Array.isArray(body.bids) ? body.bids.filter(validBid) : [];
    if (!bids.length) return json({ bids: [] });

    const ortbRequest = buildOrtbRequest(body, bids);
    const response = await callOrtb(upstream, ortbRequest);
    if (!response) return json({ bids: [] });

    return json({ bids: parseOrtbResponse(response, bids) });
  } catch (_) {
    return json({ bids: [] });
  }
}

function authorized(request, env) {
  const expected = env && env.NEXBID_PREBID_AUCTION_TOKEN;
  if (!isNonEmptyString(expected)) return false;
  return request.headers.get('authorization') === `Bearer ${expected}`;
}

function buildOrtbRequest(body, bids) {
  const referer = body.refererInfo || {};
  const ortb2 = body.ortb2 || {};
  const site = ortb2.site || {};
  const firstBid = bids[0];
  const publisherId = firstBid.publisherId;
  const page = httpsPage(referer.page || site.page);
  const domain = cleanDomain(referer.domain || site.domain || page);

  return {
    id: stringValue(body.auctionId) || randomId(),
    at: 1,
    tmax: timeoutValue(body.timeout),
    cur: bidCurrencies(bids),
    imp: bids.map(toOrtbImpression),
    site: {
      ...(domain ? { domain } : {}),
      ...(page ? { page } : {}),
      publisher: { id: publisherId }
    },
    device: contextualDevice(ortb2.device),
    regs: contextualRegs(body.privacy, ortb2.regs),
    source: sourceObject(firstBid.schain)
  };
}

function toOrtbImpression(bid) {
  const sizes = normalizedSizes(bid.sizes);
  const first = sizes[0] || [300, 250];
  const floor = bid.floor || {};
  const ortb2Imp = bid.ortb2Imp || {};

  return {
    id: bid.requestId,
    tagid: bid.placementId,
    secure: 1,
    banner: {
      w: first[0],
      h: first[1],
      format: sizes.map((size) => ({ w: size[0], h: size[1] }))
    },
    bidfloor: Math.max(0, numberValue(floor.value)),
    bidfloorcur: currencyValue(floor.currency),
    ext: {
      ...(ortb2Imp.ext || {}),
      nexbid: {
        configId: stringValue(bid.configId),
        placementId: bid.placementId
      }
    }
  };
}

async function callOrtb(endpoint, payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), payload.tmax);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-openrtb-version': '2.5'
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    if (!response.ok) return null;
    return response.json();
  } catch (_) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function parseOrtbResponse(response, requests) {
  const requestMap = new Map(requests.map((bid) => [bid.requestId, bid]));
  const currency = currencyValue(Array.isArray(response.cur) ? response.cur[0] : response.cur);
  const parsed = [];

  (response.seatbid || []).forEach((seat) => {
    (seat.bid || []).forEach((bid) => {
      const request = requestMap.get(bid.impid);
      if (!request || !validOrtbBid(bid, request)) return;
      const size = responseSize(bid, request.sizes);

      parsed.push({
        requestId: bid.impid,
        cpm: numberValue(bid.price),
        currency,
        width: size[0],
        height: size[1],
        ttl: 300,
        netRevenue: true,
        creativeId: stringValue(bid.crid || bid.id) || `nexbid-${bid.impid}`,
        advertiserDomains: bid.adomain.filter(isNonEmptyString),
        ad: bid.adm
      });
    });
  });

  return highestBidPerRequest(parsed);
}

function validOrtbBid(bid, request) {
  const floor = numberValue(request.floor && request.floor.value);
  return bid &&
    isNonEmptyString(bid.impid) &&
    numberValue(bid.price) > 0 &&
    numberValue(bid.price) >= floor &&
    isNonEmptyString(bid.adm) &&
    Array.isArray(bid.adomain) &&
    bid.adomain.some(isNonEmptyString);
}

function highestBidPerRequest(bids) {
  const winners = new Map();
  bids.forEach((bid) => {
    const current = winners.get(bid.requestId);
    if (!current || bid.cpm > current.cpm) winners.set(bid.requestId, bid);
  });
  return Array.from(winners.values());
}

function validBid(bid) {
  return bid &&
    isNonEmptyString(bid.requestId) &&
    isNonEmptyString(bid.publisherId) &&
    isNonEmptyString(bid.placementId) &&
    normalizedSizes(bid.sizes).length > 0;
}

function normalizedSizes(sizes) {
  return (Array.isArray(sizes) ? sizes : []).filter((size) => {
    return Array.isArray(size) && numberValue(size[0]) > 0 && numberValue(size[1]) > 0;
  }).map((size) => [numberValue(size[0]), numberValue(size[1])]);
}

function responseSize(bid, sizes) {
  if (numberValue(bid.w) > 0 && numberValue(bid.h) > 0) {
    return [numberValue(bid.w), numberValue(bid.h)];
  }
  return normalizedSizes(sizes)[0] || [300, 250];
}

function bidCurrencies(bids) {
  const values = bids.map((bid) => currencyValue(bid.floor && bid.floor.currency));
  return Array.from(new Set(values));
}

function contextualDevice(device) {
  const source = device || {};
  return {
    ...(numberValue(source.w) > 0 ? { w: numberValue(source.w) } : {}),
    ...(numberValue(source.h) > 0 ? { h: numberValue(source.h) } : {}),
    ...(numberValue(source.devicetype) > 0 ? { devicetype: numberValue(source.devicetype) } : {}),
    ...(isNonEmptyString(source.language) ? { language: source.language } : {})
  };
}

function contextualRegs(privacy, regs) {
  const source = regs || {};
  const output = {};
  if (source.coppa === 0 || source.coppa === 1) output.coppa = source.coppa;
  if (privacy && privacy.gdpr && typeof privacy.gdpr.applies === 'boolean') {
    output.ext = { gdpr: privacy.gdpr.applies ? 1 : 0 };
  }
  return output;
}

function sourceObject(schain) {
  if (!schain || typeof schain !== 'object') return {};
  return { ext: { schain } };
}

function timeoutValue(value) {
  const parsed = numberValue(value) || DEFAULT_TIMEOUT_MS;
  return Math.max(100, Math.min(parsed - 100, MAX_TIMEOUT_MS));
}

function currencyValue(value) {
  return /^[A-Z]{3}$/.test(value || '') ? value : 'USD';
}

function cleanDomain(value) {
  try {
    const input = String(value || '');
    return input.includes('://') ? new URL(input).hostname : input.replace(/^www\./, '').split('/')[0];
  } catch (_) {
    return '';
  }
}

function httpsPage(value) {
  try {
    const url = new URL(value || '');
    return url.protocol === 'https:' ? url.toString() : '';
  } catch (_) {
    return '';
  }
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (_) {
    return false;
  }
}

function numberValue(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function stringValue(value) {
  return isNonEmptyString(value) ? value.trim() : '';
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function randomId() {
  return `nexbid-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

export const __test = { buildOrtbRequest, parseOrtbResponse };

