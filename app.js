import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js';
import { getDatabase, ref, push, onValue, remove, update, set, get, child, limitToLast, query, onDisconnect, runTransaction } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js';
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

const API_BASE = ''; // Set to the deployed origin (e.g. 'https://your-api.example.com') for GitHub Pages use

const ANNIVERSARY_MM_DD = '01-06';
const INSIDE_JOKE = 'you are gay';

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

// For each .link-preview[data-url] in container: check Firebase cache,
// then fall back to microlink.io (free, no key needed). Fires and forgets.
async function hydrateLinkPreviews(container) {
    const previews = container.querySelectorAll('.link-preview[data-url]');
    for (const el of previews) {
        const url = decodeURIComponent(el.dataset.url);
        const key = urlToKey(url);
        try {
            // 1. Check Firebase cache
            const snap = await get(child(ref(database), `linkMeta/${key}`));
            if (snap.exists()) {
                applyLinkMeta(el, snap.val());
                continue;
            }
            // 2. Fetch from microlink.io (public free API, CORS-safe)
            const resp = await fetch(`https://api.microlink.io?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(6000) });
            if (!resp.ok) throw new Error('microlink error');
            const data = await resp.json();
            if (data.status === 'success') {
                const meta = {
                    title:       data.data.title       || null,
                    description: data.data.description || null,
                    image:       data.data.image?.url  || null,
                };
                // Cache in Firebase for next render
                set(ref(database, `linkMeta/${key}`), meta).catch(() => {});
                applyLinkMeta(el, meta);
            } else {
                el.classList.remove('lp-loading');
            }
        } catch (_) {
            el.classList.remove('lp-loading');
        }
    }
}

let currentFilter = 'all';
let currentCollection = null;
let currentSource = null;
let seenPostIds = new Set();
let notificationsEnabled = localStorage.getItem('notificationsEnabled') === 'true';
let searchQuery = '';
let allPosts = {};
let currentUser = null;
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
let focusedPostId = null;
let prevDataSig = null;
let prevVisualSig = null;

let _audioCtx = null;
let chatOpen = false;
let currentSection = 'feed';   // 'feed' | 'boards' | 'mailbox'
let allBoards = {};             // boardId → board object
let allBoardDeleteRequests = {}; // boardId → { requestedBy, requestedAt, boardTitle }
let _boardPickerPostId = null;  // postId being saved to a board
let allLetters = {};            // letterId → letter object
let mailboxTab = 'inbox';
let lastChatSeenTs = Number(localStorage.getItem('chatSeenTs') || '0');
let lastChatMessages = [];
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
    '❤️': '<3', '😂': ':D', '😮': 'O_O', '😍': '*_*',
    '🔥': '!!', '👍': '(y)', '😭': 'T_T', '🥹': ';_;',
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

function ensureAudio() {
    if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (_audioCtx.state === 'suspended') _audioCtx.resume();
}

function sparkSound(type) {
    try {
        if (!soundEnabled) return;
        ensureAudio();
        const ctx = _audioCtx;
        const t0 = ctx.currentTime;

        // Windows 95-style: square waves, sharp envelopes, named notes
        // post  → "The Microsoft Sound" abbreviated (4-note ascending chime)
        // reply → "Exclamation"  (descending two-note blip)
        // react → "Asterisk"     (single high ding)
        // chat  → "Notify"       (ascending two-tone)
        // ping  → "Default Beep" (classic square blip at 750 Hz)
        // ach   → achievement unlock 3-note fanfare
        const patterns = {
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
            ach: [
                { f: 659.25, t: 0.00, dur: 0.10 },   // E5
                { f: 783.99, t: 0.10, dur: 0.10 },   // G5
                { f: 1046.5, t: 0.20, dur: 0.28 }    // C6 (held)
            ]
        };

        const notes = patterns[type] || patterns.ping;
        notes.forEach(({ f, t, dur }) => {
            const osc  = ctx.createOscillator();
            const gain = ctx.createGain();

            osc.type = 'square';
            osc.frequency.setValueAtTime(f, t0 + t);

            osc.connect(gain);
            gain.connect(ctx.destination);

            const s = t0 + t;
            const e = s + dur;

            gain.gain.setValueAtTime(0.0001, s);
            gain.gain.linearRampToValueAtTime(0.08, s + 0.006);  // sharp attack
            gain.gain.setValueAtTime(0.08, e - 0.018);
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
    document.getElementById('loginOverlay').style.display = 'none';

    const emoji = AUTHOR_EMOJI[displayName] || '[?]';
    document.getElementById('userIndicator').textContent = `${emoji} ${displayName} · sign out`;
    document.getElementById('userIndicator').title = `Signed in as ${email}`;

    const otherBtn = document.getElementById('btnOtherUser');
    if (displayName === 'El' || displayName === 'Tero') {
        const other = displayName === 'El' ? 'Tero' : 'El';
        otherBtn.textContent = `${AUTHOR_EMOJI[other]} Just ${other}`;
        otherBtn.classList.remove('hidden');
    } else {
        otherBtn.classList.add('hidden');
        if (currentFilter === 'just-other') setFilter('all');
    }

    activitySeenTs = Number(localStorage.getItem(`activitySeenTs-${displayName}`) || String(Date.now() - 86400000));
    updateNewCount();
    loadPosts();
    setupTypingCleanup();
    startNowListening();
    showSection('feed');
    initAchievements();
    // If the garden window was already open when auth resolved (page-restore path),
    // run the visit-spark check now that currentUser is set.
    const gardenWin = document.getElementById('w95-win-garden');
    if (gardenWin && !gardenWin.classList.contains('is-hidden')) {
        checkVisitSpark();
    }
}

window.logout = function() {
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
    document.getElementById('nowListeningBar')?.classList.toggle('hidden', !isFeed);
    document.getElementById('boardsSection').classList.toggle('hidden', name !== 'boards');
    document.getElementById('mailboxSection').classList.toggle('hidden', name !== 'mailbox');
    document.getElementById('navBoards')?.classList.toggle('active', name === 'boards');
    document.getElementById('navMailbox')?.classList.toggle('active', name === 'mailbox');
    if (name === 'boards') renderBoardsList();
    if (name === 'mailbox') renderMailbox();
}

// ---- BOARDS ----
function setupBoardsListener() {
    onValue(boardsRef, snap => {
        allBoards = snap.val() || {};
        if (currentSection === 'boards') renderBoardsList();
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
                sparkSound('ping');
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
    await remove(ref(database, `board_delete_requests/${boardId}`));
    await remove(ref(database, `board_items/${boardId}`));
    await remove(ref(database, `boards/${boardId}`));
    closeModal(modal);
    if (currentSection === 'boards') closeBoardDetail();
    showToast('Board deleted');
};

window.denyBoardDeletion = async function() {
    const modal = document.getElementById('boardDeleteRequestModal');
    const boardId = modal.dataset.boardId;
    if (!boardId) return;
    await remove(ref(database, `board_delete_requests/${boardId}`));
    closeModal(modal);
    showToast('Board kept ♡');
};

// ---- MAILBOX ----
function setupLettersListener() {
    onValue(lettersRef, snap => {
        allLetters = snap.val() || {};
        updateMailboxBadge();
        if (currentSection === 'mailbox') renderMailbox();
    });
}

function updateMailboxBadge() {
    const unread = Object.values(allLetters)
        .filter(l => l.to === currentUser && !l.readAt).length;
    const badge = document.getElementById('mailboxBadge');
    const inboxBadge = document.getElementById('inboxUnread');
    if (badge) {
        if (unread > 0) { badge.textContent = unread; badge.classList.remove('hidden'); }
        else { badge.classList.add('hidden'); }
    }
    if (inboxBadge) {
        if (unread > 0) { inboxBadge.textContent = unread; inboxBadge.classList.remove('hidden'); }
        else { inboxBadge.classList.add('hidden'); }
    }
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
    const bar = document.getElementById('nowListeningBar');
    if (!bar) return;
    // Only un-hide when on the feed; don't fight showSection when on other tabs
    if (currentSection === 'feed') bar.classList.remove('hidden');
    if (elData   !== null) renderNLCard('El',   elData);
    if (teroData !== null) renderNLCard('Tero', teroData);
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
    setupLettersListener();

    onValue(postsRef, (snapshot) => {
        const newPosts = snapshot.val() || {};
        const sig = dataSig(newPosts);

        if (!isInitialLoad && sig !== prevDataSig) {
            sparkSound('ping');

            // Desktop notification for brand-new posts
            const newIds = Object.keys(newPosts).filter(id => !seenPostIds.has(id));
            if (newIds.length > 0) {
                const p = newPosts[newIds[0]];
                const author = p.author || 'Someone';
                const label = p.note || p.url || 'A new post was shared';
                sendNotification(`New post from ${author} 💜`, label, 'new-post');
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

        updateChatUnread(messages);
        if (chatOpen || !document.getElementById('w95-win-chat')?.classList.contains('is-hidden')) {
            renderChat(messages);
        }
    });
}

// ---- AUTH STATE OBSERVER ----
// Single entry point for starting/stopping a session. All DB access is gated here.
onAuthStateChanged(auth, (firebaseUser) => {
    if (!firebaseUser) {
        // Signed out — reset and show login
        currentUser = null;
        achievementsBackfilled = false;
        localStorage.removeItem('currentUser');
        document.getElementById('loginOverlay').style.display = 'flex';
        document.getElementById('accessDeniedOverlay').style.display = 'none';
        closeChat(true);
        return;
    }

    const email = firebaseUser.email || '';
    const displayName = ALLOWED_USERS[email];

    if (!displayName) {
        // Authenticated but not on the allowlist
        currentUser = null;
        document.getElementById('loginOverlay').style.display = 'none';
        document.getElementById('accessDeniedOverlay').style.display = 'flex';
        return;
    }

    // Authorised — start DB listeners (once) then load the feed
    setupDBListeners();
    login(displayName, email);
});

// Scroll to top button
window.addEventListener('scroll', () => {
    document.getElementById('scrollTopBtn').classList.toggle('visible', window.scrollY > 300);
});

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
    document.getElementById('darkModeIcon').textContent = isDarkMode ? '☼' : '☾';
    localStorage.setItem('darkMode', isDarkMode);
};

if (localStorage.getItem('darkMode') === 'true') {
    toggleDarkMode();
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
        await remove(ref(database, `board_items/${boardId}`));
        await remove(ref(database, `boards/${boardId}`));
        closeBoardDetail();
        showToast('Board deleted');
    } else if (deleteTarget.type === 'post') {
        await remove(ref(database, `posts/${deleteTarget.postId}`));
        showToast('Post deleted');
    } else {
        const post = allPosts[deleteTarget.postId];
        if (!post) return;

        const replies = post.replies || [];
        const toRemove = new Set([deleteTarget.replyId, ...collectReplyDescendants(replies, deleteTarget.replyId)]);
        const nextReplies = replies.filter(r => !toRemove.has(r.id));

        await update(ref(database, `posts/${deleteTarget.postId}`), { replies: nextReplies });
        showToast('Comment deleted');
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
                afterPostCreated();
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
            afterPostCreated();
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
        afterPostCreated();
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
        afterPostCreated();
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
        afterPostCreated();
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

// ---- REACTIONS ----
window.toggleReaction = async function(postId, emoji, btn) {
    if (!throttle(`react-${postId}-${emoji}`, 500)) return;
    const post = allPosts[postId];
    if (!post) return;
    if (btn) burstEmoji(emoji, btn);

    const reactionsBy = structuredClone(post.reactionsBy || {});
    reactionsBy[emoji] = reactionsBy[emoji] || {};

    if (reactionsBy[emoji][currentUser]) {
        delete reactionsBy[emoji][currentUser];
        if (Object.keys(reactionsBy[emoji]).length === 0) delete reactionsBy[emoji];
    } else {
        reactionsBy[emoji][currentUser] = true;
    }

    // In-place DOM update — avoids a full loadPosts() rebuild and scroll shift.
    const rxEl = document.getElementById(`post-rx-${postId}`);
    if (rxEl) {
        const reactionEmojis = ['<3', ':D', 'O_O', '*_*', '!!', '(y)', 'T_T', ';_;'];
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
            const cmtEmojis = ['<3', ':D', 'O_O', '!!', 'T_T', ';_;'];
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

    const cmtEmojis = ['<3', ':D', 'O_O', '!!', 'T_T', ';_;'];

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

function getSourceLabel(source) {
    const s = source || 'other';
    return `${SOURCE_EMOJIS[s] || '[url]'} ${SOURCE_LABELS[s] || s}`;
}

function createYouTubeEmbed(post) {
    const id = getYouTubeId(post.url);
    const hq = `https://img.youtube.com/vi/${id}/hqdefault.jpg`;
    const max = `https://img.youtube.com/vi/${id}/maxresdefault.jpg`;
    const isWL = !!(post.watchLaterBy?.[currentUser]);
    return `
        <a href="${safeText(post.url)}" target="_blank" class="yt-embed">
            <img src="${max}" alt="YouTube thumbnail" onerror="this.src='${hq}'">
            <div class="yt-play-overlay">
                <svg width="64" height="44" viewBox="0 0 64 44" fill="none">
                    <rect width="64" height="44" rx="10" fill="#FF0000" opacity="0.92"/>
                    <polygon points="25,12 25,32 46,22" fill="white"/>
                </svg>
            </div>
        </a>
        <button class="watch-later-btn${isWL ? ' active' : ''}" onclick="toggleWatchLater('${safeText(post.id)}')" data-tooltip="${isWL ? 'Click to remove' : 'Save to Watch Later'}">
            🕐 ${isWL ? 'In Watch Later' : 'Watch Later'}
        </button>
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
            <div class="post-card fade-in capsule-card" data-post-id="${post.id}">
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

    // Support both new (array) and legacy (string) collection formats
    const collArr = post.collections?.length ? post.collections
                  : post.collection         ? [post.collection]
                  : [];
    const collectionBadge = collArr
        .map(c => `<button class="collection-badge" onclick="filterByCollection('${safeText(c)}')" title="Filter by collection">${getCollectionEmoji(c)} ${safeText(COLLECTION_LABELS[c] || c)}</button>`)
        .join('');

    const reactionEmojis = ['<3', ':D', 'O_O', '*_*', '!!', '(y)', 'T_T', ';_;'];
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
        const tweetId = url.match(/(?:twitter|x)\.com\/.*\/status\/(\d+)/)?.[1];
        const faviconUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
        const source = post.source || detectSource(url);
        sourceBadge = `<button class="collection-badge" onclick="filterBySource('${safeText(source)}')" title="Filter by source">${safeText(getSourceLabel(source))}</button>`;

        if (tweetId) {
            contentHtml = `
                <div class="post-content">
                    <blockquote class="twitter-tweet" data-dnt="true" data-conversation="none">
                        <a href="https://twitter.com/x/status/${tweetId}"></a>
                    </blockquote>
                </div>
            `;
        } else if (source === 'instagram') {
            contentHtml = createInstagramEmbed(url);
        } else if (source === 'youtube') {
            contentHtml = createYouTubeEmbed(post);
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
        <div class="post-card fade-in" data-post-id="${post.id}">
            <div class="post-header">
                <div class="post-author-row">
                    <span class="${badgeClass}">${safeText(author)} ${emoji}</span>
                    <span class="post-meta-dot">•</span>
                    <span class="post-meta-date" title="${safeText(dateFull)}">${safeText(date)}</span>
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
        } else {
            h3.textContent = 'No Posts Yet';
            p.textContent  = 'Start adding posts.';
        }
        return;
    }

    emptyState.classList.add('hidden');
    const savedScroll = window.scrollY;
    container.innerHTML = posts.map(createPostCard).join('');
    hydrateLinkPreviews(container);
    window.scrollTo({ top: savedScroll, behavior: 'instant' });
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
}

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

// ---- CHAT ----
function formatChatTime(ts) {
    if (!ts) return '';
    return new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function renderChat(messages) {
    const body = document.getElementById('chatBody');
    if (!body) return;

    // Group consecutive messages from the same author within 5 minutes
    const groups = [];
    for (const m of messages) {
        const last = groups[groups.length - 1];
        const gap = last ? m.timestamp - last.msgs[last.msgs.length - 1].timestamp : Infinity;
        if (last && last.author === m.author && gap < 300000) {
            last.msgs.push(m);
        } else {
            groups.push({ author: m.author, msgs: [m] });
        }
    }

    body.innerHTML = groups.map(g => {
        const me = g.author === currentUser;
        const emoji = AUTHOR_EMOJI[g.author] || '[?]';
        const lastTs = g.msgs[g.msgs.length - 1].timestamp;
        const bubbles = g.msgs.map(m => {
            const canHeart = !me;
            const hearted  = canHeart && !!(m.hearts?.[currentUser]);
            const dblclick = canHeart ? `ondblclick="heartChatMessage('${m.id}')"` : '';
            const heartEl  = canHeart
                ? `<span class="heart-react ${hearted ? 'hearted' : 'hint'}">${hearted ? '❤️' : '♡'}</span>`
                : '';
            const title = canHeart ? 'title="Double-click to ❤️"' : '';
            return `<div class="chat-bubble${canHeart ? ' heartable' : ''}" ${dblclick} ${title}>${safeText(m.text)}${heartEl}</div>`;
        }).join('');
        const label = me ? '' : `<div class="chat-group-label">${safeText(g.author)} ${emoji}</div>`;
        return `
            <div class="chat-group chat-group--${me ? 'me' : 'other'}">
                ${label}
                ${bubbles}
                <div class="chat-group-time">${safeText(formatChatTime(lastTs))}</div>
            </div>
        `;
    }).join('');

    body.scrollTop = body.scrollHeight;
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

window.heartChatMessage = async function(msgId) {
    window.getSelection()?.removeAllRanges(); // clear the text selection dblclick produces
    const msg = lastChatMessages.find(m => m.id === msgId);
    if (!msg) return;
    const hearts = { ...(msg.hearts || {}) };
    if (hearts[currentUser]) {
        delete hearts[currentUser];
    } else {
        hearts[currentUser] = true;
    }
    await update(ref(database, `chat/${msgId}`), { hearts });
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

        renderChat(lastChatMessages);

        // One-time hint so the double-click affordance is discoverable
        if (!localStorage.getItem('chatHeartHintSeen')) {
            localStorage.setItem('chatHeartHintSeen', '1');
            const hintOther = currentUser === 'El' ? "Tero's" : currentUser === 'Tero' ? "El's" : "others'";
            setTimeout(() => showToast(`Double-click ${hintOther} messages to ❤️ them`), 900);
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

const chatInput = document.getElementById('chatInput');

if (chatInput) {
// Auto-expand textarea as user types; also start typing indicator
chatInput.addEventListener('input', () => {
    chatInput.style.height = 'auto';
    chatInput.style.height = Math.min(chatInput.scrollHeight, 140) + 'px';
    startChatTyping();
});

chatInput.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    if (e.shiftKey) return;
    e.preventDefault();

    stopChatTyping();          // clear "typing" immediately on send

    const text = chatInput.value.trim();
    if (!text) return;
    if (!throttle('chat-send', 800)) return;

    await push(chatRef, {
        author: currentUser,
        text,
        timestamp: Date.now()
    });

    chatInput.value = '';
    chatInput.style.height = 'auto';
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
    if (btn) toggleCollPick(btn);
});

// Collections modal
document.getElementById('collectionsModalClose')?.addEventListener('click', () => closeCollectionsModal());
document.getElementById('collectionsModal')?.addEventListener('click', e => {
    if (e.target.id === 'collectionsModal') { closeCollectionsModal(); return; }
    const item = e.target.closest('[data-collection]');
    if (item && item.closest('#collectionsModal')) filterByCollection(item.dataset.collection || null);
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
document.getElementById('scrollTopBtn')?.addEventListener('click', () =>
    window.scrollTo({ top: 0, behavior: 'smooth' })
);

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

// Boards nav + modals
document.getElementById('navBoards')?.addEventListener('click', () => showSection('boards'));
document.getElementById('navMailbox')?.addEventListener('click', () => showSection('mailbox'));
document.getElementById('boardPickerClose')?.addEventListener('click', () => closeModal(document.getElementById('boardPickerModal')));
document.getElementById('boardPickerModal')?.addEventListener('click', e => { if (e.target.id === 'boardPickerModal') closeModal(e.target); });
document.getElementById('createBoardClose')?.addEventListener('click', () => closeModal(document.getElementById('createBoardModal')));
document.getElementById('createBoardModal')?.addEventListener('click', e => { if (e.target.id === 'createBoardModal') closeModal(e.target); });
document.getElementById('createBoardConfirmBtn')?.addEventListener('click', () => createBoard());
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

// ===== Win95 window z-index management (bring-to-front) =====
let w95TopZ = 2000;

// ===== Win95 Our Garden Window + Shared Firebase Garden =====
(() => {
  const btn    = document.getElementById('w95-btn-garden');
  const win    = document.getElementById('w95-win-garden');
  const min    = document.getElementById('w95-garden-min');
  const handle = document.getElementById('w95-garden-handle');

  if (!btn || !win || !min || !handle) return;

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
  const STAGE_LABELS    = { seed: 'Seed', sprout: 'Sprout', bloom: 'Bloom', wilted: 'Wilted' };

  // ---- calculateStage: unchanged ----
  function calculateStage(state) {
    const now = Date.now();
    const { plantedAt, lastWatered } = state;
    const ageHrs = (now - plantedAt) / MS_HOUR;
    const wateredHrsAgo = lastWatered ? (now - lastWatered) / MS_HOUR : Infinity;

    // Wilted: was alive past seed stage but not watered for 48h
    if (ageHrs >= 24 && wateredHrsAgo >= 48) return 'wilted';

    if (ageHrs < 24) return 'seed';
    if (ageHrs < 48) return lastWatered ? 'sprout' : 'seed';

    // 48h+: bloom only if watered within last 24h
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
    for (let n = 0; n < 3; n++) {
      if (!tilesRowEl.querySelector(`[data-tile="${n}"]`)) {
        const col = document.createElement('div');
        col.dataset.tile = String(n);
        tilesRowEl.appendChild(col);
      }
    }
  }

  function renderTile(n, tileData, unlockedPlants, isUnlocked) {
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

    // ---- Unlocked: build structure once, then update fields ----
    if (!col.querySelector('.garden-plant-el')) {
      col.className = 'garden-tile-col';
      col.innerHTML =
        `<div class="garden-soil-tile">` +
          `<div class="garden-plant-el"></div>` +
          `<div class="garden-tile-events"></div>` +
        `</div>` +
        `<div class="garden-tile-status-el"></div>` +
        `<div class="garden-tile-actions">` +
          `<button class="w95-btn garden-water-btn" data-tile="${n}">Water</button>` +
          `<button class="w95-btn garden-talk-btn" data-tile="${n}">Talk</button>` +
        `</div>`;
    }

    const stage     = tileData ? calculateStage(tileData) : 'seed';
    const plantType = tileData?.selectedPlant || 'sunflower';

    // Plant visual
    const plantDiv = col.querySelector('.garden-plant-el');
    if (plantDiv) {
      plantDiv.className = `garden-plant garden-plant--${stage} garden-plant--type-${plantType}`;
    }

    // Plant selector (create once, update options only when count changes)
    // Tile 0's plant-row lives in #garden-info (not inside the tile column)
    // so that its height doesn't disturb the soil-tile grid alignment.
    const plantRowEl = n === 0
      ? document.getElementById('gpr-0')
      : col.querySelector(`#gpr-${n}`);
    const effectiveUnlocks = unlockedPlants.filter(id => id !== 'sunflower');
    if (plantRowEl) {
      if (effectiveUnlocks.length === 0) {
        if (!plantRowEl.querySelector('.garden-label')) {
          plantRowEl.innerHTML =
            `<span class="garden-label">Plant: ${PLANT_LABELS[plantType] || PLANT_LABELS.sunflower}</span>` +
            `<div class="garden-help">Water daily to unlock more</div>`;
        }
      } else {
        let sel = plantRowEl.querySelector('select');
        if (!sel) {
          plantRowEl.innerHTML =
            `<label for="gps-${n}" class="garden-label">Plant:</label>` +
            `<select id="gps-${n}" class="w95-select"></select>`;
          sel = plantRowEl.querySelector('select');
          sel.onchange = async () => {
            const chosen = sel.value;
            const snap = await get(gardenRef);
            const st   = snap.val();
            if (!st) return;
            const stUnlocked = st.unlockedPlants ?? [];
            const allowedPlants = ['sunflower', ...stUnlocked.filter(id => id !== 'sunflower')];
            if (!allowedPlants.includes(chosen)) {
              showToast("That plant isn't unlocked yet");
              sel.value = st.tiles?.[n]?.selectedPlant ?? sel.options[0]?.value ?? 'sunflower';
              return;
            }
            await update(gardenRef, { [`tiles/${n}/selectedPlant`]: chosen });
          };
        }
        // Rebuild options only when the list has changed (avoids dismissing open dropdown)
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
        sel.value = plantType;
      }
    }

    // Tile status (stage + watered time)
    const statusDiv = col.querySelector('.garden-tile-status-el');
    if (statusDiv && tileData) {
      const wateredAgo = tileData.lastWatered
        ? Math.round((Date.now() - tileData.lastWatered) / MS_HOUR) : null;
      const wateredText = wateredAgo === null ? 'never'
        : wateredAgo === 0 ? 'just now' : `${wateredAgo}h ago`;
      statusDiv.textContent = `${STAGE_LABELS[stage] || stage} · ${wateredText}`;
    }

    // Water button: reflect daily water count (per-user limit: 3/day)
    const waterBtnEl = col.querySelector('.garden-water-btn');
    if (waterBtnEl && tileData) {
      const todayCount   = dailyWaterCounts[localDateStr()] || 0;
      const limitReached = todayCount >= 3;
      if (limitReached) {
        waterBtnEl.textContent = 'Fully watered for today \uD83C\uDF31';
        waterBtnEl.disabled    = true;
      } else if (todayCount > 0) {
        waterBtnEl.textContent = `Watered ${todayCount}/3 today`;
        waterBtnEl.disabled    = false;
      } else {
        waterBtnEl.textContent = 'Water';
        waterBtnEl.disabled    = false;
      }
      waterBtnEl.classList.toggle('garden-water-btn--done', limitReached);
    }

    // Event overlays — stored events from Firebase plus client-computed mushroom
    const eventsDiv = col.querySelector('.garden-tile-events');
    if (eventsDiv && tileData) {
      const stored    = Array.isArray(tileData.events) ? tileData.events : [];
      const allEvents = [...stored];
      // Mushroom: computed client-side — visible while wilted 7+ days, no extra storage needed
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

  // ---- renderGarden: drives the 3 tiles + streak rows ----
  function renderGarden(state) {
    if (!state) return;
    const tiles         = state.tiles || {};
    const unlockedPlants = Array.isArray(state.unlockedPlants) ? state.unlockedPlants : [];
    const unlockedTiles = state.unlockedTiles || 1;

    for (let n = 0; n < 3; n++) {
      renderTile(n, tiles[String(n)] || null, unlockedPlants, n < unlockedTiles);
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
  }

  // ---- Initialise / migrate ----
  onValue(gardenRef, (snap) => {
    if (!snap.exists()) {
      set(gardenRef, {
        wateringStreak: 0, lastStreakDay:  null,
        unlockedPlants: [],
        sharedStreak:   0, lastSharedDay:  null, wateredByDay: {},
        totalBlooms: 0, unlockedTiles: 1,
        lastWateredByUser: {},
        tiles: { '0': { plantedAt: Date.now(), lastWatered: null, selectedPlant: 'sunflower', events: [] } },
      });
    } else {
      const st = snap.val();
      // Migrate: existing flat state (no tiles sub-object) → tiles structure
      if (!st.tiles) {
        update(gardenRef, {
          totalBlooms:       0,
          unlockedTiles:     1,
          lastWateredByUser: {},
          'tiles/0': {
            plantedAt:     st.plantedAt     || Date.now(),
            lastWatered:   st.lastWatered   || null,
            selectedPlant: st.selectedPlant || 'sunflower',
            events:        [],
          },
        });
      }
    }
  }, { onlyOnce: true });

  ensureTileColumns();

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

  // ---- Water a specific tile ----
  async function waterTile(n) {
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

    const waterBtn = tilesRowEl.querySelector(`.garden-water-btn[data-tile="${n}"]`);
    if (waterBtn) waterBtn.disabled = true;

    try {
      // Step 2 — Run the existing garden watering transaction
      const snap  = await get(gardenRef);
      const state = snap.val();
      if (!state) return;

      // Exploration unlocks checked once per water press
      const withExplore = await computeExploreUnlocks(state.unlockedPlants ?? []);

      const txResult = await runTransaction(gardenRef, (currentState) => {
        if (!currentState) return currentState;

        const now       = Date.now();
        const today     = new Date(now).toISOString().slice(0, 10);
        const yesterday = new Date(now - 86400000).toISOString().slice(0, 10);

        const txTiles = currentState.tiles || {};
        const tileStr = String(n);
        const txTile  = txTiles[tileStr] || { plantedAt: now, lastWatered: null, selectedPlant: 'sunflower', events: [] };

        // ---- Individual streak ----
        const lastStreakDay  = currentState.lastStreakDay  ?? null;
        const wateringStreak = currentState.wateringStreak ?? 0;
        const plantedAt      = txTile.plantedAt            ?? null;
        const lastWatered    = txTile.lastWatered          ?? null;

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

        // ---- Rare tile events ----
        const events = [];
        if (isWilted) {
          const wiltedSince = lastWatered
            ? lastWatered + 48 * MS_HOUR
            : (plantedAt ? plantedAt + 24 * MS_HOUR : null);
          if (wiltedSince && (now - wiltedSince) >= 7 * 86400000) events.push('mushroom');
        }
        if (new Date(now).getUTCHours() === 0 && Math.random() < 0.3) events.push('moonflowerVariant');
        if (whoIsWatering && GARDEN_COOP_USERS.includes(whoIsWatering)) {
          const otherUser = GARDEN_COOP_USERS.find(u => u !== whoIsWatering);
          const otherTs   = (lastWateredByUser || {})[otherUser];
          if (otherTs && Math.floor(otherTs / MS_HOUR) === Math.floor(now / MS_HOUR) && Math.random() < 0.10) {
            events.push('shootingStar');
          }
        }

        // ---- Update lastWateredByUser ----
        const newLastWateredByUser = { ...lastWateredByUser };
        if (whoIsWatering && GARDEN_COOP_USERS.includes(whoIsWatering)) {
          newLastWateredByUser[whoIsWatering] = now;
        }

        // ---- Bloom counting → tile unlock ----
        const oldStage       = calculateStage(txTile);
        const newStage       = calculateStage({ ...txTile, lastWatered: now });
        const isNewBloom     = oldStage !== 'bloom' && newStage === 'bloom';
        const newTotalBlooms = (currentState.totalBlooms || 0) + (isNewBloom ? 1 : 0);
        const newUnlockedTiles = newTotalBlooms >= 5 ? 3 : newTotalBlooms >= 1 ? 2 : 1;

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
          tiles: {
            ...txTiles,
            [tileStr]: {
              ...txTile,
              lastWatered: now,
              events,
            },
          },
        };
      });

      const finalState      = txResult.snapshot.val();
      const ritualDay       = localDateStr();
      const todayAfterWater = (finalState?.wateredByDay || {})[ritualDay] || {};

      // Success feedback
      showToast('Watered!');
      sparkSound('post');

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
    } catch (e) {
      console.error(e);
      showToast('Could not water. Please try again.');
    } finally {
      // Only re-enable the button if the user still has waters remaining today.
      if (waterBtn && (dailyWaterCounts[localDateStr()] || 0) < 3) {
        waterBtn.disabled = false;
      }
    }
  }

  // Event delegation — one listener on the tiles row handles all water buttons
  tilesRowEl.addEventListener('click', async (e) => {
    const btn = e.target.closest('.garden-water-btn');
    if (!btn || btn.disabled) return;
    await waterTile(Number(btn.dataset.tile));
  });

  // Talk button delegation
  tilesRowEl.addEventListener('click', (e) => {
    const talkBtn = e.target.closest('.garden-talk-btn');
    if (!talkBtn) return;
    doTalkToPlant(Number(talkBtn.dataset.tile));
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
    // 0.5 % chance per spawn attempt: spawn mythical instead of regular
    if (Math.random() < 0.005) { spawnMythicalCritter(); return; }
    const critter = CRITTER_POOL[Math.floor(Math.random() * CRITTER_POOL.length)];
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
    // Auto-despawn after 12s
    _critterDespawn = setTimeout(despawnCritter, 12000);
    // Schedule the next spawn attempt
    scheduleNextCritter();
  }

  function despawnCritter() {
    if (_critterDespawn) { clearTimeout(_critterDespawn); _critterDespawn = null; }
    if (_critterEl) { _critterEl.remove(); _critterEl = null; }
  }

  function scheduleNextCritter() {
    if (_critterSchedule) { clearTimeout(_critterSchedule); _critterSchedule = null; }
    const delay = 60000 + Math.random() * 60000;  // 60–120 s
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
    sparkSound('ping');
  }

  // Glitch moment (0.2 % chance on garden open, CSS-only, 1–2 s).
  function maybeGardenGlitch() {
    if (Math.random() >= 0.002) return;
    setTimeout(() => {
      gardenBodyEl.classList.add('garden-glitch');
      showToast('The garden shimmered strangely…');
      sparkSound('ping');
      gardenBodyEl.addEventListener('animationend', () =>
        gardenBodyEl.classList.remove('garden-glitch'), { once: true });
    }, 600);
  }

  // ---- Show / hide ----
  function show() {
    win.classList.remove('is-hidden');
    btn.classList.add('is-pressed');
    localStorage.setItem('w95_garden_open', '1');
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
    btn.classList.remove('is-pressed');
    localStorage.setItem('w95_garden_open', '0');
    stopCritters();
  }

  btn.onclick = () => {
    if (win.classList.contains('is-hidden')) show();
    else hide();
  };

  min.onclick = (e) => {
    e.stopPropagation();
    hide();
  };

  // Restore open state
  if (localStorage.getItem('w95_garden_open') === '0') hide();
  else show();

  // ---- Drag ---- (unchanged)
  let dragging = false, startX = 0, startY = 0, winStartX = 20, winStartY = 20;

  handle.addEventListener('mousedown', (e) => {
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    const r = win.getBoundingClientRect();
    winStartX = r.left;
    winStartY = r.top;
    win.style.zIndex = ++w95TopZ;
    e.preventDefault();
  });

  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    win.style.left = Math.max(0, winStartX + (e.clientX - startX)) + 'px';
    win.style.top = Math.max(0, winStartY + (e.clientY - startY)) + 'px';
  });

  window.addEventListener('mouseup', () => { dragging = false; });
})();

(() => {
  const chatPanel = document.getElementById('chatPanel');
  const activityPanel = document.getElementById('activityPanel');

  const chatBodyW = document.getElementById('w95-chat-body');
  const newBodyW = document.getElementById('w95-new-body');

  const winChat = document.getElementById('w95-win-chat');
  const winNew = document.getElementById('w95-win-new');

  const btnChat = document.getElementById('w95-btn-chat');
  const btnNew = document.getElementById('w95-btn-new');

  const minChat = document.getElementById('w95-chat-min');
  const minNew = document.getElementById('w95-new-min');

  if (!chatPanel || !activityPanel || !chatBodyW || !newBodyW || !winChat || !winNew || !btnChat || !btnNew || !minChat || !minNew) return;

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

  function show(win, btn, key) {
    const wasHidden = win.classList.contains('is-hidden');
    win.classList.remove('is-hidden');
    btn.classList.add('is-pressed');
    localStorage.setItem(key, '1');
    if (wasHidden) {
      if (win === winChat) snap(winChat, 'br');
      if (win === winNew)  snap(winNew, 'bl');
    }
    if (win === winChat) {
      chatOpen = true;
      lastChatSeenTs = Date.now();
      localStorage.setItem('chatSeenTs', String(lastChatSeenTs));
      document.getElementById('chatUnread')?.classList.add('hidden');
      renderChat(lastChatMessages);
      setTimeout(() => document.getElementById('chatInput')?.focus(), 80);
    }
    if (win === winNew) {
      renderActivityPanel();
    }
  }

  function hide(win, btn, key) {
    win.classList.add('is-hidden');
    btn.classList.remove('is-pressed');
    localStorage.setItem(key, '0');
    if (win === winChat) {
      chatOpen = false;
      stopChatTyping();
    }
  }

  function toggle(win, btn, key) {
    if (win.classList.contains('is-hidden')) show(win, btn, key);
    else hide(win, btn, key);
  }

  btnChat.onclick = () => toggle(winChat, btnChat, 'w95_chat_open');
  btnNew.onclick = () => toggle(winNew, btnNew, 'w95_new_open');

  minChat.onclick = (e) => { e.stopPropagation(); hide(winChat, btnChat, 'w95_chat_open'); };
  minNew.onclick = (e) => { e.stopPropagation(); hide(winNew, btnNew, 'w95_new_open'); };

  // Restore open state — default closed if no preference stored
  if (localStorage.getItem('w95_chat_open') === '1') show(winChat, btnChat, 'w95_chat_open');
  else hide(winChat, btnChat, 'w95_chat_open');

  if (localStorage.getItem('w95_new_open') === '1') show(winNew, btnNew, 'w95_new_open');
  else hide(winNew, btnNew, 'w95_new_open');

  // Drag support for both windows
  function makeDraggable(winEl, handleEl) {
    let dragging = false, startX = 0, startY = 0, winStartX = 0, winStartY = 0;
    handleEl.addEventListener('mousedown', (e) => {
      if (e.target.closest('button')) return; // let button clicks through
      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const r = winEl.getBoundingClientRect();
      winStartX = r.left;
      winStartY = r.top;
      winEl.style.zIndex = ++w95TopZ;
      e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      winEl.style.left = Math.max(0, winStartX + (e.clientX - startX)) + 'px';
      winEl.style.top = Math.max(0, winStartY + (e.clientY - startY)) + 'px';
    });
    window.addEventListener('mouseup', () => { dragging = false; });
  }

  makeDraggable(winChat, document.getElementById('w95-chat-handle'));
  makeDraggable(winNew, document.getElementById('w95-new-handle'));
})();

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
    if (hr >= 0 && hr < 5) unlockAchievement('night_owl');
    else if (hr >= 5 && hr < 8) unlockAchievement('early_bird');
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
        if (visitCount >= 7)                await unlockAchievement('checked_in');
        if (gardenVisitStreak.current >= 7) await unlockAchievement('week_streak');
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
//   id          – unique string key (matches Firebase key)
//   title       – display name
//   desc        – description
//   icon        – Win95-style text icon shown when locked
//   hidden      – (optional) if true and locked: show "???" / "Keep going…"
//   target      – (optional) numeric goal; enables progress bar
//   getProgress – (optional) function() => current count (live, not stored)
//
// To add a new count-based achievement:
//   { id: 'my_ach', title: 'My Achievement', desc: 'Do X things', icon: '[X]',
//     target: 5, getProgress: () => /* live counter expression */ }
const ACHIEVEMENTS = [
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
    },
    {
        id:          'water_7_days',
        title:       'Weekly Waterer',
        desc:        'Water your garden 7 days in a row',
        icon:        ':D',
        xp:          40,
        tier:        'silver',
        target:      7,
        getProgress: () => currentWateringStreak,
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
        id:     'night_owl',
        title:  'Night Owl',
        desc:   'Do something between midnight and 4:59 AM',
        icon:   '[O]',
        hidden: true,
        tier:   'mythic',
        xp:     30,
    },
    {
        id:     'early_bird',
        title:  'Early Bird',
        desc:   'Do something between 5:00 and 7:59 AM',
        icon:   '[E]',
        hidden: true,
        tier:   'mythic',
        xp:     30,
    },
    {
        id:     'anniversary_mode',
        title:  'Anniversary Mode',
        desc:   'Visit on a very special day',
        icon:   '[<3]',
        hidden: true,
        tier:   'mythic',
        xp:     100,
    },
    {
        id:     'inside_joke',
        title:  'Inside Joke',
        desc:   'Post the magic words',
        icon:   '[?]',
        hidden: true,
        tier:   'mythic',
        xp:     100,
    },
    {
        id:     'all_three_today',
        title:  'Full House',
        desc:   'Post, water, and chat all in one day',
        icon:   '[3]',
        hidden: true,
        tier:   'mythic',
        xp:     150,
    },
    {
        id:     'comeback_kid',
        title:  'Comeback Kid',
        desc:   'Rebuild a watering streak after it broke',
        icon:   '[>>]',
        hidden: true,
        tier:   'mythic',
        xp:     150,
    },
    {
        id:     'same_braincell',
        title:  'Same Braincell',
        desc:   'Post within 10 minutes of each other',
        icon:   '[~~]',
        hidden: true,
        tier:   'mythic',
        xp:     200,
    },
    {
        id:     'long_distance_high_five',
        title:  'Long Distance High Five',
        desc:   'One posts, the other chats within an hour',
        icon:   '^5',
        hidden: true,
        tier:   'mythic',
        xp:     200,
    },
    {
        id:     'we_were_here',
        title:  'We Were Here',
        desc:   'Visit the garden on the same day 20 times',
        icon:   '[H]',
        hidden: true,
        tier:   'mythic',
        xp:     300,
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
        id:     'both_water3_day',
        title:  'Double Dedication',
        desc:   'Both water the garden 3 times on the same day',
        icon:   '[33]',
        hidden: true,
        tier:   'mythic',
        xp:     100,
    },
    {
        id:     'both_water3_week',
        title:  'Garden Devotion',
        desc:   'Both water 3 times a day for 7 days in a row',
        icon:   '[77]',
        hidden: true,
        tier:   'mythic',
        xp:     200,
    },
];

// ---- XP / Level helpers ----
// Flat 100 XP per level: Level 1 = 0–99 XP, Level 2 = 100–199 XP, etc.
// To adjust: change XP_PER_LEVEL. The ACHIEVEMENTS[].xp values are independent.
const XP_PER_LEVEL = 100;
function xpToLevel(xp)   { return Math.floor(xp / XP_PER_LEVEL) + 1; }
function xpForLevel(lvl) { return (lvl - 1) * XP_PER_LEVEL; }  // XP at start of lvl

// Map of id -> unixTimestamp (ms) for every unlocked achievement.
// Using a Map lets us store the unlock date without a separate data structure.
let unlockedAchievements = new Map();
let achievementsBackfilled = false;

// In-session history of achievement toast notifications (newest first).
// Each entry: { title, icon, ts } — kept in memory only (resets on page reload).
const achievementToastHistory = [];

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

        renderAchievementsWindow();
        await backfillAchievements();
    } catch (e) {
        console.error('initAchievements failed', e);
    }
}

