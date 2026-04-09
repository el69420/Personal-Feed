// ui-utils.js — Pure UI utility functions shared across the app.
// No external dependencies; safe to import anywhere.

export function prefersReducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function safeText(s) {
    return (s || '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

export function timeAgo(ts) {
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

export function exactTimestamp(ts) {
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

export function detectSource(url) {
    const u = (url || '').toLowerCase();
    if (u.includes('instagram.com/')) return 'instagram';
    if (u.includes('reddit.com/') || u.includes('redd.it/')) return 'reddit';
    if (u.includes('twitter.com/') || u.includes('x.com/')) return 'x';
    if (u.includes('youtube.com/') || u.includes('youtu.be/')) return 'youtube';
    if (u.includes('tiktok.com/')) return 'tiktok';
    if (u.includes('spotify.com/')) return 'spotify';
    if (u.includes('bbc.co.uk/') || u.includes('theguardian.com/') || u.includes('ft.com/') ||
        u.includes('reuters.com/') || u.includes('sky.com/news') || u.includes('edition.cnn.com/')) return 'news-site';
    return 'other';
}

export function getYouTubeId(url) {
    try {
        const u = new URL(url);

        // youtu.be short links
        if (u.hostname.includes('youtu.be')) {
            return u.pathname.split('/').filter(Boolean)[0] || null;
        }

        // YouTube Shorts: youtube.com/shorts/{id}
        const shortsMatch = u.pathname.match(/^\/shorts\/([^/?]+)/);
        if (shortsMatch) return shortsMatch[1];

        // normal youtube.com/watch?v= links
        if (u.searchParams.get('v')) return u.searchParams.get('v');

        return null;
    } catch {
        return null;
    }
}

export function youtubeThumb(url) {
    const id = getYouTubeId(url);
    if (!id) return null;
    return `https://img.youtube.com/vi/${id}/hqdefault.jpg`;
}

export function burstEmoji(emoji, sourceEl) {
    if (prefersReducedMotion()) return;
    const rect  = sourceEl.getBoundingClientRect();
    const cx    = rect.left + rect.width  / 2;
    const cy    = rect.top  + rect.height / 2;
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
