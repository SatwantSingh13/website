import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  RequestState,
  candidateAllowed,
  placementConfigId,
  prependGamClick,
  sanitizeConfigId,
} from "../nbx/v1-safe-core.mjs";
import { isPrivateIp, resolveVast, validateVastUrl } from "../functions/api/v1/vast/resolver-core.mjs";

const player = await readFile(new URL("../nbx/v1-price-priority-safe-player.mjs", import.meta.url), "utf8");
const loader = await readFile(new URL("../nbx/v1-price-priority-safe.js", import.meta.url), "utf8");
const legacyLoader = await readFile(new URL("../nbx/v1.js", import.meta.url), "utf8");
const immutableLegacyLoader = await readFile(new URL("../nbx/v1-legacy-20260713-5.js", import.meta.url), "utf8");
const configGet = await readFile(new URL("../functions/api/v1/config/[id].js", import.meta.url), "utf8");
const configPost = await readFile(new URL("../functions/api/v1/config/index.js", import.meta.url), "utf8");
const track = await readFile(new URL("../functions/api/v1/track.js", import.meta.url), "utf8");

test("auction cannot start before waiting-for-viewability", () => {
  const state = new RequestState("r1");
  assert.equal(state.transition("auctioning"), false);
  assert.equal(state.state, "created");
});

test("viewability flow permits exactly one forward auction transition", () => {
  const state = new RequestState("r2");
  assert.equal(state.transition("waiting-for-viewability"), true);
  assert.equal(state.transition("auctioning"), true);
  assert.equal(state.transition("auctioning"), false);
});

test("terminal filled state ignores late callbacks", () => {
  const state = new RequestState("r3");
  state.transition("waiting-for-viewability");
  state.transition("auctioning");
  state.transition("rendering");
  state.transition("filled");
  assert.equal(state.transition("running-passback"), false);
  assert.equal(state.state, "filled");
});

test("delivery is deduplicated to one impression", () => {
  const state = new RequestState("r4");
  state.transition("waiting-for-viewability");
  state.transition("auctioning");
  state.transition("rendering");
  assert.equal(state.recordDelivery(), true);
  assert.equal(state.recordDelivery(), false);
});

test("passback starts once and reaches terminal no-fill", () => {
  const state = new RequestState("r5");
  state.transition("waiting-for-viewability");
  state.transition("auctioning");
  assert.equal(state.startPassback(), true);
  assert.equal(state.startPassback(), false);
  assert.equal(state.transition("no-fill"), true);
  assert.equal(state.isTerminal(), true);
});

test("VAST completion cannot return a filled request to rendering", () => {
  const state = new RequestState("r6");
  state.transition("waiting-for-viewability");
  state.transition("auctioning");
  state.transition("rendering");
  state.recordDelivery();
  state.transition("filled");
  assert.equal(state.transition("rendering"), false);
});

test("internal winner below minimum CPM is rejected", () => {
  assert.deepEqual(candidateAllowed({ cpm: 9 }, {
    minimumInternalCpm: 12, gamLineItemCpm: 10, rejectBelowGamRate: true, priceMismatchTolerance: 0,
  }).allowed, false);
});

test("internal winner above protected rate is accepted", () => {
  assert.equal(candidateAllowed({ cpm: 12 }, {
    minimumInternalCpm: 12, gamLineItemCpm: 10, rejectBelowGamRate: true,
  }).allowed, true);
});

test("GAM unescaped click macro is prepended without encoding", () => {
  assert.equal(prependGamClick("https://advertiser.example/a?x=1", "%%CLICK_URL_UNESC%%"),
    "%%CLICK_URL_UNESC%%https://advertiser.example/a?x=1");
});

test("GAM escaped click macro encodes advertiser URL once", () => {
  const result = prependGamClick("https://advertiser.example/a?x=1", "%%CLICK_URL_ESC%%");
  assert.equal(result, `%%CLICK_URL_ESC%%${encodeURIComponent("https://advertiser.example/a?x=1")}`);
});

test("invalid and non-http advertiser URLs are not modified", () => {
  assert.equal(prependGamClick("javascript:alert(1)", "%%CLICK_URL_UNESC%%"), "javascript:alert(1)");
  assert.equal(prependGamClick("", "%%CLICK_URL_UNESC%%"), "");
});

test("placement-specific IDs are stable and independent", () => {
  assert.equal(placementConfigId({ domain: "www.moneycontrol.com", placement: "Article Mid", width: 300, height: 250 }),
    "moneycontrol.com--article-mid--300x250--v1");
  assert.notEqual(
    placementConfigId({ domain: "moneycontrol.com", placement: "article-mid", width: 300, height: 250 }),
    placementConfigId({ domain: "moneycontrol.com", placement: "sidebar", width: 300, height: 250 })
  );
});

