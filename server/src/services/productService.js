const d = require("../db");
const audit = require("./auditService");
const inv = require("./inventoryService");
const accounting = require("./accountingService");
function supplierLinks(productId) {
  const links = new Map();
  for (const row of d.all(
    `SELECT ps.product_id,s.id,s.code,s.name,s.status
     FROM product_suppliers ps JOIN suppliers s ON s.id=ps.supplier_id
     ${productId ? "WHERE ps.product_id=?" : ""}
     ORDER BY s.name`,
    ...(productId ? [productId] : []),
  )) {
    if (!links.has(row.product_id)) links.set(row.product_id, []);
    links.get(row.product_id).push({
      id: row.id,
      code: row.code,
      name: row.name,
      status: row.status,
    });
  }
  return links;
}
function hydrate(rows, includeSuppliers = false) {
  const codes = new Map();
  for (const r of d.all(
    `SELECT product_id,barcode FROM product_barcodes ${rows.length === 1 ? "WHERE product_id=?" : ""} ORDER BY is_primary DESC`,
    ...(rows.length === 1 ? [rows[0].id] : []),
  )) {
    if (!codes.has(r.product_id)) codes.set(r.product_id, []);
    codes.get(r.product_id).push(r.barcode);
  }
  const links = includeSuppliers
    ? supplierLinks(rows.length === 1 ? rows[0].id : null)
    : null;
  return rows.map((r) => {
    const suppliers = links?.get(r.id) || [];
    return {
      ...r,
      barcodes: codes.get(r.id) || [],
      ...(includeSuppliers
        ? {
            supplier_ids: suppliers.map((supplier) => supplier.id),
            suppliers,
            supplier_names: suppliers
              .map((supplier) => supplier.name)
              .join("، "),
          }
        : {}),
    };
  });
}
function getProduct(id, includeSuppliers = true) {
  const p = d.get(
    "SELECT p.*,c.name_ar category_name,COALESCE(b.qty_on_hand,0) qty_on_hand FROM products p JOIN product_categories c ON c.id=p.category_id LEFT JOIN inventory_balances b ON b.product_id=p.id WHERE p.id=?",
    id,
  );
  return p ? hydrate([p], includeSuppliers)[0] : null;
}
function list({
  q = "",
  category_id = "",
  include_inactive = false,
  include_suppliers = false,
  limit = 500,
} = {}) {
  if (q) {
    const exact =
      d.get("SELECT id FROM products WHERE sku=?", q) ||
      d.get("SELECT product_id id FROM product_barcodes WHERE barcode=?", q);
    if (exact) {
      const p = getProduct(exact.id, include_suppliers);
      return p &&
        (include_inactive || p.status === "active") &&
        (!category_id || p.category_id === category_id)
        ? [p]
        : [];
    }
  }
  const rows = d.all(
    `SELECT p.*,c.name_ar category_name,COALESCE(b.qty_on_hand,0) qty_on_hand FROM products p JOIN product_categories c ON c.id=p.category_id LEFT JOIN inventory_balances b ON b.product_id=p.id WHERE (?=1 OR p.status='active') AND (?='' OR p.category_id=?) AND (?='' OR p.name_ar LIKE ? OR p.name_en LIKE ? OR p.sku LIKE ?) ORDER BY p.name_ar LIMIT ?`,
    include_inactive ? 1 : 0,
    category_id,
    category_id,
    q,
    "%" + q + "%",
    "%" + q + "%",
    "%" + q + "%",
    Math.min(Number(limit) || 500, 100000),
  );
  return hydrate(rows, include_suppliers);
}
const fields = [
  "sku",
  "name_ar",
  "name_en",
  "category_id",
  "unit",
  "cost_price",
  "sale_price",
  "min_price",
  "min_stock_alert",
  "is_discountable",
  "status",
  "image_url",
];
function save(user, body, id) {
  return d.transaction(() => {
    const old = id ? d.get("SELECT * FROM products WHERE id=?", id) : null;
    if (id && !old) d.fail("الصنف غير موجود", 404);
    const oldSupplierIds = id
      ? d
          .all(
            "SELECT supplier_id FROM product_suppliers WHERE product_id=? ORDER BY supplier_id",
            id,
          )
          .map((link) => link.supplier_id)
      : [];
    const data = Object.fromEntries(
      fields.filter((k) => body[k] !== undefined).map((k) => [k, body[k]]),
    );
    for (const k of ["sku", "name_ar", "category_id"])
      if (!id || data[k] !== undefined) data[k] = d.required(data[k], k);
    for (const k of ["sale_price", "cost_price", "min_stock_alert"])
      if (data[k] !== undefined) data[k] = d.number(data[k], k);
    if (!id && data.sale_price === undefined) d.fail("سعر البيع مطلوب");
    if (data.min_price !== undefined)
      data.min_price =
        data.min_price === "" ? null : d.number(data.min_price, "أقل سعر");
    if (
      (data.min_price ?? old?.min_price ?? 0) >
      (data.sale_price ?? old?.sale_price)
    )
      d.fail("أقل سعر يتجاوز سعر البيع");
    if (data.is_discountable !== undefined)
      data.is_discountable = Number(data.is_discountable) ? 1 : 0;
    const row = id
      ? d.update("products", id, data)
      : d.insert("products", { id: d.id(), ...data });
    if (body.barcodes !== undefined) {
      const codes = Array.isArray(body.barcodes)
        ? body.barcodes
        : JSON.parse(body.barcodes);
      if (!Array.isArray(codes)) d.fail("الباركودات غير صالحة");
      d.run("DELETE FROM product_barcodes WHERE product_id=?", row.id);
      for (const [i, code] of [
        ...new Set(
          codes
            .map(String)
            .map((s) => s.trim())
            .filter(Boolean),
        ),
      ].entries())
        d.insert("product_barcodes", {
          id: d.id(),
          product_id: row.id,
          barcode: code,
          is_primary: i === 0 ? 1 : 0,
        });
    }
    if (body.supplier_ids !== undefined) {
      let supplierIds = body.supplier_ids;
      if (!Array.isArray(supplierIds)) {
        try {
          supplierIds = JSON.parse(supplierIds);
        } catch {
          d.fail("قائمة الموردين غير صالحة");
        }
      }
      if (!Array.isArray(supplierIds)) d.fail("قائمة الموردين غير صالحة");
      supplierIds = [...new Set(supplierIds.map(String).filter(Boolean))];
      if (supplierIds.length) {
        const placeholders = supplierIds.map(() => "?").join(",");
        const found = d.all(
          `SELECT id FROM suppliers WHERE id IN (${placeholders})`,
          ...supplierIds,
        );
        if (found.length !== supplierIds.length)
          d.fail("أحد الموردين المحددين غير موجود");
      }
      d.run("DELETE FROM product_suppliers WHERE product_id=?", row.id);
      for (const supplierId of supplierIds)
        d.run(
          "INSERT INTO product_suppliers(product_id,supplier_id) VALUES(?,?)",
          row.id,
          supplierId,
        );
    }
    if (!id) {
      d.insert("inventory_balances", { id: d.id(), product_id: row.id });
      const initial =
        body.initial_qty === undefined
          ? 0
          : d.number(body.initial_qty, "المخزون الأولي");
      if (initial > 0) {
        const movement = inv.move(
          user,
          row.id,
          initial,
          "initial",
          row.id,
          "رصيد أولي",
        );
        const value = d.money(initial * (data.cost_price || 0));
        if (value)
          accounting.post(user, "initial_stock", movement.id, "مخزون افتتاحي", [
            { account_code: "1200", debit: value },
            { account_code: "3100", credit: value },
          ]);
      }
    }
    if (
      id &&
      data.cost_price !== undefined &&
      data.cost_price !== old.cost_price
    ) {
      const balance =
        d.get(
          "SELECT qty_on_hand FROM inventory_balances WHERE product_id=?",
          id,
        )?.qty_on_hand || 0;
      const delta = d.money((data.cost_price - old.cost_price) * balance);
      if (delta)
        accounting.post(
          user,
          "cost_revaluation",
          d.id(),
          "تعديل تكلفة " + row.name_ar,
          delta > 0
            ? [
                { account_code: "1200", debit: delta },
                { account_code: "5200", credit: delta },
              ]
            : [
                { account_code: "5200", debit: -delta },
                { account_code: "1200", credit: -delta },
              ],
        );
    }
    const saved = getProduct(row.id);
    audit.record(
      user,
      id ? "product_update" : "product_create",
      "products",
      row.id,
      old ? { ...old, supplier_ids: oldSupplierIds } : null,
      saved,
    );
    return saved;
  });
}
function remove(user, id) {
  return d.transaction(() => {
    const old = d.get("SELECT * FROM products WHERE id=?", id);
    if (!old) d.fail("الصنف غير موجود", 404); // Preserve inventory ledger and historical references by deactivation.
    d.update("products", id, { status: "inactive" });
    audit.record(user, "product_delete", "products", id, old, {
      status: "inactive",
    });
    return { success: true };
  });
}
module.exports = { list, getProduct, save, remove };
