require('dotenv').config();
const express = require('express');
const path = require('path');

const app = express();
app.use(express.json());

const LASTFM_API_KEY = process.env.LASTFM_API_KEY || '';
const LASTFM_USERS = { el: 'elliotmakesart', tero: 'afduarte1' };

// In-memory cache per user: { userKey: { data, fetchedAt } }
const cache = {};
const CACHE_TTL = 60_000;

app.use(express.static(path.join(__dirname)));

app.get('/api/now-playing', async (req, res) => {
    const key = req.query.user;
    if (!LASTFM_USERS[key]) return res.status(400).json({ error: 'invalid user' });
    if (!LASTFM_API_KEY)   return res.json({ status: 'none' });

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

// ===== Garden API =====

const GARDEN_PLANT_UNLOCKS = [
    { streak: 3,  id: 'daisy' },
    { streak: 7,  id: 'tulip' },
    { streak: 14, id: 'rose' },
    { streak: 30, id: 'orchid' },
];
const GARDEN_VALID_PLANTS = ['sunflower', 'daisy', 'tulip', 'rose', 'orchid'];

// POST /api/garden/water
// Body: { lastStreakDay, wateringStreak, lastWatered, plantedAt, unlockedPlants }
// Returns computed streak update using server date (UTC YYYY-MM-DD)
app.post('/api/garden/water', (req, res) => {
    const {
        lastStreakDay  = null,
        wateringStreak = 0,
        lastWatered    = null,
        plantedAt      = null,
        unlockedPlants = [],
    } = req.body || {};

    const now = Date.now();
    const MS_HOUR = 3600000;

    // Server date in UTC
    const today     = new Date(now).toISOString().slice(0, 10);
    const yesterday = new Date(now - 86400000).toISOString().slice(0, 10);

    // Determine if plant is currently wilted
    const ageHrs       = plantedAt ? (now - plantedAt) / MS_HOUR : 0;
    const wateredHrsAgo = lastWatered ? (now - lastWatered) / MS_HOUR : Infinity;
    const isWilted     = ageHrs >= 24 && wateredHrsAgo >= 48;

    let newStreak;
    if (isWilted || lastStreakDay === null) {
        newStreak = 1;
    } else if (lastStreakDay === today) {
        newStreak = wateringStreak; // already watered today, keep streak
    } else if (lastStreakDay === yesterday) {
        newStreak = wateringStreak + 1;
    } else {
        newStreak = 1; // gap in watering — reset
    }

    // Append newly unlocked plant types
    const newUnlocked = Array.isArray(unlockedPlants) ? [...unlockedPlants] : [];
    for (const u of GARDEN_PLANT_UNLOCKS) {
        if (newStreak >= u.streak && !newUnlocked.includes(u.id)) {
            newUnlocked.push(u.id);
        }
    }

    res.json({
        today,
        wateringStreak:    newStreak,
        lastStreakDay:      today,
        unlockedPlants:    newUnlocked,
        alreadyWateredToday: lastStreakDay === today,
    });
});

// POST /api/garden/select-plant
// Body: { plantType, unlockedPlants }
// Validates the plant is unlocked before the client persists it
app.post('/api/garden/select-plant', (req, res) => {
    const { plantType, unlockedPlants = [] } = req.body || {};
    if (!GARDEN_VALID_PLANTS.includes(plantType)) {
        return res.status(400).json({ error: 'invalid plant type' });
    }
    if (plantType !== 'sunflower' && !unlockedPlants.includes(plantType)) {
        return res.status(403).json({ error: 'plant not unlocked' });
    }
    res.json({ ok: true, selectedPlant: plantType });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Personal Feed running on http://localhost:${PORT}`));
