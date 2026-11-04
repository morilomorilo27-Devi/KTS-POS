const d = require("../db");
const audit = require("./auditService");

function overview(memberId) {
  const member = d.get(
    `SELECT m.id,m.membership_no,m.name,m.phone,m.email,m.status,m.category_id,c.name_ar category_name,
      p.expiry_date,p.purchase_limit,p.allowance_period,p.receipt_consent,p.preferred_channel,
      COALESCE(w.balance,0) wallet_balance
     FROM members m JOIN membership_categories c ON c.id=m.category_id
     LEFT JOIN member_profiles p ON p.member_id=m.id LEFT JOIN member_wallets w ON w.member_id=m.id
     WHERE m.id=?`,
    memberId,
  );
  if (!member) d.fail("العضو غير موجود", 404);
  const summary = d.get(
    `SELECT COUNT(*) transactions_count,COALESCE(SUM(net_total),0) total_spend,
      COALESCE(SUM(discount_total),0) total_savings,MAX(created_at) last_purchase_at
     FROM sales WHERE member_id=? AND status!='voided'`,
    memberId,
  );
  const monthSpend = d.get(
    `SELECT COALESCE(SUM(net_total),0) value FROM sales WHERE member_id=? AND status!='voided'
     AND created_at>=date('now','start of month')`,
    memberId,
  ).value;
  return {
    ...member,
    ...summary,
    month_spend: monthSpend,
    remaining_limit:
      member.purchase_limit == null
        ? null
        : Math.max(0, d.money(member.purchase_limit - monthSpend)),
    expiry_warning:
      member.expiry_date &&
      member.expiry_date <=
        new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
    dependents: d.all(
      "SELECT * FROM member_dependents WHERE member_id=? ORDER BY name",
      memberId,
    ),
    vouchers: d.all(
      `SELECT * FROM member_vouchers WHERE member_id=? AND status='active'
       AND (starts_at IS NULL OR starts_at<=date('now')) AND (expires_at IS NULL OR expires_at>=date('now'))
       ORDER BY expires_at`,
      memberId,
    ),
    recent_sales: d.all(
      `SELECT id,invoice_no,subtotal,discount_total,net_total,status,created_at
       FROM sales WHERE member_id=? ORDER BY created_at DESC LIMIT 10`,
      memberId,
    ),
  };
}

function saveProfile(user, memberId, body) {
  return d.transaction(() => {
    if (!d.get("SELECT id FROM members WHERE id=?", memberId)) d.fail("العضو غير موجود", 404);
    const data = {
      expiry_date: body.expiry_date || null,
      purchase_limit:
        body.purchase_limit === "" || body.purchase_limit == null
          ? null
          : d.money(d.number(body.purchase_limit, "حد الشراء")),
      allowance_period: body.allowance_period || "monthly",
      receipt_consent: Number(body.receipt_consent || 0) ? 1 : 0,
      preferred_channel: body.preferred_channel || null,
    };
    d.run(
      `INSERT INTO member_profiles(member_id,expiry_date,purchase_limit,allowance_period,receipt_consent,preferred_channel)
       VALUES(?,?,?,?,?,?) ON CONFLICT(member_id) DO UPDATE SET expiry_date=excluded.expiry_date,
       purchase_limit=excluded.purchase_limit,allowance_period=excluded.allowance_period,
       receipt_consent=excluded.receipt_consent,preferred_channel=excluded.preferred_channel,updated_at=datetime('now')`,
      memberId,
      data.expiry_date,
      data.purchase_limit,
      data.allowance_period,
      data.receipt_consent,
      data.preferred_channel,
    );
    audit.record(user, "member_profile_update", "members", memberId, null, data);
    return overview(memberId);
  });
}

function addDependent(user, memberId, body) {
  return d.transaction(() => {
    if (!d.get("SELECT id FROM members WHERE id=?", memberId)) d.fail("العضو غير موجود", 404);
    const row = d.insert("member_dependents", {
      id: d.id(),
      member_id: memberId,
      name: d.required(body.name, "اسم التابع"),
      civil_id: body.civil_id || null,
      relationship: body.relationship || null,
    });
    audit.record(user, "member_dependent_add", "member_dependents", row.id, null, row);
    return row;
  });
}

