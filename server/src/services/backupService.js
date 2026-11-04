const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { backup, DatabaseSync } = require("node:sqlite");
const config = require("../config");
const d = require("../db");
const audit = require("./auditService");

const MAGIC = Buffer.from("KTSB1");
function secret() {
  if (process.env.KTS_BACKUP_KEY) return process.env.KTS_BACKUP_KEY;
  const keyFile = path.join(path.dirname(config.database), ".backup-key");
  if (!fs.existsSync(keyFile)) {
    fs.mkdirSync(path.dirname(keyFile), { recursive: true });
    fs.writeFileSync(keyFile, crypto.randomBytes(32), { mode: 0o600 });
  }
  return fs.readFileSync(keyFile);
}

function encrypt(data) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(secret(), salt, 32);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  return Buffer.concat([MAGIC, salt, iv, cipher.getAuthTag(), encrypted]);
}

function decrypt(data) {
  if (!data.subarray(0, MAGIC.length).equals(MAGIC))
    throw new Error("صيغة النسخة الاحتياطية غير صالحة");
  const salt = data.subarray(5, 21);
  const iv = data.subarray(21, 33);
  const tag = data.subarray(33, 49);
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    crypto.scryptSync(secret(), salt, 32),
    iv,
  );
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data.subarray(49)), decipher.final()]);
}

async function create(user = null, trigger = "scheduled") {
  fs.mkdirSync(config.backups, { recursive: true });
  const id = d.id();
  const stamp = new Date().toISOString().replaceAll(":", "-");
  const plain = path.join(config.backups, `.working-${id}.db`);
  const fileName = `kts-${stamp}-${id.slice(0, 8)}.ktsbackup`;
  const target = path.join(config.backups, fileName);
  const row = d.insert("backup_records", {
    id,
    file_name: fileName,
    trigger_type: trigger,
    created_by: user?.id || null,
  });
  try {
    await backup(d.db, plain);
    fs.writeFileSync(target, encrypt(fs.readFileSync(plain)));
    fs.rmSync(plain, { force: true });
    d.run(
      "UPDATE backup_records SET file_size=? WHERE id=?",
      fs.statSync(target).size,
      id,
    );
    await verify(id);
    retain();
    if (user)
      audit.record(user, "backup_create", "backup_records", id, null, row);
    return d.get("SELECT * FROM backup_records WHERE id=?", id);
  } catch (error) {
    fs.rmSync(plain, { force: true });
    fs.rmSync(target, { force: true });
    d.run(
      "UPDATE backup_records SET integrity_status='invalid',error=? WHERE id=?",
      error.message,
      id,
    );
    throw error;
  }
}

async function verify(id) {
  const row = d.get("SELECT * FROM backup_records WHERE id=?", id);
  if (!row) d.fail("النسخة الاحتياطية غير موجودة", 404);
  const source = path.join(config.backups, row.file_name);
  const temp = path.join(config.backups, `.verify-${id}.db`);
  try {
    const plain = decrypt(fs.readFileSync(source));
    if (plain.subarray(0, 16).toString() !== "SQLite format 3\u0000")
      throw new Error("ملف SQLite غير صالح");
    fs.writeFileSync(temp, plain);
    const checkDb = new DatabaseSync(temp, { readOnly: true });
    const result = checkDb.prepare("PRAGMA integrity_check").get();
    checkDb.close();
    if (Object.values(result)[0] !== "ok") throw new Error("فشل اختبار سلامة قاعدة البيانات");
    d.run(
      "UPDATE backup_records SET integrity_status='valid',verified_at=datetime('now'),error=NULL WHERE id=?",
      id,
    );
    return { valid: true };
  } catch (error) {
    d.run(
      "UPDATE backup_records SET integrity_status='invalid',verified_at=datetime('now'),error=? WHERE id=?",
      error.message,
      id,
    );
    return { valid: false, error: error.message };
  } finally {
    fs.rmSync(temp, { force: true });
  }
}

async function dryRun(id, user = null) {
  const result = await verify(id);
  d.insert("backup_restore_tests", {
    id: d.id(),
    backup_id: id,
    status: result.valid ? "valid" : "invalid",
    tested_by: user?.id || null,
    error: result.error || null,
  });
  if (user)
    audit.record(user, "backup_restore_test", "backup_records", id, null, result);
  return result;
}

function retain() {
  const rows = d.all(
    "SELECT * FROM backup_records WHERE integrity_status='valid' ORDER BY created_at DESC",
  );
  for (const row of rows.slice(30)) {
    fs.rmSync(path.join(config.backups, row.file_name), { force: true });
    d.run("DELETE FROM backup_records WHERE id=?", row.id);
  }
}

function list() {
  return d.all(
    `SELECT b.*,u.full_name created_by_name,
      (SELECT COUNT(*) FROM backup_restore_tests t WHERE t.backup_id=b.id) restore_tests,
      (SELECT MAX(tested_at) FROM backup_restore_tests t WHERE t.backup_id=b.id) last_restore_test_at
     FROM backup_records b
     LEFT JOIN users u ON u.id=b.created_by ORDER BY b.created_at DESC`,
  );
}

function file(id) {
  const row = d.get("SELECT * FROM backup_records WHERE id=?", id);
  if (!row) d.fail("النسخة الاحتياطية غير موجودة", 404);
  const target = path.join(config.backups, row.file_name);
  if (!fs.existsSync(target)) d.fail("ملف النسخة الاحتياطية مفقود", 404);
  return { row, target };
}

function health() {
  const last = d.get(
    "SELECT * FROM backup_records WHERE integrity_status='valid' ORDER BY created_at DESC LIMIT 1",
  );
  return {
    healthy:
      Boolean(last) && Date.now() - Date.parse(last.created_at + "Z") < 36 * 3600000,
    last,
  };
}

module.exports = { create, verify, dryRun, list, file, health };
