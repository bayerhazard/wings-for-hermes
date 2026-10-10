"""UI text that bypasses i18n — measured, not guessed (CI ABGLEICH WG-R3, Etappe 2c).

index.html: every title / data-tooltip / aria-label / placeholder needs its
data-i18n-* twin, and every visible text node needs a data-i18n element around
it. Names, data placeholders and samples are listed in ERLAUBT with a reason.

JS: string literals in UI positions (textContent, title, toasts, dialog
options, HTML snippets) and every string literal holding an English phrase
are counted per file (comments, console and thrown errors aside). The counts are the ratchet in
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


# Any string literal holding an English phrase: a capitalised word and at
# least one lower-case word after it ("Hide archived", "No saved prompts yet.").
_LITERAL = re.compile(r"""(['"`])((?:\\.|(?!\1)[^\n\\]|\\\n)*?)\1""")
# Fallback text right after a t() call or a helper taking the key first:
#   t('k')||'Text'   (t('k'))||'Text'   ?t('k'):'Text'   _replyT('k', 'Text')
_RUECKFALL = re.compile(
    r"(?:\bt\((?:[^()]|\([^()]*\))*\)\)?\s*(?:\|\||:)\s*"      # t('k')||'Text', ?t('k'):'Text'
    r"|\|\|\s*'[^'\n]*'\)?\s*:\s*"                             # (t('k')||'Text'):'Text'
    r"|\w+\(\s*['\"][a-z][a-z0-9]*_[\w.]*['\"]\s*,\s*)$")       # _helper('some_key', 'Text')
# Text whose key sits right after it: {label:'Text', labelKey:'k'}
_KEY_DANACH = re.compile(r"^\s*,\s*\w*[kK]ey\s*:")
_ATTR_VOR = re.compile(r"\b(?:title|aria-label|placeholder|data-tooltip)=$")
# Multi-line template literals (notices, help texts); snippet text in data-i18n elements is skipped.
_VORLAGE = re.compile(r"`((?:\\.|\$\{(?:[^{}]|\{[^{}]*\})*\}|[^`\\])*)`")
_PHRASE = re.compile(r"\b[A-Z][A-Za-z]+(?: [a-z]+)+")


def _sichtbar(text):
    s = re.sub(r"\$\{[^}]*\}", "", text)
    s = re.sub(r"<[^>]+>", "", s).strip()
    if not re.search(r"[A-Za-z]{3}", s):
        return False
    # ids, classes, keys and paths are not UI text
    return not (re.fullmatch(r"[\w.:/-]+", s) and not re.match(r"[A-Z][a-z]", s))


# JS texts that stay as they are: (file, start of the text) -> reason.
HINWEIS = "Hinweis im Verlauf: bleibt englisch, wgHinweis() übersetzt beim Anzeigen (WG-R3, Entscheidung A)"
AGENT = "Text an den Agenten: bleibt englisch"
EREIGNIS = "Ereignisdaten wie in api/streaming.py, Tests vergleichen sie"
JS_ERLAUBT = {
    ("messages.js", "Context auto-compressed"): EREIGNIS,
    ("messages.js", "Compressing context"): EREIGNIS,
    ("messages.js", "The browser lost the live SSE connection before the response finished."): EREIGNIS,
    ("commands.js", "Steer"): "Begriff des Agenten, im Deutschen gleich",
    ("commands.js", "Desktop Companion app"): "Produktname in den Hinweisen zu /pet",
    ("sessions.js", "\\]]+|\\/session\\/[^\\s"): "Teil einer Regex",
    ("messages.js", "# Hermes session"): "Kopf der Markdown-Datei beim Export",
    ("commands.js", "[USER OVERRIDE]"): AGENT,
    ("commands.js", "[Attached files for this steer:"): AGENT,
    ("messages.js", "${text}\\n\\n[Attached files:"): AGENT,
    ("boot.js", "Hide workspace panel"): "Rückfall von _uiText() mit Schlüssel workspace_panel_*",
    ("boot.js", "Show workspace panel"): "Rückfall von _uiText() mit Schlüssel workspace_panel_*",
    ("ui.js", "Send message"): "Rückfall von _tt('composer_'+action) mit Schlüssel",
    ("ui.js", "Queue message"): "Rückfall von _tt('composer_'+action) mit Schlüssel",
    ("ui.js", "Interrupt and send"): "Rückfall von _tt('composer_'+action) mit Schlüssel",
    ("ui.js", "Steer current response"): "Rückfall von _tt('composer_'+action) mit Schlüssel",
    ("ui.js", "Stop generation"): "Rückfall von _tt('composer_'+action) mit Schlüssel",
    ("ui.js", "{3,})[ \\t]*$/);"): "Code zwischen zwei Backticks einer Regex, kein Text",
    ("ui.js", "/g,' '); // Strip bold/italic"): "Code zwischen zwei Backticks einer Regex, kein Text",
    ("ui.js", "WebUI"): "Name",
    ("ui.js", "Agent"): "Name",
    ("ui.js", "Token —"): "Platzhalter (Wings), ausgeblendet bis JS die Zahl setzt",
    ("ui.js", "Compressing context"): "Datenattribut; die Anzeige kommt aus _autoCompressionBaseDetail()",
    ("ui.js", "**Error:**"): HINWEIS,
    ("ui.js", "Provider details"): HINWEIS,
    # Notices that go into the transcript (S.messages); wgHinweis() has a rule for each.
    ("commands.js", "${DESKTOP_COMPANION_NAME} is "): HINWEIS,
    ("commands.js", "${DESKTOP_COMPANION_NAME} status is"): HINWEIS,
    ("commands.js", "\\n\\nBrowser tools in WebUI"): HINWEIS,
    ("commands.js", "No skills found."): HINWEIS,
    ("commands.js", "No skills matching"): HINWEIS,
    ("commands.js", "Skills matching"): HINWEIS,
    ("commands.js", "Available skills ("): HINWEIS,
    ("commands.js", "No skill named"): HINWEIS,
    ("commands.js", "Next turn: skill"): HINWEIS,
    ("commands.js", "Goal command failed"): HINWEIS,
    ("commands.js", "**Goal command failed:**"): HINWEIS,
    ("messages.js", "Desktop Companion is unavailable in WebUI."): HINWEIS,
    ("messages.js", "Desktop Companion command error:"): HINWEIS,
    ("messages.js", "Agent command runtime unavailable in WebUI."): HINWEIS,
    ("messages.js", "Agent command error:"): HINWEIS,
    ("messages.js", "Plugin command runtime unavailable in WebUI."): HINWEIS,
    ("messages.js", "Plugin command error:"): HINWEIS,
    ("messages.js", "MoA unavailable:"): HINWEIS,
    ("messages.js", "Bundle command error:"): HINWEIS,
    ("messages.js", "**Error:**"): HINWEIS,
    ("messages.js", "**Connection interrupted:**"): HINWEIS,
    ("messages.js", "**No response received.**"): HINWEIS,
    ("messages.js", "**Task cancelled:**"): HINWEIS,
    ("messages.js", "The only assistant text returned for this turn"): HINWEIS,
    ("messages.js", "Task cancelled"): HINWEIS,
    ("messages.js", "Response interrupted"): HINWEIS,
    ("messages.js", "Context compression exhausted"): HINWEIS,
    ("messages.js", "Tool iteration limit reached"): HINWEIS,
    ("messages.js", "Out of credits"): HINWEIS,
    ("messages.js", "Rate limit reached"): HINWEIS,
    ("messages.js", "No response from provider"): HINWEIS,
    ("messages.js", "Cancellation details"): HINWEIS,
    ("messages.js", "Interruption details"): HINWEIS,
    ("messages.js", "Terminal state details"): HINWEIS,
}


def _erlaubt(datei, text):
    """A JS_ERLAUBT key of 10 characters or more allows texts that start with it;
    a shorter one (a name like "Agent") only the exact text."""
    return any(d == datei and (text == anfang or (len(anfang) >= 10 and text.startswith(anfang)))
               for d, anfang in JS_ERLAUBT)


def _tag_vor(src, pos):
    """The opening tag that ends right before pos (text) or contains pos (attribute)."""
    anfang = src.rfind("<", 0, pos)
    ende = src.find(">", pos)
    return src[anfang:ende] if anfang != -1 else ""


def _rueckfall_bereiche(src):
    """Spans of _toolI18n('key', fallback, ...) calls: their texts are the en fallback."""
    bereiche = []
    for m in re.finditer(r"\b_toolI18n\(\s*'[\w.]+'\s*,", src):
        tiefe, i = 1, m.end()
        while i < len(src) and tiefe:
            tiefe += {"(": 1, ")": -1}.get(src[i], 0)
            i += 1
        bereiche.append((m.start(), i))
    return bereiche


def js_funde(datei):
    """Fixed UI text in one JS file not covered by JS_ERLAUBT: [(line, text)]."""
    src = datei.read_text(encoding="utf-8")
    zeilen = src.split("\n")
    zeile = lambda pos: src.count("\n", 0, pos) + 1
    kommentar = lambda pos: zeilen[zeile(pos) - 1].lstrip().startswith(("//", "*", "/*"))
    funde = [(zeile(m.start(2)), m.group(2)) for m in _SENKE.finditer(src)
             if _sichtbar(m.group(2)) and not kommentar(m.start())
             and not _KEY_DANACH.match(src[m.end():m.end() + 40])]
    for m in _SCHNIPSEL_TEXT.finditer(src):
        t = m.group(1).strip()
        if not _sichtbar(t) or re.search(r"[=;(){}\\]|&&|\|\|", t) or kommentar(m.start()):
            continue
        if "data-i18n=" in src[src.rfind("<", 0, m.start() + 1):m.start() + 1]:
            continue  # the element carries its key; applyLocaleToDOM sets the text
        funde.append((zeile(m.start()), t))
    for m in _LITERAL.finditer(src):
        z = zeilen[zeile(m.start()) - 1]
        if kommentar(m.start()) or re.search(r"console\.|throw new|querySelector", z):
            continue
        davor = src[max(0, m.start() - 80):m.start()]
        if (re.search(r"\bt\(\s*$", davor) or _RUECKFALL.search(davor) or _ATTR_VOR.search(davor)
                or _KEY_DANACH.match(src[m.end():m.end() + 40])):
            continue  # a key, the fallback of a t() call, or an attribute the snippet rule judges
        sicht = re.sub(r"<[^>]*>", " ", re.sub(r"\$\{[^}]*\}", "", m.group(2)))
        if _PHRASE.search(sicht) and "data-i18n=" not in m.group(2):
            funde.append((zeile(m.start()), m.group(2)))
    for m in _VORLAGE.finditer(src):
        vor = src[:m.start()].rstrip()[-6:]
        if ("\n" not in m.group(1) or kommentar(m.start())
                or not re.search(r"(?:[=(,:?\[+{]|=>|return)$", vor)):
            continue  # a template starts after an operator; anything else is code between two backticks
        sicht = re.sub(r"\$\{(?:[^{}]|\{[^{}]*\})*\}", "", m.group(1))
        sicht = re.sub(r"<(\w+)[^>]*data-i18n[^>]*>[^<]*</\1>", " ", sicht)
        sicht = re.sub(r"<[^>]*>", " ", sicht)
        if _PHRASE.search(sicht):
            funde.append((zeile(m.start()), " ".join(m.group(1).split())[:200]))
    for m in _SCHNIPSEL_ATTR.finditer(src):
        attr = m.group(0).split("=")[0]
        zwilling = {"title": "data-i18n-title", "data-tooltip": "data-i18n-title",
                    "aria-label": "data-i18n-aria-label", "placeholder": "data-i18n-placeholder"}[attr]
        if zwilling in _tag_vor(src, m.start()) or kommentar(m.start()):
            continue
        funde.append((zeile(m.start()), m.group(1)))
    bereiche = _rueckfall_bereiche(src)
    in_rueckfall = lambda z: any(src.count("\n", 0, a) + 1 <= z <= src.count("\n", 0, b) + 1 for a, b in bereiche)
    return sorted(f for f in set(funde) if not _erlaubt(datei.name, f[1]) and not in_rueckfall(f[0]))


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
