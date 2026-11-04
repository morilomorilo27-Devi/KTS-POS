const d = require("../db");
const ExcelJS = require("exceljs");
const config = require("../config");
const fs = require("node:fs");
const path = require("node:path");
const shifts = require("./shiftService");
function daily(date = d.day()) {
  return d.all(
    "SELECT s.*,u.full_name cashier_name,(SELECT SUM(amount) FROM payments WHERE sale_id=s.id AND payment_method='cash') cash,(SELECT SUM(amount) FROM payments WHERE sale_id=s.id AND payment_method='knet') knet,(SELECT COALESCE(SUM(refund_total),0) FROM return_transactions WHERE sale_id=s.id) refunds FROM sales s JOIN users u ON u.id=s.user_id WHERE date(s.created_at,'+3 hours')=? ORDER BY s.created_at",
    date,
  );
}
function summary(from = d.day(), to = d.day()) {
  const range = [from, to];
  const totals = d.get(
    "SELECT COUNT(*) invoice_count,COALESCE(SUM(subtotal),0) subtotal,COALESCE(SUM(discount_total),0) discount_total,COALESCE(SUM(net_total),0) net_total FROM sales WHERE date(created_at,'+3 hours') BETWEEN ? AND ? AND status<>'voided'",
    ...range,
  );
  const refunds = d.get(
    "SELECT COALESCE(SUM(refund_total),0) n FROM return_transactions WHERE date(created_at,'+3 hours') BETWEEN ? AND ?",
    ...range,
  ).n;
  return {
    ...totals,
    refunds,
    net_after_refunds: d.money(totals.net_total - refunds),
    cashiers: d.all(
      "SELECT u.full_name,COUNT(*) invoice_count,SUM(s.net_total) net_total FROM sales s JOIN users u ON u.id=s.user_id WHERE date(s.created_at,'+3 hours') BETWEEN ? AND ? GROUP BY s.user_id",
      ...range,
    ),
    categories: d.all(
      "SELECT c.name_ar,SUM(l.qty) qty,SUM(l.line_total) net_total FROM sale_lines l JOIN sales s ON s.id=l.sale_id JOIN products p ON p.id=l.product_id JOIN product_categories c ON c.id=p.category_id WHERE date(s.created_at,'+3 hours') BETWEEN ? AND ? GROUP BY c.id",
      ...range,
    ),
    payments: d.all(
      "SELECT p.payment_method,SUM(p.amount-CASE WHEN p.payment_method='cash' THEN s.change_due ELSE 0 END) amount FROM payments p JOIN sales s ON s.id=p.sale_id WHERE date(s.created_at,'+3 hours') BETWEEN ? AND ? GROUP BY p.payment_method",
      ...range,
    ),
  };
}
function dashboard() {
  return {
    ...summary(),
    low_stock: d.get(
      "SELECT COUNT(*) n FROM products p LEFT JOIN inventory_balances b ON b.product_id=p.id WHERE p.status='active' AND COALESCE(b.qty_on_hand,0)<=p.min_stock_alert",
    ).n,
    open_shifts: d.get(
      "SELECT COUNT(*) n FROM cashier_shifts WHERE status='open'",
    ).n,
  };
}
function shiftReport(id) {
  const row = d.get(
    "SELECT s.*,u.full_name cashier_name FROM cashier_shifts s JOIN users u ON u.id=s.user_id WHERE s.id=?",
    id,
  );
  if (!row) d.fail("الوردية غير موجودة", 404);
  return {
    ...row,
    cash_refunds: shifts.cashRefunds(id),
    cash_outflows: d.get(
      "SELECT COALESCE(SUM(amount),0) n FROM shift_cash_movements WHERE shift_id=?",
      id,
    ).n,
    sales: d.all(
      "SELECT * FROM sales WHERE shift_id=? ORDER BY created_at",
      id,
    ),
    returns: d.all("SELECT * FROM return_transactions WHERE shift_id=?", id),
    report_type: row.status === "closed" ? "Z" : "X",
  };
}
async function excel(query, user) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "جمعية المعلمين الكويتية";
  const sheet = workbook.addWorksheet("تقرير المبيعات", {
    views: [{ rightToLeft: true }],
  });
  sheet.columns = [
    { width: 29 },
    { width: 28 },
    { width: 25 },
    { width: 18 },
    { width: 18 },
    { width: 18 },
    { width: 18 },
  ];
  sheet.mergeCells("A1:G1");
  sheet.getCell("A1").value = "جمعية المعلمين الكويتية — مكتبة القرطاسية";
  sheet.getCell("A1").font = {
    name: "Arial",
    size: 18,
    bold: true,
    color: { argb: "FF0F2238" },
  };
  sheet.getRow(1).height = 44;
  sheet.mergeCells("A2:G2");
  sheet.getCell("A2").value =
    query.type === "summary"
      ? "التقرير التجميعي للمبيعات"
      : "تقرير المبيعات اليومي";
  sheet.mergeCells("A3:G3");
  sheet.getCell("A3").value =
    `الفترة: ${query.date || query.from || d.day()} — ${query.to || query.date || d.day()} | المستخدم: ${user.full_name}`;
  sheet.mergeCells("A4:G4");
  sheet.getCell("A4").value =
    "تاريخ التصدير: " +
    new Date().toLocaleString("ar-KW", { timeZone: "Asia/Kuwait" });
  const logo = path.join(config.client, "images/logo.png");
  if (fs.existsSync(logo)) {
    const image = workbook.addImage({ filename: logo, extension: "png" });
    sheet.addImage(image, {
      tl: { col: 6, row: 0 },
      ext: { width: 55, height: 55 },
    });
  }
  let rows;
  if (query.type === "summary") {
    sheet.getRow(6).values = ["الكاشير", "عدد الفواتير", "صافي المبيعات"];
    rows = summary(query.from, query.to).cashiers.map((r) => [
      r.full_name,
      r.invoice_count,
      d.money(r.net_total),
    ]);
  } else {
    sheet.getRow(6).values = [
      "رقم الفاتورة",
      "الكاشير",
      "التاريخ",
      "المجموع",
      "الخصم",
      "الصافي",
      "المردودات",
    ];
    rows = daily(query.date).map((r) => [
      r.invoice_no,
      r.cashier_name,
      r.created_at,
      r.subtotal,
      r.discount_total,
      r.net_total,
      r.refunds,
    ]);
  }
  for (const row of rows) sheet.addRow(row);
  const end = 6 + rows.length;
  const total = sheet.getRow(end + 1);
  total.getCell(1).value = "الإجمالي";
  for (
    let col = query.type === "summary" ? 2 : 4;
    col <= (query.type === "summary" ? 3 : 7);
    col++
  )
    total.getCell(col).value = {
      formula: rows.length
        ? `SUM(${sheet.getColumn(col).letter}7:${sheet.getColumn(col).letter}${end})`
        : "0",
      result: rows.reduce((s, r) => s + Number(r[col - 1] || 0), 0),
    };
  sheet.eachRow((row, n) => {
    row.eachCell((cell) => {
      cell.alignment = {
        horizontal: typeof cell.value === "number" ? "left" : "right",
        vertical: "middle",
      };
      cell.border = { bottom: { style: "thin", color: { argb: "FFE4E3DE" } } };
      if (n >= 7 && cell.col >= (query.type === "summary" ? 3 : 4))
        cell.numFmt = '#,##0.000 "د.ك"';
    });
    if (n === 6) {
      row.height = 30;
      row.eachCell((c) => {
        c.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FF0F2238" },
        };
        c.font = { bold: true, color: { argb: "FFFFFFFF" } };
      });
    } else if (n === end + 1)
      row.eachCell((c) => {
        c.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFE7EAEB" },
        };
        c.font = { bold: true };
      });
  });
  sheet.autoFilter = { from: "A6", to: query.type === "summary" ? "C6" : "G6" };
  sheet.pageSetup = {
    orientation: "landscape",
    fitToPage: true,
    fitToWidth: 1,
  };
  return workbook.xlsx.writeBuffer();
}
module.exports = { daily, summary, dashboard, shiftReport, excel };
