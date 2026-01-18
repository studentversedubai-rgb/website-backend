const express = require("express");
const cors = require("cors");
require("dotenv").config();
const contactRoutes = require("./contact");
const { supabase } = require("./supabase");
const {
  requestOtpForEmail,
  verifyOtpForEmail,
  storePendingSignup,
  getPendingSignup,
  clearPendingSignup,
} = require("./otpService");
const { canRequestFromIp, getClientIp } = require("./rateLimitService");
const {
  calculateWaitlistPosition,
  generateUniqueReferralCode,
  processReferral,
  getUserWaitlistData,
} = require("./waitlistService");

const app = express();
app.use(cors());
app.use(express.json());
app.use("/api/contact", contactRoutes);
const PORT = process.env.PORT || 3000;

// -------------------- WAITLIST JOIN --------------------
/*
app.post("/api/waitlist/join", async (req, res) => {
  const { email, referralCode } = req.body || {};

  if (!email) {
    return res.status(400).json({ error: "email is required" });
  }

  try {
    // 1. Check if user exists
    let { data: user, error: existingErr } = await supabase
      .from("waitlist_users")
      .select("*")
      .eq("email", email)
      .maybeSingle();

    if (existingErr) throw existingErr;

    // 2. If not exist, create new user with a referral_code
    if (!user) {
      const newCode = await generateUniqueReferralCode();

      const { data: inserted, error: insertErr } = await supabase
        .from("waitlist_users")
        .insert({
          email,
          referral_code: newCode,
        })
        .select()
        .single();

      if (insertErr) throw insertErr;
      user = inserted;
    }

    // 3. Handle referral code (optional)
    if (referralCode && !user.referred_by_id) {
      const { data: referrer, error: referrerErr } = await supabase
        .from("waitlist_users")
        .select("*")
        .eq("referral_code", referralCode)
        .maybeSingle();

      if (referrerErr) throw referrerErr;

      if (!referrer) {
        console.warn("Referral code not found, ignoring");
      } else if (referrer.email === email) {
        console.warn("Self-referral attempt, ignoring");
      } else {
        // set referred_by_id
        const { data: updatedUser, error: updateUserErr } = await supabase
          .from("waitlist_users")
          .update({ referred_by_id: referrer.id })
          .eq("id", user.id)
          .select()
          .single();
        if (updateUserErr) throw updateUserErr;
        user = updatedUser;

        // increment referral_count & maybe unlock reward
        const newCount = (referrer.referral_count || 0) + 1;
        const newStatus =
          newCount >= REFERRAL_THRESHOLD ? "unlocked" : referrer.reward_status;

        const { error: updateReferrerErr } = await supabase
          .from("waitlist_users")
          .update({
            referral_count: newCount,
            reward_status: newStatus,
          })
          .eq("id", referrer.id);
        if (updateReferrerErr) throw updateReferrerErr;

        // record referral event
        const { error: refEventErr } = await supabase
          .from("referral_events")
          .insert({
            referrer_id: referrer.id,
            referred_id: user.id,
          });
        if (refEventErr) throw refEventErr;
      }
    }

    return res.json({
      ok: true,
      userId: user.id,
      email: user.email,
      referralCode: user.referral_code,
      referralCount: user.referral_count,
      rewardStatus: user.reward_status,
      isVerified: user.is_verified,
    });
  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .json({ error: "Internal error", detail: String(err.message || err) });
  }
});
 */

// -------------------- WAITLIST JOIN --------------------
/**
 * POST /api/waitlist/join
 * 
 * Initiates waitlist signup by sending OTP to email.
 * Uses email enumeration protection - always returns generic response.
 * Implements IP-based rate limiting in addition to email-based limits.
 */
