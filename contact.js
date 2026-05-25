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
      .from('test_contact_business')
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

// POST /api/contact/support
router.post('/support', async (req, res) => {
  const { name, email, priority, category, message } = req.body || {};

  if (!name || !email || !priority || !category || !message) {
    return res.status(400).json({
      error: 'All fields are required'
    });
  }

  try {
    const { error } = await supabase
      .from('test_contact_support')
      .insert({
        first_name: name,
        last_name: '', // support form doesn't collect last name
        email,
        message: `Priority: ${priority}\nCategory: ${category}\n\n${message}`,
        inquiry_type: 'student_support'
      });

    if (error) throw error;

    return res.json({
      ok: true,
      message: 'Support ticket submitted successfully'
    });
  } catch (err) {
    console.error('Support form error:', err);
    return res.status(500).json({
      error: 'Failed to submit support ticket'
    });
  }
});

module.exports = router;
