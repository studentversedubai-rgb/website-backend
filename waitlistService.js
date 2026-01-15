const { supabase } = require("./supabase");

/**
 * Calculate waitlist position for a user based on created_at timestamp.
 * Position is 1-based (first user = position 1).
 * 
 * @param {string} userId - The user's ID
 * @returns {Promise<number>} The user's position in the waitlist
 */
async function calculateWaitlistPosition(userId) {
    try {
        // Get the user's created_at timestamp
        const { data: user, error: userError } = await supabase
            .from("waitlist_users")
            .select("created_at")
            .eq("id", userId)
            .single();

        if (userError || !user) {
            console.error("Error fetching user for position calculation:", userError);
            return null;
        }

        // Count how many users were created before this user
        const { count, error: countError } = await supabase
            .from("waitlist_users")
            .select("id", { count: "exact", head: true })
            .lt("created_at", user.created_at);

        if (countError) {
            console.error("Error counting users for position:", countError);
            return null;
        }

        // Position is count + 1 (1-based indexing)
        return (count || 0) + 1;
    } catch (err) {
        console.error("Unexpected error calculating waitlist position:", err);
        return null;
    }
}

/**
 * Generate a random referral code.
 * Uses alphanumeric characters excluding ambiguous ones (0, O, I, 1).
 */
function generateReferralCode(length = 8) {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";
    for (let i = 0; i < length; i++) {
        code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
}

/**
 * Generate a unique referral code that doesn't exist in the database.
 */
async function generateUniqueReferralCode() {
    let attempts = 0;
    const maxAttempts = 10;

    while (attempts < maxAttempts) {
        const code = generateReferralCode();
        const { data, error } = await supabase
            .from("waitlist_users")
            .select("id")
            .eq("referral_code", code)
            .maybeSingle();

        if (error) throw error;
        if (!data) return code;

        attempts++;
    }

    throw new Error("Failed to generate unique referral code after multiple attempts");
}

/**
 * Process referral logic when a new user signs up with a referral code.
 * Updates referrer's count and creates referral event.
 * 
 * @param {string} newUserId - The new user's ID
 * @param {string} newUserEmail - The new user's email
 * @param {string} referralCode - The referral code used
 */
async function processReferral(newUserId, newUserEmail, referralCode) {
    if (!referralCode) return;

    try {
        // Find the referrer
        const { data: referrer, error: referrerError } = await supabase
            .from("waitlist_users")
            .select("*")
            .eq("referral_code", referralCode)
            .maybeSingle();

        if (referrerError) {
            console.error("Error finding referrer:", referrerError);
            return;
        }

        // Validate referral
        if (!referrer) {
            console.warn(`Referral code ${referralCode} not found, ignoring`);
            return;
        }

        if (referrer.email === newUserEmail) {
            console.warn("Self-referral attempt detected, ignoring");
            return;
        }

        // Update referrer's count
        const newCount = (referrer.referral_count || 0) + 1;
        const { error: updateError } = await supabase
            .from("waitlist_users")
            .update({
                referral_count: newCount,
            })
            .eq("id", referrer.id);

        if (updateError) {
            console.error("Error updating referrer count:", updateError);
            return;
        }

        // Record referral event
        const { error: eventError } = await supabase
            .from("referral_events")
            .insert({
                referrer_id: referrer.id,
                referred_id: newUserId,
            });

        if (eventError) {
            console.error("Error recording referral event:", eventError);
        }
    } catch (err) {
        console.error("Unexpected error processing referral:", err);
    }
}

module.exports = {
    calculateWaitlistPosition,
    generateUniqueReferralCode,
    processReferral,
};
