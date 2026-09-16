"""Wings sidebar contract: project folders in the Beacon nav-item language.

Wings-only island (see wings_update.md). These assertions pin the deliberate
port: 14px rows without small caps, a leading 18px lucide icon at stroke 1.75,
a right-aligned session count, the gold active state, single-tap disclosure,
and the two mobile surface colours.

Run:
    ./scripts/test.sh tests/test_wings_sidebar.py -v
"""

import pathlib

REPO = pathlib.Path(__file__).parent.parent
STATIC = REPO / "static"
WINGS_CSS = (STATIC / "wings.css").read_text(encoding="utf-8")
SESSIONS_JS = (STATIC / "sessions.js").read_text(encoding="utf-8")
I18N_JS = (STATIC / "i18n.js").read_text(encoding="utf-8")
HTML = (STATIC / "index.html").read_text(encoding="utf-8")
MANIFEST = (STATIC / "manifest.json").read_text(encoding="utf-8")


def _folder_block():
    """The .session-folder-header base rule from wings.css."""
    start = WINGS_CSS.find("\n.session-folder-header{")
    assert start != -1, ".session-folder-header base rule missing from wings.css"
    end = WINGS_CSS.find("}", start)
    return WINGS_CSS[start:end]


def test_missing_am_tokens_were_added():
    """Beacon's rule is written in --am-* vocabulary; style.css only has raum-4+."""
    for token in ("--am-raum-1:", "--am-raum-2:", "--am-raum-3:"):
        assert token in WINGS_CSS, f"{token} missing — the folder rule needs it"
    # 40px absolute, NOT 2.5rem: Wings' root is 15px, so 2.5rem would be 37.5px
    # and a tap target must not shrink with the reader's font-size choice.
    assert "--am-ziel-zeiger:40px;" in WINGS_CSS
    assert "--am-radius-klein:4px;" in WINGS_CSS


def test_folder_row_adopts_beacon_nav_item_metrics():
    rule = _folder_block()
    assert "font-size:var(--fs-base)" in rule, "same 0.875rem value as Beacon's item"
    assert "font-weight:400" in rule
    assert "text-transform:none" in rule, "the old 11px small-caps look must be gone"
    assert "gap:var(--am-raum-3)" in rule
    assert "min-height:var(--am-ziel-zeiger)" in rule
    assert "border-radius:var(--am-radius-klein)" in rule
    assert "color:var(--muted)" in rule
    assert "cursor:pointer" in rule, "the row is now operable"


def test_folder_icon_and_count_are_part_of_the_row():
    assert ".session-folder-header svg{width:18px;height:18px;stroke-width:1.75;flex-shrink:0;}" in WINGS_CSS
    assert ".session-folder-header .session-folder-count{" in WINGS_CSS
    assert "font-family:var(--font-mono)" in WINGS_CSS, "numbers read in mono, like Beacon"
    assert "margin-left:auto" in WINGS_CSS
    assert ".session-folder-header.folder-aktiv{color:var(--accent-text);font-weight:600;}" in WINGS_CSS


def test_folder_row_is_44px_on_touch():
    idx = WINGS_CSS.find("@media (hover:none){")
    assert idx != -1
    assert "min-height:44px" in WINGS_CSS[idx:idx + 400], (
        "44px touch target without exception"
    )


def test_renderer_emits_icon_count_and_active_state():
    start = SESSIONS_JS.find("const _renderFolderHeader=")
    assert start != -1
    end = SESSIONS_JS.find("if(folderGrouping){", start)
    body = SESSIONS_JS[start:end]
    assert "li(isUnassigned?'archive':'folder',18,1.75)" in body
    assert "session-folder-count" in body
    assert "group.sessions.length" in body, "the count must come from the folder's sessions"
    assert "count>0" in body, "an empty folder must not claim a count"
    assert "folder-aktiv" in body
    assert "activeSidForSidebar" in body, "the active folder is derived from the open session"
    assert "aria-expanded" in body
    # Group is threaded through so the header can count and mark itself.
    assert "_renderFolderHeader(group.key, group)" in SESSIONS_JS


def test_disclosure_is_a_single_tap():
    """iOS never synthesizes dblclick on touch, so folders could not be opened."""
    start = SESSIONS_JS.find("const _renderFolderHeader=")
    body = SESSIONS_JS[start:SESSIONS_JS.find("if(folderGrouping){", start)]
    assert "ondblclick" not in body, (
        "dblclick must be gone: a double click would toggle 2x click + 1x dblclick"
    )
    assert "pointerdown" in body and "pointerup" in body, (
        "pointerup rather than click: the header is draggable and browsers "
        "suppress click on draggable elements"
    )
    assert ">8" in body, "movement beyond 8px is a drag/scroll, not a tap"
    assert "keydown" in body, "keyboard users need Enter/Space"


def test_unassigned_folder_label_is_translated():
    assert "session_folder_unassigned" in SESSIONS_JS
    assert "session_folder_unassigned: 'Unassigned'" in I18N_JS
    assert "session_folder_unassigned: 'Nicht zugewiesen'" in I18N_JS


def test_mobile_surfaces_use_the_sidebar_tone():
    """Nav bar and input field carry --sidebar on phones, the band stays chat-bg."""
    idx = WINGS_CSS.find("background:var(--sidebar);border-bottom:1px solid var(--border);")
    assert idx != -1, "mobile nav bar must take the sidebar tone"
    # :root prefix is required: `:root.dark .composer-box` weighs (0,3,0).
    assert ":root[data-mode=\"basic\"] .composer-box{background:var(--sidebar);}" in WINGS_CSS
    assert 'content="#f4f7fa"' in HTML and 'content="#0a2238"' in HTML
    assert '"theme_color": "#0a2238"' in MANIFEST
    # The launch background stays the canvas tone so the splash flows into the chat.
    assert '"background_color": "#051729"' in MANIFEST
