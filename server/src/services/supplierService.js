const d = require("../db");
const audit = require("./auditService");
const inv = require("./inventoryService");
const acc = require("./accountingService");
d.db.exec(
  "CREATE TABLE IF NOT EXISTS product_suppliers(product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,supplier_id TEXT NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,PRIMARY KEY(product_id,supplier_id)); CREATE INDEX IF NOT EXISTS idx_product_suppliers_supplier ON product_suppliers(supplier_id);",
);
function list() {
  return d.all(
    `SELECT s.*,
      (SELECT COALESCE(SUM(total-paid_amount),0) FROM purchases WHERE supplier_id=s.id)
      +(SELECT COALESCE(SUM(total-paid_amount),0) FROM supplier_invoices WHERE supplier_id=s.id AND status!='pending')
      -(SELECT COALESCE(SUM(sp.amount),0) FROM supplier_payments sp
        WHERE sp.supplier_id=s.id AND NOT EXISTS(
          SELECT 1 FROM supplier_invoice_payment_allocations a WHERE a.supplier_payment_id=sp.id
        )) balance_due
     FROM suppliers s ORDER BY s.name`,
  );
}
function save(user, body, id) {
  return d.transaction(() => {
    const old = id ? d.get("SELECT * FROM suppliers WHERE id=?", id) : null;
    if (id && !old) d.fail("المورد غير موجود", 404);
    const data = Object.fromEntries(
      ["code", "name", "contact_person", "phone", "email", "address", "status"]
        .filter((k) => body[k] !== undefined)
        .map((k) => [k, body[k]]),
    );
    for (const k of ["code", "name"])
      if (!id || data[k] !== undefined) data[k] = d.required(data[k], k);
    const row = id
      ? d.update("suppliers", id, data)
      : d.insert("suppliers", { id: d.id(), ...data });
    audit.record(user, "supplier_save", "suppliers", row.id, old, row);
    return row;
  });
}
function purchase(user, body) {
  return d.transaction(() => {
    if (
      !d.get(
        "SELECT id FROM suppliers WHERE id=? AND status='active'",
        body.supplier_id,
      )
    )
      d.fail("المورد غير متاح");
    if (!body.items?.length) d.fail("أصناف التوريد مطلوبة");
    const items = body.items.map((i) => ({
      ...i,
      qty: d.number(i.qty, "الكمية", 0, true),
      unit_cost: d.money(d.number(i.unit_cost, "تكلفة الوحدة")),
    }));
    const total = d.money(
      items.reduce((s, i) => s + d.money(i.qty * i.unit_cost), 0),
    );
    if (total <= 0) d.fail("قيمة التوريد يجب أن تكون موجبة");
    const paid = d.money(d.number(body.paid_amount ?? 0, "المبلغ المدفوع"));
    if (paid > total) d.fail("الدفع يتجاوز قيمة التوريد");
    if (!["cash", "knet"].includes(body.payment_method))
      d.fail("طريقة الدفع غير صالحة");
    const row = d.insert("purchases", {
      id: d.id(),
      purchase_no: d.sequence("purchases", "purchase_no", "PUR"),
      supplier_id: body.supplier_id,
      total,
      paid_amount: paid,
      payment_method: body.payment_method,
      user_id: user.id,
      notes: body.notes || null,
    });
    for (const i of items) {
      const product = d.get("SELECT * FROM products WHERE id=?", i.product_id);
      if (!product) d.fail("الصنف غير موجود");
      const balance =
        d.get(
          "SELECT qty_on_hand FROM inventory_balances WHERE product_id=?",
          i.product_id,
        )?.qty_on_hand || 0;
      const cost = Number(
        (
          (balance * product.cost_price + i.qty * i.unit_cost) /
          (balance + i.qty)
        ).toFixed(6),
      );
      d.insert("purchase_lines", {
        id: d.id(),
        purchase_id: row.id,
        product_id: i.product_id,
        qty: i.qty,
        unit_cost: i.unit_cost,
        line_total: d.money(i.qty * i.unit_cost),
      });
      inv.move(user, i.product_id, i.qty, "purchase", row.id);
      d.update("products", i.product_id, { cost_price: cost });
      d.run(
        "INSERT OR IGNORE INTO product_suppliers VALUES(?,?)",
        i.product_id,
        body.supplier_id,
      );
    }
    acc.post(user, "purchase", row.id, row.purchase_no, [
      { account_code: "1200", debit: total },
      {
        account_code: body.payment_method === "cash" ? "1100" : "1110",
        credit: paid,
      },
      { account_code: "2100", credit: d.money(total - paid) },
    ]);
    if (body.payment_method === "cash")
      acc.drawerOutflow(user, paid, "purchase", row.id);
    audit.record(user, "purchase", "purchases", row.id, null, row);
    return row;
  });
}
function pay(user, body) {
  return d.transaction(() => {
    const supplier = list().find((s) => s.id === body.supplier_id);
    if (!supplier) d.fail("المورد غير موجود");
    const amount = d.money(d.number(body.amount, "مبلغ السداد", 0, true));
    if (amount > d.money(supplier.balance_due))
      d.fail("السداد يتجاوز رصيد المورد");
    if (!["cash", "knet"].includes(body.payment_method))
      d.fail("طريقة الدفع غير صالحة");
    const row = d.insert("supplier_payments", {
      id: d.id(),
      supplier_id: supplier.id,
      amount,
      payment_method: body.payment_method,
      user_id: user.id,
      notes: body.notes || null,
    });
    acc.post(user, "supplier_payment", row.id, "سداد " + supplier.name, [
      { account_code: "2100", debit: amount },
      {
        account_code: body.payment_method === "cash" ? "1100" : "1110",
        credit: amount,
      },
    ]);
    if (body.payment_method === "cash")
      acc.drawerOutflow(user, amount, "supplier_payment", row.id);
    audit.record(
      user,
      "supplier_payment",
      "supplier_payments",
      row.id,
      null,
      row,
    );
    return row;
  });
}
module.exports = {
  list,
  save,
  purchase,
  pay,
  purchases: () =>
    d.all(
      "SELECT p.*,s.name supplier_name FROM purchases p JOIN suppliers s ON s.id=p.supplier_id ORDER BY p.created_at DESC",
    ),
};
