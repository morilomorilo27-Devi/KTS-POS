const d = require("../db");
const audit = require("./auditService");
const inventory = require("./inventoryService");
const accounting = require("./accountingService");
const suppliers = require("./supplierService");

const round = (value, digits = 3) =>
  Number(Number(value || 0).toFixed(digits));

function reorderSuggestions({ days = 30, review_days = 7 } = {}) {
  days = Math.max(7, Math.min(365, Number(days) || 30));
  review_days = Math.max(1, Math.min(90, Number(review_days) || 7));
  const products = d.all(
    `SELECT p.id,p.sku,p.name_ar,p.cost_price,p.sale_price,p.min_stock_alert,
      COALESCE(b.qty_on_hand,0) qty_on_hand,
      COALESCE((SELECT SUM(sl.qty) FROM sale_lines sl JOIN sales s ON s.id=sl.sale_id
        WHERE sl.product_id=p.id AND s.status!='voided' AND s.created_at>=datetime('now',?)),0) sold_qty,
      COALESCE((SELECT SUM(pol.ordered_qty-pol.received_qty) FROM purchase_order_lines pol
        JOIN purchase_orders po ON po.id=pol.order_id WHERE pol.product_id=p.id
        AND po.status IN ('sent','partial')),0) on_order
     FROM products p LEFT JOIN inventory_balances b ON b.product_id=p.id
     WHERE p.status='active' ORDER BY p.name_ar`,
    `-${days} days`,
  );
  return products
    .map((product) => {
      const terms = d.all(
        `SELECT s.id supplier_id,s.name supplier_name,s.code supplier_code,
          COALESCE(t.lead_time_days,3) lead_time_days,t.last_unit_cost,
          COALESCE(t.deliveries_total,0) deliveries_total,
          COALESCE(t.deliveries_on_time,0) deliveries_on_time,
          COALESCE(t.min_order_qty,1) min_order_qty,COALESCE(t.preferred,0) preferred
         FROM product_suppliers ps JOIN suppliers s ON s.id=ps.supplier_id
         LEFT JOIN supplier_product_terms t ON t.product_id=ps.product_id AND t.supplier_id=ps.supplier_id
         WHERE ps.product_id=? AND s.status='active'
         ORDER BY preferred DESC,
           CASE WHEN t.last_unit_cost IS NULL THEN 1 ELSE 0 END,t.last_unit_cost,s.name`,
        product.id,
      );
      const best = terms[0] || null;
      const average = round(product.sold_qty / days);
      const lead = round(best?.lead_time_days ?? 3, 1);
      const expected = round(average * lead);
      const safety = Math.max(
        Number(product.min_stock_alert || 0),
        Math.ceil(average * 2),
      );
      const reorderPoint = round(expected + safety);
      let suggested = Math.max(
        0,
        Math.ceil(
          reorderPoint + average * review_days - product.qty_on_hand - product.on_order,
        ),
      );
      if (best && suggested > 0)
        suggested = Math.max(suggested, Number(best.min_order_qty || 1));
      return {
        ...product,
        average_daily_sales: average,
        supplier_id: best?.supplier_id || null,
        supplier_name: best?.supplier_name || null,
        supplier_code: best?.supplier_code || null,
        lead_time_days: lead,
        safety_stock: safety,
        expected_during_lead_time: expected,
        reorder_point: reorderPoint,
        suggested_order_qty: round(suggested),
        supplier_options: terms.map((term) => ({
          ...term,
          compliance_pct: term.deliveries_total
            ? round((term.deliveries_on_time / term.deliveries_total) * 100, 1)
            : null,
        })),
        message: suggested
          ? `بقي من الصنف ${round(product.qty_on_hand)}، ومتوسط بيعه ${average} يوميًا، والمورد يحتاج ${lead} أيام. الكمية المقترحة للطلب: ${round(suggested)}.`
          : "المخزون يغطي الطلب المتوقع حاليًا.",
      };
    })
    .filter((row) => row.suggested_order_qty > 0)
    .sort(
      (a, b) =>
        b.suggested_order_qty - a.suggested_order_qty ||
        a.name_ar.localeCompare(b.name_ar, "ar"),
    );
}

