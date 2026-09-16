"""Wings mobile / iOS-PWA contract (26.9.4).

Static checks for the Wings-only mobile layer. These live in their own file
(instead of extending tests/test_mobile_layout.py) because that file documents
the upstream mobile contract and is rewritten on upstream syncs — this one is a
Wings island and must be updated deliberately (see wings_update.md).

Run:
    ./scripts/test.sh tests/test_wings_mobile.py -v
"""

import pathlib

REPO = pathlib.Path(__file__).parent.parent
STATIC = REPO / "static"
HTML = (STATIC / "index.html").read_text(encoding="utf-8")
WINGS_CSS = (STATIC / "wings.css").read_text(encoding="utf-8")
WINGS_JS = (STATIC / "wings_mobile.js").read_text(encoding="utf-8")
BOOT_JS = (STATIC / "boot.js").read_text(encoding="utf-8")


def test_viewport_opts_into_cover_for_the_installed_shell():
    """Without viewport-fit=cover every env(safe-area-inset-*) resolves to 0."""
    assert "viewport-fit=cover" in HTML
    assert "maximum-scale=1" in HTML and "user-scalable=no" in HTML, (
        "the zoom lock is deliberate (native feel); drop it only with a decision"
    )


def test_ios_splash_images_are_wired_for_iphone_15_pro():
    assert "apple-touch-startup-image" in HTML
    assert "splash-1179x2556.png" in HTML, "iPhone 15 Pro portrait splash missing"
    assert (STATIC / "splash-1179x2556.png").exists(), (
        "referenced splash asset missing — generation: solid #051729 PNG"
    )


def test_safe_area_variables_exist_with_fallback():
    assert "--wings-inset-top:max(env(safe-area-inset-top,0px),var(--wings-safe-top-fallback))" in WINGS_CSS
    assert "--wings-inset-bottom:max(env(safe-area-inset-bottom,0px),var(--wings-safe-bottom-fallback))" in WINGS_CSS
    # The composer must clear the home indicator, on top of the keyboard inset.
    assert "var(--wings-inset-bottom)" in WINGS_CSS
    # Standalone height workaround (WebKit 254868): 100dvh is short by the top inset.
    assert "html,body{height:100vh;}" in WINGS_CSS.replace(" ", "")


def test_safe_area_probe_only_overrides_when_env_fails():
    """The JS fallback must measure env() and stay out of the way when it works."""
    assert "window.wingsSyncSafeArea" in WINGS_JS
    assert "probeInset" in WINGS_JS
    assert "safe-area-inset-top" in WINGS_JS
    assert "safe-area-inset-bottom" in WINGS_JS
    assert "clearFallbacks" in WINGS_JS, "must remove the fallback when env() reports a value"
    assert "isIOSStandalone" in WINGS_JS and "isPortrait" in WINGS_JS, (
        "landscape must not apply the portrait top inset"
    )


def test_mobile_navbar_is_reenabled_only_on_phones():
    # Desktop keeps the upstream hidden state.
    assert ".app-titlebar{display:none!important;}" in HTML
    assert "@media (max-width:640px){ .app-titlebar{display:flex!important;} }" in HTML
    # The trailing spacer must go so menu/title/plus stay symmetric and the
    # title lands on the exact optical centre.
    assert ".app-titlebar-spacer{display:none!important;}" in WINGS_CSS
    assert "#btnTitlebarNewChat{display:flex!important;}" in WINGS_CSS, (
        "style.css hides the new-chat button with an ID-level !important"
    )
    assert "--wings-mnav-h:44px" in WINGS_CSS


def test_touch_targets_are_at_least_44px_on_phones():
    """Measured before the fix: 32px module icons, 34px search, 40px attach/mic."""
    assert "#btnAttach,#btnMic{width:44px;height:44px;min-width:44px;min-height:44px;}" in WINGS_CSS
    assert "[data-mode=\"basic\"] .sidebar-footer-btn svg," in WINGS_CSS
    # rfind: the Relay-port base rule (34px) comes first, the phone override later.
    search = WINGS_CSS.rfind("[data-mode=\"basic\"] .sidebar-footer-search{")
    assert search != -1
    assert "height:44px" in WINGS_CSS[search:search + 200]
    # 16px inputs stop iOS from zooming the page on focus.
    assert "[data-mode=\"basic\"] .sidebar-footer-search-input{font-size:16px;}" in WINGS_CSS


def test_touch_devices_do_not_keep_sticky_hover():
    assert "@media (hover:none){" in WINGS_CSS
    hover_block = WINGS_CSS[WINGS_CSS.find("@media (hover:none){"):]
    assert ":not(.active):active" in hover_block
    assert ":not(.active):hover" in hover_block, (
        "hover must be neutralised on touch, or iOS keeps the row highlighted after a tap"
    )


def test_sidebar_drag_gesture_has_follow_and_close():
    assert "function _canFollowSidebarDrag" in BOOT_JS
    assert "_isPwaStandalone()" in BOOT_JS, "live follow is gated on the installed PWA"
    assert "wings-dragging" in BOOT_JS and ".sidebar.wings-dragging" in WINGS_CSS
    assert "function _isSidebarCloseSwipeTarget" in BOOT_JS
    assert "_WINGS_SIDEBAR_CLOSE_TRIGGER" in BOOT_JS
    # A gesture starting on a control must never begin a close-drag.
    close_fn = BOOT_JS[BOOT_JS.find("function _isSidebarCloseSwipeTarget"):]
    close_fn = close_fn[:close_fn.find("\n}")]
    assert "input,textarea,select,button,a,[contenteditable=\"true\"]" in close_fn


def test_message_long_press_sheet_uses_only_real_actions():
    assert "wingsCloseMessageSheet" in WINGS_JS
    assert ".msg-action-btn" in WINGS_JS, (
        "the sheet must be built from the actions the message actually has"
    )
    assert "msg-actions" in WINGS_JS, "pressing the action bar itself must not open the sheet"
    assert "removeAllRanges" in WINGS_JS, (
        "clear a live text selection so iOS' callout doesn't sit on top of the sheet"
    )
    assert "wings-sheet-scrim" in WINGS_CSS and "wings-sheet-item" in WINGS_CSS
