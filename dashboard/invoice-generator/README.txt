NexBid Invoice Generator

Static browser-only page for nexbid.uk. No database or server is required.

Upload location suggestion:
/invoice-generator/

Files:
- index.html
- style.css
- config.js
- utils.js
- excel.js
- invoice.js
- script.js
- assets/

Workbook format:
- Sheet 1 named InvoiceData, with Sno, Partner Name, Amount, Payment Term, Bill Type
- Sheet 2 named Partners, with Partner Name, Partner Address, Contact Email

Notes:
- Invoice counter and settings are stored in browser localStorage.
- PDF and ZIP generation runs in the browser.
- External browser libraries are loaded from jsDelivr: SheetJS, jsPDF, and JSZip.
