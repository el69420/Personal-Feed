import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js';
import { getDatabase, ref, push, onValue, remove, update, set, get, child, limitToLast, query } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js';

const firebaseConfig = {
    apiKey: "AIzaSyBB0O3pcsHQt5mWVUFZqnbB0kY3Z9d8k304",
    authDomain: "personal-feed-149ce.firebaseapp.com",
    databaseURL: "https://personal-feed-149ce-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "personal-feed-149ce",
    storageBucket: "personal-feed-149ce.firebasestorage.app",
    messagingSenderId: "687986584760",
    appId: "1:687986584760:web:016afc08C44371f1985285"
};

const app = initializeApp(firebaseConfig);
const database = getDatabase(app);
const postsRef = ref(database, 'posts');
const chatRef  = ref(database, 'chat');

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
let prevDataSig = null;

let _audioCtx = null;
let chatOpen = false;
let lastChatSeenTs = Number(localStorage.getItem('chatSeenTs') || '0');
let lastChatMessages = [];


// Edit/Delete modal state
let editTarget = null;   // { type:'post'|'reply', postId, replyId }
let deleteTarget = null; // { type:'post'|'reply', postId, replyId }

const COLLECTION_EMOJIS = { funny: '😂', cute: '🥰', news: '📰', inspiration: '✨', music: '🎵', 'idiot-drivers': '🚗', other: '📌' };
const COLLECTION_LABELS = { funny: 'Funny', cute: 'Cute', news: 'News', inspiration: 'Inspiration', music: 'Music', 'idiot-drivers': 'Idiot Drivers', other: 'Other' };

const SOURCE_EMOJIS = { instagram: '📷', reddit: '👽', x: '𝕏', youtube: '▶️', tiktok: '🎵', spotify: '🎧', 'news-site': '📰', other: '🔗' };
const SOURCE_LABELS = { instagram: 'Instagram', reddit: 'Reddit', x: 'X', youtube: 'YouTube', tiktok: 'TikTok', spotify: 'Spotify', 'news-site': 'News site', other: 'Other' };

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
function ensureAudio() {
    if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (_audioCtx.state === 'suspended') _audioCtx.resume();
}

