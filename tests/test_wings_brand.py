"""Wings brand lockup in the chat empty state (Wings-only, 26.9.5).

The empty state shows the Wings shield mark with the wordmark next to it (below
it on phones). The wordmark size is derived from the mark's own geometry rather
than eyeballed, so these assertions pin the derivation and the assets it needs.

Run:
    ./scripts/test.sh tests/test_wings_brand.py -v
"""

import pathlib
import re

REPO = pathlib.Path(__file__).parent.parent
STATIC = REPO / "static"
HTML = (STATIC / "index.html").read_text(encoding="utf-8")
I18N_JS = (STATIC / "i18n.js").read_text(encoding="utf-8")
MARK = (STATIC / "wings-shield.svg").read_text(encoding="utf-8")


def test_mark_asset_carries_gold_shield_and_white_letters():
    assert 'viewBox="0 0 150 150"' in MARK
    assert 'fill="#CAA960"' in MARK, "the shield is the brand gold"
    assert MARK.count('fill="white"') == 2, "the A and the I are white on the gold"


def test_wordmark_size_is_derived_from_the_letters_not_guessed():
    """AI cap = 59.599 / 150 units (39.73 %); Geist cap = 0.71 em."""
    letters = re.findall(r'<path d="M?[\d.]+\s+100\.524[^"]*"', MARK)
    assert letters, "the AI letter paths (baseline y=100.524) are missing from the mark"
    # The derivation is recorded in the asset and applied in the lockup rule.
    assert "59.599" in MARK and "0.71" in MARK
    assert "--wings-mark-size:80px" in HTML
    assert "font-size:calc(var(--wings-mark-size) * .56)!important" in HTML, (
        "0.3973 / 0.71 = 0.56 — changing the mark size must move the word with it"
    )
    # Weight is light on purpose: the mark carries the weight, the word stays calm
    # next to it (600 read too heavy at 45px).
    assert "font-weight:300!important" in HTML


def test_lockup_uses_one_theme_independent_mark():
    """The letters are white ON gold, so a single asset works in both themes."""
    assert 'class="wings-mark"' in HTML
    assert 'src="static/wings-shield.svg"' in HTML
    assert "empty-logo-light" not in HTML and "empty-logo-dark" not in HTML, (
        "the old light/dark wordmark pair is replaced by one mark"
    )
    assert 'alt=""' in HTML.split('class="wings-mark"')[1][:80], (
        "decorative: the <h2> right beside it already says the name"
    )


def test_lockup_stacks_and_centres_on_phones():
    block = HTML[HTML.find(".wings-lockup{"):HTML.find(".empty-state{gap:4px!important;}")]
    assert "flex-direction:column" in block
    assert "@media (max-width:640px)" in block


def test_wordmark_is_just_the_brand_name_in_both_locales():
    assert I18N_JS.count("    empty_title: 'Wings',") == 2, (
        "en and de both read 'Wings' — it is a brand name, not a sentence"
    )
    assert "empty_title: 'Wings for Hermes'" not in I18N_JS
