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

    // ---- Day / Night Cycle ----
    const DN_CLOUDS    = [];
    const DN_STARS     = [];
    const DN_MOON      = {};
    let   dnShootTimer = 0;
    let   dnShoot      = null;
    let   dnT          = 0;       // 0 = full day, 1 = full night
    let   dnLastUpdate = -9999;

    // Returns blend 0 (day) → 1 (night) based on local time using smooth transitions.
    function _getDayNightBlend() {
        const now = new Date();
        const m   = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
        const ss  = x => x * x * (3 - 2 * x);  // smoothstep
        // 0:00–4:59  night (1)
        // 5:00–6:59  dawn  (1 → 0)
        // 7:00–16:59 day   (0)
        // 17:00–19:59 dusk  (0 → 1)
        // 20:00–23:59 night (1)
        if (m < 300)  return 1;
        if (m < 420)  return 1 - ss((m - 300) / 120);
        if (m < 1020) return 0;
        if (m < 1200) return ss((m - 1020) / 180);
        return 1;
    }

    // Interpolate between three RGB triplets: a (t=0) → b (t=0.5) → c (t=1).
    function _dnLerp3(a, b, c, t) {
        const u = t <= 0.5 ? t * 2 : (t - 0.5) * 2;
        const s = t <= 0.5 ? a : b;
        const e = t <= 0.5 ? b : c;
        return [
            Math.round(s[0] + (e[0] - s[0]) * u),
            Math.round(s[1] + (e[1] - s[1]) * u),
            Math.round(s[2] + (e[2] - s[2]) * u),
        ];
    }

    function initDayNight() {
        const W = canvas.width, H = canvas.height;
        dnT          = _getDayNightBlend();
        dnLastUpdate = frame;

        DN_CLOUDS.length = 0;
        for (let i = 0; i < 7; i++) {
            DN_CLOUDS.push({
                x:     Math.random() * W,
                y:     50 + Math.random() * H * 0.42,
                speed: 0.10 + Math.random() * 0.22,
                scale: 0.5  + Math.random() * 0.80,
                alpha: 0.65 + Math.random() * 0.30,
            });
        }

        DN_STARS.length = 0;
        for (let i = 0; i < 200; i++) {
            DN_STARS.push({
                x:          Math.random() * W,
                y:          Math.random() * H * 0.88,
                size:       0.4 + Math.random() * 1.5,
                phase:      Math.random() * Math.PI * 2,
                freq:       0.5 + Math.random() * 1.5,
                brightness: 0.4 + Math.random() * 0.6,
            });
        }

        DN_MOON.x = W * 0.76;
        DN_MOON.y = H * 0.15;
        DN_MOON.r = 20;
        dnShootTimer = 0;
        dnShoot      = null;
    }

    function animateDayNight() {
        const W = canvas.width, H = canvas.height;
        const t = frame / 60;

        // Resample time blend roughly every 5 s (300 frames at 60 fps).
        if (frame - dnLastUpdate > 300) {
            dnT          = _getDayNightBlend();
            dnLastUpdate = frame;
        }

        // Sky colour keyframes: day → dusk → night
        const DAY_TOP   = [74,  159, 214], DUSK_TOP   = [42,  30,  80], NIGHT_TOP   = [0,  5,  16];
        const DAY_MID   = [135, 206, 235], DUSK_MID   = [200, 75,  24], NIGHT_MID   = [0,  12, 40];
        const DAY_BOT   = [200, 232, 248], DUSK_BOT   = [245, 140, 60], NIGHT_BOT   = [0,  20, 64];
        const skyTop = _dnLerp3(DAY_TOP, DUSK_TOP, NIGHT_TOP, dnT);
        const skyMid = _dnLerp3(DAY_MID, DUSK_MID, NIGHT_MID, dnT);
        const skyBot = _dnLerp3(DAY_BOT, DUSK_BOT, NIGHT_BOT, dnT);

        const sky = ctx.createLinearGradient(0, 0, 0, H);
        sky.addColorStop(0,   `rgb(${skyTop.join(',')})`);
        sky.addColorStop(0.5, `rgb(${skyMid.join(',')})`);
        sky.addColorStop(1,   `rgb(${skyBot.join(',')})`);
        ctx.fillStyle = sky;
        ctx.fillRect(0, 0, W, H);

        // ---- Sun (visible during day; fades with dnT) ----
        const sunAlpha = Math.max(0, 1 - dnT / 0.55);
        if (sunAlpha > 0) {
            const hr      = new Date().getHours() + new Date().getMinutes() / 60;
            const sunNorm = Math.max(0, Math.min(1, (hr - 6) / 12)); // 0 at 6am, 1 at 6pm
            const sunX    = W * (0.10 + sunNorm * 0.80);
            const sunY    = H * (0.14 + Math.abs(sunNorm - 0.5) * 0.38); // arc peak at noon
            const sunR    = 22;

            const glow = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, sunR * 5);
            glow.addColorStop(0,   `rgba(255,220,80,${(sunAlpha * 0.35).toFixed(3)})`);
            glow.addColorStop(0.4, `rgba(255,180,40,${(sunAlpha * 0.15).toFixed(3)})`);
            glow.addColorStop(1,   'transparent');
            ctx.fillStyle = glow;
            ctx.fillRect(sunX - sunR * 5, sunY - sunR * 5, sunR * 10, sunR * 10);

            ctx.save();
            ctx.globalAlpha = sunAlpha;
            ctx.fillStyle   = '#fff5a0';
            ctx.beginPath(); ctx.arc(sunX, sunY, sunR,        0, Math.PI * 2); ctx.fill();
            ctx.fillStyle   = '#ffe040';
            ctx.beginPath(); ctx.arc(sunX, sunY, sunR * 0.75, 0, Math.PI * 2); ctx.fill();
            ctx.restore();
        }

        // ---- Clouds (day only; fade and warm-tint as dusk approaches) ----
        const cloudAlpha = Math.max(0, 1 - dnT * 2.2);
        if (cloudAlpha > 0) {
            for (const c of DN_CLOUDS) {
                c.x += c.speed;
                if (c.x - 80 * c.scale > W) c.x = -120 * c.scale;
                ctx.save();
                ctx.globalAlpha = c.alpha * cloudAlpha;
                const cr = Math.round(255);
                const cg = Math.round(255 * (1 - dnT * 0.45));
                const cb = Math.round(255 * (1 - dnT * 0.70));
                ctx.fillStyle   = `rgb(${cr},${cg},${cb})`;
                ctx.shadowBlur  = 16;
                ctx.shadowColor = dnT > 0.08 ? 'rgba(255,140,60,0.4)' : 'rgba(200,230,255,0.5)';
                _drawCloudShape(c.x, c.y, c.scale);
                ctx.restore();
            }
        }

        // ---- Moon (fades in from mid-transition) ----
        const moonAlpha = Math.max(0, (dnT - 0.35) / 0.65);
        if (moonAlpha > 0) {
            const mx = DN_MOON.x, my = DN_MOON.y, mr = DN_MOON.r;
            const glow2 = ctx.createRadialGradient(mx, my, 0, mx, my, mr * 3.5);
            glow2.addColorStop(0,   `rgba(220,220,170,${(moonAlpha * 0.28).toFixed(3)})`);
            glow2.addColorStop(1,   'transparent');
            ctx.fillStyle = glow2;
            ctx.fillRect(mx - mr * 4, my - mr * 4, mr * 8, mr * 8);
            ctx.save();
            ctx.globalAlpha = moonAlpha;
            ctx.fillStyle   = '#f0f0d8';
            ctx.beginPath(); ctx.arc(mx, my, mr, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = `rgb(${skyTop.join(',')})`;  // crescent shadow matches sky
            ctx.beginPath(); ctx.arc(mx + 7, my - 3, mr * 0.82, 0, Math.PI * 2); ctx.fill();
            ctx.restore();
        }

        // ---- Stars (fade in as night deepens) ----
        const starAlpha = Math.max(0, (dnT - 0.40) / 0.60);
        if (starAlpha > 0) {
            for (const s of DN_STARS) {
                const twinkle = 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(t * s.freq + s.phase));
                ctx.save();
                ctx.globalAlpha = twinkle * s.brightness * starAlpha;
                ctx.fillStyle   = '#ffffff';
                ctx.beginPath(); ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2); ctx.fill();
                if (s.size > 1.2 && starAlpha > 0.5) {
                    ctx.globalAlpha = twinkle * s.brightness * starAlpha * 0.35;
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

            // Occasional shooting star (night only)
            dnShootTimer--;
            if (dnShootTimer <= 0) {
                dnShootTimer = 200 + Math.floor(Math.random() * 350);
                dnShoot = {
                    x: Math.random() * W * 0.7, y: Math.random() * H * 0.4,
                    vx: 3 + Math.random() * 3,  vy: 1 + Math.random() * 1.5, life: 40,
                };
            }
            if (dnShoot && dnShoot.life > 0) {
                ctx.save();
                ctx.globalAlpha = (dnShoot.life / 40) * 0.85 * starAlpha;
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth   = 1.2;
                ctx.beginPath();
                ctx.moveTo(dnShoot.x, dnShoot.y);
                ctx.lineTo(dnShoot.x - dnShoot.vx * 6, dnShoot.y - dnShoot.vy * 6);
                ctx.stroke();
                ctx.restore();
                dnShoot.x += dnShoot.vx;
                dnShoot.y += dnShoot.vy;
                dnShoot.life--;
            }
        }
    }

    // ---- Cozy Rain ----
    const RAIN_DROPS  = [];
    const COND_DROPS  = [];  // condensation drops on glass

    function initCozyRain() {
        const W = canvas.width, H = canvas.height;
        RAIN_DROPS.length = 0;
        COND_DROPS.length = 0;

        for (let i = 0; i < 130; i++) {
            RAIN_DROPS.push({
                x:     Math.random() * (W + 120) - 60,
                y:     Math.random() * H * 1.5 - H * 0.5,
                speed: 5 + Math.random() * 7,
                len:   12 + Math.random() * 24,
                alpha: 0.12 + Math.random() * 0.30,
                dx:    -(0.35 + Math.random() * 0.30),  // slight wind angle
            });
        }

        for (let i = 0; i < 20; i++) {
            COND_DROPS.push({
                xr:   0.04 + Math.random() * 0.92,  // relative x
                yr:   0.05 + Math.random() * 0.80,  // relative y
                r:    2.5 + Math.random() * 5,
                vy:   0.0015 + Math.random() * 0.0035,
                alpha: 0.25 + Math.random() * 0.35,
            });
        }
    }

    function animateCozyRain() {
        const W = canvas.width, H = canvas.height;

        // Clear to transparent — background comes from the desktop CSS gradient
        ctx.clearRect(0, 0, W, H);

        // Warm candlelight glow emanating from below
        const warmGlow = ctx.createRadialGradient(W * 0.5, H * 1.05, 0, W * 0.5, H * 0.65, W * 0.72);
        warmGlow.addColorStop(0,    'rgba(210, 145, 35, 0.28)');
        warmGlow.addColorStop(0.40, 'rgba(170, 95, 20, 0.13)');
        warmGlow.addColorStop(1,    'transparent');
        ctx.fillStyle = warmGlow;
        ctx.fillRect(0, H * 0.25, W, H * 0.75);

        // Rain streaks
        for (const d of RAIN_DROPS) {
            d.x += d.dx;
            d.y += d.speed;
            if (d.y > H + 30) {
                d.y = -d.len - Math.random() * 80;
                d.x = Math.random() * (W + 120) - 60;
            }
            if (d.x < -30) d.x = W + Math.random() * 60;

            ctx.save();
            ctx.globalAlpha  = d.alpha;
            ctx.strokeStyle  = '#9bbcd8';
            ctx.lineWidth    = 1;
            ctx.lineCap      = 'round';
            ctx.beginPath();
            ctx.moveTo(d.x, d.y);
            ctx.lineTo(d.x - d.dx * (d.len / d.speed), d.y - d.len);
            ctx.stroke();
            ctx.restore();
        }

        // Condensation drops sliding slowly down the glass
        for (const cd of COND_DROPS) {
            cd.yr += cd.vy;
            if (cd.yr > 0.96) { cd.yr = 0.04 + Math.random() * 0.12; cd.xr = 0.04 + Math.random() * 0.92; }

            const gx = cd.xr * W, gy = cd.yr * H;
            ctx.save();
            ctx.globalAlpha = cd.alpha;
            const dg = ctx.createRadialGradient(gx - cd.r * 0.2, gy - cd.r * 0.35, 0, gx, gy, cd.r);
            dg.addColorStop(0,   'rgba(210, 230, 255, 0.85)');
            dg.addColorStop(0.7, 'rgba(150, 185, 230, 0.30)');
            dg.addColorStop(1,   'rgba(120, 160, 210, 0.05)');
            ctx.fillStyle = dg;
            ctx.beginPath();
            ctx.ellipse(gx, gy, cd.r * 0.65, cd.r, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
    }

    // ---- Wildflower Meadow ----
    const WILDFLOWERS = [];

    function initWildflowerMeadow() {
        const W = canvas.width, H = canvas.height;
        WILDFLOWERS.length = 0;

        const flowerColors = [
            { petals: '#ff8fc0', center: '#ffe050' },
            { petals: '#ffffff', center: '#ffe050' },
            { petals: '#c8a0ff', center: '#ffe050' },
            { petals: '#ffcc30', center: '#ff8800' },
            { petals: '#ff6060', center: '#8b0000' },
            { petals: '#7ec8e3', center: '#ffffff' },
            { petals: '#ff9966', center: '#ff5500' },
        ];

        const horizonY = H * 0.55;
        const count = Math.max(35, Math.round(W / 20));
        for (let i = 0; i < count; i++) {
            const xr     = (i + 0.5 + (Math.random() - 0.5) * 0.8) / count;
            const depthR = Math.random();
            const y      = horizonY + depthR * (H - horizonY) * 0.78;
            const height = 16 + depthR * 30 + Math.random() * 14;
            const color  = flowerColors[Math.floor(Math.random() * flowerColors.length)];
            const type   = Math.random() < 0.3 ? 'daisy' : (Math.random() < 0.5 ? 'simple' : 'tiny');
            WILDFLOWERS.push({
                x:      xr * W,
                y,
                height,
                phase:  Math.random() * Math.PI * 2,
                freq:   0.32 + Math.random() * 0.28,
                amp:    0.015 + Math.random() * 0.012,
                color,
                type,
                depth:  depthR,
                petalR: 3 + depthR * 5 + Math.random() * 2,
            });
        }
        WILDFLOWERS.sort((a, b) => a.depth - b.depth);
    }

    function _drawWildflower(f, t) {
        const sway  = Math.sin(t * f.freq + f.phase) * f.amp;
        const baseX = f.x, baseY = f.y;
        const tipX  = baseX + Math.sin(sway) * f.height;
        const tipY  = baseY - f.height;
        const midX  = baseX + (tipX - baseX) * 0.5 + Math.sin(sway * 0.5) * f.height * 0.14;
        const midY  = baseY + (tipY - baseY) * 0.5;
        const pr    = f.petalR;

        ctx.save();
        ctx.strokeStyle = '#4a8c2a';
        ctx.lineWidth   = 1.0 + f.depth * 0.8;
        ctx.lineCap     = 'round';
        ctx.beginPath();
        ctx.moveTo(baseX, baseY);
        ctx.quadraticCurveTo(midX, midY, tipX, tipY);
        ctx.stroke();

        if (f.type === 'tiny') {
            ctx.fillStyle = f.color.petals;
            ctx.beginPath();
            ctx.arc(tipX, tipY, pr * 0.7, 0, Math.PI * 2);
            ctx.fill();
        } else if (f.type === 'simple') {
            ctx.fillStyle = f.color.petals;
            for (let p = 0; p < 5; p++) {
                const angle = (p / 5) * Math.PI * 2 + sway * 0.5;
                ctx.beginPath();
                ctx.ellipse(tipX + Math.cos(angle) * pr, tipY + Math.sin(angle) * pr,
                            pr * 0.55, pr * 0.40, angle, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.fillStyle = f.color.center;
            ctx.beginPath();
            ctx.arc(tipX, tipY, pr * 0.38, 0, Math.PI * 2);
            ctx.fill();
        } else {
            ctx.fillStyle = f.color.petals;
            for (let p = 0; p < 8; p++) {
                const angle = (p / 8) * Math.PI * 2 + sway * 0.5;
                ctx.beginPath();
                ctx.ellipse(tipX + Math.cos(angle) * pr * 1.1, tipY + Math.sin(angle) * pr * 1.1,
                            pr * 0.32, pr * 0.52, angle, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.fillStyle = f.color.center;
            ctx.beginPath();
            ctx.arc(tipX, tipY, pr * 0.42, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    }

    function animateWildflowerMeadow() {
        const W = canvas.width, H = canvas.height;
        const t = frame / 60;
        const horizonY = H * 0.55;

        // Sky
        const sky = ctx.createLinearGradient(0, 0, 0, horizonY);
        sky.addColorStop(0,   '#87ceeb');
        sky.addColorStop(0.6, '#b8e0f7');
        sky.addColorStop(1,   '#d4efb0');
        ctx.fillStyle = sky;
        ctx.fillRect(0, 0, W, horizonY);

        // Sun
        const sunX = W * 0.75, sunY = H * 0.12, sunR = 18;
        const glow = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, sunR * 5);
        glow.addColorStop(0,   'rgba(255,230,100,0.40)');
        glow.addColorStop(0.4, 'rgba(255,210,60,0.15)');
        glow.addColorStop(1,   'transparent');
        ctx.fillStyle = glow;
        ctx.fillRect(sunX - sunR * 5, sunY - sunR * 5, sunR * 10, sunR * 10);
        ctx.fillStyle = '#fffacc';
        ctx.beginPath(); ctx.arc(sunX, sunY, sunR,        0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fff5a0';
        ctx.beginPath(); ctx.arc(sunX, sunY, sunR * 0.70, 0, Math.PI * 2); ctx.fill();

        // Ground
        const ground = ctx.createLinearGradient(0, horizonY, 0, H);
        ground.addColorStop(0,   '#a8c870');
        ground.addColorStop(0.3, '#7aab3a');
        ground.addColorStop(0.7, '#5a8f20');
        ground.addColorStop(1,   '#3d6f10');
        ctx.fillStyle = ground;
        ctx.fillRect(0, horizonY, W, H - horizonY);

        // Horizon blend
        const blend = ctx.createLinearGradient(0, horizonY - 20, 0, horizonY + 40);
        blend.addColorStop(0,   'rgba(168,200,112,0)');
        blend.addColorStop(0.5, 'rgba(168,200,112,0.65)');
        blend.addColorStop(1,   'rgba(122,171,58,0)');
        ctx.fillStyle = blend;
        ctx.fillRect(0, horizonY - 20, W, 60);

        // Wildflowers (back → front)
        for (const f of WILDFLOWERS) {
            _drawWildflower(f, t);
        }

        // Foreground grass blades
        const grassCount = Math.round(W / 6);
        for (let i = 0; i < grassCount; i++) {
            const gx   = (i / grassCount) * W + Math.sin(i * 1.7) * 3;
            const gh   = 10 + Math.sin(i * 2.3) * 6;
            const gswy = Math.sin(t * 0.8 + i * 0.35) * 0.08;
            ctx.save();
            ctx.strokeStyle = i % 3 === 0 ? '#3d6f10' : '#5a8f20';
            ctx.lineWidth   = 1.2;
            ctx.lineCap     = 'round';
            ctx.beginPath();
            ctx.moveTo(gx, H);
            ctx.quadraticCurveTo(
                gx + Math.sin(gswy) * gh,
                H - gh * 0.6,
                gx + Math.sin(gswy) * gh * 1.5,
                H - gh
            );
            ctx.stroke();
            ctx.restore();
        }
    }

    // ---- Core animation loop ----
    function tick() {
        if (!activeId) return;
        frame++;
        if      (activeId === 'wp_anim_clouds')   animateClouds();
        else if (activeId === 'wp_anim_forest')   animateForest();
        else if (activeId === 'wp_anim_nightsky') animateNightSky();
        else if (activeId === 'wp_anim_daynight') animateDayNight();
        else if (activeId === 'wp_cozy_rain')     animateCozyRain();
        else if (activeId === 'wp_meadow')        animateWildflowerMeadow();
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
        else if (id === 'wp_anim_daynight') initDayNight();
        else if (id === 'wp_cozy_rain')     initCozyRain();
        else if (id === 'wp_meadow')        initWildflowerMeadow();
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
        else if (activeId === 'wp_anim_daynight') initDayNight();
        else if (activeId === 'wp_cozy_rain')     initCozyRain();
        else if (activeId === 'wp_meadow')        initWildflowerMeadow();
    });

    window._animWallpaper = { start, stop };
})();


