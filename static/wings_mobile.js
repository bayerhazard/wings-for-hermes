// wings_mobile.js — Wings-only Mobile-/iOS-PWA-Schicht (ab 26.9.4)
//
// Enthält bewusst NUR Wings-Code und fasst keine Upstream-Dateien an, damit
// Upstream-Syncs sauber bleiben (siehe wings_update.md, Preserve-Liste).
//
// Aufgabe 1: Safe-Area-Fallback für die iOS-26.1-Regression (WebKit #301994).
//   In der installierten PWA liefert env(safe-area-inset-top) dort 0, obwohl
//   der Inhalt bis unter die Dynamic Island reicht -> die Navbar läge unter der
//   Uhr. Wir messen env() real; nur wenn es 0 ist UND wir in einer
//   iOS-Standalone-App im Hochformat sind, setzen wir die Fallback-Variablen,
//   die wings.css über max(...) einliest. Ist der Bug behoben, gewinnt env().
(function () {
  'use strict';

  var root = document.documentElement;

  // Hochformat-Höhe (CSS-px) -> {top, bottom} der Geräte-Safe-Area.
  // Nur genutzt, wenn env() nachweislich 0 liefert. Bottom ist ab iPhone X 34.
  var DEVICE_INSETS = [
    [956, 62, 34], // 16 Pro Max
    [932, 59, 34], // 15 Pro Max / 14 Pro Max / 16 Plus
    [926, 47, 34], // 13 Pro Max / 12 Pro Max
    [896, 44, 34], // 11 Pro Max / XS Max / XR / 11
    [874, 59, 34], // 16 Pro
    [852, 59, 34], // 15 Pro / 15 / 16 / 14 Pro
    [844, 47, 34], // 14 / 13 / 12
    [812, 44, 34], // X / XS / 11 Pro / 12 mini / 13 mini
    [780, 50, 34]  // 12 mini (Zoom-Anzeigemodus)
  ];

  function isIOSStandalone() {
    try {
      var ios = /iPad|iPhone|iPod/.test(navigator.userAgent || '') ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      if (!ios) return false;
      return navigator.standalone === true ||
        (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
    } catch (_) { return false; }
  }

  function isPortrait() {
    try {
      if (window.matchMedia) return window.matchMedia('(orientation: portrait)').matches;
      return window.innerHeight >= window.innerWidth;
    } catch (_) { return true; }
  }

  // Misst einen env()-Inset real über ein Hilfselement.
  function probeInset(prop) {
    var el = document.createElement('div');
    el.style.cssText = 'position:fixed;top:0;left:-9999px;width:1px;height:env(' + prop + ',0px);';
    (document.body || root).appendChild(el);
    var h = el.getBoundingClientRect().height;
    if (el.parentNode) el.parentNode.removeChild(el);
    return isFinite(h) ? h : 0;
  }

  function guessInset() {
    var h = Math.max(window.screen && window.screen.width || 0,
                     window.screen && window.screen.height || 0);
    for (var i = 0; i < DEVICE_INSETS.length; i++) {
      if (h >= DEVICE_INSETS[i][0]) return { top: DEVICE_INSETS[i][1], bottom: DEVICE_INSETS[i][2] };
    }
    return { top: 20, bottom: 0 };
  }

  function clearFallbacks() {
    root.style.removeProperty('--wings-safe-top-fallback');
    root.style.removeProperty('--wings-safe-bottom-fallback');
  }

  function syncSafeArea() {
    if (!isIOSStandalone() || !isPortrait()) { clearFallbacks(); return; }
    var top = probeInset('safe-area-inset-top');
    var bottom = probeInset('safe-area-inset-bottom');
    if (top > 0 && bottom > 0) { clearFallbacks(); return; }
    var guess = guessInset();
    if (top <= 0) root.style.setProperty('--wings-safe-top-fallback', guess.top + 'px');
    if (bottom <= 0) root.style.setProperty('--wings-safe-bottom-fallback', guess.bottom + 'px');
  }

  var raf = 0;
  function scheduleSync() {
    if (raf) return;
    raf = window.requestAnimationFrame ? window.requestAnimationFrame(function () {
      raf = 0; syncSafeArea();
    }) : (syncSafeArea(), 0);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleSync, { once: true });
  } else {
    scheduleSync();
  }
  window.addEventListener('orientationchange', scheduleSync);
  window.addEventListener('resize', scheduleSync);

  // Für Diagnose/Support: manuelles Nachmessen erlauben.
  window.wingsSyncSafeArea = syncSafeArea;
})();

