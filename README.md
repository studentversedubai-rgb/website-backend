# StudentVerse Backend - Production Ready

## 🚀 Production Security Features

This backend is production-ready with enterprise-level security features implemented for the Jan 21 launch.

### ✅ Implemented Security Features

#### 1️⃣ **Email Enumeration Protection**
- All OTP-related endpoints return **generic responses**
- Never reveals whether an email:
  - Exists in the database
  - Is already verified
  - Is already on the waitlist
- Example response: `"If this email is eligible, you will receive a verification code."`

#### 2️⃣ **IP-Based Rate Limiting**
- Protects against abuse from single IP addresses
- Applied to critical endpoints:
  - `/api/waitlist/join` - 20 requests per minute per IP
  - `/api/auth/verify-otp` - 20 requests per minute per IP
- Works **alongside** existing email-based rate limiting
- Configurable via environment variables

#### 3️⃣ **One-Time Data Return (No Auth)**
- User data (referral code, waitlist position) returned **ONLY ONCE** after OTP verification
- No JWT, no sessions, no cookies, no passwords
- No endpoint exists to fetch user data again by email
- Frontend must store and display data client-side

#### 4️⃣ **Waitlist Position Calculation**
- Position calculated at verification time based on `created_at` timestamp
- 1-based indexing (first user = position 1)
- Returned in OTP verification response

#### 5️⃣ **Existing Security Maintained**
- ✅ Redis OTP TTL (10 minutes)
- ✅ OTP max attempts (5 attempts)
- ✅ Email ownership verification
- ✅ Pending signup storage in Redis
- ✅ Referral locking (no self-referrals)
- ✅ Unique database constraints

## 📡 API Endpoints

### POST `/api/waitlist/join`

Initiates waitlist signup by sending OTP to email.

**Request:**
```json
{
  "email": "user@example.com",
  "referralCode": "ABC12345" // optional
}
```

**Success Response (200):**
```json
{
  "ok": true,
  "message": "If this email is eligible, you will receive a verification code."
}
```

**Error Responses:**
- `400` - Missing email
- `429` - Rate limit exceeded (IP or email)
- `500` - Server error

**Security Features:**
- ✅ Email enumeration protection
- ✅ IP-based rate limiting
- ✅ Email-based rate limiting (5 requests/hour)
- ✅ Generic error messages

---

### POST `/api/auth/verify-otp`

Verifies OTP and completes signup/login. Returns user data **ONLY ONCE**.

**Request:**
```json
{
  "email": "user@example.com",
  "otp": "123456"
}
```

**Success Response (200):**
```json
{
  "ok": true,
  "action": "signup", // or "login" or "verified"
  "message": "Account created and verified successfully!",
  "data": {
    "referralCode": "ABC12345",
    "referralCount": 0,
    "waitlistPosition": 42
  }
}
```

**Error Responses:**
- `400` - Missing email/OTP or invalid OTP
- `429` - Rate limit exceeded
- `500` - Server error

**Security Features:**
- ✅ Email enumeration protection
- ✅ IP-based rate limiting
- ✅ OTP verification (max 5 attempts)
- ✅ One-time data return
- ✅ Generic error messages

**Response Actions:**
- `signup` - New user created
- `verified` - Existing unverified user now verified
- `login` - Returning verified user

---

## 🔧 Environment Variables

### Required Variables

```bash
# Server
PORT=3000

# Supabase
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# OTP Configuration
OTP_SECRET=your-random-secret-string
OTP_TTL_SECONDS=600              # 10 minutes
OTP_MAX_ATTEMPTS=5               # Max verification attempts
OTP_REQUESTS_PER_HOUR=5          # Max OTP requests per email per hour

# IP Rate Limiting (NEW)
IP_RATE_LIMIT_WINDOW_SECONDS=60  # 1 minute window
IP_RATE_LIMIT_MAX_REQUESTS=20    # Max requests per IP per window

# Redis (Upstash)
REDIS_URL=your_redis_url

# Amazon SES
AWS_REGION=your_aws_region
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key
SES_FROM_EMAIL=your_verified_email@domain.com
```

### Optional Variables

```bash
NODE_ENV=production  # Set to 'development' for detailed error messages
```

---

## 📁 Project Structure

```
Backend - Copy/
├── index.js                 # Main Express app with routes
├── otpService.js           # OTP generation, storage, verification
├── rateLimitService.js     # IP-based rate limiting (NEW)
├── waitlistService.js      # Waitlist position, referral logic (NEW)
├── emailService.js         # Amazon SES email sending
├── redisClient.js          # Redis connection
├── supabase.js             # Supabase client
├── contact.js              # Contact form routes
├── .env                    # Environment variables (DO NOT COMMIT)
├── .env.example            # Environment template
└── package.json            # Dependencies
```

---

## 🗄️ Database Schema

### `waitlist_users` Table

```sql
CREATE TABLE waitlist_users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT UNIQUE NOT NULL,
  referral_code TEXT UNIQUE NOT NULL,
  is_verified BOOLEAN DEFAULT FALSE,
  referral_count INTEGER DEFAULT 0,
  referred_by_id UUID REFERENCES waitlist_users(id),
  created_at TIMESTAMP DEFAULT NOW()
);
```

### `referral_events` Table

```sql
CREATE TABLE referral_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  referrer_id UUID REFERENCES waitlist_users(id),
  referred_id UUID REFERENCES waitlist_users(id),
  created_at TIMESTAMP DEFAULT NOW()
);
```

