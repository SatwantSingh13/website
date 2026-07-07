const InvoicePdf = (() => {
  function hexToRgb(hex) {
    const clean = String(hex || "#0069ff").replace("#", "");
    const value = parseInt(clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean, 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  }

  function lines(doc, text, x, y, maxWidth, lineHeight) {
    const split = doc.splitTextToSize(String(text || ""), maxWidth);
    doc.text(split, x, y);
    return y + split.length * lineHeight;
  }

  function create(invoice, settings, dates) {
    if (!window.jspdf) {
      throw new Error("jsPDF did not load. Check the CDN script or use a bundled copy.");
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    const primary = hexToRgb(settings.primaryColor);
    const accent = hexToRgb(settings.accentColor);
    const money = Utils.currencyFormatter(settings.currency);
    const margin = 18;

    doc.setFillColor(primary[0], primary[1], primary[2]);
    doc.rect(0, 0, 210, 16, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text(settings.logoText || settings.companyName, margin, 10.5);

    doc.setTextColor(20, 28, 46);
    doc.setFontSize(24);
    doc.text("INVOICE", 155, 31);
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text(`Invoice No: ${invoice.invoiceNumber}`, 155, 39);
    doc.text(`Invoice Date: ${Utils.isoDate(dates.invoiceDate)}`, 155, 45);
    doc.text(`Due Date: ${Utils.isoDate(dates.dueDate)}`, 155, 51);
    doc.text(`Billing Period: ${Utils.displayMonth(dates.billingPeriod)}`, 155, 57);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text(settings.companyName, margin, 30);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    let y = lines(doc, settings.companyAddress, margin, 36, 70, 5);
    doc.text(settings.companyEmail, margin, y + 1);
    doc.text(settings.companyWebsite, margin, y + 6);

    doc.setDrawColor(225, 231, 244);
    doc.line(margin, 68, 192, 68);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("Bill To", margin, 80);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(invoice.partnerName, margin, 88);
    y = lines(doc, invoice.partnerAddress, margin, 94, 85, 5);
    doc.text(invoice.contactEmail, margin, y + 1);

    const tableTop = 118;
    doc.setFillColor(accent[0], accent[1], accent[2]);
    doc.roundedRect(margin, tableTop, 174, 11, 2, 2, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("Description", margin + 4, tableTop + 7);
    doc.text("Bill Type", 83, tableTop + 7);
    doc.text("Payment Terms", 122, tableTop + 7);
    doc.text("Amount", 169, tableTop + 7);

    doc.setTextColor(20, 28, 46);
    doc.setFont("helvetica", "normal");
    doc.rect(margin, tableTop + 11, 174, 18);
    doc.text(`NexBid advertising services for ${Utils.displayMonth(dates.billingPeriod)}`, margin + 4, tableTop + 22);
    doc.text(invoice.billType, 83, tableTop + 22);
    doc.text(`${invoice.paymentTerm} days`, 122, tableTop + 22);
    doc.text(money.format(invoice.amount), 169, tableTop + 22);

    const tax = invoice.amount * (Number(settings.taxRate) || 0);
    const total = invoice.amount + tax;
    const totalsX = 126;
    y = 158;
    doc.setFont("helvetica", "normal");
    doc.text("Subtotal", totalsX, y);
    doc.text(money.format(invoice.amount), 171, y);
    doc.text("Tax (0)", totalsX, y + 8);
    doc.text(money.format(tax), 171, y + 8);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text("Grand Total", totalsX, y + 19);
    doc.text(money.format(total), 169, y + 19);

    doc.setDrawColor(225, 231, 244);
    doc.line(margin, 204, 192, 204);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("Bank Details", margin, 216);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    lines(doc, settings.bankDetails, margin, 223, 92, 5);
    doc.setTextColor(primary[0], primary[1], primary[2]);
    doc.setFont("helvetica", "bold");
    doc.text(settings.thankYouMessage || "Thank you for your business.", margin, 276);

    return doc;
  }

  function fileName(invoice) {
    return `Invoice_${invoice.invoiceNumber}_${Utils.safeFileName(invoice.partnerName)}.pdf`;
  }

  return { create, fileName };
})();
