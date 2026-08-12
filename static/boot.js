// Early boot initialization that must run before any other code.
// These run during script evaluation to handle server-stopped state
// and cross-tab shutdown broadcasts as early as possible.
(function(){
  // Clear stale stop-server flag on successful page load (server is reachable)
  try{localStorage.removeItem('wings-server-stopped');}catch(_){}
  // Listen for shutdown broadcast from other tabs
  try {
    var _stopChan = new BroadcastChannel('wings-shutdown');
    _stopChan.onmessage = function() { _showServerStopped(); };
  } catch(_) {}
})();

// cancelStream: stop the active chat stream.
// See docs/rfcs/webui-run-state-consistency-contract.md (Invariants #2, #4)
// for the owner-aware + terminal-settle rationale.
async function cancelStream(reason){
  const sid = S.session && S.session.session_id;
  const streamId = S.activeStreamId;
  if(!streamId) return false;
  // Interrupt provenance: log WHY the active run is being cancelled so operators
  // can tell an explicit Stop / interrupt from any other trigger when they see a
  // SIGINT/exit-code-130 in the backend logs. Only explicit user paths reach
  // this function (Stop button, /stop, /interrupt, busy-interrupt); passive
  // lifecycle events — session switch, tab hide, page unload — tear down the
  // LOCAL SSE transport via closeLiveStream() and never call /api/chat/cancel,
  // so they never interrupt the backend agent/tool run. (#5345)
  const _reason = reason || 'explicit-cancel';
  if(typeof console !== 'undefined' && console.info){
    console.info('[stream] cancel requested', {reason:_reason, streamId, sessionId:sid});
  }
  let respBody=null;
  let respOk=false;
  try{
    const r=await fetch(new URL(`api/chat/cancel?stream_id=${encodeURIComponent(streamId)}`,document.baseURI||location.href).href,{credentials:'include'});
    respOk=!!(r&&r.ok);
    try{respBody=await r.json();}catch(_){}
  }catch(e){
    if(typeof console !== 'undefined' && console.warn){
      console.warn('cancelStream: /api/chat/cancel request failed', e);
    }
  }
  // Active-session cancel should not tear down the current SSE transport before
  // the backend emits its terminal event; do that only for stale owner paths
  // where the user moved on to a different stream before this request
  // completed.
  if(sid && S.activeStreamId !== streamId && typeof closeLiveStream==='function'){
    closeLiveStream(sid, streamId);
  }
  // Owner guard: if the backend accepted the active-session cancel, leave
  // the current SSE transport and owner state intact so the terminal
  // `cancel` event can clear INFLIGHT, render "Task cancelled", and refresh
  // the sidebar. Only clear locally when the backend says there is no active
  // stream left to settle.
  if(respOk && respBody && respBody.cancelled===false && S.activeStreamId===streamId){
    S.activeStreamId=null;
    setBusy(false);
    if(typeof setComposerStatus==='function') setComposerStatus('');
    else setStatus('');
    // /api/chat/cancel only exposes `cancelled:bool`, so we cannot
    // distinguish reasons — keep the toast generic and short.
    if(typeof showToast==='function') showToast('Stream is no longer active',2000);
  }
  return respOk;
}

async function cancelSessionStream(session){
  const streamId = session&&session.active_stream_id;
  const sid = session&&session.session_id;
  if(!streamId||!sid) return false;
  // Explicit sidebar "Stop response" — log provenance for the same reason as
  // cancelStream(). (#5345)
  if(typeof console !== 'undefined' && console.info){
    console.info('[stream] cancel requested', {reason:'sidebar-stop', streamId, sessionId:sid});
  }
  let respOk=false;
  try{
    const r=await fetch(new URL(`api/chat/cancel?stream_id=${encodeURIComponent(streamId)}`,document.baseURI||location.href).href,{credentials:'include'});
    respOk=!!(r&&r.ok);
  }catch(e){/* close local stream; keep UI state honest below */}
  if(!respOk) return false;
  if(typeof closeLiveStream==='function') closeLiveStream(sid, streamId);
  session.active_stream_id=null;
  delete INFLIGHT[sid];
  clearInflightState(sid);
  if(S.session&&S.session.session_id===sid){
    S.activeStreamId=null;
    if(S.session) S.session.active_stream_id=null;
    clearInflight();
    setBusy(false);
    if(typeof setComposerStatus==='function') setComposerStatus('');
    else setStatus('');
  }
  if(typeof _approvalSessionId!=='undefined' && _approvalSessionId===sid){
    stopApprovalPolling();
    hideApprovalCard(true);
  }
  if(typeof _clarifySessionId!=='undefined' && _clarifySessionId===sid){
    stopClarifyPolling();
    hideClarifyCard(true, 'cancelled');
  }
  if(typeof renderSessionList==='function') renderSessionList();
  return true;
}

async function _savedSessionShouldStaySidebarOnly(sid){
  const state = await _savedSessionSidebarOnlyState(sid);
  return !!(state&&state.sidebarOnly);
}

async function _savedSessionSidebarOnlyState(sid){
  if(!sid) return false;
  try{
    const data = await api(`/api/session?session_id=${encodeURIComponent(sid)}&messages=0&resolve_model=0`);
    const session = data&&data.session;
    const archived = !!(session&&session.archived);
    const running = !!(session&&(session.active_stream_id||session.pending_user_message));
    return {sidebarOnly:archived||running, archived};
  }catch(e){
    return null;
  }
}

// ── Mobile navigation ──────────────────────────────────────────────────────
// URL prefill boot helpers.
function _prefillHasDraftText(prefillIntent){
  return !!(prefillIntent&&prefillIntent.hasText);
}
function _rootPrefillNeedsFreshComposer(urlSession, savedLocal, prefillIntent){
  return !urlSession&&!!savedLocal&&_prefillHasDraftText(prefillIntent);
}
function _profileQueryBlocksSavedLocalRestore(profileIntent, urlSession){
  return !!(profileIntent&&profileIntent.hasParam&&profileIntent.valid&&!urlSession);
}
async function _applyComposerPrefillOnBoot(prefillIntent){
  if(!prefillIntent||!prefillIntent.hasText) return;
  const msg=(typeof $==='function')?$('msg'):document.getElementById('msg');
  if(!msg) return;
  const text=String(prefillIntent.text||'');
  msg.value=text;
  if(typeof autoResize==='function') autoResize();
  else if(typeof updateSendBtn==='function') updateSendBtn();
  if(typeof msg.focus==='function') msg.focus();
}
async function _finalizeComposerPrefillOnBoot(prefillIntent){
  if(prefillIntent&&prefillIntent.hasParams&&typeof _consumeComposerPrefillParamsFromLocation==='function'){
    _consumeComposerPrefillParamsFromLocation();
  }
  await _applyComposerPrefillOnBoot(prefillIntent);
}

// Mobile navigation.
let _workspacePanelMode='closed'; // 'closed' | 'browse' | 'preview'

function _isCompactWorkspaceViewport(){
  return window.matchMedia('(max-width: 900px)').matches;
}

function _isPhoneWidthViewport(){
  return window.matchMedia('(max-width: 640px)').matches;
}

function _isTouchKeyboardViewport(){
  try{return matchMedia('(hover:none) and (pointer:coarse)').matches&&!_hasFinePointerCoexisting();}catch(_){return false;}
}

function _syncKeyboardBottomInset(){
  const root=document.documentElement;
  if(!root) return;
  if(!window.visualViewport||!_isTouchKeyboardViewport()){
    root.style.removeProperty('--keyboard-bottom-inset');
    return;
  }
  const vv=window.visualViewport;
  // A pinch-zoomed viewport (vv.scale != 1) makes innerHeight - vv.height
  // reflect the zoom, not the keyboard — on Chromium touch devices with
  // accessibility "force enable zoom" that yields a large spurious inset that
  // jitters on pan. Treat only the unzoomed state as keyboard occlusion.
  if(Math.abs((vv.scale||1)-1)>0.05){
    root.style.removeProperty('--keyboard-bottom-inset');
    return;
  }
  const inset=Math.max(0,Math.ceil(window.innerHeight-(vv.height+vv.offsetTop)));
  if(inset>0){
    root.style.setProperty('--keyboard-bottom-inset',`${inset}px`);
  }else{
    root.style.removeProperty('--keyboard-bottom-inset');
  }
}

// Mobile PWA viewport reflow guard. When the on-screen keyboard / browser
// chrome shows or hides, visualViewport (or a plain resize on browsers without
// it) changes height without a layout invalidation, leaving the phone layout
// painted against stale geometry. Toggling a one-frame `viewport-reflow` class
// (which applies a cheap GPU-promotion transform under the @media(max-width:640px)
// rule) forces a repaint, then we resync the workspace panel + sidebar aria.
function _forceMobileViewportReflow(){
  _syncKeyboardBottomInset();
  if(!_isPhoneWidthViewport()) return;
  const layout=document.querySelector('.layout');
  if(!layout) return;
  document.documentElement.classList.add('viewport-reflow');
  void layout.offsetWidth;
  requestAnimationFrame(()=>{
    document.documentElement.classList.remove('viewport-reflow');
    try{ syncWorkspacePanelState(); }catch(_){ }
    try{ if(typeof _syncSidebarAria==='function') _syncSidebarAria(); }catch(_){ }
  });
}

function _syncWorkspacePanelInlineWidth(){
  const {panel}= _workspacePanelEls();
  if(!panel) return;

  const isCompact = _isCompactWorkspaceViewport();
  if(isCompact){
    if(panel.style.width) panel.style.removeProperty('width');
    return;
  }

  const saved = localStorage.getItem('wings-panel-w');
  if(!saved) return;
  const parsed = parseInt(saved, 10);
  if(Number.isNaN(parsed) || parsed <= 0) return;
  panel.style.width = `${parsed}px`;
}

function _workspacePanelEls(){
  return {
    layout: document.querySelector('.layout'),
    panel: document.querySelector('.rightpanel'),
    toggleBtn: $('btnWorkspacePanelToggle'),
    edgeToggleBtn: $('btnWorkspacePanelEdgeToggle'),
    collapseBtn: $('btnCollapseWorkspacePanel'),
  };
}

function _hasWorkspacePreviewVisible(){
  const preview=$('previewArea');
  return !!(preview&&preview.classList.contains('visible'));
}

function _setWorkspacePanelMode(mode){
  const {layout,panel}= _workspacePanelEls();
  if(!layout||!panel)return;
  _workspacePanelMode=(mode==='browse'||mode==='preview')?mode:'closed';
  const open=_workspacePanelMode!=='closed';
  document.documentElement.dataset.workspacePanel=open?'open':'closed';
  // Persist open/closed across refreshes (browse/preview → open; closed → closed)
  // Do NOT overwrite the user's "keep open" preference — only track runtime state
  // so that toggleWorkspacePanel(false) from the toolbar doesn't clear the setting.
  try{localStorage.setItem('wings-workspace-panel', open ? 'open' : 'closed');}catch(_){}
  layout.classList.toggle('workspace-panel-collapsed',!open);
  if(_isCompactWorkspaceViewport()){
    panel.classList.toggle('mobile-open',open);
  }else{
    panel.classList.remove('mobile-open');
  }
  syncWorkspacePanelUI();
}

function syncWorkspacePanelState(){
  const hasPreview=_hasWorkspacePreviewVisible();
  if(hasPreview){
    if(_workspacePanelMode==='closed') _setWorkspacePanelMode('preview');
    else syncWorkspacePanelUI();
    return;
  }
  if(!S.session){
    // No active session — if the panel was explicitly opened (browse mode), keep it
    // open so the workspace pane doesn't vanish on a fresh-page or empty-session boot.
    // The file tree will show the "no workspace" placeholder naturally via renderFileTree().
    // Only force-close if the mode is 'preview' (file preview without a session is invalid).
    if(_workspacePanelMode==='preview') _setWorkspacePanelMode('closed');
    else syncWorkspacePanelUI();
    return;
  }
  _setWorkspacePanelMode(_workspacePanelMode==='preview'?'closed':_workspacePanelMode);
}

function openWorkspacePanel(mode='browse'){
  // Interface mode: the workspace panel is an Advanced-only surface.
  if(typeof getUIMode==='function'&&getUIMode()!=='advanced')return;
  if(mode==='browse'&&!S.session&&!_hasWorkspacePreviewVisible()&&!S._profileDefaultWorkspace)return;
  if(mode==='preview'&&_workspacePanelMode==='browse'){
    syncWorkspacePanelUI();
    return;
  }
  _setWorkspacePanelMode(mode);
}

function closeWorkspacePanel(){
  _setWorkspacePanelMode('closed');
}

function ensureWorkspacePreviewVisible(){
  if(_workspacePanelMode==='closed') _setWorkspacePanelMode('preview');
  else syncWorkspacePanelUI();
}

function handleWorkspaceClose(){
  if(_hasWorkspacePreviewVisible()){
    clearPreview();
    return;
  }
  closeWorkspacePanel();
}

async function _maybeBindFreshDefaultWorkspaceSession(prefillIntent=null){
  if(_prefillHasDraftText(prefillIntent)) return false;
  if(S.session) return false;
  if(_workspacePanelMode!=='browse') return false;
  if(!S._profileDefaultWorkspace) return false;
  try{
    // worktree:false is explicit and load-bearing — this auto-bind runs on
    // page load, and a config-level worktree default must never leak a fresh
    // worktree + branch from simply opening the UI (#6022).
    await newSession(false, {awaitWorkspaceLoad: true, worktree: false});
    return true;
  }catch(e){
    console.warn('[wings] failed to bind fresh default workspace session', e);
    return false;
  }
}

/**
 * Set a tooltip on a button, preferring the custom CSS tooltip (`data-tooltip`)
 * when the element opts in via the `has-tooltip` class. Falls back to the
 * native `title` attribute for elements that haven't opted in.
 *
 * Critical: when the element DOES have data-tooltip, this MUST also clear any
 * existing native `title` attribute, otherwise the slow ~1.5s native browser
 * tooltip co-fires alongside the fast custom CSS tooltip — exactly the bug
 * #1775 reports. Always pair `data-tooltip` with `removeAttribute('title')`.
 */
function _setButtonTooltip(btn, text){
  if(!btn) return;
  if(btn.hasAttribute('data-tooltip')){
    btn.setAttribute('data-tooltip', text);
    if(btn.hasAttribute('title')) btn.removeAttribute('title');
  } else {
    btn.title = text;
  }
}

function _uiText(key, fallback){
  if(typeof t==='function'){
    const val=t(key);
    if(val&&val!==key) return val;
  }
  return fallback;
}

function syncWorkspacePanelUI(){
  const {layout,panel,toggleBtn,edgeToggleBtn,collapseBtn}= _workspacePanelEls();
  if(!layout||!panel)return;
  const desktopOpen=_workspacePanelMode!=='closed';
  const mobileOpen=panel.classList.contains('mobile-open');
  const isCompact=_isCompactWorkspaceViewport();
  const isOpen=isCompact?mobileOpen:desktopOpen;
  const canBrowse=!!S.session||_hasWorkspacePreviewVisible()||!!(S._profileDefaultWorkspace);
  const hasPreview=_hasWorkspacePreviewVisible();
  if(toggleBtn){
    toggleBtn.classList.toggle('active',isOpen);
    toggleBtn.setAttribute('aria-pressed',isOpen?'true':'false');
    const label=_uiText(isOpen?'workspace_panel_hide':'workspace_panel_show', isOpen?'Hide workspace panel':'Show workspace panel');
    _setButtonTooltip(toggleBtn, label);
    toggleBtn.setAttribute('aria-label', label);
    toggleBtn.disabled=!canBrowse;
  }
  if(edgeToggleBtn){
    edgeToggleBtn.classList.toggle('active',isOpen);
    edgeToggleBtn.setAttribute('aria-expanded',isOpen?'true':'false');
    const label=_uiText(isOpen?'workspace_panel_hide':'workspace_panel_show', isOpen?'Hide workspace panel':'Show workspace panel');
    _setButtonTooltip(edgeToggleBtn, label);
    edgeToggleBtn.setAttribute('aria-label', label);
    edgeToggleBtn.disabled=!canBrowse;
  }
  if(collapseBtn){
    _setButtonTooltip(collapseBtn, isCompact?_uiText('workspace_panel_close','Close workspace panel'):_uiText('workspace_panel_hide','Hide workspace panel'));
  }
  const workspaceChip=$('btnWorkspaceChip');
  if(workspaceChip){
    const chipOpen=isCompact?false:desktopOpen;
    workspaceChip.setAttribute('aria-pressed',chipOpen?'true':'false');
    workspaceChip.setAttribute('aria-label',chipOpen?_uiText('workspace_panel_hide','Hide workspace panel'):_uiText('workspace_panel_show','Show workspace panel'));
    workspaceChip.disabled=!canBrowse;
  }
  const hasSession=!!S.session;
  ['btnUpDir','btnNewFile','btnNewFolder','btnRefreshPanel'].forEach(id=>{
    const el=$(id);
    if(el)el.disabled=!hasSession;
  });
  const clearBtn=$('btnClearPreview');
  if(clearBtn){
    clearBtn.disabled=!isOpen;
    const label=hasPreview?_uiText('workspace_close_preview','Close preview'):_uiText('terminal_close','Close');
    _setButtonTooltip(clearBtn, label);
    clearBtn.setAttribute('aria-label', label);
    if(!isCompact) clearBtn.style.display='';
  }
}

function toggleMobileSidebar(){
  const sidebar=document.querySelector('.sidebar');
  if(!sidebar)return;
  const isOpen=sidebar.classList.contains('mobile-open');
  if(isOpen){closeMobileSidebar();}
  else{
    try{if(typeof _syncMobileSidebarPanelFromMainView==='function')_syncMobileSidebarPanelFromMainView();}catch(_){}
    sidebar.classList.remove('mobile-session-page');sidebar.classList.add('mobile-panel-drawer','mobile-open');
  }
}
function closeMobileSidebar(){
  const sidebar=document.querySelector('.sidebar');
  const overlay=$('mobileOverlay');
  if(sidebar)sidebar.classList.remove('mobile-open','mobile-session-page','mobile-panel-drawer');
  if(overlay)overlay.classList.remove('visible');
}

const _PWA_SIDEBAR_SWIPE_EDGE=80;
const _PWA_SIDEBAR_SWIPE_CLAIM=10;
const _PWA_SIDEBAR_SWIPE_TRIGGER=64;
const _PWA_SIDEBAR_SWIPE_MAX_VERTICAL=56;
let _pwaSidebarSwipe=null;

function _isPwaStandalone(){
  try{
    return document.documentElement.classList.contains('pwa-standalone')
      || window.matchMedia('(display-mode: standalone)').matches
      || window.navigator.standalone===true;
  }catch(_){return false;}
}

function _isInteractiveSwipeTarget(target){
  try{return !!(target&&target.closest&&target.closest('input,textarea,select,button,a,[contenteditable="true"],.topbar-chips,.composer-left,.sidebar,.rightpanel'));}
  catch(_){return false;}
}

function _pwaSidebarSwipePoint(e){
  const touch=e&&e.touches&&e.touches[0]||e&&e.changedTouches&&e.changedTouches[0];
  const src=touch||e;
  if(!src)return null;
  return {clientX:Number(src.clientX)||0,clientY:Number(src.clientY)||0};
}

function _isTouchPointerEvent(e){
  return !!(e&&e.pointerType==='touch');
}

function _openMobileSidebarFromGesture(){
  if(_isDesktopWidth())return;
  const sidebar=document.querySelector('.sidebar');
  if(!sidebar)return;
  try{if(typeof _syncMobileSidebarPanelFromMainView==='function')_syncMobileSidebarPanelFromMainView();}catch(_){}
  const layout=document.querySelector('.layout');
  if(layout)layout.classList.remove('sidebar-collapsed');
  sidebar.classList.remove('sidebar-collapsed');
  try{document.documentElement.removeAttribute('data-sidebar-collapsed');}catch(_){}
  sidebar.classList.remove('mobile-session-page');
  sidebar.classList.add('mobile-panel-drawer');
  sidebar.classList.add('mobile-open');
}

function _onPwaSidebarSwipeStart(e){
  if(_isDesktopWidth())return;
  if(_isTouchPointerEvent(e))return;
  if(e.pointerType==='mouse'||(e.pointerType&&e.pointerType!=='touch'&&e.pointerType!=='pen'))return;
  if(document.querySelector('.sidebar')?.classList.contains('mobile-open'))return;
  const point=_pwaSidebarSwipePoint(e);
  if(!point)return;
  if(point.clientX>_PWA_SIDEBAR_SWIPE_EDGE)return;
  if(_isInteractiveSwipeTarget(e.target))return;
  _pwaSidebarSwipe={startX:point.clientX,startY:point.clientY,active:true,opened:false};
}

function _onPwaSidebarSwipeMove(e){
  if(_isTouchPointerEvent(e))return;
  const swipe=_pwaSidebarSwipe;
  if(!swipe||!swipe.active||swipe.opened)return;
  const point=_pwaSidebarSwipePoint(e);
  if(!point)return;
  const dx=point.clientX-swipe.startX;
  const dy=point.clientY-swipe.startY;
  if(dx<0||Math.abs(dy)>_PWA_SIDEBAR_SWIPE_MAX_VERTICAL*1.5){_pwaSidebarSwipe=null;return;}
  if(dx>=_PWA_SIDEBAR_SWIPE_CLAIM&&dx>Math.abs(dy)*1.2){
    if(e.cancelable)e.preventDefault();
  }
  if(dx>=_PWA_SIDEBAR_SWIPE_TRIGGER&&Math.abs(dy)<=_PWA_SIDEBAR_SWIPE_MAX_VERTICAL&&dx>Math.abs(dy)*1.5){
    if(e.cancelable)e.preventDefault();
    swipe.opened=true;
    _openMobileSidebarFromGesture();
  }
}

function _onPwaSidebarSwipeEnd(e){if(_isTouchPointerEvent(e))return;_pwaSidebarSwipe=null;}
function _onPwaSidebarSwipeCancel(e){if(_isTouchPointerEvent(e))return;_pwaSidebarSwipe=null;}

function _installPwaSidebarSwipeGesture(){
  // #4660 review (Codex CORE): the #pwaSidebarEdgeGuard element is now
  // pointer-events:none (CSS), so it can no longer intercept hit-testing for
  // taps / vertical scrolls that merely start in the left edge strip — those
  // pass through to the underlying .messages scroller. The edge-swipe-to-open
  // gesture is handled entirely by the window-level CAPTURE touch/pointer
  // listeners below (which see the event regardless of the guard), so no
  // dedicated guard-element listener is needed.
  window.addEventListener('touchstart', _onPwaSidebarSwipeStart, {capture:true,passive:true});
  window.addEventListener('touchmove', _onPwaSidebarSwipeMove, {capture:true,passive:false});
  window.addEventListener('touchend', _onPwaSidebarSwipeEnd, {capture:true,passive:true});
  window.addEventListener('touchcancel', _onPwaSidebarSwipeCancel, {capture:true,passive:true});
  window.addEventListener('pointerdown', _onPwaSidebarSwipeStart, {passive:true});
  window.addEventListener('pointermove', _onPwaSidebarSwipeMove, {passive:false});
  window.addEventListener('pointerup', _onPwaSidebarSwipeEnd, {passive:true});
  window.addEventListener('pointercancel', _onPwaSidebarSwipeCancel, {passive:true});
}
_installPwaSidebarSwipeGesture();

// ── Desktop sidebar collapse toggle ────────────────────────────────────────
// Two discoverability paths into the same state:
//   (1) Click the already-active rail icon → collapse / expand the sidebar.
//   (2) Cmd/Ctrl+B keyboard shortcut (VS Code convention).
// Mobile is unaffected: the sidebar is an overlay there, and every collapse
// code path is gated on `_isDesktopWidth()` (min-width:641px).
// State is persisted via localStorage and survives reloads + bfcache.
const _SIDEBAR_COLLAPSED_KEY='wings-sidebar-collapsed';

function _isDesktopWidth(){
  try{return window.matchMedia('(min-width:641px)').matches;}catch(_){return true;}
}

function _isSidebarCollapsed(){
  return document.querySelector('.layout')?.classList.contains('sidebar-collapsed')||false;
}

function _syncSidebarAria(){
  // Mirror the open/collapsed state on the active rail button via aria-expanded
  // so screen readers announce the toggle. Open=true, collapsed=false.
  const active=document.querySelector('.rail .rail-btn.nav-tab.active[data-panel]');
  if(active)active.setAttribute('aria-expanded',!_isSidebarCollapsed());
}

function toggleSidebar(forceState){
  if(!_isDesktopWidth())return; // mobile uses an overlay; never collapse there
  const layout=document.querySelector('.layout');
  if(!layout)return;
  const next=typeof forceState==='boolean'?forceState:!_isSidebarCollapsed();
  layout.classList.toggle('sidebar-collapsed',next);
  // Clear the flash-prevention root-level marker once JS owns the state.
  try{document.documentElement.removeAttribute('data-sidebar-collapsed');}catch(_){}
  try{localStorage.setItem(_SIDEBAR_COLLAPSED_KEY,next?'1':'0');}catch(_){}
  _syncSidebarAria();
}

