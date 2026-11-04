const d = require("../db");

function item(type, severity, title, description, count, action, rows = []) {
  return { type, severity, title, description, count: Number(count || 0), action, rows };
}

function list() {
  const alerts = [];
  const low = d.all(
    `SELECT p.id,p.sku,p.name_ar,COALESCE(b.qty_on_hand,0) qty_on_hand,p.min_stock_alert
     FROM products p LEFT JOIN inventory_balances b ON b.product_id=p.id
     WHERE p.status='active' AND COALESCE(b.qty_on_hand,0)<=p.min_stock_alert ORDER BY qty_on_hand`,
  );
  if (low.length)
    alerts.push(item("low_stock", "warning", "أصناف قاربت على النفاد", "راجع اقتراحات إعادة الطلب وأنشئ أوامر شراء.", low.length, "reorder", low.slice(0, 20)));

  const negative = d.all(
    `SELECT p.id,p.sku,p.name_ar,b.qty_on_hand FROM inventory_balances b JOIN products p ON p.id=b.product_id WHERE b.qty_on_hand<0`,
  );
  const variances = d.all(
    `SELECT c.count_no,p.sku,p.name_ar,l.variance,l.reason FROM cycle_count_lines l
     JOIN cycle_counts c ON c.id=l.count_id JOIN products p ON p.id=l.product_id
     WHERE ABS(COALESCE(l.variance,0))>0.0001 ORDER BY l.counted_at DESC LIMIT 50`,
  );
  if (negative.length || variances.length)
    alerts.push(item("inventory_variance", negative.length ? "critical" : "warning", "فروقات أو أرصدة مخزون غير طبيعية", "افتح قوائم الجرد وحركات التسوية لمراجعة الأسباب.", negative.length + variances.length, "cycle-counts", [...negative, ...variances].slice(0, 20)));

  const noSupplier = d.all(
    `SELECT p.id,p.sku,p.name_ar FROM products p WHERE p.status='active'
     AND NOT EXISTS(SELECT 1 FROM product_suppliers ps WHERE ps.product_id=p.id) ORDER BY p.name_ar`,
  );
  if (noSupplier.length)
    alerts.push(item("missing_supplier", "warning", "منتجات بلا مورد", "اربط كل صنف بمورد واحد على الأقل لضمان إعادة الطلب.", noSupplier.length, "products", noSupplier.slice(0, 20)));

  const belowCost = d.all(
    `SELECT id,sku,name_ar,cost_price,sale_price FROM products WHERE status='active' AND sale_price<cost_price ORDER BY cost_price-sale_price DESC`,
  );
  if (belowCost.length)
    alerts.push(item("below_cost", "critical", "أسعار بيع أقل من التكلفة", "راجع الأسعار قبل استمرار البيع بخسارة.", belowCost.length, "products", belowCost.slice(0, 20)));

  const delayed = d.all(
    `SELECT o.id,o.order_no,s.name supplier_name,o.expected_at,o.status FROM purchase_orders o
     JOIN suppliers s ON s.id=o.supplier_id WHERE o.status IN ('sent','partial')
     AND o.expected_at IS NOT NULL AND o.expected_at<date('now') ORDER BY o.expected_at`,
  );
  if (delayed.length)
    alerts.push(item("late_purchase", "warning", "مشتريات متأخرة", "تواصل مع المورد أو حدّث موعد التسليم.", delayed.length, "purchase-orders", delayed));

  const supplierDue = d.all(
    `SELECT * FROM (SELECT s.id,s.code,s.name,
      ROUND(COALESCE((SELECT SUM(total-paid_amount) FROM purchases p WHERE p.supplier_id=s.id),0)
      +COALESCE((SELECT SUM(total-paid_amount) FROM supplier_invoices i WHERE i.supplier_id=s.id AND i.status!='pending'),0)
      -COALESCE((SELECT SUM(sp.amount) FROM supplier_payments sp WHERE sp.supplier_id=s.id
        AND NOT EXISTS(SELECT 1 FROM supplier_invoice_payment_allocations a WHERE a.supplier_payment_id=sp.id)),0),3) balance_due
     FROM suppliers s) WHERE balance_due>0 ORDER BY balance_due DESC`,
  );
  if (supplierDue.length)
    alerts.push(item("supplier_due", "info", "مبالغ مستحقة للموردين", "راجع الفواتير المعتمدة وخطة السداد.", supplierDue.length, "supplier-invoices", supplierDue));

  const openShifts = d.all(
    `SELECT s.id,s.shift_no,u.full_name,s.opened_at FROM cashier_shifts s JOIN users u ON u.id=s.user_id
     WHERE s.status='open' AND s.opened_at<datetime('now','-16 hours') ORDER BY s.opened_at`,
  );
  if (openShifts.length)
    alerts.push(item("open_shift", "critical", "ورديات مفتوحة منذ وقت طويل", "تحقق من الكاشير وأغلق الوردية بعد المطابقة.", openShifts.length, "shifts", openShifts));

  const cashDiff = d.all(
    `SELECT s.id,s.shift_no,u.full_name,s.discrepancy,s.closed_at FROM cashier_shifts s JOIN users u ON u.id=s.user_id
     WHERE s.status='closed' AND ABS(COALESCE(s.discrepancy,0))>=0.001 AND s.closed_at>=datetime('now','-30 days')
     ORDER BY ABS(s.discrepancy) DESC LIMIT 50`,
  );
  if (cashDiff.length)
    alerts.push(item("cash_difference", "warning", "فروقات صندوق", "راجع تقارير إغلاق الورديات والأسباب المسجلة.", cashDiff.length, "shifts", cashDiff));

  const unusual = d.all(
    `SELECT * FROM (SELECT s.id,s.invoice_no,u.full_name,s.net_total,s.discount_total,s.created_at,'discount' kind
     FROM sales s JOIN users u ON u.id=s.user_id WHERE s.created_at>=datetime('now','-30 days')
     AND s.subtotal>0 AND s.discount_total/s.subtotal>=0.25
     UNION ALL
     SELECT r.id,r.return_no,u.full_name,r.refund_total,0,r.created_at,'return' kind
     FROM return_transactions r JOIN users u ON u.id=r.user_id WHERE r.created_at>=datetime('now','-30 days')
     AND r.refund_total>=50) ORDER BY created_at DESC LIMIT 50`,
  );
  if (unusual.length)
    alerts.push(item("unusual_transaction", "warning", "مرتجعات أو خصومات غير اعتيادية", "راجع العمليات المرتفعة وسجل التدقيق.", unusual.length, "audit", unusual));

  const dormant = d.all(
    `SELECT p.id,p.sku,p.name_ar,COALESCE(b.qty_on_hand,0) qty_on_hand,p.cost_price,
      MAX(s.created_at) last_sale_at FROM products p LEFT JOIN inventory_balances b ON b.product_id=p.id
      LEFT JOIN sale_lines sl ON sl.product_id=p.id LEFT JOIN sales s ON s.id=sl.sale_id
     WHERE p.status='active' GROUP BY p.id HAVING qty_on_hand>0 AND (last_sale_at IS NULL OR last_sale_at<datetime('now','-90 days'))
     ORDER BY qty_on_hand*p.cost_price DESC`,
  );
  if (dormant.length)
    alerts.push(item("dormant_stock", "info", "أصناف لم تتحرك منذ 90 يومًا", "راجع التسعير أو العروض أو قرارات إعادة الشراء.", dormant.length, "inventory", dormant.slice(0, 30)));

  return {
    generated_at: new Date().toISOString(),
    total: alerts.reduce((sum, alert) => sum + alert.count, 0),
    critical: alerts.filter((alert) => alert.severity === "critical").reduce((sum, alert) => sum + alert.count, 0),
    alerts,
  };
}

module.exports = { list };
