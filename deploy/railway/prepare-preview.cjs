const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const ExcelJS = require("exceljs");

const root = path.resolve(__dirname, "../..");
const source = process.argv[2];
if (!source || path.extname(source).toLowerCase() !== ".xlsx")
  throw new Error("Pass the prepared demo product workbook (.xlsx).");
const work = path.join(root, ".artifact-work");
fs.mkdirSync(work, { recursive: true });
const stage = fs.mkdtempSync(path.join(work, "railway-preview-"));
process.env.KTS_DB_PATH = path.join(stage, "preview-seed.db");
const d = require("../../server/src/db");
const products = require("../../server/src/services/productService");

async function main() {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(source);
  const sheet = workbook.getWorksheet("products_import");
  assert.ok(sheet && sheet.rowCount === 16057, "Unexpected demo catalogue shape.");
  const allowed = new Set(["sku", "name_ar", "name_en", "category_id", "unit",
    "cost_price", "sale_price", "min_stock_alert", "is_discountable", "status",
    "barcodes", "initial_qty", "supplier_ids"]);
  const headers = sheet.getRow(1).values;
  assert.ok(headers.every((key) => allowed.has(key)), "Unexpected workbook column.");
  const suppliers = new Map();
  const user = { id: "usr-admin" };
  d.db.exec("PRAGMA synchronous=NORMAL");
  for (let n = 2; n <= sheet.rowCount; n++) {
    const row = sheet.getRow(n);
    const input = Object.fromEntries(headers.slice(1).map((header, i) => [header, row.getCell(i + 1).value ?? ""]));
    assert.match(input.sku, /^KTS-\d+$/);
    input.barcodes = String(input.barcodes).split("|").filter(Boolean);
    input.supplier_ids = (JSON.parse(input.supplier_ids || "[]")).map((original) => {
      if (!suppliers.has(original)) {
        const index = suppliers.size + 1;
        const id = "preview-supplier-" + index;
        d.insert("suppliers", { id, code: "DEMO-" + index, name: "مورد تجريبي " + index });
        suppliers.set(original, id);
      }
      return suppliers.get(original);
    });
    products.save(user, input);
  }
  d.run("UPDATE users SET status='inactive', password_hash=?, phone=NULL, email=NULL", "0".repeat(128));
  d.run("UPDATE users SET full_name=? WHERE id='usr-cashier-1'", "كاشير تجريبي");
  assert.equal(d.get("SELECT count(*) n FROM products").n, 16056);
  for (const table of ["members", "sales", "cashier_shifts"])
    assert.equal(d.get("SELECT count(*) n FROM " + table).n, 0);
  assert.equal(d.all("PRAGMA foreign_key_check").length, 0);
  assert.equal(d.get("PRAGMA integrity_check").integrity_check, "ok");
  d.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE");

  for (const name of ["package.json", "package-lock.json", "server/src", "client"]) {
    fs.cpSync(path.join(root, name), path.join(stage, name), {
      recursive: true,
      filter: (file) => file !== path.join(root, "client", "images", "uploads"),
    });
  }
  fs.copyFileSync(path.join(__dirname, "start-preview.cjs"), path.join(stage, "start-preview.cjs"));
  fs.writeFileSync(path.join(stage, "Dockerfile"), [
    "FROM node:22-bookworm-slim",
    "WORKDIR /app",
    "COPY package*.json ./",
    "RUN npm ci --omit=dev",
    "COPY server ./server",
    "COPY client ./client",
    "COPY start-preview.cjs preview-seed.db ./",
    "ENV NODE_ENV=production HOST=0.0.0.0 PORT=5000",
    'CMD ["node", "start-preview.cjs"]',
    "",
  ].join("\n"));
  fs.writeFileSync(path.join(stage, "railway.json"), JSON.stringify({
    build: { builder: "DOCKERFILE" },
    deploy: { healthcheckPath: "/api/health", healthcheckTimeout: 120, numReplicas: 1 },
  }, null, 2));
  console.log(JSON.stringify({ stage, products: 16056, demoSuppliers: suppliers.size }));
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(() => d.db.close());