function expandSidebar(){
  if(_isSidebarCollapsed())toggleSidebar(false);
}

// Boot-time restore. The inline flash-prevention script in index.html already
// set data-sidebar-collapsed='1' on <html> before the stylesheet so the page
// renders collapsed without paint flash. This IIFE promotes that pre-paint
// state into the .layout class system where both JS and CSS can read it.
(function _restoreSidebarState(){
  try{document.documentElement.removeAttribute('data-sidebar-collapsed');}catch(_){}
  if(!_isDesktopWidth())return;
  try{
    if(localStorage.getItem(_SIDEBAR_COLLAPSED_KEY)==='1'){
      const layout=document.querySelector('.layout');
      if(layout)layout.classList.add('sidebar-collapsed');
    }
  }catch(_){}
  _syncSidebarAria();
})();
// ── Boot-time tab visibility ────────────────────────────────────────────────
// Apply hidden tabs from localStorage. The primary flash-prevention is an
// inline <script> in index.html (after sidebar-nav) that runs synchronously
// before first paint. This IIFE is a secondary fallback: it ensures consistency
// after panels.js is loaded and handles the active-tab switch. No-op if
// panels.js hasn't loaded yet (typeof guard).
(function _restoreTabVisibility(){
  try{
    if(typeof _applyTabOrder==='function'&&typeof _getTabOrder==='function'){
      _applyTabOrder(_getTabOrder());
    }
    if(typeof _applyTabVisibility==='function'&&typeof _getHiddenTabs==='function'){
      _applyTabVisibility(_getHiddenTabs());
    }
    var active=document.querySelector('.rail .rail-btn.nav-tab.active[data-panel]')
               ||document.querySelector('.sidebar-nav .nav-tab.active[data-panel]');
    if(active&&active.classList.contains('nav-tab-hidden')){
      var chatBtn=document.querySelector('.rail .rail-btn.nav-tab[data-panel="chat"]');
      if(chatBtn)chatBtn.classList.add('active');
      if(active)active.classList.remove('active');
    }
  }catch(_){}
})();
function toggleMobileFiles(){
  toggleWorkspacePanel();
}
function closeMobileWorkspacePanelFromChat(e){
  if(!_isCompactWorkspaceViewport()||_workspacePanelMode==='closed') return;
  const panel=document.querySelector('.rightpanel');
  if(panel&&panel.contains(e.target)) return;
  closeWorkspacePanel();
}
function toggleWorkspacePanel(force){
  const {panel}= _workspacePanelEls();
  if(!panel)return;
  const currentlyOpen=_workspacePanelMode!=='closed';
  const nextOpen=typeof force==='boolean'?force:!currentlyOpen;
  if(!nextOpen){
    closeWorkspacePanel();
    return;
  }
  // Basic mode: openWorkspacePanel() intentionally blocks Advanced-only access.
  // The "Workspace" pill is the explicit Basic-mode gateway, so open directly
  // (skip the browse guard; the pill is disabled when no session can browse).
  const uiMode=(typeof getUIMode==='function')?getUIMode():'advanced';
  const canBrowse=!!S.session||_hasWorkspacePreviewVisible()||!!(S._profileDefaultWorkspace);
  if(uiMode!=='advanced'&&!canBrowse) return;
  const nextMode=_hasWorkspacePreviewVisible()?'preview':'browse';
  if(uiMode!=='advanced'){
    _setWorkspacePanelMode(nextMode);
    return;
  }
  openWorkspacePanel(nextMode);
}
function mobileSwitchPanel(name){
  switchPanel(name);
  if(name==='chat'){
    closeMobileSidebar();
  } else {
    const sidebar=document.querySelector('.sidebar');
    if(sidebar){
      sidebar.classList.remove('mobile-session-page');
      sidebar.classList.add('mobile-panel-drawer','mobile-open');
    }
  }
}

$('btnSend').onclick=()=>{
  if(typeof handleComposerPrimaryAction==='function') return handleComposerPrimaryAction();
  if(window._micActive){
    window._micPendingSend=true;
    _stopMic();
    return;
  }
  // Turn-based voice mode: let the voice mode system handle the send flow
  if(typeof window._voiceModeActive==='function'&&window._voiceModeActive()){
    // Immediately send whatever is in the textarea
    if(typeof window._voiceModeImmediateSend==='function') window._voiceModeImmediateSend();
    return;
  }
  send();
};
$('mainChat')?.addEventListener('pointerdown', closeMobileWorkspacePanelFromChat);
$('btnAttach').onclick=e=>{if(e&&e.preventDefault)e.preventDefault();$('fileInput').value='';$('fileInput').click();};

// ── Voice input (Web Speech API + MediaRecorder fallback) ───────────────────
function _micIsLocalhostOrLoopback(hostname){
  const host=String(hostname||'').toLowerCase().replace(/^\[|\]$/g,'');
  return host==='localhost'
    || host.endsWith('.localhost')
    || host==='::1'
    || host==='0:0:0:0:0:0:0:1'
    || /^127\./.test(host);
}

function _micOriginNeedsSecureContext(){
  if(window.isSecureContext===true) return false;
  const loc=window.location||{};
  const protocol=loc.protocol||'';
  return protocol==='http:'&&!_micIsLocalhostOrLoopback(loc.hostname);
}

function _micToastKeyForRecognitionError(error){
  if((error==='not-allowed'||error==='service-not-allowed'||error==='audio-capture')
      && _micOriginNeedsSecureContext()){
    return 'mic_insecure_origin';
  }
  const msgs={
    'not-allowed':'mic_denied',
    'service-not-allowed':'mic_denied',
    'no-speech':'mic_no_speech',
    'network':'mic_network',
  };
  return msgs[error]||null;
}

// ── WAV encoder for server-STT (PCM → WAV) ───────────────────────────────────
// The server-STT backend (vLLM ASR / qwen3-asr) cannot decode the WebM/Opus
// container that MediaRecorder emits ("Error opening <_io.BytesIO object>:
// Format not recognised"). Recording via the Web Audio API and encoding
// 16-bit PCM WAV guarantees a backend-compatible upload — the same approach
// the qwen3-asr dashboard uses ("WAV-Aufnahme, garantiert backend-kompatibel").
function _micEncodeWav(samples, sampleRate){
  const buffer=new ArrayBuffer(44+samples.length*2);
  const view=new DataView(buffer);
  const writeStr=(o,s)=>{for(let i=0;i<s.length;i++)view.setUint8(o+i,s.charCodeAt(i));};
  writeStr(0,'RIFF');
  view.setUint32(4,36+samples.length*2,true);
  writeStr(8,'WAVE');
  writeStr(12,'fmt ');
  view.setUint32(16,16,true);
  view.setUint16(20,1,true);   // PCM
  view.setUint16(22,1,true);   // mono
  view.setUint32(24,sampleRate,true);
  view.setUint32(28,sampleRate*2,true);
  view.setUint16(32,2,true);   // block align
  view.setUint16(34,16,true);  // bits per sample
  writeStr(36,'data');
  view.setUint32(40,samples.length*2,true);
  let offset=44;
  for(let i=0;i<samples.length;i++){
    const s=Math.max(-1,Math.min(1,samples[i]));
    view.setInt16(offset,s<0?s*0x8000:s*0x7FFF,true);
    offset+=2;
  }
  return new Blob([buffer],{type:'audio/wav'});
}

(function(){
  const SpeechRecognition=window.SpeechRecognition||window.webkitSpeechRecognition;
  const _canRecordAudio=!!(navigator.mediaDevices&&navigator.mediaDevices.getUserMedia&&window.MediaRecorder);
  if(!SpeechRecognition&&!_canRecordAudio) return; // Browser unsupported — mic button stays hidden

  // Persist SR failure across reloads (e.g. Tailscale/network error)
  const _micForceMediaRecorderKey='mic_force_mediarecorder';
  const _micForceMediaRecorderStored=localStorage.getItem(_micForceMediaRecorderKey);
  // Prefer Wings server-side STT (MediaRecorder -> /api/transcribe) only
  // after the server confirms an STT provider is available. No stored key must
  // keep browser SpeechRecognition as the first-click default until then; that
  // avoids dropping the first dictation on installs without server STT.
  let _serverSttAvailable=false;
  let _forceMediaRecorder=!SpeechRecognition||(_micForceMediaRecorderStored===null?(_serverSttAvailable&&_canRecordAudio):_micForceMediaRecorderStored==='1');

  // Raw audio mode preference: send audio file instead of transcribing
  let _rawAudioMode = localStorage.getItem('wings-raw-audio-mode') === 'true';
  // Append-on-commit preference: when ON (default), dictated text is appended
  // to any text already in the composer. When OFF, dictated text replaces the
  // composer content (the pre-existing behavior).
  let _dictationAppend = localStorage.getItem('wings-dictation-append') !== 'false';
  // Capture backend pinned at recording start ('speech' | 'media' | null) so
  // _stopMic / onstop act on the backend that actually started, even if the
  // raw-audio toggle changes mid-recording (#3169 Codex review).
  let _activeCaptureMode = null;

  const btn=$('btnMic');
  const status=$('micStatus');
  const ta=$('msg');
  const statusText=status?status.querySelector('.status-text'):null;
  btn.style.display=''; // Show button — browser supports speech recognition or recording fallback

  let recognition=null;
  let mediaRecorder=null;
  let mediaStream=null;
  let audioChunks=[];
  let wavRecorder=null;   // { ctx, processor, chunks } for the server-STT WAV path
  let _finalText='';
  let _prefix='';
  let _isRecording=false;
  // #5294 salvage — mobile composer-mic dictation continuity.
  // _speechStopRequested distinguishes an intentional stop (send/toggle) from a
  // natural pause so onend only auto-restarts on real pauses. _micWakeLock keeps
  // the screen awake while dictating; _micWakeLockOp serializes acquire/release
  // so rapid start/stop/visibility churn can't leak a lock. _micRestartCount is
  // bounded by _micMaxRestarts to stop a tight loop if the audio session is stolen.
  let _speechStopRequested=false;
  let _micWakeLock=null;
  let _micWakeLockOp=null;
  let _micRestartCount=0;
  const _micMaxRestarts=20;
  let _micHoldTimer=null;
  let _micHoldActive=false;
  let _micPointerDown=false;
  let _micStartSeq=0;
  const _micHoldThresholdMs=300;

  // ── Client-side VAD for the server-STT (MediaRecorder) path ──────────────
  // MediaRecorder has no built-in silence detection the way browser
  // SpeechRecognition does. When server STT is active (_forceMediaRecorder),
  // the only way the recording stops is an explicit mic click / hold-release —
  // a natural pause never ends it. This lightweight Web-Audio VAD restores the
  // auto-stop-on-silence behaviour the browser engine used to provide: it
  // watches the live captureStream level and calls _stopMic() after the
  // configured silence window, so the existing recorder.onstop → _transcribeBlob
  // → _autoSendAfterDictation pipeline takes over unchanged.
  let _micVadCtx=null;        // AudioContext (lazy; shared for the session)
  let _micVadSource=null;     // MediaStreamAudioSourceNode
  let _micVadAnalyser=null;   // AnalyserNode
  let _micVadRafId=null;      // requestAnimationFrame id for the level loop
  let _micVadSilenceTimer=null;
  let _micVadHasSpeech=false; // set once real speech is heard (lead-in guard)
  const _micVadThreshold=0.012; // normalized RMS above which counts as speech
  const _micVadReadIntervalMs=120; // analyser poll cadence

  function _micSilenceMs(){
    try{
      const raw=parseInt(localStorage.getItem('wings-voice-silence-ms'),10);
      return (Number.isFinite(raw)&&raw>0)?Math.max(200,raw):1800;
    }catch(_){ return 1800; }
  }

  function _micVadLevel(){
    if(!_micVadAnalyser) return 0;
    const buf=new Uint8Array(_micVadAnalyser.fftSize);
    _micVadAnalyser.getByteTimeDomainData(buf);
    let sum=0;
    for(let i=0;i<buf.length;i++){
      const v=(buf[i]-128)/128;
      sum+=v*v;
    }
    return Math.sqrt(sum/buf.length);
  }

  function _micVadPoll(){
    if(!_micVadAnalyser||!window._micActive) return;
    const level=_micVadLevel();
    if(level>=_micVadThreshold){
      _micVadHasSpeech=true;
      if(_micVadSilenceTimer){
        clearTimeout(_micVadSilenceTimer);
        _micVadSilenceTimer=null;
      }
    }else if(_micVadHasSpeech){
      if(!_micVadSilenceTimer){
        _micVadSilenceTimer=setTimeout(()=>{
          _micVadSilenceTimer=null;
          // Still recording + still on the server-transcribe path → stop now.
          if(window._micActive&&_activeCaptureMode==='media-transcribe'){
            _stopMic();
          }
        },_micSilenceMs());
      }
    }
    _micVadRafId=requestAnimationFrame(_micVadPoll);
  }

  function _micVadStart(stream){
    _micVadStop();
    try{
      const Ctx=window.AudioContext||window.webkitAudioContext;
      if(!Ctx) return;
      _micVadCtx=new Ctx();
      _micVadSource=_micVadCtx.createMediaStreamSource(stream);
      _micVadAnalyser=_micVadCtx.createAnalyser();
      _micVadAnalyser.fftSize=2048;
      _micVadSource.connect(_micVadAnalyser);
      _micVadHasSpeech=false;
      _micVadRafId=requestAnimationFrame(_micVadPoll);
    }catch(_){
      _micVadStop();
    }
  }

  function _micVadStop(){
    if(_micVadSilenceTimer){
      clearTimeout(_micVadSilenceTimer);
      _micVadSilenceTimer=null;
    }
    if(_micVadRafId){
      cancelAnimationFrame(_micVadRafId);
      _micVadRafId=null;
    }
    try{ if(_micVadSource){_micVadSource.disconnect();} }catch(_){}
    _micVadSource=null;
    try{ if(_micVadAnalyser){_micVadAnalyser.disconnect();} }catch(_){}
    _micVadAnalyser=null;
    try{ if(_micVadCtx&&_micVadCtx.state!=='closed'){_micVadCtx.close();} }catch(_){}
    _micVadCtx=null;
    _micVadHasSpeech=false;
  }

  // ── WAV capture for the server-STT path ──────────────────────────────────
  // MediaRecorder emits WebM/Opus, which the vLLM ASR backend cannot decode.
  // Capture raw PCM via the Web Audio API and encode WAV on stop so the
  // upstream /v1/audio/transcriptions call receives a decodable format. The
  // ScriptProcessor keeps a zero-gain tail to stay active without feedback.
  function _micWavStart(captureStream){
    _micWavStop();
    try{
      const Ctx=window.AudioContext||window.webkitAudioContext;
      if(!Ctx) return false;
      const ctx=new Ctx();
      const source=ctx.createMediaStreamSource(captureStream);
      const processor=ctx.createScriptProcessor(4096,1,1);
      const chunks=[];
      processor.onaudioprocess=e=>{chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));};
      const gain=ctx.createGain();
      gain.gain.value=0;
      source.connect(processor);
      processor.connect(gain);
      gain.connect(ctx.destination);
      wavRecorder={ctx:ctx,processor:processor,chunks:chunks,captureStream:captureStream};
      return true;
    }catch(_){
      _micWavStop();
      return false;
    }
  }

  function _micWavStop(prefixSnapshot){
    const rec=wavRecorder;
    if(!rec) return;
    wavRecorder=null;
    try{ if(rec.processor) rec.processor.onaudioprocess=null; }catch(_){}
    try{ if(rec.processor) rec.processor.disconnect(); }catch(_){}
    try{ if(rec.ctx&&rec.ctx.state!=='closed') rec.ctx.close(); }catch(_){}
    const chunks=rec.chunks||[];
    if(!chunks.length) return;
    let total=0;
    for(const c of chunks) total+=c.length;
    const merged=new Float32Array(total);
    let off=0;
    for(const c of chunks){ merged.set(c,off); off+=c.length; }
    const sampleRate=rec.ctx?rec.ctx.sampleRate:48000;
    const wav=_micEncodeWav(merged,sampleRate);
    if(wav.size) _transcribeBlob(wav, prefixSnapshot);
  }

  function _setButtonTooltipAndKey(btn, key){
    const text = t(key);
    btn.setAttribute('data-i18n-title', key);
    if(btn.hasAttribute('data-tooltip')){
      btn.setAttribute('data-tooltip', text);
      if(btn.hasAttribute('title')) btn.removeAttribute('title');
    } else {
      btn.title = text;
    }
  }

  function _setRecording(on){
    window._micActive=on;
    btn.classList.toggle('recording',on);
    // Active-state title flips so the tooltip is honest about what
    // pressing the button will do (#1488).
    _setButtonTooltipAndKey(btn, on ? (_rawAudioMode ? 'voice_recording_active' : 'voice_dictate_active') : (_rawAudioMode ? 'voice_send_raw' : 'voice_dictate'));
    status.style.display=on?'':'none';
    if(statusText) statusText.textContent=on?'Listening':'Listening';
    if(!on){ _finalText=''; _prefix=''; }
  }

  function _updateMicTooltip(){
    if(!window._micActive){
      _setButtonTooltipAndKey(btn, _rawAudioMode ? 'voice_send_raw' : 'voice_dictate');
    }
  }

  function _applyRawAudioModePreference(enabled){
    _rawAudioMode=!!enabled;
    try{localStorage.setItem('wings-raw-audio-mode',_rawAudioMode?'true':'false');}catch(_){}
    const rawAudioCheckbox=document.getElementById('settingsRawAudio');
    if(rawAudioCheckbox) rawAudioCheckbox.checked=_rawAudioMode;
    _updateMicTooltip();
  }
  window._applyRawAudioModePreference=_applyRawAudioModePreference;

  function _applyDictationAppendPreference(enabled){
    _dictationAppend=!!enabled;
    try{localStorage.setItem('wings-dictation-append',_dictationAppend?'true':'false');}catch(_){}
    const cb=document.getElementById('settingsDictationAppend');
    if(cb) cb.checked=_dictationAppend;
  }
  window._applyDictationAppendPreference=_applyDictationAppendPreference;

  async function _sendRawAudio(blob){
    const ext=(blob.type&&blob.type.includes('ogg'))?'ogg':'webm';
    const file=new File([blob],`voice-input-${Date.now()}.${ext}`,{type:blob.type||`audio/${ext}`});
    S.pendingFiles.push(file);
    renderTray();
    // Raw audio attached → recording is done → send immediately.
    _autoSendAfterDictation();
  }

  function _commitTranscript(text, prefixOverride){
    // `prefixOverride` is the composer content captured at recording start,
    // passed only by the async server-STT path (recorder.onstop → _transcribeBlob).
    // The sync browser-SR path doesn't call this function — it commits inline
    // in sr.onend using _prefix directly.
    //
    // Three concerns this function has to balance (Greptile reviews):
    //   1. Race condition: user types during async transcription → preserve those
    //      keystrokes. Read live ta.value, not the stale snapshot.
    //   2. Clear-during-transcription: user clears textarea during async wait →
    //      respect that intent. Live ta.value (even empty) wins over snapshot.
    //   3. Browser-SR fallback: if a future caller passes no prefixOverride
    //      and live ta.value is empty, fall back to _prefix as a safety net.
    //
    // Resolution: when prefixOverride IS provided (server-STT path), trust live
    // ta.value unconditionally — even when empty. Otherwise fall back to _prefix.
    const clean=(text||'').trim();
    let committed;
    if(!clean){
      committed = ta.value;
    }else if(_dictationAppend){
      const base = prefixOverride !== undefined ? ta.value : (ta.value || _prefix);
      if(!base){
        committed = clean;
      }else{
        committed = (!base.endsWith(' ') && !base.endsWith('\n'))
          ? base+' '+clean.trimStart()
          : base+clean;
      }
    }else{
      // Replace mode (explicit): dictated text overwrites the composer.
      committed = clean;
    }
    ta.value=committed;
    autoResize();
    // Server-STT path: transcript committed → recording is done → send now.
    _autoSendAfterDictation();
  }

  function _isServerSttUnavailable(err){
    const status=err&&err.status;
    if(status===404||status===503||status>=500) return true;
    if(!status) return true;
    const msg=String((err&&err.message)||'').toLowerCase();
    return msg.includes('unavailable')||msg.includes('not configured');
  }

  // Recording finished — pause (one-shot default) or explicit mic stop — means
  // "send now". Guards: never send an empty composer, and clear any pending
  // send-intent flag so the message can't fire twice.
  function _autoSendAfterDictation(){
    window._micPendingSend=false;
    const hasText=!!ta.value.trim();
    const hasFiles=!!(typeof S!=='undefined'&&S&&Array.isArray(S.pendingFiles)&&S.pendingFiles.length);
    if(hasText||hasFiles) send();
  }

  function _allowBrowserSttFallback(){
    return !!(SpeechRecognition&&localStorage.getItem(_micForceMediaRecorderKey)!=='1');
  }

  async function _transcribeBlob(blob, prefixSnapshot){
    const _bt=String(blob&&blob.type||'');
    const ext=_bt.includes('wav')?'wav':(_bt.includes('ogg')?'ogg':'webm');
    const form=new FormData();
    form.append('file',new File([blob],`voice-input.${ext}`,{type:_bt||`audio/${ext}`}));
    // Snapshot is passed in from the recorder.onstop handler — taken there
    // BEFORE _setRecording(false) clears _prefix (async server STT path).
    setComposerStatus('Transcribing…');
    try{
      const res=await fetch('api/transcribe',{method:'POST',body:form});
      const data=await res.json().catch(()=>({}));
      if(!res.ok){
        const err=new Error(data.error||'Transcription failed');
        err.status=res.status;
        throw err;
      }
      _commitTranscript(data.transcript||'', prefixSnapshot);
    }catch(err){
      if(_isServerSttUnavailable(err)&&_allowBrowserSttFallback()){
        window._micPendingSend=false;
        localStorage.setItem(_micForceMediaRecorderKey,'0');
        _forceMediaRecorder=false;
        recognition=_ensureSpeechRecognition();
        showToast(err.message||t('mic_network'));
        return;
      }
      window._micPendingSend=false;
      showToast(err.message||t('mic_network'));
    }finally{
      setComposerStatus('');
    }
  }

  function _stopTracks(stream=mediaStream){
    if(stream){
      stream.getTracks().forEach(track=>track.stop());
      if(mediaStream===stream) mediaStream=null;
    }
  }

  // Gate continuous dictation to an explicit opt-in flag. Default (also on
  // mobile): one-shot — a natural pause ends the session and the committed
  // transcript is sent immediately (Wings redesign: recording done = send).
  // 'wings-mic-continuous'='true' restores the legacy continuous mode for
  // power users who dictate in multiple bursts.
  function _micDictationContinuous(){
    try{ return localStorage.getItem('wings-mic-continuous')==='true'; }catch(_){ return false; }
  }

  // Only auto-restart the composer-mic session on a natural pause: continuity
  // must be enabled (mobile/opt-in), the session must still be active speech,
  // the stop must not have been requested, and we must be under the restart cap.
  function _micShouldRestartDictation(){
    return _micDictationContinuous()
      && !_speechStopRequested
      && !!window._micActive
      && _activeCaptureMode==='speech'
      && _micRestartCount<_micMaxRestarts;
  }

  // Screen Wake Lock while dictating. All acquire/release ops are chained onto a
  // single in-flight promise (_micWakeLockOp) so rapid start/stop/visibility
  // churn runs strictly in order and can't interleave to leak a lock or null
  // _micWakeLock mid-request.
  function _acquireMicWakeLock(){
    if(!navigator.wakeLock) return Promise.resolve();
    _micWakeLockOp=Promise.resolve(_micWakeLockOp).then(async()=>{
      if(_micWakeLock) return;
      if(!window._micActive||_activeCaptureMode!=='speech') return;
      try{
        const lock=await navigator.wakeLock.request('screen');
        // If the session ended while awaiting, don't hold a stale lock.
        if(!window._micActive||_activeCaptureMode!=='speech'){
          try{ await lock.release(); }catch(_){}
          return;
        }
        _micWakeLock=lock;
        _micWakeLock.addEventListener?.('release',()=>{ _micWakeLock=null; },{once:true});
      }catch(_){
        _micWakeLock=null;
      }
    });
    return _micWakeLockOp;
  }

  function _releaseMicWakeLock(){
    _micWakeLockOp=Promise.resolve(_micWakeLockOp).then(async()=>{
      const lock=_micWakeLock;
      _micWakeLock=null;
      if(!lock) return;
      try{ await lock.release(); }catch(_){}
    });
    return _micWakeLockOp;
  }

  // The OS drops a screen wake lock when the tab is hidden; reacquire on return
  // if we're still dictating (release on hide is a no-op if none is held).
  document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState==='hidden'){
      void _releaseMicWakeLock();
      return;
    }
    if(window._micActive&&_activeCaptureMode==='speech'){
      void _acquireMicWakeLock();
    }
  });

  function _stopMic(){
    _micStartSeq+=1;
    _isRecording=false;
    if(!window._micActive) return;
    // Stop the backend that was ACTIVE WHEN RECORDING STARTED — not whatever
    // _rawAudioMode says now. The user can toggle Settings → Sound mid-recording,
    // which would otherwise make us stop the wrong backend and orphan the other
    // (#3169 Codex review). _activeCaptureMode is pinned at start.
    if(recognition && _activeCaptureMode==='speech'){
      _speechStopRequested=true;
      recognition.stop();
      return;
    }
    if(wavRecorder && _activeCaptureMode==='media-transcribe'){
      // WAV capture path: stop the ScriptProcessor, encode PCM→WAV, and hand
      // the blob to _transcribeBlob (which re-enters via _micWavStop). Capture
      // the composer prefix BEFORE _setRecording(false) clears _prefix.
      const prefixSnapshot = _prefix;
      _setRecording(false);
      _micVadStop();
      _micWavStop(prefixSnapshot);
      _stopTracks();
      return;
    }
    if(mediaRecorder&&mediaRecorder.state!=='inactive'){
      mediaRecorder.stop();
      return;
    }
    _setRecording(false);
    _stopTracks();
  }
  window._stopMic=_stopMic; // expose for send-guard above

  function _ensureSpeechRecognition(){
    if(!SpeechRecognition) return null;
    const sr=recognition||new SpeechRecognition();
    // One-shot by default on all devices: a natural pause ends the session and
    // the committed transcript is sent immediately. Continuous mode survives
    // only as an explicit opt-in (wings-mic-continuous='true').
    sr.continuous=_micDictationContinuous();
    sr.interimResults=true;
    sr.lang=(typeof _locale!=='undefined'&&_locale._speech)||'en-US';

    sr.onstart=()=>{ _finalText=''; };

    sr.onresult=(event)=>{
      // #5294: a real result means the continuity restarts are PRODUCTIVE, not a
      // stolen-audio-session tight loop — reset the restart budget so a long
      // dictation with many natural pauses isn't silently capped at
      // _micMaxRestarts. The cap still guards the failure case: consecutive
      // restarts that yield no speech (onend without an intervening onresult)
      // keep incrementing and trip the bound.
      _micRestartCount=0;
      let interim='';
      let final=_finalText;
      for(let i=event.resultIndex;i<event.results.length;i++){
        const t=event.results[i][0].transcript;
        if(event.results[i].isFinal){ final+=t; _finalText=final; }
        else{ interim+=t; }
      }
      ta.value=_prefix+(final||interim);
      autoResize();
    };

    sr.onend=()=>{
      const committed=_finalText
        ? (_prefix&&!_prefix.endsWith(' ')&&!_prefix.endsWith('\n')
            ? _prefix+' '+_finalText.trimStart()
            : _prefix+_finalText)
        : ta.value;
      ta.value=committed;
      autoResize();
      // Mobile / opt-in continuity: a natural pause ends this recognition run but
      // the user is still dictating, so restart to keep the session alive. Desktop
      // (one-shot) and intentional stops (_speechStopRequested) skip this and
      // finalize. Bounded by _micMaxRestarts so a stolen audio session can't loop.
      if(_micShouldRestartDictation()){
        _prefix=committed&&!committed.endsWith(' ')&&!committed.endsWith('\n')
          ? committed+' '
          : committed;
        _finalText='';
        _micRestartCount++;
        try{
          sr.start();
          return;
        }catch(err){
          // Restart failed (e.g. the audio session was taken by another app).
          // Surface it instead of silently dropping to idle (Greptile P2).
          showToast(t('mic_error')+String((err&&err.message)||'restart'));
        }
      }
      _speechStopRequested=false;
      _isRecording=false;
      _micRestartCount=0;
      void _releaseMicWakeLock();
      _setRecording(false);
      // Recording ended (natural pause or explicit mic stop) → send immediately.
      _autoSendAfterDictation();
      _applyDeferredServerSttFlip();
    };

    sr.onerror=(event)=>{
      // While dictating with continuity on, a no-speech/aborted error is a normal
      // pause or transient audio-session hiccup — swallow it and let onend restart
      // (bounded by _micMaxRestarts). Desktop one-shot still surfaces the toast.
      if((event.error==='no-speech'||event.error==='aborted')
          && _micDictationContinuous()
          && window._micActive
          && _activeCaptureMode==='speech'
          && !_speechStopRequested
          && _micRestartCount<_micMaxRestarts){
        return;
      }
      _speechStopRequested=false;
      _setRecording(false);
      window._micPendingSend=false;
      _isRecording=false;
      _micRestartCount=0;
      void _releaseMicWakeLock();
      if(event.error==='network'||event.error==='not-allowed'
          ||event.error==='service-not-allowed'||event.error==='audio-capture'){
        // Persist SR failure: next reload will skip SpeechRecognition
        localStorage.setItem(_micForceMediaRecorderKey,'1');
        _forceMediaRecorder=true;
        recognition=null;
      }
      const messageKey=_micToastKeyForRecognitionError(event.error);
      showToast(messageKey?t(messageKey):t('mic_error')+event.error);
    };

    return sr;
  }

  if(!_forceMediaRecorder){
    recognition=_ensureSpeechRecognition();
  }

  async function _probeServerSttCapability(){
    if(!_canRecordAudio||_micForceMediaRecorderStored!==null) return;
    try{
      const res=await fetch('api/transcribe/capability',{cache:'no-store'});
      const data=await res.json().catch(()=>({}));
      if(res.ok&&data&&data.available){
        _serverSttAvailable=true;
        if(!window._micActive){
          _forceMediaRecorder=true;
          recognition=null;
        }
      }
    }catch(_err){
      // Keep browser SpeechRecognition as the safe first-click default when the
      // passive capability probe fails.
    }
  }

  // If the capability probe resolved WHILE a session was active, the flip to
  // server STT was deferred to protect that in-flight session. Apply it once the
  // session ends so subsequent clicks use the configured server STT as intended.
  // Reads LIVE localStorage (not the init-time const) so a fallback that just
  // persisted '0' is respected and not re-flipped.
  function _applyDeferredServerSttFlip(){
    if(_serverSttAvailable&&!_forceMediaRecorder&&!window._micActive
        &&localStorage.getItem(_micForceMediaRecorderKey)===null){
      _forceMediaRecorder=true;
      recognition=null;
    }
  }

  _probeServerSttCapability();

  function _clearMicHoldTimer(){
    if(_micHoldTimer){
      clearTimeout(_micHoldTimer);
      _micHoldTimer=null;
    }
  }

  function _resetMicHoldState(){
    _clearMicHoldTimer();
    _micHoldActive=false;
    _micPointerDown=false;
  }

  function _micButtonAvailable(){
    if(!btn||btn.disabled) return false;
    if(btn.style.display==='none') return false;
    if(btn.classList.contains('composer-control-hidden')) return false;
    if(btn.getAttribute('aria-hidden')==='true') return false;
    if(window.getComputedStyle&&window.getComputedStyle(btn).display==='none') return false;
    return true;
  }

  async function _startMicCapture(holdRequired=false){
    if(!_micButtonAvailable()) return;
    const startSeq=++_micStartSeq;
    // Race-condition guard: ignore rapid double-clicks
    if(_isRecording){
      _stopMic();
      _isRecording=false;
      return;
    }
    if(window._micActive){
      _stopMic();
      return;
    }
    _isRecording=true;
    _finalText='';
    _prefix=ta.value;
    if(_micOriginNeedsSecureContext()){
      _isRecording=false;
      window._micPendingSend=false;
      showToast(t('mic_insecure_origin'));
      return;
    }
    if(recognition && !_forceMediaRecorder && !_rawAudioMode){
      _activeCaptureMode='speech';
      _speechStopRequested=false;
      _micRestartCount=0;
      // Refresh continuity gate at start so a settings/orientation change takes
      // effect for this session (desktop stays one-shot, mobile stays continuous).
      recognition.continuous=_micDictationContinuous();
      recognition.lang=(typeof _locale!=='undefined'&&_locale._speech)||'en-US';
      recognition.start();
      void _acquireMicWakeLock();
      _setRecording(true);
      return;
    }
    if(!_canRecordAudio){
      _isRecording=false;
      showToast(t('mic_network'));
      return;
    }
    try{
      const captureStream=await navigator.mediaDevices.getUserMedia({audio:true});
      if(startSeq!==_micStartSeq||!_micButtonAvailable()||(holdRequired&&!_micHoldActive)){
        _isRecording=false;
        _stopTracks(captureStream);
        return;
      }
      mediaStream=captureStream;
      const preferredTypes=['audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus','audio/ogg'];
      const mimeType=preferredTypes.find(type=>window.MediaRecorder.isTypeSupported?.(type))||'';
      const captureMode=_rawAudioMode?'media-raw':'media-transcribe';
      // Server-STT (media-transcribe) path: capture raw PCM via the Web Audio
      // API and encode WAV on stop — MediaRecorder's WebM/Opus output is not
      // decodable by the upstream vLLM ASR backend ("Format not recognised").
      // VAD provides the auto-stop on a natural pause; raw-audio mode stays
      // manual (user clicks / holds) and keeps MediaRecorder.
      if(captureMode==='media-transcribe'){
        _micVadStart(captureStream);
        if(_micWavStart(captureStream)){
          _activeCaptureMode='media-transcribe';
          _setRecording(true);
          return;
        }
        // WAV capture unavailable (no AudioContext) → fall through to MediaRecorder.
        _micVadStop();
      }
      const recorder=new MediaRecorder(captureStream,mimeType?{mimeType}:undefined);
      audioChunks=[];
      const captureChunks=audioChunks;
      recorder.ondataavailable=e=>{if(e.data&&e.data.size)captureChunks.push(e.data);};
      recorder.onerror=()=>{
        const isCurrentCapture=mediaRecorder===recorder||mediaStream===captureStream;
        _isRecording=false;
        if(mediaRecorder===recorder) mediaRecorder=null;
        if(isCurrentCapture) _setRecording(false);
        window._micPendingSend=false;
        _stopTracks(captureStream);
        showToast(t('mic_network'));
      };
      recorder.onstop=async()=>{
        const isCurrentCapture=mediaRecorder===recorder||mediaStream===captureStream;
        if(mediaRecorder===recorder) mediaRecorder=null;
        _isRecording=false;
        // Capture the composer prefix BEFORE _setRecording(false) clears _prefix.
        // The await on _transcribeBlob runs after this sync block, so by the
        // time _transcribeBlob is called, _prefix is already ''. Passing the
        // snapshot through keeps append-mode working on the async server-STT
        // path. See _commitTranscript() for how the snapshot is consumed.
        const prefixSnapshot = _prefix;
        const blob=new Blob(captureChunks,{type:recorder.mimeType||mimeType||'audio/webm'});
        if(isCurrentCapture) _setRecording(false);
        _micVadStop();
        _stopTracks(captureStream);
        if(blob.size){
          if(captureMode==='media-raw'){
            await _sendRawAudio(blob);
          }else{
            await _transcribeBlob(blob, prefixSnapshot);
          }
        }
        else if(window._micPendingSend){
          window._micPendingSend=false;
        }
        _applyDeferredServerSttFlip();
      };
      _activeCaptureMode=captureMode;
      mediaRecorder=recorder;
      recorder.start();
      _setRecording(true);
    }catch(err){
      if(startSeq!==_micStartSeq) return;
      _isRecording=false;
      window._micPendingSend=false;
      _micVadStop();
      _micWavStop();
      _stopTracks();
      showToast(t(_micToastKeyForRecognitionError('not-allowed')||'mic_denied'));
    }
  }

  async function _toggleMicCapture(){
    if(!_micButtonAvailable()) return;
    if(window._micActive){
      _stopMic();
      return;
    }
    await _startMicCapture();
  }
  window._toggleMicCapture=_toggleMicCapture;

  btn.addEventListener('pointerdown',e=>{
    if(e.button!==0) return;
    if(!_micButtonAvailable()) return;
    _resetMicHoldState();
    _micPointerDown=true;
    _micHoldTimer=setTimeout(async()=>{
      _micHoldTimer=null;
      if(!_micPointerDown||window._micActive) return;
      _micHoldActive=true;
      await _startMicCapture(true);
    },_micHoldThresholdMs);
  });

  btn.addEventListener('pointerup',async e=>{
    if(e.button!==0||!_micPointerDown) return;
    _clearMicHoldTimer();
    if(_micHoldActive){
      _micHoldActive=false;
      _micPointerDown=false;
      _stopMic();
      return;
    }
    _micPointerDown=false;
    await _toggleMicCapture();
  });

  btn.addEventListener('pointerleave',()=>{
    _clearMicHoldTimer();
    if(_micHoldActive){
      _micHoldActive=false;
      _micPointerDown=false;
      _stopMic();
      return;
    }
    _micPointerDown=false;
  });

  btn.addEventListener('pointercancel',()=>{
    _clearMicHoldTimer();
    if(_micHoldActive){
      _micHoldActive=false;
      _micPointerDown=false;
      _stopMic();
      return;
    }
    _micPointerDown=false;
  });

  btn.addEventListener('click',async e=>{
    if(e.detail!==0) return;
    await _toggleMicCapture();
  });

  // Wire up the settings checkbox
  const rawAudioCheckbox = document.getElementById('settingsRawAudio');
  if(rawAudioCheckbox){
    rawAudioCheckbox.checked = _rawAudioMode;
    rawAudioCheckbox.addEventListener('change', function(){
      _applyRawAudioModePreference(this.checked);
    });
  }
  const appendCheckbox = document.getElementById('settingsDictationAppend');
  if(appendCheckbox){
    appendCheckbox.checked = _dictationAppend;
    appendCheckbox.addEventListener('change', function(){
      _applyDictationAppendPreference(this.checked);
    });
  }
  _updateMicTooltip();
})();
window._micActive=window._micActive||false;
window._micPendingSend=window._micPendingSend||false;
// Eager default for the empty-state suggestion buttons: hidden until the
// server-side preference resolves (default is OFF). Prevents a flash of
// suggestions on first paint; applyEmptyStateSuggestionPref() re-syncs once
// /api/settings arrives.
window._hideEmptyStateSuggestions=window._hideEmptyStateSuggestions!==undefined?window._hideEmptyStateSuggestions:true;

