"""Wings on the AImighty CI tokens (CI ABGLEICH WG-T1, WG-T2, WG-T3; Etappe 1).

- WG-T1: the token block at the top of static/wings.css is tokens/app.css of
  the CI, unchanged. Until Wings holds a CI copy (Etappe 5) the block is pinned
  by its checksum and stand; a new stand changes both here, never the block alone.
- WG-T2: the upstream names (--accent, --text, ...) get their values from
  --am-* in one bridge block in style.css. It holds no fixed colour, it never
  grows, and Wings' own CSS never reads it — new rules read --am-* directly.
- WG-T3: the CI switches dark on `dunkel`, the upstream on `dark`. Every place
  that sets the theme sets both, so they can never disagree.

Run:
    ./scripts/test.sh tests/test_ci_token.py -v
"""

import hashlib
import json
import pathlib
import re
import shutil
import subprocess

import pytest

REPO = pathlib.Path(__file__).parent.parent
STATIC = REPO / "static"
STYLE = (STATIC / "style.css").read_text(encoding="utf-8")
WINGS = (STATIC / "wings.css").read_text(encoding="utf-8")
NODE = shutil.which("node")

# tokens/app.css of the CI from ":root {" to its end, stand ci-26.10.17.
STAND = "ci-26.10.17"
TOKEN_SHA256 = "2d6cf5f78b368b8d526c80956ff79adae2862c9c72dc62bae2efe037540c0ef3"

# The bridge as it was laid (09.10.2026). It may shrink, never grow.
BRUECKE = {
    "--accent", "--accent-bg", "--accent-bg-strong", "--accent-hover", "--accent-text", "--bg",
    "--blue", "--border", "--border-muted", "--border-subtle", "--border2", "--chat-bg",
    "--code-bg", "--code-inline-bg", "--code-text", "--dur", "--dur-fast", "--dur-slow",
    "--ease", "--em", "--error", "--focus-ring", "--font-mono", "--font-ui", "--gold",
    "--gold-text", "--hover-bg", "--info", "--input-bg", "--muted", "--pre-text",
    "--radius-card", "--radius-composer", "--radius-lg", "--radius-md", "--radius-pill",
    "--radius-sm", "--sidebar", "--space-1", "--space-2", "--space-3", "--space-4",
    "--space-5", "--space-6", "--space-7", "--space-8", "--strong", "--success", "--surface",
    "--surface-subtle", "--text", "--topbar-bg", "--warning",
}

FARBE = re.compile(r"#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|color-mix)\(")


def _token_block() -> str:
    start = WINGS.index(":root {")
    end = WINGS.index("\n", WINGS.index('html[data-dichte="kompakt"]')) + 1
    return WINGS[start:end]


def _bruecke() -> dict[str, str]:
    teil = STYLE[STYLE.index("[WG-BRUECKE]"):]
    block = teil[teil.index(":root {") + len(":root {"):teil.index("\n  }")]
    block = re.sub(r"/\*.*?\*/", "", block, flags=re.S)
    return {n: v.strip() for n, v in re.findall(r"(--[\w-]+)\s*:\s*([^;]+);", block)}


def _wings_eigenes() -> str:
    """wings.css without its header and the verbatim CI block, comments removed."""
    rest = WINGS[WINGS.index("/* ── Schrift [WG-SCHRIFT]"):]
    return re.sub(r"/\*.*?\*/", "", rest, flags=re.S)


# ── WG-T1 ────────────────────────────────────────────────────────────────

def test_token_block_is_the_ci_stand():
    assert f"Stand {STAND}" in WINGS[: WINGS.index(":root {")]
    assert hashlib.sha256(_token_block().encode()).hexdigest() == TOKEN_SHA256, (
        "the [AM-TOKEN] block differs from tokens/app.css — change it in the CI, then copy"
    )


def test_root_stays_at_16px_for_the_rem_based_tokens():
    assert "font-family:var(--font-ui);font-size:16px;" in STYLE
    assert not re.search(r':root\[data-font-size="[a-z]+"\]\s*\{\s*font-size:', STYLE)


# ── WG-T2 ────────────────────────────────────────────────────────────────

def test_bridge_reads_only_ci_tokens():
    bruecke = _bruecke()
    farbig = {n: v for n, v in bruecke.items() if FARBE.search(v)}
    assert farbig == {}, "the bridge holds no fixed colour, only var(--am-*)"
    verweise = {n for n, v in bruecke.items() if v.startswith("var(--am-")}
    assert verweise, "the bridge block is missing"
    for name in verweise:
        assert re.fullmatch(r"var\(--am-[a-z0-9-]+\)", bruecke[name]), f"{name}: {bruecke[name]}"


def test_bridge_never_grows():
    verweise = {n for n, v in _bruecke().items() if v.startswith("var(--am-")}
    assert verweise <= BRUECKE, f"new bridge names: {sorted(verweise - BRUECKE)} — read --am-* instead"


