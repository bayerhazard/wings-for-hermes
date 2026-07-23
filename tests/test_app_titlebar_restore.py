from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
INDEX_HTML = (ROOT / "static" / "index.html").read_text(encoding="utf-8")
STYLE_CSS = (ROOT / "static" / "style.css").read_text(encoding="utf-8")
PANELS_JS = (ROOT / "static" / "panels.js").read_text(encoding="utf-8")
UI_JS = (ROOT / "static" / "ui.js").read_text(encoding="utf-8")


def test_app_titlebar_no_longer_contains_tps_chip():
    assert 'id="tpsStat"' not in INDEX_HTML


def test_app_titlebar_returns_to_centered_desktop_layout():
    # Titlebar is hidden (display:none!important) — the top bar was removed
    # and the status pill was moved to the sidebar panel header.
    assert ".app-titlebar{display:none!important;" in STYLE_CSS


def test_app_titlebar_subtitle_shows_message_count_again():
    assert "subText = String(vis.length);" in PANELS_JS


def test_queue_updates_do_not_hijack_app_titlebar_subtitle():
    assert "_syncQueueTitlebar" not in UI_JS
