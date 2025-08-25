module.exports = {
  apps: [
    {
      name: "bot",
      script: "bot.js",
      cwd: __dirname,
      env_file: ".env",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
