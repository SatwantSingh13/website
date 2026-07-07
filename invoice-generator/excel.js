const ExcelParser = (() => {
  const invoiceFields = {
    sno: ["sno", "serial", "serial no"],
    partnerName: ["partner name", "partner"],
    amount: ["amount", "invoice amount"],
    paymentTerm: ["payment term", "payment terms"],
    billType: ["bill type", "billing type"]
  };

  const partnerFields = {
    partnerName: ["partner name", "partner"],
    partnerAddress: ["partner address", "address"],
    contactEmail: ["contact email", "email", "partner email"]
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

    const invoiceRows = XLSX.utils.sheet_to_json(invoiceSheet, { defval: "" });
    const partnerRows = XLSX.utils.sheet_to_json(partnerSheet, { defval: "" });
    const partners = new Map();

    mapRows(partnerRows, partnerFields).forEach((partner) => {
      const key = Utils.normaliseName(partner.partnerName);
      if (key) partners.set(key, partner);
    });

    const seen = new Map();
    const invoices = mapRows(invoiceRows, invoiceFields)
      .filter((row) => Utils.normalise(row.partnerName))
      .map((row, index) => {
        const key = Utils.normaliseName(row.partnerName);
        const partner = partners.get(key) || {};
        const amount = Number(String(row.amount).replace(/,/g, ""));
        const paymentTerm = Number(row.paymentTerm || 0);
        const duplicateCount = seen.get(key) || 0;
        seen.set(key, duplicateCount + 1);

        const warnings = [];
        if (!partner.partnerAddress) warnings.push("Missing address");
        if (!partner.contactEmail) warnings.push("Missing email");
        if (!Number.isFinite(amount) || amount <= 0) warnings.push("Invalid amount");
        if (duplicateCount > 0) warnings.push("Duplicate partner");

        return {
          id: `${key}-${index}`,
          sno: row.sno,
          partnerName: Utils.normalise(row.partnerName),
          amount: Number.isFinite(amount) ? amount : 0,
          paymentTerm: Number.isFinite(paymentTerm) ? paymentTerm : 0,
          billType: Utils.normalise(row.billType) || "Advertising Services",
          partnerAddress: Utils.normalise(partner.partnerAddress),
          contactEmail: Utils.normalise(partner.contactEmail),
          warnings
        };
      });

    return invoices;
  }

  function sampleRows() {
    return [
      {
        id: "sample-alpha",
        partnerName: "Alpha Media Ltd",
        partnerAddress: "10 Market Street, London, UK",
        contactEmail: "finance@alphamedia.example",
        amount: 2450,
        paymentTerm: 30,
        billType: "Programmatic Display",
        warnings: []
      },
      {
        id: "sample-bravo",
        partnerName: "Bravo Apps",
        partnerAddress: "22 App Lane, Manchester, UK",
        contactEmail: "accounts@bravoapps.example",
        amount: 1875.5,
        paymentTerm: 15,
        billType: "In-app Video",
        warnings: []
      }
    ];
  }

  return { parseWorkbook, sampleRows };
})();
