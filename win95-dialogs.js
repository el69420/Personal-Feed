// win95-dialogs.js — Reusable Win95-style dialog helpers.
// No external dependencies; pure DOM-construction utilities.

// openW95Dialog({ icon, title, message, buttons: [{label, action}] })
// Returns { close } — Esc also closes; last button with null action = cancel.
export function openW95Dialog({ icon = '', title = 'Windows', message = '', buttons = [{ label: 'OK', action: null }] } = {}) {
    const overlay = document.createElement('div');
    overlay.className = 'w95-dialog-overlay';

    const bHtml    = buttons.map(b => `<button class="w95-btn w95-dialog-btn" type="button">${b.label}</button>`).join('');
    const iconHtml = icon ? `<div class="w95-dialog-icon">${icon}</div>` : '';

    overlay.innerHTML = `
        <div class="w95-dialog" role="dialog" aria-modal="true">
            <div class="w95-titlebar window--active">
                <div class="w95-title">${title}</div>
                <div class="w95-controls">
                    <button class="w95-control w95-control-close w95-dialog-x" type="button" aria-label="Close">X</button>
                </div>
            </div>
            <div class="w95-dialog-body">
                ${iconHtml}
                <div class="w95-dialog-message"></div>
            </div>
            <div class="w95-dialog-btns">${bHtml}</div>
        </div>`;

    // Set message safely as text content (supports newlines via white-space:pre-wrap in CSS)
    overlay.querySelector('.w95-dialog-message').textContent = message;
    document.body.appendChild(overlay);

    function close() {
        overlay.remove();
        document.removeEventListener('keydown', onKey);
    }

    const btnEls = overlay.querySelectorAll('.w95-dialog-btn');
    btnEls.forEach((btn, i) => {
        btn.addEventListener('click', () => { close(); buttons[i]?.action?.(); });
    });
    overlay.querySelector('.w95-dialog-x')?.addEventListener('click', close);
    overlay.addEventListener('pointerdown', e => { if (e.target === overlay) close(); });

    function onKey(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);

    setTimeout(() => btnEls[0]?.focus(), 0);
    return { close };
}

// Win95-style prompt dialog (single text input)
export function openW95Prompt({ icon = '', title = 'New', message = '', defaultValue = '', onOK } = {}) {
    const overlay = document.createElement('div');
    overlay.className = 'w95-dialog-overlay';
    overlay.innerHTML = `
        <div class="w95-dialog" role="dialog" aria-modal="true">
            <div class="w95-titlebar window--active">
                <div class="w95-title">${title}</div>
                <div class="w95-controls">
                    <button class="w95-control w95-control-close w95-dialog-x" type="button" aria-label="Close">X</button>
                </div>
            </div>
            <div class="w95-dialog-body">
                ${icon ? `<div class="w95-dialog-icon">${icon}</div>` : ''}
                <div style="flex:1">
                    <div class="w95-dialog-message"></div>
                    <input type="text" class="w95-prompt-input" style="width:100%;margin-top:6px;box-sizing:border-box;" autocomplete="off">
                </div>
            </div>
            <div class="w95-dialog-btns">
                <button class="w95-btn w95-dialog-btn" type="button">OK</button>
                <button class="w95-btn w95-dialog-btn" type="button">Cancel</button>
            </div>
        </div>`;
    overlay.querySelector('.w95-dialog-message').textContent = message;
    const inp = overlay.querySelector('.w95-prompt-input');
    inp.value = defaultValue;
    document.body.appendChild(overlay);
    function close()   { overlay.remove(); document.removeEventListener('keydown', onKey); }
    function confirm() { const v = inp.value.trim() || defaultValue; close(); onOK?.(v); }
    const [okBtn, cancelBtn] = overlay.querySelectorAll('.w95-dialog-btn');
    okBtn.addEventListener('click', confirm);
    cancelBtn.addEventListener('click', close);
    overlay.querySelector('.w95-dialog-x').addEventListener('click', close);
    overlay.addEventListener('pointerdown', e => { if (e.target === overlay) close(); });
    function onKey(e) { if (e.key === 'Escape') close(); else if (e.key === 'Enter') confirm(); }
    document.addEventListener('keydown', onKey);
    setTimeout(() => { inp.focus(); inp.select(); }, 0);
}

// Win95-style Notepad dialog (editable text file)
export function openW95Notepad(item, { onSave } = {}) {
    const overlay = document.createElement('div');
    overlay.className = 'w95-dialog-overlay';
    const safeTitle = item.name.replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
    overlay.innerHTML = `
        <div class="w95-dialog" role="dialog" aria-modal="true" style="width:440px;max-width:95vw;">
            <div class="w95-titlebar window--active">
                <div class="w95-title">📝 ${safeTitle}</div>
                <div class="w95-controls">
                    <button class="w95-control w95-control-close w95-dialog-x" type="button" aria-label="Close">X</button>
                </div>
            </div>
            <div class="w95-dialog-body" style="flex-direction:column;align-items:stretch;padding:8px;">
                <textarea class="w95-notepad-area" style="width:100%;height:220px;resize:vertical;font-family:monospace;font-size:13px;padding:6px;box-sizing:border-box;"></textarea>
            </div>
            <div class="w95-dialog-btns">
                <button class="w95-btn w95-dialog-btn" type="button">Save</button>
                <button class="w95-btn w95-dialog-btn" type="button">Close</button>
            </div>
        </div>`;
    const textarea = overlay.querySelector('textarea');
    textarea.value = item.content || '';
    document.body.appendChild(overlay);
    function close() { overlay.remove(); document.removeEventListener('keydown', onKey); }
    const [saveBtn, closeBtn] = overlay.querySelectorAll('.w95-dialog-btn');
    saveBtn.addEventListener('click', () => {
        item.content = textarea.value;
        if (onSave) {
            onSave(item.content);
        } else {
            const items = window._desktopCustom?.getItems() || [];
            const found = items.find(i => i.id === item.id);
            if (found) { found.content = item.content; window._desktopCustom?.saveItems(items); }
        }
        close();
    });
    closeBtn.addEventListener('click', close);
    overlay.querySelector('.w95-dialog-x').addEventListener('click', close);
    overlay.addEventListener('pointerdown', e => { if (e.target === overlay) close(); });
    function onKey(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);
    setTimeout(() => textarea.focus(), 0);
}