---

## 🔒 Security Best Practices

### What This Backend Does ✅

1. **Email Enumeration Protection** - Never reveals user existence
2. **IP Rate Limiting** - Prevents abuse from single IPs
3. **Email Rate Limiting** - Prevents spam to single emails
4. **OTP Verification** - Proves email ownership
5. **One-Time Data Return** - No persistent sessions
6. **Generic Error Messages** - Doesn't leak internal state
7. **Referral Validation** - Prevents self-referrals and invalid codes

### What This Backend Does NOT Do ❌

1. **No Authentication System** - No JWT, sessions, or cookies
2. **No Passwords** - OTP is the only identity proof
3. **No User Data Endpoints** - Can't fetch user data by email
4. **No Persistent Sessions** - Each OTP verification is independent

---

## 🚀 Deployment Checklist

Before deploying to production on Jan 21:

- [ ] Set `NODE_ENV=production` in environment
- [ ] Verify all environment variables are set correctly
- [ ] Test IP rate limiting with multiple requests
- [ ] Test email enumeration protection (try existing/non-existing emails)
- [ ] Verify OTP emails are being sent via Amazon SES
- [ ] Test referral code logic (valid, invalid, self-referral)
- [ ] Verify waitlist position calculation
- [ ] Test one-time data return (verify you can't fetch data again)
- [ ] Check Redis connection and TTL expiration
- [ ] Monitor server logs for errors
- [ ] Set up error monitoring (Sentry, LogRocket, etc.)

---

## 📊 Rate Limiting Details

### Email-Based Rate Limiting
- **Endpoint:** All OTP requests
- **Limit:** 5 OTP requests per email per hour
- **Storage:** Redis with 1-hour TTL
- **Key Format:** `otp:req:email:{email}`

### IP-Based Rate Limiting
- **Endpoints:** `/api/waitlist/join`, `/api/auth/verify-otp`
- **Limit:** 20 requests per IP per minute (configurable)
- **Storage:** Redis with 1-minute TTL
- **Key Format:** `ratelimit:ip:{endpoint}:{ip}`
- **IP Detection:** Handles proxies via `x-forwarded-for` and `x-real-ip` headers

---

## 🧪 Testing

### Test Email Enumeration Protection

```bash
# Try with existing email
curl -X POST http://localhost:3000/api/waitlist/join \
  -H "Content-Type: application/json" \
  -d '{"email": "existing@example.com"}'

# Try with non-existing email
curl -X POST http://localhost:3000/api/waitlist/join \
  -H "Content-Type: application/json" \
  -d '{"email": "new@example.com"}'

# Both should return the same generic message
```

### Test IP Rate Limiting

```bash
# Send 25 requests rapidly (should hit limit at 20)
for i in {1..25}; do
  curl -X POST http://localhost:3000/api/waitlist/join \
    -H "Content-Type: application/json" \
    -d '{"email": "test'$i'@example.com"}'
  echo ""
done
```

### Test OTP Verification

```bash
# 1. Join waitlist
curl -X POST http://localhost:3000/api/waitlist/join \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com", "referralCode": "ABC12345"}'

# 2. Check server logs for OTP code

# 3. Verify OTP (returns data ONLY ONCE)
curl -X POST http://localhost:3000/api/auth/verify-otp \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com", "otp": "123456"}'
```

---

## 🛠️ Development

### Install Dependencies

```bash
npm install
```

### Run Development Server

```bash
npm start
# or
node index.js
```

### Dependencies

- `express` - Web framework
- `cors` - CORS middleware
- `dotenv` - Environment variables
- `ioredis` - Redis client
- `@supabase/supabase-js` - Supabase client
- `@aws-sdk/client-ses` - Amazon SES client

---

## 📝 Notes

### Frontend Integration

The frontend should:

1. **Store user data client-side** after OTP verification (localStorage, state management)
2. **Display waitlist position** from the verification response
3. **Show referral code** for sharing
4. **Handle generic error messages** gracefully
5. **Not attempt to fetch user data** again (no endpoint exists)

### Example Frontend Flow

```javascript
// 1. User joins waitlist
const joinResponse = await fetch('/api/waitlist/join', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, referralCode })
});

// 2. User enters OTP
const verifyResponse = await fetch('/api/auth/verify-otp', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, otp })
});

const { data } = await verifyResponse.json();

// 3. Store data client-side (ONLY TIME YOU GET THIS)
localStorage.setItem('userData', JSON.stringify(data));
// data = { referralCode, referralCount, waitlistPosition }

// 4. Display to user
console.log(`Your position: ${data.waitlistPosition}`);
console.log(`Your referral code: ${data.referralCode}`);
```

---

## 🐛 Troubleshooting

### OTP Not Received
- Check Amazon SES configuration
- Verify `SES_FROM_EMAIL` is verified in AWS
- Check spam folder
- Check server logs for SES errors

### Rate Limit Issues
- Adjust `IP_RATE_LIMIT_MAX_REQUESTS` in `.env`
- Adjust `OTP_REQUESTS_PER_HOUR` in `.env`
- Check Redis connection

### Waitlist Position Incorrect
- Verify `created_at` column exists in database
- Check database timezone settings
- Ensure users are ordered by `created_at ASC`

---

## 📄 License

Private - StudentVerse

---

## 👨‍💻 Support

For issues or questions, contact the development team.

**Production Launch:** January 21, 2026 🚀
