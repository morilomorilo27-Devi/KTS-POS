const { DatabaseSync } = require("node:sqlite");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const config = require("./config");
fs.mkdirSync(path.dirname(config.database), { recursive: true });
const db = new DatabaseSync(config.database);
// The original DDL is extracted without altering columns or constraints.
db.exec(fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8"));
const hash = (password) =>
  crypto.pbkdf2Sync(password, config.salt, 10000, 64, "sha512").toString("hex");
// Correct the conflicting illustrative hash once, using the documented passwords.
if (
  !db
    .prepare(
      "SELECT 1 FROM system_configurations WHERE config_key='seed_passwords_initialized'",
    )
    .get()
) {
  db.prepare("UPDATE users SET password_hash=? WHERE id=?").run(
    hash("admin123"),
    "usr-admin",
  );
  db.prepare("UPDATE users SET password_hash=? WHERE id=?").run(
    hash("cashier123"),
    "usr-cashier-1",
  );
  db.prepare(
    "INSERT INTO system_configurations(config_key,config_value) VALUES (?,?)",
  ).run("seed_passwords_initialized", "1");
}
const permissionNames = {
  pos_sale: "البيع",
  pos_return: "المرتجعات",
  pos_hold_cart: "تعليق السلات",
  catalog_manage: "إدارة الأصناف والفئات",
  inventory_manage: "إدارة المخزون",
  members_manage: "إدارة الأعضاء",
  suppliers_manage: "إدارة الموردين",
  discounts_manage: "إدارة الخصومات",
  shifts_manage: "إدارة الورديات والجداول",
  reports_view: "التقارير",
  audit_view: "سجل التدقيق",
  users_manage: "إدارة المستخدمين",
  import_data: "استيراد البيانات",
  settings_manage: "إعدادات النظام",
};
for (const [key, value] of Object.entries({
  branch_name: "مكتبة القرطاسية",
  branch_phone: "",
  branch_address: "",
  return_policy: "يرجى الاحتفاظ بالفاتورة وتقديمها عند طلب الاسترجاع.",
  return_window_days: "14",
  logo_url: "images/logo.png",
}))
  run(
    "INSERT OR IGNORE INTO system_configurations(config_key,config_value) VALUES(?,?)",
    key,
    value,
  );
for (const [code, name] of Object.entries(permissionNames)) {
  db.prepare(
    "INSERT OR IGNORE INTO permissions(id,code,name_ar,module) VALUES(?,?,?,?)",
  ).run(code, code, name, code.split("_")[0]);
  for (const role of ["role-admin", "role-supervisor", "role-cashier"]) {
    const allowed =
      role === "role-admin" ||
      (role === "role-cashier"
        ? code.startsWith("pos_")
        : !["users_manage", "settings_manage", "discounts_manage"].includes(
            code,
          ));
    if (allowed)
      db.prepare("INSERT OR IGNORE INTO role_permissions VALUES(?,?)").run(
        role,
        code,
      );
  }
}
db.exec(`CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit_logs BEGIN SELECT RAISE(ABORT,'Audit logs are immutable'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit_logs BEGIN SELECT RAISE(ABORT,'Audit logs are immutable'); END;`);
function all(sql, ...args) {
  return db.prepare(sql).all(...args);
}
function get(sql, ...args) {
  return db.prepare(sql).get(...args);
}
function run(sql, ...args) {
  return db.prepare(sql).run(...args);
}
function transaction(fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const value = fn();
    db.exec("COMMIT");
    return value;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
function insert(table, data) {
  const keys = Object.keys(data);
  run(
    `INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`,
    ...keys.map((k) => data[k] ?? null),
  );
  return data;
}
function update(table, id, data) {
  const keys = Object.keys(data);
  if (keys.length)
    run(
      `UPDATE ${table} SET ${keys.map((k) => `${k}=?`).join(",")} WHERE id=?`,
      ...keys.map((k) => data[k] ?? null),
      id,
    );
  return get(`SELECT * FROM ${table} WHERE id=?`, id);
}
const id = () => crypto.randomUUID();
const money = (v) => Math.round(Number(v) * 1000) / 1000;
function fail(message, status = 400) {
  const e = new Error(message);
  e.status = status;
  throw e;
}
function number(value, name, min = 0, positive = false) {
  const n = Number(value);
  if (
    value === "" ||
    value === null ||
    value === undefined ||
    !Number.isFinite(n) ||
    n < min ||
    (positive && n === 0)
  )
    fail(`قيمة غير صالحة: ${name}`);
  return n;
}
function required(value, name) {
  if (typeof value !== "string" || !value.trim()) fail(`الحقل مطلوب: ${name}`);
  return value.trim();
}
function day() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuwait",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
function sequence(table, column, prefix) {
  const base = `${prefix}-${day().replaceAll("-", "")}-`;
  const previous = get(
    `SELECT MAX(CAST(SUBSTR(${column}, ?) AS INTEGER)) AS n FROM ${table} WHERE ${column} LIKE ?`,
    base.length + 1,
    `${base}%`,
  );
  return (
    base +
    String(Number(previous?.n || 0) + 1).padStart(4, "0")
  );
}
module.exports = {
  db,
  all,
  get,
  run,
  insert,
  update,
  transaction,
  id,
  money,
  fail,
  number,
  required,
  day,
  sequence,
  hash,
};
