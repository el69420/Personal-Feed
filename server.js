require('dotenv').config();
const express = require('express');
const path = require('path');

const app = express();
const LASTFM_API_KEY = process.env.LASTFM_API_KEY || '';
const LASTFM_USERS = { el: 'elliotmakesart', tero: 'afduarte1' };

// In-memory cache per user: { userKey: { data, fetchedAt } }
const cache = {};
const CACHE_TTL = 60_000;

app.use(express.static(path.join(__dirname)));

app.get('/api/now-playing', async (req, res) => {
    const key = req.query.user;
    if (!LASTFM_USERS[key]) return res.status(400).json({ error: 'invalid user' });

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

        const track = Array.isArray(tracks) ? tracks[0] : tracks;
        const nowPlaying = track['@attr']?.nowplaying === 'true';
        const data = {
            nowPlaying,
            artist:    track.artist?.['#text'] || '',
            track:     track.name || '',
            album:     track.album?.['#text'] || '',
            image:     (track.image || []).find(i => i.size === 'medium')?.['#text'] || '',
            timestamp: nowPlaying ? null : (track.date?.uts ? Number(track.date.uts) * 1000 : null),
        };

        cache[key] = { data, fetchedAt: Date.now() };
        res.json(data);
    } catch (e) {
        console.error('Last.fm fetch error:', e.message);
        res.status(500).json({ error: 'fetch failed' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Personal Feed running on http://localhost:${PORT}`));
