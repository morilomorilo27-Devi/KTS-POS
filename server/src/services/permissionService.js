const crypto = require("node:crypto");
const d = require("../db");
const audit = require("./auditService");

// Existing roles remain the defaults. Per-user decisions override only the named permission.
const groups = [
  ["pos", "الكاشير والبيع", [
    ["pos_sale", "الوصول إلى شاشة البيع"],
    ["customer_display_open", "فتح وربط شاشة العميل", "pos_sale"],
    ["pos_checkout", "إتمام البيع", "pos_sale"],
    ["pos_payment_cash", "التحصيل النقدي", "pos_sale"],
    ["pos_payment_knet", "التحصيل عبر K-Net", "pos_sale"],
    ["pos_payment_split", "تقسيم الدفع", "pos_sale"],
    ["pos_discount", "تطبيق قاعدة خصم على البيع", "pos_sale"],
    ["pos_member_lookup", "البحث عن العضو وربطه بالفاتورة", "pos_sale"],
    ["pos_reprint", "إعادة طباعة الفواتير", "pos_sale"],
    ["pos_receipt_send", "إرسال الفاتورة الإلكترونية", "pos_sale"],
    ["pos_shift_open", "فتح الوردية الخاصة", "pos_sale"],
    ["pos_shift_close", "إغلاق الوردية الخاصة", "pos_sale"],
    ["pos_hold_cart", "تعليق واسترجاع السلات", "pos_sale"],
    ["pos_hold_merge", "دمج السلات المعلقة", "pos_hold_cart"],
    ["pos_hold_transfer", "اعتماد نقل السلات إلى كاشير آخر", "pos_hold_cart", ["role-admin", "role-supervisor"]],
    ["pos_return", "الوصول إلى المرتجعات"],
    ["returns_create", "تنفيذ المرتجع ورد المبلغ", "pos_return"],
  ]],
  ["catalog", "الأصناف والفئات", [
    ["catalog_manage", "عرض وإتاحة الأصناف والفئات للإدارة"],
    ["products_create", "إضافة صنف", "catalog_manage"],
    ["products_update", "تعديل صنف وأسعاره ومورديه", "catalog_manage"],
    ["products_deactivate", "تعطيل صنف", "catalog_manage"],
    ["categories_write", "إضافة وتعديل الفئات", "catalog_manage"],
    ["labels_print", "تصميم وطباعة ملصقات الأصناف والرفوف", "catalog_manage"],
  ]],
  ["inventory", "المخزون والجرد", [
    ["inventory_manage", "الوصول إلى إدارة المخزون"],
    ["inventory_movements", "عرض حركات المخزون والتالف", "inventory_manage"],
    ["inventory_adjust", "تسجيل تسويات المخزون", "inventory_manage"],
    ["reorder_view", "عرض إعادة الطلب الذكية", "inventory_manage"],
    ["cycle_counts_view", "عرض الجرد الدوري وتصنيف ABC", "inventory_manage"],
    ["cycle_counts_create", "إنشاء قوائم الجرد", "inventory_manage"],
    ["cycle_counts_record", "تسجيل الكميات وأسباب الفروقات", "inventory_manage"],
    ["cycle_counts_approve", "اعتماد الفروقات والترحيل المحاسبي", "inventory_manage", ["role-admin", "role-supervisor"]],
  ]],
  ["purchasing", "الموردون والمشتريات", [
    ["suppliers_manage", "الوصول إلى الموردين والمشتريات"],
    ["suppliers_create", "إضافة مورد", "suppliers_manage"],
    ["suppliers_update", "تعديل مورد", "suppliers_manage"],
    ["suppliers_pay", "سداد أرصدة الموردين", "suppliers_manage"],
    ["purchases_view", "عرض التوريدات", "suppliers_manage"],
    ["purchases_create", "تسجيل توريد مباشر", "suppliers_manage"],
    ["procurement_view", "عرض طلبات وعروض الشراء", "suppliers_manage"],
    ["procurement_create", "إنشاء طلب شراء داخلي", "suppliers_manage"],
    ["procurement_approve", "اعتماد طلب شراء", "suppliers_manage"],
    ["quotes_create", "تسجيل عروض الموردين", "suppliers_manage"],
    ["purchase_orders_view", "عرض أوامر الشراء", "suppliers_manage"],
    ["purchase_orders_create", "إنشاء أمر شراء أو تحويل اقتراح أو عرض", "suppliers_manage"],
    ["purchase_orders_send", "إرسال أمر شراء", "suppliers_manage"],
    ["purchase_orders_receive", "استلام التوريد كليًا أو جزئيًا", "suppliers_manage"],
    ["supplier_invoices_view", "عرض فواتير الموردين", "suppliers_manage"],
    ["supplier_invoices_create", "تسجيل ومطابقة فاتورة مورد", "suppliers_manage"],
    ["supplier_invoices_approve", "اعتماد فاتورة مورد", "suppliers_manage"],
    ["supplier_invoices_pay", "سداد فاتورة مورد", "suppliers_manage"],
  ]],
  ["members", "الأعضاء والخصومات", [
    ["members_manage", "عرض بيانات الأعضاء"],
    ["members_create", "إضافة عضو", "members_manage"],
    ["members_update", "تعديل بيانات عضو", "members_manage"],
    ["member_benefits_view", "عرض سجل الشراء والمزايا", "members_manage"],
    ["member_benefits_write", "تعديل الحدود والتابعين والأسعار الخاصة والقسائم", "members_manage"],
    ["member_wallet_adjust", "إضافة وخصم رصيد محفظة عضو", "members_manage"],
    ["discounts_manage", "عرض قواعد الخصم"],
    ["discounts_create", "إنشاء قاعدة خصم", "discounts_manage"],
    ["discounts_update", "تعديل قاعدة خصم", "discounts_manage"],
  ]],
  ["reports", "التقارير والمحاسبة والورديات", [
    ["reports_view", "الوصول إلى التقارير والمحاسبة"],
    ["dashboard_view", "عرض النظرة العامة", "reports_view"],
    ["exceptions_view", "عرض مركز التنبيهات والاستثناءات", "reports_view"],
    ["sales_reports_view", "عرض تقارير المبيعات", "reports_view"],
    ["reports_export", "تصدير تقارير Excel", "reports_view"],
    ["accounting_view", "عرض أرصدة الحسابات وميزان المراجعة", "reports_view"],
    ["journal_view", "عرض القيود اليومية", "reports_view"],
    ["journal_create", "إنشاء قيد يومي يدوي", "inventory_manage"],
    ["shifts_manage", "عرض ورديات الفريق"],
    ["shifts_schedules_write", "تعديل جداول الدوام", "shifts_manage"],
    ["audit_view", "عرض سجل التدقيق"],
  ]],
  ["administration", "المستخدمون وإدارة النظام", [
    ["users_manage", "عرض المستخدمين والأدوار"],
    ["users_create", "إنشاء مستخدم", "users_manage"],
    ["users_update", "تعديل المستخدمين وكلمات المرور", "users_manage"],
    ["users_permissions", "تخصيص صلاحيات المستخدمين — مدير النظام فقط", "users_manage", ["role-admin"]],
    ["import_data", "الوصول إلى الاستيراد"],
    ["import_products", "استيراد الأصناف والأرصدة الافتتاحية", "import_data"],
    ["import_members", "استيراد الأعضاء", "import_data"],
    ["settings_manage", "الوصول إلى إعدادات النظام والأجهزة والنسخ"],
    ["customer_display_manage", "إدارة تجربة العميل والحملات والمنتجات المختارة", "settings_manage"],
    ["settings_write", "تعديل بيانات الفرع وسياسة الفاتورة", "settings_manage"],
    ["devices_view", "عرض الأجهزة ومهامها", "settings_manage"],
    ["devices_write", "إعداد واختبار الأجهزة", "settings_manage"],
    ["backups_view", "عرض النسخ وحالتها", "settings_manage"],
    ["backups_create", "إنشاء نسخة احتياطية مشفرة", "settings_manage"],
    ["backups_download", "تنزيل نسخة احتياطية", "settings_manage"],
    ["backups_test", "اختبار النسخ والاستعادة التجريبية", "settings_manage"],
  ]],
];
const catalog = groups.map(([id, name, rows]) => ({id, name, permissions: rows.map(([code, name, parent, defaultRoles]) => ({code, name, parent:parent || null, default_roles:defaultRoles || null}))}));
const definitions = new Map(catalog.flatMap(g=>g.permissions).map(p=>[p.code,p]));
d.db.exec(`CREATE TABLE IF NOT EXISTS user_permission_overrides(
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission_code TEXT NOT NULL REFERENCES permissions(code),
  effect TEXT NOT NULL CHECK(effect IN ('allow','deny')),
  updated_by TEXT REFERENCES users(id),updated_at TEXT NOT NULL DEFAULT(datetime('now')),
  PRIMARY KEY(user_id,permission_code));`);
