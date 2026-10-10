"""UI text that bypasses i18n — measured, not guessed (CI ABGLEICH WG-R3, Etappe 2c).

index.html: every title / data-tooltip / aria-label / placeholder needs its
data-i18n-* twin, and every visible text node needs a data-i18n element around
it. Names, data placeholders and samples are listed in ERLAUBT with a reason.

JS: string literals in UI positions (textContent, title, toasts, dialog
options, HTML snippets) are counted per file. The counts are the ratchet in
tests/test_ci_sperrklinke.py: they may only go down.

Run:
    python3 scripts/ci/i18n_fest.py            # counts
    python3 scripts/ci/i18n_fest.py --liste    # every finding
"""

import argparse
import pathlib
import re
import sys
from html.parser import HTMLParser

REPO = pathlib.Path(__file__).resolve().parent.parent.parent
STATIC = REPO / "static"

# index.html texts that stay as they are: (text, reason).
ERLAUBT = {
    "Wings": "Name der App (WG-R4)",
    "default": "Name des Standardprofils, JS setzt das aktive Profil",
    "agent": "Platzhalter für den Modellnamen; Name der Protokolldatei",
    "Token —": "Platzhalter, JS setzt die Zahl",
    "GPT-5.4 Mini": "Modellname", "GPT-4o": "Modellname", "o4-mini": "Modellname",
    "Claude Sonnet 4.6": "Modellname", "Claude Sonnet 4.5": "Modellname",
    "Claude Haiku 3.5": "Modellname", "Gemini 3.1 Pro Preview": "Modellname",
    "Gemini 3 Flash Preview": "Modellname", "DeepSeek V4 Flash": "Modellname",
    "DeepSeek V4 Pro": "Modellname", "DeepSeek V3 (legacy)": "Modellname",
    "Llama 4 Scout": "Modellname",
    "errors": "Name der Protokolldatei", "gateway": "Name der Protokolldatei",
    "Default": "Platzhalter, JS setzt den Namen des Boards",
    "Plugin": "Platzhalter, JS setzt den Namen des Plugins",
    "Aa": "Schriftprobe",
    "WebUI: —": "Platzhalter, JS setzt die Version",
    "Passkeys": "gleiches Wort im Deutschen",
    "http://127.0.0.1:9119": "Beispieladresse",
    "Show workspace panel": "zustandsabhängig, syncWorkspacePanelUI setzt Titel und aria-label",
    "Switch workspace": "Platzhalter, JS setzt Titel und aria-label mit dem Arbeitsbereich",
}

_ATTR = {
    "title": "data-i18n-title",
    "data-tooltip": "data-i18n-title",
    "aria-label": "data-i18n-aria-label",
    "placeholder": "data-i18n-placeholder",
}
_LEER = {"input", "img", "br", "hr", "meta", "link", "source", "area", "col",
         "embed", "wbr", "track", "param", "base"}
_AUSSEN = {"script", "style", "svg", "code", "pre", "template"}


class _Html(HTMLParser):
    def __init__(self):
        super().__init__()
        self.stapel = []  # (tag, aussen, i18n)
        self.funde = []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        aussen = tag in _AUSSEN or any(s[1] for s in self.stapel)
        if not aussen:
            for name, zwilling in _ATTR.items():
                wert = a.get(name)
                if wert and re.search(r"[A-Za-z]{2}", wert) and zwilling not in a:
                    self.funde.append((self.getpos()[0], name, wert))
        if tag not in _LEER:
            self.stapel.append((tag, aussen, "data-i18n" in a))

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in _LEER:
            self.stapel.pop()

    def handle_endtag(self, tag):
        for i in range(len(self.stapel) - 1, -1, -1):
            if self.stapel[i][0] == tag:
                del self.stapel[i:]
                break

    def handle_data(self, data):
        if not re.search(r"[A-Za-z]{2}", data):
            return
        if any(s[1] or s[2] for s in self.stapel):
            return
        self.funde.append((self.getpos()[0], "text", " ".join(data.split())))


def html_funde(text=None):
    """index.html findings not covered by ERLAUBT: [(line, kind, text)]."""
    p = _Html()
    p.feed(text if text is not None else (STATIC / "index.html").read_text(encoding="utf-8"))
    return [f for f in p.funde if f[2] not in ERLAUBT]


