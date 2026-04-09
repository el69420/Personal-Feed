// link-preview.js — Firebase-backed link metadata cache + DOM hydration helpers.
import { database, ref, get, set, child } from './firebase.js';

// Converts a URL to a safe Firebase key (no . # $ [ ] /)
export function urlToKey(url) {
    return url.replace(/https?:\/\//g, '').replace(/[.#$[\]/]/g, '_').substring(0, 768);
}

// Apply cached/fetched metadata to an already-rendered .link-preview element
export function applyLinkMeta(el, meta) {
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

// Check Firebase cache then fall back to microlink.io
// opts.requireImage: if true, bypass cache when cached result has no image
export async function fetchLinkMeta(url, opts = {}) {
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
export async function hydrateLinkPreviews(container) {
    const previews = container.querySelectorAll('.link-preview[data-url]');
    await Promise.all(Array.from(previews).map(async (el) => {
        const url  = decodeURIComponent(el.dataset.url);
        const meta = await fetchLinkMeta(url);
        if (meta) applyLinkMeta(el, meta);
        else el.classList.remove('lp-loading');
    }));
}

// Hydrate rich media cards (Spotify, TikTok, X, Reddit)
export async function hydrateRichCards(container) {
    const cards = container.querySelectorAll('.rich-card[data-url], .spotify-card[data-url]');
    await Promise.all(Array.from(cards).map(async (el) => {
        const url  = decodeURIComponent(el.dataset.url);
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
export async function hydrateYouTubeMeta(container) {
    const cards = container.querySelectorAll('.yt-embed-card[data-url]');
    await Promise.all(Array.from(cards).map(async (el) => {
        const url = decodeURIComponent(el.dataset.url);
        const key = 'yt_' + urlToKey(url);
        let meta  = null;
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