async function unlockAchievement(id) {
    if (!ACHIEVEMENTS.find(a => a.id === id)) return;
    if (unlockedAchievements.has(id) || !currentUser) return;
    try {
        const ts          = Date.now();
        const achievement = ACHIEVEMENTS.find(a => a.id === id);
        const xpGain      = achievement?.xp || 0;
        const levelBefore = xpToLevel(xpTotal);

        await set(ref(database, 'achievements/' + currentUser + '/' + id), ts);
        unlockedAchievements.set(id, ts);

        if (xpGain > 0) {
            xpTotal += xpGain;
            await set(ref(database, 'userStats/' + currentUser + '/xpTotal'), xpTotal);
        }

        if (achievement) {
            showToast(`Achievement unlocked: ${achievement.title}${xpGain ? ` (+${xpGain} XP)` : ''}`);
            achievementToastHistory.unshift({ title: achievement.title, icon: achievement.icon, ts: Date.now() });
            if (achievementToastHistory.length > 20) achievementToastHistory.pop();
            sparkSound('ach');
        }

        const levelAfter = xpToLevel(xpTotal);
        if (levelAfter > levelBefore) {
            showToast(`\u2728 Level up! Garden Level ${levelAfter}`);
        }

        renderAchievementsWindow();
    } catch (e) {
        console.error('unlockAchievement failed', e);
    }
}

