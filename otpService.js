const crypto = require("crypto");
const { redis } = require("./redisClient");
const { sendOtpEmail } = require("./emailService");
require("dotenv").config();

const OTP_SECRET = process.env.OTP_SECRET || "dev-secret";
const OTP_TTL_SECONDS = parseInt(process.env.OTP_TTL_SECONDS || "600", 10); // 10 min
const OTP_MAX_ATTEMPTS = parseInt(process.env.OTP_MAX_ATTEMPTS || "5", 10);
const OTP_REQUESTS_PER_HOUR = parseInt(
  process.env.OTP_REQUESTS_PER_HOUR || "5",
  10
);

/**
 * Generate a 6-digit OTP like "123456".
 */
function generateOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * Hash OTP with email using HMAC-SHA256.
 */
function hashOtp(email, otp) {
  const h = crypto.createHmac("sha256", OTP_SECRET);
  h.update(`${email.toLowerCase()}:${otp}`);
  return h.digest("hex");
}

/**
 * Rate limit OTP requests per email per hour.
 */
async function canRequestOtp(email) {
  const key = `otp:req:email:${email.toLowerCase()}`;
  const count = await redis.incr(key);

  if (count === 1) {
    // set 1 hour window
    await redis.expire(key, 60 * 60);
  }

  return count <= OTP_REQUESTS_PER_HOUR;
}

/**
 * Store OTP hash + attempts in Redis with TTL.
 */
async function storeOtp(email, otp) {
  const key = `otp:email:${email.toLowerCase()}`;
  const otpHash = hashOtp(email, otp);

  await redis.hset(key, {
    hash: otpHash,
    attempts: "0",
  });
  await redis.expire(key, OTP_TTL_SECONDS);
}

/**
 * Check OTP from Redis, enforce attempts limit.
 */
async function checkOtp(email, otp) {
  const key = `otp:email:${email.toLowerCase()}`;

  const exists = await redis.exists(key);
  if (!exists) {
    return { ok: false, error: "OTP not found or expired" };
  }

  const data = await redis.hgetall(key);
  const attempts = parseInt(data.attempts || "0", 10);
  const storedHash = data.hash;

  if (!storedHash) {
    return { ok: false, error: "OTP not found or expired" };
  }

  if (attempts >= OTP_MAX_ATTEMPTS) {
    return { ok: false, error: "Too many attempts" };
  }

  const candidateHash = hashOtp(email, otp);

  let match = false;
  try {
    match = crypto.timingSafeEqual(
      Buffer.from(storedHash),
      Buffer.from(candidateHash)
    );
  } catch {
    match = false;
  }

  if (!match) {
    await redis.hincrby(key, "attempts", 1);
    return { ok: false, error: "Invalid OTP" };
  }

  // success: delete key so OTP can't be reused
  await redis.del(key);
  return { ok: true };
}

/**
 * High-level: generate OTP, store, send via Resend.
 */
async function requestOtpForEmail(email) {
  // rate-limit per email
  const allowed = await canRequestOtp(email);
  if (!allowed) {
    return { ok: false, error: "Too many OTP requests. Try again later." };
  }

  const otp = generateOtp();

  await storeOtp(email, otp);
  await sendOtpEmail(email, otp);

  console.log(`OTP for ${email}: ${otp}`); // still useful in dev

  return { ok: true };
}

/**
 * High-level: verify OTP using Redis.
 */
async function verifyOtpForEmail(email, otp) {
  const result = await checkOtp(email, otp);
  return result;
}

// -------------------- PENDING WAITLIST SIGNUP --------------------

function pendingKey(email) {
  return `pending:waitlist:${email.toLowerCase()}`;
}

async function storePendingSignup(email, referralCode) {
  const key = pendingKey(email);

  await redis.hset(key, {
    email: email.toLowerCase(),
    referralCode: referralCode || "",
  });

  await redis.expire(key, OTP_TTL_SECONDS);
}

async function getPendingSignup(email) {
  const key = pendingKey(email);
  const data = await redis.hgetall(key);

  if (!data || !data.email) return null;
  return data;
}

async function clearPendingSignup(email) {
  await redis.del(pendingKey(email));
}

module.exports = {
  requestOtpForEmail,
  verifyOtpForEmail,
  storePendingSignup,
  getPendingSignup,
  clearPendingSignup,
};
