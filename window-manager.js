import { ctx } from './ctx.js';

const TASKBAR_H = 40;  // height of the Win95 taskbar in px
const MIN_VIS   = 60;  // minimum px of a window that must remain on-screen

let w95TopZ = 2000;

// ===== Win95 shared window manager =====
const w95Mgr = (() => {
  const _maxState = {}; // winId -> { isMax, prevRect }
  let _activeWinId = null;
  const _btns = {}; // winId -> taskbar btn element

  function addTaskbarBtn(winId, label, onToggle) {
    const taskbar = document.getElementById('w95-taskbar');
    if (!taskbar) return null;
    const btn = document.createElement('button');
    btn.className = 'w95-btn';
    btn.type = 'button';
    btn.textContent = label;
    // 3-way toggle: hidden→show | visible+active→minimize | visible+inactive→focus
    btn.addEventListener('click', () => {
      const win = document.getElementById(winId);
      if (!win || win.classList.contains('is-hidden')) {
        onToggle();
      } else if (_activeWinId === winId) {
        onToggle();
      } else {
        focusWindow(winId);
      }
    });
    const trayEl = document.getElementById('systemTray') || taskbar.querySelector('.w95-tray');
    if (trayEl) taskbar.insertBefore(btn, trayEl);
    else taskbar.appendChild(btn);
    _btns[winId] = btn;
    return btn;
  }

  function setPressed(btn, pressed) {
    if (!btn) return;
    btn.classList.toggle('is-pressed', pressed);
  }

  function focusWindow(winId) {
    // Clean up any detached btn references
    Object.keys(_btns).forEach(id => { if (!_btns[id].isConnected) delete _btns[id]; });
    // Clear active state from all windows and taskbar buttons
    document.querySelectorAll('.w95-window').forEach(w => w.classList.remove('window--active'));
    Object.values(_btns).forEach(b => b.classList.remove('is-active'));
    _activeWinId = null;
    if (!winId) return;
    const win = document.getElementById(winId);
    if (!win || win.classList.contains('is-hidden')) return;
    win.classList.add('window--active');
    win.style.zIndex = ++w95TopZ;
    _activeWinId = winId;
    if (_btns[winId]) _btns[winId].classList.add('is-active');
  }

  function isActiveWin(winId) { return _activeWinId === winId; }

  function toggleMaximise(win, winId) {
    if (!_maxState[winId]) _maxState[winId] = { isMax: false, prevRect: null };
    const st = _maxState[winId];
    if (st.isMax) {
      win.classList.remove('is-maximised');
      if (st.prevRect) {
        const r = st.prevRect;
        win.style.left   = r.left + 'px';
        win.style.top    = r.top  + 'px';
        win.style.width  = r.w    + 'px';
        win.style.height = r.h    + 'px';
      }
      st.isMax = false;
    } else {
      const r = win.getBoundingClientRect();
      st.prevRect = { left: r.left, top: r.top, w: r.width, h: r.height };
      win.classList.add('is-maximised');
      st.isMax = true;
    }
  }

  function isMaximised(winId) { return !!_maxState[winId]?.isMax; }

  // Used by w95Layout on page load to re-seed in-memory max state from localStorage
  function restoreMaxState(winId, prevRect) {
    if (!_maxState[winId]) _maxState[winId] = { isMax: false, prevRect: null };
    _maxState[winId].isMax = true;
    _maxState[winId].prevRect = prevRect || null;
  }

  return { addTaskbarBtn, setPressed, focusWindow, isActiveWin, toggleMaximise, isMaximised, restoreMaxState };
})();

