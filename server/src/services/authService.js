const crypto = require("node:crypto");
const d = require("../db");
const audit = require("./auditService");
const access = require("./permissionService");
const sessions = new Map();
function profile(id) {
  const u = d.get(
    "SELECT u.id,u.username,u.full_name,u.status,u.role_id,r.code AS role,r.name_ar AS role_name_ar FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=?",
    id,
  );
  if (!u || u.status !== "active") d.fail("الجلسة غير صالحة", 401);
  u.permissions = access.effective(u);
  u.access_revision = access.revision(u.permissions);
  return u;
}
function login(body, ip) {
  const u = d.get(
    "SELECT * FROM users WHERE username=?",
    String(body.username || ""),
  );
  const candidate = Buffer.from(d.hash(String(body.password || "")), "hex");
  if (
    !u ||
    u.status !== "active" ||
    !crypto.timingSafeEqual(candidate, Buffer.from(u.password_hash, "hex"))
  )
    d.fail("اسم المستخدم أو كلمة المرور غير صحيحة", 401);
  const token = "kts_token_" + crypto.randomBytes(32).toString("hex");
  sessions.set(token, { id: u.id, expires: Date.now() + 12 * 3600000 });
  d.run("UPDATE users SET last_login_at=datetime('now') WHERE id=?", u.id);
  audit.record({ id: u.id, ip }, "login", "users", u.id);
  return { success: true, token, user: profile(u.id) };
}
function authenticate(req, res, next) {
  try {
    const token = (req.headers.authorization || "").replace(/^Bearer /, "");
    const s = sessions.get(token);
    if (!s || s.expires < Date.now()) d.fail("يرجى تسجيل الدخول", 401);
    req.user = { ...profile(s.id), ip: req.ip };
    req.token = token;
    res.setHeader("X-KTS-Access-Revision",req.user.access_revision);
    const operation = access.requiredFor(req.method, req.originalUrl.split("?")[0]);
    if(operation) access.assertAllowed(req.user,operation);
    if(req.originalUrl.split('?')[0]==='/api/devices/knet/charge')access.assertAllowed(req.user,'pos_checkout');
    const route=req.originalUrl.split('?')[0];
    if(req.method==='GET' && (/^\/api\/products\/(search|category\/)/.test(route) || route==='/api/categories')) {
      if(!['pos_sale','catalog_manage','inventory_manage','suppliers_manage','members_manage'].some(code=>req.user.permissions.includes(code)))d.fail("لا تملك صلاحية عرض الكتالوج",403);
    }
    next();
  } catch (e) {
    next(e);
  }
}
function permit(code) {
  return (req, res, next) => {
    if (!req.user.permissions.includes(code))
      return next(
        Object.assign(new Error("لا تملك صلاحية تنفيذ هذه العملية"), {
          status: 403,
        }),
      );
    next();
  };
}
module.exports = {
  login,
  authenticate,
  permit,
  profile,
  logout: (token) => sessions.delete(token),
};
