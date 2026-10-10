#!/usr/bin/env python3
"""Fills every inline <svg data-li="…"> with the CI icon of that name (CI ABGLEICH WG-Z1, 3b).

index.html and the JS templates keep their icons inline, so the page draws
them without waiting for JS and tests that read the markup still find an
<svg>. Which icon a control shows is its data-li, a CI name; the drawing comes
from static/icons.js (written from a CI stand by icons_erzeugen.py). This
script rewrites each such <svg>: 24 grid, no fill, currentColor, the CI's
fixed stroke 1.5, the CI drawing inside; width, height, id, class, style and
aria attributes stay.

An <svg data-li-ausstehend="name"> waits for a CI icon that is not in the
stand yet; it keeps its drawing until the name arrives.

    python3 scripts/ci/zeichen_einsetzen.py            # rewrite
    python3 scripts/ci/zeichen_einsetzen.py --pruefen  # report, exit 1 when something differs
"""
import argparse
import pathlib
import re
import sys

REPO = pathlib.Path(__file__).resolve().parent.parent.parent
STATIC = REPO / "static"
DATEIEN = ["index.html"] + sorted(p.name for p in STATIC.glob("*.js") if p.name not in ("icons.js", "i18n.js"))

_SVG = re.compile(r"<svg\b([^>]*?)\bdata-li=([\"'])([\w-]+)\2([^>]*)>(.*?)</svg>", re.S)
_BEHALTEN = ("width", "height", "id", "class", "style", "aria-hidden", "aria-label", "role", "focusable")


def zeichen():
    """{name: inner markup} from static/icons.js."""
    src = (STATIC / "icons.js").read_text(encoding="utf-8")
    return {n: p.replace("\\'", "'") for n, p in re.findall(r"^  '([\w-]+)': '(.*)',", src, re.M)}


def _attribute(text):
    return re.findall(r"""([\w:-]+)=(["'])(.*?)\2""", text)


def einsetzen(src, tafel):
    def ersetzen(m):
        name = m.group(3)
        if name not in tafel:
            raise SystemExit(f"data-li=\"{name}\": kein Zeichen in icons.js")
        attrs = [(k, q, v) for k, q, v in _attribute(m.group(1) + m.group(4)) if k in _BEHALTEN]
        q = m.group(2)
        kopf = f'<svg data-li={q}{name}{q}' + "".join(f" {k}={qq}{v}{qq}" for k, qq, v in attrs)
        kopf += (f' viewBox={q}0 0 24 24{q} fill={q}none{q} stroke={q}currentColor{q} stroke-width={q}1.5{q}'
                 f' stroke-linecap={q}round{q} stroke-linejoin={q}round{q}>')
        innen = tafel[name] if q == '"' else tafel[name].replace('"', "'")
        return kopf + innen + "</svg>"
    return _SVG.sub(ersetzen, src)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--pruefen", action="store_true")
    args = ap.parse_args(argv)
    tafel = zeichen()
    abweichend = []
    for name in DATEIEN:
        pfad = STATIC / name
        alt = pfad.read_text(encoding="utf-8")
        neu = einsetzen(alt, tafel)
        if neu != alt:
            abweichend.append(name)
            if not args.pruefen:
                pfad.write_text(neu, encoding="utf-8")
    if args.pruefen:
        print("Zeichen gleich dem Stand" if not abweichend else f"weicht ab: {', '.join(abweichend)}")
        return 1 if abweichend else 0
    print(f"neu gezeichnet: {', '.join(abweichend) or 'nichts'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
