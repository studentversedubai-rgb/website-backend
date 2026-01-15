/**
 * Production Security Test Script
 * 
 * This script tests the production security features:
 * 1. Email enumeration protection
 * 2. IP-based rate limiting
 * 3. One-time data return
 * 
 * Run with: node test-security.js
 */

const BASE_URL = process.env.TEST_URL || "http://localhost:3000";

async function testEmailEnumerationProtection() {
    console.log("\n🔒 Testing Email Enumeration Protection...\n");

    // Test with a new email
    console.log("1. Testing with new email (doesn't exist):");
    const newEmailResponse = await fetch(`${BASE_URL}/api/waitlist/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "new-user-test@example.com" }),
    });
    const newEmailData = await newEmailResponse.json();
    console.log("Response:", newEmailData);

    // Test with an existing email (if you have one)
    console.log("\n2. Testing with existing email:");
    const existingEmailResponse = await fetch(`${BASE_URL}/api/waitlist/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "existing-user@example.com" }),
    });
    const existingEmailData = await existingEmailResponse.json();
    console.log("Response:", existingEmailData);

    console.log("\n✅ Both responses should be identical (generic message)");
}

async function testIPRateLimiting() {
    console.log("\n⏱️  Testing IP-Based Rate Limiting...\n");
    console.log("Sending 25 requests rapidly (limit is 20)...\n");

    let successCount = 0;
    let rateLimitCount = 0;

    for (let i = 1; i <= 25; i++) {
        const response = await fetch(`${BASE_URL}/api/waitlist/join`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: `test${i}@example.com` }),
        });

        const data = await response.json();

        if (response.status === 200) {
            successCount++;
            console.log(`Request ${i}: ✅ Success`);
        } else if (response.status === 429) {
            rateLimitCount++;
            console.log(`Request ${i}: ⛔ Rate Limited`);
        } else {
            console.log(`Request ${i}: ❌ Error (${response.status})`);
        }
    }

    console.log(`\n📊 Results:`);
    console.log(`   Success: ${successCount}`);
    console.log(`   Rate Limited: ${rateLimitCount}`);
    console.log(`   Expected: ~20 success, ~5 rate limited`);
}

async function testOTPVerification() {
    console.log("\n🔐 Testing OTP Verification Flow...\n");

    const testEmail = `test-${Date.now()}@example.com`;

    // Step 1: Join waitlist
    console.log("1. Joining waitlist...");
    const joinResponse = await fetch(`${BASE_URL}/api/waitlist/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            email: testEmail,
            referralCode: "TEST1234", // Optional
        }),
    });
    const joinData = await joinResponse.json();
    console.log("Join Response:", joinData);

    // Step 2: Verify with wrong OTP
    console.log("\n2. Testing with WRONG OTP (should fail)...");
    const wrongOtpResponse = await fetch(`${BASE_URL}/api/auth/verify-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            email: testEmail,
            otp: "000000", // Wrong OTP
        }),
    });
    const wrongOtpData = await wrongOtpResponse.json();
    console.log("Wrong OTP Response:", wrongOtpData);
    console.log("✅ Should show generic error message");

    console.log("\n⚠️  To complete this test:");
    console.log(`   1. Check your email (${testEmail}) for the OTP`);
    console.log(`   2. Or check server logs for the OTP code`);
    console.log(`   3. Then run this command:`);
    console.log(`\n   curl -X POST ${BASE_URL}/api/auth/verify-otp \\`);
    console.log(`     -H "Content-Type: application/json" \\`);
    console.log(`     -d '{"email": "${testEmail}", "otp": "YOUR_OTP_HERE"}'`);
    console.log(`\n   4. Verify you get: referralCode, referralCount, waitlistPosition`);
}

async function runAllTests() {
    console.log("🚀 StudentVerse Backend - Production Security Tests");
    console.log("=".repeat(60));

    try {
        await testEmailEnumerationProtection();

        console.log("\n" + "=".repeat(60));
        await testIPRateLimiting();

        console.log("\n" + "=".repeat(60));
        await testOTPVerification();

        console.log("\n" + "=".repeat(60));
        console.log("\n✅ All automated tests completed!");
        console.log("\n📝 Manual verification needed:");
        console.log("   - Complete OTP verification test above");
        console.log("   - Verify waitlist position calculation");
        console.log("   - Test referral code functionality");
        console.log("   - Verify one-time data return (can't fetch again)");
    } catch (error) {
        console.error("\n❌ Test failed:", error.message);
        console.error("\nMake sure the server is running on", BASE_URL);
    }
}

// Run tests
runAllTests();
