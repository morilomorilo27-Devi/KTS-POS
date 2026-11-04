const express = require("express");
const cors = require("cors");
const multer = require("multer");
const fs = require("node:fs");
const path = require("node:path");
const config = require("./config");
const d = require("./db");
const auth = require("./services/authService");
const access = require("./services/permissionService");
const shift = require("./services/shiftService");
const pos = require("./services/posService");
const product = require("./services/productService");
const category = require("./services/categoryService");
const member = require("./services/memberService");
const supplier = require("./services/supplierService");
const discounts = require("./services/discountEngine");
const returns = require("./services/returnService");
const report = require("./services/reportService");
const audit = require("./services/auditService");
const accounting = require("./services/accountingService");
const inventory = require("./services/inventoryService");
const importer = require("./services/importService");
const sync = require("./services/syncService");
const procurement = require("./services/procurementService");
const cycleCounts = require("./services/cycleCountService");
const exceptions = require("./services/exceptionService");
const memberExperience = require("./services/memberExperienceService");
const devices = require("./services/deviceService");
const receipts = require("./services/receiptService");
const customerDisplay = require("./services/customerDisplayService");
const backups = require("./services/backupService");
const html = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ],
  );
const compression = require("compression");
const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(compression({
  filter: (req, res) => {
    if (req.headers.accept?.includes("text/event-stream")) return false;
    return compression.filter(req, res);
  }
}));
app.use(cors({ origin: false }));
app.use(express.json({ limit: "5mb" }));
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "same-origin");
  next();
});
const uploadDir = path.join(config.client, "images/uploads");
fs.mkdirSync(uploadDir, { recursive: true });
const imageUpload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (req, file, cb) =>
      cb(null, d.id() + path.extname(file.originalname).toLowerCase()),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) =>
    cb(
      null,
      ["image/png", "image/jpeg", "image/webp"].includes(file.mimetype) &&
        [".png", ".jpg", ".jpeg", ".webp"].includes(
          path.extname(file.originalname).toLowerCase(),
        ),
    ),
});
const importUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});
const wrap = (fn) => (req, res, next) =>
  Promise.resolve()
    .then(() => fn(req, res))
    .catch(next);