// ===== Window layout persistence (size / position / max state) =====
const w95Layout = (() => {
  function _key(winId)  { return 'w95_layout_' + winId; }
  function _load(winId) {
    try { return JSON.parse(localStorage.getItem(_key(winId))); } catch (e) { return null; }
  }
  function _store(winId, data) {
    try { localStorage.setItem(_key(winId), JSON.stringify(data)); } catch (e) {}
  }

  /** Persist current size/position.  No-op when window is maximised. */
  function save(winEl, winId) {
    if (w95Mgr.isMaximised(winId)) return;
    const r = winEl.getBoundingClientRect();
    const existing = _load(winId) || {};
    _store(winId, { ...existing, left: r.left, top: r.top, w: r.width, h: r.height });
  }

  /** Persist maximise state; call with the pre-maximise rect when maximising. */
  function saveMaxState(winId, isMax, prevRect) {
    const existing = _load(winId) || {};
    _store(winId, { ...existing, isMax, prevRect: prevRect || existing.prevRect || null });
  }

  /** Apply saved layout to window element.  Returns the stored data (or null). */
  function restore(winEl, winId) {
    const data = _load(winId);
    if (!data) return null;
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight - TASKBAR_H;
    if (data.w) {
      const cssMinW = parseFloat(getComputedStyle(winEl).minWidth) || 200;
      winEl.style.width  = Math.max(cssMinW, Math.min(vw, data.w)) + 'px';
    }
    if (data.h) {
      const _cs = getComputedStyle(winEl);
      const cssMinH = parseFloat(_cs.minHeight) || 80;
      const cssMaxH = parseFloat(_cs.maxHeight);
      const capH = isFinite(cssMaxH) ? Math.min(vh, cssMaxH) : vh;
      winEl.style.height = Math.max(cssMinH, Math.min(capH, data.h)) + 'px';
    }
    const w    = data.w || winEl.offsetWidth  || 280;
    const h    = data.h || winEl.offsetHeight || 200;
    const left = Math.max(MIN_VIS - w, Math.min(vw - MIN_VIS, data.left ?? 20));
    const top  = Math.max(0,           Math.min(vh - h,        data.top  ?? 20));
    winEl.style.left = left + 'px';
    winEl.style.top  = top  + 'px';
    return data;
  }

  /** Push a visible, non-maximised window back inside the viewport. */
  function clamp(winEl) {
    if (winEl.classList.contains('is-maximised') || winEl.classList.contains('is-hidden')) return;
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight - TASKBAR_H;
    const r  = winEl.getBoundingClientRect();
    const left = Math.max(MIN_VIS - r.width,  Math.min(vw - MIN_VIS, r.left));
    const top  = Math.max(0,                  Math.min(vh - r.height, r.top));
    if (Math.round(left) !== Math.round(r.left)) winEl.style.left = left + 'px';
    if (Math.round(top)  !== Math.round(r.top))  winEl.style.top  = top  + 'px';
    if (r.height > vh) winEl.style.height = vh + 'px';
    if (r.width  > vw) winEl.style.width  = vw + 'px';
  }

  return { save, saveMaxState, restore, clamp };
})();

// Wrap toggleMaximise so maximise/restore state is persisted to localStorage.
{
  const _orig = w95Mgr.toggleMaximise;
  w95Mgr.toggleMaximise = function (win, winId) {
    const wasMax = w95Mgr.isMaximised(winId);
    // Capture pre-maximise rect before the original handler runs
    let prevRect = null;
    if (!wasMax) {
      const r = win.getBoundingClientRect();
      prevRect = { left: r.left, top: r.top, w: r.width, h: r.height };
    }
    _orig(win, winId);
    w95Layout.saveMaxState(winId, w95Mgr.isMaximised(winId), prevRect);
  };
}

// Registry so desktop icons can open windows via a shared open() callback
const w95Apps = {};