function sparkSound(type) {
    try {
        ensureAudio();
        const t0 = _audioCtx.currentTime;

        const patterns = {
            post:   [880, 1320, 1760],
            reply:  [660, 990, 1320],
            react:  [1046, 1568],
            chat:   [784, 1175],
            ping:   [880, 1320]
        };

        const freqs = patterns[type] || patterns.ping;
        freqs.forEach((f, i) => {
            const osc = _audioCtx.createOscillator();
            const gain = _audioCtx.createGain();
            const filter = _audioCtx.createBiquadFilter();

            osc.type = 'triangle';
            filter.type = 'highpass';
            filter.frequency.setValueAtTime(600, t0);

            osc.connect(filter);
            filter.connect(gain);
            gain.connect(_audioCtx.destination);

            const start = t0 + i * 0.045;
            const end = start + 0.18;

            osc.frequency.setValueAtTime(f, start);
            osc.frequency.exponentialRampToValueAtTime(f * 1.08, start + 0.06);

            gain.gain.setValueAtTime(0.0001, start);
            gain.gain.exponentialRampToValueAtTime(0.18, start + 0.015);
            gain.gain.exponentialRampToValueAtTime(0.0001, end);

            osc.start(start);
            osc.stop(end);
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
        collPill.textContent = `${COLLECTION_EMOJIS[currentCollection] || '📁'} ${COLLECTION_LABELS[currentCollection] || currentCollection}`;
        collPill.onclick = () => openCollectionsModal();
        collPill.title = 'Change collection filter';
    } else {
        collPill.classList.add('hidden');
    }

    if (hasSrc) {
        srcPill.classList.remove('hidden');
        srcPill.textContent = `${SOURCE_EMOJIS[currentSource] || '🔗'} ${SOURCE_LABELS[currentSource] || currentSource}`;
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

// ---- AUTH ----
window.login = function(user) {
    currentUser = user;
    localStorage.setItem('currentUser', user);

    ensureAudio();
    document.getElementById('loginOverlay').style.display = 'none';

    const emoji = user === 'El' ? '💖' : '💜';
    document.getElementById('userIndicator').textContent = `${emoji} ${user} · switch`;

    const other = user === 'El' ? 'Tero' : 'El';
    const otherEmoji = user === 'El' ? '💜' : '💖';
    document.getElementById('btnOtherUser').textContent = `${otherEmoji} Just ${other}`;

    updateNewCount();
    loadPosts();
};

window.logout = function() {
    currentUser = null;
    localStorage.removeItem('currentUser');
    document.getElementById('loginOverlay').style.display = 'flex';
    closeChat(true);
};

const savedUser = localStorage.getItem('currentUser');
if (savedUser) login(savedUser);

// Scroll to top button
window.addEventListener('scroll', () => {
    document.getElementById('scrollTopBtn').classList.toggle('visible', window.scrollY > 300);
});

// Keyboard shortcut: n = new post
document.addEventListener('keydown', e => {
    if (e.key === 'n' && !e.ctrlKey && !e.metaKey && !e.altKey &&
        document.activeElement.tagName !== 'TEXTAREA' &&
        document.activeElement.tagName !== 'INPUT' && currentUser) {
        openAddPostModal();
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
    if (trailCounter % 2 === 0) createStarTrail(e.clientX, e.clientY);
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
    document.getElementById('darkModeIcon').textContent = isDarkMode ? '☀️' : '🌙';
    localStorage.setItem('darkMode', isDarkMode);
};

if (localStorage.getItem('darkMode') === 'true') {
    toggleDarkMode();
}

// ---- MODALS ----


window.openEditPost = function(postId) {
    const post = allPosts[postId];
    if (!post || post.author !== currentUser) return;
    openEditModal('Edit note', post.note || '', { type: 'post', postId });
};

window.openEditComment = function(postId, replyId) {
    const post = allPosts[postId];
    if (!post) return;
    const reply = (post.replies || []).find(r => r.id === replyId);
    if (!reply || reply.author !== currentUser) return;
    openEditModal('Edit comment', reply.text || '', { type: 'reply', postId, replyId });
};

window.openHistory = function(payloadJson) {
    const p = JSON.parse(payloadJson || '{}');
    document.getElementById('historyMeta').textContent = p.meta || '';
    document.getElementById('historyText').textContent = p.text || '';
    document.getElementById('historyModal').classList.add('show');
};

window.closeHistoryModal = function() {
    document.getElementById('historyModal').classList.remove('show');
};

window.openAddPostModal = function() {
    document.getElementById('addPostModal').classList.add('show');
    setTimeout(() => document.getElementById('postUrl')?.focus(), 50);
};
window.closeAddPostModal = function() {
    document.getElementById('addPostModal').classList.remove('show');
};

window.openCollectionsModal = function() {
    document.getElementById('collectionsModal').classList.add('show');
};
window.closeCollectionsModal = function() {
    document.getElementById('collectionsModal').classList.remove('show');
};

window.openSourcesModal = function() {
    document.getElementById('sourcesModal').classList.add('show');
};
window.closeSourcesModal = function() {
    document.getElementById('sourcesModal').classList.remove('show');
};

// Edit/Delete modal controls
window.openEditModal = function(label, initialValue, target) {
    editTarget = target;
    document.getElementById('editLabel').textContent = label;
    document.getElementById('editTextarea').value = initialValue || '';
    document.getElementById('editModal').classList.add('show');
    setTimeout(() => document.getElementById('editTextarea')?.focus(), 50);
};

window.closeEditModal = function() {
    editTarget = null;
    document.getElementById('editModal').classList.remove('show');
};

window.openDeleteModal = function(target) {
    deleteTarget = target;
    document.getElementById('deleteModal').classList.add('show');
};

window.closeDeleteModal = function() {
    deleteTarget = null;
    document.getElementById('deleteModal').classList.remove('show');
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
        const updateData = { note: val, editedAt: now };
        // Preserve the very first original — don't overwrite on subsequent edits
        if (!post.editHistory) {
            updateData.editHistory = {
                originalTs: post.timestamp || now,
                originalNote: post.note || ''
            };
        }
        await update(ref(database, `posts/${editTarget.postId}`), updateData);
        showToast('Post updated');
    } else {
        const post = allPosts[editTarget.postId];
        if (!post) return;

        const replies = (post.replies || []).map(r => {
            if (r.id !== editTarget.replyId) return r;
            const updated = { ...r, text: val, editedAt: now };
            if (!r.editHistory) {
                updated.editHistory = { originalTs: r.timestamp || now, originalNote: r.text || '' };
            }
            return updated;
        });

        await update(ref(database, `posts/${editTarget.postId}`), { replies });
        showToast('Comment updated');
    }

    closeEditModal();
};

window.confirmDelete = async function() {
    if (!deleteTarget) return;

    if (deleteTarget.type === 'post') {
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
    btn.textContent = on ? '🔔' : '🔕';
    btn.title = on ? 'Desktop notifications on — click to turn off' : 'Click to enable desktop notifications';
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
    document.getElementById('notifPermModal').style.display = 'none';
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
    document.getElementById('notifPermModal').style.display = 'flex';
};

// Sync stored preference with actual browser permission on load
if (notificationsEnabled && notifSupported() && Notification.permission !== 'granted') {
    notificationsEnabled = false;
    localStorage.setItem('notificationsEnabled', 'false');
}
setTimeout(updateNotifBtn, 0);

// ---- DATA ----
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

    loadPosts();
    updateNewCount();
    updateSyncStatus('Synced');
    setTimeout(() => updateSyncStatus('Live'), 2000);
});

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

window.addPost = async function() {
    const url = document.getElementById('postUrl').value.trim();
    const note = document.getElementById('postNote').value.trim();
    const author = currentUser;
    const collections = getSelectedCollections();
    if (!url) { alert('Please enter a URL'); return; }

    const source = detectSource(url);

    try {
        await push(postsRef, {
            url,
            note,
            author,
            collections,
            source,
            timestamp: Date.now(),
            readBy: { [author]: true },
            reactionsBy: {},
            replies: []
        });

        document.getElementById('postUrl').value = '';
        document.getElementById('postNote').value = '';
        document.querySelectorAll('#collectionPicker .coll-pick-btn').forEach(b => b.classList.remove('selected'));

        closeAddPostModal();
        showToast('Post added');
        sparkSound('post');
    } catch (error) {
        alert('Failed to add post. Check your internet connection.');
    }
};

window.markSeen = async function(id) {
    await update(ref(database, `posts/${id}/readBy`), { [currentUser]: true });
    showToast('Marked as seen');
};

window.deletePost = function(id) {
    openDeleteModal({ type: 'post', postId: id });
};

// ---- REACTIONS ----
window.toggleReaction = async function(postId, emoji) {
    const post = allPosts[postId];
    if (!post) return;

    const reactionsBy = structuredClone(post.reactionsBy || {});
    reactionsBy[emoji] = reactionsBy[emoji] || {};

    if (reactionsBy[emoji][currentUser]) {
        delete reactionsBy[emoji][currentUser];
        if (Object.keys(reactionsBy[emoji]).length === 0) delete reactionsBy[emoji];
    } else {
        reactionsBy[emoji][currentUser] = true;
    }

    await update(ref(database, `posts/${postId}`), { reactionsBy });
    sparkSound('react');
};

window.toggleCommentReaction = async function(postId, replyId, emoji) {
    const post = allPosts[postId];
    if (!post) return;

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

    await update(ref(database, `posts/${postId}`), { replies });
    sparkSound('react');
};

// ---- REPLIES ----
window.addReply = async function(postId) {
    const input = document.getElementById(`reply-${postId}`);
    const text  = input.value.trim();
    if (!text) return;

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

    const cmtEmojis = ['❤️', '😂', '😮', '🔥'];

    const renderRxButtons = (rxBy, postId, replyId) => {
        const map = rxBy || {};
        return cmtEmojis.map(e => {
            const users = Object.keys(map[e] || {});
            const active = !!(map[e] && map[e][currentUser]);
            const who = users.sort().join(' & ');
            return `
                <button class="comment-reaction-btn${active ? ' active' : ''}"
                        onclick="toggleCommentReaction('${postId}','${replyId}','${e}')">
                    ${e}${who ? `<span class="reaction-people">${who}</span>` : ''}
                </button>
            `;
        }).join('');
    };

    const renderItem = (reply, isChild) => {
        const ae = reply.author === 'Tero' ? '💜' : '💖';
        const ts = reply.timestamp ? timeAgo(reply.timestamp) : '';
        const tsFull = reply.timestamp ? exactTimestamp(reply.timestamp) : '';
        const children = byParent[reply.id] || [];

        return `
            <div class="reply-item${isChild ? ' reply-child' : ''}">
                <div class="reply-item-header">
                    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                        <span style="font-size:11px;font-weight:900;color:var(--text-secondary);font-family:'Nunito',sans-serif;">${safeText(reply.author)} ${ae}</span>
                        ${ts ? `<span style="font-size:10px;color:var(--text-secondary);opacity:0.65;font-family:'Nunito',sans-serif;font-weight:800;" title="${safeText(tsFull)}">${safeText(ts)}</span>` : ''}
                        ${reply.editedAt && reply.editHistory ? `<button class="edit-pill" onclick="openHistory('${safeText(JSON.stringify({ meta: 'Original, ' + exactTimestamp(reply.editHistory.originalTs), text: reply.editHistory.originalNote || '' }))}')" title="View original">edited</button>` : ''}
                    </div>

                    <div style="display:flex;align-items:center;gap:6px;">
                        <button class="reply-btn" onclick="openInlineReply('${postId}','${reply.id}')">↩ Reply</button>
                        ${reply.author === currentUser ? `
                            <button class="reply-btn" onclick="openEditComment('${postId}','${reply.id}')" title="Edit">✏️</button>
                            <button class="reply-btn" onclick="openDeleteModal({type:'reply', postId:'${postId}', replyId:'${reply.id}'})" title="Delete">✕</button>
                        ` : ''}
                    </div>
                </div>

                <div style="font-size:13px;color:var(--text-primary);line-height:1.55;white-space:pre-wrap;font-family:'Nunito',sans-serif;font-weight:700;">${safeText(reply.text)}</div>

                <div class="comment-reactions">
                    ${renderRxButtons(reply.reactionsBy, postId, reply.id)}
                </div>
            </div>

            ${children.length ? children.map(c => renderItem(c, true)).join('') : ''}

            <div id="inline-reply-${postId}-${reply.id}" class="inline-reply-form hidden">
                <div style="font-size:11px;font-weight:900;color:var(--text-secondary);margin-bottom:6px;font-family:'Nunito',sans-serif;">Replying to ${safeText(reply.author)}</div>
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

    return `
        <div class="reply-section">
            <div class="divider-text">Replies</div>
            ${topLevel.map(r => renderItem(r, false)).join('')}
        </div>
    `;
}

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
    return `${SOURCE_EMOJIS[s] || '🔗'} ${SOURCE_LABELS[s] || s}`;
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
        <div style="padding:14px 18px;">
            <blockquote class="instagram-media" data-instgrm-permalink="${safeText(url)}" data-instgrm-version="14"
                style="margin: 0; width: 100%; background: transparent; border: none;">
            </blockquote>
            <div style="font-size:11px;color:var(--text-secondary);opacity:0.7;margin-top:8px;font-family:'Nunito',sans-serif;font-weight:800;">
                If the caption doesn’t show, Instagram is blocking it for that post.
            </div>
        </div>
    `;
}

function createPostCard(post) {
    const date = timeAgo(post.timestamp);
    const dateFull = exactTimestamp(post.timestamp);

    const domain = post.url.match(/https?:\/\/([^\/]+)/)?.[1]?.replace('www.', '') || 'link';
    const tweetId = post.url.match(/(?:twitter|x)\.com\/.*\/status\/(\d+)/)?.[1];

    const author = post.author || 'Unknown';
    const badgeClass = author === 'Tero' ? 'badge-tero' : 'badge-el';
    const emoji = author === 'Tero' ? '💜' : '💖';

    const faviconUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;

    // Support both new (array) and legacy (string) collection formats
    const collArr = post.collections?.length ? post.collections
                  : post.collection         ? [post.collection]
                  : [];
    const collectionBadge = collArr
        .map(c => `<button class="collection-badge" onclick="filterByCollection('${safeText(c)}')" title="Filter by collection">${getCollectionEmoji(c)} ${safeText(COLLECTION_LABELS[c] || c)}</button>`)
        .join('');

    const source = post.source || detectSource(post.url);
    const isFav = !!(post.favoritedBy && post.favoritedBy[currentUser]);
    const sourceBadge = `<button class="collection-badge" onclick="filterBySource('${safeText(source)}')" title="Filter by source">${safeText(getSourceLabel(source))}</button>`;

    const reactionEmojis = ['❤️', '😂', '😮', '😍', '🔥', '👍'];
    const rb = post.reactionsBy || {};

    const reactionButtons = reactionEmojis.map(e => {
        const users = Object.keys(rb[e] || {});
        const active = !!(rb[e] && rb[e][currentUser]);
        const who = users.sort().join(' & ');
        return `
            <button class="reaction-btn${active ? ' active' : ''}"
                    onclick="toggleReaction('${post.id}','${e}')">
                <span>${e}</span>
                ${who ? `<span class="reaction-people">${who}</span>` : ''}
            </button>
        `;
    }).join('');

    const replies = post.replies || [];

    let contentHtml = '';
    if (tweetId) {
        contentHtml = `
            <div class="post-content">
                <blockquote class="twitter-tweet" data-dnt="true" data-conversation="none">
                    <a href="https://twitter.com/x/status/${tweetId}"></a>
                </blockquote>
            </div>
        `;
    } else if (source === 'instagram') {
        contentHtml = createInstagramEmbed(post.url);
    } else if (source === 'youtube') {
        contentHtml = createYouTubeEmbed(post);
    } else {
        contentHtml = `
            <div class="post-content">
                <a href="${safeText(post.url)}" target="_blank" class="link-preview">
                    <div class="link-favicon">
                        <img src="${faviconUrl}" alt="${safeText(domain)}" onerror="this.parentNode.innerHTML='🔗'">
                    </div>
                    <div class="link-info">
                        <div class="link-domain">${safeText(domain)}</div>
                        <div class="link-url">${safeText(post.url)}</div>
                    </div>
                    <svg class="link-arrow" width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/>
                    </svg>
                </a>
            </div>
        `;
    }

    return `
        <div class="post-card fade-in">
            <div class="post-header">
                <div class="post-author-row">
                    <span class="${badgeClass}">${safeText(author)} ${emoji}</span>
                    <span style="color: var(--text-secondary); font-size: 12px; font-family:'Nunito',sans-serif; font-weight:900;">•</span>
                    <span style="color: var(--text-secondary); font-size: 12px; font-weight: 900; font-family:'Nunito',sans-serif;" title="${safeText(dateFull)}">${safeText(date)}</span>
                    ${collectionBadge}
                    ${sourceBadge}
                    ${isRead(post) ? '<span class="seen-dot" title="Seen"></span>' : ''}
                ${post.editedAt && post.editHistory ? `
  <button class="edit-pill"
    onclick="openHistory('${safeText(JSON.stringify({
meta: `Original, ${exactTimestamp(post.editHistory.originalTs)}`,
text: post.editHistory.originalNote || ''
    }))}')"
    title="View original">
    edited
  </button>
` : ''}

                </div>

                <div style="display:flex;gap:4px;align-items:center;">
                    <button class="icon-btn${isFav ? ' fav-active' : ''}" onclick="toggleFavorite('${post.id}')" title="${isFav ? 'Unsave' : 'Save'}">
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

            <div class="reactions-bar">
                ${reactionButtons}
            </div>

            ${renderReplies(post.id, replies)}

            <div class="reply-section">
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
                <div style="font-size:10px;color:var(--text-secondary);opacity:0.7;margin-top:6px;font-family:'Nunito',sans-serif;font-weight:800;">Enter to send, Shift+Enter for a new line</div>
            </div>

            ${!isRead(post) ? `
                <div class="post-actions">
                    <button onclick="markSeen('${post.id}')" class="btn-secondary px-4 py-2 text-sm font-semibold rounded-xl" style="display:flex;align-items:center;gap:6px;white-space:nowrap;width:100%;justify-content:center;">
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
        const other = currentUser === 'El' ? 'Tero' : 'El';
        posts = posts.filter(p => p.author === other);
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
            const other = currentUser === 'El' ? 'Tero' : 'El';
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
    window.scrollTo({ top: savedScroll, behavior: 'instant' });

    setTimeout(() => {
        window.twttr?.widgets?.load?.();
        window.instgrm?.Embeds?.process?.();
    }, 120);
}

// ---- CHAT ----
function formatChatTime(ts) {
    if (!ts) return '';
    return new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

const AUTHOR_EMOJI = { 'Tero': '💜', 'El': '💖' };

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
        const emoji = AUTHOR_EMOJI[g.author] || '💬';
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

onValue(query(chatRef, limitToLast(80)), (snapshot) => {
    const raw = snapshot.val() || {};
    const messages = Object.entries(raw)
        .map(([id, m]) => ({ id, ...m }))
        .sort((a,b) => (a.timestamp || 0) - (b.timestamp || 0));
    lastChatMessages = messages;


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
            setTimeout(() => showToast('Double-click Tero\'s messages to ❤️ them'), 900);
        }

        setTimeout(() => document.getElementById('chatInput')?.focus(), 80);
    }
};

function closeChat(silent) {
    chatOpen = false;
    document.getElementById('chatPanel').classList.remove('show');
    if (!silent) document.getElementById('chatUnread').classList.add('hidden');
}

const chatInput = document.getElementById('chatInput');

// Auto-expand textarea as user types
chatInput.addEventListener('input', () => {
    chatInput.style.height = 'auto';
    chatInput.style.height = Math.min(chatInput.scrollHeight, 140) + 'px';
});

chatInput.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    if (e.shiftKey) return;
    e.preventDefault();

    const text = chatInput.value.trim();
    if (!text) return;

    await push(chatRef, {
        author: currentUser,
        text,
        timestamp: Date.now()
    });

    chatInput.value = '';
    chatInput.style.height = 'auto';
    sparkSound('chat');
});

// Close chat when clicking outside the panel or FAB
document.addEventListener('click', (e) => {
    if (chatOpen && !e.target.closest('#chatPanel') && !e.target.closest('.chat-fab')) {
        closeChat();
    }
});

// ---- TOAST ----
function showToast(msg) {
    const toast = document.createElement('div');
    toast.style.cssText = `
        position: fixed; bottom: 28px; right: 28px;
        background: rgba(18, 9, 42, 0.96);
        color: #ede9fe;
        padding: 12px 20px;
        border-radius: 14px;
        font-size: 14px; font-weight: 900;
        font-family: 'Nunito', sans-serif;
        box-shadow: 0 8px 32px rgba(0,0,0,0.28), inset 0 0 0 1px rgba(139,92,246,0.35);
        z-index: 9999;
        backdrop-filter: blur(14px);
        transition: opacity 0.3s ease, transform 0.3s ease;
        letter-spacing: -0.01em;
    `;
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px)';
        setTimeout(() => toast.remove(), 300);
    }, 2200);
}