function createRequest(user, body) {
  if (!Array.isArray(body.items) || !body.items.length)
    d.fail("أصناف طلب الشراء مطلوبة");
  return d.transaction(() => {
    const request = d.insert("procurement_requests", {
      id: d.id(),
      request_no: d.sequence("procurement_requests", "request_no", "PR"),
      requested_by: user.id,
      notes: body.notes || null,
    });
    for (const item of body.items) {
      const product = d.get("SELECT id FROM products WHERE id=?", item.product_id);
      if (!product) d.fail("الصنف غير موجود");
      const qty = d.number(item.qty, "الكمية", 0, true);
      d.insert("procurement_request_lines", {
        id: d.id(),
        request_id: request.id,
        product_id: item.product_id,
        requested_qty: qty,
        suggested_supplier_id: item.supplier_id || null,
        reason: item.reason || null,
      });
    }
    audit.record(user, "procurement_request_create", "procurement_requests", request.id, null, request);
    return requestDetails(request.id);
  });
}

function requestDetails(id) {
  const row = d.get(
    `SELECT r.*,u.full_name requested_by_name,a.full_name approved_by_name
     FROM procurement_requests r JOIN users u ON u.id=r.requested_by
     LEFT JOIN users a ON a.id=r.approved_by WHERE r.id=?`,
    id,
  );
  if (!row) d.fail("طلب الشراء غير موجود", 404);
  return {
    ...row,
    lines: d.all(
      `SELECT l.*,p.sku,p.name_ar,s.name supplier_name FROM procurement_request_lines l
       JOIN products p ON p.id=l.product_id LEFT JOIN suppliers s ON s.id=l.suggested_supplier_id
       WHERE l.request_id=? ORDER BY p.name_ar`,
      id,
    ),
  };
}

function requests() {
  return d.all(
    `SELECT r.*,u.full_name requested_by_name,a.full_name approved_by_name,
      (SELECT COUNT(*) FROM procurement_request_lines l WHERE l.request_id=r.id) items_count
     FROM procurement_requests r JOIN users u ON u.id=r.requested_by
     LEFT JOIN users a ON a.id=r.approved_by ORDER BY r.created_at DESC`,
  );
}

function approveRequest(user, id) {
  return d.transaction(() => {
    const old = d.get("SELECT * FROM procurement_requests WHERE id=?", id);
    if (!old) d.fail("طلب الشراء غير موجود", 404);
    if (old.status !== "draft") d.fail("طلب الشراء ليس في حالة مسودة");
    d.run(
      "UPDATE procurement_requests SET status='approved',approved_by=?,approved_at=datetime('now') WHERE id=?",
      user.id,
      id,
    );
    const row = d.get("SELECT * FROM procurement_requests WHERE id=?", id);
    audit.record(user, "procurement_request_approve", "procurement_requests", id, old, row);
    return requestDetails(id);
  });
}

function createQuote(user, body) {
  if (!Array.isArray(body.items) || !body.items.length) d.fail("بنود العرض مطلوبة");
  return d.transaction(() => {
    const supplier = d.get("SELECT * FROM suppliers WHERE id=? AND status='active'", body.supplier_id);
    if (!supplier) d.fail("المورد غير متاح");
    const quote = d.insert("supplier_quotes", {
      id: d.id(),
      quote_no: d.sequence("supplier_quotes", "quote_no", "RFQ"),
      request_id: body.request_id || null,
      supplier_id: supplier.id,
      valid_until: body.valid_until || null,
      lead_time_days: d.number(body.lead_time_days ?? 3, "مدة التوريد"),
      notes: body.notes || null,
      created_by: user.id,
    });
    for (const item of body.items)
      d.insert("supplier_quote_lines", {
        id: d.id(),
        quote_id: quote.id,
        product_id: item.product_id,
        qty: d.number(item.qty, "الكمية", 0, true),
        unit_cost: d.money(d.number(item.unit_cost, "سعر الوحدة")),
      });
    audit.record(user, "supplier_quote_create", "supplier_quotes", quote.id, null, quote);
    return quote;
  });
}

