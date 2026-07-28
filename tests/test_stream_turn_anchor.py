"""Stream-turn scroll anchor: when a live assistant turn overflows the visible
area during streaming, the viewport anchors at the turn start instead of
chasing the tail.

Covers the feature introduced in v1.9.0 — "bleibe am anfang der nachricht und
gehe nicht ans ende".
"""
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent
UI_JS = (REPO / "static" / "ui.js").read_text(encoding="utf-8")
MESSAGES_JS = (REPO / "static" / "messages.js").read_text(encoding="utf-8")


@pytest.mark.sprint49
def test_stream_turn_anchored_flag_exists():
    assert "_streamTurnAnchored=false;" in UI_JS
    assert "let _streamTurnAnchored=false;" in UI_JS


@pytest.mark.sprint49
def test_stream_turn_anchored_reset_on_new_stream():
    # _resetStreamScrollFollow must reset the flag so each new stream can
    # anchor independently.
    assert "_streamTurnAnchored=false;" in UI_JS
    reset_block = UI_JS[
        UI_JS.index("function _resetStreamScrollFollow(){"):
        UI_JS.index("}", UI_JS.index("function _resetStreamScrollFollow(){"))
    ]
    assert "_streamTurnAnchored=false" in reset_block


@pytest.mark.sprint49
def test_scroll_anchor_logic_in_scrollIfPinned():
    # scrollIfPinned must check the live turn height against the viewport and
    # anchor at turn start when it overflows.
    fn_start = UI_JS.index("function scrollIfPinned(){")
    # Find the next top-level function declaration (our closing boundary)
    next_fn = UI_JS.index("function scrollToBottom(){", fn_start)
    fn = UI_JS[fn_start:next_fn]
    assert "_streamTurnAnchored" in fn
    assert "liveAssistantTurn" in fn
    assert "turn.offsetHeight>el.clientHeight" in fn
    assert "_scrollPinned=false" in fn
    assert "_messageUserUnpinned=true" in fn
    assert "_streamTurnAnchored=true" in fn


@pytest.mark.sprint49
def test_adaptive_fade_catch_up():
    # When backlog >= 24 words the fade should dump the backlog instantly
    # instead of capping at 2-3 words/frame.
    assert "if(backlogWords>=24)" in MESSAGES_JS
    assert "wordsToReveal=backlogWords;" in MESSAGES_JS
