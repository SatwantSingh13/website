# NexBanner Version 1: GAM Price Priority Production Safe

## Scope

This mode is for a Publisher Google Ad Manager **Price Priority** line item that runs NexBanner as a third-party 300×250 creative. A fixed Price Priority CPM is static: GAM selects the line item before NexBanner discovers its internal winner. NexBanner does not report a fake dynamic CPM back to GAM.

True request-level competition requires the separate NexBid Prebid adapter or a GAM price-bucket line-item architecture.

## Publisher GAM setup

1. Create a Price Priority line item with the commercial CPM agreed with NexBid.
2. Target only the agreed publisher, inventory, placement and 300×250 size.
3. Add a third-party/custom creative using the safe tag below.
4. Keep SafeFrame enabled unless a tested partner requires otherwise.
5. Configure a publisher-owned passback that cannot select the same NexBanner line item, preventing recursion.

```html
<script
  src="https://nexbid.uk/nbx/v1-price-priority-safe.js?v=20260724-1"
  data-config-id="moneycontrol.com--article-mid--300x250--v1"
  data-config-version="1"
  data-publisher-id="moneycontrol"
  data-publisher-domain="moneycontrol.com"
  data-placement-id="article-mid"
  data-width="300"
  data-height="250"
  data-gam-click="%%CLICK_URL_UNESC%%"
  data-gam-cachebuster="%%CACHEBUSTER%%">
</script>
```

The legacy `/nbx/v1.js?v=20260713-5` asset remains available for rollback. It is not overwritten by this feature.

## Request lifecycle

`created → waiting-for-viewability → auctioning → rendering → filled`

Complete no-fill:

`auctioning/rendering → running-passback → passed-back`

Passback no-fill:

`running-passback → no-fill`

Other terminal states are `cancelled` and `error`. Terminal requests ignore late callbacks. One GAM creative execution receives one request ID, one auction cycle, one winning paid creative, at most one NexBanner impression and exactly one terminal event.

## Viewability

Production-safe defaults:

- 50% of the 300×250 placement visible
- continuously visible for 1,000 ms
- page visibility state is `visible`
- maximum viewability wait is 15,000 ms
- no demand call after timeout unless `auctionOnViewabilityTimeout` is explicitly enabled

The continuous timer resets below 50% and pauses while the tab is hidden.

## Price protection

Configure:

- `gamLineItemCpm`
- `minimumInternalCpm`
- `currency`
- `rejectBelowGamRate: true`
- `priceMismatchTolerance`

An internal candidate below the protected threshold is rejected and tracked as `price_mismatch`. The final threshold should cover the publisher CPM, currency risk, discrepancies, invalid-traffic deductions and NexBid margin.

All CPM fields in one configuration must use the same `currency`. This player does not perform foreign-exchange conversion.

## Passback

Example saved configuration:

```json
{
  "enablePassback": true,
  "passbackScriptUrl": "https://publisher.example.com/gam-passback.js",
  "passbackHtml": "",
  "passbackTimeoutMs": 2000,
  "collapseOnPassbackFailure": false
}
```

The passback runs once only after all configured NexBanner candidates fail or are rejected. It runs in a sandboxed iframe. A passback must not call the same NexBanner line item.

Direct tags may use `data-passback-html`, `data-passback-script-url`, `data-passback-timeout-ms`, `data-enable-passback`, and `data-collapse-on-passback-failure`. Prefer saved configuration so publisher tags remain short.

## Server-side VAST resolver

Production Version 1 calls `/api/v1/vast/resolve`. The resolver:

- requires HTTP(S)
- blocks localhost, private/link-local/metadata IP literals and unsafe redirects
- requires an allowed hostname list by default
- follows VAST wrappers to a maximum depth
- detects loops
- applies per-hop and total timeouts
- merges wrapper/inline impression, error and tracking URLs
- selects browser-compatible video
- leaves VPAID disabled unless explicitly opted in

Required Cloudflare binding:

- `NEXBANNER_CONFIGS` — KV namespace

Recommended separate binding:

- `NEXBANNER_EVENTS` — KV namespace for tracking/reporting

Environment variables:

```text
NEXBANNER_VAST_ALLOWED_HOSTS=partner-a.example,partner-b.example,cdn.example
NEXBANNER_VAST_REQUIRE_ALLOWLIST=true
NEXBANNER_VAST_MAX_WRAPPER_DEPTH=5
NEXBANNER_VAST_HOP_TIMEOUT_MS=1500
NEXBANNER_VAST_TOTAL_TIMEOUT_MS=5000
```

No secrets or Cloudflare bindings are exposed to the browser.

Protect configuration POST access with the existing Cloudflare Access application or an equivalent origin rule. Configuration GET, tracking, player assets and the VAST resolver must remain reachable by publisher creatives; dashboard/configuration writes should not be public.

## Placement-specific configuration

Recommended ID:

```text
moneycontrol.com--article-mid--300x250--v1
```

Legacy domain IDs still resolve. The dashboard can load a legacy ID and save it as an independent placement-specific configuration without overwriting the legacy entry.

Configuration saves increment `configVersion`. GET responses provide ETags and short controlled edge caching. The safe loader requests:

```text
/api/v1/config/{configId}?v={configVersion}
```

Old tags without `data-config-version` safely revalidate the unversioned URL.

## Testing

```powershell
npm test
npm run check
```

## Staged rollout

1. Run local syntax and automated tests.
2. Test server-side VAST with approved allowlisted partner hosts.
3. Use GAM creative preview.
4. Verify on a dedicated publisher test page.
5. Reconcile GAM entry requests, qualified requests, fills, impressions, passbacks and terminal states.
6. Run at 1% traffic.
7. Increase to 10% after reconciliation.
8. Move to full traffic only after publisher and demand reports agree.

This repository has no checked-in Wrangler project configuration. For the current Git-connected Cloudflare deployment, run tests locally, commit only the reviewed files on a feature branch, push that branch for a preview deployment, and merge only after GAM preview and test-page verification. Do not guess or run a direct `wrangler pages deploy` command without the actual Cloudflare project name and binding configuration.

## Rollback

1. Pause the production-safe GAM creative or line item.
2. Restore the legacy creative tag if required.
3. Do not delete placement configurations or event data.
4. Compare request IDs and terminal-state reports before resuming.

## Fixed Price Priority limitations

NexBanner cannot change the already-selected GAM Price Priority CPM, guarantee a partner response, prevent browser/network/ad-blocker loss, or make GAM treat an internal no-fill as if the NexBanner line item never won. Passback, price protection, one-impression enforcement and reporting reconciliation reduce these risks but cannot remove the static-line-item limitation.
