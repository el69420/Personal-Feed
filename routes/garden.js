const express = require('express');
const router = express.Router();

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

const MS_HOUR            = 3_600_000;
const MS_DAY             = 86_400_000;
const WILT_AGE_HRS       = 24;  // plant must be at least this old before wilting can apply
const WILT_DRY_HRS       = 48;  // hours without water before a plant wilts
const MUSHROOM_WILT_DAYS = 7;   // days wilted before a mushroom tile event fires

// POST /api/garden/water
router.post('/api/garden/water', (req, res) => {
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

    // Server date in UTC
    const today     = new Date(now).toISOString().slice(0, 10);
    const yesterday = new Date(now - 86400000).toISOString().slice(0, 10);

    // ---- Individual streak ----
    const ageHrs        = plantedAt ? (now - plantedAt) / MS_HOUR : 0;
    const wateredHrsAgo = lastWatered ? (now - lastWatered) / MS_HOUR : Infinity;
    const isWilted      = ageHrs >= WILT_AGE_HRS && wateredHrsAgo >= WILT_DRY_HRS;

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
        if (newStreak >= u.streak && !newUnlocked.includes(u.id)) newUnlocked.push(u.id);
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

        const todayRecord      = newWateredByDay[today] || {};
        const bothWateredToday = GARDEN_COOP_USERS.every(u => todayRecord[u]);

        if (bothWateredToday && lastSharedDay !== today) {
            newSharedStreak  = lastSharedDay === yesterday ? sharedStreak + 1 : 1;
            newLastSharedDay = today;
        }
    }

    for (const u of GARDEN_COOP_UNLOCKS) {
        if (newSharedStreak >= u.streak && !newUnlocked.includes(u.id)) newUnlocked.push(u.id);
    }

    // ---- Rare tile events ----
    const events = [];

    // Mushroom: plant wilted for 7+ days
    if (isWilted) {
        const wiltedSince = lastWatered
            ? lastWatered + WILT_DRY_HRS * MS_HOUR
            : (plantedAt ? plantedAt + WILT_AGE_HRS * MS_HOUR : null);
        if (wiltedSince && (now - wiltedSince) >= MUSHROOM_WILT_DAYS * MS_DAY) events.push('mushroom');
    }

    // moonflowerVariant: watered between 00:00 and 01:00 UTC, ~30% chance
    if (new Date(now).getUTCHours() === 0 && Math.random() < 0.3) events.push('moonflowerVariant');

    // shootingStar: other user also watered within the same clock-hour, 10% chance
    if (whoIsWatering && GARDEN_COOP_USERS.includes(whoIsWatering)) {
        const otherUser = GARDEN_COOP_USERS.find(u => u !== whoIsWatering);
        const otherTs   = (lastWateredByUser || {})[otherUser];
        if (otherTs && Math.floor(otherTs / 3600000) === Math.floor(now / 3600000)
                && Math.random() < 0.10) {
            events.push('shootingStar');
        }
    }

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
router.post('/api/garden/select-plant', (req, res) => {
    const { plantType, unlockedPlants = [] } = req.body || {};
    if (!GARDEN_VALID_PLANTS.includes(plantType)) {
        return res.status(400).json({ error: 'invalid plant type' });
    }
    if (plantType !== 'sunflower' && !unlockedPlants.includes(plantType)) {
        return res.status(403).json({ error: 'plant not unlocked' });
    }
    res.json({ ok: true, selectedPlant: plantType });
});

module.exports = router;
