#!/usr/bin/env python3
"""Texts the server sends to the UI, and whether Wings translates them (CI ABGLEICH WG-R3, 2c-5).

The server stays English: upstream ports and tests share its wording. Wings
translates a known server text when it shows it (wgServer() in static/i18n.js,
decision B). This script lists every fixed English text in api/*.py that goes
out as an error or a message:

- bad(handler, "…") and _bad(handler, "…")
- a dict entry "error" / "message" / "detail" / "reason" / "toggle_reason" /
  "hint" / "warning": "…"

f-strings become templates: each {expression} is a placeholder {0}, {1} …
A text counts as translated when a wg_srv_… key in LOCALES.en carries exactly
that template. What stays English is listed with a reason in ERLAUBT.

    python3 scripts/ci/server_texte.py           # count
    python3 scripts/ci/server_texte.py --liste   # every untranslated text
"""
import argparse
import ast
import json
import pathlib
import re
import shutil
import subprocess
import sys

REPO = pathlib.Path(__file__).resolve().parent.parent.parent
API = REPO / "api"
I18N = REPO / "static" / "i18n.js"

_SCHLUESSEL = {"error", "message", "detail", "reason", "toggle_reason", "hint", "warning"}
_PROSA = re.compile(r"[a-z]{3} [a-z]")

# Server texts that stay English: text -> reason.
ERLAUBT = {
    "Use /api/onboarding/oauth/poll with flow_id": "Hinweis an Entwickler der API, die Oberfläche ruft richtig auf",
    "POST required for /api/tts": "Hinweis an Entwickler der API, die Oberfläche ruft richtig auf",
    "POST required for /api/tts/stream": "Hinweis an Entwickler der API, die Oberfläche ruft richtig auf",
    "Provider parameter is required.  Use ?provider=openrouter": "Hinweis an Entwickler der API, die Oberfläche ruft richtig auf",
    "Use skills_list to see all available skills": "Hinweis an den Agenten (Werkzeugergebnis), nicht an Menschen",
    "Request body must be a JSON object": "Hinweis an Entwickler der API, die Oberfläche ruft richtig auf",
    "Use /api/file/office-save for Office documents": "Hinweis an Entwickler der API, die Oberfläche ruft richtig auf",
}


def _vorlage(knoten):
    """The text of a str constant, or an f-string with {n} placeholders; None otherwise."""
    if isinstance(knoten, ast.Constant) and isinstance(knoten.value, str):
        return knoten.value
    if isinstance(knoten, ast.JoinedStr):
        teile, n = [], 0
        for wert in knoten.values:
            if isinstance(wert, ast.Constant):
                teile.append(str(wert.value))
            else:
                teile.append("{%d}" % n)
                n += 1
        return "".join(teile)
    return None


def texte():
    """{template: [file:line, …]} for every server text bound for the UI."""
    funde = {}
    for datei in sorted(API.glob("*.py")):
        baum = ast.parse(datei.read_text(encoding="utf-8"), filename=str(datei))
        for knoten in ast.walk(baum):
            kandidaten = []
            if (isinstance(knoten, ast.Call) and isinstance(knoten.func, ast.Name)
                    and knoten.func.id in ("bad", "_bad") and len(knoten.args) >= 2):
                kandidaten.append(knoten.args[1])
            if isinstance(knoten, ast.Dict):
                for k, v in zip(knoten.keys, knoten.values):
                    if isinstance(k, ast.Constant) and k.value in _SCHLUESSEL:
                        kandidaten.append(v)
            for k in kandidaten:
                text = _vorlage(k)
                if not text or not re.match(r"[A-Z`'\"(]", text) or not _PROSA.search(text):
                    continue
                funde.setdefault(text, []).append(f"{datei.relative_to(REPO)}:{k.lineno}")
    return funde


_EN = r"""
const fs = require('fs'), vm = require('vm');
const c = {window: {}, document: {documentElement: {}, addEventListener() {}, querySelectorAll: () => []},
  localStorage: {getItem: () => null, setItem() {}}, navigator: {language: 'en'}, console};
c.globalThis = c; vm.createContext(c);
vm.runInContext(fs.readFileSync(process.argv[1], 'utf8') + ';globalThis.__L = LOCALES;', c);
const en = c.__L.en, de = c.__L.de, aus = {};
for (const k of Object.keys(en)) if (k.startsWith('wg_srv_')) aus[k] = [en[k], de[k]];
console.log(JSON.stringify(aus));
"""


def schluessel():
    """{key: [en, de]} for every wg_srv_ key."""
    out = subprocess.run([shutil.which("node"), "-e", _EN, str(I18N)],
                         capture_output=True, text=True, check=True, timeout=30)
    return json.loads(out.stdout)


def offen():
    """Server texts with neither a wg_srv_ key nor a reason: [(template, places)]."""
    bekannt = {en for en, _ in schluessel().values()}
    return [(t, w) for t, w in texte().items() if t not in bekannt and t not in ERLAUBT]


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--liste", action="store_true", help="jeden offenen Text ausgeben")
    args = ap.parse_args(argv)
    alle = texte()
    rest = offen()
    if args.liste:
        for t, w in rest:
            print(f"{w[0]}  {t}")
    print(f"Servertexte: {len(alle)} ({sum(len(w) for w in alle.values())} Stellen), offen: {len(rest)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
