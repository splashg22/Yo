// pm2:  pm2 start deploy/ecosystem.config.cjs && pm2 save && pm2 startup
// One bot per coin, started only for coins that have a settings file.
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");

const bot = (name, coin) => ({
  name,
  cwd: root,
  script: "node_modules/.bin/tsx",
  args: coin ? `src/cli.ts loop ${coin}` : "src/cli.ts loop",
  interpreter: "none",
  autorestart: true,
  restart_delay: 30000,
  // Exit code 2 = the books and the treasury disagree. Stay stopped until a person looks.
  stop_exit_codes: [2],
  kill_timeout: 300000, // let a transaction in flight finish
  time: true,
});

module.exports = {
  apps: [
    fs.existsSync(path.join(root, ".env")) && bot("dacity-bot"),
    fs.existsSync(path.join(root, ".env.llm")) && bot("llm-bot", "llm"),
  ].filter(Boolean),
};
