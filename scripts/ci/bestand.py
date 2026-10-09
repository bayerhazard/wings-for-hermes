#!/usr/bin/env python3
"""Measure what Wings carries in colours, type, icons and building blocks.

Stage 0 of hooking Wings up to the AImighty CI (ska1walker/aimighty-ci):
every number in docs/ci/BESTAND.md comes from this script, never by hand.

    python3 scripts/ci/bestand.py                         # report to stdout
    python3 scripts/ci/bestand.py --md docs/ci/BESTAND.md # write the report
    python3 scripts/ci/bestand.py --json                  # raw numbers

Optional comparisons:

    --ci <dir>        a clone of aimighty-ci with a stand ci-YY.M.n checked
                      out (never main), or a CI copy with stand.json — how
                      many Wings colours are CI values, and the CI's own
                      tools (app-abgleich.py, bauteile.py) against Wings
    --upstream <git>  a clone of nesquena/hermes-webui — how far static/ is
                      from the fork base, and how much upstream moved there
    --basis <rev>     fork base in upstream (default 001d7985, UPSTREAM_SYNC.md)
    --anker <rev>     last sync anchor in upstream (default 3b9c632a, round 3)

Standard library only. Reads, never writes outside --md.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from collections import Counter
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
STATIC = REPO / "static"
TESTS = REPO / "tests"

BASIS = "001d7985"
ANKER = "3b9c632a"

# What Wings ships to the browser and wrote itself (vendor/ is third party).
CSS = sorted(STATIC.glob("*.css"))
JS = sorted(STATIC.glob("*.js"))
HTML = sorted(STATIC.glob("*.html"))
QUELLEN = CSS + JS + HTML

HEX = re.compile(r"(?<![\w&])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b")
FUNK = re.compile(r"\b(?:rgba?|hsla?|oklch|oklab|color-mix)\([^()]*(?:\([^()]*\)[^()]*)*\)")
DEF = re.compile(r"(?<![\w-])(--[a-zA-Z0-9_-]+)\s*:")
VAR = re.compile(r"var\(\s*(--[a-zA-Z0-9_-]+)")
FONT_FACE = re.compile(r"@font-face\s*\{[^}]*font-family\s*:\s*['\"]?([^;'\"]+)", re.S)
FONT_FAMILY = re.compile(r"font-family\s*:\s*([^;}{]+)")
FONT_SIZE = re.compile(r"font-size\s*:\s*([0-9.]+(?:px|rem|em|%))")
FONT_WEIGHT = re.compile(r"font-weight\s*:\s*([0-9]{3}|bold|normal|lighter|bolder)")
RADIUS = re.compile(r"border-radius\s*:\s*([^;}{!]+)")
SHADOW = re.compile(r"box-shadow\s*:\s*([^;}{!]+)")
ZINDEX = re.compile(r"z-index\s*:\s*(-?[0-9]+)")
DAUER = re.compile(r"(?<![\w.-])([0-9.]+m?s)\b")
KOPF = re.compile(r"^\s*/\* ── ", re.M)
KENNUNG = re.compile(r"\[((?:AM|HB|RK|IN|RL|[A-Z]{2})-[A-Z]+)\]")
KLASSE = re.compile(r"\.(-?[_a-zA-Z][_a-zA-Z0-9-]*)")
LI_KEY = re.compile(r"^\s*'([a-z0-9-]+)'\s*:", re.M)
LI_CALL = re.compile(r"\bli\(\s*['\"]([a-z0-9-]+)['\"]")
SVG = re.compile(r"<svg\b")
# Pictographs and dingbats standing in for icons, after Relay's symbole.test.ts:
# arrows, technical signs, enclosed and dingbats, supplemental arrows,
# misc symbols and arrows, emoji.
PICTO = re.compile("[←-⇿⌀-⏿①-➿⤀-⥿⬀-⯿\U0001F300-\U0001FAFF]")

# Building block families as the CI names them (bauteile/), matched by the
# words upstream and Wings use in class names.
FAMILIEN = {
    "Knopf (AM-KNOPF)": r"btn|button",
    "Feld (AM-FELD)": r"input|field|textarea|select",
    "Schalter/Haken (AM-HAKEN)": r"toggle|switch|checkbox|check",
    "Dialog (HB-DIALOG)": r"modal|dialog|overlay",
    "Menü (HB-KNOPFMENUE)": r"menu|dropdown|popover",
    "Hinweis/Zustand (HB-ZUSTAND)": r"toast|banner|alert|notice|error|warning",
    "Karte (AM-KARTE)": r"card",
    "Pille (HB-PILLE)": r"chip|pill|badge|tag",
    "Leer (AM-LEER)": r"empty",
    "Suche (HB-SUCHE)": r"search",
    "Tabelle (HB-TABELLE)": r"table",
    "Navigation/Hülle (AM-HUELLE)": r"sidebar|rail|nav|topbar|header|panel",
}


def lies(p: Path) -> str:
    return p.read_text(encoding="utf-8", errors="replace")


def rel(p: Path) -> str:
    return p.relative_to(REPO).as_posix()


def ohne_kommentare(css: str) -> str:
    return re.sub(r"/\*.*?\*/", "", css, flags=re.S)


def code(p: Path) -> str:
    """A file without its comments: issue numbers like (#1488) in a comment
    are no colours. For JS and HTML also // line comments and <!-- -->; the
    lookbehind keeps https:// and quoted '//'."""
    t = ohne_kommentare(lies(p))
    if p.suffix in (".js", ".html"):
        t = re.sub(r"<!--.*?-->", "", t, flags=re.S)
        t = re.sub(r"(^|[^:'\"`\\])//[^\n]*", r"\1", t)
    return t


def hex_werte(t: str) -> list[str]:
    # Four decimal digits are an issue reference ("#1488"), not a colour.
    return [hex_norm(h) for h in HEX.findall(t) if not re.fullmatch(r"#\d{4}", h)]


def hex_norm(h: str) -> str:
    h = h.lower().lstrip("#")
    if len(h) in (3, 4):
        h = "".join(c * 2 for c in h)
    if len(h) == 8 and h.endswith("ff"):
        h = h[:6]
    return "#" + h


def farben() -> dict:
    je_datei, alle_hex, funk = {}, Counter(), Counter()
    for p in QUELLEN:
        t = code(p)
        h = hex_werte(t)
        f = FUNK.findall(t)
        alle_hex.update(h)
        funk.update(re.sub(r"\s+", "", x.lower()) for x in f)
        if h or f:
            je_datei[rel(p)] = {"hex": len(h), "funktion": len(f)}
    defs, nutz = Counter(), Counter()
    for p in QUELLEN:
        t = lies(p)
        defs.update(DEF.findall(code(p)))
        nutz.update(VAR.findall(code(p)))
    # Colour literals outside custom property definitions: the ones a token
    # would have to replace.
    direkt = Counter()
    for p in CSS:
        for zeile in ohne_kommentare(lies(p)).split(";"):
            if DEF.search(zeile):
                continue
            direkt[rel(p)] += len(hex_werte(zeile)) + len(FUNK.findall(zeile))
    return {
        "je_datei": je_datei,
        "hex_vorkommen": sum(alle_hex.values()),
        "hex_eindeutig": len(alle_hex),
        "hex_haeufig": alle_hex.most_common(15),
        "funktion_vorkommen": sum(funk.values()),
        "funktion_eindeutig": len(funk),
        "css_direkt": dict(direkt),
        "eigenschaften_definiert": len(defs),
        "eigenschaften_am": sorted(k for k in defs if k.startswith("--am-")),
        "eigenschaften_genutzt": len(nutz),
        "var_haeufig": nutz.most_common(15),
        "alle_hex": sorted(alle_hex),
    }


def themen() -> dict:
    css = ohne_kommentare(lies(STATIC / "style.css"))
    skins = sorted(set(re.findall(r"data-skin\s*=\s*['\"]?([a-z0-9-]+)", css)))
    return {
        "dark_regeln": len(re.findall(r":root\.dark\b|html\.dark\b|(?<![\w-])\.dark\b", css)),
        "dunkel_klasse": len(re.findall(r"\.dunkel\b", css)),
        "skins": skins,
        "prefers_color_scheme": len(re.findall(r"prefers-color-scheme", css)),
        "font_size_stufen": sorted(set(re.findall(r'data-font-size="([a-z]+)"', css))),
    }


def schrift() -> dict:
    faces, families, groessen, gewichte = Counter(), Counter(), Counter(), Counter()
    for p in CSS + HTML + JS:
        t = code(p)
        faces.update(f.strip() for f in FONT_FACE.findall(t))
        families.update(re.sub(r"\s+", " ", f.strip()) for f in FONT_FAMILY.findall(t))
        groessen.update(FONT_SIZE.findall(t))
        gewichte.update(FONT_WEIGHT.findall(t))
    dateien = sorted(rel(p) for p in (STATIC / "fonts").glob("*")) + sorted(
        rel(p) for p in (STATIC / "vendor").glob("*/*.woff2")
    )
    return {
        "font_face": dict(faces),
        "schriftdateien": dateien,
        "font_family_werte": len(families),
        "font_family_haeufig": families.most_common(8),
        "font_size_werte": len(groessen),
        "font_size_vorkommen": sum(groessen.values()),
        "font_size_haeufig": groessen.most_common(12),
        "font_weight_werte": sorted(gewichte),
    }


def zeichen(ci: Path | None) -> dict:
    icons = lies(STATIC / "icons.js")
    satz = sorted(set(LI_KEY.findall(icons)))
    genutzt = Counter()
    svg, picto = {}, {}
    for p in JS + HTML:
        t = lies(p)
        if p.name != "icons.js":
            genutzt.update(LI_CALL.findall(t))
            n = len(SVG.findall(t))
            if n:
                svg[rel(p)] = n
        n = len(PICTO.findall(code(p)))
        if n:
            picto[rel(p)] = n
    erg = {
        "satz": len(satz),
        "satz_namen": satz,
        "aufrufe": sum(genutzt.values()),
        "genutzt": len(set(genutzt) & set(satz)),
        "ungenutzt": sorted(set(satz) - set(genutzt)),
        "aufgerufen_ohne_eintrag": sorted(set(genutzt) - set(satz)),
        "inline_svg": svg,
        "piktogramme": picto,
        "svg_dateien": sorted(rel(p) for p in STATIC.glob("*.svg")),
    }
    if ci:
        ui = ci / "marke" / "icons" / "ui"
        erg["ci_satz"] = len(list(ui.glob("*.svg"))) if ui.is_dir() else None
    return erg


def bausteine(ci: Path | None) -> dict:
    erg = {"dateien": {}}
    klassen = Counter()
    for p in CSS:
        t = lies(p)
        koepfe = [z for z in t.splitlines() if KOPF.match(z)]
        mit = [z for z in koepfe if KENNUNG.search(z)]
        roh = ohne_kommentare(t)
        selektoren = re.findall(r"([^{}]+)\{", roh)
        k = Counter()
        for s in selektoren:
            if s.strip().startswith("@"):
                continue
            k.update(KLASSE.findall(re.sub(r"url\([^)]*\)", "", s)))
        klassen.update(k)
        erg["dateien"][rel(p)] = {
            "zeilen": t.count("\n") + 1,
            "regeln": sum(1 for s in selektoren if not s.strip().startswith("@")),
            "abschnittskoepfe": len(koepfe),
            "mit_kennung": len(mit),
            "important": roh.count("!important"),
            "klassen": len(k),
        }
    erg["klassen_gesamt"] = len(klassen)
    erg["familien"] = {
        name: sum(1 for c in klassen if re.search(muster, c)) for name, muster in FAMILIEN.items()
    }
    # Inline style attributes in markup strings bypass every stylesheet.
    erg["style_attribute"] = {
        rel(p): n for p in JS + HTML if (n := len(re.findall(r"\bstyle\s*=\s*[\"'`]", lies(p))))
    }
    if ci and (ci / "bauteile").is_dir():
        erg["ci_bausteine"] = sorted(p.stem for p in (ci / "bauteile").glob("*.css"))
    return erg


def werte() -> dict:
    radien, schatten, ebenen, dauern = Counter(), Counter(), Counter(), Counter()
    for p in CSS:
        t = ohne_kommentare(lies(p))
        radien.update(r.strip() for r in RADIUS.findall(t))
        schatten.update(re.sub(r"\s+", " ", s.strip()) for s in SHADOW.findall(t))
        ebenen.update(ZINDEX.findall(t))
        for decl in re.findall(r"(?:transition|animation)[a-z-]*\s*:\s*([^;}{]+)", t):
            dauern.update(DAUER.findall(decl))
    return {
        "radius_werte": len(radien),
        "radius_haeufig": radien.most_common(10),
        "schatten_vorkommen": sum(v for k, v in schatten.items() if k != "none"),
        "schatten_werte": len([k for k in schatten if k != "none"]),
        "z_index_werte": sorted(ebenen, key=lambda z: int(z)),
        "dauer_werte": sorted(dauern, key=lambda d: float(d.rstrip("ms")) * (1 if d.endswith("ms") else 1000)),
    }


def ci_vergleich(ci: Path, alle_hex: list[str], am_namen: list[str]) -> dict:
    app = lies(ci / "tokens" / "app.css")
    token = {}
    for name, wert in re.findall(r"(--am-[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\b", app):
        token.setdefault(hex_norm(wert), []).append(name)
    treffer = {h: token[h] for h in alle_hex if h in token}
    ci_namen = set(re.findall(r"(--am-[a-z0-9-]+)\s*:", app))
    stand = {}
    if (ci / "stand.json").is_file():
        s = json.loads(lies(ci / "stand.json"))
        stand = {"stand": s.get("stand"), "commit": s.get("commit", "")[:7]}
    elif (ci / ".git").exists():
        # A clone of the CI repo must have a stand checked out, never main.
        try:
            name = git(ci, "describe", "--tags", "--exact-match", "--match", "ci-*", "HEAD").strip()
        except subprocess.CalledProcessError:
            sys.exit(f"{ci}: HEAD is no stand ci-YY.M.n — check one out first (git checkout ci-…), never main")
        stand = {"stand": name, "commit": git(ci, "rev-parse", "--short=7", "HEAD").strip()}
    return {
        "stand": stand,
        "ci_farbwerte": len(token),
        "wings_hex_eindeutig": len(alle_hex),
        "gleich_ci": len(treffer),
        "treffer": treffer,
        "am_namen_gleich": sorted(n for n in am_namen if n in ci_namen),
        "am_namen_fremd": sorted(n for n in am_namen if n not in ci_namen),
    }


def ci_werkzeug(ci: Path, li_namen: list[str]) -> dict:
    """The CI's own tools against Wings, as for Rocket, Insilo and Relay:
    app-abgleich.py (token set), bauteile.py (labelled sections) and the
    icon generator's name table (zeichen-abgleich.py reads only lucide-react
    imports, which Wings has none of — the Lucide names come from icons.js)."""
    w = ci / "werkzeug"
    erg = {}
    css = STATIC / "style.css"
    if (w / "app-abgleich.py").is_file():
        r = subprocess.run([sys.executable, str(w / "app-abgleich.py"), str(css)], capture_output=True, text=True)
        abw = [z for z in r.stdout.splitlines() if z.startswith("- ")]
        erg["app_abgleich"] = {
            "abweichungen": len(abw),
            "hell": sum(1 for z in abw if z.startswith("- hell")),
            "dunkel": sum(1 for z in abw if z.startswith("- dunkel")),
        }
    if (w / "bauteile.py").is_file():
        r = subprocess.run([sys.executable, str(w / "bauteile.py"), str(css), "--ohne-md"], capture_output=True, text=True)
        arten = Counter()
        for z in r.stdout.splitlines():
            if re.fullmatch(r"\d+ Befund\(e\)", z.strip()) or not z.strip():
                continue
            arten[re.sub(r"`[^`]*`|\[[A-Z]+-[A-Z]+\]|^Zeile \d+: |^bauteile/[A-Z-]+\.css: ", "", z).strip()] += 1
        erg["bauteile"] = dict(arten.most_common())
    erz = w / "icons-erzeugen.py"
    if erz.is_file():
        quelle = lies(erz)
        block = quelle[quelle.index("ZEICHEN = {"): quelle.index("\n}", quelle.index("ZEICHEN = {"))]
        set_namen = {lucide: name for name, lucide in re.findall(r'"([a-z0-9-]+)":\s*"([a-z0-9-]+)"', block)}
        alias = {}
        za = w / "zeichen-abgleich.py"
        if za.is_file():
            for alt, neu in re.findall(r'"([A-Z][A-Za-z0-9]+)":\s*"([a-z0-9-]+)"', lies(za)):
                alias[re.sub(r"(?<=[a-z0-9])(?=[A-Z])|(?<=[a-zA-Z])(?=[0-9])", "-", alt).lower()] = neu
        im_set, fehlt = {}, []
        for n in li_namen:
            kanon = alias.get(n, n)
            if kanon in set_namen:
                im_set[n] = set_namen[kanon]
            else:
                fehlt.append(n)
        erg["zeichen"] = {"im_set": im_set, "fehlt": fehlt}
    return erg


ZEICHENKETTE = re.compile(r"'((?:[^'\\]|\\.)*)'|`((?:[^`\\]|\\.)*)`|\"((?:[^\"\\]|\\.)*)\"")


def wortlaut() -> dict:
    """German UI copy in static/i18n.js against the CI rules: Sie-Form and
    "AI" (CI R3, kern/wording.md). Counts words in the `de:` block only."""
    t = lies(STATIC / "i18n.js")
    sprachen = re.findall(r"^  ([a-z]{2}(?:-[A-Za-z]+)?|'[a-zA-Z-]+')\s*:\s*\{", t, re.M)
    a = t.find("\n  de: {")
    if a < 0:
        return {"sprachen": sprachen}
    ende = re.compile(r"^(?:  [a-z]{2}(?:-[A-Za-z]+)?\s*:\s*\{|\};)", re.M).search(t, a + 5)
    de = t[a : ende.start() if ende else len(t)]
    texte = " ".join("".join(g) for g in ZEICHENKETTE.findall(de))
    def zaehle(muster: str) -> int:
        return len(re.findall(muster, texte))

    return {
        "sprachen": [x.strip("'") for x in sprachen],
        "de_schluessel": len(re.findall(r"^    [a-zA-Z_][\w]*\s*:", de, re.M)),
        "du": zaehle(r"\b(?:[Dd]u|[Dd]ein(?:e[mnrs]?)?|[Dd]ir|[Dd]ich)\b"),
        "sie": zaehle(r"\b(?:Sie|Ihr(?:e[mnrs]?)?|Ihnen)\b"),
        "ki": zaehle(r"\bKI\b"),
        "ai": zaehle(r"\bAI\b"),
        "hermes": zaehle(r"\bHermes\b"),
        "wings": zaehle(r"\bWings\b"),
    }


def tests_kopplung() -> dict:
    """Tests that read static files as text: a rename in the stylesheet or
    markup breaks them even when the browser would not notice."""
    ziele = ["style.css", "wings.css", "index.html", "icons.js"]
    erg = {z: 0 for z in ziele}
    gekoppelt = []
    for p in sorted(TESTS.glob("test_*.py")):
        t = lies(p)
        treffer = [z for z in ziele if z in t]
        for z in treffer:
            erg[z] += 1
        if treffer:
            gekoppelt.append(rel(p))
    return {
        "testdateien": len(list(TESTS.glob("test_*.py"))),
        "lesen_static": len(gekoppelt),
        "je_datei": erg,
        "gekoppelt": gekoppelt,
    }


def tests_laufen(dateien: list[str]) -> dict:
    """Run the coupled tests once through scripts/test.sh (AGENTS.md) and
    keep the summary: what is red today, before any change."""
    r = subprocess.run(
        [str(REPO / "scripts" / "test.sh"), *dateien, "-q", "-p", "no:cacheprovider", "-W", "ignore"],
        cwd=REPO, capture_output=True, text=True,
    )
    zeilen = r.stdout.splitlines()
    summe = next((z for z in reversed(zeilen) if re.search(r"\d+ (passed|failed)", z)), "")
    zahl = lambda w: int(m.group(1)) if (m := re.search(rf"(\d+) {w}", summe)) else 0
    rot = sorted({z.split("::")[0].removeprefix("FAILED ").removeprefix("ERROR ") for z in zeilen
                  if z.startswith(("FAILED ", "ERROR "))})
    return {"passed": zahl("passed"), "failed": zahl("failed"), "skipped": zahl("skipped"),
            "errors": zahl("errors?"), "rote_dateien": len(rot)}


def workflows() -> dict:
    """Which branches each GitHub workflow listens on — a guard only guards
    if its workflow runs on the branch Wings works on."""
    erg = {}
    for p in sorted((REPO / ".github" / "workflows").glob("*.yml")):
        t = lies(p)
        kopf = t[t.find("\non:"):]
        kopf = kopf[: (re.search(r"\n[a-z]", kopf[1:]).start() + 1) if re.search(r"\n[a-z]", kopf[1:]) else len(kopf)]
        zweige = sorted(set(re.findall(r"branches:\s*\[([^\]]*)\]", kopf)))
        ausloeser = [a for a in ("pull_request", "push", "tags", "workflow_dispatch") if re.search(rf"\b{a}\b", kopf)]
        erg[rel(p)] = {"zweige": zweige, "ausloeser": ausloeser}
    return erg


def git(repo: Path, *a: str) -> str:
    return subprocess.run(["git", "-C", str(repo), *a], check=True, capture_output=True, text=True).stdout


def upstream(clone: Path, basis: str, anker: str, gekoppelt: list[str]) -> dict:
    kopf = git(clone, "rev-parse", "--short", "origin/HEAD").strip()
    erg = {"basis": basis, "anker": anker, "kopf": kopf, "dateien": {}}
    for p in CSS + [STATIC / "icons.js", STATIC / "index.html"]:
        pfad = rel(p)
        try:
            alt = git(clone, "show", f"{basis}:{pfad}")
        except subprocess.CalledProcessError:
            alt = None
        eintrag = {}
        if alt is None:
            eintrag["fork"] = "nur Wings"
        else:
            # Wings against the fork base: lines Wings changed in that file.
            d = subprocess.run(
                ["git", "diff", "--no-index", "--numstat", "-", str(p)],
                input=alt, capture_output=True, text=True,
            ).stdout.split()
            eintrag["fork"] = {"zeilen_basis": alt.count("\n"), "plus": int(d[0]) if d else 0, "minus": int(d[1]) if d else 0}
        for von, schluessel in ((basis, "seit_basis"), (anker, "seit_anker")):
            log = git(clone, "log", "--format=%h", "--numstat", f"{von}..origin/HEAD", "--", pfad)
            commits = len([z for z in log.splitlines() if re.fullmatch(r"[0-9a-f]{7,}", z)])
            plus = minus = 0
            for z in log.splitlines():
                teile = z.split("\t")
                if len(teile) == 3 and teile[0].isdigit():
                    plus, minus = plus + int(teile[0]), minus + int(teile[1])
            eintrag[schluessel] = {"commits": commits, "plus": plus, "minus": minus}
        erg["dateien"][pfad] = eintrag
    # The tests that read static files as text: which came with the fork base
    # (upstream's), which are Wings' own.
    basis_dateien = set(git(clone, "ls-tree", "-r", "--name-only", basis, "--", "tests/").split())
    erg["tests_gekoppelt_aus_upstream"] = sum(1 for t in gekoppelt if t in basis_dateien)
    erg["tests_gekoppelt_wings"] = sum(1 for t in gekoppelt if t not in basis_dateien)
    for von, schluessel in ((basis, "commits_seit_basis"), (anker, "commits_seit_anker")):
        erg[schluessel] = int(git(clone, "rev-list", "--count", f"{von}..origin/HEAD").strip())
        erg[schluessel + "_static"] = int(
            git(clone, "rev-list", "--count", f"{von}..origin/HEAD", "--", "static/").strip()
        )
    return erg


def messen(ci: Path | None, up: Path | None, basis: str, anker: str, laufen: bool = False) -> dict:
    f = farben()
    erg = {
        "gemessen_an": git(REPO, "rev-parse", "--short", "HEAD").strip(),
        "farben": f,
        "themen": themen(),
        "schrift": schrift(),
        "zeichen": zeichen(ci),
        "bausteine": bausteine(ci),
        "werte": werte(),
        "tests": tests_kopplung(),
        "wortlaut": wortlaut(),
        "workflows": workflows(),
    }
    if laufen:
        erg["tests"]["lauf"] = tests_laufen(erg["tests"]["gekoppelt"])
    if ci:
        erg["ci"] = ci_vergleich(ci, f["alle_hex"], f["eigenschaften_am"])
        erg["ci_werkzeug"] = ci_werkzeug(ci, erg["zeichen"]["satz_namen"])
    if up:
        erg["upstream"] = upstream(up, basis, anker, erg["tests"]["gekoppelt"])
    return erg


def tabelle(kopf: list[str], zeilen: list[list]) -> str:
    aus = ["| " + " | ".join(kopf) + " |", "|" + "---|" * len(kopf)]
    aus += ["| " + " | ".join(str(z) for z in zeile) + " |" for zeile in zeilen]
    return "\n".join(aus)


def liste(werte) -> str:
    return ", ".join(f"`{w}`" for w in werte) if werte else "—"


def markdown(m: dict) -> str:
    f, th, s, z, b, w, t = (m[k] for k in ("farben", "themen", "schrift", "zeichen", "bausteine", "werte", "tests"))
    o = [
        "# Bestand — was Wings heute trägt",
        "",
        "<!-- Erzeugt von scripts/ci/bestand.py. Nicht von Hand ändern: neu messen. -->",
        "",
        f"Gemessen an Commit `{m['gemessen_an']}` mit `python3 scripts/ci/bestand.py"
        + (" --ci <aimighty-ci>" if "ci" in m else "")
        + (" --upstream <hermes-webui>" if "upstream" in m else "")
        + (" --tests" if "lauf" in m["tests"] else "")
        + " --md docs/ci/BESTAND.md`. Gezählt wird, was Wings selbst ausliefert: `static/*.css`, `static/*.js`, "
        "`static/*.html` — ohne `static/vendor/`.",
        "",
        "## 1. Farben",
        "",
        f"- Hex-Werte: **{f['hex_vorkommen']}** Vorkommen, **{f['hex_eindeutig']}** verschiedene.",
        f"- Farbfunktionen (`rgb()`, `rgba()`, `color-mix()` …): **{f['funktion_vorkommen']}** Vorkommen, "
        f"**{f['funktion_eindeutig']}** verschiedene.",
        f"- Eigene Eigenschaften (`--…`): **{f['eigenschaften_definiert']}** definiert, "
        f"**{f['eigenschaften_genutzt']}** per `var()` gelesen; davon CI-Namen (`--am-…`): "
        f"**{len(f['eigenschaften_am'])}** ({liste(f['eigenschaften_am'])}).",
        "",
        tabelle(
            ["Datei", "Hex", "Farbfunktion", "davon im CSS außerhalb einer Token-Definition"],
            [[k, v["hex"], v["funktion"], f["css_direkt"].get(k, "")] for k, v in sorted(f["je_datei"].items())],
        ),
        "",
        "Häufigste Hex-Werte: " + ", ".join(f"`{h}` ×{n}" for h, n in f["hex_haeufig"]) + ".",
        "",
        "Häufigste `var()`: " + ", ".join(f"`{h}` ×{n}" for h, n in f["var_haeufig"]) + ".",
        "",
        f"**Hell/Dunkel:** {th['dark_regeln']} Regeln hängen an `.dark` "
        f"(CI: Klasse `dunkel` am `<html>`; heute {th['dunkel_klasse']}). "
        f"Skins (`data-skin`): {liste(th['skins'])}. `prefers-color-scheme` im CSS: {th['prefers_color_scheme']}. "
        f"Schriftgrößen-Stufen (`data-font-size`): {liste(th['font_size_stufen'])}.",
        "",
    ]
    if "ci" in m:
        c = m["ci"]
        o += [
            f"**Gegen das CI** (Stand `{c['stand'].get('stand')}`, Commit `{c['stand'].get('commit')}`): "
            f"Von {c['wings_hex_eindeutig']} verschiedenen Wings-Hex-Werten sind **{c['gleich_ci']}** "
            f"genau ein Farbwert aus `tokens/app.css` ({c['ci_farbwerte']} verschiedene Hex-Werte dort).",
            "",
            tabelle(["Wert", "CI-Token"], [[f"`{h}`", ", ".join(n)] for h, n in sorted(c["treffer"].items())]),
            "",
            f"Wings' `--am-…`-Namen, die es im CI gibt: {liste(c['am_namen_gleich'])}. "
            f"Die es im CI **nicht** gibt: {liste(c['am_namen_fremd'])}.",
            "",
        ]
    o += [
        "## 2. Schrift",
        "",
        f"- `@font-face`: {', '.join(f'{k} ×{v}' for k, v in s['font_face'].items()) or '—'}.",
        f"- Schriftdateien: {liste(s['schriftdateien'])}.",
        f"- `font-family`: **{s['font_family_werte']}** verschiedene Werte. Häufigste: "
        + "; ".join(f"`{k}` ×{v}" for k, v in s["font_family_haeufig"])
        + ".",
        f"- `font-size` als fester Wert: **{s['font_size_vorkommen']}** Vorkommen, **{s['font_size_werte']}** "
        "verschiedene. Häufigste: " + ", ".join(f"`{k}` ×{v}" for k, v in s["font_size_haeufig"]) + ".",
        f"- `font-weight`: {liste(s['font_weight_werte'])}.",
        "",
        "## 3. Zeichen",
        "",
        f"- Eigener Satz `static/icons.js` (Lucide-Pfade, `li('name')`): **{z['satz']}** Zeichen, "
        f"**{z['genutzt']}** davon aufgerufen ({z['aufrufe']} Aufrufe außerhalb von `icons.js`).",
        f"- Nie per `li()` aufgerufen: {len(z['ungenutzt'])} ({liste(z['ungenutzt'])}). "
        "Manche davon können über Namen aus Variablen kommen — vor dem Löschen prüfen.",
        f"- Per `li()` aufgerufen, aber nicht im Satz: {liste(z['aufgerufen_ohne_eintrag'])}.",
    ]
    if z.get("ci_satz") is not None:
        o.append(f"- CI-Satz `marke/icons/ui/`: **{z['ci_satz']}** Zeichen.")
    o += [
        "",
        tabelle(
            ["Datei", "Inline-`<svg>`", "Piktogramme/Emoji im Code"],
            [
                [k, z["inline_svg"].get(k, ""), z["piktogramme"].get(k, "")]
                for k in sorted(set(z["inline_svg"]) | set(z["piktogramme"]))
            ],
        ),
        "",
        f"SVG-Dateien in `static/`: {liste(z['svg_dateien'])}.",
        "",
        "## 3a. Wortlaut (deutsche Oberfläche, `static/i18n.js`)",
        "",
    ]
    wl = m["wortlaut"]
    o += [
        f"Sprachen in `i18n.js`: {liste(wl['sprachen'])}. Im Block `de`: **{wl.get('de_schluessel', '—')}** Schlüssel.",
        "",
        tabelle(
            ["Wort", "Vorkommen in `de`", "CI"],
            [
                ["du/dein/dir/dich", wl.get("du"), "Sie-Form"],
                ["Sie/Ihr/Ihnen", wl.get("sie"), "Sie-Form"],
                ["KI", wl.get("ki"), "R3: AI"],
                ["AI", wl.get("ai"), "R3: AI"],
                ["Hermes", wl.get("hermes"), "Name der Anwendung?"],
                ["Wings", wl.get("wings"), "Name der Anwendung?"],
            ],
        ),
        "",
        "## 4. Bausteine",
        "",
        tabelle(
            ["Datei", "Zeilen", "Regeln", "Klassen", "Abschnittsköpfe `/* ── `", "davon mit Kennung", "`!important`"],
            [
                [k, v["zeilen"], v["regeln"], v["klassen"], v["abschnittskoepfe"], v["mit_kennung"], v["important"]]
                for k, v in b["dateien"].items()
            ],
        ),
        "",
        f"**{b['klassen_gesamt']}** verschiedene Klassen im CSS. Nach Familie (Klassenname enthält das Wort; "
        "eine Klasse kann in mehreren Familien zählen):",
        "",
        tabelle(["Familie (CI-Baustein)", "Klassen"], [[k, v] for k, v in b["familien"].items()]),
        "",
        "`style=\"…\"` in Markup-Strings (umgeht jedes Stylesheet): "
        + ", ".join(f"{k} ×{v}" for k, v in sorted(b["style_attribute"].items()))
        + ".",
        "",
    ]
    if b.get("ci_bausteine"):
        o += [f"CI-Bausteine im Stand: {len(b['ci_bausteine'])} ({liste(b['ci_bausteine'])}).", ""]
    o += [
        "## 5. Weitere Werte",
        "",
        f"- `border-radius`: **{w['radius_werte']}** verschiedene. Häufigste: "
        + ", ".join(f"`{k}` ×{v}" for k, v in w["radius_haeufig"])
        + ".",
        f"- `box-shadow` (ohne `none`): **{w['schatten_vorkommen']}** Vorkommen, **{w['schatten_werte']}** verschiedene "
        "(CI: ein Schatten, nur für Schwebendes).",
        f"- `z-index`: {liste(w['z_index_werte'])}.",
        f"- Dauern in `transition`/`animation`: {liste(w['dauer_werte'])}.",
        "",
    ]
    if m.get("ci_werkzeug"):
        cw = m["ci_werkzeug"]
        o += ["## 5a. Die Werkzeuge des CI gegen Wings", ""]
        if "app_abgleich" in cw:
            a = cw["app_abgleich"]
            o.append(
                f"- `werkzeug/app-abgleich.py static/style.css`: **{a['abweichungen']}** Abweichungen von "
                f"`tokens/app.css` ({a['hell']} hell, {a['dunkel']} dunkel)."
            )
        if "bauteile" in cw:
            o.append(
                "- `werkzeug/bauteile.py static/style.css --ohne-md`: "
                + "; ".join(f"{k} ×{v}" for k, v in cw["bauteile"].items())
                + "."
            )
        if "zeichen" in cw:
            zz = cw["zeichen"]
            o.append(
                f"- Zeichen aus `icons.js` gegen die Namenstafel von `werkzeug/icons-erzeugen.py`: "
                f"**{len(zz['im_set'])}** von {len(zz['im_set']) + len(zz['fehlt'])} hat das Set, "
                f"**{len(zz['fehlt'])}** fehlen ({liste(zz['fehlt'])}). Die Inline-`<svg>` aus Abschnitt 3 "
                "sind hier nicht enthalten."
            )
            o += ["", tabelle(["Wings (`li()`)", "CI-Name"], [[f"`{k}`", f"`{v}`"] for k, v in sorted(zz["im_set"].items())])]
        o.append("")
    o += [
        "## 6. Kopplung der Tests an den Quelltext",
        "",
        f"Von **{t['testdateien']}** Testdateien lesen **{t['lesen_static']}** eine der Dateien unten als Text "
        "(Selektoren, Token-Namen, Markup als Zeichenkette). Jeder Umbau dort bricht sie, auch wenn der Browser "
        "nichts merkt.",
        "",
        tabelle(["Datei", "Testdateien, die sie nennen"], [[k, v] for k, v in t["je_datei"].items()]),
        "",
    ]
    if "lauf" in t:
        lf = t["lauf"]
        o += [
            f"**Heute, vor jeder Änderung** (`./scripts/test.sh` über diese {t['lesen_static']} Dateien): "
            f"{lf['passed']} bestanden, **{lf['failed']} rot**, {lf['skipped']} übersprungen"
            + (f", {lf['errors']} Fehler" if lf["errors"] else "")
            + f" — rot in **{lf['rote_dateien']}** Testdateien.",
            "",
        ]
    o += [
        "**GitHub-Workflows und ihre Zweige** (Wings arbeitet auf `main`):",
        "",
        tabelle(
            ["Workflow", "Auslöser", "Zweige"],
            [[k, ", ".join(v["ausloeser"]), ", ".join(v["zweige"]) or "alle"] for k, v in m["workflows"].items()],
        ),
        "",
    ]
    if "upstream" in m:
        u = m["upstream"]
        o += [
            "## 7. Abstand zum Upstream (`nesquena/hermes-webui`)",
            "",
            f"Basis `{u['basis']}` (Abzweig), Anker `{u['anker']}` (letzte Sync-Runde), Upstream-Kopf `{u['kopf']}`. "
            f"Upstream seit Basis: **{u['commits_seit_basis']}** Commits, davon **{u['commits_seit_basis_static']}** "
            f"in `static/`. Seit Anker: **{u['commits_seit_anker']}**, davon **{u['commits_seit_anker_static']}** "
            "in `static/`. Von den Testdateien aus Abschnitt 6 kamen "
            f"**{u['tests_gekoppelt_aus_upstream']}** mit der Basis aus dem Upstream, "
            f"**{u['tests_gekoppelt_wings']}** sind Wings' eigene.",
            "",
            tabelle(
                ["Datei", "Zeilen in der Basis", "Wings geändert (+/−)", "Upstream seit Basis: Commits (+/−)",
                 "Upstream seit Anker: Commits (+/−)"],
                [
                    [
                        k,
                        v["fork"]["zeilen_basis"] if isinstance(v["fork"], dict) else "—",
                        f"+{v['fork']['plus']}/−{v['fork']['minus']}" if isinstance(v["fork"], dict) else v["fork"],
                        f"{v['seit_basis']['commits']} (+{v['seit_basis']['plus']}/−{v['seit_basis']['minus']})",
                        f"{v['seit_anker']['commits']} (+{v['seit_anker']['plus']}/−{v['seit_anker']['minus']})",
                    ]
                    for k, v in u["dateien"].items()
                ],
            ),
            "",
        ]
    return "\n".join(o)


def main() -> int:
    a = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    a.add_argument("--ci", type=Path)
    a.add_argument("--upstream", type=Path)
    a.add_argument("--basis", default=BASIS)
    a.add_argument("--anker", default=ANKER)
    a.add_argument("--md", type=Path)
    a.add_argument("--json", action="store_true")
    a.add_argument("--tests", action="store_true", help="run the coupled tests once (a few minutes)")
    arg = a.parse_args()
    m = messen(arg.ci, arg.upstream, arg.basis, arg.anker, arg.tests)
    if arg.json:
        m["farben"].pop("alle_hex")
        m["tests"].pop("gekoppelt")
        print(json.dumps(m, ensure_ascii=False, indent=2))
        return 0
    text = markdown(m) + "\n"
    if arg.md:
        arg.md.parent.mkdir(parents=True, exist_ok=True)
        arg.md.write_text(text, encoding="utf-8")
        print(f"{arg.md}: {len(text.splitlines())} Zeilen")
    else:
        sys.stdout.write(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