function endpoint(method, url, permission, fn, status = 200) {
  const middleware = permission ? [auth.permit(permission)] : [];
  app[method](
    url,
    ...middleware,
    wrap(async (req, res) => {
      res.status(status).json(await fn(req));
    }),
  );
}
const attempts = new Map();
// Explicit login handler precedes authentication middleware.
app.post(
  "/api/auth/login",
  wrap((req, res) => {
    const key = req.ip;
    const now = Date.now();
    let a = attempts.get(key);
    if (!a || a.until < now) a = { count: 0, until: now + 60000 };
    if (a.count >= 20) d.fail("محاولات كثيرة، حاول بعد دقيقة", 429);
    a.count++;
    attempts.set(key, a);
    const result = auth.login(req.body, req.ip);
    attempts.delete(key);
    res.json(result);
  }),
);
app.get("/api/health", (req, res) => res.json({ ok: true }));
app.get(
  "/api/public/receipts/:token",
  wrap((req, res) => res.json(receipts.verify(req.params.token))),
);
app.get(
  "/api/public/customer-display",
  wrap((req, res) =>
    res.json({payload:null,paired:true}),
  ),
);
app.get('/api/public/customer-display/:id/events',wrap((req,res)=>customerDisplay.connect(req,res)));
app.get(
  "/r/:token",
  wrap((req, res) => {
    const receipt = receipts.verify(req.params.token);
    res.type("html").send(`<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>التحقق من الفاتورة</title><style>body{margin:0;background:#f4f1eb;color:#17201d;font-family:"Segoe UI",sans-serif}main{max-width:560px;margin:8vh auto;padding:32px;background:#fff;border:1px solid #d8d4cb;border-radius:14px}small{color:#66706b}dl{display:grid;grid-template-columns:1fr 1fr;gap:14px}dt{color:#66706b}dd{margin:4px 0;font-weight:700}.ok{color:#176847}</style><main><small>جمعية المعلمين الكويتية</small><h1>فاتورة موثقة</h1><p class="ok">تم التحقق من صحة الفاتورة في النظام.</p><dl><div><dt>رقم الفاتورة</dt><dd>${html(receipt.invoice_no)}</dd></div><div><dt>التاريخ</dt><dd>${html(receipt.created_at)}</dd></div><div><dt>الصافي</dt><dd>${Number(receipt.net_total).toFixed(3)} د.ك</dd></div><div><dt>الحالة</dt><dd>${html(receipt.status)}</dd></div><div><dt>الكاشير</dt><dd>${html(receipt.cashier_name)}</dd></div><div><dt>العضو</dt><dd>${html(receipt.member_name || "بيع مباشر")}</dd></div></dl></main></html>`);
  }),
);
app.use("/api", auth.authenticate);
endpoint("get", "/api/auth/me", null, (req) => ({
  authenticated: true,
  user: req.user,
}));
endpoint("post", "/api/auth/logout", null, (req) => ({
  success: auth.logout(req.token),
}));
endpoint("get", "/api/shifts/current", null, (req) => shift.current(req.user));
endpoint(
  "post",
  "/api/shifts/open",
  "pos_sale",
  (req) => shift.open(req.user, req.body),
  201,
);
endpoint("post", "/api/shifts/close", "pos_sale", (req) =>
  shift.close(req.user, req.body),
);
endpoint("get", "/api/shifts/schedules", "shifts_manage", () =>
  shift.schedules(),
);
endpoint("post", "/api/shifts/schedules", "shifts_manage", (req) =>
  shift.saveSchedule(req.user, req.body),
);
endpoint("get", "/api/shifts", "shifts_manage", () =>
  d.all(
    "SELECT s.*,u.full_name FROM cashier_shifts s JOIN users u ON u.id=s.user_id ORDER BY opened_at DESC",
  ),
);
endpoint(
  "post",
  "/api/pos/checkout",
  "pos_sale",
  (req) => pos.checkout(req.user, req.body),
  201,
);
endpoint("post", "/api/pos/hold-cart", "pos_hold_cart", (req) =>
  pos.hold(req.user, req.body),
);
endpoint("get", "/api/pos/held-carts", "pos_hold_cart", (req) =>
  pos.held(req.user),
);
endpoint("delete", "/api/pos/held-carts/:id", "pos_hold_cart", (req) =>
  pos.recall(req.user, req.params.id),
);
endpoint("post", "/api/pos/held-carts/merge", "pos_hold_cart", (req) =>
  pos.mergeHeld(req.user, req.body.ids),
);
endpoint("post", "/api/pos/held-carts/:id/transfer", "pos_hold_cart", (req) =>
  pos.transferHeld(req.user, req.params.id, req.body.target_user_id),
);
endpoint("get", "/api/pos/favorites", "pos_sale", (req) =>
  pos.favorites(req.user),
);
endpoint("post", "/api/pos/favorites/:productId", "pos_sale", (req) =>
  pos.toggleFavorite(req.user, req.params.productId),
);
endpoint("get", "/api/pos/last-invoice", "pos_sale", (req) =>
  pos.lastInvoice(req.user),
);
endpoint("post", "/api/pos/invoices/:id/reprint", "pos_sale", (req) =>
  pos.reprint(req.user, req.params.id, req.body.reason),
);
endpoint("get", "/api/pos/transfer-targets", "pos_hold_cart", () =>
  d.all(
    `SELECT DISTINCT u.id,u.full_name FROM users u JOIN cashier_shifts s ON s.user_id=u.id
     WHERE u.status='active' AND s.status='open' ORDER BY u.full_name`,
  ),
);
endpoint("get", "/api/pos/members/:id/summary", "pos_sale", (req) =>
  memberExperience.overview(req.params.id),
);
endpoint("get", "/api/pos/invoices/:id", "pos_sale", (req) => {
  const i = pos.invoice(req.params.id);
  if (
    i.user_id !== req.user.id &&
    !req.user.permissions.includes("reports_view")
  )
    d.fail("غير مصرح", 403);
  return i;
});
endpoint("get", "/api/products/search", null, (req) => product.list(req.query));
endpoint("get", "/api/catalog/supplier-options", "catalog_manage", () =>
  d.all("SELECT id,code,name,status FROM suppliers ORDER BY name"),
);
endpoint("get", "/api/lookups/products", null, (req) => {
  if(!["inventory_adjust","purchases_create","procurement_create","quotes_create","purchase_orders_create","member_benefits_write","discounts_manage","labels_print"].some(code=>req.user.permissions.includes(code)))d.fail("لا تملك صلاحية قائمة الأصناف لهذه العملية",403);
  return product.list({limit:100000});
});
endpoint("get", "/api/lookups/accounts", "journal_create", () =>
  d.all("SELECT code,name_ar FROM accounting_accounts ORDER BY code"),
);
endpoint("get", "/api/products/category/:categoryId", null, (req) =>
  product.list({ category_id: req.params.categoryId }),
);
endpoint("get", "/api/products", "catalog_manage", () =>
  product.list({
    include_inactive: true,
    include_suppliers: true,
    limit: 100000,
  }),
);
endpoint("get", "/api/products/:id", "catalog_manage", (req) => {
  const row = product.getProduct(req.params.id);
  if (!row) d.fail("الصنف غير موجود", 404);
  return row;
});
for (const method of ["post", "put"])
  app[method](
    method === "post" ? "/api/products" : "/api/products/:id",
    auth.permit("catalog_manage"),
    imageUpload.single("image"),
    wrap((req, res) => {
      if (req.file) req.body.image_url = "images/uploads/" + req.file.filename;
      res.json(product.save(req.user, req.body, req.params.id));
    }),
  );