test("unsafe configuration IDs are rejected or sanitized", () => {
  assert.throws(() => sanitizeConfigId("../../Money Control"), /invalid_config_id/);
  assert.equal(sanitizeConfigId("Money Control Article"), "money-control-article");
  assert.throws(() => sanitizeConfigId(".."), /invalid_config_id/);
});

test("private IPv4 and metadata addresses are blocked", () => {
  for (const host of ["127.0.0.1", "10.0.0.1", "169.254.169.254", "172.20.0.1", "192.168.1.1", "::ffff:127.0.0.1"]) {
    assert.equal(isPrivateIp(host), true);
  }
});

test("localhost, private networks and unapproved VAST hosts are rejected", () => {
  assert.throws(() => validateVastUrl("http://localhost/vast", { allowedHosts: "example.com" }), /blocked_url/);
  assert.throws(() => validateVastUrl("https://evil.example/vast", { allowedHosts: "example.com" }), /blocked_url/);
});

test("valid allowlisted VAST host is accepted", () => {
  assert.equal(validateVastUrl("https://ads.example.com/vast", { allowedHosts: "example.com" }).hostname, "ads.example.com");
});

test("VAST wrapper resolves and merges tracking", async () => {
  const wrapper = `<VAST><Ad><Wrapper><Impression>https://track.example.com/w</Impression><Creatives><Creative><Linear><TrackingEvents><Tracking event="start">https://track.example.com/start</Tracking></TrackingEvents><VASTAdTagURI><![CDATA[https://ads.example.com/inline]]></VASTAdTagURI></Linear></Creative></Creatives></Wrapper></Ad></VAST>`;
  const inline = `<VAST><Ad><InLine><Impression>https://track.example.com/i</Impression><Creatives><Creative><Linear><TrackingEvents><Tracking event="complete">https://track.example.com/complete</Tracking></TrackingEvents><VideoClicks><ClickThrough>https://advertiser.example/</ClickThrough></VideoClicks><MediaFiles><MediaFile type="video/mp4" width="300" height="250">https://cdn.example.com/ad.mp4</MediaFile></MediaFiles></Linear></Creative></Creatives></InLine></Ad></VAST>`;
  const fetchImpl = async (url) => new Response(url.toString().includes("inline") ? inline : wrapper, { status: 200 });
  const result = await resolveVast("https://ads.example.com/wrapper", {
    allowedHosts: "example.com", fetchImpl, totalTimeoutMs: 2000,
  });
  assert.equal(result.mediaUrl, "https://cdn.example.com/ad.mp4");
  assert.equal(result.impressionUrls.length, 2);
  assert.equal(result.tracking.start.length, 1);
  assert.equal(result.tracking.complete.length, 1);
});

test("VAST wrapper loops are rejected", async () => {
  const loop = `<VAST><Ad><Wrapper><VASTAdTagURI>https://ads.example.com/loop</VASTAdTagURI></Wrapper></Ad></VAST>`;
  await assert.rejects(resolveVast("https://ads.example.com/loop", {
    allowedHosts: "example.com", fetchImpl: async () => new Response(loop), totalTimeoutMs: 1000,
  }), /wrapper_loop/);
});

test("relative VAST wrappers resolve against their parent URL", async () => {
  const wrapper = `<VAST><Ad><Wrapper><VASTAdTagURI><![CDATA[/inline]]></VASTAdTagURI></Wrapper></Ad></VAST>`;
  const inline = `<VAST><Ad><InLine><Creatives><Creative><Linear><MediaFiles><MediaFile type="video/mp4">https://cdn.example.com/ad.mp4</MediaFile></MediaFiles></Linear></Creative></Creatives></InLine></Ad></VAST>`;
  const fetchImpl = async (url) => new Response(url.pathname === "/inline" ? inline : wrapper);
  const result = await resolveVast("https://ads.example.com/wrapper", {
    allowedHosts: "example.com", fetchImpl,
  });
  assert.equal(result.mediaUrl, "https://cdn.example.com/ad.mp4");
});

test("non-HTTP VAST media is rejected", async () => {
  const xml = `<VAST><Ad><InLine><Creatives><Creative><Linear><MediaFiles><MediaFile type="video/mp4">javascript:alert(1)</MediaFile></MediaFiles></Linear></Creative></Creatives></InLine></Ad></VAST>`;
  await assert.rejects(resolveVast("https://ads.example.com/vast", {
    allowedHosts: "example.com", fetchImpl: async () => new Response(xml),
  }), /no_media/);
});