def test_bridge_names_get_no_second_value():
    """Dark comes from html.dunkel in the token block, not from a second table:
    outside the bridge no bridge name is given a fixed colour — not in a
    :root.dark block, not in a scope, not in any stylesheet or page."""
    bruecke_start = STYLE.index("[WG-BRUECKE]")
    bruecke_ende = STYLE.index("\n  }", bruecke_start)
    quellen = {"style.css": STYLE[:bruecke_start] + STYLE[bruecke_ende:], "wings.css": WINGS}
    for p in sorted(STATIC.glob("*.html")):
        quellen[p.name] = p.read_text(encoding="utf-8")
    zweite = []
    for name, css in quellen.items():
        css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
        for n, wert in re.findall(r"(?<![\w-])(--[\w-]+)\s*:\s*([^;}{]+)", css):
            if n in BRUECKE and FARBE.search(wert) and "var(--" not in wert:
                zweite.append(f"{name}: {n}: {wert.strip()}")
    assert zweite == []


def test_wings_css_reads_no_bridge_name():
    eigen = _wings_eigenes()
    gelesen = set(re.findall(r"var\((--[\w-]+)", eigen))
    assert gelesen & BRUECKE == set(), f"wings.css reads bridge names: {sorted(gelesen & BRUECKE)}"
    assert not re.search(r"--(?:b-\d+|gold-hell|gold-tief|active-wash|unread-wash)\b", eigen), (
        "the old Relay ramp is gone — read --am-*"
    )


def test_wings_css_has_no_fixed_colour():
    # #000 inside a mask gradient is alpha, not a colour.
    ohne_maske = re.sub(r"mask-image:[^;]*;", "", _wings_eigenes())
    assert FARBE.findall(ohne_maske) == []


# ── WG-T3 ────────────────────────────────────────────────────────────────

_FAKE_DOM = r"""
const klassen = new Set();
const store = {};
globalThis.localStorage = {getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; }};
globalThis.document = {documentElement: {classList: {
  add: (...c) => c.forEach(x => klassen.add(x)),
  remove: (...c) => c.forEach(x => klassen.delete(x)),
  toggle: (c, an) => { if (an) klassen.add(c); else klassen.delete(c); },
  contains: c => klassen.has(c)}, dataset: {}}, getElementById: () => null};
"""


def _run(js: str) -> list[str]:
    out = subprocess.run([NODE, "-e", js], capture_output=True, text=True, timeout=20)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout)


def _boot_script(html: str) -> str:
    for script in re.findall(r"<script>(.*?)</script>", html, re.S):
        if "classList.add(" in script and "dark" in script and "localStorage" in script:
            return script
    raise AssertionError("theme boot script not found")


@pytest.mark.skipif(not NODE, reason="node not installed")
@pytest.mark.parametrize("seite", ["index.html", "share.html"])
@pytest.mark.parametrize("thema,system_dunkel,erwartet", [
    ("dark", False, ["dark", "dunkel"]),
    ("light", True, []),
    ("system", True, ["dark", "dunkel"]),
    ("system", False, []),
    (None, False, ["dark", "dunkel"]),  # no choice yet: the boot default is dark
])
def test_boot_scripts_set_dark_and_dunkel_together(seite, thema, system_dunkel, erwartet):
    script = _boot_script((STATIC / seite).read_text(encoding="utf-8"))
    vorher = "" if thema is None else (
        f"store['wings-theme']={json.dumps(thema)};store['hermes-theme']={json.dumps(thema)};"
    )
    js = _FAKE_DOM + vorher + (
        f"globalThis.window={{matchMedia:()=>({{matches:{json.dumps(system_dunkel)}}})}};"
        + script
        + ";console.log(JSON.stringify([...klassen].filter(k=>k==='dark'||k==='dunkel').sort()));"
    )
    assert _run(js) == erwartet


@pytest.mark.skipif(not NODE, reason="node not installed")
def test_boot_script_error_path_sets_both():
    script = _boot_script((STATIC / "index.html").read_text(encoding="utf-8"))
    js = _FAKE_DOM + (
        "globalThis.localStorage={getItem(){throw new Error('blocked')}};"
        + script
        + ";console.log(JSON.stringify([...klassen].sort()));"
    )
    assert _run(js) == ["dark", "dunkel"]


@pytest.mark.skipif(not NODE, reason="node not installed")
def test_runtime_theme_switch_keeps_both_classes_equal():
    boot = (STATIC / "boot.js").read_text(encoding="utf-8")
    m = re.search(r"function _effectiveThemeDark\(.*?\n\}\n", boot, re.S)
    n = re.search(r"function _setResolvedTheme\(isDark\)\{.*?\n\}\n", boot, re.S)
    assert m and n, "_setResolvedTheme not found in boot.js"
    js = _FAKE_DOM + (
        "let _resolvedThemeBaseDark=false;function _syncThemeColorMeta(){}\n"
        + m.group(0) + n.group(0)
        + "const r=[];for (const d of [true,false,true]) {_setResolvedTheme(d);"
        + "r.push([document.documentElement.classList.contains('dark'),document.documentElement.classList.contains('dunkel')]);}"
        + "console.log(JSON.stringify(r));"
    )
    assert _run(js) == [[True, True], [False, False], [True, True]]
