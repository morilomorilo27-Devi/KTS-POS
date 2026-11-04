const ExcelJS = require("exceljs");
const d = require("../db");
const products = require("./productService");
const members = require("./memberService");
const audit = require("./auditService");
const access = require("./permissionService");
function csv(text) {
  const rows = [];
  let row = [],
    value = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        value += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === "," && !quoted) {
      row.push(value);
      value = "";
    } else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(value);
      if (row.some(Boolean)) rows.push(row);
      row = [];
      value = "";
    } else value += c;
  }
  if (quoted) d.fail("ملف CSV غير مكتمل");
  row.push(value);
  if (row.some(Boolean)) rows.push(row);
  return rows;
}
async function read(buffer, name) {
  let rows;
  if (name.toLowerCase().endsWith(".xlsx")) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const ws = wb.worksheets[0];
    rows = [];
    ws.eachRow((r) =>
      rows.push(r.values.slice(1).map((v) => v?.text ?? v?.result ?? v ?? "")),
    );
  } else if (name.toLowerCase().endsWith(".csv"))
    rows = csv(buffer.toString("utf8").replace(/^\uFEFF/, ""));
  else d.fail("الملفات المدعومة CSV و XLSX");
  if (rows.length < 2) d.fail("الملف لا يحتوي بيانات");
  const headers = rows
    .shift()
    .map(String)
    .map((s) => s.trim());
  return rows.map((row) =>
    Object.fromEntries(headers.map((h, i) => [h, row[i] ?? ""])),
  );
}
async function importRows(user, kind, file) {
  if (!["products", "members"].includes(kind)) d.fail("نوع استيراد غير صالح");
  if (!file) d.fail("ملف الاستيراد مطلوب");
  const rows = await read(file.buffer, file.originalname);
  const errors = [];
  let imported = 0;
  for (const [index, row] of rows.entries()) {
    if (index % 25 === 0) await new Promise((resolve) => setImmediate(resolve));
    try {
      if (kind === "products") {
        if (typeof row.barcodes === "string")
          row.barcodes = row.barcodes.split("|").filter(Boolean);
        const old = d.get("SELECT id FROM products WHERE sku=?", row.sku);
        access.assertAllowed(user,old ? "products_update" : "products_create");
        products.save(user, row, old?.id);
      } else {
        const old = d.get(
          "SELECT id FROM members WHERE membership_no=?",
          row.membership_no,
        );
        access.assertAllowed(user,old ? "members_update" : "members_create");
        members.save(user, row, old?.id);
      }
      imported++;
    } catch (e) {
      errors.push({ row: index + 2, error: e.message });
    }
  }
  const result = { total: rows.length, imported, errors };
  audit.record(user, "data_import", kind, d.id(), null, { file: file.originalname, total: result.total, imported, failed: errors.length });
  return result;
}
module.exports = { importRows, csv };
