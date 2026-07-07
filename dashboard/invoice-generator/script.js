const App = (() => {
  const state = {
    invoices: [],
    generated: new Map(),
    settings: Utils.getSettings(),
    dates: {}
  };

  const els = {};

  function init() {
    [
      "fileInput", "dropzone", "progressBar", "statusMessage", "invoiceRows",
      "searchInput", "warningList", "invoiceCount", "totalAmount", "billingMonth",
      "partnerCount", "generateAll", "downloadZip", "resetCounter", "loadSample",
      "settingsForm", "saveSettings", "restoreSettings", "themeToggle",
      "generateAllTop", "downloadZipTop"
    ].forEach((id) => {
      els[id] = document.getElementById(id);
    });

    applyTheme(Utils.getTheme());
    hydrateSettingsForm();
    bindEvents();
    refreshDates();
    render();
  }

  function refreshDates() {
    const invoiceDate = new Date();
    const billingPeriod = Utils.previousMonth(invoiceDate);
    state.dates = { invoiceDate, billingPeriod };
    els.billingMonth.textContent = Utils.displayMonth(billingPeriod);
  }

  function bindEvents() {
    els.fileInput.addEventListener("change", (event) => {
      const file = event.target.files[0];
      if (file) loadFile(file);
    });

    ["dragenter", "dragover"].forEach((eventName) => {
      els.dropzone.addEventListener(eventName, (event) => {
        event.preventDefault();
        els.dropzone.classList.add("dragover");
      });
    });

    ["dragleave", "drop"].forEach((eventName) => {
      els.dropzone.addEventListener(eventName, (event) => {
        event.preventDefault();
        els.dropzone.classList.remove("dragover");
      });
    });

    els.dropzone.addEventListener("drop", (event) => {
      const file = event.dataTransfer.files[0];
      if (file) loadFile(file);
    });

    els.searchInput.addEventListener("input", renderRows);
    els.generateAll.addEventListener("click", generateAll);
    els.generateAllTop.addEventListener("click", generateAll);
    els.downloadZip.addEventListener("click", downloadZip);
    els.downloadZipTop.addEventListener("click", downloadZip);
    els.resetCounter.addEventListener("click", resetCounter);
    els.loadSample.addEventListener("click", () => {
      state.invoices = assignInvoiceNumbers(ExcelParser.sampleRows());
      state.generated.clear();
      setStatus("Sample invoices loaded.");
      render();
    });
    els.saveSettings.addEventListener("click", saveSettings);
    els.restoreSettings.addEventListener("click", restoreSettings);
    els.themeToggle.addEventListener("click", () => {
      applyTheme(document.body.classList.contains("dark") ? "light" : "dark");
    });
  }

  async function loadFile(file) {
    try {
      setStatus(`Reading ${file.name}...`);
      const buffer = await file.arrayBuffer();
      state.invoices = assignInvoiceNumbers(ExcelParser.parseWorkbook(buffer));
      state.generated.clear();
      setStatus(`${state.invoices.length} invoice rows loaded from ${file.name}.`);
      render();
    } catch (error) {
      setStatus(error.message);
    }
  }

  function assignInvoiceNumbers(rows) {
    const periodKey = Utils.yyyymm(state.dates.billingPeriod || Utils.previousMonth());
    const existing = Utils.getCounter(periodKey);
    return rows.map((row, index) => ({
      ...row,
      invoiceSequence: existing + index + 1,
      invoiceNumber: Utils.invoiceNumber(state.settings, state.dates.billingPeriod || Utils.previousMonth(), existing + index + 1),
      dueDate: Utils.addDays(state.dates.invoiceDate || new Date(), row.paymentTerm)
    }));
  }

  function render() {
    const money = Utils.currencyFormatter(state.settings.currency);
    els.invoiceCount.textContent = state.invoices.length;
    els.partnerCount.textContent = new Set(state.invoices.map((invoice) => Utils.normaliseName(invoice.partnerName))).size;
    els.totalAmount.textContent = money.format(state.invoices.reduce((sum, invoice) => sum + invoice.amount, 0));
    renderWarnings();
    renderRows();
    setButtons();
  }

  function renderWarnings() {
    const warnings = state.invoices.flatMap((invoice) => invoice.warnings.map((warning) => `${invoice.partnerName}: ${warning}`));
    if (!warnings.length) {
      els.warningList.hidden = true;
      els.warningList.innerHTML = "";
      return;
    }
    els.warningList.hidden = false;
    els.warningList.innerHTML = warnings.map((warning) => `<div>${escapeHtml(warning)}</div>`).join("");
  }

  function renderRows() {
    const query = Utils.normalise(els.searchInput.value).toLowerCase();
    const money = Utils.currencyFormatter(state.settings.currency);
    const rows = state.invoices.filter((invoice) => {
      const haystack = `${invoice.partnerName} ${invoice.billType} ${invoice.contactEmail}`.toLowerCase();
      return haystack.includes(query);
    });

    if (!rows.length) {
      els.invoiceRows.innerHTML = `<tr><td colspan="7" class="empty">${state.invoices.length ? "No invoices match the search." : "Upload a workbook to preview invoices."}</td></tr>`;
      return;
    }

    els.invoiceRows.innerHTML = rows.map((invoice) => {
      const ok = invoice.warnings.length === 0;
      return `
        <tr>
          <td>${escapeHtml(invoice.partnerName)}<br><small>${escapeHtml(invoice.contactEmail || "No email")}</small></td>
          <td>${escapeHtml(invoice.billType)}</td>
          <td>${invoice.paymentTerm} days</td>
          <td>${money.format(invoice.amount)}</td>
          <td>${invoice.invoiceNumber}</td>
          <td><span class="badge ${ok ? "ok" : "bad"}">${ok ? "Ready" : "Check"}</span></td>
          <td><button class="secondary" type="button" data-id="${escapeHtml(invoice.id)}">PDF</button></td>
        </tr>
      `;
    }).join("");

    els.invoiceRows.querySelectorAll("button[data-id]").forEach((button) => {
      button.addEventListener("click", () => generateSingle(button.dataset.id, true));
    });
  }

  function setButtons() {
    const hasRows = state.invoices.length > 0;
    [els.generateAll, els.generateAllTop, els.downloadZip, els.downloadZipTop].forEach((button) => {
      button.disabled = !hasRows;
    });
  }

  function validateInvoice(invoice) {
    if (invoice.warnings.some((warning) => ["Missing address", "Missing email", "Invalid amount"].includes(warning))) {
      throw new Error(`${invoice.partnerName} needs address, email, and a valid amount before PDF generation.`);
    }
  }

  function createPdf(invoice) {
    validateInvoice(invoice);
    const dates = { ...state.dates, dueDate: Utils.addDays(state.dates.invoiceDate, invoice.paymentTerm) };
    return InvoicePdf.create(invoice, state.settings, dates);
  }

  function generateSingle(id, download) {
    try {
      const invoice = state.invoices.find((item) => item.id === id);
      const doc = createPdf(invoice);
      const filename = InvoicePdf.fileName(invoice);
      state.generated.set(invoice.id, { invoice, blob: doc.output("blob"), filename });
      if (download) doc.save(filename);
      setStatus(`${filename} generated.`);
      commitCounter();
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function generateAll() {
    if (!state.invoices.length) return;
    try {
      state.generated.clear();
      for (let index = 0; index < state.invoices.length; index += 1) {
        const invoice = state.invoices[index];
        const doc = createPdf(invoice);
        state.generated.set(invoice.id, {
          invoice,
          blob: doc.output("blob"),
          filename: InvoicePdf.fileName(invoice)
        });
        setProgress(((index + 1) / state.invoices.length) * 100);
        await new Promise((resolve) => setTimeout(resolve, 35));
      }
      commitCounter();
      setStatus(`${state.generated.size} PDFs generated. Use ZIP to download them together.`);
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function downloadZip() {
    try {
      if (!window.JSZip) throw new Error("JSZip did not load. Check the CDN script or use a bundled copy.");
      if (state.generated.size !== state.invoices.length) await generateAll();
      const zip = new JSZip();
      state.generated.forEach(({ blob, filename }) => zip.file(filename, blob));
      const content = await zip.generateAsync({ type: "blob" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(content);
      link.download = `NexBid_Invoices_${Utils.yyyymm(state.dates.billingPeriod)}.zip`;
      link.click();
      URL.revokeObjectURL(link.href);
      setStatus("ZIP download prepared.");
    } catch (error) {
      setStatus(error.message);
    }
  }

  function commitCounter() {
    if (!state.invoices.length) return;
    const periodKey = Utils.yyyymm(state.dates.billingPeriod);
    const maxSequence = Math.max(...state.invoices.map((invoice) => invoice.invoiceSequence));
    Utils.setCounter(periodKey, Math.max(Utils.getCounter(periodKey), maxSequence));
  }

  function resetCounter() {
    const periodKey = Utils.yyyymm(state.dates.billingPeriod);
    Utils.resetCounter(periodKey);
    state.invoices = assignInvoiceNumbers(state.invoices);
    state.generated.clear();
    setStatus(`Invoice counter reset for ${Utils.displayMonth(state.dates.billingPeriod)}.`);
    render();
  }

  function hydrateSettingsForm() {
    Object.entries(state.settings).forEach(([key, value]) => {
      const field = els.settingsForm.elements[key];
      if (field) field.value = value;
    });
  }

  function saveSettings() {
    const formData = new FormData(els.settingsForm);
    state.settings = { ...state.settings, ...Object.fromEntries(formData.entries()) };
    Utils.saveSettings(state.settings);
    state.invoices = assignInvoiceNumbers(state.invoices);
    state.generated.clear();
    setStatus("Settings saved in this browser.");
    render();
  }

  function restoreSettings() {
    Utils.resetSettings();
    state.settings = Utils.getSettings();
    hydrateSettingsForm();
    state.invoices = assignInvoiceNumbers(state.invoices);
    state.generated.clear();
    setStatus("Default settings restored.");
    render();
  }

  function applyTheme(theme) {
    document.body.classList.toggle("dark", theme === "dark");
    Utils.saveTheme(theme);
  }

  function setProgress(value) {
    els.progressBar.style.width = `${Math.max(0, Math.min(100, value))}%`;
  }

  function setStatus(message) {
    els.statusMessage.textContent = message;
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    })[char]);
  }

  return { init };
})();

document.addEventListener("DOMContentLoaded", App.init);
