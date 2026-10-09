"""No UI text past i18n (CI ABGLEICH WG-R3; Etappe 2c).

The German UI is complete only if every text goes through i18n. Measured by
scripts/ci/i18n_fest.py, two rules:

- index.html is done (Etappe 2c-1): every title, tooltip, aria-label and
  placeholder has its data-i18n-* twin, every visible text sits in a data-i18n
  element. What stays (names, data placeholders, samples) is listed with a
  reason in i18n_fest.ERLAUBT.
- JS is a ratchet: STAND holds the number of fixed texts per file. It may only
  go down. 2c-2 and 2c-3 lower it; a new fixed text from an upstream port
  fails here.

Every key index.html names exists in English and German, and every key only
Wings has starts with wg_ (CI ABGLEICH WG-K).

Run:
    ./scripts/test.sh tests/test_ci_sperrklinke.py -v
"""

import json
import pathlib
import re
import shutil
import subprocess
import sys

import pytest

REPO = pathlib.Path(__file__).parent.parent
sys.path.insert(0, str(REPO / "scripts" / "ci"))
import i18n_fest  # noqa: E402

STATIC = REPO / "static"
HTML = (STATIC / "index.html").read_text(encoding="utf-8")
NODE = shutil.which("node")

# Fixed UI texts per JS file. Lower a number when a PR removes texts; never raise it.
STAND = {
    "assistant_turn_anchors.js": 7,
    "boot.js": 16,
    "commands.js": 13,
    "messages.js": 29,
    "onboarding.js": 20,
    "panels.js": 178,
    "sessions.js": 67,
    "share.js": 6,
    "terminal.js": 1,
    "ui.js": 116,
    "wings_mobile.js": 1,
    "workspace.js": 7,
}

_LADEN = r"""
const fs = require('fs'), vm = require('vm');
const ctx = {window: {}, document: {documentElement: {}, addEventListener() {}, querySelectorAll: () => []},
  localStorage: {getItem: () => null, setItem() {}}, navigator: {language: 'en'}, console};
ctx.globalThis = ctx; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(process.argv[1], 'utf8') + ';globalThis.__L = LOCALES;', ctx);
console.log(JSON.stringify({en: Object.keys(ctx.__L.en), de: Object.keys(ctx.__L.de)}));
"""


def test_index_html_has_no_text_past_i18n():
    funde = i18n_fest.html_funde(HTML)
    assert funde == [], "\n".join(f"index.html:{z} {art}: {t}" for z, art, t in funde)


def test_allowed_texts_still_exist():
    """An ERLAUBT entry nobody needs any more is removed, not kept as a loophole."""
    alle = i18n_fest._Html()
    alle.feed(HTML)
    gefunden = {t for _, _, t in alle.funde}
    assert set(i18n_fest.ERLAUBT) - gefunden == set()


def test_js_ratchet():
    stand = i18n_fest.js_stand()
    gestiegen = {f: (STAND.get(f, 0), n) for f, n in stand.items() if n > STAND.get(f, 0)}
    assert gestiegen == {}, (
        f"new fixed UI text (STAND, now): {gestiegen} — connect it with t(); "
        "list it with: python3 scripts/ci/i18n_fest.py --liste"
    )
    gesunken = {f: (n, stand.get(f, 0)) for f, n in STAND.items() if stand.get(f, 0) < n}
    assert gesunken == {}, f"fewer fixed texts (STAND, now): {gesunken} — lower STAND"


@pytest.mark.skipif(not NODE, reason="node not installed")
def test_keys_named_in_index_html_exist():
    out = subprocess.run([NODE, "-e", _LADEN, str(STATIC / "i18n.js")],
                         capture_output=True, text=True, timeout=30)
    assert out.returncode == 0, out.stderr
    keys = json.loads(out.stdout)
    genannt = set(re.findall(r'data-i18n(?:-title|-aria-label|-placeholder)?="([^"]+)"', HTML))
    assert genannt - set(keys["en"]) == set()
    assert genannt - set(keys["de"]) == set()
    wg = {k for k in keys["en"] if k.startswith("wg_")}
    assert wg, "Wings' own keys carry the wg_ prefix"
    assert wg <= set(keys["de"])