function quotes(requestId) {
  const where = requestId ? "WHERE q.request_id=?" : "";
  return d.all(
    `SELECT q.*,s.name supplier_name,
      (SELECT ROUND(SUM(l.qty*l.unit_cost),3) FROM supplier_quote_lines l WHERE l.quote_id=q.id) total,
      (SELECT ROUND(AVG(CASE WHEN t.deliveries_total>0 THEN 100.0*t.deliveries_on_time/t.deliveries_total END),1)
       FROM supplier_product_terms t WHERE t.supplier_id=q.supplier_id) compliance_pct
     FROM supplier_quotes q JOIN suppliers s ON s.id=q.supplier_id ${where}
     ORDER BY q.created_at DESC`,
    ...(requestId ? [requestId] : []),
  );
}

function createOrderFromQuote(user, id) {
  const quote = d.get("SELECT * FROM supplier_quotes WHERE id=?", id);
  if (!quote) d.fail("عرض المورد غير موجود", 404);
  if (quote.status !== "received") d.fail("عرض المورد غير قابل للاختيار");
  if (quote.valid_until && quote.valid_until < d.day()) d.fail("انتهت صلاحية العرض");
  const lines = d.all("SELECT * FROM supplier_quote_lines WHERE quote_id=?", id);
  const expected = new Date(Date.now() + Number(quote.lead_time_days || 0) * 86400000)
    .toISOString()
    .slice(0, 10);
  const order = createOrder(user, {
    request_id: quote.request_id,
    quote_id: quote.id,
    supplier_id: quote.supplier_id,
    expected_at: expected,
    approve: true,
    notes: `أُنشئ من عرض المورد ${quote.quote_no}`,
    items: lines.map((line) => ({
      product_id: line.product_id,
      qty: line.qty,
      unit_cost: line.unit_cost,
    })),
  });
  d.run("UPDATE supplier_quotes SET status='selected' WHERE id=?", id);
  if (quote.request_id)
    d.run(
      "UPDATE supplier_quotes SET status='rejected' WHERE request_id=? AND id<>? AND status='received'",
      quote.request_id,
      id,
    );
  audit.record(user, "supplier_quote_select", "supplier_quotes", id, quote, {
    ...quote,
    status: "selected",
    order_id: order.id,
  });
  return order;
}

function createOrder(user, body) {
  if (!Array.isArray(body.items) || !body.items.length) d.fail("بنود أمر الشراء مطلوبة");
  return d.transaction(() => {
    const supplier = d.get("SELECT * FROM suppliers WHERE id=? AND status='active'", body.supplier_id);
    if (!supplier) d.fail("المورد غير متاح");
    const items = body.items.map((item) => ({
      product_id: item.product_id,
      qty: d.number(item.qty, "الكمية", 0, true),
      unit_cost: d.money(d.number(item.unit_cost ?? 0, "سعر الوحدة")),
    }));
    const total = d.money(items.reduce((sum, item) => sum + item.qty * item.unit_cost, 0));
    const order = d.insert("purchase_orders", {
      id: d.id(),
      order_no: d.sequence("purchase_orders", "order_no", "PO"),
      request_id: body.request_id || null,
      quote_id: body.quote_id || null,
      supplier_id: supplier.id,
      expected_at: body.expected_at || null,
      total,
      notes: body.notes || null,
      created_by: user.id,
      approved_by: body.approve ? user.id : null,
      status: body.approve ? "sent" : "draft",
      ordered_at: body.approve ? new Date().toISOString() : null,
    });
    for (const item of items) {
      if (!d.get("SELECT id FROM products WHERE id=?", item.product_id)) d.fail("الصنف غير موجود");
      d.insert("purchase_order_lines", {
        id: d.id(),
        order_id: order.id,
        product_id: item.product_id,
        ordered_qty: item.qty,
        unit_cost: item.unit_cost,
      });
      d.run("INSERT OR IGNORE INTO product_suppliers(product_id,supplier_id) VALUES(?,?)", item.product_id, supplier.id);
    }
    if (body.request_id)
      d.run("UPDATE procurement_requests SET status='ordered' WHERE id=?", body.request_id);
    audit.record(user, "purchase_order_create", "purchase_orders", order.id, null, order);
    return orderDetails(order.id);
  });
}