// ── Default message mode eager default (#5167 / #5145) ──────────────────────
// The Default message mode preference (queue/interrupt/steer) is read on the
// send path via `window._defaultMessageMode||'steer'`. The authoritative value
// only arrives once the async boot IIFE below resolves the `/api/settings`
// fetch. Without an eager value, every send during that boot window silently
// falls back, ignoring a saved 'queue'/'interrupt' preference (worse on
// slow/contended environments like WSL2, see #5132). Mirror the resolved value
// into localStorage — the same synchronous-source pattern used by wings-lang /
// wings-theme — so the very first send after a reload honors the saved choice.
const _DEFAULT_MESSAGE_MODES=['queue','interrupt','steer'];
// Legacy localStorage key (pre-#5145 rename); read it as a fallback so an
// existing user's persisted busy-input-mode preference survives the rename.
const _LEGACY_DEFAULT_MESSAGE_MODE_KEY='wings-busy-input-mode';
const _DEFAULT_MESSAGE_MODE_KEY='wings-default-message-mode';
function _normalizeDefaultMessageMode(mode){
  return _DEFAULT_MESSAGE_MODES.includes(mode)?mode:'steer';
}
function _persistDefaultMessageMode(mode){
  const m=_normalizeDefaultMessageMode(mode);
  try{localStorage.setItem(_DEFAULT_MESSAGE_MODE_KEY,m);}catch(_){}
  return m;
}
function _readPersistedDefaultMessageMode(){
  let stored=null;
  try{
    // Prefer the new key; fall back to the legacy key so a pre-rename
    // preference is honored until the next explicit save rewrites the new key.
    stored=localStorage.getItem(_DEFAULT_MESSAGE_MODE_KEY);
    if(stored===null||stored===undefined) stored=localStorage.getItem(_LEGACY_DEFAULT_MESSAGE_MODE_KEY);
  }catch(_){}
  return _normalizeDefaultMessageMode(stored);
}
window._persistDefaultMessageMode=_persistDefaultMessageMode;
window._readPersistedDefaultMessageMode=_readPersistedDefaultMessageMode;
// Eager default set BEFORE the async settings fetch resolves so first sends in
// the boot window honor the persisted preference instead of the raw default.
window._defaultMessageMode=_readPersistedDefaultMessageMode();

// ── Extension TTS-engine registry (registerWingsTtsEngine) ──────────────────
// Defined at MODULE scope (not inside the voice-mode IIFE below) so the public
// API exists even on browsers without SpeechRecognition / speechSynthesis — an
// extension can register a TTS engine regardless of STT/browser-TTS support.
// Lets a trusted local extension contribute a TTS engine that appears in the
// Settings -> TTS Engine dropdown and is used by BOTH playback paths (voice-mode
// auto-read and the per-message Listen button). The extension provides an async
// synthesize(text, opts) that returns audio bytes (ArrayBuffer or Blob); core
// handles selection, the dropdown option, and playback. Mirrors registerWingsSkin.
//
//   window.registerWingsTtsEngine({
//     id: 'voicevox',            // [a-z0-9_-], not a built-in (browser/edge/elevenlabs/openai)
//     label: 'VOICEVOX (local)',
//     synthesize(text, opts) { return Promise<ArrayBuffer|Blob>; }
//   }) -> true on success, false if rejected
var _WINGS_TTS_ENGINES = Object.create(null);
var _WINGS_TTS_RESERVED = { browser:1, edge:1, elevenlabs:1, openai:1 };
function _wingsTtsValidId(id){ return typeof id==='string' && /^[a-z0-9][a-z0-9_-]{0,31}$/.test(id); }
function _wingsAddTtsOption(id, label){
  var sel=document.getElementById('settingsTtsEngine');
  if(!sel) return;
  if(sel.querySelector('option[value="'+id+'"]')) return;
  var opt=document.createElement('option');
  opt.value=id;
  opt.textContent=label;   // textContent — never innerHTML (no injection)
  sel.appendChild(opt);
}
window.registerWingsTtsEngine=function(desc){
  try{
    if(!desc||typeof desc!=='object') return false;
    var id=String(desc.id||'').toLowerCase();
    if(!_wingsTtsValidId(id)) return false;
    if(_WINGS_TTS_RESERVED[id]) return false;          // can't shadow a built-in
    if(typeof desc.synthesize!=='function') return false;
    var label=(typeof desc.label==='string' && desc.label.trim()) ? desc.label.trim().slice(0,48) : id;
    _WINGS_TTS_ENGINES[id]={ id:id, label:label, synthesize:desc.synthesize };
    _wingsAddTtsOption(id, label);
    return true;
  }catch(_){ return false; }
};
window._wingsTtsIsRegistered=function(id){ return !!_WINGS_TTS_ENGINES[id]; };
// List registered engines (for the settings panel to re-add options on render).
window._wingsTtsEngineOptions=function(){
  return Object.keys(_WINGS_TTS_ENGINES).map(function(k){
    return { id:_WINGS_TTS_ENGINES[k].id, label:_WINGS_TTS_ENGINES[k].label };
  });
};
// Returns a Promise<ArrayBuffer> or null if the engine isn't registered.
window._wingsTtsSynth=function(id, text, opts){
  var eng=_WINGS_TTS_ENGINES[id];
  if(!eng) return null;
  return Promise.resolve()
    .then(function(){ return eng.synthesize(text, opts||{}); })
    .then(function(out){
      if(!out) throw new Error('empty TTS result');
      if(out instanceof ArrayBuffer) return out;
      if(typeof Blob!=='undefined' && out instanceof Blob) return out.arrayBuffer();
      if(out.buffer instanceof ArrayBuffer) return out.buffer;   // typed array
      throw new Error('TTS engine returned an unsupported type');
    });
};

