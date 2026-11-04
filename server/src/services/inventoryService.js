const d = require("../db");
const audit = require("./auditService");
function move(
  user,
  product_id,
  qty_change,
  movement_type,
  reference_id,
  notes,
) {
  const qty =
    d.number(Math.abs(qty_change), "كمية الحركة", 0, true) *
    Math.sign(qty_change);
  if (!d.get("SELECT id FROM products WHERE id=?", product_id))
    d.fail("الصنف غير موجود");
  let balance = d.get(
    "SELECT * FROM inventory_balances WHERE product_id=?",
    product_id,
  );
  if (!balance) {
    d.insert("inventory_balances", { id: d.id(), product_id, qty_on_hand: 0 });
    balance = { qty_on_hand: 0, qty_reserved: 0 };
  }
  const after = balance.qty_on_hand + qty;
  if (after < 0 || after < balance.qty_reserved) d.fail("المخزون غير كافٍ");
  d.run(
    "UPDATE inventory_balances SET qty_on_hand=?,updated_at=datetime('now') WHERE product_id=?",
    after,
    product_id,
  );
  return d.insert("inventory_movements", {
    id: d.id(),
    product_id,
    movement_type,
    qty_change: qty,
    balance_after: after,
    reference_id: reference_id || null,
    notes: notes || null,
    user_id: user.id,
  });
}
function adjust(user, body) {
  if (!["initial", "adjustment"].includes(body.movement_type))
    d.fail("سجل التوريد عبر المشتريات");
  if (body.movement_type === "initial" && Number(body.qty_change) < 0)
    d.fail("المخزون الافتتاحي يجب أن يكون موجبًا");
  return d.transaction(() => {
    const row = move(
      user,
      body.product_id,
      Number(body.qty_change),
      body.movement_type,
      body.reference_id,
      d.required(body.notes, "سبب الحركة"),
    );
    const value = d.money(
      Math.abs(row.qty_change) *
        d.get("SELECT cost_price FROM products WHERE id=?", row.product_id)
          .cost_price,
    );
    if (value) {
      const acc = require("./accountingService");
      const other = body.movement_type === "initial" ? "3100" : "5200";
      acc.post(
        user,
        "stock_adjustment",
        row.id,
        body.notes,
        row.qty_change > 0
          ? [
              { account_code: "1200", debit: value },
              { account_code: other, credit: value },
            ]
          : [
              { account_code: other, debit: value },
              { account_code: "1200", credit: value },
            ],
      );
    }
    audit.record(
      user,
      "inventory_adjust",
      "inventory_movements",
      row.id,
      null,
      row,
    );
    return row;
  });
}
function list() {
  return d.all(
    "SELECT p.*,COALESCE(b.qty_on_hand,0) qty_on_hand,COALESCE(b.qty_reserved,0) qty_reserved,COALESCE(b.qty_on_hand,0)*p.cost_price stock_value FROM products p LEFT JOIN inventory_balances b ON b.product_id=p.id ORDER BY p.name_ar",
  );
}
module.exports = {
  move,
  adjust,
  list,
  movements: () =>
    d.all(
      "SELECT m.*,p.name_ar,u.full_name FROM inventory_movements m JOIN products p ON p.id=m.product_id LEFT JOIN users u ON u.id=m.user_id ORDER BY m.created_at DESC LIMIT 2000",
    ),
};