function createOrdersFromSuggestions(user, body) {
  if (!Array.isArray(body.items) || !body.items.length) d.fail("حدد اقتراحًا واحدًا على الأقل");
  const suggestions = new Map(reorderSuggestions({ days: body.days }).map((row) => [row.id, row]));
  const selected = body.items.map((item) => {
    const suggestion = suggestions.get(item.product_id);
    if (!suggestion) d.fail("اقتراح إعادة الطلب غير متاح");
    const supplierId = item.supplier_id || suggestion.supplier_id;
    if (!supplierId) d.fail(`الصنف ${suggestion.name_ar} غير مرتبط بمورد`);
    const option = suggestion.supplier_options.find((entry) => entry.supplier_id === supplierId);
    return {
      suggestion,
      supplier_id: supplierId,
      qty: d.number(item.qty ?? suggestion.suggested_order_qty, "الكمية", 0, true),
      unit_cost: d.money(item.unit_cost ?? option?.last_unit_cost ?? suggestion.cost_price),
    };
  });
  const groups = Map.groupBy(selected, (item) => item.supplier_id);
  const orders = [];
  for (const [supplierId, items] of groups)
    orders.push(
      createOrder(user, {
        supplier_id: supplierId,
        approve: true,
        notes: "أُنشئ من اقتراحات إعادة الطلب الذكية",
        items: items.map((item) => ({
          product_id: item.suggestion.id,
          qty: item.qty,
          unit_cost: item.unit_cost,
        })),
      }),
    );
  return orders;
}

function orderDetails(id) {
  const row = d.get(
    `SELECT o.*,s.name supplier_name,s.code supplier_code,u.full_name created_by_name
     FROM purchase_orders o JOIN suppliers s ON s.id=o.supplier_id
     JOIN users u ON u.id=o.created_by WHERE o.id=?`,
    id,
  );
  if (!row) d.fail("أمر الشراء غير موجود", 404);
  return {
    ...row,
    lines: d.all(
      `SELECT l.*,p.sku,p.name_ar FROM purchase_order_lines l
       JOIN products p ON p.id=l.product_id WHERE l.order_id=? ORDER BY p.name_ar`,
      id,
    ),
  };
}

function orders() {
  return d.all(
    `SELECT o.*,s.name supplier_name,u.full_name created_by_name,
      (SELECT COUNT(*) FROM purchase_order_lines l WHERE l.order_id=o.id) items_count
     FROM purchase_orders o JOIN suppliers s ON s.id=o.supplier_id
     JOIN users u ON u.id=o.created_by ORDER BY o.created_at DESC`,
  );
}

function sendOrder(user, id) {
  return d.transaction(() => {
    const old = d.get("SELECT * FROM purchase_orders WHERE id=?", id);
    if (!old) d.fail("أمر الشراء غير موجود", 404);
    if (old.status !== "draft") d.fail("يمكن إرسال أمر شراء مسودة فقط");
    d.run("UPDATE purchase_orders SET status='sent',approved_by=?,ordered_at=datetime('now') WHERE id=?", user.id, id);
    const row = d.get("SELECT * FROM purchase_orders WHERE id=?", id);
    audit.record(user, "purchase_order_send", "purchase_orders", id, old, row);
    return orderDetails(id);
  });
}