for(const group of catalog) for(const p of group.permissions) {
  d.run("INSERT OR IGNORE INTO permissions(id,code,name_ar,module) VALUES(?,?,?,?)",p.code,p.code,p.name,group.id);
  d.run("INSERT OR IGNORE INTO role_permissions(role_id,permission_id) VALUES(?,?)","role-admin",p.code);
  if(p.code.startsWith("pos_") || p.code === "customer_display_open") {
    d.run("INSERT OR IGNORE INTO role_permissions(role_id,permission_id) VALUES(?,?)","role-cashier",p.code);
  }
}

function effective(user, overrides = null) {
  const roleCodes = new Set(d.all("SELECT p.code FROM permissions p JOIN role_permissions rp ON rp.permission_id=p.id WHERE rp.role_id=?",user.role_id).map(p=>p.code));
  overrides = overrides || Object.fromEntries(d.all("SELECT permission_code,effect FROM user_permission_overrides WHERE user_id=?",user.id).map(p=>[p.permission_code,p.effect]));
  const memo=new Map();
  const allowed=code=>{
    if(memo.has(code))return memo.get(code);
    const p=definitions.get(code);
    if(!p)return false;
    const parentAllowed=!p.parent || allowed(p.parent);
    const roleDefault=p.parent ? (p.default_roles ? p.default_roles.includes(user.role_id) : allowed(p.parent)) : roleCodes.has(code);
    const value=parentAllowed && (overrides[code]==="deny" ? false : overrides[code]==="allow" ? true : roleDefault);
    // Only system administrators may delegate access, regardless of an explicit grant.
    const result=code==="users_permissions" && user.role_id!=="role-admin" ? false : value;
    memo.set(code,result);return result;
  };
  return [...definitions.keys()].filter(allowed);
}
function revision(permissions) {return crypto.createHash('sha256').update(permissions.join('|')).digest('hex').slice(0,16);}
function assertAllowed(user, code) {
  const permissions=user.permissions || effective(d.get("SELECT id,role_id FROM users WHERE id=?",user.id) || user);
  if(!permissions.includes(code)) d.fail("لا تملك صلاحية تنفيذ هذه العملية",403);
}
function assertAdministrator(user) {
  assertAllowed(user,"users_permissions");
  if(user.role_id!=="role-admin")d.fail("تخصيص الصلاحيات متاح لمدير النظام فقط",403);
}
function assertAdministratorRemains() {
  const administrators=d.all("SELECT id,role_id FROM users WHERE status='active' AND role_id='role-admin'");
  if(!administrators.some(u=>effective(u).includes('users_permissions')))d.fail("يجب إبقاء مدير نظام فعال واحد على الأقل قادر على إدارة المستخدمين والصلاحيات");
}
function details(id) {
  const user=d.get("SELECT id,username,full_name,role_id,status FROM users WHERE id=?",id);
  if(!user)d.fail("المستخدم غير موجود",404);
  const overrides=Object.fromEntries(d.all("SELECT permission_code,effect FROM user_permission_overrides WHERE user_id=?",id).map(p=>[p.permission_code,p.effect]));
  const version=crypto.createHash('sha256').update(JSON.stringify([user.role_id,user.status,Object.entries(overrides).sort()])).digest('hex');
  return {user,overrides,effective:effective(user),role_defaults:effective(user,{}),catalog,version};
}
function save(actor,id,body) {
  assertAdministrator(actor);
  if(!body.overrides || typeof body.overrides!=="object" || Array.isArray(body.overrides)) d.fail("قائمة الصلاحيات غير صالحة");
  for(const [code,effect] of Object.entries(body.overrides)) if(!definitions.has(code)||!["allow","deny"].includes(effect))d.fail("صلاحية أو حالة غير صالحة: "+code);
  return d.transaction(()=>{
    const before=details(id);
    if(body.version && body.version!==before.version)d.fail("تغيرت الصلاحيات منذ فتح النافذة؛ أعد فتحها قبل الحفظ",409);
    d.run("DELETE FROM user_permission_overrides WHERE user_id=?",id);
    for(const [code,effect] of Object.entries(body.overrides))d.run("INSERT INTO user_permission_overrides(user_id,permission_code,effect,updated_by) VALUES(?,?,?,?)",id,code,effect,actor.id);
    assertAdministratorRemains();
    const after=details(id);
    audit.record(actor,"user_permissions_update","users",id,{overrides:before.overrides,effective:before.effective},{overrides:after.overrides,effective:after.effective,note:String(body.note||'').slice(0,300)});
    return after;
  });
}

