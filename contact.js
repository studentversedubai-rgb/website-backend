const express = require('express');
const router = express.Router();
const { supabase } = require('./supabase');

// POST /api/contact/submit
router.post('/submit', async (req, res) => {
  const {
    firstName,
    lastName,
    email,
    message,
    inquiryType
  } = req.body || {};

  // Basic validation
  if (!firstName || !lastName || !email || !message || !inquiryType) {
    return res.status(400).json({
      error: 'All fields are required'
    });
  }

  // Only allow known dropdown values
  if (!['student_support', 'merchant_business'].includes(inquiryType)) {
    return res.status(400).json({
      error: 'Invalid inquiry type'
    });
  }

  try {
    const { error } = await supabase
      .from('contact_messages')
      .insert({
        first_name: firstName,
        last_name: lastName,
        email,
        message,
        inquiry_type: inquiryType
      });

    if (error) throw error;

    return res.json({
      ok: true,
      message: 'Message submitted successfully'
    });
  } catch (err) {
    console.error('Contact form error:', err);
    return res.status(500).json({
      error: 'Failed to submit message'
    });
  }
});

module.exports = router;