function receive(user, orderId, body) {
  return d.transaction(() => {
    const order = orderDetails(orderId);
    if (!['sent','partial'].includes(order.status)) d.fail("أمر الشراء غير قابل للاستلام");
    if (!Array.isArray(body.items) || !body.items.length) d.fail("بنود الاستلام مطلوبة");
    const receipt = d.insert("goods_receipts", {
      id: d.id(),
      receipt_no: d.sequence("goods_receipts", "receipt_no", "GRN"),
      order_id: order.id,
      received_by: user.id,
      notes: body.notes || null,
      received_at: new Date().toISOString(),
    });
    for (const item of body.items) {
      const line = d.get("SELECT * FROM purchase_order_lines WHERE id=? AND order_id=?", item.order_line_id, order.id);
      if (!line) d.fail("بند أمر الشراء غير موجود");
      const accepted = d.number(item.accepted_qty ?? 0, "المستلم");
      const damaged = d.number(item.damaged_qty ?? 0, "التالف");
      const short = d.number(item.short_qty ?? 0, "الناقص");
      const remaining = line.ordered_qty - line.received_qty;
      if (accepted + damaged > remaining) d.fail("كمية الاستلام تتجاوز المتبقي");
      d.insert("goods_receipt_lines", {
        id: d.id(),
        receipt_id: receipt.id,
        order_line_id: line.id,
        accepted_qty: accepted,
        damaged_qty: damaged,
        short_qty: short,
        notes: item.notes || null,
      });
      if (accepted > 0) {
        const product = d.get("SELECT * FROM products WHERE id=?", line.product_id);
        const balance = d.get("SELECT qty_on_hand FROM inventory_balances WHERE product_id=?", line.product_id)?.qty_on_hand || 0;
        const denominator = balance + accepted;
        const cost = denominator ? round((balance * product.cost_price + accepted * line.unit_cost) / denominator, 6) : line.unit_cost;
        inventory.move(user, line.product_id, accepted, "purchase", receipt.id, `استلام ${receipt.receipt_no}`);
        d.update("products", line.product_id, { cost_price: cost });
      }
      d.run(
        "UPDATE purchase_order_lines SET received_qty=received_qty+?,damaged_qty=damaged_qty+?,short_qty=short_qty+? WHERE id=?",
        accepted,
        damaged,
        short,
        line.id,
      );
      const onTime = !order.expected_at || String(receipt.received_at).slice(0, 10) <= order.expected_at;
      const observedLead = order.ordered_at
        ? Math.max(0, (Date.parse(receipt.received_at) - Date.parse(order.ordered_at)) / 86400000)
        : 3;
      d.run(
        `INSERT INTO supplier_product_terms(product_id,supplier_id,lead_time_days,last_unit_cost,last_purchase_at,deliveries_total,deliveries_on_time)
         VALUES(?,?,?,?,datetime('now'),1,?) ON CONFLICT(product_id,supplier_id) DO UPDATE SET
         lead_time_days=ROUND((lead_time_days*deliveries_total+excluded.lead_time_days)/(deliveries_total+1),1),
         last_unit_cost=excluded.last_unit_cost,last_purchase_at=datetime('now'),
         deliveries_total=deliveries_total+1,deliveries_on_time=deliveries_on_time+excluded.deliveries_on_time,updated_at=datetime('now')`,
        line.product_id,
        order.supplier_id,
        observedLead,
        line.unit_cost,
        onTime ? 1 : 0,
      );
    }
    const remaining = d.get("SELECT COALESCE(SUM(ordered_qty-received_qty),0) n FROM purchase_order_lines WHERE order_id=?", order.id).n;
    d.run("UPDATE purchase_orders SET status=? WHERE id=?", remaining > 0 ? "partial" : "received", order.id);
    audit.record(user, "goods_receipt_post", "goods_receipts", receipt.id, null, { ...receipt, items: body.items });
    return { ...receipt, order: orderDetails(order.id) };
  });
}

