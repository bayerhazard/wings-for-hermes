/* Wings Activity Line — one calm line for run activity.
 *
 * Replaces the per-event rendering (one row per tool call, one block per
 * thinking trace) with a single line at the top of every assistant turn:
 *
 *   live:     ● search_files · /workspace      (label swaps in place)
 *             ● Thinking · the user wants…     (shimmering verb, live preview)
 *   settled:    3 actions · 7s              ›  (click expands the full trace)
 *
 * This is a presentation layer only: the underlying event rows are left
 * untouched and simply hidden/shown via turn-level CSS classes, so every
 * existing expand/copy/detail affordance keeps working when the trace is
 * expanded. State flows from the DOM (MutationObserver, rAF-debounced), never
 * from the event pipeline, so the line stays correct across live streaming,
 * settle reconciliation, session switches and history restores.
 */
(function () {
  'use strict';

  const ROW_SEL = '.transparent-event-row';
  // The turn is "live" until the system converts the live turn into a settled
  // turn. The durable signal is the turn-level marker (the same one the rest of
  // the app uses at ui.js isLive): the #liveAssistantTurn id or
  // data-live-assistant-turn="1". Per-segment [data-live-assistant="1"] markers
  // are removed mid-stream, so they must NOT gate the live line.
  const LIVE_SEL = '#liveAssistantTurn,[data-live-assistant-turn="1"]';

  let _scheduled = false;

  function _t(key, ...args) {
    try { if (typeof t === 'function') { const v = t(key, ...args); if (v && v !== key) return v; } } catch (e) {}
    return key;
  }

  function _blocks(turn) { return turn.querySelector('.assistant-turn-blocks'); }

  function _activityRows(turn) {
    const blocks = _blocks(turn);
    if (!blocks) return [];
    return Array.from(blocks.querySelectorAll(ROW_SEL + ':not([data-compression-card])'));
  }

  function _isLive(turn) {
    // A turn is live if it carries the turn-level live marker itself, or still
    // has any live segment row inside it.
    if (turn.id === 'liveAssistantTurn' || turn.getAttribute('data-live-assistant-turn') === '1') return true;
    return !!turn.querySelector('[data-live-assistant="1"],[data-live-tid],[data-live-thinking]');
  }

  function _toolCount(turn) {
    const stashed = Number(turn.getAttribute('data-transparent-total-tool-count'));
    const rows = _activityRows(turn).filter(r => r.getAttribute('data-event-type') === 'tool');
    return (Number.isFinite(stashed) && stashed > rows.length) ? stashed : rows.length;
  }

  function _turnDuration(turn) {
    const el = turn.querySelector('.msg-duration-inline');
    const raw = el ? String(el.textContent || '').replace(/^\s*Done in\s+/i, '').trim() : '';
    return raw;
  }

  /* Latest live activity as {state, verb, preview} — what the user should
     read right now. Live rows in the transparent stream do NOT carry
     data-live-* markers, so we walk the activity rows newest→oldest and take
     the newest tool/thinking row as the current action; prose segments are
     skipped (the last action remains the story while the answer streams). */
  function _liveActivity(turn) {
    const rows = _activityRows(turn);
    for (let i = rows.length - 1; i >= 0; i--) {
      const row = rows[i];
      const type = row.getAttribute('data-event-type');
      if (type === 'tool') {
        const name = (row.querySelector('.tool-card-name') || {}).textContent || '';
        const preview = (row.querySelector('.tool-card-preview') || {}).textContent || '';
        return { state: 'tool', verb: name.trim(), preview: preview.trim() };
      }
      if (type === 'thinking') {
        const prevEl = row.querySelector('.transparent-event-thinking-preview,.thinking-card-preview,.transparent-event-preview');
        const preview = (prevEl ? prevEl.textContent : '') || '';
        return { state: 'thinking', verb: _t('wings_activity_thinking'), preview: preview.trim() };
      }
    }
    return { state: 'working', verb: _t('wings_activity_working'), preview: '' };
  }

  function _ensureLine(turn) {
    let line = turn.querySelector(':scope > .wings-aline');
    if (line) return line;
    line = document.createElement('div');
    line.className = 'wings-aline';
    line.setAttribute('role', 'button');
    line.setAttribute('tabindex', '0');
    line.setAttribute('aria-label', _t('wings_activity_toggle'));
    line.innerHTML =
      '<span class="wings-aline-dot" aria-hidden="true"></span>' +
      '<span class="wings-aline-verb"></span>' +
      '<span class="wings-aline-preview"></span>' +
      '<span class="wings-aline-chevron" aria-hidden="true"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg></span>';
    const toggle = () => { turn.classList.toggle('wings-aline-open'); };
    line.addEventListener('click', toggle);
    line.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); toggle(); }
    });
    // Sibling of .assistant-turn-blocks (outside the re-rendered zone) so the
    // line survives the system's block-level reconciliation.
    const blocks = _blocks(turn);
    turn.insertBefore(line, blocks || null);
    return line;
  }

  function _setContent(line, state, verb, preview) {
    const v = line.querySelector('.wings-aline-verb');
    const p = line.querySelector('.wings-aline-preview');
    const nv = verb || '', np = preview || '';
    if (v.textContent === nv && p.textContent === np && line.dataset.state === state) return;
    // Thinking previews stream continuously — update in place, no swap motion.
    if (state === 'thinking' && line.dataset.state === 'thinking') {
      v.textContent = nv; p.textContent = np; line.dataset.state = state; return;
    }
    v.classList.add('wings-aline-swap');
    p.classList.add('wings-aline-swap');
    setTimeout(() => {
      v.textContent = nv; p.textContent = np;
      line.dataset.state = state;
      v.classList.remove('wings-aline-swap');
      p.classList.remove('wings-aline-swap');
    }, 150);
  }

  function _reconcileTurn(turn) {
    const rows = _activityRows(turn);
    const live = _isLive(turn);
    if (!rows.length && !live) {
      // No activity on this turn — remove a stale line and any state classes.
      const stale = turn.querySelector(':scope > .wings-aline');
      if (stale) stale.remove();
      turn.classList.remove('wings-aline-managed', 'wings-aline-live');
      return;
    }
    turn.classList.add('wings-aline-managed');
    turn.classList.toggle('wings-aline-live', live);
    const line = _ensureLine(turn);
    if (live) {
      const a = _liveActivity(turn);
      _setContent(line, a.state, a.verb, a.preview);
    } else {
      const n = _toolCount(turn);
      const dur = _turnDuration(turn);
      const verb = n === 1 ? _t('wings_activity_action_one')
        : _t('wings_activity_actions_many', n);
      _setContent(line, 'settled', verb, dur);
    }
  }

  function _reconcile() {
    _scheduled = false;
    const inner = document.getElementById('msgInner');
    if (!inner) return;
    inner.querySelectorAll('.assistant-turn').forEach(_reconcileTurn);
  }

  function _schedule() {
    if (_scheduled) return;
    _scheduled = true;
    requestAnimationFrame(_reconcile);
  }

  function init() {
    const inner = document.getElementById('msgInner');
    if (!inner) { setTimeout(init, 400); return; }
    const mo = new MutationObserver(_schedule);
    mo.observe(inner, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['data-live-tid', 'data-live-thinking', 'data-live-assistant', 'data-live-assistant-turn', 'data-event-type', 'data-transparent-total-tool-count'] });
    _schedule();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
