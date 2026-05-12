import { database, ref, push, onValue, remove, update } from './firebase.js';
import { w95Mgr, w95Apps, makeDraggable } from './window-manager.js';
import { ctx } from './ctx.js';
import { openW95Dialog } from './win95-dialogs.js';

(() => {
    const WIN_ID   = 'w95-win-reminders';
    const win      = document.getElementById(WIN_ID);
    const handle   = document.getElementById('w95-reminders-handle');
    const minBtn   = document.getElementById('w95-reminders-min');
    const maxBtn   = document.getElementById('w95-reminders-max');
    const closeBtn = document.getElementById('w95-reminders-close');
    const textInput = document.getElementById('rm-text-input');
    const dateInput = document.getElementById('rm-date-input');
    const addBtn    = document.getElementById('rm-add-btn');
    const listEl    = document.getElementById('rm-list');

    if (!win) return;

    let allReminders = {};
    let taskbarBtn   = null;
    let subscribed   = false;

    function getUserReminderRef(path) {
        const user = ctx.getUser();
        if (!user) return null;
        return ref(database, path ? `reminders/${user}/${path}` : `reminders/${user}`);
    }

    // ---- Subscribe to Firebase ----
    function subscribe() {
        if (subscribed) return;
        const r = getUserReminderRef();
        if (!r) return;
        subscribed = true;
        onValue(r, snap => {
            allReminders = snap.val() || {};
            renderList();
            checkReminders();
        });
        setInterval(checkReminders, 30_000);
    }

    // Poll until user is authenticated, then subscribe
    const authPoll = setInterval(() => {
        if (ctx.getUser()) { clearInterval(authPoll); subscribe(); }
    }, 500);

    // ---- Add reminder ----
    function addReminder() {
        const user = ctx.getUser();
        if (!user) return;
        const text  = textInput.value.trim();
        const dueAt = dateInput.value ? new Date(dateInput.value).getTime() : 0;
        if (!text) return;
        if (!dueAt || dueAt <= Date.now()) {
            openW95Dialog({ icon: '(>_<)', title: 'Oops', message: 'Please pick a date and time in the future.' });
            return;
        }
        push(getUserReminderRef(), { text, dueAt, fired: false }).catch(() => {});
        textInput.value = '';
        dateInput.value = '';
    }

    addBtn.addEventListener('click', addReminder);
    textInput.addEventListener('keydown', e => { if (e.key === 'Enter') addReminder(); });

    // ---- Render list ----
    function renderList() {
        listEl.innerHTML = '';
        const entries = Object.entries(allReminders)
            .filter(([, r]) => !r.fired)
            .sort((a, b) => a[1].dueAt - b[1].dueAt);

        if (!entries.length) {
            listEl.innerHTML = '<div class="rm-empty">No reminders set.</div>';
            return;
        }

        entries.forEach(([id, r]) => {
            const d       = new Date(r.dueAt);
            const dateStr = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
            const timeStr = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

            const item   = document.createElement('div');
            item.className = 'rm-item';

            const info   = document.createElement('div');
            info.className = 'rm-item-info';

            const textEl = document.createElement('div');
            textEl.className = 'rm-item-text';
            textEl.textContent = r.text;

            const timeEl = document.createElement('div');
            timeEl.className = 'rm-item-time';
            timeEl.textContent = `${dateStr} at ${timeStr}`;

            const delBtn = document.createElement('button');
            delBtn.className = 'w95-btn rm-item-del';
            delBtn.type = 'button';
            delBtn.textContent = 'Del';
            delBtn.addEventListener('click', () => {
                remove(getUserReminderRef(id)).catch(() => {});
            });

            info.append(textEl, timeEl);
            item.append(info, delBtn);
            listEl.appendChild(item);
        });
    }

    // ---- Check and fire due reminders ----
    function checkReminders() {
        if (!ctx.getUser()) return;
        const now = Date.now();
        Object.entries(allReminders).forEach(([id, r]) => {
            if (!r.fired && r.dueAt <= now) {
                // Mark fired locally immediately to prevent duplicate popups on re-render
                allReminders[id] = { ...r, fired: true };
                update(getUserReminderRef(id), { fired: true }).catch(() => {});
                openW95Dialog({
                    icon: '&#128276;',
                    title: 'Reminder',
                    message: r.text,
                    buttons: [{ label: 'OK', action: null }],
                });
            }
        });
    }

    // ---- Window controls ----
    function show() {
        if (!taskbarBtn) {
            taskbarBtn = w95Mgr.addTaskbarBtn(WIN_ID, '&#128276; Reminders', () => {
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
        hide();
        if (taskbarBtn) { taskbarBtn.remove(); taskbarBtn = null; }
    }

    win.addEventListener('mousedown', () => w95Mgr.focusWindow(WIN_ID));
    minBtn.onclick   = e => { e.stopPropagation(); hide(); };
    maxBtn.onclick   = e => { e.stopPropagation(); w95Mgr.toggleMaximise(win, WIN_ID); };
    closeBtn.onclick = e => { e.stopPropagation(); closeWin(); };

    makeDraggable(win, handle, WIN_ID);

    w95Apps['reminders'] = {
        open: () => {
            if (win.classList.contains('is-hidden')) show(); else w95Mgr.focusWindow(WIN_ID);
        }
    };
})();
