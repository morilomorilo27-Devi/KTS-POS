const d = require("../db");
function memberFor(input) {
  const id = input?.id || input;
  return id ? d.get("SELECT * FROM members WHERE id=?", id) : null;
}
function available(member, items = [], now = d.day()) {
  return d
    .all(
      "SELECT * FROM discount_rules WHERE status='active' ORDER BY priority,id",
    )
    .filter(
      (r) =>
        (!r.start_date || r.start_date <= now) &&
        (!r.end_date || r.end_date >= now) &&
        (r.scope === "all" ||
          (r.scope === "membership_category" &&
            member?.category_id === r.target_membership_category_id) ||
          (r.scope === "member" && member?.id === r.target_member_id) ||
          r.scope === "category" ||
          r.scope === "product"),
    );
}
function calculate(body) {
  if (!Array.isArray(body.items) || body.items.length === 0)
    d.fail("السلة فارغة");
  const combined = new Map();
  for (const item of body.items) {
    const qty = d.number(item.qty, "الكمية", 0, true);
    combined.set(item.product_id, (combined.get(item.product_id) || 0) + qty);
  }
  const member = memberFor(body.member_id || body.member);
  const selected = body.selected_discount_rule_id || null;
  const rule = selected
    ? available(member).find((r) => r.id === selected)
    : null;
  if (selected && !rule) d.fail("قاعدة الخصم غير متاحة لهذه العضوية");
  if (
    selected &&
    (!member || member.status !== "active" || !member.is_eligible_for_discount)
  )
    d.fail("العضوية غير مؤهلة للخصم");
  const items = [...combined].map(([product_id, qty]) => {
    const p = d.get("SELECT * FROM products WHERE id=?", product_id);
    if (!p || p.status !== "active") d.fail("الصنف غير متاح");
    const special = member
      ? d.get(
          `SELECT special_price FROM membership_product_prices
           WHERE membership_category_id=? AND product_id=?
           AND (starts_at IS NULL OR starts_at<=date('now'))
           AND (ends_at IS NULL OR ends_at>=date('now'))`,
          member.category_id,
          product_id,
        )
      : null;
    const subtotal = d.money(p.sale_price * qty);
    const specialDiscount = special
      ? d.money(Math.max(0, p.sale_price - special.special_price) * qty)
      : 0;
    return {
      product_id,
      qty,
      unit_price: p.sale_price,
      subtotal,
      discount_amount: specialDiscount,
      line_total: d.money(subtotal - specialDiscount),
      applied_rule_id: null,
      product: p,
    };
  });
  const subtotal = d.money(items.reduce((sum, i) => sum + i.subtotal, 0));
  if (rule && subtotal >= rule.min_spend) {
    let remaining =
      rule.max_discount == null ? Infinity : d.money(rule.max_discount);
    for (const line of items) {
      const p = line.product;
      const matches =
        p.is_discountable &&
        (rule.scope !== "product" || p.id === rule.target_product_id) &&
        (rule.scope !== "category" ||
          p.category_id === rule.target_category_id);
      if (!matches) continue;
      const proposed = d.money(
        rule.type === "percentage"
          ? (line.line_total * rule.value) / 100
          : rule.value * line.qty,
      );
      const floor = p.min_price == null ? 0 : d.money(p.min_price * line.qty);
      const extraDiscount = d.money(
        Math.max(0, Math.min(proposed, remaining, line.line_total - floor)),
      );
      remaining = d.money(remaining - extraDiscount);
      if (extraDiscount > 0) line.applied_rule_id = rule.id;
      line.discount_amount = d.money(line.discount_amount + extraDiscount);
      line.line_total = d.money(line.subtotal - line.discount_amount);
    }
  }
  let voucher = null;
  let voucher_discount = 0;
  if (body.voucher_code) {
    voucher = d.get(
      `SELECT * FROM member_vouchers WHERE code=? AND status='active'
       AND (member_id IS NULL OR member_id=?)
       AND (starts_at IS NULL OR starts_at<=date('now'))
       AND (expires_at IS NULL OR expires_at>=date('now'))`,
      String(body.voucher_code).trim().toUpperCase(),
      member?.id || null,
    );
    if (!voucher) d.fail("القسيمة غير صالحة لهذه العضوية");
    voucher_discount = d.money(
      Math.min(
        voucher.remaining_value,
        items.reduce((sum, line) => sum + line.line_total, 0),
      ),
    );
  }
  let wallet_discount = 0;
  if (Number(body.wallet_amount || 0) > 0) {
    if (!member) d.fail("استخدام المحفظة يتطلب عضوًا");
    const wallet = d.get(
      "SELECT balance FROM member_wallets WHERE member_id=?",
      member.id,
    );
    wallet_discount = d.money(
      Math.min(
        d.number(body.wallet_amount, "مبلغ المحفظة", 0, true),
        wallet?.balance || 0,
        items.reduce((sum, line) => sum + line.line_total, 0) -
          voucher_discount,
      ),
    );
    if (wallet_discount <= 0) d.fail("رصيد المحفظة غير كافٍ");
  }
  let benefitRemaining = d.money(voucher_discount + wallet_discount);
  for (const line of items) {
    if (benefitRemaining <= 0) break;
    const amount = d.money(Math.min(line.line_total, benefitRemaining));
    line.discount_amount = d.money(line.discount_amount + amount);
    line.line_total = d.money(line.line_total - amount);
    benefitRemaining = d.money(benefitRemaining - amount);
  }
  const discount_total = d.money(
    items.reduce((s, i) => s + i.discount_amount, 0),
  );
  return {
    subtotal,
    discount_total,
    net_total: d.money(subtotal - discount_total),
    voucher_id: voucher?.id || null,
    voucher_discount,
    wallet_discount,
    items: items.map(({ product, ...i }) => i),
  };
}
module.exports = { calculate, available, memberFor };
