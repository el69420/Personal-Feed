import { database, ref, push, onValue, update, stickyNotesRef } from './firebase.js';
import { w95Mgr, w95Apps, makeDraggable, makeResizable } from './window-manager.js';
import { ctx } from './ctx.js';

// ===== Sticky Notes drawing app =====
(() => {
    const WIN_ID   = 'w95-win-stickynotes';
    const win      = document.getElementById(WIN_ID);
    const handle   = document.getElementById('w95-stickynotes-handle');
    const minBtn   = document.getElementById('w95-stickynotes-min');
    const maxBtn   = document.getElementById('w95-stickynotes-max');
    const closeBtn = document.getElementById('w95-stickynotes-close');

    if (!win || !handle) return;

    const canvas      = document.getElementById('sn-canvas');
    const pen         = canvas.getContext('2d');
    const clearBtn    = document.getElementById('sn-clear-btn');
    const sendBtn     = document.getElementById('sn-send-btn');
    const tabDraw     = document.getElementById('sn-tab-draw');
    const tabInbox    = document.getElementById('sn-tab-inbox');
    const drawPanel   = document.getElementById('sn-draw-panel');
    const inboxPanel  = document.getElementById('sn-inbox-panel');
    const inboxList   = document.getElementById('sn-inbox-list');
    const noteModal   = document.getElementById('sn-note-modal');
    const noteModalImg  = document.getElementById('sn-note-modal-img');
    const noteModalClose = document.getElementById('sn-note-modal-close');
    const unreadBadge   = document.getElementById('sn-unread-badge');
    const colorBtns  = document.querySelectorAll('.sn-color-btn');
    const sizeBtns   = document.querySelectorAll('.sn-size-btn');

    const NOTE_BG = '#FFED6B';

    let isDrawing    = false;
    let currentColor = '#222222';
    let currentSize  = 5;
    let allNotes     = {};
    let taskbarBtn   = null;

    // ---------- Canvas ----------

    function clearCanvas() {
        pen.fillStyle = NOTE_BG;
        pen.fillRect(0, 0, canvas.width, canvas.height);
    }

    function getPos(e) {
        const rect   = canvas.getBoundingClientRect();
        const scaleX = canvas.width  / rect.width;
        const scaleY = canvas.height / rect.height;
        const src    = e.touches ? e.touches[0] : e;
        return {
            x: (src.clientX - rect.left) * scaleX,
            y: (src.clientY - rect.top)  * scaleY,
        };
    }

    function startDraw(e) {
        e.preventDefault();
        isDrawing = true;
        const { x, y } = getPos(e);
        pen.beginPath();
        pen.moveTo(x, y);
        // Draw a dot so single clicks leave a mark
        pen.arc(x, y, currentSize / 2, 0, Math.PI * 2);
        pen.fillStyle = currentColor;
        pen.fill();
        pen.beginPath();
        pen.moveTo(x, y);
    }

    function draw(e) {
        e.preventDefault();
        if (!isDrawing) return;
        const { x, y } = getPos(e);
        pen.lineTo(x, y);
        pen.strokeStyle = currentColor;
        pen.lineWidth   = currentSize;
        pen.lineCap     = 'round';
        pen.lineJoin    = 'round';
        pen.stroke();
        pen.beginPath();
        pen.moveTo(x, y);
    }

    function endDraw() { isDrawing = false; }

    canvas.addEventListener('mousedown',  startDraw);
    canvas.addEventListener('mousemove',  draw);
    canvas.addEventListener('mouseup',    endDraw);
    canvas.addEventListener('mouseleave', endDraw);
    canvas.addEventListener('touchstart', startDraw, { passive: false });
    canvas.addEventListener('touchmove',  draw,      { passive: false });
    canvas.addEventListener('touchend',   endDraw);

    // ---------- Toolbar ----------

    colorBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            colorBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentColor = btn.dataset.color;
        });
    });

    sizeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            sizeBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentSize = parseInt(btn.dataset.size, 10);
        });
    });

    clearBtn.addEventListener('click', clearCanvas);

    sendBtn.addEventListener('click', async () => {
        const from = ctx.getUser();
        if (!from) return;

        sendBtn.disabled    = true;
        sendBtn.textContent = 'Sending…';

        try {
            const imageData = canvas.toDataURL('image/png');
            await push(stickyNotesRef, { from, imageData, timestamp: Date.now(), seen: false });
            clearCanvas();
            sendBtn.textContent = 'Sent! ✓';
            if (ctx.sparkSound) ctx.sparkSound('post');
            setTimeout(() => {
                sendBtn.disabled    = false;
                sendBtn.textContent = 'Send Note ✉';
            }, 1800);
        } catch (err) {
            console.error('[sticky-notes] send failed', err);
            sendBtn.disabled    = false;
            sendBtn.textContent = 'Send Note ✉';
        }
    });

    // ---------- Tabs ----------

    function switchToTab(tab) {
        const isDraw = tab === 'draw';
        tabDraw.classList.toggle('active', isDraw);
        tabInbox.classList.toggle('active', !isDraw);
        drawPanel.classList.toggle('is-hidden', !isDraw);
        inboxPanel.classList.toggle('is-hidden', isDraw);
        if (!isDraw) {
            markAllSeen();
            renderInbox();
        }
    }

    tabDraw.addEventListener('click',  () => switchToTab('draw'));
    tabInbox.addEventListener('click', () => switchToTab('inbox'));

    // ---------- Firebase ----------

    function markAllSeen() {
        const me = ctx.getUser();
        if (!me) return;
        Object.entries(allNotes).forEach(([id, note]) => {
            if (note.from !== me && !note.seen) {
                update(ref(database, `stickyNotes/${id}`), { seen: true });
            }
        });
    }

    onValue(stickyNotesRef, snap => {
        allNotes = snap.val() || {};
        updateBadge();
        if (!inboxPanel.classList.contains('is-hidden')) renderInbox();
    });

    // ---------- Inbox ----------

    function updateBadge() {
        const me      = ctx.getUser();
        const unread  = me
            ? Object.values(allNotes).filter(n => n.from !== me && !n.seen).length
            : 0;

        if (unreadBadge) {
            unreadBadge.textContent = unread;
            unreadBadge.classList.toggle('is-hidden', unread === 0);
        }

        // Desktop icon badge
        const icon = document.querySelector('[data-app="stickynotes"]');
        if (!icon) return;
        let badge = icon.querySelector('.sn-desktop-badge');
        if (unread > 0) {
            if (!badge) {
                badge = document.createElement('div');
                badge.className = 'sn-desktop-badge';
                icon.appendChild(badge);
            }
            badge.textContent = unread;
        } else if (badge) {
            badge.remove();
        }
    }

    function renderInbox() {
        const me = ctx.getUser();
        if (!me) {
            inboxList.innerHTML = '<p class="sn-empty">Sign in to view notes.</p>';
            return;
        }

        const received = Object.entries(allNotes)
            .filter(([, n]) => n.from !== me)
            .sort((a, b) => b[1].timestamp - a[1].timestamp);

        if (received.length === 0) {
            inboxList.innerHTML = '<p class="sn-empty">No notes yet — draw something!</p>';
            return;
        }

        inboxList.innerHTML = '';
        received.forEach(([, note]) => {
            const card = document.createElement('div');
            card.className = 'sn-note-thumb' + (note.seen ? '' : ' sn-note-unread');

            const img = document.createElement('img');
            img.src = note.imageData;
            img.alt = 'Note from ' + note.from;

            const meta = document.createElement('div');
            meta.className = 'sn-note-meta';
            const d = new Date(note.timestamp);
            meta.textContent = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' });

            card.append(img, meta);
            card.addEventListener('click', () => openModal(note));
            inboxList.appendChild(card);
        });
    }

    function openModal(note) {
        noteModalImg.src = note.imageData;
        noteModal.classList.remove('is-hidden');
    }

    noteModalClose.addEventListener('click', () => noteModal.classList.add('is-hidden'));
    noteModal.addEventListener('click', e => { if (e.target === noteModal) noteModal.classList.add('is-hidden'); });

    // ---------- Window controls ----------

    function show() {
        if (!taskbarBtn) {
            taskbarBtn = w95Mgr.addTaskbarBtn(WIN_ID, '✏ Notes', () => {
                if (win.classList.contains('is-hidden')) show(); else hide();
            });
        }
        win.classList.remove('is-hidden');
        w95Mgr.focusWindow(WIN_ID);
    }

    function hide() {
        win.classList.add('is-hidden');
        if (w95Mgr.isActiveWin(WIN_ID)) w95Mgr.focusWindow(null);
    }

    function closeWin() {
        if (w95Mgr.isMaximised && w95Mgr.isMaximised(WIN_ID)) w95Mgr.toggleMaximise(win, WIN_ID);
        win.classList.add('is-hidden');
        if (w95Mgr.isActiveWin(WIN_ID)) w95Mgr.focusWindow(null);
        if (taskbarBtn) { taskbarBtn.remove(); taskbarBtn = null; }
    }

    win.addEventListener('mousedown', () => w95Mgr.focusWindow(WIN_ID));
    minBtn.onclick   = e => { e.stopPropagation(); hide(); };
    maxBtn.onclick   = e => { e.stopPropagation(); w95Mgr.toggleMaximise(win, WIN_ID); };
    closeBtn.onclick = e => { e.stopPropagation(); closeWin(); };

    makeDraggable(win, handle, WIN_ID);
    makeResizable(win, WIN_ID);

    w95Apps['stickynotes'] = {
        open: () => {
            if (win.classList.contains('is-hidden')) show(); else w95Mgr.focusWindow(WIN_ID);
        }
    };

    // Initialise canvas background
    clearCanvas();
})();
