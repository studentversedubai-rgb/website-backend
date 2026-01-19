const { SESClient, SendEmailCommand } = require("@aws-sdk/client-ses");
const { Resend } = require("resend");
require("dotenv").config();

// ==================== CONFIGURATION ====================

// Email Provider Selection
const EMAIL_PROVIDER = process.env.EMAIL_PROVIDER || "resend"; // 'resend' or 'ses'

// Resend Configuration
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM = process.env.RESEND_FROM || "onboarding@resend.dev";

// Amazon SES Configuration
const AWS_REGION = process.env.AWS_REGION;
const SES_FROM_EMAIL = process.env.SES_FROM_EMAIL;

// ==================== PROVIDER INITIALIZATION ====================

// Initialize Resend client
let resendClient = null;
if (RESEND_API_KEY) {
  resendClient = new Resend(RESEND_API_KEY);
  console.log("✅ Resend client initialized");
} else if (EMAIL_PROVIDER === "resend") {
  console.warn("⚠️  EMAIL_PROVIDER is 'resend' but RESEND_API_KEY is missing");
}

// Initialize SES client (kept for future use)
let sesClient = null;
if (AWS_REGION && process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
  sesClient = new SESClient({
    region: AWS_REGION,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });
  console.log("✅ SES client initialized (available but not active)");
} else if (EMAIL_PROVIDER === "ses") {
  console.error("❌ EMAIL_PROVIDER is 'ses' but AWS SES configuration is incomplete");
}

// ==================== RESEND IMPLEMENTATION ====================

/**
 * Send OTP email using Resend
 * @param {string} to - Recipient email address
 * @param {string} otp - 6-digit OTP code
 */
async function sendOtpViaResend(to, otp) {
  if (!resendClient) {
    throw new Error("Resend client not initialized. Check RESEND_API_KEY.");
  }

  const subject = "Your StudentVerse verification code";

  const text = `Your StudentVerse verification code is: ${otp}

This code expires in 10 minutes.

If you did not request this, please ignore this email.`;

  const html = `
    <p>Your StudentVerse verification code is:</p>
    <h2>${otp}</h2>
    <p>This code expires in <strong>10 minutes</strong>.</p>
    <p>If you did not request this, you can safely ignore this email.</p>
  `;

  try {
    const result = await resendClient.emails.send({
      from: RESEND_FROM,
      to,
      subject,
      text,
      html,
    });

    if (result.error) {
      console.error("Resend error:", result.error);
      throw new Error("Failed to send OTP email via Resend");
    }

    console.log(`✅ OTP email sent via Resend to ${to}`);
    return result;
  } catch (err) {
    console.error("Resend error:", err);
    throw new Error("Failed to send OTP email via Resend");
  }
}

// ==================== SES IMPLEMENTATION (PRESERVED) ====================

/**
 * Send OTP email using Amazon SES
 * @param {string} to - Recipient email address
 * @param {string} otp - 6-digit OTP code
 */
async function sendOtpViaSES(to, otp) {
  if (!sesClient) {
    throw new Error("SES client not initialized. Check AWS configuration.");
  }

  const subject = "Your StudentVerse verification code";

  const textBody = `
Your StudentVerse verification code is: ${otp}

This code expires in 10 minutes.

If you did not request this, please ignore this email.
  `.trim();

  const htmlBody = `
    <p>Your StudentVerse verification code is:</p>
    <h2>${otp}</h2>
    <p>This code expires in <strong>10 minutes</strong>.</p>
    <p>If you did not request this, you can safely ignore this email.</p>
  `;

  const command = new SendEmailCommand({
    Source: SES_FROM_EMAIL,
    Destination: {
      ToAddresses: [to],
    },
    Message: {
      Subject: {
        Data: subject,
        Charset: "UTF-8",
      },
      Body: {
        Text: {
          Data: textBody,
          Charset: "UTF-8",
        },
        Html: {
          Data: htmlBody,
          Charset: "UTF-8",
        },
      },
    },
  });

  try {
    await sesClient.send(command);
    console.log(`✅ OTP email sent via SES to ${to}`);
  } catch (err) {
    console.error("SES error:", err);
    throw new Error("Failed to send OTP email via SES");
  }
}

// ==================== ABSTRACTION LAYER ====================

/**
 * Send OTP email using the configured provider
 * This is the ONLY function that should be called by otpService.js
 * 
 * @param {string} to - Recipient email address
 * @param {string} otp - 6-digit OTP code
 */
async function sendOtpEmail(to, otp) {
  console.log(`📧 Sending OTP via ${EMAIL_PROVIDER.toUpperCase()} to ${to}`);

  if (EMAIL_PROVIDER === "resend") {
    return await sendOtpViaResend(to, otp);
  } else if (EMAIL_PROVIDER === "ses") {
    return await sendOtpViaSES(to, otp);
  } else {
    throw new Error(`Unknown EMAIL_PROVIDER: ${EMAIL_PROVIDER}. Use 'resend' or 'ses'.`);
  }
}

// ==================== EXPORTS ====================

module.exports = {
  sendOtpEmail,
  // Internal functions exported for testing/debugging only
  sendOtpViaResend,
  sendOtpViaSES,
};
