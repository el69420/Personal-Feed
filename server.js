require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');

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
const GARDEN_COOP_UNLOCKS = [
    { streak: 3,  id: 'sunflower' },
    { streak: 7,  id: 'lavender' },
    { streak: 14, id: 'twocolourbloom' },
];
const GARDEN_COOP_USERS   = ['el', 'tero'];
const GARDEN_VALID_PLANTS = ['sunflower', 'daisy', 'tulip', 'rose', 'orchid', 'lavender', 'twocolourbloom', 'mint', 'fern', 'wildflower'];

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
        whoIsWatering     = null,
        wateredByDay      = {},
        sharedStreak      = 0,
        lastSharedDay     = null,
        lastWateredByUser = {},
    } = req.body || {};

    const now = Date.now();
    const MS_HOUR = 3600000;

    // Server date in UTC
    const today     = new Date(now).toISOString().slice(0, 10);
    const yesterday = new Date(now - 86400000).toISOString().slice(0, 10);

    // ---- Individual streak ----
    const ageHrs        = plantedAt ? (now - plantedAt) / MS_HOUR : 0;
    const wateredHrsAgo = lastWatered ? (now - lastWatered) / MS_HOUR : Infinity;
    const isWilted      = ageHrs >= 24 && wateredHrsAgo >= 48;

    let newStreak;
    if (isWilted || lastStreakDay === null) {
        newStreak = 1;
    } else if (lastStreakDay === today) {
        newStreak = wateringStreak;
    } else if (lastStreakDay === yesterday) {
        newStreak = wateringStreak + 1;
    } else {
        newStreak = 1;
    }

    const newUnlocked = Array.isArray(unlockedPlants) ? [...unlockedPlants] : [];
    for (const u of GARDEN_PLANT_UNLOCKS) {
        if (newStreak >= u.streak && !newUnlocked.includes(u.id)) {
            newUnlocked.push(u.id);
        }
    }

    // ---- Shared streak ----
    let newSharedStreak  = sharedStreak;
    let newLastSharedDay = lastSharedDay;
    const newWateredByDay = (typeof wateredByDay === 'object' && wateredByDay !== null)
        ? { ...wateredByDay }
        : {};

    if (whoIsWatering && GARDEN_COOP_USERS.includes(whoIsWatering)) {
        if (!newWateredByDay[today]) newWateredByDay[today] = {};
        newWateredByDay[today][whoIsWatering] = true;

        // Prune entries older than yesterday
        for (const day of Object.keys(newWateredByDay)) {
            if (day !== today && day !== yesterday) delete newWateredByDay[day];
        }

        const todayRecord     = newWateredByDay[today] || {};
        const bothWateredToday = GARDEN_COOP_USERS.every(u => todayRecord[u]);

        if (bothWateredToday && lastSharedDay !== today) {
            newSharedStreak  = lastSharedDay === yesterday ? sharedStreak + 1 : 1;
            newLastSharedDay = today;
        }
    }

    for (const u of GARDEN_COOP_UNLOCKS) {
        if (newSharedStreak >= u.streak && !newUnlocked.includes(u.id)) {
            newUnlocked.push(u.id);
        }
    }

    // ---- Rare tile events ----
    const events = [];

    // Mushroom: plant wilted for 7+ days (wilt onset computable from existing data)
    if (isWilted) {
        const wiltedSince = lastWatered
            ? lastWatered + 48 * MS_HOUR
            : (plantedAt ? plantedAt + 24 * MS_HOUR : null);
        if (wiltedSince && (now - wiltedSince) >= 7 * 86400000) {
            events.push('mushroom');
        }
    }

    // moonflowerVariant: watered between 00:00 and 01:00 UTC, ~30% chance
    if (new Date(now).getUTCHours() === 0 && Math.random() < 0.3) {
        events.push('moonflowerVariant');
    }

    // shootingStar: other user also watered within the same clock-hour, 10% chance
    if (whoIsWatering && GARDEN_COOP_USERS.includes(whoIsWatering)) {
        const otherUser = GARDEN_COOP_USERS.find(u => u !== whoIsWatering);
        const otherTs   = (lastWateredByUser || {})[otherUser];
        if (otherTs && Math.floor(otherTs / 3600000) === Math.floor(now / 3600000)
                && Math.random() < 0.10) {
            events.push('shootingStar');
        }
    }

    // Update lastWateredByUser for the calling user
    const newLastWateredByUser = { ...(lastWateredByUser || {}) };
    if (whoIsWatering && GARDEN_COOP_USERS.includes(whoIsWatering)) {
        newLastWateredByUser[whoIsWatering] = now;
    }

    res.json({
        today,
        wateringStreak:      newStreak,
        lastStreakDay:        today,
        unlockedPlants:      newUnlocked,
        alreadyWateredToday: lastStreakDay === today,
        sharedStreak:        newSharedStreak,
        lastSharedDay:       newLastSharedDay,
        wateredByDay:        newWateredByDay,
        events,
        lastWateredByUser:   newLastWateredByUser,
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

// ===== Achievements API =====

const ACHIEVEMENTS_FILE = path.join(__dirname, 'achievements.json');
const VALID_ACHIEVEMENT_IDS = new Set([
    'first_post', 'five_posts', 'ten_posts', 'twenty_posts',
    'first_sprout', 'watering_can', 'water_3_days',
    'checked_in', 'week_streak',
    'night_owl', 'early_bird',
]);

function loadAchievementsStore() {
    try {
        if (fs.existsSync(ACHIEVEMENTS_FILE)) {
            return JSON.parse(fs.readFileSync(ACHIEVEMENTS_FILE, 'utf8'));
        }
    } catch (e) { console.error('Failed to read achievements store:', e.message); }
    return {};
}

function saveAchievementsStore(store) {
    try {
        fs.writeFileSync(ACHIEVEMENTS_FILE, JSON.stringify(store, null, 2));
    } catch (e) { console.error('Failed to save achievements store:', e.message); }
}

// { [displayName]: { [achievementId]: unlockedAt (ms) } }
let achievementsStore = loadAchievementsStore();

// GET /api/achievements?user=El
app.get('/api/achievements', (req, res) => {
    const user = req.query.user;
    if (!user || typeof user !== 'string' || user.length > 64) {
        return res.status(400).json({ error: 'invalid user' });
    }
    const unlocked = Object.keys(achievementsStore[user] || {});
    res.json({ unlocked });
});

// POST /api/achievements/unlock  body: { user, id }
app.post('/api/achievements/unlock', (req, res) => {
    const { user, id } = req.body || {};
    if (!user || typeof user !== 'string' || user.length > 64) {
        return res.status(400).json({ error: 'invalid user' });
    }
    if (!id || typeof id !== 'string' || !VALID_ACHIEVEMENT_IDS.has(id)) {
        return res.status(400).json({ error: 'invalid id' });
    }
    if (!achievementsStore[user]) achievementsStore[user] = {};
    const alreadyUnlocked = id in achievementsStore[user];
    if (!alreadyUnlocked) {
        achievementsStore[user][id] = Date.now();
        saveAchievementsStore(achievementsStore);
    }
    res.json({ unlocked: !alreadyUnlocked, id });
});

// ===== Wallpaper API =====

const WALLPAPERS_FILE = path.join(__dirname, 'wallpapers.json');
const VALID_WALLPAPER_IDS = new Set([
    'teal', 'purple', 'sunset', 'night', 'forest', 'blush', 'blueprint', 'candy',
]);

function loadWallpapersStore() {
    try {
        if (fs.existsSync(WALLPAPERS_FILE)) {
            return JSON.parse(fs.readFileSync(WALLPAPERS_FILE, 'utf8'));
        }
    } catch (e) { console.error('Failed to read wallpapers store:', e.message); }
    return {};
}

function saveWallpapersStore(store) {
    try {
        fs.writeFileSync(WALLPAPERS_FILE, JSON.stringify(store, null, 2));
    } catch (e) { console.error('Failed to save wallpapers store:', e.message); }
}

// { [displayName]: wallpaperId }
let wallpapersStore = loadWallpapersStore();

// GET /api/wallpaper?user=El
app.get('/api/wallpaper', (req, res) => {
    const user = req.query.user;
    if (!user || typeof user !== 'string' || user.length > 64) {
        return res.status(400).json({ error: 'invalid user' });
    }
    res.json({ wallpaperId: wallpapersStore[user] || null });
});

// POST /api/wallpaper  body: { user, wallpaperId }
app.post('/api/wallpaper', (req, res) => {
    const { user, wallpaperId } = req.body || {};
    if (!user || typeof user !== 'string' || user.length > 64) {
        return res.status(400).json({ error: 'invalid user' });
    }
    if (!wallpaperId || !VALID_WALLPAPER_IDS.has(wallpaperId)) {
        return res.status(400).json({ error: 'invalid wallpaperId' });
    }
    wallpapersStore[user] = wallpaperId;
    saveWallpapersStore(wallpapersStore);
    res.json({ ok: true, wallpaperId });
});

// ===== Cat API =====

const CATS_FILE            = path.join(__dirname, 'cats.json');
const CAT_DECAY_PER_HOUR   = 3;   // stat points lost per hour
const CAT_ACTION_DELTAS    = { feed: { hunger: 25 }, water: { thirst: 25 }, yarn: { play: 35 } };

function loadCatsStore() {
    try {
        if (fs.existsSync(CATS_FILE)) return JSON.parse(fs.readFileSync(CATS_FILE, 'utf8'));
    } catch (e) { console.error('Failed to read cats store:', e.message); }
    return {};
}

function saveCatsStore(store) {
    try { fs.writeFileSync(CATS_FILE, JSON.stringify(store, null, 2)); }
    catch (e) { console.error('Failed to save cats store:', e.message); }
}

let catsStore = loadCatsStore();

function catDecay(stored) {
    const hoursElapsed = (Date.now() - (stored.lastUpdated || Date.now())) / 3_600_000;
    const d = hoursElapsed * CAT_DECAY_PER_HOUR;
    return {
        hunger: Math.max(0, Math.min(100, (stored.hunger ?? 75) - d)),
        thirst: Math.max(0, Math.min(100, (stored.thirst ?? 75) - d)),
        play:   Math.max(0, Math.min(100, (stored.play   ?? 75) - d)),
    };
}

// GET /api/cat?user=El  — returns decayed stats + catName
app.get('/api/cat', (req, res) => {
    const user = req.query.user;
    if (!user || typeof user !== 'string' || user.length > 64)
        return res.status(400).json({ error: 'invalid user' });
    const stored  = catsStore[user] || { hunger: 75, thirst: 75, play: 75, lastUpdated: Date.now(), catName: '' };
    const decayed = catDecay(stored);
    res.json({ ...decayed, catName: stored.catName || '', lastUpdated: stored.lastUpdated || Date.now() });
});

// POST /api/cat/action  body: { user, action: 'feed'|'water'|'yarn' }
app.post('/api/cat/action', (req, res) => {
    const { user, action } = req.body || {};
    if (!user || typeof user !== 'string' || user.length > 64)
        return res.status(400).json({ error: 'invalid user' });
    const delta = CAT_ACTION_DELTAS[action];
    if (!delta) return res.status(400).json({ error: 'invalid action' });

    const stored  = catsStore[user] || { hunger: 75, thirst: 75, play: 75, lastUpdated: Date.now(), catName: '' };
    const decayed = catDecay(stored);
    const updated = {
        hunger:      Math.max(0, Math.min(100, decayed.hunger + (delta.hunger || 0))),
        thirst:      Math.max(0, Math.min(100, decayed.thirst + (delta.thirst || 0))),
        play:        Math.max(0, Math.min(100, decayed.play   + (delta.play   || 0))),
        lastUpdated: Date.now(),
        catName:     stored.catName || '',
    };
    catsStore[user] = updated;
    saveCatsStore(catsStore);
    res.json({ hunger: updated.hunger, thirst: updated.thirst, play: updated.play,
               catName: updated.catName, lastUpdated: updated.lastUpdated });
});

// POST /api/cat/name  body: { user, catName }
app.post('/api/cat/name', (req, res) => {
    const { user, catName } = req.body || {};
    if (!user || typeof user !== 'string' || user.length > 64)
        return res.status(400).json({ error: 'invalid user' });
    if (typeof catName !== 'string') return res.status(400).json({ error: 'invalid catName' });
    if (!catsStore[user]) catsStore[user] = { hunger: 75, thirst: 75, play: 75, lastUpdated: Date.now() };
    catsStore[user].catName = catName.trim().slice(0, 32);
    saveCatsStore(catsStore);
    res.json({ ok: true, catName: catsStore[user].catName });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Personal Feed running on http://localhost:${PORT}`));
