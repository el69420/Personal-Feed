// noticing.js — Lightweight ambient noticing system
//
// Features across the app emit events via:
//   window.noticingSystem.emit('event:name')
//
// This module decides whether and when to surface a short, subtle inline
// message. It is intentionally probabilistic and rate-limited so messages
// feel like quiet observations rather than notifications.

(function () {
  'use strict';

  // ---- Timing config ----
  const DISPLAY_MS      = 4500;         // how long the notice stays on screen
  const GLOBAL_COOLDOWN = 6 * 60_000;   // min gap between any two notices (6 min)
  const TRIGGER_COOLDOWN = 40 * 60_000; // min gap before same trigger fires again (40 min)
  const FIRE_CHANCE     = 0.4;          // 40% — not every eligible trigger shows

  // ---- State ----
  let _lastAt   = 0;
  const _trigAt = {};   // { triggerId: lastFiredTimestamp }
  let _el        = null;
  let _hideTimer = null;

  // ---- Simple pub/sub bus ----
  const _bus = {};

  function on(event, fn) {
    (_bus[event] = _bus[event] || []).push(fn);
  }

  function emit(event, data) {
    (_bus[event] || []).forEach(fn => { try { fn(data); } catch (_) {} });
  }

  // ---- DOM element (lazy, created once) ----
  function _getEl() {
    if (!_el) {
      _el = document.createElement('div');
      _el.id = 'noticing-msg';
      document.body.appendChild(_el);
    }
    return _el;
  }

  // ---- Core display logic ----
  function showNotice(triggerId, message) {
    const now = Date.now();

    // Cooldown gates
    if (now - _lastAt < GLOBAL_COOLDOWN) return;
    if (now - (_trigAt[triggerId] || 0) < TRIGGER_COOLDOWN) return;

    // Probabilistic filter — keeps notices feeling rare
    if (Math.random() > FIRE_CHANCE) return;

    _lastAt = now;
    _trigAt[triggerId] = now;

    const el = _getEl();
    clearTimeout(_hideTimer);

    el.textContent = message;
    el.classList.remove('noticing--out');
    el.classList.add('noticing--in');

    _hideTimer = setTimeout(() => {
      el.classList.remove('noticing--in');
      el.classList.add('noticing--out');
    }, DISPLAY_MS);
  }

  // ---- All triggers and their messages ----
  const NOTICES = {
    // Presence
    'presence:both_online': "you're both here",
    'presence:returned':    "it's been a while",
    'presence:tidied_up':   'someone tidied up',

    // Garden
    'garden:plant_waiting': "this one's been waiting",
    'garden:well_tended':   "this one's been well looked after",
    'garden:something_new': 'something new again',
    'garden:vase_quiet':    "it's been quiet here",
    'garden:vase_crowded':  "it's getting crowded",

    // Pain journal
    'pain:pattern':         'this feels familiar\u2026',
    'pain:both_feeling':    "you've both been feeling this lately",
    'pain:left_something':  'they left something here for you',
    'pain:improving':       'this seems lighter than before',

    // Lists
    'list:both_thinking':   'you were both thinking about this',
    'list:both_reached':    'you both reached for this',
    'list:sitting_here':    'this has been sitting here',
    'list:all_done':        'nothing left for now',
  };

  // Register a handler for every notice type
  Object.entries(NOTICES).forEach(([id, message]) => {
    on(id, () => showNotice(id, message));
  });

  // ---- Expose public API ----
  window.noticingSystem = { on, emit };
})();
