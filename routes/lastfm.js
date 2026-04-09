const express = require('express');
const router = express.Router();

const LASTFM_API_KEY = process.env.LASTFM_API_KEY || '4d927af2241b4f77b711972fb2112329';
const LASTFM_USERS  = { el: 'elliotmakesart', tero: 'afduarte1' };

// In-memory caches keyed by user
const cache       = {};
const recentCache = {};
const CACHE_TTL        = 60_000;
const RECENT_CACHE_TTL = 120_000;

router.get('/api/now-playing', async (req, res) => {
    const key = req.query.user;
    if (!LASTFM_USERS[key]) return res.status(400).json({ error: 'invalid user' });
    if (!LASTFM_API_KEY)    return res.json({ status: 'none' });

    const cached = cache[key];
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) return res.json(cached.data);

    try {
        const username = LASTFM_USERS[key];
        const url = `https://ws.audioscrobbler.com/2.0/?method=user.getRecentTracks&user=${username}&api_key=${LASTFM_API_KEY}&format=json&limit=1`;
        const r = await fetch(url);
        if (!r.ok) throw new Error(`Last.fm HTTP ${r.status}`);
        const json = await r.json();

        const tracks = json.recenttracks?.track;
        if (!tracks) {
            const d = { status: 'none' };
            cache[key] = { data: d, fetchedAt: Date.now() };
            return res.json(d);
        }

        const track      = Array.isArray(tracks) ? tracks[0] : tracks;
        const nowPlaying = track['@attr']?.nowplaying === 'true';
        const images     = track.image || [];
        const data = {
            nowPlaying,
            artist:    track.artist?.['#text'] || '',
            track:     track.name || '',
            album:     track.album?.['#text'] || '',
            image:     images.find(i => i.size === 'medium')?.['#text'] || '',
            imageUrl:  [...images].reverse().find(i => i['#text'])?.['#text'] || '',
            timestamp: nowPlaying ? null : (track.date?.uts ? Number(track.date.uts) * 1000 : null),
        };

        cache[key] = { data, fetchedAt: Date.now() };
        res.json(data);
    } catch (e) {
        console.error('Last.fm fetch error:', e.message);
        res.status(500).json({ error: 'fetch failed' });
    }
});

router.get('/api/recent-tracks', async (req, res) => {
    const key = req.query.user;
    if (!LASTFM_USERS[key]) return res.status(400).json({ error: 'invalid user' });
    if (!LASTFM_API_KEY)    return res.json({ tracks: [] });

    const cached = recentCache[key];
    if (cached && Date.now() - cached.fetchedAt < RECENT_CACHE_TTL) return res.json(cached.data);

    try {
        const username = LASTFM_USERS[key];
        const url = `https://ws.audioscrobbler.com/2.0/?method=user.getRecentTracks&user=${username}&api_key=${LASTFM_API_KEY}&format=json&limit=10`;
        const r = await fetch(url);
        if (!r.ok) throw new Error(`Last.fm HTTP ${r.status}`);
        const json = await r.json();
        const raw    = json.recenttracks?.track || [];
        const tracks = (Array.isArray(raw) ? raw : [raw]).map(t => {
            const images = t.image || [];
            return {
                track:    t.name || '—',
                artist:   t.artist?.['#text'] || '',
                imageUrl: [...images].reverse().find(i => i['#text'])?.['#text'] || '',
            };
        }).filter(t => t.imageUrl);
        const data = { tracks };
        recentCache[key] = { data, fetchedAt: Date.now() };
        res.json(data);
    } catch (e) {
        console.error('Last.fm recent-tracks error:', e.message);
        res.status(500).json({ error: 'fetch failed' });
    }
});

module.exports = router;
