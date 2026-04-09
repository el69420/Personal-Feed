const express = require('express');
const router = express.Router();

// GET /api/letterboxd-meta?url=<letterboxd-url>  – extracts og: meta tags server-side
router.get('/api/letterboxd-meta', async (req, res) => {
    const url = req.query.url;
    if (!url || !url.startsWith('https://letterboxd.com/')) {
        return res.status(400).json({ error: 'invalid url' });
    }
    try {
        const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (!r.ok) return res.status(502).json({ error: 'fetch failed' });
        const html  = await r.text();
        const match = (prop) =>
            html.match(new RegExp(`<meta[^>]+property="${prop}"[^>]+content="([^"]+)"`))?.[1] ||
            html.match(new RegExp(`<meta[^>]+content="([^"]+)"[^>]+property="${prop}"`))?.[1] || null;
        res.json({ posterUrl: match('og:image'), description: match('og:description') });
    } catch (e) {
        console.error('letterboxd-meta error:', e.message);
        res.status(500).json({ error: 'fetch failed' });
    }
});

module.exports = router;
