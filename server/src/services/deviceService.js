const d = require("../db");
const audit = require("./auditService");

const defaults = [
  ["receipt_printer", "طابعة الفواتير", "browser"],
  ["cash_drawer", "درج النقد", "browser"],
  ["barcode_scanner", "قارئ الباركود", "keyboard"],
  ["customer_display", "شاشة العميل", "browser"],
  ["scale", "ميزان الباركود", "barcode"],
  ["label_printer", "طابعة الملصقات", "browser"],
  ["knet", "جهاز K-Net", "simulator"],
];
for (const [type, name, adapter] of defaults)
  d.run(
    "INSERT OR IGNORE INTO device_integrations(id,device_type,name,adapter) VALUES(?,?,?,?)",
    d.id(),
    type,
    name,
    adapter,
  );

function list() {
  return d.all("SELECT * FROM device_integrations ORDER BY device_type").map((row) => ({
    ...row,
    configuration: JSON.parse(row.configuration || "{}"),
  }));
}

function save(user, type, body) {
  const old = d.get("SELECT * FROM device_integrations WHERE device_type=?", type);
  if (!old) d.fail("نوع الجهاز غير معروف", 404);
  const configuration = JSON.stringify(body.configuration || {});
  d.run(
    `UPDATE device_integrations SET name=?,adapter=?,configuration=?,status=?,updated_at=datetime('now')
     WHERE device_type=?`,
    body.name || old.name,
    body.adapter || old.adapter,
    configuration,
    body.status || old.status,
    type,
  );
  const row = d.get("SELECT * FROM device_integrations WHERE device_type=?", type);
  audit.record(user, "device_configuration", "device_integrations", row.id, old, row);
  return row;
}

function queue(user, deviceType, jobType, payload) {
  const device = d.get("SELECT * FROM device_integrations WHERE device_type=?", deviceType);
  if (!device || device.status !== "active")
    return { queued: false, reason: "device_inactive" };
  const row = d.insert("device_jobs", {
    id: d.id(),
    device_type: deviceType,
    job_type: jobType,
    payload: JSON.stringify(payload),
    user_id: user?.id || null,
  });
  if (["browser", "keyboard", "barcode", "simulator"].includes(device.adapter))
    d.run(
      "UPDATE device_jobs SET status='completed',completed_at=datetime('now') WHERE id=?",
      row.id,
    );
  return { queued: true, job_id: row.id, adapter: device.adapter };
}

function jobs() {
  return d.all(
    "SELECT * FROM device_jobs ORDER BY created_at DESC LIMIT 500",
  ).map((row) => ({ ...row, payload: JSON.parse(row.payload || "{}") }));
}

function latest(deviceType) {
  const row = d.get(
    "SELECT * FROM device_jobs WHERE device_type=? ORDER BY created_at DESC LIMIT 1",
    deviceType,
  );
  return row ? { ...row, payload: JSON.parse(row.payload || "{}") } : null;
}

function printLabels(user, body) {
  if (!Array.isArray(body.items) || !body.items.length)
    d.fail("حدد صنفًا واحدًا على الأقل لطباعة الملصقات");
  const items = body.items.map((item) => {
    const product = d.get(
      `SELECT p.id,p.sku,p.name_ar,p.sale_price,
       (SELECT barcode FROM product_barcodes b WHERE b.product_id=p.id ORDER BY b.is_primary DESC LIMIT 1) barcode
       FROM products p WHERE p.id=?`,
      item.product_id,
    );
    if (!product) d.fail("الصنف غير موجود");
    return {
      ...product,
      copies: Math.max(1, Math.min(500, Number(item.copies) || 1)),
    };
  });
  const result = queue(user, "label_printer", "product_labels", { items });
  if (!result.queued) d.fail("طابعة الملصقات غير مفعّلة");
  audit.record(user, "label_print", "device_jobs", result.job_id, null, { items });
  return result;
}

function test(user, type) {
  const result = queue(user, type, "test", { tested_at: new Date().toISOString() });
  d.run(
    "UPDATE device_integrations SET last_check_at=datetime('now'),last_error=? WHERE device_type=?",
    result.queued ? null : result.reason,
    type,
  );
  return result;
}

function startKnet(user, amount, clientReference) {
  const value = d.money(d.number(amount, "مبلغ K-Net", 0, true));
  const existing = d.get(
    "SELECT * FROM knet_transactions WHERE client_reference=?",
    clientReference,
  );
  if (existing) return existing;
  const device = d.get("SELECT * FROM device_integrations WHERE device_type='knet'");
  if (!device || device.status !== "active")
    d.fail("تكامل K-Net غير مفعّل");
  const approved = ["simulator", "browser"].includes(device.adapter);
  return d.insert("knet_transactions", {
    id: d.id(),
    client_reference: clientReference,
    amount: value,
    status: approved ? "approved" : "pending",
    terminal_reference: approved
      ? "KNET-" + Date.now().toString(36).toUpperCase()
      : null,
    user_id: user.id,
  });
}

function linkKnet(clientReference, saleId) {
  d.run(
    "UPDATE knet_transactions SET sale_id=?,updated_at=datetime('now') WHERE client_reference=? AND status='approved'",
    saleId,
    clientReference,
  );
}

function parseScaleBarcode(code) {
  const device = list().find((row) => row.device_type === "scale");
  const cfg = device?.configuration || {};
  const prefix = String(cfg.prefix || "20");
  const value = String(code || "").trim();
  if (!value.startsWith(prefix) || value.length < 12)
    return { weighted: false, barcode: value };
  const skuLength = Number(cfg.sku_length || 5);
  const weightLength = Number(cfg.weight_length || 5);
  const start = prefix.length;
  return {
    weighted: true,
    sku: value.slice(start, start + skuLength),
    weight: Number(value.slice(start + skuLength, start + skuLength + weightLength)) /
      Number(cfg.weight_divisor || 1000),
    barcode: value,
  };
}

function capabilities() {
  return Object.fromEntries(
    list().map((device) => [
      device.device_type,
      {
        active: device.status === "active",
        adapter: device.adapter,
      },
    ]),
  );
}

module.exports = {
  list,
  save,
  queue,
  jobs,
  latest,
  printLabels,
  test,
  startKnet,
  linkKnet,
  parseScaleBarcode,
  capabilities,
};
