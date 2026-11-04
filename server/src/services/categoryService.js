const d = require("../db");
const audit = require("./auditService");
function list() {
  return d.all(
    "SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id=c.id AND p.status='active') products_count FROM product_categories c ORDER BY c.code",
  );
}
function save(user, body, id) {
  return d.transaction(() => {
    const old = id
      ? d.get("SELECT * FROM product_categories WHERE id=?", id)
      : null;
    if (id && !old) d.fail("الفئة غير موجودة", 404);
    const data = Object.fromEntries(
      ["parent_id", "code", "name_ar", "name_en", "image_url", "status"]
        .filter((k) => body[k] !== undefined)
        .map((k) => [k, body[k] || null]),
    );
    if (!id || data.code !== undefined)
      data.code = d.required(data.code, "رمز الفئة");
    if (!id || data.name_ar !== undefined)
      data.name_ar = d.required(data.name_ar, "اسم الفئة");
    let parent = data.parent_id;
    const seen = new Set([id]);
    while (parent) {
      if (seen.has(parent)) d.fail("تسلسل الفئات دائري");
      seen.add(parent);
      parent = d.get(
        "SELECT parent_id FROM product_categories WHERE id=?",
        parent,
      )?.parent_id;
    }
    const row = id
      ? d.update("product_categories", id, data)
      : d.insert("product_categories", { id: d.id(), ...data });
    audit.record(user, "category_save", "product_categories", row.id, old, row);
    return row;
  });
}
module.exports = { list, save };
