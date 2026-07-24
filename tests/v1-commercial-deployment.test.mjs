// NexBanner Version 3 commercial release routing and deployment tests.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

import { onRequestPost } from "../functions/api/v1/config/index.js";

const routerSource = await readFile(new URL("../nbx/v1.js", import.meta.url), "utf8");
const commercialLoader = await readFile(new URL("../nbx/v1-commercial-20260724-6.js", import.meta.url), "utf8");
const commercialPlayer = await readFile(new URL("../nbx/nexbanner-player-20260724-6.js", import.meta.url), "utf8");
const legacyLoader = await readFile(new URL("../nbx/v1-legacy-20260713-5.js", import.meta.url), "utf8");

function routedLoader(version) {
  let inserted = null;
  const parentNode = {
    insertBefore(node) {
      inserted = node;
    },
    setAttribute() {}
  };
  const currentScript = {
    src: `https://nexbid.uk/nbx/v1.js?v=${version}`,
    attributes: [
      { name: "src", value: `https://nexbid.uk/nbx/v1.js?v=${version}` },
      { name: "data-config-id", value: "moneycontrol.com-unified-test" }
    ],
    parentNode,
    nextSibling: null
  };
  const document = {
    currentScript,
    createElement() {
      return { setAttribute(name, value) { this[name] = value; } };
    }
  };
  vm.runInNewContext(routerSource, {
    document,
    window: { location: { href: "https://publisher.example/page" } },
    URL
  });
  return inserted;
}

test("commercial release query routes to the immutable commercial loader", () => {
  const loader = routedLoader("20260724-6");
  assert.match(loader.src, /v1-commercial-20260724-6\.js\?v=20260724-6$/);
  assert.equal(loader["data-config-id"], "moneycontrol.com-unified-test");
});

test("the previous release query remains on the immutable legacy loader", () => {
  const loader = routedLoader("20260713-5");
  assert.match(loader.src, /v1-legacy-20260713-5\.js\?v=20260713-5$/);
  assert.match(legacyLoader, /v1-price-priority-safe-player\.mjs/);
});

test("commercial loader uses the immutable commercial player asset", () => {
  assert.match(commercialLoader, /nexbanner-player-20260724-6\.js/);
  assert.doesNotMatch(commercialLoader, /withCachebuster\(endpoint,\s*config\.cachebuster\)/);
  assert.match(commercialLoader, /cache:\s*"default"/);
});

test("deployment player is minified and exposes the commercial test hooks", () => {
  assert.ok(Buffer.byteLength(commercialPlayer) < 40000);
  assert.match(commercialPlayer, /startCommercialAuction/);
  assert.match(commercialPlayer, /runUnifiedAuction/);
  assert.doesNotMatch(commercialPlayer, /startViewableRotation\(root/);
});

test("commercial config excludes Prebid and ORTB and returns the new tag", async () => {
  const values = new Map();
  const store = {
    async get(key, type) {
      const value = values.get(key);
      return type === "json" && value ? JSON.parse(value) : value || null;
    },
    async put(key, value) {
      values.set(key, value);
    }
  };
  const request = new Request("https://nexbid.uk/api/v1/config", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      configId: "moneycontrol.com-unified-test",
      productVersion: "Version 1 Commercial Unified Auction",
      preset: "v1-commercial-unified-auction",
      setup: { publisherDomain: "moneycontrol.com", width: 300, height: 250 },
      vastDemand: [{
        name: "VAST",
        endpoint: "https://demand.example/vast",
        floorCpm: "0.15"
      }],
      displayScriptDemand: [{
        name: "Display JS",
        endpoint: "https://demand.example/display.js",
        configuredBidCpm: "0.20"
      }],
      displayDemand: [{
        name: "Direct Display",
        endpoint: "https://demand.example/display"
      }],
      prebidDemand: [{ name: "Ignored", endpoint: "https://prebid.example/bid" }],
      ortbDemand: [{ name: "Ignored", endpoint: "https://ortb.example/bid" }]
    })
  });
  const response = await onRequestPost({
    request,
    env: { NEXBANNER_CONFIGS: store },
    waitUntil() {}
  });
  const result = await response.json();
  const saved = JSON.parse(values.get("moneycontrol.com-unified-test"));

  assert.equal(response.status, 200);
  assert.match(result.tag, /v1\.js\?v=20260724-6/);
  assert.deepEqual(saved.prebidDemand, []);
  assert.deepEqual(saved.ortbDemand, []);
  assert.equal(saved.vastDemand[0].floorCpm, "0.15");
  assert.equal(saved.vastDemand[0].currency, "USD");
  assert.equal(saved.displayScriptDemand[0].configuredBidCpm, "0.20");
  assert.equal(saved.displayDemand[0].endpoint, "https://demand.example/display");
  assert.equal(saved.viewabilityThreshold, 0.3);
  assert.equal(saved.viewabilityTimeMs, 200);
  assert.equal(saved.auctionTimeoutMs, 900);
  assert.equal(saved.partnerTimeoutMs, 750);
  assert.equal(saved.bidTtlMs, 5000);
});
