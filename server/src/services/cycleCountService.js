const d = require("../db");
const audit = require("./auditService");
const inventory = require("./inventoryService");
const accounting = require("./accountingService");

function classification() {
  const rows = d.all(
    `SELECT p.id,p.sku,p.name_ar,p.cost_price,p.sale_price,p.min_stock_alert,
      COALESCE(b.qty_on_hand,0) qty_on_hand,
      COALESCE(SUM(CASE WHEN s.created_at>=datetime('now','-90 days') AND s.status!='voided'
        THEN sl.qty ELSE 0 END),0) sold_qty,
      COALESCE(SUM(CASE WHEN s.created_at>=datetime('now','-90 days') AND s.status!='voided'
        THEN sl.line_total ELSE 0 END),0) sales_value,
      (SELECT MAX(cc.completed_at) FROM cycle_count_lines cl JOIN cycle_counts cc ON cc.id=cl.count_id
        WHERE cl.product_id=p.id AND cc.status='completed') last_counted_at
     FROM products p LEFT JOIN inventory_balances b ON b.product_id=p.id
     LEFT JOIN sale_lines sl ON sl.product_id=p.id LEFT JOIN sales s ON s.id=sl.sale_id
     WHERE p.status='active' GROUP BY p.id ORDER BY sales_value DESC,p.cost_price*qty_on_hand DESC`,
  );
  const total = rows.reduce(
    (sum, row) => sum + (row.sales_value || row.cost_price * row.qty_on_hand),
    0,
  );
  let cumulative = 0;
  return rows.map((row) => {
    const value = row.sales_value || row.cost_price * row.qty_on_hand;
    const previousShare = total ? (cumulative / total) * 100 : 100;
    cumulative += value;
    const abc_class = previousShare < 80 ? "A" : previousShare < 95 ? "B" : "C";
    const interval_days = { A: 1, B: 7, C: 30 }[abc_class];
    const last = row.last_counted_at ? Date.parse(row.last_counted_at) : 0;
    const due = !last || Date.now() - last >= interval_days * 86400000;
    return { ...row, abc_class, interval_days, due };
  });
}

function generate(user, body = {}) {
  const limit = Math.max(1, Math.min(100, Number(body.limit) || 20));
  const candidates = classification()
    .filter((row) => row.due)
    .slice(0, limit);
  if (!candidates.length) d.fail("لا توجد أصناف مستحقة للجرد اليوم");
  return d.transaction(() => {
    const count = d.insert("cycle_counts", {
      id: d.id(),
      count_no: d.sequence("cycle_counts", "count_no", "CC"),
      generated_by: user.id,
      notes: body.notes || "قائمة جرد دوري موجه",
    });
    for (const item of candidates)
      d.insert("cycle_count_lines", {
        id: d.id(),
        count_id: count.id,
        product_id: item.id,
        abc_class: item.abc_class,
        expected_qty: item.qty_on_hand,
      });
    audit.record(user, "cycle_count_generate", "cycle_counts", count.id, null, {
      ...count,
      items_count: candidates.length,
    });
    return details(count.id);
  });
}

function list() {
  return d.all(
    `SELECT c.*,u.full_name generated_by_name,a.full_name approved_by_name,
      (SELECT COUNT(*) FROM cycle_count_lines l WHERE l.count_id=c.id) items_count,
      (SELECT COUNT(*) FROM cycle_count_lines l WHERE l.count_id=c.id AND l.counted_qty IS NOT NULL) counted_items,
      (SELECT COUNT(*) FROM cycle_count_lines l WHERE l.count_id=c.id AND ABS(COALESCE(l.variance,0))>0.0001) variance_items
     FROM cycle_counts c JOIN users u ON u.id=c.generated_by LEFT JOIN users a ON a.id=c.approved_by
     ORDER BY c.created_at DESC`,
  );
}

function details(id) {
  const count = d.get("SELECT * FROM cycle_counts WHERE id=?", id);
  if (!count) d.fail("قائمة الجرد غير موجودة", 404);
  return {
    ...count,
    lines: d.all(
      `SELECT l.*,p.sku,p.name_ar,p.cost_price,
        (SELECT GROUP_CONCAT(barcode,' | ') FROM product_barcodes b WHERE b.product_id=p.id) barcodes
       FROM cycle_count_lines l JOIN products p ON p.id=l.product_id
       WHERE l.count_id=? ORDER BY CASE l.abc_class WHEN 'A' THEN 1 WHEN 'B' THEN 2 ELSE 3 END,p.name_ar`,
      id,
    ),
  };
}

function record(user, id, body) {
  return d.transaction(() => {
    const count = d.get("SELECT * FROM cycle_counts WHERE id=?", id);
    if (!count || count.status !== "open") d.fail("قائمة الجرد غير متاحة");
    let productId = body.product_id;
    if (!productId && body.barcode)
      productId = d.get("SELECT product_id FROM product_barcodes WHERE barcode=?", String(body.barcode).trim())?.product_id;
    const line = d.get("SELECT * FROM cycle_count_lines WHERE count_id=? AND product_id=?", id, productId);
    if (!line) d.fail("الصنف ليس ضمن قائمة الجرد");
    const counted = d.number(body.counted_qty, "الكمية الفعلية");
    const variance = Number((counted - line.expected_qty).toFixed(3));
    if (variance !== 0 && !String(body.reason || "").trim())
      d.fail("سبب فرق الجرد مطلوب");
    d.run(
      "UPDATE cycle_count_lines SET counted_qty=?,variance=?,reason=?,counted_at=datetime('now') WHERE id=?",
      counted,
      variance,
      body.reason || null,
      line.id,
    );
    audit.record(user, "cycle_count_record", "cycle_count_lines", line.id, line, {
      counted_qty: counted,
      variance,
      reason: body.reason || null,
    });
    return details(id);
  });
}

function complete(user, id) {
  require("./permissionService").assertAllowed(user,"cycle_counts_approve");
  return d.transaction(() => {
    const count = details(id);
    if (count.status !== "open") d.fail("قائمة الجرد مغلقة");
    if (count.lines.some((line) => line.counted_qty == null))
      d.fail("يجب عد جميع الأصناف قبل الاعتماد");
    for (const line of count.lines.filter((entry) => Math.abs(entry.variance) > 0.0001)) {
      const movement = inventory.move(
        user,
        line.product_id,
        line.variance,
        "adjustment",
        count.id,
        `فرق جرد ${count.count_no}: ${line.reason}`,
      );
      const value = d.money(Math.abs(line.variance) * line.cost_price);
      if (value)
        accounting.post(user, "cycle_count_adjustment", movement.id, `فرق جرد ${count.count_no}`, line.variance > 0
          ? [
              { account_code: "1200", debit: value },
              { account_code: "5200", credit: value },
            ]
          : [
              { account_code: "5200", debit: value },
              { account_code: "1200", credit: value },
            ]);
    }
    d.run("UPDATE cycle_counts SET status='completed',approved_by=?,completed_at=datetime('now') WHERE id=?", user.id, id);
    const updated = details(id);
    audit.record(user, "cycle_count_complete", "cycle_counts", id, count, updated);
    return updated;
  });
}

module.exports = { classification, generate, list, details, record, complete };