function makeDraggable(winEl, handleEl, winId) {
  let dragging = false, startX = 0, startY = 0, winStartX = 0, winStartY = 0;
  handleEl.addEventListener('mousedown', (e) => {
    if (e.target.closest('button')) return;
    if (w95Mgr.isMaximised(winId)) return;
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    const r = winEl.getBoundingClientRect();
    winStartX = r.left;
    winStartY = r.top;
    // z-index / focus already handled by the generic capture handler on the window
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight - TASKBAR_H;
    winEl.style.left = Math.max(MIN_VIS - winEl.offsetWidth, Math.min(vw - MIN_VIS, winStartX + (e.clientX - startX))) + 'px';
    winEl.style.top  = Math.max(0, Math.min(vh - winEl.offsetHeight, winStartY + (e.clientY - startY))) + 'px';
  });
  window.addEventListener('mouseup', () => {
    if (dragging) {
        dragging = false;
        w95Layout.save(winEl, winId);
        // Track window moves for Window Tinkerer achievement
        const moves = Number(localStorage.getItem('windowMoveCount') || 0) + 1;
        localStorage.setItem('windowMoveCount', String(moves));
        if (moves >= 20) ctx.unlock('window_tinkerer');
    }
  });
}

// ===== CUSTOM WINDOW RESIZE =====
// Adds 8 resize handles (4 edges + 4 corners) to a window element.
// Replaces the native CSS resize:both, which conflicted with scroll bars.
function makeResizable(winEl, winId) {
  ['n','ne','e','se','s','sw','w','nw'].forEach(dir => {
    const h = document.createElement('div');
    h.className = 'w95-resize-handle ' + dir;
    h.dataset.dir = dir;
    winEl.appendChild(h);
  });
}

// Single global resize state – shared across all windows.
let _winResizeState = null;

document.addEventListener('mousedown', (e) => {
  const handle = e.target.closest('.w95-resize-handle');
  if (!handle) return;
  const winEl = handle.closest('.w95-window');
  if (!winEl) return;
  const winId = winEl.id;
  if (w95Mgr.isMaximised(winId)) return;
  const r = winEl.getBoundingClientRect();
  _winResizeState = {
    winEl, winId,
    dir: handle.dataset.dir,
    startX: e.clientX, startY: e.clientY,
    startW: r.width, startH: r.height,
    startL: r.left, startT: r.top
  };
  e.preventDefault();
  e.stopPropagation();
}, true);

window.addEventListener('mousemove', (e) => {
  if (!_winResizeState) return;
  const { winEl, dir, startX, startY, startW, startH, startL, startT } = _winResizeState;
  const dx = e.clientX - startX;
  const dy = e.clientY - startY;
  const MIN_W = 200, MIN_H = 80;
  const MAX_W = document.documentElement.clientWidth;
  const MAX_H = document.documentElement.clientHeight - TASKBAR_H;
  let newW = startW, newH = startH, newL = startL, newT = startT;
  if (dir.includes('e')) newW = Math.min(MAX_W, Math.max(MIN_W, startW + dx));
  if (dir.includes('s')) newH = Math.min(MAX_H - startT, Math.max(MIN_H, startH + dy));
  if (dir.includes('w')) { newW = Math.min(MAX_W, Math.max(MIN_W, startW - dx)); newL = startL + startW - newW; }
  if (dir.includes('n')) { newH = Math.min(MAX_H, Math.max(MIN_H, startH - dy)); newT = startT + startH - newH; if (newT < 0) { newH += newT; newT = 0; } }
  winEl.style.width  = newW + 'px';
  winEl.style.height = newH + 'px';
  winEl.style.left   = newL + 'px';
  winEl.style.top    = newT + 'px';
});

window.addEventListener('mouseup', () => {
  if (_winResizeState) {
    w95Layout.save(_winResizeState.winEl, _winResizeState.winId);
    _winResizeState = null;
  }
});


/** Read current top z without incrementing — use for overlays that should float above all windows */
function peekTopZ() { return w95TopZ; }
/** Claim the next z-index slot (increments the counter) — use when a new window/layer needs focus */
function nextTopZ() { return ++w95TopZ; }

export { w95Mgr, w95Apps, w95Layout, makeDraggable, makeResizable, peekTopZ, nextTopZ };
