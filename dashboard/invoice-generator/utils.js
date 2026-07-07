const Utils = (() => {
  const counterKey = "nexbid.invoice.counter";
  const settingsKey = "nexbid.invoice.settings";
  const themeKey = "nexbid.invoice.theme";

  function previousMonth(date = new Date()) {
    return new Date(date.getFullYear(), date.getMonth() - 1, 1);
  }

  function yyyymm(date) {
    return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}`;
  }

  function displayMonth(date) {
    return date.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  }

  function isoDate(date) {
    return date.toISOString().slice(0, 10);
  }

  function addDays(date, days) {
    const copy = new Date(date);
    copy.setDate(copy.getDate() + Number(days || 0));
    return copy;
  }

  function currencyFormatter(currency) {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency });
  }

  function normalise(value) {
    return String(value ?? "").trim();
  }

  function normaliseName(value) {
    return normalise(value).toLowerCase().replace(/\s+/g, " ");
  }

  function getSettings() {
    const saved = JSON.parse(localStorage.getItem(settingsKey) || "{}");
    return { ...window.NEXBID_CONFIG, ...saved };
  }

  function saveSettings(settings) {
    localStorage.setItem(settingsKey, JSON.stringify(settings));
  }

  function resetSettings() {
    localStorage.removeItem(settingsKey);
  }

  function getTheme() {
    return localStorage.getItem(themeKey) || "light";
  }

  function saveTheme(theme) {
    localStorage.setItem(themeKey, theme);
  }

  function getCounter(periodKey) {
    const counters = JSON.parse(localStorage.getItem(counterKey) || "{}");
    return counters[periodKey] || 0;
  }

  function setCounter(periodKey, value) {
    const counters = JSON.parse(localStorage.getItem(counterKey) || "{}");
    counters[periodKey] = value;
    localStorage.setItem(counterKey, JSON.stringify(counters));
  }

  function resetCounter(periodKey) {
    if (!periodKey) {
      localStorage.removeItem(counterKey);
      return;
    }
    const counters = JSON.parse(localStorage.getItem(counterKey) || "{}");
    delete counters[periodKey];
    localStorage.setItem(counterKey, JSON.stringify(counters));
  }

  function invoiceNumber(settings, periodDate, sequence) {
    return `${settings.invoicePrefix || "00"}${yyyymm(periodDate)}${String(sequence).padStart(5, "0")}`;
  }

  function safeFileName(value) {
    return normalise(value).replace(/[^a-z0-9_-]+/gi, "_").replace(/^_+|_+$/g, "") || "Invoice";
  }

  return {
    previousMonth,
    yyyymm,
    displayMonth,
    isoDate,
    addDays,
    currencyFormatter,
    normalise,
    normaliseName,
    getSettings,
    saveSettings,
    resetSettings,
    getTheme,
    saveTheme,
    getCounter,
    setCounter,
    resetCounter,
    invoiceNumber,
    safeFileName
  };
})();
