const express = require('express');
const router = express.Router();
const ytdlp = require('../services/ytdlp');

router.get('/', async (req, res) => {
  const { q, limit } = req.query;

  if (!q || !q.trim()) {
    return res.status(400).json({ error: 'Query parameter q is required' });
  }

  try {
    const results = await ytdlp.search(q.trim(), parseInt(limit, 10) || 12);
    res.json({ results });
  } catch (err) {
    console.error('Search error:', err.message);
    res.status(500).json({ error: err.message || 'Search failed' });
  }
});

module.exports = router;
