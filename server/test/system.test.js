const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "kts-test-"));
process.env.KTS_DB_PATH = path.join(directory, "test.db");
process.env.KTS_BACKUP_DIR = path.join(directory, "backups");
const app = require("../src/app");
const d = require("../src/db");
const ExcelJS = require("exceljs");
let server, base, admin, cashier, product, member, shift, sale;
async function request(url, method = "GET", body, token = admin) {
  const r = await fetch(base + "/api" + url, {
    method,
    headers: {
      ...(token ? { Authorization: "Bearer " + token } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json();
  return { status: r.status, data };
}
test.before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = "http://127.0.0.1:" + server.address().port;
});
test.after(async () => {
  await new Promise((r) => server.close(r));
  d.db.close();
  if (
    path.dirname(directory) === os.tmpdir() &&
    path.basename(directory).startsWith("kts-test-")
  )
    fs.rmSync(directory, { recursive: true, force: true });
});
test("documented accounts, roles, and permission isolation", async () => {
  let r = await request(
    "/auth/login",
    "POST",
    { username: "admin", password: "admin123" },
    null,
  );
  assert.equal(r.status, 200);
  admin = r.data.token;
  assert.equal(r.data.user.role, "ADMIN");
  r = await request(
    "/auth/login",
    "POST",
    { username: "cashier1", password: "cashier123" },
    null,
  );
  assert.equal(r.status, 200);
  cashier = r.data.token;
  assert.equal(r.data.user.role, "CASHIER");
  assert.equal((await request("/products", "POST", {}, cashier)).status, 403);
  assert.equal(
    (await request("/reports/dashboard", "GET", null, cashier)).status,
    403,
  );
  assert.equal(
    (await request("/products/search", "GET", null, null)).status,
    401,
  );
  assert.equal(
    (
      await request(
        "/auth/login",
        "POST",
        { username: "admin", password: "bad" },
        null,
      )
    ).status,
    401,
  );
});
test("original schema, seed categories, indexes and WAL", async () => {
  assert.equal(d.get("PRAGMA journal_mode").journal_mode, "wal");
  assert.equal(d.get("PRAGMA foreign_keys").foreign_keys, 1);
  assert.equal((await request("/categories")).data.length, 5);
  assert.equal((await request("/membership-categories")).data.length, 4);
  assert.ok(
    d.get(
      "SELECT name FROM sqlite_master WHERE name='idx_product_barcodes_code'",
    ),
  );
  assert.ok(
    d.get(
      "SELECT name FROM sqlite_master WHERE name='idx_product_suppliers_supplier'",
    ),
  );
});

test("document sequences continue safely beyond four digits", () => {
  d.db.exec(
    "CREATE TABLE sequence_probe(value TEXT UNIQUE NOT NULL); DELETE FROM sequence_probe;",
  );
  const base = `SEQ-${d.day().replaceAll("-", "")}-`;
  d.run("INSERT INTO sequence_probe(value) VALUES(?)", base + "9999");
  d.run("INSERT INTO sequence_probe(value) VALUES(?)", base + "10000");
  assert.equal(d.sequence("sequence_probe", "value", "SEQ"), base + "10001");
});

test("journal uses bounded pages with their original lines", async () => {
  const accounting = require("../src/services/accountingService");
  for(let i=0;i<3;i++) accounting.post({id:"usr-admin"},"page_test",String(i),"قيد اختبار",[{account_code:"1100",debit:1},{account_code:"3100",credit:1}]);
  const first=accounting.entries({page:1,limit:2});
  const second=accounting.entries({page:2,limit:2});
  assert.equal(first.rows.length,2);
  assert.equal(first.total,3);
  assert.equal(second.rows.length,1);
  assert.ok(!first.rows.some(row=>row.id===second.rows[0].id));
  assert.equal(first.rows[0].lines.length,2);
});
test("catalog multiple barcodes, member, opening stock and shift constraints", async () => {
  let r = await request("/products", "POST", {
    sku: "NB-A4",
    name_ar: "دفتر اختبار",
    category_id: "cat-3",
    sale_price: 1.25,
    cost_price: 0.5,
    min_stock_alert: 5,
    initial_qty: 20,
    barcodes: ["6280001", "6280002"],
  });
  assert.equal(r.status, 200);
  product = r.data;
  r = await request("/products/search?q=6280002");
  assert.equal(r.data[0].id, product.id);
  r = await request("/members", "POST", {
    membership_no: "KTS-TEST",
    civil_id: "285010101234",
    name: "عضو اختبار",
    category_id: "mcat-1",
    phone: "99887766",
  });
  assert.equal(r.status, 201);
  member = r.data;
  r = await request("/shifts/open", "POST", { opening_cash: 50 }, cashier);
  assert.equal(r.status, 201);
  shift = r.data;
  assert.equal(
    (await request("/shifts/open", "POST", { opening_cash: 1 }, cashier))
      .status,
    400,
  );
  assert.equal(
    (await request("/members/search-pos?q=99887766", "GET", null, cashier))
      .data[0].id,
    member.id,
  );
});
test("server prices, explicit discounts, scope, eligibility and ceiling", async () => {
  const items = [{ product_id: product.id, qty: 2, unit_price: 0.001 }];
  let r = await request(
    "/discounts/calculate-cart",
    "POST",
    { items, member_id: member.id },
    cashier,
  );
  assert.equal(r.data.net_total, 2.5);
  r = await request(
    "/discounts/calculate-cart",
    "POST",
    { items, member_id: member.id, selected_discount_rule_id: "disc-1" },
    cashier,
  );
  assert.equal(r.data.discount_total, 0.375);
  assert.equal(r.data.net_total, 2.125);
  assert.equal(
    (
      await request(
        "/discounts/calculate-cart",
        "POST",
        { items, member_id: member.id, selected_discount_rule_id: "disc-2" },
        cashier,
      )
    ).status,
    400,
  );
  await request("/products/" + product.id, "PUT", { is_discountable: 0 });
  r = await request(
    "/discounts/calculate-cart",
    "POST",
    { items, member_id: member.id, selected_discount_rule_id: "disc-1" },
    cashier,
  );
  assert.equal(r.data.discount_total, 0);
  await request("/products/" + product.id, "PUT", { is_discountable: 1 });
  r = await request("/discounts", "POST", {
    code: "CAP",
    name_ar: "خصم ثابت بسقف",
    type: "fixed_amount",
    value: 1,
    scope: "all",
    max_discount: 0.2,
  });
  assert.equal(r.status, 200);
  const cap = r.data.id;
  r = await request(
    "/discounts/calculate-cart",
    "POST",
    { items, member_id: member.id, selected_discount_rule_id: cap },
    cashier,
  );
  assert.equal(r.data.discount_total, 0.2);
  await request("/members/" + member.id, "PUT", { status: "suspended" });
  assert.equal(
    (
      await request(
        "/discounts/calculate-cart",
        "POST",
        { items, member_id: member.id, selected_discount_rule_id: "disc-1" },
        cashier,
      )
    ).status,
    400,
  );
  await request("/members/" + member.id, "PUT", { status: "active" });
});
test("atomic checkout, split validation, idempotency and journal balance", async () => {
  const body = {
    client_transaction_id: "test-sale-1",
    shift_id: shift.id,
    member_id: member.id,
    selected_discount_rule_id: "disc-1",
    items: [{ product_id: product.id, qty: 2, unit_price: 999 }],
    payments: [
      { payment_method: "cash", amount: 1 },
      { payment_method: "knet", amount: 1.125 },
    ],
    paid_amount: 2.125,
  };
  let r = await request(
    "/pos/checkout",
    "POST",
    {
      ...body,
      payments: [
        { payment_method: "cash", amount: 1 },
        { payment_method: "knet", amount: 1 },
      ],
    },
    cashier,
  );
  assert.equal(r.status, 400);
  assert.equal(
    d.get(
      "SELECT qty_on_hand FROM inventory_balances WHERE product_id=?",
      product.id,
    ).qty_on_hand,
    20,
  );
  r = await request("/pos/checkout", "POST", body, cashier);
  assert.equal(r.status, 201);
  sale = r.data.invoice;
  assert.equal(sale.net_total, 2.125);
  assert.match(sale.invoice_no, /^INV-\d{8}-0001$/);
  r = await request("/pos/checkout", "POST", body, cashier);
  assert.equal(r.data.invoice.id, sale.id);
  assert.equal(d.get("SELECT COUNT(*) n FROM sales").n, 1);
  assert.equal(
    d.get(
      "SELECT qty_on_hand FROM inventory_balances WHERE product_id=?",
      product.id,
    ).qty_on_hand,
    18,
  );
  const sums = d.get(
    "SELECT SUM(debit) debit,SUM(credit) credit FROM journal_lines",
  );
  assert.equal(sums.debit, sums.credit);
  assert.equal(
    d.get("SELECT total_cash_sales FROM cashier_shifts WHERE id=?", shift.id)
      .total_cash_sales,
    1,
  );
  assert.equal(
    d.get(
      "SELECT COUNT(*) n FROM inventory_movements WHERE movement_type='sale'",
    ).n,
    1,
  );
});
test("insufficient stock and unauthorized shift roll back all effects", async () => {
  const body = {
    client_transaction_id: "invalid-stock",
    shift_id: shift.id,
    items: [{ product_id: product.id, qty: 100 }],
    payments: [{ payment_method: "cash", amount: 125 }],
  };
  assert.equal(
    (await request("/pos/checkout", "POST", body, cashier)).status,
    400,
  );
  assert.equal(
    (
      await request(
        "/pos/checkout",
        "POST",
        { ...body, items: [{ product_id: product.id, qty: 1 }] },
        admin,
      )
    ).status,
    400,
  );
  assert.equal(d.get("SELECT COUNT(*) n FROM sales").n, 1);
});
test("held carts scoped to owner and current shift", async () => {
  let r = await request(
    "/pos/hold-cart",
    "POST",
    { shift_id: shift.id, items: [{ product_id: product.id, qty: 1 }], member },
    cashier,
  );
  assert.equal(r.status, 200);
  r = await request("/pos/held-carts", "GET", null, cashier);
  assert.equal(r.data.length, 1);
  const id = r.data[0].id;
  assert.equal(
    (await request("/pos/held-carts/" + id, "DELETE", null, admin)).status,
    404,
  );
  assert.equal(
    (await request("/pos/held-carts/" + id, "DELETE", null, cashier)).data
      .payload.items[0].qty,
    1,
  );
  assert.equal(
    (await request("/pos/held-carts", "GET", null, cashier)).data.length,
    0,
  );
});
test("partial and damaged returns, refund uses original price, no excess returns", async () => {
  const line = sale.items[0];
  await request("/products/" + product.id, "PUT", {
    sale_price: 5,
    cost_price: 3,
  });
  let r = await request(
    "/returns",
    "POST",
    {
      sale_id: sale.id,
      shift_id: shift.id,
      reason: "تجربة",
      items: [
        {
          sale_line_id: line.id,
          product_id: product.id,
          qty: 1,
          item_condition: "good",
          refund_amount: 1000,
        },
      ],
    },
    cashier,
  );
  assert.equal(r.status, 201);
  assert.equal(r.data.refund_total, 1.063);
  assert.equal(
    d.get(
      "SELECT qty_on_hand FROM inventory_balances WHERE product_id=?",
      product.id,
    ).qty_on_hand,
    19,
  );
  assert.equal(
    (
      await request(
        "/returns/verify-invoice/" + sale.invoice_no,
        "GET",
        null,
        cashier,
      )
    ).data.items[0].remaining_qty,
    1,
  );
  r = await request(
    "/returns",
    "POST",
    {
      sale_id: sale.id,
      shift_id: shift.id,
      reason: "تالف",
      items: [{ sale_line_id: line.id, qty: 1, item_condition: "damaged" }],
    },
    cashier,
  );
  assert.equal(r.status, 201);
  assert.equal(r.data.refund_total, 1.062);
  assert.equal(
    d.get(
      "SELECT qty_on_hand FROM inventory_balances WHERE product_id=?",
      product.id,
    ).qty_on_hand,
    19,
  );
  assert.equal(
    d.get("SELECT status FROM sales WHERE id=?", sale.id).status,
    "refunded",
  );
  assert.equal(
    (
      await request(
        "/returns",
        "POST",
        {
          sale_id: sale.id,
          shift_id: shift.id,
          reason: "تكرار",
          items: [{ sale_line_id: line.id, qty: 1, item_condition: "good" }],
        },
        cashier,
      )
    ).status,
    400,
  );
  assert.equal(
    d.money(d.get("SELECT SUM(debit-credit) n FROM journal_lines").n),
    0,
  );
});
test("close shift reconciles cash refunds, rejects further sale", async () => {
  const valuation = d.get(
    "SELECT SUM(b.qty_on_hand*p.cost_price) n FROM inventory_balances b JOIN products p ON p.id=b.product_id",
  ).n;
  const book = d.get(
    "SELECT SUM(debit-credit) n FROM journal_lines WHERE account_code='1200'",
  ).n;
  assert.equal(d.money(valuation), d.money(book));
  assert.equal(
    d.get(
      "SELECT SUM(amount) n FROM return_refund_payments WHERE payment_method='cash'",
    ).n,
    1,
  );
  const expected = d.money(
    50 + 1 - require("../src/services/shiftService").cashRefunds(shift.id),
  );
  const r = await request(
    "/shifts/close",
    "POST",
    { actual_cash: expected },
    cashier,
  );
  assert.equal(r.status, 200);
  assert.equal(r.data.discrepancy, 0);
  assert.equal(r.data.status, "closed");
  assert.equal(
    (
      await request(
        "/pos/checkout",
        "POST",
        {
          client_transaction_id: "closed",
          items: [{ product_id: product.id, qty: 1 }],
          payments: [{ payment_method: "cash", amount: 5 }],
        },
        cashier,
      )
    ).status,
    400,
  );
});
test("supplier purchase, weighted cost, liability and settlement", async () => {
  let r = await request("/suppliers", "POST", {
    code: "SUP-1",
    name: "مورد اختبار",
  });
  const sup = r.data;
  r = await request("/suppliers", "POST", {
    code: "SUP-2",
    name: "مورد بديل",
  });
  const alternative = r.data;
  r = await request("/products/" + product.id, "PUT", {
    name_ar: product.name_ar,
    supplier_ids: [sup.id, alternative.id, sup.id],
  });
  assert.deepEqual(r.data.supplier_ids.sort(), [sup.id, alternative.id].sort());
  r = await request("/products/" + product.id);
  assert.equal(r.data.suppliers.length, 2);
  assert.ok(r.data.supplier_names.includes("مورد اختبار"));
  assert.ok(r.data.supplier_names.includes("مورد بديل"));
  assert.equal(
    (await request("/suppliers/" + alternative.id + "/products")).data[0].id,
    product.id,
  );
  assert.equal(
    (
      await request("/products/" + product.id, "PUT", {
        name_ar: product.name_ar,
        supplier_ids: ["missing-supplier"],
      })
    ).status,
    400,
  );
  assert.equal(
    (await request("/products/" + product.id)).data.suppliers.length,
    2,
  );
  r = await request("/products/" + product.id, "PUT", {
    name_ar: product.name_ar,
    supplier_ids: [],
  });
  assert.equal(r.data.suppliers.length, 0);
  r = await request("/purchases", "POST", {
    supplier_id: sup.id,
    paid_amount: 1,
    payment_method: "knet",
    items: [{ product_id: product.id, qty: 2, unit_cost: 1 }],
  });
  assert.equal(r.status, 201);
  assert.equal(
    (await request("/products/" + product.id)).data.supplier_ids[0],
    sup.id,
  );
  assert.equal((await request("/suppliers")).data[0].balance_due, 1);
  assert.equal(
    d.get(
      "SELECT qty_on_hand FROM inventory_balances WHERE product_id=?",
      product.id,
    ).qty_on_hand,
    21,
  );
  assert.equal(
    (
      await request("/suppliers/payments", "POST", {
        supplier_id: sup.id,
        amount: 2,
        payment_method: "cash",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request("/suppliers/payments", "POST", {
        supplier_id: sup.id,
        amount: 1,
        payment_method: "knet",
      })
    ).status,
    200,
  );
  assert.equal((await request("/suppliers")).data[0].balance_due, 0);
  assert.equal(
    d.money(d.get("SELECT SUM(debit-credit) n FROM journal_lines").n),
    0,
  );
});
test("inventory adjustment is ledgered, balanced and negative balance rejected", async () => {
  let r = await request("/inventory/adjust", "POST", {
    product_id: product.id,
    movement_type: "adjustment",
    qty_change: -1,
    notes: "جرد",
  });
  assert.equal(r.status, 200);
  assert.equal(
    (
      await request("/inventory/adjust", "POST", {
        product_id: product.id,
        movement_type: "adjustment",
        qty_change: -100,
        notes: "جرد",
      })
    ).status,
    400,
  );
  assert.equal(
    d.money(d.get("SELECT SUM(debit-credit) n FROM journal_lines").n),
    0,
  );
});
test("audit and journal cannot be changed or deleted", () => {
  assert.throws(() => d.run("DELETE FROM audit_logs"), /immutable/);
  assert.throws(
    () => d.run("UPDATE audit_logs SET action='changed'"),
    /immutable/,
  );
  assert.throws(() => d.run("DELETE FROM journal_entries"), /immutable/);
  assert.throws(() => d.run("UPDATE journal_lines SET debit=0"), /immutable/);
});
test("Excel RTL, official formatting and SUM formula, reports", async () => {
  const response = await fetch(
    base + "/api/reports/export-excel?type=daily&date=" + d.day(),
    { headers: { Authorization: "Bearer " + admin } },
  );
  assert.equal(response.status, 200);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(await response.arrayBuffer()));
  const sheet = wb.worksheets[0];
  assert.equal(sheet.views[0].rightToLeft, true);
  assert.equal(sheet.getCell("D7").numFmt, '#,##0.000 "د.ك"');
  assert.match(sheet.getCell("D8").value.formula, /SUM/);
  const r = await request(
    "/reports/sales-summary?from=" + d.day() + "&to=" + d.day(),
  );
  assert.equal(r.data.invoice_count, 1);
  assert.equal(r.data.net_after_refunds, 0);
});
test("sync replays same UUID once and returns actionable rejection per transaction", async () => {
  await request("/shifts/open", "POST", { opening_cash: 0 }, cashier);
  const current = (await request("/shifts/current", "GET", null, cashier)).data;
  const transaction = {
    client_transaction_id: "sync-1",
    shift_id: current.id,
    items: [{ product_id: product.id, qty: 1 }],
    payments: [{ payment_method: "cash", amount: 5 }],
  };
  let r = await request(
    "/sync/upload",
    "POST",
    {
      transactions: [
        transaction,
        transaction,
        {
          ...transaction,
          client_transaction_id: "sync-bad",
          items: [{ product_id: product.id, qty: 10000 }],
        },
      ],
    },
    cashier,
  );
  assert.equal(r.data.results[0].success, true);
  assert.equal(r.data.results[1].invoice.id, r.data.results[0].invoice.id);
  assert.equal(r.data.results[2].success, false);
  assert.equal(
    d.get("SELECT COUNT(*) n FROM sales WHERE client_transaction_id='sync-1'")
      .n,
    1,
  );
});
test("CSV quoting and import errors retain explicit row numbers", async () => {
  const importer = require("../src/services/importService");
  assert.deepEqual(importer.csv('a,b\r\n"x,y","a""b"\r\n'), [
    ["a", "b"],
    ["x,y", 'a"b'],
  ]);
  const form = new FormData();
  form.append(
    "file",
    new Blob([
      "membership_no,civil_id,name,category_id\nIM-1,111111111111,عضو مستورد,mcat-1\nIM-2,111111111111,مكرر,mcat-1",
    ]),
    "members.csv",
  );
  const r = await fetch(base + "/api/import/members", {
    method: "POST",
    headers: { Authorization: "Bearer " + admin },
    body: form,
  });
  const data = await r.json();
  assert.equal(data.imported, 1);
  assert.equal(data.errors[0].row, 3);
});

test("smart reorder and the professional purchasing cycle are fully linked", async () => {
  let response = await request("/suppliers", "POST", {
    code: "SUP-PRO",
    name: "مورد الدورة الاحترافية",
  });
  const professionalSupplier = response.data;
  response = await request("/products", "POST", {
    sku: "REORDER-1",
    name_ar: "صنف إعادة الطلب",
    category_id: "cat-1",
    sale_price: 3,
    cost_price: 2,
    min_stock_alert: 10,
    initial_qty: 2,
    supplier_ids: [professionalSupplier.id],
    barcodes: ["629999100001"],
  });
  const reorderProduct = response.data;
  const suggestions = (await request("/reorder-suggestions")).data;
  const suggestion = suggestions.find((row) => row.id === reorderProduct.id);
  assert.ok(suggestion);
  assert.equal(suggestion.qty_on_hand, 2);
  assert.equal(suggestion.safety_stock, 10);
  assert.equal(suggestion.suggested_order_qty, 8);
  response = await request("/reorder-suggestions/create-orders", "POST", {
    items: [{ product_id: reorderProduct.id }],
  });
  assert.equal(response.status, 200);
  assert.equal(response.data[0].status, "sent");

  response = await request("/procurement/requests", "POST", {
    notes: "احتياج داخلي",
    items: [
      {
        product_id: reorderProduct.id,
        qty: 8,
        supplier_id: professionalSupplier.id,
        reason: "وصول المخزون إلى نقطة الطلب",
      },
    ],
  });
  const purchaseRequest = response.data;
  assert.equal(purchaseRequest.status, "draft");
  assert.equal(
    (await request(`/procurement/requests/${purchaseRequest.id}/approve`, "POST", {}))
      .data.status,
    "approved",
  );
  response = await request("/procurement/quotes", "POST", {
    request_id: purchaseRequest.id,
    supplier_id: professionalSupplier.id,
    lead_time_days: 4,
    items: [{ product_id: reorderProduct.id, qty: 8, unit_cost: 2 }],
  });
  const quote = response.data;
  assert.equal((await request(`/procurement/quotes?request_id=${purchaseRequest.id}`)).data.length, 1);
  response = await request(`/procurement/quotes/${quote.id}/create-order`, "POST", {});
  let order = response.data;
  assert.equal(order.status, "sent");
  assert.equal(
    (await request(`/procurement/quotes?request_id=${purchaseRequest.id}`)).data[0].status,
    "selected",
  );
  const orderLine = order.lines[0];
  response = await request(`/purchase-orders/${order.id}/receive`, "POST", {
    items: [
      {
        order_line_id: orderLine.id,
        accepted_qty: 6,
        damaged_qty: 1,
        short_qty: 1,
        notes: "قطعة تالفة وقطعة ناقصة",
      },
    ],
  });
  assert.equal(response.data.order.status, "partial");
  response = await request(`/purchase-orders/${order.id}/receive`, "POST", {
    items: [{ order_line_id: orderLine.id, accepted_qty: 2 }],
  });
  assert.equal(response.data.order.status, "received");
  assert.equal(
    d.get("SELECT qty_on_hand FROM inventory_balances WHERE product_id=?", reorderProduct.id)
      .qty_on_hand,
    10,
  );
  const terms = d.get(
    "SELECT * FROM supplier_product_terms WHERE product_id=? AND supplier_id=?",
    reorderProduct.id,
    professionalSupplier.id,
  );
  assert.equal(terms.deliveries_total, 2);
  assert.equal(terms.last_unit_cost, 2);

  response = await request("/supplier-invoices", "POST", {
    order_id: order.id,
    invoice_no: "SUP-INV-001",
    items: [{ order_line_id: orderLine.id, qty: 8, unit_cost: 2 }],
  });
  const supplierInvoice = response.data;
  assert.equal(supplierInvoice.match_status, "matched");
  assert.equal(
    (await request(`/supplier-invoices/${supplierInvoice.id}/approve`, "POST", {})).data
      .status,
    "approved",
  );
  response = await request(`/supplier-invoices/${supplierInvoice.id}/pay`, "POST", {
    amount: 16,
    payment_method: "knet",
  });
  assert.equal(response.data.status, "paid");
  const supplierAfterPayment = (await request("/suppliers")).data.find(
    (row) => row.id === professionalSupplier.id,
  );
  assert.equal(supplierAfterPayment.balance_due, 0);
});

test("directed ABC counting requires reasons and posts approved adjustments", async () => {
  const generated = (await request("/cycle-counts", "POST", { limit: 5 })).data;
  assert.ok(generated.lines.length > 0);
  assert.ok(generated.lines.every((line) => ["A", "B", "C"].includes(line.abc_class)));
  const changed = generated.lines[0];
  assert.equal(
    (
      await request(`/cycle-counts/${generated.id}/count`, "POST", {
        product_id: changed.product_id,
        counted_qty: changed.expected_qty - 1,
      })
    ).status,
    400,
  );
  for (const [index, line] of generated.lines.entries())
    await request(`/cycle-counts/${generated.id}/count`, "POST", {
      barcode: line.barcodes?.split(" | ")[0] || undefined,
      product_id: line.product_id,
      counted_qty: index ? line.expected_qty : line.expected_qty - 1,
      reason: index ? undefined : "فرق عد فعلي",
    });
  const completed = (await request(`/cycle-counts/${generated.id}/complete`, "POST", {}))
    .data;
  assert.equal(completed.status, "completed");
  assert.ok(
    d.get(
      "SELECT 1 FROM journal_entries WHERE reference_type='cycle_count_adjustment' LIMIT 1",
    ),
  );
});

test("membership benefits affect checkout while cashier data stays minimal", async () => {
  let response = await request(`/members/${member.id}/profile`, "PUT", {
    expiry_date: "2099-12-31",
    purchase_limit: 100,
    receipt_consent: 1,
    preferred_channel: "email",
  });
  assert.equal(response.data.purchase_limit, 100);
  await request(`/members/${member.id}/dependents`, "POST", {
    name: "تابع اختبار",
    relationship: "ابن",
  });
  await request(`/members/${member.id}/wallet`, "POST", {
    amount: 1,
    notes: "رصيد تجريبي",
  });
  await request("/member-vouchers", "POST", {
    member_id: member.id,
    code: "MEMBER500",
    value: 0.5,
    expires_at: "2099-12-31",
  });
  await request("/member-special-prices", "POST", {
    membership_category_id: member.category_id,
    product_id: product.id,
    special_price: 4,
  });
  const posMember = (await request(`/members/search-pos?q=${member.membership_no}`, "GET", null, cashier))
    .data[0];
  assert.equal(posMember.civil_id, undefined);
  assert.equal(posMember.phone, undefined);
  response = await request(
    "/discounts/calculate-cart",
    "POST",
    {
      member_id: member.id,
      items: [{ product_id: product.id, qty: 1 }],
      voucher_code: "MEMBER500",
      wallet_amount: 0.5,
    },
    cashier,
  );
  assert.equal(response.data.net_total, 3);
  const activeShift = (await request("/shifts/current", "GET", null, cashier)).data;
  response = await request(
    "/pos/checkout",
    "POST",
    {
      client_transaction_id: "membership-benefits-sale",
      shift_id: activeShift.id,
      member_id: member.id,
      items: [{ product_id: product.id, qty: 1 }],
      voucher_code: "MEMBER500",
      wallet_amount: 0.5,
      payments: [{ payment_method: "cash", amount: 3 }],
    },
    cashier,
  );
  assert.equal(response.status, 201);
  assert.equal(d.get("SELECT balance FROM member_wallets WHERE member_id=?", member.id).balance, 0.5);
  assert.equal(
    d.get("SELECT status FROM member_vouchers WHERE code='MEMBER500'").status,
    "used",
  );
});

test("cashier accelerators, devices, electronic receipt and encrypted backup work", async () => {
  let response = await request(`/pos/favorites/${product.id}`, "POST", {}, cashier);
  assert.equal(response.data.favorite, true);
  assert.ok((await request("/pos/favorites", "GET", null, cashier)).data.some((row) => row.id === product.id));
  const last = (await request("/pos/last-invoice", "GET", null, cashier)).data;
  assert.equal(
    (await request(`/pos/invoices/${last.id}/reprint`, "POST", { reason: "نسخة للعضو" }, cashier))
      .data.id,
    last.id,
  );
  response = await request("/devices/label_printer", "PUT", {
    status: "active",
    adapter: "browser",
    configuration: { width_mm: 50 },
  });
  assert.equal(response.data.status, "active");
  assert.equal(
    (
      await request("/devices/label-print", "POST", {
        items: [{ product_id: product.id, copies: 2 }],
      })
    ).data.queued,
    true,
  );
  await request("/devices/knet", "PUT", { status: "active", adapter: "simulator" });
  response = await request(
    "/devices/knet/charge",
    "POST",
    { amount: 1.25, client_reference: "knet-integration-test" },
    cashier,
  );
  assert.equal(response.data.status, "approved");
  response = await request("/devices/scale/parse", "POST", {
    barcode: "201234500750",
  }, cashier);
  assert.equal(response.data.weighted, true);
  assert.equal(response.data.sku, "12345");
  assert.equal(response.data.weight, 0.75);

  response = await request(`/receipts/${last.id}/electronic`, "GET", null, cashier);
  assert.match(response.data.qr_svg, /^<svg/);
  assert.match(response.data.verification_value, /\/r\/[A-F0-9]{12}$/);
  const token = response.data.verification_token;
  const verified = await fetch(`${base}/api/public/receipts/${token}`).then((result) => result.json());
  assert.equal(verified.invoice_no, last.invoice_no);
  assert.equal((await fetch(`${base}/r/${token}`)).status, 200);
  response = await request(
    `/receipts/${last.id}/deliver`,
    "POST",
    { channel: "email", destination: "member@example.test", consent: true },
    cashier,
  );
  assert.equal(response.data.delivery_status, "queued");
  assert.equal(
    d.get("SELECT status FROM device_jobs WHERE id=?", response.data.job_id).status,
    "queued",
  );

  response = await request("/backups", "POST", {});
  assert.equal(response.data.integrity_status, "valid");
  const backupId = response.data.id;
  assert.equal((await request(`/backups/${backupId}/verify`, "POST", {})).data.valid, true);
  assert.equal((await request(`/backups/${backupId}/dry-run`, "POST", {})).data.valid, true);
  assert.equal(
    d.get("SELECT COUNT(*) n FROM backup_restore_tests WHERE backup_id=?", backupId).n,
    1,
  );
  assert.equal((await request("/backups/health")).data.healthy, true);
  assert.ok((await request("/exceptions")).data.alerts.length > 0);
  assert.equal(
    d.money(d.get("SELECT SUM(debit-credit) n FROM journal_lines").n),
    0,
  );
});
