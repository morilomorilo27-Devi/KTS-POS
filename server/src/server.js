const app = require("./app");
const config = require("./config");
const { db } = require("./db");
const backups = require("./services/backupService");
const server = app.listen(config.port, config.host, () =>
  console.log(`KTS POS: http://${config.host}:${config.port}`),
);
backups.create(null, "scheduled").catch(console.error);
const timer = setInterval(
  () => backups.create(null, "scheduled").catch(console.error),
  24 * 3600000,
);
timer.unref();
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () =>
    server.close(() => {
      db.close();
      process.exit(0);
    }),
  );
