const express = require('express');
const router = express.Router();
const { supabase } = require('./supabase');

const requiredFields = [
  'status',
  'type',
  'livesituation',
  'university',
  'studycity',
  'livecity',
  'name',
  'email',
];

router.post('/', async (req, res) => {
  const payload = req.body || {};

  for (const field of requiredFields) {
    if (!payload[field]) {
      return res.status(400).json({ error: `${field} is required` });
    }
  }

  const record = {
    status: payload.status,
    type: payload.type,
    livesituation: payload.livesituation,
    university: payload.university,
    studycity: payload.studycity,
    livecity: payload.livecity,
    name: payload.name,
    email: payload.email,
    intent: payload.intent || null,
    budget: payload.budget || null,
    placetype: payload.placetype || null,
    priority: payload.priority || null,
    frustration: payload.frustration || null,
    channels: Array.isArray(payload.channels)
      ? payload.channels.join(', ')
      : payload.channels || null,
    wand: payload.wand || null,
    optin: payload.optin || null,
    submitted_at: new Date().toISOString(),
  };

  try {
    const { data, error } = await supabase.from('survey_responses').insert([record]);

    if (error) {
      console.error('Survey insert error:', error);
      return res.status(500).json({ error: error.message });
    }

    return res.json({ ok: true, data });
  } catch (err) {
    console.error('Survey submission error:', err);
    return res.status(500).json({ error: 'Failed to submit survey response' });
  }
});

module.exports = router;
