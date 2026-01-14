const Redis = require("ioredis");
require("dotenv").config();

const rawUrl = process.env.REDIS_URL || "";

if (!rawUrl) {
  console.error("Missing REDIS_URL in .env");
  process.exit(1);
}

// Just in case there are accidental quotes in env, strip them
const redisUrl = rawUrl.replace(/^"|"$/g, "");

const redis = new Redis(redisUrl);

redis.on("connect", () => {
  console.log("Connected to Redis");
});

redis.on("error", (err) => {
  console.error("Redis error:", err);
});

module.exports = { redis };