// ── Turn-based voice mode (#1333) ────────────────────────────────────────
// Chained flow: listen → send → (agent processes) → TTS response → listen again
(function(){
  const SpeechRecognition=window.SpeechRecognition||window.webkitSpeechRecognition;
  const hasSTT=!(!SpeechRecognition);
  const hasTTS=!!('speechSynthesis' in window);

  // Need both STT and TTS for turn-based voice mode
  if(!hasSTT||!hasTTS) return;

  const modeBtn=$('btnVoiceMode');
  const bar=$('voiceModeBar');
  const indicator=$('voiceModeIndicator');
  const label=$('voiceModeLabel');
  const micBtn=$('btnMic');
  const ta=$('msg');

  if(!modeBtn||!bar||!indicator||!label) return;

  // Voice-mode button is gated behind a Preferences toggle (#1488).
  // Default off — keeps the composer footer uncluttered for users who
  // only need plain dictation. The hands-free conversation feature is
  // a power-user surface; explicit opt-in avoids the visual confusion
  // of two near-identical mic icons.
  function _voiceModePrefEnabled(){
    try{ return localStorage.getItem('wings-voice-mode-button')==='true'; }
    catch(_){ return false; }
  }
  let _voiceModeActive=false;

  function _applyVoiceModePref(){
    const enabled = _voiceModePrefEnabled();
    modeBtn.style.display = enabled ? '' : 'none';
    if(!enabled && _voiceModeActive) _deactivate();
  }
  _applyVoiceModePref();
  // Expose so the settings pane can re-apply immediately on toggle.
  window._applyVoiceModePref = _applyVoiceModePref;

  let _voiceModeState='idle'; // idle | listening | thinking | speaking
  let _recognition=null;
  let _silenceTimer=null;
  // Capture the session id at thinking-time so the TTS callback won't read
  // a different session's last assistant reply if the user navigated away
  // between send and stream completion. (Opus pre-release advisor.)
  let _voiceModeThinkingSid=null;
  let _browserTtsKeepAlive=null;
  let _browserTtsWatchdog=null;
  let _browserTtsSuppressNextErrorRearm=false;
  // Configurable via localStorage keys (set from dev console or a future settings panel).
//   wings-voice-silence-ms, pause duration before auto-send (ms, default 1800)
//   wings-voice-continuous, keep mic open across natural pauses ("true"/"false", default false)
  function _voiceSilenceMs(){
    const _silenceMsRaw=parseInt(localStorage.getItem('wings-voice-silence-ms'),10);
    return (Number.isFinite(_silenceMsRaw)&&_silenceMsRaw>0)?Math.max(200,_silenceMsRaw):1800;
  }

  function _clearBrowserTtsRecovery(){
    if(_browserTtsKeepAlive){
      clearInterval(_browserTtsKeepAlive);
      _browserTtsKeepAlive=null;
    }
    if(_browserTtsWatchdog){
      clearTimeout(_browserTtsWatchdog);
      _browserTtsWatchdog=null;
    }
  }

  function _armBrowserTtsRecovery(clean, rate){
    _clearBrowserTtsRecovery();
    _browserTtsSuppressNextErrorRearm=false;
    const safeRate=(Number.isFinite(rate)&&rate>0)?rate:1;
    // Chromium can drop utter.onend on later turns, so force a recovery path.
    const watchdogMs=Math.max(4000,Math.round((String(clean||'').length/(12*safeRate))*1000)+10000);
    _browserTtsWatchdog=setTimeout(()=>{
      if(!_voiceModeActive||_voiceModeState!=='speaking') return;
      _browserTtsSuppressNextErrorRearm=true;
      try{ speechSynthesis.cancel(); }catch(_){}
      _clearBrowserTtsRecovery();
      _startListening();
    },watchdogMs);
    _browserTtsKeepAlive=setInterval(()=>{
      if(!_voiceModeActive||_voiceModeState!=='speaking'){
        _clearBrowserTtsRecovery();
        return;
      }
      if(!speechSynthesis.speaking) return;
      try{
        speechSynthesis.pause();
        speechSynthesis.resume();
      }catch(_){}
    },10000);
  }

  function _setState(state){
    _voiceModeState=state;
    indicator.className='voice-mode-indicator '+state;
    label.textContent=state==='listening'?t('voice_listening')
      :state==='speaking'?t('voice_speaking')
      :state==='thinking'?t('voice_thinking')
      :'';
    bar.style.display=_voiceModeActive?(state==='idle'?'none':''):'none';
  }

  function _startListening(){
    if(!_voiceModeActive) return;
    if(_micOriginNeedsSecureContext()){
      _deactivate();
      showToast(t('mic_insecure_origin'));
      return;
    }
    _bargeStop();
    _clearBrowserTtsRecovery();
    _setState('listening');

    _recognition=new SpeechRecognition();
    _recognition.continuous=localStorage.getItem('wings-voice-continuous')==='true';
    _recognition.interimResults=true;
    _recognition.lang=(typeof _locale!=='undefined'&&_locale._speech)||'en-US';

    let _finalText='';

    _recognition.onstart=()=>{ _finalText=''; };

    _recognition.onresult=(event)=>{
      // Reset silence timer on any result
      clearTimeout(_silenceTimer);
      let interim='';
      let final=_finalText;
      for(let i=event.resultIndex;i<event.results.length;i++){
        const txt=event.results[i][0].transcript;
        if(event.results[i].isFinal){ final+=txt; _finalText=final; }
        else{ interim+=txt; }
      }
      ta.value=final||interim;
      autoResize();

      // Auto-send on silence after final result
      if(_finalText){
        _silenceTimer=setTimeout(()=>{
          _voiceModeSend();
        },_voiceSilenceMs());
      }
    };

    _recognition.onend=()=>{
      clearTimeout(_silenceTimer);
      // If we have text and haven't sent yet, send it
      if(_finalText&&_voiceModeActive&&_voiceModeState==='listening'){
        _voiceModeSend();
      } else if(_voiceModeActive&&_voiceModeState==='listening'){
        // No speech detected — restart listening
        setTimeout(()=>{ if(_voiceModeActive) _startListening(); },500);
      }
    };

    _recognition.onerror=(event)=>{
      clearTimeout(_silenceTimer);
      if(event.error==='no-speech'||event.error==='aborted'){
        // Restart ONLY while actually listening — never over an in-flight
        // turn. _voiceModeSend() aborts the recognition, which fires
        // 'aborted' here moments later; without the state guard this yanks
        // voice mode back to "Hören" ~800ms after every send, so the
        // assistant's reply arrives while the mic is already listening
        // again, the autoReadLastAssistant guard (state==='thinking')
        // blocks _speakResponse, and no TTS ever plays. The onend handler
        // below already has the same 'listening' guard.
        if(_voiceModeActive&&_voiceModeState==='listening'){
          setTimeout(()=>{ if(_voiceModeActive) _startListening(); },800);
        }
        return;
      }
      if(event.error==='not-allowed'||event.error==='service-not-allowed'||event.error==='audio-capture'){
        _deactivate();
        const messageKey=_micToastKeyForRecognitionError(event.error);
        showToast(messageKey?t(messageKey):t('mic_error')+event.error);
        return;
      }
      // Other errors — restart only while actually listening.
      if(_voiceModeActive&&_voiceModeState==='listening'){
        setTimeout(()=>{ if(_voiceModeActive) _startListening(); },1500);
      }
    };

    try{ _recognition.start(); }catch(e){
      // Already started or other error — retry shortly
      setTimeout(()=>{ if(_voiceModeActive) _startListening(); },1000);
    }
  }

  function _voiceModeSend(){
    if(!_voiceModeActive) return;
    let text=(ta.value||'').trim();
    if(!text){
      ta.value='';
      setTimeout(()=>{ if(_voiceModeActive) _startListening(); },300);
      return;
    }
    // Barge-in latch: if the user interrupted the previous spoken reply, tell
    // the model (same note text as the Hermes agent's take_speech_interrupted).
    if(_bargeInterrupted){
      _bargeInterrupted=false;
      text='[Note: the user interrupted your previous spoken reply before it finished.] '+text;
    }
    ta.value=text;
    _setState('thinking');
    // Pin the active session id so the TTS callback won't speak a different
    // session's reply if the user navigates away mid-stream.
    _voiceModeThinkingSid=(typeof S!=='undefined'&&S.session)?S.session.session_id:null;
    try{ if(_recognition) _recognition.abort(); }catch(_){}
    _recognition=null;
    // Arm the full-duplex barge monitor: the user can cut in by voice during
    // generation AND playback, not only while listening.
    _bargeStart();
    // send() is global from boot.js
    if(typeof send==='function') send();
  }

  // ── Barge-in (Unterbrechungserkennung) ────────────────────────────────
  // Port of the Hermes agent's full_duplex_listen VAD (voice_mode.py):
  // calibrate against the QUIET room at turn start (before any TTS exists),
  // hold that baseline through playback (never absorb speaker bleed),
  // phase-clamp the trigger (>= PLAYBACK_MIN_TRIGGER while audio flows, so
  // bleed alone can't trip), and trip on a windowed majority of blocks so
  // intra-word energy dips don't reset progress. The earlier 8x-multiplier
  // variant computed a 3200 trigger over a 400 floor — unreachable for
  // normal speech (2000-4000 RMS), and speech below trigger fed the floor
  // until the trigger pinned at the 4000 ceiling, making barge-in
  // impossible. Best-effort: mic failures retry briefly, then silently
  // degrade to normal voice mode.
  const _BARGE_BLOCK_MS=30;
  const _BARGE_CALIB_BLOCKS=15;     // ~450ms quiet-room calibration
  const _BARGE_TRIP_BLOCKS=10;      // ~300ms detection window
  const _BARGE_TRIP_NEEDED=8;       // >=80% of window above trigger
  const _BARGE_GRACE_BLOCKS=60;     // ~1.8s trip-free playback onset (covers
                                    // the bleed-floor seed phase)
  const _BARGE_WINDOW_BLOCKS=100;   // ~3s ambient drift window
  const _BARGE_SILENCE_RMS=200;     // agent SILENCE_RMS_THRESHOLD
  const _BARGE_MULT=3.0;            // agent DEFAULT_BARGE_MULTIPLIER
  const _BARGE_PLAYBACK_MIN_TRIGGER=1500; // agent PLAYBACK_MIN_TRIGGER
  const _BARGE_TRIGGER_CEILING=4000;
  // Playback bleed handling: the first ~2s of playback are trip-free
  // (grace + seed) while the bleed floor fills; afterwards the trigger is
  // raised adaptively to clear the speaker bleed (4x over the rolling
  // 90th-percentile floor), so loud speakers no longer false-trip the
  // VAD while real speech (3000-8000 RMS) still can.
  const _BARGE_BLEED_MULT=4.0;
  const _BARGE_PLAYBACK_SEED_BLOCKS=60;   // ~1.8s bleed-floor seed
  const _BARGE_MIC_RETRIES=3;
  const _BARGE_MIC_RETRY_MS=400;
  const _BARGE_PREROLL_CHUNKS=18;         // ~1.5s pre-roll ring buffer (4096/48k)
  const _BARGE_CAPTURE_MAX_MS=8000;       // interruption capture cap
  const _BARGE_CAPTURE_ENDPOINT_MS=1200;  // silence endpointing
  const _BARGE_GENERATION_MIN_TRIGGER=1200; // ambient-dynamics floor while the
                                            // LLM runs — the old 600 tripped on
                                            // keyboards/fans and looped
                                            // capture→send→capture until the
                                            // browser froze
  const _BARGE_CAPTURE_PEAK_MIN=1500;     // captured audio must contain real
                                          // speech energy (else: no send)
  const _BARGE_CAPTURE_SEND_COOLDOWN_MS=6000; // at most one capture-send per 6s
  let _bargeLastCaptureSendAt=0;
  let _bargeActive=false;
  let _bargeInterrupted=false;
  let _bargeCtx=null;
  let _bargeStream=null;
  let _bargeAnalyser=null;
  let _bargeBuf=null;
  let _bargeTimer=null;
  let _bargeProc=null;
  let _bargePreRoll=[];
  let _bargeMicAttempts=0;
  let _bargeAmbient=[];
  let _bargeQuietFloor=0;
  let _bargeFloorLocked=false;
  let _bargeBleed=[];               // rolling mic RMS while TTS plays (bleed)
  let _bargeRecentAbove=[];
  let _bargePlayingPrev=false;
  let _bargePlaybackSeen=false;
  let _bargeGraceRemaining=0;
  let _bargeBlocksSincePlayback=10000;

  function _bargePercentile(values,p){
    if(!values.length) return 0;
    const sorted=values.slice().sort((a,b)=>a-b);
    const idx=Math.min(sorted.length-1,Math.floor((p/100)*(sorted.length-1)));
    return sorted[idx];
  }

  // True while TTS audio is actually flowing (the streaming player holds
  // _playingEdgeAudio for the duration of the current sentence).
  function _bargeIsPlaying(){
    return !!_playingEdgeAudio;
  }

  function _bargeStop(keepStream){
    _bargeActive=false;
    if(_bargeTimer){ clearInterval(_bargeTimer); _bargeTimer=null; }
    if(_bargeProc){ try{ _bargeProc.onaudioprocess=null; _bargeProc.disconnect(); }catch(_){} _bargeProc=null; }
    if(_bargeStream){
      // keepStream=true hands the mic to the interruption capture
      // (transcribe-from-pre-roll); otherwise release the device.
      if(!keepStream){
        try{ _bargeStream.getTracks().forEach(t=>t.stop()); }catch(_){}
      }
      _bargeStream=null;
    }
    if(_bargeCtx){
      try{ _bargeCtx.close(); }catch(_){}
      _bargeCtx=null;
    }
    _bargeAnalyser=null;
    _bargeBuf=null;
    _bargePreRoll=[];
    _bargeAmbient=[];
    _bargeQuietFloor=0;
    _bargeFloorLocked=false;
    _bargeBleed=[];
    _bargeRecentAbove=[];
    _bargePlayingPrev=false;
    _bargePlaybackSeen=false;
    _bargeGraceRemaining=0;
    _bargeBlocksSincePlayback=10000;
  }

  function _bargeStart(){
    if(!_voiceModeActive||_bargeActive) return;
    if(_micOriginNeedsSecureContext()) return;
    const C=window.AudioContext||window.webkitAudioContext;
    if(!C||!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia) return;
    _bargeActive=true;
    _bargeMicAttempts=0;
    _bargeOpenMic();
  }

  function _bargeOpenMic(){
    if(!_bargeActive) return;
    const C=window.AudioContext||window.webkitAudioContext;
    navigator.mediaDevices.getUserMedia({audio:true}).then(stream=>{
      if(!_bargeActive){
        try{ stream.getTracks().forEach(t=>t.stop()); }catch(_){}
        return;
      }
      _bargeStream=stream;
      try{
        _bargeCtx=new C();
        if(_bargeCtx.state==='suspended'){
          try{ _bargeCtx.resume().catch(()=>{}); }catch(_){}
        }
        const src=_bargeCtx.createMediaStreamSource(stream);
        _bargeAnalyser=_bargeCtx.createAnalyser();
        _bargeAnalyser.fftSize=2048;
        _bargeAnalyser.smoothingTimeConstant=0;
        src.connect(_bargeAnalyser);
        _bargeBuf=new Float32Array(_bargeAnalyser.fftSize);
        // Pre-roll ring buffer: continuously capture the mic PCM so a barge-in
        // can be transcribed FROM ITS FIRST WORD (the VAD trip only fires
        // after ~300-500ms of speech — without pre-roll those first words are
        // lost and the interruption comes back empty).
        try{
          const proc=_bargeCtx.createScriptProcessor(4096,1,1);
          _bargePreRoll=[];
          proc.onaudioprocess=function(e){
            const d=e.inputBuffer.getChannelData(0);
            if(_bargePreRoll.length>=_BARGE_PREROLL_CHUNKS) _bargePreRoll.shift();
            _bargePreRoll.push(new Float32Array(d));
          };
          const silent=_bargeCtx.createGain();
          silent.gain.value=0;
          src.connect(proc);
          proc.connect(silent);
          silent.connect(_bargeCtx.destination);
          _bargeProc=proc;
        }catch(_){ _bargePreRoll=[]; _bargeProc=null; }
        _bargeTimer=setInterval(_bargeTick,_BARGE_BLOCK_MS);
        console.debug('[wings-barge] monitor armed');
      }catch(_){ _bargeStop(); }
    }).catch(err=>{
      // The mic may still be held by the just-aborted SpeechRecognition;
      // retry briefly before giving up for this turn.
      if(_bargeActive&&_bargeMicAttempts<_BARGE_MIC_RETRIES){
        _bargeMicAttempts++;
        setTimeout(_bargeOpenMic,_BARGE_MIC_RETRY_MS);
      }else{
        console.debug('[wings-barge] mic unavailable:',err&&err.name);
        _bargeActive=false;
      }
    });
  }

  function _bargeTick(){
    if(!_bargeActive||!_bargeAnalyser||!_bargeBuf) return;
    _bargeAnalyser.getFloatTimeDomainData(_bargeBuf);
    let sum=0;
    for(let i=0;i<_bargeBuf.length;i++){ const v=_bargeBuf[i]; sum+=v*v; }
    const rms=Math.sqrt(sum/_bargeBuf.length)*32768;   // int16-scale RMS
    const playing=_bargeIsPlaying();

    // Pre-playback calibration: sample the quiet room, never speaker bleed.
    if(!_bargeFloorLocked){
      if(!playing){ _bargeAmbient.push(rms); }
      if(_bargeAmbient.length>=_BARGE_CALIB_BLOCKS||playing){
        const pct90=_bargePercentile(_bargeAmbient,90);
        _bargeQuietFloor=Math.max(pct90,_BARGE_SILENCE_RMS);
        _bargeFloorLocked=true;
        console.debug('[wings-barge] calibrated floor='+Math.round(_bargeQuietFloor));
      }
      if(!_bargeFloorLocked) return;
    }

    // Playback onset -> grace window (suppress the onset transient). Grace
    // only when playback starts after a real gap (>=1s), so inter-sentence
    // flapping can't chain grace windows together.
    if(playing&&!_bargePlayingPrev){
      if(!_bargePlaybackSeen||_bargeBlocksSincePlayback>33){
        _bargeGraceRemaining=_BARGE_GRACE_BLOCKS;
      }
      _bargePlaybackSeen=true;
    }
    _bargePlayingPrev=playing;
    _bargeBlocksSincePlayback=playing?0:_bargeBlocksSincePlayback+1;

    // Trigger: quiet baseline x mult, phase-clamped. During playback the
    // trigger must also clear the SPEAKER BLEED the mic picks up from the
    // TTS itself — a fixed 1500 clamp false-trips as soon as the audio
    // actually plays through loud speakers (bleed 1500-4000 RMS), killing
    // the playback every turn. Instead, track a rolling bleed floor from
    // the mic level while audio flows and raise the trigger adaptively:
    //   trigger_playback = clamp(max(quiet*3, bleed*4), 1500, 4000)
    // The bleed window is seeded during the first ~2s of playback (the
    // grace window + 60-block seed; speaker bleed sets in 50-300ms after
    // playback starts, so a short seed leaves the floor empty and the
    // late bleed trips the VAD). The seed phase is trip-free. Afterwards
    // the window is fed only by blocks below the current trigger, so
    // genuine speech never poisons it.
    let trigger=_bargeQuietFloor*_BARGE_MULT;
    // The whole speaking phase (including the wait for the first audio
    // chunk, when nothing plays yet) must use the playback trigger floor —
    // a room-noise trip during that wait would kill the TTS before the
    // first sentence is even heard. _voiceModeState lives in this IIFE.
    const _inSpeaking=_voiceModeState==='speaking';
    if(playing||_inSpeaking){
      if(playing){
        if(_bargeGraceRemaining>0||_bargeBleed.length<_BARGE_PLAYBACK_SEED_BLOCKS){
          _bargeBleed.push(rms);
        }else if(rms<trigger){
          if(_bargeBleed.length>=_BARGE_WINDOW_BLOCKS) _bargeBleed.shift();
          _bargeBleed.push(rms);
        }
        const bleed=_bargeBleed.length?_bargePercentile(_bargeBleed,90):0;
        trigger=Math.max(trigger,Math.min(Math.max(bleed*_BARGE_BLEED_MULT,_BARGE_PLAYBACK_MIN_TRIGGER),_BARGE_TRIGGER_CEILING));
      }else{
        // Speaking but no audio flowing yet (waiting on the first chunk):
        // hold at the playback minimum — ambient noise must not trip here.
        trigger=Math.max(trigger,_BARGE_PLAYBACK_MIN_TRIGGER);
      }
    }else{
      trigger=Math.max(trigger,_BARGE_GENERATION_MIN_TRIGGER);
    }
    trigger=Math.min(trigger,_BARGE_TRIGGER_CEILING);

    // Ambient drift: only while nothing plays and the block isn't speech —
    // never absorb speaker bleed or user speech into the floor.
    if(!playing&&rms<trigger){
      if(_bargeAmbient.length>=_BARGE_WINDOW_BLOCKS) _bargeAmbient.shift();
      _bargeAmbient.push(rms);
      _bargeQuietFloor=Math.max(_bargePercentile(_bargeAmbient,90),_BARGE_SILENCE_RMS);
    }

    let above=rms>=trigger;
    if(above&&_bargeGraceRemaining>0){ above=false; }
    if(_bargeGraceRemaining>0){ _bargeGraceRemaining--; }

    _bargeRecentAbove.push(above);
    if(_bargeRecentAbove.length>_BARGE_TRIP_BLOCKS){ _bargeRecentAbove.shift(); }
    const aboveCount=_bargeRecentAbove.reduce((n,b)=>n+(b?1:0),0);
    if(_bargeRecentAbove.length>=_BARGE_TRIP_BLOCKS&&above&&aboveCount>=_BARGE_TRIP_NEEDED){
      console.debug('[wings-barge] TRIPPED rms='+Math.round(rms)+' trigger='+Math.round(trigger)+' phase='+(playing?'playback':'generation'));
      _bargeTripped();
    }
  }

  function _bargeTripped(){
    _bargeInterrupted=true;
    // Cut any playing TTS immediately.
    if(typeof stopTTS==='function') stopTTS();
    // Hand the mic to the interruption capture: the pre-roll ring buffer
    // holds the last ~1.5s of mic audio, so the user's spoken interruption
    // is transcribed FROM ITS FIRST WORD (a fresh SpeechRecognition here
    // would start too late — the first words, often the whole "Stopp",
    // fall into the VAD-trip detection gap and the transcript comes back
    // empty, leaving the mode stuck on "Höre zu...").
    const stream=_bargeStream;
    const preRoll=_bargePreRoll.slice();
    _bargeStop(true);
    if(stream&&_voiceModeActive&&_voiceModeState!=='listening'){
      _captureInterruption(stream, preRoll);
    }else if(_voiceModeActive&&_voiceModeState!=='listening'){
      setTimeout(()=>{ if(_voiceModeActive) _startListening(); },150);
    }
  }

  // Encode captured Float32 mono PCM chunks into a 16-bit WAV blob.
  function _bargeEncodeWav(chunks, sampleRate){
    let total=0;
    for(let c=0;c<chunks.length;c++) total+=chunks[c].length;
    const data=new Int16Array(total);
    let off=0;
    for(let c=0;c<chunks.length;c++){
      const d=chunks[c];
      for(let i=0;i<d.length;i++){
        const v=Math.max(-1,Math.min(1,d[i]));
        data[off++]=(v<0?v*32768:v*32767)|0;
      }
    }
    const bytes=new Uint8Array(44+data.length*2);
    const dv=new DataView(bytes.buffer);
    const wstr=function(s,o){for(let i=0;i<s.length;i++)bytes[o+i]=s.charCodeAt(i);};
    wstr('RIFF',0); dv.setUint32(4,36+data.length*2,true); wstr('WAVE',8);
    wstr('fmt ',12); dv.setUint32(16,16,true); dv.setUint16(20,1,true);
    dv.setUint16(22,1,true); dv.setUint32(24,sampleRate,true);
    dv.setUint32(28,sampleRate*2,true); dv.setUint16(32,2,true); dv.setUint16(34,16,true);
    wstr('data',36); dv.setUint32(40,data.length*2,true);
    new Uint8Array(data.buffer,data.byteOffset,data.byteLength).forEach((b,i)=>bytes[44+i]=b);
    return new Blob([bytes],{type:'audio/wav'});
  }

  // Record the interruption from the pre-roll ring + live mic until silence
  // endpointing, transcribe it via the server STT and send it (with the
  // interrupt note). Falls back to plain listening on empty/failure.
  function _captureInterruption(stream, preRoll){
    if(!_voiceModeActive) return;
    _setState('listening');
    console.debug('[wings-barge] capture start, preRoll=' + preRoll.length + ' chunks (' + Math.round(preRoll.length*4096/48) + 'ms)');
    let ctx=null, proc=null, src=null;
    let done=false;
    const frames=preRoll.slice();
    let quietBlocks=0;
    let totalBlocks=0;
    let peakRms=0;
    const BLOCK_MS=4096/48; // 4096 samples @48kHz ≈ 85ms
    const endpointBlocks=Math.max(1,_BARGE_CAPTURE_ENDPOINT_MS/BLOCK_MS);
    const maxBlocks=Math.max(1,_BARGE_CAPTURE_MAX_MS/BLOCK_MS);
    const finish=function(ok){
      if(done) return;
      done=true;
      if(proc){ try{ proc.onaudioprocess=null; proc.disconnect(); }catch(_){} }
      try{ if(src) src.disconnect(); }catch(_){}
      try{ if(ctx&&ctx.state!=='closed') ctx.close(); }catch(_){}
      try{ stream.getTracks().forEach(t=>t.stop()); }catch(_){}
      console.debug('[wings-barge] capture finished ok=' + ok + ' frames=' + frames.length + ' totalMs=' + Math.round(totalBlocks*BLOCK_MS) + ' peak=' + Math.round(peakRms));
      // Loop guards: no speech energy in the capture (ambient trip) or a
      // capture-send within the cooldown window (capture→send→trip→capture
      // loop) must NOT start another turn — fall back to plain listening.
      if(!ok||!frames.length||!_voiceModeActive||peakRms<_BARGE_CAPTURE_PEAK_MIN){
        _startListening();
        return;
      }
      const now=Date.now();
      if(now-_bargeLastCaptureSendAt<_BARGE_CAPTURE_SEND_COOLDOWN_MS){
        console.debug('[wings-barge] capture-send cooldown active — no send');
        _startListening();
        return;
      }
      _bargeLastCaptureSendAt=now;
      const wav=_bargeEncodeWav(frames, ctx?ctx.sampleRate:48000);
      const fd=new FormData();
      fd.append('file',new File([wav],'barge.wav',{type:'audio/wav'}));
      fetch(new URL('api/transcribe', document.baseURI||location.href).href,{
        method:'POST',body:fd
      }).then(function(r){ return r.json().catch(function(){return {};}); })
      .then(function(d){
        const t=String((d&&d.transcript)||'').trim();
        console.debug('[wings-barge] transcribe result: ' + JSON.stringify(t.slice(0,80)) + ' (wav ' + wav.size + ' bytes)');
        if(t&&_voiceModeActive){
          ta.value=t;
          if(typeof autoResize==='function') autoResize();
          _voiceModeSend();
        }else{
          _startListening();
        }
      }).catch(function(e){
        console.debug('[wings-barge] transcribe fetch failed: ' + ((e&&e.message)||e));
        _startListening();
      });
    };
    try{
      const C=window.AudioContext||window.webkitAudioContext;
      ctx=new C();
      if(ctx.state==='suspended'){ try{ ctx.resume().catch(function(){}); }catch(_){} }
      src=ctx.createMediaStreamSource(stream);
      proc=ctx.createScriptProcessor(4096,1,1);
      proc.onaudioprocess=function(e){
        const d=e.inputBuffer.getChannelData(0);
        frames.push(new Float32Array(d));
        totalBlocks++;
        let sum=0;
        for(let i=0;i<d.length;i++) sum+=d[i]*d[i];
        const rms=Math.sqrt(sum/d.length)*32768;
        if(rms>peakRms) peakRms=rms;
        if(rms<_BARGE_SILENCE_RMS*2) quietBlocks++;
        else quietBlocks=0;
        if(quietBlocks>=endpointBlocks||totalBlocks>=maxBlocks){
          finish(true);
        }
      };
      const silent=ctx.createGain();
      silent.gain.value=0;
      src.connect(proc);
      proc.connect(silent);
      silent.connect(ctx.destination);
      // Safety net in case the capture graph never fires (suspended context
      // without gesture, mic already dead, ...) — never leave the mode stuck.
      setTimeout(function(){ finish(true); }, _BARGE_CAPTURE_MAX_MS+2000);
    }catch(_){
      finish(false);
    }
  }

  function _speakResponse(){
    if(!_voiceModeActive) return;
    // Bail out if the user navigated to a different session between send and
    // stream completion. The patched autoReadLastAssistant fires globally;
    // without this guard it would TTS-read the wrong session's last assistant
    // message. Drop back to listening on the new session instead.
    const currentSid=(typeof S!=='undefined'&&S.session)?S.session.session_id:null;
    if(_voiceModeThinkingSid && currentSid && currentSid!==_voiceModeThinkingSid){
      _voiceModeThinkingSid=null;
      _startListening();
      return;
    }
    _voiceModeThinkingSid=null;
    _setState('speaking');

    // Find last assistant message
    const rows=document.querySelectorAll('.msg-row[data-role="assistant"], .assistant-segment[data-raw-text]');
    if(!rows.length){ _startListening(); return; }
    const last=rows[rows.length-1];
    const rawText=last.dataset.rawText||'';
    if(!rawText.trim()){ _startListening(); return; }

    // Strip for TTS (reuse existing helper if available)
    let clean=rawText;
    if(typeof _stripForTTS==='function') clean=_stripForTTS(rawText);
    else{
      // Basic strip: remove code blocks, images, links
      clean=clean.replace(/```[\s\S]*?```/g,' code block ')
        .replace(/`([^`]*)`/g,'$1')
        .replace(/!\[([^\]]*)\]\([^)]*\)/g,'$1')
        .replace(/\[([^\]]*)\]\([^)]*\)/g,'$1')
        .replace(/#{1,6}\s/g,'')
        .replace(/[*_~]+/g,'')
        .replace(/\n{2,}/g,'. ')
        .replace(/\n/g,' ')
        .trim();
    }
    if(!clean){ _startListening(); return; }
    const engine=localStorage.getItem("wings-tts-engine")||"browser";
    // Extension-registered TTS engine (window.registerWingsTtsEngine): synth
    // via the extension, then play through the same Audio lifecycle as edge.
    if(typeof window._wingsTtsIsRegistered==='function' && window._wingsTtsIsRegistered(engine)){
      _ttsSpeaking=true;
      const _opts={
        voice: localStorage.getItem("wings-tts-voice")||'',
        rate: parseFloat(localStorage.getItem("wings-tts-rate")),
        pitch: parseFloat(localStorage.getItem("wings-tts-pitch")),
      };
      Promise.resolve(window._wingsTtsSynth(engine, clean, _opts))
        .then(function(buf){
          const blob=new Blob([buf]);
          const url=URL.createObjectURL(blob);
          const audio=new Audio(url);
          _playingEdgeAudio=audio;
          audio.onended=function(){
            _ttsSpeaking=false;
            if(_playingEdgeAudio===audio) _playingEdgeAudio=null;
            URL.revokeObjectURL(url);
            if(_voiceModeActive) setTimeout(function(){_startListening();},500);
          };
          audio.onerror=function(){
            _ttsSpeaking=false;
            if(_playingEdgeAudio===audio) _playingEdgeAudio=null;
            URL.revokeObjectURL(url);
            if(_voiceModeActive) setTimeout(function(){_startListening();},1000);
          };
          audio.play().catch(function(){
            _ttsSpeaking=false;
            if(_playingEdgeAudio===audio) _playingEdgeAudio=null;
            URL.revokeObjectURL(url);
            if(_voiceModeActive) setTimeout(function(){_startListening();},1000);
          });
        })
        .catch(function(){
          _ttsSpeaking=false;
          if(_voiceModeActive) setTimeout(function(){_startListening();},1000);
        });
      return;
    }
    if(engine==="elevenlabs"){
      _ttsSpeaking=true;
      fetch(new URL('api/tts', document.baseURI || location.href).href, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({text: clean, engine: 'elevenlabs'})
      })
      .then(r => {
        if(!r.ok) throw new Error('TTS request failed: ' + r.status);
        return r.blob();
      })
      .then(blob => {
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        _playingEdgeAudio=audio;
        audio.onended = () => {
          _ttsSpeaking=false;
          if(_playingEdgeAudio===audio) _playingEdgeAudio=null;
          URL.revokeObjectURL(url);
          if(_voiceModeActive) setTimeout(()=>_startListening(),500);
        };
        audio.onerror = () => {
          _ttsSpeaking=false;
          if(_playingEdgeAudio===audio) _playingEdgeAudio=null;
          URL.revokeObjectURL(url);
          if(_voiceModeActive) setTimeout(()=>_startListening(),1000);
        };
        audio.play().catch(e => {
          _ttsSpeaking=false;
          if(_playingEdgeAudio===audio) _playingEdgeAudio=null;
          URL.revokeObjectURL(url);
          if(_voiceModeActive) setTimeout(()=>_startListening(),1000);
        });
      })
      .catch(() => {
        _ttsSpeaking=false;
        if(_voiceModeActive) setTimeout(()=>_startListening(),1000);
      });
      return;
    }
    if(engine==="openai"){
      // Streaming path: the server synthesizes sentence-by-sentence and the
      // browser plays each completed sentence immediately (first audio after
      // ~1 sentence instead of after the whole reply). onDone returns to
      // listening when the queue drains.
      _playOpenaiTts(clean, null, function(){
        if(_voiceModeActive) setTimeout(()=>_startListening(),500);
      });
      return;
    }
    if(engine==="edge"){
      const voice=localStorage.getItem("wings-tts-voice")||"zh-CN-XiaoxiaoNeural";
      const savedRate=parseFloat(localStorage.getItem("wings-tts-rate"));
      const savedPitch=parseFloat(localStorage.getItem("wings-tts-pitch"));
      let rate='', pitch='';
      if(!isNaN(savedRate)){const pct=Math.round((savedRate-1)*100);const sign=pct>=0?'+':'';rate=sign+pct+'%';}
      if(!isNaN(savedPitch)){const hz=Math.round((savedPitch-1)*50);const sign=hz>=0?'+':'';pitch=sign+hz+'Hz';}
      _ttsSpeaking=true;
      fetch(new URL('api/tts', document.baseURI || location.href).href, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({text: clean, voice, rate, pitch})
      })
      .then(r => {
        if(!r.ok) throw new Error('TTS request failed: ' + r.status);
        return r.blob();
      })
      .then(blob => {
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        // Register with the shared handle (declared in ui.js, same global scope;
        // both scripts are fully evaluated before any voice interaction) so
        // stopTTS() — called from _deactivate() — can actually pause hands-free
        // Edge playback. Without this the audio is local here and unstoppable.
        _playingEdgeAudio=audio;
        audio.onended = () => {
          _ttsSpeaking=false;
          if(_playingEdgeAudio===audio) _playingEdgeAudio=null;
          URL.revokeObjectURL(url);
          if(_voiceModeActive) setTimeout(()=>_startListening(),500);
        };
        audio.onerror = () => {
          _ttsSpeaking=false;
          if(_playingEdgeAudio===audio) _playingEdgeAudio=null;
          URL.revokeObjectURL(url);
          if(_voiceModeActive) setTimeout(()=>_startListening(),1000);
        };
        audio.play().catch(e => {
          _ttsSpeaking=false;
          if(_playingEdgeAudio===audio) _playingEdgeAudio=null;
          if(_voiceModeActive) setTimeout(()=>_startListening(),1000);
        });
      })
      .catch(() => {
        _ttsSpeaking=false;
        if(_voiceModeActive) setTimeout(()=>_startListening(),1000);
      });
      return;
    }
    const utter=new SpeechSynthesisUtterance(clean);

    // Apply saved voice preferences
    const savedVoice=localStorage.getItem('wings-tts-voice');
    const voices=speechSynthesis.getVoices();
    if(savedVoice&&voices.length){
      const match=voices.find(v=>v.name===savedVoice);
      if(match) utter.voice=match;
    }
    const savedRate=parseFloat(localStorage.getItem('wings-tts-rate'));
    if(!isNaN(savedRate)) utter.rate=Math.min(2,Math.max(0.5,savedRate));
    const savedPitch=parseFloat(localStorage.getItem('wings-tts-pitch'));
    if(!isNaN(savedPitch)) utter.pitch=Math.min(2,Math.max(0,savedPitch));

    utter.onend=()=>{
      _browserTtsSuppressNextErrorRearm=false;
      _clearBrowserTtsRecovery();
      // After speaking, go back to listening
      if(_voiceModeActive&&_voiceModeState==='speaking') setTimeout(()=>_startListening(),500);
    };
    utter.onerror=()=>{
      _clearBrowserTtsRecovery();
      if(_browserTtsSuppressNextErrorRearm){
        _browserTtsSuppressNextErrorRearm=false;
        return;
      }
      if(_voiceModeActive) setTimeout(()=>_startListening(),1000);
    };

    _armBrowserTtsRecovery(clean, utter.rate);
    try{
      speechSynthesis.speak(utter);
    }catch(_){
      _clearBrowserTtsRecovery();
      if(_voiceModeActive) setTimeout(()=>_startListening(),1000);
    }
  }

  // Hook into response completion — observe when the agent finishes
  // We patch setComposerStatus to detect when a response completes
  const _origSetComposerStatus=(typeof setComposerStatus==='function')?setComposerStatus.bind(window):null;

  window._voiceModeOnResponseComplete=function(){
    if(_voiceModeActive&&_voiceModeState==='thinking'){
      // Small delay to let DOM render the final message
      setTimeout(()=>{
        if(_voiceModeActive&&_voiceModeState==='thinking'){
          _speakResponse();
        }
      },400);
    }
  };

  // Observe S.busy changes to detect response completion
  // The existing code calls setBusy(false) when response completes
  const _origSetBusy=(typeof setBusy==='function')?setBusy.bind(window):null;
  if(_origSetBusy){
    // We use a MutationObserver-style approach via polling S.busy
    // Actually, we'll use a simpler approach: hook into the message stream completion
  }

  // Most reliable hook: use the existing autoReadLastAssistant call site.
  // We override autoReadLastAssistant so that if voice mode is active, we use our
  // own speak-and-resume flow instead of the default auto-read. The patch is a
  // SUPERSET of the original (it delegates to _origAutoRead whenever voice mode
  // is inactive), so it must stay installed permanently. _deactivate previously
  // restored the original — and _activate never re-installed it — so toggling
  // voice mode off and on once silently disabled the voice-mode auto-read: the
  // reply finished, the state stayed on "thinking" and no TTS ever played.
  const _origAutoRead=(typeof autoReadLastAssistant==='function')?autoReadLastAssistant:null;

  // Minimal near-silent WAV (8 kHz mono, 0 samples) — plays within the user
  // gesture to unlock autoplay without audible feedback.
  const _UNLOCK_WAV='data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
  function _unlockAudioPlayback(){
    try{
      const a=new Audio(_UNLOCK_WAV);
      a.volume=0.0001;
      const p=a.play();
      if(p&&typeof p.catch==='function') p.catch(function(){});
    }catch(_){}
  }

  function _installVoiceAutoReadPatch(){
    window.autoReadLastAssistant=function(){
      if(_voiceModeActive&&_voiceModeState==='thinking'){
        _speakResponse();
        return;
      }
      // The user cut in mid-reply (barge-in) — never auto-read over them.
      if(_voiceModeActive&&_bargeInterrupted) return;
      if(_origAutoRead) _origAutoRead.apply(this,arguments);
    };
  }
  _installVoiceAutoReadPatch();

  function _activate(){
    if(_micOriginNeedsSecureContext()){
      showToast(t('mic_insecure_origin'));
      return;
    }
    _voiceModeActive=true;
    // Unlock autoplay: Chrome's autoplay policy can reject audio.play() for
    // media started long after the last user gesture (the assistant reply
    // lands 10-60s after the button click). Playing a (nearly silent) audio
    // element synchronously INSIDE this click handler grants the domain
    // autoplay permission for the rest of the session — every subsequent
    // TTS chunk then plays without NotAllowedError.
    _unlockAudioPlayback();
    // (Re-)install the auto-read patch: a prior _deactivate (or any other
    // override) must never leave the original autoReadLastAssistant in place,
    // or the reply completion would skip _speakResponse entirely.
    _installVoiceAutoReadPatch();
    modeBtn.classList.add('active');
    _setButtonTooltip(modeBtn, t('voice_mode_toggle_active'));
    showToast(t('voice_mode_active'),1500);
    // If the agent is busy, wait — state will be 'thinking' and we'll detect completion
    if(typeof S!=='undefined'&&S.busy){
      _setState('thinking');
      return;
    }
    // Cancel any existing TTS
    if(typeof stopTTS==='function') stopTTS();
    _startListening();
  }

  function _deactivate(){
    _voiceModeActive=false;
    _voiceModeState='idle';
    _voiceModeThinkingSid=null;
    _bargeInterrupted=false;
    _bargeStop();
    _browserTtsSuppressNextErrorRearm=false;
    modeBtn.classList.remove('active');
    _setButtonTooltip(modeBtn, t('voice_mode_toggle'));
    bar.style.display='none';
    clearTimeout(_silenceTimer);
    _clearBrowserTtsRecovery();
    try{ if(_recognition) _recognition.abort(); }catch(_){}
    _recognition=null;
    if(typeof stopTTS==='function') stopTTS();
    // NOTE: autoReadLastAssistant is intentionally NOT restored here — the
    // voice-mode patch is a superset that delegates to the original when
    // voice mode is inactive, and removing it on deactivate (without
    // re-installing on activate) silently broke voice-mode TTS.
    // Clear textarea if it was only voice input
    ta.value='';
    autoResize();
  }

  modeBtn.onclick=()=>{
    if(_voiceModeActive){
      _deactivate();
      showToast(t('voice_mode_off'),1500);
    }else{
      _activate();
    }
  };

  // Expose for external use
  window._voiceModeActive=()=>_voiceModeActive;
  window._voiceModeDeactivate=_deactivate;
  window._voiceModeImmediateSend=_voiceModeSend;
})();
function _currentSessionIsReusableEmptyChat(){
  if(!S.session) return false;
  const hasVisibleMessages=Array.isArray(S.messages)
    && S.messages.some(m=>m&&m.role&&m.role!=='tool');
  return (S.session.message_count||0)===0
    && !hasVisibleMessages
    && !S.busy
    && !S.session.active_stream_id
    && !S.session.pending_user_message;
}

$('fileInput').onchange=e=>{addFiles(Array.from(e.target.files));e.target.value='';};
$('btnNewChat').onclick=async()=>{
  // If the current session has no messages AND nothing is in flight, just focus
  // the composer rather than creating another empty session that will clutter the
  // sidebar list (#1171).
  //
  // The "nothing in flight" half is critical (#1432): if the user clicks + while
  // their first message is still streaming (or queued), `message_count` is still 0
  // server-side because the user turn hasn't been merged yet. The old guard treated
  // that as "empty" and made + a no-op for the entire stream duration, so users
  // couldn't actually start a parallel chat. Use the same in-flight signal as
  // `_restoreSettledSession()` in messages.js: an active stream id or a queued
  // pending user message means the session is real, not empty.
  if(_currentSessionIsReusableEmptyChat()){
    $('msg').focus();closeMobileSidebar();return;
  }
  if(typeof _restoreRememberedNewChatDraftSession==='function'
     && await _restoreRememberedNewChatDraftSession()){
    await renderSessionList();closeMobileSidebar();$('msg').focus();return;
  }
  await newSession();await renderSessionList();closeMobileSidebar();$('msg').focus();
};
$('btnDownload').onclick=()=>{
  if(!S.session)return;
  const blob=new Blob([transcript()],{type:'text/markdown'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);
  a.download=`wings-${S.session.session_id}.md`;a.click();URL.revokeObjectURL(a.href);
};
$('btnExportJSON').onclick=()=>{
  if(!S.session)return;
  const url=`/api/session/export?session_id=${encodeURIComponent(S.session.session_id)}`;
  const a=document.createElement('a');a.href=url;
  a.download=`wings-${S.session.session_id}.json`;a.click();
};
$('btnShareSession').onclick=async()=>{
  if(typeof getUIMode==='function'&&getUIMode()!=='advanced') return;
  if(!S.session) return;
  try{
    const existing=(S.session&&S.session.share_token)?new URL(`/share/${encodeURIComponent(S.session.share_token)}`,location.origin).href:null;
    if(existing){
      const reuse=await showConfirmDialog({
        title:t('share_session'),
        message:t('share_session_existing_confirm'),
        confirmLabel:t('share_session_copy_existing'),
        cancelLabel:t('share_session_refresh_snapshot'),
      });
      if(reuse){
        await _copyText(existing);
        showToast(t('share_session_link_copied'));
        window.open(existing,'_blank','noopener');
        return;
      }
    }
    const res=await api('/api/share/create',{method:'POST',body:JSON.stringify({session_id:S.session.session_id})});
    if(res&&res.session) S.session=res.session;
    const href=new URL(String(res&&res.share&&res.share.url||''),location.origin).href;
    await _copyText(href);
    showToast(t('share_session_created'));
    if(typeof _syncWingsPanelSessionActions==='function') _syncWingsPanelSessionActions();
    window.open(href,'_blank','noopener');
  }catch(err){
    showToast(t('share_session_failed')+(err&&err.message?err.message:String(err||'')),4000,'error');
  }
};
$('btnStopSharingSession').onclick=async()=>{
  if(!S.session||!S.session.share_token) return;
  const ok=await showConfirmDialog({
    title:t('stop_sharing_session'),
    message:t('stop_sharing_session_confirm'),
    confirmLabel:t('stop_sharing_session'),
    danger:true,
  });
  if(!ok) return;
  try{
    const res=await api('/api/share/revoke',{method:'POST',body:JSON.stringify({session_id:S.session.session_id})});
    if(res&&res.session) S.session=res.session;
    showToast(t('share_session_revoked'));
    if(typeof _syncWingsPanelSessionActions==='function') _syncWingsPanelSessionActions();
  }catch(err){
    showToast(t('share_session_revoke_failed')+(err&&err.message?err.message:String(err||'')),4000,'error');
  }
};
function exportSessionHTML(session){
  const target=session||S.session;
  if(!target||!target.session_id)return;
  const sid=target.session_id;
  const theme=document.documentElement.classList.contains('dark')?'dark':'light';
  // Capture the live WebUI palette so the export matches the user's active
  // theme + skin exactly, not just the built-in dark/light fallback. Map each
  // export-template variable to its WebUI source; getComputedStyle resolves to
  // the currently rendered colour regardless of which skin is selected.
  const cs=getComputedStyle(document.documentElement);
  const read=(...names)=>{for(const n of names){const v=cs.getPropertyValue(n).trim();if(v)return v;}return '';};
  const palette={
    'bg':read('--bg'),
    'panel':read('--surface','--bg'),
    'panel2':read('--code-bg','--surface'),
    'border':read('--border'),
    'text':read('--text'),
    'muted':read('--muted','--text'),
    'accent':read('--accent'),
    'code-bg':read('--code-bg'),
    'code-border':read('--border2','--border'),
    'code-text':read('--text'),
  };
  // Drop empties so the inlined fallback keeps working for anything we couldn't read.
  const clean={};for(const k in palette){if(palette[k])clean[k]=palette[k];}
  const paletteB64=btoa(unescape(encodeURIComponent(JSON.stringify(clean))));
  const url=`/api/session/export?session_id=${encodeURIComponent(sid)}&format=html&theme=${theme}&palette=${encodeURIComponent(paletteB64)}`;
  const a=document.createElement('a');a.href=url;
  a.download=`wings-${sid}.html`;a.click();
}
$('btnExportHTML').onclick=()=>exportSessionHTML();
$('btnImportJSON').onclick=()=>$('importFileInput').click();
$('importFileInput').onchange=async(e)=>{
  const file=e.target.files[0];
  if(!file)return;
  e.target.value='';
  try{
    const text=await file.text();
    const data=JSON.parse(text);
    const res=await api('/api/session/import',{method:'POST',body:JSON.stringify(data)});
    if(res.ok&&res.session){
      await loadSession(res.session.session_id);
      await renderSessionList();
      if(_currentPanel==='settings') switchPanel('chat');
      showToast(t('session_imported'));
    }
  }catch(err){
    showToast(t('import_failed')+(err.message||t('import_invalid_json')));
  }
};
// btnRefreshFiles is now panel-icon-btn in header (see HTML)
function clearPreview(opts={}){
  const keepPanelOpen=!!(opts&&opts.keepPanelOpen);
  // Restore directory breadcrumb after closing file preview
  if(typeof renderBreadcrumb==='function') renderBreadcrumb();
  const closePanelAfter=_workspacePanelMode==='preview'&&!keepPanelOpen;
  const pa=$('previewArea');if(pa)pa.classList.remove('visible');
  const pi=$('previewImg');if(pi){pi.onerror=null;pi.src='';}
  const pdf=$('previewPdfFrame');if(pdf)pdf.src='';
  const html=$('previewHtmlIframe');if(html)html.src='';
  const pm=$('previewMd');if(pm)pm.innerHTML='';
  const pc=$('previewCode');if(pc)pc.textContent='';
  const pp=$('previewPathText');if(pp)pp.textContent='';
  const ft=$('fileTree');if(ft)ft.style.display='';
  _previewCurrentPath='';_previewCurrentMode='';_previewDirty=false;
  if(closePanelAfter)closeWorkspacePanel();
  else if(keepPanelOpen&&_workspacePanelMode==='preview')openWorkspacePanel('browse');
  else syncWorkspacePanelUI();
}
$('btnClearPreview').onclick=handleWorkspaceClose;
// workspacePath click handler removed -- use topbar workspace chip dropdown instead
function _applySessionContextMetadataUpdate(data){
  if(!S.session||!data||!data.session)return;
  S.session.context_length=data.session.context_length||0;
  S.session.threshold_tokens=data.session.threshold_tokens||0;
  S.session.last_prompt_tokens=data.session.last_prompt_tokens||0;
  S.session.post_compression_context_tokens_estimate=data.session.post_compression_context_tokens_estimate||null;
  if(typeof _syncCtxIndicator==='function'){
    const u=S.lastUsage||{};
    const _pick=(latest,stored,dflt=0)=>latest!=null?latest:(stored!=null?stored:dflt);
    _syncCtxIndicator({
      input_tokens:_pick(u.input_tokens,S.session.input_tokens),
      output_tokens:_pick(u.output_tokens,S.session.output_tokens),
      estimated_cost:_pick(u.estimated_cost,S.session.estimated_cost),
      context_length:S.session.context_length||0,
      last_prompt_tokens:_pick(u.last_prompt_tokens,S.session.last_prompt_tokens),
      post_compression_context_tokens_estimate:S.session.post_compression_context_tokens_estimate,
      threshold_tokens:S.session.threshold_tokens||0,
    });
  }
}

$('modelSelect').onchange=async()=>{
  const selectedModel=$('modelSelect').value;
  const modelState=(typeof _modelStateForSelect==='function')
    ? _modelStateForSelect($('modelSelect'),selectedModel)
    : {model:selectedModel,model_provider:null};
  if(typeof clearProfileTransitionReasoningContext==='function') clearProfileTransitionReasoningContext();
  if(typeof closeModelDropdown==='function') closeModelDropdown();
  if(typeof _writePersistedModelState==='function') _writePersistedModelState(modelState.model,modelState.model_provider);
  else try{localStorage.setItem('wings-model',modelState.model)}catch{}
  if(!S.session){
    if(typeof _rememberEmptyComposerModelOverride==='function') _rememberEmptyComposerModelOverride(modelState.model,modelState.model_provider);
    if(typeof syncModelChip==='function') syncModelChip();
    if(typeof syncReasoningChip==='function') syncReasoningChip();
    return;
  }
  if(typeof _rememberPendingSessionModel==='function') _rememberPendingSessionModel(S.session.session_id,modelState.model,modelState.model_provider);
  S.session.model=modelState.model;
  S.session.model_provider=modelState.model_provider||null;
  if(typeof syncModelChip==='function') syncModelChip();
  if(typeof syncReasoningChip==='function') syncReasoningChip();
  syncTopbar();
  // Clarify scope: composer model changes are session-local, not the global default.
  if(typeof showToast==='function'){
    showToast(t('model_scope_toast')||'Applies to this conversation from your next message.', 3000);
  }
  const data=await api('/api/session/update',{method:'POST',body:JSON.stringify({
    session_id:S.session.session_id,
    workspace:S.session.workspace,
    model:modelState.model,
    model_provider:modelState.model_provider||null,
  })});
  // NOTE: do NOT clear the pending explicit-pick marker here. It must survive until
  // the NEXT send() consumes it, otherwise the normal "pick → session-update → send"
  // flow loses the explicit-pick signal before /api/chat/start runs and the server
  // re-reverts a cross-family pick (the #3737 bug, Codex catch). send() clears it
  // after reading a matching pending pick. (#3739/#3737)
  _applySessionContextMetadataUpdate(data);
  // Warn if selected model belongs to a different provider than what Wings is configured for
  if(typeof _checkProviderMismatch==='function'){
    const warn=_checkProviderMismatch(selectedModel);
    if(warn&&typeof showToast==='function') showToast(warn,4000);
  }
};
$('msg').addEventListener('input',()=>{
  updateSendBtn();
  scheduleComposerAutoResize();
  // Persist composer draft to server (debounced in _saveComposerDraft).
  const sid = S && S.session && S.session.session_id;
  if (sid && typeof _saveComposerDraft === 'function') {
    _saveComposerDraft(sid, $('msg').value, S.pendingFiles ? [...S.pendingFiles] : []);
  }
  const text=$('msg').value;
  const _slashIdx=typeof _activeSlashCommandOffset==='function'?_activeSlashCommandOffset(text):-1;
  if(_slashIdx>=0&&text.indexOf('\n')===-1){
    if(typeof getSlashAutocompleteMatches==='function'){
      getSlashAutocompleteMatches(text).then(matches=>{
        if(($('msg').value||'')!==text) return;
        if(matches.length)showCmdDropdown(matches); else hideCmdDropdown();
      });
    }else{
      const prefix=text.slice(_slashIdx+1);
      const matches=getMatchingCommands(prefix);
      if(matches.length)showCmdDropdown(matches); else hideCmdDropdown();
    }
    if(typeof ensureSkillCommandsLoadedForAutocomplete==='function') ensureSkillCommandsLoadedForAutocomplete();
  } else if(typeof getComposerPathAutocompleteMatches==='function'){
    const cursor=$('msg').selectionStart;
    getComposerPathAutocompleteMatches(text,cursor).then(matches=>{
      const ta=$('msg');
      if(!ta||ta.value!==text||ta.selectionStart!==cursor) return;
      if(matches.length)showCmdDropdown(matches); else hideCmdDropdown();
    }).catch(()=>hideCmdDropdown());
  } else {
    hideCmdDropdown();
  }
});
// Mobile keyboard dismissal: tapping outside the composer blurs the textarea so
// the virtual keyboard collapses. Only blur when the tap is NOT inside the
// composer, NOT on an interactive element that wants focus (buttons, inputs,
// selects, textareas, links), and NOT on a dropdown/menu surface.
document.addEventListener('touchstart',(e)=>{
  try{
    const ta=document.getElementById('msg');
    if(!ta||document.activeElement!==ta) return;
    const composer=document.getElementById('composerWrap');
    if(composer&&composer.contains(e.target)) return;
    const t=e.target;
    if(t&&(t.closest&&t.closest('button,input,select,textarea,a,[contenteditable="true"],[role="dialog"],[role="menu"],[role="listbox"]'))) return;
    ta.blur();
  }catch(_){}
},{passive:true});
// Mobile horizontal swipe navigation between sessions (touch only). A decisive
// left swipe moves to the next session row in the sidebar order, a right swipe to
// the previous one. Only fires when the gesture is clearly horizontal (|dx| > 60px
// and > 3x |dy|) so vertical scrolling and edge-swipe sidebars are unaffected.
(function(){
  if(!('ontouchstart' in window)) return;
  let startX=0,startY=0,tracking=false;
  const chat=document.getElementById('mainChat')||document.querySelector('.chat-col,.chat-area,.messages-view');
  if(!chat) return;
  const _navSwipe=function(dx){
    try{
      if(typeof S==='undefined'||!S.session||S.busy||S.activeStreamId) return;
      if(typeof loadSession!=='function') return;
      const list=document.getElementById('sessionList');
      if(!list) return;
      const rows=Array.from(list.querySelectorAll('[data-sid],.session-item')).filter(r=>r.dataset&&(r.dataset.sid||r.dataset.sessionId));
      if(rows.length<2) return;
      const current=String(S.session.session_id||'');
      let idx=rows.findIndex(r=>(r.dataset.sid||r.dataset.sessionId)===current);
      if(idx===-1) return;
      const target=dx<0?rows[idx+1]:rows[idx-1];
      if(!target) return;
      const sid=target.dataset.sid||target.dataset.sessionId;
      if(!sid||sid===current) return;
      if(typeof showToast==='function') showToast(dx<0?'→':'\u2190');
      loadSession(sid);
    }catch(_){}
  };
  chat.addEventListener('touchstart',(e)=>{
    if(e.touches&&e.touches.length>1) return;
    startX=e.touches[0].clientX; startY=e.touches[0].clientY; tracking=true;
  },{passive:true});
  chat.addEventListener('touchmove',(e)=>{
    if(!tracking||e.touches.length>1) return;
    const dx=e.touches[0].clientX-startX;
    const dy=e.touches[0].clientY-startY;
    // If the gesture is becoming vertical, abandon the horizontal swipe.
    if(Math.abs(dy)>Math.abs(dx)*1.2) tracking=false;
  },{passive:true});
  chat.addEventListener('touchend',(e)=>{
    if(!tracking) return;
    tracking=false;
    const t=e.changedTouches&&e.changedTouches[0];
    if(!t) return;
    const dx=t.clientX-startX,dy=t.clientY-startY;
    if(Math.abs(dx)<60) return;              // too short
    if(Math.abs(dy)>Math.abs(dx)*0.5) return; // not horizontal enough
    _navSwipe(dx);
  },{passive:true});
})();
// #5514/#5515: re-pin the transcript on ANY composer height change, not only the
// ones that route through the input->autoResize path. A multi-line paste
// (WisprFlow), a draft restore, an attachment tray / selection-chip appearing, a
// programmatic value set, or a font/reflow can all grow the composer and shrink
// the flex:1 transcript viewport, stranding a pinned reader above the bottom
// (reads as a "random" upward jump — #5515). Observe the whole #composerWrap
// (not just #msg) so tray/chip growth is covered too, at one seam. The re-pin is
// guarded (only fires when genuinely pinned), so it never fights a reader who
// scrolled away. First callback fires on observe (initial size) — the guard
// makes that a cheap no-op.
(()=>{
  const _cw=$('composerWrap')||$('msg');
  if(!_cw || typeof ResizeObserver!=='function' || typeof _repinMessagesAfterComposerResize!=='function') return;
  let _lastComposerH=_cw.offsetHeight;
  const _ro=new ResizeObserver(()=>{
    const h=_cw.offsetHeight;
    if(h<=_lastComposerH){_lastComposerH=h;return;}   // shrink/no-op: enlarges the viewport, can't strand
    _lastComposerH=h;
    _repinMessagesAfterComposerResize();               // grow: re-pin the pinned reader
  });
  try{ _ro.observe(_cw); }catch(_){ }
})();
// Track IME composition for East Asian input. Safari fires the committing
// keydown AFTER compositionend with isComposing=false, so we also keep a
// manual flag and reset it on the next tick to swallow that trailing Enter.
// Also reset on blur so the flag can never get stuck in a true state if
// compositionend never fires (focus loss with some IME implementations).
//
// The `_imeComposing` flag is bound to the chat composer (`#msg`); other
// inputs (session/project rename, app dialog, message edit, workspace rename)
// rely on the state-free `e.isComposing || e.keyCode === 229` part of
// `_isImeEnter`, which is sufficient for the Safari race because keyCode 229
// is the canonical "still composing" signal regardless of which field is
// focused. Promote `_isImeEnter` to `window` so other modules can reuse it
// without duplicating the full IIFE per input (issue #1443).
let _imeComposing=false;
(()=>{const _c=$('msg');if(!_c)return;
  _c.addEventListener('compositionstart',()=>{_imeComposing=true;});
  _c.addEventListener('compositionend',()=>{setTimeout(()=>{_imeComposing=false;},0);});
  _c.addEventListener('blur',()=>{_imeComposing=false;});
})();
function _isImeEnter(e){return e.isComposing||e.keyCode===229||_imeComposing;}
window._isImeEnter=_isImeEnter;
// #3076: a touch-primary device (`pointer:coarse`) can still have a
// physical keyboard attached (Android tablet + Bluetooth keyboard,
// detachable Surface in tablet mode, iPad + Magic Keyboard). When that
// happens we should NOT force the mobile newline-on-Enter override
// because Shift+Enter / Ctrl+Enter come from real keys and the user
// expects desktop semantics. `matchMedia('(any-pointer:fine)')` is true
// whenever ANY available pointing device is fine-grained — which is the
// strongest signal browsers expose for "there is a real keyboard /
// trackpad in the picture too". Skip the mobile default in that case.
function _hasFinePointerCoexisting(){
  try{ return matchMedia('(any-pointer:fine)').matches; }catch(_){ return false; }
}
function _isNumpadEnter(e){
  return e.key==='Enter'&&(e.code==='NumpadEnter'||e.location===KeyboardEvent.DOM_KEY_LOCATION_NUMPAD);
}
$('msg').addEventListener('keydown',e=>{
  // Autocomplete navigation when dropdown is open
  const dd=$('cmdDropdown');
  const dropdownOpen=dd&&dd.classList.contains('open');
  if(dropdownOpen){
    if(e.key==='ArrowUp'){e.preventDefault();navigateCmdDropdown(-1);return;}
    if(e.key==='ArrowDown'){e.preventDefault();navigateCmdDropdown(1);return;}
    if(e.key==='Tab'){e.preventDefault();selectCmdDropdownItem();return;}
    if(e.key==='Escape'){e.preventDefault();e.stopPropagation();hideCmdDropdown();return;}
    if(e.key==='Enter'&&!e.shiftKey){
      if(_isImeEnter(e)){return;}
      if(window._sendKey==='shift+enter'){
        return;
      }
      e.preventDefault();
      selectCmdDropdownItem();
      return;
    }
  }
  // Send key: respect user preference.
  // On touch-primary devices (coarse pointer, no fine pointer co-existing),
  // default to Enter = newline regardless of whether the visual viewport has
  // shrunk. The viewport-shrink heuristic (_isVirtualKeyboardLikelyOpen) was
  // unreliable on iOS Safari and some Android browsers where the keyboard
  // doesn't consistently reduce vv.height by >120px. The pointer media query
  // pair is a sufficient and more reliable signal for "software keyboard only".
  // Hardware keyboards on tablets are covered by _hasFinePointerCoexisting.
  // The 'ctrl+enter' and 'shift+enter' settings also use this behavior
  // (plain Enter = newline).
  // Users can override in Settings by explicitly choosing 'enter' mode.
  if(e.key==='Enter'){
    if(_isImeEnter(e)){return;}
    const isNumpadEnter=_isNumpadEnter(e);
    const _mobileDefault=matchMedia('(pointer:coarse)').matches
      &&!_hasFinePointerCoexisting()
      &&window._sendKey==='enter';
    if(window._sendKey==='shift+enter'){
      if(e.shiftKey){e.preventDefault();send();}
    } else if(window._sendKey==='ctrl+enter'||_mobileDefault){
      if(isNumpadEnter||e.ctrlKey||e.metaKey){e.preventDefault();send();}
    } else {
      if(!e.shiftKey){e.preventDefault();send();}
    }
  }
});
// B14: Cmd/Ctrl+K creates a new chat from anywhere
document.addEventListener('keydown',async e=>{
  // Cmd/Ctrl+B toggles desktop sidebar collapse (VS Code convention).
  // Skip when typing in an input/textarea/contenteditable so text-edit
  // shortcuts (e.g. bold in some embedded editors) are never stolen.
  if((e.metaKey||e.ctrlKey)&&!e.shiftKey&&!e.altKey&&(e.key==='b'||e.key==='B')){
    const t=e.target;
    const isText=t&&(t.tagName==='INPUT'||t.tagName==='TEXTAREA'||t.isContentEditable);
    if(!isText&&typeof toggleSidebar==='function'&&_isDesktopWidth()){
      e.preventDefault();
      toggleSidebar();
      return;
    }
  }
  // Cmd/Ctrl+/ focuses the message composer without creating a chat.
  // Match on the '/' CHARACTER (e.key), not the physical key position: on QWERTZ
  // layouts the physical Slash key produces Ctrl+- (browser zoom-out) and '/' is
  // typed as Shift+7, so matching the physical code both steals zoom and misses
  // the real '/' chord. e.key==='/' is layout-correct on every keyboard.
  if((e.metaKey||e.ctrlKey)&&!e.altKey&&e.key==='/'){
    const t=e.target;
    const isText=t&&(t.tagName==='INPUT'||t.tagName==='TEXTAREA'||t.isContentEditable);
    if(isText) return;
    const composer=$('msg');
    if(composer){e.preventDefault();composer.focus();}
    return;
  }
  // Enter on approval card = Allow once (when a button inside the card is focused or
  // card is visible and focus is not on an input/textarea/select)
  if(e.key==='Enter'&&!e.metaKey&&!e.ctrlKey&&!e.shiftKey){
    const card=$('approvalCard');
    const tag=(document.activeElement||{}).tagName||'';
    if(card&&card.classList.contains('visible')&&tag!=='TEXTAREA'&&tag!=='INPUT'&&tag!=='SELECT'){
      e.preventDefault();
      if(typeof respondApproval==='function') respondApproval('once');
      return;
    }
  }
  if((e.metaKey||e.ctrlKey)&&e.key==='k'){
    const t=e.target;
    const isText=t&&(t.tagName==='INPUT'||t.tagName==='TEXTAREA'||t.isContentEditable);
    if(isText) return;
    e.preventDefault();
    // If the current session has no messages AND nothing is in flight, just focus
    // the composer rather than creating another empty session that will clutter
    // the sidebar list (#1171). See the matching guard in $('btnNewChat').onclick
    // and bug #1432 for why the in-flight check is needed.
    if(_currentSessionIsReusableEmptyChat()){
      $('msg').focus();return;
    }
    // Cmd/Ctrl+K should always create a new conversation, even while the current
    // one is still streaming. The old !S.busy guard meant users had to wait for
    // a long generation to finish before they could start something new — exactly
    // the moment they want to switch context. newSession() leaves the in-flight
    // stream running on its own session; the user just gets a fresh blank one.
    await newSession();await renderSessionList();closeMobileSidebar();$('msg').focus();
  }
  // Cmd/Ctrl+, opens/closes Settings (VS Code convention).
  // Fire globally — like VS Code, don't skip text inputs.
  if((e.metaKey||e.ctrlKey)&&!e.shiftKey&&!e.altKey&&e.key===','){
    e.preventDefault();
    if(typeof toggleSettings==='function') toggleSettings();
    return;
  }
  if(e.key==='Escape'){
    // Close onboarding overlay if open (skip/dismiss the wizard)
    const onboardingOverlay=$('onboardingOverlay');
    if(onboardingOverlay&&onboardingOverlay.style.display!=='none'){
      if(typeof skipOnboarding==='function') skipOnboarding();
      return;
    }
    // Close settings panel if active
    if(_currentPanel==='settings'){_closeSettingsPanel();return;}
    // Close workspace dropdown
    closeWsDropdown();
    // Clear session search
    const ss=$('sessionSearch');
    if(ss&&ss.value){
      if(typeof clearSessionSearch==='function') clearSessionSearch(false);
      else { ss.value=''; filterSessions(); }
    }
    // Cancel any active message edit
    const editArea=document.querySelector('.msg-edit-area');
    if(editArea){
      const bar=editArea.closest('.msg-row')&&editArea.closest('.msg-row').querySelector('.msg-edit-bar');
      if(bar){const cancel=bar.querySelector('.msg-edit-cancel');if(cancel)cancel.click();}
    }
    // Blur composer to enable j/k message navigation.
    // Skip while an IME candidate window is composing — Escape there should
    // dismiss the candidate, not blur the composer (CJK input).
    if(document.activeElement===$('msg') && !e.isComposing && !_imeComposing){
      $('msg').blur();
    }
  }
});
const LARGE_TEXT_PASTE_CHAR_THRESHOLD=4000;
const LARGE_TEXT_PASTE_LINE_THRESHOLD=100;
function _largeTextPasteLineCount(text){
  const value=String(text||'');
  const lines=value.split('\n');
  return value.endsWith('\n')?lines.length-1:lines.length;
}
function _shouldAttachLargePastedText(text){
  if(window._largeTextPasteAsAttachment===false)return false;
  const value=String(text||'');
  if(!value.trim())return false;
  return value.length>=LARGE_TEXT_PASTE_CHAR_THRESHOLD || _largeTextPasteLineCount(value)>=LARGE_TEXT_PASTE_LINE_THRESHOLD;
}
function _largeTextPasteFileName(now){
  const d=new Date(now||Date.now());
  const p=n=>String(n).padStart(2,'0');
  const stamp=`${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}-${String(d.getMilliseconds()).padStart(3,'0')}`;
  const existing=new Set((S.pendingFiles||[]).map(f=>f&&f.name).filter(Boolean));
  let name=`pasted-text-${stamp}.md`;
  for(let i=2;existing.has(name);i++)name=`pasted-text-${stamp}-${i}.md`;
  return name;
}
function _largeTextPasteFile(text,now){
  const name=_largeTextPasteFileName(now||Date.now());
  return new File([String(text||'')],name,{type:'text/markdown;charset=utf-8'});
}
function _largeTextPasteFitsUploadLimit(file){
  return !(file&&typeof MAX_UPLOAD_BYTES==='number'&&file.size>MAX_UPLOAD_BYTES);
}
function _attachLargePastedText(file){
  addFiles([file]);
  if(typeof setStatus==='function')setStatus(t('text_pasted')+file.name);
  return file;
}
$('msg').addEventListener('paste',e=>{
  const items=Array.from(e.clipboardData?.items||[]);
  // Extract image items (kind==='file' filter avoids misclassifying text/html
  // with embedded data URIs as images).
  const imageItems=items.filter(i=>i.kind==='file'&&i.type.startsWith('image/'));
  if(imageItems.length){
    // If text is also present (common when copying images from browsers, Notes,
    // Slack, etc.), let the browser paste the text normally AND attach the image.
    // Only preventDefault when the clipboard is image-only (true screenshot paste).
    const hasText=items.some(i=>i.kind==='string'&&(i.type==='text/plain'||i.type==='text/html'));
    if(!hasText)e.preventDefault();
    const pasteTs=Date.now();
    const files=imageItems.map((i,idx)=>{
      const blob=i.getAsFile();
      const ext=i.type.split('/')[1]||'png';
      const suffix=imageItems.length>1?`-${idx+1}`:'';
      return new File([blob],`screenshot-${pasteTs}${suffix}.${ext}`,{type:i.type});
    });
    addFiles(files);
    setStatus(t('image_pasted')+files.map(f=>f.name).join(', '));
    return;
  }
  const plainText=e.clipboardData?.getData('text/plain')||'';
  if(!_shouldAttachLargePastedText(plainText))return;
  const pastedTextFile=_largeTextPasteFile(plainText);
  if(!_largeTextPasteFitsUploadLimit(pastedTextFile))return;
  e.preventDefault();
  _attachLargePastedText(pastedTextFile);
});
document.querySelectorAll('.suggestion').forEach(btn=>{
  btn.onclick=()=>{$('msg').value=btn.dataset.msg;send();};
});

function applyEmptyStateSuggestionPref(){
  if(!$('emptyState')) return;
  $('emptyState').classList.toggle('no-suggestions',window._hideEmptyStateSuggestions===true);
}

window.addEventListener('resize',()=>{
  _syncWorkspacePanelInlineWidth();
  syncWorkspacePanelState();
  if(!window.visualViewport) _forceMobileViewportReflow();
});

// On PWAs / mobile browsers that expose visualViewport, keyboard show/hide and
// URL-bar collapse fire visualViewport resize/scroll rather than window resize.
// Debounce a reflow so the phone layout repaints against the new geometry.
if(window.visualViewport){
  _syncKeyboardBottomInset();
  let _mobileViewportReflowTimer=0;
  const _scheduleMobileViewportReflow=()=>{
    if(_mobileViewportReflowTimer) clearTimeout(_mobileViewportReflowTimer);
    _mobileViewportReflowTimer=setTimeout(()=>{
      _mobileViewportReflowTimer=0;
      _forceMobileViewportReflow();
    },60);
  };
  window.visualViewport.addEventListener('resize', _scheduleMobileViewportReflow);
  window.visualViewport.addEventListener('scroll', _scheduleMobileViewportReflow);
}

// Boot: restore last session or start fresh
// ── Resizable panels ──────────────────────────────────────────────────────
(function(){
  const SIDEBAR_MIN=180, SIDEBAR_MAX=420;
  const PANEL_MIN=180,   PANEL_MAX=1200;

  function initResize(handleId, targetEl, edge, minW, maxW, storageKey){
    const handle = $(handleId);
    if(!handle || !targetEl) return;

    // Restore saved width
    if(storageKey === 'wings-panel-w'){
      _syncWorkspacePanelInlineWidth();
    }else{
      const saved = localStorage.getItem(storageKey);
      if(saved) targetEl.style.width = saved + 'px';
    }

    let startX=0, startW=0;

    handle.addEventListener('mousedown', e=>{
      e.preventDefault();
      startX = e.clientX;
      startW = targetEl.getBoundingClientRect().width;
      handle.classList.add('dragging');
      document.body.classList.add('resizing');

      const onMove = ev=>{
        const delta = edge==='right' ? ev.clientX - startX : startX - ev.clientX;
        const newW = Math.min(maxW, Math.max(minW, startW + delta));
        targetEl.style.width = newW + 'px';
      };
      const onUp = ()=>{
        handle.classList.remove('dragging');
        document.body.classList.remove('resizing');
        localStorage.setItem(storageKey, parseInt(targetEl.style.width));
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  // Run after DOM ready (called from boot)
  window._initResizePanels = function(){
    const sidebar    = document.querySelector('.sidebar');
    const rightpanel = document.querySelector('.rightpanel');
    initResize('sidebarResize',    sidebar,    'right', SIDEBAR_MIN, SIDEBAR_MAX, 'wings-sidebar-w');
    initResize('rightpanelResize', rightpanel, 'left',  PANEL_MIN,   PANEL_MAX,   'wings-panel-w');
  };
})();

// ── Appearance helpers (theme = light/dark/system, skin = palette/accent) ────
const _THEMES=[
  {name:'Hell',    value:'light',  colors:['#FEFCF7','#FAF7F0','#B8860B']},
  {name:'Dunkel',  value:'dark',   colors:['#0D0D1A','#141425','#C9A45C']},
  {name:'AImighty', value:'aimighty', colors:['#051729','#0A2238','#C9A45C']},
  {name:'System',  value:'system', colors:['#FEFCF7','#0D0D1A','#B8860B']},
];
const _VALID_THEMES=new Set((_THEMES||[]).map(t=>t.value));
const _LEGACY_THEME_MAP={
  midnight:{theme:'dark'},
  neon:{theme:'aimighty'},
  light:{theme:'light'},
  dark:{theme:'dark'},
  slate:{theme:'dark'},
  solarized:{theme:'dark'},
  monokai:{theme:'aimighty'},
  nord:{theme:'dark'},
  oled:{theme:'dark'},
  codex:{theme:'dark'},
  terracotta:{theme:'dark'},
  graphite:{theme:'dark'},
  github:{theme:'light'},
  'wings-light':{theme:'light'},
  'wings-dark':{theme:'dark'},
};
let _systemThemeMq=null;
let _onSystemThemeChange=null;
let _resolvedThemeBaseDark=false;

function _normalizeAppearance(theme){
  const rawTheme=typeof theme==='string'?theme.trim().toLowerCase():'';
  const legacy=_LEGACY_THEME_MAP[rawTheme];
  const nextTheme=legacy?legacy.theme:(_VALID_THEMES.has(rawTheme)?rawTheme:'dark');
  return {theme:nextTheme};
}

// Sync <meta name="theme-color"> with the active theme's app chrome color.
// This surfaces the WebUI's exact theme background to:
//   1. Mobile Safari status bar (the prefers-color-scheme media variants in index.html
//      cover the pre-load case; this updater handles user-toggled changes mid-session).
//   2. iOS PWA / Add to Home Screen status bar.
//   3. Native WKWebView wrappers (e.g. hermes-swift-mac) that read this attribute as
//      the source of truth for AppKit chrome (tab bar, title bar, traffic-light area)
//      instead of pixel-sampling — overlay-resistant and IPC-free.
// Reading getComputedStyle(html).getPropertyValue('--sidebar') picks up the active skin
// (Default, Sienna, Sisyphus, Charizard, etc.) so each skin's distinct paint reaches
// the meta tag.
function _syncThemeColorMeta(){
  try{
    const bg=getComputedStyle(document.documentElement).getPropertyValue('--sidebar').trim();
    if(!bg) return;
    const known=document.getElementById('wings-theme-color');
    if(known){
      known.setAttribute('content',bg);
      known.removeAttribute('media');
    }
    document.querySelectorAll('meta[name="theme-color"]').forEach(meta=>{
      meta.setAttribute('content',bg);
      meta.removeAttribute('media');
    });
  }catch(e){}
}

function _effectiveThemeDark(baseIsDark){
  return !!baseIsDark;
}

function _setResolvedTheme(isDark){
  _resolvedThemeBaseDark=!!isDark;
  const effectiveDark=_effectiveThemeDark(_resolvedThemeBaseDark);
  document.documentElement.classList.toggle('dark',effectiveDark);
  const link=document.getElementById('prism-theme');
  if(!link){ _syncThemeColorMeta(); return; }
  const want=effectiveDark
    ?'https://cdn.jsdelivr.net/npm/prismjs@1.29.0/themes/prism-tomorrow.min.css'
    :'https://cdn.jsdelivr.net/npm/prismjs@1.29.0/themes/prism.min.css';
  // No SRI integrity on theme CSS — jsdelivr edge nodes serve different
  // digests for the same pinned version, causing intermittent blocking (#1100).
  if(link.href!==want){ link.integrity=''; link.href=want; }
  _syncThemeColorMeta();
}

function _applyTheme(name){
  const normalized=_normalizeAppearance(name);
  delete document.documentElement.dataset.theme;
  if(_systemThemeMq&&_onSystemThemeChange){
    _systemThemeMq.removeEventListener('change',_onSystemThemeChange);
    _systemThemeMq=null;
    _onSystemThemeChange=null;
  }
  if(normalized.theme==='system'){
    _systemThemeMq=window.matchMedia('(prefers-color-scheme:dark)');
    _onSystemThemeChange=()=>_setResolvedTheme(_systemThemeMq.matches);
    _setResolvedTheme(_systemThemeMq.matches);
    _systemThemeMq.addEventListener('change',_onSystemThemeChange);
    return;
  }
  document.documentElement.dataset.theme=normalized.theme;
  if(normalized.theme==='aimighty'){
    document.documentElement.classList.remove('dark');
    _resolvedThemeBaseDark=false;
    _syncThemeColorMeta();
  }else{
    _setResolvedTheme(normalized.theme==='dark');
  }
}

function _pickTheme(name){
  const appearance=_normalizeAppearance(name);
  localStorage.setItem('wings-theme',appearance.theme);
  localStorage.removeItem('wings-skin');
  _applyTheme(appearance.theme);
  _syncThemePicker(appearance.theme);
  const hidden=$('settingsTheme');
  if(hidden) hidden.value=appearance.theme;
  if(typeof _scheduleAppearanceAutosave==='function') _scheduleAppearanceAutosave();
}

function _syncThemePicker(active){
  document.querySelectorAll('#themePickerGrid .theme-pick-btn').forEach(btn=>{
    btn.classList.toggle('active',btn.dataset.themeVal===active);
    btn.style.borderColor='';
    btn.style.boxShadow='';
  });
}

function _applyFontSize(size){
  if(size&&size!=='default'){
    document.documentElement.dataset.fontSize=size;
  } else {
    delete document.documentElement.dataset.fontSize;
  }
}

function _pickFontSize(size){
  localStorage.setItem('wings-font-size',size);
  _applyFontSize(size);
  _syncFontSizePicker(size);
  const hidden=$('settingsFontSize');
  if(hidden) hidden.value=size;
  if(typeof _scheduleAppearanceAutosave==='function') _scheduleAppearanceAutosave();
}

function _syncFontSizePicker(active){
  document.querySelectorAll('#fontSizePickerGrid .font-size-pick-btn').forEach(btn=>{
    btn.classList.toggle('active',btn.dataset.fontSizeVal===(active||'default'));
    btn.style.borderColor='';
    btn.style.boxShadow='';
  });
}

// ── registerWingsSkin — no-op stub (skin system removed, themes unified) ──────
// Kept for backward compatibility with any extension that may call it.
// Returns false; no skin registration is performed.
function registerWingsSkin(_descriptor){ return false; }
if(typeof window!=='undefined') window.registerWingsSkin=registerWingsSkin;

function applyBotName(){
  // The saved assistant name applies to the default profile only.
  // Non-default profiles use their own profile names.
  const name=assistantDisplayName();
  if(!S.session) document.title=name;
  const sidebarH1=document.querySelector('.sidebar-header h1');
  if(sidebarH1) sidebarH1.textContent=name;
  const logo=document.querySelector('.sidebar-header .logo');
  if(logo) logo.textContent=name.charAt(0).toUpperCase();
  const topbarTitle=$('topbarTitle');
  if(topbarTitle && (!S.session)) topbarTitle.textContent=name;
  const msg=$('msg');
  if(msg) msg.placeholder=typeof t==='function'?(t('composer_placeholder_idle')||'Wie kann ich helfen?'):'Wie kann ich helfen?';
  if(typeof _applyBusyComposerPlaceholder==='function') _applyBusyComposerPlaceholder();
}

const _COMPOSER_CONTROL_TOGGLE_DEFS=[
  {key:'hide_composer_attach',label:'Attach',labelKey:'composer_control_attach',selectors:['#btnAttach'],orderSelector:'#btnAttach',orderGroup:'left'},
  {key:'hide_composer_saved_prompts',label:'Saved prompts',labelKey:'composer_control_saved_prompts',selectors:['#btnSavedPrompts'],orderSelector:'#btnSavedPrompts',orderGroup:'left'},
  {key:'hide_composer_mic',label:'Mic',labelKey:'composer_control_mic',selectors:['#btnMic'],orderSelector:'#btnMic',orderGroup:'left'},
  // Voice-mode button lives in the composer-right group (between mic and
  // send) and is available in BOTH UI modes — keep it directly after Mic in
  // the default order so the sort stays at "mic, voice, send".
  {key:'hide_composer_voice_mode',label:'Voice mode',labelKey:'composer_control_voice_mode',selectors:['#btnVoiceMode'],orderSelector:'#btnVoiceMode',orderGroup:'right'},
  {key:'hide_composer_profile',label:'Profile',labelKey:'composer_control_profile',selectors:['#profileChipWrap'],orderSelector:'#profileChipWrap',orderGroup:'left'},
  {key:'hide_composer_workspace',label:'Workspace',labelKey:'composer_control_workspace',selectors:['.composer-ws-wrap','#composerMobileWorkspaceAction'],orderSelector:'.composer-ws-wrap',orderGroup:'left'},
  {key:'hide_composer_model',label:'Model',labelKey:'composer_control_model',selectors:['.composer-model-wrap','#composerMobileModelAction'],orderSelector:'.composer-model-wrap',orderGroup:'left'},
  {key:'hide_composer_reasoning',label:'Reasoning',labelKey:'composer_control_reasoning',selectors:['#composerReasoningWrap','#composerMobileReasoningAction'],orderSelector:'#composerReasoningWrap',orderGroup:'left'},
  {key:'hide_composer_context',label:'Context',labelKey:'composer_control_context',selectors:['#ctxIndicatorWrap','#composerMobileContextAction'],orderSelector:'#ctxIndicatorWrap',orderGroup:'right'},
];
window._COMPOSER_CONTROL_TOGGLE_DEFS=_COMPOSER_CONTROL_TOGGLE_DEFS;

const _COMPOSER_SITUATIONAL_CONTROL_TOGGLE_DEFS=[
  {key:'hide_composer_yolo',label:'YOLO',labelKey:'composer_control_yolo',selectors:['#yoloPill'],orderSelector:'#yoloPill',orderGroup:'left'},
  {key:'hide_composer_bg_badge',label:'Background badge',labelKey:'composer_control_bg_badge',selectors:['#bgBadge'],orderSelector:'#bgBadge',orderGroup:'right'},
  {key:'hide_composer_mobile_config',label:'Mobile config',labelKey:'composer_control_mobile_config',selectors:['#composerMobileConfigBtn'],orderSelector:'#composerMobileConfigBtn',orderGroup:'left'},
  {key:'hide_composer_quota_chip',label:'Quota chip',labelKey:'composer_control_quota_chip',selectors:['#providerQuotaChip','#composerMobileQuotaAction'],orderSelector:'#providerQuotaChip',orderGroup:'left'},
  {key:'hide_composer_toolsets',label:'Toolsets',labelKey:'composer_control_toolsets',selectors:['#composerToolsetsWrap'],orderSelector:'#composerToolsetsWrap',orderGroup:'left'},
  {key:'hide_composer_status',label:'Status',labelKey:'composer_control_status',selectors:['#composerStatus'],orderSelector:'#composerStatus',orderGroup:'right'},
];
window._COMPOSER_SITUATIONAL_CONTROL_TOGGLE_DEFS=_COMPOSER_SITUATIONAL_CONTROL_TOGGLE_DEFS;

function _allComposerControlToggleDefs(){
  return _COMPOSER_CONTROL_TOGGLE_DEFS.concat(_COMPOSER_SITUATIONAL_CONTROL_TOGGLE_DEFS);
}

function _sanitizeComposerControlOrder(order){
  if(!Array.isArray(order)) return [];
  const allowed=new Set(_allComposerControlToggleDefs().map(def=>def.key));
  const out=[];
  order.forEach(key=>{
    if(typeof key!=='string') return;
    key=key.trim();
    if(!key||!allowed.has(key)||out.includes(key)) return;
    out.push(key);
  });
  return out;
}
window._sanitizeComposerControlOrder=_sanitizeComposerControlOrder;

function _orderedComposerControlDefs(order){
  const defs=_allComposerControlToggleDefs();
  const byKey=new Map(defs.map(def=>[def.key,def]));
  const out=[];
  _sanitizeComposerControlOrder(Array.isArray(order)?order:window._composerControlOrder).forEach(key=>{
    if(byKey.has(key)) out.push(byKey.get(key));
  });
  defs.forEach(def=>{if(!out.includes(def)) out.push(def);});
  return out;
}
window._orderedComposerControlDefs=_orderedComposerControlDefs;

function _applyComposerControlOrder(order){
  window._composerControlOrder=_sanitizeComposerControlOrder(order);
  const grouped=new Map();
  _orderedComposerControlDefs(window._composerControlOrder).forEach(def=>{
    const node=document.querySelector(def.orderSelector||def.selectors&&def.selectors[0]);
    if(!node||!node.parentNode) return;
    const parent=node.parentNode;
    if(!grouped.has(parent)) grouped.set(parent,[]);
    grouped.get(parent).push(node);
  });
  grouped.forEach((nodes,parent)=>{
    if(!nodes.length) return;
    const marker=document.createComment('composer-control-order');
    parent.insertBefore(marker,nodes[0]);
    let ref=marker;
    nodes.forEach(node=>{
      parent.insertBefore(node,ref.nextSibling);
      ref=node;
    });
    marker.remove();
  });
  if(typeof _fitComposerFooter==='function') _fitComposerFooter();
}
window._applyComposerControlOrder=_applyComposerControlOrder;

function _composerControlVisibilityFromSettings(settings){
  const next={};
  for(const def of _allComposerControlToggleDefs()){
    next[def.key]=!!(settings&&settings[def.key]);
  }
  return next;
}
window._composerControlVisibilityFromSettings=_composerControlVisibilityFromSettings;

function _setComposerControlHidden(el, hidden){
  if(!el) return;
  el.classList.toggle('composer-control-hidden', !!hidden);
  if(hidden) el.setAttribute('aria-hidden','true');
  else el.removeAttribute('aria-hidden');
}

function _applyComposerFooterVisibilitySettings(){
  const hidden=window._composerControlVisibility||{};
  for(const def of _allComposerControlToggleDefs()){
    const isHidden=!!hidden[def.key];
    for(const selector of def.selectors){
      document.querySelectorAll(selector).forEach(el=>_setComposerControlHidden(el,isHidden));
    }
  }

  const hideMic=!!hidden.hide_composer_mic;
  if(hideMic&&window._micActive&&typeof window._stopMic==='function'){
    try{window._stopMic();}catch(_){ }
  }

  const hideSavedPrompts=!!hidden.hide_composer_saved_prompts;
  const savedBtn=$('btnSavedPrompts');
  const savedPopup=$('savedPromptsPopup');
  if(hideSavedPrompts&&savedPopup){
    savedPopup.style.display='none';
    if(savedBtn) savedBtn.setAttribute('aria-expanded','false');
  }

  if(hidden.hide_composer_workspace&&typeof closeWsDropdown==='function') closeWsDropdown();
  if(hidden.hide_composer_profile&&typeof closeProfileDropdown==='function') closeProfileDropdown();
  if(hidden.hide_composer_model&&typeof closeModelDropdown==='function') closeModelDropdown();
  if(hidden.hide_composer_reasoning&&typeof closeReasoningDropdown==='function') closeReasoningDropdown();
  if(hidden.hide_composer_toolsets&&typeof closeToolsetsDropdown==='function') closeToolsetsDropdown();
  if(hidden.hide_composer_mobile_config&&typeof closeMobileComposerConfig==='function') closeMobileComposerConfig();

  // Hide the divider when all left-group buttons before it are hidden
  // Stops a lone vertical separator from appearing when attach/saved-prompts/mic/voice are all hidden.
  const _divider=document.querySelector('.composer-divider');
  if(_divider){
    const _leftBtnSelectors=['#btnAttach','#btnSavedPrompts','#btnMic'];
    const _allLeftHidden=_leftBtnSelectors.every(sel=>{
      const el=document.querySelector(sel);
      return !el||el.classList.contains('composer-control-hidden')||el.style.display==='none';
    });
    // Use classList.toggle directly instead of _setComposerControlHidden
    // so we don't strip the intentional aria-hidden="true" on the decorative divider
    // when buttons are visible (Greptile feedback).
    _divider.classList.toggle('composer-control-hidden',_allLeftHidden);
  }
}
window._applyComposerFooterVisibilitySettings=_applyComposerFooterVisibilitySettings;

function _applyTitlebarProfileVisibility(){
  const btn=$('titlebarProfileBtn');
  if(!btn) return;
  btn.style.display=window._showTitlebarProfile?'':'none';
}
window._applyTitlebarProfileVisibility=_applyTitlebarProfileVisibility;

function _mirrorSpeechSettingsFromServer(s){
  if(!s||typeof s!=='object') return;
  const persistedSpeechKeys = new Set(
    Array.isArray(s.persisted_speech_keys) ? s.persisted_speech_keys : []
  );
  const hasServerValue=(settingKey)=>persistedSpeechKeys.has(settingKey);
  const defaults={
    tts_enabled:false,
    tts_auto_read:false,
    tts_engine:'browser',
    tts_voice:'',
    tts_rate:1,
    tts_pitch:1,
    voice_mode_button:false,
    voice_continuous:false,
    voice_silence_ms:1800,
    raw_audio_mode:false,
  };
  const cachedValue=(storageKey)=>{
    try{return localStorage.getItem(storageKey);}catch(_){return null;}
  };
  const boolValue=(value)=>value===true||value==='true';
  const resolveBool=(settingKey,storageKey)=>{
    const server=hasServerValue(settingKey)?s[settingKey]:defaults[settingKey];
    const cached=cachedValue(storageKey);
    if(!hasServerValue(settingKey)&&cached!==null){
      return boolValue(cached);
    }
    return boolValue(server);
  };
  const resolveScalar=(settingKey,storageKey)=>{
    const server=hasServerValue(settingKey)?s[settingKey]:defaults[settingKey];
    const cached=cachedValue(storageKey);
    if(!hasServerValue(settingKey)&&cached!==null){
      return cached;
    }
    return server;
  };
  const boolKeys=[
    ['tts_enabled','wings-tts-enabled'],
    ['tts_auto_read','wings-tts-auto-read'],
    ['voice_mode_button','wings-voice-mode-button'],
    ['voice_continuous','wings-voice-continuous'],
  ];
  boolKeys.forEach(([settingKey,storageKey])=>{
    if(hasServerValue(settingKey)){
      try{localStorage.setItem(storageKey,resolveBool(settingKey,storageKey)?'true':'false');}catch(_){}
    }
  });
  [
    ['tts_engine','wings-tts-engine'],
    ['tts_voice','wings-tts-voice'],
    ['tts_rate','wings-tts-rate'],
    ['tts_pitch','wings-tts-pitch'],
    ['voice_silence_ms','wings-voice-silence-ms'],
  ].forEach(([settingKey,storageKey])=>{
    if(hasServerValue(settingKey)){
      try{localStorage.setItem(storageKey,String(resolveScalar(settingKey,storageKey)));}catch(_){}
    }
  });
  if(hasServerValue('raw_audio_mode')){
    const rawAudioMode=resolveBool('raw_audio_mode','wings-raw-audio-mode');
    if(typeof window._applyRawAudioModePreference==='function'){
      window._applyRawAudioModePreference(rawAudioMode);
    }else{
      try{localStorage.setItem('wings-raw-audio-mode',rawAudioMode?'true':'false');}catch(_){}
    }
  }
}
window._mirrorSpeechSettingsFromServer=_mirrorSpeechSettingsFromServer;

(async()=>{
  // Load send key preference
  let _bootSettings={};
  const prefillIntent=(typeof _composerPrefillIntentFromLocation==='function')?_composerPrefillIntentFromLocation():null;
  try{
    const s=await api('/api/settings');
    _bootSettings=s;
    if(typeof checkWebUIVersionSkew==='function'){try{checkWebUIVersionSkew(s);}catch(_){}}
    window._sendKey=s.send_key||'enter';
    // Persist default workspace so the blank new-chat page can show it
    // and workspace actions (New file/folder) work before the first session (#804).
    if(s.default_workspace) S._profileDefaultWorkspace=s.default_workspace;
    window._showTokenUsage=!!s.show_token_usage;
    window._showQuotaChip=s.show_quota_chip===true;
    window._showConversationOutline=s.show_conversation_outline===true;
    document.documentElement.dataset.conversationOutline=window._showConversationOutline?'enabled':'disabled';
    if(typeof applyConversationOutlinePreference==='function') applyConversationOutlinePreference();
    window._hideEmptyStateSuggestions=s.hide_empty_state_suggestions===true;
    applyEmptyStateSuggestionPref();
    // #4343: transcript virtualization is EXPERIMENTAL/opt-IN (default OFF).
    // It caused scroll-up flicker on long sessions, so it's off for everyone
    // unless explicitly opted in; long transcripts render in full by default.
    window._virtualizeTranscript=s.virtualize_transcript===true;
    window._showTps=!!s.show_tps;
    window._fadeTextEffect=!!s.fade_text_effect;
    window._showCliSessions=s.show_cli_sessions!==false;
    window._showPreviousMessagingSessions=!!s.show_previous_messaging_sessions;
    window._soundEnabled=!!s.sound_enabled;
    window._notificationsEnabled=!!s.notifications_enabled;
    window._whatsNewSummaryEnabled=!!s.whats_new_summary_enabled;
    window._showThinking=s.show_thinking!==false;
    window._simplifiedToolCalling=true;
    window._chatActivityDisplayMode=s.chat_activity_display_mode==='transparent_stream'||s.chat_activity_display_mode==='hide_all_activity'
      ? s.chat_activity_display_mode
      : 'compact_worklog';
    window._transparentStream=window._chatActivityDisplayMode==='transparent_stream';
    window._terminalAutoExpandOnOutput=!!s.terminal_auto_expand_on_output;
    window._worklogDetailsExpandedByDefault=!!(
      Object.prototype.hasOwnProperty.call(s,'worklog_details_expanded_default')
        ? s.worklog_details_expanded_default
        : s.activity_feed_expanded_default
    );
    window._workspaceTodosTab=!!s.workspace_todos_tab;
    if(typeof _applyWorkspaceTodosTabVisibility==='function') _applyWorkspaceTodosTabVisibility();
    window._sidebarDensity=(s.sidebar_density==='detailed'?'detailed':'compact');
    window._pinnedSessionsLimit=parseInt(s.pinned_sessions_limit||3,10)||3;
    window._inflightStateLimits={
      maxSessions:parseInt(s.inflight_state_max_sessions||8,10)||8,
      messages:parseInt(s.inflight_state_max_messages||24,10)||24,
      toolCalls:parseInt(s.inflight_state_max_tool_calls||48,10)||48,
      stringChars:parseInt(s.inflight_state_max_string_chars||60000,10)||60000,
      jsonChars:parseInt(s.inflight_state_max_json_chars||1500000,10)||1500000,
    };
    // #5162 rename + steer default, layered on the #5170 localStorage mirror:
    // resolve the mode (new key, legacy busy_input_mode fallback, else 'steer'
    // via _normalizeDefaultMessageMode) and persist it so the very first send
    // after a reload honors the saved choice.
    window._defaultMessageMode=_persistDefaultMessageMode(s.default_message_mode||s.busy_input_mode);
    window._showBusyPlaceholderHint=!!s.show_busy_placeholder_hint;
    window._newChatOnWorkspaceSwitch=!!s.new_chat_on_workspace_switch;  // #5473 opt-in
    window._sessionEndlessScrollEnabled=!!s.session_endless_scroll;
    window._autoScrollFollow=s.auto_scroll_follow!==false;
    window._largeTextPasteAsAttachment=s.large_text_paste_as_attachment!==false;
    window._projectQuickCreate=!!s.project_quick_create_buttons;
    window._composerControlVisibility=_composerControlVisibilityFromSettings(s);
    window._composerControlOrder=_sanitizeComposerControlOrder(s.composer_control_order);
    _applyComposerControlOrder(window._composerControlOrder);
    window._showTitlebarProfile=!!s.show_titlebar_profile;
    _applyTitlebarProfileVisibility();
    window._botName=s.bot_name||'Wings';
    if(s.default_model_provider) window._activeProvider=s.default_model_provider;
    if(s.default_model){
      window._defaultModel=s.default_model;
      const sel=$('modelSelect');
      if(sel&&typeof _applyModelToDropdown==='function'){
        // Fresh page boot must prefer the profile/server default over stale
        // browser-persisted model state. A restored session can still apply its
        // own persisted model later through loadSession(). Preserve the browser
        // keys for legacy/no-default fallback paths instead of deleting them.
        const existingDefaultOpt=Array.from(sel.options).find(o=>o.value===s.default_model);
        if(existingDefaultOpt&&window._activeProvider&&!existingDefaultOpt.dataset.provider){
          existingDefaultOpt.dataset.provider=window._activeProvider;
        }
        if(!existingDefaultOpt){
          const opt=document.createElement('option');
          opt.value=s.default_model;
          opt.textContent=typeof getModelLabel==='function'?getModelLabel(s.default_model):s.default_model;
          opt.dataset.custom='1';
          opt.dataset.provider=window._activeProvider||'';
          sel.querySelectorAll('option[data-custom]').forEach(o=>o.remove());
          sel.appendChild(opt);
        }
        _applyModelToDropdown(s.default_model,sel,window._activeProvider||null);
      }
    }
    window._sessionJumpButtonsEnabled=!!s.session_jump_buttons;
    window._renderUserMarkdown=!!s.render_user_markdown;
    // JSON/YAML structured code-block default view (#484): auto | on | off,
    // plus the 'auto'-mode line threshold (sanitized int 1..1000, fallback 10).
    window._structuredCodeDefaultView=['on','off','auto'].includes(s.structured_code_default_view)?s.structured_code_default_view:'auto';
    const _sctLines=parseInt(s.structured_code_auto_tree_lines,10);
    window._structuredCodeAutoTreeLines=(Number.isFinite(_sctLines)&&_sctLines>=1&&_sctLines<=1000)?_sctLines:10;
    // Reconcile appearance: prefer localStorage (what the user last saw) over
    // the server.  If they diverge (e.g. a previous autosave POST failed),
    // push the localStorage values back to the server so settings.json stays
    // in sync without ever clobbering the user's chosen theme/skin.
    //
    // Caveat: the pre-paint inline script in index.html normalises empty
    // localStorage into 'dark'/'default' BEFORE this code runs, so a truly
    // empty (new-browser) state is indistinguishable from a user who chose
    // the defaults.  To avoid blocking server→client sync on first visit we
    // only let localStorage override the server when it carries an explicit
    // user-selectable theme value. That keeps the server in charge for empty
    // first-visit state while preserving explicit light/dark/neon/system choices
    // after a failed autosave.
    const srvAppearance=_normalizeAppearance(s.theme);
    const lsTheme=(localStorage.getItem('wings-theme')||'').trim().toLowerCase();
    const lsAppearance=_normalizeAppearance(lsTheme||null);
    const lsHasExplicitTheme=lsTheme&&['system','light','dark','neon','aimighty'].includes(lsTheme);
    const theme=lsHasExplicitTheme?lsAppearance.theme:srvAppearance.theme;
    localStorage.setItem('wings-theme',theme);
    localStorage.removeItem('wings-skin');
    _applyTheme(theme);
    // Reconcile: if localStorage and server disagree, push localStorage
    // values to the server so the next refresh won't revert.
    if(lsHasExplicitTheme&&theme!==srvAppearance.theme){
      try{
        api('/api/settings',{method:'POST',body:JSON.stringify({theme})});
      }catch(_){}
    }
    const fontSize=(s.font_size||localStorage.getItem('wings-font-size')||'default');
    localStorage.setItem('wings-font-size',fontSize);
    _applyFontSize(fontSize);
    if(typeof setLocale==='function'){
      const _lang=typeof resolvePreferredLocale==='function'
        ? resolvePreferredLocale(s.language, localStorage.getItem('wings-lang'))
        : (s.language || localStorage.getItem('wings-lang') || 'en');
      setLocale(_lang);
      if(typeof applyLocaleToDOM==='function')applyLocaleToDOM();
    }
    _mirrorSpeechSettingsFromServer(s);
    // Apply voice-mode visibility BEFORE computing the divider so the
    // .composer-divider (#5451) sees #btnVoiceMode final display even
    // when a server/localStorage sync path flipped the pref between
    // module init and settings-load completion (round-2 SILENT race).
    // Note: must use window._applyVoiceModePref — the bare name is
    // closure-local to the voice-mode IIFE and not visible here.
    if(typeof window._applyVoiceModePref==='function') window._applyVoiceModePref();
    _applyComposerFooterVisibilitySettings();
    // TTS: apply enabled state on boot so buttons show/hide correctly (#499)
    if(typeof _applyTtsEnabled==='function') _applyTtsEnabled(localStorage.getItem('wings-tts-enabled')==='true');
  }catch(e){
    window._showTokenUsage=false;
    window._showQuotaChip=false;
    window._showConversationOutline=false;
    document.documentElement.dataset.conversationOutline='disabled';
    if(typeof applyConversationOutlinePreference==='function') applyConversationOutlinePreference();
    window._hideEmptyStateSuggestions=true;  // settings-load failed: mirror the True config default (suggestions opt-in)
    applyEmptyStateSuggestionPref();
    window._virtualizeTranscript=false;  // settings-load failed: default-OFF (experimental/opt-in) (#4343)
    window._showTps=false;
    window._fadeTextEffect=false;
    window._showCliSessions=true;  // settings-load failed: mirror the True config default (#3988)
    window._soundEnabled=false;
    window._notificationsEnabled=false;
    window._whatsNewSummaryEnabled=false;
    window._showThinking=true;
    window._simplifiedToolCalling=true;
    window._chatActivityDisplayMode='compact_worklog';
    window._transparentStream=false;
    window._terminalAutoExpandOnOutput=false;
    window._workspaceTodosTab=false;
    if(typeof _applyWorkspaceTodosTabVisibility==='function') _applyWorkspaceTodosTabVisibility();
    window._sessionJumpButtonsEnabled=false;
    window._structuredCodeDefaultView='auto';
    window._structuredCodeAutoTreeLines=10;
    window._sidebarDensity='compact';
    window._pinnedSessionsLimit=3;
    // Settings load failed: keep the persisted default-message-mode preference
    // (the eager default already read it from the localStorage mirror) instead
    // of clobbering it, so a saved 'steer'/'interrupt'/'queue' still applies
    // when the server is unreachable (#5167). The placeholder-hint has no
    // persisted mirror, so it defaults off on failure.
    window._defaultMessageMode=_readPersistedDefaultMessageMode();
    window._showBusyPlaceholderHint=false;
    window._sessionEndlessScrollEnabled=false;
    window._autoScrollFollow=true;
    window._composerControlVisibility=_composerControlVisibilityFromSettings(null);
    window._composerControlOrder=[];
    _applyComposerControlOrder(window._composerControlOrder);
    window._botName='Wings';
    _bootSettings={check_for_updates:false};
    if(typeof setLocale==='function'){
      const _lang=typeof resolvePreferredLocale==='function'
        ? resolvePreferredLocale(null, localStorage.getItem('wings-lang'))
        : (localStorage.getItem('wings-lang') || 'en');
      setLocale(_lang);
      if(typeof applyLocaleToDOM==='function')applyLocaleToDOM();
    }
    // Apply voice-mode visibility BEFORE computing the divider so the
    // .composer-divider (#5451) sees #btnVoiceMode final display even when
    // a server/localStorage sync path flipped the pref between module init
    // and settings-load completion (round-2 SILENT race fix; safe no-op on
    // the failure-fallback path because _applyVoiceModePref is idempotent).
    // Note: must use window._applyVoiceModePref — the bare name is
    // closure-local to the voice-mode IIFE and not visible here.
    if(typeof window._applyVoiceModePref==='function') window._applyVoiceModePref();
    _applyComposerFooterVisibilitySettings();
    if(typeof _applyTtsEnabled==='function') _applyTtsEnabled(localStorage.getItem('wings-tts-enabled')==='true');
  }
  // Non-blocking update check (fire-and-forget, once per tab session)
  // ?test_updates=1 in URL forces banner display for testing (bypasses sessionStorage guards)
  const _testUpdates=new URLSearchParams(location.search).get('test_updates')==='1';
  if(_testUpdates||(_bootSettings.check_for_updates!==false&&!sessionStorage.getItem('wings-update-checked')&&!sessionStorage.getItem('wings-update-dismissed'))){
    const _checkUrl='api/updates/check'+(_testUpdates?'?simulate=1':'');
    api(_checkUrl,{method:_testUpdates?'GET':'POST',body:_testUpdates?undefined:JSON.stringify({force:false})}).then(d=>{if(!_testUpdates)sessionStorage.setItem('wings-update-checked','1');if((d.webui&&d.webui.behind>0)||(d.agent&&d.agent.behind>0))_showUpdateBanner(d);}).catch(()=>{});
  }
  const _bootActiveProfileUnauthRedirectBudget=(()=>{
    const markerKey='wings-active-profile-bootstrap-401';
    let consumed=false;
    const readAttempted=(storage=sessionStorage)=>{
      try{
        const attempted=storage&&storage.getItem?storage.getItem(markerKey)==='1':false;
        if(attempted) consumed=true;
        return attempted;
      }catch(_){
        return false;
      }
    };
    const markAttempted=(storage=sessionStorage)=>{
      consumed=true;
      try{
        if(storage&&storage.setItem) storage.setItem(markerKey,'1');
      }catch(_){}
    };
    const clearAttempted=(storage=sessionStorage)=>{
      try{
        if(storage&&storage.removeItem) storage.removeItem(markerKey);
      }catch(_){}
    };
    const spendOnFallback=(storage=sessionStorage)=>{
      consumed=true;
      clearAttempted(storage);
    };
    const spendOnRedirect=(storage=sessionStorage)=>{
      if(consumed) return false;
      markAttempted(storage);
      return true;
    };
    const redirectToLogin=(nextUrl)=>{
      // #5578: never nest the login URL into its own next= — if already on a
      // login-shaped page, reload 'login' bare (the page keeps its inner next).
      const _p=(window.location.pathname||'').replace(/\/+$/,'');
      if(/(?:^|\/)login$/.test(_p)){window.location.href='login';return;}
      window.location.href='login?next='+encodeURIComponent(nextUrl);
    };
    return {
      readAttempted,
      clearAttempted,
      spendOnFallback,
      spendOnRedirect,
      redirectToLogin,
      isConsumed:()=>consumed,
    };
  })();
  async function _resolveActiveProfileBootstrapState({
    loadActiveProfile = () => api('/api/profile/active', {redirect401: false}),
    getNextUrl = () => window.location.pathname + window.location.search,
    redirectToLogin = (nextUrl) => {
      _bootActiveProfileUnauthRedirectBudget.redirectToLogin(nextUrl);
    },
    markerStorage = sessionStorage,
  } = {}) {
    const alreadyAttempted = _bootActiveProfileUnauthRedirectBudget.readAttempted(markerStorage);
    try {
      const p = await loadActiveProfile();
      if (p && typeof p === 'object' && typeof p.name === 'string') {
        _bootActiveProfileUnauthRedirectBudget.clearAttempted(markerStorage);
        if (p.default_workspace) S._profileDefaultWorkspace = p.default_workspace;
        return {status: 'resolved', profile: p.name || 'default', isDefault: !!p.is_default};
      }
      if (p === undefined && !alreadyAttempted) {
        if (_bootActiveProfileUnauthRedirectBudget.spendOnRedirect(markerStorage)) {
          redirectToLogin(getNextUrl());
        }
        return {status: 'recovery-redirect'};
      }
      if (p === undefined) _bootActiveProfileUnauthRedirectBudget.spendOnFallback(markerStorage);
      else _bootActiveProfileUnauthRedirectBudget.clearAttempted(markerStorage);
      return {status: 'fallback', profile: 'default', isDefault: true};
    } catch (e) {
      _bootActiveProfileUnauthRedirectBudget.clearAttempted(markerStorage);
      if (!alreadyAttempted && e && e.status === 401) {
        if (_bootActiveProfileUnauthRedirectBudget.spendOnRedirect(markerStorage)) {
          redirectToLogin(getNextUrl());
        }
        return {status: 'recovery-redirect'};
      }
      if (e && e.status === 401) _bootActiveProfileUnauthRedirectBudget.spendOnFallback(markerStorage);
      return {status: 'fallback', profile: 'default', isDefault: true};
    }
  }

  // Fetch active profile
  const activeProfileState = await _resolveActiveProfileBootstrapState();
  if (activeProfileState.status === 'recovery-redirect') return;
  S.activeProfile = activeProfileState.profile;
  S.activeProfileIsDefault = activeProfileState.isDefault;
  applyBotName();
  // Update profile chip label immediately
  const profileLabel=$('profileChipLabel');
  if(profileLabel) profileLabel.textContent=S.activeProfile||'default';
  const titleLabel=$('titlebarProfileLabel');
  if(titleLabel) titleLabel.textContent=S.activeProfile||'default';
  const profileIntent=(typeof _profileQueryIntentFromLocation==='function')?_profileQueryIntentFromLocation():null;
  const _savedLocalBeforeProfileSwitch=localStorage.getItem('wings-session');
  const _profileSwitchProfileBefore=S.activeProfile||'default';
  const _profileSwitchIsDefaultBefore=!!S.activeProfileIsDefault;
  let _profileSwitchCompleted=false;
  let _profileSwitchChangedProfile=false;
  if(profileIntent&&profileIntent.hasParam){
    try{
      if(profileIntent.valid){
        if(typeof switchToProfile==='function'){
          _profileSwitchCompleted=await switchToProfile(profileIntent.name)===true;
          if(_profileSwitchCompleted){
            _profileSwitchChangedProfile=(S.activeProfile||'default')!==_profileSwitchProfileBefore||!!S.activeProfileIsDefault!==_profileSwitchIsDefaultBefore;
            if(typeof _consumeProfileQueryParamFromLocation==='function') _consumeProfileQueryParamFromLocation();
          }
        }
      }else{
        console.warn('[boot] ignored invalid profile query', profileIntent.name);
        if(typeof _consumeProfileQueryParamFromLocation==='function') _consumeProfileQueryParamFromLocation();
      }
    }catch(e){
      console.warn('[boot] profile query switch failed', e);
    }
  }
  if(typeof fetchReasoningChip==='function'&&(!_profileSwitchCompleted||!_profileSwitchChangedProfile)) fetchReasoningChip();
  // Fetch available models without blocking session restore. The static HTML
  // options are enough for first paint; the dynamic provider list can settle
  // after the saved session is visible.
  const _redirectBootModelDropdownIfUnauth=(res)=>{
    if(!res||res.status!==401) return false;
    window._modelDropdownReady=null;
    if(_bootActiveProfileUnauthRedirectBudget.isConsumed()) return true;
    if(_bootActiveProfileUnauthRedirectBudget.spendOnRedirect(sessionStorage)){
      _bootActiveProfileUnauthRedirectBudget.redirectToLogin(window.location.pathname+window.location.search);
    }
    return true;
  };
  const _hydrateModelDropdown=({redirectIfUnauth=null}={})=>populateModelDropdown({
    preferProfileDefaultOnFreshBoot:true,
    ...(redirectIfUnauth?{redirectIfUnauth}:{}),
  }).then(()=>{
    const sessionModelState=S.session&&S.session.model
      ? {model:S.session.model,model_provider:S.session.model_provider||null}
      : null;
    const savedState=(typeof _readPersistedModelState==='function')
      ? _readPersistedModelState()
      : (localStorage.getItem('wings-model')?{model:localStorage.getItem('wings-model'),model_provider:null}:null);
    // Active sessions are authoritative. On fresh boot without a restored
    // session, keep the profile/server default ahead of stale browser model
    // state when a default exists.
    const stateToApply=sessionModelState||(!window._defaultModel?savedState:null);
    const savedModel=stateToApply&&stateToApply.model;
    if(savedModel && $('modelSelect')){
      const applied=(typeof _applyModelToDropdown==='function')
        ? (sessionModelState
          ? _applyModelToDropdown(sessionModelState.model,$('modelSelect'),sessionModelState.model_provider||null)
          : _applyModelToDropdown(savedState.model,$('modelSelect'),savedState.model_provider||null))
        : null;
      if(!applied) $('modelSelect').value=stateToApply.model;
      // If the value didn't take (model not in list), clear the bad pref only
      // for persisted browser preferences. Active sessions remain authoritative.
      if(!applied&&sessionModelState&&typeof _ensureModelOptionInDropdown==='function'){
        _ensureModelOptionInDropdown(sessionModelState.model,$('modelSelect'),sessionModelState.model_provider||null);
      }
      else if(!applied&&!sessionModelState&&$('modelSelect').value!==stateToApply.model){
        if(typeof _clearPersistedModelState==='function') _clearPersistedModelState();
        else {
          localStorage.removeItem('wings-model');
          localStorage.removeItem('wings-model-state');
        }
      }
      else if(typeof syncModelChip==='function') syncModelChip();
    }
    if(S.session) syncTopbar();
    else if(typeof syncReasoningChip==='function') syncReasoningChip();
  }).catch(e=>{
    window._modelDropdownReady=null;
    throw e;
  });
  const _startModelDropdown=()=>{
    const ready=window._modelDropdownReady;
    if(ready&&typeof ready.then==='function') return ready;
    const next=_hydrateModelDropdown();
    window._modelDropdownReady=next;
    return next;
  };
  const _startBootModelDropdown=()=>{
    const ready=window._modelDropdownReady;
    if(ready&&typeof ready.then==='function') return ready;
    const next=_hydrateModelDropdown({redirectIfUnauth:_redirectBootModelDropdownIfUnauth});
    window._modelDropdownReady=next;
    return next;
  };
  window._modelDropdownReady=null;
  window._startBootModelDropdown=_startBootModelDropdown;
  window._ensureModelDropdownReady=_startModelDropdown;
  setTimeout(()=>{
    try{Promise.resolve(_startBootModelDropdown()).catch(()=>{});}catch(_){}
  },0);
  // Start independent boot fetches without holding the conversation list behind
  // them. The sidebar can render from /api/sessions while workspace/onboarding
  // metadata settles in parallel.
  const _workspaceListReady=loadWorkspaceList();
  const _onboardingReady=_bootSettings.onboarding_completed?Promise.resolve(false):loadOnboardingWizard();
  // Render the session list before restoring the saved conversation so a stale
  // saved-session/client-side boot error cannot leave the sidebar empty forever.
  await renderSessionList();
  await _workspaceListReady;
  await _onboardingReady;
  _initResizePanels();
  // Workspace panel restore happens AFTER loadSession so we know if
  // the session has a workspace — prevents the snap-open-then-closed flash (#576).
  // Fix #822: clear any browser-restored value before first render. This
  // covers fresh page loads and reloads. The bfcache restore case is handled
  // separately below by a `pageshow` listener — the async IIFE here does NOT
  // re-run when the browser restores the page from bfcache.
  const _srch = document.getElementById('sessionSearch'); if (_srch) _srch.value = '';
  if (typeof syncSessionSearchClear === 'function') syncSessionSearchClear();
  if(typeof refreshProviderQuotaIndicator==='function') refreshProviderQuotaIndicator();
  const urlSession=(typeof _sessionIdFromLocation==='function')?_sessionIdFromLocation():null;
  const pwaLaunchAction=(window.WingsPWA&&typeof window.WingsPWA.launchAction==='function')
    ? window.WingsPWA.launchAction()
    : null;
  if(pwaLaunchAction==='new-chat'){
    try{
      await newSession(true);
      // New-chat PWA launches need the empty conversation visible immediately.
      // Boot model hydration can take several seconds when /api/models falls
      // into a cold provider-catalog rebuild; it is already safe to finish in
      // the background because newSession() posted the configured default and
      // rendered the session's authoritative model/provider.
      if(S.session){
        try{Promise.resolve(_startBootModelDropdown()).catch(()=>{});}catch(_){}
      }
      S._bootReady=true;
      syncTopbar();syncWorkspacePanelState();await renderSessionList();await _finalizeComposerPrefillOnBoot(prefillIntent);if(typeof startGatewaySSE==='function')startGatewaySSE();return;
    }catch(e){console.warn('[pwa] new-chat launch action failed', e);}
  }
  const _profileQueryBlocksSavedLocal=_profileQueryBlocksSavedLocalRestore(profileIntent, urlSession);
  if(_profileQueryBlocksSavedLocal&&_profileSwitchCompleted&&_profileSwitchChangedProfile){
    try{
      if(localStorage.getItem('wings-session')===_savedLocalBeforeProfileSwitch) localStorage.removeItem('wings-session');
    }catch(_){}
  }
  const savedLocal=localStorage.getItem('wings-session');
  const saved=urlSession||savedLocal;
  if(saved){
    try{
      const savedSidebarOnlyState=(!urlSession&&savedLocal)
        ? await _savedSessionSidebarOnlyState(savedLocal)
        : null;
      if(savedSidebarOnlyState&&savedSidebarOnlyState.sidebarOnly){
        if(savedSidebarOnlyState.archived){
          try{localStorage.removeItem('wings-session');}catch(_){}
        }
        S.session=null; S.messages=[]; S.activeStreamId=null; S.busy=false;
        S._bootReady=true;
        syncTopbar();syncWorkspacePanelState();
        $('emptyState').style.display='';
        await renderSessionList();await _finalizeComposerPrefillOnBoot(prefillIntent);if(typeof startGatewaySSE==='function')startGatewaySSE();
        return;
      }
      if(_rootPrefillNeedsFreshComposer(urlSession, savedLocal, prefillIntent)){
        S.session=null; S.messages=[]; S.activeStreamId=null; S.busy=false;
        S._bootReady=true;
        const _ephPanelPref=localStorage.getItem('wings-workspace-panel-pref')==='open'
          || localStorage.getItem('wings-workspace-panel')==='open';
        if(_ephPanelPref&&!_isCompactWorkspaceViewport()) _workspacePanelMode='browse';
        await _maybeBindFreshDefaultWorkspaceSession(prefillIntent);
        syncTopbar();syncWorkspacePanelState();
        $('emptyState').style.display='';
        await renderSessionList();await _finalizeComposerPrefillOnBoot(prefillIntent);if(typeof startGatewaySSE==='function')startGatewaySSE();
        return;
      }
      await loadSession(saved, {preserveActiveInput:true});
      // Hard refresh starts from the static HTML model list. Hydrate the live
      // catalog after the saved session is known, then re-apply that session's
      // model before S._bootReady lets syncModelChip reveal the composer label.
      // Otherwise the chip can display the static default (e.g. GPT-5.4 Mini)
      // even though S.session already points at the Codex/current model.
      if(S.session) await _startBootModelDropdown();
      // If the restored session has no messages it is an ephemeral scratch pad —
      // treat the page as a fresh start rather than resuming a blank conversation.
      // loadSession() already ran, so loadDir() has populated the workspace file tree.
      // Do NOT remove the session ID from localStorage — keeping it means every
      // subsequent refresh will also run loadSession() → loadDir() → files stay visible.
      // Removing it here caused the file tree to go blank on the second refresh
      // because the "no saved session" path never calls loadDir (#workspace-files).
      const _restoredInFlight = S.session && (
        S.session.active_stream_id ||
        S.session.pending_user_message
      );
      const _restoredDraft = (S.session && S.session.composer_draft) || {};
      const _restoredDraftText = String(_restoredDraft.text||'').trim();
      const _restoredDraftFiles = Array.isArray(_restoredDraft.files)
        ? _restoredDraft.files.filter(Boolean)
        : [];
      const _restoredHasDraft = !!(_restoredDraftText || _restoredDraftFiles.length);
      if(S.session && (S.session.message_count||0) === 0 && !_restoredInFlight && !_restoredHasDraft){
        S.session=null; S.messages=[];
        S._bootReady=true;
        // Restore panel pref before syncing so the workspace panel stays visible
        // even though there is no active session (#workspace-persist).
        const _ephPanelPref=localStorage.getItem('wings-workspace-panel-pref')==='open'
          || localStorage.getItem('wings-workspace-panel')==='open';
        if(_ephPanelPref&&!_isCompactWorkspaceViewport()) _workspacePanelMode='browse';
        await _maybeBindFreshDefaultWorkspaceSession(prefillIntent);
        syncTopbar();syncWorkspacePanelState();
        $('emptyState').style.display='';
        await renderSessionList();await _finalizeComposerPrefillOnBoot(prefillIntent);if(typeof startGatewaySSE==='function')startGatewaySSE();
        return;
      }
      // Restore the panel from localStorage when the session has a workspace.
      // Preference key takes priority over runtime state so that closing
      // the panel via toolbar X doesn't suppress the "keep open" setting.
      const panelPref=localStorage.getItem('wings-workspace-panel-pref')==='open'
        || localStorage.getItem('wings-workspace-panel')==='open';
      if(S.session&&S.session.workspace&&panelPref&&!_isCompactWorkspaceViewport()){
        _workspacePanelMode='browse';
      }
      S._bootReady=true;
      syncTopbar();syncWorkspacePanelState();await renderSessionList();if(typeof startGatewaySSE==='function')startGatewaySSE();await checkInflightOnBoot(saved);await _finalizeComposerPrefillOnBoot(prefillIntent);return;}
    catch(e){localStorage.removeItem('wings-session');}
  }
  // no saved session - show empty state, wait for user to hit +
  S._bootReady=true;
  syncTopbar();
  // Restore panel pref so the workspace panel stays visible on a fresh load if the
  // user had it open during their last session (#workspace-persist).
  const _freshPanelPref=localStorage.getItem('wings-workspace-panel-pref')==='open'
    || localStorage.getItem('wings-workspace-panel')==='open';
  if(_freshPanelPref&&!_isCompactWorkspaceViewport()) _workspacePanelMode='browse';
  await _maybeBindFreshDefaultWorkspaceSession(prefillIntent);
  syncWorkspacePanelState();
  $('emptyState').style.display='';
  await renderSessionList();await _finalizeComposerPrefillOnBoot(prefillIntent);
  // Start real-time gateway session sync if setting is enabled
  if(typeof startGatewaySSE==='function') startGatewaySSE();
})().catch(e=>{
  console.error('[wings] boot failed', e);
  try{S._bootReady=true;}catch(_){}
  try{syncTopbar();}catch(_){}
  try{syncWorkspacePanelState();}catch(_){}
  try{$('emptyState').style.display='';}catch(_){}
  try{if(typeof renderSessionList==='function') void renderSessionList();}catch(_){}
});

// Fix #822 (bfcache path): when the browser restores the page from the
// back-forward cache, the async boot IIFE above does NOT re-run, but the
// DOM — including any stale value in #sessionSearch — IS restored.  A
// prior search string would silently hide all sessions via the filter in
// renderSessionListFromCache().  Clear the field and re-run the full layout
// sync whenever the page is restored from cache (`event.persisted === true`).
// Fix #1045: also re-run topbar/workspace/panel state so the rail and layout
// chrome aren't left in the stale bfcache snapshot.
window.addEventListener('pageshow', async (event) => {
  if (!event.persisted) return;  // fresh loads are handled by the IIFE above
  _syncKeyboardBottomInset();
  const _srch = document.getElementById('sessionSearch');
  if (_srch) _srch.value = '';
  if (typeof syncSessionSearchClear === 'function') syncSessionSearchClear();
  // Close any dropdowns/popovers that were open when the user navigated away.
  // bfcache freezes DOM state, so a dropdown left open remains open on restore.
  if (typeof closeModelDropdown === 'function') try { closeModelDropdown(); } catch (_) {}
  if (typeof closeReasoningDropdown === 'function') try { closeReasoningDropdown(); } catch (_) {}
  if (typeof closeWsDropdown === 'function') try { closeWsDropdown(); } catch (_) {}
  if (typeof closeProfileDropdown === 'function') try { closeProfileDropdown(); } catch (_) {}
  // BFCache restores the frozen DOM without rerunning boot. Refresh the active
  // session through the normal load path so in-flight sessions with
  // active_stream_id / pending_user_message can reattach like a reload restore.
  if (S.session && S.session.session_id && typeof loadSession === 'function') {
    try {
      await loadSession(S.session.session_id);
      if (S.session && S.session.session_id && typeof checkInflightOnBoot === 'function') {
        try { await checkInflightOnBoot(S.session.session_id); } catch (_) {}
      }
    } catch (_) {}
  }
  // Re-synchronise layout chrome that the boot IIFE sets up but bfcache
  // doesn't re-run. Each call is guarded so missing helpers degrade silently.
  if (typeof syncTopbar === 'function') try { syncTopbar(); } catch (_) {}
  if (typeof syncWorkspacePanelState === 'function') try { syncWorkspacePanelState(); } catch (_) {}
  if (typeof renderSessionListFromCache === 'function') {
    try { renderSessionListFromCache(); } catch (_) {}
  }
  // Restart the gateway SSE watcher — the persisted connection is dead after bfcache
  if (typeof startGatewaySSE === 'function') try { startGatewaySSE(); } catch (_) {}
  // Re-sync sidebar collapse state from localStorage. bfcache restored the
  // frozen DOM but another tab may have toggled the sidebar in the meantime.
  if (typeof _isSidebarCollapsed === 'function' && typeof toggleSidebar === 'function') {
    try {
      const _want = localStorage.getItem('wings-sidebar-collapsed') === '1';
      const _have = _isSidebarCollapsed();
      if (_want !== _have) toggleSidebar(_want);
      if (typeof _syncSidebarAria === 'function') _syncSidebarAria();
    } catch (_) {}
  }
});

async function shutdownServer() {
  const ok = await showConfirmDialog({
    title: (typeof t === 'function' ? t('settings_shutdown_confirm_title') : 'Stop Wings for Hermes'),
    message: (typeof t === 'function' ? t('settings_shutdown_confirm_message') : 'Stop the Wings for Hermes server?'),
    confirmLabel: (typeof t === 'function' ? t('settings_shutdown_confirm_btn') : 'Stop'),
    danger: true,
  });
  if (!ok) return;
  localStorage.setItem('wings-server-stopped', '1');
  try { var bc = new BroadcastChannel('wings-shutdown'); bc.postMessage('stop'); bc.close(); } catch(_) {}
  _showServerStopped();
  try { await api('/api/shutdown', { method: 'POST' }); } catch (_) {}
}

function _showServerStopped() {
  var stoppedMsg = (typeof t === 'function' ? t('settings_shutdown_stopped_message') : 'Server stopped. You can close this tab.');
  document.body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;color:var(--muted);font-family:system-ui,ui-sans-serif;font-size:14px"><p>' + stoppedMsg + '</p></div>';
}
