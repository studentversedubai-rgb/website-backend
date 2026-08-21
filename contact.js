const express = require('express');
const router = express.Router();
const { supabase } = require('./supabase');

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PRIORITIES = new Set(['Low', 'Medium', 'High']);
const CATEGORIES = new Set(['Account', 'Payments', 'Partnerships', 'App Bug', 'Other']);

function validateStringFields(fields) {
  for (const [name, value] of Object.entries(fields)) {
    if (value !== undefined && value !== null && typeof value !== 'string') {
      return `${name} must be a string`;
    }
  }

  return null;
}

function validateRequiredFields(fields) {
  const missing = Object.entries(fields)
    .filter(([, value]) => !value)
    .map(([name]) => name);

  return missing.length > 0
    ? `${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} required`
    : null;
}

function validateLengthLimits(fields, limits) {
  for (const [name, maxLength] of Object.entries(limits)) {
    const value = fields[name];
    if (value && value.length > maxLength) {
      return `${name} must be ${maxLength} characters or fewer`;
    }
  }

  return null;
}

async function insertSubmission(record, res, errorLabel) {
  try {
    const { data: inserted, error } = await supabase
      .from('contact_submissions')
      .insert(record)
      .select('id')
      .single();

    if (error) throw error;
    if (!inserted?.id) throw new Error('Supabase insert returned no submission id');

    return res.json({
      ok: true,
      submissionId: inserted.id
    });
  } catch (err) {
    console.error(`${errorLabel}:`, err);
    return res.status(500).json({
      error: 'Failed to submit message'
    });
  }
}

// POST /api/contact/submit
router.post('/submit', async (req, res) => {
  const {
    inquiryType,
    contactName,
    businessName,
    email,
    businessType,
    location,
    message
  } = req.body || {};

  const typeError = validateStringFields({
    inquiryType,
    contactName,
    businessName,
    email,
    businessType,
    location,
    message
  });
  if (typeError) return res.status(400).json({ error: typeError });

  const submission = {
    inquiryType: inquiryType?.trim(),
    contactName: contactName?.trim(),
    businessName: businessName?.trim(),
    email: email?.trim().toLowerCase(),
    businessType: businessType?.trim() || null,
    location: location?.trim() || null,
    message: message?.trim()
  };

  const requiredError = validateRequiredFields({
    inquiryType: submission.inquiryType,
    contactName: submission.contactName,
    businessName: submission.businessName,
    email: submission.email,
    message: submission.message
  });
  if (requiredError) return res.status(400).json({ error: requiredError });

  if (submission.inquiryType !== 'business') {
    return res.status(400).json({ error: 'Invalid inquiry type' });
  }

  if (!EMAIL_PATTERN.test(submission.email)) {
    return res.status(400).json({ error: 'Invalid email address' });
  }

  const lengthError = validateLengthLimits(submission, {
    contactName: 120,
    businessName: 160,
    email: 254,
    businessType: 100,
    location: 160,
    message: 5000
  });
  if (lengthError) return res.status(400).json({ error: lengthError });

  return insertSubmission({
    inquiry_type: 'business',
    contact_name: submission.contactName,
    business_name: submission.businessName,
    email: submission.email,
    business_type: submission.businessType,
    location: submission.location,
    priority: null,
    category: null,
    message: submission.message
  }, res, 'Business contact form error');
});

// POST /api/contact/support
router.post('/support', async (req, res) => {
  const {
    inquiryType,
    contactName,
    email,
    priority,
    category,
    message
  } = req.body || {};

  const typeError = validateStringFields({
    inquiryType,
    contactName,
    email,
    priority,
    category,
    message
  });
  if (typeError) return res.status(400).json({ error: typeError });

  const submission = {
    inquiryType: inquiryType?.trim(),
    contactName: contactName?.trim(),
    email: email?.trim().toLowerCase(),
    priority: priority?.trim(),
    category: category?.trim(),
    message: message?.trim()
  };

  const requiredError = validateRequiredFields(submission);
  if (requiredError) return res.status(400).json({ error: requiredError });

  if (submission.inquiryType !== 'support') {
    return res.status(400).json({ error: 'Invalid inquiry type' });
  }

  if (!EMAIL_PATTERN.test(submission.email)) {
    return res.status(400).json({ error: 'Invalid email address' });
  }

  const lengthError = validateLengthLimits(submission, {
    contactName: 120,
    email: 254,
    priority: 30,
    category: 100,
    message: 5000
  });
  if (lengthError) return res.status(400).json({ error: lengthError });

  if (!PRIORITIES.has(submission.priority)) {
    return res.status(400).json({ error: 'Invalid priority' });
  }

  if (!CATEGORIES.has(submission.category)) {
    return res.status(400).json({ error: 'Invalid category' });
  }

  return insertSubmission({
    inquiry_type: 'support',
    contact_name: submission.contactName,
    business_name: null,
    email: submission.email,
    business_type: null,
    location: null,
    priority: submission.priority,
    category: submission.category,
    message: submission.message
  }, res, 'Support contact form error');
});

module.exports = router;
