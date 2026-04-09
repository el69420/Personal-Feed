import { ctx } from './ctx.js';

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

    // ---- Fireflies ----
    let fireflies = [], fireflyFrame = 0;
    const FIREFLY_COUNT = 60;

    function initFireflies() {
        const W = canvas.width, H = canvas.height;
        fireflyFrame = 0;
        fireflies = Array.from({ length: FIREFLY_COUNT }, () => ({
            x:         Math.random() * W,
            y:         Math.random() * H,
            vx:        (Math.random() - 0.5) * 0.4,
            vy:        (Math.random() - 0.5) * 0.3,
            pulsePhase: Math.random() * Math.PI * 2,
            pulseSpeed: 0.018 + Math.random() * 0.025,
            radius:    1.5 + Math.random() * 2,
            hue:       70 + Math.random() * 30,   // yellow-green
        }));
    }

    function drawFireflies() {
        if (!active) return;
        const W = canvas.width, H = canvas.height;
        fireflyFrame++;

        // Dark warm background
        ctx.fillStyle = 'rgba(4, 12, 2, 0.22)';
        ctx.fillRect(0, 0, W, H);

        for (const f of fireflies) {
            f.x += f.vx + Math.sin(fireflyFrame * 0.011 + f.pulsePhase) * 0.3;
            f.y += f.vy + Math.cos(fireflyFrame * 0.009 + f.pulsePhase * 1.3) * 0.2;
            if (f.x < -10) f.x = W + 10;
            if (f.x > W + 10) f.x = -10;
            if (f.y < -10) f.y = H + 10;
            if (f.y > H + 10) f.y = -10;

            const pulse = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(fireflyFrame * f.pulseSpeed + f.pulsePhase));
            const alpha = pulse;
            const r = f.radius * (0.8 + 0.4 * pulse);

            // Glow halo
            const grad = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, r * 5);
            grad.addColorStop(0, `hsla(${f.hue},90%,75%,${alpha * 0.55})`);
            grad.addColorStop(1, `hsla(${f.hue},90%,60%,0)`);
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(f.x, f.y, r * 5, 0, Math.PI * 2);
            ctx.fill();

            // Core dot
            ctx.globalAlpha = alpha;
            ctx.fillStyle = `hsl(${f.hue},95%,88%)`;
            ctx.beginPath();
            ctx.arc(f.x, f.y, r, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = 1;
        }
    }

    // ---- Still Moment (breathing — 4-7-8 technique) ----
    let breathStartTime = null;

    function initBreathing() {
        breathStartTime = null; // reset; will be set on first draw
    }

    function drawBreathing() {
        if (!active) return;
        const W = canvas.width, H = canvas.height;
        const now = performance.now();
        if (breathStartTime === null) breathStartTime = now;

        // 4-7-8 technique: exact wall-clock durations
        const INHALE_MS = 4000;
        const HOLD_MS   = 7000;
        const EXHALE_MS = 8000;
        const TOTAL_MS  = INHALE_MS + HOLD_MS + EXHALE_MS; // 19 000 ms

        const elapsed = (now - breathStartTime) % TOTAL_MS;

        // t: 0 = circle fully contracted, 1 = fully expanded
        let t, breathPhase, phaseElapsed, phaseDuration;
        if (elapsed < INHALE_MS) {
            breathPhase   = 'inhale';
            phaseElapsed  = elapsed;
            phaseDuration = INHALE_MS;
            const p = elapsed / INHALE_MS;
            // ease-in-out: gentle expansion
            t = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
        } else if (elapsed < INHALE_MS + HOLD_MS) {
            breathPhase   = 'hold';
            phaseElapsed  = elapsed - INHALE_MS;
            phaseDuration = HOLD_MS;
            t = 1; // stay fully expanded
        } else {
            breathPhase   = 'exhale';
            phaseElapsed  = elapsed - INHALE_MS - HOLD_MS;
            phaseDuration = EXHALE_MS;
            const p = phaseElapsed / EXHALE_MS;
            // ease-in: starts fast (forceful release), then slows
            t = 1 - p * p;
        }

        // Background: shifts from deep slate to soft blue-grey as circle expands
        const bgHue = 215 + t * 8;
        const bgLit = 12 + t * 6;
        ctx.fillStyle = `hsl(${bgHue},30%,${bgLit}%)`;
        ctx.fillRect(0, 0, W, H);

        const cx = W / 2, cy = H / 2;
        const minR = Math.min(W, H) * 0.08;
        const maxR = Math.min(W, H) * 0.22;
        const r = minR + (maxR - minR) * t;

        // Outer glow rings (stronger during hold)
        const glowBoost = breathPhase === 'hold' ? 1.4 : 1;
        for (let i = 3; i >= 1; i--) {
            const gr = r * (1 + i * 0.6);
            const ga = (0.06 / i) * t * glowBoost;
            const ring = ctx.createRadialGradient(cx, cy, r * 0.5, cx, cy, gr);
            ring.addColorStop(0, `rgba(160,200,240,${ga})`);
            ring.addColorStop(1, 'rgba(160,200,240,0)');
            ctx.fillStyle = ring;
            ctx.beginPath();
            ctx.arc(cx, cy, gr, 0, Math.PI * 2);
            ctx.fill();
        }

        // Main circle — slightly warmer hue during hold
        const circleHue = breathPhase === 'hold' ? 200 : 210;
        const grad = ctx.createRadialGradient(cx - r * 0.2, cy - r * 0.2, r * 0.1, cx, cy, r);
        grad.addColorStop(0, `hsla(${circleHue},60%,${60 + t * 20}%,${0.6 + t * 0.3})`);
        grad.addColorStop(1, `hsla(${circleHue + 10},50%,${35 + t * 15}%,${0.5 + t * 0.2})`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();

        // Instruction text — fades in/out over 333 ms at phase transitions
        const FADE_MS = 333;
        const labelAlpha = Math.min(phaseElapsed / FADE_MS, (phaseDuration - phaseElapsed) / FADE_MS, 1);

        let label, sublabel;
        if (breathPhase === 'inhale') {
            label    = 'inhale';
            sublabel = 'quietly through your nose';
        } else if (breathPhase === 'hold') {
            label    = 'hold';
            sublabel = '';
        } else {
            label    = 'exhale';
            sublabel = 'forcefully through your mouth';
        }

        const fontSize    = Math.round(Math.min(W, H) * 0.028);
        const subFontSize = Math.round(fontSize * 0.72);
        const textY       = cy + r + Math.min(W, H) * 0.07;

        ctx.textAlign = 'center';
        ctx.globalAlpha = labelAlpha * 0.9;
        ctx.fillStyle = 'rgba(200,220,240,1)';
        ctx.font = `${fontSize}px sans-serif`;
        ctx.fillText(label, cx, textY);

        if (sublabel) {
            ctx.globalAlpha = labelAlpha * 0.5;
            ctx.font = `${subFontSize}px sans-serif`;
            ctx.fillText(sublabel, cx, textY + fontSize * 1.35);
        }

        ctx.globalAlpha = 1;
        ctx.textAlign = 'left';
    }

    // ---- Snowfall ----
    let snowflakes = [], snowFrame = 0;
    const SNOW_COUNT = 120;

    function initSnow() {
        const W = canvas.width, H = canvas.height;
        snowFrame = 0;
        snowflakes = Array.from({ length: SNOW_COUNT }, () => ({
            x:        Math.random() * W,
            y:        Math.random() * H,
            r:        1 + Math.random() * 3.5,
            speed:    0.25 + Math.random() * 0.8,
            drift:    (Math.random() - 0.5) * 0.4,
            swayAmp:  0.3 + Math.random() * 0.8,
            swayFreq: 0.008 + Math.random() * 0.015,
            swayPhase: Math.random() * Math.PI * 2,
            alpha:    0.4 + Math.random() * 0.5,
        }));
    }

    function drawSnow() {
        if (!active) return;
        const W = canvas.width, H = canvas.height;
        snowFrame++;

        // Deep night-blue gradient background
        ctx.fillStyle = 'rgba(8, 18, 38, 0.25)';
        ctx.fillRect(0, 0, W, H);

        for (const s of snowflakes) {
            s.y += s.speed;
            s.x += s.drift + Math.sin(snowFrame * s.swayFreq + s.swayPhase) * s.swayAmp;
            if (s.y > H + s.r) { s.y = -s.r; s.x = Math.random() * W; }
            if (s.x > W + s.r) s.x = -s.r;
            if (s.x < -s.r) s.x = W + s.r;

            ctx.globalAlpha = s.alpha;
            ctx.fillStyle = '#d8eaff';
            ctx.beginPath();
            ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
    }

    // ---- Album Covers Screensaver ----
    const AC = { tiles: [], frame: 0 };
    const AC_FALLBACK_COLORS = ['#1a1a2e','#16213e','#0f3460','#533483','#1a2a1a','#2a1a1a','#0d1b2a','#2a1a2a'];

    function _applyCacheToTiles() {
        if (!ctx.acCache || !ctx.acCache.tracks.length || !AC.tiles.length) return;
        AC.tiles.forEach((tile, i) => {
            const td  = ctx.acCache.tracks[i % ctx.acCache.tracks.length];
            const img = ctx.acCache.images[i % ctx.acCache.images.length];
            tile.track  = td.track;
            tile.artist = td.artist;
            tile.img    = img;   // already loading / loaded
        });
    }

    function initAlbumCovers() {
        const W = canvas.width, H = canvas.height;
        AC.frame = 0;
        AC.tiles = [];
        const coverSize = 120, textH = 38, vGap = 16, hGap = 16;
        const tileH = coverSize + textH;
        const spacing = coverSize + hGap;
        const rows = Math.ceil(H / (tileH + vGap)) + 1;
        const cols = Math.ceil(W / spacing) + 3;
        let idx = 0;
        for (let row = 0; row < rows; row++) {
            const rowSpeed = 0.28 + (row % 3) * 0.11;
            const dir = row % 2 === 0 ? 1 : -1;
            for (let col = 0; col < cols; col++) {
                AC.tiles.push({
                    x:       col * spacing + (row % 2 === 0 ? 0 : spacing * 0.5),
                    y:       row * (tileH + vGap) + 10,
                    w:       coverSize,
                    coverH:  coverSize,
                    textH,
                    speed:   rowSpeed * dir,
                    spacing,
                    track:   '♪',
                    artist:  '',
                    img:     null,
                    color:   AC_FALLBACK_COLORS[idx++ % AC_FALLBACK_COLORS.length],
                });
            }
        }
        // Apply pre-loaded cache immediately so covers show from frame one
        _applyCacheToTiles();
        // Refresh cache in background (updates tiles once new images load)
        ctx.prefetchAlbumCovers().then(_applyCacheToTiles);
    }

    function drawAlbumCovers() {
        if (!active) return;
        const W = canvas.width, H = canvas.height;
        AC.frame++;
        // Lazy cache application: if data arrived after tiles were initialised, apply it now
        if (ctx.acCache && ctx.acCache.tracks.length && AC.tiles.some(t => !t.img)) _applyCacheToTiles();
        ctx.fillStyle = '#0d0d1a';
        ctx.fillRect(0, 0, W, H);

        for (const t of AC.tiles) {
            t.x += t.speed;
            const totalW = t.spacing * (Math.ceil(W / t.spacing) + 3);
            if (t.speed > 0 && t.x > W + t.w + 20) t.x -= totalW;
            if (t.speed < 0 && t.x < -t.w - 20)    t.x += totalW;

            // Shadow
            ctx.fillStyle = 'rgba(0,0,0,0.45)';
            ctx.fillRect(t.x + 3, t.y + 3, t.w, t.coverH);

            // Album cover image or fallback
            if (t.img && t.img.complete && t.img.naturalWidth > 0) {
                ctx.drawImage(t.img, t.x, t.y, t.w, t.coverH);
            } else {
                ctx.fillStyle = t.color;
                ctx.fillRect(t.x, t.y, t.w, t.coverH);
                ctx.fillStyle = 'rgba(255,255,255,0.12)';
                ctx.font = '38px sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText('♪', t.x + t.w / 2, t.y + t.coverH / 2);
            }

            // Label strip below cover
            ctx.fillStyle = 'rgba(0,0,0,0.72)';
            ctx.fillRect(t.x, t.y + t.coverH, t.w, t.textH);

            // Track name
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 10px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            let track = t.track;
            while (track.length > 1 && ctx.measureText(track).width > t.w - 8) track = track.slice(0, -1);
            if (track !== t.track) track = track.slice(0, -1) + '…';
            ctx.fillText(track, t.x + t.w / 2, t.y + t.coverH + 5);

            // Artist name
            ctx.fillStyle = 'rgba(255,255,255,0.55)';
            ctx.font = '9px sans-serif';
            let artist = t.artist;
            while (artist.length > 1 && ctx.measureText(artist).width > t.w - 8) artist = artist.slice(0, -1);
            if (artist !== t.artist) artist = artist.slice(0, -1) + '…';
            ctx.fillText(artist, t.x + t.w / 2, t.y + t.coverH + 20);
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
        else if (type === 'ss_feed_slideshow') initAlbumCovers();
        else if (type === 'ss_fireflies') initFireflies();
        else if (type === 'ss_breathing') initBreathing();
        else if (type === 'ss_snow') initSnow();
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
        else if (type === 'ss_feed_slideshow') currentDrawFn = drawAlbumCovers;
        else if (type === 'ss_fireflies') currentDrawFn = drawFireflies;
        else if (type === 'ss_breathing') currentDrawFn = drawBreathing;
        else if (type === 'ss_snow') currentDrawFn = drawSnow;
        else currentDrawFn = drawStarfield;
        overlay.classList.remove('is-hidden');
        if (!rmq.matches) {
            ctx.fillStyle = (type === 'ss_bubbles' || type === 'underwater') ? '#001628'
                          : type === 'ss_petals' ? '#120818'
                          : type === 'ss_fireflies' ? '#040c02'
                          : type === 'ss_breathing' ? '#111a22'
                          : type === 'ss_snow' ? '#081226'
                          : '#000';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            drawFrame();
        }
        // Track screensaver activation for Idle Dreamer achievement
        const ssTriggers = Number(localStorage.getItem('screensaverTriggeredCount') || 0) + 1;
        localStorage.setItem('screensaverTriggeredCount', String(ssTriggers));
        ctx.unlock('idle_dreamer');
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

