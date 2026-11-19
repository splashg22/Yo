// pm2:  pm2 start deploy/ecosystem.config.cjs && pm2 save && pm2 startup
module.exports = {
  apps: [
    {
      name: "dacity-bot",
      cwd: __dirname + "/..",
      script: "node_modules/.bin/tsx",
      args: "src/cli.ts loop",
      interpreter: "none",
      autorestart: true,
      restart_delay: 30000,
      // Exit code 2 = the books and the treasury disagree. Stay stopped until a person looks.
      stop_exit_codes: [2],
      kill_timeout: 300000, // let a transaction in flight finish
      time: true,
    },
  ],
};