endpoint("delete", "/api/products/:id", "catalog_manage", (req) =>
  product.remove(req.user, req.params.id),
);
endpoint("get", "/api/categories", null, () => category.list());
for (const method of ["post", "put"])
  app[method](
    method === "post" ? "/api/categories" : "/api/categories/:id",
    auth.permit("catalog_manage"),
    imageUpload.single("image"),
    wrap((req, res) => {
      if (req.file) req.body.image_url = "images/uploads/" + req.file.filename;
      res.json(category.save(req.user, req.body, req.params.id));
    }),
  );
endpoint("get", "/api/members/search-pos", null, (req) =>
  member.searchPos(String(req.query.q || "")),
);
endpoint("get", "/api/members", "members_manage", (req) =>
  member.list(req.query.q),
);
endpoint("get", "/api/membership-categories", null, () => member.categories());
endpoint(
  "post",
  "/api/members",
  "members_manage",
  (req) => member.save(req.user, req.body),
  201,
);
endpoint("put", "/api/members/:id", "members_manage", (req) =>
  member.save(req.user, req.body, req.params.id),
);
endpoint("get", "/api/members/:id/experience", "members_manage", (req) =>
  memberExperience.overview(req.params.id),
);
endpoint("put", "/api/members/:id/profile", "members_manage", (req) =>
  memberExperience.saveProfile(req.user, req.params.id, req.body),
);
endpoint("post", "/api/members/:id/dependents", "members_manage", (req) =>
  memberExperience.addDependent(req.user, req.params.id, req.body),
);
endpoint("post", "/api/members/:id/wallet", "members_manage", (req) =>
  memberExperience.walletAdjust(req.user, req.params.id, req.body),
);
endpoint("post", "/api/member-vouchers", "members_manage", (req) =>
  memberExperience.createVoucher(req.user, req.body),
);
endpoint("get", "/api/member-special-prices", "members_manage", () =>
  memberExperience.specialPrices(),
);
endpoint("post", "/api/member-special-prices", "members_manage", (req) =>
  memberExperience.setSpecialPrice(req.user, req.body),
);
endpoint("get", "/api/discounts/rules", null, () =>
  d.all("SELECT * FROM discount_rules WHERE status='active' ORDER BY priority"),
);
endpoint("post", "/api/discounts/calculate-cart", "pos_sale", (req) =>
  discounts.calculate(req.body),
);
function saveDiscount(req) {
  return d.transaction(() => {
    const old = req.params.id
      ? d.get("SELECT * FROM discount_rules WHERE id=?", req.params.id)
      : null;
    if (req.params.id && !old) d.fail("قاعدة الخصم غير موجودة", 404);
    const keys = [
      "code",
      "name_ar",
      "type",
      "value",
      "priority",
      "scope",
      "target_membership_category_id",
      "target_member_id",
      "target_category_id",
      "target_product_id",
      "min_spend",
      "max_discount",
      "can_combine",
      "start_date",
      "end_date",
      "status",
    ];
    const data = Object.fromEntries(
      keys
        .filter((k) => req.body[k] !== undefined)
        .map((k) => [k, req.body[k] === "" ? null : req.body[k]]),
    );
    if (!old || data.value !== undefined)
      data.value = d.number(data.value, "قيمة الخصم", 0, true);
    const type = data.type || old?.type;
    if (type === "percentage" && Number(data.value ?? old?.value) > 100)
      d.fail("النسبة تتجاوز 100%");
    for (const k of ["max_discount", "min_spend"])
      if (data[k] != null) data[k] = d.number(data[k], k);
    if (!old)
      for (const k of ["code", "name_ar", "type", "scope"])
        data[k] = d.required(data[k], k);
    const row = old
      ? d.update("discount_rules", old.id, data)
      : d.insert("discount_rules", { id: d.id(), ...data });
    audit.record(req.user, "discount_save", "discount_rules", row.id, old, row);
    return row;
  });
}
endpoint("get", "/api/discounts", "discounts_manage", () =>
  d.all("SELECT * FROM discount_rules ORDER BY priority"),
);
endpoint("post", "/api/discounts", "discounts_manage", saveDiscount);
endpoint("put", "/api/discounts/:id", "discounts_manage", saveDiscount);
endpoint("get", "/api/returns/verify-invoice/:invoiceNo", "pos_return", (req) =>
  returns.verify(req.params.invoiceNo),
);
endpoint(
  "post",
  "/api/returns",
  "pos_return",
  (req) => returns.create(req.user, req.body),
  201,
);
endpoint("get", "/api/inventory", "inventory_manage", () => inventory.list());
endpoint("get", "/api/inventory/movements", "inventory_manage", () =>
  inventory.movements(),
);
endpoint("post", "/api/inventory/adjust", "inventory_manage", (req) =>
  inventory.adjust(req.user, req.body),
);
endpoint("get", "/api/suppliers", "suppliers_manage", () => supplier.list());
endpoint(
  "post",
  "/api/suppliers",
  "suppliers_manage",
  (req) => supplier.save(req.user, req.body),
  201,
);
endpoint("put", "/api/suppliers/:id", "suppliers_manage", (req) =>
  supplier.save(req.user, req.body, req.params.id),
);
endpoint("get", "/api/purchases", "suppliers_manage", () =>
  supplier.purchases(),
);
endpoint(
  "post",
  "/api/purchases",
  "suppliers_manage",
  (req) => supplier.purchase(req.user, req.body),
  201,
);
endpoint("post", "/api/suppliers/payments", "suppliers_manage", (req) =>
  supplier.pay(req.user, req.body),
);
endpoint("get", "/api/reorder-suggestions", "inventory_manage", (req) =>
  procurement.reorderSuggestions(req.query),
);
endpoint("post", "/api/reorder-suggestions/create-orders", "suppliers_manage", (req) =>
  procurement.createOrdersFromSuggestions(req.user, req.body),
);
endpoint("get", "/api/procurement/requests", "suppliers_manage", () =>
  procurement.requests(),
);
endpoint("post", "/api/procurement/requests", "suppliers_manage", (req) =>
  procurement.createRequest(req.user, req.body),
);
endpoint("get", "/api/procurement/requests/:id", "suppliers_manage", (req) =>
  procurement.requestDetails(req.params.id),
);
endpoint("post", "/api/procurement/requests/:id/approve", "suppliers_manage", (req) =>
  procurement.approveRequest(req.user, req.params.id),
);
endpoint("get", "/api/procurement/quotes", "suppliers_manage", (req) =>
  procurement.quotes(req.query.request_id),
);
endpoint("post", "/api/procurement/quotes", "suppliers_manage", (req) =>
  procurement.createQuote(req.user, req.body),
);
endpoint("post", "/api/procurement/quotes/:id/create-order", "suppliers_manage", (req) =>
  procurement.createOrderFromQuote(req.user, req.params.id),
);
endpoint("get", "/api/purchase-orders", "suppliers_manage", () =>
  procurement.orders(),
);
endpoint("post", "/api/purchase-orders", "suppliers_manage", (req) =>
  procurement.createOrder(req.user, req.body),
);
endpoint("get", "/api/purchase-orders/:id", "suppliers_manage", (req) =>
  procurement.orderDetails(req.params.id),
);
endpoint("post", "/api/purchase-orders/:id/send", "suppliers_manage", (req) =>
  procurement.sendOrder(req.user, req.params.id),
);
endpoint("post", "/api/purchase-orders/:id/receive", "suppliers_manage", (req) =>
  procurement.receive(req.user, req.params.id, req.body),
);
endpoint("get", "/api/supplier-invoices", "suppliers_manage", () =>
  procurement.invoices(),
);
endpoint("post", "/api/supplier-invoices", "suppliers_manage", (req) =>
  procurement.createInvoice(req.user, req.body),
);
endpoint("post", "/api/supplier-invoices/:id/approve", "suppliers_manage", (req) =>
  procurement.approveInvoice(req.user, req.params.id),
);
endpoint("post", "/api/supplier-invoices/:id/pay", "suppliers_manage", (req) =>
  procurement.payInvoice(req.user, req.params.id, req.body),
);
endpoint("get", "/api/cycle-counts/classification", "inventory_manage", () =>
  cycleCounts.classification(),
);
endpoint("get", "/api/cycle-counts", "inventory_manage", () =>
  cycleCounts.list(),
);
endpoint("post", "/api/cycle-counts", "inventory_manage", (req) =>
  cycleCounts.generate(req.user, req.body),
);
endpoint("get", "/api/cycle-counts/:id", "inventory_manage", (req) =>
  cycleCounts.details(req.params.id),
);
endpoint("post", "/api/cycle-counts/:id/count", "inventory_manage", (req) =>
  cycleCounts.record(req.user, req.params.id, req.body),
);
endpoint("post", "/api/cycle-counts/:id/complete", "inventory_manage", (req) =>
  cycleCounts.complete(req.user, req.params.id),
);
endpoint("get", "/api/exceptions", "reports_view", () => exceptions.list());
endpoint("get", "/api/reports/dashboard", "reports_view", () =>
  report.dashboard(),
);
endpoint("get", "/api/reports/sales-daily", "reports_view", (req) =>
  report.daily(req.query.date),
);
endpoint("get", "/api/reports/sales-summary", "reports_view", (req) =>
  report.summary(req.query.from, req.query.to),
);
endpoint("get", "/api/reports/shifts/:id", "reports_view", (req) =>
  report.shiftReport(req.params.id),
);
app.get(
  "/api/reports/export-excel",
  auth.permit("reports_view"),
  wrap(async (req, res) => {
    const buffer = await report.excel(req.query, req.user);
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="KTS-Sales.xlsx"',
    );
    res.send(Buffer.from(buffer));
  }),
);
endpoint("get", "/api/audit", "audit_view", () => audit.list());
endpoint("get", "/api/accounting/accounts", "reports_view", () =>
  accounting.balances(),
);
endpoint("get", "/api/accounting/journal", "reports_view", (req) =>
  accounting.entries(req.query),
);
endpoint("get", "/api/users", "users_manage", () =>
  d.all(
    "SELECT u.id,u.username,u.full_name,u.role_id,u.status,u.phone,u.email,r.name_ar role_name_ar,CASE WHEN EXISTS(SELECT 1 FROM user_permission_overrides o WHERE o.user_id=u.id) THEN 'مخصصة' ELSE 'حسب الدور' END access_mode FROM users u JOIN roles r ON r.id=u.role_id",
  ),
);
endpoint("get", "/api/roles", "users_manage", () =>
  d.all("SELECT * FROM roles"),
);
endpoint("get", "/api/users/:id/permissions", "users_permissions", (req) => {
  access.assertAdministrator(req.user);
  return access.details(req.params.id);
});
endpoint("put", "/api/users/:id/permissions", "users_permissions", (req) =>
  access.save(req.user,req.params.id,req.body),
);
function saveUser(req) {
  return d.transaction(() => {
    const old = req.params.id
      ? d.get("SELECT * FROM users WHERE id=?", req.params.id)
      : null;
    if (req.params.id && !old) d.fail("المستخدم غير موجود", 404);
    const data = Object.fromEntries(
      ["username", "full_name", "role_id", "status", "phone", "email"]
        .filter((k) => req.body[k] !== undefined)
        .map((k) => [k, req.body[k]]),
    );
    if (req.body.password)
      data.password_hash = d.hash(d.required(req.body.password, "كلمة المرور"));
    if (!old)
      for (const k of ["username", "full_name", "role_id", "password_hash"])
        d.required(data[k], k);
    if (req.user.role_id !== "role-admin") {
      const target = {id:old?.id || "",role_id:data.role_id || old?.role_id};
      if(target.role_id === "role-admin" || (old && data.role_id && data.role_id!==old.role_id))
        d.fail("تغيير الأدوار أو إدارة حساب مدير النظام متاح لمدير النظام فقط",403);
      if(access.effective(target).some(code=>!req.user.permissions.includes(code)))
        d.fail("لا يمكنك إدارة مستخدم يمتلك صلاحيات أوسع من صلاحياتك",403);
    }
    if (
      old?.id === req.user.id &&
      (data.status === "inactive" ||
        (data.role_id && data.role_id !== old.role_id))
    )
      d.fail("لا يمكن تعطيل حسابك الإداري الحالي");
    const row = old
      ? d.update("users", old.id, data)
      : d.insert("users", { id: d.id(), ...data });
    access.assertAdministratorRemains();
    const { password_hash, ...safe } = row;
    const previous = old
      ? Object.fromEntries(
          Object.entries(old).filter(([k]) => k !== "password_hash"),
        )
      : null;
    audit.record(req.user, "user_save", "users", row.id, previous, safe);
    return safe;
  });
}
endpoint("post", "/api/users", "users_manage", saveUser, 201);
endpoint("put", "/api/users/:id", "users_manage", saveUser);
endpoint("get", "/api/settings", null, () =>
  Object.fromEntries(
    d
      .all(
        "SELECT config_key,config_value FROM system_configurations WHERE config_key IN ('branch_name','branch_phone','branch_address','return_policy','return_window_days','logo_url')",
      )
      .map((r) => [r.config_key, r.config_value]),
  ),
);
endpoint("get", "/api/devices", "settings_manage", () => devices.list());
endpoint('post','/api/customer-display/channels','customer_display_open',req=>customerDisplay.ensure(req.user,req.body));
endpoint('post','/api/customer-display/channels/:id/events','customer_display_open',req=>customerDisplay.publish(req.user,req.params.id,req.body,`${req.protocol}://${req.get('host')}`));
endpoint('post','/api/customer-display/channels/:id/heartbeat','customer_display_open',req=>customerDisplay.heartbeat(req.user,req.params.id,req.body));
endpoint('post','/api/customer-display/channels/:id/disconnect','customer_display_open',req=>customerDisplay.disconnect(req.user,req.params.id,req.body));
endpoint('get','/api/customer-display/settings','customer_display_manage',()=>customerDisplay.adminSettings());
endpoint('get','/api/customer-display/products','customer_display_manage',req=>customerDisplay.search(req.query.q));
endpoint('put','/api/customer-display/settings','customer_display_manage',req=>customerDisplay.saveSettings(req.user,req.body));
app.post('/api/customer-display/asset',auth.permit('customer_display_manage'),imageUpload.single('image'),wrap((req,res)=>{if(!req.file)d.fail('اختر صورة PNG أو JPEG أو WebP');res.json({path:'/images/uploads/'+req.file.filename});}));
endpoint("get", "/api/devices/pos-capabilities", "pos_sale", () =>
  devices.capabilities(),
);
endpoint("put", "/api/devices/:type", "settings_manage", (req) =>
  devices.save(req.user, req.params.type, req.body),
);
endpoint("post", "/api/devices/:type/test", "settings_manage", (req) =>
  devices.test(req.user, req.params.type),
);
endpoint("get", "/api/device-jobs", "settings_manage", () => devices.jobs());
endpoint("post", "/api/devices/label-print", "catalog_manage", (req) =>
  devices.printLabels(req.user, req.body),
);
endpoint("post", "/api/devices/knet/charge", "pos_sale", (req) =>
  devices.startKnet(req.user, req.body.amount, req.body.client_reference),
);
endpoint("post", "/api/devices/scale/parse", "pos_sale", (req) =>
  devices.parseScaleBarcode(req.body.barcode),
);
endpoint("get", "/api/receipts/:saleId/electronic", "pos_sale", (req) =>
  receipts.details(req.params.saleId, `${req.protocol}://${req.get("host")}`),
);
endpoint("post", "/api/receipts/:saleId/deliver", "pos_sale", (req) =>
  receipts.deliver(req.user, req.params.saleId, req.body),
);
endpoint("get", "/api/backups", "settings_manage", () => backups.list());
endpoint("post", "/api/backups", "settings_manage", (req) =>
  backups.create(req.user, "manual"),
);
endpoint("post", "/api/backups/:id/verify", "settings_manage", (req) =>
  backups.verify(req.params.id),
);
endpoint("post", "/api/backups/:id/dry-run", "settings_manage", (req) =>
  backups.dryRun(req.params.id, req.user),
);
endpoint("get", "/api/backups/health", "settings_manage", () =>
  backups.health(),
);
app.get(
  "/api/backups/:id/download",
  auth.permit("settings_manage"),
  wrap((req, res) => {
    const entry = backups.file(req.params.id);
    res.download(entry.target, entry.row.file_name);
  }),
);
endpoint("put", "/api/settings", "settings_manage", (req) => {
  return d.transaction(() => {
    for (const key of [
      "branch_name",
      "branch_phone",
      "branch_address",
      "return_policy",
      "return_window_days",
      "logo_url",
    ])
      if (req.body[key] !== undefined) {
        const value = String(req.body[key]);
        d.run(
          "INSERT INTO system_configurations(config_key,config_value) VALUES(?,?) ON CONFLICT(config_key) DO UPDATE SET config_value=excluded.config_value,updated_at=datetime('now')",
          key,
          value,
        );
      }
    audit.record(
      req.user,
      "settings_update",
      "system_configurations",
      "settings",
      null,
      req.body,
    );
    return { success: true };
  });
});
app.post(
  "/api/import/:type",
  auth.permit("import_data"),
  importUpload.single("file"),
  wrap(async (req, res) =>
    res.json(await importer.importRows(req.user, req.params.type, req.file)),
  ),
);
endpoint("get", "/api/sync/snapshot", "pos_sale", (req) =>
  sync.snapshot(req.user),
);
endpoint("post", "/api/sync/upload", "pos_sale", (req) =>
  sync.upload(req.user, req.body),
);
endpoint("get", "/api/shifts/cashiers", "shifts_manage", () =>
  d.all(
    "SELECT id,full_name FROM users WHERE status='active' ORDER BY full_name",
  ),
);
endpoint("get", "/api/suppliers/:id/products", "suppliers_manage", (req) =>
  d.all(
    "SELECT p.* FROM products p JOIN product_suppliers ps ON ps.product_id=p.id WHERE ps.supplier_id=? ORDER BY p.name_ar",
    req.params.id,
  ),
);
endpoint("get", "/api/inventory/damaged", "inventory_manage", () =>
  d.all(
    "SELECT p.name_ar,p.sku,SUM(l.qty) qty FROM return_lines l JOIN products p ON p.id=l.product_id WHERE l.item_condition='damaged' GROUP BY l.product_id",
  ),
);
endpoint(
  "post",
  "/api/accounting/journal",
  "inventory_manage",
  (req) =>
    d.transaction(() => {
      const amount = d.money(d.number(req.body.amount, "المبلغ", 0, true));
      if (req.body.debit_account === req.body.credit_account)
        d.fail("الحسابان يجب أن يختلفا");
      const row = accounting.post(
        req.user,
        "manual",
        d.id(),
        d.required(req.body.description, "البيان"),
        [
          { account_code: req.body.debit_account, debit: amount },
          { account_code: req.body.credit_account, credit: amount },
        ],
      );
      audit.record(
        req.user,
        "journal_post",
        "journal_entries",
        row.id,
        null,
        row,
      );
      return row;
    }),
  201,
);
app.use("/api", (req, res) =>
  res.status(404).json({ error: "المسار غير موجود" }),
);
app.use(express.static(config.client));
app.use((err, req, res, next) => {
  console.error(err.status ? err.message : err);
  const constraint = /constraint|FOREIGN KEY|UNIQUE|CHECK/.test(err.message);
  res.status(err.status || (constraint ? 409 : 500)).json({
    success: false,
    error: constraint
      ? "تعارض بيانات أو مرجع غير صالح"
      : err.status
        ? err.message
        : "تعذر إتمام العملية",
  });
});
module.exports = app;