// Aufgabe 2 (M4b): Long-Press auf eine Nachricht öffnet ein iOS-artiges
// Bottom-Sheet. Es spiegelt bewusst NUR die real vorhandenen Aktionen der
// Nachricht (die .msg-action-btn der Zeile) — kein erfundenes Verzweigen oder
// Löschen, das es für Nachrichten nicht gibt. Der Klick auf einen Eintrag geht
// an den Original-Button, damit `this` und die bestehende Logik intakt bleiben.
(function () {
  'use strict';

  var LP_DELAY = 600;      // ms — bewusst über iOS' Textauswahl-Callout
  var MOVE_TOL = 9;        // px — darüber ist es ein Scroll, kein Long-Press
  var MAX_TEXT = 220;      // Zeichen für die Kopfzeile des Sheets

  var timer = null;
  var start = null;
  var pressedRow = null;
  var scrim = null;

  function rowFrom(target) {
    if (!target || !target.closest) return null;
    // Bedienelemente und die Aktionsleiste selbst nie abfangen
    if (target.closest('button,a,input,textarea,select,[contenteditable="true"],.msg-actions,.msg-action-btn,.selected-text-reply-btn')) return null;
    return target.closest('.assistant-turn,.msg-row');
  }

  function visibleActions(row) {
    var found = row.querySelectorAll('.msg-action-btn');
    var out = [];
    for (var i = 0; i < found.length; i++) {
      var b = found[i];
      var cs = window.getComputedStyle(b);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      out.push(b);
    }
    return out;
  }

  function labelFor(btn) {
    return (btn.getAttribute('title') || btn.getAttribute('aria-label') || '').trim();
  }

  function clearTimer() {
    if (timer) { clearTimeout(timer); timer = null; }
    if (pressedRow) { pressedRow.classList.remove('wings-msg-pressing'); pressedRow = null; }
  }

  function onStart(e) {
    if (scrim) return;
    if (!e.touches || e.touches.length !== 1) return;
    var row = rowFrom(e.target);
    if (!row) return;
    if (!visibleActions(row).length) return;
    var t = e.touches[0];
    start = { x: t.clientX, y: t.clientY };
    pressedRow = row;
    row.classList.add('wings-msg-pressing');
    timer = setTimeout(function () {
      timer = null;
      var row2 = pressedRow;
      pressedRow = null;
      if (!row2) return;
      row2.classList.remove('wings-msg-pressing');
      // Hat iOS parallel eine Textauswahl gestartet, gewinnt die Auswahl.
      try {
        var sel = window.getSelection && window.getSelection();
        if (sel && String(sel).length > 0) return;
      } catch (_) {}
      openSheet(row2);
    }, LP_DELAY);
  }

  function onMove(e) {
    if (!start || !e.touches || !e.touches.length) return;
    var t = e.touches[0];
    if (Math.abs(t.clientX - start.x) > MOVE_TOL || Math.abs(t.clientY - start.y) > MOVE_TOL) clearTimer();
  }

  function onEnd() { start = null; clearTimer(); }

  function messageText(row) {
    var body = row.querySelector('.msg-body') || row.querySelector('.msg-text') || row;
    var txt = (body.textContent || '').replace(/\s+/g, ' ').trim();
    return txt.length > MAX_TEXT ? txt.slice(0, MAX_TEXT - 1) + '…' : txt;
  }

  function roleLabel(row) {
    var roleEl = row.closest('[data-role]');
    var role = roleEl ? roleEl.getAttribute('data-role') : '';
    if (!role) role = row.classList.contains('assistant-turn') ? 'assistant' : '';
    if (role === 'user') return 'Nachricht';
    if (role === 'assistant') return 'Antwort';
    return 'Nachricht';
  }

  function closeSheet() {
    if (!scrim) return;
    scrim.remove();
    scrim = null;
    document.removeEventListener('keydown', onKey, true);
    var scroller = document.getElementById('messages');
    if (scroller) scroller.removeEventListener('scroll', closeSheet);
  }

  function onKey(e) {
    if (e.key === 'Escape') { e.stopPropagation(); closeSheet(); }
  }

  function openSheet(row) {
    closeSheet();
    var actions = visibleActions(row);
    if (!actions.length) return;

    // Eine laufende native Textauswahl ausblenden, sonst steht der Callout
    // über unserem Sheet.
    try { var s = window.getSelection && window.getSelection(); if (s) s.removeAllRanges(); } catch (_) {}

    scrim = document.createElement('div');
    scrim.className = 'wings-sheet-scrim';
    scrim.addEventListener('click', function (e) { if (e.target === scrim) closeSheet(); });

    var sheet = document.createElement('div');
    sheet.className = 'wings-sheet';
    sheet.setAttribute('role', 'menu');

    var grab = document.createElement('div');
    grab.className = 'wings-sheet-grab';
    sheet.appendChild(grab);

    var head = document.createElement('div');
    head.className = 'wings-sheet-head';
    head.textContent = roleLabel(row) + ' · ' + messageText(row);
    sheet.appendChild(head);

    actions.forEach(function (btn) {
      var label = labelFor(btn);
      if (!label) return;
      var item = document.createElement('button');
      item.type = 'button';
      item.className = 'wings-sheet-item';
      item.setAttribute('role', 'menuitem');
      var icon = btn.querySelector('svg');
      if (icon) item.appendChild(icon.cloneNode(true));
      var span = document.createElement('span');
      span.textContent = label;
      item.appendChild(span);
      item.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        closeSheet();
        try { btn.click(); } catch (_) {}
      });
      sheet.appendChild(item);
    });

    var cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'wings-sheet-cancel';
    cancel.textContent = 'Abbrechen';
    cancel.addEventListener('click', function (e) { e.preventDefault(); closeSheet(); });
    sheet.appendChild(cancel);

    scrim.appendChild(sheet);
    document.body.appendChild(scrim);
    document.addEventListener('keydown', onKey, true);
    var scroller = document.getElementById('messages');
    if (scroller) scroller.addEventListener('scroll', closeSheet, { passive: true });
  }

  document.addEventListener('touchstart', onStart, { passive: true, capture: true });
  document.addEventListener('touchmove', onMove, { passive: true, capture: true });
  document.addEventListener('touchend', onEnd, { passive: true, capture: true });
  document.addEventListener('touchcancel', onEnd, { passive: true, capture: true });

  window.wingsCloseMessageSheet = function () { closeSheet(); };
})();