function afterPostCreated() {
    unlockAchievement('first_post');
    // allPosts hasn't yet received the Firebase onValue update for the just-pushed post,
    // so add 1 to the current count to include it.
    const myPosts = Object.values(allPosts).filter(p => p.author === currentUser);
    const myCount = myPosts.length + 1;
    if (myCount >= 5)   unlockAchievement('five_posts');
    if (myCount >= 10)  unlockAchievement('ten_posts');
    if (myCount >= 20)  unlockAchievement('twenty_posts');
    if (myCount >= 30)  unlockAchievement('thirty_posts');
    if (myCount >= 50)  unlockAchievement('fifty_posts');
    if (myCount >= 100) unlockAchievement('hundred_posts');

    // Post-length achievements — read body from form (not yet reset at this point).
    const bodyEl = document.getElementById('postBody');
    const newBodyLen = bodyEl ? bodyEl.value.trim().length : 0;
    if (newBodyLen > 0) {
        const longform    = myPosts.filter(p => p.body && p.body.length >= 500).length + (newBodyLen >= 500 ? 1 : 0);
        const minimalist  = myPosts.filter(p => p.body && p.body.length > 0 && p.body.length < 30).length + (newBodyLen < 30 ? 1 : 0);
        if (longform >= 1)   unlockAchievement('longform_1');
        if (longform >= 5)   unlockAchievement('longform_5');
        if (minimalist >= 5)  unlockAchievement('minimalist_5');
        if (minimalist >= 20) unlockAchievement('minimalist_20');
    }

    // XP / meta — check after all other unlocks above have fired.
    if (xpToLevel(xpTotal) >= 5)        unlockAchievement('level_5');
    if (unlockedAchievements.size >= 25) unlockAchievement('unlock_25');

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

    // XP / meta — checked last so all prior unlocks are counted.
    if (xpToLevel(xpTotal) >= 5)        await unlockAchievement('level_5');
    if (unlockedAchievements.size >= 25) await unlockAchievement('unlock_25');

    await checkMythics();
    renderAchievementsWindow();
}

