import { database, ref, onValue, set, update, remove, runTransaction } from './firebase.js';
import { w95Mgr, w95Apps, w95Layout, makeDraggable } from './window-manager.js';
import { ctx } from './ctx.js';
import { launchConfetti } from './confetti.js';

// ===== Connect 4 =====
(() => {
    const ROWS = 6, COLS = 7;
    const EMPTY = 0, PLAYER = 1, AI = 2;

    // gameMode: 'ai' | 'local' | 'online'
    let board, currentPlayer, gameOver, gameMode, pendingOnline = false;
    let onlineUnsub = null;

    const win        = document.getElementById('w95-win-connect4');
    const boardEl    = document.getElementById('c4-board');
    const statusEl   = document.getElementById('c4-status');
    const resetBtn   = document.getElementById('c4-reset-btn');
    const modeSelect = document.getElementById('c4-mode-select');
    const diffSelect = document.getElementById('c4-diff-select');
    const rematchBtn = document.getElementById('c4-rematch-btn');
    const minBtn     = document.getElementById('w95-connect4-min');
    const maxBtn     = document.getElementById('w95-connect4-max');
    const closeBtn   = document.getElementById('w95-connect4-close');
    const handle     = document.getElementById('w95-connect4-handle');

    if (!win || !boardEl || !handle) return;

    const c4Ref = ref(database, 'connect4');
    const c4ScoresRef = ref(database, 'connect4_scores');

    let taskbarBtn = null;
    let moveCount = 0;            // total pieces placed this game (AI mode)
    let onlineResultRecorded = false; // prevent double-counting online results
    let scoresCache = null;       // latest connect4_scores snapshot
    let aiDifficulty = 'hard';   // 'easy' | 'medium' | 'hard'

    // In online mode: El = PLAYER (1, red), Tero = AI (2, yellow)
    function myPiece() { return ctx.getUser() === 'El' ? PLAYER : AI; }

    // ---------- stats helpers ----------

    function getC4Stats() {
        try { return JSON.parse(localStorage.getItem('c4Stats_' + ctx.getUser()) || '{}'); }
        catch(e) { return {}; }
    }
    function saveC4Stats(stats) {
        if (!ctx.getUser()) return;
        localStorage.setItem('c4Stats_' + ctx.getUser(), JSON.stringify(stats));
    }

    async function updateOnlineScore(result) {
        if (!ctx.getUser()) return;
        const userScoreRef = ref(database, 'connect4_scores/' + ctx.getUser());
        await runTransaction(userScoreRef, (current) => {
            const data = current || { wins: 0, draws: 0 };
            if (result === 'win')  data.wins  = (data.wins  || 0) + 1;
            if (result === 'draw') data.draws = (data.draws || 0) + 1;
            return data;
        });
        if (result === 'win') await ctx.unlock('c4_online_win');
    }

    function renderLeaderboard() {
        const el = document.getElementById('c4-lb-rows');
        if (!el) return;
        const scores = scoresCache || {};
        const stats  = getC4Stats();
        const players = [
            { name: 'El',   circle: '&#128308;', data: scores.El   || { wins: 0, draws: 0 } },
            { name: 'Tero', circle: '&#128993;', data: scores.Tero || { wins: 0, draws: 0 } },
        ];
        el.innerHTML =
            players.map(p =>
                `<div class="c4-lb-row">` +
                `<span class="c4-lb-player">${p.circle} ${p.name}</span>` +
                `<span class="c4-lb-score">${p.data.wins}W&nbsp;${p.data.draws}D</span>` +
                `</div>`
            ).join('') +
            (ctx.getUser()
                ? `<hr class="c4-lb-divider">` +
                  `<div class="c4-lb-row">` +
                  `<span>vs AI</span>` +
                  `<span class="c4-lb-score">${stats.aiWins || 0}W&nbsp;${stats.aiDraws || 0}D</span>` +
                  `</div>`
                : '');
    }

    // Subscribe once to live score updates
    onValue(c4ScoresRef, (snap) => {
        scoresCache = snap.val() || {};
        renderLeaderboard();
    });

    // ---------- game logic ----------

    function initGame(forceNew = false) {
        if (onlineUnsub) { onlineUnsub(); onlineUnsub = null; }
        gameMode = modeSelect ? modeSelect.value : 'ai';
        aiDifficulty = diffSelect ? diffSelect.value : 'hard';
        pendingOnline = false;
        if (rematchBtn) rematchBtn.style.display = 'none';
        if (diffSelect) diffSelect.style.display = gameMode === 'ai' ? '' : 'none';

        if (!forceNew && ctx.getUser()) {
            if (gameMode === 'online') {
                (async () => { if (!(await tryRestoreOnlineC4())) startFreshC4(); })();
                return;
            }
            if (gameMode === 'ai') {
                (async () => { if (!(await tryRestoreAIC4())) startFreshC4(); })();
                return;
            }
        }
        startFreshC4();
    }

    function startFreshC4() {
        board = Array.from({length: ROWS}, () => Array(COLS).fill(EMPTY));
        currentPlayer = PLAYER;
        gameOver = false;
        moveCount = 0;
        onlineResultRecorded = false;

        if (gameMode === 'online') {
            if (!ctx.getUser()) {
                statusEl.textContent = 'Sign in to play online';
                renderBoard(null);
                return;
            }
            const gameId = Date.now().toString(36);
            localStorage.setItem('c4_online_gid', gameId);
            set(c4Ref, {
                board: board.map(r => [...r]),
                turn: 'El',
                status: 'playing',
                winner: null,
                winCells: null,
                gameId,
            });
            set(ref(database, 'connect4_invite'), { from: ctx.getUser(), ts: Date.now() });
            subscribeOnline();
            return;
        }

        renderBoard(null);
        updateStatus();
    }

    async function tryRestoreOnlineC4() {
        try {
            const snap = await get(c4Ref);
            const data = snap.val();
            if (!data || data.status === 'over') return false;
            const savedGid = localStorage.getItem('c4_online_gid');
            if (savedGid && data.gameId && savedGid !== data.gameId) return false;
            onlineResultRecorded = false;
            subscribeOnline();
            return true;
        } catch(e) { return false; }
    }

    async function tryRestoreAIC4() {
        if (!ctx.getUser()) return false;
        try {
            const snap = await get(ref(database, 'connect4_ai/' + ctx.getUser()));
            const data = snap.val();
            if (!data || data.gameOver || data.mode !== gameMode) return false;
            if (Date.now() - (data.ts || 0) > 48 * 3600000) return false;
            board = data.board.map(r => [...r]);
            currentPlayer = data.currentPlayer;
            gameOver = data.gameOver || false;
            moveCount = data.moveCount || 0;
            onlineResultRecorded = false;
            renderBoard(null);
            updateStatus();
            // If it was the AI's turn when we saved, trigger the AI move
            if (currentPlayer === AI && !gameOver) setTimeout(doAIMove, 350);
            return true;
        } catch(e) { return false; }
    }

    function saveC4AIGame() {
        if (!ctx.getUser() || gameMode !== 'ai') return;
        set(ref(database, 'connect4_ai/' + ctx.getUser()), {
            mode: gameMode,
            board: board.map(r => [...r]),
            currentPlayer,
            gameOver,
            moveCount,
            ts: Date.now(),
        }).catch(() => {});
    }

    function subscribeOnline() {
        onlineUnsub = onValue(c4Ref, (snapshot) => {
            const data = snapshot.val();
            pendingOnline = false;
            if (!data) { renderBoard(null); updateStatus(); return; }

            // Handle rematch: when both accept, El creates a fresh game
            if (data.rematch?.El && data.rematch?.Tero) {
                onlineResultRecorded = false;
                if (rematchBtn) rematchBtn.style.display = 'none';
                if (ctx.getUser() === 'El') {
                    const newGid = Date.now().toString(36);
                    localStorage.setItem('c4_online_gid', newGid);
                    const newBoard = Array.from({length: ROWS}, () => Array(COLS).fill(EMPTY));
                    set(c4Ref, {
                        board: newBoard.map(r => [...r]),
                        turn: 'El', status: 'playing',
                        winner: null, winCells: null, gameId: newGid,
                    });
                }
                return;
            }

            board = Array.from({length: ROWS}, (_, r) =>
                Array.from({length: COLS}, (_, c) => (data.board[r] && data.board[r][c] != null ? data.board[r][c] : EMPTY))
            );
            currentPlayer = data.turn === 'El' ? PLAYER : AI;
            gameOver = data.status === 'over';

            const winCells = data.winCells ? data.winCells.map(cell => [cell[0], cell[1]]) : null;
            renderBoard(winCells);

            if (data.status === 'over') {
                if (data.winner === 'draw') {
                    statusEl.textContent = "It's a draw!";
                } else {
                    const isMe = data.winner === ctx.getUser();
                    statusEl.innerHTML = data.winner === 'El'
                        ? '&#128308; El wins!' + (isMe ? ' &#127881;' : '')
                        : '&#128993; Tero wins!' + (isMe ? ' &#127881;' : '');
                    if (isMe) launchConfetti();
                }
                if (!onlineResultRecorded) {
                    onlineResultRecorded = true;
                    if (data.winner === ctx.getUser()) updateOnlineScore('win');
                    else if (data.winner === 'draw') updateOnlineScore('draw');
                }
                if (rematchBtn) {
                    rematchBtn.style.display = '';
                    const myRematch = data.rematch?.[ctx.getUser()];
                    rematchBtn.textContent = myRematch ? 'Rematch (waiting\u2026)' : 'Rematch';
                    rematchBtn.disabled = !!myRematch;
                }
            } else {
                updateStatus();
            }
        });
    }

    function renderBoard(winCells) {
        boardEl.innerHTML = '';
        const winSet = winCells
            ? new Set(winCells.map(([r, c]) => r * COLS + c))
            : null;
        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
                const cell = document.createElement('div');
                cell.className = 'c4-cell';
                const piece = board[r][c];
                if (piece === PLAYER) cell.classList.add('c4-player');
                else if (piece === AI) cell.classList.add('c4-ai');
                if (winSet && winSet.has(r * COLS + c)) cell.classList.add('c4-win');
                const col = c;
                cell.addEventListener('click', () => {
                    if (gameMode === 'ai' && currentPlayer === AI) return;
                    if (gameMode === 'online' && (currentPlayer !== myPiece() || pendingOnline)) return;
                    onColClick(col);
                });
                boardEl.appendChild(cell);
            }
        }
    }

    function dropPiece(col, player) {
        for (let r = ROWS - 1; r >= 0; r--) {
            if (board[r][col] === EMPTY) {
                board[r][col] = player;
                return r;
            }
        }
        return -1; // column full
    }

    function undropPiece(col) {
        for (let r = 0; r < ROWS; r++) {
            if (board[r][col] !== EMPTY) {
                board[r][col] = EMPTY;
                return;
            }
        }
    }

    function checkWin(row, col) {
        const player = board[row][col];
        if (player === EMPTY) return null;
        const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
        for (const [dr, dc] of dirs) {
            const cells = [[row, col]];
            for (let s = 1; s < 4; s++) {
                const nr = row + dr * s, nc = col + dc * s;
                if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS || board[nr][nc] !== player) break;
                cells.push([nr, nc]);
            }
            for (let s = 1; s < 4; s++) {
                const nr = row - dr * s, nc = col - dc * s;
                if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS || board[nr][nc] !== player) break;
                cells.push([nr, nc]);
            }
            if (cells.length >= 4) return cells;
        }
        return null;
    }

    function isBoardFull() {
        return board[0].every(cell => cell !== EMPTY);
    }

    function updateStatus() {
        if (gameMode === 'online') {
            const isMyTurn = currentPlayer === myPiece();
            statusEl.innerHTML = currentPlayer === PLAYER
                ? '&#128308; ' + (isMyTurn ? 'Your turn (El)' : "El's turn")
                : '&#128993; ' + (isMyTurn ? 'Your turn (Tero)' : "Tero's turn");
        } else if (gameMode === 'ai') {
            statusEl.innerHTML = currentPlayer === PLAYER
                ? '&#128308; Your turn'
                : '&#128993; AI thinking\u2026';
        } else {
            statusEl.innerHTML = currentPlayer === PLAYER
                ? '&#128308; Red\'s turn'
                : '&#128993; Yellow\'s turn';
        }
    }

    function onColClick(col) {
        if (gameOver) return;

        if (gameMode === 'online') {
            pushMoveOnline(col);
            return;
        }

        const row = dropPiece(col, currentPlayer);
        if (row === -1) return; // column full

        moveCount++;

        const winCells = checkWin(row, col);
        renderBoard(winCells);

        if (winCells) {
            if (gameMode === 'ai') {
                if (currentPlayer === PLAYER) {
                    statusEl.innerHTML = '&#128308; You win! &#127881;';
                    launchConfetti();
                    const stats = getC4Stats();
                    stats.aiWins = (stats.aiWins || 0) + 1;
                    saveC4Stats(stats);
                    const mc = moveCount;
                    (async () => {
                        await ctx.unlock('c4_first_win');
                        if (stats.aiWins >= 5)  await ctx.unlock('c4_ai_wins_5');
                        if (stats.aiWins >= 10) await ctx.unlock('c4_ai_wins_10');
                        if (stats.aiWins >= 25) await ctx.unlock('c4_ai_wins_25');
                        if (mc <= 15)           await ctx.unlock('c4_speed_win');
                        renderLeaderboard();
                    })();
                } else {
                    statusEl.innerHTML = '&#128993; AI wins!';
                }
            } else {
                statusEl.innerHTML = currentPlayer === PLAYER
                    ? '&#128308; Red wins! &#127881;'
                    : '&#128993; Yellow wins! &#127881;';
                launchConfetti();
            }
            gameOver = true;
            if (rematchBtn) rematchBtn.style.display = '';
            if (gameMode === 'ai') saveC4AIGame();
            return;
        }

        if (isBoardFull()) {
            statusEl.textContent = "It's a draw!";
            gameOver = true;
            if (rematchBtn) rematchBtn.style.display = '';
            if (gameMode === 'ai') {
                const stats = getC4Stats();
                stats.aiDraws = (stats.aiDraws || 0) + 1;
                saveC4Stats(stats);
                saveC4AIGame();
                (async () => {
                    await ctx.unlock('c4_first_draw');
                    renderLeaderboard();
                })();
            }
            return;
        }

        currentPlayer = currentPlayer === PLAYER ? AI : PLAYER;
        updateStatus();

        if (gameMode === 'ai' && currentPlayer === AI) {
            setTimeout(doAIMove, 350);
        } else if (gameMode === 'ai') {
            // Player's turn again after AI responded — save state
            saveC4AIGame();
        }
    }

    function pushMoveOnline(col) {
        const row = dropPiece(col, currentPlayer);
        if (row === -1) return; // column full

        const winCells = checkWin(row, col);
        const boardFull = isBoardFull();

        let status = 'playing', winner = null, winCellsData = null;
        if (winCells) {
            status = 'over';
            winner = currentPlayer === PLAYER ? 'El' : 'Tero';
            winCellsData = winCells;
        } else if (boardFull) {
            status = 'over';
            winner = 'draw';
        }

        const nextTurn = currentPlayer === PLAYER ? 'Tero' : 'El';
        pendingOnline = true;
        set(c4Ref, {
            board: board.map(r => [...r]),
            turn: status === 'over' ? (currentPlayer === PLAYER ? 'El' : 'Tero') : nextTurn,
            status,
            winner,
            winCells: winCellsData,
        });
    }

    function doAIMove() {
        if (gameOver) return;
        onColClick(getAIMove());
    }

    // ---------- AI: minimax with alpha-beta, depth 5 ----------

    const COL_ORDER = [3, 2, 4, 1, 5, 0, 6]; // prefer centre

    function getAIMove() {
        if (aiDifficulty === 'easy')   return getAIMoveEasy();
        if (aiDifficulty === 'medium') return getAIMoveMedium();
        return getAIMoveHard();
    }

    function getAIMoveEasy() {
        const valid = COL_ORDER.filter(c => board[0][c] === EMPTY);
        return valid[Math.floor(Math.random() * valid.length)] ?? 3;
    }

    function getAIMoveMedium() {
        // Win if possible
        for (const c of COL_ORDER) {
            const r = dropPiece(c, AI);
            if (r === -1) continue;
            const wins = !!checkWin(r, c);
            undropPiece(c);
            if (wins) return c;
        }
        // Block opponent win
        for (const c of COL_ORDER) {
            const r = dropPiece(c, PLAYER);
            if (r === -1) continue;
            const wins = !!checkWin(r, c);
            undropPiece(c);
            if (wins) return c;
        }
        return getAIMoveEasy();
    }

    function getAIMoveHard() {
        let bestScore = -Infinity, bestCol = 3;
        for (const c of COL_ORDER) {
            const r = dropPiece(c, AI);
            if (r === -1) continue;
            if (checkWin(r, c)) { undropPiece(c); return c; } // immediate win
            const score = minimax(4, false, -Infinity, Infinity, r, c);
            undropPiece(c);
            if (score > bestScore) { bestScore = score; bestCol = c; }
        }
        return bestCol;
    }

    function minimax(depth, isMaximizing, alpha, beta, lastRow, lastCol) {
        // Check if the last move ended the game
        if (lastRow >= 0) {
            const w = checkWin(lastRow, lastCol);
            if (w) {
                const winner = board[lastRow][lastCol];
                return winner === AI ? 1000 + depth : -1000 - depth;
            }
        }
        if (isBoardFull() || depth === 0) return scoreBoard();

        if (isMaximizing) {
            let best = -Infinity;
            for (const c of COL_ORDER) {
                const r = dropPiece(c, AI);
                if (r === -1) continue;
                best = Math.max(best, minimax(depth - 1, false, alpha, beta, r, c));
                undropPiece(c);
                alpha = Math.max(alpha, best);
                if (beta <= alpha) break;
            }
            return best;
        } else {
            let best = Infinity;
            for (const c of COL_ORDER) {
                const r = dropPiece(c, PLAYER);
                if (r === -1) continue;
                best = Math.min(best, minimax(depth - 1, true, alpha, beta, r, c));
                undropPiece(c);
                beta = Math.min(beta, best);
                if (beta <= alpha) break;
            }
            return best;
        }
    }

    function scoreWindow(a, b, c, d) {
        const cells = [a, b, c, d];
        const aiCnt = cells.filter(x => x === AI).length;
        const plCnt = cells.filter(x => x === PLAYER).length;
        const emCnt = cells.filter(x => x === EMPTY).length;
        if (aiCnt === 4) return 100;
        if (aiCnt === 3 && emCnt === 1) return 5;
        if (aiCnt === 2 && emCnt === 2) return 2;
        if (plCnt === 3 && emCnt === 1) return -4;
        return 0;
    }

    function scoreBoard() {
        let score = 0;
        // Centre column bonus
        for (let r = 0; r < ROWS; r++) {
            if (board[r][3] === AI) score += 3;
            else if (board[r][3] === PLAYER) score -= 3;
        }
        // Horizontal windows
        for (let r = 0; r < ROWS; r++)
            for (let c = 0; c <= COLS - 4; c++)
                score += scoreWindow(board[r][c], board[r][c+1], board[r][c+2], board[r][c+3]);
        // Vertical windows
        for (let c = 0; c < COLS; c++)
            for (let r = 0; r <= ROWS - 4; r++)
                score += scoreWindow(board[r][c], board[r+1][c], board[r+2][c], board[r+3][c]);
        // Diagonal ↘
        for (let r = 0; r <= ROWS - 4; r++)
            for (let c = 0; c <= COLS - 4; c++)
                score += scoreWindow(board[r][c], board[r+1][c+1], board[r+2][c+2], board[r+3][c+3]);
        // Diagonal ↙
        for (let r = 3; r < ROWS; r++)
            for (let c = 0; c <= COLS - 4; c++)
                score += scoreWindow(board[r][c], board[r-1][c+1], board[r-2][c+2], board[r-3][c+3]);
        return score;
    }

    // ---------- window management ----------

    function show() {
        const wasHidden = win.classList.contains('is-hidden');
        if (!taskbarBtn) taskbarBtn = w95Mgr.addTaskbarBtn('w95-win-connect4', 'CONNECT 4', () => {
            if (win.classList.contains('is-hidden')) show(); else hide();
        });
        win.classList.remove('is-hidden');
        w95Mgr.focusWindow('w95-win-connect4');
        if (wasHidden) ctx.trackWindowOpen('connect4');
    }

    function hide() {
        win.classList.add('is-hidden');
        if (w95Mgr.isActiveWin('w95-win-connect4')) w95Mgr.focusWindow(null);
    }

    function closeWin() {
        if (w95Mgr.isMaximised('w95-win-connect4')) w95Mgr.toggleMaximise(win, 'w95-win-connect4');
        hide();
        if (taskbarBtn) { taskbarBtn.remove(); taskbarBtn = null; }
    }

    minBtn.addEventListener('click', (e) => { e.stopPropagation(); hide(); });
    if (maxBtn) maxBtn.addEventListener('click', (e) => { e.stopPropagation(); w95Mgr.toggleMaximise(win, 'w95-win-connect4'); });
    closeBtn.addEventListener('click', (e) => { e.stopPropagation(); closeWin(); });
    resetBtn.addEventListener('click', () => initGame(true));
    if (modeSelect) modeSelect.addEventListener('change', () => initGame(false));
    if (diffSelect) diffSelect.addEventListener('change', () => { aiDifficulty = diffSelect.value; });
    rematchBtn?.addEventListener('click', () => {
        if (gameMode === 'online') {
            if (rematchBtn) { rematchBtn.textContent = 'Rematch (waiting\u2026)'; rematchBtn.disabled = true; }
            set(ref(database, 'connect4/rematch/' + ctx.getUser()), true).catch(() => {});
        } else {
            initGame(true);
        }
    });

    makeDraggable(win, handle, 'w95-win-connect4');

    w95Apps['connect4'] = { open: () => {
        if (win.classList.contains('is-hidden')) show(); else w95Mgr.focusWindow('w95-win-connect4');
    }};

    initGame();
})();

