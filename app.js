import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js';
import { getDatabase, ref, push, onValue, remove, update, set, get, child, limitToLast, query, onDisconnect } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js';
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

const COLLECTION_EMOJIS = { funny: 'xD', cute: '^_^', news: '[news]', inspiration: '*', music: '♪', 'idiot-drivers': '>:(', other: '[+]' };
const COLLECTION_LABELS = { funny: 'Funny', cute: 'Cute', news: 'News', inspiration: 'Inspiration', music: 'Music', 'idiot-drivers': 'Idiot Drivers', other: 'Other' };

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
        .replaceAll("'", '&#039;');
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
        ensureAudio();
        const ctx = _audioCtx;
        const t0 = ctx.currentTime;

        // Windows 95-style: square waves, sharp envelopes, named notes
        // post  → "The Microsoft Sound" abbreviated (4-note ascending chime)
        // reply → "Exclamation"  (descending two-note blip)
        // react → "Asterisk"     (single high ding)
        // chat  → "Notify"       (ascending two-tone)
        // ping  → "Default Beep" (classic square blip at 750 Hz)
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
        if (chatOpen) renderChat(messages);
    });
}

// ---- AUTH STATE OBSERVER ----
// Single entry point for starting/stopping a session. All DB access is gated here.
onAuthStateChanged(auth, (firebaseUser) => {
    if (!firebaseUser) {
        // Signed out — reset and show login
        currentUser = null;
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
    if (panel.classList.contains('show')) { closeActivityPanel(); return; }
    panel.classList.add('show');
    renderActivityPanel();
    activitySeenTs = Date.now();
    localStorage.setItem(`activitySeenTs-${currentUser}`, String(activitySeenTs));
    document.getElementById('activityBadge').classList.add('hidden');
};

window.closeActivityPanel = function() {
    document.getElementById('activityPanel').classList.remove('show');
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
    panel.classList.toggle('show', chatOpen);

    if (chatOpen) {
        lastChatSeenTs = Date.now();
        localStorage.setItem('chatSeenTs', String(lastChatSeenTs));
        document.getElementById('chatUnread').classList.add('hidden');

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
    document.getElementById('chatPanel').classList.remove('show');
    if (!silent) document.getElementById('chatUnread').classList.add('hidden');
}

const chatInput = document.getElementById('chatInput');

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
});



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
document.getElementById('activityFab')?.addEventListener('click',       () => toggleActivityPanel());
document.getElementById('activityPanelClose')?.addEventListener('click', () => closeActivityPanel());

// Chat
document.getElementById('chatFab')?.addEventListener('click',       () => toggleChat());
document.getElementById('chatPanelClose')?.addEventListener('click', () => toggleChat());

// About modal
document.getElementById('aboutBtn')?.addEventListener('click',   () => openAbout());
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

// ===== Win95 Dog Window + Shared Firebase Dog =====
(() => {
  const btn = document.getElementById('w95-btn-dog');
  const win = document.getElementById('w95-win-dog');
  const min = document.getElementById('w95-dog-min');
  const handle = document.getElementById('w95-dog-handle');

  if (!btn || !win || !min || !handle) return;

  const ascii = document.getElementById('dog-ascii');
  const hungerEl = document.getElementById('dog-hunger');
  const happyEl = document.getElementById('dog-happy');
  const energyEl = document.getElementById('dog-energy');

  const feedBtn = document.getElementById('dog-feed');
  const petBtn = document.getElementById('dog-pet');
  const sleepBtn = document.getElementById('dog-sleep');

  const DOG_ASCII =
`          "",_o
!       ( (  _)
\`\\ ,,,,_'),)=~
 (          )
  ,   ,,,,  ,
  ) ,)   < (
 < <      ",\\
  ",)      "_)
`;

  if (ascii) ascii.textContent = DOG_ASCII;

  const dogRef = ref(database, 'dog');

  function clamp(n) {
    return Math.max(0, Math.min(100, n));
  }

  // Initialise dog once if missing
  onValue(dogRef, (snap) => {
    if (!snap.exists()) {
      set(dogRef, { hunger: 70, happy: 70, energy: 70 });
    }
  }, { onlyOnce: true });

  // Live render
  onValue(dogRef, (snap) => {
    const d = snap.val();
    if (!d) return;

    if (hungerEl) hungerEl.textContent = String(d.hunger ?? 0);
    if (happyEl) happyEl.textContent = String(d.happy ?? 0);
    if (energyEl) energyEl.textContent = String(d.energy ?? 0);
  });

  async function applyDelta(delta) {
    const snap = await get(dogRef);
    const d = snap.val();
    if (!d) return;

    update(dogRef, {
      hunger: clamp((d.hunger ?? 70) + (delta.hunger ?? 0)),
      happy: clamp((d.happy ?? 70) + (delta.happy ?? 0)),
      energy: clamp((d.energy ?? 70) + (delta.energy ?? 0)),
    });
  }

  if (feedBtn) feedBtn.onclick = () => applyDelta({ hunger: 15, happy: 2, energy: -2 });
  if (petBtn) petBtn.onclick = () => applyDelta({ hunger: -1, happy: 12, energy: -1 });
  if (sleepBtn) sleepBtn.onclick = () => applyDelta({ hunger: -6, happy: 2, energy: 18 });

  // Optional gentle decay every 10 minutes (shared, but driven by any open client)
  setInterval(() => {
    applyDelta({ hunger: -1, happy: -1, energy: -1 });
  }, 10 * 60 * 1000);

  // Minimise and toggle
  function show() {
    win.classList.remove('is-hidden');
    btn.classList.add('is-pressed');
    localStorage.setItem('w95_dog_open', '1');
  }

  function hide() {
    win.classList.add('is-hidden');
    btn.classList.remove('is-pressed');
    localStorage.setItem('w95_dog_open', '0');
  }

  btn.onclick = () => {
    const isHidden = win.classList.contains('is-hidden');
    if (isHidden) show();
    else hide();
  };

  min.onclick = (e) => {
    e.stopPropagation();
    hide();
  };

  // Restore open state
  const savedOpen = localStorage.getItem('w95_dog_open');
  if (savedOpen === '0') hide();
  else show();

  // Drag
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let winStartX = 20;
  let winStartY = 20;

  handle.addEventListener('mousedown', (e) => {
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
    const nx = winStartX + (e.clientX - startX);
    const ny = winStartY + (e.clientY - startY);
    win.style.left = Math.max(0, nx) + 'px';
    win.style.top = Math.max(0, ny) + 'px';
  });

  window.addEventListener('mouseup', () => {
    dragging = false;
  });
})();

(() => {
  const chatPanel = document.getElementById('chatPanel');
  const activityPanel = document.getElementById('activityPanel');

  const chatBody = document.getElementById('w95-chat-body');
  const newBody = document.getElementById('w95-new-body');

  const winChat = document.getElementById('w95-win-chat');
  const winNew = document.getElementById('w95-win-new');

  const btnChat = document.getElementById('w95-btn-chat');
  const btnNew = document.getElementById('w95-btn-new');

  const minChat = document.getElementById('w95-chat-min');
  const minNew = document.getElementById('w95-new-min');

  if (!chatPanel || !activityPanel || !chatBody || !newBody || !winChat || !winNew || !btnChat || !btnNew || !minChat || !minNew) return;

  // Move existing panels into Win95 windows (keeps their current JS)
  chatBody.appendChild(chatPanel);
  newBody.appendChild(activityPanel);

  // Stop any fixed positioning from fighting the window
  chatPanel.style.position = 'static';
  activityPanel.style.position = 'static';
  chatPanel.style.display = 'block';
  activityPanel.style.display = 'block';

  function show(win, btn, key) {
    win.classList.remove('is-hidden');
    btn.classList.add('is-pressed');
    localStorage.setItem(key, '1');
  }

  function hide(win, btn, key) {
    win.classList.add('is-hidden');
    btn.classList.remove('is-pressed');
    localStorage.setItem(key, '0');
  }

  function toggle(win, btn, key) {
    if (win.classList.contains('is-hidden')) show(win, btn, key);
    else hide(win, btn, key);
  }

  btnChat.onclick = () => toggle(winChat, btnChat, 'w95_chat_open');
  btnNew.onclick = () => toggle(winNew, btnNew, 'w95_new_open');

  minChat.onclick = (e) => { e.stopPropagation(); hide(winChat, btnChat, 'w95_chat_open'); };
  minNew.onclick = (e) => { e.stopPropagation(); hide(winNew, btnNew, 'w95_new_open'); };

  // Make the existing X buttons minimise too
  const chatClose = document.getElementById('chatPanelClose');
  const newClose = document.getElementById('activityPanelClose');
  if (chatClose) chatClose.onclick = (e) => { e.preventDefault(); hide(winChat, btnChat, 'w95_chat_open'); };
  if (newClose) newClose.onclick = (e) => { e.preventDefault(); hide(winNew, btnNew, 'w95_new_open'); };

  // Restore open state
  if (localStorage.getItem('w95_chat_open') === '0') hide(winChat, btnChat, 'w95_chat_open');
  else show(winChat, btnChat, 'w95_chat_open');

  if (localStorage.getItem('w95_new_open') === '0') hide(winNew, btnNew, 'w95_new_open');
  else show(winNew, btnNew, 'w95_new_open');
})();
