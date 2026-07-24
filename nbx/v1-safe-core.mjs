export const TERMINAL_STATES = new Set(["filled", "passed-back", "no-fill", "cancelled", "error"]);

export class RequestState {
  constructor(requestId, onTransition) {
    this.requestId = requestId;
    this.state = "created";
    this.deliveryRecorded = false;
    this.passbackStarted = false;
    this.auctionCycles = 0;
    this.cleanups = [];
    this.onTransition = typeof onTransition === "function" ? onTransition : () => {};
  }

  isTerminal() {
    return TERMINAL_STATES.has(this.state);
  }

  transition(next, detail = {}) {
    if (this.isTerminal() || !allowedTransition(this.state, next)) return false;
    const previous = this.state;
    this.state = next;
    this.onTransition({ previous, state: next, requestId: this.requestId, detail });
    if (this.isTerminal()) this.cleanup();
    return true;
  }

  addCleanup(fn) {
    if (typeof fn === "function") this.cleanups.push(fn);
  }

  recordDelivery() {
    if (this.deliveryRecorded || this.isTerminal()) return false;
    this.deliveryRecorded = true;
    return true;
  }

  startPassback() {
    if (this.passbackStarted || this.isTerminal()) return false;
    this.passbackStarted = true;
    return this.transition("running-passback");
  }

  cleanup() {
    this.cleanups.splice(0).forEach((fn) => {
      try { fn(); } catch (_) {}
    });
  }
}

export function allowedTransition(from, to) {
  const graph = {
    created: ["waiting-for-viewability", "cancelled", "error"],
    "waiting-for-viewability": ["auctioning", "cancelled", "error"],
    auctioning: ["rendering", "running-passback", "no-fill", "cancelled", "error"],
    rendering: ["filled", "running-passback", "no-fill", "cancelled", "error"],
    "running-passback": ["passed-back", "no-fill", "error"],
  };
  return (graph[from] || []).includes(to);
}

export function sanitizeConfigId(value) {
  const result = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/^-+|-+$/g, "")
    .slice(0, 180);
  if (!result || result.includes("..") || result.startsWith(".")) throw new Error("invalid_config_id");
  return result;
}

export function placementConfigId({ domain, placement, width = 300, height = 250, version = "v1" }) {
  return sanitizeConfigId(
    `${normalizeDomain(domain)}--${placement || "placement"}--${Number(width)}x${Number(height)}--${version}`
  );
}

export function normalizeDomain(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");
}

export function candidateAllowed(candidate, config) {
  const internal = finiteNumber(candidate?.cpm, finiteNumber(candidate?.nbxRankCpm, 0));
  const minimum = finiteNumber(config.minimumInternalCpm, 0);
  const gam = finiteNumber(config.gamLineItemCpm, 0);
  const tolerance = Math.max(0, finiteNumber(config.priceMismatchTolerance, 0));
  const required = config.rejectBelowGamRate ? Math.max(minimum, gam - tolerance) : minimum;
  return { allowed: internal >= required, internalCpm: internal, requiredCpm: required, gamCpm: gam };
}

export function prependGamClick(advertiserUrl, macro) {
  const target = String(advertiserUrl || "").trim();
  const click = String(macro || "").trim();
  if (!click || !/^https?:\/\//i.test(target)) return target;
  if (/%%CLICK_URL_(?:UNESC|ESC)%%/i.test(target)) return target;
  if (/%%CLICK_URL_UNESC%%/i.test(click)) return click + target;
  if (/%%CLICK_URL_ESC%%/i.test(click)) return click + encodeURIComponent(target);
  try {
    const parsed = new URL(click);
    if (!/^https?:$/.test(parsed.protocol)) return target;
    return click + target;
  } catch (_) {
    return target;
  }
}

export function finiteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