const routes = [
  ["POST",/^\/api\/shifts\/open$/,"pos_shift_open"],["POST",/^\/api\/shifts\/close$/,"pos_shift_close"],
  ["POST",/^\/api\/pos\/checkout$/,"pos_checkout"],["POST",/^\/api\/pos\/held-carts\/merge$/,"pos_hold_merge"],
  ["POST",/^\/api\/pos\/held-carts\/[^/]+\/transfer$/,"pos_hold_transfer"],["POST",/^\/api\/pos\/invoices\/[^/]+\/reprint$/,"pos_reprint"],
  ["GET",/^\/api\/members\/search-pos$/,"pos_member_lookup"],["GET",/^\/api\/pos\/members\/[^/]+\/summary$/,"pos_member_lookup"],
  ["POST",/^\/api\/returns$/,"returns_create"],["POST",/^\/api\/receipts\/[^/]+\/deliver$/,"pos_receipt_send"],
  ["POST",/^\/api\/devices\/knet\/charge$/,"pos_payment_knet"],
  ["POST",/^\/api\/products$/,"products_create"],["PUT",/^\/api\/products\/[^/]+$/,"products_update"],["DELETE",/^\/api\/products\/[^/]+$/,"products_deactivate"],
  ["POST|PUT",/^\/api\/categories(?:\/[^/]+)?$/,"categories_write"],["POST",/^\/api\/devices\/label-print$/,"labels_print"],
  ["GET",/^\/api\/inventory\/(movements|damaged)$/,"inventory_movements"],["POST",/^\/api\/inventory\/adjust$/,"inventory_adjust"],
  ["GET",/^\/api\/reorder-suggestions$/,"reorder_view"],["POST",/^\/api\/reorder-suggestions\/create-orders$/,"purchase_orders_create"],
  ["GET",/^\/api\/cycle-counts(?:\/[^/]+)?$/,"cycle_counts_view"],["POST",/^\/api\/cycle-counts$/,"cycle_counts_create"],
  ["POST",/^\/api\/cycle-counts\/[^/]+\/count$/,"cycle_counts_record"],["POST",/^\/api\/cycle-counts\/[^/]+\/complete$/,"cycle_counts_approve"],
  ["POST",/^\/api\/suppliers$/,"suppliers_create"],["PUT",/^\/api\/suppliers\/[^/]+$/,"suppliers_update"],["POST",/^\/api\/suppliers\/payments$/,"suppliers_pay"],
  ["GET",/^\/api\/purchases$/,"purchases_view"],["POST",/^\/api\/purchases$/,"purchases_create"],
  ["GET",/^\/api\/procurement\/(requests|quotes)(?:\/[^/]+)?$/,"procurement_view"],["POST",/^\/api\/procurement\/requests$/,"procurement_create"],
  ["POST",/^\/api\/procurement\/requests\/[^/]+\/approve$/,"procurement_approve"],["POST",/^\/api\/procurement\/quotes$/,"quotes_create"],
  ["POST",/^\/api\/procurement\/quotes\/[^/]+\/create-order$/,"purchase_orders_create"],
  ["GET",/^\/api\/purchase-orders(?:\/[^/]+)?$/,"purchase_orders_view"],["POST",/^\/api\/purchase-orders$/,"purchase_orders_create"],
  ["POST",/^\/api\/purchase-orders\/[^/]+\/send$/,"purchase_orders_send"],["POST",/^\/api\/purchase-orders\/[^/]+\/receive$/,"purchase_orders_receive"],
  ["GET",/^\/api\/supplier-invoices$/,"supplier_invoices_view"],["POST",/^\/api\/supplier-invoices$/,"supplier_invoices_create"],
  ["POST",/^\/api\/supplier-invoices\/[^/]+\/approve$/,"supplier_invoices_approve"],["POST",/^\/api\/supplier-invoices\/[^/]+\/pay$/,"supplier_invoices_pay"],
  ["POST",/^\/api\/members$/,"members_create"],["PUT",/^\/api\/members\/[^/]+$/,"members_update"],
  ["GET",/^\/api\/members\/[^/]+\/experience$/,"member_benefits_view"],
  ["GET",/^\/api\/member-special-prices$/,"member_benefits_view"],
  ["PUT|POST",/^\/api\/members\/[^/]+\/(profile|dependents)$/,"member_benefits_write"],
  ["POST",/^\/api\/(member-special-prices|member-vouchers)$/,"member_benefits_write"],
  ["POST",/^\/api\/members\/[^/]+\/wallet$/,"member_wallet_adjust"],
  ["POST",/^\/api\/discounts$/,"discounts_create"],["PUT",/^\/api\/discounts\/[^/]+$/,"discounts_update"],
  ["GET",/^\/api\/reports\/dashboard$/,"dashboard_view"],["GET",/^\/api\/exceptions$/,"exceptions_view"],
  ["GET",/^\/api\/reports\/(sales-daily|sales-summary|shifts\/[^/]+)$/,"sales_reports_view"],
  ["GET",/^\/api\/reports\/(export-excel|excel\/)/,"reports_export"],["GET",/^\/api\/accounting\/accounts$/,"accounting_view"],
  ["GET",/^\/api\/accounting\/journal$/,"journal_view"],["POST",/^\/api\/accounting\/journal$/,"journal_create"],
  ["POST",/^\/api\/shifts\/schedules$/,"shifts_schedules_write"],
  ["POST",/^\/api\/users$/,"users_create"],["PUT",/^\/api\/users\/[^/]+$/,"users_update"],
  ["POST",/^\/api\/import\/products$/,"import_products"],["POST",/^\/api\/import\/members$/,"import_members"],
  ["PUT",/^\/api\/settings$/,"settings_write"],["GET",/^\/api\/(devices|device-jobs)$/,"devices_view"],
  ["PUT|POST",/^\/api\/devices\/[^/]+(?:\/test)?$/,"devices_write"],
  ["GET",/^\/api\/backups(?:\/health)?$/,"backups_view"],["POST",/^\/api\/backups$/,"backups_create"],
  ["GET",/^\/api\/backups\/[^/]+\/download$/,"backups_download"],["POST",/^\/api\/backups\/[^/]+\/(verify|dry-run)$/,"backups_test"],
];
function requiredFor(method,path) {return routes.find(([verbs,pattern])=>verbs.split('|').includes(method)&&pattern.test(path))?.[2];}
module.exports={catalog,effective,revision,assertAllowed,assertAdministrator,assertAdministratorRemains,details,save,requiredFor};
