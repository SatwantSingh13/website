const ExcelParser = (() => {
  const invoiceFields = {
    sno: ["sno", "serial", "serial no"],
    partnerName: ["partner name", "partner", "company", "company name"],
    itemDescription: ["item description", "description", "item", "service description"],
    billType: ["bill type", "billing type", "service type"],
    quantity: ["quantity", "qty"],
    unitPrice: ["unit price", "rate", "price"],
    amount: ["amount", "invoice amount", "line total"],
    paymentTerm: ["payment term", "payment terms", "payment days"]
  };

  const partnerFields = {
    partnerName: ["partner name", "partner", "company", "company name"],
    partnerAddress: ["partner address", "address", "billing address"],
    contactEmail: ["contact email", "email", "partner email", "billing email"]
  };

  function findValue(row, aliases) {
    const keys = Object.keys(row);
    const found = keys.find((key) => aliases.includes(key.trim().toLowerCase()));
    return found ? row[found] : "";
  }

  function mapRows(rows, fields) {
    return rows.map((row) => {
      const mapped = {};
      Object.entries(fields).forEach(([field, aliases]) => {
        mapped[field] = findValue(row, aliases);
      });
      return mapped;
    });
  }

  function numberValue(value, fallback = 0) {
    const parsed = Number(String(value ?? "").replace(/[£$€,\s]/g, ""));
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function rowsFromDetectedHeader(sheet, requiredHeaders, sheetName) {
    const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
    const headerIndex = rawRows.findIndex((row) => {
      const cells = row.map((value) => Utils.normalise(value).toLowerCase());
      return requiredHeaders.every((aliases) => aliases.some((alias) => cells.includes(alias)));
    });

    if (headerIndex < 0) {
      throw new Error(`${sheetName} is missing the required column headers.`);
    }

    return XLSX.utils.sheet_to_json(sheet, { range: headerIndex, defval: "" });
  }

  function parseWorkbook(arrayBuffer) {
    if (!window.XLSX) {
      throw new Error("SheetJS did not load. Check the CDN script or use a bundled copy.");
    }

    const workbook = XLSX.read(arrayBuffer, { type: "array" });
    const invoiceSheet = workbook.Sheets.InvoiceData || workbook.Sheets[workbook.SheetNames[0]];
    const partnerSheet = workbook.Sheets.Partners || workbook.Sheets[workbook.SheetNames[1]];

    if (!invoiceSheet || !partnerSheet) {
      throw new Error("Workbook must include InvoiceData and Partners sheets.");
    }

    const invoiceRows = rowsFromDetectedHeader(
      invoiceSheet,
      [invoiceFields.partnerName],
      "InvoiceData"
    );
    const partnerRows = rowsFromDetectedHeader(
      partnerSheet,
      [partnerFields.partnerName],
      "Partners"
    );
    const partners = new Map();

    mapRows(partnerRows, partnerFields).forEach((partner) => {
      const key = Utils.normaliseName(partner.partnerName);
      if (key) partners.set(key, partner);
    });

    const grouped = new Map();
    mapRows(invoiceRows, invoiceFields)
      .filter((row) => Utils.normalise(row.partnerName))
      .forEach((row, index) => {
        const key = Utils.normaliseName(row.partnerName);
        const partner = partners.get(key) || {};
        const quantity = Math.max(numberValue(row.quantity, 1), 0);
        const unitPrice = numberValue(row.unitPrice, 0);
        const explicitAmount = numberValue(row.amount, NaN);
        const amount = Number.isFinite(explicitAmount) ? explicitAmount : quantity * unitPrice;
        const paymentTerm = Math.max(numberValue(row.paymentTerm, 0), 0);
        const billType = Utils.normalise(row.billType) || "Advertising Services";
        const description = Utils.normalise(row.itemDescription) || billType;

        if (!grouped.has(key)) {
          grouped.set(key, {
            id: `invoice-${key}`,
            partnerName: Utils.normalise(row.partnerName),
            partnerAddress: Utils.normalise(partner.partnerAddress),
            contactEmail: Utils.normalise(partner.contactEmail),
            paymentTerm,
            items: [],
            warnings: []
          });
        }

        const invoice = grouped.get(key);
        invoice.paymentTerm = Math.max(invoice.paymentTerm, paymentTerm);
        invoice.items.push({
          id: `${key}-${index}`,
          sno: row.sno || index + 1,
          description,
          billType,
          quantity: quantity || 1,
          unitPrice,
          amount: Number.isFinite(amount) ? amount : 0
        });
      });

    return Array.from(grouped.values()).map((invoice) => {
      if (!invoice.partnerAddress) invoice.warnings.push("Missing address");
      if (!invoice.contactEmail) invoice.warnings.push("Missing email");
      if (invoice.items.some((item) => !Number.isFinite(item.amount) || item.amount === 0)) {
        invoice.warnings.push("Invalid amount");
      }

      return {
        ...invoice,
        amount: invoice.items.reduce((sum, item) => sum + item.amount, 0),
        billType: Array.from(new Set(invoice.items.map((item) => item.billType))).join(", ")
      };
    });
  }

  function sampleRows() {
    return [
      {
        id: "sample-alpha",
        partnerName: "Alpha Media Ltd",
        partnerAddress: "10 Market Street, London, UK",
        contactEmail: "finance@alphamedia.example",
        paymentTerm: 30,
        items: [
          { id: "alpha-1", description: "Programmatic display campaign", billType: "Display", quantity: 1, unitPrice: 1750, amount: 1750 },
          { id: "alpha-2", description: "Campaign optimisation", billType: "Service Fee", quantity: 2, unitPrice: 350, amount: 700 }
        ],
        amount: 2450,
        billType: "Display, Service Fee",
        warnings: []
      },
      {
        id: "sample-bravo",
        partnerName: "Bravo Apps",
        partnerAddress: "22 App Lane, Manchester, UK",
        contactEmail: "accounts@bravoapps.example",
        paymentTerm: 15,
        items: [
          { id: "bravo-1", description: "In-app video inventory", billType: "Video", quantity: 1, unitPrice: 1875.5, amount: 1875.5 }
        ],
        amount: 1875.5,
        billType: "Video",
        warnings: []
      }
    ];
  }

  return { parseWorkbook, sampleRows };
})();
