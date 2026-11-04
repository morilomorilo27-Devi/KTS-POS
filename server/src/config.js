const path = require("node:path");
const root = path.resolve(__dirname, "../..");
module.exports = {
  root,
  client: path.join(root, "client"),
  database: process.env.KTS_DB_PATH || path.join(root, "database/kts_pos.db"),
  backups: process.env.KTS_BACKUP_DIR || path.join(root, "database/backups"),
  port: Number(process.env.PORT || 5000),
  host: process.env.HOST || (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1"),
  salt: process.env.KTS_SALT || "kts_pos_fixed_salt_2026",
};
