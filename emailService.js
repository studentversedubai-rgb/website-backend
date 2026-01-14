const { SESClient, SendEmailCommand } = require("@aws-sdk/client-ses");
require("dotenv").config();

const AWS_REGION = process.env.AWS_REGION;
const SES_FROM_EMAIL = process.env.SES_FROM_EMAIL;

if (!AWS_REGION || !SES_FROM_EMAIL) {
  console.error("Missing AWS SES configuration in .env");
  process.exit(1);
}

const sesClient = new SESClient({
  region: AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

/**
 * Send OTP email using Amazon SES
 */
async function sendOtpEmail(to, otp) {
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
  } catch (err) {
    console.error("SES error:", err);
    throw new Error("Failed to send OTP email");
  }
}

module.exports = { sendOtpEmail };