_SENKE = re.compile(r"""(?x)
  (?:\.(?:textContent|innerText|title|placeholder|ariaLabel)\s*=\s*
   |setAttribute\(\s*['"](?:title|aria-label|placeholder|data-tooltip)['"]\s*,\s*
   |\b(?:showToast|_showToast|toast)\(\s*
   |\b(?:confirmLabel|cancelLabel|title|message|label|placeholder|tooltip|ariaLabel
       |text|detail|description|hint)\s*:\s*)
  (['"`])((?:\\.|(?!\1).){2,300}?)\1""")
_SCHNIPSEL_TEXT = re.compile(r">([^<>`'\"${}]*[A-Za-z]{3}[^<>`'\"${}]*)<")
_SCHNIPSEL_ATTR = re.compile(
    r"""\b(?:title|aria-label|placeholder|data-tooltip)=["\\]*["']([^"'$<>]*[A-Za-z]{3}[^"'$<>]*)["\\]""")


def _sichtbar(text):
    s = re.sub(r"\$\{[^}]*\}", "", text)
    s = re.sub(r"<[^>]+>", "", s).strip()
    if not re.search(r"[A-Za-z]{3}", s):
        return False
    # ids, classes, keys and paths are not UI text
    return not (re.fullmatch(r"[\w.:/-]+", s) and not re.match(r"[A-Z][a-z]", s))


# JS texts that stay as they are: (file, text) -> reason.
JS_ERLAUBT = {
    ("messages.js", "Context auto-compressed"): "Ereignisdaten wie in api/streaming.py, Tests vergleichen sie",
    ("messages.js", "Compressing context"): "Ereignisdaten wie in api/streaming.py, Tests vergleichen sie",
    ("messages.js", "The browser lost the live SSE connection before the response finished."):
        "Ereignisdaten, Tests vergleichen sie",
    ("commands.js", "Steer"): "Begriff des Agenten, im Deutschen gleich",
    ("sessions.js", "\\]]+|\\/session\\/[^\\s"): "Teil einer Regex",
}


def _tag_vor(src, pos):
    """The opening tag that ends right before pos (text) or contains pos (attribute)."""
    anfang = src.rfind("<", 0, pos)
    ende = src.find(">", pos)
    return src[anfang:ende] if anfang != -1 else ""


def js_funde(datei):
    """Fixed UI text in one JS file not covered by JS_ERLAUBT: [(line, text)]."""
    src = datei.read_text(encoding="utf-8")
    zeilen = src.split("\n")
    zeile = lambda pos: src.count("\n", 0, pos) + 1
    kommentar = lambda pos: zeilen[zeile(pos) - 1].lstrip().startswith(("//", "*", "/*"))
    funde = [(zeile(m.start()), m.group(2)) for m in _SENKE.finditer(src)
             if _sichtbar(m.group(2)) and not kommentar(m.start())]
    for m in _SCHNIPSEL_TEXT.finditer(src):
        t = m.group(1).strip()
        if not _sichtbar(t) or re.search(r"[=;(){}]|&&|\|\|", t) or kommentar(m.start()):
            continue
        if "data-i18n=" in src[src.rfind("<", 0, m.start() + 1):m.start() + 1]:
            continue  # the element carries its key; applyLocaleToDOM sets the text
        funde.append((zeile(m.start()), t))
    for m in _SCHNIPSEL_ATTR.finditer(src):
        attr = m.group(0).split("=")[0]
        zwilling = {"title": "data-i18n-title", "data-tooltip": "data-i18n-title",
                    "aria-label": "data-i18n-aria-label", "placeholder": "data-i18n-placeholder"}[attr]
        if zwilling in _tag_vor(src, m.start()) or kommentar(m.start()):
            continue
        funde.append((zeile(m.start()), m.group(1)))
    return sorted(f for f in set(funde) if (datei.name, f[1]) not in JS_ERLAUBT)


def js_stand():
    """Ratchet counts per JS file (files without findings left out)."""
    stand = {}
    for f in sorted(STATIC.glob("*.js")):
        if f.name == "i18n.js":
            continue
        n = len(js_funde(f))
        if n:
            stand[f.name] = n
    return stand


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--liste", action="store_true", help="jede Fundstelle ausgeben")
    args = ap.parse_args(argv)
    html = html_funde()
    stand = js_stand()
    if args.liste:
        for z, art, t in html:
            print(f"index.html:{z}  {art}  {t}")
        for name in stand:
            for z, t in js_funde(STATIC / name):
                print(f"{name}:{z}  {t}")
    print(f"index.html: {len(html)}")
    for name, n in stand.items():
        print(f"{name}: {n}")
    print(f"JS gesamt: {sum(stand.values())}")


if __name__ == "__main__":
    sys.exit(main())
