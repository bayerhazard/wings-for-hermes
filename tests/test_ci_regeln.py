"""CI rules on Wings' surfaces (CI ABGLEICH WG-R1, WG-B1, WG-T6; Etappe 2b).

The upstream markup stays; wings.css gives its classes the CI's rules in WG-
sections, reading only --am-* (layer model, WG-B1):

- R6: what floats (menus, popovers, toasts, dialogs, the phone sheet) carries
  the one shadow --am-schatten-1; nothing reads the undefined --shadow-lg.
- R1/R7: red only for deleting. Stop, recording, deny and "context full" are
  not red; the delete confirmation is red with the CI's text colour.
- T6: no overshoot, no `transition: all` left unscoped, Wings' own motion on
  the CI durations (two loops of the activity line excepted).

Run:
    ./scripts/test.sh tests/test_ci_regeln.py -v
"""

import pathlib
import re

REPO = pathlib.Path(__file__).parent.parent
STATIC = REPO / "static"
STYLE = (STATIC / "style.css").read_text(encoding="utf-8")
WINGS = (STATIC / "wings.css").read_text(encoding="utf-8")
HTML = (STATIC / "index.html").read_text(encoding="utf-8")


def _abschnitt(kennung: str) -> str:
    start = WINGS.rfind("/* ── ", 0, WINGS.index(f"[{kennung}]"))
    ende = WINGS.find("/* ── ", start + 1)
    return WINGS[start: ende if ende != -1 else len(WINGS)]


def _regel(css: str, selektor: str) -> str:
    """Declarations of the rule whose selector list contains `selektor`."""
    for m in re.finditer(r"([^{}]+)\{([^{}]*)\}", re.sub(r"/\*.*?\*/", "", css, flags=re.S)):
        if selektor in [s.strip() for s in m.group(1).split(",")]:
            return m.group(2)
    raise AssertionError(f"no rule for {selektor}")


SCHWEBEND = [
    ".app-titlebar-title-popover", ".cmd-dropdown", ".composer-reasoning-dropdown",
    ".composer-toolsets-dropdown", ".kanban-board-switcher-menu", ".model-dropdown",
    ".profile-dropdown", ".project-picker", ".session-action-menu", ".skill-picker-dropdown",
    ".toast", ".workspace-prefs-menu", ".ws-dropdown", ".wings-sheet", ".app-dialog",
]


def test_what_floats_carries_the_one_shadow():
    schwebe = _abschnitt("WG-SCHWEBE")
    for sel in SCHWEBEND:
        assert "var(--am-schatten-1)" in _regel(schwebe, sel), sel


def test_no_undefined_shadow_token():
    for name, text in (("style.css", STYLE), ("wings.css", WINGS), ("index.html", HTML)):
        assert "--shadow-lg" not in text, name


def test_red_only_for_deleting():
    knopf = _abschnitt("WG-KNOPF")
    assert "var(--am-handlung-ruhend)" in _regel(knopf, ".send-btn.stop")
    assert "var(--am-gold-500)" in _regel(knopf, ".mic-btn.recording")
    assert "var(--am-rand-betont-farbe)" in _regel(knopf, ".approval-btn.deny")
    assert "var(--am-achtung)" in _regel(knopf, ".ctx-indicator.ctx-high .ctx-compress-btn")
    for sel in (".send-btn.stop", ".mic-btn.recording", ".approval-btn.deny",
                ".ctx-indicator.ctx-high .ctx-compress-btn"):
        assert "fehler" not in _regel(knopf, sel) and "error" not in _regel(knopf, sel), sel
    loeschen = _regel(knopf, ":root.dunkel .app-dialog-btn.confirm.danger")
    assert "background:var(--am-fehler)!important" in loeschen
    assert "color:var(--am-handlung-text)!important" in loeschen, "Blau 900 on the light red in the dark"


def test_text_on_the_action_colour():
    assert "var(--am-handlung-text)" in _regel(_abschnitt("WG-KNOPF"), ".send-btn")


def test_no_overshoot_left_unanswered():
    """Every overshooting curve (a y control point above 1) is overridden."""
    ueber = r"(?:1\.\d*[1-9]|[2-9][\d.]*)"
    kurve = rf"cubic-bezier\(\s*[\d.]+\s*,\s*(?:{ueber}\s*,\s*[\d.]+\s*,\s*[-\d.]+|[-\d.]+\s*,\s*[\d.]+\s*,\s*{ueber})\s*\)"
    css = re.sub(r"/\*.*?\*/", "", STYLE, flags=re.S)
    federnd = [m.group(1).strip() for m in re.finditer(r"([^{}]+)\{([^{}]*)\}", css) if re.search(kurve, m.group(2))]
    assert federnd, "the measurement found the send button's pop-in before Etappe 2b"
    bewegung = _abschnitt("WG-BEWEGUNG")
    for sel in federnd:
        assert "var(--am-kurve)" in _regel(bewegung, sel), f"{sel} overshoots"
    assert not re.search(kurve, WINGS)


def test_transition_all_is_scoped():
    """A new `transition: all` from upstream must be scoped here too."""
    alle = set()
    for m in re.finditer(r"([^{}]+)\{([^{}]*)\}", re.sub(r"/\*.*?\*/", "", STYLE, flags=re.S)):
        if re.search(r"transition\s*:\s*all\b", m.group(2)):
            alle.update(s.strip() for s in m.group(1).split(","))
    bewegung = _abschnitt("WG-BEWEGUNG")
    eingeschraenkt = {s.strip() for m in re.finditer(r"([^{}]+)\{[^{}]*transition-property", bewegung)
                      for s in m.group(1).split(",")}
    # .icon-btn gets an explicit property list from the micro-interactions block.
    assert "transition: transform" in _regel(WINGS, ".icon-btn")
    assert alle - eingeschraenkt - {".icon-btn"} == set()


def test_wings_motion_on_ci_durations():
    eigen = re.sub(r"/\*.*?\*/", "", WINGS[WINGS.index("/* ── Schrift [WG-SCHRIFT]"):], flags=re.S)
    fest = [d for d in re.findall(r"(?:transition|animation)[\w-]*\s*:[^;}]*", eigen)
            if re.search(r"(?<![\w.-])\d*\.?\d+m?s\b", d)]
    # The activity line's two loops are Wings' signature (CI ABGLEICH WG-T6).
    assert sorted(fest) == sorted([
        "animation: wings-aline-pulse 1.6s ease-in-out infinite",
        "animation: wings-aline-shimmer 2.4s linear infinite",
    ])
