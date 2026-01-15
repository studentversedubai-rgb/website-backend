const { redis } = require("./redisClient");
require("dotenv").config();

const IP_RATE_LIMIT_WINDOW_SECONDS = parseInt(
    process.env.IP_RATE_LIMIT_WINDOW_SECONDS || "60",
    10
); // 1 minute
const IP_RATE_LIMIT_MAX_REQUESTS = parseInt(
    process.env.IP_RATE_LIMIT_MAX_REQUESTS || "20",
    10
); // 20 requests per minute

/**
 * Check if an IP address can make a request based on rate limiting.
 * Returns true if allowed, false if rate limit exceeded.
 */
async function canRequestFromIp(ip, endpoint) {
    const key = `ratelimit:ip:${endpoint}:${ip}`;
    const count = await redis.incr(key);

    if (count === 1) {
        // First request, set expiry window
        await redis.expire(key, IP_RATE_LIMIT_WINDOW_SECONDS);
    }

    return count <= IP_RATE_LIMIT_MAX_REQUESTS;
}

/**
 * Get the client IP address from the request.
 * Handles proxies and load balancers.
 */
function getClientIp(req) {
    // Check common proxy headers first
    const forwarded = req.headers["x-forwarded-for"];
    if (forwarded) {
        // x-forwarded-for can contain multiple IPs, take the first one
        return forwarded.split(",")[0].trim();
    }

    const realIp = req.headers["x-real-ip"];
    if (realIp) {
        return realIp.trim();
    }

    // Fallback to direct connection IP
    return req.ip || req.connection?.remoteAddress || "unknown";
}

module.exports = {
    canRequestFromIp,
    getClientIp,
};
