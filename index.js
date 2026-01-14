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
//const { generateOtp, setOtp, verifyOtp } = require('./otpStore');

const app = express();
app.use(cors());
app.use(express.json());
app.use("/api/contact", contactRoutes);
const PORT = process.env.PORT || 3000;
const REFERRAL_THRESHOLD = parseInt(process.env.REFERRAL_THRESHOLD || "5", 10);

// helper to generate referral codes
function generateReferralCode(length = 8) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < length; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

async function generateUniqueReferralCode() {
  while (true) {
    const code = generateReferralCode();
    const { data, error } = await supabase
      .from("waitlist_users")
      .select("id")
      .eq("referral_code", code)
      .maybeSingle();

    if (error) throw error;
    if (!data) return code;
  }
}

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

// better api route
app.post("/api/waitlist/join", async (req, res) => {
  const { email, referralCode } = req.body || {};

  if (!email) {
    return res.status(400).json({ error: "email is required" });
  }

  try {
    // Store pending signup data in Redis
    await storePendingSignup(email, referralCode);

    // Send OTP
    const result = await requestOtpForEmail(email);
    if (!result.ok) {
      return res.status(429).json({ error: result.error });
    }

    return res.json({
      ok: true,
      message: "OTP sent to email",
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Failed to start signup" });
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

// Verify OTP
app.post("/api/auth/verify-otp", async (req, res) => {
  const { email, otp } = req.body || {};

  if (!email || !otp) {
    return res.status(400).json({
      ok: false,
      error: "email and otp are required"
    });
  }

  try {
    // 1️⃣ Verify OTP FIRST (security boundary)
    const otpResult = await verifyOtpForEmail(email, otp);
    if (!otpResult.ok) {
      return res.status(400).json({
        ok: false,
        error: otpResult.error || "Invalid or expired OTP",
        errorType: "INVALID_OTP"
      });
    }

    // 2️⃣ Check if user already exists
    const { data: existingUser, error: fetchErr } = await supabase
      .from("waitlist_users")
      .select("*")
      .eq("email", email)
      .maybeSingle();

    if (fetchErr) {
      console.error("Database fetch error:", fetchErr);
      return res.status(500).json({
        ok: false,
        error: "Database error while fetching user",
        errorType: "DATABASE_ERROR"
      });
    }

    // ✅ Case A: User already exists & verified (login-like behavior)
    if (existingUser && existingUser.is_verified) {
      await clearPendingSignup(email);

      return res.json({
        ok: true,
        action: "login",
        message: "Welcome back! You're already verified.",
        userId: existingUser.id,
        email: existingUser.email,
        referralCode: existingUser.referral_code,
        referralCount: existingUser.referral_count || 0,
        isVerified: true,
      });
    }

    // ✅ Case B: User exists but not verified
    if (existingUser && !existingUser.is_verified) {
      const { error: updateErr } = await supabase
        .from("waitlist_users")
        .update({ is_verified: true })
        .eq("id", existingUser.id);

      if (updateErr) {
        console.error("Database update error:", updateErr);
        return res.status(500).json({
          ok: false,
          error: "Failed to update verification status",
          errorType: "DATABASE_ERROR"
        });
      }

      await clearPendingSignup(email);

      return res.json({
        ok: true,
        action: "verified",
        message: "Email verified successfully!",
        userId: existingUser.id,
        email: existingUser.email,
        referralCode: existingUser.referral_code,
        referralCount: existingUser.referral_count || 0,
        isVerified: true,
      });
    }

    // ✅ Case C: New user → create from pending signup
    const pending = await getPendingSignup(email);
    if (!pending) {
      return res.status(400).json({
        ok: false,
        error: "No pending signup found. Please restart signup.",
        errorType: "NO_PENDING_SIGNUP"
      });
    }

    const referralCode = pending.referralCode || null;
    const newReferralCode = await generateUniqueReferralCode();

    const { data: user, error: insertErr } = await supabase
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
      return res.status(500).json({
        ok: false,
        error: "Failed to create user account",
        errorType: "DATABASE_ERROR"
      });
    }

    // Apply referral logic
    if (referralCode) {
      const { data: referrer } = await supabase
        .from("waitlist_users")
        .select("*")
        .eq("referral_code", referralCode)
        .maybeSingle();

      if (referrer && referrer.email !== email) {
        await supabase
          .from("waitlist_users")
          .update({
            referral_count: (referrer.referral_count || 0) + 1,
          })
          .eq("id", referrer.id);

        await supabase.from("referral_events").insert({
          referrer_id: referrer.id,
          referred_id: user.id,
        });
      }
    }

    await clearPendingSignup(email);

    return res.json({
      ok: true,
      action: "signup",
      message: "Account created and verified successfully!",
      userId: user.id,
      email: user.email,
      referralCode: user.referral_code,
      referralCount: 0,
      isVerified: true,
    });
  } catch (err) {
    console.error("Unexpected error in verify-otp:", err);
    return res.status(500).json({
      ok: false,
      error: "An unexpected error occurred during verification",
      errorType: "INTERNAL_ERROR",
      detail: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
});

// -------------------- START SERVER --------------------
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