app.post("/api/waitlist/join", async (req, res) => {
  const { email, referralCode } = req.body || {};

  if (!email) {
    return res.status(400).json({ error: "Email is required" });
  }

  try {
    // 1️⃣ IP-based rate limiting (PRODUCTION SECURITY)
    const clientIp = getClientIp(req);
    const ipAllowed = await canRequestFromIp(clientIp, "waitlist-join");

    if (!ipAllowed) {
      // Generic response - don't reveal it's an IP rate limit
      return res.status(429).json({
        error: "Too many requests. Please try again later.",
      });
    }

    // 2️⃣ Store pending signup data in Redis (for later verification)
    await storePendingSignup(email, referralCode);

    // 3️⃣ Send OTP (has its own email-based rate limiting)
    const result = await requestOtpForEmail(email);

    if (!result.ok) {
      // Generic response - don't reveal if it's email rate limit or other issue
      return res.status(429).json({
        error: "Too many requests. Please try again later.",
      });
    }

    // 4️⃣ GENERIC RESPONSE (Email Enumeration Protection)
    // Never reveal whether email exists, is verified, or is already on waitlist
    return res.json({
      ok: true,
      message: "If this email is eligible, you will receive a verification code.",
    });
  } catch (err) {
    console.error("Error in /api/waitlist/join:", err);
    // Generic error response
    return res.status(500).json({
      error: "An error occurred. Please try again later.",
    });
  }
});

// -------------------- EMAIL VERIFICATION (METHOD A - REDIS + RESEND) --------------------

// Request OTP
/* 
app.post("/api/auth/request-otp", async (req, res) => {
  const { email } = req.body || {};

  if (!email) {
    return res.status(400).json({ error: "email is required" });
  }

  try {
    const { data: user, error: userErr } = await supabase
      .from("waitlist_users")
      .select("id")
      .eq("email", email)
      .maybeSingle();

    if (userErr) throw userErr;
    if (!user) {
      return res.status(400).json({
        error: "Email not found in waitlist. Join first.",
      });
    }

    const result = await requestOtpForEmail(email);
    if (!result.ok) {
      return res.status(429).json({
        ok: false,
        error: result.error,
      });
    }

    return res.json({
      ok: true,
      message: "OTP sent to email",
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      error: "Failed to generate OTP",
    });
  }
});
*/

// -------------------- OTP VERIFICATION --------------------
/**
 * POST /api/auth/verify-otp
 * 
 * Verifies OTP and completes signup/login.
 * 
 * PRODUCTION SECURITY FEATURES:
 * - IP-based rate limiting
 * - Email enumeration protection (generic responses)
 * - One-time data return (referral code + waitlist position)
 * - No authentication tokens (OTP is the only proof)
 * 
 * RESPONSE BEHAVIOR:
 * - Returns user data (referralCode, position) ONLY ONCE after successful verification
 * - Generic error messages that don't reveal user existence
 * - No way to fetch this data again without re-verifying
 */