function createInvoice(user, body) {
  return d.transaction(() => {
    const order = orderDetails(body.order_id);
    if (!Array.isArray(body.items) || !body.items.length) d.fail("بنود الفاتورة مطلوبة");
    const items = body.items.map((item) => {
      const line = order.lines.find((entry) => entry.id === item.order_line_id);
      if (!line) d.fail("بند أمر الشراء غير موجود");
      const qty = d.number(item.qty, "الكمية");
      const unitCost = d.money(d.number(item.unit_cost, "سعر الوحدة"));
      return { line, qty, unit_cost: unitCost, line_total: d.money(qty * unitCost) };
    });
    const total = d.money(items.reduce((sum, item) => sum + item.line_total, 0));
    const matched = items.every(
      (item) => item.qty <= item.line.received_qty && item.unit_cost === item.line.unit_cost,
    );
    const invoice = d.insert("supplier_invoices", {
      id: d.id(),
      invoice_no: d.required(body.invoice_no, "رقم فاتورة المورد"),
      order_id: order.id,
      supplier_id: order.supplier_id,
      total,
      match_status: matched ? "matched" : "variance",
      created_by: user.id,
      notes: body.notes || null,
    });
    for (const item of items)
      d.insert("supplier_invoice_lines", {
        id: d.id(),
        invoice_id: invoice.id,
        order_line_id: item.line.id,
        qty: item.qty,
        unit_cost: item.unit_cost,
        line_total: item.line_total,
      });
    audit.record(user, "supplier_invoice_create", "supplier_invoices", invoice.id, null, invoice);
    return invoice;
  });
}

function approveInvoice(user, id) {
  return d.transaction(() => {
    const old = d.get("SELECT * FROM supplier_invoices WHERE id=?", id);
    if (!old) d.fail("فاتورة المورد غير موجودة", 404);
    if (old.match_status !== "matched") d.fail("لا يمكن اعتماد فاتورة بها فروقات قبل مراجعتها");
    if (old.status !== "pending") d.fail("الفاتورة معتمدة مسبقًا");
    d.run("UPDATE supplier_invoices SET status='approved',approved_by=? WHERE id=?", user.id, id);
    const row = d.get("SELECT * FROM supplier_invoices WHERE id=?", id);
    accounting.post(user, "supplier_invoice", row.id, `فاتورة مورد ${row.invoice_no}`, [
      { account_code: "1200", debit: row.total },
      { account_code: "2100", credit: row.total },
    ]);
    audit.record(user, "supplier_invoice_approve", "supplier_invoices", id, old, row);
    return row;
  });
}

function payInvoice(user, id, body) {
  const invoice = d.get("SELECT * FROM supplier_invoices WHERE id=?", id);
  if (!invoice) d.fail("فاتورة المورد غير موجودة", 404);
  if (!["approved", "partially_paid"].includes(invoice.status))
    d.fail("الفاتورة غير قابلة للسداد");
  const amount = d.money(d.number(body.amount, "المبلغ", 0, true));
  if (amount > d.money(invoice.total - invoice.paid_amount))
    d.fail("المبلغ يتجاوز المتبقي");
  const payment = suppliers.pay(user, {
    supplier_id: invoice.supplier_id,
    amount,
    payment_method: body.payment_method,
    notes: `سداد فاتورة ${invoice.invoice_no}`,
  });
  return d.transaction(() => {
    d.insert("supplier_invoice_payment_allocations", {
      id: d.id(),
      invoice_id: invoice.id,
      supplier_payment_id: payment.id,
      amount,
    });
    const paid = d.money(invoice.paid_amount + amount);
    d.run("UPDATE supplier_invoices SET paid_amount=?,status=? WHERE id=?", paid, paid === invoice.total ? "paid" : "partially_paid", id);
    return d.get("SELECT * FROM supplier_invoices WHERE id=?", id);
  });
}

function invoices() {
  return d.all(
    `SELECT i.*,s.name supplier_name,o.order_no FROM supplier_invoices i
     JOIN suppliers s ON s.id=i.supplier_id JOIN purchase_orders o ON o.id=i.order_id
     ORDER BY i.created_at DESC`,
  );
}

module.exports = {
  reorderSuggestions,
  createRequest,
  requestDetails,
  requests,
  approveRequest,
  createQuote,
  quotes,
  createOrderFromQuote,
  createOrder,
  createOrdersFromSuggestions,
  orderDetails,
  orders,
  sendOrder,
  receive,
  createInvoice,
  approveInvoice,
  payInvoice,
  invoices,
};
