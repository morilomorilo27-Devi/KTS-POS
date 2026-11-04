const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const assert = require("node:assert/strict");
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "kts-performance-"));
process.env.KTS_DB_PATH = path.join(directory, "test.db");
const d = require("../server/src/db");
const products = require("../server/src/services/productService");
const members = require("../server/src/services/memberService");
try {
  d.transaction(() => {
    const p = d.db.prepare(
      "INSERT INTO products(id,sku,name_ar,category_id,sale_price) VALUES(?,?,?,?,?)",
    );
    const b = d.db.prepare(
      "INSERT INTO product_barcodes(id,product_id,barcode) VALUES(?,?,?)",
    );
    const i = d.db.prepare(
      "INSERT INTO inventory_balances(id,product_id,qty_on_hand) VALUES(?,?,?)",
    );
    for (let n = 0; n < 50000; n++) {
      p.run("p" + n, "SKU" + n, "منتج " + n, "cat-1", 1);
      b.run("b" + n, "p" + n, "628" + String(n).padStart(10, "0"));
      i.run("i" + n, "p" + n, 100);
    }
    const m = d.db.prepare(
      "INSERT INTO members(id,membership_no,civil_id,name,category_id,phone) VALUES(?,?,?,?,?,?)",
    );
    for (let n = 0; n < 100000; n++)
      m.run(
        "m" + n,
        "M" + n,
        String(n).padStart(12, "0"),
        "عضو " + n,
        "mcat-1",
        "9" + String(n).padStart(7, "0"),
      );
  });
  function measure(fn) {
    const samples = [];
    for (let i = 0; i < 500; i++) {
      const start = performance.now();
      fn(i);
      samples.push(performance.now() - start);
    }
    samples.sort((a, b) => a - b);
    return {
      median_ms: Number(samples[250].toFixed(3)),
      p95_ms: Number(samples[475].toFixed(3)),
      max_ms: Number(samples[499].toFixed(3)),
    };
  }
  const result = {
    products: 50000,
    members: 100000,
    barcode: measure((i) => {
      assert.equal(
        products.list({ q: "628" + String(i * 97).padStart(10, "0") })[0].id,
        "p" + i * 97,
      );
    }),
    membership: measure((i) => {
      assert.equal(members.list("M" + i * 197)[0].id, "m" + i * 197);
    }),
  };
  fs.mkdirSync(path.join(__dirname, "test-output"), { recursive: true });
  fs.writeFileSync(
    path.join(__dirname, "test-output/performance.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
  assert.ok(result.barcode.p95_ms < 3);
  assert.ok(result.membership.p95_ms < 1);
} finally {
  d.db.close();
  if (
    path.dirname(directory) === os.tmpdir() &&
    path.basename(directory).startsWith("kts-performance-")
  )
    fs.rmSync(directory, { recursive: true, force: true });
}
