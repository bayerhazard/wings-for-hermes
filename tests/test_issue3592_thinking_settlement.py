"""#3592 / #3401 -- Thinking-only messages render as individual Thinking Cards.

Provider reasoning is not inline assistant prose and not a Tool Card. It is
preserved as an independent Thinking Card inserted directly after the anchor
segment (no folded Worklog group).
"""
from __future__ import annotations

import re
from pathlib import Path

UI_JS = (Path(__file__).resolve().parent.parent / "static" / "ui.js").read_text(encoding="utf-8")


def test_thinking_card_html_function_exists():
    """_thinkingCardHtml must be defined so Thinking Cards can render."""
    assert "function _thinkingCardHtml(" in UI_JS, (
        "_thinkingCardHtml function must exist in ui.js"
    )


def test_settlement_loop_does_not_inline_thinking_only_messages():
    """Thinking-only messages should not use the old inline early-continue path."""
    assert "!cards.length&&assistantThinking.has(aIdx)" not in UI_JS, (
        "Thinking-only messages must not use the old inline early-continue path"
    )
    assert "_thinkingActivityNode(thinkingText,false)" in UI_JS, (
        "settled reasoning should render as a collapsed Thinking Card via _thinkingActivityNode"
    )


def test_worklog_thinking_card_is_not_a_tool_card():
    """Thinking Cards should not be Tool Card rows."""
    thinking_fn = UI_JS.split("function _thinkingActivityNode", 1)[1].split("function", 1)[0]
    assert "data-worklog-thinking-card" in thinking_fn
    assert "tool-card-row" not in thinking_fn
    assert "buildToolCard" not in thinking_fn


def test_thinking_card_inserted_directly_after_anchor():
    """Thinking must be inserted directly after the anchor segment (not via Worklog group)."""
    assert "anchorParent.insertBefore(_thinkingActivityNode(thinkingText,false), refNode)" in UI_JS, (
        "settled reasoning should be inserted directly after the anchor segment"
    )


def test_show_thinking_preference_respected():
    """The simplified render path must respect _showThinking for visible cards."""
    render_match = re.search(r"if\(thinkingText&&window\._showThinking!==false\)\{(.*?)\n\s*\}", UI_JS, re.DOTALL)
    assert render_match, "thinking render branch not found"
    assert "assistantThinking.set(rawIdx, thinkingText)" in render_match.group(1)


def test_tool_calls_rendered_as_individual_cards():
    """Tool calls must be rendered as individual buildToolCard elements."""
    assert "buildToolCard(tc)" in UI_JS, (
        "buildToolCard must still exist"
    )


def test_duration_lives_in_msg_foot():
    """Duration must live in msg-foot since there is no folded Worklog group."""
    assert "const compactWorklogForMessage=false;" in UI_JS, (
        "compactWorklogForMessage must be false so duration renders in msg-foot"
    )
    assert "_formatTurnDuration(msg._turnDuration)" in UI_JS, (
        "turn duration formatting must still be present"
    )
