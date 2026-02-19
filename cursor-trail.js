/**
 * cursor-trail.js — Kuromi ASCII cursor trail
 * Symbols: ✦ ☆ · + ✦ ·
 *
 * Toggle on/off: window.CURSOR_TRAIL = true / false
 * Passive mousemove — does NOT interfere with existing listeners.
 */
window.CURSOR_TRAIL = true;

(function () {
    'use strict';

    var SYMBOLS = ['✦', '☆', '·', '+', '·', '✦', '☆'];
    var COLORS  = ['#e91e8c', '#c8a0e8', '#ffffff', '#ff69b4', '#a855f7', '#00c896'];
    var THROTTLE_MS = 38;   /* ~26 spawns/sec max */
    var lastSpawn = 0;

    /* Inject keyframes once */
    var styleEl = document.createElement('style');
    styleEl.textContent =
        '@keyframes _mkTrail {' +
        '  0%   { opacity:1;   transform: translateY(0)    scale(1);   }' +
        '  100% { opacity:0;   transform: translateY(-22px) scale(0.25); }' +
        '}';
    document.head.appendChild(styleEl);

    function spawn(x, y) {
        var el   = document.createElement('span');
        var sym  = SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];
        var col  = COLORS [Math.floor(Math.random() * COLORS.length)];
        var size = 10 + Math.floor(Math.random() * 9);   /* 10–18 px */
        var dx   = (Math.random() - 0.5) * 18;
        var dy   = (Math.random() - 0.5) * 12;
        var dur  = 700 + Math.floor(Math.random() * 400); /* 700–1100 ms */

        el.textContent  = sym;
        el.style.cssText =
            'position:fixed;' +
            'left:' + (x + dx) + 'px;' +
            'top:'  + (y + dy) + 'px;' +
            'color:' + col + ';' +
            'font-size:' + size + 'px;' +
            'pointer-events:none;' +
            'user-select:none;' +
            'z-index:99999;' +
            'animation:_mkTrail ' + dur + 'ms ease-out forwards;' +
            'font-family:serif;' +
            'line-height:1;';

        document.body.appendChild(el);
        setTimeout(function () { el.parentNode && el.parentNode.removeChild(el); }, dur);
    }

    document.addEventListener('mousemove', function (e) {
        if (!window.CURSOR_TRAIL) return;
        var now = Date.now();
        if (now - lastSpawn < THROTTLE_MS) return;
        lastSpawn = now;
        spawn(e.clientX, e.clientY);
    }, { passive: true });
}());