test("VAST without compatible media is rejected", async () => {
  const noMedia = `<VAST><Ad><InLine><Creatives><Creative><Linear><MediaFiles><MediaFile type="application/javascript" apiFramework="VPAID">https://ads.example.com/vpaid.js</MediaFile></MediaFiles></Linear></Creative></Creatives></InLine></Ad></VAST>`;
  await assert.rejects(resolveVast("https://ads.example.com/no-media", {
    allowedHosts: "example.com", fetchImpl: async () => new Response(noMedia), allowVpaid: false,
  }), /no_media/);
});

test("VPAID requires explicit opt-in", async () => {
  const vpaid = `<VAST><Ad><InLine><Creatives><Creative><Linear><MediaFiles><MediaFile type="application/javascript" apiFramework="VPAID">https://ads.example.com/vpaid.js</MediaFile></MediaFiles></Linear></Creative></Creatives></InLine></Ad></VAST>`;
  const result = await resolveVast("https://ads.example.com/vpaid", {
    allowedHosts: "example.com", fetchImpl: async () => new Response(vpaid), allowVpaid: true,
  });
  assert.equal(result.adType, "vpaid-js");
});

test("player enforces 50 percent for 1000 ms and pauses hidden tabs", () => {
  assert.match(player, /viewabilityThreshold,\s*0\.5/);
  assert.match(player, /viewabilityTimeMs,\s*1000/);
  assert.match(player, /document\.visibilityState !== "visible"/);
  assert.match(player, /reset\(\)/);
});

test("player has one auction cycle and no internal refresh loop", () => {
  assert.match(player, /config\.maxAuctionCycles = 1/);
  assert.match(player, /config\.internalRefresh = false/);
  assert.doesNotMatch(player, /startHybridCycle|rotation_cycle_complete/);
});

test("complete no-fill invokes passback once and terminalizes", () => {
  assert.match(player, /machine\.startPassback\(\)/);
  assert.match(player, /machine\.transition\("passed-back"/);
  assert.match(player, /machine\.transition\("no-fill"/);
});

test("existing tags without new attributes retain safe loader defaults", () => {
  assert.match(loader, /viewabilityThreshold:\s*decimal\(data\.viewabilityThreshold,\s*0\.5\)/);
  assert.match(loader, /enablePassback:\s*boolean\(data\.enablePassback,\s*false\)/);
});

test("legacy v1.js tag routes to the safe player with compatibility VAST fallback", () => {
  assert.match(legacyLoader, /v1-legacy-20260713-5\.js/);
  assert.match(immutableLegacyLoader, /v1-price-priority-safe-player\.mjs/);
  assert.match(immutableLegacyLoader, /legacyBrowserVastFallback:\s*boolean\(data\.legacyBrowserVastFallback,\s*true\)/);
  assert.match(immutableLegacyLoader, /viewabilityThreshold:\s*decimal\(data\.viewabilityThreshold,\s*0\.5\)/);
});

test("runtime GAM macros override stored literal macros", () => {
  assert.match(player, /gamClickMacro:\s*base\.gamClickMacro\s*\|\|\s*remote\.gamClickMacro/);
  assert.match(player, /gamCachebuster:\s*base\.gamCachebuster\s*\|\|\s*remote\.gamCachebuster/);
});

test("browser VAST fetching is compatibility fallback only", () => {
  assert.match(player, /if \(!config\.legacyBrowserVastFallback\) throw error/);
  assert.match(player, /vast_browser_fallback/);
});

test("config GET uses ETag revalidation and controlled cache lifetime", () => {
  assert.match(configGet, /if-none-match/i);
  assert.match(configGet, /status:\s*304/);
  assert.match(configGet, /s-maxage=300/);
  assert.doesNotMatch(configGet, /Math\.random/);
});

test("config POST increments config version and supports legacy duplication", () => {
  assert.match(configPost, /configVersion = Math\.max\(1, Number\(existing\?\.configVersion \|\| 0\) \+ 1\)/);
  assert.match(configPost, /legacyConfigId/);
  assert.match(configPost, /Version 1 Price Priority Safe/);
});

test("tracking deduplicates filled, impression and terminal events", () => {
  assert.match(track, /\["ad_request", "request_filled", "impression", "terminal_state"\]/);
  assert.match(track, /dedupe:/);
  assert.match(track, /delivery:\$\{request\}/);
  assert.match(track, /terminal:\$\{request\}/);
});