function walletAdjust(user, memberId, body) {
  return d.transaction(() => {
    const amount = d.money(d.number(Math.abs(body.amount), "المبلغ", 0, true) * (Number(body.amount) < 0 ? -1 : 1));
    const current = d.get("SELECT balance FROM member_wallets WHERE member_id=?", memberId)?.balance || 0;
    if (current + amount < 0) d.fail("الرصيد غير كافٍ");
    d.run(
      `INSERT INTO member_wallets(member_id,balance) VALUES(?,?)
       ON CONFLICT(member_id) DO UPDATE SET balance=ROUND(balance+excluded.balance,3),updated_at=datetime('now')`,
      memberId,
      amount,
    );
    const entry = d.insert("member_wallet_entries", {
      id: d.id(),
      member_id: memberId,
      amount,
      reference_type: body.reference_type || "manual",
      reference_id: body.reference_id || null,
      notes: d.required(body.notes, "السبب"),
      user_id: user.id,
    });
    audit.record(user, "member_wallet_adjust", "member_wallet_entries", entry.id, null, entry);
    return overview(memberId);
  });
}

function createVoucher(user, body) {
  return d.transaction(() => {
    const value = d.money(d.number(body.value, "قيمة القسيمة", 0, true));
    const row = d.insert("member_vouchers", {
      id: d.id(),
      code: d.required(body.code, "رمز القسيمة").toUpperCase(),
      member_id: body.member_id || null,
      value,
      remaining_value: value,
      starts_at: body.starts_at || null,
      expires_at: body.expires_at || null,
    });
    audit.record(user, "member_voucher_create", "member_vouchers", row.id, null, row);
    return row;
  });
}

function setSpecialPrice(user, body) {
  return d.transaction(() => {
    const price = d.money(d.number(body.special_price, "السعر الخاص"));
    const existing = d.get(
      "SELECT * FROM membership_product_prices WHERE membership_category_id=? AND product_id=?",
      body.membership_category_id,
      body.product_id,
    );
    if (existing)
      d.run(
        "UPDATE membership_product_prices SET special_price=?,starts_at=?,ends_at=? WHERE id=?",
        price,
        body.starts_at || null,
        body.ends_at || null,
        existing.id,
      );
    else
      d.insert("membership_product_prices", {
        id: d.id(),
        membership_category_id: body.membership_category_id,
        product_id: body.product_id,
        special_price: price,
        starts_at: body.starts_at || null,
        ends_at: body.ends_at || null,
      });
    const row = d.get(
      "SELECT * FROM membership_product_prices WHERE membership_category_id=? AND product_id=?",
      body.membership_category_id,
      body.product_id,
    );
    audit.record(user, "membership_special_price", "membership_product_prices", row.id, existing, row);
    return row;
  });
}

function specialPrices() {
  return d.all(
    `SELECT sp.*,c.name_ar category_name,p.sku,p.name_ar product_name FROM membership_product_prices sp
     JOIN membership_categories c ON c.id=sp.membership_category_id JOIN products p ON p.id=sp.product_id
     ORDER BY c.name_ar,p.name_ar`,
  );
}

function assertPurchaseLimit(memberId, amount) {
  if (!memberId) return;
  const profile = d.get("SELECT purchase_limit,expiry_date FROM member_profiles WHERE member_id=?", memberId);
  if (!profile) return;
  if (profile.expiry_date && profile.expiry_date < d.day()) d.fail("انتهت صلاحية العضوية");
  if (profile.purchase_limit != null) {
    const spent = d.get(
      `SELECT COALESCE(SUM(net_total),0) value FROM sales WHERE member_id=? AND status!='voided'
       AND created_at>=date('now','start of month')`,
      memberId,
    ).value;
    if (d.money(spent + amount) > profile.purchase_limit)
      d.fail("تتجاوز العملية حد الشراء الشهري للعضو");
  }
}

module.exports = {
  overview,
  saveProfile,
  addDependent,
  walletAdjust,
  createVoucher,
  setSpecialPrice,
  specialPrices,
  assertPurchaseLimit,
};
