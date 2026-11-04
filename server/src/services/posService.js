const d = require("../db");
const shifts = require("./shiftService");
const discounts = require("./discountEngine");
const inv = require("./inventoryService");
const accounting = require("./accountingService");
const audit = require("./auditService");
const memberExperience = require("./memberExperienceService");
const devices = require("./deviceService");
const receipts = require("./receiptService");
const access = require("./permissionService");
function invoice(id) {
  const sale = d.get(
    "SELECT s.*,u.full_name cashier_name,cs.shift_no,m.name member_name,m.membership_no FROM sales s JOIN users u ON u.id=s.user_id JOIN cashier_shifts cs ON cs.id=s.shift_id LEFT JOIN members m ON m.id=s.member_id WHERE s.id=?",
    id,
  );
  if (!sale) d.fail("الفاتورة غير موجودة", 404);
  return {
    ...sale,
    items: d.all(
      "SELECT l.*,p.name_ar,p.sku FROM sale_lines l JOIN products p ON p.id=l.product_id WHERE sale_id=?",
      id,
    ),
    payments: d.all("SELECT * FROM payments WHERE sale_id=?", id),
    items_count: d.get("SELECT COUNT(*) n FROM sale_lines WHERE sale_id=?", id)
      .n,
  };
}
function checkout(user, body) {
  access.assertAllowed(user,"pos_checkout");
  if(body.selected_discount_rule_id) access.assertAllowed(user,"pos_discount");
  if(body.member_id || body.member) access.assertAllowed(user,"pos_member_lookup");
  const tx = d.required(body.client_transaction_id, "معرف المعاملة");
  return d.transaction(() => {
    const prior = d.get(
      "SELECT id,user_id FROM sales WHERE client_transaction_id=?",
      tx,
    );
    if (prior) {
      if (prior.user_id !== user.id)
        d.fail("معرف المعاملة يخص مستخدمًا آخر", 403);
      return { success: true, invoice: invoice(prior.id) };
    }
    const shift = shifts.requireShift(user, body.shift_id);
    const totals = discounts.calculate(body);
    if (totals.net_total <= 0) d.fail("صافي الفاتورة يجب أن يكون موجبًا");
    memberExperience.assertPurchaseLimit(
      body.member_id || body.member?.id || null,
      totals.net_total,
    );
    if (
      !Array.isArray(body.payments) ||
      body.payments.length < 1 ||
      body.payments.length > 2
    )
      d.fail("بيانات الدفع مطلوبة");
    const payments = body.payments.map((p) => ({
      payment_method: p.payment_method,
      amount: d.money(d.number(p.amount, "مبلغ الدفع", 0, true)),
      reference_no: p.reference_no || null,
    }));
    if (
      payments.some((p) => !["cash", "knet"].includes(p.payment_method)) ||
      new Set(payments.map((p) => p.payment_method)).size !== payments.length
    )
      d.fail("طريقة الدفع غير صالحة");
    const paid = d.money(payments.reduce((s, p) => s + p.amount, 0));
    const split = payments.length === 2;
    for(const payment of payments) access.assertAllowed(user,"pos_payment_"+payment.payment_method);
    if(split)access.assertAllowed(user,"pos_payment_split");
    if (split && paid !== totals.net_total)
      d.fail("مجموع تقسيم الدفع يجب أن يطابق صافي الفاتورة");
    if (paid < totals.net_total) d.fail("المبلغ المدفوع غير كافٍ");
    if (
      payments[0].payment_method === "knet" &&
      !split &&
      paid !== totals.net_total
    )
      d.fail("يجب أن يطابق تحصيل كي نت الصافي");
    if (
      body.paid_amount != null &&
      d.money(d.number(body.paid_amount, "المبلغ المدفوع")) !== paid
    )
      d.fail("المبلغ المدفوع لا يطابق تفاصيل الدفع");
    let cost = 0;
    for (const l of totals.items) {
      const b = d.get(
        "SELECT * FROM inventory_balances WHERE product_id=?",
        l.product_id,
      );
      if (!b || b.qty_on_hand - b.qty_reserved < l.qty)
        d.fail("المخزون غير كافٍ");
      cost += d.money(
        d.get("SELECT cost_price FROM products WHERE id=?", l.product_id)
          .cost_price * l.qty,
      );
    }
    const sale = d.insert("sales", {
      id: d.id(),
      invoice_no: d.sequence("sales", "invoice_no", "INV"),
      client_transaction_id: tx,
      shift_id: shift.id,
      user_id: user.id,
      member_id: body.member_id || body.member?.id || null,
      subtotal: totals.subtotal,
      discount_total: totals.discount_total,
      net_total: totals.net_total,
      paid_amount: paid,
      change_due: d.money(paid - totals.net_total),
      notes: body.notes || null,
    });
    for (const { subtotal, ...line } of totals.items) {
      const saved = d.insert("sale_lines", {
        id: d.id(),
        sale_id: sale.id,
        ...line,
      });
      d.insert("sale_cost_lines", {
        sale_line_id: saved.id,
        unit_cost: d.get(
          "SELECT cost_price FROM products WHERE id=?",
          line.product_id,
        ).cost_price,
      });
      inv.move(user, line.product_id, -line.qty, "sale", sale.id);
    }
    for (const payment of payments)
      d.insert("payments", { id: d.id(), sale_id: sale.id, ...payment });
    if (totals.voucher_id && totals.voucher_discount > 0) {
      d.run(
        `UPDATE member_vouchers SET remaining_value=ROUND(remaining_value-?,3),
         status=CASE WHEN remaining_value-?<=0 THEN 'used' ELSE status END WHERE id=?`,
        totals.voucher_discount,
        totals.voucher_discount,
        totals.voucher_id,
      );
    }
    if (sale.member_id && totals.wallet_discount > 0) {
      d.run(
        "UPDATE member_wallets SET balance=ROUND(balance-?,3),updated_at=datetime('now') WHERE member_id=?",
        totals.wallet_discount,
        sale.member_id,
      );
      d.insert("member_wallet_entries", {
        id: d.id(),
        member_id: sale.member_id,
        amount: -totals.wallet_discount,
        reference_type: "sale",
        reference_id: sale.id,
        notes: "استخدام رصيد المحفظة في الفاتورة " + sale.invoice_no,
        user_id: user.id,
      });
    }
    const cash = d.money(
      payments
        .filter((p) => p.payment_method === "cash")
        .reduce((s, p) => s + p.amount, 0) - sale.change_due,
    );
    const knet = d.money(
      payments
        .filter((p) => p.payment_method === "knet")
        .reduce((s, p) => s + p.amount, 0),
    );
    d.run(
      "UPDATE cashier_shifts SET total_sales=ROUND(total_sales+?,3),total_cash_sales=ROUND(total_cash_sales+?,3),total_knet_sales=ROUND(total_knet_sales+?,3),expected_cash=ROUND(expected_cash+?,3),invoice_count=invoice_count+1 WHERE id=?",
      sale.net_total,
      cash,
      knet,
      cash,
      shift.id,
    );
    accounting.sale(user, sale, payments, d.money(cost));
    const consent = sale.member_id
      ? Boolean(
          d.get(
            "SELECT receipt_consent FROM member_profiles WHERE member_id=?",
            sale.member_id,
          )?.receipt_consent,
        )
      : false;
    receipts.ensure(sale.id, consent);
    devices.queue(user, "receipt_printer", "sale_receipt", {
      sale_id: sale.id,
      invoice_no: sale.invoice_no,
    });
    if (cash > 0)
      devices.queue(user, "cash_drawer", "open_after_cash_sale", {
        sale_id: sale.id,
      });
    devices.queue(user, "customer_display", "sale_completed", {
      invoice_no: sale.invoice_no,
      net_total: sale.net_total,
      change_due: sale.change_due,
    });
    if (body.knet_client_reference)
      devices.linkKnet(body.knet_client_reference, sale.id);
    audit.record(user, "sale", "sales", sale.id, null, {
      ...sale,
      selected_discount_rule_id: body.selected_discount_rule_id || null,
    });
    return { success: true, invoice: invoice(sale.id) };
  });
}
function hold(user, body) {
  return d.transaction(() => {
    const s = shifts.requireShift(user, body.shift_id);
    if (!body.items?.length) d.fail("السلة فارغة");
    const row = d.insert("held_carts", {
      id: d.id(),
      cart_ref: "CART-" + d.id().slice(0, 8).toUpperCase(),
      user_id: user.id,
      shift_id: s.id,
      member_id: body.member?.id || null,
      payload: JSON.stringify(body),
    });
    audit.record(user, "cart_hold", "held_carts", row.id, null, row);
    return {
      success: true,
      ...row,
      held_at: d.get("SELECT created_at FROM held_carts WHERE id=?", row.id)
        .created_at,
    };
  });
}
function held(user) {
  const s = shifts.current(user);
  return s
    ? d
        .all(
          "SELECT * FROM held_carts WHERE user_id=? AND shift_id=? ORDER BY created_at",
          user.id,
          s.id,
        )
        .map((r) => ({ ...r, payload: JSON.parse(r.payload) }))
    : [];
}
function recall(user, id) {
  return d.transaction(() => {
    const row = held(user).find((c) => c.id === id);
    if (!row) d.fail("السلة غير متاحة", 404);
    d.run("DELETE FROM held_carts WHERE id=?", id);
    return row;
  });
}
function favorites(user) {
  return d.all(
    `SELECT p.* FROM product_favorites f JOIN products p ON p.id=f.product_id
     WHERE f.user_id=? AND p.status='active' ORDER BY f.created_at DESC`,
    user.id,
  );
}
function toggleFavorite(user, productId) {
  if (!d.get("SELECT id FROM products WHERE id=?", productId))
    d.fail("الصنف غير موجود", 404);
  const exists = d.get(
    "SELECT 1 FROM product_favorites WHERE user_id=? AND product_id=?",
    user.id,
    productId,
  );
  if (exists)
    d.run(
      "DELETE FROM product_favorites WHERE user_id=? AND product_id=?",
      user.id,
      productId,
    );
  else
    d.run(
      "INSERT INTO product_favorites(user_id,product_id) VALUES(?,?)",
      user.id,
      productId,
    );
  return { favorite: !exists };
}
function mergeHeld(user, ids) {
  if (!Array.isArray(ids) || ids.length < 2)
    d.fail("حدد سلتين على الأقل للدمج");
  return d.transaction(() => {
    const carts = held(user).filter((cart) => ids.includes(cart.id));
    if (carts.length !== new Set(ids).size) d.fail("إحدى السلات غير متاحة");
    const memberIds = new Set(carts.map((cart) => cart.member_id).filter(Boolean));
    if (memberIds.size > 1) d.fail("لا يمكن دمج سلات لأعضاء مختلفين");
    const combined = new Map();
    for (const cart of carts)
      for (const line of cart.payload.items)
        combined.set(
          line.product_id,
          (combined.get(line.product_id) || 0) + Number(line.qty),
        );
    for (const cart of carts) d.run("DELETE FROM held_carts WHERE id=?", cart.id);
    const payload = {
      ...carts[0].payload,
      items: [...combined].map(([product_id, qty]) => ({ product_id, qty })),
    };
    const row = d.insert("held_carts", {
      id: d.id(),
      cart_ref: "CART-" + d.id().slice(0, 8).toUpperCase(),
      user_id: user.id,
      shift_id: carts[0].shift_id,
      member_id: carts[0].member_id || null,
      payload: JSON.stringify(payload),
    });
    audit.record(user, "cart_merge", "held_carts", row.id, carts, row);
    return { ...row, payload };
  });
}
function transferHeld(user, id, targetUserId) {
  access.assertAllowed(user,"pos_hold_transfer");
  return d.transaction(() => {
    const cart = d.get("SELECT * FROM held_carts WHERE id=?", id);
    if (!cart) d.fail("السلة غير متاحة", 404);
    const shift = d.get(
      "SELECT * FROM cashier_shifts WHERE user_id=? AND status='open'",
      targetUserId,
    );
    if (!shift) d.fail("المستخدم المستهدف لا يملك وردية مفتوحة");
    d.run(
      "UPDATE held_carts SET user_id=?,shift_id=? WHERE id=?",
      targetUserId,
      shift.id,
      id,
    );
    const log = d.insert("cart_transfer_logs", {
      id: d.id(),
      cart_id: id,
      from_user_id: cart.user_id,
      to_user_id: targetUserId,
      approved_by: user.id,
    });
    audit.record(user, "cart_transfer", "held_carts", id, cart, log);
    return log;
  });
}
function lastInvoice(user) {
  const row = d.get(
    "SELECT id FROM sales WHERE user_id=? ORDER BY created_at DESC LIMIT 1",
    user.id,
  );
  return row ? invoice(row.id) : null;
}
function reprint(user, id, reason) {
  const sale = invoice(id);
  const row = d.insert("receipt_actions", {
    id: d.id(),
    sale_id: sale.id,
    action: "reprint",
    reason: d.required(reason, "سبب إعادة الطباعة"),
    user_id: user.id,
  });
  audit.record(user, "receipt_reprint", "sales", sale.id, null, row);
  return sale;
}
module.exports = {
  checkout,
  invoice,
  hold,
  held,
  recall,
  favorites,
  toggleFavorite,
  mergeHeld,
  transferHeld,
  lastInvoice,
  reprint,
};