app.post("/api/auth/verify-otp", async (req, res) => {
  const { email, otp } = req.body || {};

  if (!email || !otp) {
    return res.status(400).json({
      ok: false,
      error: "Email and verification code are required",
    });
  }

  try {
    // 1️⃣ IP-based rate limiting (PRODUCTION SECURITY)
    const clientIp = getClientIp(req);
    const ipAllowed = await canRequestFromIp(clientIp, "verify-otp");

    if (!ipAllowed) {
      // Generic response - don't reveal it's an IP rate limit
      return res.status(429).json({
        ok: false,
        error: "Too many requests. Please try again later.",
      });
    }

    // 2️⃣ Verify OTP (security boundary - validates email ownership)
    const otpResult = await verifyOtpForEmail(email, otp);

    if (!otpResult.ok) {
      // GENERIC ERROR (Email Enumeration Protection)
      // Don't reveal if OTP is wrong, expired, or email doesn't exist
      return res.status(400).json({
        ok: false,
        error: "Invalid or expired verification code",
      });
    }

    // ✅ OTP VERIFIED - Email ownership proven
    // Now we can safely interact with the database

    // 3️⃣ Check if user already exists in database
    const { data: existingUser, error: fetchErr } = await supabase
      .from("waitlist_users")
      .select("*")
      .eq("email", email)
      .maybeSingle();

    if (fetchErr) {
      console.error("Database fetch error:", fetchErr);
      return res.status(500).json({
        ok: false,
        error: "An error occurred. Please try again later.",
      });
    }

    // 📊 CASE A: User exists and is already verified (returning user)
    if (existingUser && existingUser.is_verified) {
      await clearPendingSignup(email);

      // Fetch complete waitlist data
      const waitlistData = await getUserWaitlistData(existingUser.id);

      if (!waitlistData) {
        return res.status(500).json({
          ok: false,
          error: "An error occurred. Please try again later.",
        });
      }

      // ONE-TIME DATA RETURN (no auth, no way to fetch again)
      return res.json({
        ok: true,
        referralCode: waitlistData.referralCode,
        position: waitlistData.position,
        referralCount: waitlistData.referralCount,
        rewardStatus: waitlistData.rewardStatus,
      });
    }

    // 📊 CASE B: User exists but not verified yet (first-time verification)
    if (existingUser && !existingUser.is_verified) {
      const { error: updateErr } = await supabase
        .from("waitlist_users")
        .update({ is_verified: true })
        .eq("id", existingUser.id);

      if (updateErr) {
        console.error("Database update error:", updateErr);
        return res.status(500).json({
          ok: false,
          error: "An error occurred. Please try again later.",
        });
      }

      await clearPendingSignup(email);

      // Fetch complete waitlist data
      const waitlistData = await getUserWaitlistData(existingUser.id);

      if (!waitlistData) {
        return res.status(500).json({
          ok: false,
          error: "An error occurred. Please try again later.",
        });
      }

      // ONE-TIME DATA RETURN
      return res.json({
        ok: true,
        referralCode: waitlistData.referralCode,
        position: waitlistData.position,
        referralCount: waitlistData.referralCount,
        rewardStatus: waitlistData.rewardStatus,
      });
    }

    // 📊 CASE C: New user - create account from pending signup
    const pending = await getPendingSignup(email);

    if (!pending) {
      // This shouldn't happen in normal flow, but handle gracefully
      return res.status(400).json({
        ok: false,
        error: "Verification session expired. Please restart signup.",
      });
    }

    const referralCode = pending.referralCode || null;
    const newReferralCode = await generateUniqueReferralCode();

    // Create new user account
    const { data: newUser, error: insertErr } = await supabase
      .from("waitlist_users")
      .insert({
        email,
        referral_code: newReferralCode,
        is_verified: true,
      })
      .select()
      .single();

    if (insertErr) {
      console.error("Database insert error:", insertErr);

      // Handle duplicate email (race condition edge case)
      if (insertErr.code === "23505") {
        return res.status(400).json({
          ok: false,
          error: "An account with this email already exists.",
        });
      }

      return res.status(500).json({
        ok: false,
        error: "An error occurred. Please try again later.",
      });
    }

    // Process referral if provided
    if (referralCode) {
      await processReferral(newUser.id, email, referralCode);
    }

    await clearPendingSignup(email);

    // Fetch complete waitlist data (includes updated referral count if referred)
    const waitlistData = await getUserWaitlistData(newUser.id);

    if (!waitlistData) {
      return res.status(500).json({
        ok: false,
        error: "An error occurred. Please try again later.",
      });
    }

    // ONE-TIME DATA RETURN (ONLY time user gets this data)
    return res.json({
      ok: true,
      referralCode: waitlistData.referralCode,
      position: waitlistData.position,
      referralCount: waitlistData.referralCount,
      rewardStatus: waitlistData.rewardStatus,
    });
  } catch (err) {
    console.error("Unexpected error in /api/auth/verify-otp:", err);

    // Generic error response (don't leak internal details)
    return res.status(500).json({
      ok: false,
      error: "An error occurred. Please try again later.",
    });
  }
});

// -------------------- START SERVER --------------------
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
