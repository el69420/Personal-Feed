import { database, ref, push, onValue, set, update, remove, get, runTransaction } from './firebase.js';
import { w95Mgr, w95Apps, w95Layout, makeDraggable } from './window-manager.js';
import { ctx } from './ctx.js';
import { launchConfetti } from './confetti.js';

(() => {
    const BS = 10; // grid size
    const SHIPS = [
        { id: 'carrier',    name: 'Carrier',    size: 5 },
        { id: 'battleship', name: 'Battleship', size: 4 },
        { id: 'cruiser',    name: 'Cruiser',    size: 3 },
        { id: 'submarine',  name: 'Submarine',  size: 3 },
        { id: 'destroyer',  name: 'Destroyer',  size: 2 },
    ];

    const win          = document.getElementById('w95-win-battleships');
    const statusEl     = document.getElementById('bs-status');
    const logEl        = document.getElementById('bs-log');
    const myGridEl     = document.getElementById('bs-my-grid');
    const enemyGridEl  = document.getElementById('bs-enemy-grid');
    const shipsPanelEl = document.getElementById('bs-ships-panel');
    const readyBtn     = document.getElementById('bs-ready-btn');
    const resetBtn     = document.getElementById('bs-reset-btn');
    const rotateBtn    = document.getElementById('bs-rotate-btn');
    const modeSelect   = document.getElementById('bs-mode-select');
    const rematchBtn   = document.getElementById('bs-rematch-btn');
    const minBtn       = document.getElementById('w95-battleships-min');
    const maxBtn       = document.getElementById('w95-battleships-max');
    const closeBtn     = document.getElementById('w95-battleships-close');
    const handle       = document.getElementById('w95-battleships-handle');

    if (!win || !handle) return;

    const bsRef       = ref(database, 'battleships');
    const bsScoresRef = ref(database, 'battleships_scores');
    let taskbarBtn = null;

    // ---- state ----
    let gameMode  = 'ai';
    let phase     = 'setup'; // 'setup' | 'playing' | 'over'
    let gameOver  = false;
    let myTurn    = false;
    let myShips   = [];      // { id, name, size, row, col, horizontal }
    let enemyShips = [];     // opponent's ships (AI placement or from Firebase)
    let myShots      = new Set(); // "r,c" of cells I fired on
    let shotResults  = {};        // "r,c" → { hit, sunkShipId }
    let incomingShots = new Set(); // "r,c" of shots fired at me
    let placingIdx = 0;
    let horizontal = true;
    let hoverRC    = null; // { r, c } during placement hover
    let aiShots    = new Set();
    let aiTargets  = []; // probe stack after a hit
    let bsUnsub    = null;
    let onlineResultDone = false;
    let bsScoresCache    = null;
    let loggedShotsCount = 0;
    let _statusTimer     = null;

    // ---- helpers ----
    function key(r, c) { return r + ',' + c; }

    function shipCells(s) {
        const cells = [];
        for (let i = 0; i < s.size; i++)
            cells.push(s.horizontal ? { r: s.row, c: s.col + i } : { r: s.row + i, c: s.col });
        return cells;
    }

    function canPlace(fleet, size, row, col, horiz) {
        for (let i = 0; i < size; i++) {
            const r = horiz ? row : row + i;
            const c = horiz ? col + i : col;
            if (r < 0 || r >= BS || c < 0 || c >= BS) return false;
            if (fleet.some(s => shipCells(s).some(sc => sc.r === r && sc.c === c))) return false;
        }
        return true;
    }

    function shipAt(fleet, r, c) {
        return fleet.find(s => shipCells(s).some(sc => sc.r === r && sc.c === c)) || null;
    }

    function isSunk(ship, shots) {
        return shipCells(ship).every(sc => shots.has(key(sc.r, sc.c)));
    }

    function allSunk(fleet, shots) {
        return fleet.length > 0 && fleet.every(s => isSunk(s, shots));
    }

    // ---- random fleet for AI ----
    function randomFleet() {
        const fleet = [];
        for (const s of SHIPS) {
            let ok = false, tries = 0;
            while (!ok && tries++ < 300) {
                const horiz = Math.random() < 0.5;
                const r = Math.floor(Math.random() * BS);
                const c = Math.floor(Math.random() * BS);
                if (canPlace(fleet, s.size, r, c, horiz)) {
                    fleet.push({ ...s, row: r, col: c, horizontal: horiz });
                    ok = true;
                }
            }
        }
        return fleet;
    }

    // ---- init ----
    function initGame(forceNew = false) {
        if (bsUnsub) { bsUnsub(); bsUnsub = null; }
        gameMode = modeSelect ? modeSelect.value : 'ai';
        clearTimeout(_statusTimer);
        if (rematchBtn) rematchBtn.style.display = 'none';

        if (!forceNew && ctx.getUser()) {
            if (gameMode === 'online') {
                (async () => { if (!(await tryRestoreOnlineBS())) startFreshBS(); })();
                return;
            }
            if (gameMode === 'ai') {
                (async () => { if (!(await tryRestoreAIBS())) startFreshBS(); })();
                return;
            }
        }
        startFreshBS();
    }

    function startFreshBS() {
        phase     = 'setup';
        gameOver  = false;
        myTurn    = false;
        myShips   = [];
        enemyShips = [];
        myShots      = new Set();
        shotResults  = {};
        incomingShots = new Set();
        placingIdx = 0;
        horizontal = true;
        hoverRC    = null;
        aiShots    = new Set();
        aiTargets  = [];
        onlineResultDone = false;
        loggedShotsCount = 0;
        if (logEl) logEl.innerHTML = '';

        if (gameMode === 'ai') {
            enemyShips = randomFleet();
        } else {
            if (!ctx.getUser()) { statusEl.textContent = 'Sign in to play online'; renderAll(); return; }
            const gameId = Date.now().toString(36);
            localStorage.setItem('bs_online_gid', gameId);
            set(bsRef, {
                phase: 'setup', turn: 'El', winner: null,
                ready: { El: false, Tero: false },
                ElShips: null, TeroShips: null, shots: null, gameId,
            });
            set(ref(database, 'battleships_invite'), { from: ctx.getUser(), ts: Date.now() });
            bsUnsub = onValue(bsRef, onBsSnapshot);
        }
        renderAll();
        updateStatus();
    }

    async function tryRestoreOnlineBS() {
        try {
            const snap = await get(bsRef);
            const data = snap.val();
            if (!data || data.phase === 'over') return false;
            const savedGid = localStorage.getItem('bs_online_gid');
            if (savedGid && data.gameId && savedGid !== data.gameId) return false;
            loggedShotsCount = 0;
            bsUnsub = onValue(bsRef, onBsSnapshot);
            return true;
        } catch(e) { return false; }
    }

    async function tryRestoreAIBS() {
        if (!ctx.getUser()) return false;
        try {
            const snap = await get(ref(database, 'battleships_ai/' + ctx.getUser()));
            const data = snap.val();
            if (!data || data.phase === 'over') return false;
            if (Date.now() - (data.ts || 0) > 48 * 3600000) return false;

            phase        = data.phase;
            myTurn       = data.myTurn;
            myShips      = data.myShips || [];
            enemyShips   = data.enemyShips || [];
            myShots      = new Set(data.myShots || []);
            shotResults  = data.shotResults || {};
            incomingShots = new Set(data.incomingShots || []);
            aiShots      = new Set(data.aiShots || []);
            aiTargets    = data.aiTargets || [];
            placingIdx   = myShips.length;
            horizontal   = true;
            hoverRC      = null;
            gameOver     = false;
            onlineResultDone = false;
            loggedShotsCount = 0;
            if (logEl) logEl.innerHTML = '';

            renderAll();
            updateStatus();
            return true;
        } catch(e) { return false; }
    }

    function saveBSAIGame() {
        if (!ctx.getUser() || gameMode !== 'ai') return;
        set(ref(database, 'battleships_ai/' + ctx.getUser()), {
            phase, myTurn,
            myShips,
            enemyShips,
            myShots: [...myShots],
            shotResults,
            incomingShots: [...incomingShots],
            aiShots: [...aiShots],
            aiTargets,
            ts: Date.now(),
        }).catch(() => {});
    }

    // ---- placement ----
    function previewCells(r, c) {
        const s = SHIPS[placingIdx];
        if (!s) return [];
        const cells = [];
        for (let i = 0; i < s.size; i++)
            cells.push(horizontal ? { r, c: c + i } : { r: r + i, c });
        return cells;
    }

    function onMyGridClick(r, c) {
        if (phase !== 'setup') return;
        const s = SHIPS[placingIdx];
        if (!s || !canPlace(myShips, s.size, r, c, horizontal)) return;
        myShips.push({ ...s, row: r, col: c, horizontal });
        placingIdx++;
        hoverRC = null;
        renderAll();
        updateStatus();
    }

    function toggleOrientation() {
        horizontal = !horizontal;
        updateHoverPreview();
        updateStatus();
    }

    // ---- shooting (AI mode) ----
    function onEnemyGridClick(r, c) {
        if (phase !== 'playing' || !myTurn || gameOver) return;
        const k = key(r, c);
        if (myShots.has(k)) return;

        myShots.add(k);
        const hitShip = shipAt(enemyShips, r, c);
        const hit = !!hitShip;
        const sunk = hit && isSunk(hitShip, myShots);
        shotResults[k] = { hit, sunkShipId: sunk ? hitShip.id : null };
        renderEnemyGrid();

        if (allSunk(enemyShips, myShots)) { endGame(true); return; }

        if (sunk) {
            setStatus(`You sank their ${hitShip.name}! \uD83D\uDCA5`);
            addLog(`You sank their ${hitShip.name}!`, 'sunk');
        } else if (hit) {
            setStatus('Hit! \uD83D\uDD25');
            addLog('You hit!', 'hit');
        } else {
            setStatus('Miss! \uD83D\uDCA7');
            addLog('You missed.', 'miss');
        }
        myTurn = false;
        saveBSAIGame();
        setTimeout(doAIShot, 850);
    }

    // ---- AI shooting ----
    function doAIShot() {
        if (gameOver) return;
        const [r, c] = getAITarget();
        const k = key(r, c);
        aiShots.add(k);
        incomingShots.add(k);

        const hitShip = shipAt(myShips, r, c);
        if (hitShip) {
            if (isSunk(hitShip, aiShots)) {
                // clear probes for this ship
                const sunkKeys = new Set(shipCells(hitShip).map(sc => key(sc.r, sc.c)));
                aiTargets = aiTargets.filter(t => !sunkKeys.has(key(t.r, t.c)));
                setStatus(`AI sank your ${hitShip.name}!`);
                addLog(`AI sank your ${hitShip.name}!`, 'sunk');
            } else {
                for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
                    const nr = r+dr, nc = c+dc;
                    if (nr>=0 && nr<BS && nc>=0 && nc<BS && !aiShots.has(key(nr, nc)))
                        aiTargets.push({ r: nr, c: nc });
                }
                setStatus('AI hit your ship! \uD83D\uDD25');
                addLog('AI hit your ship!', 'hit');
            }
        } else {
            setStatus('AI missed!');
            addLog('AI missed.', 'miss');
        }

        renderMyGrid();
        if (allSunk(myShips, aiShots)) { endGame(false); return; }
        myTurn = true;
        saveBSAIGame();
        setTimeout(() => { updateStatus(); renderEnemyGrid(); }, 600);
    }

    function getAITarget() {
        while (aiTargets.length > 0) {
            const t = aiTargets.pop();
            if (!aiShots.has(key(t.r, t.c))) return [t.r, t.c];
        }
        // Checkerboard hunt (never misses a ship of size ≥ 2)
        const pool = [];
        for (let r = 0; r < BS; r++)
            for (let c = 0; c < BS; c++)
                if (!aiShots.has(key(r, c)) && (r+c) % 2 === 0) pool.push([r, c]);
        if (pool.length === 0)
            for (let r = 0; r < BS; r++)
                for (let c = 0; c < BS; c++)
                    if (!aiShots.has(key(r, c))) pool.push([r, c]);
        return pool[Math.floor(Math.random() * pool.length)];
    }

    // ---- end game ----
    function endGame(won) {
        phase = 'over'; gameOver = true; myTurn = false;
        statusEl.textContent = won
            ? 'Victory! All enemy ships sunk! \uD83C\uDF89'
            : 'Defeat! Your fleet is destroyed! \uD83D\uDC80';
        clearTimeout(_statusTimer);
        if (won) launchConfetti();
        if (rematchBtn) rematchBtn.style.display = '';
        if (gameMode === 'ai') saveBSAIGame();
        renderAll();
    }

    // ---- online ----
    function onBsSnapshot(snap) {
        const data = snap.val();
        if (!data || !ctx.getUser()) return;

        // Handle rematch: when both players accepted, reset for a new game
        if (data.rematch?.El && data.rematch?.Tero) {
            onlineResultDone = false;
            loggedShotsCount = 0;
            if (logEl) logEl.innerHTML = '';
            if (rematchBtn) rematchBtn.style.display = 'none';
            myShips = []; enemyShips = []; placingIdx = 0;
            if (ctx.getUser() === 'El') {
                const newGid = Date.now().toString(36);
                localStorage.setItem('bs_online_gid', newGid);
                set(bsRef, {
                    phase: 'setup', turn: 'El', winner: null,
                    ready: { El: false, Tero: false },
                    ElShips: null, TeroShips: null, shots: null, gameId: newGid,
                });
            }
            return;
        }

        phase  = data.phase || 'setup';
        myTurn = data.turn === ctx.getUser();
        const other = ctx.getUser() === 'El' ? 'Tero' : 'El';

        // Load opponent's ships (used for hit evaluation by this browser)
        if (data[other + 'Ships']) enemyShips = data[other + 'Ships'];
        // Restore own ships if re-joining mid-game
        if (data[ctx.getUser() + 'Ships'] && myShips.length === 0) {
            myShips = data[ctx.getUser() + 'Ships'];
            placingIdx = SHIPS.length;
        }

        // Rebuild shot state from Firebase ground truth (sort by push-key for order)
        myShots       = new Set();
        shotResults   = {};
        incomingShots = new Set();
        const shotsArr = data.shots
            ? Object.entries(data.shots).sort(([a], [b]) => a < b ? -1 : 1).map(([, v]) => v)
            : [];
        for (const s of shotsArr) {
            const k = key(s.row, s.col);
            if (s.by === ctx.getUser()) {
                myShots.add(k);
                shotResults[k] = { hit: s.hit, sunkShipId: s.sunkShipId || null };
            } else {
                incomingShots.add(k);
            }
        }

        // Log only shots we haven't seen yet
        const newShots = shotsArr.slice(loggedShotsCount);
        loggedShotsCount = shotsArr.length;
        for (const s of newShots) {
            if (s.by === ctx.getUser()) {
                if (s.sunkShipId) {
                    const ship = SHIPS.find(sh => sh.id === s.sunkShipId);
                    addLog(`You sank their ${ship ? ship.name : s.sunkShipId}!`, 'sunk');
                } else if (s.hit) {
                    addLog('You hit!', 'hit');
                } else {
                    addLog('You missed.', 'miss');
                }
            } else {
                if (s.sunkShipId) {
                    const ship = SHIPS.find(sh => sh.id === s.sunkShipId);
                    addLog(`${other} sank your ${ship ? ship.name : s.sunkShipId}!`, 'sunk');
                } else if (s.hit) {
                    addLog(`${other} hit your ship!`, 'hit');
                } else {
                    addLog(`${other} missed.`, 'miss');
                }
            }
        }

        if (data.phase === 'over' && !onlineResultDone) {
            onlineResultDone = true;
            gameOver = true; myTurn = false;
            clearTimeout(_statusTimer);
            if (data.winner === ctx.getUser()) {
                statusEl.textContent = 'Victory! \uD83C\uDF89';
                launchConfetti();
                runTransaction(ref(database, 'battleships_scores/' + ctx.getUser()), cur => {
                    const d = cur || { wins: 0 };
                    d.wins = (d.wins || 0) + 1;
                    return d;
                });
            } else {
                statusEl.textContent = 'Defeat! \uD83D\uDC80';
            }
            if (rematchBtn) {
                rematchBtn.style.display = '';
                const myRematch = data.rematch?.[ctx.getUser()];
                rematchBtn.textContent = myRematch ? 'Rematch (waiting\u2026)' : 'Rematch';
                rematchBtn.disabled = !!myRematch;
            }
        } else if (data.phase !== 'over') {
            updateStatus();
        }

        renderAll();
    }

    async function onReadyOnline() {
        if (placingIdx < SHIPS.length || !ctx.getUser()) return;
        await set(ref(database, 'battleships/' + ctx.getUser() + 'Ships'),
            myShips.map(({ id, name, size, row, col, horizontal: h }) => ({ id, name, size, row, col, horizontal: h }))
        );
        await set(ref(database, 'battleships/ready/' + ctx.getUser()), true);
        statusEl.textContent = 'Waiting for opponent to place ships\u2026';
        const snap = await get(bsRef);
        const data = snap.val();
        if (data?.ready?.El && data?.ready?.Tero)
            await update(bsRef, { phase: 'playing', turn: 'El' });
    }

    async function shootOnline(r, c) {
        if (!myTurn || gameOver) return;
        const k = key(r, c);
        if (myShots.has(k)) return;
        myTurn = false;

        const hitShip = shipAt(enemyShips, r, c);
        const hit = !!hitShip;
        const futureShots = new Set([...myShots, k]);
        const sunkShipId = (hit && isSunk(hitShip, futureShots)) ? hitShip.id : null;
        const won = hit && allSunk(enemyShips, futureShots);
        const other = ctx.getUser() === 'El' ? 'Tero' : 'El';

        await push(ref(database, 'battleships/shots'), { by: ctx.getUser(), row: r, col: c, hit, sunkShipId });
        if (won) await update(bsRef, { phase: 'over', winner: ctx.getUser(), turn: ctx.getUser() });
        else     await set(ref(database, 'battleships/turn'), other);
    }

    // ---- render ----
    function updateHoverPreview() {
        myGridEl.querySelectorAll('.bs-preview-ok, .bs-preview-bad').forEach(el => {
            el.classList.remove('bs-preview-ok', 'bs-preview-bad');
        });
        if (!hoverRC || placingIdx >= SHIPS.length) return;
        const prev = previewCells(hoverRC.r, hoverRC.c);
        const valid = canPlace(myShips, SHIPS[placingIdx].size, hoverRC.r, hoverRC.c, horizontal);
        prev.forEach(p => {
            const cell = myGridEl.querySelector(`[data-r="${p.r}"][data-c="${p.c}"]`);
            if (cell) cell.classList.add(valid ? 'bs-preview-ok' : 'bs-preview-bad');
        });
    }

    function renderMyGrid() {
        myGridEl.classList.toggle('bs-grid--setup', phase === 'setup');
        myGridEl.innerHTML = '';
        for (let r = 0; r < BS; r++) {
            for (let c = 0; c < BS; c++) {
                const cell = document.createElement('div');
                cell.className = 'bs-cell';
                cell.dataset.r = r;
                cell.dataset.c = c;
                const ship = shipAt(myShips, r, c);
                const k = key(r, c);

                if (phase === 'setup') {
                    if (ship) cell.classList.add('bs-ship');
                    cell.addEventListener('click', () => onMyGridClick(r, c));
                    cell.addEventListener('mouseover', () => { hoverRC = { r, c }; updateHoverPreview(); });
                    cell.addEventListener('mouseout',  e => {
                        if (e.relatedTarget && myGridEl.contains(e.relatedTarget)) return;
                        hoverRC = null; updateHoverPreview();
                    });
                } else {
                    if (ship) cell.classList.add('bs-ship');
                    if (incomingShots.has(k)) cell.classList.add(ship ? 'bs-hit' : 'bs-miss');
                }
                myGridEl.appendChild(cell);
            }
        }
    }

    function renderEnemyGrid() {
        // Collect all cells belonging to sunk ships (so we can outline them)
        const sunkCells = new Set();
        for (const k in shotResults) {
            const sid = shotResults[k]?.sunkShipId;
            if (sid) {
                const s = enemyShips.find(sh => sh.id === sid);
                if (s) shipCells(s).forEach(sc => sunkCells.add(key(sc.r, sc.c)));
            }
        }

        enemyGridEl.innerHTML = '';
        for (let r = 0; r < BS; r++) {
            for (let c = 0; c < BS; c++) {
                const cell = document.createElement('div');
                cell.className = 'bs-cell';
                const k = key(r, c);

                if (myShots.has(k)) {
                    cell.classList.add(shotResults[k]?.hit ? 'bs-hit' : 'bs-miss');
                    if (sunkCells.has(k)) cell.classList.add('bs-sunk');
                } else if (phase === 'playing' && myTurn && !gameOver) {
                    cell.classList.add('bs-shootable');
                    cell.addEventListener('click', () =>
                        gameMode === 'online' ? shootOnline(r, c) : onEnemyGridClick(r, c)
                    );
                }
                enemyGridEl.appendChild(cell);
            }
        }
    }

    function renderShipsPanel() {
        if (!shipsPanelEl) return;
        shipsPanelEl.innerHTML = SHIPS.map((s, i) => {
            const done = i < placingIdx, cur = i === placingIdx && phase === 'setup';
            return `<span class="bs-ship-item${done?' bs-ship-placed':cur?' bs-ship-current':''}">${done?'✓':cur?'▶':'·'} ${s.name}&nbsp;(${s.size})</span>`;
        }).join('');
    }

    function renderLeaderboard() {
        const el = document.getElementById('bs-lb-rows');
        if (!el) return;
        const sc = bsScoresCache || {};
        el.innerHTML = ['El', 'Tero'].map(name =>
            `<div class="c4-lb-row"><span class="c4-lb-player">&#9875; ${name}</span><span class="c4-lb-score">${sc[name]?.wins||0}W</span></div>`
        ).join('');
    }

    function renderAll() {
        renderMyGrid();
        renderEnemyGrid();
        renderShipsPanel();
        const allPlaced = placingIdx >= SHIPS.length;
        if (readyBtn) { readyBtn.disabled = !(phase === 'setup' && allPlaced); readyBtn.textContent = allPlaced ? 'Ready!' : 'Place ships\u2026'; }
        if (rotateBtn) rotateBtn.style.display = phase === 'setup' ? '' : 'none';
        renderLeaderboard();
    }

    function setStatus(msg) {
        if (!statusEl) return;
        statusEl.textContent = msg;
        clearTimeout(_statusTimer);
        _statusTimer = setTimeout(() => updateStatus(), 2000);
    }

    function addLog(text, type) {
        if (!logEl) return;
        const entry = document.createElement('div');
        entry.className = 'bs-log-entry' + (type ? ' bs-log-' + type : '');
        entry.textContent = text;
        logEl.prepend(entry);
    }

    function updateStatus() {
        if (!statusEl) return;
        if (phase === 'setup') {
            const s = SHIPS[placingIdx];
            statusEl.textContent = s
                ? `Place your ${s.name} (${s.size}) \u2014 click your grid${horizontal ? '' : ' (vertical)'}`
                : 'All ships placed \u2014 press Ready!';
        } else if (phase === 'playing') {
            const other = ctx.getUser() === 'El' ? 'Tero' : 'El';
            statusEl.textContent = myTurn
                ? 'Your turn \u2014 click enemy waters to fire'
                : gameMode === 'ai' ? 'AI is targeting\u2026' : `Waiting for ${other}\u2026`;
        }
    }

    // ---- scores subscription ----
    onValue(bsScoresRef, snap => { bsScoresCache = snap.val() || {}; renderLeaderboard(); });

    // ---- event listeners ----
    readyBtn?.addEventListener('click', () => {
        if (phase !== 'setup' || placingIdx < SHIPS.length) return;
        if (gameMode === 'ai') { phase = 'playing'; myTurn = true; renderAll(); updateStatus(); }
        else onReadyOnline();
    });
    rotateBtn?.addEventListener('click', toggleOrientation);
    resetBtn?.addEventListener('click', () => initGame(true));
    modeSelect?.addEventListener('change', () => initGame(false));
    rematchBtn?.addEventListener('click', () => {
        if (gameMode === 'online') {
            if (rematchBtn) { rematchBtn.textContent = 'Rematch (waiting\u2026)'; rematchBtn.disabled = true; }
            set(ref(database, 'battleships/rematch/' + ctx.getUser()), true).catch(() => {});
        } else {
            initGame(true);
        }
    });
    myGridEl?.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); if (phase === 'setup') toggleOrientation(); });
    window.addEventListener('keydown', e => {
        if (!win || win.classList.contains('is-hidden')) return;
        if ((e.key === 'r' || e.key === 'R') && phase === 'setup') toggleOrientation();
    });

    // ---- window management ----
    function show() {
        const wasHidden = win.classList.contains('is-hidden');
        if (!taskbarBtn) taskbarBtn = w95Mgr.addTaskbarBtn('w95-win-battleships', 'BATTLESHIPS', () => {
            if (win.classList.contains('is-hidden')) show(); else hide();
        });
        win.classList.remove('is-hidden');
        w95Mgr.focusWindow('w95-win-battleships');
        if (wasHidden) ctx.trackWindowOpen('battleships');
    }
    function hide() {
        win.classList.add('is-hidden');
        if (w95Mgr.isActiveWin('w95-win-battleships')) w95Mgr.focusWindow(null);
    }
    function closeWin() {
        if (w95Mgr.isMaximised('w95-win-battleships')) w95Mgr.toggleMaximise(win, 'w95-win-battleships');
        hide();
        if (taskbarBtn) { taskbarBtn.remove(); taskbarBtn = null; }
    }

    minBtn?.addEventListener('click',  e => { e.stopPropagation(); hide(); });
    maxBtn?.addEventListener('click',  e => { e.stopPropagation(); w95Mgr.toggleMaximise(win, 'w95-win-battleships'); });
    closeBtn?.addEventListener('click', e => { e.stopPropagation(); closeWin(); });

    makeDraggable(win, handle, 'w95-win-battleships');

    w95Apps['battleships'] = { open: () => {
        if (win.classList.contains('is-hidden')) show();
        else w95Mgr.focusWindow('w95-win-battleships');
    }};

    initGame();
})();

