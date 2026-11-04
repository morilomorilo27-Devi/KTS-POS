const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");

const data = path.resolve(process.env.RAILWAY_VOLUME_MOUNT_PATH || process.env.KTS_PREVIEW_DATA || "");
if (!process.env.RAILWAY_VOLUME_MOUNT_PATH && !process.env.KTS_PREVIEW_DATA)
  throw new Error("Attach a persistent volume before starting the preview.");
if (!fs.statSync(data).isDirectory()) throw new Error("Invalid preview volume.");

process.env.KTS_DB_PATH = path.join(data, "kts_pos.db");
process.env.KTS_BACKUP_DIR = path.join(data, "backups");
const config = require("./server/src/config");
const uploads = path.join(data, "uploads");
fs.mkdirSync(uploads, { recursive: true });
const link = path.join(config.client, "images", "uploads");
if (!fs.existsSync(link)) fs.symlinkSync(uploads, link, "junction");
if (fs.realpathSync(link) !== fs.realpathSync(uploads))
  throw new Error("Uploaded images must be stored on the preview volume.");

if (!fs.existsSync(config.database)) {
  const passwords = [process.env.KTS_PREVIEW_ADMIN_PASSWORD, process.env.KTS_PREVIEW_CASHIER_PASSWORD];
  if (passwords.some((value) => !value || value.length < 16) || passwords[0] === passwords[1])
    throw new Error("Set distinct preview passwords of at least 16 characters.");
  const temp = path.join(data, ".bootstrap-" + crypto.randomUUID());
  try {
    fs.copyFileSync(path.join(__dirname, "preview-seed.db"), temp, fs.constants.COPYFILE_EXCL);
    const db = new DatabaseSync(temp);
    try {
      const update = db.prepare("UPDATE users SET password_hash=?,status='active' WHERE id=?");
      for (const [i, id] of ["usr-admin", "usr-cashier-1"].entries()) {
        const hash = crypto.pbkdf2Sync(passwords[i], config.salt, 10000, 64, "sha512").toString("hex");
        if (update.run(hash, id).changes !== 1) throw new Error("Missing preview user.");
      }
    } finally {
      db.close();
    }
    fs.renameSync(temp, config.database);
  } finally {
    fs.rmSync(temp, { force: true });
  }
}

require("./server/src/server");
