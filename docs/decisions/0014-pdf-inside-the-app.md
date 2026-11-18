# 0014. The letter note is also a PDF made inside the app

Status: Accepted. Date: 2026-11-15.

Context: on iPhone Safari, printing stopped working until the page was reloaded (Safari blocks a page's print dialog after it is
cancelled a few times), and the owner asked for PDF files named after the customer, the folio and the delivery date. Before, a PDF was
only the browser's "Save as PDF", named after the page.
Decision: `js/pdf.js` writes the letter PDF itself, with no library (decision 0001): US Letter, the standard Helvetica fonts with
WinAnsiEncoding, black only, more pages when needed. The file is "cliente folio fecha.pdf" (`NT.logic.pdfFileName`). A "PDF" button
shares the file where the browser can (iPhone, Android: the share sheet offers Imprimir, Guardar en Archivos, WhatsApp) and downloads it
elsewhere. On iPhone and iPad, "Imprimir hoja" goes through the PDF. Browser printing keeps working elsewhere and sets the page title to
the file name while printing.
Consequences: printing on iPhone no longer depends on Safari's print dialog; files arrive named. The PDF shows letters that the standard
fonts have (Spanish included); others appear as "?" (LIM-008).
Enforced by: tests/pdf.test.js (TC-PDF-01-01 to 05) and tests/app_fixes.test.js (TC-PDF-02-01 to 03).
