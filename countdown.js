import { database, ref, push, onValue, runTransaction } from './firebase.js';
import { w95Mgr, w95Apps, w95Layout } from './window-manager.js';
import { ctx } from './ctx.js';

(() => {
    const win       = document.getElementById('w95-win-countdown');
    const handle    = document.getElementById('w95-countdown-handle');
    const minBtn    = document.getElementById('w95-countdown-min');
    const maxBtn    = document.getElementById('w95-countdown-max');
    const closeBtn  = document.getElementById('w95-countdown-close');

    // Pick phase
    const pickPhaseEl  = document.getElementById('cd-pick-phase');
    const largeBtnsEl  = document.getElementById('cd-large-btns');
    const pickPreview  = document.getElementById('cd-pick-preview');
    const dealBtn      = document.getElementById('cd-deal-btn');

    // Game phase
    const gamePhaseEl  = document.getElementById('cd-game-phase');
    const targetEl     = document.getElementById('cd-target');
    const timerEl      = document.getElementById('cd-timer');
    const stepsLog     = document.getElementById('cd-steps-log');
    const currentStepEl = document.getElementById('cd-current-step');
    const numbersEl    = document.getElementById('cd-numbers');
    const undoBtn      = document.getElementById('cd-undo-btn');
    const clearBtn     = document.getElementById('cd-clear-btn');
    const resultEl     = document.getElementById('cd-result');
    const bestWrapEl   = document.getElementById('cd-best-wrap');
    const bestEl       = document.getElementById('cd-best');

    // Analogue clock
    let clockCtx = null;

    function drawClock() {
        const canvas = document.getElementById('cd-clock');
        if (!canvas) return;
        if (!clockCtx) {
            clockCtx = canvas.getContext('2d');
            if (!clockCtx) return;
        }
        const cw = canvas.width, ch = canvas.height;
        const cx = cw / 2, cy = ch / 2;
        const r  = Math.min(cw, ch) / 2 - 3;
        const urgent  = timerSec <= 10;
        const isDark  = document.body.classList.contains('dark-mode');

        clockCtx.clearRect(0, 0, cw, ch);

        // Face fill — warm cream background
        clockCtx.beginPath();
        clockCtx.arc(cx, cy, r, 0, 2 * Math.PI);
        clockCtx.fillStyle = isDark ? '#1e1810' : '#fffbf0';
        clockCtx.fill();

        const elapsed   = 30 - timerSec;

        // Elapsed-time arc (filled sector from 12 o'clock, follows hand)
        if (timerSec < 30) {
            const startAngle = -Math.PI / 2;
            const endAngle   = startAngle + (elapsed / 30) * 2 * Math.PI;
            clockCtx.beginPath();
            clockCtx.moveTo(cx, cy);
            clockCtx.arc(cx, cy, r - 2, startAngle, endAngle);
            clockCtx.closePath();
            if (urgent) {
                clockCtx.fillStyle = isDark ? 'rgba(255,80,80,0.30)' : 'rgba(200,0,0,0.14)';
            } else {
                clockCtx.fillStyle = isDark ? 'rgba(200,160,40,0.22)' : 'rgba(180,130,0,0.13)';
            }
            clockCtx.fill();
        }

        // Face border — gold ring
        clockCtx.beginPath();
        clockCtx.arc(cx, cy, r, 0, 2 * Math.PI);
        clockCtx.strokeStyle = urgent ? (isDark ? '#ff5555' : '#c01010') : (isDark ? '#8a6820' : '#9a7820');
        clockCtx.lineWidth = 2.5;
        clockCtx.stroke();

        // Tick marks (30 ticks — one per second)
        for (let i = 0; i < 30; i++) {
            const angle  = (i / 30) * 2 * Math.PI - Math.PI / 2;
            const isFive = i % 5 === 0;
            const inner  = r - (isFive ? 10 : 6);
            clockCtx.beginPath();
            clockCtx.moveTo(cx + Math.cos(angle) * (r - 2), cy + Math.sin(angle) * (r - 2));
            clockCtx.lineTo(cx + Math.cos(angle) * inner,   cy + Math.sin(angle) * inner);
            clockCtx.strokeStyle = isDark ? '#7a6030' : '#5a4010';
            clockCtx.lineWidth   = isFive ? 2 : 1;
            clockCtx.stroke();
        }

        // Second hand — points at elapsed position (starts at 12, sweeps clockwise)
        const handAngle = (elapsed / 30) * 2 * Math.PI - Math.PI / 2;
        const handLen   = r - 14;
        clockCtx.beginPath();
        clockCtx.moveTo(cx, cy);
        clockCtx.lineTo(cx + Math.cos(handAngle) * handLen, cy + Math.sin(handAngle) * handLen);
        clockCtx.strokeStyle = urgent ? (isDark ? '#ff5555' : '#c01010') : (isDark ? '#e0a820' : '#9a6800');
        clockCtx.lineWidth   = 2.5;
        clockCtx.lineCap     = 'round';
        clockCtx.stroke();
        clockCtx.lineCap     = 'butt';

        // Centre dot
        clockCtx.beginPath();
        clockCtx.arc(cx, cy, 3.5, 0, 2 * Math.PI);
        clockCtx.fillStyle = urgent ? (isDark ? '#ff5555' : '#c01010') : (isDark ? '#e0a820' : '#9a6800');
        clockCtx.fill();
    }

    // Scoreboard
    const sbRowsEl     = document.getElementById('cd-sb-rows');

    const cdScoresRef  = ref(database, 'countdown_scores');

    // ---- Game state ----
    let numLargeSelected = -1;
    let gameNumbers   = [];   // the 6 numbers dealt
    let target        = 0;
    let pool          = [];   // { id, value, isResult } — currently available numbers
    let nextPoolId    = 0;
    let steps         = [];   // completed: { aId, bId, op, a, b, aIsResult, bIsResult, result, resultId }
    let stepState     = 'pickA'; // 'pickA' | 'pickOp' | 'pickB'
    let pendingA      = null; // pool item selected as first operand
    let pendingOp     = null; // '+' | '-' | '*' | '/'
    let timerSec      = 30;
    let timerInterval = null;
    let gameOver        = false;
    let gameStartTime   = 0;
    let bestAttemptTime = 0;
    let taskbarBtn      = null;
    let bestAttempt     = { value: null, steps: [], score: 0 };

    // ---- Pools ----
    const LARGE = [25, 50, 75, 100];
    // Small: 1-10 each appearing twice
    const SMALL_POOL = [1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10];

    function shuffle(arr) {
        const a = arr.slice();
        for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
    }

    // ---- Step helpers ----
    function opDisplay(op) {
        if (op === '+') return '+';
        if (op === '-') return '−';
        if (op === '*') return '×';
        if (op === '/') return '÷';
        return op;
    }

    function compute(a, op, b) {
        if (op === '+') return a + b;
        if (op === '-') { const r = a - b; return r > 0 ? r : null; }
        if (op === '*') return a * b;
        if (op === '/') return (b > 0 && a % b === 0) ? a / b : null;
        return null;
    }

    function getPlayerResult() {
        if (steps.length === 0) return null;
        return steps[steps.length - 1].result;
    }

    function updateDisplay() {
        // Render completed steps
        stepsLog.innerHTML = '';
        steps.forEach(step => {
            const diff = Math.abs(step.result - target);
            const cls = diff === 0 ? 'cd-val-exact' : diff <= 10 ? 'cd-val-close' : '';
            const row = document.createElement('div');
            row.className = 'cd-step-row';

            const leftSpan = document.createElement('span');
            leftSpan.textContent = `${step.a} ${opDisplay(step.op)} ${step.b} =`;

            const resultSpan = document.createElement('span');
            resultSpan.className = `cd-step-result${cls ? ' ' + cls : ''}`;
            resultSpan.textContent = String(step.result);

            // Make result clickable if it is still in the pool and usable
            const resultItem = pool.find(p => p.id === step.resultId);
            let canClick = !!resultItem && !gameOver &&
                           !(pendingA && pendingA.id === step.resultId) &&
                           (stepState === 'pickA' || stepState === 'pickB');
            if (canClick && stepState === 'pickB' && pendingOp) {
                if (pendingOp === '/' && (resultItem.value === 0 || pendingA.value % resultItem.value !== 0)) canClick = false;
                if (pendingOp === '-' && resultItem.value >= pendingA.value) canClick = false;
            }
            if (canClick) {
                resultSpan.style.cursor = 'pointer';
                resultSpan.addEventListener('click', () => onNumberClick(resultItem));
            }

            row.appendChild(leftSpan);
            row.appendChild(resultSpan);
            stepsLog.appendChild(row);
        });

        // Render in-progress step hint
        if (stepState === 'pickA') {
            currentStepEl.textContent = steps.length === 0 ? 'Pick a number to start' : 'Pick a number for next step (or Submit)';
        } else if (stepState === 'pickOp') {
            currentStepEl.textContent = `${pendingA.value}  …  pick an operator`;
        } else if (stepState === 'pickB') {
            currentStepEl.textContent = `${pendingA.value} ${opDisplay(pendingOp)}  …  pick a number`;
        }
    }

    function updateTileDisabled() {
        numbersEl.querySelectorAll('.cd-num-btn').forEach(btn => {
            const id = parseInt(btn.dataset.poolId, 10);
            btn.classList.remove('is-pressed');
            if (gameOver) { btn.disabled = true; return; }
            // Pending A tile: show as selected (pressed) and disabled
            if (pendingA && pendingA.id === id) {
                btn.disabled = true;
                btn.classList.add('is-pressed');
                return;
            }
            const item = pool.find(p => p.id === id);
            if (!item) { btn.disabled = true; return; }
            if (stepState === 'pickA') {
                btn.disabled = false;
            } else if (stepState === 'pickOp') {
                btn.disabled = true;
            } else { // pickB
                if (pendingOp === '/') {
                    btn.disabled = item.value === 0 || pendingA.value % item.value !== 0;
                } else if (pendingOp === '-') {
                    btn.disabled = item.value >= pendingA.value;
                } else {
                    btn.disabled = false;
                }
            }
        });
    }

    function updateControls() {
        document.querySelectorAll('.cd-op-btn').forEach(b => {
            const canAutoSelectLast = stepState === 'pickA' && steps.length > 0 &&
                pool.some(p => p.id === steps[steps.length - 1].resultId);
            b.disabled = gameOver || (stepState !== 'pickOp' && stepState !== 'pickB' && !canAutoSelectLast);
        });
        const nothingDone = stepState === 'pickA' && steps.length === 0;
        if (undoBtn) undoBtn.disabled = gameOver || nothingDone;
        if (clearBtn) clearBtn.disabled = gameOver || nothingDone;
        updateTileDisabled();
    }

    // ---- Solver ----
    // Finds the closest achievable result to target using the given numbers.
    // Returns { diff, expr } where expr is a human-readable string.
    function solveCountdown(nums, tgt) {
        let bestDiff = Infinity;
        let bestExpr = '';

        function search(pool, exprs) {
            for (let i = 0; i < pool.length; i++) {
                const d = Math.abs(pool[i] - tgt);
                if (d < bestDiff) { bestDiff = d; bestExpr = exprs[i]; }
                if (bestDiff === 0) return;
            }
            if (pool.length === 1) return;
            for (let i = 0; i < pool.length; i++) {
                for (let j = 0; j < pool.length; j++) {
                    if (i === j) continue;
                    const a = pool[i], b = pool[j];
                    const ae = exprs[i], be = exprs[j];
                    const rest = pool.filter((_, k) => k !== i && k !== j);
                    const restE = exprs.filter((_, k) => k !== i && k !== j);
                    const ops = [
                        [a + b, `(${ae} + ${be})`],
                        [a - b, `(${ae} - ${be})`],
                        [a * b, `(${ae} × ${be})`],
                    ];
                    if (b > 0 && a % b === 0) ops.push([a / b, `(${ae} ÷ ${be})`]);
                    for (const [val, expr] of ops) {
                        if (val > 0 && bestDiff > 0) {
                            search([...rest, val], [...restE, expr]);
                        }
                    }
                }
            }
        }

        search(nums.slice(), nums.map(String));
        return { diff: bestDiff, expr: bestExpr };
    }

    // ---- Scoring ----
    function scoreResult(got, tgt) {
        if (got === null) return 0;
        const diff = Math.abs(got - tgt);
        if (diff === 0)  return 10;
        if (diff <= 5)   return 7;
        if (diff <= 10)  return 5;
        return 0;
    }

    function checkAndUpdateBest() {
        const val = getPlayerResult();
        if (val === null) return;
        const sc = scoreResult(val, target);
        if (sc <= 0) return;
        const curDiff = Math.abs(val - target);
        const prevDiff = bestAttempt.value !== null ? Math.abs(bestAttempt.value - target) : Infinity;
        if (sc > bestAttempt.score || (sc === bestAttempt.score && curDiff < prevDiff)) {
            bestAttempt = { value: val, steps: steps.slice(), score: sc };
            bestAttemptTime = Date.now();
            bestWrapEl?.classList.remove('is-hidden');
            if (bestEl) bestEl.textContent = String(val);
        }
    }

    // ---- Pick phase ----
    largeBtnsEl?.querySelectorAll('.cd-large-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            largeBtnsEl.querySelectorAll('.cd-large-btn').forEach(b => b.classList.remove('cd-selected'));
            btn.classList.add('cd-selected');
            numLargeSelected = parseInt(btn.dataset.count, 10);
            dealBtn.disabled = false;
            updatePickPreview();
        });
    });

    function updatePickPreview() {
        if (numLargeSelected < 0) { pickPreview.innerHTML = ''; return; }
        const numSmall = 6 - numLargeSelected;
        // Show placeholder tiles
        pickPreview.innerHTML = '';
        for (let i = 0; i < numLargeSelected; i++) {
            const el = document.createElement('div');
            el.className = 'cd-preview-tile';
            el.textContent = 'Large';
            pickPreview.appendChild(el);
        }
        for (let i = 0; i < numSmall; i++) {
            const el = document.createElement('div');
            el.className = 'cd-preview-tile';
            el.textContent = 'Small';
            pickPreview.appendChild(el);
        }
    }

    dealBtn?.addEventListener('click', () => {
        if (numLargeSelected < 0) return;
        // Build number set
        const largePerm = shuffle(LARGE).slice(0, numLargeSelected);
        const smallPerm = shuffle(SMALL_POOL).slice(0, 6 - numLargeSelected);
        gameNumbers = [...largePerm, ...smallPerm];
        target = Math.floor(Math.random() * 899) + 101; // 101-999
        startGame();
    });

    // ---- Game phase ----
    function startGame() {
        // Reset state
        nextPoolId = 0;
        pool = gameNumbers.map(v => ({ id: nextPoolId++, value: v, isResult: false }));
        steps = [];
        stepState = 'pickA';
        pendingA = null;
        pendingOp = null;
        gameOver = false;
        gameStartTime = Date.now();
        timerSec = 30;
        bestAttempt = { value: null, steps: [], score: 0 };
        bestAttemptTime = 0;
        bestWrapEl?.classList.add('is-hidden');
        if (bestEl) bestEl.textContent = '—';
        resultEl.innerHTML = '';
        resultEl.style.display = '';

        // Switch phases
        pickPhaseEl.classList.add('is-hidden');
        gamePhaseEl.classList.remove('is-hidden');

        targetEl.textContent = String(target);
        timerEl.textContent  = '30';
        timerEl.classList.remove('cd-timer-urgent');
        buildNumberTiles();
        updateDisplay();
        updateControls();
        drawClock();

        // Start timer
        clearInterval(timerInterval);
        timerInterval = setInterval(() => {
            timerSec--;
            timerEl.textContent = String(timerSec);
            if (timerSec <= 10) timerEl.classList.add('cd-timer-urgent');
            drawClock();
            if (timerSec <= 0) {
                clearInterval(timerInterval);
                endGame(false);
            }
        }, 1000);
    }

    function buildNumberTiles() {
        numbersEl.innerHTML = '';
        pool.forEach(item => {
            const btn = document.createElement('button');
            btn.className = 'w95-btn cd-num-btn';
            if (item.isResult) btn.classList.add('cd-num-result');
            btn.textContent = String(item.value);
            btn.dataset.poolId = item.id;
            btn.type = 'button';
            btn.addEventListener('click', () => onNumberClick(item));
            numbersEl.appendChild(btn);
        });
        updateTileDisabled();
    }

    function onNumberClick(item) {
        if (gameOver) return;
        if (stepState === 'pickA') {
            pendingA = item;
            // Keep item in pool — tile stays in place, just greys out via updateTileDisabled
            stepState = 'pickOp';
            updateDisplay();
            updateControls();
        } else if (stepState === 'pickB') {
            const result = compute(pendingA.value, pendingOp, item.value);
            if (result === null) return;
            // Remove both operands from pool now that the step is complete
            pool = pool.filter(p => p.id !== item.id && p.id !== pendingA.id);
            const resultId = nextPoolId++;
            steps.push({
                aId: pendingA.id, bId: item.id,
                op: pendingOp,
                a: pendingA.value, b: item.value,
                aIsResult: pendingA.isResult, bIsResult: item.isResult,
                result, resultId
            });
            pool.push({ id: resultId, value: result, isResult: true });
            pendingA = null;
            pendingOp = null;
            stepState = 'pickA';
            buildNumberTiles();
            updateDisplay();
            updateControls();
            checkAndUpdateBest();
            // Auto-submit only on exact match; close results are tracked via bestAttempt
            if (result === target) {
                clearInterval(timerInterval);
                endGame(true);
                return;
            }
        }
    }

    document.querySelectorAll('.cd-op-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (gameOver) return;
            if (stepState === 'pickA') {
                // Auto-select the last equation's result as the first operand
                if (steps.length === 0) return;
                const lastResultId = steps[steps.length - 1].resultId;
                const lastResult = pool.find(p => p.id === lastResultId);
                if (!lastResult) return;
                pendingA = lastResult;
                // Keep in pool — tile stays put, greys out via updateTileDisabled
                pendingOp = btn.dataset.op;
                stepState = 'pickB';
            } else if (stepState === 'pickOp') {
                pendingOp = btn.dataset.op;
                stepState = 'pickB';
            } else if (stepState === 'pickB') {
                // Change operator — re-validate tiles via updateControls below
                pendingOp = btn.dataset.op;
            } else {
                return;
            }
            updateDisplay();
            updateControls();
        });
    });

    undoBtn?.addEventListener('click', () => {
        if (gameOver) return;
        if (stepState === 'pickOp') {
            // Cancel A selection — tile was never removed from pool, just clear selection
            pendingA = null;
            stepState = 'pickA';
        } else if (stepState === 'pickB') {
            // Cancel operator, go back to pickOp
            pendingOp = null;
            stepState = 'pickOp';
        } else if (steps.length > 0) {
            // Undo last completed step — pool structure changes, rebuild tiles
            const step = steps.pop();
            pool = pool.filter(p => p.id !== step.resultId);
            pool.push({ id: step.aId, value: step.a, isResult: step.aIsResult });
            pool.push({ id: step.bId, value: step.b, isResult: step.bIsResult });
            buildNumberTiles();
        }
        updateDisplay();
        updateControls();
    });

    clearBtn?.addEventListener('click', () => {
        if (gameOver) return;
        pool = gameNumbers.map((v, i) => ({ id: i, value: v, isResult: false }));
        nextPoolId = gameNumbers.length;
        steps = [];
        pendingA = null;
        pendingOp = null;
        stepState = 'pickA';
        buildNumberTiles();
        updateDisplay();
        updateControls();
    });


    function endGame(submitted) {
        gameOver = true;
        updateControls();
        timerEl.classList.remove('cd-timer-urgent');

        const currentVal   = getPlayerResult();
        const currentScore = scoreResult(currentVal, target);
        const currentDiff  = currentVal !== null ? Math.abs(currentVal - target) : Infinity;
        const bestDiff     = bestAttempt.value !== null ? Math.abs(bestAttempt.value - target) : Infinity;
        const useBest = bestAttempt.score > currentScore ||
                        (bestAttempt.score === currentScore && bestAttempt.score > 0 && bestDiff < currentDiff);
        const resultTime   = useBest && bestAttemptTime ? bestAttemptTime : Date.now();
        const timeTaken    = Math.round((resultTime - gameStartTime) / 100) / 10; // seconds, 1dp
        const playerVal    = useBest ? bestAttempt.value : currentVal;
        const finalSteps   = useBest ? bestAttempt.steps : steps;
        const pts          = scoreResult(playerVal, target);
        const playerMethod = finalSteps.map(s => `${s.a} ${opDisplay(s.op)} ${s.b} = ${s.result}`).join(', ');

        // Find best computer solution
        const solution = solveCountdown(gameNumbers, target);

        // Build result HTML
        let scoreClass = `cd-score-${pts}`;
        let scoreLabel = pts === 10 ? `10 points — Exact! (${timeTaken}s)` :
                         pts === 7  ? '7 points — Within 5!' :
                         pts === 5  ? '5 points — Within 10!' :
                                      '0 points — No score';

        const gotDiff = playerVal !== null ? Math.abs(playerVal - target) : null;
        let gotText = playerVal !== null
            ? `${useBest ? 'Best attempt: ' : 'You got: '}<strong>${playerVal}</strong> (${gotDiff === 0 ? 'exact' : gotDiff + ' away'})`
            : submitted ? 'No steps completed.' : 'Time\'s up — no steps completed.';

        let solutionHtml = solution.diff === 0
            ? `<div class="cd-result-solution">Optimal: ${solution.expr} = ${target}</div>`
            : `<div class="cd-result-solution">Closest found: ${solution.expr} (${solution.diff} away)</div>`;

        resultEl.innerHTML = `
          <div class="cd-result-inner">
            <div class="cd-result-score ${scoreClass}">${scoreLabel}</div>
            <div class="cd-result-detail">${gotText}</div>
            ${solutionHtml}
            <button class="w95-btn cd-again-btn" id="cd-again-btn" type="button">Play Again</button>
          </div>`;

        document.getElementById('cd-again-btn')?.addEventListener('click', resetToPick);

        // Save score to Firebase
        if (ctx.getUser() && pts > 0) {
            const userScoreRef = ref(database, 'countdown_scores/' + ctx.getUser());
            runTransaction(userScoreRef, cur => {
                if (!cur) return { total: pts, games: 1 };
                return { total: (cur.total || 0) + pts, games: (cur.games || 0) + 1 };
            }).catch(() => {});
            push(ref(database, 'countdown_games/' + ctx.getUser()), {
                pts, numbers: gameNumbers, target, method: playerMethod,
                timeTaken, timestamp: Date.now()
            }).catch(() => {});
        } else if (ctx.getUser()) {
            const userScoreRef = ref(database, 'countdown_scores/' + ctx.getUser());
            runTransaction(userScoreRef, cur => {
                if (!cur) return { total: 0, games: 1 };
                return { total: (cur.total || 0), games: (cur.games || 0) + 1 };
            }).catch(() => {});
        }
    }

    function resetToPick() {
        gamePhaseEl.classList.add('is-hidden');
        pickPhaseEl.classList.remove('is-hidden');
        // Reset pick selection
        numLargeSelected = -1;
        largeBtnsEl?.querySelectorAll('.cd-large-btn').forEach(b => b.classList.remove('cd-selected'));
        pickPreview.innerHTML = '';
        dealBtn.disabled = true;
        resultEl.innerHTML = '';
    }

    // ---- Scoreboard ----
    // Detail panel for showing per-user game history on row click
    const sbDetailEl = document.createElement('div');
    sbDetailEl.id = 'cd-sb-detail';
    sbDetailEl.style.cssText = 'margin-top:4px;padding:4px 6px;border:1px solid #aaa;font-size:11px;display:none;line-height:1.4;';
    document.getElementById('cd-scoreboard')?.appendChild(sbDetailEl);
    let sbDetailUser = '';

    let cdLatestScores = {};
    let cdLatestGames  = {};

    function renderCdLeaderboard() {
        if (!sbRowsEl) return;
        const allUsers = new Set([...Object.keys(cdLatestScores), ...Object.keys(cdLatestGames)]);
        if (!allUsers.size) {
            sbRowsEl.innerHTML = '<div class="c4-lb-row" style="justify-content:center;color:#888;font-size:11px;">No scores yet</div>';
            return;
        }
        const rows = Array.from(allUsers).map(user => {
            const s = cdLatestScores[user] || {};
            const userGames = cdLatestGames[user] ? Object.values(cdLatestGames[user]) : [];
            const times = userGames.map(g => g.timeTaken).filter(t => t != null);
            const bestTime = times.length ? Math.min(...times) : Infinity;
            return { user, total: s.total || 0, games: s.games || 0, bestTime };
        });
        rows.sort((a, b) => a.bestTime - b.bestTime);
        sbRowsEl.innerHTML = rows.map(r => {
            const bestStr = r.bestTime < Infinity ? `${r.bestTime}s best · ` : '';
            return `<div class="c4-lb-row cd-lb-clickable" data-user="${r.user}" style="cursor:pointer;" title="Click to see game history">
               <span class="c4-lb-player">${r.user}</span>
               <span class="c4-lb-score">${bestStr}${r.total} pts (${r.games} game${r.games === 1 ? '' : 's'})</span>
             </div>`;
        }).join('');

        sbRowsEl.querySelectorAll('.cd-lb-clickable').forEach(row => {
            row.addEventListener('click', async () => {
                const user = row.dataset.user;
                if (sbDetailUser === user && sbDetailEl.style.display !== 'none') {
                    sbDetailEl.style.display = 'none';
                    sbDetailUser = '';
                    return;
                }
                sbDetailUser = user;
                sbDetailEl.style.display = 'block';
                sbDetailEl.innerHTML = '<em>Loading…</em>';
                try {
                    const gSnap = await get(ref(database, 'countdown_games/' + user));
                    const gData = gSnap.val();
                    if (!gData) {
                        sbDetailEl.innerHTML = `<strong>${user}</strong> — no detailed records yet.`;
                        return;
                    }
                    const entries = Object.values(gData)
                        .filter(g => g.timeTaken != null)
                        .sort((a, b) => a.timeTaken - b.timeTaken)
                        .slice(0, 5);
                    sbDetailEl.innerHTML = `<strong>${user}'s recent games:</strong>` +
                        entries.map(g => {
                            const nums = (g.numbers || []).join(', ');
                            const timeStr = g.timeTaken != null ? ` in ${g.timeTaken}s` : '';
                            const method = g.method || 'N/A';
                            return `<div style="margin-top:3px;padding-top:3px;border-top:1px solid #ddd;">
                                <b>${g.pts}pts</b> — Target: <b>${g.target}</b>${timeStr}<br>
                                Numbers: [${nums}]<br>
                                Method: ${method}
                            </div>`;
                        }).join('');
                } catch (_) {
                    sbDetailEl.innerHTML = '<em>Could not load game details.</em>';
                }
            });
        });
    }

    onValue(cdScoresRef, snap => {
        cdLatestScores = snap.val() || {};
        renderCdLeaderboard();
    });

    onValue(ref(database, 'countdown_games'), snap => {
        cdLatestGames = snap.val() || {};
        renderCdLeaderboard();
    });

    // ---- Window management ----
    function show() {
        const wasHidden = win.classList.contains('is-hidden');
        if (!taskbarBtn) taskbarBtn = w95Mgr.addTaskbarBtn('w95-win-countdown', 'COUNTDOWN', () => {
            if (win.classList.contains('is-hidden')) show(); else hide();
        });
        win.classList.remove('is-hidden');
        w95Mgr.focusWindow('w95-win-countdown');
        if (wasHidden) _trackWindowOpen('countdown');
    }
    function hide() {
        win.classList.add('is-hidden');
        if (w95Mgr.isActiveWin('w95-win-countdown')) w95Mgr.focusWindow(null);
    }
    function closeWin() {
        if (w95Mgr.isMaximised('w95-win-countdown')) w95Mgr.toggleMaximise(win, 'w95-win-countdown');
        clearInterval(timerInterval);
        hide();
        if (taskbarBtn) { taskbarBtn.remove(); taskbarBtn = null; }
    }

    minBtn?.addEventListener('click',  e => { e.stopPropagation(); hide(); });
    maxBtn?.addEventListener('click',  e => { e.stopPropagation(); w95Mgr.toggleMaximise(win, 'w95-win-countdown'); });
    closeBtn?.addEventListener('click', e => { e.stopPropagation(); closeWin(); });

    let dragging = false, sx = 0, sy = 0, wx = 0, wy = 0;
    handle.addEventListener('mousedown', e => {
        if (e.target.closest('button') || w95Mgr.isMaximised('w95-win-countdown')) return;
        dragging = true; sx = e.clientX; sy = e.clientY;
        const rect = win.getBoundingClientRect(); wx = rect.left; wy = rect.top;
        e.preventDefault();
    });
    window.addEventListener('mousemove', e => {
        if (!dragging) return;
        const maxX = document.documentElement.clientWidth - win.offsetWidth;
        const maxY = document.documentElement.clientHeight - win.offsetHeight - 40;
        win.style.left = Math.max(0, Math.min(maxX, wx + e.clientX - sx)) + 'px';
        win.style.top  = Math.max(0, Math.min(maxY, wy + e.clientY - sy)) + 'px';
    });
    window.addEventListener('mouseup', () => {
        if (dragging) { dragging = false; w95Layout.save(win, 'w95-win-countdown'); }
    });

    w95Apps['countdown'] = { open: () => {
        if (win.classList.contains('is-hidden')) show();
        else w95Mgr.focusWindow('w95-win-countdown');
    }};
})();

