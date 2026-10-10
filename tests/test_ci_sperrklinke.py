"""No UI text past i18n (CI ABGLEICH WG-R3; Etappe 2c).

The German UI is complete only if every text goes through i18n. Measured by
scripts/ci/i18n_fest.py, two rules:

- index.html is done (Etappe 2c-1): every title, tooltip, aria-label and
  placeholder has its data-i18n-* twin, every visible text sits in a data-i18n
  element. What stays (names, data placeholders, samples) is listed with a
  reason in i18n_fest.ERLAUBT.
- JS is a ratchet: STAND holds the number of fixed texts per file. It may only
  go down; a file missing from STAND must stay at zero. 2c-2 brought the chat
  (sessions.js, messages.js, commands.js) to zero, 2c-3a ui.js and boot.js,
  2c-3b lowers the rest. What
  stays in JS is listed with a reason in i18n_fest.JS_ERLAUBT.
- Notices that go into the transcript stay English there (server, session
  files and tests share one wording) and are translated when shown:
  wgHinweis() in i18n.js (CI ABGLEICH WG-R3, decision A).

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
    "assistant_turn_anchors.js": 14,
    "login.js": 3,
    "onboarding.js": 45,
    "panels.js": 275,
    "share.js": 12,
    "terminal.js": 2,
    "wings_mobile.js": 1,
    "workspace.js": 14,
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


def test_js_allowed_texts_still_exist():
    for (datei, anfang) in i18n_fest.JS_ERLAUBT:
        src = (STATIC / datei).read_text(encoding="utf-8")
        # multi-line templates are reported with their whitespace collapsed
        assert anfang in src or anfang in " ".join(src.split()), (datei, anfang)


# One real notice per wgHinweis() rule, as Wings or the server writes it.
HINWEISE = [
    "**Error:** No response received after context compression. Please retry.",
    "**Connection interrupted:** The browser lost the live SSE connection before the response finished.",
    "**Connection interrupted:** The browser lost the live SSE connection before the response finished. If the worker completed, reopening this session should restore the settled transcript.",
    "**No response received.** Check your API key and model selection.",
    "**Error:** An error occurred. Check server logs.",
    "**Task cancelled:** Task cancelled.\n\n*The run was cancelled by the user before Wings finished. No provider failure occurred.*",
    "**Rate limit reached:** 429 from provider",
    "**Goal command failed:** boom",
    'No skills matching "git".',
    "No skills found.",
    'Skills matching "git" (1):\n\n- git',
    "Available skills (2):\n\n- a\n- b",
    "No skill named `x`. Use `/skills` to see available skills.",
    "Next turn: skill `x` will be forced.",
    "Agent command runtime unavailable in WebUI.",
    "Agent command error: boom",
    "Plugin command runtime unavailable in WebUI.",
    "Plugin command error: boom",
    "Bundle command error: boom",
    "MoA unavailable: boom",
    "Desktop Companion is unavailable in WebUI.",
    "Desktop Companion command error: boom",
    "`/browser` is a Hermes CLI-only command and cannot run inside the WebUI.",
    "Desktop Companion status is unavailable right now.\n\nReload WebUI or check your connection, then retry /pet.",
    "(no output)",
    "Task cancelled.",
    "Cancellation details",
    "Interruption details",
    "Terminal state details",
    "Provider details",
]

_HINWEIS = r"""
const fs = require('fs'), vm = require('vm');
const ctx = {window: {}, document: {documentElement: {}, addEventListener() {}, querySelectorAll: () => []},
  localStorage: {getItem: () => null, setItem() {}}, navigator: {language: 'en'}, console};
ctx.globalThis = ctx; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(process.argv[1], 'utf8') +
  ';globalThis.__h = wgHinweis; globalThis.__set = (l) => { _locale = LOCALES[l]; };', ctx);
const texte = JSON.parse(process.argv[2]);
const en = texte.map(x => ctx.__h(x));
ctx.__set('de');
console.log(JSON.stringify({en, de: texte.map(x => ctx.__h(x)), antwort: ctx.__h('Hello, this is an answer.')}));
"""


@pytest.mark.skipif(not NODE, reason="node not installed")
def test_notices_in_the_transcript_are_translated_when_shown():
    out = subprocess.run([NODE, "-e", _HINWEIS, str(STATIC / "i18n.js"), json.dumps(HINWEISE)],
                         capture_output=True, text=True, timeout=30)
    assert out.returncode == 0, out.stderr
    r = json.loads(out.stdout)
    assert r["en"] == HINWEISE, "English stays as written"
    unuebersetzt = [h for h, d in zip(HINWEISE, r["de"]) if d == h]
    assert unuebersetzt == []
    assert r["antwort"] == "Hello, this is an answer.", "answers of the model are never touched"


def test_transcript_render_goes_through_wghinweis():
    ui = (STATIC / "ui.js").read_text(encoding="utf-8")
    assert "if(!isUser&&typeof wgHinweis==='function') text=wgHinweis(text);" in ui
    assert "wgHinweis(m.provider_details_label||'Provider details')" in ui


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
