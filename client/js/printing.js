window.Printing = {
  open(html, css, title = "طباعة", rollWidth = null) {
    const popup = window.open("", "_blank", "width=900,height=750");
    if (!popup) return UI.toast("اسمح بالنوافذ المنبثقة للطباعة", true);
    popup.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${UI.escape(title)}</title><style>*{box-sizing:border-box}body{margin:0;color:#111;background:white;font-family:Arial,'Segoe UI',sans-serif}svg{stroke:none!important;fill:none}svg rect,svg path{stroke:none!important}table{border-collapse:collapse;width:100%}th,td{padding:2mm 1mm;border-bottom:1px solid #ddd;text-align:right;font-variant-numeric:tabular-nums}img{object-fit:contain}p{margin:2mm 0}.ltr{direction:ltr;unicode-bidi:isolate;display:inline-block} ${css}</style></head><body>${html}</body></html>`);
    popup.document.close();
    (async () => {
      await popup.document.fonts.ready;
      await Promise.all([...popup.document.images].map(img => img.complete ? Promise.resolve() : new Promise(resolve => { img.onload = resolve; img.onerror = resolve; })));
      if (!rollWidth && title === "فاتورة البيع" && UI.$("receiptFormat")?.value !== "a4") rollWidth = Number(UI.$("receiptFormat")?.value || 80);
      if (rollWidth) {
        const height = Math.ceil(popup.document.body.getBoundingClientRect().height * 25.4 / 96) + 2;
        const style = popup.document.createElement("style");
        style.textContent = `@page{size:${rollWidth}mm ${Math.max(40,height)}mm;margin:0}`;
        popup.document.head.append(style);
      }
      popup.focus(); popup.print();
    })();
  },
  receipt() {
    const mode = UI.$("receiptFormat")?.value || "80";
    const width = mode === "a4" ? "190mm" : `${mode}mm`;
    this.open(UI.$("receiptPaper").outerHTML, `@page{size:${mode === "a4" ? "A4" : mode + "mm 300mm"};margin:${mode === "a4" ? "10mm" : "0"}}body{width:${width};direction:rtl}.receipt-paper{width:100%;padding:4mm;font-size:${mode === "58" ? "10" : "12"}px}header{text-align:center}header img{width:14mm;height:18mm}h2{font-size:15px;margin:2mm 0}.receipt-meta{font-size:11px;margin:4mm 0}.receipt-total{font-size:18px;font-weight:700}.barcode{width:100%;height:13mm;display:block}.receipt-verification{text-align:center;display:block;margin:4mm 0}.receipt-verification svg{display:block;width:25mm;height:25mm;margin:auto}.receipt-verification p{font-size:9px;overflow-wrap:anywhere}tr{break-inside:avoid}`, "فاتورة البيع");
  },
};
for (const button of document.querySelectorAll("#printReceipt")) {
  button.addEventListener("click", event => {
    if (POS.reprintMode) return;
    event.preventDefault(); event.stopImmediatePropagation(); Printing.receipt();
  }, true);
}
const format = document.createElement("label");
format.innerHTML = 'مقاس الطباعة <select id="receiptFormat"><option value="80">حراري 80 مم</option><option value="58">حراري 58 مم</option><option value="a4">ورق A4</option></select>';
UI.$("receiptModal").querySelector("footer").prepend(format);
