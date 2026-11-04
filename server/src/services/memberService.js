const d = require("../db");
const audit = require("./auditService");
function list(q = "") {
  const base =
    "SELECT m.*,c.name_ar category_name FROM members m JOIN membership_categories c ON c.id=m.category_id";
  if (q) {
    const exact = d.all(
      base + " WHERE m.membership_no=? OR m.civil_id=? OR m.phone=?",
      q,
      q,
      q,
    );
    if (exact.length) return exact;
    return d.all(
      base + " WHERE m.name LIKE ? ORDER BY m.name LIMIT 100000",
      "%" + q + "%",
    );
  }
  return d.all(base + " ORDER BY m.name LIMIT 100000");
}
function searchPos(q = "") {
  return list(q).map((member) => ({
    id: member.id,
    membership_no: member.membership_no,
    name: member.name,
    category_id: member.category_id,
    category_name: member.category_name,
    is_eligible_for_discount: member.is_eligible_for_discount,
    status: member.status,
  }));
}
function save(user, body, id) {
  return d.transaction(() => {
    const old = id ? d.get("SELECT * FROM members WHERE id=?", id) : null;
    if (id && !old) d.fail("العضو غير موجود", 404);
    const data = Object.fromEntries(
      [
        "membership_no",
        "civil_id",
        "name",
        "category_id",
        "phone",
        "email",
        "workplace",
        "is_eligible_for_discount",
        "status",
      ]
        .filter((k) => body[k] !== undefined)
        .map((k) => [k, body[k]]),
    );
    for (const k of ["membership_no", "civil_id", "name", "category_id"])
      if (!id || data[k] !== undefined) data[k] = d.required(data[k], k);
    if (data.is_eligible_for_discount !== undefined)
      data.is_eligible_for_discount = Number(data.is_eligible_for_discount)
        ? 1
        : 0;
    const row = id
      ? d.update("members", id, data)
      : d.insert("members", { id: d.id(), ...data });
    audit.record(user, "member_save", "members", row.id, old, row);
    return row;
  });
}
module.exports = {
  list,
  searchPos,
  save,
  categories: () => d.all("SELECT * FROM membership_categories ORDER BY code"),
};
