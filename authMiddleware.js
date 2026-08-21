require('dotenv').config();

function requireAdmin(req, res, next) {
  const providedKey = req.headers['x-admin-key'];

  if (!providedKey || providedKey !== process.env.ADMIN_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized: Invalid or missing API key' });
  }

  next();
}

module.exports = { requireAdmin };
