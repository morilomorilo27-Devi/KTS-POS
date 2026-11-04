const d = require("../db");
const pos = require("./posService");
const shift = require("./shiftService");
const inv = require("./inventoryService");
const acc = require("./accountingService");
const audit = require("./auditService");
function verify(invoiceNo) {
  const s = d.get("SELECT id,created_at FROM sales WHERE invoice_no=?", invoiceNo);
  if (!s) d.fail("الفاتورة غير موجودة", 404);
  const returnWindow = Math.max(
    0,
    Number(
      d.get(
        "SELECT config_value FROM system_configurations WHERE config_key='return_window_days'",
      )?.config_value || 14,
    ),
  );
  if (
    returnWindow &&
    Date.now() - Date.parse(String(s.created_at).replace(" ", "T") + "Z") >
      returnWindow * 86400000
  )
    d.fail(`انتهت مهلة الاسترجاع المعتمدة (${returnWindow} يومًا)`);
  const sale = pos.invoice(s.id);
  if (sale.status === "voided") d.fail("الفاتورة ملغاة");
  sale.items = sale.items
    .map((l) => ({
      ...l,
      returned_qty: d.get(
        "SELECT COALESCE(SUM(qty),0) n FROM return_lines WHERE sale_line_id=?",
        l.id,
      ).n,
    }))
    .map((l) => ({ ...l, remaining_qty: l.qty - l.returned_qty }));
  return sale;
}
function create(user, body) {
  return d.transaction(() => {
    const sh = shift.requireShift(user, body.shift_id);
    const source = d.get(
      "SELECT invoice_no FROM sales WHERE id=?",
      body.sale_id,
    );
    if (!source) d.fail("الفاتورة غير موجودة");
    const sale = verify(source.invoice_no);
    if (!body.items?.length) d.fail("بنود المرتجع مطلوبة");
    const seen = new Set();
    const lines = body.items.map((i) => {
      if (seen.has(i.sale_line_id)) d.fail("بند المرتجع مكرر");
      seen.add(i.sale_line_id);
      const l = sale.items.find((l) => l.id === i.sale_line_id);
      const qty = d.number(i.qty, "كمية المرتجع", 0, true);
      if (
        !l ||
        qty > l.remaining_qty ||
        (i.product_id && i.product_id !== l.product_id)
      )
        d.fail("كمية المرتجع أو الصنف غير صالح");
      if (!["good", "damaged"].includes(i.item_condition))
        d.fail("حالة الصنف غير صالحة");
      const prior = d.get(
        "SELECT COALESCE(SUM(refund_amount),0) n FROM return_lines WHERE sale_line_id=?",
        l.id,
      ).n;
      const refund =
        qty === l.remaining_qty
          ? d.money(l.line_total - prior)
          : d.money((l.line_total * qty) / l.qty);
      return {
        sale_line_id: l.id,
        product_id: l.product_id,
        qty,
        refund_amount: refund,
        item_condition: i.item_condition,
        restocked: i.item_condition === "good" ? 1 : 0,
      };
    });
    const total = d.money(lines.reduce((s, l) => s + l.refund_amount, 0));
    if (total <= 0) d.fail("قيمة المرتجع يجب أن تكون موجبة");
    const row = d.insert("return_transactions", {
      id: d.id(),
      return_no: d.sequence("return_transactions", "return_no", "RET"),
      sale_id: sale.id,
      shift_id: sh.id,
      user_id: user.id,
      refund_total: total,
      reason: d.required(body.reason, "سبب المرتجع"),
    });
    let goodCost = 0;
    let damagedCost = 0;
    for (const l of lines) {
      d.insert("return_lines", { id: d.id(), return_id: row.id, ...l });
      const cost = d.money(
        (d.get(
          "SELECT unit_cost FROM sale_cost_lines WHERE sale_line_id=?",
          l.sale_line_id,
        )?.unit_cost ??
          d.get("SELECT cost_price FROM products WHERE id=?", l.product_id)
            .cost_price) * l.qty,
      );
      if (l.restocked) {
        const product = d.get(
          "SELECT cost_price FROM products WHERE id=?",
          l.product_id,
        );
        const balance =
          d.get(
            "SELECT qty_on_hand FROM inventory_balances WHERE product_id=?",
            l.product_id,
          )?.qty_on_hand || 0;
        const restoredAverage = Number(
          ((balance * product.cost_price + cost) / (balance + l.qty)).toFixed(
            6,
          ),
        );
        inv.move(user, l.product_id, l.qty, "return", row.id);
        d.update("products", l.product_id, { cost_price: restoredAverage });
        goodCost += cost;
      } else damagedCost += cost;
    }
    const cashSale =
      sale.payments
        .filter((p) => p.payment_method === "cash")
        .reduce((s, p) => s + p.amount, 0) - sale.change_due;
    const previouslyRefunded = d.get(
      "SELECT COALESCE(SUM(refund_total),0) n FROM return_transactions WHERE sale_id=? AND id<>?",
      sale.id,
      row.id,
    ).n;
    const priorCash = d.get(
      "SELECT COALESCE(SUM(p.amount),0) n FROM return_refund_payments p JOIN return_transactions r ON r.id=p.return_id WHERE r.sale_id=? AND p.payment_method='cash'",
      sale.id,
    ).n;
    const cash = d.money(
      Math.max(
        0,
        Math.min(
          total,
          cashSale - priorCash,
          d.money(previouslyRefunded + total) === sale.net_total
            ? cashSale - priorCash
            : (total * cashSale) / sale.net_total,
        ),
      ),
    );
    const knet = d.money(total - cash);
    for (const [method, amount] of [
      ["cash", cash],
      ["knet", knet],
    ])
      if (amount > 0)
        d.insert("return_refund_payments", {
          id: d.id(),
          return_id: row.id,
          payment_method: method,
          amount,
        });
    d.run(
      "UPDATE cashier_shifts SET total_sales=ROUND(total_sales-?,3),total_refunds=ROUND(total_refunds+?,3),expected_cash=ROUND(expected_cash-?,3) WHERE id=?",
      total,
      total,
      cash,
      sh.id,
    );
    const remaining =
      d.get("SELECT SUM(qty) n FROM sale_lines WHERE sale_id=?", sale.id).n -
      d.get(
        "SELECT COALESCE(SUM(rl.qty),0) n FROM return_lines rl JOIN return_transactions r ON r.id=rl.return_id WHERE r.sale_id=?",
        sale.id,
      ).n;
    d.update("sales", sale.id, {
      status: remaining === 0 ? "refunded" : "partial_refunded",
    });
    acc.post(user, "return", row.id, row.return_no, [
      { account_code: "4200", debit: total },
      { account_code: "1100", credit: cash },
      { account_code: "1110", credit: knet },
      { account_code: "1200", debit: d.money(goodCost) },
      { account_code: "5100", credit: d.money(goodCost + damagedCost) },
      { account_code: "5200", debit: d.money(damagedCost) },
    ]);
    audit.record(user, "return", "return_transactions", row.id, null, {
      ...row,
      lines,
    });
    return {
      success: true,
      ...row,
      lines,
      cash_refund: cash,
      knet_refund: knet,
    };
  });
}
module.exports = { verify, create };