function renderAchievementsWindow() {
    const body = document.getElementById('w95-achievements-body');
    if (!body) return;

    // Format a Unix-ms timestamp as YYYY-MM-DD
    function fmtDate(ts) {
        return new Date(ts).toISOString().slice(0, 10);
    }

    // Text progress bar, e.g. [#####-----] for 5/10
    function progressBar(current, target) {
        const BAR_W  = 10;
        const capped = Math.min(current, target);
        const filled = Math.round(capped / target * BAR_W);
        return '[' + '#'.repeat(filled) + '-'.repeat(BAR_W - filled) + ']';
    }

    // Relative time formatter for toast history
    function fmtRelative(ts) {
        const diff = Math.floor((Date.now() - ts) / 1000);
        if (diff < 60)  return 'just now';
        if (diff < 3600) return Math.floor(diff / 60) + ' min ago';
        return Math.floor(diff / 3600) + ' hr ago';
    }

    // Garden Level / XP header
    const lvl       = xpToLevel(xpTotal);
    const nextFloor = xpForLevel(lvl + 1);            // XP needed to reach next level
    const xpInLevel = xpTotal - xpForLevel(lvl);      // progress within current level
    const BAR_W     = 20;
    const filled    = Math.min(BAR_W, Math.round(xpInLevel / XP_PER_LEVEL * BAR_W));
    const levelBar  = '[' + '#'.repeat(filled) + '-'.repeat(BAR_W - filled) + ']';
    const levelHtml =
        `<div class="achievement-level-header">` +
        `<div class="achievement-level-row">` +
        `<span class="achievement-level-title">Garden Level: ${lvl}</span>` +
        `<span class="achievement-level-xp">XP: ${xpTotal}&nbsp;/&nbsp;${nextFloor}</span>` +
        `</div>` +
        `<div class="achievement-level-bar">${levelBar}</div>` +
        `</div>`;

    // Toast history section (shown only when there are entries this session)
    let historyHtml = '';
    if (achievementToastHistory.length > 0) {
        const rows = achievementToastHistory.map(h =>
            `<div class="achievement-toast-history-row">` +
            `<span class="achievement-toast-history-icon">${safeText(h.icon)}</span>` +
            `<span class="achievement-toast-history-title">${safeText(h.title)}</span>` +
            `<span class="achievement-toast-history-time">${fmtRelative(h.ts)}</span>` +
            `</div>`
        ).join('');
        historyHtml =
            `<div class="achievement-toast-history">` +
            `<div class="achievement-toast-history-header">Notifications this session</div>` +
            rows +
            `</div>`;
    }

    // Build HTML for a single achievement card
    function renderCard(a) {
        const isUnlocked = unlockedAchievements.has(a.id);
        const ts         = unlockedAchievements.get(a.id);

        // Hidden locked achievements show mystery placeholder
        const isHiddenLocked = !isUnlocked && a.hidden;
        const title = isHiddenLocked ? '???' : safeText(a.title);
        const desc  = isHiddenLocked ? 'Keep going\u2026' : safeText(a.desc);

        // Always show the bracket icon — unlocked state is conveyed via CSS class, not icon swap
        const icon = safeText(a.icon);

        // Build stable CSS class list for external styling hooks
        let itemClass = 'achievement-item achievement-card';
        if (isUnlocked)          itemClass += ' is-unlocked';
        else if (isHiddenLocked) itemClass += ' is-locked is-hidden-locked';
        else                     itemClass += ' is-locked';
        itemClass += ` tier-${a.tier}`;

        // Progress row for count-based achievements
        let progressHtml = '';
        if (a.target) {
            const current = isUnlocked
                ? a.target
                : (a.getProgress ? a.getProgress() : 0);
            progressHtml =
                `<div class="achievement-progress">` +
                `<span class="achievement-progress-count">${current}&nbsp;/&nbsp;${a.target}</span>` +
                `<span class="achievement-progress-bar">${progressBar(current, a.target)}</span>` +
                `</div>`;
        }

        // Unlock date line (only shown when unlocked; takes up same space when locked
        // via min-height so the card height doesn't jump on unlock)
        const dateHtml = isUnlocked
            ? `<div class="achievement-unlocked-date">Unlocked: ${fmtDate(ts)}</div>`
            : `<div class="achievement-unlocked-date achievement-unlocked-date--placeholder"></div>`;

        return (
            `<div class="${itemClass}">` +
            `<span class="achievement-icon">${icon}</span>` +
            `<div class="achievement-body">` +
            `<div class="achievement-title">${title}</div>` +
            `<div class="achievement-desc">${desc}</div>` +
            progressHtml +
            dateHtml +
            `</div>` +
            `</div>`
        );
    }

    // Group and render achievements by tier: bronze -> silver -> gold -> mythic
    const TIER_ORDER = ['bronze', 'silver', 'gold', 'mythic'];
    let tiersHtml = '';
    for (const tier of TIER_ORDER) {
        const tierAchs = ACHIEVEMENTS.filter(a => a.tier === tier);
        if (tier === 'mythic') {
            // Mythics are completely hidden until unlocked — no ??? placeholder
            const unlockedMythics = tierAchs.filter(a => unlockedAchievements.has(a.id));
            if (unlockedMythics.length === 0) continue;
            tiersHtml += `<div class="achievement-tier-header">=== MYTHIC ===</div>`;
            tiersHtml += unlockedMythics.map(renderCard).join('');
        } else {
            if (tierAchs.length === 0) continue;
            const label = tier.toUpperCase();
            tiersHtml += `<div class="achievement-tier-header">=== ${label} ===</div>`;
            // Unlocked first, then locked
            const unlockedInTier = tierAchs.filter(a =>  unlockedAchievements.has(a.id));
            const lockedInTier   = tierAchs.filter(a => !unlockedAchievements.has(a.id));
            tiersHtml += [...unlockedInTier, ...lockedInTier].map(renderCard).join('');
        }
    }

    body.innerHTML = levelHtml + historyHtml + tiersHtml;
}

