const InvoicePdf = (() => {
  function hexToRgb(hex) {
    const clean = String(hex || "#ff168f").replace("#", "");
    const value = parseInt(clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean, 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  }

  function lines(doc, text, x, y, maxWidth, lineHeight) {
    const split = doc.splitTextToSize(String(text || ""), maxWidth);
    doc.text(split, x, y);
    return y + split.length * lineHeight;
  }

  function addLogo(doc, settings) {
    if (settings.logoDataUrl) {
      try {
        const format = settings.logoDataUrl.includes("image/jpeg") ? "JPEG" : "PNG";
        doc.addImage(settings.logoDataUrl, format, 18, 4, 12, 12, undefined, "FAST");
        return 34;
      } catch (error) {
        // Fall back to logo text if an unsupported image is stored.
      }
    }
    return 18;
  }

  function drawHeader(doc, settings, primary, pageNumber) {
    doc.setFillColor(primary[0], primary[1], primary[2]);
    doc.rect(0, 0, 210, 20, "F");
    doc.setFillColor(123, 44, 255);
    doc.rect(150, 0, 42, 20, "F");
    doc.setFillColor(255, 106, 0);
    doc.rect(192, 0, 18, 20, "F");
    const textX = addLogo(doc, settings);
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text(settings.logoText || settings.companyName, textX, 12.5);
    if (pageNumber > 1) {
      doc.setFontSize(9);
      doc.text(`Page ${pageNumber}`, 181, 12.5);
    }
  }

  function drawTableHeader(doc, y, accent) {
    doc.setFillColor(accent[0], accent[1], accent[2]);
    doc.roundedRect(18, y, 174, 10, 2, 2, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.text("Description", 22, y + 6.5);
    doc.text("Bill Type", 91, y + 6.5);
    doc.text("Qty", 132, y + 6.5);
    doc.text("Rate", 149, y + 6.5);
    doc.text("Amount", 177, y + 6.5);
    return y + 10;
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
    const items = invoice.items?.length ? invoice.items : [{
      description: `NexBid advertising services for ${Utils.displayMonth(dates.billingPeriod)}`,
      billType: invoice.billType,
      quantity: 1,
      unitPrice: invoice.amount,
      amount: invoice.amount
    }];

    drawHeader(doc, settings, primary, 1);

    doc.setTextColor(18, 18, 24);
    doc.setFontSize(24);
    doc.text("INVOICE", 152, 34);
    doc.setFontSize(9.5);
    doc.setFont("helvetica", "normal");
    doc.text(`Invoice No: ${invoice.invoiceNumber}`, 152, 42);
    doc.text(`Issue Date: ${Utils.isoDate(dates.invoiceDate)}`, 152, 48);
    doc.text(`Due Date: ${Utils.isoDate(dates.dueDate)}`, 152, 54);
    doc.text(`Billing Month: ${Utils.displayMonth(dates.billingPeriod)}`, 152, 60);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text(settings.companyName, margin, 34);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    let y = lines(doc, settings.companyAddress, margin, 40, 72, 5);
    doc.text(settings.companyEmail, margin, y + 1);
    doc.text(settings.companyWebsite, margin, y + 6);

    doc.setDrawColor(229, 222, 241);
    doc.line(margin, 70, 192, 70);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("Bill To", margin, 82);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(invoice.partnerName, margin, 90);
    y = lines(doc, invoice.partnerAddress, margin, 96, 95, 5);
    doc.text(invoice.contactEmail, margin, y + 1);

    y = drawTableHeader(doc, 118, accent);
    doc.setTextColor(18, 18, 24);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);

    items.forEach((item, index) => {
      const descriptionLines = doc.splitTextToSize(item.description || item.billType || "Service", 64);
      const billTypeLines = doc.splitTextToSize(item.billType || "Service", 34);
      const rowHeight = Math.max(13, Math.max(descriptionLines.length, billTypeLines.length) * 4.2 + 5);

      if (y + rowHeight > 250) {
        doc.addPage();
        drawHeader(doc, settings, primary, doc.getNumberOfPages());
        y = drawTableHeader(doc, 30, accent);
        doc.setTextColor(18, 18, 24);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8.5);
      }

      if (index % 2 === 1) {
        doc.setFillColor(250, 247, 255);
        doc.rect(margin, y, 174, rowHeight, "F");
      }
      doc.setDrawColor(229, 222, 241);
      doc.rect(margin, y, 174, rowHeight);
      doc.text(descriptionLines, 22, y + 6);
      doc.text(billTypeLines, 91, y + 6);
      doc.text(String(item.quantity || 1), 134, y + 6);
      doc.text(money.format(item.unitPrice || item.amount), 147, y + 6);
      doc.text(money.format(item.amount), 174, y + 6);
      y += rowHeight;
    });

    const tax = invoice.amount * (Number(settings.taxRate) || 0);
    const total = invoice.amount + tax;
    if (y + 50 > 276) {
      doc.addPage();
      drawHeader(doc, settings, primary, doc.getNumberOfPages());
      y = 34;
    } else {
      y += 10;
    }

    const totalsX = 128;
    doc.setTextColor(18, 18, 24);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    doc.text("Subtotal", totalsX, y);
    doc.text(money.format(invoice.amount), 171, y);
    doc.text(`Tax (${Number(settings.taxRate || 0) * 100}%)`, totalsX, y + 8);
    doc.text(money.format(tax), 171, y + 8);
    doc.setDrawColor(primary[0], primary[1], primary[2]);
    doc.line(totalsX, y + 13, 192, y + 13);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text("Grand Total", totalsX, y + 22);
    doc.text(money.format(total), 169, y + 22);

    const bankY = Math.min(y + 46, 244);
    doc.setDrawColor(229, 222, 241);
    doc.line(margin, bankY - 8, 192, bankY - 8);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("Bank Details", margin, bankY);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    lines(doc, settings.bankDetails, margin, bankY + 7, 100, 5);
    doc.setTextColor(primary[0], primary[1], primary[2]);
    doc.setFont("helvetica", "bold");
    doc.text(settings.thankYouMessage || "Thank you for your business.", margin, 282);

    return doc;
  }

  function fileName(invoice) {
    return `Invoice_${invoice.invoiceNumber}_${Utils.safeFileName(invoice.partnerName)}.pdf`;
  }

  return { create, fileName };
})();
