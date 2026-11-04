module.exports = {
  apps: [
    {
      name: "kts-pos",
      script: "server/src/server.js",
      instances: 1, // Must be 1 instance to prevent SQLite file lock concurrency
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "development",
        PORT: 5000,
        HOST: "127.0.0.1",
      },
      env_production: {
        NODE_ENV: "production",
        PORT: 5000,
        HOST: "0.0.0.0",
      },
    },
  ],
};