// Achievements window IIFE
(() => {
    const win    = document.getElementById('w95-win-achievements');
    const btn    = document.getElementById('w95-btn-achievements');
    const min    = document.getElementById('w95-achievements-min');
    const handle = document.getElementById('w95-achievements-handle');
    if (!win || !btn || !min || !handle) return;

    function show() {
        win.classList.remove('is-hidden');
        btn.classList.add('is-pressed');
        localStorage.setItem('w95_achievements_open', '1');
    }
    function hide() {
        win.classList.add('is-hidden');
        btn.classList.remove('is-pressed');
        localStorage.setItem('w95_achievements_open', '0');
    }

    btn.onclick = () => {
        if (win.classList.contains('is-hidden')) show(); else hide();
    };
    min.onclick = (e) => { e.stopPropagation(); hide(); };

    if (localStorage.getItem('w95_achievements_open') === '1') show();
    else hide();

    // Drag support
    let dragging = false, startX = 0, startY = 0, winStartX = 0, winStartY = 0;
    handle.addEventListener('mousedown', (e) => {
        if (e.target.closest('button')) return;
        dragging = true;
        startX = e.clientX; startY = e.clientY;
        const r = win.getBoundingClientRect();
        winStartX = r.left; winStartY = r.top;
        win.style.zIndex = ++w95TopZ;
        e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        win.style.left = Math.max(0, winStartX + (e.clientX - startX)) + 'px';
        win.style.top  = Math.max(0, winStartY + (e.clientY - startY)) + 'px';
    });
    window.addEventListener('mouseup', () => { dragging = false; });
})();
