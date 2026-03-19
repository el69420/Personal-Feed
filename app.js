import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js';
import { getDatabase, ref, push, onValue, remove, update, set, get, child, limitToLast, query, onDisconnect, runTransaction, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';
import { firebaseConfig } from './firebase-config.js';

const app = initializeApp(firebaseConfig);
const database = getDatabase(app);
const auth     = getAuth(app);
const googleProvider = new GoogleAuthProvider();
const postsRef      = ref(database, 'posts');
const chatRef       = ref(database, 'chat');
const boardsRef             = ref(database, 'boards');
const boardItemsRef         = ref(database, 'board_items');
const boardDeleteRequestsRef = ref(database, 'board_delete_requests');
const lettersRef    = ref(database, 'letters');
const linkMetaRef   = ref(database, 'linkMeta');
const recycleBinRef = ref(database, 'recycleBin');
const categoriesRef     = ref(database, 'categories');
const wishlistBoardsRef = ref(database, 'wishlistBoards');
const wishlistItemsRef  = ref(database, 'wishlistItems');

const API_BASE = ''; // Set to the deployed origin (e.g. 'https://your-api.example.com') for GitHub Pages use

const ANNIVERSARY_MM_DD = '01-06';
const INSIDE_JOKE = 'you are gay';

// ---- APP ENTRY POINT ----
// initApp() is called once from DOMContentLoaded so that every DOM query and
// event-listener registration is guaranteed to run after the full document
// (including taskbar, windows, and boot-screen markup) has been parsed.
// All app constants, state variables, and function declarations live inside
// initApp() so they share one scope — the original flat-module scope is
// preserved, just wrapped one level deeper.
function initApp() {

// ===== Boot Screen — run FIRST so the fallback timer is always registered =====
// This IIFE is intentionally placed at the very top of initApp() so that the
// 8-second dismissal fallback fires even if any later initialisation code throws.
(function () {
    const boot = document.getElementById('boot-screen');
    function dismissBoot() {
        if (!boot) return;
        boot.style.transition = 'opacity 0.4s';
        boot.style.opacity = '0';
        setTimeout(() => boot.classList.add('is-hidden'), 420);
        sessionStorage.setItem('bootShown', '1');
    }
    if (!boot) return;
    if (sessionStorage.getItem('bootShown') || localStorage.getItem('bootEnabled') === 'false') {
        boot.classList.add('is-hidden');
        return;
    }
    const _bootFallbackTimer = setTimeout(dismissBoot, 8000);
    try {
        const bar   = document.getElementById('boot-progress-bar');
        const label = document.getElementById('boot-label');
        const log   = document.getElementById('boot-log');
        const STEPS = [
            [10, 'Initializing system...',          'Starting Windows\u2026'],
            [22, 'Loading HIMEM.SYS...',            'Starting Windows\u2026'],
            [34, 'Loading Feed.exe',                'Loading programs\u2026'],
            [46, 'Loading Garden.exe',              'Loading programs\u2026'],
            [56, 'Loading Cat.exe',                 'Loading programs\u2026'],
            [66, 'Loading Mail.exe',                'Loading programs\u2026'],
            [76, 'Loading Jukebox.exe',             'Loading programs\u2026'],
            [88, 'Checking for updates...',         'Almost ready\u2026'],
            [100, 'Desktop ready.',                 'Welcome'],
        ];
        function addLine(text) {
            if (!log) return;
            const span = document.createElement('span');
            span.className = 'boot-log-line';
            span.textContent = text;
            log.appendChild(span);
            while (log.children.length > 5) log.removeChild(log.firstChild);
        }
        let i = 0;
        function tick() {
            if (i >= STEPS.length) { clearTimeout(_bootFallbackTimer); dismissBoot(); return; }
            const [pct, line, lbl] = STEPS[i];
            if (bar) bar.style.width = pct + '%';
            if (label && lbl) label.textContent = lbl;
            addLine(line);
            i++;
            setTimeout(tick, i < STEPS.length ? 210 : 400);
        }
        setTimeout(tick, 300);
    } catch (_e) {
        clearTimeout(_bootFallbackTimer);
        dismissBoot();
    }
})();

// ---- LINK PREVIEW CACHE ----
// Converts a URL to a safe Firebase key (no . # $ [ ] /)
function urlToKey(url) {
    return url.replace(/https?:\/\//g, '').replace(/[.#$[\]/]/g, '_').substring(0, 768);
}

// Apply cached/fetched metadata to an already-rendered .link-preview element
function applyLinkMeta(el, meta) {
    el.classList.remove('lp-loading');
    if (meta.title) {
        const d = el.querySelector('.link-domain');
        if (d) d.textContent = meta.title;
    }
    if (meta.description) {
        const u = el.querySelector('.link-url');
        if (u) u.textContent = meta.description;
    }
    if (meta.image) {
        const img = el.querySelector('.link-favicon img');
        if (img) {
            img.src = meta.image;
            img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
        }
    }
}

// Shared: check Firebase cache then fall back to microlink.io
// opts.requireImage: if true, bypass cache when cached result has no image
async function fetchLinkMeta(url, opts = {}) {
    const key = urlToKey(url);
    try {
        const snap = await get(child(ref(database), `linkMeta/${key}`));
        if (snap.exists()) {
            const cached = snap.val();
            if (!opts.requireImage || cached.image) return cached;
            // cached has no image and caller needs one — fall through to fresh fetch
        }
        const resp = await fetch(`https://api.microlink.io?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(6000) });
        if (!resp.ok) return null;
        const data = await resp.json();
        if (data.status === 'success') {
            const meta = {
                title:       data.data.title       || null,
                description: data.data.description || null,
                image:       data.data.image?.url  || null,
            };
            set(ref(database, `linkMeta/${key}`), meta).catch(() => {});
            return meta;
        }
        return null;
    } catch { return null; }
}

// For each .link-preview[data-url] in container: check Firebase cache,
// then fall back to microlink.io (free, no key needed). Fires and forgets.
async function hydrateLinkPreviews(container) {
    const previews = container.querySelectorAll('.link-preview[data-url]');
    await Promise.all(Array.from(previews).map(async (el) => {
        const url = decodeURIComponent(el.dataset.url);
        const meta = await fetchLinkMeta(url);
        if (meta) applyLinkMeta(el, meta);
        else el.classList.remove('lp-loading');
    }));
}

// Hydrate rich media cards (Spotify, TikTok, X, Reddit)
async function hydrateRichCards(container) {
    const cards = container.querySelectorAll('.rich-card[data-url], .spotify-card[data-url]');
    await Promise.all(Array.from(cards).map(async (el) => {
        const url = decodeURIComponent(el.dataset.url);
        const meta = await fetchLinkMeta(url);
        el.classList.remove('lp-loading');
        if (!meta) return;
        const titleEl = el.querySelector('.rc-title');
        const descEl  = el.querySelector('.rc-desc');
        const imgEl   = el.querySelector('.rc-art img');
        if (titleEl && meta.title) titleEl.textContent = meta.title;
        if (descEl  && meta.description) { descEl.textContent = meta.description; descEl.style.display = ''; }
        if (imgEl   && meta.image) {
            imgEl.src = meta.image;
            imgEl.style.cssText = 'width:100%;height:100%;object-fit:cover;';
            const artEl = imgEl.closest('.rc-art');
            if (artEl) artEl.classList.add('rc-art--loaded');
        }
    }));
}

// Hydrate YouTube cards with title + channel name from oEmbed
async function hydrateYouTubeMeta(container) {
    const cards = container.querySelectorAll('.yt-embed-card[data-url]');
    await Promise.all(Array.from(cards).map(async (el) => {
        const url = decodeURIComponent(el.dataset.url);
        const key = 'yt_' + urlToKey(url);
        let meta = null;
        try {
            const snap = await get(child(ref(database), `linkMeta/${key}`));
            if (snap.exists()) {
                meta = snap.val();
            } else {
                const resp = await fetch(
                    `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
                    { signal: AbortSignal.timeout(5000) }
                );
                if (resp.ok) {
                    const data = await resp.json();
                    meta = { title: data.title || null, channel: data.author_name || null };
                    set(ref(database, `linkMeta/${key}`), meta).catch(() => {});
                }
            }
        } catch {}
        el.classList.remove('lp-loading');
        if (!meta) return;
        const titleEl   = el.querySelector('.yt-title');
        const channelEl = el.querySelector('.yt-channel');
        if (titleEl   && meta.title)   titleEl.textContent = meta.title;
        if (channelEl && meta.channel) { channelEl.textContent = meta.channel; channelEl.style.display = ''; }
    }));
}

// ===== Wallpaper definitions =====
const WALLPAPERS = [
    { id: 'teal',      label: 'Teal Classic',   css: 'linear-gradient(135deg,#006868 0%,#004466 100%)' },
    { id: 'purple',    label: 'Purple Dream',   css: 'linear-gradient(135deg,#4a0080 0%,#1a0040 100%)' },
    { id: 'sunset',    label: 'Sunset',         css: 'linear-gradient(to bottom,#ff6b35 0%,#f7931e 45%,#c2185b 100%)' },
    { id: 'night',     label: 'Starry Night',   css: [
        'radial-gradient(1px 1px at 15% 25%,rgba(255,255,255,0.9) 0%,transparent 100%)',
        'radial-gradient(1px 1px at 60% 10%,rgba(255,255,255,0.8) 0%,transparent 100%)',
        'radial-gradient(1px 1px at 80% 40%,rgba(255,255,255,0.7) 0%,transparent 100%)',
        'radial-gradient(1px 1px at 35% 70%,rgba(255,255,255,0.85) 0%,transparent 100%)',
        'radial-gradient(1px 1px at 92% 80%,rgba(255,255,255,0.75) 0%,transparent 100%)',
        'linear-gradient(to bottom,#0a0018 0%,#12003a 100%)',
    ].join(',') },
    { id: 'forest',    label: 'Forest',         css: 'linear-gradient(to bottom,#1a4a1a 0%,#0d2b0d 55%,#0a1f0a 100%)' },
    { id: 'blush',     label: 'Blush',          css: 'linear-gradient(135deg,#f8c8d4 0%,#e8a0b0 50%,#d4789a 100%)' },
    { id: 'blueprint', label: 'Blueprint',      css: [
        'repeating-linear-gradient(0deg,transparent,transparent 19px,rgba(255,255,255,0.08) 19px,rgba(255,255,255,0.08) 20px)',
        'repeating-linear-gradient(90deg,transparent,transparent 19px,rgba(255,255,255,0.08) 19px,rgba(255,255,255,0.08) 20px)',
        'linear-gradient(135deg,#003366 0%,#00214d 100%)',
    ].join(',') },
    { id: 'candy',     label: 'Candy Stripe',   css: 'repeating-linear-gradient(45deg,#ff69b4 0px,#ff69b4 10px,#fff0f5 10px,#fff0f5 20px)' },
];
const DEFAULT_WALLPAPER_ID = 'teal';
let currentWallpaperId = DEFAULT_WALLPAPER_ID;

// Set to true once the app is fully initialised so wallpaper/theme changes from
// user interaction are counted but the initial restore on load is not.
let _desktopCustomisationReady = false;

function applyWallpaper(id, _fromUser = false) {
    // Stop any running animated wallpaper before switching
    window._animWallpaper?.stop();

    // Check base wallpapers first, then reward wallpapers
    const wp = WALLPAPERS.find(w => w.id === id)
        || REWARD_REGISTRY.find(r => r.type === REWARD_TYPE_WALLPAPER && r.id === id && unlockedRewards.has(r.id));
    const resolved = wp || WALLPAPERS[0];
    const desktop = document.getElementById('w95-desktop');
    if (desktop) desktop.style.background = resolved.css || resolved.swatchCss || '';
    currentWallpaperId = resolved.id;

    // Start canvas animation for animated wallpapers
    if (resolved.animated) window._animWallpaper?.start(resolved.id);

    if (_fromUser && _desktopCustomisationReady) {
        unlockAchievement('first_wallpaper_change');
        const wpc = Number(localStorage.getItem('wallpaperChangeCount') || 0) + 1;
        localStorage.setItem('wallpaperChangeCount', String(wpc));
        if (wpc >= 5) unlockAchievement('pixel_mood');
        if (unlockedAchievements.size >= 10) unlockAchievement('power_user');
    }
}

// Apply a desktop theme by id. Themes are stored as body data-theme attributes.
function applyDesktopTheme(themeId, _fromUser = false) {
    document.body.setAttribute('data-theme', themeId || '');
    localStorage.setItem('activeDesktopTheme', themeId || '');
    if (_fromUser && _desktopCustomisationReady) {
        const wpc = Number(localStorage.getItem('wallpaperChangeCount') || 0) + 1;
        localStorage.setItem('wallpaperChangeCount', String(wpc));
        if (wpc >= 5) unlockAchievement('pixel_mood');
        if (unlockedAchievements.size >= 10) unlockAchievement('power_user');
    }
}

const _linkedPostId = new URLSearchParams(location.search).get('post');
let _linkedPostHandled = false;

let currentFilter = 'all';
let currentCollection = null;
let currentSource = null;
let seenPostIds = new Set();
let notificationsEnabled = localStorage.getItem('notificationsEnabled') === 'true';
let searchQuery = '';
let allPosts = {};
let allRecycleBin = {};
let currentUser = null;
let currentUserUid = null;
let editState = null;


let isDarkMode = false;
let isInitialLoad = true;
let currentWateringStreak = 0;
// Per-user stats synced from Firebase /userStats/{user}/
let totalWaterings    = 0;                                 // total water presses this user
let gardenVisitDays   = {};                                // { "YYYY-MM-DD": true }
let gardenVisitStreak = { current: 0, lastDate: null };    // consecutive-day visit streak
let xpTotal = 0;   // total XP earned; persisted at /userStats/{user}/xpTotal in Firebase
// Sound toggle — default ON; set localStorage soundEnabled='false' to mute.
let soundEnabled = localStorage.getItem('soundEnabled') !== 'false';

// Master volume (0–1, default 1)
let soundMasterVolume = parseFloat(localStorage.getItem('soundMasterVolume') || '1');
if (isNaN(soundMasterVolume) || soundMasterVolume < 0 || soundMasterVolume > 1) soundMasterVolume = 1;

// Global sound category toggles
let soundUiEffects = localStorage.getItem('soundUiEffects') !== 'false';
let soundStartup   = localStorage.getItem('soundStartup')   !== 'false';
// soundAmbience: ready for future ambience sounds; no ambience implemented yet
let soundAmbience  = localStorage.getItem('soundAmbience')  !== 'false';

// Per-feature sound toggles
let sndChat    = localStorage.getItem('snd_chat')    !== 'false';
let sndPost    = localStorage.getItem('snd_post')    !== 'false';
let sndMail    = localStorage.getItem('snd_mail')    !== 'false';
let sndCat     = localStorage.getItem('snd_cat')     !== 'false';
let sndGarden  = localStorage.getItem('snd_garden')  !== 'false';
let sndAch     = localStorage.getItem('snd_ach')     !== 'false';
let sndConsole = localStorage.getItem('snd_console') !== 'false';

let focusedPostId = null;
let prevDataSig = null;
let prevVisualSig = null;

let _audioCtx = null;
let chatOpen = false;
let currentSection = 'feed';
let allBoards = {};             // boardId → board object
let allBoardDeleteRequests = {}; // boardId → { requestedBy, requestedAt, boardTitle }
let _boardPickerPostId = null;  // postId being saved to a board
let allWishlistBoards = {};       // boardId → wishlist board object
let currentWishlistBoardId = null; // currently open wishlist board
let currentWishlistCommentItemId = null;  // itemId whose comments modal is open
let currentWishlistCommentBoardId = null; // boardId for the above item
let allLetters = {};            // letterId → letter object
let mailboxTab = 'inbox';
let lastChatSeenTs = Number(localStorage.getItem('chatSeenTs') || '0');
let lastChatMessages = [];
let _lastAnimationTs = Date.now(); // track which command animations have already been triggered
let _chatLastRenderedId = null;   // last message ID seen by renderChat; null = initial render
const _goldenSyncShown = new Set(); // track golden kiss sync pairs already animated (key: "ts1_ts2")
let activitySeenTs = 0;

// ---- MYTHIC ACHIEVEMENT STATE ----
// { [YYYY-MM-DD]: { didPost?:true, didWater?:true, didChat?:true, lastPostTs?:number, lastChatTs?:number } }
let dailyActions = {};
let comebackArmed = false;          // true when streak broke from >=3; cleared on comeback
let _otherUserGardenVisitDaysCache = null;  // one-read cache for we_were_here

// ---- PER-USER DAILY WATER LIMITS ----
// Tracks how many times the current user has watered per calendar day (local time).
let dailyWaterCounts = {};                               // { "YYYY-MM-DD": number }
let water3Streak     = { current: 0, lastDate: null };   // consecutive days where user hit 3 waters
let _otherUserWater3Cache = null;  // { date, todayCount, streak } — one-read cache for both_water3_* checks

// ---- TYPING INDICATOR STATE ----
let _chatTypingTimer    = null;
let _chatIsTyping       = false;
const _commentTypingTimers = {};        // postId → timerHandle
const _commentOnDisconnectSet = new Set(); // postIds where onDisconnect is registered
let _cachedChatTyping    = {};           // snapshot of /typing/chat
let _cachedCommentTyping = {};           // snapshot of /typing/comments

// ---- PRESENCE STATE ----
let _presRef         = null;   // Firebase ref for current user's presence node
let _presState       = 'offline';  // 'online' | 'idle' | 'typing' | 'offline'
let _presIdleTimer   = null;
let _presHbInterval  = null;  // heartbeat interval handle


// Edit/Delete modal state
let editTarget = null;   // { type:'post'|'reply', postId, replyId }
let deleteTarget = null; // { type:'post'|'reply', postId, replyId }

// ---- RATE LIMITING ----
const _lastAction = {};
function throttle(key, minMs) {
    const now = Date.now();
    if (_lastAction[key] && now - _lastAction[key] < minMs) return false;
    _lastAction[key] = now;
    return true;
}

// ---- REDUCED MOTION HELPER ----
function prefersReducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// ---- MODAL FOCUS MANAGEMENT ----
// Stack so nested/sequential modals each restore focus correctly.
const _modalStack = [];

function getFocusables(container) {
    return [...container.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )].filter(el => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length));
}

function openModal(modalEl) {
    const opener = document.activeElement;
    modalEl.classList.add('show');

    // Prefer first input/textarea, fall back to first focusable (e.g. close button)
    const focusables = getFocusables(modalEl);
    const firstInput = focusables.find(el => ['INPUT','TEXTAREA','SELECT'].includes(el.tagName));
    setTimeout(() => (firstInput || focusables[0])?.focus(), 50);

    function trapFn(e) {
        if (e.key !== 'Tab') return;
        const focs = getFocusables(modalEl);
        if (!focs.length) { e.preventDefault(); return; }
        const first = focs[0], last = focs[focs.length - 1];
        if (e.shiftKey) {
            if (document.activeElement === first) { e.preventDefault(); last.focus(); }
        } else {
            if (document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
    }
    modalEl.addEventListener('keydown', trapFn);
    _modalStack.push({ el: modalEl, opener, trapFn });
}

function closeModal(modalEl) {
    modalEl.classList.remove('show');
    const idx = _modalStack.findIndex(e => e.el === modalEl);
    if (idx !== -1) {
        const { opener, trapFn } = _modalStack[idx];
        modalEl.removeEventListener('keydown', trapFn);
        _modalStack.splice(idx, 1);
        // Restore focus after paint so the element is no longer hidden
        setTimeout(() => opener?.focus(), 0);
    }
}

const COLLECTION_EMOJIS = { funny: 'xD', cute: '^_^', news: '[news]', inspiration: '*', music: '♪', 'idiot-drivers': '>:(', wishlist: '[w]', other: '[+]' };
const COLLECTION_LABELS = { funny: 'Funny', cute: 'Cute', news: 'News', inspiration: 'Inspiration', music: 'Music', 'idiot-drivers': 'Idiot Drivers', wishlist: 'Wishlist', other: 'Other' };

const SOURCE_EMOJIS = { instagram: '[cam]', reddit: 'O_O', x: '[X]', youtube: '[>]', tiktok: '♪', spotify: '[~]', 'news-site': '[news]', other: '[url]' };
const SOURCE_LABELS = { instagram: 'Instagram', reddit: 'Reddit', x: 'X', youtube: 'YouTube', tiktok: 'TikTok', spotify: 'Spotify', 'news-site': 'News site', other: 'Other' };

const AUTHOR_EMOJI = { 'El': '<3', 'Tero': ':)', 'Guest': '[*]' };
const AUTHOR_BADGE = { 'El': 'badge-el', 'Tero': 'badge-tero', 'Guest': 'badge-guest' };

// Maps stored emoji → retro text emoticon for display only (Firebase keeps the emoji)
const EMOTICON_MAP = {
    '❤️': '<3', '😂': 'xD', '😮': 'O_O', '😍': '*_*',
    '🔥': '!!', '👍': '(y)', '😭': 'T_T', '🥹': ';_;', '😢': ':(',
};

function safeText(s) {
    return (s || '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function timeAgo(ts) {
    if (!ts) return '';
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60)  return 'just now';
    const m = Math.floor(s / 60);
    if (m < 60)  return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24)  return `${h}h ago`;
    const d = Math.floor(h / 24);
    if (d < 7)   return `${d}d ago`;
    return new Date(ts).toLocaleDateString('en-GB', { month: 'short', day: 'numeric' });
}

function exactTimestamp(ts) {
    if (!ts) return '';
    return new Date(ts).toLocaleString('en-GB', {
        weekday: 'short',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function detectSource(url) {
    const u = (url || '').toLowerCase();
    if (u.includes('instagram.com/')) return 'instagram';
    if (u.includes('reddit.com/') || u.includes('redd.it/')) return 'reddit';
    if (u.includes('twitter.com/') || u.includes('x.com/')) return 'x';
    if (u.includes('youtube.com/') || u.includes('youtu.be/')) return 'youtube';
    if (u.includes('tiktok.com/')) return 'tiktok';
    if (u.includes('spotify.com/')) return 'spotify';
    if (u.includes('bbc.co.uk/') || u.includes('theguardian.com/') || u.includes('ft.com/') || u.includes('reuters.com/') || u.includes('sky.com/news') || u.includes('edition.cnn.com/')) return 'news-site';
    return 'other';
}
function getYouTubeId(url) {
    try {
const u = new URL(url);

// youtu.be short links
if (u.hostname.includes('youtu.be')) {
    return u.pathname.split('/').filter(Boolean)[0] || null;
}

// YouTube Shorts: youtube.com/shorts/{id}
const shortsMatch = u.pathname.match(/^\/shorts\/([^/?]+)/);
if (shortsMatch) return shortsMatch[1];

// normal youtube watch links
if (u.searchParams.get('v')) {
    return u.searchParams.get('v');
}

return null;
    } catch {
return null;
    }
}

function youtubeThumb(url) {
    const id = getYouTubeId(url);
    if (!id) return null;
    return `https://img.youtube.com/vi/${id}/hqdefault.jpg`;
}
function burstEmoji(emoji, sourceEl) {
    if (prefersReducedMotion()) return;
    const rect = sourceEl.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const count = 7;
    for (let i = 0; i < count; i++) {
        const el = document.createElement('div');
        el.textContent = emoji;
        el.style.cssText = `position:fixed;left:${cx}px;top:${cy}px;font-size:${13 + Math.random() * 10}px;pointer-events:none;z-index:9999;user-select:none;transform:translate(-50%,-50%);`;
        document.body.appendChild(el);
        const dx = (Math.random() - 0.5) * 70;
        const dy = -(55 + Math.random() * 65);
        el.animate(
            [{ opacity: 1, transform: `translate(-50%,-50%) translate(0,0) scale(1)` },
             { opacity: 0, transform: `translate(-50%,-50%) translate(${dx}px,${dy}px) scale(${0.7 + Math.random() * 0.7})` }],
            { duration: 650 + Math.random() * 300, delay: i * 35, easing: 'cubic-bezier(0.25,0.46,0.45,0.94)', fill: 'forwards' }
        ).onfinish = () => el.remove();
    }
}

let _masterGain = null;

function ensureAudio() {
    if (!_audioCtx) {
        _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        _masterGain = _audioCtx.createGain();
        _masterGain.gain.value = soundMasterVolume;
        _masterGain.connect(_audioCtx.destination);
    }
    if (_audioCtx.state === 'suspended') _audioCtx.resume();
}

// ===== Ambience sound =====
let _ambienceTimer = null;
let _ambienceActive = false;

function _playAmbienceChord() {
    if (!_audioCtx || !soundEnabled || !soundAmbience) return;
    // Soft 3-note chord arpeggiated upward, randomly transposed for variety
    const BASE = [523.25, 659.25, 783.99]; // C5, E5, G5
    const semis = [-5, -2, 0, 2, 5][Math.floor(Math.random() * 5)];
    const factor = Math.pow(2, semis / 12);
    BASE.forEach((freq, i) => {
        const osc  = _audioCtx.createOscillator();
        const gain = _audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq * factor;
        gain.gain.value = 0;
        osc.connect(gain);
        gain.connect(_masterGain);
        const now    = _audioCtx.currentTime;
        const offset = i * 0.14;
        const peak   = 0.006 + Math.random() * 0.003;
        gain.gain.setValueAtTime(0, now + offset);
        gain.gain.linearRampToValueAtTime(peak, now + offset + 0.45);
        gain.gain.linearRampToValueAtTime(peak * 0.6, now + offset + 1.6);
        gain.gain.linearRampToValueAtTime(0, now + offset + 2.4);
        osc.start(now + offset);
        osc.stop(now + offset + 2.5);
    });
}

function startAmbience() {
    if (_ambienceActive) return;
    _ambienceActive = true;
    ensureAudio();
    function tick() {
        if (!_ambienceActive) return;
        _playAmbienceChord();
        _ambienceTimer = setTimeout(tick, 4500 + Math.random() * 3000);
    }
    _ambienceTimer = setTimeout(tick, 1500);
}

function stopAmbience() {
    _ambienceActive = false;
    if (_ambienceTimer !== null) { clearTimeout(_ambienceTimer); _ambienceTimer = null; }
}

// Maps a sound type to its feature category when no explicit category is passed.
const _SOUND_CATEGORIES = {
    window_open: 'ui', window_close: 'ui', window_min: 'ui', window_max: 'ui', window_restore: 'ui',
    startup: 'startup', shutdown: 'startup',
    post: 'post', react: 'post', reply: 'post',
    chat: 'chat',
    letter: 'mail',
    cat: 'cat',
    water: 'garden',
    ach: 'ach',
    cmd_success: 'console', cmd_error: 'console',
    // ping: resolved at call site via explicit category arg
};

// Returns false if the sound should be suppressed by category toggles.
function _soundCategoryAllowed(category) {
    switch (category) {
        case 'ui':      return soundUiEffects;
        case 'startup': return soundStartup;
        case 'ambience': return soundAmbience;
        case 'chat':    return sndChat;
        case 'post':    return sndPost;
        case 'mail':    return sndMail;
        case 'cat':     return sndCat;
        case 'garden':  return sndGarden;
        case 'ach':     return sndAch;
        case 'console': return sndConsole;
        default:        return true;
    }
}

// ---- Sound pack synthesis profiles ----
// Each pack overrides oscType, gainLevel, attackTime, and note patterns.
// Packs that omit a pattern key fall back to the default patterns below.
const _SOUND_PACK_PROFILES = {
    // ☕ Cozy Café — sine waves, warm mid-range, gentle bell chimes, slow attack
    snd_cozy: {
        oscType: 'sine', gainLevel: 0.06, attackTime: 0.022,
        patterns: {
            post:           [ {f:523.25,t:0.00,dur:0.20}, {f:783.99,t:0.17,dur:0.20}, {f:1046.5,t:0.34,dur:0.20}, {f:1318.5,t:0.51,dur:0.36} ],
            reply:          [ {f:659.25,t:0.00,dur:0.16}, {f:523.25,t:0.16,dur:0.22} ],
            react:          [ {f:1046.5,t:0.00,dur:0.26} ],
            chat:           [ {f:698.46,t:0.00,dur:0.16}, {f:880.00,t:0.16,dur:0.24} ],
            ping:           [ {f:523.25,t:0.00,dur:0.30} ],
            window_open:    [ {f:659.25,t:0.00,dur:0.12}, {f:783.99,t:0.10,dur:0.18} ],
            window_close:   [ {f:783.99,t:0.00,dur:0.12}, {f:523.25,t:0.11,dur:0.18} ],
            window_min:     [ {f:659.25,t:0.00,dur:0.10}, {f:523.25,t:0.09,dur:0.14} ],
            window_max:     [ {f:523.25,t:0.00,dur:0.10}, {f:659.25,t:0.09,dur:0.10}, {f:783.99,t:0.18,dur:0.16} ],
            window_restore: [ {f:783.99,t:0.00,dur:0.10}, {f:659.25,t:0.09,dur:0.10}, {f:523.25,t:0.18,dur:0.16} ],
            startup:        [ {f:392.00,t:0.00,dur:0.20}, {f:523.25,t:0.18,dur:0.20}, {f:659.25,t:0.36,dur:0.20}, {f:783.99,t:0.54,dur:0.22}, {f:1046.5,t:0.74,dur:0.52} ],
            shutdown:       [ {f:1046.5,t:0.00,dur:0.20}, {f:783.99,t:0.19,dur:0.19}, {f:659.25,t:0.36,dur:0.19}, {f:523.25,t:0.53,dur:0.19}, {f:392.00,t:0.70,dur:0.40} ],
            cat:            [ {f:880.00,t:0.00,dur:0.10}, {f:1046.5,t:0.09,dur:0.18} ],
            water:          [ {f:523.25,t:0.00,dur:0.12}, {f:659.25,t:0.11,dur:0.12}, {f:783.99,t:0.22,dur:0.12}, {f:1046.5,t:0.33,dur:0.20} ],
            letter:         [ {f:659.25,t:0.00,dur:0.14}, {f:783.99,t:0.13,dur:0.14}, {f:1046.5,t:0.26,dur:0.24} ],
            cmd_success:    [ {f:659.25,t:0.00,dur:0.12}, {f:783.99,t:0.11,dur:0.16} ],
            cmd_error:      [ {f:311.13,t:0.00,dur:0.16}, {f:261.63,t:0.15,dur:0.22} ],
            ach:            [ {f:659.25,t:0.00,dur:0.12}, {f:783.99,t:0.12,dur:0.12}, {f:1046.5,t:0.24,dur:0.12}, {f:1318.5,t:0.36,dur:0.14}, {f:1567.98,t:0.50,dur:0.46} ],
        }
    },
    // 🌿 Nature Walk — sine waves, bird-chirp frequencies, quick staccato notes
    snd_nature: {
        oscType: 'sine', gainLevel: 0.065, attackTime: 0.006,
        patterns: {
            post:           [ {f:1200,t:0.00,dur:0.07}, {f:1500,t:0.06,dur:0.07}, {f:1800,t:0.12,dur:0.07}, {f:1400,t:0.19,dur:0.12} ],
            reply:          [ {f:1500,t:0.00,dur:0.06}, {f:1000,t:0.07,dur:0.10} ],
            react:          [ {f:1800,t:0.00,dur:0.10} ],
            chat:           [ {f:1200,t:0.00,dur:0.07}, {f:1600,t:0.08,dur:0.11} ],
            ping:           [ {f:1300,t:0.00,dur:0.14} ],
            window_open:    [ {f:1000,t:0.00,dur:0.08}, {f:1300,t:0.07,dur:0.12} ],
            window_close:   [ {f:1300,t:0.00,dur:0.08}, {f:800,t:0.08,dur:0.12} ],
            window_min:     [ {f:1100,t:0.00,dur:0.07}, {f:900,t:0.06,dur:0.10} ],
            window_max:     [ {f:900,t:0.00,dur:0.07}, {f:1100,t:0.06,dur:0.07}, {f:1400,t:0.12,dur:0.12} ],
            window_restore: [ {f:1400,t:0.00,dur:0.07}, {f:1100,t:0.06,dur:0.07}, {f:900,t:0.12,dur:0.10} ],
            startup:        [ {f:800,t:0.00,dur:0.14}, {f:1000,t:0.12,dur:0.14}, {f:1200,t:0.24,dur:0.14}, {f:1500,t:0.36,dur:0.16}, {f:1800,t:0.50,dur:0.38} ],
            shutdown:       [ {f:1800,t:0.00,dur:0.14}, {f:1500,t:0.13,dur:0.13}, {f:1200,t:0.25,dur:0.13}, {f:1000,t:0.37,dur:0.13}, {f:800,t:0.49,dur:0.32} ],
            cat:            [ {f:1600,t:0.00,dur:0.06}, {f:2000,t:0.05,dur:0.10} ],
            water:          [ {f:700,t:0.00,dur:0.09}, {f:900,t:0.08,dur:0.09}, {f:1100,t:0.16,dur:0.09}, {f:800,t:0.25,dur:0.14} ],
            letter:         [ {f:1200,t:0.00,dur:0.10}, {f:1500,t:0.09,dur:0.10}, {f:1200,t:0.19,dur:0.16} ],
            cmd_success:    [ {f:1200,t:0.00,dur:0.08}, {f:1600,t:0.08,dur:0.12} ],
            cmd_error:      [ {f:600,t:0.00,dur:0.11}, {f:480,t:0.10,dur:0.16} ],
            ach:            [ {f:800,t:0.00,dur:0.09}, {f:1000,t:0.09,dur:0.09}, {f:1200,t:0.18,dur:0.09}, {f:1500,t:0.27,dur:0.11}, {f:1800,t:0.38,dur:0.36} ],
        }
    },
    // 🎮 Retro Chiptune — punchy square waves, staccato, bright pitches
    snd_retro: {
        oscType: 'square', gainLevel: 0.10, attackTime: 0.002,
        patterns: {
            post:           [ {f:523.25,t:0.00,dur:0.07}, {f:659.25,t:0.06,dur:0.07}, {f:783.99,t:0.12,dur:0.07}, {f:1046.5,t:0.18,dur:0.13} ],
            reply:          [ {f:880.00,t:0.00,dur:0.06}, {f:659.25,t:0.07,dur:0.07} ],
            react:          [ {f:1046.5,t:0.00,dur:0.09} ],
            chat:           [ {f:440.00,t:0.00,dur:0.06}, {f:880.00,t:0.07,dur:0.08} ],
            ping:           [ {f:750.00,t:0.00,dur:0.14} ],
            window_open:    [ {f:523.25,t:0.00,dur:0.04}, {f:659.25,t:0.03,dur:0.06} ],
            window_close:   [ {f:659.25,t:0.00,dur:0.04}, {f:392.00,t:0.03,dur:0.06} ],
            window_min:     [ {f:523.25,t:0.00,dur:0.04}, {f:392.00,t:0.03,dur:0.05} ],
            window_max:     [ {f:392.00,t:0.00,dur:0.04}, {f:523.25,t:0.03,dur:0.04}, {f:659.25,t:0.06,dur:0.06} ],
            window_restore: [ {f:659.25,t:0.00,dur:0.04}, {f:523.25,t:0.03,dur:0.04}, {f:392.00,t:0.06,dur:0.05} ],
            startup:        [ {f:392.00,t:0.00,dur:0.09}, {f:523.25,t:0.08,dur:0.09}, {f:659.25,t:0.16,dur:0.09}, {f:783.99,t:0.24,dur:0.10}, {f:1046.5,t:0.33,dur:0.22} ],
            shutdown:       [ {f:1046.5,t:0.00,dur:0.09}, {f:783.99,t:0.08,dur:0.08}, {f:659.25,t:0.15,dur:0.08}, {f:523.25,t:0.22,dur:0.08}, {f:392.00,t:0.29,dur:0.18} ],
            cat:            [ {f:880.00,t:0.00,dur:0.04}, {f:1108.7,t:0.03,dur:0.06} ],
            water:          [ {f:392.00,t:0.00,dur:0.05}, {f:523.25,t:0.04,dur:0.05}, {f:659.25,t:0.08,dur:0.05}, {f:783.99,t:0.12,dur:0.08} ],
            letter:         [ {f:523.25,t:0.00,dur:0.05}, {f:659.25,t:0.04,dur:0.05}, {f:783.99,t:0.08,dur:0.09} ],
            cmd_success:    [ {f:523.25,t:0.00,dur:0.04}, {f:659.25,t:0.03,dur:0.06} ],
            cmd_error:      [ {f:220.00,t:0.00,dur:0.07}, {f:196.00,t:0.06,dur:0.10} ],
            ach:            [ {f:523.25,t:0.00,dur:0.05}, {f:659.25,t:0.05,dur:0.05}, {f:783.99,t:0.10,dur:0.05}, {f:1046.5,t:0.15,dur:0.06}, {f:1318.5,t:0.21,dur:0.20} ],
        }
    },
    // 🌟 Cute & Cozy — high-pitched sine tones; cat interaction plays a tiny meow
    snd_cute: {
        oscType: 'sine', gainLevel: 0.065, attackTime: 0.010,
        patterns: {
            post:           [ {f:1046.5,t:0.00,dur:0.11}, {f:1318.5,t:0.10,dur:0.11}, {f:1567.98,t:0.20,dur:0.11}, {f:2093.0,t:0.30,dur:0.26} ],
            reply:          [ {f:1318.5,t:0.00,dur:0.09}, {f:1046.5,t:0.10,dur:0.14} ],
            react:          [ {f:2093.0,t:0.00,dur:0.16} ],
            chat:           [ {f:880.00,t:0.00,dur:0.09}, {f:1318.5,t:0.10,dur:0.14} ],
            ping:           [ {f:1046.5,t:0.00,dur:0.20} ],
            window_open:    [ {f:1046.5,t:0.00,dur:0.08}, {f:1318.5,t:0.07,dur:0.12} ],
            window_close:   [ {f:1318.5,t:0.00,dur:0.08}, {f:880.00,t:0.08,dur:0.12} ],
            window_min:     [ {f:1046.5,t:0.00,dur:0.07}, {f:880.00,t:0.06,dur:0.10} ],
            window_max:     [ {f:880.00,t:0.00,dur:0.07}, {f:1046.5,t:0.06,dur:0.07}, {f:1318.5,t:0.12,dur:0.12} ],
            window_restore: [ {f:1318.5,t:0.00,dur:0.07}, {f:1046.5,t:0.06,dur:0.07}, {f:880.00,t:0.12,dur:0.10} ],
            startup:        [ {f:659.25,t:0.00,dur:0.14}, {f:783.99,t:0.13,dur:0.14}, {f:1046.5,t:0.26,dur:0.14}, {f:1318.5,t:0.39,dur:0.16}, {f:2093.0,t:0.54,dur:0.46} ],
            shutdown:       [ {f:2093.0,t:0.00,dur:0.14}, {f:1318.5,t:0.13,dur:0.13}, {f:1046.5,t:0.25,dur:0.13}, {f:783.99,t:0.37,dur:0.13}, {f:659.25,t:0.49,dur:0.36} ],
            cat:            null,  // replaced by synthetic meow — see sparkSound
            water:          [ {f:1046.5,t:0.00,dur:0.09}, {f:1318.5,t:0.08,dur:0.09}, {f:1567.98,t:0.16,dur:0.09}, {f:1046.5,t:0.25,dur:0.16} ],
            letter:         [ {f:1046.5,t:0.00,dur:0.11}, {f:1318.5,t:0.10,dur:0.11}, {f:1567.98,t:0.20,dur:0.20} ],
            cmd_success:    [ {f:1046.5,t:0.00,dur:0.08}, {f:1318.5,t:0.08,dur:0.12} ],
            cmd_error:      [ {f:440.00,t:0.00,dur:0.11}, {f:392.00,t:0.10,dur:0.16} ],
            ach:            [ {f:1046.5,t:0.00,dur:0.09}, {f:1318.5,t:0.09,dur:0.09}, {f:1567.98,t:0.18,dur:0.09}, {f:2093.0,t:0.27,dur:0.11}, {f:2637.0,t:0.38,dur:0.40} ],
        }
    },
    // 🌿 Garden Ambience — triangle waves, earthy low tones; water sound ends with a wood frog ribbit
    snd_garden_pack: {
        oscType: 'triangle', gainLevel: 0.07, attackTime: 0.018,
        patterns: {
            post:           [ {f:261.63,t:0.00,dur:0.16}, {f:329.63,t:0.14,dur:0.16}, {f:392.00,t:0.28,dur:0.16}, {f:523.25,t:0.42,dur:0.32} ],
            reply:          [ {f:329.63,t:0.00,dur:0.14}, {f:261.63,t:0.14,dur:0.18} ],
            react:          [ {f:523.25,t:0.00,dur:0.22} ],
            chat:           [ {f:261.63,t:0.00,dur:0.12}, {f:392.00,t:0.13,dur:0.18} ],
            ping:           [ {f:329.63,t:0.00,dur:0.28} ],
            window_open:    [ {f:329.63,t:0.00,dur:0.10}, {f:392.00,t:0.09,dur:0.14} ],
            window_close:   [ {f:392.00,t:0.00,dur:0.10}, {f:261.63,t:0.10,dur:0.14} ],
            window_min:     [ {f:329.63,t:0.00,dur:0.09}, {f:261.63,t:0.08,dur:0.12} ],
            window_max:     [ {f:261.63,t:0.00,dur:0.09}, {f:329.63,t:0.08,dur:0.09}, {f:392.00,t:0.16,dur:0.14} ],
            window_restore: [ {f:392.00,t:0.00,dur:0.09}, {f:329.63,t:0.08,dur:0.09}, {f:261.63,t:0.16,dur:0.12} ],
            startup:        [ {f:196.00,t:0.00,dur:0.18}, {f:261.63,t:0.16,dur:0.18}, {f:329.63,t:0.32,dur:0.18}, {f:392.00,t:0.48,dur:0.20}, {f:523.25,t:0.66,dur:0.50} ],
            shutdown:       [ {f:523.25,t:0.00,dur:0.18}, {f:392.00,t:0.17,dur:0.17}, {f:329.63,t:0.32,dur:0.17}, {f:261.63,t:0.47,dur:0.17}, {f:196.00,t:0.62,dur:0.36} ],
            cat:            [ {f:300,t:0.00,dur:0.10}, {f:360,t:0.09,dur:0.14} ],
            water:          null,  // replaced by rain-drop tones + wood frog ribbit — see sparkSound
            letter:         [ {f:392.00,t:0.00,dur:0.13}, {f:523.25,t:0.12,dur:0.13}, {f:659.25,t:0.24,dur:0.20} ],
            cmd_success:    [ {f:392.00,t:0.00,dur:0.10}, {f:523.25,t:0.09,dur:0.14} ],
            cmd_error:      [ {f:130.81,t:0.00,dur:0.14}, {f:110.00,t:0.13,dur:0.20} ],
            ach:            [ {f:261.63,t:0.00,dur:0.11}, {f:329.63,t:0.11,dur:0.11}, {f:392.00,t:0.22,dur:0.11}, {f:523.25,t:0.33,dur:0.13}, {f:659.25,t:0.46,dur:0.42} ],
        }
    },
};

// Synthesise a small cat meow using a sine frequency sweep (used by snd_cute).
function _playSyntheticMeow(ctx, dest, t0, vol) {
    try {
        const osc  = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        // Frequency sweep: 580 Hz → 1050 Hz → 700 Hz  (the "mew" shape)
        osc.frequency.setValueAtTime(580, t0);
        osc.frequency.linearRampToValueAtTime(1050, t0 + 0.07);
        osc.frequency.linearRampToValueAtTime(700,  t0 + 0.34);
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.linearRampToValueAtTime(vol,   t0 + 0.015);
        gain.gain.setValueAtTime(vol,            t0 + 0.26);
        gain.gain.linearRampToValueAtTime(0.0001, t0 + 0.38);
        osc.connect(gain);
        gain.connect(dest);
        osc.start(t0);
        osc.stop(t0 + 0.40);
    } catch(e) {}
}

// Synthesise a wood-frog ribbit (two short descending sawtooth bursts) — used by snd_garden_pack water sound.
function _playWoodFrogRibbit(ctx, dest, t0, vol) {
    try {
        [0, 0.16].forEach(offset => {
            const osc  = ctx.createOscillator();
            const g    = ctx.createGain();
            osc.type   = 'sawtooth';
            const s    = t0 + offset;
            osc.frequency.setValueAtTime(360, s);
            osc.frequency.linearRampToValueAtTime(220, s + 0.09);
            g.gain.setValueAtTime(0.0001, s);
            g.gain.linearRampToValueAtTime(vol * 0.55, s + 0.006);
            g.gain.setValueAtTime(vol * 0.55, s + 0.07);
            g.gain.linearRampToValueAtTime(0.0001, s + 0.11);
            osc.connect(g);
            g.connect(dest);
            osc.start(s);
            osc.stop(s + 0.13);
        });
    } catch(e) {}
}

function sparkSound(type, category) {
    try {
        if (!soundEnabled) return;
        const cat = category || _SOUND_CATEGORIES[type] || null;
        if (cat && !_soundCategoryAllowed(cat)) return;
        ensureAudio();
        const ctx  = _audioCtx;
        const dest = _masterGain || ctx.destination;
        const t0   = ctx.currentTime;

        // Resolve active sound pack
        const activePack   = localStorage.getItem('activeSoundPack') || '';
        const packProfile  = _SOUND_PACK_PROFILES[activePack] || null;
        const oscType      = packProfile?.oscType    ?? 'square';
        const gainLevel    = packProfile?.gainLevel  ?? 0.08;
        const attackTime   = packProfile?.attackTime ?? 0.006;

        // Special per-pack synthesis effects that replace normal note playback
        if (activePack === 'snd_cute' && type === 'cat') {
            _playSyntheticMeow(ctx, dest, t0, gainLevel);
            return;
        }
        if (activePack === 'snd_garden_pack' && type === 'water') {
            // Rain-drop tones followed by a wood frog ribbit
            [ {f:329.63,t:0.00,dur:0.10}, {f:392.00,t:0.09,dur:0.10},
              {f:523.25,t:0.18,dur:0.10}, {f:659.25,t:0.27,dur:0.15} ].forEach(({f, t, dur}) => {
                const osc = ctx.createOscillator(); const g = ctx.createGain();
                osc.type = 'triangle'; osc.frequency.setValueAtTime(f, t0 + t);
                osc.connect(g); g.connect(dest);
                const s = t0 + t, e = s + dur;
                g.gain.setValueAtTime(0.0001, s);
                g.gain.linearRampToValueAtTime(gainLevel, s + attackTime);
                g.gain.setValueAtTime(gainLevel, e - 0.018);
                g.gain.linearRampToValueAtTime(0.0001, e);
                osc.start(s); osc.stop(e);
            });
            _playWoodFrogRibbit(ctx, dest, t0 + 0.52, gainLevel);
            return;
        }

        // Windows 95-style default patterns (square waves, sharp envelopes)
        // post  → "The Microsoft Sound" abbreviated (4-note ascending chime)
        // reply → "Exclamation"  (descending two-note blip)
        // react → "Asterisk"     (single high ding)
        // chat  → "Notify"       (ascending two-tone)
        // ping  → "Default Beep" (classic square blip at 750 Hz)
        // ach   → achievement unlock fanfare
        const defaultPatterns = {
            post: [
                { f: 523.25, t: 0.00, dur: 0.12 },   // C5
                { f: 659.25, t: 0.10, dur: 0.12 },   // E5
                { f: 783.99, t: 0.20, dur: 0.12 },   // G5
                { f: 1046.5, t: 0.30, dur: 0.22 }    // C6
            ],
            reply: [
                { f: 880.00, t: 0.00, dur: 0.10 },   // A5
                { f: 659.25, t: 0.12, dur: 0.12 }    // E5
            ],
            react: [
                { f: 1046.5, t: 0.00, dur: 0.18 }    // C6
            ],
            chat: [
                { f: 440.00, t: 0.00, dur: 0.10 },   // A4
                { f: 880.00, t: 0.12, dur: 0.14 }    // A5
            ],
            ping: [
                { f: 750.00, t: 0.00, dur: 0.25 }    // Default Beep
            ],
            // ---- Window / desktop sounds ----
            window_open: [
                { f: 523.25, t: 0.00, dur: 0.07 },   // C5
                { f: 659.25, t: 0.06, dur: 0.09 },   // E5
            ],
            window_close: [
                { f: 659.25, t: 0.00, dur: 0.07 },   // E5
                { f: 392.00, t: 0.06, dur: 0.09 },   // G4
            ],
            window_min: [
                { f: 523.25, t: 0.00, dur: 0.06 },   // C5
                { f: 392.00, t: 0.05, dur: 0.08 },   // G4
            ],
            window_max: [
                { f: 392.00, t: 0.00, dur: 0.06 },   // G4
                { f: 523.25, t: 0.05, dur: 0.06 },   // C5
                { f: 659.25, t: 0.10, dur: 0.09 },   // E5
            ],
            window_restore: [
                { f: 659.25, t: 0.00, dur: 0.06 },   // E5
                { f: 523.25, t: 0.05, dur: 0.06 },   // C5
                { f: 392.00, t: 0.10, dur: 0.08 },   // G4
            ],
            // ---- System sounds ----
            startup: [
                { f: 392.00, t: 0.00, dur: 0.14 },   // G4
                { f: 523.25, t: 0.12, dur: 0.14 },   // C5
                { f: 659.25, t: 0.26, dur: 0.14 },   // E5
                { f: 783.99, t: 0.40, dur: 0.16 },   // G5
                { f: 1046.5, t: 0.54, dur: 0.36 },   // C6 (held)
            ],
            shutdown: [
                { f: 1046.5, t: 0.00, dur: 0.14 },   // C6
                { f: 783.99, t: 0.13, dur: 0.13 },   // G5
                { f: 659.25, t: 0.25, dur: 0.13 },   // E5
                { f: 523.25, t: 0.37, dur: 0.13 },   // C5
                { f: 392.00, t: 0.49, dur: 0.28 },   // G4 (held)
            ],
            // ---- App sounds ----
            cat: [
                { f: 880.00, t: 0.00, dur: 0.06 },   // A5
                { f: 1108.7, t: 0.05, dur: 0.09 },   // C#6
            ],
            water: [
                { f: 392.00, t: 0.00, dur: 0.07 },   // G4
                { f: 523.25, t: 0.06, dur: 0.07 },   // C5
                { f: 659.25, t: 0.12, dur: 0.07 },   // E5
                { f: 783.99, t: 0.18, dur: 0.11 },   // G5
            ],
            letter: [
                { f: 523.25, t: 0.00, dur: 0.09 },   // C5
                { f: 659.25, t: 0.08, dur: 0.09 },   // E5
                { f: 783.99, t: 0.16, dur: 0.14 },   // G5
            ],
            // ---- Console sounds ----
            cmd_success: [
                { f: 523.25, t: 0.00, dur: 0.07 },   // C5
                { f: 659.25, t: 0.06, dur: 0.08 },   // E5
            ],
            cmd_error: [
                { f: 220.00, t: 0.00, dur: 0.10 },   // A3
                { f: 196.00, t: 0.09, dur: 0.14 },   // G3
            ],
            ach: [
                { f: 523.25, t: 0.00, dur: 0.08 },   // C5
                { f: 659.25, t: 0.08, dur: 0.08 },   // E5
                { f: 783.99, t: 0.16, dur: 0.08 },   // G5
                { f: 1046.5, t: 0.24, dur: 0.10 },   // C6
                { f: 1318.5, t: 0.34, dur: 0.30 },   // E6 (triumphant hold)
            ]
        };

        // Pack pattern (null means "use special synthesis above"); fall back to default
        const packNotes = packProfile?.patterns?.[type];
        const notes = (packNotes !== undefined && packNotes !== null)
            ? packNotes
            : (defaultPatterns[type] || defaultPatterns.ping);

        notes.forEach(({ f, t, dur }) => {
            const osc  = ctx.createOscillator();
            const gain = ctx.createGain();

            osc.type = oscType;
            osc.frequency.setValueAtTime(f, t0 + t);

            osc.connect(gain);
            gain.connect(dest);

            const s = t0 + t;
            const e = s + dur;

            gain.gain.setValueAtTime(0.0001, s);
            gain.gain.linearRampToValueAtTime(gainLevel, s + attackTime);
            gain.gain.setValueAtTime(gainLevel, e - 0.018);
            gain.gain.linearRampToValueAtTime(0.0001, e);         // sharp cutoff

            osc.start(s);
            osc.stop(e);
        });
    } catch(e) {}
}

function dataSig(posts) {
    let out = '';
    for (const [id, p] of Object.entries(posts)) {
        const replies = p.replies || [];
        const rx = p.reactionsBy ? Object.keys(p.reactionsBy).length : 0;
        out += `${id}:${replies.length}:${rx}|`;
    }
    return out;
}

// Includes comment-level reaction data; used to skip loadPosts() when only
// comment reactions changed (we do an in-place DOM update instead).
function visualSig(posts) {
    let out = '';
    for (const [id, p] of Object.entries(posts)) {
        const replies = p.replies || [];
        const postRx = Object.keys(p.reactionsBy || {}).sort()
            .map(e => `${e}:${Object.keys((p.reactionsBy || {})[e] || {}).sort().join(',')}`)
            .join(';');
        const cRx = replies.map(r => {
            const rx = r.reactionsBy || {};
            return `${r.id}:` + Object.keys(rx).sort()
                .map(e => `${e}:${Object.keys(rx[e] || {}).sort().join(',')}`)
                .join(';');
        }).join('|');
        out += `${id}:${replies.length}:[${postRx}]:[${cRx}]+`;
    }
    return out;
}

function isRead(post) {
    if (!post) return false;
    if (post.readBy) return !!(post.readBy[currentUser]);
    return !!post.read;
}

function updateSyncStatus(status) {
    document.getElementById('syncStatus').textContent = status;
}

function updateActiveFiltersBanner() {
    const banner = document.getElementById('activeFiltersBanner');
    const collPill = document.getElementById('activeCollectionPill');
    const srcPill = document.getElementById('activeSourcePill');

    const hasColl = !!currentCollection;
    const hasSrc = !!currentSource;

    if (!hasColl && !hasSrc) {
        banner.classList.add('hidden');
        collPill.classList.add('hidden');
        srcPill.classList.add('hidden');
        return;
    }

    banner.classList.remove('hidden');

    if (hasColl) {
        collPill.classList.remove('hidden');
        collPill.textContent = `${COLLECTION_EMOJIS[currentCollection] || '[+]'} ${COLLECTION_LABELS[currentCollection] || currentCollection}`;
        collPill.onclick = () => openCollectionsModal();
        collPill.title = 'Change collection filter';
    } else {
        collPill.classList.add('hidden');
    }

    if (hasSrc) {
        srcPill.classList.remove('hidden');
        srcPill.textContent = `${SOURCE_EMOJIS[currentSource] || '[url]'} ${SOURCE_LABELS[currentSource] || currentSource}`;
        srcPill.onclick = () => openSourcesModal();
        srcPill.title = 'Change source filter';
    } else {
        srcPill.classList.add('hidden');
    }
}

window.clearAllExtraFilters = function() {
    currentCollection = null;
    currentSource = null;
    updateActiveFiltersBanner();
    loadPosts();
};

// ---- ALLOWED USERS ----
// Map each authorised Google account email → display name used throughout the app.
// Edit the two email addresses below — nothing else needs to change.
const ALLOWED_USERS = {
    'elliotpeep@gmail.com':  'El',
    'a.fduarte1@gmail.com':  'Tero',
};

// ---- AUTH ----
window.signInWithGoogle = async function() {
    try {
        await signInWithPopup(auth, googleProvider);
    } catch (err) {
        if (err.code !== 'auth/popup-closed-by-user') {
            console.error('Sign-in error:', err);
            showToast('Sign-in failed. Please try again.');
        }
    }
};

// Called after onAuthStateChanged confirms an authorised user.
function login(displayName, email) {
    currentUser = displayName;
    localStorage.setItem('currentUser', displayName);

    ensureAudio();
    sparkSound('startup');
    const loginOverlay = document.getElementById('loginOverlay');
    if (loginOverlay) loginOverlay.style.display = 'none';

    const emoji = AUTHOR_EMOJI[displayName] || '[?]';
    const userIndicator = document.getElementById('userIndicator');
    if (userIndicator) {
        userIndicator.textContent = `${emoji} ${displayName} · sign out`;
        userIndicator.title = `Signed in as ${email}`;
    }

    const otherBtn = document.getElementById('btnOtherUser');
    if (otherBtn) {
        if (displayName === 'El' || displayName === 'Tero') {
            const other = displayName === 'El' ? 'Tero' : 'El';
            otherBtn.textContent = `${AUTHOR_EMOJI[other]} Just ${other}`;
            otherBtn.classList.remove('hidden');
        } else {
            otherBtn.classList.add('hidden');
            if (currentFilter === 'just-other') setFilter('all');
        }
    }

    activitySeenTs = Number(localStorage.getItem(`activitySeenTs-${displayName}`) || String(Date.now() - 86400000));
    updateNewCount();

    loadPosts();
    loadUserWallpaper();
    applyIconPositions();
    setupTypingCleanup();
    setupPresence();
    if (typeof window._profilesOnLogin === 'function') window._profilesOnLogin();
    startNowListening();
    showSection('feed');
    initAchievements();
    initPixelCat();
    // Allow wallpaper/theme changes to count toward customisation achievements
    // after the initial restore has completed.
    requestAnimationFrame(() => { _desktopCustomisationReady = true; });
    // If the garden window was already open when auth resolved (page-restore path),
    // run the visit-spark check now that currentUser is set.
    const gardenWin = document.getElementById('w95-win-garden');
    if (gardenWin && !gardenWin.classList.contains('is-hidden')) {
        checkVisitSpark();
    }
}

window.logout = function() {
    sparkSound('shutdown');
    stopChatTyping();
    signOut(auth);
    // onAuthStateChanged(null) will clear currentUser and show the login screen
};

// ---- SECTION MANAGER ----
function showSection(name) {
    currentSection = name;
    const isFeed = name === 'feed';
    document.getElementById('feedSection').classList.toggle('hidden', !isFeed);
    document.getElementById('filterButtons').classList.toggle('hidden', !isFeed);
    document.getElementById('searchWrap').classList.toggle('hidden', !isFeed);
}

// ---- BOARDS ----
function setupBoardsListener() {
    onValue(boardsRef, snap => {
        allBoards = snap.val() || {};
        const sbWin = document.getElementById('w95-win-scrapbook');
        if (sbWin && !sbWin.classList.contains('is-hidden')) renderBoardsList();
    });
}

function setupBoardDeleteRequestsListener() {
    onValue(boardDeleteRequestsRef, snap => {
        allBoardDeleteRequests = snap.val() || {};
        // Find a pending request directed at the current user (i.e. sent by the other user)
        const pending = Object.entries(allBoardDeleteRequests)
            .find(([, req]) => req.requestedBy !== currentUser);
        const modal = document.getElementById('boardDeleteRequestModal');
        if (!modal) return;
        if (pending) {
            const [boardId, req] = pending;
            modal.dataset.boardId = boardId;
            document.getElementById('boardDeleteRequestUser').textContent = req.requestedBy;
            document.getElementById('boardDeleteRequestTitle').textContent = req.boardTitle;
            if (!modal.classList.contains('show')) {
                openModal(modal);
                sparkSound('ping', 'ui');
                sendNotification('Board deletion request', `${req.requestedBy} wants to delete "${req.boardTitle}"`, 'board-delete');
            }
        } else {
            if (modal.classList.contains('show')) closeModal(modal);
        }
    });
}

function renderBoardsList() {
    const container = document.getElementById('boardsList');
    const detail = document.getElementById('boardDetail');
    if (!container) return;
    detail.classList.add('hidden');
    container.classList.remove('hidden');

    const entries = Object.entries(allBoards)
        .filter(([, b]) => b.owner === currentUser || b.isShared)
        .sort((a, b) => b[1].createdAt - a[1].createdAt);

    if (entries.length === 0) {
        container.innerHTML = '<div class="boards-empty">No boards yet. Create one!</div>';
        return;
    }
    container.innerHTML = entries.map(([id, board]) => `
        <div class="board-card" onclick="openBoardDetail('${id}')">
            <div class="board-card-title">${safeText(board.title)}</div>
            <div class="board-card-meta">${board.isShared ? '👥 Shared' : '🔒 Personal'} · by ${safeText(board.owner)}</div>
        </div>
    `).join('');
}

window.openBoardDetail = async function(boardId) {
    const board = allBoards[boardId];
    if (!board) return;
    document.getElementById('boardsList').classList.add('hidden');
    const detail = document.getElementById('boardDetail');
    detail.classList.remove('hidden');
    const isOwner = board.owner === currentUser;
    const pendingRequest = allBoardDeleteRequests[boardId];
    let deleteBtn = '';
    if (isOwner && pendingRequest) {
        deleteBtn = `<button class="board-delete-btn board-delete-pending" onclick="cancelBoardDeleteRequest('${boardId}')" title="Cancel deletion request">⏳ Cancel request</button>`;
    } else if (isOwner) {
        deleteBtn = `<button class="board-delete-btn" onclick="requestDeleteBoard('${boardId}')" title="Delete board">🗑</button>`;
    }
    document.getElementById('boardDetailHeader').innerHTML = `
        <div>
            <h3 class="boards-title">${safeText(board.title)}</h3>
            <span class="board-card-meta">${board.isShared ? '👥 Shared' : '🔒 Personal'}</span>
        </div>
        ${deleteBtn}
    `;
    const snap = await get(ref(database, `board_items/${boardId}`));
    const items = snap.val() || {};
    const postIds = Object.keys(items).sort((a, b) => items[b].savedAt - items[a].savedAt);
    const postsEl = document.getElementById('boardDetailPosts');
    if (postIds.length === 0) {
        postsEl.innerHTML = '<div class="boards-empty">No posts saved here yet.</div>';
        return;
    }
    postsEl.innerHTML = postIds
        .map(id => allPosts[id] ? createPostCard(allPosts[id]) : '')
        .filter(Boolean)
        .join('');
};

window.closeBoardDetail = function() {
    document.getElementById('boardDetail').classList.add('hidden');
    document.getElementById('boardsList').classList.remove('hidden');
};

window.openBoardPickerModal = function(postId) {
    _boardPickerPostId = postId;
    const post = allPosts[postId];
    const isFav = !!(post?.favoritedBy?.[currentUser]);
    const entries = Object.entries(allBoards)
        .filter(([, b]) => b.owner === currentUser || b.isShared)
        .sort((a, b) => a[1].title.localeCompare(b[1].title));

    const list = document.getElementById('boardPickerList');
    list.innerHTML = `
        <button class="board-picker-item${isFav ? ' board-picker-saved' : ''}"
                onclick="toggleFavorite('${postId}');closeModal(document.getElementById('boardPickerModal'))">
            ⭐ Quick Save${isFav ? ' ✓' : ''}
        </button>
        ${entries.map(([id, board]) => `
            <button class="board-picker-item" onclick="saveToBoard('${id}','${postId}')">
                ${safeText(board.title)}
                <span class="board-meta-tag">${board.isShared ? '👥' : '🔒'}</span>
            </button>
        `).join('')}
    `;
    openModal(document.getElementById('boardPickerModal'));
};

window.saveToBoard = async function(boardId, postId) {
    await set(ref(database, `board_items/${boardId}/${postId}`), { savedAt: Date.now() });
    closeModal(document.getElementById('boardPickerModal'));
    showToast('Saved to board ✓');
};

window.openCreateBoardModal = function() {
    closeModal(document.getElementById('boardPickerModal'));
    openModal(document.getElementById('createBoardModal'));
};

window.createBoard = async function() {
    const title = document.getElementById('boardNameInput').value.trim();
    const isShared = document.getElementById('boardSharedToggle').checked;
    if (!title) { showToast('Enter a board name'); return; }
    await push(boardsRef, { title, owner: currentUser, isShared, createdAt: Date.now() });
    document.getElementById('boardNameInput').value = '';
    document.getElementById('boardSharedToggle').checked = false;
    closeModal(document.getElementById('createBoardModal'));
    showToast('Board created ✓');
};

window.requestDeleteBoard = async function(boardId) {
    const board = allBoards[boardId];
    if (!board || board.owner !== currentUser) return;
    if (!board.isShared) {
        // Personal board: use the standard delete confirmation modal
        openDeleteModal({ type: 'board', boardId });
    } else {
        // Shared board: send a deletion request to the other user
        await set(ref(database, `board_delete_requests/${boardId}`), {
            requestedBy: currentUser,
            requestedAt: Date.now(),
            boardTitle: board.title
        });
        showToast('Deletion request sent — waiting for their confirmation');
    }
};

window.cancelBoardDeleteRequest = async function(boardId) {
    await remove(ref(database, `board_delete_requests/${boardId}`));
    showToast('Deletion request cancelled');
    openBoardDetail(boardId);
};

window.confirmBoardDeletion = async function() {
    const modal = document.getElementById('boardDeleteRequestModal');
    const boardId = modal.dataset.boardId;
    if (!boardId) return;
    const board = allBoards[boardId];
    const itemsSnap = await get(ref(database, `board_items/${boardId}`));
    const boardItems = itemsSnap.val() || {};
    await set(ref(database, `recycleBin/b_${boardId}`), {
        id: boardId,
        type: 'board',
        board: board,
        boardItems: boardItems,
        deletedAt: Date.now(),
    });
    await remove(ref(database, `board_delete_requests/${boardId}`));
    await remove(ref(database, `board_items/${boardId}`));
    await remove(ref(database, `boards/${boardId}`));
    closeModal(modal);
    const sbWin = document.getElementById('w95-win-scrapbook');
    if (sbWin && !sbWin.classList.contains('is-hidden')) closeBoardDetail();
    showToast('Board moved to Recycle Bin');
};

window.denyBoardDeletion = async function() {
    const modal = document.getElementById('boardDeleteRequestModal');
    const boardId = modal.dataset.boardId;
    if (!boardId) return;
    await remove(ref(database, `board_delete_requests/${boardId}`));
    closeModal(modal);
    showToast('Board kept ♡');
};

// ---- WISHLIST ----

function setupWishlistBoardsListener() {
    onValue(wishlistBoardsRef, snap => {
        allWishlistBoards = snap.val() || {};
        const win = document.getElementById('w95-win-wishlist');
        if (win && !win.classList.contains('is-hidden')) {
            if (currentWishlistBoardId) {
                if (allWishlistBoards[currentWishlistBoardId]) {
                    openWishlistBoardDetail(currentWishlistBoardId);
                } else {
                    closeWishlistBoardDetail();
                }
            } else {
                renderWishlistBoardsList();
            }
        }
    });
}

function renderWishlistBoardsList() {
    const detail = document.getElementById('wishlistBoardDetail');
    const listEl = document.getElementById('wishlistBoardsList');
    if (!listEl) return;
    if (detail) detail.classList.add('hidden');
    listEl.classList.remove('hidden');
    currentWishlistBoardId = null;

    const container = document.getElementById('wishlistBoardsContent');
    if (!container) return;

    function renderSection(ownerName, boards) {
        const isMe = ownerName === currentUser;
        let html = `<div class="wishlist-owner-section">
            <div class="wishlist-owner-heading">${safeText(ownerName)}'s Boards${isMe ? `<button class="boards-action-btn btn-primary" style="font-size:11px;padding:4px 12px;margin-left:8px;" onclick="openCreateWishlistBoardModal()">+ New</button>` : ''}</div>`;
        if (boards.length === 0) {
            html += `<div class="boards-empty" style="padding:12px 0 8px;">No boards yet.</div>`;
        } else {
            html += boards.map(([id, board]) => `
                <div class="board-card" onclick="openWishlistBoardDetail('${id}')">
                    <div class="board-card-title">${safeText(board.title)}</div>
                    <div class="board-card-meta">by ${safeText(board.owner)}</div>
                </div>
            `).join('');
        }
        html += '</div>';
        return html;
    }

    const elBoards   = Object.entries(allWishlistBoards).filter(([, b]) => b.owner === 'El').sort((a, b) => b[1].createdAt - a[1].createdAt);
    const teroBoards = Object.entries(allWishlistBoards).filter(([, b]) => b.owner === 'Tero').sort((a, b) => b[1].createdAt - a[1].createdAt);

    container.innerHTML = renderSection('El', elBoards) + renderSection('Tero', teroBoards);
}

window.openWishlistBoardDetail = async function(boardId) {
    const board = allWishlistBoards[boardId];
    if (!board) return;
    currentWishlistBoardId = boardId;
    document.getElementById('wishlistBoardsList').classList.add('hidden');
    const detail = document.getElementById('wishlistBoardDetail');
    detail.classList.remove('hidden');

    const isOwner = board.owner === currentUser;
    document.getElementById('wishlistBoardDetailHeader').innerHTML = `
        <div>
            <h3 class="boards-title">${safeText(board.title)}</h3>
            <span class="board-card-meta">by ${safeText(board.owner)}</span>
        </div>
        <div style="display:flex;gap:8px;align-items:center;">
            ${isOwner ? `<button class="btn-primary boards-action-btn" onclick="openAddWishlistItemModal()">+ Add</button>` : ''}
            ${isOwner ? `<button class="board-delete-btn" onclick="deleteWishlistBoard('${boardId}')" title="Delete board">&#128465;</button>` : ''}
        </div>
    `;

    const grid = document.getElementById('wishlistItemsGrid');
    grid.innerHTML = '<div class="boards-empty">Loading\u2026</div>';
    const snap = await get(ref(database, `wishlistItems/${boardId}`));
    renderWishlistItems(boardId, snap.val() || {});
};

function renderWishlistItems(boardId, items) {
    const grid = document.getElementById('wishlistItemsGrid');
    if (!grid) return;
    const isOwner = allWishlistBoards[boardId]?.owner === currentUser;
    const entries = Object.entries(items).sort((a, b) => b[1].createdAt - a[1].createdAt);
    if (entries.length === 0) {
        grid.innerHTML = `<div class="boards-empty">No items yet.${isOwner ? ' Add one!' : ''}</div>`;
        return;
    }
    grid.innerHTML = entries.map(([itemId, item]) => {
        const imgHtml = item.image
            ? `<img class="wishlist-item-img" src="${safeText(item.image)}" alt="" onerror="this.style.display='none'">`
            : `<div class="wishlist-item-img-placeholder">&#128279;</div>`;
        return `<div class="wishlist-item-card" data-item-id="${itemId}" onclick="openWishlistItemComments('${boardId}','${itemId}')">
            ${imgHtml}
            <div class="wishlist-item-body">
                <div class="wishlist-item-title">${safeText(item.title || item.url)}</div>
                ${item.store ? `<div class="wishlist-item-store">${safeText(item.store)}</div>` : ''}
                ${item.priceText ? `<div class="wishlist-item-price">${safeText(item.priceText)}</div>` : ''}
                ${item.note ? `<div class="wishlist-item-note">${safeText(item.note)}</div>` : ''}
            </div>
            <div class="wishlist-item-footer">
                <span class="wishlist-item-comment-btn" onclick="event.stopPropagation();openWishlistItemComments('${boardId}','${itemId}')" title="Comments">
                    &#128172; <span class="wl-cmt-count" id="wl-cmt-count-${itemId}"></span>
                </span>
            </div>
            ${isOwner ? `<button class="wishlist-item-delete" onclick="event.stopPropagation();deleteWishlistItem('${boardId}','${itemId}')" title="Remove">&#10005;</button>` : ''}
        </div>`;
    }).join('');
    // Update comment counts asynchronously
    Promise.all(entries.map(async ([itemId]) => {
        const snap = await get(ref(database, `wishlistComments/${itemId}`));
        const count = snap.exists() ? Object.keys(snap.val()).length : 0;
        const badge = document.getElementById(`wl-cmt-count-${itemId}`);
        if (badge) badge.textContent = count > 0 ? count : '';
    }));
    // Hydrate missing thumbnails: items with no stored image try a fresh fetch
    const noImageEntries = entries.filter(([, item]) => !item.image);
    if (noImageEntries.length > 0) {
        Promise.all(noImageEntries.map(async ([itemId, item]) => {
            const meta = await fetchLinkMeta(item.url, { requireImage: true });
            if (!meta?.image) return;
            // Persist newly found image to Firebase
            set(ref(database, `wishlistItems/${boardId}/${itemId}/image`), meta.image).catch(() => {});
            // Swap placeholder in DOM if card is still visible
            const card = grid.querySelector(`[data-item-id="${itemId}"]`);
            if (!card) return;
            const placeholder = card.querySelector('.wishlist-item-img-placeholder');
            if (!placeholder) return;
            const img = document.createElement('img');
            img.className = 'wishlist-item-img';
            img.src = meta.image;
            img.alt = '';
            img.onerror = () => img.style.display = 'none';
            placeholder.replaceWith(img);
        }));
    }
}

window.closeWishlistBoardDetail = function() {
    document.getElementById('wishlistBoardDetail').classList.add('hidden');
    document.getElementById('wishlistBoardsList').classList.remove('hidden');
    currentWishlistBoardId = null;
    renderWishlistBoardsList();
};

window.openCreateWishlistBoardModal = function() {
    const modal = document.getElementById('createWishlistBoardModal');
    if (!modal) return;
    document.getElementById('wishlistBoardNameInput').value = '';
    openModal(modal);
};

window.createWishlistBoard = async function() {
    const title = document.getElementById('wishlistBoardNameInput').value.trim();
    if (!title) { showToast('Enter a board name'); return; }
    await push(wishlistBoardsRef, { title, owner: currentUser, createdAt: Date.now() });
    closeModal(document.getElementById('createWishlistBoardModal'));
    showToast('Board created \u2713');
};

window.deleteWishlistBoard = async function(boardId) {
    const board = allWishlistBoards[boardId];
    if (!board || board.owner !== currentUser) return;
    if (!confirm(`Delete "${board.title}"? This cannot be undone.`)) return;
    await remove(ref(database, `wishlistItems/${boardId}`));
    await remove(ref(database, `wishlistBoards/${boardId}`));
    closeWishlistBoardDetail();
    showToast('Board deleted');
};

window.openAddWishlistItemModal = function() {
    const modal = document.getElementById('addWishlistItemModal');
    if (!modal) return;
    document.getElementById('wishlistItemUrl').value = '';
    document.getElementById('wishlistItemTitle').value = '';
    document.getElementById('wishlistItemNote').value = '';
    document.getElementById('wishlistItemPrice').value = '';
    document.getElementById('wishlistItemStore').value = '';
    openModal(modal);
};

window.addWishlistItem = async function() {
    const boardId = currentWishlistBoardId;
    if (!boardId) return;
    const url = document.getElementById('wishlistItemUrl').value.trim();
    if (!url) { showToast('Enter a URL'); return; }
    const title     = document.getElementById('wishlistItemTitle').value.trim() || null;
    const note      = document.getElementById('wishlistItemNote').value.trim() || null;
    const priceText = document.getElementById('wishlistItemPrice').value.trim() || null;
    const store     = document.getElementById('wishlistItemStore').value.trim() || null;

    const item = { url, createdAt: Date.now(), owner: currentUser };
    if (title)     item.title     = title;
    if (note)      item.note      = note;
    if (priceText) item.priceText = priceText;
    if (store)     item.store     = store;

    closeModal(document.getElementById('addWishlistItemModal'));
    showToast('Adding item\u2026');

    // Always fetch thumbnail (and title if the user didn't supply one)
    const meta = await fetchLinkMeta(url);
    if (meta) {
        if (!title && meta.title) item.title = meta.title;
        if (meta.image) item.image = meta.image;
    }

    await push(ref(database, `wishlistItems/${boardId}`), item);
    const snap = await get(ref(database, `wishlistItems/${boardId}`));
    renderWishlistItems(boardId, snap.val() || {});
    showToast('Item added \u2713');
};

window.deleteWishlistItem = async function(boardId, itemId) {
    await remove(ref(database, `wishlistItems/${boardId}/${itemId}`));
    await remove(ref(database, `wishlistComments/${itemId}`));
    const snap = await get(ref(database, `wishlistItems/${boardId}`));
    renderWishlistItems(boardId, snap.val() || {});
    showToast('Item removed');
};

// ---- WISHLIST COMMENTS ----

window.openWishlistItemComments = async function(boardId, itemId) {
    currentWishlistCommentItemId = itemId;
    currentWishlistCommentBoardId = boardId;

    const item = (await get(ref(database, `wishlistItems/${boardId}/${itemId}`))).val();
    const modal = document.getElementById('wishlistItemCommentsModal');
    if (!modal) return;

    // Populate image
    const imgWrap = document.getElementById('wlDetailImgWrap');
    if (item?.image) {
        imgWrap.innerHTML = `<img class="wl-detail-img" src="${safeText(item.image)}" alt="" onerror="this.parentElement.style.display='none'">`;
        imgWrap.style.display = '';
    } else {
        imgWrap.innerHTML = '';
        imgWrap.style.display = 'none';
    }

    // Populate meta fields
    const titleEl = document.getElementById('wlDetailTitle');
    titleEl.textContent = item?.title || item?.url || 'Item';

    const storeEl = document.getElementById('wlDetailStore');
    storeEl.textContent = item?.store || '';
    storeEl.style.display = item?.store ? '' : 'none';

    const priceEl = document.getElementById('wlDetailPrice');
    priceEl.textContent = item?.priceText || '';
    priceEl.style.display = item?.priceText ? '' : 'none';

    const noteEl = document.getElementById('wlDetailNote');
    noteEl.textContent = item?.note || '';
    noteEl.style.display = item?.note ? '' : 'none';

    const linkEl = document.getElementById('wlDetailLink');
    if (item?.url) {
        linkEl.href = item.url;
        linkEl.style.display = '';
    } else {
        linkEl.style.display = 'none';
    }

    document.getElementById('wishlistCommentInput').value = '';

    const snap = await get(ref(database, `wishlistComments/${itemId}`));
    renderWishlistCommentsList(itemId, snap.val() || {});
    openModal(modal);
};

function renderWishlistCommentsList(itemId, comments) {
    const list = document.getElementById('wishlistCommentsList');
    if (!list) return;
    const entries = Object.entries(comments).sort((a, b) => a[1].timestamp - b[1].timestamp);
    if (entries.length === 0) {
        list.innerHTML = `<div class="wl-comments-empty">No comments yet. Say something! &#128172;</div>`;
        return;
    }
    list.innerHTML = entries.map(([commentId, c]) => {
        const ae = AUTHOR_EMOJI[c.author] || '[?]';
        const ts = c.timestamp ? timeAgo(c.timestamp) : '';
        const tsFull = c.timestamp ? exactTimestamp(c.timestamp) : '';
        return `<div class="wl-comment-item">
            <div class="wl-comment-header">
                <span class="wl-comment-author">${safeText(c.author)} ${ae}</span>
                ${ts ? `<span class="wl-comment-ts" title="${safeText(tsFull)}">${safeText(ts)}</span>` : ''}
                ${c.author === currentUser ? `<button class="wl-comment-delete" onclick="deleteWishlistItemComment('${itemId}','${commentId}')" title="Delete">&#10005;</button>` : ''}
            </div>
            <div class="wl-comment-text">${safeText(c.text)}</div>
        </div>`;
    }).join('');
    list.scrollTop = list.scrollHeight;
}

window.addWishlistItemComment = async function() {
    const itemId = currentWishlistCommentItemId;
    const boardId = currentWishlistCommentBoardId;
    if (!itemId) return;
    const input = document.getElementById('wishlistCommentInput');
    const text = input.value.trim();
    if (!text) return;

    const commentId = Date.now().toString(36) + Math.random().toString(36).slice(2);
    await set(ref(database, `wishlistComments/${itemId}/${commentId}`), {
        author: currentUser,
        text,
        timestamp: Date.now()
    });

    input.value = '';
    const snap = await get(ref(database, `wishlistComments/${itemId}`));
    renderWishlistCommentsList(itemId, snap.val() || {});

    // Update badge on card
    const count = Object.keys(snap.val() || {}).length;
    const badge = document.getElementById(`wl-cmt-count-${itemId}`);
    if (badge) badge.textContent = count > 0 ? count : '';

    sparkSound('reply');
};

window.deleteWishlistItemComment = async function(itemId, commentId) {
    await remove(ref(database, `wishlistComments/${itemId}/${commentId}`));
    const snap = await get(ref(database, `wishlistComments/${itemId}`));
    renderWishlistCommentsList(itemId, snap.val() || {});

    // Update badge on card
    const count = Object.keys(snap.val() || {}).length;
    const badge = document.getElementById(`wl-cmt-count-${itemId}`);
    if (badge) badge.textContent = count > 0 ? count : '';
};

window.closeWishlistItemCommentsModal = function() {
    currentWishlistCommentItemId = null;
    currentWishlistCommentBoardId = null;
    closeModal(document.getElementById('wishlistItemCommentsModal'));
};

window.handleWishlistCommentKey = function(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        addWishlistItemComment();
    }
};

// ---- MAILBOX ----
function setupLettersListener() {
    onValue(lettersRef, snap => {
        allLetters = snap.val() || {};
        updateMailboxBadge();
        if (!document.getElementById('w95-win-mailbox')?.classList.contains('is-hidden')) renderMailbox();
    });
}

function updateMailboxBadge() {
    const unread = Object.values(allLetters)
        .filter(l => l.to === currentUser && !l.readAt).length;
    const inboxBadge = document.getElementById('inboxUnread');
    if (inboxBadge) {
        if (unread > 0) { inboxBadge.textContent = unread; inboxBadge.classList.remove('hidden'); }
        else { inboxBadge.classList.add('hidden'); }
    }
    // Update mailbox desktop icon flag
    const flagUp   = document.querySelector('#mailboxDesktopIcon .mailbox-flag-up');
    const flagDown = document.querySelector('#mailboxDesktopIcon .mailbox-flag-down');
    if (flagUp)   flagUp.style.display   = unread > 0 ? '' : 'none';
    if (flagDown) flagDown.style.display = unread > 0 ? 'none' : '';
}

function renderMailbox() {
    const body = document.getElementById('mailboxBody');
    if (!body) return;
    const letters = Object.entries(allLetters)
        .map(([id, l]) => ({ id, ...l }))
        .filter(l => mailboxTab === 'inbox' ? l.to === currentUser : l.from === currentUser)
        .sort((a, b) => b.createdAt - a.createdAt);
    if (letters.length === 0) {
        body.innerHTML = `<div class="mailbox-empty">${mailboxTab === 'inbox' ? 'No letters yet 💌' : 'Nothing sent yet'}</div>`;
        return;
    }
    body.innerHTML = letters.map(l => `
        <div class="letter-item${!l.readAt && l.to === currentUser ? ' unread' : ''}" onclick="openLetter('${l.id}')">
            <div class="letter-from">${mailboxTab === 'inbox' ? `from ${safeText(l.from)}` : `to ${safeText(l.to)}`}</div>
            <div class="letter-subject">${safeText(l.subject || '(no subject)')}</div>
            <div class="letter-preview">${safeText((l.body || '').slice(0, 80))}${(l.body || '').length > 80 ? '…' : ''}</div>
            <div class="letter-time">${safeText(timeAgo(l.createdAt))}</div>
        </div>
    `).join('');
}

window.openLetter = async function(letterId) {
    const letter = allLetters[letterId];
    if (!letter) return;
    sparkSound('letter');
    if (!letter.readAt && letter.to === currentUser) {
        await update(ref(database, `letters/${letterId}`), { readAt: Date.now() });
    }
    const body = document.getElementById('mailboxBody');
    body.innerHTML = `
        <button class="board-back-btn" onclick="renderMailbox()">← Back</button>
        <div class="letter-full">
            <div class="letter-full-meta">
                <span>from ${safeText(letter.from)}</span>
                <span>→ ${safeText(letter.to)}</span>
                <span>${safeText(exactTimestamp(letter.createdAt))}</span>
            </div>
            ${letter.subject ? `<div class="letter-full-subject">${safeText(letter.subject)}</div>` : ''}
            <div class="letter-full-body">${safeText(letter.body || '')}</div>
            ${letter.from === currentUser ? `<button class="btn-secondary delete-letter-btn" onclick="deleteLetter('${letterId}')">Delete</button>` : ''}
        </div>
    `;
};

window.deleteLetter = async function(letterId) {
    if (!allLetters[letterId] || allLetters[letterId].from !== currentUser) return;
    await remove(ref(database, `letters/${letterId}`));
    renderMailbox();
    showToast('Deleted');
};

window.sendLetter = async function() {
    const to = currentUser === 'El' ? 'Tero' : 'El';
    const subject = document.getElementById('letterSubject').value.trim();
    const body = document.getElementById('letterBody').value.trim();
    if (!body) { showToast('Write something first'); return; }
    await push(lettersRef, { from: currentUser, to, subject, body, createdAt: Date.now(), readAt: null });
    document.getElementById('letterSubject').value = '';
    document.getElementById('letterBody').value = '';
    closeModal(document.getElementById('composeLetterModal'));
    showToast('Letter sent 💌');
    _afterLetter();
};

window.openComposeLetter = function() {
    openModal(document.getElementById('composeLetterModal'));
};

window.switchMailboxTab = function(tab) {
    mailboxTab = tab;
    document.getElementById('tabInbox').classList.toggle('active', tab === 'inbox');
    document.getElementById('tabSent').classList.toggle('active', tab === 'sent');
    renderMailbox();
};

// ---- NOW PLAYING ----

const LASTFM_API_KEY = '4d927af2241b4f77b711972fb2112329';
const LASTFM_USERS   = { el: 'elliotmakesart', tero: 'afduarte1' };

async function fetchNowPlaying(userKey) {
    const username = LASTFM_USERS[userKey];
    if (!username) return null;
    try {
        const lastfmUrl = `https://ws.audioscrobbler.com/2.0/?method=user.getrecenttracks&user=${encodeURIComponent(username)}&api_key=${LASTFM_API_KEY}&format=json&limit=1&t=${Date.now()}`;
        const proxyUrl  = `https://api.allorigins.win/raw?url=${encodeURIComponent(lastfmUrl)}`;
        const r = await fetch(proxyUrl, { cache: 'no-store' });
        if (!r.ok) return null;
        const json = await r.json();
        const tracks = json.recenttracks?.track;
        if (!tracks) return null;
        const track = Array.isArray(tracks) ? tracks[0] : tracks;
        const nowPlaying = track['@attr']?.nowplaying === 'true';
        const images = track.image || [];
        return {
            nowPlaying,
            track:     track.name || '—',
            artist:    track.artist?.['#text'] || '',
            image:     images[images.length - 1]?.['#text'] || '',
            timestamp: nowPlaying ? null : (track.date?.uts ? Number(track.date.uts) * 1000 : null),
        };
    } catch { return null; }
}

function renderNLCard(suffix, data) {
    const key = data ? `${data.track}|${data.artist}|${data.nowPlaying}` : 'none';
    if (_nlLastTrack[suffix] === key) return;   // no change, skip DOM update
    _nlLastTrack[suffix] = key;

    const artEl    = document.getElementById(`nlArt${suffix}`);
    const trackEl  = document.getElementById(`nlTrack${suffix}`);
    const artistEl = document.getElementById(`nlArtist${suffix}`);
    const statusEl = document.getElementById(`nlStatus${suffix}`);
    const cardEl   = document.getElementById(`nlCard${suffix}`);
    if (!cardEl) return;

    if (!data || data.status === 'none') {
        trackEl.textContent  = '—';
        artistEl.textContent = '';
        statusEl.textContent = '';
        artEl.style.display  = 'none';
        cardEl.classList.remove('nl-playing');
        return;
    }

    trackEl.textContent  = data.track  || '—';
    artistEl.textContent = data.artist || '';
    cardEl.classList.toggle('nl-playing', !!data.nowPlaying);
    statusEl.textContent = data.nowPlaying
        ? '▶ Now playing'
        : (data.timestamp ? `Last: ${timeAgo(data.timestamp)}` : '');

    if (data.image) { artEl.src = data.image; artEl.style.display = ''; }
    else            { artEl.style.display = 'none'; }
}

async function pollNowListening() {
    const [elData, teroData] = await Promise.all([
        fetchNowPlaying('el'),
        fetchNowPlaying('tero'),
    ]);
    if (elData   !== null) renderNLCard('El',   elData);
    if (teroData !== null) renderNLCard('Tero', teroData);
    // Let the cat window know if anyone is currently listening to music
    window._anyoneNowPlaying = !!(elData?.nowPlaying || teroData?.nowPlaying);
}

let _nlInterval = null;
const _nlLastTrack = {};   // cache: suffix -> "track|artist|nowPlaying"
function startNowListening() {
    if (_nlInterval) clearInterval(_nlInterval);
    pollNowListening();
    _nlInterval = setInterval(pollNowListening, 35_000);
}

// ---- DB LISTENERS ----
// Started exactly once, after the first successful authentication.
let _dbListenersStarted = false;

function setupDBListeners() {
    if (_dbListenersStarted) return;
    _dbListenersStarted = true;

    setupBoardsListener();
    setupBoardDeleteRequestsListener();
    setupWishlistBoardsListener();
    setupLettersListener();

    onValue(recycleBinRef, (snapshot) => {
        allRecycleBin = snapshot.val() || {};
        renderRecycleBin();
        applyRecycleBinIconState();
    });

    onValue(categoriesRef, (snapshot) => {
        const custom = snapshot.val() || {};
        // Merge custom categories into lookup objects (custom categories come after built-ins)
        Object.entries(custom).forEach(([key, val]) => {
            COLLECTION_EMOJIS[key] = val.emoji || '[+]';
            COLLECTION_LABELS[key]  = val.label || key;
        });
        renderCustomCollectionButtons();
        renderCustomCollectionsGrid();
    });

    onValue(postsRef, (snapshot) => {
        const newPosts = snapshot.val() || {};
        const sig = dataSig(newPosts);

        if (!isInitialLoad && sig !== prevDataSig) {
            sparkSound('ping', 'post');

            // Desktop notification + in-app notification popup for brand-new posts
            const newIds = Object.keys(newPosts).filter(id => !seenPostIds.has(id));
            if (newIds.length > 0) {
                const p = newPosts[newIds[0]];
                const author = p.author || 'Someone';
                // Only notify if the post is from the other user (not your own post)
                if (author !== currentUser) {
                    const label = p.note || p.url || 'A new post was shared';
                    sendNotification(`New post from ${author} 💜`, label, 'new-post');
                    // In-app notification popup (always shown, regardless of focus)
                    addInAppNotification({ postId: newIds[0], post: p });
                }
            }
        }

        seenPostIds = new Set(Object.keys(newPosts));
        prevDataSig = sig;
        isInitialLoad = false;

        allPosts = newPosts;

        const vSig = visualSig(newPosts);
        if (vSig !== prevVisualSig) {
            prevVisualSig = vSig;
            loadPosts();
        }
        updateNewCount();
        updateActivityBadge();
        if (!document.getElementById('w95-win-new')?.classList.contains('is-hidden')) {
            renderActivityPanel();
        }
        updateSyncStatus('Synced');
        setTimeout(() => updateSyncStatus('Live'), 2000);
    });

    onValue(ref(database, 'typing/chat'), snapshot => {
        _cachedChatTyping = snapshot.val() || {};
        updateChatTypingUI();
    });

    onValue(ref(database, 'typing/comments'), snapshot => {
        _cachedCommentTyping = snapshot.val() || {};
        updateCommentTypingUI();
    });

    onValue(query(chatRef, limitToLast(80)), (snapshot) => {
        const raw = snapshot.val() || {};
        const messages = Object.entries(raw)
            .map(([id, m]) => ({ id, ...m }))
            .sort((a,b) => (a.timestamp || 0) - (b.timestamp || 0));
        lastChatMessages = messages;

        // Seed seen-timestamp from the user's own last message so history
        // doesn't appear as 38 unread messages on a fresh device/browser.
        if (lastChatSeenTs === 0 && currentUser) {
            const myLast = [...messages].reverse().find(m => m.author === currentUser);
            lastChatSeenTs = myLast ? myLast.timestamp : Date.now();
            localStorage.setItem('chatSeenTs', String(lastChatSeenTs));
        }

        if (chatOpen) {
            const newest = messages[messages.length - 1]?.timestamp || lastChatSeenTs;
            lastChatSeenTs = Math.max(lastChatSeenTs, newest);
            localStorage.setItem('chatSeenTs', String(lastChatSeenTs));
        } else {
            const newest = messages[messages.length - 1]?.timestamp || 0;
            const newestAuthor = messages[messages.length - 1]?.author || '';
            if (newest > lastChatSeenTs && newestAuthor && newestAuthor !== currentUser) {
                sparkSound('chat');
                const lastMsg = messages[messages.length - 1];
                sendNotification(`💬 ${lastMsg.author}`, lastMsg.text, 'chat-message');
            }
        }

        // Trigger animations for newly received command messages (both users see them)
        const XP_VISUAL_CMDS = new Set([
            'sparkle', 'glow', 'pulse', 'tint', 'warm',
        ]);
        const newAnimCmds = messages.filter(m =>
            m.kind === 'system' &&
            m.systemType === 'command' &&
            m.timestamp > _lastAnimationTs &&
            (m.command === 'flurry' || m.command === 'dance' ||
             m.command === 'hug'    || m.command === 'kiss'  ||
             XP_VISUAL_CMDS.has(m.command))
        );
        if (newAnimCmds.length > 0) {
            _lastAnimationTs = Math.max(...newAnimCmds.map(c => c.timestamp));
            // Run all new commands (not just the latest) so concurrent effects fire correctly
            for (const cmd of newAnimCmds) {
                if (cmd.command === 'flurry') triggerFlurry();
                else if (cmd.command === 'dance')  triggerDance();
                else if (cmd.command === 'hug')    triggerHugSparkle(cmd.variant);
                else if (cmd.command === 'kiss')   triggerKissSparkle(cmd.variant);
                else if (XP_VISUAL_CMDS.has(cmd.command)) triggerXpCommandEffect(cmd);
            }
        }
        checkGoldenKissSync(messages);

        updateChatUnread(messages);
        if (chatOpen || !document.getElementById('w95-win-chat')?.classList.contains('is-hidden')) {
            const currentLastId = messages[messages.length - 1]?.id || null;
            const isInitialRender = _chatLastRenderedId === null;
            const isNewMessage = !isInitialRender && currentLastId !== _chatLastRenderedId;
            _chatLastRenderedId = currentLastId;
            renderChat(messages, isInitialRender ? 'initial' : (isNewMessage ? 'new' : 'update'));
        }
    });
}

// ---- AUTH STATE OBSERVER ----
// Single entry point for starting/stopping a session. All DB access is gated here.
onAuthStateChanged(auth, (firebaseUser) => {
    if (!firebaseUser) {
        // Signed out — reset and show login
        currentUser = null;
        currentUserUid = null;
        achievementsBackfilled = false;
        localStorage.removeItem('currentUser');
        const lo = document.getElementById('loginOverlay');
        const ad = document.getElementById('accessDeniedOverlay');
        if (lo) lo.style.display = 'flex';
        if (ad) ad.style.display = 'none';
        closeChat(true);
        return;
    }

    const email = firebaseUser.email || '';
    const displayName = ALLOWED_USERS[email];

    if (!displayName) {
        // Authenticated but not on the allowlist
        currentUser = null;
        const lo = document.getElementById('loginOverlay');
        const ad = document.getElementById('accessDeniedOverlay');
        if (lo) lo.style.display = 'none';
        if (ad) ad.style.display = 'flex';
        return;
    }

    // Authorised — start DB listeners (once) then load the feed
    currentUserUid = firebaseUser.uid;
    setupDBListeners();
    login(displayName, email);
});

// Scroll to top button — listens on the feed window body (feed is inside a W95 window)
function getFeedScrollEl() { return document.getElementById('w95-feed-body'); }
function isFeedOpen() {
    const feedWin = document.getElementById('w95-win-feed');
    return feedWin && !feedWin.classList.contains('is-hidden');
}
function updateScrollTopBtn() {
    const feedBody = getFeedScrollEl();
    const scrolled = feedBody ? feedBody.scrollTop > 300 : window.scrollY > 300;
    document.getElementById('scrollTopBtn').classList.toggle('visible', isFeedOpen() && scrolled);
}
(function initFeedScrollListener() {
    const feedBody = getFeedScrollEl();
    if (feedBody) {
        feedBody.addEventListener('scroll', updateScrollTopBtn);
        // Archivist: fire when the user scrolls to (near) the very bottom of the feed
        feedBody.addEventListener('scroll', () => {
            const nearBottom = feedBody.scrollTop + feedBody.clientHeight >= feedBody.scrollHeight - 60;
            if (nearBottom) unlockAchievement('archivist');
        }, { passive: true });
    } else {
        window.addEventListener('scroll', updateScrollTopBtn);
    }
    // Deep Reader: track external link clicks from the feed
    document.addEventListener('click', (e) => {
        const link = e.target.closest('.link-preview');
        if (link && link.tagName === 'A' && link.href) {
            // Only count links in posts authored by the other user
            const postCard = link.closest('.post-card');
            const postId   = postCard?.dataset?.postId;
            const post     = postId ? allPosts[postId] : null;
            if (post && post.author !== currentUser) _trackLinkOpen();
        }
    }, { capture: false });
})();

// ---- KEYBOARD NAVIGATION ----

function isTypingInField() {
    const tag = document.activeElement.tagName;
    return tag === 'TEXTAREA' || tag === 'INPUT' || document.activeElement.isContentEditable;
}

function getVisiblePostCards() {
    return Array.from(document.querySelectorAll('#postsContainer .post-card'));
}

function setFocusedPost(index) {
    const cards = getVisiblePostCards();
    if (!cards.length) return;
    index = Math.max(0, Math.min(index, cards.length - 1));
    cards.forEach(c => c.classList.remove('post-focused'));
    cards[index].classList.add('post-focused');
    cards[index].scrollIntoView({ behavior: 'smooth', block: 'center' });
    focusedPostId = cards[index].dataset.postId;
}

function getCurrentFocusedIndex() {
    if (!focusedPostId) return -1;
    return getVisiblePostCards().findIndex(c => c.dataset.postId === focusedPostId);
}

function closeEverything() {
    // Close managed modals (restores focus via stack)
    [..._modalStack].forEach(({ el }) => closeModal(el));
    // Close non-stack overlays
    const aboutM = document.getElementById('aboutModal');
    if (aboutM?.classList.contains('show')) closeAbout();
    const notifM = document.getElementById('notifPermModal');
    if (notifM?.classList.contains('show')) closeNotifPermModal();
    if (chatOpen) toggleChat();
    closeActivityPanel();
    // Clear focused post highlight
    document.querySelectorAll('.post-focused').forEach(c => c.classList.remove('post-focused'));
    focusedPostId = null;
}

window.openShortcutsModal = function() {
    openModal(document.getElementById('shortcutsModal'));
};
window.closeShortcutsModal = function() {
    closeModal(document.getElementById('shortcutsModal'));
};

document.addEventListener('keydown', e => {
    // Esc always works, even in inputs
    if (e.key === 'Escape') { closeEverything(); return; }

    // Everything else: skip if typing or using modifier keys
    if (isTypingInField() || e.ctrlKey || e.metaKey || e.altKey) return;
    if (!currentUser) return;

    switch (e.key) {
        case 'j': case 'J': {
            e.preventDefault();
            const idx = getCurrentFocusedIndex();
            setFocusedPost(idx < 0 ? 0 : idx + 1);
            break;
        }
        case 'k': case 'K': {
            e.preventDefault();
            const idx = getCurrentFocusedIndex();
            if (idx > 0) setFocusedPost(idx - 1);
            else if (idx < 0) setFocusedPost(0);
            break;
        }
        case 'l': case 'L': {
            // Like / react ❤️ on focused post
            if (!focusedPostId) break;
            const card = document.querySelector(`[data-post-id="${focusedPostId}"]`);
            card?.querySelector('.reaction-btn')?.click(); // first btn is always ❤️
            break;
        }
        case 'f': case 'F': {
            // Favourite / save focused post
            if (focusedPostId) toggleFavorite(focusedPostId);
            break;
        }
        case 'n': case 'N':
            openTypePickerModal();
            break;
        case 'm': case 'M':
            toggleChat();
            break;
        case '/':
            e.preventDefault();
            document.getElementById('searchInput')?.focus();
            break;
        case '?':
            openShortcutsModal();
            break;
    }
});

// Cursor
const cursor = document.getElementById('cursor');
const starChars = ['✦', '✧', '⋆', '✵', '✿', '❋', '✽', '♡', '✨', '⭐', '🌸', '💫', '🌟', '✶'];
const trailColors = ['#f9a8d4', '#e879f9', '#c084fc', '#a78bfa', '#fbcfe8', '#fde68a', '#fff', '#f0abfc'];
let trailCounter = 0;

document.addEventListener('mousemove', (e) => {
    cursor.style.left = e.clientX + 'px';
    cursor.style.top = e.clientY + 'px';
    trailCounter++;
    if (trailCounter % 2 === 0 && !prefersReducedMotion()) createStarTrail(e.clientX, e.clientY);
});

function createStarTrail(x, y) {
    const trail = document.createElement('div');
    trail.className = 'star-trail';
    trail.textContent = starChars[Math.floor(Math.random() * starChars.length)];
    const size = Math.random() * 10 + 10;
    trail.style.fontSize = size + 'px';
    trail.style.left = (x - size / 2 + (Math.random() - 0.5) * 12) + 'px';
    trail.style.top  = (y - size / 2 + (Math.random() - 0.5) * 12) + 'px';
    trail.style.color = trailColors[Math.floor(Math.random() * trailColors.length)];
    document.body.appendChild(trail);
    setTimeout(() => trail.remove(), 1400);
}

function createParticles() {
    if (prefersReducedMotion()) return;
    const purpleEmojis = ['💜', '✨', '💫', '⭐', '🌟', '✦', '🔮', '🪻'];
    for (let i = 0; i < 65; i++) {
        const particle = document.createElement('div');
        particle.className = 'particle';
        particle.textContent = purpleEmojis[Math.floor(Math.random() * purpleEmojis.length)];
        particle.style.left = Math.random() * 100 + '%';
        particle.style.top = Math.random() * 100 + '%';
        particle.style.fontSize = (Math.random() * 10 + 10) + 'px';
        particle.style.animationDelay = (Math.random() * 10) + 's';
        particle.style.animationDuration = (Math.random() * 28 + 26) + 's';
        document.body.appendChild(particle);
    }
}
createParticles();

// Dark mode
window.toggleDarkMode = function() {
    isDarkMode = !isDarkMode;
    document.body.classList.toggle('dark-mode');
    const darkModeIcon = document.getElementById('darkModeIcon');
    if (darkModeIcon) darkModeIcon.textContent = isDarkMode ? '☼' : '☾';
    localStorage.setItem('darkMode', isDarkMode);
};

if (localStorage.getItem('darkMode') === 'true') {
    toggleDarkMode();
}

// ---- Sun-based theme mode ----
let isSunMode = false;
let _sunModeInterval = null;
let _sunModeGeoCoords = null;

// CSS variable values for light and dark endpoints
const _SUN_VARS_LIGHT = {
    '--bg-gradient-start': '#006868',
    '--bg-gradient-mid1':  '#008080',
    '--bg-gradient-mid2':  '#009898',
    '--bg-gradient-end':   '#006060',
    '--card-bg':           'rgba(240,255,255,0.94)',
    '--card-border':       'rgba(0,160,160,0.22)',
    '--section-bg':        'rgba(200,240,240,0.55)',
    '--text-primary':      'rgba(30,27,75,1)',
    '--text-secondary':    'rgba(107,114,128,1)',
    '--input-bg':          'rgba(255,255,255,1)',
    '--input-border':      'rgba(0,180,180,0.35)',
};
const _SUN_VARS_DARK = {
    '--bg-gradient-start': '#001a1a',
    '--bg-gradient-mid1':  '#0a2a2a',
    '--bg-gradient-mid2':  '#0d3535',
    '--bg-gradient-end':   '#001a1a',
    '--card-bg':           'rgba(8,30,30,0.97)',
    '--card-border':       'rgba(0,180,180,0.35)',
    '--section-bg':        'rgba(0,50,50,0.6)',
    '--text-primary':      'rgba(224,250,250,1)',
    '--text-secondary':    'rgba(122,186,186,1)',
    '--input-bg':          'rgba(0,40,40,0.9)',
    '--input-border':      'rgba(0,180,180,0.4)',
};

function _parseRgba(c) {
    if (c && c[0] === '#') {
        const h = c.slice(1);
        return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16), 1];
    }
    const m = c && c.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/);
    return m ? [+m[1],+m[2],+m[3], m[4]!==undefined?+m[4]:1] : [0,0,0,1];
}

function _lerpColor(a, b, t) {
    const ca = _parseRgba(a), cb = _parseRgba(b);
    const r  = Math.round(ca[0]+(cb[0]-ca[0])*t);
    const g  = Math.round(ca[1]+(cb[1]-ca[1])*t);
    const bl = Math.round(ca[2]+(cb[2]-ca[2])*t);
    const al = +(ca[3]+(cb[3]-ca[3])*t).toFixed(3);
    return `rgba(${r},${g},${bl},${al})`;
}

// Calculates sunrise and sunset times for today at the given coordinates.
// Returns { sunrise: Date, sunset: Date } or null for polar regions.
function _calcSunTimes(lat, lon) {
    const now = new Date();
    const dayOfYear = Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 86400000);
    const lat_r = lat * Math.PI / 180;
    const decl  = -23.45 * Math.cos(2 * Math.PI / 365 * (dayOfYear + 10)) * Math.PI / 180;
    const cosHA = (Math.cos(90.833 * Math.PI / 180) - Math.sin(lat_r) * Math.sin(decl))
                / (Math.cos(lat_r) * Math.cos(decl));
    if (cosHA < -1 || cosHA > 1) return null; // polar day or night
    const ha  = Math.acos(cosHA) * 180 / Math.PI;
    const B   = 2 * Math.PI / 365 * (dayOfYear - 81);
    const eot = 9.87 * Math.sin(2*B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B); // equation of time (minutes)
    const solarNoonUTC = 720 - 4 * lon - eot;
    const tzOffset     = -now.getTimezoneOffset(); // minutes east of UTC
    const srMin = solarNoonUTC - 4 * ha + tzOffset;
    const ssMin = solarNoonUTC + 4 * ha + tzOffset;
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return {
        sunrise: new Date(today.getTime() + srMin * 60000),
        sunset:  new Date(today.getTime() + ssMin * 60000),
    };
}

// Returns a blend factor t where 0 = full day (light) and 1 = full night (dark).
// Transitions are smoothed over ±60 min around sunrise and sunset.
function _getSunBlend(lat, lon) {
    const times = _calcSunTimes(lat, lon);
    if (!times) return null;
    const { sunrise, sunset } = times;
    const now = Date.now();
    const sr  = sunrise.getTime();
    const ss  = sunset.getTime();
    const WIN = 60 * 60 * 1000; // 60-minute transition window (each side)
    const smoothstep = t => t * t * (3 - 2 * t);
    if (now < sr - WIN) return 1;
    if (now < sr + WIN) return 1 - smoothstep((now - (sr - WIN)) / (2 * WIN));
    if (now < ss - WIN) return 0;
    if (now < ss + WIN) return smoothstep((now - (ss - WIN)) / (2 * WIN));
    return 1;
}

function _applySunBlend(t) {
    // Interpolate all CSS variables directly on the body element
    for (const [v, lightVal] of Object.entries(_SUN_VARS_LIGHT)) {
        document.body.style.setProperty(v, _lerpColor(lightVal, _SUN_VARS_DARK[v], t));
    }
    // Toggle dark-mode class for the star/twinkling effect when it's mostly night
    const wantDark = t > 0.5;
    if (wantDark !== isDarkMode) {
        isDarkMode = wantDark;
        document.body.classList.toggle('dark-mode', wantDark);
        const icon = document.getElementById('darkModeIcon');
        if (icon) icon.textContent = wantDark ? '☼' : '☾';
    }
}

function _updateSunTheme() {
    if (!_sunModeGeoCoords) return;
    const t = _getSunBlend(_sunModeGeoCoords.lat, _sunModeGeoCoords.lon);
    if (t !== null) _applySunBlend(t);
}

function startSunMode(lat, lon) {
    _sunModeGeoCoords = { lat, lon };
    localStorage.setItem('sunModeCoords', JSON.stringify({ lat, lon }));
    isSunMode = true;
    localStorage.setItem('sunMode', 'true');
    _updateSunTheme();
    if (!_sunModeInterval) {
        _sunModeInterval = setInterval(_updateSunTheme, 60000);
    }
}

function stopSunMode() {
    isSunMode = false;
    localStorage.setItem('sunMode', 'false');
    if (_sunModeInterval) {
        clearInterval(_sunModeInterval);
        _sunModeInterval = null;
    }
    // Remove inline CSS variable overrides so the normal dark/light classes take over
    for (const v of Object.keys(_SUN_VARS_LIGHT)) {
        document.body.style.removeProperty(v);
    }
}

function enableSunMode() {
    const stored   = localStorage.getItem('sunModeCoords');
    const fallback = { lat: 51.5, lon: -0.12 }; // London fallback
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            pos => startSunMode(pos.coords.latitude, pos.coords.longitude),
            ()  => startSunMode(...(stored ? Object.values(JSON.parse(stored)) : [fallback.lat, fallback.lon])),
            { timeout: 5000 }
        );
    } else {
        const c = stored ? JSON.parse(stored) : fallback;
        startSunMode(c.lat, c.lon);
    }
}

// Restore sun mode on startup
if (localStorage.getItem('sunMode') === 'true') {
    const stored = localStorage.getItem('sunModeCoords');
    if (stored) {
        const c = JSON.parse(stored);
        startSunMode(c.lat, c.lon);
    } else {
        enableSunMode();
    }
}

// Apply any stored desktop theme on startup
{
    const _storedTheme = localStorage.getItem('activeDesktopTheme') || '';
    if (_storedTheme) document.body.setAttribute('data-theme', _storedTheme);
}

// ---- MODALS ----


window.openEditPost = function(postId) {
    const post = allPosts[postId];
    if (!post || post.author !== currentUser) return;
    if (post.type === 'text') {
        resetAddPostModal();
        _editingTextPostId = postId;
        switchPostMode('text');
        document.getElementById('postHeading').value = post.heading || '';
        document.getElementById('postBody').value = post.body || '';
        const collArr = post.collections?.length ? post.collections : post.collection ? [post.collection] : [];
        collArr.forEach(c => {
            const btn = document.querySelector(`#collectionPicker .coll-pick-btn[data-val="${c}"]`);
            if (btn) btn.classList.add('selected');
        });
        document.getElementById('addPostModalHeading').textContent = 'Edit Post';
        document.getElementById('addPostBtn').textContent = 'Save Changes';
        openModal(document.getElementById('addPostModal'));
    } else {
        openEditModal('Edit note', post.note || '', { type: 'post', postId });
    }
};

window.openEditComment = function(postId, replyId) {
    const post = allPosts[postId];
    if (!post) return;
    const reply = (post.replies || []).find(r => r.id === replyId);
    if (!reply || reply.author !== currentUser) return;
    openEditModal('Edit comment', reply.text || '', { type: 'reply', postId, replyId });
};

// Normalises editHistory to [{ts, note}] regardless of whether the stored
// value uses the old {originalTs, originalNote} object or the new array form.
function normalizeHistory(obj) {
    const h = obj.editHistory;
    if (!h) return [];
    if (Array.isArray(h)) return h;
    return [{ ts: h.originalTs, note: h.originalNote || '' }];
}

window.openHistory = function(payloadJson) {
    const entries = JSON.parse(payloadJson || '[]');
    const list = document.getElementById('historyEntriesList');
    list.innerHTML = entries.map((e, i) => `
        <div class="history-entry">
            <div class="history-entry-label">${i === 0 ? 'Original' : `Edit ${i}`} &middot; ${exactTimestamp(e.ts)}</div>
            <div class="history-entry-text">${safeText(e.note || '')}</div>
        </div>
    `).join('');
    openModal(document.getElementById('historyModal'));
};

window.closeHistoryModal = function() {
    closeModal(document.getElementById('historyModal'));
};

window.openAddPostModal = function() {
    resetAddPostModal();
    openModal(document.getElementById('addPostModal'));
};
window.openTextPostModal = function() {
    resetAddPostModal();
    switchPostMode('text');
    document.getElementById('addPostModalHeading').textContent = 'Write a Post';
    openModal(document.getElementById('addPostModal'));
};
window.closeAddPostModal = function() {
    closeModal(document.getElementById('addPostModal'));
    resetAddPostModal();
};

window.openTypePickerModal = function() {
    openModal(document.getElementById('typePickerModal'));
};
window.closeTypePickerModal = function() {
    closeModal(document.getElementById('typePickerModal'));
};
window.openPollModal = function() {
    const dt = new Date(Date.now() + 86400000);
    const local = new Date(dt.getTime() - dt.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    document.getElementById('pollEndsAt').value = local;
    openModal(document.getElementById('pollModal'));
};
window.closePollModal = function() {
    closeModal(document.getElementById('pollModal'));
};
window.openImageModal = function() {
    const errEl = document.getElementById('imageUploadError');
    if (errEl) errEl.textContent = '';
    openModal(document.getElementById('imageModal'));
};
window.closeImageModal = function() {
    closeModal(document.getElementById('imageModal'));
    document.getElementById('imagePreview').innerHTML = '';
    document.getElementById('imageFile').value = '';
    const errEl = document.getElementById('imageUploadError');
    if (errEl) errEl.textContent = '';
};
window.openMovieModal = function() {
    openModal(document.getElementById('movieModal'));
};
window.closeMovieModal = function() {
    closeModal(document.getElementById('movieModal'));
};

window.openCollectionsModal = function() {
    openModal(document.getElementById('collectionsModal'));
};
window.closeCollectionsModal = function() {
    closeModal(document.getElementById('collectionsModal'));
};

window.openSourcesModal = function() {
    openModal(document.getElementById('sourcesModal'));
};
window.closeSourcesModal = function() {
    closeModal(document.getElementById('sourcesModal'));
};

// Edit/Delete modal controls
window.openEditModal = function(label, initialValue, target) {
    editTarget = target;
    document.getElementById('editLabel').textContent = label;
    document.getElementById('editTextarea').value = initialValue || '';
    openModal(document.getElementById('editModal'));
};

window.closeEditModal = function() {
    editTarget = null;
    closeModal(document.getElementById('editModal'));
};

window.openDeleteModal = function(target) {
    deleteTarget = target;
    openModal(document.getElementById('deleteModal'));
};

window.closeDeleteModal = function() {
    deleteTarget = null;
    closeModal(document.getElementById('deleteModal'));
};

function collectReplyDescendants(replies, rootId) {
    const children = replies.filter(r => r.replyToId === rootId).map(r => r.id);
    let all = [...children];
    for (const cid of children) all = all.concat(collectReplyDescendants(replies, cid));
    return all;
}

window.saveEdit = async function() {
    if (!editTarget) return;
    const val = document.getElementById('editTextarea').value.trim();
    const now = Date.now();

    if (editTarget.type === 'post') {
        const post = allPosts[editTarget.postId];
        if (!post) return;
        const updateData = {
            note: val,
            editedAt: now,
            // Append the current (pre-save) version so every revision is kept
            editHistory: [...normalizeHistory(post), { ts: post.editedAt || post.timestamp || now, note: post.note || '' }]
        };
        await update(ref(database, `posts/${editTarget.postId}`), updateData);
        showToast('Post updated');
    } else {
        const post = allPosts[editTarget.postId];
        if (!post) return;

        const replies = (post.replies || []).map(r => {
            if (r.id !== editTarget.replyId) return r;
            return {
                ...r,
                text: val,
                editedAt: now,
                editHistory: [...normalizeHistory(r), { ts: r.editedAt || r.timestamp || now, note: r.text || '' }]
            };
        });

        await update(ref(database, `posts/${editTarget.postId}`), { replies });
        showToast('Comment updated');
    }

    closeEditModal();
};

window.confirmDelete = async function() {
    if (!deleteTarget) return;

    if (deleteTarget.type === 'board') {
        const boardId = deleteTarget.boardId;
        const board = allBoards[boardId];
        const itemsSnap = await get(ref(database, `board_items/${boardId}`));
        const boardItems = itemsSnap.val() || {};
        await set(ref(database, `recycleBin/b_${boardId}`), {
            id: boardId,
            type: 'board',
            board: board,
            boardItems: boardItems,
            deletedAt: Date.now(),
        });
        await remove(ref(database, `board_items/${boardId}`));
        await remove(ref(database, `boards/${boardId}`));
        closeBoardDetail();
        showToast('Board moved to Recycle Bin');
    } else if (deleteTarget.type === 'post') {
        const postToTrash = allPosts[deleteTarget.postId];
        if (postToTrash) {
            await set(ref(database, `recycleBin/${deleteTarget.postId}`), {
                id: deleteTarget.postId,
                post: postToTrash,
                deletedAt: Date.now(),
            });
            await remove(ref(database, `posts/${deleteTarget.postId}`));
        }
        showToast('Post moved to Recycle Bin');
    } else {
        const post = allPosts[deleteTarget.postId];
        if (!post) return;

        const replies = post.replies || [];
        const toRemove = new Set([deleteTarget.replyId, ...collectReplyDescendants(replies, deleteTarget.replyId)]);
        const removedReplies = replies.filter(r => toRemove.has(r.id));
        const nextReplies = replies.filter(r => !toRemove.has(r.id));

        await set(ref(database, `recycleBin/c_${deleteTarget.replyId}`), {
            id: deleteTarget.replyId,
            type: 'comment',
            postId: deleteTarget.postId,
            replies: removedReplies,
            deletedAt: Date.now(),
        });
        await update(ref(database, `posts/${deleteTarget.postId}`), { replies: nextReplies });
        showToast('Comment moved to Recycle Bin');
    }

    closeDeleteModal();
};

// ---- FILTERS ----
window.resetToAll = function() {
    currentCollection = null;
    currentSource     = null;
    searchQuery       = '';
    const inp = document.getElementById('searchInput');
    if (inp) inp.value = '';
    document.getElementById('searchClear')?.classList.add('hidden');
    showSection('feed');
    setFilter('all');
};

window.setFilter = function(filter) {
    currentFilter = filter;

    document.getElementById('btnAll').className        = 'filter-btn' + (filter === 'all'          ? ' active' : '');
    document.getElementById('btnNew').className        = 'filter-btn' + (filter === 'new'          ? ' active' : '');
    document.getElementById('btnSeen').className       = 'filter-btn' + (filter === 'seen'         ? ' active' : '');
    document.getElementById('btnFav').className        = 'filter-btn' + (filter === 'fav'          ? ' active' : '');
    document.getElementById('btnWatchLater').className = 'filter-btn' + (filter === 'watch-later'  ? ' active' : '');
    document.getElementById('btnOtherUser').className  = 'filter-btn' + (filter === 'just-other'   ? ' active' : '');
    document.getElementById('btnArchived').className   = 'filter-btn' + (filter === 'archived'     ? ' active' : '');

    updateNewCount();
    loadPosts();
};

window.setSearch = function(val) {
    searchQuery = val.toLowerCase();
    document.getElementById('searchClear').classList.toggle('hidden', !searchQuery);
    loadPosts();
};

window.clearSearch = function() {
    searchQuery = '';
    document.getElementById('searchInput').value = '';
    document.getElementById('searchClear').classList.add('hidden');
    loadPosts();
};

window.toggleFavorite = async function(postId) {
    const post = allPosts[postId];
    if (!post) return;
    const favBy = { ...(post.favoritedBy || {}) };
    if (favBy[currentUser]) {
        delete favBy[currentUser];
    } else {
        favBy[currentUser] = true;
    }
    await update(ref(database, `posts/${postId}`), { favoritedBy: favBy });
};

window.toggleWatchLater = async function(postId) {
    const post = allPosts[postId];
    if (!post) return;
    const wlBy = { ...(post.watchLaterBy || {}) };
    if (wlBy[currentUser]) {
        delete wlBy[currentUser];
        showToast('Removed from Watch Later');
    } else {
        wlBy[currentUser] = Date.now();
        showToast('Added to Watch Later 🕐');
    }
    await update(ref(database, `posts/${postId}`), { watchLaterBy: wlBy });
};

window.filterByCollection = function(collection) {
    currentCollection = collection;
    closeCollectionsModal();
    updateActiveFiltersBanner();
    updateNewCount();
    loadPosts();
    showToast(collection ? `Showing: ${COLLECTION_LABELS[collection] || collection}` : 'Showing all collections');
};

window.filterBySource = function(source) {
    currentSource = source;
    closeSourcesModal();
    updateActiveFiltersBanner();
    updateNewCount();
    loadPosts();
    showToast(source ? `Source: ${SOURCE_LABELS[source] || source}` : 'All sources');
};

// ---- NOTIFICATIONS ----
function notifSupported() { return 'Notification' in window; }
function notifActive() { return notificationsEnabled && notifSupported() && Notification.permission === 'granted'; }

function sendNotification(title, body, tag) {
    if (!notifActive()) return;
    if (document.hasFocus()) return;
    new Notification(title, { body, tag });
}

function updateNotifBtn() {
    const btn = document.getElementById('notifBtn');
    if (!btn) return;
    const on = notifActive();
    btn.textContent = on ? '[!]' : '[!]';
    btn.title = on ? 'Desktop notifications on — click to turn off' : 'Click to enable desktop notifications';
    btn.classList.toggle('notif-active', on);
}

// Called once the user clicks "Allow" in our custom modal
window.doRequestNotifPermission = function() {
    closeNotifPermModal();
    // Cross-browser: requestPermission() returns a Promise in modern browsers
    // but undefined in old Safari — handle both.
    function handlePerm(perm) {
        if (perm === 'granted') {
            notificationsEnabled = true;
            localStorage.setItem('notificationsEnabled', 'true');
            updateNotifBtn();
            new Notification('Notifications enabled 💜', { body: "You'll be notified about new posts and messages." });
        } else if (perm === 'denied' || Notification.permission === 'denied') {
            showToast('Notifications blocked in your browser. Open Site Settings and allow notifications for this page, then try again.');
        } else {
            showToast('Permission not granted — please click "Allow" when the browser asks.');
        }
    }
    const result = Notification.requestPermission();
    if (result && typeof result.then === 'function') {
        result.then(handlePerm);
    } else {
        // Legacy callback-only browsers (old Safari)
        Notification.requestPermission(handlePerm);
    }
};

window.closeNotifPermModal = function() {
    document.getElementById('notifPermModal').classList.remove('show');
};

window.toggleNotifications = function() {
    if (!notifSupported()) {
        showToast('Notifications not supported in this browser');
        return;
    }
    if (notifActive()) {
        notificationsEnabled = false;
        localStorage.setItem('notificationsEnabled', 'false');
        updateNotifBtn();
        showToast('Desktop notifications turned off');
        return;
    }
    if (Notification.permission === 'denied') {
        showToast('Notifications blocked — open Site Settings in your browser and allow notifications for this page.');
        return;
    }
    // Show our custom explanation modal before triggering the browser prompt
    document.getElementById('notifPermModal').classList.add('show');
};

// Sync stored preference with actual browser permission on load
if (notificationsEnabled && notifSupported() && Notification.permission !== 'granted') {
    notificationsEnabled = false;
    localStorage.setItem('notificationsEnabled', 'false');
}
setTimeout(updateNotifBtn, 0);

// ---- IN-APP NOTIFICATION SYSTEM ----
// Stores recent notifications in memory (persisted to localStorage for the session)
let _inAppNotifs = (() => {
    try { return JSON.parse(localStorage.getItem('inAppNotifs') || '[]'); } catch { return []; }
})();
let _notifPopupTimer = null;

function _saveInAppNotifs() {
    // Keep only the 30 most recent
    _inAppNotifs = _inAppNotifs.slice(0, 30);
    try { localStorage.setItem('inAppNotifs', JSON.stringify(_inAppNotifs)); } catch {}
}

function _getNotifSnippet(post) {
    if (post.type === 'text') return post.heading || post.body || 'Text post';
    if (post.type === 'poll') return post.question || 'New poll';
    if (post.type === 'recommendation') return post.title || 'New recommendation';
    if (post.type === 'image') return 'Shared a photo';
    return post.note || post.url || 'New post';
}

function addInAppNotification({ postId, post }) {
    const notif = {
        id: postId,
        type: 'post',
        author: post.author || 'Someone',
        snippet: _getNotifSnippet(post),
        timestamp: Date.now(),
        read: false,
    };
    _inAppNotifs.unshift(notif);
    _saveInAppNotifs();
    _updateBellBadge();
    _renderNotifPanel();
    _showNotifPopup(notif);
}

function addAchievementNotification(achievement, xpGain) {
    const notif = {
        id: 'ach_' + achievement.id + '_' + Date.now(),
        type: 'achievement',
        title: achievement.title,
        icon: achievement.icon,
        xp: xpGain,
        tier: achievement.tier || 'bronze',
        timestamp: Date.now(),
        read: false,
    };
    _inAppNotifs.unshift(notif);
    _saveInAppNotifs();
    _updateBellBadge();
    _renderNotifPanel();
}

function addCommandUnlockNotification(cmds) {
    const notif = {
        id: 'cmd_' + Date.now(),
        type: 'command',
        commands: cmds.map(c => ({ name: c.name, description: c.description })),
        timestamp: Date.now(),
        read: false,
    };
    _inAppNotifs.unshift(notif);
    _saveInAppNotifs();
    _updateBellBadge();
    _renderNotifPanel();
}

function addRewardCommandNotification(reward) {
    const notif = {
        id: 'rwdcmd_' + reward.id + '_' + Date.now(),
        type: 'command',
        commands: [{ name: reward.name.replace(/^\//, ''), description: reward.description || 'Console command unlocked' }],
        timestamp: Date.now(),
        read: false,
    };
    _inAppNotifs.unshift(notif);
    _saveInAppNotifs();
    _updateBellBadge();
    _renderNotifPanel();
}

function _updateBellBadge() {
    const badge = document.getElementById('notifBadge');
    const bell = document.getElementById('tray-bell');
    if (!badge) return;
    const unread = _inAppNotifs.filter(n => !n.read).length;
    badge.textContent = unread > 9 ? '9+' : String(unread);
    badge.classList.toggle('hidden', unread === 0);
    bell?.classList.toggle('bell-has-notif', unread > 0);
}

function _markAllNotifsRead() {
    _inAppNotifs.forEach(n => { n.read = true; });
    _saveInAppNotifs();
    _updateBellBadge();
    _renderNotifPanel();
}

function _renderNotifPanel() {
    const list = document.getElementById('notifPanelList');
    if (!list) return;
    if (_inAppNotifs.length === 0) {
        list.innerHTML = '<div class="notif-panel-empty">No notifications yet.</div>';
        return;
    }
    const SIX_HOURS = 6 * 60 * 60 * 1000;
    const now = Date.now();
    list.innerHTML = _inAppNotifs.map(n => {
        const ago = timeAgo(n.timestamp);
        const isAged = (n.type === 'achievement' || n.type === 'command') && (now - n.timestamp) > SIX_HOURS;
        const agedClass = isAged ? ' notif-aged' : '';
        const readClass = n.read ? ' notif-read' : '';

        if (n.type === 'achievement') {
            const tierClass = `notif-tier-${n.tier || 'bronze'}`;
            return `<div class="notif-panel-item notif-achievement${readClass}${agedClass}">
                <div class="notif-item-author"><span class="notif-ach-icon">${safeText(n.icon)}</span> ${safeText(n.title)}</div>
                <div class="notif-item-snippet">Achievement unlocked${n.xp ? ` · +${n.xp} XP` : ''} <span class="notif-tier-badge ${tierClass}">${n.tier || 'bronze'}</span></div>
                <div class="notif-item-time">${safeText(ago)}</div>
            </div>`;
        }

        if (n.type === 'command') {
            const cmdList = (n.commands || []).map(c => `/${c.name}`).join(', ');
            const firstDesc = n.commands?.[0]?.description || '';
            return `<div class="notif-panel-item notif-command${readClass}${agedClass}">
                <div class="notif-item-author">🔓 Command${(n.commands?.length || 0) > 1 ? 's' : ''} Unlocked</div>
                <div class="notif-item-snippet"><strong>${safeText(cmdList)}</strong>${firstDesc ? ` — ${safeText(firstDesc)}` : ''}</div>
                <div class="notif-item-time">${safeText(ago)}</div>
            </div>`;
        }

        return `<div class="notif-panel-item${readClass}" onclick="openPostFromNotif('${n.id}')">
            <div class="notif-item-author">${safeText(n.author)}</div>
            <div class="notif-item-snippet">${safeText(n.snippet)}</div>
            <div class="notif-item-time">${safeText(ago)}</div>
        </div>`;
    }).join('');
}

function _showNotifPopup(notif) {
    // Remove any existing popup
    const existing = document.getElementById('post-notif-popup');
    if (existing) existing.remove();
    if (_notifPopupTimer) clearTimeout(_notifPopupTimer);

    const popup = document.createElement('div');
    popup.id = 'post-notif-popup';
    popup.className = 'post-notif-popup';
    popup.innerHTML = `
        <div class="notif-popup-header">
            <span class="notif-popup-icon">🔔</span>
            <span class="notif-popup-author">${safeText(notif.author)}</span>
            <button class="notif-popup-close" onclick="document.getElementById('post-notif-popup')?.remove()">✕</button>
        </div>
        <div class="notif-popup-snippet">${safeText(notif.snippet)}</div>
        <button class="notif-popup-open" onclick="openPostFromNotif('${notif.id}');document.getElementById('post-notif-popup')?.remove()">Open post →</button>
    `;
    document.body.appendChild(popup);
    // Trigger animation after paint
    requestAnimationFrame(() => { requestAnimationFrame(() => { popup.classList.add('notif-popup-visible'); }); });

    _notifPopupTimer = setTimeout(() => {
        popup.classList.remove('notif-popup-visible');
        setTimeout(() => popup.remove(), 350);
    }, 6000);
}

window.openPostFromNotif = function(postId) {
    // Mark this notification as read
    const notif = _inAppNotifs.find(n => n.id === postId);
    if (notif) { notif.read = true; _saveInAppNotifs(); _updateBellBadge(); _renderNotifPanel(); }
    closeNotifPanel();
    openPostWindow(postId);
};

function toggleNotifPanel() {
    const panel = document.getElementById('notif-panel');
    if (!panel) return;
    const isOpen = !panel.classList.contains('is-hidden');
    if (isOpen) {
        closeNotifPanel();
    } else {
        // Ensure notification panel appears above all open windows
        panel.style.zIndex = (w95TopZ + 1);
        panel.classList.remove('is-hidden');
        _markAllNotifsRead();
        _renderNotifPanel();
    }
}

function closeNotifPanel() {
    document.getElementById('notif-panel')?.classList.add('is-hidden');
}

// Initial bell state (will be properly set up in STATIC HTML EVENT WIRING section below)
setTimeout(() => { _updateBellBadge(); _renderNotifPanel(); }, 0);

// ---- DATA ----
// (onValue listeners are registered in setupDBListeners(), called after auth)

function updateNewCount() {
    const newPosts = Object.values(allPosts).filter(p => !isRead(p)).length;
    const badge = document.getElementById('newCount');
    const markAllBtn = document.getElementById('btnMarkAll');

    if (newPosts > 0) {
        badge.textContent = newPosts;
        badge.classList.remove('hidden');
        if (currentFilter === 'new' && !currentCollection && !currentSource) markAllBtn.classList.remove('hidden');
    } else {
        badge.classList.add('hidden');
        markAllBtn.classList.add('hidden');
    }
}

window.markAllSeen = async function() {
    const updatesObj = {};
    Object.entries(allPosts).forEach(([id, post]) => {
        if (!isRead(post)) updatesObj[`posts/${id}/readBy/${currentUser}`] = true;
    });
    await update(ref(database), updatesObj);
    showToast('All posts marked as seen');
};

window.toggleCollPick = function(btn) {
    btn.classList.toggle('selected');
};

function getSelectedCollections() {
    return [...document.querySelectorAll('#collectionPicker .coll-pick-btn.selected')]
        .map(b => b.dataset.val);
}

let _editingTextPostId = null;

window.switchPostMode = function(mode) {
    const isText = mode === 'text';
    document.getElementById('linkFields').classList.toggle('hidden', isText);
    document.getElementById('textFields').classList.toggle('hidden', !isText);
    document.getElementById('linkTip')?.classList.toggle('hidden', isText);
};

function resetAddPostModal() {
    _editingTextPostId = null;
    document.getElementById('postUrl').value = '';
    document.getElementById('postNote').value = '';
    document.getElementById('postHeading').value = '';
    document.getElementById('postBody').value = '';
    document.querySelectorAll('#collectionPicker .coll-pick-btn').forEach(b => b.classList.remove('selected'));
    const capsuleToggle = document.getElementById('timeCapsuleToggle');
    const capsulePicker = document.getElementById('timeCapsulePicker');
    if (capsuleToggle) { capsuleToggle.checked = false; capsulePicker.classList.add('hidden'); capsulePicker.value = ''; }
    switchPostMode('link');
    document.getElementById('addPostModalHeading').textContent = 'Add a Post';
    document.getElementById('addPostBtn').textContent = 'Add to Feed';
}

window.addPost = async function() {
    const isText = !document.getElementById('textFields').classList.contains('hidden');
    const author = currentUser;
    const collections = getSelectedCollections();
    const capsuleToggle = document.getElementById('timeCapsuleToggle');
    const capsulePicker = document.getElementById('timeCapsulePicker');
    const unlockAt = capsuleToggle?.checked && capsulePicker?.value
        ? new Date(capsulePicker.value).getTime() : null;

    if (isText) {
        const body = document.getElementById('postBody').value.trim();
        const heading = document.getElementById('postHeading').value.trim();
        if (!body) { showToast('Please enter some text'); return; }
        if (!throttle('add-post', 2000)) return;
        try {
            if (_editingTextPostId) {
                const existing = allPosts[_editingTextPostId];
                if (!existing) return;
                const updateData = {
                    body, heading: heading || null,
                    collections,
                    editedAt: Date.now(),
                    editHistory: [...normalizeHistory(existing), { ts: existing.editedAt || existing.timestamp || Date.now(), note: existing.body || '' }]
                };
                await update(ref(database, `posts/${_editingTextPostId}`), updateData);
                showToast('Post updated');
            } else {
                const postData = {
                    type: 'text', body, author, collections,
                    timestamp: Date.now(),
                    readBy: { [author]: true },
                    reactionsBy: {},
                    replies: []
                };
                if (heading) postData.heading = heading;
                if (unlockAt) postData.unlockAt = unlockAt;
                await push(postsRef, postData);
                afterPostCreated('text');
                showToast('Post added');
                sparkSound('post');
            }
            resetAddPostModal();
            closeAddPostModal();
        } catch {
            showToast('Failed to save post. Check your internet connection.');
        }
    } else {
        const url = document.getElementById('postUrl').value.trim();
        const note = document.getElementById('postNote').value.trim();
        if (!url) { showToast('Please enter a URL'); return; }
        try { const u = new URL(url); if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error(); }
        catch { showToast('Please enter a valid URL (starting with https://)'); return; }
        if (!throttle('add-post', 2000)) return;
        const source = detectSource(url);
        try {
            const postData = {
                url, note, author, collections, source,
                timestamp: Date.now(),
                readBy: { [author]: true },
                reactionsBy: {},
                replies: []
            };
            if (unlockAt) postData.unlockAt = unlockAt;
            await push(postsRef, postData);
            afterPostCreated('link');
            resetAddPostModal();
            closeAddPostModal();
            showToast('Post added');
            sparkSound('post');
        } catch {
            showToast('Failed to add post. Check your internet connection.');
        }
    }
};

window.addPoll = async function() {
    const question = document.getElementById('pollQuestion').value.trim();
    const options = ['pollOpt0','pollOpt1','pollOpt2','pollOpt3']
        .map(id => document.getElementById(id).value.trim()).filter(Boolean);
    const endsAtValue = document.getElementById('pollEndsAt').value;
    const endsAt = endsAtValue ? new Date(endsAtValue).getTime() : null;

    if (!question) { showToast('Please enter a question'); return; }
    if (options.length < 2) { showToast('Please enter at least 2 options'); return; }
    if (!throttle('add-poll', 2000)) return;

    try {
        await push(postsRef, {
            type: 'poll', question, options, endsAt, votes: {},
            author: currentUser, collections: [],
            timestamp: Date.now(), readBy: { [currentUser]: true },
            reactionsBy: {}, replies: []
        });
        afterPostCreated('poll');
        ['pollQuestion','pollOpt0','pollOpt1','pollOpt2','pollOpt3'].forEach(id => {
            const el = document.getElementById(id); if (el) el.value = '';
        });
        closePollModal();
        showToast('Poll created!');
        sparkSound('post');
    } catch { showToast('Failed to create poll.'); }
};

window.castVote = async function(postId, optionIndex) {
    if (!currentUser) return;
    const post = allPosts[postId];
    if (!post) return;
    if (post.endsAt && Date.now() > post.endsAt) { showToast('This poll has ended'); return; }
    await update(ref(database, `posts/${postId}/votes`), { [currentUser]: optionIndex });
};

// Compress an image File to a JPEG data-URL (max 900px on longest side).
// Stores the result directly in RTDB — no Firebase Storage needed.
function compressImage(file) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const objectUrl = URL.createObjectURL(file);
        img.onload = () => {
            URL.revokeObjectURL(objectUrl);
            const MAX = 1920;
            let w = img.naturalWidth, h = img.naturalHeight;
            if (w > MAX || h > MAX) {
                if (w >= h) { h = Math.round(h * MAX / w); w = MAX; }
                else        { w = Math.round(w * MAX / h); h = MAX; }
            }
            const canvas = document.createElement('canvas');
            canvas.width = w; canvas.height = h;
            canvas.getContext('2d').drawImage(img, 0, 0, w, h);
            resolve(canvas.toDataURL('image/jpeg', 0.75));
        };
        img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('Could not read image file')); };
        img.src = objectUrl;
    });
}

window.addImagePost = async function() {
    const file = document.getElementById('imageFile').files[0];
    const caption = document.getElementById('imageCaption').value.trim();
    if (!file) { showToast('Please select a photo'); return; }
    if (!throttle('add-image', 3000)) return;

    const btn = document.getElementById('sharePhotoBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Uploading…'; }

    try {
        const imageUrl = await compressImage(file);

        await push(postsRef, {
            type: 'image', imageUrl, note: caption,
            author: currentUser, collections: [],
            timestamp: Date.now(), readBy: { [currentUser]: true },
            reactionsBy: {}, replies: []
        });
        afterPostCreated('image');
        document.getElementById('imageCaption').value = '';
        closeImageModal();
        showToast('Photo shared!');
        sparkSound('post');
    } catch (err) {
        console.error(err);
        const errEl = document.getElementById('imageUploadError');
        if (errEl) errEl.textContent = 'Failed: ' + (err.message || String(err));
        showToast('Photo post failed: ' + (err.message || String(err)));
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Share Photo'; }
    }
};

window.previewImage = function(input) {
    const preview = document.getElementById('imagePreview');
    if (input.files && input.files[0]) {
        const reader = new FileReader();
        reader.onload = e => { preview.innerHTML = `<img src="${e.target.result}" class="image-preview-thumb" alt="preview">`; };
        reader.readAsDataURL(input.files[0]);
    } else {
        preview.innerHTML = '';
    }
};

async function fetchLetterboxdMeta(url) {
    try {
        const res = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(url)}`);
        if (!res.ok) return null;
        const { contents } = await res.json();
        const match = (prop) =>
            contents.match(new RegExp(`<meta[^>]+property="${prop}"[^>]+content="([^"]+)"`))?.[1] ||
            contents.match(new RegExp(`<meta[^>]+content="([^"]+)"[^>]+property="${prop}"`))?.[1] || null;
        return { posterUrl: match('og:image'), description: match('og:description') };
    } catch { return null; }
}

window.addMovieRec = async function() {
    const title = document.getElementById('recTitle').value.trim();
    const mediaType = document.getElementById('recMediaType').value || 'show';
    const streamingService = document.getElementById('recService').value.trim();
    const rating = parseInt(document.getElementById('recRating').value || '0', 10);
    const note = document.getElementById('recNote').value.trim();
    const letterboxdUrl = document.getElementById('recLetterboxd').value.trim();

    if (!title) { showToast('Please enter a title'); return; }
    if (!throttle('add-rec', 2000)) return;

    try {
        let posterUrl = null, letterboxdDescription = null;
        if (letterboxdUrl) {
            const meta = await fetchLetterboxdMeta(letterboxdUrl);
            if (meta) { posterUrl = meta.posterUrl; letterboxdDescription = meta.description; }
        }

        await push(postsRef, {
            type: 'recommendation', title, mediaType, streamingService, rating, note,
            letterboxdUrl: letterboxdUrl || null,
            posterUrl: posterUrl || null,
            letterboxdDescription: letterboxdDescription || null,
            author: currentUser, collections: [],
            timestamp: Date.now(), readBy: { [currentUser]: true },
            reactionsBy: {}, replies: []
        });
        afterPostCreated('recommendation');
        ['recTitle','recService','recNote','recLetterboxd'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
        document.getElementById('recRating').value = '0';
        document.querySelectorAll('#starPicker button').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('#mediaTypePicker .type-toggle-btn').forEach((b,i) => b.classList.toggle('active', i === 0));
        document.getElementById('recMediaType').value = 'movie';
        closeMovieModal();
        showToast('Recommendation added!');
        sparkSound('post');
    } catch { showToast('Failed to add recommendation.'); }
};

window.setRating = function(n) {
    document.getElementById('recRating').value = n;
    document.querySelectorAll('#starPicker button').forEach((b, i) => b.classList.toggle('active', i < n));
};

window.setMediaType = function(type, btn) {
    document.getElementById('recMediaType').value = type;
    document.querySelectorAll('#mediaTypePicker .type-toggle-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
};

window.markSeen = async function(id) {
    await update(ref(database, `posts/${id}/readBy`), { [currentUser]: true });
    showToast('Marked as seen');
};

window.deletePost = function(id) {
    openDeleteModal({ type: 'post', postId: id });
};

window.archivePost = async function(id) {
    const post = allPosts[id];
    if (!post) return;
    const archivedBy = { ...(post.archivedBy || {}), [currentUser]: true };
    // Optimistically update local state so loadPosts() reflects it immediately
    allPosts[id] = { ...allPosts[id], archivedBy };
    loadPosts();
    await update(ref(database, `posts/${id}`), { archivedBy });
    showToast('Post archived [_]');
};

window.unarchivePost = async function(id) {
    const post = allPosts[id];
    if (!post) return;
    const archivedBy = { ...(post.archivedBy || {}) };
    delete archivedBy[currentUser];
    // Optimistically update local state
    allPosts[id] = { ...allPosts[id], archivedBy };
    loadPosts();
    await update(ref(database, `posts/${id}`), { archivedBy });
    showToast('Post unarchived ✓');
};

// ---- REACTIONS ----
window.toggleReaction = async function(postId, emoji, btn) {
    if (!throttle(`react-${postId}-${emoji}`, 500)) return;
    const post = allPosts[postId];
    if (!post) return;
    if (btn) burstEmoji(emoji, btn);

    const reactionsBy = structuredClone(post.reactionsBy || {});
    reactionsBy[emoji] = reactionsBy[emoji] || {};

    const _wasAdding = !reactionsBy[emoji][currentUser];
    if (reactionsBy[emoji][currentUser]) {
        delete reactionsBy[emoji][currentUser];
        if (Object.keys(reactionsBy[emoji]).length === 0) delete reactionsBy[emoji];
    } else {
        reactionsBy[emoji][currentUser] = true;
    }

    // In-place DOM update — avoids a full loadPosts() rebuild and scroll shift.
    const rxEl = document.getElementById(`post-rx-${postId}`);
    if (rxEl) {
        const reactionEmojis = ['<3', 'xD', 'O_O', '*_*', '!!', '(y)', 'T_T', ';_;'];
        rxEl.innerHTML = reactionEmojis.map(e => {
            const users = Object.keys(reactionsBy[e] || {});
            const active = !!(reactionsBy[e]?.[currentUser]);
            const who = users.sort().join(' & ');
            return `<button class="reaction-btn${active ? ' active' : ''}"
                    onclick="toggleReaction('${postId}','${e}',this)">
                <span>${EMOTICON_MAP[e] || e}</span>
                ${who ? `<span class="reaction-people">${who}</span>` : ''}
            </button>`;
        }).join('');
    }

    // Pre-set prevVisualSig so the Firebase echo doesn't trigger a redundant loadPosts().
    const updatedPosts = { ...allPosts, [postId]: { ...allPosts[postId], reactionsBy } };
    prevVisualSig = visualSig(updatedPosts);

    await update(ref(database, `posts/${postId}`), { reactionsBy });
    sparkSound('react');
    if (_wasAdding) _afterReaction();
};

window.toggleCommentReaction = async function(postId, replyId, emoji, btn) {
    if (!throttle(`cmtreact-${postId}-${replyId}-${emoji}`, 500)) return;
    const post = allPosts[postId];
    if (!post) return;
    if (btn) burstEmoji(emoji, btn);

    const replies = (post.replies || []).map(r => {
        if (r.id !== replyId) return r;
        const reactionsBy = structuredClone(r.reactionsBy || {});
        reactionsBy[emoji] = reactionsBy[emoji] || {};
        if (reactionsBy[emoji][currentUser]) {
            delete reactionsBy[emoji][currentUser];
            if (Object.keys(reactionsBy[emoji]).length === 0) delete reactionsBy[emoji];
        } else {
            reactionsBy[emoji][currentUser] = true;
        }
        return { ...r, reactionsBy };
    });

    // In-place DOM update — avoids a full loadPosts() rebuild and scroll shift.
    const newReply = replies.find(r => r.id === replyId);
    if (newReply) {
        const rxEl = document.getElementById(`comment-rx-${postId}-${replyId}`);
        if (rxEl) {
            const cmtEmojis = ['<3', 'xD', 'O_O', '!!', 'T_T', ';_;'];
            rxEl.innerHTML = cmtEmojis.map(e => {
                const rxBy = newReply.reactionsBy || {};
                const users = Object.keys(rxBy[e] || {});
                const active = !!(rxBy[e]?.[currentUser]);
                const who = users.sort().join(' & ');
                return `<button class="comment-reaction-btn${active ? ' active' : ''}"
                    onclick="toggleCommentReaction('${postId}','${replyId}','${e}',this)"
                    >${EMOTICON_MAP[e] || e}${who ? `<span class="reaction-people">${who}</span>` : ''}</button>`;
            }).join('');
        }
    }

    // Pre-set prevVisualSig so the Firebase echo doesn't trigger a redundant loadPosts().
    const updatedPosts = { ...allPosts, [postId]: { ...allPosts[postId], replies } };
    prevVisualSig = visualSig(updatedPosts);

    await update(ref(database, `posts/${postId}`), { replies });
    sparkSound('react');
};

// ---- REPLIES ----
window.addReply = async function(postId) {
    const input = document.getElementById(`reply-${postId}`);
    const text  = input.value.trim();
    if (!text) return;

    stopCommentTyping(postId);   // clear typing indicator immediately on send

    const author = currentUser;
    const post = allPosts[postId];
    const replies = post.replies || [];

    replies.push({
        id: Date.now().toString(36) + Math.random().toString(36).slice(2),
        author,
        text,
        timestamp: Date.now(),
        replyToId: null,
        reactionsBy: {}
    });

    await update(ref(database, `posts/${postId}`), { replies });
    input.value = '';
    showToast('Reply added');
    sparkSound('reply');
    _afterReply();
};

window.openInlineReply = function(postId, replyId) {
    const form = document.getElementById(`inline-reply-${postId}-${replyId}`);
    if (!form) return;
    const isHidden = form.classList.contains('hidden');
    document.querySelectorAll(`[id^="inline-reply-${postId}-"]`).forEach(el => el.classList.add('hidden'));
    if (isHidden) {
        form.classList.remove('hidden');
        document.getElementById(`inline-input-${postId}-${replyId}`)?.focus({ preventScroll: true });
    }
};

window.submitInlineReply = async function(postId, replyToId) {
    const input  = document.getElementById(`inline-input-${postId}-${replyToId}`);
    const raw    = input.value;
    const text   = raw.trim();
    if (!text) return;

    stopCommentTyping(postId);   // clear typing indicator immediately on send

    const author = currentUser;
    const post = allPosts[postId];
    const replies = post.replies || [];

    replies.push({
        id: Date.now().toString(36) + Math.random().toString(36).slice(2),
        author,
        text,
        timestamp: Date.now(),
        replyToId,
        reactionsBy: {}
    });

    await update(ref(database, `posts/${postId}`), { replies });
    input.value = '';
    document.getElementById(`inline-reply-${postId}-${replyToId}`).classList.add('hidden');
    showToast('Reply added');
    sparkSound('reply');
    _afterReply();
};

// ---- RENDER ----
function renderReplies(postId, replies) {
    if (!replies || replies.length === 0) return '';

    const withIds = replies.map((r, i) => ({ ...r, id: r.id || `${postId}_${i}` }));
    const topLevel = withIds.filter(r => !r.replyToId);
    const byParent = {};
    withIds.filter(r => r.replyToId).forEach(r => {
        (byParent[r.replyToId] = byParent[r.replyToId] || []).push(r);
    });

    const cmtEmojis = ['<3', 'xD', 'O_O', '!!', 'T_T', ';_;'];

    const renderRxButtons = (rxBy, postId, replyId) => {
        const map = rxBy || {};
        return cmtEmojis.map(e => {
            const users = Object.keys(map[e] || {});
            const active = !!(map[e] && map[e][currentUser]);
            const who = users.sort().join(' & ');
            return `
                <button class="comment-reaction-btn${active ? ' active' : ''}"
                        onclick="toggleCommentReaction('${postId}','${replyId}','${e}',this)">
                    ${EMOTICON_MAP[e] || e}${who ? `<span class="reaction-people">${who}</span>` : ''}
                </button>
            `;
        }).join('');
    };

    const renderItem = (reply, isChild) => {
        const ae = AUTHOR_EMOJI[reply.author] || '[?]';
        const ts = reply.timestamp ? timeAgo(reply.timestamp) : '';
        const tsFull = reply.timestamp ? exactTimestamp(reply.timestamp) : '';
        const children = byParent[reply.id] || [];

        return `
            <div class="reply-item${isChild ? ' reply-child' : ''}">
                <div class="reply-item-header">
                    <div class="reply-author-info">
                        <span class="reply-author-name">${safeText(reply.author)} ${ae}</span>
                        ${ts ? `<span class="reply-timestamp" title="${safeText(tsFull)}">${safeText(ts)}</span>` : ''}
                        ${reply.editedAt && reply.editHistory ? `<button class="edit-pill" onclick="openHistory('${safeText(JSON.stringify(normalizeHistory(reply)))}')" title="View edit history">edited</button>` : ''}
                    </div>

                    <div class="reply-action-btns">
                        <button class="reply-btn" onclick="openInlineReply('${postId}','${reply.id}')">↩ Reply</button>
                        ${reply.author === currentUser ? `
                            <button class="reply-btn" onclick="openEditComment('${postId}','${reply.id}')" title="Edit">✏️</button>
                            <button class="reply-btn" onclick="openDeleteModal({type:'reply', postId:'${postId}', replyId:'${reply.id}'})" title="Delete">✕</button>
                        ` : ''}
                    </div>
                </div>

                <div class="reply-text">${safeText(reply.text)}</div>

                <div class="comment-reactions" id="comment-rx-${postId}-${reply.id}">
                    ${renderRxButtons(reply.reactionsBy, postId, reply.id)}
                </div>
            </div>

            ${children.length ? children.map(c => renderItem(c, true)).join('') : ''}

            <div id="inline-reply-${postId}-${reply.id}" class="inline-reply-form hidden">
                <div class="inline-reply-label">Replying to ${safeText(reply.author)}</div>
                <div class="reply-input-row">
                    <textarea
                        id="inline-input-${postId}-${reply.id}"
                        class="reply-input"
                        rows="2"
                        placeholder="Reply..."
                        onkeydown="handleReplyKey(event,'${postId}','${reply.id}', true)"></textarea>
                    <button onclick="submitInlineReply('${postId}','${reply.id}')" class="reply-send-btn" title="Send">
                        <svg width="15" height="15" fill="none" stroke="white" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 12h14M12 5l7 7-7 7"/>
                        </svg>
                    </button>
                </div>
            </div>
        `;
    };

    const lastComment    = topLevel[topLevel.length - 1];
    const olderComments  = topLevel.slice(0, topLevel.length - 1);
    const collapseId     = `comments-collapse-${postId}`;

    return `
        <div class="reply-section">
            <div class="divider-text">Replies</div>
            ${olderComments.length ? `
                <div id="${collapseId}" class="hidden">
                    ${olderComments.map(r => renderItem(r, false)).join('')}
                </div>
                <button class="show-more-comments-btn"
                        onclick="toggleComments('${collapseId}', this, ${olderComments.length})">
                    show ${olderComments.length} older comment${olderComments.length !== 1 ? 's' : ''}
                </button>
            ` : ''}
            ${lastComment ? renderItem(lastComment, false) : ''}
        </div>
    `;
}

window.toggleComments = function(collapseId, btn, count) {
    const el = document.getElementById(collapseId);
    if (!el) return;
    const isNowHidden = el.classList.toggle('hidden');
    btn.textContent = isNowHidden
        ? `show ${count} older comment${count !== 1 ? 's' : ''}`
        : `hide older comments`;
};

window.handleReplyKey = function(e, postId, replyToId, isInline) {
    if (e.key !== 'Enter') return;
    if (e.shiftKey) return;
    e.preventDefault();
    if (isInline) submitInlineReply(postId, replyToId);
    else addReply(postId);
};

function getCollectionEmoji(collection) {
    return COLLECTION_EMOJIS[collection] || '';
}

const BUILTIN_COLLECTIONS = ['funny', 'cute', 'news', 'inspiration', 'music', 'idiot-drivers', 'wishlist', 'other'];

function renderCustomCollectionButtons() {
    const picker = document.getElementById('collectionPicker');
    if (!picker) return;
    // Remove previously injected custom buttons
    picker.querySelectorAll('.coll-pick-btn-custom').forEach(b => b.remove());
    const addBtn = picker.querySelector('.coll-pick-add-btn');
    // Insert custom buttons before the add button
    Object.keys(COLLECTION_EMOJIS).filter(k => !BUILTIN_COLLECTIONS.includes(k)).forEach(key => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'coll-pick-btn coll-pick-btn-custom';
        btn.dataset.val = key;
        btn.textContent = `${COLLECTION_EMOJIS[key]} ${COLLECTION_LABELS[key]}`;
        if (addBtn) picker.insertBefore(btn, addBtn);
        else picker.appendChild(btn);
    });
}

function renderCustomCollectionsGrid() {
    const grid = document.getElementById('collectionsGrid');
    if (!grid) return;
    grid.querySelectorAll('.collection-item-custom').forEach(el => el.remove());
    const addItem = grid.querySelector('.collection-add-item');
    Object.keys(COLLECTION_EMOJIS).filter(k => !BUILTIN_COLLECTIONS.includes(k)).forEach(key => {
        const item = document.createElement('div');
        item.className = 'collection-item collection-item-custom';
        item.dataset.collection = key;
        item.innerHTML = `<div class="text-2xl mb-1">${safeText(COLLECTION_EMOJIS[key])}</div><div class="text-xs font-semibold collection-item-label">${safeText(COLLECTION_LABELS[key])}</div>`;
        if (addItem) grid.insertBefore(item, addItem);
        else grid.appendChild(item);
    });
}

window.openAddCategoryModal = function() {
    const modal = document.getElementById('addCategoryModal');
    if (modal) {
        document.getElementById('newCatEmoji').value = '';
        document.getElementById('newCatName').value = '';
        document.getElementById('addCatError').textContent = '';
        openModal(modal);
        setTimeout(() => document.getElementById('newCatEmoji').focus(), 50);
    }
};

window.closeAddCategoryModal = function() {
    closeModal(document.getElementById('addCategoryModal'));
};

window.saveNewCategory = async function() {
    const emoji = document.getElementById('newCatEmoji').value.trim();
    const name  = document.getElementById('newCatName').value.trim();
    const err   = document.getElementById('addCatError');
    if (!emoji) { err.textContent = 'Please enter a symbol or emoji.'; return; }
    if (!name)  { err.textContent = 'Please enter a name.'; return; }
    // Create a key from the name (lowercase, hyphens)
    const key = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (!key) { err.textContent = 'Invalid name.'; return; }
    if (BUILTIN_COLLECTIONS.includes(key)) { err.textContent = 'That name is already a built-in category.'; return; }
    try {
        await set(ref(database, `categories/${key}`), { emoji, label: name });
        closeAddCategoryModal();
        showToast(`Category "${name}" added!`);
    } catch (e) {
        err.textContent = 'Failed to save. Try again.';
    }
};

function getSourceLabel(source) {
    const s = source || 'other';
    return `${SOURCE_EMOJIS[s] || '[url]'} ${SOURCE_LABELS[s] || s}`;
}

function createYouTubeEmbed(post) {
    const id = getYouTubeId(post.url);
    const hq  = `https://img.youtube.com/vi/${id}/hqdefault.jpg`;
    const max = `https://img.youtube.com/vi/${id}/maxresdefault.jpg`;
    const isWL = !!(post.watchLaterBy?.[currentUser]);
    return `
        <div class="yt-embed-card lp-loading" data-url="${encodeURIComponent(post.url)}">
            <a href="${safeText(post.url)}" target="_blank" class="yt-embed">
                <img src="${max}" alt="YouTube thumbnail" onerror="this.src='${hq}'">
                <div class="yt-play-overlay">
                    <svg width="64" height="44" viewBox="0 0 64 44" fill="none">
                        <rect width="64" height="44" rx="10" fill="#FF0000" opacity="0.92"/>
                        <polygon points="25,12 25,32 46,22" fill="white"/>
                    </svg>
                </div>
            </a>
            <div class="yt-meta">
                <a href="${safeText(post.url)}" target="_blank" class="yt-title">Loading…</a>
                <span class="yt-channel" style="display:none"></span>
            </div>
            <div class="yt-actions">
                <a href="${safeText(post.url)}" target="_blank" class="yt-watch-btn">▶ Watch</a>
                <button class="watch-later-btn${isWL ? ' active' : ''}" onclick="toggleWatchLater('${safeText(post.id)}')" data-tooltip="${isWL ? 'Click to remove' : 'Save to Watch Later'}">
                    🕐 ${isWL ? 'In Watch Later' : 'Watch Later'}
                </button>
            </div>
        </div>
    `;
}

function createInstagramEmbed(url) {
    return `
        <div class="instagram-wrap">
            <blockquote class="instagram-media" data-instgrm-permalink="${safeText(url)}" data-instgrm-version="14"
                style="margin: 0; width: 100%; background: transparent; border: none;">
            </blockquote>
            <div class="ig-note">
                If the caption doesn't show, Instagram is blocking it for that post.
            </div>
        </div>
    `;
}

// ---- RICH MEDIA CARD RENDERERS ----

const RICH_CARD_META = {
    spotify: { icon: '♪', label: 'Spotify', colorClass: 'rcp-spotify' },
    tiktok:  { icon: '▶', label: 'TikTok',  colorClass: 'rcp-tiktok'  },
    x:       { icon: '✕', label: 'X',       colorClass: 'rcp-x'       },
    reddit:  { icon: '▲', label: 'Reddit',  colorClass: 'rcp-reddit'  },
};

function createSpotifyCard(url) {
    return `
        <div class="post-content">
            <div class="spotify-card lp-loading" data-url="${encodeURIComponent(url)}">
                <a href="${safeText(url)}" target="_blank" class="spotify-card-link">
                    <div class="rc-art">
                        <img src="" alt="Cover art" style="display:none">
                        <div class="rc-art-placeholder">♪</div>
                    </div>
                    <div class="rc-body">
                        <div class="rc-platform rcp-spotify">♪ Spotify</div>
                        <div class="rc-title">Loading…</div>
                        <div class="rc-desc" style="display:none"></div>
                    </div>
                    <svg class="link-arrow" width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/>
                    </svg>
                </a>
                <a href="${safeText(url)}" target="_blank" rel="noopener" class="rc-open-btn rcp-spotify-btn">Open in Spotify ↗</a>
            </div>
        </div>
    `;
}

function createRichLinkCard(url, source) {
    const m = RICH_CARD_META[source] || { icon: '🔗', label: source, colorClass: 'rcp-other' };
    return `
        <div class="post-content">
            <div class="rich-card lp-loading" data-url="${encodeURIComponent(url)}">
                <a href="${safeText(url)}" target="_blank" class="rich-card-link">
                    <div class="rc-art">
                        <img src="" alt="" style="display:none">
                        <div class="rc-art-placeholder">${safeText(m.icon)}</div>
                    </div>
                    <div class="rc-body">
                        <div class="rc-platform ${safeText(m.colorClass)}">${safeText(m.icon)} ${safeText(m.label)}</div>
                        <div class="rc-title">Loading…</div>
                        <div class="rc-desc" style="display:none"></div>
                    </div>
                    <svg class="link-arrow" width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/>
                    </svg>
                </a>
            </div>
        </div>
    `;
}

// ---- POST-TYPE CONTENT RENDERERS ----

function renderPollContent(post) {
    const now = Date.now();
    const isExpired = post.endsAt && now > post.endsAt;
    const votes = post.votes || {};
    const totalVotes = Object.keys(votes).length;
    const myVote = votes[currentUser];
    const hasVoted = myVote !== undefined;

    const voteCounts = (post.options || []).map((_, i) =>
        Object.values(votes).filter(v => v === i).length
    );

    const endLabel = post.endsAt
        ? (isExpired ? `Ended ${timeAgo(post.endsAt)}` : `Ends ${timeAgo(post.endsAt)}`)
        : '';

    const optionsHtml = (post.options || []).map((opt, i) => {
        const count = voteCounts[i] || 0;
        const pct = totalVotes ? Math.round(count / totalVotes * 100) : 0;
        const isMyVote = hasVoted && myVote === i;
        const voters = Object.entries(votes).filter(([, v]) => v === i).map(([u]) => u).join(', ');

        if (isExpired || hasVoted) {
            return `
                <div class="poll-result${isMyVote ? ' poll-result--voted' : ''}">
                    <div class="poll-result-fill" style="width:${pct}%"></div>
                    <span class="poll-result-label">${safeText(opt)}</span>
                    <span class="poll-result-pct">${pct}%</span>
                    ${voters ? `<span class="poll-voters">${safeText(voters)}</span>` : ''}
                </div>
            `;
        } else {
            return `<button class="poll-vote-btn" onclick="castVote('${post.id}', ${i})">${safeText(opt)}</button>`;
        }
    }).join('');

    return `
        <div class="post-content poll-content">
            <div class="poll-question">${safeText(post.question)}</div>
            <div class="poll-options">${optionsHtml}</div>
            <div class="poll-meta">
                ${totalVotes} vote${totalVotes !== 1 ? 's' : ''}${endLabel ? ` · ${endLabel}` : ''}${isExpired ? ' · <span class="poll-closed">Closed</span>' : ''}
            </div>
        </div>
    `;
}

function renderRecommendationContent(post) {
    const mediaLabel = post.mediaType === 'movie' ? '🎬 Movie' : '📺 Show';
    const stars = Array.from({length: 5}, (_, i) => i < (post.rating || 0) ? '★' : '☆').join('');
    return `
        <div class="post-content rec-content${post.posterUrl ? ' rec-has-poster' : ''}">
            ${post.posterUrl ? `<img src="${safeText(post.posterUrl)}" class="rec-poster" alt="${safeText(post.title)} poster" loading="lazy">` : ''}
            <div class="rec-details">
                <div class="rec-type-badge">${mediaLabel}</div>
                <div class="rec-title">${safeText(post.title)}</div>
                ${post.streamingService ? `<div class="rec-service">📍 ${safeText(post.streamingService)}</div>` : ''}
                ${post.rating ? `<div class="rec-rating" title="${post.rating} out of 5">${stars}</div>` : ''}
                ${post.letterboxdDescription ? `<div class="rec-lb-desc">${safeText(post.letterboxdDescription)}</div>` : ''}
                ${post.letterboxdUrl ? `<a href="${safeText(post.letterboxdUrl)}" target="_blank" rel="noopener" class="rec-lb-link">View on Letterboxd ↗</a>` : ''}
            </div>
        </div>
    `;
}

// ---- CARD RENDERER ----

function createPostCard(post) {
    // Time capsule: non-owners see a locked placeholder until unlockAt passes
    if (post.unlockAt && post.unlockAt > Date.now() && post.author !== currentUser) {
        const unlockDate = exactTimestamp(post.unlockAt);
        return `
            <div class="post-card fade-in capsule-card" id="post-${post.id}" data-post-id="${post.id}">
                <div class="capsule-lock">
                    <div class="capsule-icon">🔒</div>
                    <div class="capsule-label">Locked until</div>
                    <div class="capsule-date">${safeText(unlockDate)}</div>
                    <div class="capsule-author">from ${safeText(post.author || 'someone')}</div>
                </div>
            </div>`;
    }

    const date = timeAgo(post.timestamp);
    const dateFull = exactTimestamp(post.timestamp);
    const author = post.author || 'Unknown';
    const badgeClass = AUTHOR_BADGE[author] || 'badge-el';
    const emoji = AUTHOR_EMOJI[author] || '[?]';
    const isFav = !!(post.favoritedBy && post.favoritedBy[currentUser]);
    const isArchived = !!(post.archivedBy && post.archivedBy[currentUser]);

    // Support both new (array) and legacy (string) collection formats
    const collArr = post.collections?.length ? post.collections
                  : post.collection         ? [post.collection]
                  : [];
    const collectionBadge = collArr
        .map(c => `<button class="collection-badge" onclick="filterByCollection('${safeText(c)}')" title="Filter by collection">${getCollectionEmoji(c)} ${safeText(COLLECTION_LABELS[c] || c)}</button>`)
        .join('');

    const reactionEmojis = ['<3', 'xD', 'O_O', '*_*', '!!', '(y)', 'T_T', ';_;'];
    const rb = post.reactionsBy || {};
    const reactionButtons = reactionEmojis.map(e => {
        const users = Object.keys(rb[e] || {});
        const active = !!(rb[e] && rb[e][currentUser]);
        const who = users.sort().join(' & ');
        return `
            <button class="reaction-btn${active ? ' active' : ''}"
                    onclick="toggleReaction('${post.id}','${e}',this)">
                <span>${EMOTICON_MAP[e] || e}</span>
                ${who ? `<span class="reaction-people">${who}</span>` : ''}
            </button>
        `;
    }).join('');

    const replies = post.replies || [];

    // Type-specific: source badge + content
    let sourceBadge = '';
    let contentHtml = '';

    if (!post.type || post.type === 'link') {
        const url = post.url || '';
        const domain = url.match(/https?:\/\/([^\/]+)/)?.[1]?.replace('www.', '') || 'link';
        const faviconUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
        const source = post.source || detectSource(url);
        sourceBadge = `<button class="collection-badge" onclick="filterBySource('${safeText(source)}')" title="Filter by source">${safeText(getSourceLabel(source))}</button>`;

        if (source === 'instagram') {
            contentHtml = createInstagramEmbed(url);
        } else if (source === 'youtube') {
            contentHtml = createYouTubeEmbed(post);
        } else if (source === 'spotify') {
            contentHtml = createSpotifyCard(url);
        } else if (source === 'tiktok' || source === 'x' || source === 'reddit') {
            contentHtml = createRichLinkCard(url, source);
        } else {
            contentHtml = `
                <div class="post-content">
                    <a href="${safeText(url)}" target="_blank" class="link-preview lp-loading" data-url="${encodeURIComponent(url)}">
                        <div class="link-favicon">
                            <img src="${faviconUrl}" alt="${safeText(domain)}" onerror="this.parentNode.innerHTML='🔗'">
                        </div>
                        <div class="link-info">
                            <div class="link-domain">${safeText(domain)}</div>
                            <div class="link-url">${safeText(url)}</div>
                        </div>
                        <svg class="link-arrow" width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/>
                        </svg>
                    </a>
                </div>
            `;
        }
    } else if (post.type === 'image') {
        contentHtml = `<div class="post-content"><img src="${safeText(post.imageUrl)}" class="post-image" alt="shared photo" loading="lazy"></div>`;
    } else if (post.type === 'poll') {
        contentHtml = renderPollContent(post);
    } else if (post.type === 'recommendation') {
        contentHtml = renderRecommendationContent(post);
    } else if (post.type === 'text') {
        contentHtml = `<div class="post-text-content">${post.heading ? `<div class="post-text-heading">${safeText(post.heading)}</div>` : ''}<p class="post-text-body">${safeText(post.body || '')}</p></div>`;
    }

    return `
        <div class="post-card fade-in" id="post-${post.id}" data-post-id="${post.id}">
            <div class="post-header">
                <div class="post-author-row">
                    <span class="${badgeClass}">${safeText(author)} ${emoji}</span>
                    <span class="post-meta-dot">•</span>
                    <span class="post-meta-date" title="${safeText(dateFull)}" onclick="openPostWindow('${post.id}')">${safeText(date)}</span>
                    ${collectionBadge}
                    ${sourceBadge}
                    ${isRead(post) ? '<span class="seen-dot" title="Seen"></span>' : ''}
                ${post.editedAt && post.editHistory ? `
  <button class="edit-pill"
    onclick="openHistory('${safeText(JSON.stringify(normalizeHistory(post)))}')"
    title="View edit history">
    edited
  </button>
` : ''}

                </div>

                <div class="post-header-actions">
                    <button class="icon-btn${isFav ? ' fav-active' : ''}" onclick="openBoardPickerModal('${post.id}')" title="Save to board">
                        ${isFav ? '♥' : '♡'}
                    </button>
                    <button class="icon-btn copy-link-btn" onclick="copyPostLink('${post.id}',this)" title="Copy link">
                        <svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"/></svg>
                    </button>
                    <button class="icon-btn" onclick="openPostWindow('${post.id}')" title="Open in window">
                        <svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="2" y="3" width="20" height="18" rx="2" stroke-width="2"/><path stroke-linecap="round" stroke-width="2" d="M2 7h20"/><circle cx="5" cy="5" r="1" fill="currentColor"/><circle cx="8" cy="5" r="1" fill="currentColor"/></svg>
                    </button>
                    <button class="icon-btn archive-btn${isArchived ? ' archive-active' : ''}" onclick="${isArchived ? `unarchivePost('${post.id}')` : `archivePost('${post.id}')`}" title="${isArchived ? 'Unarchive post' : 'Archive post'}">
                        <svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"/></svg>
                    </button>
                    ${post.author === currentUser ? `
                        <button class="icon-btn" onclick="openEditPost('${post.id}')" title="Edit">✏️</button>
                        <button class="icon-btn delete-btn" onclick="deletePost('${post.id}')" title="Delete">
                            <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                            </svg>
                        </button>
                    ` : ''}
                </div>
            </div>

            ${post.note ? `
                <div class="post-note">
                    <div class="note-author">${safeText(author)}</div>
                    <p class="note-text">${safeText(post.note)}</p>
                </div>
            ` : ''}

            ${contentHtml}

            <div class="reactions-bar" id="post-rx-${post.id}">
                ${reactionButtons}
            </div>

            ${renderReplies(post.id, replies)}

            <div class="reply-section">
                <div id="typing-comment-${post.id}" class="comment-typing-indicator hidden"></div>
                <div class="reply-input-row">
                    <textarea
                        id="reply-${post.id}"
                        placeholder="Add a reply..."
                        class="reply-input"
                        rows="2"
                        onkeydown="handleReplyKey(event,'${post.id}',null,false)"></textarea>
                    <button onclick="addReply('${post.id}')" class="reply-send-btn" title="Send">
                        <svg width="15" height="15" fill="none" stroke="white" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 12h14M12 5l7 7-7 7"/>
                        </svg>
                    </button>
                </div>
                <div class="reply-hint">Enter to send, Shift+Enter for a new line</div>
            </div>

            ${!isRead(post) ? `
                <div class="post-actions">
                    <button onclick="markSeen('${post.id}')" class="btn-secondary px-4 py-2 text-sm font-semibold rounded-xl mark-seen-btn">
                        <span class="seen-dot"></span> Mark Seen
                    </button>
                </div>
            ` : ''}
        </div>
    `;
}

function loadPosts() {
    updateActiveFiltersBanner();

    let posts = Object.entries(allPosts)
        .map(([id, data]) => ({ id, ...data }))
        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    // Always hide archived posts from normal views; only show them in the 'archived' filter
    if (currentFilter !== 'archived') {
        posts = posts.filter(p => !p.archivedBy?.[currentUser]);
    }

    if (currentCollection) posts = posts.filter(p => {
        const colls = p.collections?.length ? p.collections : p.collection ? [p.collection] : [];
        return colls.includes(currentCollection);
    });
    if (currentSource) posts = posts.filter(p => (p.source || detectSource(p.url)) === currentSource);

    if (currentFilter === 'new')        posts = posts.filter(p => !isRead(p));
    else if (currentFilter === 'seen')  posts = posts.filter(p =>  isRead(p));
    else if (currentFilter === 'fav')   posts = posts.filter(p => p.favoritedBy?.[currentUser]);
    else if (currentFilter === 'watch-later') {
        posts = posts.filter(p => !!(p.watchLaterBy?.[currentUser]));
        posts.sort((a, b) => (b.watchLaterBy[currentUser] || 0) - (a.watchLaterBy[currentUser] || 0));
    }
    else if (currentFilter === 'just-other') {
        posts = posts.filter(p => p.author !== currentUser);
    }
    else if (currentFilter === 'archived') {
        posts = posts.filter(p => !!(p.archivedBy?.[currentUser]));
    }

    if (searchQuery) {
        posts = posts.filter(p => {
            const colls = p.collections?.length ? p.collections : p.collection ? [p.collection] : [];
            const hay = [p.url || '', p.note || '', p.author || '', ...colls].join(' ').toLowerCase();
            return hay.includes(searchQuery);
        });
    }

    const container  = document.getElementById('postsContainer');
    const emptyState = document.getElementById('emptyState');

    if (posts.length === 0) {
        container.innerHTML = '';
        emptyState.classList.remove('hidden');
        const h3 = emptyState.querySelector('h3');
        const p  = emptyState.querySelector('p');

        if (currentCollection && currentSource) {
            h3.textContent = 'Nothing matches those filters';
            p.textContent  = 'Try clearing one of the filters.';
        } else if (currentCollection) {
            h3.textContent = `No ${COLLECTION_LABELS[currentCollection] || 'Collection'} Posts`;
            p.textContent  = 'Nothing in this category yet.';
        } else if (currentSource) {
            h3.textContent = `No ${SOURCE_LABELS[currentSource] || 'Source'} Posts`;
            p.textContent  = 'Nothing from this source yet.';
        } else if (searchQuery) {
            h3.textContent = 'No Results';
            p.textContent  = `Nothing matched "${searchQuery}".`;
        } else if (currentFilter === 'fav') {
            h3.textContent = 'No Saved Posts';
            p.textContent  = 'Tap ♡ on any post to save it here.';
        } else if (currentFilter === 'new') {
            h3.textContent = 'All Caught Up';
            p.textContent  = 'No new posts to see.';
        } else if (currentFilter === 'seen') {
            h3.textContent = 'No Seen Posts';
            p.textContent  = 'Mark posts as seen and they\'ll appear here.';
        } else if (currentFilter === 'watch-later') {
            h3.textContent = 'Watch Later is empty';
            p.textContent  = 'Hit 🕐 under any YouTube video to save it here.';
        } else if (currentFilter === 'just-other') {
            const other = currentUser === 'El' ? 'Tero' : currentUser === 'Tero' ? 'El' : 'El or Tero';
            h3.textContent = `No Posts from ${other}`;
            p.textContent  = `${other} hasn't shared anything yet.`;
        } else if (currentFilter === 'archived') {
            h3.textContent = 'Archive is Empty';
            p.textContent  = 'Archive posts to tuck them away from the main feed.';
        } else {
            h3.textContent = 'No Posts Yet';
            p.textContent  = 'Start adding posts.';
        }
        return;
    }

    emptyState.classList.add('hidden');
    const _feedBodyEl = getFeedScrollEl();
    const savedScroll = _feedBodyEl ? _feedBodyEl.scrollTop : window.scrollY;
    container.innerHTML = posts.map(createPostCard).join('');
    hydrateLinkPreviews(container);
    hydrateRichCards(container);
    hydrateYouTubeMeta(container);
    if (_feedBodyEl) _feedBodyEl.scrollTo({ top: savedScroll, behavior: 'instant' });
    else window.scrollTo({ top: savedScroll, behavior: 'instant' });
    // Re-apply keyboard-navigation focus after re-render
    if (focusedPostId) {
        document.querySelector(`[data-post-id="${focusedPostId}"]`)?.classList.add('post-focused');
    }
    // Re-stamp any active typing indicators (DOM was rebuilt)
    updateCommentTypingUI();

    setTimeout(() => {
        window.twttr?.widgets?.load?.();
        window.instgrm?.Embeds?.process?.();
    }, 120);

    // Handle ?post= URL deep-link (once, on first render that includes the target post)
    if (_linkedPostId && !_linkedPostHandled && allPosts[_linkedPostId]) {
        _linkedPostHandled = true;
        setTimeout(() => openPostWindow(_linkedPostId), 120);
    }
}

window.copyPostLink = function(postId, btn) {
    const url = window.location.origin + window.location.pathname + '?post=' + postId;
    navigator.clipboard.writeText(url).then(() => {
        const svg = btn.innerHTML;
        btn.textContent = '✓';
        btn.disabled = true;
        setTimeout(() => { btn.innerHTML = svg; btn.disabled = false; }, 1500);
    });
};

// ---- ACTIVITY FEED ----
function computeActivity() {
    if (!currentUser) return [];
    const cutoff = Date.now() - 72 * 60 * 60 * 1000;
    const items = [];
    for (const [id, post] of Object.entries(allPosts)) {
        if (post.timestamp > cutoff && post.author && post.author !== currentUser) {
            let preview = post.note || '';
            if (!preview) { try { preview = new URL(post.url).hostname.replace('www.', ''); } catch { preview = post.url || ''; } }
            items.push({ type: 'post', postId: id, author: post.author, timestamp: post.timestamp, preview, seen: post.timestamp <= activitySeenTs });
        }
        for (const reply of (post.replies || [])) {
            if (reply.timestamp > cutoff && reply.author && reply.author !== currentUser) {
                items.push({ type: 'reply', postId: id, author: reply.author, timestamp: reply.timestamp, preview: reply.text || '', seen: reply.timestamp <= activitySeenTs });
            }
        }
    }
    items.sort((a, b) => b.timestamp - a.timestamp);
    return items;
}

function updateActivityBadge() {
    if (!currentUser) return;
    const badge = document.getElementById('activityBadge');
    if (!badge) return;
    const count = computeActivity().filter(i => !i.seen).length;
    if (count > 0) {
        badge.textContent = count > 99 ? '99+' : count;
        badge.classList.remove('hidden');
    } else {
        badge.classList.add('hidden');
    }
}

function renderActivityPanel() {
    const items = computeActivity();
    const body = document.getElementById('activityBody');
    if (!body) return;
    if (items.length === 0) {
        body.innerHTML = '<div class="activity-empty">All caught up! ✨</div>';
        return;
    }
    body.innerHTML = items.map(item => {
        const emoji = AUTHOR_EMOJI[item.author] || '[?]';
        const action = item.type === 'post' ? 'shared a post' : 'commented';
        const preview = (item.preview || '').slice(0, 90);
        return `
            <div class="activity-item${item.seen ? ' seen' : ''}" onclick="scrollToPost('${item.postId}');closeActivityPanel();" title="${safeText(exactTimestamp(item.timestamp))}">
                <div class="activity-item-action">${emoji} <strong>${safeText(item.author)}</strong> ${safeText(action)}</div>
                ${preview ? `<div class="activity-item-preview">${safeText(preview)}</div>` : ''}
                <div class="activity-item-time">${safeText(timeAgo(item.timestamp))}</div>
            </div>
        `;
    }).join('');
}

window.toggleActivityPanel = function() {
    if (!currentUser) return;
    const panel = document.getElementById('activityPanel');
    if (!panel) return;
    if (panel.classList.contains('show')) { closeActivityPanel(); return; }
    panel.classList.add('show');
    renderActivityPanel();
    activitySeenTs = Date.now();
    localStorage.setItem(`activitySeenTs-${currentUser}`, String(activitySeenTs));
    document.getElementById('activityBadge')?.classList.add('hidden');
};

window.closeActivityPanel = function() {
    document.getElementById('activityPanel')?.classList.remove('show');
};

window.scrollToPost = function(postId) {
    if (currentFilter !== 'all' || currentCollection || currentSource || searchQuery) {
        currentFilter = 'all';
        currentCollection = null;
        currentSource = null;
        searchQuery = '';
        const inp = document.getElementById('searchInput');
        if (inp) inp.value = '';
        document.getElementById('searchClear')?.classList.add('hidden');
        updateActiveFiltersBanner();
        loadPosts();
    }
    setTimeout(() => {
        const el = document.querySelector(`[data-post-id="${postId}"]`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 80);
};

// ---- TYPING INDICATORS ----

// --- Chat typing ---

function _chatTypingRef() {
    return ref(database, `typing/chat/${currentUser}`);
}

function startChatTyping() {
    if (!currentUser) return;
    if (!_chatIsTyping) {
        _chatIsTyping = true;
        set(_chatTypingRef(), { typing: true });
    }
    _setPresState('typing');
    // Reset the inactivity timer
    clearTimeout(_chatTypingTimer);
    _chatTypingTimer = setTimeout(stopChatTyping, 1200);
}

function stopChatTyping() {
    clearTimeout(_chatTypingTimer);
    _chatTypingTimer = null;
    if (!currentUser || !_chatIsTyping) return;
    _chatIsTyping = false;
    set(_chatTypingRef(), { typing: false });
    _setPresState('online');
    _resetPresIdle(); // restart the idle countdown
}

function setupTypingCleanup() {
    if (!currentUser) return;
    // Register server-side cleanup so the flag clears if the tab is closed
    onDisconnect(_chatTypingRef()).set({ typing: false });
}

// --- Comment typing ---

function startCommentTyping(postId) {
    if (!currentUser) return;
    const typRef = ref(database, `typing/comments/${postId}/${currentUser}`);
    // Register onDisconnect once per post per session
    if (!_commentOnDisconnectSet.has(postId)) {
        onDisconnect(typRef).set({ typing: false });
        _commentOnDisconnectSet.add(postId);
    }
    set(typRef, { typing: true });
    clearTimeout(_commentTypingTimers[postId]);
    _commentTypingTimers[postId] = setTimeout(() => stopCommentTyping(postId), 1200);
}

function stopCommentTyping(postId) {
    clearTimeout(_commentTypingTimers[postId]);
    delete _commentTypingTimers[postId];
    if (!currentUser) return;
    set(ref(database, `typing/comments/${postId}/${currentUser}`), { typing: false });
}

// --- Typing UI update helpers ---

function updateChatTypingUI() {
    const indicator = document.getElementById('chatTypingIndicator');
    if (!indicator) return;
    const other = Object.entries(_cachedChatTyping)
        .find(([uid, v]) => uid !== currentUser && v?.typing);
    if (other) {
        indicator.textContent = `${other[0]} is typing…`;
        indicator.classList.remove('hidden');
    } else {
        indicator.classList.add('hidden');
    }
}

// Called by loadPosts() to re-stamp indicators after a DOM rebuild
function updateCommentTypingUI() {
    if (!currentUser) return;
    document.querySelectorAll('[id^="typing-comment-"]').forEach(el => {
        const postId = el.id.slice('typing-comment-'.length);
        const typingData = _cachedCommentTyping[postId] || {};
        const other = Object.entries(typingData)
            .find(([uid, v]) => uid !== currentUser && v?.typing);
        if (other) {
            el.textContent = `${other[0]} is typing a comment…`;
            el.classList.remove('hidden');
        } else {
            el.classList.add('hidden');
        }
    });
}

// (typing onValue listeners are in setupDBListeners())

// ---- PRESENCE (Phase 1: Shared Presence Pulse) ----

function _setPresState(state) {
    if (!_presRef || _presState === state) return;
    _presState = state;
    update(_presRef, { state, ts: Date.now() });
}

function _resetPresIdle() {
    clearTimeout(_presIdleTimer);
    // Don't interrupt an active typing state — let stopChatTyping restore it.
    if (_presState !== 'typing') _setPresState('online');
    _presIdleTimer = setTimeout(() => _setPresState('idle'), 60_000);
}

function _presRelativeTime(ts) {
    if (!ts) return '';
    const diff = Math.floor((Date.now() - ts) / 1000);
    if (diff < 10)  return 'just now';
    if (diff < 60)  return `${diff}s ago`;
    const mins = Math.floor(diff / 60);
    if (mins < 60)  return `${mins} min${mins !== 1 ? 's' : ''} ago`;
    const hrs = Math.floor(mins / 60);
    return `${hrs} hr${hrs !== 1 ? 's' : ''} ago`;
}

function updatePresenceDots(data) {
    const STATE_LABEL = { online: 'Online', idle: 'Idle', typing: 'Typing…', offline: 'Offline' };
    // If the heartbeat timestamp is older than 3× the heartbeat interval the client
    // is gone without having cleaned up (crash / forced kill / onDisconnect skipped).
    const STALE_MS = 90_000;
    ['El', 'Tero'].forEach(user => {
        const entry = data[user] || {};
        const stale = entry.ts && (Date.now() - entry.ts) > STALE_MS;
        const state = (entry.state && !stale) ? entry.state : 'offline';
        const ts    = entry.ts   || null;
        document.querySelectorAll(`.presence-dot[data-user="${user}"]`).forEach(dot => {
            dot.className = `presence-dot ${state}`;
        });
        // Update Presence.exe window rows
        const statusEl = document.getElementById(`pres-status-${user}`);
        const lastEl   = document.getElementById(`pres-last-${user}`);
        if (statusEl) statusEl.textContent = STATE_LABEL[state] || state;
        if (lastEl)   lastEl.textContent   = state !== 'offline' ? '' : _presRelativeTime(ts);
    });
}

function setupPresence() {
    if (!currentUser) return;
    _presRef = ref(database, `presence/${currentUser}`);
    _presState = 'online';

    // Re-register the onDisconnect handler every time the connection is established
    // (or re-established after a drop). Without this, a reconnect clears the server-side
    // handler and the user gets stuck showing as permanently online.
    onValue(ref(database, '.info/connected'), snap => {
        if (!snap.val()) return; // currently disconnected — nothing to register
        // Register server-side cleanup; serverTimestamp() is evaluated at disconnect time
        onDisconnect(_presRef).set({ state: 'offline', ts: serverTimestamp() });
        // Announce online
        set(_presRef, { state: _presState === 'offline' ? 'online' : _presState, ts: Date.now() });
        if (_presState === 'offline') _presState = 'online';
    });

    // Heartbeat every 30 s (keeps ts fresh so the other client knows we're still alive)
    clearInterval(_presHbInterval);
    _presHbInterval = setInterval(() => {
        if (_presRef && _presState !== 'offline') update(_presRef, { ts: Date.now() });
    }, 30_000);

    // Idle detection: go idle after 60 s of no mouse/key activity
    ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'].forEach(ev =>
        window.addEventListener(ev, _resetPresIdle, { passive: true })
    );
    _resetPresIdle();

    // Go offline immediately when the tab is hidden or closed.
    // The heartbeat keeps the WebSocket alive, so the server-side onDisconnect
    // handler never fires while the page is open — these listeners bridge that gap.
    document.addEventListener('visibilitychange', () => {
        if (!_presRef) return;
        if (document.visibilityState === 'hidden') {
            clearTimeout(_presIdleTimer);
            _presState = 'offline';
            set(_presRef, { state: 'offline', ts: Date.now() });
        } else {
            // Tab became visible again — come back online
            _presState = 'online';
            set(_presRef, { state: 'online', ts: Date.now() });
            _resetPresIdle();
        }
    });

    window.addEventListener('beforeunload', () => {
        if (_presRef) set(_presRef, { state: 'offline', ts: Date.now() });
    });

    // Listen to all presence nodes and refresh the dots
    onValue(ref(database, 'presence'), snap => {
        updatePresenceDots(snap.val() || {});
    });
}

// ---- SLASH COMMANDS ----
// Command handler map — returns { command, text } to be stored in Firebase.
const SLASH_COMMANDS = {
    hug: (args) => {
        const target = args.length ? args.join(' ') : (_otherUser());
        return { command: 'hug', text: `${safeText(currentUser || '?')} hugs ${safeText(target)} 🤍` };
    },
    kiss: (args) => {
        const target = args.length ? args.join(' ') : (_otherUser());
        return { command: 'kiss', text: `${safeText(currentUser || '?')} kisses ${safeText(target)} 💋` };
    },
    flurry: () => ({ command: 'flurry', text: '✿ a flurry of petals ✿' }),
    dance:  () => ({ command: 'dance',  text: '(ﾉ◕ヮ◕)ﾉ*:･ﾟ✧ dance break! ✧ﾟ･: *ヽ(◕ヮ◕ヽ)' }),
};

function _otherUser() {
    if (currentUser === 'El') return 'Tero';
    if (currentUser === 'Tero') return 'El';
    return 'you';
}

// ---- XP CHAT COMMANDS ----
// Each entry: { name, requiredXP, description, handler(args) → { command, text [,style] [,tintVariant] } | null }
const XP_CHAT_COMMANDS = [
    // ── Tier 2 · 50 XP ──────────────────────────────────────────────────────────
    {
        name: 'sparkle', requiredXP: 50,
        description: 'Sparkle effect around the latest message (~2s)',
        handler: () => ({ command: 'sparkle', text: `✨ ${currentUser} adds a sparkle` }),
    },
    {
        name: 'glow', requiredXP: 50,
        description: 'Softly glow the chat window (~5s)',
        handler: () => ({ command: 'glow', text: `🌟 ${currentUser} adds a soft glow` }),
    },
    {
        name: 'pulse', requiredXP: 50,
        description: 'Trigger a gentle pulse animation (~3s)',
        handler: () => ({ command: 'pulse', text: `💫 ${currentUser} sends a pulse` }),
    },
    {
        name: 'tint', requiredXP: 50,
        description: 'Tint the chat warm|cool|rose for ~20s',
        args: 'warm|cool|rose',
        handler: (args) => {
            const VARIANTS = ['warm', 'cool', 'rose'];
            const v = VARIANTS.includes(args[0]) ? args[0] : 'warm';
            const LABELS = { warm: '🌅 warm', cool: '❄️ cool', rose: '🌹 rose' };
            return { command: 'tint', tintVariant: v, text: `${LABELS[v]} — ${currentUser} tints the chat` };
        },
    },
    {
        name: 'warm', requiredXP: 50,
        description: 'Apply a warm tint to the chat (0–100 intensity)',
        args: '<0–100>',
        handler: (args) => {
            const n = parseInt(args[0], 10);
            if (!args.length || isNaN(n) || n < 0 || n > 100) return null;
            return { command: 'warm', tintIntensity: n, text: `🌅 ${currentUser} warms the chat` };
        },
    },
    // ── Tier 3 · 120 XP ─────────────────────────────────────────────────────────
    {
        name: 'whisper', requiredXP: 120,
        description: 'Send a softly styled whisper message',
        args: '<message>',
        handler: (args) => {
            const msg = args.join(' ');
            if (!msg) return null;
            return { command: 'whisper', style: 'whisper', text: msg };
        },
    },
    {
        name: 'echo', requiredXP: 120,
        description: 'Send a message that visually echoes',
        args: '<message>',
        handler: (args) => {
            const msg = args.join(' ');
            if (!msg) return null;
            return { command: 'echo', style: 'echo', text: msg };
        },
    },
    {
        name: 'fade', requiredXP: 120,
        description: 'Send a message that fades in slowly',
        args: '<message>',
        handler: (args) => {
            const msg = args.join(' ');
            if (!msg) return null;
            return { command: 'fade', style: 'fade', text: msg };
        },
    },
    // ── Tier 4 · 250 XP ─────────────────────────────────────────────────────────
    // ── Tier 5 · 500 XP ─────────────────────────────────────────────────────────
    {
        name: 'memory', requiredXP: 500,
        description: 'Resurface a random past message as a Memory',
        handler: () => {
            const pool = (lastChatMessages || []).filter(
                m => m.kind !== 'system' && m.author === currentUser && m.text
            );
            const picked = pool.length
                ? pool[Math.floor(Math.random() * pool.length)]
                : null;
            return { command: 'memory', style: 'memory', text: picked ? picked.text : '(no memories found yet)' };
        },
    },
];

// Show a local-only usage hint in the chat body (not synced to Firebase).
function showCommandUsageHint(cmd, argsHint) {
    const body = document.getElementById('chatBody');
    if (!body) return;
    const el = document.createElement('div');
    el.className = 'chat-system-msg chat-system-msg--usage';
    el.setAttribute('aria-live', 'polite');
    el.textContent = `Usage: /${cmd} ${argsHint}`;
    body.appendChild(el);
    body.scrollTop = body.scrollHeight;
    setTimeout(() => el.remove(), 5000);
}

// Show a Windows-95-style lock alert when a locked command is used.
function showXpLockAlert(requiredXP) {
    document.getElementById('xp-lock-alert')?.remove();
    const box = document.createElement('div');
    box.id = 'xp-lock-alert';
    box.className = 'xp-lock-alert';
    box.innerHTML =
        `<div class="xp-lock-alert__bar">` +
            `<span>🔒 Locked</span>` +
            `<button class="xp-lock-alert__close" aria-label="Close">✕</button>` +
        `</div>` +
        `<div class="xp-lock-alert__body">` +
            `Unlocks at <strong>${requiredXP} XP</strong>` +
            `<div class="xp-lock-alert__cur">You have ${xpTotal} XP</div>` +
        `</div>` +
        `<div class="xp-lock-alert__footer">` +
            `<button class="xp-lock-alert__ok">OK</button>` +
        `</div>`;
    document.body.appendChild(box);
    const close = () => {
        box.classList.add('xp-lock-alert--out');
        setTimeout(() => box.remove(), 180);
    };
    box.querySelector('.xp-lock-alert__close').addEventListener('click', close);
    box.querySelector('.xp-lock-alert__ok').addEventListener('click', close);
    setTimeout(close, 4000);
}

// Track which XP thresholds have already triggered an "Unlocked!" notification.
const _notifiedXpThresholds = new Set();

// Seed thresholds already passed at load time so we don't re-notify on startup.
function _initXpNotifiedThresholds() {
    for (const c of XP_CHAT_COMMANDS) {
        if (xpTotal >= c.requiredXP) _notifiedXpThresholds.add(c.requiredXP);
    }
}

// Called after xpTotal increases (prevXp = value before the change).
function checkXpCommandUnlocks(prevXp, newXp) {
    const newlyUnlocked = XP_CHAT_COMMANDS.filter(
        c => prevXp < c.requiredXP && newXp >= c.requiredXP && !_notifiedXpThresholds.has(c.requiredXP)
    );
    if (!newlyUnlocked.length) return;
    newlyUnlocked.forEach(c => _notifiedXpThresholds.add(c.requiredXP));
    showXpCommandUnlockNotification(newlyUnlocked);
}

// Show a Windows-95-style "Unlocked!" notification listing newly available commands.
function showXpCommandUnlockNotification(cmds) {
    document.getElementById('xp-unlock-notification')?.remove();
    const box = document.createElement('div');
    box.id = 'xp-unlock-notification';
    box.className = 'xp-unlock-notification';
    const items = cmds.map(c => `<li><strong>/${c.name}</strong> — ${c.description}</li>`).join('');
    box.innerHTML =
        `<div class="xp-unlock-notification__bar">` +
            `<span>🔓 Commands Unlocked!</span>` +
            `<button class="xp-unlock-notification__close" aria-label="Close">✕</button>` +
        `</div>` +
        `<div class="xp-unlock-notification__body"><ul>${items}</ul></div>`;
    document.body.appendChild(box);
    const close = () => {
        box.classList.add('xp-unlock-notification--out');
        setTimeout(() => box.remove(), 300);
    };
    box.querySelector('.xp-unlock-notification__close').addEventListener('click', close);
    setTimeout(close, 8000);
    // Add to notification panel
    addCommandUnlockNotification(cmds);
}

// Pushes a recognised slash command to Firebase as a system entry.
// Returns true if the text was a recognised slash command (caller should NOT push to Firebase).
async function handleSlashCommand(text) {
    if (!text.startsWith('/')) return false;
    const parts = text.slice(1).trim().split(/\s+/);
    const cmd   = (parts[0] || '').toLowerCase();
    const args  = parts.slice(1);

    // ── Legacy commands (hug, kiss, flurry, dance) ──────────────────────────────
    const legacyHandler = SLASH_COMMANDS[cmd];
    if (legacyHandler) {
        const result = legacyHandler(args);
        const entry = {
            author:     currentUser,
            timestamp:  Date.now(),
            kind:       'system',
            systemType: 'command',
            command:    result.command,
            text:       result.text,
        };
        // 5% chance of a subtly upgraded sparkle effect for hug and kiss
        if ((cmd === 'hug' || cmd === 'kiss') && Math.random() < 0.05) {
            entry.variant = 'sparkle';
        }
        await push(chatRef, entry);
        return true;
    }

    // ── XP-gated commands ────────────────────────────────────────────────────────
    const xpCmd = XP_CHAT_COMMANDS.find(c => c.name === cmd);
    if (!xpCmd) return false;

    if (xpTotal < xpCmd.requiredXP) {
        showXpLockAlert(xpCmd.requiredXP);
        return true;
    }

    const result = xpCmd.handler(args);
    if (!result) {
        // Handler returned null — show a local usage hint (not synced to Firebase)
        if (xpCmd.args) showCommandUsageHint(xpCmd.name, xpCmd.args);
        return true;
    }

    const entry = {
        author:     currentUser,
        timestamp:  Date.now(),
        kind:       'system',
        systemType: 'command',
        command:    result.command,
        text:       result.text,
    };
    if (result.style)           entry.style         = result.style;
    if (result.tintVariant)     entry.tintVariant   = result.tintVariant;
    if (result.tintIntensity != null) entry.tintIntensity = result.tintIntensity;
    await push(chatRef, entry);
    return true;
}

// /flurry — shower the chat panel with flower petals (animation only, respects reduced-motion).
function triggerFlurry() {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const panel = document.getElementById('chatPanel') ||
                  document.getElementById('w95-win-chat');
    if (!panel) return;

    const EMOJIS = ['🌸', '🌺', '🌷', '✿', '❀', '🌼'];
    const container = document.createElement('div');
    container.className = 'chat-flurry-container';
    panel.appendChild(container);

    for (let i = 0; i < 14; i++) {
        const petal = document.createElement('span');
        petal.className = 'chat-flurry-petal';
        petal.textContent = EMOJIS[Math.floor(Math.random() * EMOJIS.length)];
        petal.style.left              = Math.random() * 100 + '%';
        petal.style.animationDelay    = (Math.random() * 1.6) + 's';
        petal.style.animationDuration = (1.4 + Math.random() * 1.4) + 's';
        petal.style.fontSize          = (11 + Math.random() * 10) + 'px';
        container.appendChild(petal);
    }

    setTimeout(() => container.remove(), 4500);
}

// /dance — playful wiggle animation (animation only, respects reduced-motion).
function triggerDance() {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const body = document.getElementById('chatBody');
    if (!body) return;
    body.classList.remove('chat-dance'); // reset in case it's still running
    // Force reflow so removing then adding triggers the animation fresh
    void body.offsetWidth;
    body.classList.add('chat-dance');
    setTimeout(() => body.classList.remove('chat-dance'), 700);
}

// /hug — soft white/pastel sparkle burst with gentle upward float (respects reduced-motion).
// variant='sparkle': rare upgrade — more particles, subtle golden tones, longer fade.
function triggerHugSparkle(variant) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const panel = document.getElementById('chatPanel') ||
                  document.getElementById('w95-win-chat');
    if (!panel) return;

    const container = document.createElement('div');
    container.className = 'chat-hug-container';
    panel.appendChild(container);

    const isSparkle = variant === 'sparkle';
    const COLORS = isSparkle
        ? ['#ffffff', '#e8d5ff', '#d4f0ff', '#fffde7', '#f3e5f5', '#fce4ec', '#ffd700', '#fff0a0', '#ffe8a0']
        : ['#ffffff', '#e8d5ff', '#d4f0ff', '#fffde7', '#f3e5f5', '#fce4ec'];
    const count   = isSparkle ? 24 : 16;
    const baseDur = isSparkle ? 0.9  : 0.7;
    const durVar  = isSparkle ? 0.5  : 0.35;
    const timeout = isSparkle ? 2000 : 1400;

    const W  = panel.offsetWidth  || 300;
    const H  = panel.offsetHeight || 400;
    const cx = W * 0.5;
    const cy = H * 0.62;

    for (let i = 0; i < count; i++) {
        const p  = document.createElement('span');
        p.className = 'chat-hug-particle';
        const ox = (Math.random() - 0.5) * 44;
        const oy = (Math.random() - 0.5) * 30;
        const tx = (Math.random() - 0.5) * (isSparkle ? 90 : 74);
        const ty = -(44 + Math.random() * (isSparkle ? 96 : 76));
        const sz = 3 + Math.random() * 5;
        p.style.left             = (cx + ox - sz / 2) + 'px';
        p.style.top              = (cy + oy - sz / 2) + 'px';
        p.style.width            = sz + 'px';
        p.style.height           = sz + 'px';
        p.style.background       = COLORS[Math.floor(Math.random() * COLORS.length)];
        p.style.animationDuration = (baseDur + Math.random() * durVar) + 's';
        p.style.animationDelay    = (Math.random() * 0.22) + 's';
        p.style.setProperty('--tx', tx + 'px');
        p.style.setProperty('--ty', ty + 'px');
        container.appendChild(p);
    }

    setTimeout(() => container.remove(), timeout);
}

// /kiss — soft pink radial sparkle burst (respects reduced-motion).
// variant='sparkle': rare upgrade — more particles, subtle golden tones, longer fade.
function triggerKissSparkle(variant) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const panel = document.getElementById('chatPanel') ||
                  document.getElementById('w95-win-chat');
    if (!panel) return;

    const container = document.createElement('div');
    container.className = 'chat-kiss-container';
    panel.appendChild(container);

    const isSparkle = variant === 'sparkle';
    const COLORS = isSparkle
        ? ['#ffb3c6', '#ff69b4', '#ffc0cb', '#ff8fab', '#ffccd5', '#ff4d6d', '#ffd700', '#ffe08a', '#fff0a0']
        : ['#ffb3c6', '#ff69b4', '#ffc0cb', '#ff8fab', '#ffccd5', '#ff4d6d'];
    const COUNT   = isSparkle ? 24 : 16;
    const baseDur = isSparkle ? 0.85 : 0.65;
    const durVar  = isSparkle ? 0.5  : 0.35;
    const timeout = isSparkle ? 1900 : 1300;

    const W  = panel.offsetWidth  || 300;
    const H  = panel.offsetHeight || 400;
    const cx = W * 0.5;
    const cy = H * 0.58;

    for (let i = 0; i < COUNT; i++) {
        const p     = document.createElement('span');
        p.className = 'chat-kiss-particle';
        const angle = (i / COUNT) * Math.PI * 2 + (Math.random() - 0.5) * 0.6;
        const dist  = isSparkle ? 56 + Math.random() * 72 : 46 + Math.random() * 58;
        const tx    = Math.cos(angle) * dist;
        const ty    = Math.sin(angle) * dist;
        const sz    = 3 + Math.random() * 5;
        const ox    = (Math.random() - 0.5) * 20;
        const oy    = (Math.random() - 0.5) * 20;
        p.style.left             = (cx + ox - sz / 2) + 'px';
        p.style.top              = (cy + oy - sz / 2) + 'px';
        p.style.width            = sz + 'px';
        p.style.height           = sz + 'px';
        p.style.background       = COLORS[Math.floor(Math.random() * COLORS.length)];
        p.style.animationDuration = (baseDur + Math.random() * durVar) + 's';
        p.style.animationDelay    = (Math.random() * 0.18) + 's';
        p.style.setProperty('--tx', tx + 'px');
        p.style.setProperty('--ty', ty + 'px');
        container.appendChild(p);
    }

    setTimeout(() => container.remove(), timeout);
}

// ---- GOLDEN KISS SYNC ----
// Detects when both users sent /kiss within 2 minutes of each other.
// Triggers once per sync pair (tracked by timestamp key), client-side for both users.
function checkGoldenKissSync(messages) {
    const now = Date.now();
    const SYNC_WINDOW_MS = 2 * 60 * 1000; // 2 minutes
    const MAX_AGE_MS     = 5 * 60 * 1000; // ignore kiss commands older than 5 minutes

    const kissCmds = messages.filter(m =>
        m.kind === 'system' &&
        m.systemType === 'command' &&
        m.command === 'kiss' &&
        (now - (m.timestamp || 0)) < MAX_AGE_MS
    );

    // Check all pairs from different authors within the sync window
    for (let i = 0; i < kissCmds.length; i++) {
        for (let j = i + 1; j < kissCmds.length; j++) {
            const a = kissCmds[i];
            const b = kissCmds[j];
            if (a.author === b.author) continue;
            if (Math.abs((a.timestamp || 0) - (b.timestamp || 0)) > SYNC_WINDOW_MS) continue;

            // Stable key: lower timestamp first
            const ts1 = Math.min(a.timestamp || 0, b.timestamp || 0);
            const ts2 = Math.max(a.timestamp || 0, b.timestamp || 0);
            const key = `${ts1}_${ts2}`;
            if (_goldenSyncShown.has(key)) continue;

            _goldenSyncShown.add(key);
            triggerGoldenSync();
            return; // one sync event per listener call
        }
    }
}

// Golden radial sparkle burst — used for the Golden Echo sync event.
function triggerGoldenKissSparkle() {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const panel = document.getElementById('chatPanel') ||
                  document.getElementById('w95-win-chat');
    if (!panel) return;

    const container = document.createElement('div');
    container.className = 'chat-kiss-container';
    panel.appendChild(container);

    const COLORS = ['#ffd700', '#ffec5c', '#fff0a0', '#ffe08a', '#ffc107', '#fff9c4', '#fffde7', '#ffe566'];
    const W     = panel.offsetWidth  || 300;
    const H     = panel.offsetHeight || 400;
    const cx    = W * 0.5;
    const cy    = H * 0.5;
    const COUNT = 28;

    for (let i = 0; i < COUNT; i++) {
        const p     = document.createElement('span');
        p.className = 'chat-kiss-particle';
        const angle = (i / COUNT) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
        const dist  = 60 + Math.random() * 80;
        const tx    = Math.cos(angle) * dist;
        const ty    = Math.sin(angle) * dist;
        const sz    = 3 + Math.random() * 6;
        const ox    = (Math.random() - 0.5) * 20;
        const oy    = (Math.random() - 0.5) * 20;
        p.style.left             = (cx + ox - sz / 2) + 'px';
        p.style.top              = (cy + oy - sz / 2) + 'px';
        p.style.width            = sz + 'px';
        p.style.height           = sz + 'px';
        p.style.background       = COLORS[Math.floor(Math.random() * COLORS.length)];
        p.style.animationDuration = (1.0 + Math.random() * 0.6) + 's';
        p.style.animationDelay    = (Math.random() * 0.25) + 's';
        p.style.setProperty('--tx', tx + 'px');
        p.style.setProperty('--ty', ty + 'px');
        container.appendChild(p);
    }

    setTimeout(() => container.remove(), 2600);
}

// Shows the golden sparkle burst and the "Golden Echo" system message overlay.
function triggerGoldenSync() {
    triggerGoldenKissSparkle();

    const panel = document.getElementById('chatPanel') ||
                  document.getElementById('w95-win-chat');
    if (!panel) return;

    const msg = document.createElement('div');
    msg.className = 'chat-golden-sync-msg';
    msg.textContent = 'Golden Echo \u2728 \u2014 In sync.';
    panel.appendChild(msg);
    setTimeout(() => msg.remove(), 4500);
}

// ---- CHAT ----
function formatChatTime(ts) {
    if (!ts) return '';
    return new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function renderChat(messages, updateKind = 'update') {
    const body = document.getElementById('chatBody');
    if (!body) return;

    // Capture scroll state before touching the DOM
    const prevScrollTop = body.scrollTop;
    const nearBottom = body.scrollHeight - body.scrollTop - body.clientHeight <= 80;

    const htmlParts = [];
    let currentGroup = null;

    function flushGroup() {
        if (!currentGroup) return;
        const g = currentGroup;
        currentGroup = null;
        const me = g.author === currentUser;
        const emoji = AUTHOR_EMOJI[g.author] || '[?]';
        const lastTs = g.msgs[g.msgs.length - 1].timestamp;
        const bubbles = g.msgs.map(m => {
            const reactionEntries = Object.entries(m.reactions || {});
            const reactionsHtml = reactionEntries.length > 0
                ? `<div class="chat-reactions">${reactionEntries.map(([user, rxVal]) => {
                    const display = EMOTICON_MAP[rxVal] || rxVal;
                    return `<span class="chat-reaction${user === currentUser ? ' mine' : ''}">${safeText(display)}</span>`;
                  }).join('')}</div>`
                : '';
            return `<div class="chat-bubble" ondblclick="openReactionPicker('${m.id}', this)">${safeText(m.text)}${reactionsHtml}</div>`;
        }).join('');
        const label = me ? '' : `<div class="chat-group-label">${safeText(g.author)} ${emoji}</div>`;
        htmlParts.push(`
            <div class="chat-group chat-group--${me ? 'me' : 'other'}">
                ${label}
                ${bubbles}
                <div class="chat-group-time">${safeText(formatChatTime(lastTs))}</div>
            </div>
        `);
    }

    for (const m of messages) {
        // System messages (slash commands) render inline without grouping
        if (m.kind === 'system') {
            flushGroup();
            const style = m.style || '';
            let sysHtml;
            if (style === 'whisper') {
                sysHtml = `<div class="chat-system-msg chat-system-msg--whisper" aria-live="polite">` +
                    `<span class="chat-whisper-prefix">~${safeText(m.author)} whispers:</span> ` +
                    `<em>${safeText(m.text)}</em></div>`;
            } else if (style === 'echo') {
                sysHtml = `<div class="chat-system-msg chat-system-msg--echo" aria-live="polite">` +
                    `<span class="chat-echo-text">${safeText(m.text)}</span>` +
                    `<span class="chat-echo-ghost" aria-hidden="true">${safeText(m.text)}</span>` +
                    `</div>`;
            } else if (style === 'fade') {
                sysHtml = `<div class="chat-system-msg chat-system-msg--fade" aria-live="polite">` +
                    `${safeText(m.text)}</div>`;
            } else if (style === 'memory') {
                sysHtml = `<div class="chat-system-msg chat-system-msg--memory" aria-live="polite">` +
                    `<span class="chat-memory-label">✦ Memory ✦</span>` +
                    `<span class="chat-memory-text">${safeText(m.text)}</span>` +
                    `</div>`;
            } else {
                sysHtml = `<div class="chat-system-msg" aria-live="polite">${safeText(m.text)}</div>`;
            }
            htmlParts.push(sysHtml);
            continue;
        }
        // Group consecutive normal messages from the same author within 5 minutes
        if (!currentGroup) {
            currentGroup = { author: m.author, msgs: [m] };
        } else {
            const gap = m.timestamp - currentGroup.msgs[currentGroup.msgs.length - 1].timestamp;
            if (currentGroup.author === m.author && gap < 300000) {
                currentGroup.msgs.push(m);
            } else {
                flushGroup();
                currentGroup = { author: m.author, msgs: [m] };
            }
        }
    }
    flushGroup();

    body.innerHTML = htmlParts.join('');

    if (updateKind === 'initial' || (updateKind === 'new' && nearBottom)) {
        // Initial load or new message when already at bottom: scroll to bottom
        body.scrollTop = body.scrollHeight;
        _hideChatNewMsgBtn();
    } else if (updateKind === 'new' && !nearBottom) {
        // New message but user is scrolled up: preserve position, show indicator
        body.scrollTop = prevScrollTop;
        _showChatNewMsgBtn();
    } else {
        // Reaction/edit update: preserve scroll position exactly
        body.scrollTop = prevScrollTop;
    }
}

function _showChatNewMsgBtn() {
    document.getElementById('chatNewMsgBtn')?.classList.remove('hidden');
}

function _hideChatNewMsgBtn() {
    document.getElementById('chatNewMsgBtn')?.classList.add('hidden');
}

function updateChatUnread(messages) {
    const unread = messages.filter(m => m.timestamp > lastChatSeenTs && m.author !== currentUser).length;
    const badge = document.getElementById('chatUnread');
    if (!badge) return;
    if (unread > 0 && !chatOpen) {
        badge.textContent = unread;
        badge.classList.remove('hidden');
    } else {
        badge.classList.add('hidden');
    }
}

// (chat onValue listener is in setupDBListeners())

let _activePicker = null;

function _closeReactionPicker() {
    if (_activePicker) {
        _activePicker.remove();
        _activePicker = null;
    }
}

window.openReactionPicker = function(msgId, bubbleEl) {
    window.getSelection()?.removeAllRanges(); // clear text selection from dblclick
    _closeReactionPicker();

    const EMOTICONS = ['<3', 'xD', ':('];
    const msg = lastChatMessages.find(m => m.id === msgId);
    const stored = msg?.reactions?.[currentUser] || null;
    // Normalize any legacy emoji stored in Firebase so the selected state shows correctly
    const myReaction = stored ? (EMOTICON_MAP[stored] || stored) : null;

    const picker = document.createElement('div');
    picker.className = 'chat-reaction-picker';
    picker.setAttribute('role', 'dialog');

    // Build buttons via DOM so <3 is never mis-parsed as an HTML tag
    for (const e of EMOTICONS) {
        const btn = document.createElement('button');
        btn.className = 'reaction-pick-btn' + (e === myReaction ? ' selected' : '');
        btn.textContent = e;
        btn.addEventListener('click', () => { window.sendChatReaction(msgId, e); });
        picker.appendChild(btn);
    }

    picker.style.visibility = 'hidden';
    document.body.appendChild(picker);

    const pRect = picker.getBoundingClientRect();
    const bRect = bubbleEl.getBoundingClientRect();
    const left  = bRect.left + bRect.width / 2 - pRect.width / 2;
    const top   = bRect.top - pRect.height - 6;
    picker.style.left = Math.max(4, Math.min(left, window.innerWidth - pRect.width - 4)) + 'px';
    picker.style.top  = Math.max(4, top) + 'px';
    picker.style.visibility = '';

    _activePicker = picker;
    setTimeout(() => document.addEventListener('click', _closeReactionPicker, { once: true }), 0);
};

window.sendChatReaction = async function(msgId, emoticon) {
    _closeReactionPicker();
    const msg = lastChatMessages.find(m => m.id === msgId);
    if (!msg) return;
    const reactions = { ...(msg.reactions || {}) };
    // Normalize any legacy emoji before comparing so toggling works even on old data
    const stored = reactions[currentUser];
    const storedNormalized = stored ? (EMOTICON_MAP[stored] || stored) : null;
    if (storedNormalized === emoticon) {
        delete reactions[currentUser]; // same emoticon → remove
    } else {
        reactions[currentUser] = emoticon; // new or different emoticon → set
    }
    await update(ref(database, `chat/${msgId}`), { reactions });
};

window.toggleChat = function() {
    if (!currentUser) return;
    chatOpen = !chatOpen;
    const panel = document.getElementById('chatPanel');
    if (!panel) return;
    panel.classList.toggle('show', chatOpen);

    if (chatOpen) {
        lastChatSeenTs = Date.now();
        localStorage.setItem('chatSeenTs', String(lastChatSeenTs));
        document.getElementById('chatUnread')?.classList.add('hidden');

        renderChat(lastChatMessages, 'initial');
        _hideChatNewMsgBtn();

        // One-time hint so the double-click affordance is discoverable
        if (!localStorage.getItem('chatReactionHintSeen')) {
            localStorage.setItem('chatReactionHintSeen', '1');
            setTimeout(() => showToast('Double-click any message to react ❤️ 😂 😢'), 900);
        }

        setTimeout(() => document.getElementById('chatInput')?.focus(), 80);
    }
};

function closeChat(silent) {
    stopChatTyping();
    chatOpen = false;
    document.getElementById('chatPanel')?.classList.remove('show');
    if (!silent) document.getElementById('chatUnread')?.classList.add('hidden');
}

// Clear the "New messages" indicator when the user scrolls to the bottom
document.getElementById('chatBody')?.addEventListener('scroll', () => {
    const body = document.getElementById('chatBody');
    if (!body) return;
    if (body.scrollHeight - body.scrollTop - body.clientHeight <= 80) {
        _hideChatNewMsgBtn();
    }
});

// Clicking "New messages" scrolls to the bottom and clears the indicator
document.getElementById('chatNewMsgBtn')?.addEventListener('click', () => {
    const body = document.getElementById('chatBody');
    if (body) body.scrollTop = body.scrollHeight;
    _hideChatNewMsgBtn();
});

const chatInput = document.getElementById('chatInput');

if (chatInput) {
// Auto-expand textarea as user types; also start typing indicator
chatInput.addEventListener('input', () => {
    chatInput.style.height = 'auto';
    chatInput.style.height = Math.min(chatInput.scrollHeight, 140) + 'px';
    startChatTyping();
    _acUpdate();
});

chatInput.addEventListener('keydown', async (e) => {
    // ---- Autocomplete keyboard navigation ----
    if (_acEl && !_acEl.classList.contains('hidden')) {
        const items = _acEl.querySelectorAll('.chat-autocomplete__item');
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            _acSetActive(Math.min(_acIndex + 1, items.length - 1));
            return;
        }
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            _acSetActive(Math.max(_acIndex - 1, 0));
            return;
        }
        if (e.key === 'Tab') {
            e.preventDefault();
            const target = _acIndex >= 0 ? items[_acIndex] : items[0];
            if (target && !target.classList.contains('chat-autocomplete__item--locked')) {
                _acFill(target.querySelector('.chat-autocomplete__cmd-name').textContent.slice(1));
            }
            return;
        }
        if (e.key === 'Escape') {
            e.preventDefault();
            _acClose();
            return;
        }
        if (e.key === 'Enter' && !e.shiftKey && _acIndex >= 0 && items[_acIndex]) {
            e.preventDefault();
            if (!items[_acIndex].classList.contains('chat-autocomplete__item--locked')) {
                chatInput.value = items[_acIndex].querySelector('.chat-autocomplete__cmd-name').textContent;
            }
            _acClose();
            // fall through to the normal Enter send handler below
        }
    }
    // ---- End autocomplete ----
    if (e.key !== 'Enter') return;
    if (e.shiftKey) return;
    e.preventDefault();

    stopChatTyping();          // clear "typing" immediately on send

    const text = chatInput.value.trim();
    if (!text) return;
    if (!throttle('chat-send', 800)) return;

    chatInput.value = '';
    chatInput.style.height = 'auto';
    _acClose();

    // Handle slash commands — pushed to Firebase as system entries, but DO count as didChat.
    if (await handleSlashCommand(text)) {
        sparkSound('chat');
        fireCatEvent('sparkle');
        if (currentUser) {
            const _cToday  = localDateStr();
            const _chatTs  = Date.now();
            dailyActions[_cToday] = dailyActions[_cToday] || {};
            dailyActions[_cToday].didChat    = true;
            dailyActions[_cToday].lastChatTs = _chatTs;
            update(ref(database, 'userStats/' + currentUser), {
                [`dailyActions/${_cToday}/didChat`]:    true,
                [`dailyActions/${_cToday}/lastChatTs`]: _chatTs,
            }).catch(() => {});
            checkMythics();
        }
        return;
    }

    await push(chatRef, {
        author: currentUser,
        text,
        timestamp: Date.now()
    });

    fireCatEvent('sparkle');
    sparkSound('chat');

    // Mythic: track daily chat action
    if (currentUser) {
        const _cToday  = localDateStr();
        const _chatTs  = Date.now();
        dailyActions[_cToday] = dailyActions[_cToday] || {};
        dailyActions[_cToday].didChat    = true;
        dailyActions[_cToday].lastChatTs = _chatTs;
        update(ref(database, 'userStats/' + currentUser), {
            [`dailyActions/${_cToday}/didChat`]:    true,
            [`dailyActions/${_cToday}/lastChatTs`]: _chatTs,
        }).catch(() => {});
        checkMythics();
    }
});
}

// ---- SLASH COMMAND AUTOCOMPLETE ----
const _acEl    = document.getElementById('chatAutocomplete');
let   _acIndex = -1;

function _acGetMatches(val) {
    if (!val.startsWith('/')) return [];
    const typed   = val.slice(1).toLowerCase();
    const legacy  = Object.keys(SLASH_COMMANDS);
    const xpNames = XP_CHAT_COMMANDS.map(c => c.name);
    const allCmds = [...legacy, ...xpNames];
    if (!typed) return allCmds;
    // Hide dropdown when the input is an exact command match (already fully typed)
    if (allCmds.includes(typed)) return [];
    return allCmds.filter(c => c.startsWith(typed));
}

function _acSetActive(idx) {
    if (!_acEl) return;
    const items = _acEl.querySelectorAll('.chat-autocomplete__item');
    items.forEach((el, i) => {
        const active = i === idx;
        el.classList.toggle('chat-autocomplete__item--active', active);
        el.setAttribute('aria-selected', String(active));
        if (active) el.id = 'chat-ac-active'; else el.removeAttribute('id');
    });
    _acIndex = idx;
    if (idx >= 0 && items[idx]) items[idx].scrollIntoView({ block: 'nearest' });
    if (chatInput) {
        if (idx >= 0) chatInput.setAttribute('aria-activedescendant', 'chat-ac-active');
        else chatInput.removeAttribute('aria-activedescendant');
    }
}

function _acFill(cmd) {
    if (!chatInput) return;
    const xpDef = XP_CHAT_COMMANDS.find(c => c.name === cmd);
    chatInput.value = '/' + cmd + (xpDef?.args ? ' ' : '');
    chatInput.style.height = 'auto';
    chatInput.style.height = Math.min(chatInput.scrollHeight, 140) + 'px';
    _acClose();
    chatInput.focus();
}

function _acClose() {
    if (!_acEl) return;
    _acEl.classList.add('hidden');
    _acEl.innerHTML = '';
    _acIndex = -1;
    if (chatInput) {
        chatInput.setAttribute('aria-expanded', 'false');
        chatInput.removeAttribute('aria-activedescendant');
    }
}

function _acOpen(matches) {
    if (!_acEl) return;
    _acIndex = -1;
    _acEl.innerHTML = '';
    matches.forEach(cmd => {
        const xpDef   = XP_CHAT_COMMANDS.find(c => c.name === cmd);
        const isLocked = xpDef ? xpTotal < xpDef.requiredXP : false;

        const li = document.createElement('li');
        li.className = 'chat-autocomplete__item' + (isLocked ? ' chat-autocomplete__item--locked' : '');
        li.setAttribute('role', 'option');
        li.setAttribute('aria-selected', 'false');

        const nameSpan = document.createElement('span');
        nameSpan.className = 'chat-autocomplete__cmd-name';
        nameSpan.textContent = '/' + cmd;
        li.appendChild(nameSpan);

        if (isLocked) {
            const badge = document.createElement('span');
            badge.className = 'chat-autocomplete__xp-badge';
            badge.textContent = xpDef.requiredXP + ' XP';
            li.appendChild(badge);
        } else if (xpDef?.args) {
            const argsSpan = document.createElement('span');
            argsSpan.className = 'chat-autocomplete__args';
            argsSpan.textContent = xpDef.args;
            li.appendChild(argsSpan);
        }

        li.addEventListener('mousedown', e => {
            e.preventDefault(); // prevent blur before fill
            if (isLocked) { showXpLockAlert(xpDef.requiredXP); return; }
            _acFill(cmd);
        });
        _acEl.appendChild(li);
    });
    _acEl.classList.remove('hidden');
    if (chatInput) chatInput.setAttribute('aria-expanded', 'true');
}

function _acUpdate() {
    if (!chatInput || !_acEl) return;
    const matches = _acGetMatches(chatInput.value);
    if (matches.length) _acOpen(matches);
    else _acClose();
}

// Close dropdown when clicking outside the input area
document.addEventListener('click', e => {
    if (_acEl && !_acEl.classList.contains('hidden')) {
        const positioner = document.querySelector('.chat-input-positioner');
        if (positioner && !positioner.contains(e.target)) _acClose();
    }
});



// ---- XP COMMAND TRIGGER FUNCTIONS ----

// Dispatch a received XP command to its visual trigger (called for both users via Firebase).
function triggerXpCommandEffect(msg) {
    switch (msg.command) {
        case 'sparkle':      triggerXpSparkle(); break;
        case 'glow':         triggerXpGlow(); break;
        case 'pulse':        triggerXpPulse(); break;
        case 'tint':         triggerXpTint(msg.tintVariant); break;
        case 'warm':         triggerXpWarm(msg.tintIntensity); break;
        // whisper/echo/fade/memory: pure render — no extra side-effect needed
    }
}

// /sparkle — glitter particles around the last chat bubble (~2s).
function triggerXpSparkle() {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const body = document.getElementById('chatBody');
    if (!body) return;
    const bubbles = body.querySelectorAll('.chat-bubble');
    const target  = bubbles[bubbles.length - 1];
    if (!target) return;

    // Ensure container positioning
    const savedPos = target.style.position;
    target.style.position = 'relative';

    const container = document.createElement('div');
    container.className = 'chat-sparkle-container';
    target.appendChild(container);

    const CHARS = ['✦', '✧', '⋆', '✺', '✸', '✹', '✻', '✼', '★', '✱'];
    const COUNT = 12;
    for (let i = 0; i < COUNT; i++) {
        const s = document.createElement('span');
        s.className = 'chat-sparkle-particle';
        s.textContent = CHARS[Math.floor(Math.random() * CHARS.length)];
        const angle = (i / COUNT) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
        const dist  = 28 + Math.random() * 22;
        s.style.setProperty('--tx', Math.cos(angle) * dist + 'px');
        s.style.setProperty('--ty', Math.sin(angle) * dist + 'px');
        s.style.animationDelay    = (Math.random() * 0.25) + 's';
        s.style.animationDuration = (0.9 + Math.random() * 0.6) + 's';
        container.appendChild(s);
    }
    setTimeout(() => {
        container.remove();
        if (!savedPos) target.style.removeProperty('position');
        else target.style.position = savedPos;
    }, 2200);
}

// /glow — softly glow the chat panel background (~5s).
function triggerXpGlow() {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const panel = document.getElementById('chatPanel') || document.getElementById('w95-win-chat');
    if (!panel) return;
    panel.classList.remove('chat-xp-glow');
    void panel.offsetWidth;
    panel.classList.add('chat-xp-glow');
    setTimeout(() => panel.classList.remove('chat-xp-glow'), 5200);
}

// /pulse — gentle pulse animation on the chat panel (~3s).
function triggerXpPulse() {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const panel = document.getElementById('chatPanel') || document.getElementById('w95-win-chat');
    if (!panel) return;
    panel.classList.remove('chat-xp-pulse');
    void panel.offsetWidth;
    panel.classList.add('chat-xp-pulse');
    setTimeout(() => panel.classList.remove('chat-xp-pulse'), 3200);
}

// /tint warm|cool|rose — tint the chat body for ~20s then revert.
function triggerXpTint(variant) {
    const body = document.getElementById('chatBody');
    if (!body) return;
    const VARIANTS = ['warm', 'cool', 'rose'];
    VARIANTS.forEach(v => body.classList.remove('chat-tint-' + v));
    body.classList.add('chat-tint-' + (VARIANTS.includes(variant) ? variant : 'warm'));
    setTimeout(() => VARIANTS.forEach(v => body.classList.remove('chat-tint-' + v)), 20000);
}

// /warm <0–100> — warm tint with variable intensity for ~20s then revert.
function triggerXpWarm(intensity) {
    const body = document.getElementById('chatBody');
    if (!body) return;
    // Clear any existing class-based tint so they don't conflict
    ['warm', 'cool', 'rose'].forEach(v => body.classList.remove('chat-tint-' + v));
    const alpha = (Math.min(100, Math.max(0, intensity ?? 100)) / 100 * 0.15).toFixed(3);
    body.style.background = `rgba(255,190,110,${alpha})`;
    body.style.transition = 'background 1s';
    setTimeout(() => {
        body.style.background = '';
        body.style.transition = '';
    }, 20000);
}

// /bloom — brightness/saturation boost on the garden for ~5s.
function triggerXpBloom() {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const gardenBody = document.getElementById('w95-win-garden')?.querySelector('.w95-body');
    if (!gardenBody) return;
    gardenBody.classList.remove('garden-xp-bloom');
    void gardenBody.offsetWidth;
    gardenBody.classList.add('garden-xp-bloom');
    setTimeout(() => gardenBody.classList.remove('garden-xp-bloom'), 5200);
}

// /rain · /snow · /comet · /fireflies — overlay in the garden window.
function triggerGardenOverlay(type, durationMs) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const gardenWin = document.getElementById('w95-win-garden');
    if (!gardenWin) return;

    // Remove any existing overlay of the same type
    gardenWin.querySelector(`.garden-xp-overlay--${type}`)?.remove();

    const overlay = document.createElement('div');
    overlay.className = `garden-xp-overlay garden-xp-overlay--${type}`;

    if (type === 'rain') {
        for (let i = 0; i < 40; i++) {
            const d = document.createElement('div');
            d.className = 'garden-rain-drop';
            d.style.left              = (Math.random() * 110 - 5) + '%';
            d.style.animationDelay    = (Math.random() * 1.5) + 's';
            d.style.animationDuration = (0.35 + Math.random() * 0.35) + 's';
            overlay.appendChild(d);
        }
    } else if (type === 'snow') {
        const FLAKES = ['❄', '❅', '❆', '·', '✦'];
        for (let i = 0; i < 28; i++) {
            const f = document.createElement('div');
            f.className = 'garden-snow-flake';
            f.textContent = FLAKES[Math.floor(Math.random() * FLAKES.length)];
            f.style.left              = (Math.random() * 110 - 5) + '%';
            f.style.fontSize          = (7 + Math.random() * 9) + 'px';
            f.style.opacity           = (0.6 + Math.random() * 0.4).toFixed(2);
            f.style.animationDelay    = (Math.random() * 4) + 's';
            f.style.animationDuration = (2.5 + Math.random() * 2.5) + 's';
            overlay.appendChild(f);
        }
    } else if (type === 'fireflies') {
        for (let i = 0; i < 14; i++) {
            const ff = document.createElement('div');
            ff.className = 'garden-firefly';
            ff.style.left             = (8 + Math.random() * 84) + '%';
            ff.style.top              = (15 + Math.random() * 65) + '%';
            ff.style.animationDelay   = (Math.random() * 3) + 's';
            ff.style.animationDuration = (1.8 + Math.random() * 2.2) + 's';
            overlay.appendChild(ff);
        }
    } else if (type === 'comet') {
        const comet = document.createElement('div');
        comet.className = 'garden-comet';
        overlay.appendChild(comet);
    }

    gardenWin.appendChild(overlay);
    setTimeout(() => overlay.remove(), durationMs + 500);
}

// /constellation — star overlay (~20s). Night only; daytime runs anyway but subtle.
function triggerXpConstellation() {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const gardenWin = document.getElementById('w95-win-garden');
    if (!gardenWin) return;

    gardenWin.querySelector('.garden-xp-overlay--constellation')?.remove();

    const h = new Date().getHours();
    const isNight = h < 6 || h >= 20;

    const overlay = document.createElement('div');
    overlay.className = 'garden-xp-overlay garden-xp-overlay--constellation' +
        (isNight ? '' : ' garden-xp-overlay--constellation-day');

    for (let i = 0; i < 22; i++) {
        const s = document.createElement('div');
        s.className = 'garden-constellation-star';
        s.style.left             = (4 + Math.random() * 92) + '%';
        s.style.top              = (4 + Math.random() * 70) + '%';
        s.style.animationDelay   = (Math.random() * 2) + 's';
        s.style.animationDuration = (1.5 + Math.random() * 2) + 's';
        s.style.width = s.style.height = (1.5 + Math.random() * 2.5) + 'px';
        overlay.appendChild(s);
    }

    gardenWin.appendChild(overlay);
    setTimeout(() => overlay.remove(), 20500);
}

// ---- ABOUT MODAL ----
function openAbout() {
    document.getElementById('aboutModal').classList.add('show');
    setTimeout(() => document.getElementById('aboutClose')?.focus(), 50);
}
function closeAbout() {
    document.getElementById('aboutModal').classList.remove('show');
}

// ---- NET STATUS ----
(function initNetStatus() {
    const ns = document.getElementById('netStatus');
    function update() {
        if (navigator.onLine) ns.classList.remove('offline');
        else ns.classList.add('offline');
    }
    window.addEventListener('online',  update);
    window.addEventListener('offline', update);
    update();
})();

// ---- TOAST ----
function showToast(msg) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => {
        toast.classList.add('hiding');
        setTimeout(() => toast.remove(), 300);
    }, 2200);
}

// ============================================================
//  STATIC HTML EVENT WIRING
//  Replaces all inline onclick / oninput / onchange attributes
//  that were removed from index.html.
// ============================================================

// Login
document.getElementById('loginGoogleBtn')?.addEventListener('click', () => signInWithGoogle());
document.getElementById('signOutDeniedBtn')?.addEventListener('click', () => signOut(auth));

// Header
document.getElementById('feedTitle')?.addEventListener('click', () => resetToAll());
document.getElementById('darkModeBtn')?.addEventListener('click', () => toggleDarkMode());
document.getElementById('notifBtn')?.addEventListener('click', () => toggleNotifications());
document.getElementById('userIndicator')?.addEventListener('click', () => logout());

// Main nav
document.getElementById('navAddPost')?.addEventListener('click', () => openTypePickerModal());
document.getElementById('navCollections')?.addEventListener('click', () => openCollectionsModal());
document.getElementById('navSources')?.addEventListener('click', () => openSourcesModal());

// Active filters banner
document.getElementById('clearFiltersBtn')?.addEventListener('click', () => clearAllExtraFilters());

// Filter tabs
document.getElementById('btnAll')?.addEventListener('click', () => setFilter('all'));
document.getElementById('btnNew')?.addEventListener('click', () => setFilter('new'));
document.getElementById('btnSeen')?.addEventListener('click', () => setFilter('seen'));
document.getElementById('btnFav')?.addEventListener('click', () => setFilter('fav'));
document.getElementById('btnWatchLater')?.addEventListener('click', () => setFilter('watch-later'));
document.getElementById('btnOtherUser')?.addEventListener('click', () => setFilter('just-other'));
document.getElementById('btnArchived')?.addEventListener('click', () => setFilter('archived'));
document.getElementById('btnMarkAll')?.addEventListener('click', () => markAllSeen());

// Search
document.getElementById('searchInput')?.addEventListener('input', e => setSearch(e.target.value));
document.getElementById('searchClear')?.addEventListener('click', () => clearSearch());

// Empty state
document.getElementById('emptyStateAddBtn')?.addEventListener('click', () => openTypePickerModal());

// Keyboard shortcuts modal
document.getElementById('shortcutsModalClose')?.addEventListener('click', () => closeShortcutsModal());
document.getElementById('shortcutsModal')?.addEventListener('click', e => {
    if (e.target.id === 'shortcutsModal') closeShortcutsModal();
});

// Type picker modal
document.getElementById('typePickerModalClose')?.addEventListener('click', () => closeTypePickerModal());
document.getElementById('typePickerModal')?.addEventListener('click', e => {
    if (e.target.id === 'typePickerModal') closeTypePickerModal();
});
document.getElementById('typePickLink')?.addEventListener('click', () => {
    closeTypePickerModal(); openAddPostModal();
});
document.getElementById('typePickPhoto')?.addEventListener('click', () => {
    closeTypePickerModal(); openImageModal();
});
document.getElementById('typePickPoll')?.addEventListener('click', () => {
    closeTypePickerModal(); openPollModal();
});
document.getElementById('typePickMovie')?.addEventListener('click', () => {
    closeTypePickerModal(); openMovieModal();
});
document.getElementById('typePickText')?.addEventListener('click', () => {
    closeTypePickerModal(); openTextPostModal();
});

// Poll modal
document.getElementById('pollModalClose')?.addEventListener('click', () => closePollModal());
document.getElementById('pollModal')?.addEventListener('click', e => {
    if (e.target.id === 'pollModal') closePollModal();
});
document.getElementById('createPollBtn')?.addEventListener('click', () => addPoll());

// Image modal
document.getElementById('imageModalClose')?.addEventListener('click', () => closeImageModal());
document.getElementById('imageModal')?.addEventListener('click', e => {
    if (e.target.id === 'imageModal') closeImageModal();
});
document.getElementById('imageFile')?.addEventListener('change', function() { previewImage(this); });
document.getElementById('sharePhotoBtn')?.addEventListener('click', () => addImagePost());

// Movie / rec modal
document.getElementById('movieModalClose')?.addEventListener('click', () => closeMovieModal());
document.getElementById('movieModal')?.addEventListener('click', e => {
    if (e.target.id === 'movieModal') closeMovieModal();
});
document.getElementById('mediaTypeMovie')?.addEventListener('click', function() { setMediaType('movie', this); });
document.getElementById('mediaTypeShow')?.addEventListener('click',  function() { setMediaType('show',  this); });
[1, 2, 3, 4, 5].forEach(n => {
    document.getElementById(`star${n}`)?.addEventListener('click', () => setRating(n));
});
document.getElementById('addMovieRecBtn')?.addEventListener('click', () => addMovieRec());

// Add post modal
document.getElementById('addPostModalClose')?.addEventListener('click', () => closeAddPostModal());
document.getElementById('addPostModal')?.addEventListener('click', e => {
    if (e.target.id === 'addPostModal') closeAddPostModal();
});
document.getElementById('addPostBtn')?.addEventListener('click', () => addPost());

// Collection picker pills (event delegation on static picker in add-post modal)
document.getElementById('collectionPicker')?.addEventListener('click', e => {
    const btn = e.target.closest('.coll-pick-btn');
    if (btn && !btn.classList.contains('coll-pick-add-btn')) toggleCollPick(btn);
});

// Collections modal
document.getElementById('collectionsModalClose')?.addEventListener('click', () => closeCollectionsModal());
document.getElementById('collectionsModal')?.addEventListener('click', e => {
    if (e.target.id === 'collectionsModal') { closeCollectionsModal(); return; }
    const item = e.target.closest('[data-collection]');
    if (item && item.closest('#collectionsModal')) filterByCollection(item.dataset.collection || null);
});

// Add Category modal
document.getElementById('addCategoryModal')?.addEventListener('click', e => {
    if (e.target.id === 'addCategoryModal') closeAddCategoryModal();
});
document.getElementById('newCatName')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') saveNewCategory();
});

// Sources modal
document.getElementById('sourcesModalClose')?.addEventListener('click', () => closeSourcesModal());
document.getElementById('sourcesModal')?.addEventListener('click', e => {
    if (e.target.id === 'sourcesModal') { closeSourcesModal(); return; }
    const item = e.target.closest('[data-source]');
    if (item && item.closest('#sourcesModal')) filterBySource(item.dataset.source || null);
});

// Edit modal
document.getElementById('editModalClose')?.addEventListener('click', () => closeEditModal());
document.getElementById('editModal')?.addEventListener('click', e => {
    if (e.target.id === 'editModal') closeEditModal();
});
document.getElementById('editCancelBtn')?.addEventListener('click', () => closeEditModal());
document.getElementById('editSaveBtn')?.addEventListener('click',   () => saveEdit());

// Delete modal
document.getElementById('deleteModal')?.addEventListener('click', e => {
    if (e.target.id === 'deleteModal') closeDeleteModal();
});
document.getElementById('deleteCancelBtn')?.addEventListener('click',  () => closeDeleteModal());
document.getElementById('deleteConfirmBtn')?.addEventListener('click', () => confirmDelete());

// History modal
document.getElementById('historyModalClose')?.addEventListener('click', () => closeHistoryModal());
document.getElementById('historyModal')?.addEventListener('click', e => {
    if (e.target.id === 'historyModal') closeHistoryModal();
});
document.getElementById('historyCloseBtn')?.addEventListener('click', () => closeHistoryModal());

// Notification permission modal
document.getElementById('notifAllowBtn')?.addEventListener('click', () => doRequestNotifPermission());
document.getElementById('notifDenyBtn')?.addEventListener('click',  () => closeNotifPermModal());

// Scroll to top
document.getElementById('scrollTopBtn')?.addEventListener('click', () => {
    const feedBody = getFeedScrollEl();
    if (feedBody) feedBody.scrollTo({ top: 0, behavior: 'smooth' });
    else window.scrollTo({ top: 0, behavior: 'smooth' });
});

// Activity panel
document.getElementById('activityFab')?.addEventListener('click', () => toggleActivityPanel());

// Chat
document.getElementById('chatFab')?.addEventListener('click', () => toggleChat());

// About modal
document.getElementById('aboutBtn')?.addEventListener('click', e => { e.stopPropagation(); openAbout(); });
document.getElementById('aboutClose')?.addEventListener('click', () => closeAbout());
document.getElementById('aboutModal')?.addEventListener('click', e => {
    if (e.target === document.getElementById('aboutModal')) closeAbout();
});

// Board modals
document.getElementById('boardPickerClose')?.addEventListener('click', () => closeModal(document.getElementById('boardPickerModal')));
document.getElementById('boardPickerModal')?.addEventListener('click', e => { if (e.target.id === 'boardPickerModal') closeModal(e.target); });
document.getElementById('createBoardClose')?.addEventListener('click', () => closeModal(document.getElementById('createBoardModal')));
document.getElementById('createBoardModal')?.addEventListener('click', e => { if (e.target.id === 'createBoardModal') closeModal(e.target); });
document.getElementById('createBoardConfirmBtn')?.addEventListener('click', () => createBoard());
// Wishlist modals
document.getElementById('createWishlistBoardClose')?.addEventListener('click', () => closeModal(document.getElementById('createWishlistBoardModal')));
document.getElementById('createWishlistBoardModal')?.addEventListener('click', e => { if (e.target.id === 'createWishlistBoardModal') closeModal(e.target); });
document.getElementById('createWishlistBoardConfirmBtn')?.addEventListener('click', () => createWishlistBoard());
document.getElementById('addWishlistItemClose')?.addEventListener('click', () => closeModal(document.getElementById('addWishlistItemModal')));
document.getElementById('addWishlistItemModal')?.addEventListener('click', e => { if (e.target.id === 'addWishlistItemModal') closeModal(e.target); });
document.getElementById('addWishlistItemConfirmBtn')?.addEventListener('click', () => addWishlistItem());
document.getElementById('composeLetterClose')?.addEventListener('click', () => closeModal(document.getElementById('composeLetterModal')));
document.getElementById('composeLetterModal')?.addEventListener('click', e => { if (e.target.id === 'composeLetterModal') closeModal(e.target); });
document.getElementById('sendLetterBtn')?.addEventListener('click', () => sendLetter());

// Comment typing indicator (event delegation — survives loadPosts DOM rebuilds)
document.getElementById('postsContainer')?.addEventListener('input', e => {
    if (!currentUser) return;
    const ta = e.target.closest('textarea.reply-input');
    if (!ta) return;
    // Derive postId from the textarea's id:
    //   "reply-{postId}"                  → top-level reply input
    //   "inline-input-{postId}-{replyId}" → threaded reply input
    let postId = null;
    if (ta.id.startsWith('reply-')) {
        postId = ta.id.slice('reply-'.length);
    } else if (ta.id.startsWith('inline-input-')) {
        postId = ta.id.split('-')[2];
    }
    if (postId) startCommentTyping(postId);
});

// ===== System Properties dialog with Update History =====
const UPDATE_HISTORY = [
    {
        date: '18-03-26',
        label: 'Chat & Presence',
        items: [
            'Chat windows now inherit the active desktop colour theme — background, text, and borders all match whichever of the six themes you have selected.',
            'Chat message text was almost invisible in several themes because it was inheriting an incorrect colour from the window background — all six themes now render chat text with full contrast.',
            'If you left the page open and your browser paused activity, your presence could get stuck showing as "online" for other users indefinitely — the site now marks you offline when the tab goes to the background or the window loses focus, and cleans up correctly when you leave.',
            'On page load, stale presence entries left over from a previous session were being read as "online" before the realtime listener could correct them — these are now treated as offline immediately so other users never see a ghost presence.',
        ]
    },
    {
        date: '18-03-26',
        label: 'Desktop Icons & Shortcuts',
        items: [
            'You can now create your own desktop shortcuts via New → Shortcut — choose any app from the list, give it a custom label, and it will appear as a new icon on the desktop.',
            'When creating a new shortcut, icons that are not available in the current theme were still appearing as options and causing a broken image — only valid icons for your theme are now shown.',
            'Double-clicking a shortcut in the "New Shortcut" list now immediately confirms the selection, matching the expected Windows 95 behaviour.',
            'When the "New Shortcut" or "New Category" dialog was opened, the first item in the list was being highlighted as if already selected — the dialog now opens with no pre-selection.',
            'If you had "Auto Arrange" enabled and dragged an icon to a new position, the grid snapped it back immediately on mouse-up — manually dragging an icon now temporarily disables Auto Arrange so your chosen position is respected.',
            'Deleting a built-in .exe icon and then using Arrange by Name or Auto Arrange was leaving gaps in the icon grid where the deleted icon used to be — hidden icons are now excluded from the arrangement so the remaining icons pack together without gaps.',
        ]
    },
    {
        date: '17-03-26',
        label: 'Desktop & File System',
        items: [
            'You can now drag any desktop icon directly onto the Recycle Bin icon to delete it, matching real Windows 95 behaviour.',
            'Deleting a custom item (shortcut, text file, folder icon) now moves it to the Recycle Bin rather than permanently destroying it, so you can restore it later.',
            'Desktop icons can be dragged and dropped onto a folder icon to move them inside — the folder window updates immediately to reflect the new contents.',
            'Opening a folder window on the desktop now shows all its contents — custom items, app shortcuts, and text files — in a browsable list.',
            'Right-clicking the desktop now offers New Folder and New Text Document options. An ambience sounds player was also added to fill your desktop with background atmosphere.',
            'If you drag a window upward while the cat is perched on it and it loses room to stand, the cat is now knocked off gracefully rather than clipping into the titlebar.',
            'After dragging an item into a folder the folder window was incorrectly displaying as empty — this has been fixed. Unused toolbar buttons were also removed from folder windows.',
        ]
    },
    {
        date: '17-03-26',
        label: 'Themes & Readability',
        items: [
            'In pastel theme with dark mode enabled, many labels and inputs inside the settings window were invisible against the background — all text elements are now readable.',
            'Theme colours are now applied to every previously un-themed element: context menus, the system tray area, desktop icon labels, and all dark-mode variants of each theme.',
            'The Console window terminal text was nearly invisible on pastel and some other themes because background and foreground colours were too similar — contrast has been corrected for all themes.',
            'A full readability pass was made across all six themes and dark mode: low-contrast text, barely visible icons, and illegible window labels have all been fixed.',
        ]
    },
    {
        date: '17-03-26',
        label: 'Achievements & XP',
        items: [
            'The achievements window was opening at full content height (often extremely tall), making it hard to position — it now opens at a sensible 420 px by default.',
            'When multiple achievements unlock at the same time (e.g. on first launch), the window was re-rendering after each one individually — it now batches the updates and renders once at the end, making it much faster.',
            'XP earned from achievements that were unlocked before the current system was introduced was not being counted toward your displayed total — this has been backfilled correctly.',
            'Level and XP calculations were running before achievement unlock operations had finished, causing your displayed level to lag one step behind — the order of operations is now correct.',
        ]
    },
    {
        date: '17-03-26',
        label: 'Windows, Cat & Feed',
        items: [
            'Windows can now be resized by dragging any of the four edges or four corners — previously only the bottom-right corner worked. Scrolling inside a window no longer accidentally triggers a resize.',
            'Cat accessories (hats, glasses, bows, etc.) were rendering offset or stacked in the wrong layer relative to the cat sprite — positions and z-order have been corrected for every accessory type.',
            'You can now create your own feed categories (e.g. "Design", "Music") to group and filter posts beyond the built-in set.',
            'If you try to call the cat onto a window that is too close to the top of the screen, it now shows a small "no room up here!" message instead of silently doing nothing.',
            'The pixel cat was attempting to jump onto windows that did not have enough space above them for it to perch, causing it to disappear or glitch — it now checks for clearance before jumping.',
            'Windows that were wider than the viewport could get stuck or lose their saved size when dragged — dragging now snaps them correctly and width is restored on next open.',
            'The garden window could be resized too narrow, hiding some plant tiles — a minimum width is now enforced so all 8 columns remain visible at all times.',
            'Achievements earned and console commands unlocked now also appear as entries in the taskbar notifications panel, giving you a persistent record alongside the popup.',
            'Window dragging behaviour was overhauled for a smoother feel, the internal scroll structure inside windows was refactored, scrollbars are now subtler, and font sizes scale correctly at different viewport sizes.',
            'The "Rainy Day" achievement (earned by visiting while it is raining) was incorrectly showing its unlock popup on every page refresh instead of just once — fixed.',
        ]
    },
    {
        date: '17-03-26',
        label: 'Sound & Ambient',
        items: [
            'Each of the five sound packs (Classic, Soft, Chiptune, Nature, Lo-fi) now has its own fully synthesised audio — every UI interaction such as clicking, opening windows, and hovering sounds distinct depending on your chosen pack.',
            'Ambient connections were woven between different parts of the site — for example, rain in the garden now influences certain sound effects, and your Jukebox mood can affect the active screensaver.',
        ]
    },
    {
        date: '16-03-26',
        label: 'Link Previews & Themes',
        items: [
            'Link previews in posts have been upgraded to richer, platform-specific media cards: YouTube shows thumbnail and duration, Spotify shows album art and track info, GitHub shows repo name and star count, and so on.',
            'All windows can now be resized by dragging their edges. Each window remembers its size and position individually and restores them between sessions.',
            'All six desktop colour themes (Classic, Dark, Sakura, Ocean, Forest, Sunset) are now fully applied across every UI element — windows, menus, icons, taskbar, and tray.',
            'The notification panel is no longer a child of the taskbar in the DOM — this fixes it appearing behind other windows when opened and ensures it always renders on top.',
            'Notification windows were sometimes appearing behind other windows, and were occasionally showing notifications intended for a different logged-in user — both issues are fixed.',
            'Some screensavers were showing the wrong name and description in the settings panel, and two wallpapers looked nearly identical — names, descriptions, and assets have been corrected.',
            'Whatever accessory you have equipped in the shop (hat, glasses, bow, etc.) now visibly appears on the pixel cat sitting on your desktop.',
            'A JavaScript error was crashing the pixel cat on page load for some browsers due to a missing variable reference in the accessory lookup — fixed.',
        ]
    },
    {
        date: '11-03-26',
        label: 'Posts & Notifications',
        items: [
            'Posts can now be archived to remove them from your main feed without deleting them. A bell icon in the taskbar tray now shows popup notifications for new activity across the site.',
            'Clicking a post in the feed now opens its full content inside its own resizable Windows 95 window, complete with the post body and any comments.',
            'Clicking the timestamp on a feed post now opens it directly in the post detail window for quick access without scrolling.',
            'URL previews in posts used to load one at a time in sequence — they now load in parallel, making feeds with multiple links significantly faster.',
            'X (Twitter) post previews were slow to render due to an inefficient fetch path, and YouTube Shorts links were not generating previews at all — both have been fixed.',
            'Post share links were missing the site\'s GitHub Pages subpath, causing the copied URL to land on a 404 — the full pathname is now included.',
            'Text and icon colours in dark mode and some themes were too low-contrast to read comfortably — contrast levels have been corrected across the board.',
        ]
    },
    {
        date: '17-02-26',
        label: 'Initial Launch',
        items: [
            'The achievements system was rebuilt from scratch with a proper progression model — you earn XP from actions across the site and level up to unlock new features rather than just passively tracking stats.',
            'A central reward registry now manages all unlockable content (wallpapers, themes, console commands, cat accessories) so every part of the app can grant and verify unlocks in a consistent way.',
            'The unlock system is now connected to the desktop UI — earning an achievement immediately makes newly unlocked themes, commands, and accessories available without needing to refresh.',
            '20 achievements were added under the "First Transmission" set, covering milestones such as first post, first chat message, first garden action, and more — each with a corresponding reward.',
            'The boot screen was sometimes freezing on first load due to an initialisation timing issue — the order in which Firebase, the app scope, and the boot screen IIFE execute has been corrected so the site always starts cleanly.',
            'Legacy UI elements left over from an earlier design (floating action buttons for chat, an old About modal, and a What\'s New panel) have been removed to make way for the Windows 95 interface.',
            'The Start Menu and desktop .exe icons were broken because a required DOM element had been accidentally removed during a refactor — restored.',
        ]
    },
];

function openSystemPropertiesDialog() {
    const ua = navigator.userAgent;
    const cpu = ua.includes('Win') ? 'x86' : ua.includes('Mac') ? 'ARM/x86' : 'x86';

    const overlay = document.createElement('div');
    overlay.className = 'w95-dialog-overlay';

    const historyHtml = UPDATE_HISTORY.map((group, i) => `
        <div class="sys-props-update-group">
            <div class="sys-props-update-date">${group.date} — ${group.label}</div>
            <ul class="sys-props-update-list">
                ${group.items.map(item => `<li>${item}</li>`).join('')}
            </ul>
        </div>
    `).join('');

    overlay.innerHTML = `
        <div class="w95-dialog sys-props-dialog" role="dialog" aria-modal="true">
            <div class="w95-titlebar window--active">
                <div class="w95-title">System Properties</div>
                <div class="w95-controls">
                    <button class="w95-control w95-control-close sys-props-close" type="button" aria-label="Close">X</button>
                </div>
            </div>
            <div class="sys-props-tabs">
                <button class="sys-props-tab sys-props-tab--active" data-tab="general">General</button>
                <button class="sys-props-tab" data-tab="updates">Update History</button>
            </div>
            <div class="sys-props-body">
                <div class="sys-props-panel" data-panel="general">
                    <div class="sys-props-general">
                        <div class="sys-props-logo">💻</div>
                        <div class="sys-props-info">
                            <div class="sys-props-product">Personal Feed</div>
                            <div class="sys-props-version">Version 1.0</div>
                            <hr class="sys-props-hr">
                            <div><b>Operating System:</b> Windows 95</div>
                            <div><b>Processor:</b> ${cpu}, ~66 MHz</div>
                            <div><b>Memory:</b> 16.0 MB RAM</div>
                            <hr class="sys-props-hr">
                            <div class="sys-props-registered">Registered to: You ♥</div>
                        </div>
                    </div>
                </div>
                <div class="sys-props-panel sys-props-panel--hidden" data-panel="updates">
                    <div class="sys-props-updates-scroll">
                        ${historyHtml}
                    </div>
                </div>
            </div>
            <div class="w95-dialog-btns">
                <button class="w95-btn w95-dialog-btn sys-props-close" type="button">OK</button>
            </div>
        </div>`;

    document.body.appendChild(overlay);

    function close() {
        overlay.remove();
        document.removeEventListener('keydown', onKey);
    }

    overlay.querySelectorAll('.sys-props-close').forEach(btn => btn.addEventListener('click', close));
    overlay.addEventListener('pointerdown', e => { if (e.target === overlay) close(); });

    overlay.querySelectorAll('.sys-props-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            overlay.querySelectorAll('.sys-props-tab').forEach(t => t.classList.remove('sys-props-tab--active'));
            overlay.querySelectorAll('.sys-props-panel').forEach(p => p.classList.add('sys-props-panel--hidden'));
            tab.classList.add('sys-props-tab--active');
            overlay.querySelector(`[data-panel="${tab.dataset.tab}"]`).classList.remove('sys-props-panel--hidden');
        });
    });

    function onKey(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);

    setTimeout(() => overlay.querySelector('.sys-props-close')?.focus(), 0);
}

// ===== Reusable Win95-style dialog =====
// openW95Dialog({ icon, title, message, buttons: [{label, action}] })
// Returns { close } — Esc also closes; last button with null action = cancel.
function openW95Dialog({ icon = '', title = 'Windows', message = '', buttons = [{ label: 'OK', action: null }] } = {}) {
    const overlay = document.createElement('div');
    overlay.className = 'w95-dialog-overlay';

    const bHtml = buttons.map(b =>
        `<button class="w95-btn w95-dialog-btn" type="button">${b.label}</button>`
    ).join('');

    const iconHtml = icon ? `<div class="w95-dialog-icon">${icon}</div>` : '';

    overlay.innerHTML = `
        <div class="w95-dialog" role="dialog" aria-modal="true">
            <div class="w95-titlebar window--active">
                <div class="w95-title">${title}</div>
                <div class="w95-controls">
                    <button class="w95-control w95-control-close w95-dialog-x" type="button" aria-label="Close">X</button>
                </div>
            </div>
            <div class="w95-dialog-body">
                ${iconHtml}
                <div class="w95-dialog-message"></div>
            </div>
            <div class="w95-dialog-btns">${bHtml}</div>
        </div>`;

    // Set message safely as text content (supports newlines via white-space:pre-wrap in CSS)
    overlay.querySelector('.w95-dialog-message').textContent = message;
    document.body.appendChild(overlay);

    function close() {
        overlay.remove();
        document.removeEventListener('keydown', onKey);
    }

    const btnEls = overlay.querySelectorAll('.w95-dialog-btn');
    btnEls.forEach((btn, i) => {
        btn.addEventListener('click', () => { close(); buttons[i]?.action?.(); });
    });
    overlay.querySelector('.w95-dialog-x')?.addEventListener('click', close);
    overlay.addEventListener('pointerdown', e => { if (e.target === overlay) close(); });

    function onKey(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);

    setTimeout(() => btnEls[0]?.focus(), 0);
    return { close };
}

// ===== Win95-style prompt dialog (single text input) =====
function openW95Prompt({ icon = '', title = 'New', message = '', defaultValue = '', onOK } = {}) {
    const overlay = document.createElement('div');
    overlay.className = 'w95-dialog-overlay';
    overlay.innerHTML = `
        <div class="w95-dialog" role="dialog" aria-modal="true">
            <div class="w95-titlebar window--active">
                <div class="w95-title">${title}</div>
                <div class="w95-controls">
                    <button class="w95-control w95-control-close w95-dialog-x" type="button" aria-label="Close">X</button>
                </div>
            </div>
            <div class="w95-dialog-body">
                ${icon ? `<div class="w95-dialog-icon">${icon}</div>` : ''}
                <div style="flex:1">
                    <div class="w95-dialog-message"></div>
                    <input type="text" class="w95-prompt-input" style="width:100%;margin-top:6px;box-sizing:border-box;" autocomplete="off">
                </div>
            </div>
            <div class="w95-dialog-btns">
                <button class="w95-btn w95-dialog-btn" type="button">OK</button>
                <button class="w95-btn w95-dialog-btn" type="button">Cancel</button>
            </div>
        </div>`;
    overlay.querySelector('.w95-dialog-message').textContent = message;
    const inp = overlay.querySelector('.w95-prompt-input');
    inp.value = defaultValue;
    document.body.appendChild(overlay);
    function close() { overlay.remove(); document.removeEventListener('keydown', onKey); }
    function confirm() { const v = inp.value.trim() || defaultValue; close(); onOK?.(v); }
    const [okBtn, cancelBtn] = overlay.querySelectorAll('.w95-dialog-btn');
    okBtn.addEventListener('click', confirm);
    cancelBtn.addEventListener('click', close);
    overlay.querySelector('.w95-dialog-x').addEventListener('click', close);
    overlay.addEventListener('pointerdown', e => { if (e.target === overlay) close(); });
    function onKey(e) { if (e.key === 'Escape') close(); else if (e.key === 'Enter') confirm(); }
    document.addEventListener('keydown', onKey);
    setTimeout(() => { inp.focus(); inp.select(); }, 0);
}

// ===== Win95-style Notepad dialog (editable text file) =====
function openW95Notepad(item, { onSave } = {}) {
    const overlay = document.createElement('div');
    overlay.className = 'w95-dialog-overlay';
    const safeTitle = item.name.replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
    overlay.innerHTML = `
        <div class="w95-dialog" role="dialog" aria-modal="true" style="width:440px;max-width:95vw;">
            <div class="w95-titlebar window--active">
                <div class="w95-title">📝 ${safeTitle}</div>
                <div class="w95-controls">
                    <button class="w95-control w95-control-close w95-dialog-x" type="button" aria-label="Close">X</button>
                </div>
            </div>
            <div class="w95-dialog-body" style="flex-direction:column;align-items:stretch;padding:8px;">
                <textarea class="w95-notepad-area" style="width:100%;height:220px;resize:vertical;font-family:monospace;font-size:13px;padding:6px;box-sizing:border-box;"></textarea>
            </div>
            <div class="w95-dialog-btns">
                <button class="w95-btn w95-dialog-btn" type="button">Save</button>
                <button class="w95-btn w95-dialog-btn" type="button">Close</button>
            </div>
        </div>`;
    const textarea = overlay.querySelector('textarea');
    textarea.value = item.content || '';
    document.body.appendChild(overlay);
    function close() { overlay.remove(); document.removeEventListener('keydown', onKey); }
    const [saveBtn, closeBtn2] = overlay.querySelectorAll('.w95-dialog-btn');
    saveBtn.addEventListener('click', () => {
        item.content = textarea.value;
        if (onSave) {
            onSave(item.content);
        } else {
            const items = window._desktopCustom?.getItems() || [];
            const found = items.find(i => i.id === item.id);
            if (found) { found.content = item.content; window._desktopCustom?.saveItems(items); }
        }
        close();
    });
    closeBtn2.addEventListener('click', close);
    overlay.querySelector('.w95-dialog-x').addEventListener('click', close);
    overlay.addEventListener('pointerdown', e => { if (e.target === overlay) close(); });
    function onKey(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);
    setTimeout(() => textarea.focus(), 0);
}

// ===== Win95 window z-index management (bring-to-front) =====
let w95TopZ = 2000;

// ===== Win95 shared window manager =====
const w95Mgr = (() => {
  const _maxState = {}; // winId -> { isMax, prevRect }
  let _activeWinId = null;
  const _btns = {}; // winId -> taskbar btn element

  function addTaskbarBtn(winId, label, onToggle) {
    const taskbar = document.getElementById('w95-taskbar');
    if (!taskbar) return null;
    const btn = document.createElement('button');
    btn.className = 'w95-btn';
    btn.type = 'button';
    btn.textContent = label;
    // 3-way toggle: hidden→show | visible+active→minimize | visible+inactive→focus
    btn.addEventListener('click', () => {
      const win = document.getElementById(winId);
      if (!win || win.classList.contains('is-hidden')) {
        onToggle();
      } else if (_activeWinId === winId) {
        onToggle();
      } else {
        focusWindow(winId);
      }
    });
    const trayEl = document.getElementById('systemTray') || taskbar.querySelector('.w95-tray');
    if (trayEl) taskbar.insertBefore(btn, trayEl);
    else taskbar.appendChild(btn);
    _btns[winId] = btn;
    return btn;
  }

  function setPressed(btn, pressed) {
    if (!btn) return;
    btn.classList.toggle('is-pressed', pressed);
  }

  function focusWindow(winId) {
    // Clean up any detached btn references
    Object.keys(_btns).forEach(id => { if (!_btns[id].isConnected) delete _btns[id]; });
    // Clear active state from all windows and taskbar buttons
    document.querySelectorAll('.w95-window').forEach(w => w.classList.remove('window--active'));
    Object.values(_btns).forEach(b => b.classList.remove('is-active'));
    _activeWinId = null;
    if (!winId) return;
    const win = document.getElementById(winId);
    if (!win || win.classList.contains('is-hidden')) return;
    win.classList.add('window--active');
    win.style.zIndex = ++w95TopZ;
    _activeWinId = winId;
    if (_btns[winId]) _btns[winId].classList.add('is-active');
  }

  function isActiveWin(winId) { return _activeWinId === winId; }

  function toggleMaximise(win, winId) {
    if (!_maxState[winId]) _maxState[winId] = { isMax: false, prevRect: null };
    const st = _maxState[winId];
    if (st.isMax) {
      win.classList.remove('is-maximised');
      if (st.prevRect) {
        const r = st.prevRect;
        win.style.left   = r.left + 'px';
        win.style.top    = r.top  + 'px';
        win.style.width  = r.w    + 'px';
        win.style.height = r.h    + 'px';
      }
      st.isMax = false;
    } else {
      const r = win.getBoundingClientRect();
      st.prevRect = { left: r.left, top: r.top, w: r.width, h: r.height };
      win.classList.add('is-maximised');
      st.isMax = true;
    }
  }

  function isMaximised(winId) { return !!_maxState[winId]?.isMax; }

  // Used by w95Layout on page load to re-seed in-memory max state from localStorage
  function restoreMaxState(winId, prevRect) {
    if (!_maxState[winId]) _maxState[winId] = { isMax: false, prevRect: null };
    _maxState[winId].isMax = true;
    _maxState[winId].prevRect = prevRect || null;
  }

  return { addTaskbarBtn, setPressed, focusWindow, isActiveWin, toggleMaximise, isMaximised, restoreMaxState };
})();

// ===== Window layout persistence (size / position / max state) =====
const w95Layout = (() => {
  const TASKBAR_H = 40;
  const MIN_VIS   = 60; // px of window that must remain on-screen

  function _key(winId)  { return 'w95_layout_' + winId; }
  function _load(winId) {
    try { return JSON.parse(localStorage.getItem(_key(winId))); } catch (e) { return null; }
  }
  function _store(winId, data) {
    try { localStorage.setItem(_key(winId), JSON.stringify(data)); } catch (e) {}
  }

  /** Persist current size/position.  No-op when window is maximised. */
  function save(winEl, winId) {
    if (w95Mgr.isMaximised(winId)) return;
    const r = winEl.getBoundingClientRect();
    const existing = _load(winId) || {};
    _store(winId, { ...existing, left: r.left, top: r.top, w: r.width, h: r.height });
  }

  /** Persist maximise state; call with the pre-maximise rect when maximising. */
  function saveMaxState(winId, isMax, prevRect) {
    const existing = _load(winId) || {};
    _store(winId, { ...existing, isMax, prevRect: prevRect || existing.prevRect || null });
  }

  /** Apply saved layout to window element.  Returns the stored data (or null). */
  function restore(winEl, winId) {
    const data = _load(winId);
    if (!data) return null;
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight - TASKBAR_H;
    if (data.w) {
      const cssMinW = parseFloat(getComputedStyle(winEl).minWidth) || 200;
      winEl.style.width  = Math.max(cssMinW, Math.min(vw, data.w)) + 'px';
    }
    if (data.h) {
      const cssMinH = parseFloat(getComputedStyle(winEl).minHeight) || 80;
      winEl.style.height = Math.max(cssMinH, Math.min(vh, data.h)) + 'px';
    }
    const w    = data.w || winEl.offsetWidth  || 280;
    const h    = data.h || winEl.offsetHeight || 200;
    const left = Math.max(MIN_VIS - w, Math.min(vw - MIN_VIS, data.left ?? 20));
    const top  = Math.max(0,           Math.min(vh - MIN_VIS, data.top  ?? 20));
    winEl.style.left = left + 'px';
    winEl.style.top  = top  + 'px';
    return data;
  }

  /** Push a visible, non-maximised window back inside the viewport. */
  function clamp(winEl) {
    if (winEl.classList.contains('is-maximised') || winEl.classList.contains('is-hidden')) return;
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight - TASKBAR_H;
    const r  = winEl.getBoundingClientRect();
    const left = Math.max(MIN_VIS - r.width,  Math.min(vw - MIN_VIS, r.left));
    const top  = Math.max(0,                  Math.min(vh - MIN_VIS, r.top));
    if (Math.round(left) !== Math.round(r.left)) winEl.style.left = left + 'px';
    if (Math.round(top)  !== Math.round(r.top))  winEl.style.top  = top  + 'px';
    if (r.height > vh) winEl.style.height = vh + 'px';
  }

  return { save, saveMaxState, restore, clamp };
})();

// Wrap toggleMaximise so maximise/restore state is persisted to localStorage.
{
  const _orig = w95Mgr.toggleMaximise;
  w95Mgr.toggleMaximise = function (win, winId) {
    const wasMax = w95Mgr.isMaximised(winId);
    // Capture pre-maximise rect before the original handler runs
    let prevRect = null;
    if (!wasMax) {
      const r = win.getBoundingClientRect();
      prevRect = { left: r.left, top: r.top, w: r.width, h: r.height };
    }
    _orig(win, winId);
    w95Layout.saveMaxState(winId, w95Mgr.isMaximised(winId), prevRect);
  };
}

// Registry so desktop icons can open windows via a shared open() callback
const w95Apps = {};

// ===== Win95 Our Garden Window + Shared Firebase Garden =====
(() => {
  let btn = null;
  const win    = document.getElementById('w95-win-garden');
  const min    = document.getElementById('w95-garden-min');
  const max    = document.getElementById('w95-garden-max');
  const closeBtn = document.getElementById('w95-garden-close');
  const handle = document.getElementById('w95-garden-handle');

  if (!win || !min || !handle) return;

  const tilesRowEl     = document.getElementById('garden-tiles-row');
  const streakEl       = document.getElementById('garden-streak');
  const sharedStreakEl = document.getElementById('garden-shared-streak');
  const gardenBodyEl   = win.querySelector('.w95-body');
  const weatherDisplayEl = document.getElementById('garden-weather');

  const gardenRef  = ref(database, 'garden');
  const ritualEl   = document.getElementById('garden-ritual');
  const MS_HOUR    = 3600000;

  // Returns "YYYY-MM-DD" in local time for a given ms timestamp.
  function tsToLocalDate(ts) {
    const d = new Date(ts);
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  const PLANT_LABELS = {
    sunflower:      'Sunflower',
    daisy:          'Daisy',
    tulip:          'Tulip',
    rose:           'Rose',
    orchid:         'Orchid',
    lavender:       'Lavender',
    twocolourbloom: 'Two-colour Bloom',
    mint:           'Mint',
    fern:           'Fern',
    wildflower:     'Wildflower',
  };
  const UNLOCK_THRESHOLDS = [
    { streak: 3,  id: 'daisy' },
    { streak: 7,  id: 'tulip' },
    { streak: 14, id: 'rose' },
    { streak: 30, id: 'orchid' },
  ];
  const COOP_UNLOCK_THRESHOLDS = [
    { streak: 3,  id: 'sunflower' },
    { streak: 7,  id: 'lavender' },
    { streak: 14, id: 'twocolourbloom' },
  ];
  const EXPLORE_UNLOCKS = [
    { id: 'mint',      threshold: 5,  field: 'postsCount' },
    { id: 'fern',      threshold: 10, field: 'messagesCount' },
    { id: 'wildflower', threshold: 5, field: 'taggedPostsCount' },
  ];
  const GARDEN_USER_KEY = { El: 'el', Tero: 'tero' };
  const GARDEN_COOP_USERS    = ['el', 'tero'];
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
  const STAGE_LABELS    = { seed: 'Seed', sprout: 'Sprout', bud: 'Bud', bloom: 'Bloom', wilted: 'Wilted' };
  const TOTAL_SLOTS = 8;
  // Bloom count thresholds to unlock each slot (index = slot number)
  const TILE_UNLOCK_THRESHOLDS = [0, 1, 5, 10, 15, 20, 25, 30];

  // Tracks which flower type to plant into an empty slot (set by global dropdown, never touches planted slots)
  let selectedFlower = 'sunflower';

  // ---- calculateStage: unchanged ----
  function calculateStage(state) {
    const now = Date.now();
    const { plantedAt, lastWatered } = state;
    const ageHrs = (now - plantedAt) / MS_HOUR;
    const wateredHrsAgo = lastWatered ? (now - lastWatered) / MS_HOUR : Infinity;

    // Wilted: was alive past seed stage but not watered for 48h
    if (ageHrs >= 24 && wateredHrsAgo >= 48) return 'wilted';

    if (ageHrs < 24) return 'seed';
    if (ageHrs < 40) return lastWatered ? 'sprout' : 'seed';

    // Bud: 40-68h, watered within 32h — flower forming but not yet open
    if (ageHrs < 68 && wateredHrsAgo < 32) return 'bud';

    // 68h+: full bloom if watered within last 24h
    if (wateredHrsAgo < 24) return 'bloom';

    // Watered but not recently enough for bloom
    return lastWatered ? 'sprout' : 'seed';
  }

  // ---- Exploration unlock counts (reads Firebase once per water press) ----
  async function computeExploreUnlocks(currentUnlocked) {
    try {
      const [postsSnap, chatSnap] = await Promise.all([get(postsRef), get(chatRef)]);
      const postsObj   = postsSnap.val() || {};
      const postsArr   = Object.values(postsObj);
      const counts = {
        postsCount:      postsArr.length,
        messagesCount:   chatSnap.exists() ? Object.keys(chatSnap.val() || {}).length : 0,
        taggedPostsCount: postsArr.filter(p => Array.isArray(p.collections) && p.collections.length > 0).length,
      };
      const newUnlocked = [...currentUnlocked];
      for (const u of EXPLORE_UNLOCKS) {
        if (counts[u.field] >= u.threshold && !newUnlocked.includes(u.id)) {
          newUnlocked.push(u.id);
        }
      }
      return newUnlocked;
    } catch { return currentUnlocked; }
  }

  // ---- Per-tile rendering ----
  // Ensures tile column DOM nodes exist in the row (called once at startup)
  function ensureTileColumns() {
    for (let n = 0; n < TOTAL_SLOTS; n++) {
      if (!tilesRowEl.querySelector(`[data-tile="${n}"]`)) {
        const col = document.createElement('div');
        col.dataset.tile = String(n);
        tilesRowEl.appendChild(col);
      }
    }
    // Passive fireflies — hidden via CSS until garden--night class is active
    if (!tilesRowEl.querySelector('.garden-passive-firefly')) {
      const FF_POSITIONS = [
        [12, 22], [30, 38], [55, 18], [72, 42], [88, 28],
      ];
      FF_POSITIONS.forEach(([l, t], i) => {
        const ff = document.createElement('span');
        ff.className = 'garden-passive-firefly';
        ff.style.left = l + '%';
        ff.style.top  = t + '%';
        ff.style.setProperty('--ff-delay', (i * 0.9) + 's');
        ff.style.setProperty('--ff-dur',   (3.2 + i * 0.7) + 's');
        tilesRowEl.appendChild(ff);
      });
    }
  }

  function renderTile(n, tileData, isUnlocked) {
    const col = tilesRowEl.querySelector(`[data-tile="${n}"]`);
    if (!col) return;

    // ---- Locked state ----
    if (!isUnlocked) {
      if (!col.classList.contains('garden-tile-col--locked')) {
        col.className = 'garden-tile-col garden-tile-col--locked';
        col.innerHTML =
          `<div class="garden-soil-tile"><span class="garden-lock-hint">?</span></div>`;
      }
      return;
    }

    // ---- Determine occupied vs empty and rebuild HTML if state changed ----
    const isOccupied = !!tileData;
    if (col.dataset.occupied !== String(isOccupied)) {
      // Grass blades vary by tile position for organic feel
      const gv = `garden-grass--v${(n % 3) + 1}`;
      // Pebbles on tiles beyond the first two
      const pebble = n >= 2 ? `<span class="garden-pebble garden-pebble--${(n % 3) + 1}"></span>` : '';
      col.className = `garden-tile-col garden-tile-col--v${(n % 3) + 1}`;
      col.dataset.occupied = String(isOccupied);
      if (isOccupied) {
        col.innerHTML =
          `<div class="garden-soil-tile">` +
            `<div class="garden-plant-el"></div>` +
            `<div class="garden-tile-events"></div>` +
            `<span class="garden-grass ${gv}"></span>${pebble}` +
          `</div>` +
          `<div class="garden-tile-status-el"></div>`;
      } else {
        col.className += ' garden-tile-col--empty';
        col.innerHTML =
          `<div class="garden-soil-tile">` +
            `<div class="garden-plant garden-plant--seed"></div>` +
            `<span class="garden-grass ${gv}"></span>${pebble}` +
          `</div>` +
          `<div class="garden-tile-actions">` +
            `<button class="w95-btn garden-plant-btn" data-tile="${n}">Plant</button>` +
          `</div>`;
      }
    }

    if (!isOccupied) return; // empty slot rendering complete

    // ---- Occupied slot: update visuals ----
    const plantType = tileData.flowerType || tileData.selectedPlant || 'sunflower';
    const stage     = calculateStage(tileData);

    // Plant visual
    const plantDiv = col.querySelector('.garden-plant-el');
    if (plantDiv) {
      const prevStage = plantDiv.dataset.prevStage;
      plantDiv.className = `garden-plant garden-plant--${stage} garden-plant--type-${plantType}`;
      if (prevStage && prevStage !== stage) {
        plantDiv.classList.add('garden-plant--stage-change');
        setTimeout(() => plantDiv.classList.remove('garden-plant--stage-change'), 800);
      }
      plantDiv.dataset.prevStage = stage;
    }

    // Tile status: flower name + stage + watered time
    const statusDiv = col.querySelector('.garden-tile-status-el');
    if (statusDiv) {
      const wateredAgo = tileData.lastWatered
        ? Math.round((Date.now() - tileData.lastWatered) / MS_HOUR) : null;
      const wateredText = wateredAgo === null ? 'never'
        : wateredAgo === 0 ? 'just now' : `${wateredAgo}h ago`;
      statusDiv.textContent =
        `${PLANT_LABELS[plantType] || plantType} · ${STAGE_LABELS[stage] || stage} · ${wateredText}`;
    }

    // Event overlays — stored events from Firebase plus client-computed mushroom
    const eventsDiv = col.querySelector('.garden-tile-events');
    if (eventsDiv) {
      const stored    = Array.isArray(tileData.events) ? tileData.events : [];
      const allEvents = [...stored];
      if (stage === 'wilted' && !allEvents.includes('mushroom')) {
        const wiltedSince = tileData.lastWatered
          ? tileData.lastWatered + 48 * MS_HOUR
          : (tileData.plantedAt ? tileData.plantedAt + 24 * MS_HOUR : null);
        if (wiltedSince && (Date.now() - wiltedSince) >= 7 * 86400000) {
          allEvents.push('mushroom');
        }
      }
      eventsDiv.innerHTML = allEvents
        .map(ev => `<span class="garden-event garden-event--${ev}"></span>`)
        .join('');
    }
  }

  // ---- renderPlantSelector: global dropdown in the info panel for choosing which flower to plant ----
  function renderPlantSelector(unlockedPlants) {
    const plantRowEl = document.getElementById('gpr-0');
    if (!plantRowEl) return;
    const effectiveUnlocks = unlockedPlants.filter(id => id !== 'sunflower');
    if (effectiveUnlocks.length === 0) {
      if (!plantRowEl.querySelector('.garden-label')) {
        plantRowEl.innerHTML =
          `<span class="garden-label">Plant: ${PLANT_LABELS.sunflower}</span>` +
          `<div class="garden-help">Water daily to unlock more</div>`;
      }
      selectedFlower = 'sunflower';
    } else {
      let sel = plantRowEl.querySelector('select');
      if (!sel) {
        plantRowEl.innerHTML =
          `<label for="gps-plant" class="garden-label">Plant:</label>` +
          `<select id="gps-plant" class="w95-select"></select>`;
        sel = plantRowEl.querySelector('select');
        sel.onchange = () => { selectedFlower = sel.value; };
      }
      // Rebuild options only when the list changes (avoids dismissing open dropdown)
      const expectedCount = 1 + effectiveUnlocks.length;
      if (sel.options.length !== expectedCount) {
        sel.innerHTML = `<option value="sunflower">${PLANT_LABELS.sunflower}</option>`;
        for (const id of unlockedPlants) {
          if (id === 'sunflower') continue;
          if (PLANT_LABELS[id]) {
            const opt = document.createElement('option');
            opt.value = id;
            opt.textContent = PLANT_LABELS[id];
            sel.appendChild(opt);
          }
        }
      }
      // Keep dropdown in sync with selectedFlower (without overriding user's in-progress choice)
      if (!Array.from(sel.options).some(o => o.value === selectedFlower)) {
        selectedFlower = 'sunflower';
      }
      sel.value = selectedFlower;
    }
  }

  // ---- renderGarden: drives the 8 slots + streak rows ----
  function renderGarden(state) {
    if (!state) return;
    const tiles         = state.tiles || {};
    const unlockedPlants = Array.isArray(state.unlockedPlants) ? state.unlockedPlants : [];
    const unlockedTiles = state.unlockedTiles || 1;
    tilesRowEl.dataset.gardenSize = String(unlockedTiles);

    renderPlantSelector(unlockedPlants);

    for (let n = 0; n < TOTAL_SLOTS; n++) {
      renderTile(n, tiles[String(n)] || null, n < unlockedTiles);
    }

    // Individual streak (based on tile 0's wilt state for the 0-display rule)
    if (streakEl) {
      const tile0     = tiles['0'];
      const tile0Stage = tile0 ? calculateStage(tile0) : 'seed';
      const displayStreak = tile0Stage === 'wilted' ? 0 : (state.wateringStreak || 0);
      // comeback_kid: arm flag when streak drops from >=3 to 0
      if (currentWateringStreak >= 3 && displayStreak === 0 && !comebackArmed && currentUser) {
          comebackArmed = true;
          update(ref(database, 'userStats/' + currentUser), { comebackArmed: true }).catch(() => {});
      }
      currentWateringStreak = displayStreak;
      const nextUnlock = UNLOCK_THRESHOLDS.find(u => !unlockedPlants.includes(u.id));
      const nextText   = nextUnlock
        ? ` (next: ${PLANT_LABELS[nextUnlock.id]} at ${nextUnlock.streak})` : '';
      streakEl.textContent =
        `Streak: ${displayStreak} day${displayStreak !== 1 ? 's' : ''}${nextText}`;
    }

    // Shared streak — unchanged logic
    if (sharedStreakEl) {
      const clientToday     = new Date().toISOString().slice(0, 10);
      const clientYesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      const lsd = state.lastSharedDay;
      const displayShared = (!lsd || lsd < clientYesterday) ? 0 : (state.sharedStreak || 0);

      const todayRecord = (state.wateredByDay || {})[clientToday] || {};
      let coopStatus = '';
      if (todayRecord.el && todayRecord.tero)  coopStatus = ' · both watered today';
      else if (todayRecord.el)                 coopStatus = ' · El watered, waiting for Tero';
      else if (todayRecord.tero)               coopStatus = ' · Tero watered, waiting for El';

      const nextCoop = COOP_UNLOCK_THRESHOLDS.find(u =>
        u.id !== 'sunflower' && !unlockedPlants.includes(u.id)
      );
      const nextCoopText = nextCoop
        ? ` (next: ${PLANT_LABELS[nextCoop.id]} at ${nextCoop.streak})` : '';

      sharedStreakEl.textContent =
        `Shared streak: ${displayShared} day${displayShared !== 1 ? 's' : ''}${nextCoopText}${coopStatus}`;
    }

    // Same-day Water Ritual indicator — stays visible all day once both have watered
    if (ritualEl) {
      const todayRec = (state.wateredByDay || {})[localDateStr()] || {};
      const ritualOn = !!(todayRec.el && todayRec.tero);
      ritualEl.textContent  = ritualOn ? 'Ritual active: ✔' : '';
      ritualEl.style.display = ritualOn ? '' : 'none';
    }

    updateWaterGardenBtn();
  }

  // ---- Initialise / migrate ----
  onValue(gardenRef, (snap) => {
    if (!snap.exists()) {
      // New garden: all slots start empty; users plant explicitly via the Plant button
      set(gardenRef, {
        wateringStreak: 0, lastStreakDay:  null,
        unlockedPlants: [],
        sharedStreak:   0, lastSharedDay:  null, wateredByDay: {},
        totalBlooms: 0, unlockedTiles: 1,
        lastWateredByUser: {},
        tiles: {},
      });
    } else {
      const st = snap.val();
      const updates = {};
      // Migrate: existing flat state (no tiles sub-object) → tiles structure
      if (!st.tiles) {
        updates['totalBlooms']       = 0;
        updates['unlockedTiles']     = 1;
        updates['lastWateredByUser'] = {};
        updates['tiles/0'] = {
          slotId:      0,
          flowerType:  st.selectedPlant || 'sunflower',
          plantedAt:   st.plantedAt     || Date.now(),
          lastWatered: st.lastWatered   || null,
          events:      [],
        };
      } else {
        // Migrate: tiles that have selectedPlant but no flowerType
        for (const [key, tile] of Object.entries(st.tiles || {})) {
          if (tile && tile.selectedPlant && !tile.flowerType) {
            updates[`tiles/${key}/flowerType`] = tile.selectedPlant;
            updates[`tiles/${key}/slotId`]     = Number(key);
          }
        }
      }
      if (Object.keys(updates).length > 0) update(gardenRef, updates);
    }
  }, { onlyOnce: true });

  ensureTileColumns();

  // ---- Time-of-day theming (visual only) ----
  const TIME_THEMES = ['garden--dawn','garden--day','garden--dusk','garden--night'];
  function getGardenTimeTheme() {
    const h = new Date().getHours();
    if (h >= 5  && h < 8)  return 'garden--dawn';
    if (h >= 8  && h < 17) return 'garden--day';
    if (h >= 17 && h < 20) return 'garden--dusk';
    return 'garden--night'; // 20:00–04:59
  }
  function applyGardenTheme() {
    if (!gardenBodyEl) return;
    TIME_THEMES.forEach(t => gardenBodyEl.classList.remove(t));
    gardenBodyEl.classList.add(getGardenTimeTheme());
  }
  applyGardenTheme();
  setInterval(applyGardenTheme, 60000);

  // Live render — also ensures today's daily water count is loaded from Firebase
  // before the first paint so the button shows the correct X/3 state.
  onValue(gardenRef, async (snap) => {
    if (currentUser && !(localDateStr() in dailyWaterCounts)) {
      try {
        const todayKey  = localDateStr();
        const countSnap = await get(ref(database, `userStats/${currentUser}/dailyWaterCounts/${todayKey}`));
        dailyWaterCounts[todayKey] = countSnap.val() || 0;
      } catch (e) {
        dailyWaterCounts[localDateStr()] = 0; // prevent repeated fetches on error
      }
    }
    renderGarden(snap.val());
  });

  // ---- Shared Water Garden button state ----
  function updateWaterGardenBtn() {
    const btn = document.getElementById('garden-water-garden-btn');
    if (!btn) return;
    const todayCount   = dailyWaterCounts[localDateStr()] || 0;
    const limitReached = todayCount >= 3;
    const WATER_FLAVOUR = [
      'Water Garden',
      'Watered 1\u20443 today \u2013 A little sip \uD83D\uDCA7',
      'Watered 2\u20443 today \u2013 Growing nicely \uD83C\uDF3F',
      'Watered 3\u20443 today \u2013 Thriving today \uD83C\uDF38',
    ];
    btn.textContent = WATER_FLAVOUR[Math.min(todayCount, 3)];
    btn.disabled    = limitReached;
    btn.classList.toggle('garden-water-btn--done',    limitReached);
    btn.classList.toggle('garden-water-btn--partial', !limitReached && todayCount > 0);
  }

  // ---- Water the whole garden ----
  async function waterGarden() {
    // Step 1 — Reserve a water credit for the current user (per-user daily limit: 3)
    const todayKey      = localDateStr();
    const dailyCountRef = ref(database, `userStats/${currentUser}/dailyWaterCounts/${todayKey}`);

    let newDailyCount;
    try {
      const creditTx = await runTransaction(dailyCountRef, (current) => {
        const count = current || 0;
        if (count >= 3) return undefined; // abort — limit reached
        return count + 1;
      });
      if (!creditTx.committed) {
        showToast("You've used all 3 waters today");
        return;
      }
      newDailyCount = creditTx.snapshot.val();
    } catch (e) {
      console.error(e);
      showToast('Could not water. Please try again.');
      return;
    }

    // Update local daily-count cache
    dailyWaterCounts[todayKey] = newDailyCount;

    // When the 3rd water of the day is reached, update the consecutive 3-water-day streak
    if (newDailyCount === 3) {
      try {
        const yesterday  = localDateStr(-1);
        const streakSnap = await get(ref(database, `userStats/${currentUser}/water3Streak`));
        const prev       = streakSnap.val() || { current: 0, lastDate: null };
        const newStreakVal = {
          current:  prev.lastDate === yesterday ? prev.current + 1 : 1,
          lastDate: todayKey,
        };
        water3Streak = newStreakVal;
        set(ref(database, `userStats/${currentUser}/water3Streak`), newStreakVal).catch(() => {});
      } catch (e) {
        console.error('water3Streak update failed', e);
      }
    }

    const waterBtn = document.getElementById('garden-water-garden-btn');
    if (waterBtn) waterBtn.disabled = true;

    try {
      // Step 2 — Run the garden watering transaction (all occupied tiles)
      const snap  = await get(gardenRef);
      const state = snap.val();
      if (!state) return;

      if (!Object.values(state.tiles || {}).some(Boolean)) {
        showToast('No plants to water yet');
        return;
      }

      // Exploration unlocks checked once per water press
      const withExplore = await computeExploreUnlocks(state.unlockedPlants ?? []);

      const txResult = await runTransaction(gardenRef, (currentState) => {
        if (!currentState) return currentState;

        const now       = Date.now();
        const today     = new Date(now).toISOString().slice(0, 10);
        const yesterday = new Date(now - 86400000).toISOString().slice(0, 10);

        const txTiles         = currentState.tiles || {};
        const occupiedEntries = Object.entries(txTiles).filter(([, t]) => t);
        if (occupiedEntries.length === 0) return currentState;

        // ---- Streak: reset if any tile is wilted ----
        const lastStreakDay  = currentState.lastStreakDay  ?? null;
        const wateringStreak = currentState.wateringStreak ?? 0;
        const anyWilted = occupiedEntries.some(([, t]) => {
          const ageHrs       = t.plantedAt ? (now - t.plantedAt) / MS_HOUR : 0;
          const wateredHrsAgo = t.lastWatered ? (now - t.lastWatered) / MS_HOUR : Infinity;
          return ageHrs >= 24 && wateredHrsAgo >= 48;
        });

        let newStreak;
        if (anyWilted || lastStreakDay === null) {
          newStreak = 1;
        } else if (lastStreakDay === today) {
          newStreak = wateringStreak;
        } else if (lastStreakDay === yesterday) {
          newStreak = wateringStreak + 1;
        } else {
          newStreak = 1;
        }

        // ---- Plant unlocks (merge explore + streak-based) ----
        const newUnlocked = Array.isArray(currentState.unlockedPlants) ? [...currentState.unlockedPlants] : [];
        for (const id of withExplore) {
          if (!newUnlocked.includes(id)) newUnlocked.push(id);
        }
        for (const u of GARDEN_PLANT_UNLOCKS) {
          if (newStreak >= u.streak && !newUnlocked.includes(u.id)) newUnlocked.push(u.id);
        }

        // ---- Shared streak ----
        const whoIsWatering     = GARDEN_USER_KEY[currentUser] ?? null;
        const sharedStreak      = currentState.sharedStreak      ?? 0;
        const lastSharedDay     = currentState.lastSharedDay      ?? null;
        const lastWateredByUser = currentState.lastWateredByUser  ?? {};
        const newWateredByDay   = (typeof currentState.wateredByDay === 'object' && currentState.wateredByDay !== null)
          ? { ...currentState.wateredByDay }
          : {};

        let newSharedStreak  = sharedStreak;
        let newLastSharedDay = lastSharedDay;

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

        // ---- Update lastWateredByUser ----
        const newLastWateredByUser = { ...lastWateredByUser };
        if (whoIsWatering && GARDEN_COOP_USERS.includes(whoIsWatering)) {
          newLastWateredByUser[whoIsWatering] = now;
        }

        // ---- Roll rare events once for the whole watering action ----
        const rolledMoonflower = new Date(now).getUTCHours() === 0 && Math.random() < 0.3;
        const otherCoopUser    = GARDEN_COOP_USERS.find(u => u !== whoIsWatering);
        const otherTs          = (lastWateredByUser || {})[otherCoopUser];
        const rolledShootingStar = whoIsWatering && GARDEN_COOP_USERS.includes(whoIsWatering)
          && otherTs && Math.floor(otherTs / MS_HOUR) === Math.floor(now / MS_HOUR)
          && Math.random() < 0.10;

        // ---- Update all occupied tiles + count new blooms ----
        let newTotalBlooms = currentState.totalBlooms || 0;
        const newTiles = { ...txTiles };

        for (const [tileStr, txTile] of occupiedEntries) {
          const plantedAt     = txTile.plantedAt  ?? null;
          const lastWatered   = txTile.lastWatered ?? null;
          const ageHrs        = plantedAt ? (now - plantedAt) / MS_HOUR : 0;
          const wateredHrsAgo = lastWatered ? (now - lastWatered) / MS_HOUR : Infinity;
          const tileWilted    = ageHrs >= 24 && wateredHrsAgo >= 48;

          const tileEvents = [];
          if (tileWilted) {
            const wiltedSince = lastWatered
              ? lastWatered + 48 * MS_HOUR
              : (plantedAt ? plantedAt + 24 * MS_HOUR : null);
            if (wiltedSince && (now - wiltedSince) >= 7 * 86400000) tileEvents.push('mushroom');
          }
          if (rolledMoonflower)   tileEvents.push('moonflowerVariant');
          if (rolledShootingStar) tileEvents.push('shootingStar');

          const oldStage = calculateStage(txTile);
          const newStage = calculateStage({ ...txTile, lastWatered: now });
          if (oldStage !== 'bloom' && newStage === 'bloom') newTotalBlooms++;

          newTiles[tileStr] = { ...txTile, lastWatered: now, events: tileEvents };
        }

        const newUnlockedTiles = TILE_UNLOCK_THRESHOLDS.reduce(
          (acc, t) => newTotalBlooms >= t ? acc + 1 : acc, 0
        );

        return {
          ...currentState,
          wateringStreak:    newStreak,
          lastStreakDay:     today,
          unlockedPlants:    newUnlocked,
          sharedStreak:      newSharedStreak,
          lastSharedDay:     newLastSharedDay,
          wateredByDay:      newWateredByDay,
          lastWateredByUser: newLastWateredByUser,
          totalBlooms:       newTotalBlooms,
          unlockedTiles:     newUnlockedTiles,
          tiles:             newTiles,
        };
      });

      const finalState      = txResult.snapshot.val();
      const ritualDay       = localDateStr();
      const todayAfterWater = (finalState?.wateredByDay || {})[ritualDay] || {};

      // Success feedback
      showToast('Watered!');
      sparkSound('water');

      // Same-day Water Ritual: toast the moment the second user completes the pair
      if (todayAfterWater.el && todayAfterWater.tero) {
        const ritualFlagKey = 'garden_ritual_toast_' + ritualDay;
        if (!localStorage.getItem(ritualFlagKey)) {
          localStorage.setItem(ritualFlagKey, '1');
          showToast('Shared ritual 🌸 You both watered today');
        }
      }

      if ((finalState?.wateringStreak || 0) >= 3) unlockAchievement('water_3_days');

      // Per-user watering count → first_sprout + watering_can
      totalWaterings++;
      update(ref(database, 'userStats/' + currentUser), { totalWaterings });
      unlockAchievement('first_sprout');
      if (totalWaterings >= 5) unlockAchievement('watering_can');

      // Mythic: track daily watering action
      const _wToday = localDateStr();
      dailyActions[_wToday] = dailyActions[_wToday] || {};
      dailyActions[_wToday].didWater = true;
      update(ref(database, 'userStats/' + currentUser), {
        [`dailyActions/${_wToday}/didWater`]: true,
      }).catch(() => {});

      // Per-user 3-waters-a-day achievements
      if (newDailyCount >= 3) unlockAchievement('water3_day');
      if (water3Streak.current >= 7) unlockAchievement('water3_week');

      // Time-of-day hidden achievements
      checkTimeBasedAchievements();
      checkMythics();
      fireCatEvent('cheer');
    } catch (e) {
      console.error(e);
      showToast('Could not water. Please try again.');
    } finally {
      // Only re-enable the button if the user still has waters remaining today.
      updateWaterGardenBtn();
    }
  }

  // ---- Plant an empty slot with the currently selected flower ----
  async function plantSlot(n) {
    const snap = await get(gardenRef);
    const st   = snap.val();
    if (!st) return;
    if (st.tiles?.[String(n)]) {
      showToast('This slot already has a plant');
      return;
    }
    const unlockedTiles = st.unlockedTiles || 1;
    if (n >= unlockedTiles) {
      showToast('This slot is locked');
      return;
    }
    const allowed = ['sunflower', ...(st.unlockedPlants ?? [])];
    if (!allowed.includes(selectedFlower)) {
      showToast("That plant isn't unlocked yet");
      return;
    }
    await update(gardenRef, {
      [`tiles/${n}`]: {
        slotId:      n,
        flowerType:  selectedFlower,
        plantedAt:   Date.now(),
        lastWatered: null,
        events:      [],
      },
    });
    showToast(`Planted ${PLANT_LABELS[selectedFlower] || selectedFlower}!`);
    sparkSound('post');
  }

  // Shared Water Garden button
  document.getElementById('garden-water-garden-btn')?.addEventListener('click', async () => {
    await waterGarden();
  });

  // Plant button delegation (per-tile, kept as-is)
  tilesRowEl.addEventListener('click', async (e) => {
    const btn = e.target.closest('.garden-plant-btn');
    if (!btn || btn.disabled) return;
    btn.disabled = true;
    await plantSlot(Number(btn.dataset.tile));
    btn.disabled = false;
  });

  // Talk to Garden button — fires directly, no text input needed
  document.getElementById('garden-talk-garden-btn')?.addEventListener('click', () => {
    doTalkToPlant();
  });

  // ================================================================
  // VIBE + FEEDBACK FEATURES
  // ================================================================

  // ---- 1) Talk to Plant ----
  const TALK_MESSAGES = [
    "Your leaves are looking so lovely today!",
    "I've been thinking about you all day.",
    "You're doing such a great job growing!",
    "Did you know you make this whole space brighter?",
    "I love how you reach toward the light.",
    "You're my favourite plant — don't tell the others.",
    "Growing takes courage. You've got plenty of it.",
    "Every new leaf is a tiny miracle.",
    "I see you stretching a little taller today!",
    "Thank you for existing.",
    "The soil feels happy today — can you tell?",
    "Your roots are strong, even if I can't see them.",
    "I'm so proud of how far you've come.",
    "You handle the weather better than I do.",
    "Sometimes I wonder what you dream about.",
    "You're honestly the best listener.",
    "Keep blooming — you were made for it.",
    "A little water, a little love — that's all we need.",
    "I named a star after you. In my heart.",
    "Talking to plants is scientifically proven to help. (Probably.)",
  ];

  function doTalkToPlant() {
    const msg = TALK_MESSAGES[Math.floor(Math.random() * TALK_MESSAGES.length)];
    showToast(msg);
    sparkSound('chat');
    const count = Number(localStorage.getItem('garden_talkCount') || '0') + 1;
    localStorage.setItem('garden_talkCount', String(count));
    _afterGardenTalk(count);
  }

  // ---- 2) Daily Weather ----
  const WEATHER_TYPES  = ['sunny', 'cloudy', 'rainy', 'foggy', 'windy', 'stormy'];
  const WEATHER_LABELS = {
    sunny:  '☀️ Sunny',
    cloudy: '☁️ Cloudy',
    rainy:  '🌧️ Rainy',
    foggy:  '🌫️ Foggy',
    windy:  '💨 Windy',
    stormy: '⛈️ Stormy',
  };

  let _currentWeather = null;

  function rollDailyWeather(dateKey) {
    const key = 'garden_weather_' + dateKey;
    let w = localStorage.getItem(key);
    if (!w || !WEATHER_TYPES.includes(w)) {
      w = WEATHER_TYPES[Math.floor(Math.random() * WEATHER_TYPES.length)];
      localStorage.setItem(key, w);
    }
    return w;
  }

  function getTodayWeather() {
    return rollDailyWeather(getLocalDateKey());
  }

  function applyWeather() {
    const w = getTodayWeather();
    if (w === _currentWeather) return;
    _currentWeather = w;
    if (weatherDisplayEl) weatherDisplayEl.textContent = 'Weather: ' + WEATHER_LABELS[w];
    WEATHER_TYPES.forEach(t => gardenBodyEl?.classList.remove('garden-weather--' + t));
    if (gardenBodyEl) gardenBodyEl.classList.add('garden-weather--' + w);
  }

  // ---- 3) Critters ----
  const CRITTER_POOL = [
    { emoji: '🐌', label: 'snail' },
    { emoji: '🐝', label: 'bee' },
    { emoji: '🦋', label: 'butterfly' },
    { emoji: '🐌', label: 'snail' },
    { emoji: '🐝', label: 'bee' },
    { emoji: '🦋', label: 'butterfly' },
  ];
  const CRITTER_MESSAGES = {
    snail:     ['A little snail says hi! 🐌', 'Slow and steady! 🐌', 'Look, a snail!'],
    bee:       ['A bee visits your flowers! 🐝', 'Bzzzz! 🐝', 'The bees love your garden!'],
    butterfly: ['A butterfly dances past! 🦋', 'How beautiful! 🦋', 'Flutter flutter! 🦋'],
  };

  // Mythical critter pool — fairy and spirit moth (very rare, 0.5–1 %)
  const MYTHICAL_POOL = [
    {
      emoji: '✨🧚✨',
      label: 'fairy',
      msgs:  ['A garden fairy appeared! ✨', '✨ So rare! A wild fairy! ✨', 'The garden magic is strong today! ✨'],
    },
    {
      emoji: '🦋✨',
      label: 'spirit_moth',
      msgs:  ['A spirit moth drifts through… 🦋✨', 'So rare! The spirit moth visits! 🦋✨', 'The garden glows with the spirit moth\'s wings ✨'],
    },
  ];

  let _critterEl       = null;
  let _critterDespawn  = null;
  let _critterSchedule = null;

  function spawnCritter() {
    if (_critterEl) return;   // at most 1 critter at a time
    // Stormy weather: regular critters shelter indoors — reschedule and bail
    if (_currentWeather === 'stormy') { scheduleNextCritter(); return; }
    // Sunny days give mythical visitors a slightly better chance
    const mythicalChance = _currentWeather === 'sunny' ? 0.01 : 0.005;
    if (Math.random() < mythicalChance) { spawnMythicalCritter(); return; }
    // Foggy weather: only snails venture out (they like the damp)
    const pool = _currentWeather === 'foggy'
      ? CRITTER_POOL.filter(c => c.label === 'snail')
      : CRITTER_POOL;
    const critter = pool[Math.floor(Math.random() * pool.length)];
    const el = document.createElement('div');
    el.className     = 'garden-critter';
    el.textContent   = critter.emoji;
    el.dataset.label = critter.label;
    // Position randomly within the bed (percentage-based so it works at any bed width)
    el.style.left   = (4 + Math.random() * 82) + '%';
    el.style.top    = (5 + Math.random() * 30) + '%';
    el.addEventListener('click', () => {
      const label = el.dataset.label;
      const msgs  = CRITTER_MESSAGES[label] || ['A critter!'];
      showToast(msgs[Math.floor(Math.random() * msgs.length)]);
      sparkSound('react');
      const stored = JSON.parse(localStorage.getItem('garden_critterCounts') || '{}');
      stored[label] = (stored[label] || 0) + 1;
      localStorage.setItem('garden_critterCounts', JSON.stringify(stored));
      despawnCritter();
    });
    tilesRowEl.appendChild(el);
    _critterEl = el;
    // Windy weather sends critters away faster; otherwise auto-despawn after 12s
    const despawnMs = _currentWeather === 'windy' ? 7000 : 12000;
    _critterDespawn = setTimeout(despawnCritter, despawnMs);
    // Schedule the next spawn attempt
    scheduleNextCritter();
  }

  function despawnCritter() {
    if (_critterDespawn) { clearTimeout(_critterDespawn); _critterDespawn = null; }
    if (_critterEl) { _critterEl.remove(); _critterEl = null; }
  }

  function scheduleNextCritter() {
    if (_critterSchedule) { clearTimeout(_critterSchedule); _critterSchedule = null; }
    // Weather-aware spawn timing: sunny = busier garden, stormy/rainy = quieter
    let minMs = 60000, rangeMs = 60000;
    if (_currentWeather === 'sunny')                                   { minMs =  30000; rangeMs = 30000; }
    else if (_currentWeather === 'rainy' || _currentWeather === 'foggy') { minMs =  90000; rangeMs = 90000; }
    else if (_currentWeather === 'stormy')                              { minMs = 150000; rangeMs = 90000; }
    const delay = minMs + Math.random() * rangeMs;
    _critterSchedule = setTimeout(spawnCritter, delay);
  }

  function startCritters() {
    stopCritters();
    // Initial spawn attempt: 2–5 s after opening
    _critterSchedule = setTimeout(spawnCritter, 2000 + Math.random() * 3000);
  }

  function stopCritters() {
    if (_critterSchedule) { clearTimeout(_critterSchedule); _critterSchedule = null; }
    despawnCritter();
  }

  // ---- Rare / Mythical layer ----

  // Returns local date key "YYYY-MM-DD" (alias kept inside IIFE for clarity).
  function getLocalDateKey() {
    return localDateStr();
  }

  // Special dates keyed by "MM-DD" (day/month format from spec → stored as month-day).
  const SPECIAL_DATES = {
    '01-06': { type: 'anniversary',   msg: 'Happy anniversary 💚' },
    '03-26': { type: 'birthday_tero', msg: 'Happy birthday Tero 🎂' },
    '10-22': { type: 'birthday_el',   msg: 'Happy birthday El 🎂' },
  };

  // Returns the special-date descriptor { type, msg } or null.
  function isSpecialDate(dateKey) {
    const mmdd = dateKey.slice(5); // "YYYY-MM-DD" → "MM-DD"
    return SPECIAL_DATES[mmdd] || null;
  }

  // Persist a keepsake entry to the Garden Journal (max 10, newest first).
  function appendGardenJournalEntry(entry) {
    const stored = JSON.parse(localStorage.getItem('garden_journal') || '[]');
    stored.unshift(entry);
    if (stored.length > 10) stored.length = 10;
    localStorage.setItem('garden_journal', JSON.stringify(stored));
    renderGardenJournal();
  }
  window._appendGardenJournalEntry = appendGardenJournalEntry;

  // Re-render the Garden Journal section from localStorage.
  function renderGardenJournal() {
    const journalEl  = document.getElementById('garden-journal');
    const entriesEl  = document.getElementById('garden-journal-entries');
    if (!journalEl || !entriesEl) return;
    const stored = JSON.parse(localStorage.getItem('garden_journal') || '[]');
    if (!stored.length) { journalEl.style.display = 'none'; return; }
    journalEl.style.display = '';
    entriesEl.innerHTML = stored.map(e =>
      `<div class="garden-journal-row">` +
        `<span class="garden-journal-date">${e.date}</span>` +
        `<span class="garden-journal-msg">${e.msg}</span>` +
      `</div>`
    ).join('');
  }

  // Spawn a mythical critter unconditionally (caller controls the probability roll).
  function spawnMythicalCritter() {
    if (_critterEl) return false;
    const mythical = MYTHICAL_POOL[Math.floor(Math.random() * MYTHICAL_POOL.length)];
    const el = document.createElement('div');
    el.className     = 'garden-critter garden-critter--mythical';
    el.textContent   = mythical.emoji;
    el.dataset.label = mythical.label;
    el.style.left    = (4 + Math.random() * 82) + '%';
    el.style.top     = (5 + Math.random() * 30) + '%';
    el.addEventListener('click', () => {
      const msg = mythical.msgs[Math.floor(Math.random() * mythical.msgs.length)];
      showToast(msg);
      sparkSound('react');
      // Persist critter counts
      const counts = JSON.parse(localStorage.getItem('garden_critterCounts') || '{}');
      counts[mythical.label] = (counts[mythical.label] || 0) + 1;
      localStorage.setItem('garden_critterCounts', JSON.stringify(counts));
      // Persist mythicalSeenCount
      const seen = parseInt(localStorage.getItem('mythicalSeenCount') || '0', 10) + 1;
      localStorage.setItem('mythicalSeenCount', String(seen));
      // Keepsake journal entry
      appendGardenJournalEntry({ date: getLocalDateKey(), msg });
      despawnCritter();
    });
    tilesRowEl.appendChild(el);
    _critterEl = el;
    _critterDespawn = setTimeout(despawnCritter, 15000);
    scheduleNextCritter();
    return true;
  }

  // Called on garden open: handles special-date guarantees and normal 1 % on-open roll.
  function maybeTriggerMythical(dateKey) {
    const special = isSpecialDate(dateKey);

    if (special) {
      // Special toast (once per day)
      const toastKey = 'garden_special_toast_' + dateKey;
      if (!localStorage.getItem(toastKey)) {
        localStorage.setItem(toastKey, '1');
        setTimeout(() => { showToast(special.msg); sparkSound('ach'); }, 800);
      }
      // Guarantee mythical + keepsake the first time the garden opens this special day
      const seenKey = 'garden_special_mythical_' + dateKey;
      if (!localStorage.getItem(seenKey)) {
        localStorage.setItem(seenKey, '1');
        appendGardenJournalEntry({ date: dateKey, msg: special.msg });
        setTimeout(() => spawnMythicalCritter(), 3000);
      }
      return;
    }

    // Normal day: 1 % chance for an immediate mythical spawn on garden open
    if (Math.random() < 0.01) {
      setTimeout(() => spawnMythicalCritter(), 3000 + Math.random() * 2000);
    }
  }

  // Night shooting star (21:00–03:59, 3 % chance, once per day).
  function maybeShootingStar(dateKey) {
    const hr = new Date().getHours();
    if (hr < 21 && hr >= 4) return;                           // only at night
    const key = 'garden_shootingstar_' + dateKey;
    if (localStorage.getItem(key)) return;                     // already seen today
    if (Math.random() >= 0.03) return;                         // 3 % chance
    localStorage.setItem(key, '1');
    const el = document.createElement('div');
    el.className   = 'garden-shooting-star';
    el.textContent = '✨☄️';
    gardenBodyEl.appendChild(el);
    setTimeout(() => el.remove(), 2000);
    showToast('A shooting star! ✨☄️');
    sparkSound('ping', 'garden');
  }

  // Glitch moment (0.2 % chance on garden open, CSS-only, 1–2 s).
  function maybeGardenGlitch() {
    if (Math.random() >= 0.002) return;
    setTimeout(() => {
      gardenBodyEl.classList.add('garden-glitch');
      showToast('The garden shimmered strangely…');
      sparkSound('ping', 'garden');
      gardenBodyEl.addEventListener('animationend', () =>
        gardenBodyEl.classList.remove('garden-glitch'), { once: true });
    }, 600);
  }

  // ---- Show / hide ----
  function show() {
    if (!btn) btn = w95Mgr.addTaskbarBtn('w95-win-garden', 'GARDEN', () => {
      if (win.classList.contains('is-hidden')) show(); else hide();
    });
    win.classList.remove('is-hidden');
    w95Mgr.focusWindow('w95-win-garden');
    localStorage.setItem('w95_garden_open', '1');
    if (wasHidden) _trackWindowOpen('garden');
    // Record today's garden visit (streak / day-map) and check achievements.
    // This is the correct place — not during achievement init — so that
    // simply loading the app does not count as a garden visit.
    recordGardenVisit();
    // Same-hour Visit Spark: write our open timestamp + toast if other user is also here.
    checkVisitSpark();
    applyWeather();
    startCritters();
    // Rare / Mythical layer — all checks run only on garden open, no polling.
    const _dateKey = getLocalDateKey();
    maybeShootingStar(_dateKey);
    maybeTriggerMythical(_dateKey);
    maybeGardenGlitch();
    renderGardenJournal();
  }

  function hide() {
    win.classList.add('is-hidden');
    if (w95Mgr.isActiveWin('w95-win-garden')) w95Mgr.focusWindow(null);
    localStorage.setItem('w95_garden_open', '0');
    stopCritters();
  }

  function closeWin() {
    if (w95Mgr.isMaximised('w95-win-garden')) w95Mgr.toggleMaximise(win, 'w95-win-garden');
    hide();
    if (btn) { btn.remove(); btn = null; }
  }

  min.onclick = (e) => { e.stopPropagation(); hide(); };
  if (max) max.onclick = (e) => { e.stopPropagation(); w95Mgr.toggleMaximise(win, 'w95-win-garden'); };
  if (closeBtn) closeBtn.onclick = (e) => { e.stopPropagation(); closeWin(); };

  w95Apps['garden'] = { open: () => {
    if (win.classList.contains('is-hidden')) show(); else w95Mgr.focusWindow('w95-win-garden');
  }};

  // Restore open state
  if (localStorage.getItem('w95_garden_open') !== '0') show();

  // ---- Drag ----
  let dragging = false, startX = 0, startY = 0, winStartX = 20, winStartY = 20;

  handle.addEventListener('mousedown', (e) => {
    if (e.target.closest('button')) return;
    if (w95Mgr.isMaximised('w95-win-garden')) return;
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    const r = win.getBoundingClientRect();
    winStartX = r.left;
    winStartY = r.top;
    e.preventDefault();
  });

  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const MIN_VIS = 60;
    const taskbarH = 40;
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight - taskbarH;
    win.style.left = Math.max(MIN_VIS - win.offsetWidth, Math.min(vw - MIN_VIS, winStartX + (e.clientX - startX))) + 'px';
    win.style.top  = Math.max(0, Math.min(vh - MIN_VIS, winStartY + (e.clientY - startY))) + 'px';
  });

  window.addEventListener('mouseup', () => { if (dragging) { dragging = false; w95Layout.save(win, 'w95-win-garden'); } });
})();

(() => {
  const chatPanel = document.getElementById('chatPanel');
  const activityPanel = document.getElementById('activityPanel');

  const chatBodyW = document.getElementById('w95-chat-body');
  const newBodyW = document.getElementById('w95-new-body');

  const winChat = document.getElementById('w95-win-chat');
  const winNew = document.getElementById('w95-win-new');

  let btnChat = null, btnNew = null;

  const minChat = document.getElementById('w95-chat-min');
  const minNew  = document.getElementById('w95-new-min');
  const maxChat = document.getElementById('w95-chat-max');
  const maxNew  = document.getElementById('w95-new-max');
  const closeBtnChat = document.getElementById('w95-chat-close');
  const closeBtnNew  = document.getElementById('w95-new-close');

  if (!chatPanel || !activityPanel || !chatBodyW || !newBodyW || !winChat || !winNew || !minChat || !minNew) return;

  // Hide the old floating FABs — taskbar buttons replace them
  const fabChat = document.getElementById('chatFab');
  const fabActivity = document.getElementById('activityFab');
  if (fabChat) fabChat.style.display = 'none';
  if (fabActivity) fabActivity.style.display = 'none';

  // Move existing panels into Win95 windows (keeps their current JS bindings)
  chatBodyW.appendChild(chatPanel);
  newBodyW.appendChild(activityPanel);

  // Reset panel styles so they fill their W95 window body as flex columns
  for (const panel of [chatPanel, activityPanel]) {
    panel.style.position = 'static';
    panel.style.display = 'flex';
    panel.style.flex = '1';
    panel.style.opacity = '1';
    panel.style.visibility = 'visible';
    panel.style.pointerEvents = 'auto';
    panel.style.transform = 'none';
    panel.style.transition = 'none';
    panel.style.width = '100%';
    panel.style.height = '100%';
    panel.style.maxHeight = '100%';
    panel.style.zIndex = '';
    panel.style.borderRadius = '0';
    panel.style.boxShadow = 'none';
    panel.style.border = 'none';
    panel.style.bottom = '';
    panel.style.right = '';
    panel.style.left = '';
    panel.style.top = '';
  }

  function snap(win, corner) {
    const margin = 16;
    const taskbar = document.getElementById('w95-taskbar') || document.querySelector('.taskbar');
    const taskbarH = taskbar ? taskbar.getBoundingClientRect().height : 0;

    const r = win.getBoundingClientRect();
    const w = r.width, h = r.height;

    const top = window.innerHeight - taskbarH - h - margin;
    const left = corner === 'br'
      ? window.innerWidth - w - margin
      : margin;

    win.style.left = Math.max(margin, left) + 'px';
    win.style.top  = Math.max(margin, top) + 'px';
  }

  function showChat() {
    const wasHidden = winChat.classList.contains('is-hidden');
    if (!btnChat) btnChat = w95Mgr.addTaskbarBtn('w95-win-chat', 'CHAT', () => {
      if (winChat.classList.contains('is-hidden')) showChat(); else hideChat();
    });
    winChat.classList.remove('is-hidden');
    w95Mgr.focusWindow('w95-win-chat');
    localStorage.setItem('w95_chat_open', '1');
    if (wasHidden) { snap(winChat, 'br'); _trackWindowOpen('chat'); }
    chatOpen = true;
    lastChatSeenTs = Date.now();
    localStorage.setItem('chatSeenTs', String(lastChatSeenTs));
    document.getElementById('chatUnread')?.classList.add('hidden');
    renderChat(lastChatMessages, 'initial');
    _hideChatNewMsgBtn();
    setTimeout(() => document.getElementById('chatInput')?.focus(), 80);
  }

  function hideChat() {
    winChat.classList.add('is-hidden');
    if (w95Mgr.isActiveWin('w95-win-chat')) w95Mgr.focusWindow(null);
    localStorage.setItem('w95_chat_open', '0');
    chatOpen = false;
    stopChatTyping();
  }

  function closeChatWin() {
    if (w95Mgr.isMaximised('w95-win-chat')) w95Mgr.toggleMaximise(winChat, 'w95-win-chat');
    winChat.classList.add('is-hidden');
    chatOpen = false;
    stopChatTyping();
    localStorage.setItem('w95_chat_open', '0');
    if (btnChat) { btnChat.remove(); btnChat = null; }
  }

  function showNew() {
    const wasHidden = winNew.classList.contains('is-hidden');
    if (!btnNew) btnNew = w95Mgr.addTaskbarBtn('w95-win-new', 'NEW', () => {
      if (winNew.classList.contains('is-hidden')) showNew(); else hideNew();
    });
    winNew.classList.remove('is-hidden');
    w95Mgr.focusWindow('w95-win-new');
    localStorage.setItem('w95_new_open', '1');
    if (wasHidden) { snap(winNew, 'bl'); _trackWindowOpen('new'); }
    renderActivityPanel();
  }

  function hideNew() {
    winNew.classList.add('is-hidden');
    if (w95Mgr.isActiveWin('w95-win-new')) w95Mgr.focusWindow(null);
    localStorage.setItem('w95_new_open', '0');
  }

  function closeNewWin() {
    if (w95Mgr.isMaximised('w95-win-new')) w95Mgr.toggleMaximise(winNew, 'w95-win-new');
    winNew.classList.add('is-hidden');
    localStorage.setItem('w95_new_open', '0');
    if (btnNew) { btnNew.remove(); btnNew = null; }
  }

  minChat.onclick = (e) => { e.stopPropagation(); hideChat(); };
  minNew.onclick  = (e) => { e.stopPropagation(); hideNew(); };
  if (maxChat) maxChat.onclick = (e) => { e.stopPropagation(); w95Mgr.toggleMaximise(winChat, 'w95-win-chat'); };
  if (maxNew)  maxNew.onclick  = (e) => { e.stopPropagation(); w95Mgr.toggleMaximise(winNew,  'w95-win-new'); };
  if (closeBtnChat) closeBtnChat.onclick = (e) => { e.stopPropagation(); closeChatWin(); };
  if (closeBtnNew)  closeBtnNew.onclick  = (e) => { e.stopPropagation(); closeNewWin(); };

  w95Apps['chat'] = { open: () => { if (winChat.classList.contains('is-hidden')) showChat(); else w95Mgr.focusWindow('w95-win-chat'); } };
  w95Apps['new']  = { open: () => { if (winNew.classList.contains('is-hidden'))  showNew();  else w95Mgr.focusWindow('w95-win-new'); } };

  // Restore open state — default closed if no preference stored
  if (localStorage.getItem('w95_chat_open') === '1') showChat();
  if (localStorage.getItem('w95_new_open')  === '1') showNew();

  // Drag support for both windows
  makeDraggable(winChat, document.getElementById('w95-chat-handle'), 'w95-win-chat');
  makeDraggable(winNew,  document.getElementById('w95-new-handle'),  'w95-win-new');
})();

// ===== Profiles.exe – Avatar Engine =====

const PROF_SKIN = {
    light:        '#FFE4C8',
    medium_light: '#F5C8A0',
    medium:       '#D4956A',
    medium_dark:  '#A0603A',
    dark:         '#5C3520',
};

const PROF_HAIR_COLOR = {
    black:      '#1A1A1A',
    dark_brown: '#2E1B0E',
    brown:      '#6B3A2A',
    blonde:     '#D4A840',
    ginger:     '#B83A10',
    maroon:     '#6E0B1A',
    blue:       '#1A38B0',
    purple:     '#6018A8',
    pink:       '#D04090',
    white:      '#EDEDEE',
    grey:       '#8888A0',
};

const PROF_CLOTH_COLOR = {
    grey:       '#7A7A7A',
    navy:       '#1E3280',
    black:      '#282828',
    white:      '#F0F0F0',
    teal:       '#1E7878',
    maroon:     '#6E0B1A',
    olive:      '#506028',
    dusty_pink: '#B86070',
};

// All trait categories — add new options here freely, no other code changes needed
const PROF_TRAIT_DEFS = [
    { id: 'skin', label: 'Skin tone', type: 'swatch', options: [
        { value: 'light',        color: '#FFE4C8', label: 'Light' },
        { value: 'medium_light', color: '#F5C8A0', label: 'Medium light' },
        { value: 'medium',       color: '#D4956A', label: 'Medium' },
        { value: 'medium_dark',  color: '#A0603A', label: 'Medium dark' },
        { value: 'dark',         color: '#5C3520', label: 'Dark' },
    ]},
    { id: 'hair', label: 'Hair style', type: 'chip', options: [
        { value: 'none',          label: 'None' },
        { value: 'short_straight',label: 'Short' },
        { value: 'bob',           label: 'Bob' },
        { value: 'long_curly',    label: 'Long curly' },
        { value: 'shaggy',        label: 'Shaggy' },
        { value: 'ponytail',      label: 'Ponytail' },
        { value: 'bun',           label: 'Bun' },
    ]},
    { id: 'hair_color', label: 'Hair colour', type: 'swatch', options: [
        { value: 'black',      color: '#1A1A1A', label: 'Black' },
        { value: 'dark_brown', color: '#2E1B0E', label: 'Dark brown' },
        { value: 'brown',      color: '#6B3A2A', label: 'Brown' },
        { value: 'blonde',     color: '#D4A840', label: 'Blonde' },
        { value: 'ginger',     color: '#B83A10', label: 'Ginger' },
        { value: 'maroon',     color: '#6E0B1A', label: 'Maroon red' },
        { value: 'blue',       color: '#1A38B0', label: 'Blue' },
        { value: 'purple',     color: '#6018A8', label: 'Purple' },
        { value: 'pink',       color: '#D04090', label: 'Pink' },
        { value: 'white',      color: '#EDEDEE', label: 'White' },
        { value: 'grey',       color: '#8888A0', label: 'Grey' },
    ]},
    { id: 'eyes', label: 'Eyes', type: 'chip', options: [
        { value: 'normal', label: 'Normal' },
        { value: 'closed', label: 'Closed' },
        { value: 'sleepy', label: 'Sleepy' },
    ]},
    { id: 'glasses', label: 'Glasses', type: 'chip', options: [
        { value: 'none',        label: 'None' },
        { value: 'round',       label: 'Round' },
        { value: 'rectangular', label: 'Rectangular' },
    ]},
    { id: 'face_pierce', label: 'Face piercings', type: 'multi', options: [
        { value: 'septum',    label: 'Septum' },
        { value: 'nostril_l', label: 'Left nostril' },
        { value: 'nostril_r', label: 'Right nostril' },
    ]},
    { id: 'ear', label: 'Ear accessories', type: 'chip', options: [
        { value: 'none',        label: 'None' },
        { value: 'lobe_studs',  label: 'Lobe studs' },
        { value: 'stretchers',  label: 'Stretchers' },
        { value: 'hoops',       label: 'Hoops' },
        { value: 'studs_hoops', label: 'Studs + Hoops' },
    ]},
    { id: 'clothing', label: 'Top', type: 'chip', options: [
        { value: 'hoodie',  label: 'Hoodie' },
        { value: 'tshirt',  label: 'T-shirt' },
        { value: 'tank',    label: 'Tank' },
        { value: 'sweater', label: 'Sweater' },
    ]},
    { id: 'clothing_color', label: 'Top colour', type: 'swatch', options: [
        { value: 'grey',       color: '#7A7A7A', label: 'Grey' },
        { value: 'navy',       color: '#1E3280', label: 'Navy' },
        { value: 'black',      color: '#282828', label: 'Black' },
        { value: 'white',      color: '#F0F0F0', label: 'White' },
        { value: 'teal',       color: '#1E7878', label: 'Teal' },
        { value: 'maroon',     color: '#6E0B1A', label: 'Maroon' },
        { value: 'olive',      color: '#506028', label: 'Olive' },
        { value: 'dusty_pink', color: '#B86070', label: 'Dusty pink' },
    ]},
];

// User defaults — reflect real traits for El and Tero
const PROF_DEFAULTS = {
    El:   { skin: 'light',        hair: 'shaggy',     hair_color: 'maroon',     eyes: 'normal', glasses: 'none',        face_pierce: ['septum'], ear: 'studs_hoops', clothing: 'hoodie',  clothing_color: 'navy' },
    Tero: { skin: 'medium_light', hair: 'long_curly', hair_color: 'dark_brown', eyes: 'normal', glasses: 'none',        face_pierce: [],         ear: 'none',        clothing: 'tshirt',  clothing_color: 'teal' },
};

function _profDarken(hex, amt) {
    const n = parseInt(hex.replace('#', ''), 16);
    const r = Math.max(0, Math.round(((n >> 16) & 0xff) * (1 - amt)));
    const g = Math.max(0, Math.round(((n >>  8) & 0xff) * (1 - amt)));
    const b = Math.max(0, Math.round(( n        & 0xff) * (1 - amt)));
    return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
}

function _profAvatarHairBack(style, H, HD, out) {
    if (style === 'bob') {
        // Full bob silhouette drawn behind the face so the face stays visible
        out.push(`<path d="M26 50 Q20 54 20 64 Q20 72 26 73 Q36 75 50 75 Q64 75 74 73 Q80 72 80 64 Q80 54 74 50 Q67 56 50 57 Q33 56 26 50Z" fill="${H}"/>`);
    } else if (style === 'long_curly') {
        // Wide, voluminous sides — no longer narrow braid-like columns
        out.push(`<path d="M28 52 Q12 58 11 74 Q12 86 19 88 Q25 88 25 81 Q23 71 24 62 Q26 55 28 52Z" fill="${H}"/>`);
        out.push(`<path d="M72 52 Q88 58 89 74 Q88 86 81 88 Q75 88 75 81 Q77 71 76 62 Q74 55 72 52Z" fill="${H}"/>`);
    } else if (style === 'shaggy') {
        out.push(`<path d="M28 52 Q22 62 23 76 Q26 84 30 80 Q33 70 31 60 Q31 54 28 52Z" fill="${H}"/>`);
        out.push(`<path d="M72 52 Q78 62 77 76 Q74 84 70 80 Q67 70 69 60 Q69 54 72 52Z" fill="${H}"/>`);
    } else if (style === 'ponytail') {
        out.push(`<path d="M53 22 Q58 32 60 48 Q62 64 63 78 Q64 88 60 90 Q56 92 54 84 Q52 70 50 56 Q50 38 50 22 Q51 20 53 22Z" fill="${H}"/>`);
    }
}

function _profAvatarHairFront(style, H, HD, out) {
    if (style === 'none') return;
    const shapes = {
        short_straight: `<path d="M28 50 Q28 18 50 16 Q72 18 72 50 Q66 44 50 43 Q34 44 28 50Z" fill="${H}"/>`,
        bob:            `<path d="M28 50 Q28 18 50 16 Q72 18 72 50 Q66 44 50 43 Q34 44 28 50Z" fill="${H}"/>`,
        long_curly:     `<path d="M28 52 Q28 18 50 16 Q72 18 72 52 Q66 46 50 44 Q34 46 28 52Z" fill="${H}"/>
                         <path d="M28 52 Q22 55 22 61 Q23 67 27 63 Q28 58 28 52Z" fill="${H}"/>
                         <path d="M72 52 Q78 55 78 61 Q77 67 73 63 Q72 58 72 52Z" fill="${H}"/>
                         <path d="M26 63 Q20 70 22 76 Q24 79 27 76 Q27 69 26 63Z" fill="${H}"/>
                         <path d="M74 63 Q80 70 78 76 Q76 79 73 76 Q73 69 74 63Z" fill="${H}"/>`,
        shaggy:         `<path d="M28 50 Q28 18 50 16 Q72 18 72 50 Q68 44 62 40 Q56 36 50 34 Q44 36 38 40 Q32 44 28 50Z" fill="${H}"/>
                         <path d="M28 50 Q23 44 22 50 Q21 56 24 58 Q26 58 27 54Z" fill="${H}"/>
                         <path d="M72 50 Q77 44 78 50 Q79 56 76 58 Q74 58 73 54Z" fill="${H}"/>
                         <path d="M34 18 Q30 12 26 16 Q24 20 28 22 Q32 22 34 18Z" fill="${H}"/>
                         <path d="M50 14 Q48 8 50 6 Q52 8 50 14Z" fill="${H}"/>
                         <path d="M66 18 Q70 12 74 16 Q76 20 72 22 Q68 22 66 18Z" fill="${H}"/>`,
        ponytail:       `<path d="M28 50 Q28 18 50 16 Q72 18 72 50 Q65 42 50 40 Q35 42 28 50Z" fill="${H}"/>
                         <path d="M46 17 Q50 14 54 17 Q54 24 50 26 Q46 24 46 17Z" fill="${HD}"/>`,
        bun:            `<path d="M28 50 Q28 18 50 16 Q72 18 72 50 Q65 42 50 40 Q35 42 28 50Z" fill="${H}"/>
                         <ellipse cx="50" cy="12" rx="10" ry="9" fill="${H}"/>
                         <ellipse cx="50" cy="12" rx="6" ry="5" fill="${HD}"/>`,
    };
    if (shapes[style]) out.push(shapes[style]);
}

function _profAvatarBody(clothing, C, CS, skin, out) {
    out.push(`<rect x="44" y="66" width="12" height="9" fill="${skin}" rx="2"/>`);
    const shapes = {
        hoodie:  `<path d="M26 76 Q18 80 14 100 L86 100 Q82 80 74 76 Q64 72 56 74 Q50 76 44 74 Q36 72 26 76Z" fill="${C}"/>
                  <path d="M44 74 Q50 72 56 74 L57 80 Q50 82 43 80Z" fill="${CS}"/>`,
        tshirt:  `<path d="M30 75 Q18 72 14 84 L20 90 Q28 80 32 80 L32 100 L68 100 L68 80 Q72 80 80 90 L86 84 Q82 72 70 75 Q62 72 50 73 Q38 72 30 75Z" fill="${C}"/>`,
        tank:    `<path d="M36 76 L36 100 L64 100 L64 76 Q56 73 50 74 Q44 73 36 76Z" fill="${C}"/>`,
        sweater: `<path d="M24 77 Q16 82 14 100 L86 100 Q84 82 76 77 Q64 73 50 74 Q36 73 24 77Z" fill="${C}"/>
                  <path d="M44 74 Q50 72 56 74 L56 78 Q50 80 44 78Z" fill="${CS}"/>`,
    };
    out.push(shapes[clothing] || shapes.tshirt);
}

function _profAvatarEars(skin, skinSh, earStyle, out) {
    out.push(`<ellipse cx="27" cy="48" rx="5" ry="7" fill="${skin}"/>`);
    out.push(`<ellipse cx="73" cy="48" rx="5" ry="7" fill="${skin}"/>`);
    out.push(`<ellipse cx="27" cy="48" rx="3" ry="5" fill="${skinSh}" opacity="0.35"/>`);
    out.push(`<ellipse cx="73" cy="48" rx="3" ry="5" fill="${skinSh}" opacity="0.35"/>`);
    const M = '#C8C8C8', MD = '#909090';
    if (earStyle === 'lobe_studs') {
        out.push(`<circle cx="24" cy="50" r="1.6" fill="${M}" stroke="${MD}" stroke-width="0.5"/>`);
        out.push(`<circle cx="76" cy="50" r="1.6" fill="${M}" stroke="${MD}" stroke-width="0.5"/>`);
        out.push(`<circle cx="24" cy="54" r="2"   fill="${M}" stroke="${MD}" stroke-width="0.5"/>`);
        out.push(`<circle cx="76" cy="54" r="2"   fill="${M}" stroke="${MD}" stroke-width="0.5"/>`);
    } else if (earStyle === 'stretchers') {
        out.push(`<circle cx="26" cy="51" r="4.5" fill="${MD}" stroke="${M}" stroke-width="1.2"/>`);
        out.push(`<circle cx="74" cy="51" r="4.5" fill="${MD}" stroke="${M}" stroke-width="1.2"/>`);
        out.push(`<circle cx="26" cy="51" r="2.2" fill="${skin}"/>`);
        out.push(`<circle cx="74" cy="51" r="2.2" fill="${skin}"/>`);
    } else if (earStyle === 'hoops') {
        out.push(`<path d="M23 56 Q19 63 25 65 Q31 63 27 56" fill="none" stroke="${M}" stroke-width="1.6"/>`);
        out.push(`<path d="M77 56 Q81 63 75 65 Q69 63 73 56" fill="none" stroke="${M}" stroke-width="1.6"/>`);
    } else if (earStyle === 'studs_hoops') {
        out.push(`<circle cx="24" cy="50" r="1.8" fill="${M}" stroke="${MD}" stroke-width="0.5"/>`);
        out.push(`<circle cx="76" cy="50" r="1.8" fill="${M}" stroke="${MD}" stroke-width="0.5"/>`);
        out.push(`<path d="M23 56 Q19 63 25 65 Q31 63 27 56" fill="none" stroke="${M}" stroke-width="1.6"/>`);
        out.push(`<path d="M77 56 Q81 63 75 65 Q69 63 73 56" fill="none" stroke="${M}" stroke-width="1.6"/>`);
    }
}

function _profAvatarEyes(style, out) {
    const EW = '#FFFFFF', ED = '#303040';
    if (style === 'closed') {
        out.push(`<path d="M37 44 Q42 42 47 44" fill="none" stroke="${ED}" stroke-width="1.5" stroke-linecap="round"/>`);
        out.push(`<path d="M53 44 Q58 42 63 44" fill="none" stroke="${ED}" stroke-width="1.5" stroke-linecap="round"/>`);
    } else if (style === 'sleepy') {
        out.push(`<ellipse cx="42" cy="46" rx="5" ry="4" fill="${EW}"/>`);
        out.push(`<ellipse cx="58" cy="46" rx="5" ry="4" fill="${EW}"/>`);
        out.push(`<circle cx="42" cy="47" r="2.5" fill="${ED}"/>`);
        out.push(`<circle cx="58" cy="47" r="2.5" fill="${ED}"/>`);
        out.push(`<path d="M37 46 Q42 42 47 46" fill="#D4B098"/>`);
        out.push(`<path d="M53 46 Q58 42 63 46" fill="#D4B098"/>`);
    } else { // normal
        out.push(`<ellipse cx="42" cy="46" rx="5.5" ry="5.5" fill="${EW}"/>`);
        out.push(`<ellipse cx="58" cy="46" rx="5.5" ry="5.5" fill="${EW}"/>`);
        out.push(`<circle cx="42" cy="46.5" r="3.2" fill="#4060A0"/>`);
        out.push(`<circle cx="58" cy="46.5" r="3.2" fill="#4060A0"/>`);
        out.push(`<circle cx="42" cy="46.5" r="1.6" fill="${ED}"/>`);
        out.push(`<circle cx="58" cy="46.5" r="1.6" fill="${ED}"/>`);
        out.push(`<circle cx="43.2" cy="45.0" r="0.9" fill="${EW}"/>`);
        out.push(`<circle cx="59.2" cy="45.0" r="0.9" fill="${EW}"/>`);
        out.push(`<path d="M37 43 Q42 40 47 43" fill="none" stroke="${ED}" stroke-width="1.2" stroke-linecap="round"/>`);
        out.push(`<path d="M53 43 Q58 40 63 43" fill="none" stroke="${ED}" stroke-width="1.2" stroke-linecap="round"/>`);
    }
}

function _profAvatarFaceDetails(skin, skinSh, out) {
    // Nose
    out.push(`<circle cx="47" cy="54" r="1.3" fill="${skinSh}" opacity="0.55"/>`);
    out.push(`<circle cx="53" cy="54" r="1.3" fill="${skinSh}" opacity="0.55"/>`);
    // Mouth
    out.push(`<path d="M43 60 Q50 65 57 60" fill="none" stroke="#B07868" stroke-width="1.5" stroke-linecap="round"/>`);
    // Blush
    out.push(`<ellipse cx="33" cy="54" rx="5.5" ry="3" fill="#FF9090" opacity="0.18"/>`);
    out.push(`<ellipse cx="67" cy="54" rx="5.5" ry="3" fill="#FF9090" opacity="0.18"/>`);
}

function _profAvatarGlasses(style, out) {
    const S = '#404040';
    if (style === 'round') {
        out.push(`<circle cx="42" cy="46" r="7.5" fill="none" stroke="${S}" stroke-width="1.5"/>`);
        out.push(`<circle cx="58" cy="46" r="7.5" fill="none" stroke="${S}" stroke-width="1.5"/>`);
        out.push(`<line x1="49.5" y1="46" x2="50.5" y2="46" stroke="${S}" stroke-width="1.2"/>`);
        out.push(`<line x1="34.5" y1="43" x2="29"   y2="42" stroke="${S}" stroke-width="1.2"/>`);
        out.push(`<line x1="65.5" y1="43" x2="71"   y2="42" stroke="${S}" stroke-width="1.2"/>`);
    } else if (style === 'rectangular') {
        out.push(`<rect x="34.5" y="42" width="15" height="9" rx="1.5" fill="none" stroke="${S}" stroke-width="1.5"/>`);
        out.push(`<rect x="50.5" y="42" width="15" height="9" rx="1.5" fill="none" stroke="${S}" stroke-width="1.5"/>`);
        out.push(`<line x1="49.5" y1="46" x2="50.5" y2="46" stroke="${S}" stroke-width="1.2"/>`);
        out.push(`<line x1="34.5" y1="44" x2="29"   y2="42" stroke="${S}" stroke-width="1.2"/>`);
        out.push(`<line x1="65.5" y1="44" x2="71"   y2="42" stroke="${S}" stroke-width="1.2"/>`);
    }
}

function buildAvatarSVG(t) {
    const skin   = PROF_SKIN[t.skin]              || PROF_SKIN.light;
    const hairC  = PROF_HAIR_COLOR[t.hair_color]  || PROF_HAIR_COLOR.brown;
    const clothC = PROF_CLOTH_COLOR[t.clothing_color] || PROF_CLOTH_COLOR.grey;
    const skinSh = _profDarken(skin,   0.15);
    const hairSh = _profDarken(hairC,  0.22);
    const clothSh= _profDarken(clothC, 0.22);
    const layers = [];

    _profAvatarHairBack(t.hair, hairC, hairSh, layers);
    _profAvatarBody(t.clothing, clothC, clothSh, skin, layers);
    _profAvatarEars(skin, skinSh, t.ear, layers);
    layers.push(`<ellipse cx="50" cy="46" rx="22" ry="24" fill="${skin}"/>`);
    _profAvatarHairFront(t.hair, hairC, hairSh, layers);
    _profAvatarEyes(t.eyes, layers);
    _profAvatarFaceDetails(skin, skinSh, layers);
    if (t.glasses && t.glasses !== 'none') _profAvatarGlasses(t.glasses, layers);

    const fp = Array.isArray(t.face_pierce) ? t.face_pierce : [];
    if (fp.includes('septum'))    layers.push(`<path d="M47 58 Q50 61.5 53 58" fill="none" stroke="#C4C4C4" stroke-width="1.8" stroke-linecap="round"/>`);
    if (fp.includes('nostril_l')) layers.push(`<circle cx="44" cy="56.5" r="1.6" fill="none" stroke="#C4C4C4" stroke-width="1.2"/>`);
    if (fp.includes('nostril_r')) layers.push(`<circle cx="56" cy="56.5" r="1.6" fill="none" stroke="#C4C4C4" stroke-width="1.2"/>`);

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="90" height="90" aria-hidden="true">${layers.join('')}</svg>`;
}

function _profRandomTraits() {
    const pick = arr => arr[Math.floor(Math.random() * arr.length)];
    const draft = {};
    PROF_TRAIT_DEFS.forEach(def => {
        if (def.type === 'multi') {
            // randomly include 0–2 options
            const shuffled = [...def.options].sort(() => Math.random() - 0.5);
            draft[def.id] = shuffled.slice(0, Math.floor(Math.random() * 3)).map(o => o.value);
        } else {
            draft[def.id] = pick(def.options).value;
        }
    });
    return draft;
}

function _profRenderEditorSections(draft) {
    return PROF_TRAIT_DEFS.map(def => {
        const opts = def.options.map(opt => {
            const sel = def.type === 'multi'
                ? (Array.isArray(draft[def.id]) && draft[def.id].includes(opt.value))
                : draft[def.id] === opt.value;
            if (def.type === 'swatch') {
                return `<button class="avatar-swatch${sel ? ' selected' : ''}" title="${opt.label}" style="background:${opt.color}" onclick="pfAvatarPick('${def.id}','${opt.value}',false)" type="button"></button>`;
            }
            const multi = def.type === 'multi';
            return `<button class="avatar-trait-btn${sel ? ' selected' : ''}" onclick="pfAvatarPick('${def.id}','${opt.value}',${multi})" type="button">${opt.label}</button>`;
        }).join('');
        return `<div class="avatar-trait-section"><span class="avatar-trait-label">${def.label}</span><div class="avatar-trait-options">${opts}</div></div>`;
    }).join('');
}

// ===== Profiles.exe Window =====
(() => {
    const win      = document.getElementById('w95-win-profiles');
    const minBtn   = document.getElementById('w95-profiles-min');
    const closeBtn = document.getElementById('w95-profiles-close');
    const handle   = document.getElementById('w95-profiles-handle');
    const edWin    = document.getElementById('w95-win-avatar-editor');
    const edHandle = document.getElementById('w95-avatar-editor-handle');
    const edClose  = document.getElementById('w95-avatar-editor-close');
    if (!win || !minBtn || !closeBtn || !handle) return;

    const USERS = ['El', 'Tero'];
    let btn = null;
    const avatarData = { El: null, Tero: null };
    let editorUser  = null;
    let editorDraft = null;

    // ---- Window management ----
    function showProfiles() {
        if (!btn) btn = w95Mgr.addTaskbarBtn('w95-win-profiles', 'PROFILES', () => {
            if (win.classList.contains('is-hidden')) showProfiles(); else hideProfiles();
        });
        win.classList.remove('is-hidden');
        w95Mgr.focusWindow('w95-win-profiles');
        localStorage.setItem('w95_profiles_open', '1');
        _updateEditButtons();
    }

    function hideProfiles() {
        win.classList.add('is-hidden');
        if (w95Mgr.isActiveWin('w95-win-profiles')) w95Mgr.focusWindow(null);
        localStorage.setItem('w95_profiles_open', '0');
    }

    function closeProfiles() {
        win.classList.add('is-hidden');
        if (w95Mgr.isActiveWin('w95-win-profiles')) w95Mgr.focusWindow(null);
        localStorage.setItem('w95_profiles_open', '0');
        if (btn) { btn.remove(); btn = null; }
    }

    function _updateEditButtons() {
        USERS.forEach(u => {
            const b = document.getElementById(`profile-edit-btn-${u}`);
            if (!b) return;
            if (u === currentUser) b.classList.remove('is-hidden');
            else b.classList.add('is-hidden');
        });
    }

    // ---- Avatar rendering ----
    function _getTraits(user) {
        return Object.assign({}, PROF_DEFAULTS[user] || PROF_DEFAULTS.El, avatarData[user] || {});
    }

    function _renderAllAvatars() {
        USERS.forEach(u => {
            const el = document.getElementById(`profile-avatar-${u}`);
            if (el) el.innerHTML = buildAvatarSVG(_getTraits(u));
        });
    }

    // ---- Firebase: load saved avatars ----
    onValue(ref(database, 'profiles'), snap => {
        const data = snap.val() || {};
        USERS.forEach(u => { avatarData[u] = data[u]?.avatar || null; });
        _renderAllAvatars();
    });

    // ---- Avatar editor ----
    function _openEditor(user) {
        if (!currentUser || user !== currentUser) return;
        editorUser  = user;
        editorDraft = Object.assign({}, _getTraits(user));
        _refreshEditor();
        edWin.classList.remove('is-hidden');
        w95Mgr.focusWindow('w95-win-avatar-editor');
    }

    function _closeEditor() {
        edWin.classList.add('is-hidden');
        if (w95Mgr.isActiveWin('w95-win-avatar-editor')) w95Mgr.focusWindow(null);
        editorUser  = null;
        editorDraft = null;
    }

    function _refreshEditor() {
        const prev = document.getElementById('avatar-editor-preview');
        const secs = document.getElementById('avatar-editor-sections');
        const meta = document.getElementById('avatar-editor-meta');
        if (prev) prev.innerHTML = buildAvatarSVG(editorDraft);
        if (secs) secs.innerHTML = _profRenderEditorSections(editorDraft);
        if (meta) meta.textContent = editorUser || '';
    }

    function _pickTrait(traitId, value, multi) {
        if (!editorDraft) return;
        if (multi) {
            const arr = Array.isArray(editorDraft[traitId]) ? [...editorDraft[traitId]] : [];
            const idx = arr.indexOf(value);
            if (idx >= 0) arr.splice(idx, 1); else arr.push(value);
            editorDraft[traitId] = arr;
        } else {
            editorDraft[traitId] = value;
        }
        _refreshEditor();
    }

    async function _saveAvatar() {
        if (!editorUser || !editorDraft) return;
        try {
            await set(ref(database, `profiles/${editorUser}/avatar`), editorDraft);
            _closeEditor();
            showToast('Avatar saved!');
        } catch (e) {
            showToast('Save failed — try again.');
        }
    }

    function _randomiseAvatar() {
        editorDraft = _profRandomTraits();
        _refreshEditor();
    }

    // ---- Event bindings ----
    minBtn.onclick   = (e) => { e.stopPropagation(); hideProfiles(); };
    closeBtn.onclick = (e) => { e.stopPropagation(); closeProfiles(); };
    win.addEventListener('mousedown', () => w95Mgr.focusWindow('w95-win-profiles'));

    if (edClose) edClose.onclick = (e) => { e.stopPropagation(); _closeEditor(); };
    if (edWin)   edWin.addEventListener('mousedown', () => w95Mgr.focusWindow('w95-win-avatar-editor'));

    const saveBtn = document.getElementById('avatar-save-btn');
    const randBtn = document.getElementById('avatar-randomise-btn');
    if (saveBtn) saveBtn.onclick = _saveAvatar;
    if (randBtn) randBtn.onclick = _randomiseAvatar;

    // ---- App registry ----
    w95Apps['profiles'] = { open: () => {
        if (win.classList.contains('is-hidden')) showProfiles(); else w95Mgr.focusWindow('w95-win-profiles');
    }};

    // ---- Expose globals needed by inline onclick handlers ----
    window.openAvatarEditor = _openEditor;
    window.pfAvatarPick     = _pickTrait;

    // ---- Called after login to show the correct edit button ----
    window._profilesOnLogin = _updateEditButtons;

    makeDraggable(win, handle, 'w95-win-profiles');
    if (edWin && edHandle) makeDraggable(edWin, edHandle, 'w95-win-avatar-editor');

    if (localStorage.getItem('w95_profiles_open') === '1') showProfiles();
})();

// Shared drag helper used by window IIFEs and initPixelCat (must be module-level).
function makeDraggable(winEl, handleEl, winId) {
  let dragging = false, startX = 0, startY = 0, winStartX = 0, winStartY = 0;
  handleEl.addEventListener('mousedown', (e) => {
    if (e.target.closest('button')) return;
    if (w95Mgr.isMaximised(winId)) return;
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    const r = winEl.getBoundingClientRect();
    winStartX = r.left;
    winStartY = r.top;
    // z-index / focus already handled by the generic capture handler on the window
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const MIN_VIS = 60;
    const taskbarH = 40;
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight - taskbarH;
    winEl.style.left = Math.max(MIN_VIS - winEl.offsetWidth, Math.min(vw - MIN_VIS, winStartX + (e.clientX - startX))) + 'px';
    winEl.style.top  = Math.max(0, Math.min(vh - MIN_VIS, winStartY + (e.clientY - startY))) + 'px';
  });
  window.addEventListener('mouseup', () => {
    if (dragging) {
        dragging = false;
        w95Layout.save(winEl, winId);
        // Track window moves for Window Tinkerer achievement
        const moves = Number(localStorage.getItem('windowMoveCount') || 0) + 1;
        localStorage.setItem('windowMoveCount', String(moves));
        if (moves >= 20) unlockAchievement('window_tinkerer');
    }
  });
}

// ===== CUSTOM WINDOW RESIZE =====
// Adds 8 resize handles (4 edges + 4 corners) to a window element.
// Replaces the native CSS resize:both, which conflicted with scroll bars.
function makeResizable(winEl, winId) {
  ['n','ne','e','se','s','sw','w','nw'].forEach(dir => {
    const h = document.createElement('div');
    h.className = 'w95-resize-handle ' + dir;
    h.dataset.dir = dir;
    winEl.appendChild(h);
  });
}

// Single global resize state – shared across all windows.
let _winResizeState = null;

document.addEventListener('mousedown', (e) => {
  const handle = e.target.closest('.w95-resize-handle');
  if (!handle) return;
  const winEl = handle.closest('.w95-window');
  if (!winEl) return;
  const winId = winEl.id;
  if (w95Mgr.isMaximised(winId)) return;
  const r = winEl.getBoundingClientRect();
  _winResizeState = {
    winEl, winId,
    dir: handle.dataset.dir,
    startX: e.clientX, startY: e.clientY,
    startW: r.width, startH: r.height,
    startL: r.left, startT: r.top
  };
  e.preventDefault();
  e.stopPropagation();
}, true);

window.addEventListener('mousemove', (e) => {
  if (!_winResizeState) return;
  const { winEl, dir, startX, startY, startW, startH, startL, startT } = _winResizeState;
  const dx = e.clientX - startX;
  const dy = e.clientY - startY;
  const MIN_W = 200, MIN_H = 80;
  let newW = startW, newH = startH, newL = startL, newT = startT;
  if (dir.includes('e')) newW = Math.max(MIN_W, startW + dx);
  if (dir.includes('s')) newH = Math.max(MIN_H, startH + dy);
  if (dir.includes('w')) { newW = Math.max(MIN_W, startW - dx); newL = startL + startW - newW; }
  if (dir.includes('n')) { newH = Math.max(MIN_H, startH - dy); newT = startT + startH - newH; }
  winEl.style.width  = newW + 'px';
  winEl.style.height = newH + 'px';
  winEl.style.left   = newL + 'px';
  winEl.style.top    = newT + 'px';
});

window.addEventListener('mouseup', () => {
  if (_winResizeState) {
    w95Layout.save(_winResizeState.winEl, _winResizeState.winId);
    _winResizeState = null;
  }
});

// ===== ACHIEVEMENT TRACKING HELPERS =====

// Record today as a site-visit day for Rainy Day achievement.
// Safe to call multiple times per day — Set ensures deduplication.
function _recordSiteVisitDay() {
    try {
        const key   = 'siteVisitDays';
        const days  = new Set(JSON.parse(localStorage.getItem(key) || '[]'));
        const today = new Date().toISOString().slice(0, 10);
        if (!days.has(today)) {
            days.add(today);
            localStorage.setItem(key, JSON.stringify([...days]));
        }
        const count = days.size;
        if (count >= 5)  unlockAchievement('rainy_day');
        if (unlockedAchievements.size >= 10) unlockAchievement('power_user');
    } catch (_) {}
}

// Track a window open event for Bouncer + Curious Mind achievements.
// appKey should match the w95Apps key (e.g. 'feed', 'garden', 'cat').
const _CURIOUS_MIND_APPS = new Set(['feed','chat','garden','cat','mailbox','console','achievements','jukebox','settings']);
function _trackWindowOpen(appKey) {
    try {
        // Bouncer: raw open count
        const opens = Number(localStorage.getItem('windowOpenCount') || 0) + 1;
        localStorage.setItem('windowOpenCount', String(opens));
        if (opens >= 10) unlockAchievement('bouncer');

        // Curious Mind: set of unique apps opened
        const seenKey  = 'openedApps';
        const seen     = new Set(JSON.parse(localStorage.getItem(seenKey) || '[]'));
        if (appKey) seen.add(appKey);
        localStorage.setItem(seenKey, JSON.stringify([...seen]));
        const allSeen  = _CURIOUS_MIND_APPS.size > 0 && [..._CURIOUS_MIND_APPS].every(a => seen.has(a));
        if (allSeen) unlockAchievement('curious_mind');

        if (unlockedAchievements.size >= 10) unlockAchievement('power_user');
    } catch (_) {}
}

// Track a link being opened from the feed for Deep Reader achievement.
function _trackLinkOpen() {
    try {
        const count = Number(localStorage.getItem('linksOpenedCount') || 0) + 1;
        localStorage.setItem('linksOpenedCount', String(count));
        if (count >= 25) unlockAchievement('deep_reader');
        if (unlockedAchievements.size >= 10) unlockAchievement('power_user');
    } catch (_) {}
}

// ===== ACHIEVEMENTS =====

// Returns local date as "YYYY-MM-DD" (optionally offset by `offsetDays`).
function localDateStr(offsetDays = 0) {
    const d = new Date();
    if (offsetDays) d.setDate(d.getDate() + offsetDays);
    return d.getFullYear() + '-' +
        String(d.getMonth() + 1).padStart(2, '0') + '-' +
        String(d.getDate()).padStart(2, '0');
}

// Unlock Night Owl or Early Bird based on the current local hour.
function checkTimeBasedAchievements() {
    const hr = new Date().getHours();
    if (hr >= 0 && hr < 5) {
        unlockAchievement('night_owl');
        // Track 5-visit Night Owl (night_visits)
        const nv = Number(localStorage.getItem('nightVisitCount') || 0) + 1;
        localStorage.setItem('nightVisitCount', String(nv));
        if (nv >= 5) unlockAchievement('night_visits');
    } else if (hr >= 5 && hr < 8) {
        unlockAchievement('early_bird');
        // Track 5-visit Early Bird (morning_visits)
        const mv = Number(localStorage.getItem('morningVisitCount') || 0) + 1;
        localStorage.setItem('morningVisitCount', String(mv));
        if (mv >= 5) unlockAchievement('morning_visits');
    }
}

// Check all mythic achievements. Call after any significant action.
// newPostBody: body text of a just-created post (may not be in allPosts yet).
async function checkMythics(newPostBody = null) {
    if (!currentUser) return;
    const today = localDateStr();

    // 1. anniversary_mode — special calendar date
    if (today.slice(5) === ANNIVERSARY_MM_DD) {
        await unlockAchievement('anniversary_mode');
    }

    // 2. inside_joke — any post body contains the magic phrase
    if (!unlockedAchievements.has('inside_joke')) {
        const jokeLower     = INSIDE_JOKE.toLowerCase();
        const foundInNew    = !!(newPostBody && newPostBody.toLowerCase().includes(jokeLower));
        const foundInExisting = !foundInNew && Object.values(allPosts)
            .some(p => p.author === currentUser && p.body && p.body.toLowerCase().includes(jokeLower));
        if (foundInNew || foundInExisting) await unlockAchievement('inside_joke');
    }

    // 3. all_three_today — posted + watered + chatted on the same day
    const todayActs = dailyActions[today] || {};
    if (todayActs.didPost && todayActs.didWater && todayActs.didChat) {
        await unlockAchievement('all_three_today');
    }

    // 4. comeback_kid — streak rebuilt to >=3 after having broken from >=3
    if (comebackArmed && currentWateringStreak >= 3) {
        comebackArmed = false;
        update(ref(database, 'userStats/' + currentUser), { comebackArmed: false }).catch(() => {});
        await unlockAchievement('comeback_kid');
    }

    // 5. same_braincell — both users post within 10 minutes of each other
    if (!unlockedAchievements.has('same_braincell')) {
        const otherUser  = currentUser === 'El' ? 'Tero' : 'El';
        const myPosts    = Object.values(allPosts).filter(p => p.author === currentUser);
        const otherPosts = Object.values(allPosts).filter(p => p.author === otherUser);
        const TEN_MIN    = 10 * 60 * 1000;
        const matched    = myPosts.some(mp =>
            otherPosts.some(op => Math.abs((op.timestamp || 0) - (mp.timestamp || 0)) < TEN_MIN)
        );
        if (matched) await unlockAchievement('same_braincell');
    }

    // 6. long_distance_high_five — one user posts, the other chats within 1 hour
    if (!unlockedAchievements.has('long_distance_high_five')) {
        const otherUser  = currentUser === 'El' ? 'Tero' : 'El';
        const myPosts    = Object.values(allPosts).filter(p => p.author === currentUser);
        const otherPosts = Object.values(allPosts).filter(p => p.author === otherUser);
        const ONE_HOUR   = 60 * 60 * 1000;
        const highFive   =
            myPosts.some(mp => lastChatMessages.some(
                c => c.author === otherUser && Math.abs((c.timestamp || 0) - (mp.timestamp || 0)) < ONE_HOUR
            )) ||
            otherPosts.some(op => lastChatMessages.some(
                c => c.author === currentUser && Math.abs((c.timestamp || 0) - (op.timestamp || 0)) < ONE_HOUR
            ));
        if (highFive) await unlockAchievement('long_distance_high_five');
    }

    // 7. we_were_here — both visited garden on the same day 20+ times total
    //    At most ONE read of the other user's gardenVisitDays (cached in memory).
    if (!unlockedAchievements.has('we_were_here')) {
        try {
            const otherUser = currentUser === 'El' ? 'Tero' : 'El';
            if (_otherUserGardenVisitDaysCache === null) {
                const snap = await get(ref(database, 'userStats/' + otherUser + '/gardenVisitDays'));
                _otherUserGardenVisitDaysCache = snap.val() || {};
            }
            const sharedCount = Object.keys(gardenVisitDays)
                .filter(d => _otherUserGardenVisitDaysCache[d]).length;
            if (sharedCount >= 20) await unlockAchievement('we_were_here');
        } catch (e) {
            console.error('checkMythics we_were_here failed', e);
        }
    }

    // 8. both_water3_day — both users watered 3 times on the same calendar day
    // 9. both_water3_week — both users have water3Streak.current >= 7
    //    At most ONE combined read of the other user's dailyWaterCounts + water3Streak (cached, invalidated by date).
    if (!unlockedAchievements.has('both_water3_day') || !unlockedAchievements.has('both_water3_week')) {
        try {
            const otherUser = currentUser === 'El' ? 'Tero' : 'El';
            if (!_otherUserWater3Cache || _otherUserWater3Cache.date !== today) {
                const [countSnap, streakSnap] = await Promise.all([
                    get(ref(database, `userStats/${otherUser}/dailyWaterCounts/${today}`)),
                    get(ref(database, `userStats/${otherUser}/water3Streak`)),
                ]);
                _otherUserWater3Cache = {
                    date:       today,
                    todayCount: countSnap.val() || 0,
                    streak:     streakSnap.val() || { current: 0, lastDate: null },
                };
            }
            const myCount = dailyWaterCounts[today] || 0;
            if (!unlockedAchievements.has('both_water3_day') &&
                    myCount >= 3 && _otherUserWater3Cache.todayCount >= 3) {
                await unlockAchievement('both_water3_day');
            }
            if (!unlockedAchievements.has('both_water3_week') &&
                    water3Streak.current >= 7 && _otherUserWater3Cache.streak.current >= 7) {
                await unlockAchievement('both_water3_week');
            }
        } catch (e) {
            console.error('checkMythics both_water3 failed', e);
        }
    }
}

// Record that the current user opened the garden today, updating the visit
// day-map and consecutive-day streak. Called when the garden window is shown,
// NOT during achievement initialisation (which would count every login).
async function recordGardenVisit() {
    if (!currentUser) return;
    try {
        const today     = localDateStr();
        const yesterday = localDateStr(-1);
        if (!gardenVisitDays[today]) {
            const newCurrent = gardenVisitStreak.lastDate === yesterday
                ? gardenVisitStreak.current + 1
                : 1;
            gardenVisitDays[today] = true;
            gardenVisitStreak = { current: newCurrent, lastDate: today };
            await update(ref(database, 'userStats/' + currentUser), {
                [`gardenVisitDays/${today}`]: true,
                gardenVisitStreak: { current: newCurrent, lastDate: today },
            });
        }
        const visitCount = Object.keys(gardenVisitDays).length;
        if (visitCount >= 3)  await unlockAchievement('digital_gardener');
        if (visitCount >= 5)  await unlockAchievement('frog_friend');
        if (visitCount >= 7)  await unlockAchievement('checked_in');
        if (visitCount >= 14) await unlockAchievement('visit_14_total');
        if (visitCount >= 30) await unlockAchievement('visit_30_total');
        if (visitCount >= 60) await unlockAchievement('visit_60_total');
        if (gardenVisitStreak.current >= 7)  await unlockAchievement('week_streak');
        if (gardenVisitStreak.current >= 14) await unlockAchievement('visit_streak_14');
        if (gardenVisitStreak.current >= 30) await unlockAchievement('visit_streak_30');
        if (unlockedAchievements.size >= 10) await unlockAchievement('power_user');
        await checkMythics();
        renderAchievementsWindow();
    } catch (e) {
        console.error('recordGardenVisit failed', e);
    }
}

// Same-hour Visit Spark: show a toast when both users have the garden open within 60 min.
// Writes lastGardenOpen for the current user, reads it for the other user.
// Called from show() (inside the garden IIFE) on every garden-open event.
async function checkVisitSpark() {
    if (!currentUser) return;
    try {
        const otherUser = currentUser === 'El' ? 'Tero' : 'El';
        const now       = Date.now();
        // Read the other user's timestamp BEFORE writing our own to avoid a self-match
        // on the first open (both would be 0 / null otherwise).
        const otherSnap = await get(ref(database, 'userStats/' + otherUser + '/lastGardenOpen'));
        const otherTs   = otherSnap.val();
        // Record our own open time so the other user can see it on their next open.
        await update(ref(database, 'userStats/' + currentUser), { lastGardenOpen: now });
        // Toast if the other user opened the garden within the last 60 minutes.
        if (typeof otherTs === 'number' && (now - otherTs) < 60 * 60 * 1000) {
            showToast("You're both here 💚");
        }
    } catch (e) {
        console.error('checkVisitSpark failed', e);
    }
}

// Achievement definitions.
// Fields:
//   id                  – unique string key (matches Firebase key)
//   title               – display name
//   desc                – description / flavour text shown in UI and popup
//   icon                – Win95-style text icon
//   xp                  – XP reward on first unlock
//   tier                – 'bronze' | 'silver' | 'gold' | 'mythic'
//   hiddenUntilUnlocked – (optional) if true: hidden by default, shows ??? silhouette with "Show Unknown" toggle ON
//   target              – (optional) numeric goal; enables progress bar
//   getProgress         – (optional) function() => current count (live, not stored)
//   rewardIds           – (optional) array of reward ids from REWARD_REGISTRY to unlock
//
// To add a new count-based achievement:
//   { id: 'my_ach', title: 'My Achievement', desc: 'Do X things', icon: '[X]',
//     xp: 10, tier: 'bronze', target: 5, getProgress: () => /* live counter */ }
//
// To add an achievement that unlocks a reward:
//   1. Add the reward entry to REWARD_REGISTRY (above ACHIEVEMENTS).
//   2. Add rewardIds: ['your_reward_id'] to the achievement entry here.
var ACHIEVEMENTS = [
    // ---- Posting ----
    // To adjust XP values: change the `xp` field below. Level formula is flat 100 XP/level.
    {
        id:   'first_post',
        title: 'First Post!',
        desc:  'Create your first post',
        icon:  '[*]',
        xp:    10,
        tier:  'bronze',
    },
    {
        id:          'five_posts',
        title:       'Five Posts',
        desc:        'Create 5 posts',
        icon:        '[5]',
        xp:          10,
        tier:        'bronze',
        target:      5,
        getProgress: () => Object.values(allPosts).filter(p => p.author === currentUser).length,
        rewardIds:   ['wp_sakura'],
    },
    {
        id:          'ten_posts',
        title:       'Ten Posts',
        desc:        'Create 10 posts',
        icon:        '[10]',
        xp:          25,
        tier:        'silver',
        target:      10,
        getProgress: () => Object.values(allPosts).filter(p => p.author === currentUser).length,
        rewardIds:   ['ss_starfield'],
    },
    {
        id:          'twenty_posts',
        title:       'Twenty Posts',
        desc:        'Create 20 posts',
        icon:        '[20]',
        xp:          25,
        tier:        'gold',
        target:      20,
        getProgress: () => Object.values(allPosts).filter(p => p.author === currentUser).length,
        rewardIds:   ['theme_pastel'],
    },
    {
        id:          'thirty_posts',
        title:       'Thirty Posts',
        desc:        'Create 30 posts',
        icon:        '[30]',
        xp:          30,
        tier:        'bronze',
        target:      30,
        getProgress: () => Object.values(allPosts).filter(p => p.author === currentUser).length,
    },
    {
        id:          'fifty_posts',
        title:       'Fifty Posts',
        desc:        'Create 50 posts',
        icon:        '[50]',
        xp:          50,
        tier:        'silver',
        target:      50,
        getProgress: () => Object.values(allPosts).filter(p => p.author === currentUser).length,
    },
    {
        id:          'hundred_posts',
        title:       'Century',
        desc:        'Create 100 posts',
        icon:        '[C]',
        xp:          100,
        tier:        'gold',
        target:      100,
        getProgress: () => Object.values(allPosts).filter(p => p.author === currentUser).length,
        rewardIds:   ['catb_zoomies'],
    },

    // ---- Post length ----
    {
        id:          'longform_1',
        title:       'Long Read',
        desc:        'Write a post with 500 or more characters',
        icon:        '[L]',
        xp:          15,
        tier:        'bronze',
        target:      1,
        getProgress: () => Object.values(allPosts).filter(p => p.author === currentUser && p.body && p.body.length >= 500).length,
        rewardIds:   ['snd_retro'],
    },
    {
        id:          'longform_5',
        title:       'Essayist',
        desc:        'Write 5 posts with 500 or more characters each',
        icon:        '[LL]',
        xp:          35,
        tier:        'silver',
        target:      5,
        getProgress: () => Object.values(allPosts).filter(p => p.author === currentUser && p.body && p.body.length >= 500).length,
    },
    {
        id:          'minimalist_5',
        title:       'Minimalist',
        desc:        'Write 5 posts under 30 characters each',
        icon:        '[.]',
        xp:          15,
        tier:        'bronze',
        target:      5,
        getProgress: () => Object.values(allPosts).filter(p => p.author === currentUser && p.body && p.body.length > 0 && p.body.length < 30).length,
    },
    {
        id:          'minimalist_20',
        title:       'Zen Master',
        desc:        'Write 20 posts under 30 characters each',
        icon:        '[..]',
        xp:          60,
        tier:        'gold',
        target:      20,
        getProgress: () => Object.values(allPosts).filter(p => p.author === currentUser && p.body && p.body.length > 0 && p.body.length < 30).length,
    },

    // ---- XP / Meta ----
    {
        id:          'level_5',
        title:       'Level 5',
        desc:        'Reach Garden Level 5',
        icon:        '[5]',
        xp:          50,
        tier:        'silver',
        target:      5,
        getProgress: () => xpToLevel(xpTotal),
    },
    {
        id:          'unlock_25',
        title:       'Collector',
        desc:        'Unlock 25 achievements',
        icon:        '[*]',
        xp:          75,
        tier:        'gold',
        target:      25,
        getProgress: () => unlockedAchievements.size,
    },

    // ---- Garden actions ----
    {
        id:    'first_sprout',
        title: 'First Sprout',
        desc:  'Water the garden for the first time',
        icon:  '[~]',
        xp:    10,
        tier:  'bronze',
    },
    {
        id:          'watering_can',
        title:       'Watering Can',
        desc:        'Water the garden 5 times',
        icon:        '[W]',
        xp:          25,
        tier:        'silver',
        target:      5,
        getProgress: () => totalWaterings,
        rewardIds:   ['snd_nature'],
    },
    {
        id:          'watering_10',
        title:       'Dedicated Gardener',
        desc:        'Water the garden 10 times',
        icon:        '[W]',
        xp:          15,
        tier:        'bronze',
        target:      10,
        getProgress: () => totalWaterings,
    },
    {
        id:          'watering_25',
        title:       'Hydration Station',
        desc:        'Water the garden 25 times',
        icon:        '[W]',
        xp:          20,
        tier:        'bronze',
        target:      25,
        getProgress: () => totalWaterings,
        rewardIds:   ['wp_anim_clouds'],
    },
    {
        id:          'watering_50',
        title:       'Rainmaker',
        desc:        'Water the garden 50 times',
        icon:        '[W]',
        xp:          35,
        tier:        'silver',
        target:      50,
        getProgress: () => totalWaterings,
    },
    {
        id:          'watering_100',
        title:       'Garden Guardian',
        desc:        'Water the garden 100 times',
        icon:        '[W]',
        xp:          75,
        tier:        'gold',
        target:      100,
        getProgress: () => totalWaterings,
        rewardIds:   ['cat_glasses', 'theme_midnight'],
    },
    {
        id:          'water_3_days',
        title:       'Green Thumb',
        desc:        'Water your garden 3 days in a row',
        icon:        ':)',
        xp:          25,
        tier:        'silver',
        target:      3,
        getProgress: () => currentWateringStreak,
        rewardIds:   ['cat_bow'],
    },
    {
        id:          'water_7_days',
        title:       'Weekly Waterer',
        desc:        'Water your garden 7 days in a row',
        icon:        'xD',
        xp:          40,
        tier:        'silver',
        target:      7,
        getProgress: () => currentWateringStreak,
        rewardIds:   ['wp_nightsky'],
    },
    {
        id:          'water_14_days',
        title:       'Fortnight Flow',
        desc:        'Water your garden 14 days in a row',
        icon:        '[:',
        xp:          75,
        tier:        'gold',
        target:      14,
        getProgress: () => currentWateringStreak,
        rewardIds:   ['wp_cozy_rain', 'ss_bubbles'],
    },

    // ---- Visiting / consistency ----
    {
        id:          'checked_in',
        title:       'Checked In',
        desc:        'Open the garden on 7 different days',
        icon:        '[7]',
        xp:          25,
        tier:        'silver',
        target:      7,
        getProgress: () => Object.keys(gardenVisitDays).length,
        rewardIds:   ['wp_garden'],
    },
    {
        id:          'visit_14_total',
        title:       'Regular Visitor',
        desc:        'Open the garden on 14 different days',
        icon:        '[V]',
        xp:          20,
        tier:        'bronze',
        target:      14,
        getProgress: () => Object.keys(gardenVisitDays).length,
        rewardIds:   ['wp_anim_forest'],
    },
    {
        id:          'visit_30_total',
        title:       'Monthly Regular',
        desc:        'Open the garden on 30 different days',
        icon:        '[V]',
        xp:          40,
        tier:        'silver',
        target:      30,
        getProgress: () => Object.keys(gardenVisitDays).length,
        rewardIds:   ['theme_autumn'],
    },
    {
        id:          'visit_60_total',
        title:       'Seasoned Visitor',
        desc:        'Open the garden on 60 different days',
        icon:        '[V]',
        xp:          75,
        tier:        'gold',
        target:      60,
        getProgress: () => Object.keys(gardenVisitDays).length,
    },
    {
        id:          'week_streak',
        title:       'Week Streak',
        desc:        'Visit 7 days in a row',
        icon:        '[>]',
        xp:          50,
        tier:        'gold',
        target:      7,
        getProgress: () => gardenVisitStreak.current,
        rewardIds:   ['catb_knead'],
    },
    {
        id:          'visit_streak_14',
        title:       'Two-Week Streak',
        desc:        'Visit 14 days in a row',
        icon:        '[>>]',
        xp:          75,
        tier:        'gold',
        target:      14,
        getProgress: () => gardenVisitStreak.current,
    },
    {
        id:          'visit_streak_30',
        title:       'Monthly Streak',
        desc:        'Visit 30 days in a row',
        icon:        '[>>>]',
        xp:          100,
        tier:        'gold',
        target:      30,
        getProgress: () => gardenVisitStreak.current,
    },

    // ---- Hidden / Mythic ----
    {
        id:                  'night_owl',
        title:               'Night Owl',
        desc:                'Do something between midnight and 4:59 AM',
        icon:                '[O]',
        hiddenUntilUnlocked: true,
        tier:                'mythic',
        xp:                  30,
        rewardIds:           ['wp_anim_nightsky'],
    },
    {
        id:                  'early_bird',
        title:               'Early Bird',
        desc:                'Do something between 5:00 and 7:59 AM',
        icon:                '[E]',
        hiddenUntilUnlocked: true,
        tier:                'mythic',
        xp:                  30,
    },
    {
        id:                  'anniversary_mode',
        title:               'Anniversary Mode',
        desc:                'Visit on a very special day',
        icon:                '[<3]',
        hiddenUntilUnlocked: true,
        tier:                'mythic',
        xp:                  100,
    },
    {
        id:                  'inside_joke',
        title:               'Inside Joke',
        desc:                'Post the magic words',
        icon:                '[?]',
        hiddenUntilUnlocked: true,
        tier:                'mythic',
        xp:                  100,
    },
    {
        id:                  'all_three_today',
        title:               'Full House',
        desc:                'Post, water, and chat all in one day',
        icon:                '[3]',
        hiddenUntilUnlocked: true,
        tier:                'mythic',
        xp:                  150,
    },
    {
        id:                  'comeback_kid',
        title:               'Comeback Kid',
        desc:                'Rebuild a watering streak after it broke',
        icon:                '[>>]',
        hiddenUntilUnlocked: true,
        tier:                'mythic',
        xp:                  150,
    },
    {
        id:                  'same_braincell',
        title:               'Same Braincell',
        desc:                'Post within 10 minutes of each other',
        icon:                '[~~]',
        hiddenUntilUnlocked: true,
        tier:                'mythic',
        xp:                  200,
    },
    {
        id:                  'long_distance_high_five',
        title:               'Long Distance High Five',
        desc:                'One posts, the other chats within an hour',
        icon:                '^5',
        hiddenUntilUnlocked: true,
        tier:                'mythic',
        xp:                  200,
    },
    {
        id:                  'we_were_here',
        title:               'We Were Here',
        desc:                'Visit the garden on the same day 20 times',
        icon:                '[H]',
        hiddenUntilUnlocked: true,
        tier:                'mythic',
        xp:                  300,
    },

    // ---- Per-user 3-waters-a-day ----
    {
        id:          'water3_day',
        title:       'Triple Waters',
        desc:        'Water the garden 3 times in one day',
        icon:        '[3~]',
        xp:          30,
        tier:        'silver',
        target:      3,
        getProgress: () => dailyWaterCounts[localDateStr()] || 0,
    },
    {
        id:          'water3_week',
        title:       'Week of Triples',
        desc:        'Water 3 times a day for 7 days in a row',
        icon:        '[7~]',
        xp:          75,
        tier:        'gold',
        target:      7,
        getProgress: () => water3Streak.current,
    },

    // ---- Shared 3-waters-a-day (mythic) ----
    {
        id:                  'both_water3_day',
        title:               'Double Dedication',
        desc:                'Both water the garden 3 times on the same day',
        icon:                '[33]',
        hiddenUntilUnlocked: true,
        tier:                'mythic',
        xp:                  100,
    },
    {
        id:                  'both_water3_week',
        title:               'Garden Devotion',
        desc:                'Both water 3 times a day for 7 days in a row',
        icon:                '[77]',
        hiddenUntilUnlocked: true,
        tier:                'mythic',
        xp:                  200,
    },

    // ---- Replies ----
    {
        id:    'first_reply',
        title: 'First Reply',
        desc:  'Send your first reply to a post',
        icon:  '[>]',
        xp:    10,
        tier:  'bronze',
    },
    {
        id:          'ten_replies',
        title:       'Regular Commenter',
        desc:        'Send 10 replies',
        icon:        '[>>]',
        xp:          25,
        tier:        'silver',
        target:      10,
        getProgress: () => Object.values(allPosts).reduce((acc, p) => acc + (p.replies || []).filter(r => r.author === currentUser).length, 0),
        rewardIds:   ['cmd_stats'],
    },

    // ---- Reactions ----
    {
        id:    'first_reaction',
        title: 'First Reaction',
        desc:  'React to a post for the first time',
        icon:  '[<3]',
        xp:    10,
        tier:  'bronze',
    },
    {
        id:          'twentyfive_reactions',
        title:       'Reactor',
        desc:        'React to posts 25 times',
        icon:        '[:D]',
        xp:          30,
        tier:        'silver',
        target:      25,
        getProgress: () => Object.values(allPosts).reduce((acc, p) => {
            const rxBy = p.reactionsBy || {};
            return acc + Object.values(rxBy).filter(users => users && users[currentUser]).length;
        }, 0),
        rewardIds:   ['cmd_reactstats'],
    },

    // ---- Letters ----
    {
        id:    'first_letter',
        title: 'First Letter',
        desc:  'Send your first letter',
        icon:  '[L]',
        xp:    10,
        tier:  'bronze',
        rewardIds: ['ss_petals'],
    },
    {
        id:          'five_letters',
        title:       'Pen Pal',
        desc:        'Send 5 letters',
        icon:        '[LL]',
        xp:          25,
        tier:        'silver',
        target:      5,
        getProgress: () => Object.values(allLetters).filter(l => l.from === currentUser).length,
        rewardIds:   ['cmd_letters', 'catb_loaf'],
    },

    // ---- Cat ----
    {
        id:    'first_cat_action',
        title: 'Cat Parent',
        desc:  'Perform your first cat action (feed, water, yarn)',
        icon:  '[~]',
        xp:    10,
        tier:  'bronze',
        rewardIds: ['cat_hat'],
    },
    {
        id:          'ten_cat_actions',
        title:       'Devoted Cat Parent',
        desc:        'Perform 10 total cat actions',
        icon:        '[~~]',
        xp:          25,
        tier:        'silver',
        target:      10,
        getProgress: () => Number(localStorage.getItem('catActionCount') || 0),
        rewardIds:   ['cmd_catstats', 'cat_scarf'],
    },

    // ---- Garden Talk ----
    {
        id:    'first_garden_talk',
        title: 'Plant Whisperer',
        desc:  'Talk to the garden for the first time',
        icon:  '[T]',
        xp:    10,
        tier:  'bronze',
        rewardIds: ['snd_cozy'],
    },
    {
        id:          'ten_garden_talks',
        title:       'Garden Conversationalist',
        desc:        'Talk to the garden 10 times',
        icon:        '[TT]',
        xp:          20,
        tier:        'silver',
        target:      10,
        getProgress: () => Number(localStorage.getItem('garden_talkCount') || 0),
        rewardIds:   ['cmd_gardenlog'],
    },

    // ---- Personalisation ----
    {
        id:    'first_wallpaper_change',
        title: 'Interior Decorator',
        desc:  'Change your wallpaper for the first time',
        icon:  '[wp]',
        xp:    10,
        tier:  'bronze',
    },

    // ================================================================
    // ---- Achievement Set: First Transmission ----
    // ================================================================

    // ---- Feed / Link achievements ----
    {
        id:          'first_transmission',
        title:       'First Transmission',
        desc:        'Share your first link into the feed',
        icon:        '[>>]',
        xp:          15,
        tier:        'bronze',
        rewardIds:   ['wp_cat_monitor'],
    },
    {
        id:          'link_hoarder_10',
        title:       'Link Hoarder I',
        desc:        'Share 10 links',
        icon:        '[L]',
        xp:          25,
        tier:        'silver',
        target:      10,
        getProgress: () => Object.values(allPosts).filter(p => p.author === currentUser && (!p.type || p.type === 'link') && p.url).length,
        rewardIds:   ['ss_feed_slideshow'],
    },
    {
        id:          'link_hoarder_50',
        title:       'Link Hoarder II',
        desc:        'Share 50 links — you are the algorithm now',
        icon:        '[LL]',
        xp:          60,
        tier:        'gold',
        target:      50,
        getProgress: () => Object.values(allPosts).filter(p => p.author === currentUser && (!p.type || p.type === 'link') && p.url).length,
        rewardIds:   ['theme_glass'],
    },
    {
        id:          'deep_reader',
        title:       'Deep Reader',
        desc:        'Open 25 links shared by the other person',
        icon:        '[R]',
        xp:          30,
        tier:        'silver',
        target:      25,
        getProgress: () => Number(localStorage.getItem('linksOpenedCount') || 0),
        rewardIds:   ['wp_infinite_desktop'],
    },
    {
        id:          'archivist',
        title:       'Archivist',
        desc:        'Scroll all the way back to the very first post',
        icon:        '[A]',
        xp:          25,
        tier:        'silver',
        rewardIds:   ['wp_retro_clouds'],
    },

    // ---- Time-of-day achievements ----
    {
        id:          'night_visits',
        title:       'Night Owl',
        desc:        'Visit after midnight, five times — the feed looks different when the world is asleep',
        icon:        '[🦉]',
        xp:          40,
        tier:        'silver',
        target:      5,
        hiddenUntilUnlocked: true,
        getProgress: () => Number(localStorage.getItem('nightVisitCount') || 0),
        rewardIds:   ['wp_midnight'],
    },
    {
        id:          'morning_visits',
        title:       'Early Bird',
        desc:        'Catch the feed before 8 AM, five times',
        icon:        '[🐦]',
        xp:          40,
        tier:        'silver',
        target:      5,
        hiddenUntilUnlocked: true,
        getProgress: () => Number(localStorage.getItem('morningVisitCount') || 0),
        rewardIds:   ['garden_butterflies'],
    },

    // ---- Cat achievements ----
    {
        id:          'cat_whisperer',
        title:       'Cat Whisperer',
        desc:        'Interact with the cat 25 times — it has started to expect you',
        icon:        '[~^~]',
        xp:          35,
        tier:        'silver',
        target:      25,
        getProgress: () => Number(localStorage.getItem('catActionCount') || 0),
        rewardIds:   ['snd_cute'],
    },
    {
        id:          'explorer_cat',
        title:       'Explorer Cat',
        desc:        'Interact with the cat on 3 different days',
        icon:        '[🗺️]',
        xp:          30,
        tier:        'silver',
        target:      3,
        getProgress: () => { try { return JSON.parse(localStorage.getItem('catInteractDays') || '[]').length; } catch(_) { return 0; } },
        rewardIds:   ['cat_explorer'],
    },
    {
        id:          'soft_paws',
        title:       'Soft Paws',
        desc:        'Unlock 3 cat-related achievements — the cat acknowledges your devotion',
        icon:        '[🌸]',
        xp:          50,
        tier:        'gold',
        target:      3,
        getProgress: () => ['first_cat_action','ten_cat_actions','cat_whisperer','explorer_cat'].filter(id => unlockedAchievements.has(id)).length,
        rewardIds:   ['cat_flower_crown'],
    },

    // ---- Console achievements ----
    {
        id:          'console_wizard',
        title:       'Console Wizard',
        desc:        'Run 10 console commands — the terminal is your friend now',
        icon:        '[>_]',
        xp:          30,
        tier:        'silver',
        target:      10,
        getProgress: () => Number(localStorage.getItem('consoleCommandCount') || 0),
        rewardIds:   ['cat_wizard_hat'],
    },

    // ---- Desktop / exploration achievements ----
    {
        id:          'window_tinkerer',
        title:       'Window Tinkerer',
        desc:        'Move windows around 20 times — rearranging is the art',
        icon:        '[ww]',
        xp:          20,
        tier:        'bronze',
        target:      20,
        getProgress: () => Number(localStorage.getItem('windowMoveCount') || 0),
        rewardIds:   ['cat_sunglasses'],
    },
    {
        id:          'bouncer',
        title:       'Bouncer',
        desc:        'Open and close apps 10 times — in, out, in, out',
        icon:        '[><]',
        xp:          15,
        tier:        'bronze',
        target:      10,
        getProgress: () => Number(localStorage.getItem('windowOpenCount') || 0),
        rewardIds:   ['ss_bouncing_logo'],
    },
    {
        id:          'pixel_mood',
        title:       'Pixel Mood',
        desc:        'Change the desktop look 5 times — the vibe must be right',
        icon:        '[*wp]',
        xp:          20,
        tier:        'bronze',
        target:      5,
        getProgress: () => Number(localStorage.getItem('wallpaperChangeCount') || 0),
        rewardIds:   ['theme_pixel'],
    },
    {
        id:          'curious_mind',
        title:       'Curious Mind',
        desc:        'Open every main app at least once',
        icon:        '[?!]',
        xp:          50,
        tier:        'gold',
        rewardIds:   ['theme_crt'],
    },

    // ---- Garden / time-based achievements ----
    {
        id:          'digital_gardener',
        title:       'Digital Gardener',
        desc:        'Visit the garden on 3 different days — seeds take time',
        icon:        '[~G]',
        xp:          20,
        tier:        'bronze',
        target:      3,
        getProgress: () => Object.keys(gardenVisitDays).length,
        rewardIds:   ['snd_garden_pack'],
    },
    {
        id:          'frog_friend',
        title:       'Frog Friend',
        desc:        'Visit the garden on 5 different days — the frogs have been watching',
        icon:        '[🐸]',
        xp:          25,
        tier:        'silver',
        target:      5,
        getProgress: () => Object.keys(gardenVisitDays).length,
        rewardIds:   ['garden_frogs'],
    },
    {
        id:          'rainy_day',
        title:       'Rainy Day',
        desc:        'Come back to the feed on 5 different days — it is always here',
        icon:        '[☁]',
        xp:          30,
        tier:        'silver',
        target:      5,
        getProgress: () => { try { return JSON.parse(localStorage.getItem('siteVisitDays') || '[]').length; } catch(_) { return 0; } },
        rewardIds:   ['garden_rain'],
    },
    {
        id:          'idle_dreamer',
        title:       'Idle Dreamer',
        desc:        'Let the screensaver take over — sometimes you just watch the stars',
        icon:        '[zzz]',
        xp:          20,
        tier:        'bronze',
        rewardIds:   ['ss_starfield'],
    },

    // ---- Meta / power achievements ----
    {
        id:          'power_user',
        title:       'Power User',
        desc:        'Unlock 10 achievements — you know your way around',
        icon:        '[PWR]',
        xp:          75,
        tier:        'gold',
        target:      10,
        getProgress: () => unlockedAchievements.size,
        rewardIds:   ['cmd_linkstats', 'cmd_whoami'],
    },
];

// ---- XP / Level helpers ----
// Flat 100 XP per level: Level 1 = 0–99 XP, Level 2 = 100–199 XP, etc.
// To adjust: change XP_PER_LEVEL. The ACHIEVEMENTS[].xp values are independent.
const XP_PER_LEVEL = 100;
function xpToLevel(xp)   { return Math.floor(xp / XP_PER_LEVEL) + 1; }
function xpForLevel(lvl) { return (lvl - 1) * XP_PER_LEVEL; }  // XP at start of lvl

// ============================================================
// REWARD REGISTRY — central catalogue of all unlockable content
// ============================================================
//
// Each entry shape:
//   id          – unique string key
//   type        – one of the reward type constants below
//   name        – display name shown in popups and the achievements window
//   description – flavour text / explanation
//   icon        – Win95-style text icon (optional)
//
// To add a new reward type: add a REWARD_TYPE_* constant and entries here.
// No other part of the app needs to change for the registry to recognise it.
//
// To link a reward to an achievement: add its id to the achievement's
//   rewardIds: ['reward_id_here']  array.
// ============================================================

const REWARD_TYPE_WALLPAPER       = 'wallpaper';
const REWARD_TYPE_SCREENSAVER     = 'screensaver';
const REWARD_TYPE_SOUND_PACK      = 'sound_pack';
const REWARD_TYPE_CAT_ACCESSORY   = 'cat_accessory';
const REWARD_TYPE_CAT_BEHAVIOUR   = 'cat_behaviour';
const REWARD_TYPE_CONSOLE_COMMAND = 'console_command';
const REWARD_TYPE_DESKTOP_THEME   = 'desktop_theme';
const REWARD_TYPE_GARDEN_UNLOCK   = 'garden_unlock';

const REWARD_REGISTRY = [
    // ---- Console commands (unlocked by achievements) ----
    { id: 'cmd_stats',       type: REWARD_TYPE_CONSOLE_COMMAND, name: '/stats',      description: 'Show your posting statistics',              icon: '[>_]' },
    { id: 'cmd_reactstats',  type: REWARD_TYPE_CONSOLE_COMMAND, name: '/reactstats', description: 'Show your reaction statistics',              icon: '[>_]' },
    { id: 'cmd_letters',     type: REWARD_TYPE_CONSOLE_COMMAND, name: '/letters',    description: 'View your sent and received letters',        icon: '[>_]' },
    { id: 'cmd_catstats',    type: REWARD_TYPE_CONSOLE_COMMAND, name: '/catstats',   description: 'Show cat care statistics',                   icon: '[>_]' },
    { id: 'cmd_gardenlog',   type: REWARD_TYPE_CONSOLE_COMMAND, name: '/gardenlog',  description: 'View your garden talk history',              icon: '[>_]' },

    // ---- Wallpapers ---- (css applied to desktop; swatchCss used in the swatch preview)
    { id: 'wp_sakura',    type: REWARD_TYPE_WALLPAPER, name: 'Sakura Dream',  description: 'A soft pink cherry-blossom background',  icon: '[wp]',
      css: 'linear-gradient(135deg,#fff0f4 0%,#ffd6e6 30%,#ffb3d0 60%,#ff85b3 100%)',
      swatchCss: 'linear-gradient(135deg,#fff0f4 0%,#ffd6e6 35%,#ff85b3 100%)' },
    { id: 'wp_nightsky',  type: REWARD_TYPE_WALLPAPER, name: 'Night Sky',     description: 'A deep navy sky thick with stars, like looking up from a dark countryside field', icon: '[wp]',
      css: [
        'radial-gradient(1px 1px at 12% 18%,rgba(200,220,255,0.9) 0%,transparent 100%)',
        'radial-gradient(1px 1px at 48% 6%,rgba(200,220,255,0.8) 0%,transparent 100%)',
        'radial-gradient(1px 1px at 73% 28%,rgba(200,220,255,0.85) 0%,transparent 100%)',
        'radial-gradient(1px 1px at 88% 58%,rgba(220,235,255,0.7) 0%,transparent 100%)',
        'radial-gradient(1px 1px at 22% 73%,rgba(200,220,255,0.8) 0%,transparent 100%)',
        'radial-gradient(1px 1px at 57% 86%,rgba(200,220,255,0.75) 0%,transparent 100%)',
        'linear-gradient(to bottom,#000820 0%,#001840 50%,#000c2a 100%)',
      ].join(','),
      swatchCss: 'linear-gradient(to bottom,#000820 0%,#001840 60%,#000c2a 100%)' },
    { id: 'wp_garden',    type: REWARD_TYPE_WALLPAPER, name: 'Garden View',   description: 'Lush green garden in full bloom',         icon: '[wp]',
      css: 'linear-gradient(to bottom,#c8e6a0 0%,#8ec84a 25%,#4a9f2a 55%,#1e6010 100%)',
      swatchCss: 'linear-gradient(to bottom,#c8e6a0 0%,#8ec84a 30%,#1e6010 100%)' },
    { id: 'wp_cozy_rain', type: REWARD_TYPE_WALLPAPER, name: 'Cozy Rain',     description: 'Rainy window with warm light inside',     icon: '[wp]',
      css: 'linear-gradient(to bottom right,#4a5568 0%,#6b7280 40%,#374151 80%,#2d3748 100%)',
      swatchCss: 'linear-gradient(to bottom right,#4a5568 0%,#6b7280 50%,#2d3748 100%)' },

    // ---- Screensavers ---- (swatchCss used in the picker thumbnail)
    { id: 'ss_petals',    type: REWARD_TYPE_SCREENSAVER, name: 'Falling Petals',  description: 'Slow cascade of flower petals',            icon: '[ss]',
      swatchCss: 'linear-gradient(135deg,#ffb7c5 0%,#ff8fa3 50%,#c47c8e 100%)' },
    { id: 'ss_starfield', type: REWARD_TYPE_SCREENSAVER, name: 'Starfield',       description: 'Flying through a field of stars',          icon: '[ss]',
      swatchCss: 'radial-gradient(ellipse at 50% 50%,#1a1a4a 0%,#000018 100%)' },
    { id: 'ss_bubbles',   type: REWARD_TYPE_SCREENSAVER, name: 'Underwater World', description: 'Drift through a deep-sea scene with fish, swaying seaweed, and rising bubbles', icon: '[ss]',
      swatchCss: 'linear-gradient(to bottom,#001628 0%,#002d55 50%,#001520 100%)' },

    // ---- Sound packs ----
    { id: 'snd_cozy',    type: REWARD_TYPE_SOUND_PACK, name: 'Cozy Café',      description: 'Soft café ambience and chime sounds',     icon: '☕' },
    { id: 'snd_nature',  type: REWARD_TYPE_SOUND_PACK, name: 'Nature Walk',    description: 'Birds, wind, and gentle rain sounds',     icon: '🌿' },
    { id: 'snd_retro',   type: REWARD_TYPE_SOUND_PACK, name: 'Retro Chiptune', description: '8-bit notification and UI sounds',        icon: '🎮' },

    // ---- Cat accessories ---- (faceDecor appended to cat face text when equipped)
    { id: 'cat_bow',     type: REWARD_TYPE_CAT_ACCESSORY, name: 'Ribbon Bow',     description: 'A cute ribbon bow for the cat',            icon: '🎀', faceDecor: '🎀' },
    { id: 'cat_hat',     type: REWARD_TYPE_CAT_ACCESSORY, name: 'Tiny Hat',       description: 'A very small top hat',                     icon: '🎩', faceDecor: '🎩' },
    { id: 'cat_scarf',   type: REWARD_TYPE_CAT_ACCESSORY, name: 'Cosy Scarf',     description: 'A warm knitted scarf',                     icon: '🧣', faceDecor: '🧣', placement: 'neck' },
    { id: 'cat_glasses', type: REWARD_TYPE_CAT_ACCESSORY, name: 'Tiny Glasses',   description: 'Round reading glasses for a studious cat', icon: '🕶️', faceDecor: '🕶️' },

    // ---- Cat behaviours ----
    { id: 'catb_zoomies', type: REWARD_TYPE_CAT_BEHAVIOUR, name: 'Zoomies',    description: 'Cat randomly dashes around the screen',    icon: '💨' },
    { id: 'catb_knead',   type: REWARD_TYPE_CAT_BEHAVIOUR, name: 'Kneading',   description: 'Cat kneads the screen contentedly',        icon: '🐾' },
    { id: 'catb_loaf',    type: REWARD_TYPE_CAT_BEHAVIOUR, name: 'Loaf Mode',  description: 'Cat sits in a perfect loaf shape',         icon: '🍞' },

    // ---- Desktop themes / effects ---- (swatchCss: preview swatch)
    { id: 'theme_pastel',   type: REWARD_TYPE_DESKTOP_THEME, name: 'Pastel Mode',    description: 'Soft pastel colour palette for the whole UI', icon: '🌸',
      swatchCss: 'linear-gradient(135deg,#ffd6e0 0%,#c7f0d8 50%,#c9d6f7 100%)' },
    { id: 'theme_midnight', type: REWARD_TYPE_DESKTOP_THEME, name: 'Midnight',       description: 'Deep-blue theme with subtle star accents',  icon: '🌙',
      swatchCss: 'linear-gradient(135deg,#0a0a2e 0%,#1a1a4e 50%,#0a0a2e 100%)' },
    { id: 'theme_autumn',   type: REWARD_TYPE_DESKTOP_THEME, name: 'Autumn Leaves',  description: 'Warm amber and rust tones',                  icon: '🍂',
      swatchCss: 'linear-gradient(135deg,#c0680a 0%,#8b3a0a 50%,#5a2000 100%)' },

    // ---- Garden unlocks ----
    { id: 'garden_fountain', type: REWARD_TYPE_GARDEN_UNLOCK, name: 'Garden Fountain', description: 'A decorative fountain for your garden',     icon: '[G]' },
    { id: 'garden_lantern',  type: REWARD_TYPE_GARDEN_UNLOCK, name: 'Paper Lantern',   description: 'A glowing lantern for evening garden visits', icon: '[G]' },
    { id: 'garden_bench',    type: REWARD_TYPE_GARDEN_UNLOCK, name: 'Wooden Bench',    description: 'A cosy bench to sit and admire your garden', icon: '[G]' },

    // ---- Achievement Set: First Transmission & beyond ----

    // Wallpapers
    // ---- Animated wallpapers ---- (canvas-based; animated: true signals the engine to run a canvas animation)
    { id: 'wp_anim_clouds',   type: REWARD_TYPE_WALLPAPER, name: 'Drifting Clouds',  description: 'Fluffy clouds float lazily across a soft blue sky', animated: true,
      css: '#87ceeb',
      swatchCss: 'linear-gradient(to bottom, #5aaee0 0%, #87ceeb 50%, #c8e8f8 100%)' },
    { id: 'wp_anim_forest',   type: REWARD_TYPE_WALLPAPER, name: 'Swaying Trees',    description: 'A forest silhouette where every branch sways gently in the evening breeze', animated: true,
      css: 'linear-gradient(to bottom, #1a2a40 0%, #0d2008 100%)',
      swatchCss: 'linear-gradient(to bottom, #1a2a40 0%, #2a4a2a 40%, #0d2008 100%)' },
    { id: 'wp_anim_nightsky', type: REWARD_TYPE_WALLPAPER, name: 'Twinkling Stars',  description: 'A clear night sky where every star quietly twinkles', animated: true,
      css: 'linear-gradient(to bottom, #000510 0%, #000c28 50%, #001440 100%)',
      swatchCss: 'linear-gradient(to bottom, #000510 0%, #000c28 60%, #001440 100%)' },

    { id: 'wp_cat_monitor',       type: REWARD_TYPE_WALLPAPER, name: 'Cat Monitor',         description: 'A CRT screen in a dark room, watched over by a glowing-eyed cat',
      css: 'radial-gradient(ellipse 60% 40% at 50% 52%, #1a3300 0%, #0a1800 50%, #030800 100%)',
      swatchCss: 'radial-gradient(ellipse 60% 40% at 50% 52%, #1a3300 0%, #030800 100%)' },
    { id: 'wp_infinite_desktop',  type: REWARD_TYPE_WALLPAPER, name: 'Infinite Desktop',    description: 'A vanishing-point grid stretching out forever into a violet void',
      css: 'linear-gradient(to bottom, #080015 0%, #0a0835 40%, #050a50 60%, #020840 80%, #020510 100%)',
      swatchCss: 'linear-gradient(to bottom, #080015 0%, #050a50 60%, #020510 100%)' },
    { id: 'wp_retro_clouds',      type: REWARD_TYPE_WALLPAPER, name: 'Retro Clouds',        description: 'Crisp pixel clouds drifting across a sky the exact blue of 1995',
      css: 'linear-gradient(to bottom, #4a90d9 0%, #6ab0f0 40%, #88c8ff 70%, #a8deff 100%)',
      swatchCss: 'linear-gradient(to bottom, #4a90d9 0%, #a8deff 100%)' },
    { id: 'wp_midnight',          type: REWARD_TYPE_WALLPAPER, name: 'Midnight',             description: 'The hour between late night and early morning, captured in gradient form',
      css: 'linear-gradient(to bottom, #000510 0%, #020b24 35%, #040e30 65%, #01081a 100%)',
      swatchCss: 'linear-gradient(to bottom, #000510 0%, #040e30 60%, #01081a 100%)' },

    // Screensavers
    { id: 'ss_feed_slideshow',   type: REWARD_TYPE_SCREENSAVER, name: 'Feed Slideshow',   description: 'Your shared links drift past like memories on a slow carousel',
      swatchCss: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)' },
    { id: 'ss_bouncing_logo',    type: REWARD_TYPE_SCREENSAVER, name: 'Bouncing Logo',    description: 'The classic. It almost hit the corner. You were there',
      swatchCss: 'linear-gradient(135deg, #000 0%, #111 50%, #222 100%)' },

    // Sound packs
    { id: 'snd_cute',            type: REWARD_TYPE_SOUND_PACK, name: 'Cute & Cozy',       description: 'Soft chimes, gentle pops, and one very small meow', icon: '🌟' },
    { id: 'snd_garden_pack',     type: REWARD_TYPE_SOUND_PACK, name: 'Garden Ambience',   description: 'Wind through leaves, distant bees, and a wood frog', icon: '🌿' },

    // Cat accessories
    { id: 'cat_sunglasses',      type: REWARD_TYPE_CAT_ACCESSORY, name: 'Cool Shades',      description: 'For when the cat needs to look like they own the place', icon: '😎', faceDecor: '🕶️', placement: 'eye' },
    { id: 'cat_wizard_hat',      type: REWARD_TYPE_CAT_ACCESSORY, name: 'Wizard Hat',       description: 'It confers no magical powers. The cat disagrees',          icon: '🧙', faceDecor: '🧙' },
    { id: 'cat_explorer',        type: REWARD_TYPE_CAT_ACCESSORY, name: 'Explorer Kit',     description: 'A tiny map and tinier compass. Adventures await',           icon: '🗺️', faceDecor: '🗺️' },
    { id: 'cat_flower_crown',    type: REWARD_TYPE_CAT_ACCESSORY, name: 'Flower Crown',     description: 'Woven with care. The cat tolerates it with grace',          icon: '🌸', faceDecor: '🌸' },

    // Desktop themes
    { id: 'theme_glass',         type: REWARD_TYPE_DESKTOP_THEME, name: 'Frosted Glass',   description: 'Soft blur and ice-white highlights — everything feels just out of focus',
      swatchCss: 'linear-gradient(135deg, rgba(200,220,255,0.6) 0%, rgba(180,210,240,0.4) 50%, rgba(220,235,255,0.7) 100%)' },
    { id: 'theme_pixel',         type: REWARD_TYPE_DESKTOP_THEME, name: 'Pixel Art',        description: 'Hard edges, limited palette, maximum charm',
      swatchCss: 'linear-gradient(135deg, #2d6a4f 0%, #1b4332 50%, #081c15 100%)' },
    { id: 'theme_crt',           type: REWARD_TYPE_DESKTOP_THEME, name: 'CRT Mode',         description: 'Scanlines and phosphor glow. Your eyes will adjust. Probably',
      swatchCss: 'linear-gradient(135deg, #003300 0%, #001a00 50%, #000800 100%)' },

    // Garden unlocks (second set)
    { id: 'garden_butterflies',  type: REWARD_TYPE_GARDEN_UNLOCK, name: 'Garden Butterflies', description: 'Painted wings drift between the blooms in the morning light', icon: '[G]' },
    { id: 'garden_rain',         type: REWARD_TYPE_GARDEN_UNLOCK, name: 'Gentle Rain',         description: 'A soft patter on the leaves. The kind you want to stay in',   icon: '[G]' },
    { id: 'garden_frogs',        type: REWARD_TYPE_GARDEN_UNLOCK, name: 'Frog Friends',        description: 'They appeared overnight. They seem content. All is well',      icon: '[G]' },

    // Console commands (second set — unlocked by Power User)
    { id: 'cmd_linkstats',  type: REWARD_TYPE_CONSOLE_COMMAND, name: '/linkstats', description: 'Show your link-sharing history and top domains', icon: '[>_]' },
    { id: 'cmd_whoami',     type: REWARD_TYPE_CONSOLE_COMMAND, name: '/whoami',    description: 'Your full profile: level, XP, stats, and hidden lore', icon: '[>_]' },
];

// ---- Reward unlock state ----
// Persisted to localStorage as a JSON array of unlocked reward ids.
const _rewardStorageKey = 'unlockedRewards';
let unlockedRewards = new Set(
    JSON.parse(localStorage.getItem(_rewardStorageKey) || '[]')
);

// ---- "New" badge tracking ----
// A reward is "new" when it has been unlocked but not yet viewed in any panel.
const _seenRewardsKey = 'seenRewards';
let _seenRewards = new Set(
    JSON.parse(localStorage.getItem(_seenRewardsKey) || '[]')
);

// Mark a reward as seen (clears the NEW badge). Persists to localStorage.
function markRewardSeen(rewardId) {
    if (_seenRewards.has(rewardId)) return;
    _seenRewards.add(rewardId);
    localStorage.setItem(_seenRewardsKey, JSON.stringify([..._seenRewards]));
}

// Returns true if the reward is unlocked but has not been viewed yet.
function isRewardNew(rewardId) {
    return unlockedRewards.has(rewardId) && !_seenRewards.has(rewardId);
}

// Returns true if the reward with the given id is currently unlocked.
function isRewardUnlocked(rewardId) {
    return unlockedRewards.has(rewardId);
}

// Marks a reward as unlocked. Returns true if this was a new unlock.
// Also keeps unlockedConsoleCmds in sync for slash-command gating.
// Dispatches a 'rewardUnlocked' CustomEvent so open windows can refresh.
function unlockReward(rewardId) {
    if (unlockedRewards.has(rewardId)) return false;
    const reward = REWARD_REGISTRY.find(r => r.id === rewardId);
    if (!reward) return false;
    unlockedRewards.add(rewardId);
    localStorage.setItem(_rewardStorageKey, JSON.stringify([...unlockedRewards]));
    if (reward.type === REWARD_TYPE_CONSOLE_COMMAND) {
        const cmdName = reward.name.replace(/^\//, '');
        unlockedConsoleCmds.add(cmdName);
        localStorage.setItem(_consoleCmdsKey, JSON.stringify([...unlockedConsoleCmds]));
        // Add console command unlock to notification panel
        addRewardCommandNotification(reward);
    }
    // Notify all open panels that a new reward arrived
    document.dispatchEvent(new CustomEvent('rewardUnlocked', { detail: { reward } }));
    return true;
}

// Returns all unlocked rewards of a given type.
// e.g. getUnlockedRewardsByType(REWARD_TYPE_WALLPAPER)
function getUnlockedRewardsByType(type) {
    return REWARD_REGISTRY.filter(r => r.type === type && unlockedRewards.has(r.id));
}

// Returns all rewards of a given type (both locked and unlocked), for building full grids.
function getAllRewardsByType(type) {
    return REWARD_REGISTRY.filter(r => r.type === type);
}

// ---- Achievement state ----
// Map of id -> unixTimestamp (ms) for every unlocked achievement.
// Using a Map lets us store the unlock date without a separate data structure.
let unlockedAchievements = new Map();
let achievementsBackfilled = false;
// When true, renderAchievementsWindow() is a no-op — used during bulk unlocks
// (e.g. backfillAchievements) so we only pay the render cost once at the end.
let _batchingAchievements = false;

// In-session history of achievement unlock notifications (newest first).
// Each entry: { title, icon, ts } — kept in memory only (resets on page reload).
const achievementToastHistory = [];

// ---- Achievement unlock popup ----
// Queued OS-style popups shown when achievements are unlocked.
// Multiple unlocks are shown sequentially (one at a time, 5 s each).
let _achPopupQueue = [];
let _achPopupActive = false;

function showAchievementPopup(achievement, xpGain) {
    _achPopupQueue.push({ achievement, xpGain });
    if (!_achPopupActive) _drainAchPopupQueue();
}

function _drainAchPopupQueue() {
    if (!_achPopupQueue.length) { _achPopupActive = false; return; }
    _achPopupActive = true;
    const { achievement, xpGain } = _achPopupQueue.shift();

    // Remove any leftover popup from a previous drain cycle.
    document.getElementById('ach-unlock-popup')?.remove();

    const TIER_COLORS  = { bronze: '#cd7f32', silver: '#909090', gold: '#b8860b', mythic: '#9b30ff' };
    const TIER_LABELS  = { bronze: 'Bronze',  silver: 'Silver',  gold: 'Gold',   mythic: 'Mythic'  };
    const tierColor    = TIER_COLORS[achievement.tier] || '#3a7a3a';
    const tierLabel    = TIER_LABELS[achievement.tier] || '';

    // Build reward line(s) — XP first, then named rewards from the registry
    let rewardLines = [];
    if (xpGain > 0) rewardLines.push(`+${xpGain} XP`);
    if (Array.isArray(achievement.rewardIds)) {
        for (const rId of achievement.rewardIds) {
            const reward = REWARD_REGISTRY.find(r => r.id === rId);
            if (reward) rewardLines.push(`Unlocked: ${reward.name}`);
        }
    }
    const rewardHtml = rewardLines.length
        ? `<div class="ach-popup__reward">${rewardLines.map(r => `<span>${safeText(r)}</span>`).join('')}</div>`
        : '';

    const popup = document.createElement('div');
    popup.id = 'ach-unlock-popup';
    popup.className = 'ach-popup';
    popup.style.setProperty('--tier-color', tierColor);
    popup.innerHTML =
        `<div class="ach-popup__bar">` +
            `<span class="ach-popup__bar-icon">★</span>` +
            `<span class="ach-popup__bar-label">Achievement Unlocked!</span>` +
            `<button class="ach-popup__close" aria-label="Close">✕</button>` +
        `</div>` +
        `<div class="ach-popup__body">` +
            `<div class="ach-popup__icon-col">` +
                `<div class="ach-popup__icon">${safeText(achievement.icon)}</div>` +
                `<div class="ach-popup__tier-badge">${safeText(tierLabel)}</div>` +
            `</div>` +
            `<div class="ach-popup__info">` +
                `<div class="ach-popup__title">${safeText(achievement.title)}</div>` +
                `<div class="ach-popup__desc">${safeText(achievement.desc)}</div>` +
                rewardHtml +
            `</div>` +
        `</div>`;

    document.body.appendChild(popup);
    // Trigger enter animation on next frame
    requestAnimationFrame(() => popup.classList.add('ach-popup--in'));

    let dismissed = false;
    const dismiss = () => {
        if (dismissed) return;
        dismissed = true;
        popup.classList.add('ach-popup--out');
        popup.classList.remove('ach-popup--in');
        setTimeout(() => {
            popup.remove();
            // Small gap between sequential popups
            setTimeout(_drainAchPopupQueue, 250);
        }, 320);
    };

    popup.querySelector('.ach-popup__close').addEventListener('click', dismiss);
    const autoTimer = setTimeout(dismiss, 5500);
    // If user manually closes, cancel auto-dismiss
    popup.querySelector('.ach-popup__close').addEventListener('click', () => clearTimeout(autoTimer), { once: true });
}

async function initAchievements() {
    const body = document.getElementById('w95-achievements-body');
    if (!currentUser) {
        if (body) body.innerHTML = '<div class="achievement-placeholder">Sign in to view achievements</div>';
        return;
    }
    try {
        const [achSnap, xpSnap] = await Promise.all([
            get(ref(database, 'achievements/' + currentUser)),
            get(ref(database, 'userStats/' + currentUser + '/xpTotal')),
        ]);
        unlockedAchievements = new Map(achSnap.exists() ? Object.entries(achSnap.val()) : []);

        if (xpSnap.exists()) {
            // Normal path: xpTotal was already stored.
            xpTotal = xpSnap.val() || 0;

            // Repair: recalculate from all unlocked achievements in case new
            // achievements (or updated XP values) were added after the stored
            // total was last written. Only ever adjusts upward.
            const computedXp = [...unlockedAchievements.keys()].reduce((sum, id) => {
                const ach = ACHIEVEMENTS.find(a => a.id === id);
                return sum + (ach?.xp || 0);
            }, 0);
            if (computedXp > xpTotal) {
                xpTotal = computedXp;
                await set(ref(database, 'userStats/' + currentUser + '/xpTotal'), xpTotal);
            }
        } else {
            // First load after XP feature ships: bootstrap from already-unlocked achievements
            // so existing users don't start at 0. Runs exactly once, then xpTotal is set.
            xpTotal = 0;
            for (const [id] of unlockedAchievements) {
                const ach = ACHIEVEMENTS.find(a => a.id === id);
                if (ach && ach.xp) xpTotal += ach.xp;
            }
            await set(ref(database, 'userStats/' + currentUser + '/xpTotal'), xpTotal);
        }

        _initXpNotifiedThresholds();
        _seedUnlockedRewards();
        renderAchievementsWindow();
        // Record today's visit after unlockedAchievements is populated so the
        // duplicate-unlock guard works correctly and the popup only shows on
        // the actual first unlock.
        _recordSiteVisitDay();
        await backfillAchievements();
    } catch (e) {
        console.error('initAchievements failed', e);
    }
}

async function unlockAchievement(id) {
    if (!ACHIEVEMENTS?.find(a => a.id === id)) return;
    if (unlockedAchievements.has(id) || !currentUser) return;
    try {
        const ts          = Date.now();
        const achievement = ACHIEVEMENTS.find(a => a.id === id);
        const xpGain      = achievement?.xp || 0;
        const levelBefore = xpToLevel(xpTotal);

        await set(ref(database, 'achievements/' + currentUser + '/' + id), ts);
        unlockedAchievements.set(id, ts);

        if (xpGain > 0) {
            const prevXp = xpTotal;
            xpTotal += xpGain;
            await set(ref(database, 'userStats/' + currentUser + '/xpTotal'), xpTotal);
            checkXpCommandUnlocks(prevXp, xpTotal);
        }

        if (achievement) {
            // OS-style popup replaces the plain toast for achievement unlocks
            showAchievementPopup(achievement, xpGain);
            achievementToastHistory.unshift({ title: achievement.title, icon: achievement.icon, ts: Date.now() });
            if (achievementToastHistory.length > 20) achievementToastHistory.pop();
            sparkSound('ach');
            // Add to notification panel
            addAchievementNotification(achievement, xpGain);
        }

        const levelAfter = xpToLevel(xpTotal);
        if (levelAfter > levelBefore) {
            showToast(`✨ Level up! Garden Level ${levelAfter}`);
        }

        // Unlock any rewards linked to this achievement via the reward registry.
        if (achievement?.rewardIds?.length) {
            for (const rId of achievement.rewardIds) {
                unlockReward(rId);
            }
        }

        renderAchievementsWindow();
    } catch (e) {
        console.error('unlockAchievement failed', e);
    }
}

async function afterPostCreated(newPostType) {
    await unlockAchievement('first_post');
    // allPosts hasn't yet received the Firebase onValue update for the just-pushed post,
    // so add 1 to the current count to include it.
    const myPosts = Object.values(allPosts).filter(p => p.author === currentUser);
    const myCount = myPosts.length + 1;
    if (myCount >= 5)   await unlockAchievement('five_posts');
    if (myCount >= 10)  await unlockAchievement('ten_posts');
    if (myCount >= 20)  await unlockAchievement('twenty_posts');
    if (myCount >= 30)  await unlockAchievement('thirty_posts');
    if (myCount >= 50)  await unlockAchievement('fifty_posts');
    if (myCount >= 100) await unlockAchievement('hundred_posts');

    // Link-sharing achievements — count existing link posts + this new one if it's a link
    const isNewLink = !newPostType || newPostType === 'link';
    const myLinkCount = myPosts.filter(p => !p.type || p.type === 'link').length + (isNewLink ? 1 : 0);
    if (myLinkCount >= 1)  await unlockAchievement('first_transmission');
    if (myLinkCount >= 10) await unlockAchievement('link_hoarder_10');
    if (myLinkCount >= 50) await unlockAchievement('link_hoarder_50');

    // Post-length achievements — read body from form (not yet reset at this point).
    const bodyEl = document.getElementById('postBody');
    const newBodyLen = bodyEl ? bodyEl.value.trim().length : 0;
    if (newBodyLen > 0) {
        const longform    = myPosts.filter(p => p.body && p.body.length >= 500).length + (newBodyLen >= 500 ? 1 : 0);
        const minimalist  = myPosts.filter(p => p.body && p.body.length > 0 && p.body.length < 30).length + (newBodyLen < 30 ? 1 : 0);
        if (longform >= 1)   await unlockAchievement('longform_1');
        if (longform >= 5)   await unlockAchievement('longform_5');
        if (minimalist >= 5)  await unlockAchievement('minimalist_5');
        if (minimalist >= 20) await unlockAchievement('minimalist_20');
    }

    // XP / meta — check after all other unlocks above have fired.
    if (xpToLevel(xpTotal) >= 5)        await unlockAchievement('level_5');
    if (unlockedAchievements.size >= 25) await unlockAchievement('unlock_25');
    if (unlockedAchievements.size >= 10) await unlockAchievement('power_user');

    // Mythic: track daily post action
    if (currentUser) {
        const _today  = localDateStr();
        const _postTs = Date.now();
        dailyActions[_today] = dailyActions[_today] || {};
        dailyActions[_today].didPost    = true;
        dailyActions[_today].lastPostTs = _postTs;
        update(ref(database, 'userStats/' + currentUser), {
            [`dailyActions/${_today}/didPost`]:    true,
            [`dailyActions/${_today}/lastPostTs`]: _postTs,
        }).catch(() => {});
    }
    // Pass body text so inside_joke can fire before allPosts is updated
    const _newPostBody = bodyEl ? bodyEl.value.trim() : '';
    checkMythics(_newPostBody);
    checkTimeBasedAchievements();
}

async function backfillAchievements() {
    if (achievementsBackfilled) return;
    achievementsBackfilled = true;
    if (!currentUser) return;
    _batchingAchievements = true;

    // Count existing posts by the current user from the already-loaded allPosts.
    const myPosts = Object.values(allPosts).filter(p => p.author === currentUser);
    const myCount = myPosts.length;
    if (myCount >= 1)   await unlockAchievement('first_post');
    if (myCount >= 5)   await unlockAchievement('five_posts');
    if (myCount >= 10)  await unlockAchievement('ten_posts');
    if (myCount >= 20)  await unlockAchievement('twenty_posts');
    if (myCount >= 30)  await unlockAchievement('thirty_posts');
    if (myCount >= 50)  await unlockAchievement('fifty_posts');
    if (myCount >= 100) await unlockAchievement('hundred_posts');

    // Post-length achievements.
    const longformCount   = myPosts.filter(p => p.body && p.body.length >= 500).length;
    const minimalistCount = myPosts.filter(p => p.body && p.body.length > 0 && p.body.length < 30).length;
    if (longformCount >= 1)   await unlockAchievement('longform_1');
    if (longformCount >= 5)   await unlockAchievement('longform_5');
    if (minimalistCount >= 5)  await unlockAchievement('minimalist_5');
    if (minimalistCount >= 20) await unlockAchievement('minimalist_20');

    // Check garden watering streak directly from Firebase.
    try {
        const gardenSnap = await get(ref(database, 'garden'));
        const gardenState = gardenSnap.val();
        if (gardenState) {
            // Keep global streak in sync so progress bars render correctly
            // before the garden window has been opened this session.
            currentWateringStreak = gardenState.wateringStreak || 0;
            if (currentWateringStreak >= 3) await unlockAchievement('water_3_days');
        }
    } catch (e) {
        console.error('backfillAchievements garden check failed', e);
    }

    // Load per-user stats (totalWaterings, garden visit tracking).
    try {
        const statsSnap = await get(ref(database, 'userStats/' + currentUser));
        const stats = statsSnap.val() || {};

        // ---- Watering count ----
        totalWaterings = stats.totalWaterings || 0;
        if (totalWaterings >= 1)   await unlockAchievement('first_sprout');
        if (totalWaterings >= 5)   await unlockAchievement('watering_can');
        if (totalWaterings >= 10)  await unlockAchievement('watering_10');
        if (totalWaterings >= 25)  await unlockAchievement('watering_25');
        if (totalWaterings >= 50)  await unlockAchievement('watering_50');
        if (totalWaterings >= 100) await unlockAchievement('watering_100');

        // ---- Garden visit tracking (load only; write-back happens in recordGardenVisit) ----
        // We hydrate the globals so progress bars render correctly before the
        // garden window has been opened this session. The actual "count today
        // as a visit" write happens in recordGardenVisit(), called from the
        // garden window show() handler, so that merely loading the app does not
        // register a garden visit.
        gardenVisitDays   = stats.gardenVisitDays   || {};
        gardenVisitStreak = stats.gardenVisitStreak || { current: 0, lastDate: null };

        // Unlock based on already-recorded historical visits (no write here).
        const visitCount = Object.keys(gardenVisitDays).length;
        if (visitCount >= 7)  await unlockAchievement('checked_in');
        if (visitCount >= 14) await unlockAchievement('visit_14_total');
        if (visitCount >= 30) await unlockAchievement('visit_30_total');
        if (visitCount >= 60) await unlockAchievement('visit_60_total');
        if (gardenVisitStreak.current >= 7)  await unlockAchievement('week_streak');
        if (gardenVisitStreak.current >= 14) await unlockAchievement('visit_streak_14');
        if (gardenVisitStreak.current >= 30) await unlockAchievement('visit_streak_30');

        // ---- Mythic state hydration ----
        dailyActions  = stats.dailyActions  || {};
        comebackArmed = stats.comebackArmed || false;

        // ---- Per-user 3-waters-a-day hydration ----
        dailyWaterCounts = stats.dailyWaterCounts || {};
        water3Streak     = stats.water3Streak     || { current: 0, lastDate: null };
        const _w3Today = localDateStr();
        if ((dailyWaterCounts[_w3Today] || 0) >= 3) await unlockAchievement('water3_day');
        if (water3Streak.current >= 7)              await unlockAchievement('water3_week');
    } catch (e) {
        console.error('backfillAchievements userStats check failed', e);
    }

    // Also sync watering streak (loaded from garden node earlier in this function).
    if (currentWateringStreak >= 7)  await unlockAchievement('water_7_days');
    if (currentWateringStreak >= 14) await unlockAchievement('water_14_days');

    // ---- Replies ----
    const myReplyCount = Object.values(allPosts).reduce((acc, p) => acc + (p.replies || []).filter(r => r.author === currentUser).length, 0);
    if (myReplyCount >= 1)  await unlockAchievement('first_reply');
    if (myReplyCount >= 10) await unlockAchievement('ten_replies');

    // ---- Reactions ----
    const myReactionCount = Object.values(allPosts).reduce((acc, p) => {
        const rxBy = p.reactionsBy || {};
        return acc + Object.values(rxBy).filter(users => users && users[currentUser]).length;
    }, 0);
    if (myReactionCount >= 1)  await unlockAchievement('first_reaction');
    if (myReactionCount >= 25) await unlockAchievement('twentyfive_reactions');

    // ---- Letters ----
    const myLetterCount = Object.values(allLetters).filter(l => l.from === currentUser).length;
    if (myLetterCount >= 1) await unlockAchievement('first_letter');
    if (myLetterCount >= 5) await unlockAchievement('five_letters');

    // ---- Cat actions (localStorage-based, no historical Firebase data) ----
    const catCount = Number(localStorage.getItem('catActionCount') || 0);
    if (catCount >= 1)  await unlockAchievement('first_cat_action');
    if (catCount >= 10) await unlockAchievement('ten_cat_actions');
    if (catCount >= 25) await unlockAchievement('cat_whisperer');

    // ---- Cat interact days ----
    try {
        const catDays = JSON.parse(localStorage.getItem('catInteractDays') || '[]').length;
        if (catDays >= 3) await unlockAchievement('explorer_cat');
    } catch (_) {}

    // ---- Soft Paws ----
    const catAchCountBf = ['first_cat_action','ten_cat_actions','cat_whisperer','explorer_cat']
        .filter(id => unlockedAchievements.has(id)).length;
    if (catAchCountBf >= 3) await unlockAchievement('soft_paws');

    // ---- Garden talk (already in localStorage as garden_talkCount) ----
    const talkCount = Number(localStorage.getItem('garden_talkCount') || 0);
    if (talkCount >= 1)  await unlockAchievement('first_garden_talk');
    if (talkCount >= 10) await unlockAchievement('ten_garden_talks');

    // ---- Link posts (retroactive from allPosts) ----
    const myLinkCountBf = Object.values(allPosts).filter(p => p.author === currentUser && (!p.type || p.type === 'link') && p.url).length;
    if (myLinkCountBf >= 1)  await unlockAchievement('first_transmission');
    if (myLinkCountBf >= 10) await unlockAchievement('link_hoarder_10');
    if (myLinkCountBf >= 50) await unlockAchievement('link_hoarder_50');

    // ---- Deep Reader (retroactive from readBy on link posts by the other user) ----
    const otherUser     = currentUser === 'El' ? 'Tero' : 'El';
    const linksReadBf   = Object.values(allPosts).filter(p =>
        p.author === otherUser && (!p.type || p.type === 'link') && p.url && p.readBy && p.readBy[currentUser]
    ).length;
    // Seed localStorage if the stored value is lower than what Firebase knows
    const storedLinksOpened = Number(localStorage.getItem('linksOpenedCount') || 0);
    if (linksReadBf > storedLinksOpened) {
        localStorage.setItem('linksOpenedCount', String(linksReadBf));
    }
    if (Math.max(linksReadBf, storedLinksOpened) >= 25) await unlockAchievement('deep_reader');

    // ---- Garden visit milestones (new set) ----
    const visitCountBf = Object.keys(gardenVisitDays).length;
    if (visitCountBf >= 3) await unlockAchievement('digital_gardener');
    if (visitCountBf >= 5) await unlockAchievement('frog_friend');

    // ---- Site visit days (localStorage-based) ----
    try {
        const svDays = JSON.parse(localStorage.getItem('siteVisitDays') || '[]').length;
        if (svDays >= 5) await unlockAchievement('rainy_day');
    } catch (_) {}

    // ---- Night/morning visit counts (localStorage-based) ----
    const nightVis   = Number(localStorage.getItem('nightVisitCount') || 0);
    const morningVis = Number(localStorage.getItem('morningVisitCount') || 0);
    if (nightVis >= 5)   await unlockAchievement('night_visits');
    if (morningVis >= 5) await unlockAchievement('morning_visits');

    // ---- Console usage (localStorage-based) ----
    const cmdUsesBf = Number(localStorage.getItem('consoleCommandCount') || 0);
    if (cmdUsesBf >= 10) await unlockAchievement('console_wizard');

    // ---- Window moves (localStorage-based) ----
    const winMovesBf = Number(localStorage.getItem('windowMoveCount') || 0);
    if (winMovesBf >= 20) await unlockAchievement('window_tinkerer');

    // ---- Window opens (localStorage-based) ----
    const winOpensBf = Number(localStorage.getItem('windowOpenCount') || 0);
    if (winOpensBf >= 10) await unlockAchievement('bouncer');

    // ---- Wallpaper changes (localStorage-based) ----
    const wpChangesBf = Number(localStorage.getItem('wallpaperChangeCount') || 0);
    if (wpChangesBf >= 5) await unlockAchievement('pixel_mood');

    // ---- Screensaver (localStorage-based) ----
    const ssBf = Number(localStorage.getItem('screensaverTriggeredCount') || 0);
    if (ssBf >= 1) await unlockAchievement('idle_dreamer');

    // ---- Curious Mind (localStorage-based) ----
    try {
        const seenApps = new Set(JSON.parse(localStorage.getItem('openedApps') || '[]'));
        const allSeen  = [..._CURIOUS_MIND_APPS].every(a => seenApps.has(a));
        if (allSeen) await unlockAchievement('curious_mind');
    } catch (_) {}

    // XP / meta — checked last so all prior unlocks are counted.
    if (xpToLevel(xpTotal) >= 5)        await unlockAchievement('level_5');
    if (unlockedAchievements.size >= 25) await unlockAchievement('unlock_25');
    if (unlockedAchievements.size >= 10) await unlockAchievement('power_user');

    _batchingAchievements = false;
    await checkMythics();
    renderAchievementsWindow();
}

// ---- Achievement trigger helpers ----
// Called after the user sends a reply. Counts all of their replies across all posts.
async function _afterReply() {
    await unlockAchievement('first_reply');
    const total = Object.values(allPosts).reduce((acc, p) => acc + (p.replies || []).filter(r => r.author === currentUser).length, 0) + 1; // +1 for the just-pushed reply (allPosts not yet updated)
    if (total >= 10) await unlockAchievement('ten_replies');
    if (unlockedAchievements.size >= 25) await unlockAchievement('unlock_25');
}

// Called after the user ADDS a reaction (not removes).
function _afterReaction() {
    unlockAchievement('first_reaction');
    const total = Object.values(allPosts).reduce((acc, p) => {
        const rxBy = p.reactionsBy || {};
        return acc + Object.values(rxBy).filter(users => users && users[currentUser]).length;
    }, 0) + 1; // +1 for the just-updated reaction (allPosts not yet synced)
    if (total >= 25) unlockAchievement('twentyfive_reactions');
    if (unlockedAchievements.size >= 25) unlockAchievement('unlock_25');
}

// Called after the user sends a letter.
function _afterLetter() {
    unlockAchievement('first_letter');
    const total = Object.values(allLetters).filter(l => l.from === currentUser).length;
    if (total >= 5) unlockAchievement('five_letters');
    if (unlockedAchievements.size >= 25) unlockAchievement('unlock_25');
    // Desktop cat reacts to you sending a letter
    window._catLocalEmote?.('heart');
    // Track that a letter was sent today (available for cross-system checks)
    const _lToday = localDateStr();
    dailyActions[_lToday] = dailyActions[_lToday] || {};
    dailyActions[_lToday].didLetter = true;
}

// Called after any cat action (feed / water / yarn).
function _afterCatAction() {
    const count = Number(localStorage.getItem('catActionCount') || 0) + 1;
    localStorage.setItem('catActionCount', String(count));
    unlockAchievement('first_cat_action');
    if (count >= 10) unlockAchievement('ten_cat_actions');
    if (count >= 25) unlockAchievement('cat_whisperer');

    // Track unique cat-interact days for Explorer Cat achievement
    try {
        const daysKey  = 'catInteractDays';
        const days     = new Set(JSON.parse(localStorage.getItem(daysKey) || '[]'));
        const today    = new Date().toISOString().slice(0, 10);
        days.add(today);
        localStorage.setItem(daysKey, JSON.stringify([...days]));
        if (days.size >= 3) unlockAchievement('explorer_cat');
    } catch (_) {}

    // Soft Paws — check cat achievement count
    const catAchCount = ['first_cat_action','ten_cat_actions','cat_whisperer','explorer_cat']
        .filter(id => unlockedAchievements.has(id)).length;
    if (catAchCount >= 3) unlockAchievement('soft_paws');

    if (unlockedAchievements.size >= 25) unlockAchievement('unlock_25');
    if (unlockedAchievements.size >= 10) unlockAchievement('power_user');
}

// Called after talking to the garden plant. count is the new total.
function _afterGardenTalk(count) {
    unlockAchievement('first_garden_talk');
    if (count >= 10) unlockAchievement('ten_garden_talks');
    if (unlockedAchievements.size >= 25) unlockAchievement('unlock_25');
    if (unlockedAchievements.size >= 10) unlockAchievement('power_user');
}

// ---- Console command state (used by slash-command gating) ----
// Derived from the reward registry — any console_command reward that is unlocked
// is also present in this set. unlockReward() keeps both in sync.
const _consoleCmdsKey = 'unlockedConsoleCmds';
let unlockedConsoleCmds = new Set(
    JSON.parse(localStorage.getItem(_consoleCmdsKey) || '[]')
);

// Seed unlockedRewards (and unlockedConsoleCmds) from already-unlocked achievements on load.
// This ensures users who unlocked achievements before the reward registry shipped
// don't lose their rewards on first load.
function _seedUnlockedRewards() {
    for (const [id] of unlockedAchievements) {
        const ach = ACHIEVEMENTS.find(a => a.id === id);
        if (!ach?.rewardIds) continue;
        for (const rId of ach.rewardIds) {
            const reward = REWARD_REGISTRY.find(r => r.id === rId);
            if (!reward) continue;
            unlockedRewards.add(rId);
            if (reward.type === REWARD_TYPE_CONSOLE_COMMAND) {
                unlockedConsoleCmds.add(reward.name.replace(/^\//, ''));
            }
        }
    }
    localStorage.setItem(_rewardStorageKey, JSON.stringify([...unlockedRewards]));
    localStorage.setItem(_consoleCmdsKey, JSON.stringify([...unlockedConsoleCmds]));
}

// localStorage key for "Show Unknown Achievements" toggle state.
const _ACH_SHOW_UNKNOWN_KEY = 'ach_show_unknown';

function renderAchievementsWindow() {
    if (_batchingAchievements) return;
    const body = document.getElementById('w95-achievements-body');
    if (!body) return;

    // "Show Unknown" toggle — persisted across reloads
    const showUnknown = localStorage.getItem(_ACH_SHOW_UNKNOWN_KEY) === '1';

    // ---- Helpers ----
    function fmtDate(ts) {
        return new Date(ts).toISOString().slice(0, 10);
    }

    function fmtRelative(ts) {
        const diff = Math.floor((Date.now() - ts) / 1000);
        if (diff < 60)   return 'just now';
        if (diff < 3600) return Math.floor(diff / 60) + ' min ago';
        return Math.floor(diff / 3600) + ' hr ago';
    }

    // Visual HTML progress bar (percentage-fill bar + count label)
    function progressBarHtml(current, target, isUnlocked) {
        const pct    = Math.min(100, Math.round(current / target * 100));
        const cls    = isUnlocked ? 'ach-progress-bar--done' : 'ach-progress-bar--active';
        return (
            `<div class="ach-progress-wrap">` +
            `<div class="ach-progress-bar ${cls}" style="width:${pct}%"></div>` +
            `</div>` +
            `<span class="ach-progress-count">${current}&nbsp;/&nbsp;${target}</span>`
        );
    }

    // ---- Level / XP header ----
    const lvl        = xpToLevel(xpTotal);
    const nextFloor  = xpForLevel(lvl + 1);
    const xpInLevel  = xpTotal - xpForLevel(lvl);
    const xpPct      = Math.min(100, Math.round(xpInLevel / XP_PER_LEVEL * 100));
    const unlockedCount = unlockedAchievements.size;
    const totalCount    = ACHIEVEMENTS.length;

    const levelHtml =
        `<div class="achievement-level-header">` +
        `<div class="achievement-level-row">` +
        `<span class="achievement-level-title">Level ${lvl}</span>` +
        `<span class="achievement-level-xp">${xpTotal}&nbsp;/&nbsp;${nextFloor} XP</span>` +
        `</div>` +
        `<div class="ach-xp-bar-wrap"><div class="ach-xp-bar-fill" style="width:${xpPct}%"></div></div>` +
        `<div class="achievement-level-sub">${unlockedCount}&nbsp;/&nbsp;${totalCount} achievements</div>` +
        `</div>`;

    // ---- Unlock history (this session) ----
    let historyHtml = '';
    if (achievementToastHistory.length > 0) {
        const rows = achievementToastHistory.slice(0, 5).map(h =>
            `<div class="achievement-toast-history-row">` +
            `<span class="achievement-toast-history-icon">${safeText(h.icon)}</span>` +
            `<span class="achievement-toast-history-title">${safeText(h.title)}</span>` +
            `<span class="achievement-toast-history-time">${fmtRelative(h.ts)}</span>` +
            `</div>`
        ).join('');
        historyHtml =
            `<div class="achievement-toast-history">` +
            `<div class="achievement-toast-history-header">Unlocked this session</div>` +
            rows +
            `</div>`;
    }

    // ---- Toggle toolbar ----
    const toggleHtml =
        `<div class="ach-toolbar">` +
        `<button class="ach-toggle-btn${showUnknown ? ' ach-toggle-btn--on' : ''}" id="ach-toggle-unknown">` +
        `${showUnknown ? '▼' : '▶'} Show Unknown` +
        `</button>` +
        `</div>`;

    // ---- Card renderer ----
    function renderCard(a) {
        const isUnlocked = unlockedAchievements.has(a.id);
        const ts         = unlockedAchievements.get(a.id);
        const isHidden   = a.hiddenUntilUnlocked || a.hidden; // backward compat

        // Silhouette cards — shown when toggle is ON and achievement is hidden+locked
        if (!isUnlocked && isHidden) {
            return (
                `<div class="achievement-item achievement-card is-locked is-silhouette tier-${a.tier}">` +
                `<span class="achievement-icon ach-silhouette-icon">???</span>` +
                `<div class="achievement-body">` +
                `<div class="achievement-title ach-silhouette-text">??? Unknown Achievement</div>` +
                `<div class="achievement-desc ach-silhouette-text">Keep exploring to discover this…</div>` +
                `</div>` +
                `</div>`
            );
        }

        // Reward badges — XP first, then named rewards from the registry
        let rewardBadge = '';
        if (isUnlocked) {
            if (a.xp) rewardBadge += `<span class="ach-reward-badge ach-reward-xp">+${a.xp} XP</span>`;
            if (Array.isArray(a.rewardIds)) {
                for (const rId of a.rewardIds) {
                    const reward = REWARD_REGISTRY.find(r => r.id === rId);
                    if (!reward) continue;
                    const cls = reward.type === REWARD_TYPE_CONSOLE_COMMAND ? 'ach-reward-cmd' : 'ach-reward-item';
                    rewardBadge += `<span class="ach-reward-badge ${cls}" title="${safeText(reward.description)}">${safeText(reward.name)}</span>`;
                }
            }
        }

        // Progress row
        let progressHtml = '';
        if (a.target) {
            const current = isUnlocked
                ? a.target
                : (a.getProgress ? a.getProgress() : 0);
            progressHtml =
                `<div class="ach-progress-row">` +
                progressBarHtml(current, a.target, isUnlocked) +
                `</div>`;
        }

        // Locked reward preview — show what the achievement would unlock (teaser)
        let lockedRewardHtml = '';
        if (!isUnlocked && Array.isArray(a.rewardIds) && a.rewardIds.length) {
            const previews = a.rewardIds.map(rId => {
                const r = REWARD_REGISTRY.find(x => x.id === rId);
                return r ? `<span class="ach-reward-badge ach-reward-locked" title="${safeText(r.description)}">🔒 ${safeText(r.name)}</span>` : '';
            }).join('');
            if (previews) lockedRewardHtml = `<div class="ach-locked-rewards">${previews}</div>`;
        }

        // Bottom meta row (unlock date + reward badges)
        const dateStr  = isUnlocked ? `Unlocked ${fmtDate(ts)}` : '';
        const metaHtml = (isUnlocked)
            ? `<div class="ach-meta-row"><span class="achievement-unlocked-date">${dateStr}</span>${rewardBadge}</div>`
            : (a.target
                ? lockedRewardHtml   // progress row shown; only add locked reward preview if present
                : `<div class="achievement-unlocked-date achievement-unlocked-date--placeholder"></div>${lockedRewardHtml}`);

        let itemClass = 'achievement-item achievement-card';
        if (isUnlocked) itemClass += ' is-unlocked';
        else            itemClass += ' is-locked';
        itemClass += ` tier-${a.tier}`;

        return (
            `<div class="${itemClass}">` +
            `<span class="achievement-icon">${safeText(a.icon)}</span>` +
            `<div class="achievement-body">` +
            `<div class="achievement-title">${safeText(a.title)}</div>` +
            `<div class="achievement-desc">${safeText(a.desc)}</div>` +
            progressHtml +
            metaHtml +
            `</div>` +
            `</div>`
        );
    }

    // ---- Tier sections ----
    const TIER_ORDER = ['bronze', 'silver', 'gold', 'mythic'];
    const TIER_LABELS = { bronze: '✦ Bronze', silver: '✦ Silver', gold: '✦ Gold', mythic: '★ Mythic' };
    let tiersHtml = '';

    for (const tier of TIER_ORDER) {
        const tierAchs   = ACHIEVEMENTS.filter(a => a.tier === tier);
        const unlocked   = tierAchs.filter(a =>  unlockedAchievements.has(a.id));
        const locked     = tierAchs.filter(a => !unlockedAchievements.has(a.id));
        const hidden     = locked.filter(a => a.hiddenUntilUnlocked || a.hidden);
        const visible    = locked.filter(a => !(a.hiddenUntilUnlocked || a.hidden));

        // Always show unlocked. Show visible-locked always. Show hidden only with toggle.
        const toRender = [...unlocked];
        if (visible.length) toRender.push(...visible);
        if (showUnknown && hidden.length) toRender.push(...hidden);

        // For mythic: only render unlocked (+ silhouettes if toggle is on)
        const mythicToRender = tier === 'mythic'
            ? [...unlocked, ...(showUnknown ? hidden : [])]
            : toRender;

        const cards = (tier === 'mythic' ? mythicToRender : toRender).map(renderCard).join('');

        // For non-mythic tiers that are all locked and toggle is off, show a count line
        const hasAnything = unlocked.length > 0 || visible.length > 0 || (showUnknown && hidden.length > 0);
        if (!hasAnything && tier !== 'mythic') {
            // Show the tier header + a "X hidden" hint, but only if there are locked achievements
            if (locked.length > 0) {
                tiersHtml +=
                    `<div class="achievement-tier-header">${safeText(TIER_LABELS[tier])}</div>` +
                    `<div class="ach-locked-hint">${locked.length} achievement${locked.length > 1 ? 's' : ''} locked — keep going</div>`;
            }
            continue;
        }

        if (!cards && tier === 'mythic') {
            if (hidden.length > 0 && !showUnknown) {
                tiersHtml +=
                    `<div class="achievement-tier-header">${safeText(TIER_LABELS[tier])}</div>` +
                    `<div class="ach-locked-hint">${hidden.length} secret achievement${hidden.length > 1 ? 's' : ''} — toggle "Show Unknown" to see silhouettes</div>`;
            }
            continue;
        }

        tiersHtml +=
            `<div class="achievement-tier-header">${safeText(TIER_LABELS[tier])}</div>` +
            cards;

        // Hidden count footer when some mythics are hidden and toggle is off
        if (tier === 'mythic' && hidden.length > 0 && !showUnknown) {
            tiersHtml += `<div class="ach-locked-hint">${hidden.length} secret achievement${hidden.length > 1 ? 's' : ''} hidden</div>`;
        }
    }

    // ---- Chat commands section ----
    const XP_TIERS = [
        { xp: 50,  tier: 2 },
        { xp: 120, tier: 3 },
        { xp: 250, tier: 4 },
        { xp: 500, tier: 5 },
    ];

    let commandsHtml = `<div class="achievement-tier-header">✦ Chat Commands</div>`;

    for (const { xp, tier } of XP_TIERS) {
        const cmds = XP_CHAT_COMMANDS.filter(c => c.requiredXP === xp);
        if (!cmds.length) continue;

        const tierUnlocked = xpTotal >= xp;
        const needed       = xp - xpTotal;
        const needLabel    = !tierUnlocked ? ` · need ${needed} more XP` : '';
        const tierClass    = tierUnlocked ? 'xp-cmd-group--unlocked' : 'xp-cmd-group--locked';

        commandsHtml += `<div class="xp-cmd-group ${tierClass}">`;
        commandsHtml +=
            `<div class="xp-cmd-group-header">` +
            `Tier ${tier} · ${xp} XP` +
            (tierUnlocked
                ? ` <span class="xp-cmd-unlocked-badge">✓ unlocked</span>`
                : `<span class="xp-cmd-need-label">${needLabel}</span>`) +
            `</div>`;

        for (const c of cmds) {
            const unlocked = xpTotal >= c.requiredXP;
            commandsHtml +=
                `<div class="xp-cmd-row${unlocked ? ' xp-cmd-row--unlocked' : ' xp-cmd-row--locked'}">` +
                `<span class="xp-cmd-status">${unlocked ? '✓' : '🔒'}</span>` +
                `<span class="xp-cmd-name">/${safeText(c.name)}</span>` +
                `<span class="xp-cmd-desc">${safeText(c.description)}</span>` +
                `</div>`;
        }

        commandsHtml += `</div>`;
    }

    body.innerHTML = levelHtml + historyHtml + toggleHtml + tiersHtml + commandsHtml;

    // Wire the toggle button (after innerHTML set)
    const toggleBtn = body.querySelector('#ach-toggle-unknown');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', () => {
            const current = localStorage.getItem(_ACH_SHOW_UNKNOWN_KEY) === '1';
            localStorage.setItem(_ACH_SHOW_UNKNOWN_KEY, current ? '0' : '1');
            renderAchievementsWindow();
        });
    }
}

// Achievements window IIFE
(() => {
    const win      = document.getElementById('w95-win-achievements');
    const min      = document.getElementById('w95-achievements-min');
    const max      = document.getElementById('w95-achievements-max');
    const closeBtn = document.getElementById('w95-achievements-close');
    const handle   = document.getElementById('w95-achievements-handle');
    if (!win || !min || !handle) return;

    let btn = null;

    function show() {
        if (!btn) btn = w95Mgr.addTaskbarBtn('w95-win-achievements', 'ACHIEVEMENTS', () => {
            if (win.classList.contains('is-hidden')) show(); else hide();
        });
        const _wasHiddenAch = win.classList.contains('is-hidden');
        win.classList.remove('is-hidden');
        w95Mgr.focusWindow('w95-win-achievements');
        localStorage.setItem('w95_achievements_open', '1');
        if (_wasHiddenAch) {
            renderAchievementsWindow();
            _trackWindowOpen('achievements');
        }
    }
    function hide() {
        win.classList.add('is-hidden');
        if (w95Mgr.isActiveWin('w95-win-achievements')) w95Mgr.focusWindow(null);
        localStorage.setItem('w95_achievements_open', '0');
    }
    function closeWin() {
        if (w95Mgr.isMaximised('w95-win-achievements')) w95Mgr.toggleMaximise(win, 'w95-win-achievements');
        hide();
        if (btn) { btn.remove(); btn = null; }
    }

    min.onclick = (e) => { e.stopPropagation(); hide(); };
    if (max) max.onclick = (e) => { e.stopPropagation(); w95Mgr.toggleMaximise(win, 'w95-win-achievements'); };
    if (closeBtn) closeBtn.onclick = (e) => { e.stopPropagation(); closeWin(); };

    w95Apps['achievements'] = { open: () => {
        if (win.classList.contains('is-hidden')) show(); else w95Mgr.focusWindow('w95-win-achievements');
    }};

    if (localStorage.getItem('w95_achievements_open') === '1') show();

    // Drag support
    let dragging = false, startX = 0, startY = 0, winStartX = 0, winStartY = 0;
    handle.addEventListener('mousedown', (e) => {
        if (e.target.closest('button')) return;
        if (w95Mgr.isMaximised('w95-win-achievements')) return;
        dragging = true;
        startX = e.clientX; startY = e.clientY;
        const r = win.getBoundingClientRect();
        winStartX = r.left; winStartY = r.top;
        e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        const taskbarH = 40;
        const maxX = document.documentElement.clientWidth - win.offsetWidth;
        const maxY = document.documentElement.clientHeight - win.offsetHeight - taskbarH;
        win.style.left = Math.max(0, Math.min(maxX, winStartX + (e.clientX - startX))) + 'px';
        win.style.top  = Math.max(0, Math.min(maxY, winStartY + (e.clientY - startY))) + 'px';
    });
    window.addEventListener('mouseup', () => { if (dragging) { dragging = false; w95Layout.save(win, 'w95-win-achievements'); } });
})();

// ===== Win95 Mailbox Window =====
(() => {
    const win      = document.getElementById('w95-win-mailbox');
    const minBtn   = document.getElementById('w95-mailbox-min');
    const maxBtn   = document.getElementById('w95-mailbox-max');
    const closeBtn = document.getElementById('w95-mailbox-close');
    const handle   = document.getElementById('w95-mailbox-handle');
    if (!win || !minBtn || !closeBtn || !handle) return;

    let btn = null;

    function showMailbox() {
        const _wasHiddenMb = win.classList.contains('is-hidden');
        if (!btn) btn = w95Mgr.addTaskbarBtn('w95-win-mailbox', 'MAILBOX', () => {
            if (win.classList.contains('is-hidden')) showMailbox(); else hideMailbox();
        });
        win.classList.remove('is-hidden');
        w95Mgr.focusWindow('w95-win-mailbox');
        renderMailbox();
        if (_wasHiddenMb) _trackWindowOpen('mailbox');
    }

    function hideMailbox() {
        win.classList.add('is-hidden');
        if (w95Mgr.isActiveWin('w95-win-mailbox')) w95Mgr.focusWindow(null);
    }

    function closeMailbox() {
        if (w95Mgr.isMaximised('w95-win-mailbox')) w95Mgr.toggleMaximise(win, 'w95-win-mailbox');
        hideMailbox();
        if (btn) { btn.remove(); btn = null; }
    }

    minBtn.addEventListener('click', (e) => { e.stopPropagation(); hideMailbox(); });
    if (maxBtn) maxBtn.addEventListener('click', (e) => { e.stopPropagation(); w95Mgr.toggleMaximise(win, 'w95-win-mailbox'); });
    closeBtn.addEventListener('click', (e) => { e.stopPropagation(); closeMailbox(); });

    // Drag support
    let dragging = false, startX = 0, startY = 0, winStartX = 0, winStartY = 0;
    handle.addEventListener('mousedown', (e) => {
        if (e.target.closest('button')) return;
        if (w95Mgr.isMaximised('w95-win-mailbox')) return;
        dragging = true;
        startX = e.clientX; startY = e.clientY;
        const r = win.getBoundingClientRect();
        winStartX = r.left; winStartY = r.top;
        e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        const taskbarH = 40;
        const maxX = document.documentElement.clientWidth - win.offsetWidth;
        const maxY = document.documentElement.clientHeight - win.offsetHeight - taskbarH;
        win.style.left = Math.max(0, Math.min(maxX, winStartX + (e.clientX - startX))) + 'px';
        win.style.top  = Math.max(0, Math.min(maxY, winStartY + (e.clientY - startY))) + 'px';
    });
    window.addEventListener('mouseup', () => { if (dragging) { dragging = false; w95Layout.save(win, 'w95-win-mailbox'); } });

    w95Apps['mailbox'] = { open: () => {
        if (win.classList.contains('is-hidden')) showMailbox(); else w95Mgr.focusWindow('w95-win-mailbox');
    }};
})();

// ===== Win95 Jukebox Window =====
(() => {
    const win      = document.getElementById('w95-win-jukebox');
    const minBtn   = document.getElementById('w95-jukebox-min');
    const maxBtn   = document.getElementById('w95-jukebox-max');
    const closeBtn = document.getElementById('w95-jukebox-close');
    const handle   = document.getElementById('w95-jukebox-handle');
    if (!win || !minBtn || !closeBtn || !handle) return;

    let btn = null;

    function showJukebox() {
        const _wasHiddenJb = win.classList.contains('is-hidden');
        if (!btn) btn = w95Mgr.addTaskbarBtn('w95-win-jukebox', 'JUKEBOX', () => {
            if (win.classList.contains('is-hidden')) showJukebox(); else hideJukebox();
        });
        win.classList.remove('is-hidden');
        w95Mgr.focusWindow('w95-win-jukebox');
        if (_wasHiddenJb) _trackWindowOpen('jukebox');
    }

    function hideJukebox() {
        win.classList.add('is-hidden');
        if (w95Mgr.isActiveWin('w95-win-jukebox')) w95Mgr.focusWindow(null);
    }

    function closeJukebox() {
        if (w95Mgr.isMaximised('w95-win-jukebox')) w95Mgr.toggleMaximise(win, 'w95-win-jukebox');
        hideJukebox();
        if (btn) { btn.remove(); btn = null; }
    }

    minBtn.addEventListener('click', (e) => { e.stopPropagation(); hideJukebox(); });
    if (maxBtn) maxBtn.addEventListener('click', (e) => { e.stopPropagation(); w95Mgr.toggleMaximise(win, 'w95-win-jukebox'); });
    closeBtn.addEventListener('click', (e) => { e.stopPropagation(); closeJukebox(); });

    // Drag support
    let dragging = false, startX = 0, startY = 0, winStartX = 0, winStartY = 0;
    handle.addEventListener('mousedown', (e) => {
        if (e.target.closest('button')) return;
        if (w95Mgr.isMaximised('w95-win-jukebox')) return;
        dragging = true;
        startX = e.clientX; startY = e.clientY;
        const r = win.getBoundingClientRect();
        winStartX = r.left; winStartY = r.top;
        e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        const taskbarH = 40;
        const maxX = document.documentElement.clientWidth - win.offsetWidth;
        const maxY = document.documentElement.clientHeight - win.offsetHeight - taskbarH;
        win.style.left = Math.max(0, Math.min(maxX, winStartX + (e.clientX - startX))) + 'px';
        win.style.top  = Math.max(0, Math.min(maxY, winStartY + (e.clientY - startY))) + 'px';
    });
    window.addEventListener('mouseup', () => { if (dragging) { dragging = false; w95Layout.save(win, 'w95-win-jukebox'); } });

    w95Apps['jukebox'] = { open: () => {
        if (win.classList.contains('is-hidden')) showJukebox(); else w95Mgr.focusWindow('w95-win-jukebox');
    }};
})();

// ===== Win95 Scrapbook Window =====
(() => {
    const win      = document.getElementById('w95-win-scrapbook');
    const minBtn   = document.getElementById('w95-scrapbook-min');
    const maxBtn   = document.getElementById('w95-scrapbook-max');
    const closeBtn = document.getElementById('w95-scrapbook-close');
    const handle   = document.getElementById('w95-scrapbook-handle');
    if (!win || !handle) return;

    let btn = null;

    function show() {
        if (!btn) btn = w95Mgr.addTaskbarBtn('w95-win-scrapbook', 'SCRAPBOOK', () => {
            if (win.classList.contains('is-hidden')) show(); else hide();
        });
        win.classList.remove('is-hidden');
        w95Mgr.focusWindow('w95-win-scrapbook');
        localStorage.setItem('w95_scrapbook_open', '1');
        renderBoardsList();
    }

    function hide() {
        win.classList.add('is-hidden');
        if (w95Mgr.isActiveWin('w95-win-scrapbook')) w95Mgr.focusWindow(null);
        localStorage.setItem('w95_scrapbook_open', '0');
    }

    function closeWin() {
        if (w95Mgr.isMaximised('w95-win-scrapbook')) w95Mgr.toggleMaximise(win, 'w95-win-scrapbook');
        win.classList.add('is-hidden');
        if (w95Mgr.isActiveWin('w95-win-scrapbook')) w95Mgr.focusWindow(null);
        localStorage.setItem('w95_scrapbook_open', '0');
        if (btn) { btn.remove(); btn = null; }
    }

    win.addEventListener('mousedown', () => w95Mgr.focusWindow('w95-win-scrapbook'));

    if (minBtn)   minBtn.onclick   = (e) => { e.stopPropagation(); hide(); };
    if (maxBtn)   maxBtn.onclick   = (e) => { e.stopPropagation(); w95Mgr.toggleMaximise(win, 'w95-win-scrapbook'); };
    if (closeBtn) closeBtn.onclick = (e) => { e.stopPropagation(); closeWin(); };

    makeDraggable(win, handle, 'w95-win-scrapbook');

    if (localStorage.getItem('w95_scrapbook_open') === '1') show();

    w95Apps['scrapbook'] = { open: () => {
        if (win.classList.contains('is-hidden')) show(); else w95Mgr.focusWindow('w95-win-scrapbook');
    }};
})();

// ===== Win95 Wishlist Window =====
(() => {
    const win      = document.getElementById('w95-win-wishlist');
    const minBtn   = document.getElementById('w95-wishlist-min');
    const maxBtn   = document.getElementById('w95-wishlist-max');
    const closeBtn = document.getElementById('w95-wishlist-close');
    const handle   = document.getElementById('w95-wishlist-handle');
    if (!win || !handle) return;

    let btn = null;

    function show() {
        if (!btn) btn = w95Mgr.addTaskbarBtn('w95-win-wishlist', 'WISHLIST', () => {
            if (win.classList.contains('is-hidden')) show(); else hide();
        });
        win.classList.remove('is-hidden');
        w95Mgr.focusWindow('w95-win-wishlist');
        localStorage.setItem('w95_wishlist_open', '1');
        renderWishlistBoardsList();
    }

    function hide() {
        win.classList.add('is-hidden');
        if (w95Mgr.isActiveWin('w95-win-wishlist')) w95Mgr.focusWindow(null);
        localStorage.setItem('w95_wishlist_open', '0');
    }

    function closeWin() {
        if (w95Mgr.isMaximised('w95-win-wishlist')) w95Mgr.toggleMaximise(win, 'w95-win-wishlist');
        win.classList.add('is-hidden');
        if (w95Mgr.isActiveWin('w95-win-wishlist')) w95Mgr.focusWindow(null);
        localStorage.setItem('w95_wishlist_open', '0');
        if (btn) { btn.remove(); btn = null; }
    }

    win.addEventListener('mousedown', () => w95Mgr.focusWindow('w95-win-wishlist'));

    if (minBtn)   minBtn.onclick   = (e) => { e.stopPropagation(); hide(); };
    if (maxBtn)   maxBtn.onclick   = (e) => { e.stopPropagation(); w95Mgr.toggleMaximise(win, 'w95-win-wishlist'); };
    if (closeBtn) closeBtn.onclick = (e) => { e.stopPropagation(); closeWin(); };

    makeDraggable(win, handle, 'w95-win-wishlist');

    if (localStorage.getItem('w95_wishlist_open') === '1') show();

    w95Apps['wishlist'] = { open: () => {
        if (win.classList.contains('is-hidden')) show(); else w95Mgr.focusWindow('w95-win-wishlist');
    }};
})();

// ===== Desktop Icon Positions =====
const ICON_DEFAULTS = {
    feed:         { x: 16,  y: 16  },
    chat:         { x: 16,  y: 100 },
    garden:       { x: 16,  y: 184 },
    achievements: { x: 16,  y: 268 },
    mailbox:      { x: 16,  y: 352 },
    jukebox:      { x: 16,  y: 436 },
    recycleBin:   { x: 16,  y: 520 },
    cat:          { x: 16,  y: 604 },
    myComputer:   { x: 16,  y: 688 },
    console:      { x: 104, y: 16  },
    scrapbook:    { x: 104, y: 100 },
    wishlist:     { x: 104, y: 184 },
};

// ===== Snap-to-grid + Arrange =====
const GRID_SIZE   = 80; // px — grid cell size for icon snapping
const GRID_OFFSET =  8; // px — same offset used by arrangeByName so manual drags align

function snapToGrid(x, y) {
    return {
        x: Math.round((x - GRID_OFFSET) / GRID_SIZE) * GRID_SIZE + GRID_OFFSET,
        y: Math.round((y - GRID_OFFSET) / GRID_SIZE) * GRID_SIZE + GRID_OFFSET,
    };
}

function getDesktopPrefs() {
    if (!currentUser) return {};
    try { return JSON.parse(localStorage.getItem(`desktopPrefs_${currentUser}`) || '{}'); } catch { return {}; }
}

function saveDesktopPrefs(prefs) {
    if (!currentUser) return;
    localStorage.setItem(`desktopPrefs_${currentUser}`, JSON.stringify(prefs));
}

function arrangeByName() {
    const icons = Array.from(document.querySelectorAll('.w95-desktop-icon:not(.is-hidden)'));
    icons.sort((a, b) => {
        const la = a.querySelector('.desktop-icon-label')?.textContent || '';
        const lb = b.querySelector('.desktop-icon-label')?.textContent || '';
        return la.localeCompare(lb);
    });
    const desktop = document.getElementById('w95-desktop');
    const dh = desktop ? desktop.offsetHeight : window.innerHeight - 40;
    const perCol = Math.max(1, Math.floor(dh / GRID_SIZE));
    const positions = getIconPositions();
    icons.forEach((icon, i) => {
        const col = Math.floor(i / perCol);
        const row = i % perCol;
        const x = col * GRID_SIZE + 8;
        const y = row * GRID_SIZE + 8;
        icon.style.left = x + 'px';
        icon.style.top  = y + 'px';
        if (icon.dataset.app) positions[icon.dataset.app] = { x, y };
    });
    saveIconPositions(positions);
}

function updateAutoArrangeLabel() {
    const btn = document.getElementById('ctx-auto-arrange');
    if (!btn) return;
    const prefs = getDesktopPrefs();
    btn.textContent = (prefs.autoArrange ? '\u2713 ' : '') + 'Auto Arrange';
}

function getIconPositions() {
    if (!currentUser) return {};
    try { return JSON.parse(localStorage.getItem(`iconPositions_${currentUser}`) || '{}'); } catch { return {}; }
}

function saveIconPositions(positions) {
    if (!currentUser) return;
    localStorage.setItem(`iconPositions_${currentUser}`, JSON.stringify(positions));
}

function applyIconPositions() {
    const positions = getIconPositions();

    // Collect all positions already claimed (saved or default) for free-slot detection.
    const allocated = [];
    document.querySelectorAll('.w95-desktop-icon').forEach(icon => {
        const p = positions[icon.dataset.app] || ICON_DEFAULTS[icon.dataset.app];
        if (p) allocated.push(p);
    });

    // Returns the first grid slot not within icon-size proximity of any allocated position.
    // Uses the same column/row spacing as the existing ICON_DEFAULTS layout.
    function nextFreeSlot() {
        const deskEl = document.getElementById('w95-desktop');
        const dh = deskEl ? deskEl.offsetHeight : window.innerHeight - 40;
        const COL_W = 88; // icon width (72) + gap — keeps columns visually separated
        const ROW_H = 84; // matches the 84 px row stride used in ICON_DEFAULTS
        for (let col = 0; ; col++) {
            for (let row = 0; ; row++) {
                const x = 16 + col * COL_W;
                const y = 16 + row * ROW_H;
                if (y + 68 > dh) break; // column is full, try next
                if (!allocated.some(p => Math.abs(p.x - x) < 72 && Math.abs(p.y - y) < 68)) {
                    allocated.push({ x, y });
                    return { x, y };
                }
            }
        }
        return { x: 16, y: 16 }; // unreachable fallback
    }

    document.querySelectorAll('.w95-desktop-icon').forEach(icon => {
        const appKey = icon.dataset.app;
        const pos = positions[appKey] || ICON_DEFAULTS[appKey] || nextFreeSlot();
        icon.style.left = pos.x + 'px';
        icon.style.top  = pos.y + 'px';
    });
}

// ===== Folder Window System =====

// Apps that can be added as shortcuts inside custom folders
const SHORTCUTABLE_APPS = [
    { app: 'feed',         icon: '📰', name: 'Feed.exe' },
    { app: 'chat',         icon: '💬', name: 'Chat.exe' },
    { app: 'mailbox',      icon: '📬', name: 'Mailbox.exe' },
    { app: 'garden',       icon: '🌿', name: 'Garden.exe' },
    { app: 'cat',          icon: '🐱', name: 'Cat.exe' },
    { app: 'jukebox',      icon: '🎵', name: 'Jukebox.exe' },
    { app: 'console',      icon: '💻', name: 'Console.exe' },
    { app: 'scrapbook',    icon: '📋', name: 'Scrapbook.exe' },
    { app: 'wishlist',     icon: '🎁', name: 'Wishlist.exe' },
    { app: 'stats',        icon: '📊', name: 'Stats.exe' },
    { app: 'achievements', icon: '🏆', name: 'Achievements.exe' },
    { app: 'myComputer',   icon: '🖥️', name: 'My Computer' },
];

// Shows a picker dialog for selecting an app to create a shortcut to
function openAppPickerDialog(onPick) {
    function esc(s) { return String(s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c])); }
    const overlay = document.createElement('div');
    overlay.className = 'w95-dialog-overlay';
    const appItems = SHORTCUTABLE_APPS.map(a =>
        `<div class="explorer-item" data-app-key="${a.app}" tabindex="0">
            <span class="explorer-item-icon">${a.icon}</span>
            <span class="explorer-item-name">${esc(a.name)}</span>
        </div>`
    ).join('');
    overlay.innerHTML = `
        <div class="w95-dialog" role="dialog" aria-modal="true" style="width:380px;max-width:95vw;">
            <div class="w95-titlebar window--active">
                <div class="w95-title">Create Shortcut</div>
                <div class="w95-controls">
                    <button class="w95-control w95-control-close w95-dialog-x" type="button" aria-label="Close">X</button>
                </div>
            </div>
            <div class="w95-dialog-body" style="flex-direction:column;align-items:stretch;padding:8px;">
                <div style="margin:0 0 6px;font:11px Tahoma,sans-serif;">Double-click an app to create a shortcut to it:</div>
                <div class="explorer-grid" style="max-height:200px;overflow-y:auto;border:2px inset #808080;background:#fff;">${appItems}</div>
            </div>
            <div class="w95-dialog-btns">
                <button class="w95-btn w95-dialog-btn" type="button">Cancel</button>
            </div>
        </div>`;
    document.body.appendChild(overlay);
    function close() { overlay.remove(); document.removeEventListener('keydown', onKey); }
    overlay.querySelector('.w95-dialog-x').addEventListener('click', close);
    overlay.querySelector('.w95-dialog-btn').addEventListener('click', close);
    overlay.addEventListener('pointerdown', e => { if (e.target === overlay) close(); });
    function onKey(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);
    const clickTimes = {};
    overlay.querySelectorAll('.explorer-item').forEach(el => {
        el.addEventListener('click', () => {
            const now = Date.now();
            const key = el.dataset.appKey;
            overlay.querySelectorAll('.explorer-item').forEach(i => i.classList.remove('selected'));
            el.classList.add('selected');
            if (clickTimes[key] && now - clickTimes[key] < 500) {
                const app = SHORTCUTABLE_APPS.find(a => a.app === key);
                if (app) { close(); onPick(app); }
            } else { clickTimes[key] = now; }
        });
    });
}

// Opens a draggable folder window for a custom folder item
function openFolderWindow(folderItem) {
    // Always read fresh children from localStorage so drops persisted since last open are visible
    const _fresh = (window._desktopCustom?.getItems() || []).find(i => i.id === folderItem.id);
    if (_fresh) folderItem.children = _fresh.children || [];
    if (!folderItem.children) folderItem.children = [];
    function esc(s) { return String(s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c])); }

    function saveFolder() {
        const items = window._desktopCustom?.getItems() || [];
        const found = items.find(i => i.id === folderItem.id);
        if (found) { found.children = folderItem.children; window._desktopCustom?.saveItems(items); }
    }

    // Remove any pre-existing window for this folder so double-open just re-focuses
    const winId = 'fwin-' + folderItem.id;
    const existing = document.getElementById(winId);
    if (existing) { existing.style.zIndex = ++w95TopZ; return; }

    const win = document.createElement('div');
    win.id = winId;
    win.className = 'w95-window';
    win.style.cssText = 'position:fixed;width:480px;max-width:95vw;height:360px;display:flex;flex-direction:column;left:140px;top:90px;';
    win.style.zIndex = ++w95TopZ;

    win.innerHTML = `
        <div class="w95-titlebar window--active" id="${winId}-handle">
            <div class="w95-title">📁 ${esc(folderItem.name)}</div>
            <div class="w95-controls">
                <button class="w95-control w95-control-close" type="button" aria-label="Close">X</button>
            </div>
        </div>
        <div class="explorer-toolbar">
            <div class="explorer-addr">${esc(folderItem.name)}</div>
        </div>
        <div class="explorer-body">
            <div class="explorer-grid" id="${winId}-grid"></div>
        </div>`;

    // Item right-click context menu (lives in document.body for z-index)
    const itemCtxMenu = document.createElement('div');
    itemCtxMenu.className = 'w95-ctx-menu is-hidden';
    itemCtxMenu.style.cssText = 'position:fixed;z-index:99999;';
    itemCtxMenu.innerHTML = `
        <button class="w95-ctx-item" data-action="open" type="button"><b>Open</b></button>
        <hr class="w95-ctx-separator">
        <button class="w95-ctx-item" data-action="rename" type="button">Rename</button>
        <button class="w95-ctx-item" data-action="delete" type="button">Delete</button>`;
    document.body.appendChild(itemCtxMenu);
    document.body.appendChild(win);

    // Register so drag-to-folder can find the live item + re-render function
    if (!window._openFolderWindows) window._openFolderWindows = {};
    window._openFolderWindows[folderItem.id] = { item: folderItem, render: () => renderGrid() };

    function cleanup() {
        delete window._openFolderWindows?.[folderItem.id];
        itemCtxMenu.remove();
        win.remove();
    }
    win.querySelector('.w95-control-close').addEventListener('click', cleanup);

    // Bring to front on click
    win.addEventListener('mousedown', () => { win.style.zIndex = ++w95TopZ; });

    // Drag
    const handle = document.getElementById(`${winId}-handle`);
    let dragging = false, dStartX = 0, dStartY = 0, dWinX = 0, dWinY = 0;
    handle.addEventListener('mousedown', e => {
        if (e.target.closest('button')) return;
        dragging = true;
        dStartX = e.clientX; dStartY = e.clientY;
        const r = win.getBoundingClientRect();
        dWinX = r.left; dWinY = r.top;
        e.preventDefault();
    });
    window.addEventListener('mousemove', e => {
        if (!dragging) return;
        const taskH = 40, vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
        win.style.left = Math.max(0, Math.min(vw - 80, dWinX + e.clientX - dStartX)) + 'px';
        win.style.top  = Math.max(0, Math.min(vh - taskH - 30, dWinY + e.clientY - dStartY)) + 'px';
    });
    window.addEventListener('mouseup', () => { dragging = false; });

    // Hide item context menu on outside click
    let ctxTargetId = null;
    document.addEventListener('pointerdown', e => {
        if (!itemCtxMenu.contains(e.target)) itemCtxMenu.classList.add('is-hidden');
    }, { capture: true });

    function renderGrid() {
        const grid = document.getElementById(`${winId}-grid`);
        if (!grid) return;
        if (!folderItem.children.length) {
            grid.innerHTML = '<div class="explorer-empty">(This folder is empty — use the buttons above to add items)</div>';
            return;
        }
        const clickTimes = {};
        grid.innerHTML = folderItem.children.map(child => {
            const icon = child.type === 'textfile' ? '📝' : (child.icon || '⚙️');
            return `<div class="explorer-item" data-child-id="${child.id}" tabindex="0">
                <span class="explorer-item-icon">${icon}</span>
                <span class="explorer-item-name">${esc(child.name)}</span>
            </div>`;
        }).join('');
        grid.querySelectorAll('.explorer-item').forEach(el => {
            const childId = el.dataset.childId;
            el.addEventListener('click', () => {
                const now = Date.now();
                grid.querySelectorAll('.explorer-item').forEach(i => i.classList.remove('selected'));
                el.classList.add('selected');
                if (clickTimes[childId] && now - clickTimes[childId] < 500) {
                    openChild(childId); clickTimes[childId] = 0;
                } else { clickTimes[childId] = now; }
            });
            el.addEventListener('keydown', e => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openChild(childId); }
            });
            el.addEventListener('contextmenu', e => {
                e.preventDefault(); e.stopPropagation();
                itemCtxMenu.classList.add('is-hidden');
                ctxTargetId = childId;
                grid.querySelectorAll('.explorer-item').forEach(i => i.classList.remove('selected'));
                el.classList.add('selected');
                itemCtxMenu.style.left = e.clientX + 'px';
                itemCtxMenu.style.top  = e.clientY + 'px';
                itemCtxMenu.classList.remove('is-hidden');
            });
        });
    }

    function openChild(childId) {
        const child = folderItem.children.find(c => c.id === childId);
        if (!child) return;
        if (child.type === 'textfile') {
            openW95Notepad(child, { onSave: content => { child.content = content; saveFolder(); } });
        } else if (child.type === 'shortcut') {
            w95Apps[child.app]?.open();
        }
    }

    // Item context menu actions
    itemCtxMenu.addEventListener('click', e => {
        const action = e.target.closest('[data-action]')?.dataset.action;
        itemCtxMenu.classList.add('is-hidden');
        const child = folderItem.children.find(c => c.id === ctxTargetId);
        if (!child) return;
        if (action === 'open') {
            openChild(ctxTargetId);
        } else if (action === 'rename') {
            openW95Prompt({
                icon: child.type === 'textfile' ? '📝' : '⚙️',
                title: 'Rename',
                message: 'Enter a new name:',
                defaultValue: child.name,
                onOK: name => { child.name = name; saveFolder(); renderGrid(); }
            });
        } else if (action === 'delete') {
            openW95Dialog({
                icon: '🗑️',
                title: 'Confirm Delete',
                message: `Delete '${child.name}'?`,
                buttons: [
                    { label: 'Yes', action: () => {
                        addToLocalTrash(child);
                        folderItem.children = folderItem.children.filter(c => c.id !== ctxTargetId);
                        saveFolder(); renderGrid();
                    }},
                    { label: 'No', action: null }
                ]
            });
        }
    });

    renderGrid();
}

// ===== Win95 Feed Window + Desktop Icon Management =====
(() => {
    const win      = document.getElementById('w95-win-feed');
    const minBtn   = document.getElementById('w95-feed-min');
    const maxBtn   = document.getElementById('w95-feed-max');
    const closeBtn = document.getElementById('w95-feed-close');
    const handle   = document.getElementById('w95-feed-handle');
    if (!win || !minBtn || !closeBtn || !handle) return;

    let btn = null;

    function showFeed() {
        const _wasHiddenFeed = win.classList.contains('is-hidden');
        if (!btn) btn = w95Mgr.addTaskbarBtn('w95-win-feed', 'FEED', () => {
            if (win.classList.contains('is-hidden')) showFeed(); else hideFeed();
        });
        win.classList.remove('is-hidden');
        w95Mgr.focusWindow('w95-win-feed');
        localStorage.setItem('w95_feed_open', '1');
        if (_wasHiddenFeed) _trackWindowOpen('feed');
    }

    function hideFeed() {
        win.classList.add('is-hidden');
        if (w95Mgr.isActiveWin('w95-win-feed')) w95Mgr.focusWindow(null);
        localStorage.setItem('w95_feed_open', '0');
        updateScrollTopBtn();
    }

    function closeFeed() {
        if (w95Mgr.isMaximised('w95-win-feed')) w95Mgr.toggleMaximise(win, 'w95-win-feed');
        win.classList.add('is-hidden');
        if (w95Mgr.isActiveWin('w95-win-feed')) w95Mgr.focusWindow(null);
        localStorage.setItem('w95_feed_open', '0');
        if (btn) { btn.remove(); btn = null; }
        updateScrollTopBtn();
    }

    // Minimize button
    minBtn.addEventListener('click', (e) => { e.stopPropagation(); hideFeed(); });

    // Maximise button
    if (maxBtn) maxBtn.addEventListener('click', (e) => { e.stopPropagation(); w95Mgr.toggleMaximise(win, 'w95-win-feed'); });

    // Close button: fully closes the window and removes taskbar button
    closeBtn.addEventListener('click', (e) => { e.stopPropagation(); closeFeed(); });

    // Drag support
    let dragging = false, startX = 0, startY = 0, winStartX = 0, winStartY = 0;
    handle.addEventListener('mousedown', (e) => {
        if (e.target.closest('button')) return;
        if (w95Mgr.isMaximised('w95-win-feed')) return;
        dragging = true;
        startX = e.clientX; startY = e.clientY;
        const r = win.getBoundingClientRect();
        winStartX = r.left; winStartY = r.top;
        e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        const taskbarH = 40;
        const maxX = document.documentElement.clientWidth - win.offsetWidth;
        const maxY = document.documentElement.clientHeight - win.offsetHeight - taskbarH;
        win.style.left = Math.max(0, Math.min(maxX, winStartX + (e.clientX - startX))) + 'px';
        win.style.top  = Math.max(0, Math.min(maxY, winStartY + (e.clientY - startY))) + 'px';
    });
    window.addEventListener('mouseup', () => { if (dragging) { dragging = false; w95Layout.save(win, 'w95-win-feed'); } });

    // Restore open state — default closed (desktop is shown first)
    if (localStorage.getItem('w95_feed_open') === '1') showFeed();

    w95Apps['feed'] = { open: () => {
        if (win.classList.contains('is-hidden')) showFeed(); else w95Mgr.focusWindow('w95-win-feed');
    }};

    // ---- Desktop icon drag + selection logic ----
    function openApp(appKey) {
        const app = w95Apps[appKey];
        if (app) app.open();
    }

    function clearIconSelection() {
        document.querySelectorAll('.w95-desktop-icon').forEach(i => i.classList.remove('selected'));
    }

    // Apply saved (or default) positions on first load
    applyIconPositions();

    const DRAG_THRESHOLD = 4; // px — below this, treat as a click not a drag
    const clickTimes = {};

    // ---- Shared icon drag state (mouse-event based, same pattern as window dragging) ----
    // Using mousedown/mousemove/mouseup mirrors the proven window-drag implementation and
    // avoids pointer-capture and pointer-events:none interaction issues.
    let _drag = null; // active drag descriptor, or null when idle

    window.addEventListener('mousemove', (e) => {
        if (!_drag) return;
        const dx = e.clientX - _drag.startX;
        const dy = e.clientY - _drag.startY;
        if (!_drag.didDrag && (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD)) {
            _drag.didDrag = true;
        }
        if (_drag.didDrag) {
            const desktop = document.getElementById('w95-desktop');
            const dw = desktop.offsetWidth;
            const dh = desktop.offsetHeight;
            // Move every selected icon by the same delta
            document.querySelectorAll('.w95-desktop-icon.selected').forEach(si => {
                const sk = si.dataset.app;
                const start = _drag.dragStarts[sk];
                if (!start) return;
                const iconW = si.offsetWidth  || 72;
                const iconH = si.offsetHeight || 68;
                si.style.left = Math.max(0, Math.min(dw - iconW, start.left + dx)) + 'px';
                si.style.top  = Math.max(0, Math.min(dh - iconH, start.top  + dy)) + 'px';
            });
            // Detect folder / recycle-bin drop target under dragged icon's centre
            const rect = _drag.icon.getBoundingClientRect();
            const cx = rect.left + rect.width / 2;
            const cy = rect.top  + rect.height / 2;
            let newTarget = null;
            // Check folder desktop icons (skip any that are being dragged)
            document.querySelectorAll('.w95-desktop-icon[data-folder="1"]').forEach(fi => {
                if (fi.classList.contains('selected')) return;
                const fr = fi.getBoundingClientRect();
                if (cx >= fr.left && cx <= fr.right && cy >= fr.top && cy <= fr.bottom) {
                    newTarget = { el: fi, folderId: fi.dataset.app };
                }
            });
            // Check open folder window grids
            if (!newTarget) {
                document.querySelectorAll('[id^="fwin-"] .explorer-grid').forEach(grid => {
                    const gr = grid.getBoundingClientRect();
                    if (cx >= gr.left && cx <= gr.right && cy >= gr.top && cy <= gr.bottom) {
                        newTarget = { el: grid, folderId: grid.closest('[id^="fwin-"]').id.replace('fwin-', '') };
                    }
                });
            }
            // Check recycle bin icon
            if (!newTarget) {
                const rbEl = document.querySelector('.w95-desktop-icon[data-app="recycleBin"]');
                if (rbEl && !rbEl.classList.contains('selected')) {
                    const rr = rbEl.getBoundingClientRect();
                    if (cx >= rr.left && cx <= rr.right && cy >= rr.top && cy <= rr.bottom) {
                        newTarget = { el: rbEl, type: 'recycleBin' };
                    }
                }
            }
            // Update drop-target highlight
            if (_drag.dropTarget?.el !== newTarget?.el) {
                _drag.dropTarget?.el.classList.remove('drop-target');
                newTarget?.el.classList.add('drop-target');
                _drag.dropTarget = newTarget;
            }
        }
    });

    window.addEventListener('mouseup', (e) => {
        if (!_drag) return;
        const drag = _drag;
        _drag = null; // clear before any callbacks


        const isCtrl = e.ctrlKey || e.metaKey;

        if (drag.didDrag) {
            if (drag.dropTarget) drag.dropTarget.el.classList.remove('drop-target');
            if (drag.dropTarget?.type === 'recycleBin') {
                // === Drop icons into recycle bin ===
                const dropTarget = drag.dropTarget;
                const customItems = window._desktopCustom?.getItems() || [];
                const positions = getIconPositions();
                const toRemove = [];
                document.querySelectorAll('.w95-desktop-icon.selected').forEach(si => {
                    const sk = si.dataset.app;
                    if (sk === 'recycleBin') return;
                    const srcItem = customItems.find(i => i.id === sk);
                    if (srcItem) {
                        addToLocalTrash(srcItem);
                        toRemove.push(sk);
                        si.remove();
                        delete w95Apps[sk];
                        delete positions[sk];
                    } else {
                        // Built-in icon: send to Firebase recycle bin and hide immediately
                        const label = si.querySelector('.desktop-icon-label')?.textContent || sk;
                        set(ref(database, `recycleBin/icon_${sk}`), {
                            type: 'desktop-icon', iconApp: sk, iconLabel: label, deletedAt: Date.now(),
                        });
                        si.classList.add('is-hidden');
                    }
                });
                if (toRemove.length) {
                    window._desktopCustom?.saveItems(customItems.filter(i => !toRemove.includes(i.id)));
                    saveIconPositions(positions);
                    renderRecycleBin();
                }
            } else if (drag.dropTarget) {
                // === Drop icons into folder ===
                const tid = drag.dropTarget.folderId;
                const customItems = window._desktopCustom?.getItems() || [];
                const targetFolder = customItems.find(i => i.id === tid);
                if (targetFolder) {
                    if (!targetFolder.children) targetFolder.children = [];
                    const positions = getIconPositions();
                    const toRemove = [];
                    document.querySelectorAll('.w95-desktop-icon.selected').forEach(si => {
                        const sk = si.dataset.app;
                        if (sk === tid) return; // don't drop folder into itself
                        const srcItem = customItems.find(i => i.id === sk);
                        if (srcItem) {
                            targetFolder.children.push({
                                id: 'child_' + Date.now() + '_' + Math.random().toString(36).slice(2),
                                type: srcItem.type, name: srcItem.name,
                                ...(srcItem.content   !== undefined && { content:   srcItem.content }),
                                ...(srcItem.children  !== undefined && { children:  srcItem.children }),
                                ...(srcItem.app       !== undefined && { app:       srcItem.app, icon: srcItem.icon }),
                            });
                            toRemove.push(sk);
                            si.remove();
                            delete w95Apps[sk];
                            delete positions[sk];
                        } else {
                            // Built-in icon: add shortcut only
                            const meta = SHORTCUTABLE_APPS.find(a => a.app === sk);
                            if (meta) {
                                targetFolder.children.push({
                                    id: 'child_' + Date.now() + '_' + Math.random().toString(36).slice(2),
                                    type: 'shortcut', name: meta.name, app: meta.app, icon: meta.icon,
                                });
                            }
                        }
                    });
                    window._desktopCustom?.saveItems(customItems.filter(i => !toRemove.includes(i.id)));
                    saveIconPositions(positions);
                    const openWin = window._openFolderWindows?.[tid];
                    if (openWin) { openWin.item.children = targetFolder.children; openWin.render(); }
                } else {
                    // Target folder gone — save current positions as a normal drag
                    const positions = getIconPositions();
                    document.querySelectorAll('.w95-desktop-icon.selected').forEach(si => {
                        const sk = si.dataset.app;
                        positions[sk] = { x: parseInt(si.style.left) || 0, y: parseInt(si.style.top) || 0 };
                    });
                    saveIconPositions(positions);
                }
            } else {
                // Normal free drag — save exact drop positions.
                // Manually dragging an icon turns off Auto Arrange (matches Windows XP behaviour).
                const prefs = getDesktopPrefs();
                if (prefs.autoArrange) {
                    prefs.autoArrange = false;
                    saveDesktopPrefs(prefs);
                    updateAutoArrangeLabel();
                }
                const positions = getIconPositions();
                document.querySelectorAll('.w95-desktop-icon.selected').forEach(si => {
                    const sk = si.dataset.app;
                    positions[sk] = { x: parseInt(si.style.left) || 0, y: parseInt(si.style.top) || 0 };
                });
                saveIconPositions(positions);
            }
        } else {
            // Plain click (no drag)
            if (!isCtrl && drag.wasSelectedOnDown) {
                clearIconSelection();
                drag.icon.classList.add('selected');
            }
            // Double-click: open app on second click within 500 ms
            const now = Date.now();
            if (clickTimes[drag.appKey] && now - clickTimes[drag.appKey] < 500) {
                openApp(drag.appKey);
                clickTimes[drag.appKey] = 0;
            } else {
                clickTimes[drag.appKey] = now;
            }
        }
    });

    function setupDesktopIcon(icon) {
        const appKey = icon.dataset.app;

        icon.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            e.stopPropagation();
            e.preventDefault(); // prevent browser native drag / text selection

            const isCtrl = e.ctrlKey || e.metaKey;
            const wasSelectedOnDown = icon.classList.contains('selected');

            if (isCtrl) {
                icon.classList.toggle('selected');
            } else if (!wasSelectedOnDown) {
                clearIconSelection();
                icon.classList.add('selected');
            }
            // If already selected without Ctrl: keep group selected for multi-drag.
            // Deselection of others deferred to mouseup if no drag occurs.

            // Snapshot start positions of every selected icon
            const dragStarts = {};
            document.querySelectorAll('.w95-desktop-icon.selected').forEach(si => {
                const sk = si.dataset.app;
                dragStarts[sk] = {
                    left: si.style.left ? parseInt(si.style.left) : (ICON_DEFAULTS[sk]?.x ?? GRID_OFFSET),
                    top:  si.style.top  ? parseInt(si.style.top)  : (ICON_DEFAULTS[sk]?.y ?? GRID_OFFSET),
                };
            });

            _drag = {
                icon, appKey, wasSelectedOnDown,
                startX: e.clientX, startY: e.clientY,
                didDrag: false, dragStarts, dropTarget: null,
            };
        });

        // Keyboard: Enter/Space to open
        icon.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openApp(appKey); }
        });
    }

    document.querySelectorAll('.w95-desktop-icon').forEach(setupDesktopIcon);

    // ===== Custom Desktop Items (New Folder / New Text Document) =====
    function getCustomItems() {
        try { return JSON.parse(localStorage.getItem('desktopCustomItems') || '[]'); } catch { return []; }
    }
    function saveCustomItems(items) {
        localStorage.setItem('desktopCustomItems', JSON.stringify(items));
    }
    function createCustomDesktopIcon(item) {
        const desktop = document.getElementById('w95-desktop');
        if (!desktop) return;
        const safeName = item.name.replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
        const el = document.createElement('div');
        el.className = 'w95-desktop-icon';
        el.dataset.app = item.id;
        el.tabIndex = 0;
        const iconEmoji = item.type === 'folder' ? '📁' : item.type === 'shortcut' ? item.icon : '📝';
        el.innerHTML = `<div class="desktop-icon-img">${iconEmoji}</div><div class="desktop-icon-label">${safeName}</div>`;
        if (item.type === 'folder') el.dataset.folder = '1';
        desktop.appendChild(el);
        applyIconPositions();
        w95Apps[item.id] = {
            open: () => {
                if (item.type === 'folder') {
                    openFolderWindow(item);
                } else if (item.type === 'shortcut') {
                    w95Apps[item.app]?.open();
                } else {
                    openW95Notepad(item);
                }
            }
        };
        setupDesktopIcon(el);
    }
    // Load any previously saved custom items
    getCustomItems().forEach(item => createCustomDesktopIcon(item));
    // Expose for context menu + rename/delete handlers
    window._desktopCustom = { getItems: getCustomItems, saveItems: saveCustomItems, createIcon: createCustomDesktopIcon };

    // ---- Desktop drag-select (rubber-band selection) ----
    const desktop = document.getElementById('w95-desktop');

    const selBox = document.createElement('div');
    selBox.id = 'desktop-selection-box';
    desktop.appendChild(selBox);

    let selActive = false;
    let selStartX = 0, selStartY = 0;
    let selDeskRect = null;

    function hitTestIcons(l, t, r, b) {
        document.querySelectorAll('.w95-desktop-icon').forEach(icon => {
            const ir = icon.getBoundingClientRect();
            const iL = ir.left - selDeskRect.left, iT = ir.top - selDeskRect.top;
            const iR = iL + ir.width,              iB = iT + ir.height;
            icon.classList.toggle('selected', !(iR < l || iL > r || iB < t || iT > b));
        });
    }

    function cancelDragSelect() {
        selActive = false;
        selBox.style.display = 'none';
    }

    // Pointerdown on empty desktop — icons use stopPropagation so won't bubble here
    document.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        if (e.target.closest('.w95-desktop-icon') || e.target.closest('.w95-window') || e.target.closest('#w95-taskbar')) return;
        clearIconSelection();
        selDeskRect  = desktop.getBoundingClientRect();
        selStartX    = e.clientX - selDeskRect.left;
        selStartY    = e.clientY - selDeskRect.top;
        selActive    = true;
        selBox.style.left    = selStartX + 'px';
        selBox.style.top     = selStartY + 'px';
        selBox.style.width   = '0';
        selBox.style.height  = '0';
        selBox.style.display = 'none';
    });

    document.addEventListener('pointermove', (e) => {
        if (!selActive) return;
        const curX = Math.max(0, Math.min(selDeskRect.width,  e.clientX - selDeskRect.left));
        const curY = Math.max(0, Math.min(selDeskRect.height, e.clientY - selDeskRect.top));
        if (Math.abs(curX - selStartX) > 3 || Math.abs(curY - selStartY) > 3) selBox.style.display = 'block';
        const l = Math.min(selStartX, curX), t = Math.min(selStartY, curY);
        const r = Math.max(selStartX, curX), b = Math.max(selStartY, curY);
        selBox.style.left   = l + 'px';      selBox.style.top    = t + 'px';
        selBox.style.width  = (r - l) + 'px'; selBox.style.height = (b - t) + 'px';
        hitTestIcons(l, t, r, b);
    });

    document.addEventListener('pointerup',     () => { if (selActive) cancelDragSelect(); });
    document.addEventListener('pointercancel', () => { if (selActive) { clearIconSelection(); cancelDragSelect(); } });

    // Escape: clear selection + cancel box
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { clearIconSelection(); cancelDragSelect(); }
    });
})();

// ===== Win95 Post Detail Window =====
(() => {
    const win     = document.getElementById('w95-win-post');
    const minBtn  = document.getElementById('w95-post-min');
    const maxBtn  = document.getElementById('w95-post-max');
    const closeBtn = document.getElementById('w95-post-close');
    const handle  = document.getElementById('w95-post-handle');
    const body    = document.getElementById('w95-post-body');
    const titleEl = document.getElementById('w95-post-title');
    if (!win) return;

    let btn = null;

    function showPostWin() {
        if (!btn) btn = w95Mgr.addTaskbarBtn('w95-win-post', 'POST', () => {
            if (win.classList.contains('is-hidden')) showPostWin(); else hidePostWin();
        });
        win.classList.remove('is-hidden');
        w95Mgr.focusWindow('w95-win-post');
    }

    function hidePostWin() {
        win.classList.add('is-hidden');
        if (w95Mgr.isActiveWin('w95-win-post')) w95Mgr.focusWindow(null);
    }

    function closePostWin() {
        if (w95Mgr.isMaximised('w95-win-post')) w95Mgr.toggleMaximise(win, 'w95-win-post');
        win.classList.add('is-hidden');
        if (w95Mgr.isActiveWin('w95-win-post')) w95Mgr.focusWindow(null);
        if (btn) { btn.remove(); btn = null; }
    }

    minBtn.addEventListener('click', (e) => { e.stopPropagation(); hidePostWin(); });
    if (maxBtn) maxBtn.addEventListener('click', (e) => { e.stopPropagation(); w95Mgr.toggleMaximise(win, 'w95-win-post'); });
    closeBtn.addEventListener('click', (e) => { e.stopPropagation(); closePostWin(); });

    let dragging = false, startX = 0, startY = 0, winStartX = 0, winStartY = 0;
    handle.addEventListener('mousedown', (e) => {
        if (e.target.closest('button')) return;
        if (w95Mgr.isMaximised('w95-win-post')) return;
        dragging = true;
        startX = e.clientX; startY = e.clientY;
        const r = win.getBoundingClientRect();
        winStartX = r.left; winStartY = r.top;
        e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        win.style.left = (winStartX + e.clientX - startX) + 'px';
        win.style.top  = (winStartY + e.clientY - startY) + 'px';
    });
    window.addEventListener('mouseup', () => { dragging = false; });

    w95Apps['post'] = {
        open: (postId) => {
            const post = postId ? { id: postId, ...allPosts[postId] } : null;
            if (!post || !allPosts[postId]) return;
            if (titleEl) titleEl.textContent = 'Post — ' + (post.author || 'Unknown');
            body.innerHTML = createPostCard(post);
            hydrateLinkPreviews(body);
            hydrateRichCards(body);
            hydrateYouTubeMeta(body);
            if (window.twttr?.widgets) window.twttr.widgets.load(body);
            if (window.instgrm?.Embeds) window.instgrm.Embeds.process();
            showPostWin();
        }
    };
})();

window.openPostWindow = function(postId) {
    w95Apps['post']?.open(postId);
};

// Bring any W95 window to front on mousedown and mark it active (single source of truth)
document.querySelectorAll('.w95-window').forEach(win => {
    win.addEventListener('mousedown', () => {
        w95Mgr.focusWindow(win.id);
    }, true);
});

// ===== Window open animation (C) =====
// Observes every .w95-window for removal of is-hidden → plays scale/fade-in.
// Respects prefers-reduced-motion.
(function() {
    const rmq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const obs = new MutationObserver(muts => {
        if (rmq.matches) return;
        muts.forEach(m => {
            if (m.attributeName !== 'class') return;
            const el = m.target;
            if (!el.classList.contains('w95-window')) return;
            const wasHidden = (m.oldValue || '').split(/\s+/).includes('is-hidden');
            const isVisible = !el.classList.contains('is-hidden');
            if (wasHidden && isVisible) {
                el.classList.remove('win-opening');
                void el.offsetWidth; // force reflow so animation restarts
                el.classList.add('win-opening');
                el.addEventListener('animationend', () => el.classList.remove('win-opening'), { once: true });
            }
        });
    });
    document.querySelectorAll('.w95-window').forEach(w => {
        obs.observe(w, { attributes: true, attributeOldValue: true });
    });
})();

// ===== Window layout restore + resize persistence =====
(function () {
    // 1. Restore saved size/position for every window on page load.
    //    Windows that were saved as maximised get their in-memory prevRect seeded
    //    so that maximise→restore returns to the right position.
    document.querySelectorAll('.w95-window').forEach(winEl => {
        const winId = winEl.id;
        if (!winId) return;
        const data = w95Layout.restore(winEl, winId);
        if (data && data.isMax) {
            w95Mgr.restoreMaxState(winId, data.prevRect || null);
            winEl.classList.add('is-maximised');
        }
    });

    // 2. Add custom resize handles to every window.
    document.querySelectorAll('.w95-window').forEach(winEl => {
        if (winEl.id) makeResizable(winEl, winEl.id);
    });

    // 3. ResizeObserver: debounce-save when the user drags a resize handle.
    if (typeof ResizeObserver !== 'undefined') {
        const _resizeTimers = {};
        const ro = new ResizeObserver(entries => {
            entries.forEach(entry => {
                const winEl = entry.target;
                const winId = winEl.id;
                if (!winId || w95Mgr.isMaximised(winId)) return;
                clearTimeout(_resizeTimers[winId]);
                _resizeTimers[winId] = setTimeout(() => w95Layout.save(winEl, winId), 300);
            });
        });
        document.querySelectorAll('.w95-window').forEach(winEl => ro.observe(winEl));
    }

    // 4. On viewport resize, push any off-screen windows back into view.
    let _vpResizeTimer;
    window.addEventListener('resize', () => {
        clearTimeout(_vpResizeTimer);
        _vpResizeTimer = setTimeout(() => {
            document.querySelectorAll('.w95-window:not(.is-hidden)').forEach(w95Layout.clamp);
        }, 150);
    });
})();

// ===== Recycle Bin =====
function applyRecycleBinIconState() {
    // Show all desktop icons first (except recycleBin itself which is never deleted)
    document.querySelectorAll('.w95-desktop-icon[data-app]').forEach(icon => {
        if (icon.dataset.app !== 'recycleBin') icon.classList.remove('is-hidden');
    });
    // Hide any icons currently in the recycle bin
    Object.values(allRecycleBin).forEach(item => {
        if (item.type === 'desktop-icon' && item.iconApp) {
            const iconEl = document.querySelector(`.w95-desktop-icon[data-app="${item.iconApp}"]`);
            if (iconEl) iconEl.classList.add('is-hidden');
        }
    });
}

window.restoreFromRecycleBin = async function(itemId) {
    if (itemId.startsWith('local_')) {
        const trash = getLocalTrash();
        const entry = trash[itemId];
        if (!entry?.customItem) return;
        const ci = entry.customItem;
        // Add back to desktopCustomItems and recreate the icon
        const existing = window._desktopCustom?.getItems() || [];
        if (!existing.find(i => i.id === ci.id)) {
            existing.push(ci);
            window._desktopCustom?.saveItems(existing);
            window._desktopCustom?.createIcon(ci);
        }
        delete trash[itemId];
        saveLocalTrash(trash);
        renderRecycleBin();
        showToast('Restored to desktop');
        return;
    }
    const item = allRecycleBin[itemId];
    if (!item) return;

    if (item.type === 'desktop-icon') {
        await remove(ref(database, `recycleBin/${itemId}`));
        showToast('Icon restored');
    } else if (item.type === 'comment') {
        const post = allPosts[item.postId];
        if (!post) {
            showToast('Cannot restore: parent post no longer exists');
            return;
        }
        const currentReplies = post.replies || [];
        const restoredReplies = [...currentReplies, ...(item.replies || [])];
        await update(ref(database, `posts/${item.postId}`), { replies: restoredReplies });
        await remove(ref(database, `recycleBin/${itemId}`));
        showToast('Comment restored');
    } else if (item.type === 'board') {
        await set(ref(database, `boards/${item.id}`), item.board);
        if (item.boardItems && Object.keys(item.boardItems).length > 0) {
            await set(ref(database, `board_items/${item.id}`), item.boardItems);
        }
        await remove(ref(database, `recycleBin/${itemId}`));
        showToast('Board restored');
    } else {
        await set(ref(database, `posts/${item.id || itemId}`), item.post);
        await remove(ref(database, `recycleBin/${itemId}`));
        showToast('Post restored');
    }
};

window.deleteFromRecycleBinPermanently = async function(itemId) {
    if (itemId.startsWith('local_')) {
        const trash = getLocalTrash();
        delete trash[itemId];
        saveLocalTrash(trash);
        renderRecycleBin();
        showToast('Permanently deleted');
        return;
    }
    await remove(ref(database, `recycleBin/${itemId}`));
    showToast('Permanently deleted');
};

// Local-storage trash for custom desktop items (text files, folders)
function getLocalTrash() {
    try { return JSON.parse(localStorage.getItem('desktopTrashItems') || '{}'); } catch { return {}; }
}
function saveLocalTrash(t) { localStorage.setItem('desktopTrashItems', JSON.stringify(t)); }
function addToLocalTrash(customItem) {
    const trash = getLocalTrash();
    trash['local_' + customItem.id] = { type: 'local-custom', customItem, deletedAt: Date.now() };
    saveLocalTrash(trash);
}

function getRecycleBinPreview(item) {
    if (item.type === 'local-custom') {
        return item.customItem?.name || '(file)';
    }
    if (item.type === 'desktop-icon') {
        return item.iconLabel || item.iconApp || 'Desktop icon';
    }
    if (item.type === 'comment') {
        const mainComment = item.replies && item.replies[0];
        return mainComment ? (mainComment.text || '').slice(0, 80) : '(comment)';
    }
    if (item.type === 'board') {
        return item.board ? (item.board.title || '(untitled board)') : '(board)';
    }
    const post = item.post;
    if (!post) return '(empty)';
    if (post.type === 'text') return (post.heading || post.body || '').slice(0, 80);
    if (post.type === 'link') return (post.note || post.url || '').slice(0, 80);
    if (post.type === 'poll') return (post.question || '').slice(0, 80);
    if (post.type === 'image') return (post.note || '[image]').slice(0, 80);
    if (post.type === 'recommendation') return (post.title || '').slice(0, 80);
    return (post.body || post.note || '').slice(0, 80) || '(post)';
}

function renderRecycleBin() {
    const list = document.getElementById('recycle-bin-list');
    if (!list) return;
    const allItems = { ...allRecycleBin, ...getLocalTrash() };
    const items = Object.entries(allItems).sort((a, b) => (b[1].deletedAt || 0) - (a[1].deletedAt || 0));
    if (items.length === 0) {
        list.innerHTML = '<div class="recycle-bin-empty">Recycle Bin is empty.</div>';
        return;
    }
    list.innerHTML = items.map(([id, item]) => {
        const preview = getRecycleBinPreview(item);
        const date = item.deletedAt ? new Date(item.deletedAt).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' }) : '?';
        const previewEscaped = preview.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        const typeLabel = item.type === 'local-custom'
            ? (item.customItem?.type === 'folder' ? 'Folder' : 'Text File')
            : item.type === 'comment' ? 'Comment' : item.type === 'board' ? 'Board' : item.type === 'desktop-icon' ? 'Desktop Icon' : 'Post';
        return `<div class="recycle-bin-item">
  <div class="recycle-bin-meta">${typeLabel} · Deleted ${date}</div>
  <div class="recycle-bin-preview">${previewEscaped || '(no preview)'}</div>
  <div class="recycle-bin-actions">
    <button class="w95-btn" onclick="restoreFromRecycleBin('${id}')">Restore</button>
    <button class="w95-btn recycle-bin-del-btn" onclick="deleteFromRecycleBinPermanently('${id}')">Delete Permanently</button>
  </div>
</div>`;
    }).join('');
}

(() => {
    const win = document.getElementById('w95-win-recycle');
    if (!win) return;

    const handle   = document.getElementById('w95-recycle-handle');
    const closeBtn = document.getElementById('w95-recycle-close');
    const minBtn   = document.getElementById('w95-recycle-min');
    const maxBtn   = document.getElementById('w95-recycle-max');

    let taskbarBtn = null;

    function show() {
        if (!taskbarBtn) taskbarBtn = w95Mgr.addTaskbarBtn('w95-win-recycle', 'RECYCLE BIN', () => {
            if (win.classList.contains('is-hidden')) show(); else hide();
        });
        win.classList.remove('is-hidden');
        w95Mgr.focusWindow('w95-win-recycle');
        renderRecycleBin();
    }

    function hide() {
        win.classList.add('is-hidden');
        if (w95Mgr.isActiveWin('w95-win-recycle')) w95Mgr.focusWindow(null);
    }

    function closeWin() {
        if (w95Mgr.isMaximised('w95-win-recycle')) w95Mgr.toggleMaximise(win, 'w95-win-recycle');
        win.classList.add('is-hidden');
        if (taskbarBtn) { taskbarBtn.remove(); taskbarBtn = null; }
    }

    if (minBtn)   minBtn.onclick   = (e) => { e.stopPropagation(); hide(); };
    if (maxBtn)   maxBtn.onclick   = (e) => { e.stopPropagation(); w95Mgr.toggleMaximise(win, 'w95-win-recycle'); };
    if (closeBtn) closeBtn.onclick = (e) => { e.stopPropagation(); closeWin(); };

    w95Apps['recycleBin'] = { open: () => {
        if (win.classList.contains('is-hidden')) show(); else w95Mgr.focusWindow('w95-win-recycle');
    }};

    // Drag
    let dragging = false, startX = 0, startY = 0, winStartX = 0, winStartY = 0;
    handle.addEventListener('mousedown', (e) => {
        if (e.target.closest('button')) return;
        if (w95Mgr.isMaximised('w95-win-recycle')) return;
        dragging = true;
        startX = e.clientX; startY = e.clientY;
        const r = win.getBoundingClientRect();
        winStartX = r.left; winStartY = r.top;
        e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        const taskbarH = 40;
        const maxX = document.documentElement.clientWidth - win.offsetWidth;
        const maxY = document.documentElement.clientHeight - win.offsetHeight - taskbarH;
        win.style.left = Math.max(0, Math.min(maxX, winStartX + (e.clientX - startX))) + 'px';
        win.style.top  = Math.max(0, Math.min(maxY, winStartY + (e.clientY - startY))) + 'px';
    });
    window.addEventListener('mouseup', () => { dragging = false; });
})();

// ===== Win95 Start Menu =====
(() => {
    const startBtn  = document.getElementById('w95-start-btn');
    const startMenu = document.getElementById('w95-start-menu');
    if (!startBtn || !startMenu) return;

    function openMenu() {
        startMenu.classList.remove('is-hidden');
        startBtn.classList.add('is-pressed');
    }

    function closeMenu() {
        startMenu.classList.add('is-hidden');
        startBtn.classList.remove('is-pressed');
    }

    startBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (startMenu.classList.contains('is-hidden')) openMenu(); else closeMenu();
    });

    startMenu.addEventListener('click', (e) => {
        const item = e.target.closest('[data-app]');
        if (!item) return;
        const app = w95Apps[item.dataset.app];
        if (app) app.open();
        closeMenu();
    });

    document.addEventListener('click', (e) => {
        if (!startMenu.classList.contains('is-hidden') &&
            !startMenu.contains(e.target) &&
            e.target !== startBtn) {
            closeMenu();
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeMenu();
    });
})();

// ===== Wallpaper: load from Firebase on login =====
async function loadUserWallpaper() {
    if (!currentUserUid) { applyWallpaper(DEFAULT_WALLPAPER_ID); return; }
    try {
        const snap = await get(ref(database, `users/${currentUserUid}/settings/wallpaper`));
        applyWallpaper(snap.exists() ? snap.val() : DEFAULT_WALLPAPER_ID);
    } catch (_) {
        applyWallpaper(DEFAULT_WALLPAPER_ID);
    }
}

// ===== Settings / Preferences Window =====
(() => {
    const WIN_ID    = 'w95-win-settings';
    const win       = document.getElementById(WIN_ID);
    const handle    = document.getElementById('w95-settings-handle');
    const closeBtn  = document.getElementById('w95-settings-close');
    const okBtn     = document.getElementById('settings-ok');
    const cancelBtn = document.getElementById('settings-cancel');
    const applyBtn  = document.getElementById('settings-apply');
    const grid      = document.getElementById('wallpaper-grid');
    const preview   = document.getElementById('wallpaper-preview');
    if (!win) return;

    // ---- State snapshot on open (for Cancel) ----
    let snap = {};

    function takeSnap() {
        snap = {
            wallpaper:    currentWallpaperId,
            darkMode:     isDarkMode,
            sunMode:      isSunMode,
            sound:        soundEnabled,
            masterVolume: soundMasterVolume,
            uiEffects:    soundUiEffects,
            startup:      soundStartup,
            ambience:     soundAmbience,
            sndChat:      sndChat,
            sndPost:      sndPost,
            sndMail:      sndMail,
            sndCat:       sndCat,
            sndGarden:    sndGarden,
            sndAch:       sndAch,
            sndConsole:   sndConsole,
            motion:       localStorage.getItem('motionEnabled') !== 'false',
            boot:         localStorage.getItem('bootEnabled') !== 'false',
            screensaver:         localStorage.getItem('screensaverEnabled') !== 'false',
            screensaverType:     localStorage.getItem('screensaverType') || 'starfield',
            screensaverIdleTime: localStorage.getItem('screensaverIdleTime') || '5',
        };
    }

    // ---- Tab switching ----
    let activeTab = 'appearance';
    function switchTab(tab) {
        activeTab = tab;
        win.querySelectorAll('.settings-tab-btn').forEach(btn => {
            const on = btn.dataset.tab === tab;
            btn.classList.toggle('is-active', on);
            btn.setAttribute('aria-selected', on ? 'true' : 'false');
        });
        win.querySelectorAll('.settings-panel').forEach(panel => {
            panel.classList.toggle('is-hidden', panel.id !== 'stab-' + tab);
        });
    }
    win.querySelectorAll('.settings-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    // ---- Wallpaper (Appearance tab) ----
    let wpSavedId   = DEFAULT_WALLPAPER_ID;
    let wpSelectedId = DEFAULT_WALLPAPER_ID;

    function renderWallpaperGrid() {
        if (!grid) return;
        grid.innerHTML = '';

        // ---- Base wallpapers (always available) ----
        WALLPAPERS.forEach(wp => {
            const sw = document.createElement('button');
            sw.className = 'wallpaper-swatch' + (wp.id === wpSelectedId ? ' selected' : '');
            sw.style.background = wp.css;
            sw.setAttribute('aria-label', wp.label);
            sw.setAttribute('title', wp.label);
            sw.type = 'button';
            const lbl = document.createElement('span');
            lbl.className = 'wallpaper-swatch-label';
            lbl.textContent = wp.label;
            sw.appendChild(lbl);
            sw.addEventListener('click', () => {
                wpSelectedId = wp.id;
                applyWallpaper(wpSelectedId, true);
                if (preview) preview.style.background = wp.css;
                grid.querySelectorAll('.wallpaper-swatch, .reward-item--wallpaper').forEach(s => s.classList.remove('selected'));
                sw.classList.add('selected');
            });
            grid.appendChild(sw);
        });

        // ---- Reward wallpapers ----
        const rewardWallpapers = getAllRewardsByType(REWARD_TYPE_WALLPAPER);
        if (rewardWallpapers.length > 0) {
            const sep = document.createElement('div');
            sep.className = 'unlock-section-label';
            sep.style.cssText = 'grid-column:1/-1;font:bold 10px Tahoma,Verdana,Arial,sans-serif;color:#000080;padding-bottom:2px;border-bottom:1px solid #c0c0c0;margin-top:4px;';
            sep.textContent = '🔓 Unlockable Wallpapers';
            grid.appendChild(sep);

            rewardWallpapers.forEach(rw => {
                const unlocked = isRewardUnlocked(rw.id);
                const isNew    = isRewardNew(rw.id);
                const sw = document.createElement('button');
                sw.type = 'button';
                sw.className = 'wallpaper-swatch reward-item--wallpaper' +
                    (rw.id === wpSelectedId ? ' selected' : '') +
                    (unlocked ? '' : ' reward-item--locked') +
                    (rw.animated ? ' wallpaper-swatch--animated' : '');
                sw.style.background = unlocked ? (rw.swatchCss || rw.css) : '';
                sw.setAttribute('aria-label', rw.name);
                sw.setAttribute('title', unlocked ? rw.name : `🔒 ${rw.name} — ${rw.description}`);
                sw.disabled = !unlocked;

                if (!unlocked) {
                    const lockIco = document.createElement('span');
                    lockIco.className = 'reward-lock-icon';
                    lockIco.textContent = '🔒';
                    sw.appendChild(lockIco);
                } else if (isNew) {
                    const badge = document.createElement('span');
                    badge.className = 'reward-item-new-badge';
                    badge.textContent = 'NEW';
                    sw.appendChild(badge);
                }

                const lbl = document.createElement('span');
                lbl.className = 'wallpaper-swatch-label';
                lbl.textContent = unlocked ? rw.name : '???';
                sw.appendChild(lbl);

                if (unlocked) {
                    sw.addEventListener('click', () => {
                        markRewardSeen(rw.id);
                        wpSelectedId = rw.id;
                        applyWallpaper(wpSelectedId, true);
                        if (preview) preview.style.background = rw.swatchCss || rw.css;
                        grid.querySelectorAll('.wallpaper-swatch, .reward-item--wallpaper').forEach(s => s.classList.remove('selected'));
                        sw.classList.add('selected');
                        // Remove NEW badge now that it's been seen
                        sw.querySelector('.reward-item-new-badge')?.remove();
                    });
                }
                grid.appendChild(sw);
            });
        }
    }

    // ---- Render unlockable screensavers in the Screensaver tab ----
    function renderRewardScreensavers() {
        const picker = document.getElementById('ss-picker');
        if (!picker) return;
        // Remove any previously injected reward cards
        picker.querySelectorAll('.ss-picker-card--reward').forEach(c => c.remove());

        getAllRewardsByType(REWARD_TYPE_SCREENSAVER).forEach(rs => {
            const unlocked = isRewardUnlocked(rs.id);
            const isNew    = isRewardNew(rs.id);
            const card = document.createElement('label');
            card.className = 'ss-picker-card ss-picker-card--reward' +
                (unlocked ? '' : ' ss-picker-card--locked');
            card.title = unlocked ? rs.name : `🔒 ${rs.name} — ${rs.description}`;

            const radio = document.createElement('input');
            radio.type = 'radio';
            radio.name = 'ss-type';
            radio.value = rs.id;
            radio.disabled = !unlocked;
            const ssType = localStorage.getItem('screensaverType') || 'starfield';
            radio.checked = unlocked && ssType === rs.id;

            const thumb = document.createElement('div');
            thumb.className = 'ss-picker-thumb';
            if (unlocked && rs.swatchCss) {
                thumb.style.background = rs.swatchCss;
            } else {
                thumb.style.background = 'repeating-linear-gradient(45deg,#c0c0c0 0px,#c0c0c0 3px,#a0a0a0 3px,#a0a0a0 6px)';
                const lockSpan = document.createElement('span');
                lockSpan.style.cssText = 'font-size:18px;display:flex;align-items:center;justify-content:center;height:100%;';
                lockSpan.textContent = '🔒';
                thumb.appendChild(lockSpan);
            }

            const nameEl = document.createElement('span');
            nameEl.className = 'ss-picker-name';
            nameEl.textContent = unlocked ? rs.name : '???';

            card.appendChild(radio);
            card.appendChild(thumb);
            card.appendChild(nameEl);

            if (unlocked && isNew) {
                const badge = document.createElement('span');
                badge.className = 'reward-item-new-badge';
                badge.style.cssText = 'position:absolute;top:2px;right:2px;';
                badge.textContent = 'NEW';
                card.style.position = 'relative';
                card.appendChild(badge);
            }

            if (unlocked) {
                radio.addEventListener('change', () => {
                    if (radio.checked) {
                        localStorage.setItem('screensaverType', rs.id);
                        markRewardSeen(rs.id);
                        card.querySelector('.reward-item-new-badge')?.remove();
                    }
                });
            }
            picker.appendChild(card);
        });
    }

    // ---- Render reward sound packs in the Sound tab ----
    function renderRewardSoundPacks() {
        const container = document.getElementById('settings-sndpacks');
        if (!container) return;
        container.innerHTML = '';
        const packs = getAllRewardsByType(REWARD_TYPE_SOUND_PACK);
        if (packs.length === 0) return;

        const activePack = localStorage.getItem('activeSoundPack') || '';

        packs.forEach(sp => {
            const unlocked = isRewardUnlocked(sp.id);
            const isNew    = isRewardNew(sp.id);
            const item = document.createElement('div');
            item.className = 'sndpack-item' +
                (unlocked ? '' : ' sndpack-item--locked') +
                (activePack === sp.id ? ' selected' : '');
            item.title = unlocked ? sp.description : `🔒 ${sp.name} — ${sp.description}`;

            const iconEl = document.createElement('span');
            iconEl.className = 'sndpack-item-icon';
            iconEl.textContent = unlocked ? sp.icon : '🔒';

            const infoEl = document.createElement('div');
            infoEl.className = 'sndpack-item-info';
            const nameEl = document.createElement('div');
            nameEl.className = 'sndpack-item-name';
            nameEl.textContent = unlocked ? sp.name : '??? (locked)';
            const descEl = document.createElement('div');
            descEl.className = 'sndpack-item-desc';
            descEl.textContent = unlocked ? sp.description : 'Earn an achievement to unlock';
            infoEl.appendChild(nameEl);
            infoEl.appendChild(descEl);

            item.appendChild(iconEl);
            item.appendChild(infoEl);

            if (unlocked && isNew) {
                const badge = document.createElement('span');
                badge.className = 'sndpack-item-badge sndpack-item-badge--new';
                badge.textContent = 'NEW';
                item.appendChild(badge);
            } else if (!unlocked) {
                const badge = document.createElement('span');
                badge.className = 'sndpack-item-badge sndpack-item-badge--lock';
                badge.textContent = '🔒';
                item.appendChild(badge);
            }

            if (unlocked) {
                item.addEventListener('click', () => {
                    markRewardSeen(sp.id);
                    localStorage.setItem('activeSoundPack', activePack === sp.id ? '' : sp.id);
                    renderRewardSoundPacks(); // re-render to update selection
                });
            }
            container.appendChild(item);
        });
    }

    // ---- Render reward desktop themes in the Appearance tab ----
    function renderRewardThemes() {
        const container = document.getElementById('settings-themes');
        if (!container) return;
        container.innerHTML = '';
        const themes = getAllRewardsByType(REWARD_TYPE_DESKTOP_THEME);
        if (themes.length === 0) return;

        const activeTheme = localStorage.getItem('activeDesktopTheme') || '';

        themes.forEach(th => {
            const unlocked = isRewardUnlocked(th.id);
            const isNew    = isRewardNew(th.id);
            const item = document.createElement('div');
            item.className = 'theme-item' +
                (unlocked ? '' : ' theme-item--locked') +
                (activeTheme === th.id ? ' selected' : '');
            item.title = unlocked ? th.description : `🔒 ${th.name} — ${th.description}`;

            const swatchEl = document.createElement('div');
            swatchEl.className = 'theme-item-swatch';
            if (unlocked && th.swatchCss) {
                swatchEl.style.background = th.swatchCss;
            } else {
                swatchEl.style.background = 'repeating-linear-gradient(45deg,#c0c0c0 0px,#c0c0c0 3px,#a0a0a0 3px,#a0a0a0 6px)';
            }

            const infoEl = document.createElement('div');
            infoEl.className = 'theme-item-info';
            const nameEl = document.createElement('div');
            nameEl.className = 'theme-item-name';
            nameEl.textContent = unlocked ? (th.icon + ' ' + th.name) : '??? (locked)';
            const descEl = document.createElement('div');
            descEl.className = 'theme-item-desc';
            descEl.textContent = unlocked ? th.description : 'Earn an achievement to unlock';
            infoEl.appendChild(nameEl);
            infoEl.appendChild(descEl);

            item.appendChild(swatchEl);
            item.appendChild(infoEl);

            if (unlocked && isNew) {
                const badge = document.createElement('span');
                badge.className = 'theme-item-badge theme-item-badge--new';
                badge.textContent = 'NEW';
                item.appendChild(badge);
            } else if (!unlocked) {
                const badge = document.createElement('span');
                badge.className = 'theme-item-badge theme-item-badge--lock';
                badge.textContent = '🔒';
                item.appendChild(badge);
            }

            if (unlocked) {
                item.addEventListener('click', () => {
                    markRewardSeen(th.id);
                    const newActive = activeTheme === th.id ? '' : th.id;
                    localStorage.setItem('activeDesktopTheme', newActive);
                    applyDesktopTheme(newActive, true);
                    renderRewardThemes();
                });
            }
            container.appendChild(item);
        });
    }

    // ---- Appearance tab ----
    const darkModeChk = document.getElementById('settings-darkmode-chk');
    const sunModeChk  = document.getElementById('settings-sunmode-chk');

    if (darkModeChk) {
        darkModeChk.addEventListener('change', () => {
            if (darkModeChk.checked !== isDarkMode) toggleDarkMode();
        });
    }

    if (sunModeChk) {
        sunModeChk.addEventListener('change', () => {
            if (sunModeChk.checked) {
                enableSunMode();
                if (darkModeChk) darkModeChk.disabled = true;
            } else {
                stopSunMode();
                if (darkModeChk) {
                    darkModeChk.disabled = false;
                    darkModeChk.checked  = isDarkMode;
                }
            }
        });
    }

    // ---- Sound tab ----
    const muteChk    = document.getElementById('settings-mute-chk');
    const volSlider  = document.getElementById('settings-vol-slider');
    const volPct     = document.getElementById('settings-vol-pct');
    const sndUiChk   = document.getElementById('settings-snd-ui');
    const sndStrtChk = document.getElementById('settings-snd-startup');
    const sndAmbiChk = document.getElementById('settings-snd-ambience');
    const sndChatChk = document.getElementById('settings-snd-chat');
    const sndPostChk = document.getElementById('settings-snd-post');
    const sndMailChk = document.getElementById('settings-snd-mail');
    const sndCatChk  = document.getElementById('settings-snd-cat');
    const sndGardChk = document.getElementById('settings-snd-garden');
    const sndAchChk  = document.getElementById('settings-snd-ach');
    const sndConChk  = document.getElementById('settings-snd-console');

    if (muteChk) {
        muteChk.addEventListener('change', () => {
            soundEnabled = !muteChk.checked;
            localStorage.setItem('soundEnabled', soundEnabled ? 'true' : 'false');
            const traySound = document.getElementById('tray-sound');
            if (traySound) {
                traySound.textContent = soundEnabled ? '\uD83D\uDD0A' : '\uD83D\uDD07';
                traySound.title       = soundEnabled ? 'Sound: on (click to mute)' : 'Sound: muted (click to unmute)';
                traySound.classList.toggle('tray-muted', !soundEnabled);
            }
            if (soundEnabled && soundAmbience) startAmbience(); else stopAmbience();
        });
    }

    if (volSlider && volPct) {
        volSlider.addEventListener('input', () => {
            soundMasterVolume = parseInt(volSlider.value, 10) / 100;
            localStorage.setItem('soundMasterVolume', String(soundMasterVolume));
            volPct.textContent = volSlider.value + '%';
            if (_masterGain) _masterGain.gain.value = soundMasterVolume;
        });
    }

    function _mkSndToggle(el, getter, setter, lsKey) {
        if (!el) return;
        el.addEventListener('change', () => {
            const on = el.checked;
            setter(on);
            localStorage.setItem(lsKey, on ? 'true' : 'false');
        });
    }

    _mkSndToggle(sndUiChk,   () => soundUiEffects, v => { soundUiEffects = v; }, 'soundUiEffects');
    _mkSndToggle(sndStrtChk, () => soundStartup,   v => { soundStartup   = v; }, 'soundStartup');
    _mkSndToggle(sndAmbiChk, () => soundAmbience,  v => { soundAmbience  = v; if (v && soundEnabled) startAmbience(); else stopAmbience(); }, 'soundAmbience');
    _mkSndToggle(sndChatChk, () => sndChat,        v => { sndChat    = v; }, 'snd_chat');
    _mkSndToggle(sndPostChk, () => sndPost,        v => { sndPost    = v; }, 'snd_post');
    _mkSndToggle(sndMailChk, () => sndMail,        v => { sndMail    = v; }, 'snd_mail');
    _mkSndToggle(sndCatChk,  () => sndCat,         v => { sndCat     = v; }, 'snd_cat');
    _mkSndToggle(sndGardChk, () => sndGarden,      v => { sndGarden  = v; }, 'snd_garden');
    _mkSndToggle(sndAchChk,  () => sndAch,         v => { sndAch     = v; }, 'snd_ach');
    _mkSndToggle(sndConChk,  () => sndConsole,     v => { sndConsole = v; }, 'snd_console');

    // ---- Desktop tab ----
    const motionChk     = document.getElementById('settings-motion-chk');
    const bootChk       = document.getElementById('settings-boot-chk');
    const screensaverChk = document.getElementById('settings-screensaver-chk');
    const ssIdleSel      = document.getElementById('settings-ss-idle');

    if (motionChk) {
        motionChk.addEventListener('change', () => {
            const on = motionChk.checked;
            localStorage.setItem('motionEnabled', on ? 'true' : 'false');
            window._motionEnabled = on;
            const trayMotion = document.getElementById('tray-motion');
            if (trayMotion) {
                trayMotion.textContent = on ? '\u2728' : '\u2B55';
                trayMotion.title       = on ? 'Motion: on (click to reduce)' : 'Motion: reduced (click to enable)';
                trayMotion.classList.toggle('tray-muted', !on);
            }
        });
    }
    if (bootChk) {
        bootChk.addEventListener('change', () => {
            localStorage.setItem('bootEnabled', bootChk.checked ? 'true' : 'false');
        });
    }
    if (screensaverChk) {
        screensaverChk.addEventListener('change', () => {
            const on = screensaverChk.checked;
            localStorage.setItem('screensaverEnabled', on ? 'true' : 'false');
            if (on) {
                window._screensaverCtrl?.reset();
            } else {
                window._screensaverCtrl?.disable();
            }
        });
    }

    // Screensaver type picker
    win.querySelectorAll('input[name="ss-type"]').forEach(radio => {
        radio.addEventListener('change', () => {
            if (radio.checked) localStorage.setItem('screensaverType', radio.value);
        });
    });

    // Screensaver idle time
    if (ssIdleSel) {
        ssIdleSel.addEventListener('change', () => {
            localStorage.setItem('screensaverIdleTime', ssIdleSel.value);
            window._screensaverCtrl?.reset();
        });
    }

    // ---- Populate controls on open ----
    function populateControls() {
        wpSavedId    = currentWallpaperId;
        wpSelectedId = currentWallpaperId;
        const cur = WALLPAPERS.find(w => w.id === wpSelectedId)
            || REWARD_REGISTRY.find(r => r.id === wpSelectedId)
            || WALLPAPERS[0];
        if (preview) preview.style.background = cur.css || cur.swatchCss || '';
        renderWallpaperGrid();
        renderRewardThemes();
        renderRewardSoundPacks();
        renderRewardScreensavers();

        if (darkModeChk) {
            darkModeChk.checked  = isDarkMode;
            darkModeChk.disabled = isSunMode;
        }
        if (sunModeChk)     sunModeChk.checked     = isSunMode;

        if (muteChk)        muteChk.checked        = !soundEnabled;
        if (volSlider) {
            const pct = Math.round(soundMasterVolume * 100);
            volSlider.value = pct;
            if (volPct) volPct.textContent = pct + '%';
        }
        if (sndUiChk)   sndUiChk.checked   = soundUiEffects;
        if (sndStrtChk) sndStrtChk.checked = soundStartup;
        if (sndAmbiChk) sndAmbiChk.checked = soundAmbience;
        if (sndChatChk) sndChatChk.checked = sndChat;
        if (sndPostChk) sndPostChk.checked = sndPost;
        if (sndMailChk) sndMailChk.checked = sndMail;
        if (sndCatChk)  sndCatChk.checked  = sndCat;
        if (sndGardChk) sndGardChk.checked = sndGarden;
        if (sndAchChk)  sndAchChk.checked  = sndAch;
        if (sndConChk)  sndConChk.checked  = sndConsole;

        if (motionChk)      motionChk.checked      = localStorage.getItem('motionEnabled') !== 'false';
        if (bootChk)        bootChk.checked        = localStorage.getItem('bootEnabled') !== 'false';
        if (screensaverChk) screensaverChk.checked = localStorage.getItem('screensaverEnabled') !== 'false';
        if (ssIdleSel) ssIdleSel.value = localStorage.getItem('screensaverIdleTime') || '5';

        const ssType = localStorage.getItem('screensaverType') || 'starfield';
        win.querySelectorAll('input[name="ss-type"]').forEach(r => { r.checked = r.value === ssType; });

        // About tab: show current user
        const userSpan = document.getElementById('settings-about-user');
        if (userSpan) userSpan.textContent = (typeof currentUser !== 'undefined' && currentUser) ? currentUser : 'Not signed in';
    }

    // ---- Auto-refresh settings when a new reward unlocks ----
    document.addEventListener('rewardUnlocked', (e) => {
        if (win.classList.contains('is-hidden')) return;
        const type = e.detail?.reward?.type;
        if (type === REWARD_TYPE_WALLPAPER)    renderWallpaperGrid();
        if (type === REWARD_TYPE_SCREENSAVER)  renderRewardScreensavers();
        if (type === REWARD_TYPE_SOUND_PACK)   renderRewardSoundPacks();
        if (type === REWARD_TYPE_DESKTOP_THEME) renderRewardThemes();
    });

    // ---- Apply / save ----
    async function applySettings() {
        // Wallpaper — save to Firebase
        if (currentWallpaperId !== wpSavedId) {
            if (currentUserUid) {
                try {
                    await set(ref(database, `users/${currentUserUid}/settings/wallpaper`), currentWallpaperId);
                } catch (_) { /* best-effort */ }
            }
            unlockAchievement('first_wallpaper_change');
            wpSavedId = currentWallpaperId;
        }
        // Other settings are already in localStorage via their change handlers
    }

    // ---- Cancel / revert ----
    function revertSettings() {
        applyWallpaper(snap.wallpaper);

        if (snap.sunMode !== isSunMode) {
            if (snap.sunMode) enableSunMode(); else stopSunMode();
            if (sunModeChk)  sunModeChk.checked = snap.sunMode;
            if (darkModeChk) darkModeChk.disabled = snap.sunMode;
        }
        if (!isSunMode && snap.darkMode !== isDarkMode) toggleDarkMode();

        soundEnabled = snap.sound;
        localStorage.setItem('soundEnabled', soundEnabled ? 'true' : 'false');
        const traySound = document.getElementById('tray-sound');
        if (traySound) {
            traySound.textContent = soundEnabled ? '\uD83D\uDD0A' : '\uD83D\uDD07';
            traySound.title       = soundEnabled ? 'Sound: on (click to mute)' : 'Sound: muted (click to unmute)';
            traySound.classList.toggle('tray-muted', !soundEnabled);
        }

        soundMasterVolume = snap.masterVolume;
        localStorage.setItem('soundMasterVolume', String(soundMasterVolume));
        if (_masterGain) _masterGain.gain.value = soundMasterVolume;

        soundUiEffects = snap.uiEffects;  localStorage.setItem('soundUiEffects', soundUiEffects ? 'true' : 'false');
        soundStartup   = snap.startup;    localStorage.setItem('soundStartup',   soundStartup   ? 'true' : 'false');
        soundAmbience  = snap.ambience;   localStorage.setItem('soundAmbience',  soundAmbience  ? 'true' : 'false');
        if (soundEnabled && soundAmbience) startAmbience(); else stopAmbience();
        sndChat    = snap.sndChat;    localStorage.setItem('snd_chat',    sndChat    ? 'true' : 'false');
        sndPost    = snap.sndPost;    localStorage.setItem('snd_post',    sndPost    ? 'true' : 'false');
        sndMail    = snap.sndMail;    localStorage.setItem('snd_mail',    sndMail    ? 'true' : 'false');
        sndCat     = snap.sndCat;     localStorage.setItem('snd_cat',     sndCat     ? 'true' : 'false');
        sndGarden  = snap.sndGarden;  localStorage.setItem('snd_garden',  sndGarden  ? 'true' : 'false');
        sndAch     = snap.sndAch;     localStorage.setItem('snd_ach',     sndAch     ? 'true' : 'false');
        sndConsole = snap.sndConsole; localStorage.setItem('snd_console', sndConsole ? 'true' : 'false');

        localStorage.setItem('motionEnabled', snap.motion ? 'true' : 'false');
        window._motionEnabled = snap.motion;
        const trayMotion = document.getElementById('tray-motion');
        if (trayMotion) {
            trayMotion.textContent = snap.motion ? '\u2728' : '\u2B55';
            trayMotion.title       = snap.motion ? 'Motion: on (click to reduce)' : 'Motion: reduced (click to enable)';
            trayMotion.classList.toggle('tray-muted', !snap.motion);
        }

        localStorage.setItem('bootEnabled', snap.boot ? 'true' : 'false');

        localStorage.setItem('screensaverEnabled', snap.screensaver ? 'true' : 'false');
        if (snap.screensaver) window._screensaverCtrl?.reset(); else window._screensaverCtrl?.disable();

        localStorage.setItem('screensaverType', snap.screensaverType);
        win.querySelectorAll('input[name="ss-type"]').forEach(r => { r.checked = r.value === snap.screensaverType; });

        localStorage.setItem('screensaverIdleTime', snap.screensaverIdleTime);
        if (ssIdleSel) ssIdleSel.value = snap.screensaverIdleTime;
        window._screensaverCtrl?.reset();
    }

    // ---- Show / hide ----
    function show(tab) {
        const _wasHiddenSettings = win.classList.contains('is-hidden');
        takeSnap();
        populateControls();
        if (tab) switchTab(tab); else switchTab(activeTab);
        win.classList.remove('is-hidden');
        w95Mgr.focusWindow(WIN_ID);
        if (_wasHiddenSettings) _trackWindowOpen('settings');
    }

    function hide() {
        win.classList.add('is-hidden');
        if (w95Mgr.isActiveWin(WIN_ID)) w95Mgr.focusWindow(null);
    }

    // ---- Button handlers ----
    closeBtn.addEventListener('click', e => { e.stopPropagation(); revertSettings(); hide(); });
    cancelBtn.addEventListener('click', () => { revertSettings(); hide(); });
    okBtn.addEventListener('click', async () => { await applySettings(); hide(); });
    applyBtn.addEventListener('click', async () => { await applySettings(); takeSnap(); });

    // ---- Dragging ----
    makeDraggable(win, handle, WIN_ID);

    // ---- Register apps ----
    w95Apps['settings'] = { open: () => {
        if (win.classList.contains('is-hidden')) show(); else w95Mgr.focusWindow(WIN_ID);
    }};
    // Backward-compat: anything that opens 'wallpaper' now opens Settings > Appearance
    w95Apps['wallpaper'] = { open: () => {
        if (win.classList.contains('is-hidden')) show('appearance'); else { switchTab('appearance'); w95Mgr.focusWindow(WIN_ID); }
    }};
})();

// ===== Win95 Cat Window =====
(() => {
    const win      = document.getElementById('w95-win-cat');
    const minBtn   = document.getElementById('w95-cat-min');
    const maxBtn   = document.getElementById('w95-cat-max');
    const closeBtn = document.getElementById('w95-cat-close');
    const handle   = document.getElementById('w95-cat-handle');
    if (!win || !minBtn || !closeBtn || !handle) return;

    let btn = null;
    let _catStats      = null; // { hunger, thirst, play, catName, lastUpdated }
    let _lastActionText = '';
    let _lastActionTimer = null;

    // ---- Activity log (local-only, up to 8 recent entries) ----
    const _CAT_LOG_MAX = 8;
    const _catActivityLog = [];
    function _addCatLog(msg) {
        const d = new Date();
        const ts = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
        _catActivityLog.unshift(ts + ' ' + msg);
        if (_catActivityLog.length > _CAT_LOG_MAX) _catActivityLog.length = _CAT_LOG_MAX;
        _renderCatLog();
    }
    function _renderCatLog() {
        const el = document.getElementById('cat-activity-log');
        if (!el) return;
        el.innerHTML = '';
        _catActivityLog.forEach((entry, i) => {
            const span = document.createElement('span');
            span.className = 'cat-log-entry';
            span.textContent = entry;
            span.style.opacity = i === 0 ? '1' : String(Math.max(0.3, 1 - i * 0.13));
            el.appendChild(span);
        });
    }
    // Expose so the pixel cat driver (initPixelCat) can log state transitions
    window._catLog = _addCatLog;

    const CAT_DECAY_PER_HOUR  = 3;
    const CAT_ACTION_DELTAS   = { feed: 25, water: 25, yarn: 35 };
    const CAT_ACTION_STAT     = { feed: 'hunger', water: 'thirst', yarn: 'play' };
    const CAT_DEFAULTS        = { catName: '', hunger: 75, thirst: 75, play: 75 };

    function applyCatDecay(stored) {
        const hoursElapsed = (Date.now() - (stored.lastUpdated || Date.now())) / 3_600_000;
        const d = hoursElapsed * CAT_DECAY_PER_HOUR;
        return {
            hunger: Math.max(0, Math.min(100, (stored.hunger ?? 75) - d)),
            thirst: Math.max(0, Math.min(100, (stored.thirst ?? 75) - d)),
            play:   Math.max(0, Math.min(100, (stored.play   ?? 75) - d)),
        };
    }

    function showCat() {
        const _wasHiddenCat = win.classList.contains('is-hidden');
        initPixelCat(); // ensure mascot helpers (_catLocalEmote etc.) are ready
        if (!btn) btn = w95Mgr.addTaskbarBtn('w95-win-cat', 'CAT', () => {
            if (win.classList.contains('is-hidden')) showCat(); else hideCat();
        });
        win.classList.remove('is-hidden');
        w95Mgr.focusWindow('w95-win-cat');
        localStorage.setItem('w95_cat_open', '1');
        loadCatStats();
        renderCatAccessories();
        renderCatBehaviours();
        // Desktop cat notices Cat.exe being opened and walks toward it
        window._catController?.onCatOpen();
        if (_wasHiddenCat) _trackWindowOpen('cat');
    }

    function hideCat() {
        win.classList.add('is-hidden');
        if (w95Mgr.isActiveWin('w95-win-cat')) w95Mgr.focusWindow(null);
        localStorage.setItem('w95_cat_open', '0');
    }

    function closeCat() {
        if (w95Mgr.isMaximised('w95-win-cat')) w95Mgr.toggleMaximise(win, 'w95-win-cat');
        hideCat();
        if (btn) { btn.remove(); btn = null; }
    }

    minBtn.addEventListener('click', (e) => { e.stopPropagation(); hideCat(); });
    if (maxBtn) maxBtn.addEventListener('click', (e) => { e.stopPropagation(); w95Mgr.toggleMaximise(win, 'w95-win-cat'); });
    closeBtn.addEventListener('click', (e) => { e.stopPropagation(); closeCat(); });

    // ---- Drag ----
    let dragging = false, startX = 0, startY = 0, winStartX = 0, winStartY = 0;
    handle.addEventListener('mousedown', (e) => {
        if (e.target.closest('button')) return;
        if (w95Mgr.isMaximised('w95-win-cat')) return;
        dragging = true;
        startX = e.clientX; startY = e.clientY;
        const r = win.getBoundingClientRect();
        winStartX = r.left; winStartY = r.top;
        e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        const taskbarH = 40;
        const maxX = document.documentElement.clientWidth  - win.offsetWidth;
        const maxY = document.documentElement.clientHeight - win.offsetHeight - taskbarH;
        win.style.left = Math.max(0, Math.min(maxX, winStartX + (e.clientX - startX))) + 'px';
        win.style.top  = Math.max(0, Math.min(maxY, winStartY + (e.clientY - startY))) + 'px';
    });
    window.addEventListener('mouseup', () => { dragging = false; });

    // ---- Display helpers ----
    function catDisplayName() {
        return (_catStats?.catName || '').trim() || 'the cat';
    }

    function getEquippedAccessory() {
        const id = localStorage.getItem('catEquippedAccessory') || '';
        if (!id || !isRewardUnlocked(id)) return null;
        return REWARD_REGISTRY.find(r => r.id === id && r.type === REWARD_TYPE_CAT_ACCESSORY) || null;
    }

    function getCatFace(s) {
        const acc = getEquippedAccessory();
        let face;
        if (!s) face = '=^.^=';
        else if (s.hunger < 20) face = '=^;_;^=';
        else if (s.thirst < 20) face = '=^-.-^=';
        else if (s.play   < 20) face = '=^_.^= z';
        else if (s.hunger < 40 || s.thirst < 40 || s.play < 40) face = '=^~.~^=';
        else if (Math.min(s.hunger, s.thirst, s.play) > 75) face = window._anyoneNowPlaying ? '=^o^= \u266a' : '=^o^= \u2661';
        else face = '=^-^=';
        if (!acc) return face;
        if (acc.placement === 'eye')  return face.replace(/\^[^^]*\^/, '^8^');
        if (acc.placement === 'neck') return face + '\n' + acc.faceDecor;
        return face + ' ' + acc.faceDecor;
    }

    // ---- Render accessories panel ----
    function renderCatAccessories() {
        const grid = document.getElementById('cat-accessories-grid');
        if (!grid) return;
        grid.innerHTML = '';
        const equipped = localStorage.getItem('catEquippedAccessory') || '';
        getAllRewardsByType(REWARD_TYPE_CAT_ACCESSORY).forEach(acc => {
            const unlocked = isRewardUnlocked(acc.id);
            const isNew    = isRewardNew(acc.id);
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'cat-unlock-item' +
                (unlocked ? '' : ' cat-unlock-item--locked') +
                (equipped === acc.id ? ' active' : '');
            item.title = unlocked
                ? (equipped === acc.id ? 'Click to remove ' + acc.name : 'Click to equip ' + acc.name)
                : '🔒 ' + acc.name + ' — ' + acc.description;
            item.disabled = !unlocked;

            const iconEl = document.createElement('span');
            iconEl.className = 'cat-unlock-item-icon';
            iconEl.textContent = unlocked ? acc.icon : '🔒';
            item.appendChild(iconEl);

            const nameEl = document.createElement('span');
            nameEl.textContent = unlocked ? acc.name : '???';
            item.appendChild(nameEl);

            if (unlocked && isNew) {
                const badge = document.createElement('span');
                badge.className = 'cat-unlock-item-badge cat-unlock-item-badge--new';
                badge.textContent = 'NEW';
                item.appendChild(badge);
            }

            if (unlocked) {
                item.addEventListener('click', () => {
                    markRewardSeen(acc.id);
                    const cur = localStorage.getItem('catEquippedAccessory');
                    localStorage.setItem('catEquippedAccessory', cur === acc.id ? '' : acc.id);
                    renderCatAccessories();
                    // Update face display with new accessory
                    const faceEl = document.getElementById('cat-face');
                    if (faceEl) faceEl.textContent = getCatFace(_catStats);
                    if (window._catUpdateAccessoryOverlay) window._catUpdateAccessoryOverlay();
                });
            }
            grid.appendChild(item);
        });
    }

    // ---- Render behaviours panel ----
    function renderCatBehaviours() {
        const grid = document.getElementById('cat-behaviours-grid');
        if (!grid) return;
        grid.innerHTML = '';
        const activeBehaviours = JSON.parse(localStorage.getItem('catActiveBehaviours') || '[]');
        getAllRewardsByType(REWARD_TYPE_CAT_BEHAVIOUR).forEach(beh => {
            const unlocked = isRewardUnlocked(beh.id);
            const isNew    = isRewardNew(beh.id);
            const isActive = activeBehaviours.includes(beh.id);
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'cat-unlock-item' +
                (unlocked ? '' : ' cat-unlock-item--locked') +
                (isActive ? ' active' : '');
            item.title = unlocked
                ? (isActive ? 'Click to disable ' + beh.name : 'Click to enable ' + beh.name)
                : '🔒 ' + beh.name + ' — ' + beh.description;
            item.disabled = !unlocked;

            const iconEl = document.createElement('span');
            iconEl.className = 'cat-unlock-item-icon';
            iconEl.textContent = unlocked ? beh.icon : '🔒';
            item.appendChild(iconEl);

            const nameEl = document.createElement('span');
            nameEl.textContent = unlocked ? beh.name : '???';
            item.appendChild(nameEl);

            if (unlocked && isNew) {
                const badge = document.createElement('span');
                badge.className = 'cat-unlock-item-badge cat-unlock-item-badge--new';
                badge.textContent = 'NEW';
                item.appendChild(badge);
            } else if (unlocked && isActive) {
                const badge = document.createElement('span');
                badge.className = 'cat-unlock-item-badge';
                badge.style.cssText = 'background:#008000;color:#fff;';
                badge.textContent = 'ON';
                item.appendChild(badge);
            }

            if (unlocked) {
                item.addEventListener('click', () => {
                    markRewardSeen(beh.id);
                    const cur = JSON.parse(localStorage.getItem('catActiveBehaviours') || '[]');
                    const updated = cur.includes(beh.id)
                        ? cur.filter(b => b !== beh.id)
                        : [...cur, beh.id];
                    localStorage.setItem('catActiveBehaviours', JSON.stringify(updated));
                    renderCatBehaviours();
                });
            }
            grid.appendChild(item);
        });
    }

    // Listen for new reward unlocks while cat window is open
    document.addEventListener('rewardUnlocked', (e) => {
        if (win.classList.contains('is-hidden')) return;
        const type = e.detail?.reward?.type;
        if (type === REWARD_TYPE_CAT_ACCESSORY) renderCatAccessories();
        if (type === REWARD_TYPE_CAT_BEHAVIOUR) renderCatBehaviours();
    });

    function getCatMoodBadge(s) {
        if (!s) return { text: '...', cls: '' };
        if (s.hunger < 20) return { text: 'hungry!',  cls: 'mood-urgent' };
        if (s.thirst < 20) return { text: 'thirsty!', cls: 'mood-urgent' };
        if (s.play   < 20) return { text: 'bored...',  cls: 'mood-urgent' };
        if (s.hunger < 40) return { text: 'peckish',  cls: 'mood-warn' };
        if (s.thirst < 40) return { text: 'parched',  cls: 'mood-warn' };
        if (s.play   < 40) return { text: 'restless', cls: 'mood-warn' };
        if (Math.min(s.hunger, s.thirst, s.play) > 75) return { text: 'purring \u2661', cls: '' };
        return { text: 'content', cls: '' };
    }

    // ---- Render stats into the window ----
    function renderCatWindow() {
        const s = _catStats;
        const nameInput = document.getElementById('cat-name-input');
        if (nameInput && s?.catName !== undefined && !nameInput.dataset.dirty) {
            nameInput.value = s.catName || '';
        }

        // Portrait panel
        const faceEl = document.getElementById('cat-face');
        if (faceEl) faceEl.textContent = getCatFace(s);
        const nameDisplay = document.getElementById('cat-name-display');
        if (nameDisplay) nameDisplay.textContent = catDisplayName();
        const moodBadge = document.getElementById('cat-mood-badge');
        if (moodBadge && s) {
            const { text, cls } = getCatMoodBadge(s);
            moodBadge.textContent = text;
            moodBadge.className = 'cat-mood-badge' + (cls ? ' ' + cls : '');
        }

        if (!s) return;
        for (const stat of ['hunger', 'thirst', 'play']) {
            const val  = Math.round(s[stat] ?? 0);
            const fill = document.getElementById(`cat-meter-${stat}`);
            const valEl = document.getElementById(`cat-val-${stat}`);
            if (fill) {
                fill.style.width      = val + '%';
                fill.style.background = val < 25 ? '#cc3333' : val < 50 ? '#cc8833' : '#339944';
            }
            if (valEl) valEl.textContent = val;
        }
    }

    // ---- Load stats from Firebase ----
    async function loadCatStats() {
        if (!currentUser) return;
        try {
            const catRef = ref(database, `cat/${currentUser}`);
            const snap = await get(catRef);
            let stored = snap.val();
            if (!stored) {
                stored = { ...CAT_DEFAULTS, lastUpdated: Date.now() };
                await set(catRef, stored);
            }
            const decayed = applyCatDecay(stored);
            const now = Date.now();
            _catStats = { ...decayed, catName: stored.catName || '', lastUpdated: now };
            await update(catRef, { hunger: decayed.hunger, thirst: decayed.thirst, play: decayed.play, lastUpdated: now });
            renderCatWindow();
        } catch (e) { console.error('loadCatStats failed', e); }
    }

    // ---- Perform a care action ----
    async function doCatAction(action) {
        if (!currentUser || !throttle('catAction', 1500)) return;
        if (!CAT_ACTION_STAT[action]) return;

        // --- Immediate local feedback (fires before any network/db call) ---
        const BTN_IDS    = { feed: 'cat-feed-btn', water: 'cat-water-btn', yarn: 'cat-yarn-btn' };
        const STATUS_LBL = { feed: 'Feeding\u2026', water: 'Watering\u2026', yarn: 'Playing\u2026' };
        const DONE_LBL   = { feed: '\u2713 fed!', water: '\u2713 watered!', yarn: '\u2713 played!' };
        const METER_IDS  = { feed: 'cat-meter-hunger', water: 'cat-meter-thirst', yarn: 'cat-meter-play' };

        const actionBtn   = document.getElementById(BTN_IDS[action]);
        const lastActEl   = document.getElementById('cat-last-action');

        if (lastActEl) {
            lastActEl.textContent = STATUS_LBL[action] || '\u2026';
            lastActEl.classList.add('is-visible');
            clearTimeout(_lastActionTimer);
        }

        const meterFill = document.getElementById(METER_IDS[action]);
        if (meterFill) {
            meterFill.classList.add('cat-meter-flash');
            setTimeout(() => meterFill.classList.remove('cat-meter-flash'), 400);
        }

        if (actionBtn) {
            actionBtn.disabled = true;
            setTimeout(() => { actionBtn.disabled = false; }, 800);
        }

        if (action === 'feed' || action === 'water') {
            window._catLocalEmote?.('heart');
        } else if (action === 'yarn') {
            window._catLocalYarnZoom?.();
        }
        sparkSound('cat');
        const _ACT_LOG = { feed: 'Cat was fed', water: 'Cat was watered', yarn: 'Cat played with yarn' };
        if (_ACT_LOG[action]) _addCatLog(_ACT_LOG[action]);

        // --- Network / DB sync (runs after immediate feedback) ---
        try {
            const catRef = ref(database, `cat/${currentUser}`);
            const result = await runTransaction(catRef, (stored) => {
                if (stored === null) stored = { ...CAT_DEFAULTS, lastUpdated: Date.now() };
                const decayed = applyCatDecay(stored);
                const delta = CAT_ACTION_DELTAS[action] || 0;
                const stat  = CAT_ACTION_STAT[action];
                return {
                    catName:     stored.catName || '',
                    hunger:      Math.max(0, Math.min(100, decayed.hunger + (stat === 'hunger' ? delta : 0))),
                    thirst:      Math.max(0, Math.min(100, decayed.thirst + (stat === 'thirst' ? delta : 0))),
                    play:        Math.max(0, Math.min(100, decayed.play   + (stat === 'play'   ? delta : 0))),
                    lastUpdated: Date.now(),
                };
            });
            if (result.committed && result.snapshot.exists()) {
                _catStats = result.snapshot.val();
                renderCatWindow();
            }
            // Update last-action to done state
            const lastActElDone = document.getElementById('cat-last-action');
            if (lastActElDone) {
                lastActElDone.textContent = DONE_LBL[action] || '\u2713 done';
                _lastActionTimer = setTimeout(() => lastActElDone.classList.remove('is-visible'), 5000);
            }
        } catch (e) {
            console.error('doCatAction failed', e);
            showToast("Couldn\u2019t sync, but the cat still enjoyed it locally \u2665");
            const lastActElErr = document.getElementById('cat-last-action');
            if (lastActElErr) {
                lastActElErr.textContent = '\u26a0 sync failed, but the cat felt it \u2665';
                _lastActionTimer = setTimeout(() => lastActElErr.classList.remove('is-visible'), 5000);
            }
        }
        _afterCatAction();
    }

    // ---- Cat name save ----
    const nameInput  = document.getElementById('cat-name-input');
    const nameSaveBtn = document.getElementById('cat-name-save');
    if (nameInput) {
        nameInput.addEventListener('input', () => { nameInput.dataset.dirty = '1'; });
        nameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') nameSaveBtn?.click();
        });
    }
    if (nameSaveBtn && nameInput) {
        nameSaveBtn.addEventListener('click', async () => {
            if (!currentUser) return;
            const newName = nameInput.value.trim().slice(0, 32);
            try {
                await set(ref(database, `cat/${currentUser}/catName`), newName);
                if (_catStats) _catStats.catName = newName;
                delete nameInput.dataset.dirty;
                renderCatWindow();
                showToast('Cat name saved!');
            } catch (e) { console.error('saveCatName failed', e); }
        });
    }

    // ---- Action buttons ----
    // Use mousedown instead of click so the action fires on the first press even when the
    // window is not yet focused. The window's capture-phase mousedown handler focuses the
    // window at the same moment, so focus + action happen in a single interaction.
    document.getElementById('cat-feed-btn')?.addEventListener('mousedown',  (e) => { if (e.button === 0) doCatAction('feed');  });
    document.getElementById('cat-water-btn')?.addEventListener('mousedown', (e) => { if (e.button === 0) doCatAction('water'); });
    document.getElementById('cat-yarn-btn')?.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        if (window._catController?.isSleeping()) {
            const name = catDisplayName();
            openW95Dialog({
                icon: '😴',
                title: 'Cat.exe',
                message: `Are you sure you want to disturb ${name} while they're napping?`,
                buttons: [
                    {
                        label: 'Yes',
                        action: () => {
                            if (Math.random() < 0.5) {
                                // Positive: cat wakes up excited
                                window._catController?.wakeCat();
                                doCatAction('yarn');
                                window._catLocalEmote?.('cheer');
                                _addCatLog(`[positive] ${name} wakes up excited for play time`);
                                window._appendGardenJournalEntry?.({
                                    date: localDateStr(),
                                    msg:  `${name} wakes up excited for play time`,
                                });
                            } else {
                                // Negative: cat is grumpy about being disturbed
                                window._catLocalGrumpy?.();
                                _addCatLog(`[negative] ${name} was trying to get cosy, leave them be!`);
                                window._appendGardenJournalEntry?.({
                                    date: localDateStr(),
                                    msg:  `${name} was trying to get cosy, leave them be!`,
                                });
                            }
                        },
                    },
                    { label: 'No', action: null },
                ],
            });
        } else {
            doCatAction('yarn');
        }
    });

    // ---- Desktop cat status display (updates every second) ----
    function renderDesktopCatStatus() {
        const el = document.getElementById('cat-desktop-state');
        if (el) el.textContent = window._catController?.getDesktopState() ?? 'loading...';
        // Keep roam button label in sync with paused state
        const roamBtn = document.getElementById('cat-roam-btn');
        if (roamBtn) {
            const paused = window._catController?.isRoamingPaused();
            roamBtn.textContent = paused ? '\u25B6 Resume Roaming' : '\u23F8 Pause Roaming';
        }
    }
    setInterval(renderDesktopCatStatus, 1000);

    // ---- Desktop cat control panel buttons ----
    document.getElementById('cat-call-btn')?.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        const callResult = window._catController?.callCat();
        const lastActEl = document.getElementById('cat-last-action');
        if (callResult === 'already_here') {
            const name = catDisplayName();
            const label = name === 'the cat' ? 'The cat' : name;
            if (lastActEl) {
                lastActEl.textContent = `${label} is already here!`;
                lastActEl.classList.add('is-visible');
                clearTimeout(_lastActionTimer);
                _lastActionTimer = setTimeout(() => lastActEl.classList.remove('is-visible'), 4000);
            }
        } else if (callResult === 'no_room') {
            if (lastActEl) {
                lastActEl.textContent = `No room to sit \u2014 move the window down!`;
                lastActEl.classList.add('is-visible');
                clearTimeout(_lastActionTimer);
                _lastActionTimer = setTimeout(() => lastActEl.classList.remove('is-visible'), 4000);
            }
        } else {
            _addCatLog('Cat came when called');
            if (lastActEl) {
                lastActEl.textContent = '\uD83D\uDCCD calling\u2026';
                lastActEl.classList.add('is-visible');
                clearTimeout(_lastActionTimer);
                _lastActionTimer = setTimeout(() => lastActEl.classList.remove('is-visible'), 4000);
            }
        }
    });
    document.getElementById('cat-roam-btn')?.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        const nowPaused = window._catController?.toggleRoaming();
        _addCatLog(nowPaused ? 'Cat settled in' : 'Cat started roaming');
        renderDesktopCatStatus();
    });
    document.getElementById('cat-nap-btn')?.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        window._catController?.napCat();
        _addCatLog('Cat took a nap');
        renderDesktopCatStatus();
    });
    document.getElementById('cat-pet-btn')?.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        window._catController?.petCat();
        _addCatLog('Cat enjoyed being petted');
    });

    // ---- Auth recovery: reload stats if auth resolves while window is already visible ----
    // When the window is auto-restored from localStorage before Firebase auth fires,
    // loadCatStats() is called with currentUser = null and returns early. This listener
    // re-runs it once the user is confirmed, so the first button click is never silently dropped.
    onAuthStateChanged(auth, (firebaseUser) => {
        if (firebaseUser && !win.classList.contains('is-hidden')) loadCatStats();
    });

    // ---- App registry ----
    w95Apps['cat'] = { open: () => {
        if (win.classList.contains('is-hidden')) showCat(); else w95Mgr.focusWindow('w95-win-cat');
    }};

    if (localStorage.getItem('w95_cat_open') === '1') showCat();
})();

// ===== PIXEL CAT =====
// Shared desktop mascot. One client drives cat position via Firebase (~1.4 s writes);
// all clients render smoothly by extrapolating movement locally between updates.

// ---- Cat emote event helper — call from anywhere to trigger a short visual on the cat ----
function fireCatEvent(type) {
    if (!currentUser) return;
    set(ref(database, 'desktop/catEvent'), { type, ts: Date.now(), by: currentUser }).catch(() => {});
}

function initPixelCat() {
    if (initPixelCat._done) return;
    initPixelCat._done = true;

    // ---- Sprite data (8 × 8 pixels, each drawn at S px) ----
    // Palette: 0 = transparent | 1 = dark outline | 2 = fur | 3 = pink (ear-inner / nose)
    const S   = 5;                            // CSS pixels per cat-pixel → 40 × 40 canvas
    const CW  = 8, CH = 8;
    const CLR = [null, '#2C2C3E', '#C0C2D8', '#E8829A'];

    // Ear tips at outer cols 1 & 6 form triangle ears; pink at row 1 = inner ear.
    // Eyes: dark pixel at cols 2 & 5 in the eye row.
    // Nose: two centred pink pixels at cols 3 & 4.

    const HEAD = [          // shared top rows (ears + face) – 5 rows
        [0,1,0,0,0,0,1,0],  // row 0 – ear tips at cols 1 & 6 (outer corners)
        [1,3,1,0,0,1,3,1],  // row 1 – ears: outline/pink/outline · gap · outline/pink/outline
        [1,2,2,2,2,2,2,1],  // row 2 – face
        [1,2,1,2,2,1,2,1],  // row 3 – eyes (dark at cols 2 & 5)
        [1,2,2,3,3,2,2,1],  // row 4 – centred pink nose (no whisker-hint dots)
    ];

    // Walk-A: legs together (stride-in)
    const WALK_A = [
        ...HEAD,
        [1,2,2,2,2,2,2,1],  // row 5 – body
        [0,1,1,0,0,1,1,0],  // row 6 – legs (2-px wide each)
        [0,1,1,0,0,1,1,0],  // row 7 – paws
    ];
    // Walk-B: legs apart (stride-out)
    const WALK_B = [
        ...HEAD,
        [1,2,2,2,2,2,2,1],  // row 5 – body
        [0,1,1,0,0,1,1,0],  // row 6 – legs (2-px wide, same as WALK_A)
        [1,1,0,0,0,0,1,1],  // row 7 – paws spread wide
    ];
    // Sit: haunches visible, paws tucked
    const SIT = [
        ...HEAD,
        [1,2,2,2,2,2,2,1],  // row 5 – body
        [1,2,2,2,2,2,2,1],  // row 6 – haunches
        [1,2,2,1,1,2,2,1],  // row 7 – tucked paws
    ];
    // Sleep: ears lowered by one row, eyes closed (horizontal bar), rounded body
    const SLEEP = [
        [0,0,0,0,0,0,0,0],  // row 0 – empty (cat is curled lower)
        [0,1,0,0,0,0,1,0],  // row 1 – ear tips (shifted down)
        [1,3,1,0,0,1,3,1],  // row 2 – ears with pink inner
        [1,2,2,2,2,2,2,1],  // row 3 – face
        [1,2,2,2,2,2,2,1],  // row 4 – closed eyes (smooth face, no marks = eyelids shut)
        [1,2,2,2,2,2,2,1],  // row 5 – body
        [1,2,2,2,2,2,2,1],  // row 6 – body
        [0,1,2,2,2,2,1,0],  // row 7 – body bottom
    ];
    // Surprise: big eyes — shown for ~700 ms after a click
    const SURPRISE = [
        [0,1,0,0,0,0,1,0],  // row 0 – ear tips
        [1,3,1,0,0,1,3,1],  // row 1 – ears with pink inner
        [1,2,2,2,2,2,2,1],  // row 2 – face
        [1,1,1,2,2,1,1,1],  // row 3 – wide eyes (dark fills 3 cols each)
        [1,2,2,3,3,2,2,1],  // row 4 – surprised nose (no scary dark sides)
        [1,2,2,2,2,2,2,1],  // row 5 – body
        [0,1,1,2,2,1,1,0],  // row 6 – body lower
        [0,1,1,0,0,1,1,0],  // row 7 – paws
    ];

    // Wakeup: half-open eyes (horizontal bar thinned to one pixel row), seated posture
    const WAKEUP = [
        [0,0,0,0,0,0,0,0],  // row 0 – empty
        [0,1,0,0,0,0,1,0],  // row 1 – ear tips
        [1,3,1,0,0,1,3,1],  // row 2 – ears with pink inner
        [1,2,2,2,2,2,2,1],  // row 3 – face
        [1,2,1,2,2,1,2,1],  // row 4 – half-open eyes (single dark pixel per eye)
        [1,2,2,3,3,2,2,1],  // row 5 – nose (clean, no whisker-hint dots)
        [1,2,2,2,2,2,2,1],  // row 6 – body
        [0,1,2,2,2,2,1,0],  // row 7 – body bottom
    ];

    // Idle: cat standing still, glancing sideways (left eye shifted one pixel right)
    const IDLE = [
        [0,1,0,0,0,0,1,0],  // row 0 – ear tips
        [1,3,1,0,0,1,3,1],  // row 1 – ears with pink inner
        [1,2,2,2,2,2,2,1],  // row 2 – face
        [1,2,2,1,2,1,2,1],  // row 3 – sideways glance: left eye at col 3, right at col 5
        [1,2,2,3,3,2,2,1],  // row 4 – nose (no whisker-hint dots)
        [1,2,2,2,2,2,2,1],  // row 5 – body
        [0,1,1,0,0,1,1,0],  // row 6 – legs
        [0,1,1,0,0,1,1,0],  // row 7 – paws
    ];
    // Jump: mid-leap pose – front paws reaching out, back paws dangling
    const JUMP = [
        [0,1,0,0,0,0,1,0],  // row 0 – ear tips
        [1,3,1,0,0,1,3,1],  // row 1 – ears with pink inner
        [1,2,2,2,2,2,2,1],  // row 2 – face
        [1,2,1,2,2,1,2,1],  // row 3 – eyes wide open (alert mid-leap)
        [1,2,2,3,3,2,2,1],  // row 4 – nose (no whisker-hint dots)
        [1,2,2,2,2,2,2,1],  // row 5 – body
        [1,0,2,2,2,2,0,1],  // row 6 – front paws extended sideways
        [0,1,0,0,0,0,1,0],  // row 7 – back paws tucked/dangling
    ];

    // Dazed: seated cat with crossed/inward eyes — shown for ~2 s after a hard fall
    const DAZED = [
        [0,1,0,0,0,0,1,0],  // row 0 – ear tips
        [1,3,1,0,0,1,3,1],  // row 1 – ears with pink inner
        [1,2,2,2,2,2,2,1],  // row 2 – face
        [1,2,2,1,1,2,2,1],  // row 3 – crossed eyes (pupils moved inward to cols 3 & 4)
        [1,2,2,3,3,2,2,1],  // row 4 – nose
        [1,2,2,2,2,2,2,1],  // row 5 – body
        [1,2,2,2,2,2,2,1],  // row 6 – haunches
        [1,2,2,1,1,2,2,1],  // row 7 – tucked paws
    ];

    const FRAMES = { walkA: WALK_A, walkB: WALK_B, sit: SIT, sleep: SLEEP, surprise: SURPRISE, wakeup: WAKEUP, idle: IDLE, jump: JUMP, dazed: DAZED };

    // ---- Canvas (appended to body so z-index is unambiguous) ----
    const canvas = document.createElement('canvas');
    canvas.id     = 'pixel-cat-canvas';
    canvas.width  = CW * S;
    canvas.height = CH * S;
    document.body.appendChild(canvas);

    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;

    // ---- Interactive hit area — transparent overlay that captures clicks on the cat ----
    const hitArea = document.createElement('div');
    hitArea.id    = 'cat-hit-area';
    hitArea.title = 'Desktop Cat \u00b7 double-click to open Cat.exe';
    document.body.appendChild(hitArea);

    // Single click: light local reaction (heart + bounce) without a Firebase write
    let _lastCatClick = 0;
    hitArea.addEventListener('click', (e) => {
        const now = Date.now();
        if (now - _lastCatClick < 400) return; // ignore if part of a dblclick
        _lastCatClick = now;
        setTimeout(() => {
            if (Date.now() - _lastCatClick < 350) return; // dblclick fired, skip
            window._catController?.petCat();
        }, 220);
    });

    // Double click: open / focus Cat.exe
    hitArea.addEventListener('dblclick', (e) => {
        _lastCatClick = 0; // prevent single-click from firing
        w95Apps['cat']?.open();
    });

    // Track cursor position for behaviour system (passive — never blocks scroll)
    window.addEventListener('mousemove', e => {
        const nx = e.clientX / window.innerWidth;
        lastCursorX      = Math.max(EDGE_PAD, Math.min(1 - EDGE_PAD, nx));
        lastCursorMoveAt = performance.now();
        // Append to copycat history ring buffer (keep ~2 s at 60 fps ≈ 120 entries)
        bhvCopycatBuf.push({ x: lastCursorX, ts: lastCursorMoveAt });
        if (bhvCopycatBuf.length > 120) bhvCopycatBuf.shift();
    }, { passive: true });

    // ---- Firebase refs ----
    const catFbRef    = ref(database, 'desktop/cat');
    const catEventRef = ref(database, 'desktop/catEvent');
    const giftsRef    = ref(database, 'desktop/gifts');
    const giftMetaRef = ref(database, 'desktop/giftMeta');

    // ---- Emote overlay (positioned to track the cat canvas) ----
    const emoteEl = document.createElement('div');
    emoteEl.id = 'cat-emotes';
    document.body.appendChild(emoteEl);

    // ---- Sleep Zzz overlay (floats up from the cat's head while sleeping) ----
    const zzzEl = document.createElement('div');
    zzzEl.id = 'cat-zzz';
    document.body.appendChild(zzzEl);

    // ---- Accessory overlay (shows equipped accessory icon on the desktop cat) ----
    const accEl = document.createElement('div');
    accEl.id = 'cat-accessory-overlay';
    document.body.appendChild(accEl);

    // Vertical offset (in CSS px) from the cat sprite's top edge to the accessory overlay.
    // Updated whenever the equipped accessory changes; read every render frame.
    let _catAccOverlayTopOffset = S;

    function updateCatAccessoryOverlay() {
        const id = localStorage.getItem('catEquippedAccessory') || '';
        const acc = id && isRewardUnlocked(id)
            ? REWARD_REGISTRY.find(r => r.id === id && r.type === REWARD_TYPE_CAT_ACCESSORY) || null
            : null;
        accEl.textContent = acc ? acc.faceDecor : '';
        // Position overlay at the anatomically correct row of the cat sprite.
        // Sprite rows: 0-1 ears, 2 face, 3 eyes, 4 nose, 5+ body/neck.
        if (acc && acc.placement === 'eye')  _catAccOverlayTopOffset = S * 3;
        else if (acc && acc.placement === 'neck') _catAccOverlayTopOffset = S * 4;
        else _catAccOverlayTopOffset = S;
    }
    updateCatAccessoryOverlay();
    window._catUpdateAccessoryOverlay = updateCatAccessoryOverlay;

    // ---- State received from Firebase ----
    let fbX         = 0.5;
    let fbDir       = 'right';
    let fbState     = 'walk';
    let fbUpdatedAt = Date.now();

    // ---- Local render state ----
    let localX      = 0.5;   // smoothly interpolated x (0–1)
    let animIdx     = 0;     // 0 | 1 walk-frame toggle
    let lastFlip    = 0;     // timestamp of last frame toggle
    let surpriseEnd     = 0; // show surprise face until this time
    let wakeupStartedAt = 0; // local ts when wakeup state was first observed

    // ---- Driver state (only the elected driver uses these) ----
    let isDriver    = false;
    let drvX        = 0.5;
    let drvDir      = 'right';
    let drvState    = 'walk';
    let drvSitEnd   = 0;     // timestamp when sit/sleep phase ends
    let drvNextAct  = 0;     // timestamp of next walk→sit transition
    let lastFbWrite = 0;     // timestamp of last Firebase write
    let onlinePres  = {};    // { userName: { state, ts } } from presence/
    let drvWasNightSleep = isNightSleepWindow(); // track sleep-window transitions
    let drvWakeStart     = 0; // ms timestamp when wakeup state began (driver)
    let drvPerchTarget   = null; // { winEl, side } – local-only, never synced to Firebase
    let drvPerchEnd      = 0;   // ms timestamp when perching ends
    let drvIdleEnd       = 0;   // ms timestamp when idle phase ends (local-only)
    let drvJumpStartX    = 0;   // jump arc: start position screen-px x
    let drvJumpStartY    = 0;   // jump arc: start position screen-px y
    let drvJumpTargetX   = 0;   // jump arc: destination screen-px x
    let drvJumpTargetY   = 0;   // jump arc: destination screen-px y
    let drvJumpTime      = 0;   // timestamp when current jump arc began

    // ---- Cat controller state (commands from Cat.exe control panel) ----
    let drvRoamingPaused = false;   // when true, cat won't auto-walk between sits
    let drvCallTarget    = null;    // normalised x (0–1) to walk toward; null = no call
    let drvForcedNapEnd  = 0;       // performance.now() timestamp: force sleep until this time
    let _prevDrvState    = null;    // tracks previous state for activity-log transition events
    let drvCallPerchWin  = null;    // window element to jump onto once call-cat walk completes
    let drvPerchLastPos  = null;    // { x, y, ts } – last perch pixel pos for shake detection
    let drvPerchLastPixel = null;  // { px, py } – saved pixel pos for fall start position
    let drvFalling        = false; // true when cat fell from a closed window (vs graceful jump-down)
    let drvDazedEnd       = 0;    // timestamp when dazed-on-landing state ends

    // ---- Behaviour system state ----
    // Cursor position tracked globally within initPixelCat for attention/copycat use
    let lastCursorX      = 0.5;  // normalised x (0–1) of mouse cursor
    let lastCursorMoveAt = 0;    // performance.now() timestamp of last mousemove

    // Attention Mode: after petting, cat follows cursor for 5–8 s with slight delay
    let bhvAttentionActive = false;
    let bhvAttentionEndAt  = 0;  // performance.now() when attention mode expires

    // Shy Mode: after ~15 s of the cat not walking, it creeps behind a nearby window
    let bhvShyActive    = false;
    let bhvShyHideWin   = null;  // window element the cat is hiding behind
    let bhvShyHideSide  = 'left';
    let bhvShyPeekX     = 0;    // normalised x of the peek position (edge of window)
    let bhvShyReturning = false; // true while cat walks back into the open
    let bhvShyIdleMs    = 0;    // accumulated ms the cat has spent not walking
    const BHV_SHY_MS    = 15000;// ms threshold to trigger shy mode

    // Copycat: cat loosely mirrors cursor with a lag and playful offset
    let bhvCopycatActive  = false;
    let bhvCopycatEndAt   = 0;
    let bhvCopycatOffsetX = 0;   // normalised x offset added to the delayed cursor position
    const COPYCAT_DELAY_MS = 800; // ms the cat lags behind the cursor
    const bhvCopycatBuf    = []; // [{x, ts}] ring buffer for delayed cursor lookup (≤120 entries)

    // ---- Gift drop driver state ----
    const GIFT_MIN_INTERVAL_MS = 90 * 60 * 1000;  // 90 min minimum between gifts
    const GIFT_CHECK_MS        =  3 * 60 * 1000;  // re-fetch giftMeta every 3 min
    const GIFT_ROLL_MS         =  5 * 60 * 1000;  // roll dice at most every 5 min
    const GIFT_ROLL_CHANCE     = 0.40;             // 40 % per roll → ~12 min expected wait
    let lastGiftCheckAt = 0;
    let lastGiftRollAt  = 0;
    let giftDropArmed   = false; // true once interval has elapsed

    // Tuning constants
    const WALK_SPEED  = 0.000085; // normalised x per ms ≈ full-width crossing ~12 s
    const EDGE_PAD    = 0.04;     // stay within [EDGE_PAD, 1 − EDGE_PAD]
    const FB_INTERVAL = 1400;     // ms between Firebase writes (driver only)
    const WALK_FPS    = 220;      // ms per walk animation frame
    const LERP_K      = 0.006;    // lerp rate for remote clients (per ms)
    const SIT_MIN     = 3500;     // min sit/sleep duration (ms)
    const SIT_MAX     = 8000;
    const SLEEP_P     = 0.28;     // probability that sit transitions to sleep
    const JUMP_DURATION   = 650;  // ms for a jump arc animation (up or down)
    const JUMP_ARC        = 85;   // extra upward px at the peak of the arc
    const IDLE_MIN        = 500;  // ms cat pauses in idle before deciding next action
    const IDLE_MAX        = 1400;
    const SHAKE_THRESHOLD = 5;    // px/ms – window speed that shakes cat off perch
    const PERCH_PROX_PX   = 120;  // px – max horizontal gap for the cat to jump to a window
    const DAZE_DURATION   = 2000; // ms the cat sits dazed after hitting the ground from a hard fall

    // ---- Presence listener → driver election + both-online heart ----
    let _presInitDone   = false; // skip very first snapshot (avoid heart on page load)
    let _bothOnlineFired = false; // debounce: only fire once per "both came online" transition
    onValue(ref(database, 'presence'), snap => {
        onlinePres = snap.val() || {};
        const onlineCount = Object.values(onlinePres)
            .filter(v => v && v.state !== 'offline').length;
        if (_presInitDone) {
            if (onlineCount >= 2 && !_bothOnlineFired) {
                _bothOnlineFired = true;
                fireCatEvent('heart');
            }
        }
        if (onlineCount < 2) _bothOnlineFired = false; // reset so it can fire again next time
        _presInitDone = true;
        electDriver();
    });

    // ---- Cat emote rendering ----
    function triggerEmote(type) {
        const configs = {
            sparkle: { syms: ['✦', '✧', '⋆', '✦', '✧'], colors: ['#f9d55a', '#fff8b0', '#f9d55a', '#fffde0', '#fff8b0'] },
            cheer:   { syms: ['✿', '♪', '✿', '♪', '✿'], colors: ['#ff9eb0', '#a0e8af', '#f9d55a', '#a0e8af', '#ff9eb0'] },
            heart:   { syms: ['♡', '♡', '♡', '♡', '♡'], colors: ['#ff6b8a', '#ff8fab', '#ff6b8a', '#ffb3c6', '#ff6b8a'] },
            grumpy:  { syms: ['！', '～', '！', '～', '！'], colors: ['#ff5555', '#ff8888', '#ff5555', '#ffaaaa', '#ff5555'] },
        };
        const cfg = configs[type] || configs.sparkle;
        cfg.syms.forEach((sym, i) => {
            const p = document.createElement('span');
            p.className = 'cat-ep';
            p.textContent = sym;
            p.style.color = cfg.colors[i];
            p.style.left  = Math.round(Math.random() * 36 + 2) + 'px'; // spread within the 40px cat
            p.style.animationDelay = (i * 110) + 'ms';
            emoteEl.appendChild(p);
            setTimeout(() => p.remove(), 1400 + i * 110);
        });
    }

    // ---- Sleep Zzz spawner ----
    let _zzzTimer = null;
    let _zzzIdx   = 0;
    function startSleepZzz() {
        if (_zzzTimer) return;
        _zzzIdx = 0;
        const spawn = () => {
            const chars = ['z', 'Z', 'z'];
            const sizes = ['9px', '13px', '9px'];
            const p = document.createElement('span');
            p.className = 'cat-zzz-p';
            p.textContent = chars[_zzzIdx % 3];
            p.style.fontSize = sizes[_zzzIdx % 3];
            p.style.left = (3 + (_zzzIdx % 3) * 8) + 'px';
            zzzEl.appendChild(p);
            setTimeout(() => p.remove(), 2600);
            _zzzIdx++;
        };
        spawn();
        _zzzTimer = setInterval(spawn, 1400);
    }
    function stopSleepZzz() {
        clearInterval(_zzzTimer);
        _zzzTimer = null;
        // leave any in-flight particles to finish their animation naturally
    }

    // Listen for shared cat emote events
    onValue(catEventRef, snap => {
        const ev = snap.val();
        if (!ev || !ev.type || !ev.ts) return;
        if (Date.now() - ev.ts > 2000) return; // stale — ignore
        triggerEmote(ev.type);
        // Clear so the event doesn't replay; occasional double-clear is harmless
        setTimeout(() => set(catEventRef, null).catch(() => {}), 400);
    });

    function electDriver() {
        // Driver = alphabetically first user whose presence state is not 'offline'
        const candidates = Object.entries(onlinePres)
            .filter(([, v]) => v && v.state !== 'offline')
            .map(([k]) => k)
            .sort();
        const elected = candidates[0] || null;
        const wasDriver = isDriver;
        isDriver = !!currentUser && currentUser === elected;
        if (!wasDriver && isDriver) {
            // Inherit current interpolated position so the cat doesn't jump
            drvX       = localX;
            drvDir     = fbDir;
            drvState   = fbState;
            drvNextAct = performance.now() + 4000 + Math.random() * 5000;
        }
    }

    // ---- Cat gift system ----
    const GIFT_TYPES = [
        { id: 'fish',    icon: '🐟', label: 'a tiny fish',      msg: 'The cat brought you a fish!' },
        { id: 'yarn',    icon: '🧶', label: 'a ball of yarn',   msg: 'The cat left some yarn to play with!' },
        { id: 'leaf',    icon: '🍃', label: 'a lucky leaf',     msg: 'The cat found a leaf for you!' },
        { id: 'feather', icon: '🪶', label: 'a soft feather',   msg: 'The cat dropped a feather!' },
        { id: 'gem',     icon: '💎', label: 'a shiny gem',      msg: 'The cat left a gem for you!' },
        { id: 'acorn',   icon: '🌰', label: 'an acorn',         msg: 'The cat brought you an acorn!' },
        { id: 'pebble',  icon: '🪨', label: 'a smooth pebble',  msg: 'The cat found a pebble for you!' },
        { id: 'flower',  icon: '🌸', label: 'a little flower',  msg: 'The cat picked a flower for you!' },
    ];

    // Check Firebase to see if a gift can be dropped yet
    function checkGiftEligibility() {
        get(giftMetaRef).then(snap => {
            const meta = snap.val() || {};
            giftDropArmed = (Date.now() - (meta.lastGiftAt || 0)) >= GIFT_MIN_INTERVAL_MS;
        }).catch(() => {});
    }

    // Driver drops a gift at the cat's current position
    function dropGift() {
        if (!isDriver || !currentUser || !giftDropArmed) return;
        giftDropArmed = false; // prevent double-drop before Firebase confirms
        const type = GIFT_TYPES[Math.floor(Math.random() * GIFT_TYPES.length)];
        push(giftsRef, {
            type:      type.id,
            x:         drvX,
            droppedAt: Date.now(),
            collected: false,
        }).then(() => {
            set(giftMetaRef, { lastGiftAt: Date.now() }).catch(() => {});
            fireCatEvent('sparkle');
        }).catch(() => { giftDropArmed = true; }); // re-arm on failure
    }

    // Render / remove gift elements based on Firebase state
    const renderedGifts = {}; // giftId → DOM element
    const GIFT_EXPIRY_MS = 24 * 60 * 60 * 1000; // expire uncollected gifts after 24 h

    onValue(giftsRef, snap => {
        const gifts = snap.val() || {};
        // Remove elements for gifts that were collected or deleted
        Object.keys(renderedGifts).forEach(id => {
            if (!gifts[id] || gifts[id].collected) {
                renderedGifts[id].remove();
                delete renderedGifts[id];
            }
        });
        // Render new uncollected gifts; driver silently removes expired ones
        Object.entries(gifts).forEach(([id, gift]) => {
            if (gift.collected) return;
            if (Date.now() - (gift.droppedAt || 0) > GIFT_EXPIRY_MS) {
                if (isDriver) remove(ref(database, `desktop/gifts/${id}`)).catch(() => {});
                return;
            }
            if (renderedGifts[id]) return; // already rendered
            const type = GIFT_TYPES.find(t => t.id === gift.type) || GIFT_TYPES[0];
            const el = document.createElement('div');
            el.className = 'cat-gift';
            el.textContent = type.icon;
            el.title = `Click to collect ${type.label}!`;
            el.style.left = `${Math.round(gift.x * (window.innerWidth - 40))}px`;
            el.addEventListener('click', () => openGiftPopup(id, type));
            document.body.appendChild(el);
            renderedGifts[id] = el;
        });
    });

    // Gift popup elements
    const giftWin     = document.getElementById('w95-win-gift');
    const giftIconEl  = document.getElementById('gift-popup-icon');
    const giftLabelEl = document.getElementById('gift-popup-label');
    const giftMsgEl   = document.getElementById('gift-popup-msg');
    let activeGiftId  = null;

    function openGiftPopup(id, type) {
        activeGiftId = id;
        giftIconEl.textContent  = type.icon;
        giftLabelEl.textContent = type.label;
        giftMsgEl.textContent   = type.msg;
        giftWin.style.left = `${Math.round((window.innerWidth  - 240) / 2)}px`;
        giftWin.style.top  = `${Math.round((window.innerHeight - 180) / 2 - 30)}px`;
        giftWin.style.zIndex = ++w95TopZ;
        giftWin.classList.remove('is-hidden');
    }

    document.getElementById('w95-gift-close').addEventListener('click', () => {
        giftWin.classList.add('is-hidden');
        activeGiftId = null;
    });

    document.getElementById('gift-collect-btn').addEventListener('click', () => {
        if (!activeGiftId || !currentUser) return;
        const id = activeGiftId;
        activeGiftId = null;
        giftWin.classList.add('is-hidden');
        update(ref(database, `desktop/gifts/${id}`), {
            collected:   true,
            collectedAt: Date.now(),
            collectedBy: currentUser,
        }).then(() => fireCatEvent('cheer')).catch(() => {});
    });

    makeDraggable(giftWin, document.getElementById('w95-gift-handle'), 'w95-win-gift');

    // ---- Perch helpers (local-only, no Firebase involvement) ----
    function getPerchableWindows() {
        const catH = CH * S;
        return Array.from(document.querySelectorAll('[id^="w95-win-"]'))
            .filter(el => {
                if (el.classList.contains('is-hidden') || el.classList.contains('is-maximised')) return false;
                const rect = el.getBoundingClientRect();
                return rect.top >= catH;  // only perch if there's room above for the cat to sit
            });
    }
    function calcPerchPos(winEl, side) {
        const rect = winEl.getBoundingClientRect();
        const catW = CW * S;  // 40px
        const catH = CH * S;  // 40px
        const vw   = window.innerWidth;
        let px = side === 'left' ? rect.left + 8 : rect.right - catW - 8;
        px = Math.max(0, Math.min(vw - catW, px));
        const py = Math.max(0, rect.top - catH);  // cat sits on top of the title bar
        return { px, py };
    }

    // ---- Helpers: London timezone sleep window ----
    function getLondonHour() {
        return parseInt(new Intl.DateTimeFormat('en-GB', {
            timeZone: 'Europe/London', hour: 'numeric', hour12: false,
        }).format(new Date()), 10);
    }
    function isNightSleepWindow() {
        const h = getLondonHour();
        return h >= 23 || h < 7;
    }

    // ---- Helper: derive mood from presence (no Firebase writes) ----
    function getMood() {
        const present = Object.values(onlinePres).filter(v => v && v.state !== 'offline');
        if (present.length >= 2) return 'excited';
        // Drowsy: at least one present but all who are present are idle
        if (present.length > 0 && present.every(v => v.state === 'idle')) return 'drowsy';
        return 'calm';
    }

    // ---- Firebase → receive shared cat state ----
    onValue(catFbRef, snap => {
        const d = snap.val();
        if (!d) return;
        const prevState = fbState;
        fbX         = typeof d.x     === 'number' ? d.x     : 0.5;
        fbDir       = d.dir   || 'right';
        fbState     = d.state || 'walk';
        fbUpdatedAt = d.updatedAt || Date.now();
        // Track when we first see the wakeup state so non-driver can sync the animation
        if (fbState === 'wakeup' && prevState !== 'wakeup') {
            wakeupStartedAt = performance.now();
        }
    });

    // ---- Behaviour system tick (called from driverTick each frame) ----
    // Processes all active behaviours; may override drvX / drvDir / drvState / drvNextAct.
    function behaviourTick(now, dt, speedMult) {

        // ── Attention Mode ───────────────────────────────────────────────────────
        // Triggered by petCat(); cat follows cursor with slight delay for 5–8 s.
        if (bhvAttentionActive) {
            if (now >= bhvAttentionEndAt) {
                // Attention window has expired — resume normal behaviour
                bhvAttentionActive = false;
            } else if (!['sleep', 'wakeup', 'jumping', 'jumpDown', 'perched', 'dazed'].includes(drvState)) {
                const targetX = Math.max(EDGE_PAD, Math.min(1 - EDGE_PAD, lastCursorX));
                const diff    = targetX - drvX;
                if (Math.abs(diff) > 0.02) {
                    // Walk toward cursor with a gentle overshoot prevention
                    drvDir   = diff > 0 ? 'right' : 'left';
                    drvX    += (drvDir === 'right' ? 1 : -1) * WALK_SPEED * speedMult * 1.15 * dt;
                    drvX     = Math.max(EDGE_PAD, Math.min(1 - EDGE_PAD, drvX));
                    drvState = 'walk';
                    drvNextAct = now + 1500; // suppress normal sit transition during following
                } else {
                    // Close enough — do a brief idle near cursor, then creep again next frame
                    if (drvState === 'walk') {
                        drvState   = 'idle';
                        drvIdleEnd = now + 250 + Math.random() * 300;
                    }
                }
            }
        }

        // ── Shy Mode ────────────────────────────────────────────────────────────
        // Triggered after ~15 s of the cat being stationary; cat peeks from behind
        // a nearby window and returns once the user moves the cursor.
        if (!bhvShyActive && !bhvAttentionActive) {
            // Accumulate idle time while cat is not walking
            if (['idle', 'sit', 'sleep', 'wakeup', 'dazed'].includes(drvState)) {
                bhvShyIdleMs += dt;
            } else {
                bhvShyIdleMs = 0; // walking resets the clock
            }

            if (bhvShyIdleMs >= BHV_SHY_MS && !drvRoamingPaused
                && !['sleep', 'jumping', 'jumpDown'].includes(drvState)) {
                const wins = getPerchableWindows();
                if (wins.length > 0) {
                    const win  = wins[Math.floor(Math.random() * wins.length)];
                    const rect = win.getBoundingClientRect();
                    const vw   = window.innerWidth;
                    const catW = CW * S;
                    const catPx = Math.round(drvX * (vw - catW));
                    // Pick the nearer side of the window to hide behind
                    const distLeft  = Math.abs(catPx - rect.left);
                    const distRight = Math.abs(catPx - rect.right);
                    bhvShyHideSide = distLeft <= distRight ? 'left' : 'right';
                    // Peek position: cat mostly hidden, ~10 px of sprite still visible
                    const peekPx = bhvShyHideSide === 'left'
                        ? rect.left - (catW - 10)
                        : rect.right - 10;
                    bhvShyPeekX     = Math.max(EDGE_PAD, Math.min(1 - EDGE_PAD, peekPx / (vw - catW)));
                    bhvShyHideWin   = win;
                    bhvShyActive    = true;
                    bhvShyReturning = false;
                    bhvShyIdleMs    = 0;
                    // Interrupt any current sit/sleep and sneak toward the window
                    drvCallTarget = bhvShyPeekX;
                    drvState      = 'walk';
                    drvNextAct    = now + 9999999;
                }
            }
        }

        if (bhvShyActive) {
            // Window the cat was hiding behind was closed or maximised — cancel shy
            if (bhvShyHideWin && (bhvShyHideWin.classList.contains('is-hidden') ||
                                   bhvShyHideWin.classList.contains('is-maximised'))) {
                bhvShyActive    = false;
                bhvShyReturning = false;
                bhvShyHideWin   = null;
                drvCallTarget   = null;
                bhvShyIdleMs    = 0;
            }

            // User moved the cursor — emerge from hiding
            const userJustMoved = (now - lastCursorMoveAt) < 2500;
            if (!bhvShyReturning && userJustMoved) {
                bhvShyReturning = true;
                drvCallTarget   = null;
                // Slink out to a random open spot, biased away from the hide window
                const vw = window.innerWidth;
                const catW = CW * S;
                const returnX = bhvShyHideSide === 'left'
                    ? 0.5 + Math.random() * (0.5 - EDGE_PAD)  // come out to the right half
                    : EDGE_PAD + Math.random() * 0.5;           // come out to the left half
                drvState   = 'walk';
                drvDir     = returnX > drvX ? 'right' : 'left';
                drvNextAct = now + 3000 + Math.random() * 3000;
                // Store where to walk back to by setting a temporary call target
                drvCallTarget = Math.max(EDGE_PAD, Math.min(1 - EDGE_PAD, returnX));
            }

            // Once the cat has walked back out and settled, deactivate shy mode
            if (bhvShyReturning && (drvState === 'idle' || drvState === 'sit')) {
                bhvShyActive    = false;
                bhvShyReturning = false;
                bhvShyHideWin   = null;
                drvCallTarget   = null;
                bhvShyIdleMs    = 0;
            }
        }

        // ── Copycat ─────────────────────────────────────────────────────────────
        // Cat loosely mirrors cursor movement with a lag and a playful offset.
        // Activates occasionally during autonomous roaming (not during other behaviours).
        if (!bhvCopycatActive && !bhvAttentionActive && !bhvShyActive
            && drvState === 'walk' && drvCallTarget === null
            && now > bhvCopycatEndAt + 20000) { // at least 20 s gap between activations
            // ~30% chance each time the cat transitions from sit back to walking
            // (checked externally via bhvMaybeCopycat flag set in driverTick sit→walk)
        }
        // Note: activation is triggered from the sit→walk transition in driverTick below.

        if (bhvCopycatActive) {
            if (now >= bhvCopycatEndAt || bhvAttentionActive || bhvShyActive) {
                bhvCopycatActive = false;
            } else if (drvState === 'walk' && drvCallTarget === null) {
                // Look up the cursor position from COPYCAT_DELAY_MS ago
                let delayedX = lastCursorX;
                const targetTs = now - COPYCAT_DELAY_MS;
                for (let i = bhvCopycatBuf.length - 1; i >= 0; i--) {
                    if (bhvCopycatBuf[i].ts <= targetTs) {
                        delayedX = bhvCopycatBuf[i].x;
                        break;
                    }
                }
                // Steer direction to match delayed cursor + offset (without overriding speed)
                const copycatTarget = Math.max(EDGE_PAD, Math.min(1 - EDGE_PAD,
                                          delayedX + bhvCopycatOffsetX));
                const diff = copycatTarget - drvX;
                if (Math.abs(diff) > 0.04) {
                    drvDir = diff > 0 ? 'right' : 'left';
                }
                // Keep the normal walk-to-sit timer alive so cat doesn't walk forever
                if (drvNextAct < now + 800) drvNextAct = now + 1200 + Math.random() * 1500;
            }
        }
    }

    // ---- Driver behaviour tick (runs every animation frame) ----
    function driverTick(now, dt) {
        const nightSleep = isNightSleepWindow();
        const mood = getMood();

        // Mood multipliers derived locally from presence — no extra Firebase writes
        const speedMult   = mood === 'excited' ? 1.3  : (mood === 'drowsy' ? 0.45 : 0.78);
        const sitMinMult  = mood === 'excited' ? 0.55 : (mood === 'drowsy' ? 2.2  : 1.5);
        const sleepProb   = mood === 'excited' ? 0    : (mood === 'drowsy' ? 0.72 : (mood === 'calm' ? 0.38 : SLEEP_P));
        const sitGapBase  = mood === 'excited' ? 3000 : (mood === 'drowsy' ? 12000 : 7000); // ms gap between sits

        // ---- Run the behaviour system before the main state machine ----
        behaviourTick(now, dt, speedMult);

        // ---- Night-time forced sleep (23:00–07:00 Europe/London) ----
        if (nightSleep) {
            if (drvState !== 'sleep') drvState = 'sleep';
            drvWasNightSleep = true;
            // Write at low frequency so all clients see the sleep state
            if (now - lastFbWrite > FB_INTERVAL) {
                lastFbWrite = now;
                set(catFbRef, {
                    x: drvX, dir: drvDir, state: 'sleep',
                    updatedAt: now, driverUserId: currentUser,
                }).catch(() => {});
            }
            return; // no movement during night window
        }

        // ---- Waking up: first tick after night window ends ----
        if (drvWasNightSleep) {
            drvWasNightSleep = false;
            drvState     = 'wakeup';
            drvWakeStart = now;
        }

        // ---- Forced nap (Cat.exe "Nap" command) ----
        if (drvForcedNapEnd > now) {
            if (drvState !== 'sleep') drvState = 'sleep';
            // If napping on a perch, track the window so the cat stays on it;
            // drop off if the window is closed or maximised.
            if (drvPerchTarget) {
                const napPerchGone = drvPerchTarget.winEl.classList.contains('is-hidden') ||
                                     drvPerchTarget.winEl.classList.contains('is-maximised');
                if (!napPerchGone) {
                    const { px: curPx } = calcPerchPos(drvPerchTarget.winEl, drvPerchTarget.side);
                    drvX = Math.max(EDGE_PAD, Math.min(1 - EDGE_PAD, curPx / (window.innerWidth - CW * S)));
                } else {
                    drvPerchTarget  = null;
                    drvPerchLastPos = null;
                }
            }
            if (now - lastFbWrite > FB_INTERVAL) {
                lastFbWrite = now;
                set(catFbRef, { x: drvX, dir: drvDir, state: 'sleep', updatedAt: now, driverUserId: currentUser }).catch(() => {});
            }
            return;
        }
        // Transition out of forced nap once timer expires
        if (drvState === 'sleep' && drvForcedNapEnd > 0 && drvForcedNapEnd <= now) {
            drvForcedNapEnd = 0;
            if (drvPerchTarget) {
                // Wake up still on the window; let the perched state machine take over
                drvState    = 'perched';
                drvPerchEnd = now + 1000 + Math.random() * 2000; // linger briefly then jump down
            } else {
                drvState     = 'wakeup';
                drvWakeStart = now;
            }
        }

        // ---- State machine (daytime only) ----
        if (drvState === 'wakeup') {
            // Hold wakeup pose ~3 s, then stand and walk
            if (now - drvWakeStart > 3000) {
                drvState   = 'walk';
                drvNextAct = now + 4000 + Math.random() * 5000;
            }
            // no movement during wakeup

        } else if (drvState === 'walk') {
            if (drvCallTarget !== null) {
                // Walk toward the Cat.exe-requested target position
                const diff = drvCallTarget - drvX;
                if (Math.abs(diff) < 0.05) {
                    // Arrived at the window edge
                    drvCallTarget = null;
                    const perchWin = drvCallPerchWin;
                    drvCallPerchWin = null;
                    if (perchWin && !perchWin.classList.contains('is-hidden') &&
                                    !perchWin.classList.contains('is-maximised')) {
                        // Jump up onto the window
                        const vw       = window.innerWidth;
                        const catW     = CW * S;
                        const catPx    = Math.round(drvX * (vw - catW));
                        const rect     = perchWin.getBoundingClientRect();
                        const side     = catPx < rect.left + rect.width / 2 ? 'left' : 'right';
                        drvPerchTarget = { winEl: perchWin, side };
                        const groundY  = window.innerHeight - 44 - CH * S;
                        const { px: tpx, py: tpy } = calcPerchPos(perchWin, side);
                        drvJumpStartX  = catPx;
                        drvJumpStartY  = groundY;
                        drvJumpTargetX = tpx;
                        drvJumpTargetY = tpy;
                        drvJumpTime    = now;
                        drvPerchLastPos = null;
                        drvDir         = tpx > catPx ? 'right' : 'left';
                        drvState       = 'jumping';
                    } else {
                        // Window gone or closed — just sit
                        drvState  = 'sit';
                        const sitDur = (SIT_MIN * sitMinMult) + Math.random() * (SIT_MAX - SIT_MIN);
                        drvSitEnd  = now + sitDur;
                        drvNextAct = drvSitEnd + sitGapBase + Math.random() * 5000;
                    }
                } else {
                    drvDir = diff > 0 ? 'right' : 'left';
                    drvX  += (drvDir === 'right' ? 1 : -1) * WALK_SPEED * speedMult * dt;
                    if (drvX >= 1 - EDGE_PAD) { drvX = 1 - EDGE_PAD; drvDir = 'left'; }
                    if (drvX <= EDGE_PAD)     { drvX = EDGE_PAD;     drvDir = 'right'; }
                    // If the call-perch window was closed mid-walk, drop the perch intent
                    if (drvCallPerchWin && drvCallPerchWin.classList.contains('is-hidden')) {
                        drvCallPerchWin = null;
                    }
                }
            } else {
                drvX += (drvDir === 'right' ? 1 : -1) * WALK_SPEED * speedMult * dt;
                if (drvX >= 1 - EDGE_PAD) { drvX = 1 - EDGE_PAD; drvDir = 'left'; }
                if (drvX <= EDGE_PAD)     { drvX = EDGE_PAD;     drvDir = 'right'; }
                if (now > drvNextAct) {
                    // Pause in idle briefly before deciding what to do next
                    drvState   = 'idle';
                    drvIdleEnd = now + IDLE_MIN + Math.random() * (IDLE_MAX - IDLE_MIN);
                }
            }

        } else if (drvState === 'idle') {
            // Cat glances around; once done, decides to perch or sit
            if (now > drvIdleEnd) {
                if (drvRoamingPaused) {
                    // Roaming paused: settle into a sit instead of walking again
                    drvState  = 'sit';
                    drvSitEnd = now + 4000 + Math.random() * 3000;
                    drvNextAct = now + 9999999; // won't auto-walk while paused
                } else {
                const perchWins = getPerchableWindows();
                if (perchWins.length > 0 && Math.random() < 0.30) {
                    // Choose a window; only jump if the cat is physically next to it
                    const targetWin = perchWins[Math.floor(Math.random() * perchWins.length)];
                    const vw        = window.innerWidth;
                    const catW      = CW * S;
                    const catPx     = Math.round(drvX * (vw - catW));
                    const wRect     = targetWin.getBoundingClientRect();
                    // Horizontal gap: positive = cat is outside the window's x-span
                    const hDistL    = wRect.left - (catPx + catW); // gap if cat is left of window
                    const hDistR    = catPx - wRect.right;          // gap if cat is right of window
                    const hDist     = Math.max(0, Math.max(hDistL, hDistR));
                    if (hDist <= PERCH_PROX_PX) {
                        // Close enough — jump up onto the window
                        const side      = Math.random() < 0.5 ? 'left' : 'right';
                        drvPerchTarget  = { winEl: targetWin, side };
                        const groundY   = window.innerHeight - 44 - CH * S;
                        const startPixX = catPx;
                        const { px: tpx, py: tpy } = calcPerchPos(targetWin, side);
                        drvJumpStartX  = startPixX;
                        drvJumpStartY  = groundY;
                        drvJumpTargetX = tpx;
                        drvJumpTargetY = tpy;
                        drvJumpTime    = now;
                        drvPerchLastPos = null;
                        // Face the target window before leaping
                        drvDir   = tpx > startPixX ? 'right' : 'left';
                        drvState = 'jumping';
                    } else {
                        // Too far away — sit instead of teleporting across the screen
                        drvState  = 'sit';
                        const sitDur = (SIT_MIN * sitMinMult) + Math.random() * (SIT_MAX - SIT_MIN);
                        drvSitEnd  = now + sitDur;
                        drvNextAct = drvSitEnd + sitGapBase + Math.random() * 5000;
                    }
                } else {
                    drvState  = 'sit';
                    const sitDur = (SIT_MIN * sitMinMult) + Math.random() * (SIT_MAX - SIT_MIN);
                    drvSitEnd  = now + sitDur;
                    drvNextAct = drvSitEnd + sitGapBase + Math.random() * 5000;
                }
                } // end else (not roaming paused)
            }

        } else if (drvState === 'jumping') {
            // Arc from ground to window title bar; no explicit position update here —
            // the render loop calculates the arc position directly.
            const t = Math.min(1, (now - drvJumpTime) / JUMP_DURATION);
            if (t >= 1) {
                // Arrived at perch — normalise drvX to the perch pixel x
                drvX        = Math.max(EDGE_PAD, Math.min(1 - EDGE_PAD,
                                  drvJumpTargetX / (window.innerWidth - CW * S)));
                drvPerchLastPos = null; // start fresh for shake detection
                drvState    = 'perched';
                drvPerchEnd = now + 4000 + Math.random() * 6000; // sit 4–10 s
            }

        } else if (drvState === 'perched') {
            // Cat sits on the window title bar; leave when timer expires or window goes away
            const gone = !drvPerchTarget ||
                         drvPerchTarget.winEl.classList.contains('is-hidden') ||
                         drvPerchTarget.winEl.classList.contains('is-maximised');

            // Detect rapid window movement (shake) — cat loses balance and falls off
            let shakenOff = false;
            let knockedOffByHeight = false;
            if (!gone && drvPerchTarget) {
                const { px: curPx, py: curPy } = calcPerchPos(drvPerchTarget.winEl, drvPerchTarget.side);
                drvPerchLastPixel = { px: curPx, py: curPy }; // save for fall start position
                if (drvPerchLastPos !== null) {
                    const elapsed = now - drvPerchLastPos.ts;
                    if (elapsed > 0) {
                        const dx = curPx - drvPerchLastPos.x;
                        const dy = curPy - drvPerchLastPos.y;
                        if (Math.sqrt(dx * dx + dy * dy) / elapsed > SHAKE_THRESHOLD) {
                            shakenOff = true;
                        }
                    }
                }
                drvPerchLastPos = { x: curPx, y: curPy, ts: now };
                // Detect window dragged too high — no room above title bar for cat to sit
                const rect = drvPerchTarget.winEl.getBoundingClientRect();
                if (rect.top < CH * S) {
                    knockedOffByHeight = true;
                }
            } else {
                drvPerchLastPos = null;
            }

            if (gone || shakenOff || knockedOffByHeight || now > drvPerchEnd) {
                const windowClosed = drvPerchTarget?.winEl.classList.contains('is-hidden');
                drvPerchLastPos = null;
                // Compute jump-down arc back to the ground
                const vw      = window.innerWidth;
                const groundY = window.innerHeight - 44 - CH * S;
                // Start from last saved perch pos, live pos, or approximate pos
                const { px: spx, py: spy } = (!gone)
                    ? calcPerchPos(drvPerchTarget.winEl, drvPerchTarget.side)
                    : (drvPerchLastPixel || { px: Math.round(drvX * (vw - CW * S)), py: 0 });
                // Land somewhere near the window, with a little randomness
                const landX = Math.max(CW * S,
                                Math.min(vw - CW * S * 2,
                                    spx + (Math.random() - 0.5) * 160));
                drvJumpStartX  = spx;
                drvJumpStartY  = spy;
                drvJumpTargetX = landX;
                drvJumpTargetY = groundY;
                drvJumpTime    = now;
                drvDir     = landX > spx ? 'right' : 'left';
                drvFalling = !!(windowClosed || shakenOff || knockedOffByHeight); // true = uncontrolled fall → dazed landing
                drvState   = 'jumpDown';
                drvPerchLastPixel = null;
                if (gone || shakenOff || knockedOffByHeight) drvPerchTarget = null;
            }

        } else if (drvState === 'jumpDown') {
            const t = Math.min(1, (now - drvJumpTime) / JUMP_DURATION);
            if (t >= 1) {
                // Landed — convert pixel landing x back to normalised drvX
                drvX           = Math.max(EDGE_PAD, Math.min(1 - EDGE_PAD,
                                    drvJumpTargetX / (window.innerWidth - CW * S)));
                drvPerchTarget = null;
                const wasFalling = drvFalling;
                drvFalling     = false;
                if (wasFalling) {
                    // Hard landing: sit dazed for a couple of seconds before running off
                    drvState    = 'dazed';
                    drvDazedEnd = now + DAZE_DURATION;
                } else {
                    drvState   = 'walk';
                    drvNextAct = now + 3000 + Math.random() * 4000;
                }
            }

        } else if (drvState === 'dazed') {
            if (now > drvDazedEnd) {
                drvState   = 'walk';
                drvNextAct = now + 3000 + Math.random() * 4000;
            }

        } else if (drvState === 'sit') {
            if (now > drvSitEnd) {
                if (Math.random() < sleepProb) {
                    drvState  = 'sleep';
                    drvSitEnd = now + 5000 + Math.random() * 10000;
                } else if (drvRoamingPaused) {
                    // Stay sitting while roaming is paused
                    drvSitEnd = now + 4000 + Math.random() * 3000;
                } else {
                    drvState = 'walk';
                    // 30% chance to activate Copycat when resuming a walk (not during other behaviours)
                    if (!bhvCopycatActive && !bhvAttentionActive && !bhvShyActive
                        && now > bhvCopycatEndAt + 20000 && Math.random() < 0.30) {
                        bhvCopycatActive  = true;
                        bhvCopycatEndAt   = now + 10000 + Math.random() * 10000; // 10–20 s
                        // Random offset: cat aims for cursor ± up to 12% of screen width
                        bhvCopycatOffsetX = (Math.random() - 0.5) * 0.24;
                    }
                }
            }

        } else { // random sleep (only reachable outside night window)
            if (now > drvSitEnd) {
                drvState  = 'sit';
                drvSitEnd = now + SIT_MIN + Math.random() * (SIT_MAX - SIT_MIN);
            }
        }

        // ---- Activity log: state-change events (driver only) ----
        if (drvState !== _prevDrvState) {
            const prev = _prevDrvState;
            _prevDrvState = drvState;
            if (prev !== null) {
                if (drvState === 'walk' && prev !== 'wakeup' && prev !== 'jumping' && prev !== 'jumpDown') {
                    if (Math.random() < 0.3) window._catLog?.('Cat wandered across the desktop');
                } else if (drvState === 'sleep' && prev !== 'sleep' && drvForcedNapEnd <= now) {
                    window._catLog?.('Cat curled up to sleep');
                } else if (drvState === 'wakeup') {
                    window._catLog?.('Cat woke up');
                } else if (drvState === 'perched') {
                    window._catLog?.('Cat perched on a window');
                }
            }
        }

        // ---- Gift drop (daytime only, driver only) ----
        if (now - lastGiftCheckAt > GIFT_CHECK_MS) {
            lastGiftCheckAt = now;
            checkGiftEligibility();
        }
        if (giftDropArmed && drvState === 'walk' && (now - lastGiftRollAt) > GIFT_ROLL_MS) {
            lastGiftRollAt = now;
            if (Math.random() < GIFT_ROLL_CHANCE) dropGift();
        }

        // Push to Firebase at low frequency.
        // Local-only states are hidden from remote clients:
        //   idle / perched → 'sit'   (cat is stationary)
        //   jumping / jumpDown → 'walk' (cat is in motion)
        const LOCAL_ONLY = { idle: 'sit', perched: 'sit', jumping: 'walk', jumpDown: 'walk', dazed: 'sit' };
        const fbWriteState = LOCAL_ONLY[drvState] || drvState;
        if (now - lastFbWrite > FB_INTERVAL) {
            lastFbWrite = now;
            set(catFbRef, {
                x: drvX, dir: drvDir, state: fbWriteState,
                updatedAt: now, driverUserId: currentUser,
            }).catch(() => {});
        }
    }

    // ---- Target x for the non-driving client ----
    // Extrapolate from the last known position + direction so the cat
    // keeps moving smoothly between Firebase snapshots.
    function remoteTargetX(now) {
        if (fbState !== 'walk') return fbX; // sleep / sit / wakeup: stay put
        const elapsed = now - fbUpdatedAt;
        // Mirror the driver's mood-adjusted speed so extrapolation stays in sync
        const _rm = getMood();
        const rSpeedMult = _rm === 'excited' ? 1.3 : (_rm === 'drowsy' ? 0.45 : 0.78);
        const dx = (fbDir === 'right' ? 1 : -1) * WALK_SPEED * rSpeedMult * elapsed;
        return Math.max(EDGE_PAD, Math.min(1 - EDGE_PAD, fbX + dx));
    }

    // ---- Pixel-art draw ----
    function drawSprite(name, flip) {
        const grid = FRAMES[name];
        if (!grid) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (flip) { ctx.save(); ctx.scale(-1, 1); ctx.translate(-canvas.width, 0); }
        for (let r = 0; r < grid.length; r++) {
            for (let c = 0; c < grid[r].length; c++) {
                const v = grid[r][c];
                if (!v) continue;
                ctx.fillStyle = CLR[v];
                ctx.fillRect(c * S, r * S, S, S);
            }
        }
        if (flip) ctx.restore();
    }

    // ---- Main animation loop ----
    let lastTs = performance.now();
    let _prevRenderState = null;  // tracks previous cat state for ambient stretch trigger

    function loop(now) {
        const dt = Math.min(now - lastTs, 100); // cap delta so a tab-wake doesn't teleport the cat
        lastTs = now;
        try {

        if (isDriver) driverTick(now, dt);

        // Which state & direction to render
        const catState = isDriver ? drvState : fbState;
        const catDir   = isDriver ? drvDir   : fbDir;

        // Ambient: brief stretch when cat stops walking and settles
        if (catState !== _prevRenderState) {
            if (_prevRenderState === 'walk' && (catState === 'idle' || catState === 'sit')) {
                if (Math.random() < 0.35 && !canvas.classList.contains('cat-bounce')) {
                    canvas.classList.remove('cat-stretch');
                    void canvas.offsetWidth;
                    canvas.classList.add('cat-stretch');
                }
            }
            if (catState === 'sleep') startSleepZzz();
            else if (_prevRenderState === 'sleep') stopSleepZzz();
            _prevRenderState = catState;
        }
        // Settled visual: soft green glow when driver has roaming paused
        canvas.classList.toggle('cat-settled', isDriver && drvRoamingPaused && catState === 'sit');

        // Walk animation frame toggle
        if (catState === 'walk' && now - lastFlip > WALK_FPS) {
            animIdx  = 1 - animIdx;
            lastFlip = now;
        }

        // Smooth local position
        const targetX = isDriver ? drvX : remoteTargetX(now);
        localX += (targetX - localX) * Math.min(1, LERP_K * dt);

        // Position the canvas: jump arc → perched on title bar → ground
        const vw = window.innerWidth;
        const isJumping  = isDriver && (drvState === 'jumping' || drvState === 'jumpDown');
        const isPerching = isDriver && (drvState === 'perched' || (drvState === 'sleep' && drvPerchTarget !== null)) && drvPerchTarget &&
                           !drvPerchTarget.winEl.classList.contains('is-hidden');

        if (isJumping) {
            const t = Math.min(1, (now - drvJumpTime) / JUMP_DURATION);
            let px, py;
            if (drvState === 'jumpDown' && drvFalling) {
                // Gravity fall: ease-in vertical (accelerates downward), no upward arc
                const gravEase = t * t; // ease-in = gravity acceleration
                const hEase    = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
                px = drvJumpStartX + (drvJumpTargetX - drvJumpStartX) * hEase;
                py = drvJumpStartY + (drvJumpTargetY - drvJumpStartY) * gravEase;
            } else {
                // Parabolic arc: ease-in-out horizontal, sine-arch vertical (always curves upward)
                const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t; // ease-in-out quadratic
                px = drvJumpStartX + (drvJumpTargetX - drvJumpStartX) * ease;
                py = drvJumpStartY + (drvJumpTargetY - drvJumpStartY) * ease
                     - JUMP_ARC * Math.sin(Math.PI * t); // negative = arcs upward
            }
            localX = px / (vw - CW * S); // keep localX in sync so landing has no slide
            canvas.style.left   = Math.round(px) + 'px';
            canvas.style.top    = Math.round(py) + 'px';
            canvas.style.bottom = 'auto';
            canvas.style.zIndex = '155';
            emoteEl.style.left   = Math.round(px) + 'px';
            emoteEl.style.top    = Math.round(py + CH * S) + 'px';
            emoteEl.style.bottom = 'auto';
            emoteEl.style.zIndex = '156';
            zzzEl.style.left   = Math.round(px) + 'px';
            zzzEl.style.top    = Math.round(py) + 'px';
            zzzEl.style.bottom = 'auto';
            zzzEl.style.zIndex = '157';
            accEl.style.left   = Math.round(px) + 'px';
            accEl.style.top    = Math.round(py + _catAccOverlayTopOffset) + 'px';
            accEl.style.bottom = 'auto';
            accEl.style.zIndex = '158';
        } else if (isPerching) {
            const { px, py } = calcPerchPos(drvPerchTarget.winEl, drvPerchTarget.side);
            canvas.style.left   = px + 'px';
            canvas.style.top    = py + 'px';
            canvas.style.bottom = 'auto';
            // Render above the target window without blocking pointer events
            const winZ = parseInt(drvPerchTarget.winEl.style.zIndex) || 2000;
            canvas.style.zIndex = (winZ + 1) + '';
            emoteEl.style.left   = px + 'px';
            emoteEl.style.top    = (py + CH * S) + 'px';
            emoteEl.style.bottom = 'auto';
            emoteEl.style.zIndex = (winZ + 2) + '';
            zzzEl.style.left   = px + 'px';
            zzzEl.style.top    = py + 'px';
            zzzEl.style.bottom = 'auto';
            zzzEl.style.zIndex = (winZ + 3) + '';
            accEl.style.left   = px + 'px';
            accEl.style.top    = (py + _catAccOverlayTopOffset) + 'px';
            accEl.style.bottom = 'auto';
            accEl.style.zIndex = (winZ + 4) + '';
        } else {
            canvas.style.left   = `${Math.round(localX * (vw - CW * S))}px`;
            canvas.style.top    = 'auto';
            canvas.style.bottom = '44px';
            // Shy Mode: lower z-index so the cat renders behind the hide window
            if (isDriver && bhvShyActive && !bhvShyReturning && bhvShyHideWin
                && !bhvShyHideWin.classList.contains('is-hidden')) {
                const hideWinZ = parseInt(bhvShyHideWin.style.zIndex) || 2000;
                canvas.style.zIndex  = (hideWinZ - 1) + '';
                emoteEl.style.zIndex = (hideWinZ - 1) + '';
            } else {
                canvas.style.zIndex  = '150';
                emoteEl.style.zIndex = '151';
            }
            emoteEl.style.left   = canvas.style.left;
            emoteEl.style.top    = 'auto';
            emoteEl.style.bottom = '44px';
            zzzEl.style.left   = canvas.style.left;
            zzzEl.style.top    = 'auto';
            zzzEl.style.bottom = (44 + CH * S) + 'px';
            zzzEl.style.zIndex = '152';
            accEl.style.left   = canvas.style.left;
            accEl.style.top    = 'auto';
            accEl.style.bottom = (44 + CH * S - _catAccOverlayTopOffset) + 'px';
            accEl.style.zIndex = '153';
        }

        // Mirror canvas position to the interactive hit area overlay
        hitArea.style.left   = canvas.style.left;
        hitArea.style.top    = canvas.style.top;
        hitArea.style.bottom = canvas.style.bottom;

        // Choose sprite frame
        // For wakeup, cycle: sleep (0-1 s) → wakeup half-open (1-2 s) → sit (2-3 s)
        const wakeElapsed = catState === 'wakeup'
            ? (isDriver ? now - drvWakeStart : now - wakeupStartedAt)
            : 0;
        let frame;
        if (now < surpriseEnd)                                        frame = 'surprise';
        else if (catState === 'wakeup')                               frame = wakeElapsed < 1000 ? 'sleep' : wakeElapsed < 2000 ? 'wakeup' : 'sit';
        else if (catState === 'dazed')                                frame = 'dazed';
        else if (catState === 'sit' || catState === 'perched')        frame = 'sit';
        else if (catState === 'idle')                                 frame = 'idle';
        else if (catState === 'jumping' || catState === 'jumpDown')   frame = 'jump';
        else if (catState === 'sleep')                                frame = 'sleep';
        else                                                          frame = animIdx === 0 ? 'walkA' : 'walkB';

        drawSprite(frame, catDir === 'left');
        } catch (e) { console.error('[cat]', e); }
        requestAnimationFrame(loop);
    }

    requestAnimationFrame(loop);

    // ---- Mood bounce: excited mode triggers periodic spontaneous bounces ----
    // Derived locally from onlinePres — no Firebase writes required.
    (function scheduleMoodBounce() {
        const mood = getMood();
        // excited: bounce every 8-14 s while walking; calm/single: no spontaneous bounces
        if (mood === 'excited') {
            const catState = isDriver ? drvState : fbState;
            if (catState === 'walk') {
                canvas.classList.remove('cat-bounce');
                void canvas.offsetWidth;
                canvas.classList.add('cat-bounce');
            }
        }
        const delay = mood === 'excited'
            ? 8000 + Math.random() * 6000
            : 20000 + Math.random() * 10000;
        setTimeout(scheduleMoodBounce, delay);
    }());

    // ---- Click detection (canvas has pointer-events:none, so listen on document) ----
    document.addEventListener('click', e => {
        const r = canvas.getBoundingClientRect();
        if (e.clientX >= r.left && e.clientX <= r.right &&
            e.clientY >= r.top  && e.clientY <= r.bottom) {
            surpriseEnd = performance.now() + 700;
            canvas.classList.remove('cat-bounce');
            void canvas.offsetWidth;            // force reflow to restart animation
            canvas.classList.add('cat-bounce');
        }
    });
    canvas.addEventListener('animationend', () => {
        canvas.classList.remove('cat-bounce');
        canvas.classList.remove('cat-yarn-zoom');
        canvas.classList.remove('cat-stretch');
        canvas.classList.remove('cat-grumpy');
    });

    // Expose local-only animation helpers for Cat.exe window (no Firebase sync).
    window._catLocalEmote = triggerEmote;
    window._catLocalGrumpy = function() {
        triggerEmote('grumpy');
        canvas.classList.remove('cat-grumpy');
        void canvas.offsetWidth;
        canvas.classList.add('cat-grumpy');
    };
    window._catLocalYarnZoom = function () {
        canvas.classList.remove('cat-yarn-zoom');
        void canvas.offsetWidth; // force reflow to restart
        canvas.classList.add('cat-yarn-zoom');
    };

    // ---- Cat controller: shared interface for Cat.exe control panel ----
    // All movement commands are driver-only (only one client controls cat position).
    // Emote commands (pet) always work via Firebase and are visible to all clients.
    window._catController = {

        // Returns a readable status string for the desktop cat status line.
        getDesktopState() {
            const now = performance.now();
            if (isDriver) {
                if (drvForcedNapEnd > now)     return 'napping';
                if (drvCallTarget !== null)    return 'following';
                if (drvRoamingPaused)          return 'paused';
                switch (drvState) {
                    case 'walk':     return 'roaming';
                    case 'sit':      return 'sitting';
                    case 'idle':     return 'sitting';
                    case 'sleep':    return 'sleeping';
                    case 'wakeup':   return 'waking up';
                    case 'perched':  return 'perched';
                    case 'jumping':
                    case 'jumpDown': return 'jumping';
                    default:         return drvState;
                }
            } else {
                switch (fbState) {
                    case 'walk':   return 'roaming';
                    case 'sit':    return 'sitting';
                    case 'sleep':  return 'sleeping';
                    case 'wakeup': return 'waking up';
                    default:       return fbState;
                }
            }
        },

        // Returns true while the cat is in sleep state (visible from Cat.exe).
        isSleeping() {
            return (isDriver ? drvState : fbState) === 'sleep';
        },

        // Immediately end a forced nap and transition to wakeup (driver only).
        wakeCat() {
            if (!isDriver) return;
            drvForcedNapEnd = 0;
            if (drvState === 'sleep') {
                drvWakeStart = performance.now();
                drvState = 'wakeup';
            }
            stopSleepZzz();
        },

        // Walk the desktop cat to the edge of the Cat.exe window, then jump on top.
        // Returns 'already_here' if the cat is already perched/napping on Cat.exe.
        callCat() {
            if (!isDriver) { fireCatEvent('sparkle'); return; }
            const catWin = document.getElementById('w95-win-cat');
            if (!catWin || catWin.classList.contains('is-hidden')) return;
            // If the cat is already perched on (or napping on) the Cat.exe window, do nothing.
            const alreadyThere = drvPerchTarget?.winEl === catWin &&
                                 (drvState === 'perched' || drvState === 'sleep');
            if (alreadyThere) return 'already_here';
            const rect   = catWin.getBoundingClientRect();
            const catH   = CH * S;
            if (rect.top < catH) return 'no_room';
            const vw     = window.innerWidth;
            const catW   = CW * S;
            // Approach the nearer edge so the cat walks up beside the window, not through it
            const catPx    = Math.round(drvX * (vw - catW));
            const midWin   = rect.left + rect.width / 2;
            const targetPx = catPx < midWin
                ? rect.left - catW  // cat comes from the left, stops at left edge
                : rect.right;       // cat comes from the right, stops at right edge
            drvCallTarget   = Math.max(EDGE_PAD, Math.min(1 - EDGE_PAD, targetPx / (vw - catW)));
            drvCallPerchWin = catWin;
            drvForcedNapEnd = 0;
            drvPerchTarget  = null;
            drvPerchLastPos = null;
            // Wake the cat from any stationary/perched state
            if (drvState !== 'walk') {
                drvState   = 'walk';
                drvNextAct = performance.now() + 9999999; // call target handles the transition
            }
        },

        // Toggle autonomous roaming on/off. Returns the new paused state.
        toggleRoaming() {
            drvRoamingPaused = !drvRoamingPaused;
            if (!drvRoamingPaused && (drvState === 'idle' || drvState === 'sit')) {
                // Resume: walk again
                drvState   = 'walk';
                drvNextAct = performance.now() + 5000 + Math.random() * 5000;
            }
            return drvRoamingPaused;
        },

        isRoamingPaused() { return drvRoamingPaused; },

        // Force the desktop cat to take a nap (15–25 s).
        napCat() {
            drvForcedNapEnd = performance.now() + 15000 + Math.random() * 10000;
            drvCallTarget   = null;
            drvCallPerchWin = null;
            // If cat is currently perched, let it nap there; only clear perch data otherwise
            if (drvState !== 'perched') {
                drvPerchTarget  = null;
                drvPerchLastPos = null;
            }
            if (drvState !== 'sleep') drvState = 'sleep';
        },

        // Trigger a happy reaction on the desktop cat (sparkle emotes + bounce).
        petCat() {
            fireCatEvent('heart');
            triggerEmote('heart');
            canvas.classList.remove('cat-bounce');
            void canvas.offsetWidth;
            canvas.classList.add('cat-bounce');
            // Activate Attention Mode: cat follows cursor for 5–8 s
            if (isDriver) {
                bhvAttentionActive = true;
                bhvAttentionEndAt  = performance.now() + 5000 + Math.random() * 3000;
                // Cancel any conflicting behaviours
                bhvShyActive       = false;
                bhvShyReturning    = false;
                bhvCopycatActive   = false;
                drvCallTarget      = null;
            }
        },

        // Called when Cat.exe window is opened: cat notices and walks over to jump on top.
        onCatOpen() {
            if (!isDriver) return;
            const catWin = document.getElementById('w95-win-cat');
            if (!catWin || catWin.classList.contains('is-hidden')) return;
            const rect   = catWin.getBoundingClientRect();
            const vw     = window.innerWidth;
            const catW   = CW * S;
            // Approach the nearer edge (same logic as callCat)
            const catPx    = Math.round(drvX * (vw - catW));
            const midWin   = rect.left + rect.width / 2;
            const targetPx = catPx < midWin
                ? rect.left - catW
                : rect.right;
            drvCallTarget   = Math.max(EDGE_PAD, Math.min(1 - EDGE_PAD, targetPx / (vw - catW)));
            drvCallPerchWin = catWin;
            drvForcedNapEnd = 0;
            drvPerchTarget  = null;
            drvPerchLastPos = null;
            if (drvState !== 'walk') {
                drvState   = 'walk';
                drvNextAct = performance.now() + 9999999;
            }
            // Brief surprise expression before walking over
            surpriseEnd = performance.now() + 700;
        },
    };
}

// ===== Unified Context Menu (event delegation) =====
(() => {
    const desktop    = document.getElementById('w95-desktop');
    const deskMenu   = document.getElementById('w95-ctx-menu');
    const iconMenu   = document.getElementById('w95-icon-ctx-menu');
    const winMenu    = document.getElementById('w95-win-ctx-menu');
    const catMenu    = document.getElementById('w95-cat-ctx-menu');
    if (!desktop || !deskMenu) return;

    // Track which icon / window was right-clicked so action buttons can reference it
    let _targetIcon = null;
    let _targetWin  = null;

    // --- Helpers ---
    function placeMenu(menu, x, y) {
        menu.classList.remove('is-hidden');
        const mw = menu.offsetWidth;
        const mh = menu.offsetHeight;
        menu.style.left = Math.max(0, Math.min(x, window.innerWidth  - mw - 2)) + 'px';
        menu.style.top  = Math.max(0, Math.min(y, window.innerHeight - mh - 2)) + 'px';
    }

    function hideAll() {
        deskMenu?.classList.add('is-hidden');
        iconMenu?.classList.add('is-hidden');
        winMenu?.classList.add('is-hidden');
        catMenu?.classList.add('is-hidden');
    }

    // --- Single contextmenu listener (event delegation) ---
    document.addEventListener('contextmenu', e => {
        e.preventDefault();
        hideAll();
        _targetIcon = null;
        _targetWin  = null;

        // Don't show context menu while an icon rename is in progress
        if (e.target.classList.contains('icon-rename-input')) return;

        const catEl  = e.target.closest('#cat-hit-area');
        const iconEl = e.target.closest('.w95-desktop-icon, .exe-icon');
        const winEl  = e.target.closest('.w95-window');

        if (catEl) {
            if (catMenu) placeMenu(catMenu, e.clientX, e.clientY);
        } else if (iconEl) {
            _targetIcon = iconEl;
            if (iconMenu) placeMenu(iconMenu, e.clientX, e.clientY);
        } else if (winEl) {
            _targetWin = winEl;
            if (winMenu) placeMenu(winMenu, e.clientX, e.clientY);
        } else {
            updateAutoArrangeLabel();
            placeMenu(deskMenu, e.clientX, e.clientY);
        }
    });

    // Close all menus on left-click outside any menu
    document.addEventListener('click', e => {
        if (!deskMenu.contains(e.target) && !iconMenu?.contains(e.target) && !winMenu?.contains(e.target)) {
            hideAll();
        }
    });

    // Close on Escape, scroll, resize
    document.addEventListener('keydown', e => { if (e.key === 'Escape') hideAll(); });
    window.addEventListener('scroll',    hideAll, { passive: true });
    window.addEventListener('resize',    hideAll, { passive: true });

    // ===== Desktop menu actions =====

    document.getElementById('ctx-refresh')?.addEventListener('click', () => {
        hideAll();
        desktop.style.opacity = '0.5';
        setTimeout(() => { desktop.style.opacity = ''; }, 120);
    });

    document.getElementById('ctx-arrange-name')?.addEventListener('click', () => {
        hideAll();
        arrangeByName();
    });

    document.getElementById('ctx-auto-arrange')?.addEventListener('click', () => {
        hideAll();
        const prefs = getDesktopPrefs();
        prefs.autoArrange = !prefs.autoArrange;
        saveDesktopPrefs(prefs);
        if (prefs.autoArrange) arrangeByName();
        updateAutoArrangeLabel();
    });

    document.getElementById('ctx-new-folder')?.addEventListener('click', () => {
        hideAll();
        openW95Prompt({
            icon: '📁',
            title: 'New Folder',
            message: 'Enter a name for the new folder:',
            defaultValue: 'New Folder',
            onOK: name => {
                const item = { id: 'custom_' + Date.now(), type: 'folder', name };
                const items = window._desktopCustom.getItems();
                items.push(item);
                window._desktopCustom.saveItems(items);
                window._desktopCustom.createIcon(item);
            }
        });
    });

    document.getElementById('ctx-new-shortcut')?.addEventListener('click', () => {
        hideAll();

        function isAppOnDesktop(appKey) {
            if (document.querySelector(`.w95-desktop-icon[data-app="${appKey}"]:not(.is-hidden)`)) return true;
            return (window._desktopCustom?.getItems() || []).some(i => i.type === 'shortcut' && i.app === appKey);
        }

        function esc2(s) { return String(s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c])); }
        const overlay = document.createElement('div');
        overlay.className = 'w95-dialog-overlay';

        const appItems = SHORTCUTABLE_APPS.map(a => {
            const already = isAppOnDesktop(a.app);
            return `<div class="explorer-item${already ? ' shortcut-already-here' : ''}" data-app-key="${esc2(a.app)}" data-already="${already}" tabindex="0" style="${already ? 'opacity:0.7;cursor:default;' : ''}">
                <span class="explorer-item-icon">${a.icon}</span>
                <span class="explorer-item-name" style="display:flex;flex-direction:column;align-items:center;gap:1px;">
                    <span>${esc2(a.name)}</span>
                    ${already ? '<span style="font-size:9px;color:#000080;font-weight:bold;">It\'s already here!</span>' : ''}
                </span>
            </div>`;
        }).join('');

        overlay.innerHTML = `
            <div class="w95-dialog" role="dialog" aria-modal="true" style="width:400px;max-width:95vw;">
                <div class="w95-titlebar window--active">
                    <div class="w95-title">📄 New Shortcut</div>
                    <div class="w95-controls">
                        <button class="w95-control w95-control-close w95-dialog-x" type="button" aria-label="Close">X</button>
                    </div>
                </div>
                <div class="w95-dialog-body" style="flex-direction:column;align-items:stretch;padding:8px;">
                    <div style="margin:0 0 6px;font:11px Tahoma,sans-serif;">Double-click an app to add a shortcut to the desktop:</div>
                    <div class="explorer-grid" style="max-height:230px;overflow-y:auto;border:2px inset #808080;background:#fff;">${appItems}</div>
                </div>
                <div class="w95-dialog-btns">
                    <button class="w95-btn w95-dialog-btn" type="button">Cancel</button>
                </div>
            </div>`;

        document.body.appendChild(overlay);
        function closeDialog() { overlay.remove(); document.removeEventListener('keydown', onShortcutKey); }
        overlay.querySelector('.w95-dialog-x').addEventListener('click', closeDialog);
        overlay.querySelector('.w95-dialog-btn').addEventListener('click', closeDialog);
        overlay.addEventListener('pointerdown', e => { if (e.target === overlay) closeDialog(); });
        function onShortcutKey(e) { if (e.key === 'Escape') closeDialog(); }
        document.addEventListener('keydown', onShortcutKey);

        const clickTimes = {};
        overlay.querySelectorAll('.explorer-item').forEach(el => {
            el.addEventListener('click', () => {
                const already = el.dataset.already === 'true';
                const now = Date.now();
                const key = el.dataset.appKey;
                overlay.querySelectorAll('.explorer-item').forEach(i => i.classList.remove('selected'));
                el.classList.add('selected');
                if (already) return;
                if (clickTimes[key] && now - clickTimes[key] < 500) {
                    const appDef = SHORTCUTABLE_APPS.find(a => a.app === key);
                    if (appDef) {
                        const item = { id: 'custom_' + Date.now(), type: 'shortcut', name: appDef.name, app: appDef.app, icon: appDef.icon };
                        const items = window._desktopCustom.getItems();
                        items.push(item);
                        window._desktopCustom.saveItems(items);
                        window._desktopCustom.createIcon(item);
                        closeDialog();
                    }
                } else { clickTimes[key] = now; }
            });
        });
    });

    document.getElementById('ctx-new-text')?.addEventListener('click', () => {
        hideAll();
        openW95Prompt({
            icon: '📝',
            title: 'New Text Document',
            message: 'Enter a name for the new text document:',
            defaultValue: 'New Text Document.txt',
            onOK: name => {
                const item = { id: 'custom_' + Date.now(), type: 'textfile', name, content: '' };
                const items = window._desktopCustom.getItems();
                items.push(item);
                window._desktopCustom.saveItems(items);
                window._desktopCustom.createIcon(item);
            }
        });
    });

    document.getElementById('ctx-settings')?.addEventListener('click', () => {
        hideAll();
        w95Apps['settings']?.open();
    });

    document.getElementById('ctx-properties')?.addEventListener('click', () => {
        hideAll();
        openSystemPropertiesDialog();
    });

    // ===== Icon menu actions =====

    document.getElementById('icon-ctx-open')?.addEventListener('click', () => {
        hideAll();
        if (!_targetIcon) return;
        const appKey = _targetIcon.dataset.app;
        if (appKey) openApp(appKey);
    });

    document.getElementById('icon-ctx-rename')?.addEventListener('click', () => {
        hideAll();
        if (!_targetIcon) return;
        const labelEl = _targetIcon.querySelector('.desktop-icon-label');
        if (!labelEl) return;

        const originalText = labelEl.textContent;

        // Create a small textarea that mimics the label style
        const input = document.createElement('textarea');
        input.className = 'icon-rename-input';
        input.value = originalText;
        input.rows = 2;
        input.spellcheck = false;

        // Auto-size height to content
        function fitHeight() {
            input.style.height = 'auto';
            input.style.height = input.scrollHeight + 'px';
        }
        input.addEventListener('input', fitHeight);

        // Hide label, insert input after it
        labelEl.classList.add('is-renaming');
        labelEl.parentNode.insertBefore(input, labelEl.nextSibling);

        // Focus and select all
        input.focus();
        input.select();
        fitHeight();

        function commitRename() {
            const newName = input.value.trim() || originalText;
            labelEl.textContent = newName;
            labelEl.classList.remove('is-renaming');
            input.remove();
            // Persist rename for custom desktop items
            const appId = _targetIcon?.dataset?.app;
            if (appId?.startsWith('custom_') && window._desktopCustom) {
                const items = window._desktopCustom.getItems();
                const found = items.find(i => i.id === appId);
                if (found) { found.name = newName; window._desktopCustom.saveItems(items); }
            }
        }

        function cancelRename() {
            labelEl.classList.remove('is-renaming');
            input.remove();
        }

        input.addEventListener('keydown', e => {
            if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
            if (e.key === 'Escape') { cancelRename(); }
        });
        input.addEventListener('blur', commitRename);
    });

    document.getElementById('icon-ctx-delete')?.addEventListener('click', () => {
        hideAll();
        if (!_targetIcon) return;
        const appId = _targetIcon.dataset.app;
        if (appId === 'recycleBin') return; // Cannot delete the Recycle Bin
        const label = _targetIcon.querySelector('.desktop-icon-label')?.textContent || appId || 'this item';
        openW95Dialog({
            icon: '\uD83D\uDDD1\uFE0F',
            title: 'Confirm File Delete',
            message: `Are you sure you want to delete '${label}'?`,
            buttons: [
                { label: 'Yes', action: async () => {
                    const _customItems = window._desktopCustom?.getItems() || [];
                    if (appId && window._desktopCustom && _customItems.find(i => i.id === appId)) {
                        // Custom item: move to local trash, remove from desktop
                        const items = _customItems;
                        const found = items.find(i => i.id === appId);
                        if (found) addToLocalTrash(found);
                        window._desktopCustom.saveItems(items.filter(i => i.id !== appId));
                        delete w95Apps[appId];
                        _targetIcon.remove();
                    } else if (appId) {
                        await set(ref(database, `recycleBin/icon_${appId}`), {
                            type: 'desktop-icon',
                            iconApp: appId,
                            iconLabel: label,
                            deletedAt: Date.now(),
                        });
                    } else {
                        _targetIcon.classList.add('is-hidden');
                    }
                    _targetIcon = null;
                }},
                { label: 'No', action: null }
            ]
        });
    });

    document.getElementById('icon-ctx-properties')?.addEventListener('click', () => {
        hideAll();
        if (!_targetIcon) return;
        const label = _targetIcon.querySelector('.desktop-icon-label')?.textContent || _targetIcon.dataset.app || 'Unknown';
        openW95Dialog({
            icon: '\ud83d\udcc4',
            title: `${label} Properties`,
            message: `Name: ${label}\nType: Application shortcut`,
            buttons: [{ label: 'OK', action: null }]
        });
    });

    // ===== Window menu actions =====

    document.getElementById('win-ctx-minimise')?.addEventListener('click', () => {
        hideAll();
        if (!_targetWin) return;
        const winId = _targetWin.id;
        if (!winId) return;
        // Find the app and call its minimize behavior (click taskbar button)
        const tbBtn = document.querySelector(`[data-win-id="${winId}"]`);
        if (tbBtn) { tbBtn.click(); return; }
        // Fallback: just hide the window
        _targetWin.classList.add('is-hidden');
        if (w95Mgr.isActiveWin(winId)) w95Mgr.focusWindow(null);
    });

    document.getElementById('win-ctx-close')?.addEventListener('click', () => {
        hideAll();
        if (!_targetWin) return;
        // Click the window's own close button so each window's cleanup runs
        const closeBtn = _targetWin.querySelector('.w95-control[aria-label="Close"], .w95-close');
        if (closeBtn) { closeBtn.click(); return; }
        // Fallback
        _targetWin.classList.add('is-hidden');
        if (w95Mgr.isActiveWin(_targetWin.id)) w95Mgr.focusWindow(null);
    });

    // ===== Cat context menu actions =====

    document.getElementById('cat-ctx-open')?.addEventListener('click', () => {
        hideAll();
        w95Apps['cat']?.open();
    });

    document.getElementById('cat-ctx-pet')?.addEventListener('click', () => {
        hideAll();
        window._catController?.petCat();
    });

    document.getElementById('cat-ctx-call')?.addEventListener('click', () => {
        hideAll();
        window._catController?.callCat();
    });

    document.getElementById('cat-ctx-roam')?.addEventListener('click', () => {
        hideAll();
        window._catController?.toggleRoaming();
    });
})();

// ===== Screensaver (E) — starfield + underwater =====
(function () {
    function ssIdleMs() {
        const mins = parseInt(localStorage.getItem('screensaverIdleTime') || '5', 10);
        return mins * 60 * 1000;
    }
    const overlay = document.getElementById('screensaver-overlay');
    const canvas  = document.getElementById('screensaver-canvas');
    if (!overlay || !canvas) return;

    const ctx = canvas.getContext('2d');
    const rmq = window.matchMedia('(prefers-reduced-motion: reduce)');
    let timer = null, active = false, rafId = null;
    let currentDrawFn = null;

    function getType() {
        return localStorage.getItem('screensaverType') || 'starfield';
    }

    // ---- Starfield ----
    const STAR_COUNT = 160;
    let stars = [];

    function initStars() {
        const W = canvas.width, H = canvas.height;
        stars = Array.from({ length: STAR_COUNT }, () => ({
            x: Math.random() * W,
            y: Math.random() * H,
            z: Math.random() * W,
            pz: 0,
        }));
        stars.forEach(s => { s.pz = s.z; });
    }

    function drawStarfield() {
        if (!active) return;
        const W = canvas.width, H = canvas.height;
        const cx = W / 2, cy = H / 2;
        const speed = 6;

        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fillRect(0, 0, W, H);

        for (const s of stars) {
            s.pz = s.z;
            s.z -= speed;
            if (s.z <= 0) { s.x = Math.random() * W; s.y = Math.random() * H; s.z = W; s.pz = W; }

            const sx = (s.x - cx) * (W / s.z) + cx;
            const sy = (s.y - cy) * (W / s.z) + cy;
            const px = (s.x - cx) * (W / s.pz) + cx;
            const py = (s.y - cy) * (W / s.pz) + cy;

            const size = Math.max(0.5, (1 - s.z / W) * 2.5);
            const bright = Math.floor((1 - s.z / W) * 255);
            ctx.strokeStyle = `rgb(${bright},${bright},${bright})`;
            ctx.lineWidth = size;
            ctx.beginPath();
            ctx.moveTo(px, py);
            ctx.lineTo(sx, sy);
            ctx.stroke();
        }
    }

    // ---- Underwater ----
    const UW = { bubbles: [], fish: [], seaweed: [], frame: 0 };
    const FISH_COLORS = ['#ff9966', '#ffcc44', '#88ddff', '#ff88cc', '#aaffbb', '#ffbbff', '#66ddaa', '#ffaa55'];

    function initUnderwater() {
        const W = canvas.width, H = canvas.height;
        UW.frame = 0;

        UW.bubbles = Array.from({ length: 35 }, () => ({
            x: Math.random() * W,
            y: H * 0.3 + Math.random() * H * 0.7,
            r: 1.5 + Math.random() * 8,
            speed: 0.35 + Math.random() * 0.7,
            wobbleAmp: 0.6 + Math.random() * 1.8,
            wobbleFreq: 0.018 + Math.random() * 0.028,
            wobblePhase: Math.random() * Math.PI * 2,
            alpha: 0.25 + Math.random() * 0.45,
        }));

        UW.fish = Array.from({ length: 7 }, (_, i) => {
            const goRight = Math.random() < 0.5;
            return {
                x: goRight ? -100 : W + 100,
                y: H * 0.12 + Math.random() * H * 0.68,
                vx: (0.8 + Math.random() * 1.8) * (goRight ? 1 : -1),
                size: 10 + Math.random() * 20,
                color: FISH_COLORS[i % FISH_COLORS.length],
                flip: !goRight,
                tailPhase: Math.random() * Math.PI * 2,
                bobPhase: Math.random() * Math.PI * 2,
            };
        });

        const swCount = Math.max(6, Math.ceil(W / 55));
        UW.seaweed = Array.from({ length: swCount }, (_, i) => ({
            x: 10 + i * (W / swCount) + (Math.random() - 0.5) * 18,
            height: 28 + Math.random() * 65,
            segments: 3 + Math.floor(Math.random() * 4),
            phase: Math.random() * Math.PI * 2,
            speed: 0.006 + Math.random() * 0.01,
            hue: 115 + (Math.random() - 0.5) * 30,
        }));
    }

    function _drawFish(f) {
        const { x, y, size, color, flip, tailPhase } = f;
        ctx.save();
        ctx.translate(x, y);
        if (flip) ctx.scale(-1, 1);

        // Tail fin
        const wag = Math.sin(tailPhase) * size * 0.32;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(-size * 0.28, 0);
        ctx.lineTo(-size * 0.82, -size * 0.38 + wag);
        ctx.lineTo(-size * 0.82, size * 0.38 + wag);
        ctx.closePath();
        ctx.fill();

        // Body
        ctx.beginPath();
        ctx.ellipse(0, 0, size * 0.62, size * 0.3, 0, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();

        // Dorsal fin
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(0, -size * 0.3);
        ctx.quadraticCurveTo(size * 0.25, -size * 0.52, size * 0.45, -size * 0.3);
        ctx.closePath();
        ctx.fill();

        // Eye
        ctx.beginPath();
        ctx.arc(size * 0.32, -size * 0.04, size * 0.09, 0, Math.PI * 2);
        ctx.fillStyle = '#111';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(size * 0.3, -size * 0.07, size * 0.035, 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();

        ctx.restore();
    }

    function _drawSeaweedStrand(sw) {
        const H = canvas.height;
        const segH = sw.height / sw.segments;
        ctx.strokeStyle = `hsl(${sw.hue},55%,28%)`;
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.beginPath();
        let cx = sw.x, cy = H;
        ctx.moveTo(cx, cy);
        for (let i = 0; i < sw.segments; i++) {
            const t = UW.frame * sw.speed + sw.phase;
            const sway = Math.sin(t + i * 0.55) * 10 * ((i + 1) / sw.segments);
            const nx = sw.x + sway;
            const ny = H - segH * (i + 1);
            ctx.quadraticCurveTo((cx + nx) / 2 + sway * 0.5, (cy + ny) / 2, nx, ny);
            cx = nx; cy = ny;
        }
        ctx.stroke();
    }

    function drawUnderwater() {
        if (!active) return;
        const W = canvas.width, H = canvas.height;
        UW.frame++;

        // Background
        const bg = ctx.createLinearGradient(0, 0, 0, H);
        bg.addColorStop(0,   '#001628');
        bg.addColorStop(0.5, '#002d55');
        bg.addColorStop(1,   '#001520');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, W, H);

        // Subtle light rays from surface
        const t = UW.frame * 0.004;
        ctx.save();
        for (let i = 0; i < 6; i++) {
            const rx = W * (0.08 + i * 0.17) + Math.sin(t + i * 1.1) * W * 0.04;
            const alpha = Math.max(0, 0.028 + Math.sin(t * 0.6 + i) * 0.013);
            ctx.fillStyle = `rgba(90,170,255,${alpha})`;
            ctx.beginPath();
            ctx.moveTo(rx - 15, 0);
            ctx.lineTo(rx + 15, 0);
            ctx.lineTo(rx + 90, H);
            ctx.lineTo(rx - 90, H);
            ctx.closePath();
            ctx.fill();
        }
        ctx.restore();

        // Seaweed
        for (const sw of UW.seaweed) _drawSeaweedStrand(sw);

        // Bubbles
        for (const b of UW.bubbles) {
            b.y -= b.speed;
            b.x += Math.sin(UW.frame * b.wobbleFreq + b.wobblePhase) * b.wobbleAmp;
            if (b.y + b.r < 0) { b.y = H + b.r + Math.random() * 40; b.x = Math.random() * W; }

            ctx.strokeStyle = `rgba(140,215,255,${b.alpha})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
            ctx.stroke();

            // Highlight
            ctx.fillStyle = `rgba(210,240,255,${b.alpha * 0.35})`;
            ctx.beginPath();
            ctx.arc(b.x - b.r * 0.28, b.y - b.r * 0.28, b.r * 0.32, 0, Math.PI * 2);
            ctx.fill();
        }

        // Fish
        for (const f of UW.fish) {
            f.x += f.vx;
            f.tailPhase += 0.14;
            f.y += Math.sin(UW.frame * 0.018 + f.bobPhase) * 0.28;

            const offScreen = f.flip ? f.x < -(f.size * 3) : f.x > W + f.size * 3;
            if (offScreen) {
                const goRight = Math.random() < 0.5;
                f.flip = !goRight;
                f.x = goRight ? -f.size * 3 : W + f.size * 3;
                f.y = H * 0.12 + Math.random() * H * 0.68;
                f.vx = (0.8 + Math.random() * 1.8) * (goRight ? 1 : -1);
                f.color = FISH_COLORS[Math.floor(Math.random() * FISH_COLORS.length)];
            }
            _drawFish(f);
        }
    }

    // ---- Falling Petals ----
    const PETAL_COUNT = 55;
    let petals = [], petalFrame = 0;

    function initPetals() {
        const W = canvas.width, H = canvas.height;
        petalFrame = 0;
        petals = Array.from({ length: PETAL_COUNT }, () => ({
            x: Math.random() * W,
            y: Math.random() * H,
            size: 5 + Math.random() * 9,
            speed: 0.4 + Math.random() * 1.2,
            drift: (Math.random() - 0.5) * 0.6,
            rot: Math.random() * Math.PI * 2,
            rotSpeed: (Math.random() - 0.5) * 0.04,
            swayAmp: 0.6 + Math.random() * 1.8,
            swayFreq: 0.012 + Math.random() * 0.022,
            swayPhase: Math.random() * Math.PI * 2,
            alpha: 0.55 + Math.random() * 0.45,
            hue: 330 + (Math.random() - 0.5) * 30,
            sat: 55 + Math.random() * 30,
            lit: 70 + Math.random() * 20,
        }));
    }

    function _drawPetal(p) {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.globalAlpha = p.alpha;
        ctx.fillStyle = `hsl(${p.hue},${p.sat}%,${p.lit}%)`;
        ctx.beginPath();
        ctx.ellipse(0, 0, p.size, p.size * 0.48, 0, 0, Math.PI * 2);
        ctx.fill();
        // Subtle vein
        ctx.strokeStyle = `hsla(${p.hue},${p.sat - 10}%,${p.lit - 20}%,0.4)`;
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.moveTo(-p.size * 0.8, 0);
        ctx.lineTo(p.size * 0.8, 0);
        ctx.stroke();
        ctx.restore();
    }

    function drawPetals() {
        if (!active) return;
        const W = canvas.width, H = canvas.height;
        petalFrame++;
        const bg = ctx.createLinearGradient(0, 0, 0, H);
        bg.addColorStop(0,   '#120818');
        bg.addColorStop(0.5, '#1e0a22');
        bg.addColorStop(1,   '#120818');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, W, H);
        for (const p of petals) {
            p.y += p.speed;
            p.x += p.drift + Math.sin(petalFrame * p.swayFreq + p.swayPhase) * p.swayAmp;
            p.rot += p.rotSpeed;
            if (p.y - p.size > H) { p.y = -p.size * 2; p.x = Math.random() * W; }
            if (p.x < -p.size * 2) p.x = W + p.size;
            if (p.x > W + p.size * 2) p.x = -p.size;
            _drawPetal(p);
        }
    }

    // ---- Bouncing Logo ----
    const BL = { x: 0, y: 0, vx: 2.2, vy: 1.6 };
    const BL_COLORS = ['#ff5555', '#55ff55', '#5599ff', '#ffff55', '#ff55ff', '#55ffff', '#ff9944'];
    let blColorIdx = 0;

    function initBouncingLogo() {
        const W = canvas.width, H = canvas.height;
        ctx.font = 'bold 28px monospace';
        const tw = ctx.measureText('Personal Feed').width;
        BL.w = tw + 4;
        BL.h = 34;
        BL.x = Math.max(0, Math.random() * (W - BL.w));
        BL.y = Math.max(0, Math.random() * (H - BL.h));
        BL.vx = (Math.random() < 0.5 ? 1 : -1) * (1.8 + Math.random() * 1.2);
        BL.vy = (Math.random() < 0.5 ? 1 : -1) * (1.4 + Math.random() * 1.0);
        blColorIdx = 0;
    }

    function drawBouncingLogo() {
        if (!active) return;
        const W = canvas.width, H = canvas.height;
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, W, H);

        BL.x += BL.vx;
        BL.y += BL.vy;

        let corner = false;
        if (BL.x <= 0)          { BL.vx =  Math.abs(BL.vx); BL.x = 0;          corner = true; }
        if (BL.x + BL.w >= W)  { BL.vx = -Math.abs(BL.vx); BL.x = W - BL.w;   corner = true; }
        if (BL.y <= 0)          { BL.vy =  Math.abs(BL.vy); BL.y = 0;          corner = true; }
        if (BL.y + BL.h >= H)  { BL.vy = -Math.abs(BL.vy); BL.y = H - BL.h;   corner = true; }

        if (corner) blColorIdx = (blColorIdx + 1) % BL_COLORS.length;

        ctx.font = 'bold 28px monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillStyle = BL_COLORS[blColorIdx];
        ctx.fillText('Personal Feed', BL.x, BL.y);
    }

    // ---- Feed Slideshow ----
    const FS = { cards: [], frame: 0, spacing: 0 };
    const FS_PALETTES = [
        { bg: '#1a1a2e', border: '#e94560', text: '#eee' },
        { bg: '#16213e', border: '#0f3460', text: '#dce' },
        { bg: '#0f3460', border: '#533483', text: '#eef' },
        { bg: '#1a2a1a', border: '#4caf50', text: '#dfd' },
        { bg: '#2a1a1a', border: '#e57373', text: '#fee' },
    ];

    function _makeFeedCards() {
        // Collect real feed items from the DOM if available, otherwise use placeholders
        const items = [];
        document.querySelectorAll('.feed-item .post-text, .feed-card .post-text, .timeline-item .text').forEach(el => {
            const t = (el.textContent || '').trim().slice(0, 72);
            if (t.length > 8) items.push(t);
        });
        if (items.length < 3) {
            items.push(
                'Sharing something wonderful today…',
                'A link worth revisiting',
                'This made me think of you',
                'Found this and had to share',
                'Worth a slow read',
                'Something interesting from the feed',
            );
        }
        return items;
    }

    function initFeedSlideshow() {
        const W = canvas.width, H = canvas.height;
        FS.frame = 0;
        const items = _makeFeedCards();
        const cardH = 90, cardW = 260, rows = Math.ceil(H / (cardH + 24)) + 1;
        FS.cards = [];
        FS.spacing = cardW + 40;
        const cols = Math.ceil(W / FS.spacing) + 3;
        for (let row = 0; row < rows; row++) {
            const pal = FS_PALETTES[row % FS_PALETTES.length];
            const rowSpeed = 0.35 + (row % 3) * 0.15;
            const dir = row % 2 === 0 ? 1 : -1;
            for (let col = 0; col < cols; col++) {
                FS.cards.push({
                    x: col * FS.spacing + (row % 2 === 0 ? 0 : FS.spacing * 0.5),
                    y: row * (cardH + 28) + 20,
                    w: cardW, h: cardH,
                    speed: rowSpeed * dir,
                    text: items[(row * cols + col) % items.length],
                    pal,
                });
            }
        }
    }

    function drawFeedSlideshow() {
        if (!active) return;
        const W = canvas.width;
        FS.frame++;
        ctx.fillStyle = '#0d0d1a';
        ctx.fillRect(0, 0, W, canvas.height);

        for (const c of FS.cards) {
            c.x += c.speed;
            const totalW = FS.spacing * Math.ceil(W / FS.spacing + 3);
            if (c.speed > 0 && c.x > W + c.w + 20)  c.x -= totalW;
            if (c.speed < 0 && c.x < -c.w - 20)      c.x += totalW;

            // Card shadow
            ctx.fillStyle = 'rgba(0,0,0,0.35)';
            ctx.fillRect(c.x + 4, c.y + 4, c.w, c.h);
            // Card background
            ctx.fillStyle = c.pal.bg;
            ctx.fillRect(c.x, c.y, c.w, c.h);
            // Accent bar
            ctx.fillStyle = c.pal.border;
            ctx.fillRect(c.x, c.y, 4, c.h);
            // Card text
            ctx.fillStyle = c.pal.text;
            ctx.font = '13px sans-serif';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';
            const words = c.text.split(' ');
            let line = '', lineY = c.y + 12;
            for (const word of words) {
                const test = line ? line + ' ' + word : word;
                if (ctx.measureText(test).width > c.w - 24 && line) {
                    ctx.fillText(line, c.x + 14, lineY);
                    line = word; lineY += 18;
                    if (lineY > c.y + c.h - 10) break;
                } else { line = test; }
            }
            if (line && lineY <= c.y + c.h - 10) ctx.fillText(line, c.x + 14, lineY);
        }
    }

    // ---- Core lifecycle ----
    function resizeCanvas() {
        canvas.width  = overlay.offsetWidth  || window.innerWidth;
        canvas.height = overlay.offsetHeight || window.innerHeight;
        const type = getType();
        if (type === 'ss_bubbles' || type === 'underwater') initUnderwater();
        else if (type === 'ss_petals') initPetals();
        else if (type === 'ss_bouncing_logo') initBouncingLogo();
        else if (type === 'ss_feed_slideshow') initFeedSlideshow();
        else initStars();
    }

    function drawFrame() {
        if (!active) return;
        currentDrawFn();
        rafId = requestAnimationFrame(drawFrame);
    }

    function start() {
        if (active) return;
        active = true;
        resizeCanvas();
        const type = getType();
        if (type === 'ss_bubbles' || type === 'underwater') currentDrawFn = drawUnderwater;
        else if (type === 'ss_petals') currentDrawFn = drawPetals;
        else if (type === 'ss_bouncing_logo') currentDrawFn = drawBouncingLogo;
        else if (type === 'ss_feed_slideshow') currentDrawFn = drawFeedSlideshow;
        else currentDrawFn = drawStarfield;
        overlay.classList.remove('is-hidden');
        if (!rmq.matches) {
            ctx.fillStyle = (type === 'ss_bubbles' || type === 'underwater') ? '#001628'
                          : type === 'ss_petals' ? '#120818'
                          : '#000';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            drawFrame();
        }
        // Track screensaver activation for Idle Dreamer achievement
        const ssTriggers = Number(localStorage.getItem('screensaverTriggeredCount') || 0) + 1;
        localStorage.setItem('screensaverTriggeredCount', String(ssTriggers));
        unlockAchievement('idle_dreamer');
    }

    function stop() {
        if (!active) return;
        active = false;
        overlay.classList.add('is-hidden');
        cancelAnimationFrame(rafId);
        reset();
    }

    function ssEnabled() {
        return localStorage.getItem('screensaverEnabled') !== 'false';
    }

    function reset() {
        clearTimeout(timer);
        if (!active && ssEnabled()) timer = setTimeout(start, ssIdleMs());
    }

    ['pointermove', 'pointerdown', 'keydown', 'touchstart', 'wheel'].forEach(evt => {
        document.addEventListener(evt, () => { active ? stop() : reset(); }, { passive: true });
    });

    // Expose control so the Settings window can toggle the screensaver live.
    window._screensaverCtrl = {
        reset,
        disable: () => { clearTimeout(timer); if (active) stop(); },
    };

    reset();
})();

// ===== My Computer / Explorer Window (F) =====
(function () {
    const win     = document.getElementById('w95-win-mycomputer');
    const handle  = document.getElementById('w95-mycomputer-handle');
    const minBtn  = document.getElementById('w95-mycomputer-min');
    const maxBtn  = document.getElementById('w95-mycomputer-max');
    const closeBtn= document.getElementById('w95-mycomputer-close');
    const body    = document.getElementById('w95-mycomputer-body');
    if (!win || !body) return;

    let btn = null;

    // Hard-coded virtual file system
    const VFS = {
        type: 'root', children: {
            'C:': { type: 'drive', icon: '💾', label: 'Local Disk (C:)', children: {
                'Documents': { type: 'folder', icon: '📁', children: {
                    'readme.txt':       { type: 'file', icon: '📄', size: '1 KB',  date: '03/08/2024', content: 'Welcome to Personal Feed!\n\nThis is your personal space <3' },
                    'about.txt':        { type: 'file', icon: '📄', size: '1 KB',  date: '03/08/2024', content: 'Created with love by El & Tero <3\n\nBuilt on Firebase + Vanilla JS.' },
                    'GardenLog.txt':    { type: 'file', icon: '📄', size: '2 KB',  date: '03/08/2024', content: () => {
                        const t = Number(localStorage.getItem('garden_talkCount') || 0);
                        return '--- Garden Log ---\n\nTimes talked to plant: ' + t + '\n' + (t === 0 ? '(Try the "Talk to Garden" button!)' : 'Your plant remembers every kind word.');
                    }},
                    'CatNotes.txt':     { type: 'file', icon: '📄', size: '1 KB',  date: '03/08/2024', content: () => {
                        const c = Number(localStorage.getItem('catActionCount') || 0);
                        return '--- Cat Notes ---\n\nCat interactions: ' + c + '\n' + (c === 0 ? '(Visit Cat.exe to meet your cat!)' : 'Your cat remembers every visit. ♡');
                    }},
                    'Achievements.log': { type: 'file', icon: '📋', size: '3 KB',  date: '03/08/2024', content: () => {
                        if (!currentUser) return 'Sign in to view achievements.';
                        const unlocked = ACHIEVEMENTS.filter(a => unlockedAchievements.has(a.id));
                        if (!unlocked.length) return '--- Achievements Log ---\n\nNo achievements unlocked yet.\nKeep using the site!';
                        return '--- Achievements Log ---\n\n' + unlocked.map(a => a.icon + '  ' + a.title).join('\n');
                    }},
                    'StatsReport.txt':  { type: 'file', icon: '📄', size: '2 KB',  date: '03/08/2024', content: () => {
                        if (!currentUser) return 'Sign in to view your stats.';
                        const posts   = Object.values(allPosts).filter(p => p.author === currentUser).length;
                        const replies = Object.values(allPosts).reduce((a, p) => a + (p.replies||[]).filter(r => r.author === currentUser).length, 0);
                        const talks   = Number(localStorage.getItem('garden_talkCount') || 0);
                        const cats    = Number(localStorage.getItem('catActionCount') || 0);
                        return '--- Stats Report ---\n\nPosts:         ' + posts + '\nReplies:       ' + replies + '\nGarden Talks:  ' + talks + '\nCat Actions:   ' + cats + '\nAchievements:  ' + unlockedAchievements.size + ' / ' + ACHIEVEMENTS.length;
                    }},
                    'Letters.txt':      { type: 'file', icon: '📄', size: '1 KB',  date: '03/08/2024', content: () => {
                        if (!currentUser) return 'Sign in to view letters.';
                        const sent = Object.values(allLetters).filter(l => l.from === currentUser).length;
                        const recv = Object.values(allLetters).filter(l => l.to   === currentUser).length;
                        return '--- Letters ---\n\nSent:     ' + sent + '\nReceived: ' + recv;
                    }},
                }},
                'Pictures': { type: 'folder', icon: '🗂️', children: {
                    'Wallpapers':  { type: 'folder', icon: '📁', children: {
                        'about.txt': { type: 'file', icon: '📄', size: '1 KB', date: '03/08/2024', content: 'Wallpapers are managed via the Display control panel.\n\nOpen Control Panel → Display.cpl to change your wallpaper.' },
                    }},
                    'Screenshots': { type: 'folder', icon: '📁', children: {
                        'placeholder.txt': { type: 'file', icon: '📄', size: '1 KB', date: '03/08/2024', content: '[ Screenshots ]\n\nThis folder will hold desktop screenshots in a future update.' },
                    }},
                    'Memories':    { type: 'folder', icon: '📁', children: {
                        'placeholder.txt': { type: 'file', icon: '📄', size: '1 KB', date: '03/08/2024', content: '[ Memories ]\n\nThis folder will hold special moments in a future update.' },
                    }},
                }},
                'Program Files': { type: 'folder', icon: '📁', children: {
                    'Feed.exe':         { type: 'app', icon: '⚙️', size: '32 KB', date: '03/08/2024', app: 'feed' },
                    'Mailbox.exe':      { type: 'app', icon: '⚙️', size: '28 KB', date: '03/08/2024', app: 'mailbox' },
                    'Chat.exe':         { type: 'app', icon: '⚙️', size: '24 KB', date: '03/08/2024', app: 'chat' },
                    'Garden.exe':       { type: 'app', icon: '⚙️', size: '18 KB', date: '03/08/2024', app: 'garden' },
                    'Cat.exe':          { type: 'app', icon: '⚙️', size: '12 KB', date: '03/08/2024', app: 'cat' },
                    'Jukebox.exe':      { type: 'app', icon: '⚙️', size: '20 KB', date: '03/08/2024', app: 'jukebox' },
                    'Console.exe':      { type: 'app', icon: '⚙️', size: '8 KB',  date: '03/08/2024', app: 'console' },
                    'Stats.exe':        { type: 'app', icon: '⚙️', size: '16 KB', date: '03/08/2024', app: 'stats' },
                    'Profiles.exe':     { type: 'app', icon: '⚙️', size: '14 KB', date: '03/08/2024', app: 'profiles' },
                    'Achievements.exe': { type: 'app', icon: '⚙️', size: '14 KB', date: '03/08/2024', app: 'achievements' },
                    'Scrapbook.exe':    { type: 'app', icon: '⚙️', size: '11 KB', date: '03/08/2024', app: 'scrapbook' },
                }},
                'Windows': { type: 'folder', icon: '📁', children: {
                    'System32': { type: 'folder', icon: '📁', children: {
                        'notepad.exe':  { type: 'file', icon: '⚙️', size: '69 KB',  date: '08/24/1996', content: 'C:\\Windows\\System32\\notepad.exe\n[69 KB]\n\nMicrosoft Notepad\nVersion 4.00' },
                        'explorer.exe': { type: 'file', icon: '⚙️', size: '512 KB', date: '08/24/1996', content: 'C:\\Windows\\System32\\explorer.exe\n[512 KB]\n\nWindows Explorer\nVersion 4.00.950' },
                        'win.ini':      { type: 'file', icon: '📄', size: '2 KB',   date: '08/24/1996', content: '[windows]\nload=\nrun=\nBeep=yes\nspooler=yes\n\n[Desktop]\nWallpaper=(None)\nTileWallpaper=0' },
                        'system.ini':   { type: 'file', icon: '📄', size: '1 KB',   date: '08/24/1996', content: '[boot]\nsystem.drv=system.drv\nuser.exe=user.exe\ngdi.exe=gdi.exe\n\n[386Enh]\nwoafont=dosapp.fon' },
                    }},
                    'Fonts': { type: 'folder', icon: '📁', children: {
                        'Arial.ttf':            { type: 'file', icon: '🔤', size: '63 KB', date: '08/24/1996', content: 'Arial\nMonotype Typography, 1992\n\nA clean sans-serif typeface.' },
                        'Courier New.ttf':      { type: 'file', icon: '🔤', size: '45 KB', date: '08/24/1996', content: 'Courier New\nMonotype Typography, 1992\n\nA monospaced serif typeface.' },
                        'Times New Roman.ttf':  { type: 'file', icon: '🔤', size: '56 KB', date: '08/24/1996', content: 'Times New Roman\nMonotype Typography, 1992\n\nA classic serif typeface.' },
                        'Wingdings.ttf':        { type: 'file', icon: '🔤', size: '28 KB', date: '08/24/1996', content: 'Wingdings\nMicrosoft, 1990\n\n✉ ✈ ✂ ☎ ✌ ✍ ♫ ✎ ✏ ☺' },
                    }},
                    'Media': { type: 'folder', icon: '📁', children: {
                        'chimes.wav': { type: 'file', icon: '🎵', size: '11 KB', date: '08/24/1996', content: 'chimes.wav  [11 KB]\n\nWindows chime sound.\nPlayback available via Jukebox.exe.' },
                        'chord.wav':  { type: 'file', icon: '🎵', size: '24 KB', date: '08/24/1996', content: 'chord.wav  [24 KB]\n\nWindows chord sound.' },
                        'ding.wav':   { type: 'file', icon: '🎵', size: '11 KB', date: '08/24/1996', content: 'ding.wav  [11 KB]\n\nWindows ding sound.' },
                        'tada.wav':   { type: 'file', icon: '🎵', size: '28 KB', date: '08/24/1996', content: 'tada.wav  [28 KB]\n\nWindows startup fanfare.' },
                    }},
                }},
                'Logs': { type: 'folder', icon: '📁', children: {
                    'error.log': { type: 'file', icon: '📋', size: '1 KB', date: '03/08/2024', content: 'Windows Error Log\n------------------\n[03/08/2024 09:41] System started.\n[03/08/2024 09:41] No errors found.\n[03/08/2024 09:41] Have a nice day.' },
                    'boot.log':  { type: 'file', icon: '📋', size: '1 KB', date: '03/08/2024', content: 'Boot Log\n---------\n[OK] Loading HIMEM.SYS\n[OK] Loading EMM386.EXE\n[OK] Starting Windows 95\n[OK] Personal Feed loaded.' },
                }},
            }},
            'D:': { type: 'drive', icon: '💿', label: 'CD-ROM (D:)', children: {
                'AUTORUN.INF':     { type: 'file', icon: '📄', size: '1 KB', date: '02/14/2024', content: '[autorun]\nopen=setup.exe\nlabel=Personal Feed CD' },
                'readme.txt':      { type: 'file', icon: '📄', size: '2 KB', date: '02/14/2024', content: 'Personal Feed — Limited Edition CD\n\nThank you for being here.\nThis disc contains everything we made together.\n\nTracks: 12\nRuntime: 47:32\n\nInsert disc to begin.' },
                'tracklist.txt':   { type: 'file', icon: '📄', size: '1 KB', date: '02/14/2024', content: 'Tracklist\n----------\n01. Startup Fanfare          (0:04)\n02. Garden Theme             (3:22)\n03. Cat Nap Jazz             (2:48)\n04. Loading Screen Blues     (1:12)\n05. Notification Ping        (0:01)\n06. Letter Day               (4:05)\n07. Midnight Garden          (5:17)\n08. Jukebox Shuffle          (3:55)\n09. Achievement Unlocked     (0:03)\n10. Error 404 Not Found      (2:11)\n11. Goodbye Screen           (1:33)\n12. Credits Roll             (7:01)' },
                'love_letter.txt': { type: 'file', icon: '📄', size: '1 KB', date: '02/14/2024', content: 'Dear You,\n\nWe made this for us.\nEvery pixel, every plant, every purr.\n\nThank you for showing up.\n\n  \u2661\n  El & Tero' },
            }},
            'Control Panel': { type: 'folder', icon: '🏛️', children: {
                'Display.cpl':  { type: 'app',  icon: '🖥️', size: '4 KB', date: '03/08/2024', app: 'wallpaper' },
                'Sounds.cpl':   { type: 'app',  icon: '🔊', size: '4 KB', date: '03/08/2024', app: 'jukebox' },
                'DateTime.cpl': { type: 'app',  icon: '🕐', size: '2 KB', date: '03/08/2024', app: 'datetime' },
                'Mouse.cpl':    { type: 'file', icon: '🖱️', size: '2 KB', date: '03/08/2024', content: 'Mouse Properties\n\nPointer speed: Normal\nDouble-click speed: Normal\nLeft-handed: No\n\n[ This panel is read-only ]' },
                'About.cpl':    { type: 'file', icon: 'ℹ️', size: '1 KB', date: '03/08/2024', content: () => 'Personal Feed\nVersion 1.0\n\nBuilt with love by El & Tero.\nPowered by Firebase + Vanilla JS.\n\nSystem:\n  Date: ' + new Date().toLocaleDateString() + '\n  Time: ' + new Date().toLocaleTimeString() },
            }},
        }
    };

    let path = []; // stack of folder-name strings

    function nodeAt(p) {
        let node = VFS;
        for (const part of p) {
            node = node.children?.[part];
            if (!node) return null;
        }
        return node;
    }

    function safeText(s) {
        const d = document.createElement('div');
        d.textContent = s;
        return d.innerHTML;
    }

    function render() {
        const node = nodeAt(path);
        if (!node) return;
        const pathStr = path.length === 0 ? 'My Computer' : path.join(' \u203a ');
        const items = Object.entries(node.children || {});

        let rows = items.map(([name, child]) => {
            const displayName = (child.type === 'drive' && child.label) ? child.label : name;
            return `<div class="explorer-item" data-name="${safeText(name)}" tabindex="0">
                <span class="explorer-item-icon">${child.icon || '\ud83d\udcc4'}</span>
                <span class="explorer-item-name">${safeText(displayName)}</span>
            </div>`;
        }).join('');

        if (!rows) rows = '<div class="explorer-empty">(empty)</div>';

        body.innerHTML = `
            <div class="explorer-toolbar">
                <button class="w95-btn" id="explorer-back" type="button"${path.length === 0 ? ' disabled' : ''}>\u25c4 Back</button>
                <div class="explorer-addr">${safeText(pathStr)}</div>
            </div>
            <div class="explorer-grid">${rows}</div>`;

        document.getElementById('explorer-back')?.addEventListener('click', () => { path.pop(); render(); });

        const clickTimes = {};
        body.querySelectorAll('.explorer-item').forEach(el => {
            const name = el.dataset.name;
            el.addEventListener('click', () => {
                const now = Date.now();
                if (now - (clickTimes[name] || 0) < 500) {
                    activateItem(name, nodeAt(path)?.children?.[name]);
                } else {
                    body.querySelectorAll('.explorer-item').forEach(i => i.classList.remove('selected'));
                    el.classList.add('selected');
                    clickTimes[name] = now;
                }
            });
            el.addEventListener('keydown', e => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activateItem(name, nodeAt(path)?.children?.[name]); }
            });
        });
    }

    function activateItem(name, child) {
        if (!child) return;
        if (child.type === 'folder' || child.type === 'drive') {
            path.push(name); render();
        } else if (child.type === 'app') {
            w95Apps[child.app]?.open();
        } else {
            const msg = typeof child.content === 'function' ? child.content() : (child.content || '(empty)');
            openW95Dialog({ icon: child.icon || '📄', title: name,
                message: msg,
                buttons: [{ label: 'OK', action: null }] });
        }
    }

    function show() {
        if (!btn) btn = w95Mgr.addTaskbarBtn('w95-win-mycomputer', 'MY PC', () => {
            if (win.classList.contains('is-hidden')) show(); else hide();
        });
        path = [];
        render();
        win.classList.remove('is-hidden');
        w95Mgr.focusWindow('w95-win-mycomputer');
    }

    function hide() {
        win.classList.add('is-hidden');
        if (w95Mgr.isActiveWin('w95-win-mycomputer')) w95Mgr.focusWindow(null);
    }

    if (minBtn)   minBtn.addEventListener('click',  e => { e.stopPropagation(); hide(); });
    if (maxBtn)   maxBtn.addEventListener('click',  e => { e.stopPropagation(); w95Mgr.toggleMaximise(win, 'w95-win-mycomputer'); });
    if (closeBtn) closeBtn.addEventListener('click', e => {
        e.stopPropagation();
        if (w95Mgr.isMaximised('w95-win-mycomputer')) w95Mgr.toggleMaximise(win, 'w95-win-mycomputer');
        win.classList.add('is-hidden');
        if (w95Mgr.isActiveWin('w95-win-mycomputer')) w95Mgr.focusWindow(null);
        if (btn) { btn.remove(); btn = null; }
    });

    makeDraggable(win, handle, 'w95-win-mycomputer');

    w95Apps['myComputer'] = { open: () => {
        if (win.classList.contains('is-hidden')) show(); else w95Mgr.focusWindow('w95-win-mycomputer');
    }};
})();

// ===== Console.exe =====
(() => {
    const win      = document.getElementById('w95-win-console');
    const handle   = document.getElementById('w95-console-handle');
    const minBtn   = document.getElementById('w95-console-min');
    const maxBtn   = document.getElementById('w95-console-max');
    const closeBtn = document.getElementById('w95-console-close');
    const output   = document.getElementById('console-output');
    const input    = document.getElementById('console-input');
    if (!win || !handle || !output || !input) return;

    let taskbarBtn = null;
    const history  = [];  // command history for up-arrow recall
    let histIdx    = -1;

    // ---- Output helpers ----
    function print(text, cls) {
        const line = document.createElement('div');
        line.className = 'console-line' + (cls ? ' ' + cls : '');
        line.textContent = text;
        output.appendChild(line);
        output.scrollTop = output.scrollHeight;
    }
    function printHtml(html, cls) {
        const line = document.createElement('div');
        line.className = 'console-line' + (cls ? ' ' + cls : '');
        line.innerHTML = html;
        output.appendChild(line);
        output.scrollTop = output.scrollHeight;
    }
    function printBlank() { print(''); }
    function clearOutput() { output.innerHTML = ''; }

    // ---- Fortune messages ----
    const FORTUNES = [
        'A small act of kindness ripples further than you know.',
        'The answer you seek is closer than the question.',
        'Today is a good day to water something.',
        'Error 404: Worry not found. Carry on.',
        'The universe noticed you showing up today.',
        'Every pixel in this window was placed with care.',
        'You have mail you haven\'t opened yet — in your heart.',
        'Somewhere a cat is thinking of you.',
        'The garden remembers every visit.',
        'Reboot. Refresh. Try again. It usually works.',
        'You are running low on sleep. Consider a restore point.',
        'The best feature is the one that makes you smile.',
        'Connection established: ♡ → you.',
        'A wildflower has your name on it.',
        'Proceed anyway? [Y/n]: Y',
    ];

    // ---- Stats helpers ----
    function getMyPostCount()     { return Object.values(allPosts).filter(p => p.author === currentUser).length; }
    function getMyReplyCount()    { return Object.values(allPosts).reduce((a, p) => a + (p.replies||[]).filter(r => r.author === currentUser).length, 0); }
    function getMyReactionCount() {
        return Object.values(allPosts).reduce((a, p) => {
            return a + Object.values(p.reactionsBy||{}).filter(u => u && u[currentUser]).length;
        }, 0);
    }
    function getMyLetterCount()   { return Object.values(allLetters).filter(l => l.from === currentUser).length; }

    // ---- Command registry ----
    // Base commands always available in the console.
    // BASE_CMDS: always available. Reward-gated commands (stats etc.) live in
    // unlockedConsoleCmds and are added via achievement rewards.
    const BASE_CMDS = new Set(['help','clear','achievements','commands',
        'rain','spin','dance','summon-cat','grow-tree','matrix','love','party','ghost','fortune',
        'bloom','snow','comet','fireflies','constellation']);

    // These commands are gated behind achievement rewards.
    const GATED_CMDS = {
        stats:      { rewardId: 'cmd_stats',      desc: 'Your post & reply stats' },
        reactstats: { rewardId: 'cmd_reactstats', desc: 'Your reaction stats' },
        letters:    { rewardId: 'cmd_letters',    desc: 'Your letter stats' },
        catstats:   { rewardId: 'cmd_catstats',   desc: 'Your cat care stats' },
        gardenlog:  { rewardId: 'cmd_gardenlog',  desc: 'Your garden talk count' },
        linkstats:  { rewardId: 'cmd_linkstats',  desc: 'Your link-sharing history' },
        whoami:     { rewardId: 'cmd_whoami',     desc: 'Your full profile overview' },
    };

    function isGatedCmdUnlocked(cmd) {
        return unlockedConsoleCmds.has(cmd);
    }

    function getCmdList() {
        // Always include base; also include achievement-unlocked commands
        return [...BASE_CMDS, ...unlockedConsoleCmds];
    }

    // ---- Command handlers ----
    const CMD_HANDLERS = {
        help() {
            print('Available commands:', 'console-line-header');
            printBlank();
            [
                ['help',        'Show this help'],
                ['clear',       'Clear the console'],
                ['achievements','List your unlocked achievements'],
                ['commands',    'Show special commands unlocked via achievements'],
            ].forEach(([cmd, desc]) => print(`  ${cmd.padEnd(14)} ${desc}`));
            printBlank();

            // Show reward-gated commands: unlocked ones in normal colour, locked as dim hints
            const gatedEntries = Object.entries(GATED_CMDS);
            const unlockedGated = gatedEntries.filter(([c]) => isGatedCmdUnlocked(c));
            const lockedGated   = gatedEntries.filter(([c]) => !isGatedCmdUnlocked(c));
            if (unlockedGated.length > 0) {
                print('Special commands:', 'console-line-header');
                unlockedGated.forEach(([cmd, info]) => print(`  ${cmd.padEnd(14)} ${info.desc}`));
                printBlank();
            }
            if (lockedGated.length > 0) {
                print('Locked commands:', 'console-line-header');
                lockedGated.forEach(() => print(`  ${'???'.padEnd(14)} (earn achievements to unlock)`, 'console-line-dim'));
                printBlank();
            }

            print('Garden effects:', 'console-line-header');
            [
                ['bloom',         'Garden bloom effect (~5s)'],
                ['rain',          'Garden rain overlay (~15s)'],
                ['snow',          'Garden snow overlay (~15s)'],
                ['comet',         'Comet overlay (~8s)'],
                ['fireflies',     'Firefly overlay (~20s)'],
                ['constellation', 'Constellation overlay (~20s)'],
            ].forEach(([cmd, desc]) => print(`  ${cmd.padEnd(14)} ${desc}`));
            printBlank();
            print('Easter eggs: spin  dance  summon-cat  grow-tree');
            print('             matrix  love  party  ghost  fortune');
        },

        clear() { clearOutput(); },

        achievements() {
            if (!currentUser) { print('Sign in to view achievements.', 'console-line-err'); return; }
            const unlocked = ACHIEVEMENTS.filter(a => unlockedAchievements.has(a.id));
            if (unlocked.length === 0) { print('No achievements unlocked yet.'); return; }
            print(`Achievements (${unlocked.length}/${ACHIEVEMENTS.length}):`, 'console-line-header');
            printBlank();
            unlocked.forEach(a => print(`  ${a.icon.padEnd(6)} ${a.title}`));
        },

        commands() {
            const cmds = [...unlockedConsoleCmds];
            const lockedCount = Object.keys(GATED_CMDS).filter(c => !isGatedCmdUnlocked(c)).length;
            if (cmds.length === 0) {
                print('No special commands unlocked yet.', 'console-line-dim');
                if (lockedCount > 0) print(`${lockedCount} commands locked — earn achievements to reveal them.`, 'console-line-dim');
                return;
            }
            print('Unlocked special commands:', 'console-line-header');
            cmds.forEach(c => print(`  ${c.padEnd(14)} ${GATED_CMDS[c]?.desc || ''}`));
            if (lockedCount > 0) {
                printBlank();
                print(`${lockedCount} more command${lockedCount > 1 ? 's' : ''} still locked — keep earning achievements!`, 'console-line-dim');
            }
        },

        stats() {
            if (!currentUser) { print('Sign in first.', 'console-line-err'); return; }
            print('--- STATS SUMMARY ---', 'console-line-header');
            const rxGiven  = Object.values(allPosts).reduce((a, p) =>
                a + Object.values(p.reactionsBy||{}).filter(u => u && u[currentUser]).length, 0);
            const letSent  = Object.values(allLetters).filter(l => l.from === currentUser).length;
            const talks    = Number(localStorage.getItem('garden_talkCount') || 0);
            const cats     = Number(localStorage.getItem('catActionCount') || 0);
            print(`  Posts:            ${getMyPostCount()}`);
            print(`  Replies:          ${getMyReplyCount()}`);
            print(`  Reactions Given:  ${rxGiven}`);
            print(`  Letters Sent:     ${letSent}`);
            print(`  Garden Talks:     ${talks}`);
            print(`  Cat Actions:      ${cats}`);
            print(`  Achievements:     ${unlockedAchievements.size} / ${ACHIEVEMENTS.length}`);
            printBlank();
            print('For full details, open Stats.exe', 'console-line-dim');
        },

        reactstats() {
            if (!currentUser) { print('Sign in first.', 'console-line-err'); return; }
            print('--- REACTION STATS ---', 'console-line-header');
            const rxMap = {};
            Object.values(allPosts).forEach(p => {
                Object.entries(p.reactionsBy || {}).forEach(([emoji, users]) => {
                    if (users && users[currentUser]) rxMap[emoji] = (rxMap[emoji] || 0) + 1;
                });
            });
            const total = Object.values(rxMap).reduce((a, b) => a + b, 0);
            print(`  Total reactions given: ${total}`);
            Object.entries(rxMap).sort((a, b) => b[1] - a[1]).forEach(([e, n]) => {
                print(`  ${(EMOTICON_MAP[e] || e).padEnd(4)} ${n}`);
            });
        },

        letters() {
            if (!currentUser) { print('Sign in first.', 'console-line-err'); return; }
            print('--- LETTERS ---', 'console-line-header');
            print(`  Sent:     ${getMyLetterCount()}`);
            const recv = Object.values(allLetters).filter(l => l.to === currentUser).length;
            print(`  Received: ${recv}`);
        },

        catstats() {
            if (!currentUser) { print('Sign in first.', 'console-line-err'); return; }
            print('--- CAT STATS ---', 'console-line-header');
            print(`  Total actions: ${Number(localStorage.getItem('catActionCount') || 0)}`);
        },

        gardenlog() {
            print('--- GARDEN LOG ---', 'console-line-header');
            const talks = Number(localStorage.getItem('garden_talkCount') || 0);
            print(`  Times talked to plant: ${talks}`);
            if (talks === 0) print('  (try the "Talk to Garden" button!)');
        },

        linkstats() {
            if (!currentUser) { print('Sign in first.', 'console-line-err'); return; }
            print('--- LINK STATS ---', 'console-line-header');
            const myLinks = Object.values(allPosts).filter(p => p.author === currentUser && (!p.type || p.type === 'link') && p.url);
            const domainCounts = {};
            myLinks.forEach(p => {
                const d = p.url.match(/https?:\/\/([^\/]+)/)?.[1]?.replace('www.', '') || 'unknown';
                domainCounts[d] = (domainCounts[d] || 0) + 1;
            });
            print(`  Links shared: ${myLinks.length}`);
            const sorted = Object.entries(domainCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);
            if (sorted.length > 0) {
                printBlank();
                print('  Top domains:', 'console-line-dim');
                sorted.forEach(([d, n]) => print(`    ${d.padEnd(28)} ${n}`));
            }
            const linksRead = Number(localStorage.getItem('linksOpenedCount') || 0);
            printBlank();
            print(`  Links opened (theirs):  ${linksRead}`);
        },

        whoami() {
            if (!currentUser) { print('Sign in first.', 'console-line-err'); return; }
            print('--- PROFILE ---', 'console-line-header');
            const lvl       = xpToLevel(xpTotal);
            const achCount  = unlockedAchievements.size;
            const myLinks   = Object.values(allPosts).filter(p => p.author === currentUser && (!p.type || p.type === 'link') && p.url).length;
            const catDays   = (() => { try { return JSON.parse(localStorage.getItem('catInteractDays') || '[]').length; } catch(_) { return 0; } })();
            const visitDays = (() => { try { return JSON.parse(localStorage.getItem('siteVisitDays') || '[]').length; } catch(_) { return 0; } })();
            print(`  User:             ${currentUser}`);
            print(`  Garden Level:     ${lvl}  (${xpTotal} XP)`);
            print(`  Achievements:     ${achCount} / ${ACHIEVEMENTS.length}`);
            printBlank();
            print(`  Posts:            ${getMyPostCount()}`);
            print(`  Links shared:     ${myLinks}`);
            print(`  Cat days:         ${catDays}`);
            print(`  Days visited:     ${visitDays}`);
            printBlank();
            const nightVisits   = Number(localStorage.getItem('nightVisitCount') || 0);
            const morningVisits = Number(localStorage.getItem('morningVisitCount') || 0);
            if (nightVisits > 0 || morningVisits > 0) {
                print(`  Night visits:     ${nightVisits}   Morning visits: ${morningVisits}`, 'console-line-dim');
            }
        },

        // ---- Easter eggs ----
        spin()        { _eggSpin();        print('The icons are dizzy.', 'console-line-egg'); },
        dance()       { _eggDance();       print('(ﾉ◕ヮ◕)ﾉ*:･ﾟ✧ dance break!', 'console-line-egg'); },
        'summon-cat'(){ _eggSummonCat();   print('A cat wanders in from the east...', 'console-line-egg'); },
        'grow-tree'() { _eggGrowTree();    print('A pixel tree sprouts on the desktop.', 'console-line-egg'); },
        matrix()      { _eggMatrix();      print('Wake up, Neo...', 'console-line-egg'); },
        love()        { _eggLove();        print('♡ ♡ ♡', 'console-line-egg'); },
        party()       { _eggParty();       print('🎉 Party mode activated!', 'console-line-egg'); },
        ghost()       { _eggGhost();       print('Boo!', 'console-line-egg'); },
        fortune()     { print(FORTUNES[Math.floor(Math.random() * FORTUNES.length)], 'console-line-egg'); },

        // ---- Garden effects ----
        bloom() {
            if (!document.getElementById('w95-win-garden')) {
                print('Open Garden.exe first, then try again.', 'console-line-dim'); return;
            }
            triggerXpBloom();
            print('🌸 Garden bloom activated.', 'console-line-egg');
        },
        rain() {
            if (!document.getElementById('w95-win-garden')) {
                print('Open Garden.exe first, then try again.', 'console-line-dim'); return;
            }
            triggerGardenOverlay('rain', 15000);
            print('🌧️ Rain overlay started (~15s).', 'console-line-egg');
        },
        snow() {
            if (!document.getElementById('w95-win-garden')) {
                print('Open Garden.exe first, then try again.', 'console-line-dim'); return;
            }
            triggerGardenOverlay('snow', 15000);
            print('❄️ Snow overlay started (~15s).', 'console-line-egg');
        },
        comet() {
            if (!document.getElementById('w95-win-garden')) {
                print('Open Garden.exe first, then try again.', 'console-line-dim'); return;
            }
            triggerGardenOverlay('comet', 8000);
            print('☄️ Comet streaking across the sky (~8s).', 'console-line-egg');
        },
        fireflies() {
            if (!document.getElementById('w95-win-garden')) {
                print('Open Garden.exe first, then try again.', 'console-line-dim'); return;
            }
            triggerGardenOverlay('fireflies', 20000);
            print('✨ Fireflies awakened (~20s).', 'console-line-egg');
        },
        constellation() {
            if (!document.getElementById('w95-win-garden')) {
                print('Open Garden.exe first, then try again.', 'console-line-dim'); return;
            }
            triggerXpConstellation();
            print('🌌 Constellation overlay active (~20s).', 'console-line-egg');
        },
    };

    // ---- Run a command ----
    function runCmd(raw) {
        const trimmed = raw.trim();
        if (!trimmed) return;
        history.unshift(trimmed);
        if (history.length > 30) history.pop();
        histIdx = -1;

        print(`C:\\> ${trimmed}`, 'console-line-prompt');

        const [cmd, ...args] = trimmed.split(/\s+/);
        const cmdLower = cmd.toLowerCase();

        // Check if this is a reward-gated command that isn't unlocked yet
        if (GATED_CMDS[cmdLower] && !isGatedCmdUnlocked(cmdLower)) {
            print(`'${cmd}' is locked. Earn achievements to unlock special commands.`, 'console-line-dim');
            print("Type 'commands' to see what's available.", 'console-line-dim');
            sparkSound('cmd_error');
            printBlank();
            return;
        }

        const handler = CMD_HANDLERS[cmdLower];
        if (handler) {
            handler(args);
            sparkSound('cmd_success');
            // Track console use for Console Wizard achievement
            const cmdUses = Number(localStorage.getItem('consoleCommandCount') || 0) + 1;
            localStorage.setItem('consoleCommandCount', String(cmdUses));
            if (cmdUses >= 10) unlockAchievement('console_wizard');
            if (unlockedAchievements.size >= 10) unlockAchievement('power_user');
        } else {
            print(`'${cmd}' is not recognized as a command.`, 'console-line-err');
            print("Type 'help' for a list of commands.", 'console-line-dim');
            sparkSound('cmd_error');
        }
        printBlank();
    }

    // Refresh console hints panel when a new command is unlocked
    document.addEventListener('rewardUnlocked', (e) => {
        if (win.classList.contains('is-hidden')) return;
        if (e.detail?.reward?.type === REWARD_TYPE_CONSOLE_COMMAND) {
            const cmdName = e.detail.reward.name.replace(/^\//, '');
            print(`\u2713 Command unlocked: ${cmdName}`, 'console-line-header');
            printBlank();
        }
    });

    // ---- Input handling ----
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const val = input.value;
            input.value = '';
            runCmd(val);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (histIdx < history.length - 1) { histIdx++; input.value = history[histIdx] || ''; }
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (histIdx > 0) { histIdx--; input.value = history[histIdx] || ''; }
            else { histIdx = -1; input.value = ''; }
        }
    });

    // ---- Show / hide ----
    function show() {
        const _wasHiddenConsole = win.classList.contains('is-hidden');
        if (!taskbarBtn) taskbarBtn = w95Mgr.addTaskbarBtn('w95-win-console', 'CONSOLE', () => {
            if (win.classList.contains('is-hidden')) show(); else hide();
        });
        win.classList.remove('is-hidden');
        w95Mgr.focusWindow('w95-win-console');
        localStorage.setItem('w95_console_open', '1');
        if (_wasHiddenConsole) _trackWindowOpen('console');
        if (output.children.length === 0) {
            print('Personal Feed Console  v1.0', 'console-line-header');
            print('Type \'help\' for available commands.', 'console-line-dim');
            printBlank();
        }
        setTimeout(() => input.focus(), 50);
    }
    function hide() {
        win.classList.add('is-hidden');
        if (w95Mgr.isActiveWin('w95-win-console')) w95Mgr.focusWindow(null);
        localStorage.setItem('w95_console_open', '0');
    }

    if (minBtn)   minBtn.addEventListener('click',  e => { e.stopPropagation(); hide(); });
    if (maxBtn)   maxBtn.addEventListener('click',  e => { e.stopPropagation(); w95Mgr.toggleMaximise(win, 'w95-win-console'); });
    if (closeBtn) closeBtn.addEventListener('click', e => {
        e.stopPropagation();
        if (w95Mgr.isMaximised('w95-win-console')) w95Mgr.toggleMaximise(win, 'w95-win-console');
        hide();
        if (taskbarBtn) { taskbarBtn.remove(); taskbarBtn = null; }
    });

    makeDraggable(win, handle, 'w95-win-console');

    w95Apps['console'] = { open: () => {
        if (win.classList.contains('is-hidden')) show(); else w95Mgr.focusWindow('w95-win-console');
    }};

    // Defer auto-restore until after the first paint so the window system is
    // fully initialised and the flex layout is applied before show() runs.
    if (localStorage.getItem('w95_console_open') === '1') requestAnimationFrame(show);

    // ---- Easter egg implementations ----
    function _overlay(cls, duration) {
        const el = document.createElement('div');
        el.className = 'egg-overlay ' + cls;
        document.getElementById('w95-desktop')?.appendChild(el);
        setTimeout(() => el.remove(), duration);
        return el;
    }

    function _eggRain() {
        const desk = document.getElementById('w95-desktop');
        if (!desk) return;
        const el = document.createElement('div');
        el.className = 'egg-overlay egg-rain';
        desk.appendChild(el);
        const W = desk.offsetWidth, H = desk.offsetHeight;
        for (let i = 0; i < 60; i++) {
            const drop = document.createElement('div');
            drop.className = 'egg-raindrop';
            drop.style.cssText = `left:${Math.random()*W}px;animation-delay:${Math.random()*1.5}s;animation-duration:${0.6+Math.random()*0.6}s;height:${8+Math.random()*12}px;`;
            el.appendChild(drop);
        }
        setTimeout(() => el.remove(), 5000);
    }

    function _eggSpin() {
        document.querySelectorAll('.w95-desktop-icon').forEach(ic => {
            ic.classList.add('egg-spin');
            setTimeout(() => ic.classList.remove('egg-spin'), 1200);
        });
    }

    function _eggDance() {
        document.querySelectorAll('.w95-desktop-icon').forEach((ic, i) => {
            ic.style.setProperty('--egg-dance-delay', `${i * 60}ms`);
            ic.classList.add('egg-dance');
            setTimeout(() => ic.classList.remove('egg-dance'), 2000);
        });
    }

    function _eggSummonCat() {
        const desk = document.getElementById('w95-desktop');
        if (!desk) return;
        const cat = document.createElement('div');
        cat.className = 'egg-summon-cat';
        cat.textContent = '🐱';
        desk.appendChild(cat);
        setTimeout(() => cat.remove(), 4000);
    }

    function _eggGrowTree() {
        const desk = document.getElementById('w95-desktop');
        if (!desk) return;
        const tree = document.createElement('div');
        tree.className = 'egg-tree';
        tree.textContent = '🌲';
        tree.style.left = `${100 + Math.random() * 300}px`;
        tree.style.top  = `${60  + Math.random() * 200}px`;
        desk.appendChild(tree);
        setTimeout(() => tree.classList.add('egg-tree-fade'), 6000);
        setTimeout(() => tree.remove(), 7200);
    }

    function _eggMatrix() {
        const desk = document.getElementById('w95-desktop');
        if (!desk) return;
        const el = document.createElement('div');
        el.className = 'egg-matrix';
        desk.appendChild(el);
        const chars = '01アイウエオカキクケコ';
        let frame = 0;
        const iv = setInterval(() => {
            let html = '';
            for (let r = 0; r < 14; r++) {
                let row = '';
                for (let c = 0; c < 24; c++) {
                    row += chars[Math.floor(Math.random() * chars.length)];
                }
                html += `<div>${row}</div>`;
            }
            el.innerHTML = html;
            if (++frame > 50) { clearInterval(iv); el.remove(); }
        }, 80);
    }

    function _eggLove() {
        const desk = document.getElementById('w95-desktop');
        if (!desk) return;
        const W = desk.offsetWidth;
        for (let i = 0; i < 15; i++) {
            const h = document.createElement('div');
            h.className = 'egg-heart';
            h.textContent = '♡';
            h.style.left = `${Math.random() * W}px`;
            h.style.animationDelay = `${Math.random() * 1.5}s`;
            desk.appendChild(h);
            setTimeout(() => h.remove(), 3500);
        }
    }

    function _eggParty() {
        const desk = document.getElementById('w95-desktop');
        if (!desk) return;
        const colors = ['#ff6b6b','#ffd93d','#6bcb77','#4d96ff','#ff922b','#cc5de8'];
        let t = 0;
        const iv = setInterval(() => {
            desk.style.outline = `4px solid ${colors[t % colors.length]}`;
            if (++t > 14) { clearInterval(iv); desk.style.outline = ''; }
        }, 120);
    }

    function _eggGhost() {
        const desk = document.getElementById('w95-desktop');
        if (!desk) return;
        const g = document.createElement('div');
        g.className = 'egg-ghost';
        g.textContent = '👻';
        desk.appendChild(g);
        setTimeout(() => g.remove(), 4000);
    }
})();

// ===== System Clock =====
(() => {
    const clockEl = document.getElementById('systemClock');
    if (!clockEl) return;

    function pad(n) { return String(n).padStart(2, '0'); }

    function tickClock() {
        const d = new Date();
        clockEl.textContent = pad(d.getHours()) + ':' + pad(d.getMinutes());
    }

    tickClock();
    // Align to the next full minute, then tick every 30s for responsiveness
    const now = new Date();
    const msToNextMinute = (60 - now.getSeconds()) * 1000 - now.getMilliseconds();
    setTimeout(() => {
        tickClock();
        setInterval(tickClock, 30000);
    }, msToNextMinute);

    // Click → open Date & Time window
    clockEl.addEventListener('click', () => w95Apps['datetime']?.open());
    clockEl.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); w95Apps['datetime']?.open(); }
    });
})();

// ===== Date & Time Window =====
(() => {
    const win      = document.getElementById('w95-win-datetime');
    const handle   = document.getElementById('w95-datetime-handle');
    const closeBtn = document.getElementById('w95-datetime-close');
    const dateEl   = document.getElementById('datetime-date');
    const timeEl   = document.getElementById('datetime-time');
    if (!win || !dateEl || !timeEl) return;

    let _ticker = null;

    const DAYS   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

    function pad(n) { return String(n).padStart(2, '0'); }

    function tickDatetime() {
        const d = new Date();
        dateEl.textContent = `${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
        timeEl.textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    }

    function showDatetime() {
        win.classList.remove('is-hidden');
        w95Mgr.focusWindow('w95-win-datetime');
        tickDatetime();
        _ticker = setInterval(tickDatetime, 1000);
    }

    function hideDatetime() {
        win.classList.add('is-hidden');
        clearInterval(_ticker);
        _ticker = null;
        if (w95Mgr.isActiveWin('w95-win-datetime')) w95Mgr.focusWindow(null);
    }

    closeBtn?.addEventListener('click', hideDatetime);

    if (handle) makeDraggable(win, handle, 'w95-win-datetime');

    w95Apps['datetime'] = {
        open: () => {
            if (win.classList.contains('is-hidden')) showDatetime();
            else w95Mgr.focusWindow('w95-win-datetime');
        }
    };
})();

// ===== System Tray =====
(() => {
    const trayChat   = document.getElementById('tray-chat');
    const trayGarden = document.getElementById('tray-garden');
    const traySound  = document.getElementById('tray-sound');
    const trayMotion = document.getElementById('tray-motion');

    // ---- Sound toggle icon ----
    function syncSoundIcon() {
        if (!traySound) return;
        const on = soundEnabled;
        traySound.textContent  = on ? '\uD83D\uDD0A' : '\uD83D\uDD07';
        traySound.title        = on ? 'Sound: on (click to mute)' : 'Sound: muted (click to unmute)';
        traySound.classList.toggle('tray-muted', !on);
    }
    if (traySound) {
        syncSoundIcon();
        traySound.addEventListener('click', () => {
            soundEnabled = !soundEnabled;
            localStorage.setItem('soundEnabled', soundEnabled ? 'true' : 'false');
            syncSoundIcon();
        });
    }

    // ---- Motion toggle icon ----
    // We store a user-override in localStorage; it doesn't change the system preference
    // but we can use it to skip our own animations.
    let motionEnabled = localStorage.getItem('motionEnabled') !== 'false';

    function syncMotionIcon() {
        if (!trayMotion) return;
        trayMotion.textContent = motionEnabled ? '\u2728' : '\u2B55';
        trayMotion.title       = motionEnabled ? 'Motion: on (click to reduce)' : 'Motion: reduced (click to enable)';
        trayMotion.classList.toggle('tray-muted', !motionEnabled);
        // Expose for other code that may want to respect this setting
        window._motionEnabled = motionEnabled;
    }
    if (trayMotion) {
        syncMotionIcon();
        trayMotion.addEventListener('click', () => {
            motionEnabled = !motionEnabled;
            localStorage.setItem('motionEnabled', motionEnabled ? 'true' : 'false');
            syncMotionIcon();
        });
    }

    // ---- Chat unread indicator ----
    // Runs after chat messages are loaded; piggybacks on updateChatUnread patch.
    function syncChatTrayIcon(unreadCount) {
        if (!trayChat) return;
        const hasUnread = unreadCount > 0;
        trayChat.classList.toggle('tray-has-unread', hasUnread);
        trayChat.title = hasUnread
            ? `Chat: ${unreadCount} unread message${unreadCount === 1 ? '' : 's'} (click to open)`
            : 'Chat (click to open)';
    }

    // Patch updateChatUnread to also update the tray icon
    const _origUpdateChatUnread = window.updateChatUnread;
    window.updateChatUnread = function (messages) {
        if (typeof _origUpdateChatUnread === 'function') _origUpdateChatUnread(messages);
        const unread = Array.isArray(messages)
            ? messages.filter(m => m.timestamp > lastChatSeenTs && m.author !== currentUser).length
            : 0;
        syncChatTrayIcon(unread);
    };

    if (trayChat) {
        syncChatTrayIcon(0);
        trayChat.addEventListener('click', () => w95Apps['chat']?.open());
    }

    // ---- Garden status icon ----
    if (trayGarden) {
        trayGarden.title = 'Garden (click to open)';
        trayGarden.addEventListener('click', () => w95Apps['garden']?.open());
    }

    // ---- Network status icon ----
    const trayNetwork = document.getElementById('tray-network');
    if (trayNetwork) {
        function syncNetworkIcon() {
            const online = navigator.onLine;
            trayNetwork.textContent = online ? '\uD83D\uDCF6' : '\uD83D\uDCF5'; // 📶 or 📵
            trayNetwork.title = online ? 'Network: connected' : 'Network: disconnected';
            trayNetwork.classList.toggle('tray-muted', !online);
        }
        syncNetworkIcon();
        window.addEventListener('online',  syncNetworkIcon);
        window.addEventListener('offline', syncNetworkIcon);
    }

    // ---- Bell / notifications icon ----
    const trayBell = document.getElementById('tray-bell');
    if (trayBell) {
        trayBell.addEventListener('click', toggleNotifPanel);
        trayBell.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleNotifPanel(); } });
    }
    document.getElementById('notifClearBtn')?.addEventListener('click', () => {
        _inAppNotifs = [];
        _saveInAppNotifs();
        _updateBellBadge();
        _renderNotifPanel();
    });
    // Close panel when clicking outside
    document.addEventListener('click', (e) => {
        const panel = document.getElementById('notif-panel');
        const bell  = document.getElementById('tray-bell');
        if (!panel?.classList.contains('is-hidden') && !panel?.contains(e.target) && !bell?.contains(e.target)) {
            closeNotifPanel();
        }
    }, true);
})();

// ===== Win95 Stats.exe Window =====
(() => {
    const win      = document.getElementById('w95-win-stats');
    const minBtn   = document.getElementById('w95-stats-min');
    const maxBtn   = document.getElementById('w95-stats-max');
    const closeBtn = document.getElementById('w95-stats-close');
    const handle   = document.getElementById('w95-stats-handle');
    if (!win || !minBtn || !closeBtn || !handle) return;

    let btn = null;
    let activeTab = 'overview';

    // ---- Helpers ----
    function na() { return '<span class="stats-na">No data yet</span>'; }
    function fmtDate(ts) {
        if (!ts) return na();
        return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    }
    function row(label, value) {
        return `<div class="stats-row"><span class="stats-label">${label}</span><span class="stats-value">${value}</span></div>`;
    }
    function section(title, rows) {
        return `<div class="stats-section"><div class="stats-section-title">${title}</div>${rows.join('')}</div>`;
    }
    function myPosts()   { return Object.values(allPosts).filter(p => p.author === currentUser); }
    function myReplies() { return Object.values(allPosts).flatMap(p => (p.replies||[]).filter(r => r.author === currentUser)); }

    // ---- Tab renderers ----
    function renderOverview() {
        const posts      = myPosts().length;
        const replies    = myReplies().length;
        const rxGiven    = Object.values(allPosts).reduce((a, p) =>
            a + Object.values(p.reactionsBy||{}).filter(u => u && u[currentUser]).length, 0);
        const rxReceived = Object.values(allPosts)
            .filter(p => p.author === currentUser)
            .reduce((a, p) => a + Object.values(p.reactionsBy||{})
                .reduce((b, users) => b + Object.keys(users||{}).length, 0), 0);
        const letSent    = Object.values(allLetters).filter(l => l.from === currentUser).length;
        const letRecv    = Object.values(allLetters).filter(l => l.to   === currentUser).length;
        const talks      = Number(localStorage.getItem('garden_talkCount') || 0);
        const cats       = Number(localStorage.getItem('catActionCount') || 0);
        return section('Overview', [
            row('Posts',               posts),
            row('Replies',             replies),
            row('Reactions Given',     rxGiven),
            row('Reactions Received',  rxReceived),
            row('Letters Sent',        letSent),
            row('Letters Received',    letRecv),
            row('Garden Talks',        talks),
            row('Cat Actions',         cats),
            row('Achievements',        `${unlockedAchievements.size} / ${ACHIEVEMENTS.length}`),
            row('XP',                  xpTotal),
            row('Level',               xpToLevel(xpTotal)),
        ]);
    }

    function renderFeed() {
        const posts = myPosts();
        if (!posts.length) return section('Feed', [row('Total Posts', 0), row('', '<span class="stats-na">No posts yet</span>')]);
        posts.sort((a, b) => (a.timestamp||0) - (b.timestamp||0));
        const first   = posts[0];
        const latest  = posts[posts.length - 1];
        const lengths = posts.map(p => (p.body||'').length).filter(l => l > 0);
        const maxLen  = lengths.length ? Math.max(...lengths) : 0;
        const minLen  = lengths.length ? Math.min(...lengths) : 0;
        const totalWords = posts.reduce((a, p) =>
            a + (p.body||'').trim().split(/\s+/).filter(Boolean).length, 0);
        const imagePosts = posts.filter(p => p.mediaUrl || p.imageUrl).length;
        let avgPerWeek = na();
        if (first?.timestamp) {
            const weeks = Math.max(1, (Date.now() - first.timestamp) / (7 * 24 * 3600 * 1000));
            avgPerWeek  = (posts.length / weeks).toFixed(1) + ' / week';
        }
        return section('Feed', [
            row('Total Posts',       posts.length),
            row('First Post',        fmtDate(first?.timestamp)),
            row('Most Recent Post',  fmtDate(latest?.timestamp)),
            row('Avg Posts / Week',  avgPerWeek),
            row('Longest Post',      maxLen ? `${maxLen} chars` : na()),
            row('Shortest Post',     minLen ? `${minLen} chars` : na()),
            row('Total Words',       totalWords.toLocaleString()),
            row('Image Posts',       imagePosts),
        ]);
    }

    function renderLetters() {
        const sent = Object.values(allLetters).filter(l => l.from === currentUser)
            .sort((a, b) => (a.createdAt||0) - (b.createdAt||0));
        const recv = Object.values(allLetters).filter(l => l.to === currentUser)
            .sort((a, b) => (a.createdAt||0) - (b.createdAt||0));
        const longestSent = sent.length ? Math.max(...sent.map(l => (l.body||'').length)) : 0;
        const totalWords  = sent.reduce((a, l) =>
            a + (l.body||'').trim().split(/\s+/).filter(Boolean).length, 0);
        const firstDate   = sent[0]?.createdAt || recv[0]?.createdAt || null;
        return section('Letters', [
            row('Sent',              sent.length),
            row('Received',          recv.length),
            row('First Letter',      fmtDate(firstDate)),
            row('Most Recent Sent',  fmtDate(sent[sent.length - 1]?.createdAt)),
            row('Most Recent Recv',  fmtDate(recv[recv.length - 1]?.createdAt)),
            row('Longest Sent',      longestSent ? `${longestSent} chars` : na()),
            row('Total Words Sent',  totalWords.toLocaleString()),
        ]);
    }

    function renderGarden() {
        const talks     = Number(localStorage.getItem('garden_talkCount') || 0);
        const visitDays = Object.keys(gardenVisitDays).length;
        return section('Garden', [
            row('Times Watered',      totalWaterings),
            row('Garden Visit Days',  visitDays),
            row('Watering Streak',    currentWateringStreak ? `${currentWateringStreak} days` : '0 days'),
            row('Visit Streak',       gardenVisitStreak.current ? `${gardenVisitStreak.current} days` : '0 days'),
            row('Times Talked To',    talks),
            row('3x/day Streak',      water3Streak.current ? `${water3Streak.current} days` : '0 days'),
        ]);
    }

    async function renderCatAsync() {
        const panel = document.getElementById('stats-panel');
        if (!panel) return;
        const total = Number(localStorage.getItem('catActionCount') || 0);
        panel.innerHTML = section('Cat', [
            row('Total Actions', total),
            row('Cat Name',   '<span class="stats-na">Loading…</span>'),
            row('Hunger',     '<span class="stats-na">Loading…</span>'),
            row('Thirst',     '<span class="stats-na">Loading…</span>'),
            row('Play',       '<span class="stats-na">Loading…</span>'),
        ]);
        try {
            const snap = await get(ref(database, `cat/${currentUser}`));
            const c    = snap.val() || {};
            if (activeTab !== 'cat') return;
            panel.innerHTML = section('Cat', [
                row('Total Actions', total),
                row('Cat Name',  c.catName || na()),
                row('Hunger',    c.hunger != null ? `${Math.round(c.hunger)}%` : na()),
                row('Thirst',    c.thirst != null ? `${Math.round(c.thirst)}%` : na()),
                row('Play',      c.play   != null ? `${Math.round(c.play)}%`   : na()),
            ]);
        } catch (_) { /* ignore */ }
    }

    function renderXP() {
        const unlocked = ACHIEVEMENTS.filter(a => unlockedAchievements.has(a.id));
        const locked   = ACHIEVEMENTS.filter(a => !unlockedAchievements.has(a.id) && !a.hidden);
        const level    = xpToLevel(xpTotal);
        const nextXp   = xpForLevel(level + 1);
        const rarest   = unlocked.length
            ? unlocked.reduce((best, a) => (a.xp||0) > (best.xp||0) ? a : best, unlocked[0])
            : null;
        return section('Achievements & XP', [
            row('Total XP',           xpTotal),
            row('Level',              level),
            row('Next Level At',      `${nextXp} XP`),
            row('Unlocked',           `${unlocked.length} / ${ACHIEVEMENTS.length}`),
            row('Locked (visible)',   locked.length),
            row('Rarest Unlocked',    rarest ? `${rarest.icon} ${rarest.title}` : na()),
        ]);
    }

    // ---- Render panel ----
    function renderPanel() {
        const panel = document.getElementById('stats-panel');
        if (!panel) return;
        if (!currentUser) {
            panel.innerHTML = '<div class="stats-empty">Sign in to view stats</div>';
            return;
        }
        if (activeTab === 'cat') { renderCatAsync(); return; }
        let html = '';
        if      (activeTab === 'overview') html = renderOverview();
        else if (activeTab === 'feed')     html = renderFeed();
        else if (activeTab === 'letters')  html = renderLetters();
        else if (activeTab === 'garden')   html = renderGarden();
        else if (activeTab === 'xp')       html = renderXP();
        panel.innerHTML = html;
    }

    // ---- Tab switching ----
    document.getElementById('stats-tabs')?.addEventListener('click', e => {
        const tab = e.target.closest('.stats-tab');
        if (!tab) return;
        activeTab = tab.dataset.tab;
        document.querySelectorAll('#stats-tabs .stats-tab').forEach(t =>
            t.classList.toggle('active', t === tab));
        renderPanel();
    });

    // ---- Show / hide ----
    function show() {
        if (!btn) btn = w95Mgr.addTaskbarBtn('w95-win-stats', 'STATS', () => {
            if (win.classList.contains('is-hidden')) show(); else hide();
        });
        win.classList.remove('is-hidden');
        w95Mgr.focusWindow('w95-win-stats');
        localStorage.setItem('w95_stats_open', '1');
        renderPanel();
    }

    function hide() {
        win.classList.add('is-hidden');
        if (w95Mgr.isActiveWin('w95-win-stats')) w95Mgr.focusWindow(null);
        localStorage.setItem('w95_stats_open', '0');
    }

    function closeWin() {
        if (w95Mgr.isMaximised('w95-win-stats')) w95Mgr.toggleMaximise(win, 'w95-win-stats');
        hide();
        if (btn) { btn.remove(); btn = null; }
    }

    minBtn.onclick   = (e) => { e.stopPropagation(); hide(); };
    maxBtn.onclick   = (e) => { e.stopPropagation(); w95Mgr.toggleMaximise(win, 'w95-win-stats'); };
    closeBtn.onclick = (e) => { e.stopPropagation(); closeWin(); };

    win.addEventListener('mousedown', () => w95Mgr.focusWindow('w95-win-stats'));

    if (localStorage.getItem('w95_stats_open') === '1') show();

    makeDraggable(win, handle, 'w95-win-stats');

    w95Apps['stats'] = { open: () => {
        if (win.classList.contains('is-hidden')) show(); else w95Mgr.focusWindow('w95-win-stats');
    }};
})();

// ===== Window sound wiring =====
// Event delegation (capture phase) for close / min / max button clicks.
// Fires before each window IIFE's own handler so sound plays on the interaction.
document.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const win = btn.closest('.w95-window');
    if (!win) return;
    if (btn.classList.contains('w95-control-close')) {
        sparkSound('window_close');
    } else if (btn.getAttribute('aria-label') === 'Minimise') {
        sparkSound('window_min');
    } else if (btn.getAttribute('aria-label') === 'Maximise') {
        // Read state before the handler flips it
        sparkSound(win.classList.contains('is-maximised') ? 'window_restore' : 'window_max');
    }
}, true);

// MutationObserver: play window_open whenever a window transitions from hidden → visible.
// (Close/minimise are covered by the event delegation above.)
(() => {
    const observer = new MutationObserver((mutations) => {
        for (const m of mutations) {
            if (m.type !== 'attributes' || m.attributeName !== 'class') continue;
            const wasHidden = (m.oldValue || '').includes('is-hidden');
            const isHidden  = m.target.classList.contains('is-hidden');
            if (wasHidden && !isHidden) sparkSound('window_open');
        }
    });
    document.querySelectorAll('.w95-window').forEach(w => {
        observer.observe(w, { attributes: true, attributeOldValue: true });
    });
})();

    // Start ambience if enabled on load
    if (soundEnabled && soundAmbience) startAmbience();

} // end initApp

window.addEventListener('DOMContentLoaded', initApp, { once: true });

// ===== Animated Wallpapers =====
// Runs canvas-based background animations for wallpapers with animated:true.
// Exposes window._animWallpaper = { start(id), stop() }.
(function () {
    const canvas = document.getElementById('wallpaper-anim-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const rmq = window.matchMedia('(prefers-reduced-motion: reduce)');

    let rafId   = null;
    let activeId = null;
    let frame   = 0;

    // ---- Shared helpers ----
    function resizeCanvas() {
        canvas.width  = canvas.offsetWidth  || window.innerWidth;
        canvas.height = canvas.offsetHeight || (window.innerHeight - 40);
    }

    // ---- Clouds ----
    const CLOUDS = [];

    function initClouds() {
        const W = canvas.width, H = canvas.height;
        CLOUDS.length = 0;
        for (let i = 0; i < 8; i++) {
            CLOUDS.push({
                x:     Math.random() * W,
                y:     40 + Math.random() * H * 0.5,
                speed: 0.12 + Math.random() * 0.25,
                scale: 0.55 + Math.random() * 0.85,
                alpha: 0.70 + Math.random() * 0.28,
            });
        }
    }

    function _drawCloudShape(cx, cy, scale) {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(scale, scale);
        ctx.beginPath();
        ctx.arc(  0,  0, 28, 0, Math.PI * 2);
        ctx.arc( 32,-10, 22, 0, Math.PI * 2);
        ctx.arc( 58,  0, 25, 0, Math.PI * 2);
        ctx.arc( 38, 14, 20, 0, Math.PI * 2);
        ctx.arc( 12, 14, 18, 0, Math.PI * 2);
        ctx.arc(-18,  8, 20, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    function animateClouds() {
        const W = canvas.width, H = canvas.height;

        // Sky gradient
        const sky = ctx.createLinearGradient(0, 0, 0, H);
        sky.addColorStop(0,   '#4a9fd6');
        sky.addColorStop(0.55, '#87ceeb');
        sky.addColorStop(1,   '#c8e8f8');
        ctx.fillStyle = sky;
        ctx.fillRect(0, 0, W, H);

        for (const c of CLOUDS) {
            c.x += c.speed;
            if (c.x - 80 * c.scale > W) c.x = -120 * c.scale;
            ctx.save();
            ctx.globalAlpha = c.alpha;
            ctx.fillStyle = '#ffffff';
            ctx.shadowBlur  = 18;
            ctx.shadowColor = 'rgba(200,230,255,0.6)';
            _drawCloudShape(c.x, c.y, c.scale);
            ctx.restore();
        }
    }

    // ---- Forest ----
    const TREES = [];

    function initForest() {
        const W = canvas.width, H = canvas.height;
        TREES.length = 0;
        const count = Math.max(10, Math.round(W / 50));
        for (let i = 0; i < count; i++) {
            const layer = (i % 3 === 0) ? 1 : 0;  // 1 = foreground
            TREES.push({
                x:      (i / count) * W + (Math.random() - 0.5) * (W / count * 0.5),
                height: H * (layer === 1 ? 0.48 + Math.random() * 0.18 : 0.30 + Math.random() * 0.20),
                width:  layer === 1 ? 14 + Math.random() * 10 : 8 + Math.random() * 8,
                phase:  Math.random() * Math.PI * 2,
                freq:   0.40 + Math.random() * 0.35,
                amp:    0.014 + Math.random() * 0.010,
                layer,
            });
        }
        TREES.sort((a, b) => a.layer - b.layer);
    }

    function _drawTree(tree, t) {
        const H = canvas.height;
        const sway    = Math.sin(t * tree.freq + tree.phase) * tree.amp;
        const baseX   = tree.x;
        const baseY   = H;
        const tipX    = baseX + Math.sin(sway) * tree.height;
        const tipY    = baseY - tree.height;
        const midX    = baseX + (tipX - baseX) * 0.45;
        const midY    = baseY + (tipY - baseY) * 0.45;

        ctx.save();
        ctx.strokeStyle = tree.layer === 1 ? '#0a1808' : '#162810';
        ctx.lineWidth   = tree.width;
        ctx.lineCap     = 'round';
        ctx.beginPath();
        ctx.moveTo(baseX, baseY);
        ctx.quadraticCurveTo(midX, midY, tipX, tipY);
        ctx.stroke();

        // Two side branches near the upper third
        for (let b = 0; b < 2; b++) {
            const bp    = 0.62 + b * 0.14;
            const bx    = baseX + (tipX - baseX) * bp;
            const by    = baseY + (tipY - baseY) * bp;
            const bLen  = tree.height * (0.18 - b * 0.04);
            const dir   = (b % 2 === 0 ? 1 : -1);
            const bSway = sway * 1.6;
            const endX  = bx + Math.cos(dir * 1.1 + bSway) * bLen;
            const endY  = by - Math.abs(Math.sin(dir * 1.1 + bSway)) * bLen * 0.8;
            ctx.lineWidth = tree.width * 0.35;
            ctx.beginPath();
            ctx.moveTo(bx, by);
            ctx.lineTo(endX, endY);
            ctx.stroke();
        }
        ctx.restore();
    }

    function animateForest() {
        const W = canvas.width, H = canvas.height;
        const t = frame / 60;

        // Dusk sky
        const sky = ctx.createLinearGradient(0, 0, 0, H);
        sky.addColorStop(0,    '#181c2e');
        sky.addColorStop(0.35, '#2a3a28');
        sky.addColorStop(0.70, '#1a3010');
        sky.addColorStop(1,    '#0c1a08');
        ctx.fillStyle = sky;
        ctx.fillRect(0, 0, W, H);

        // Distant moon glow
        const moonX = W * 0.72, moonY = H * 0.18, moonR = 18;
        const moonGrad = ctx.createRadialGradient(moonX, moonY, 0, moonX, moonY, moonR * 4);
        moonGrad.addColorStop(0,   'rgba(230,230,180,0.22)');
        moonGrad.addColorStop(1,   'transparent');
        ctx.fillStyle = moonGrad;
        ctx.fillRect(moonX - moonR * 4, moonY - moonR * 4, moonR * 8, moonR * 8);
        ctx.fillStyle = '#e8e8c8';
        ctx.beginPath();
        ctx.arc(moonX, moonY, moonR, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#2a3a28';
        ctx.beginPath();
        ctx.arc(moonX + 6, moonY - 2, moonR * 0.8, 0, Math.PI * 2);
        ctx.fill();

        // Background trees (layer 0)
        for (const tree of TREES) {
            if (tree.layer === 0) _drawTree(tree, t);
        }

        // Ground strip
        ctx.fillStyle = '#080e06';
        ctx.fillRect(0, H * 0.84, W, H * 0.16);

        // Foreground trees (layer 1)
        for (const tree of TREES) {
            if (tree.layer === 1) _drawTree(tree, t);
        }
    }

    // ---- Night Sky ----
    const STARS      = [];
    const MOON_NS    = {};
    let shootTimer   = 0;
    let shoot        = null;

    function initNightSky() {
        const W = canvas.width, H = canvas.height;
        STARS.length = 0;
        for (let i = 0; i < 220; i++) {
            STARS.push({
                x:          Math.random() * W,
                y:          Math.random() * H * 0.92,
                size:       0.4 + Math.random() * 1.6,
                phase:      Math.random() * Math.PI * 2,
                freq:       0.6 + Math.random() * 1.8,
                brightness: 0.45 + Math.random() * 0.55,
            });
        }
        MOON_NS.x = W * 0.78;
        MOON_NS.y = H * 0.16;
        MOON_NS.r = 20;
        shootTimer = 0;
        shoot = null;
    }

    function animateNightSky() {
        const W = canvas.width, H = canvas.height;
        const t = frame / 60;

        // Sky gradient
        const sky = ctx.createLinearGradient(0, 0, 0, H);
        sky.addColorStop(0,   '#000510');
        sky.addColorStop(0.5, '#000c28');
        sky.addColorStop(1,   '#001440');
        ctx.fillStyle = sky;
        ctx.fillRect(0, 0, W, H);

        // Moon glow + crescent
        const mx = MOON_NS.x, my = MOON_NS.y, mr = MOON_NS.r;
        const glow = ctx.createRadialGradient(mx, my, 0, mx, my, mr * 3.5);
        glow.addColorStop(0,   'rgba(220,220,170,0.28)');
        glow.addColorStop(1,   'transparent');
        ctx.fillStyle = glow;
        ctx.fillRect(mx - mr * 4, my - mr * 4, mr * 8, mr * 8);
        ctx.fillStyle = '#f0f0d8';
        ctx.beginPath();
        ctx.arc(mx, my, mr, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#000c28';
        ctx.beginPath();
        ctx.arc(mx + 7, my - 3, mr * 0.82, 0, Math.PI * 2);
        ctx.fill();

        // Twinkling stars
        for (const s of STARS) {
            const twinkle = 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(t * s.freq + s.phase));
            ctx.save();
            ctx.globalAlpha = twinkle * s.brightness;
            ctx.fillStyle   = '#ffffff';
            ctx.beginPath();
            ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
            ctx.fill();
            // Cross glint on larger stars
            if (s.size > 1.3) {
                ctx.globalAlpha = twinkle * s.brightness * 0.35;
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth   = 0.6;
                const gl = s.size * 3.5;
                ctx.beginPath();
                ctx.moveTo(s.x - gl, s.y); ctx.lineTo(s.x + gl, s.y);
                ctx.moveTo(s.x, s.y - gl); ctx.lineTo(s.x, s.y + gl);
                ctx.stroke();
            }
            ctx.restore();
        }

        // Occasional shooting star
        shootTimer--;
        if (shootTimer <= 0) {
            shootTimer = 180 + Math.floor(Math.random() * 300);
            shoot = {
                x: Math.random() * W * 0.7,
                y: Math.random() * H * 0.4,
                vx: 3.5 + Math.random() * 3,
                vy: 1.2 + Math.random() * 1.5,
                life: 40,
            };
        }
        if (shoot && shoot.life > 0) {
            const alpha = shoot.life / 40;
            ctx.save();
            ctx.globalAlpha = alpha * 0.85;
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth   = 1.2;
            ctx.beginPath();
            ctx.moveTo(shoot.x, shoot.y);
            ctx.lineTo(shoot.x - shoot.vx * 6, shoot.y - shoot.vy * 6);
            ctx.stroke();
            ctx.restore();
            shoot.x += shoot.vx;
            shoot.y += shoot.vy;
            shoot.life--;
        }
    }

    // ---- Core animation loop ----
    function tick() {
        if (!activeId) return;
        frame++;
        if      (activeId === 'wp_anim_clouds')   animateClouds();
        else if (activeId === 'wp_anim_forest')   animateForest();
        else if (activeId === 'wp_anim_nightsky') animateNightSky();
        rafId = requestAnimationFrame(tick);
    }

    function start(id) {
        stop();
        if (rmq.matches) return;  // respect prefers-reduced-motion
        activeId = id;
        frame    = 0;
        resizeCanvas();
        canvas.style.display = 'block';
        if      (id === 'wp_anim_clouds')   initClouds();
        else if (id === 'wp_anim_forest')   initForest();
        else if (id === 'wp_anim_nightsky') initNightSky();
        rafId = requestAnimationFrame(tick);
    }

    function stop() {
        activeId = null;
        cancelAnimationFrame(rafId);
        rafId = null;
        canvas.style.display = 'none';
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    window.addEventListener('resize', () => {
        if (!activeId) return;
        resizeCanvas();
        if      (activeId === 'wp_anim_clouds')   initClouds();
        else if (activeId === 'wp_anim_forest')   initForest();
        else if (activeId === 'wp_anim_nightsky') initNightSky();
    });

    window._animWallpaper = { start, stop };
})();
