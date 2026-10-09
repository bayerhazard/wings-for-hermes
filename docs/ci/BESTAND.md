# Bestand — was Wings heute trägt

<!-- Erzeugt von scripts/ci/bestand.py. Nicht von Hand ändern: neu messen. -->

Gemessen an Commit `004b26e` mit `python3 scripts/ci/bestand.py --ci <aimighty-ci> --upstream <hermes-webui> --tests --md docs/ci/BESTAND.md`. Gezählt wird, was Wings selbst ausliefert: `static/*.css`, `static/*.js`, `static/*.html` — ohne `static/vendor/`.

## 1. Farben

- Hex-Werte: **226** Vorkommen, **76** verschiedene.
- Farbfunktionen (`rgb()`, `rgba()`, `color-mix()` …): **488** Vorkommen, **277** verschiedene.
- Eigene Eigenschaften (`--…`): **137** definiert, **145** per `var()` gelesen; davon CI-Namen (`--am-…`): **19** (`--am-einheit`, `--am-header-h`, `--am-radius-klein`, `--am-radius-l`, `--am-radius-m`, `--am-radius-s`, `--am-raum-1`, `--am-raum-12`, `--am-raum-16`, `--am-raum-2`, `--am-raum-24`, `--am-raum-3`, `--am-raum-32`, `--am-raum-4`, `--am-raum-48`, `--am-raum-64`, `--am-raum-8`, `--am-skalierung`, `--am-ziel-zeiger`).

| Datei | Hex | Farbfunktion | davon im CSS außerhalb einer Token-Definition |
|---|---|---|---|
| static/boot.js | 9 | 0 |  |
| static/index.html | 24 | 13 |  |
| static/onboarding.js | 2 | 2 |  |
| static/panels.js | 8 | 14 |  |
| static/sessions.js | 8 | 1 |  |
| static/share.html | 4 | 3 |  |
| static/style.css | 119 | 441 | 474 |
| static/terminal.js | 20 | 2 |  |
| static/ui.js | 13 | 5 |  |
| static/wings.css | 19 | 7 | 3 |

Häufigste Hex-Werte: `#ffffff` ×42, `#caa960` ×29, `#0a2238` ×8, `#051729` ×7, `#294766` ×6, `#55c483` ×5, `#000000` ×5, `#2d3748` ×4, `#002f56` ×4, `#142e47` ×4, `#8ca1b7` ×4, `#60b0ff` ×4, `#f6857a` ×4, `#ed914c` ×4, `#f5f5f7` ×3.

Häufigste `var()`: `--muted` ×634, `--text` ×380, `--border` ×281, `--accent` ×278, `--accent-bg` ×159, `--accent-text` ×150, `--error` ×147, `--surface` ×143, `--border2` ×135, `--accent-bg-strong` ×122, `--hover-bg` ×89, `--success` ×62, `--code-bg` ×51, `--warning` ×45, `--blue` ×45.

**Hell/Dunkel:** 139 Regeln hängen an `.dark` (CI: Klasse `dunkel` am `<html>`; heute 0). Skins (`data-skin`): —. `prefers-color-scheme` im CSS: 0. Schriftgrößen-Stufen (`data-font-size`): `large`, `small`, `xlarge`.

**Gegen das CI** (Stand `ci-26.10.17`, Commit `f5f1118`): Von 76 verschiedenen Wings-Hex-Werten sind **15** genau ein Farbwert aus `tokens/app.css` (52 verschiedene Hex-Werte dort).

| Wert | CI-Token |
|---|---|
| `#002f56` | --am-handlung-ruhend, --am-fokus-ring |
| `#007e46` | --am-erfolg |
| `#051729` | --am-blau-900 |
| `#066bb8` | --am-hinweis |
| `#0a2238` | --am-blau-800 |
| `#142e47` | --am-blau-700 |
| `#55c483` | --am-erfolg |
| `#60b0ff` | --am-hinweis |
| `#8c6c1f` | --am-gold-800 |
| `#9f5100` | --am-achtung |
| `#ad3f38` | --am-fehler |
| `#caa960` | --am-gold-500 |
| `#ed914c` | --am-achtung |
| `#f6857a` | --am-fehler |
| `#ffffff` | --am-seite, --am-handlung-text, --am-text-auf-farbe |

Wings' `--am-…`-Namen, die es im CI gibt: `--am-einheit`, `--am-radius-klein`, `--am-raum-1`, `--am-raum-12`, `--am-raum-16`, `--am-raum-2`, `--am-raum-3`, `--am-raum-4`, `--am-raum-8`, `--am-skalierung`, `--am-ziel-zeiger`. Die es im CI **nicht** gibt: `--am-header-h`, `--am-radius-l`, `--am-radius-m`, `--am-radius-s`, `--am-raum-24`, `--am-raum-32`, `--am-raum-48`, `--am-raum-64`.

## 2. Schrift

- `@font-face`: Geist ×1, Geist Mono ×1.
- Schriftdateien: `static/fonts/Geist.woff2`, `static/fonts/GeistMono.woff2`, `static/vendor/inter/InterVariable.woff2`.
- `font-family`: **21** verschiedene Werte. Häufigste: `var(--font-mono)` ×24; `'Geist Mono','SF Mono',ui-monospace,monospace` ×20; `inherit` ×18; `'SF Mono',ui-monospace,SFMono-Regular,Menlo,monospace` ×3; `var(--font-ui)` ×2; `"Geist Mono","SF Mono",ui-monospace,monospace` ×2; `"Geist Mono","SF Mono","Fira Code",ui-monospace,monospace` ×2; `'SF Mono', ui-monospace, monospace` ×2.
- `font-size` als fester Wert: **1022** Vorkommen, **40** verschiedene. Häufigste: `12px` ×284, `11px` ×284, `13px` ×158, `10px` ×93, `14px` ×35, `16px` ×24, `10.5px` ×20, `15px` ×16, `9px` ×16, `18px` ×15, `12.5px` ×12, `11.5px` ×10.
- `font-weight`: `100`, `300`, `400`, `500`, `550`, `600`, `650`, `700`, `750`, `800`, `bold`.

## 3. Zeichen

- Eigener Satz `static/icons.js` (Lucide-Pfade, `li('name')`): **64** Zeichen, **45** davon aufgerufen (118 Aufrufe außerhalb von `icons.js`).
- Nie per `li()` aufgerufen: 19 (`archive`, `arrow-right`, `arrow-up`, `audio-lines`, `braces`, `calendar`, `clipboard-list`, `database`, `lock`, `map`, `paperclip`, `pause`, `refresh-cw`, `save`, `sparkles`, `square`, `trash-2`, `upload`, `user`). Manche davon können über Namen aus Variablen kommen — vor dem Löschen prüfen.
- Per `li()` aufgerufen, aber nicht im Satz: —.
- CI-Satz `marke/icons/ui/`: **145** Zeichen.

| Datei | Inline-`<svg>` | Piktogramme/Emoji im Code |
|---|---|---|
| static/boot.js |  | 1 |
| static/commands.js |  | 1 |
| static/i18n.js |  | 26 |
| static/index.html | 159 | 5 |
| static/messages.js | 3 |  |
| static/onboarding.js |  | 17 |
| static/panels.js | 9 | 26 |
| static/sessions.js | 14 |  |
| static/share.html | 1 |  |
| static/ui.js | 14 | 42 |
| static/workspace.js |  | 1 |

SVG-Dateien in `static/`: `static/ai_mighty_blue_white_bg.svg`, `static/ai_mighty_gold_shield_dark_bg.svg`, `static/favicon-v5.svg`, `static/wings-shield.svg`.

## 3a. Wortlaut (deutsche Oberfläche, `static/i18n.js`)

Sprachen in `i18n.js`: `en`, `de`. Im Block `de`: **1630** Schlüssel.

| Wort | Vorkommen in `de` | CI |
|---|---|---|
| du/dein/dir/dich | 19 | Sie-Form |
| Sie/Ihr/Ihnen | 41 | Sie-Form |
| KI | 1 | R3: AI |
| AI | 2 | R3: AI |
| Hermes | 31 | Name der Anwendung? |
| Wings | 1 | Name der Anwendung? |

## 4. Bausteine

| Datei | Zeilen | Regeln | Klassen | Abschnittsköpfe `/* ── ` | davon mit Kennung | `!important` |
|---|---|---|---|---|---|---|
| static/style.css | 6159 | 3244 | 1602 | 105 | 0 | 173 |
| static/wings.css | 812 | 184 | 86 | 19 | 0 | 20 |

**1644** verschiedene Klassen im CSS. Nach Familie (Klassenname enthält das Wort; eine Klasse kann in mehreren Familien zählen):

| Familie (CI-Baustein) | Klassen |
|---|---|
| Knopf (AM-KNOPF) | 85 |
| Feld (AM-FELD) | 53 |
| Schalter/Haken (AM-HAKEN) | 52 |
| Dialog (HB-DIALOG) | 19 |
| Menü (HB-KNOPFMENUE) | 21 |
| Hinweis/Zustand (HB-ZUSTAND) | 38 |
| Karte (AM-KARTE) | 159 |
| Pille (HB-PILLE) | 88 |
| Leer (AM-LEER) | 29 |
| Suche (HB-SUCHE) | 29 |
| Tabelle (HB-TABELLE) | 12 |
| Navigation/Hülle (AM-HUELLE) | 87 |

`style="…"` in Markup-Strings (umgeht jedes Stylesheet): static/boot.js ×1, static/icons.js ×1, static/index.html ×349, static/onboarding.js ×29, static/panels.js ×152, static/sessions.js ×4, static/share.js ×1, static/ui.js ×23.

CI-Bausteine im Stand: 32 (`AM-BASIS`, `AM-FELD`, `AM-HAKEN`, `AM-HUELLE`, `AM-KARTE`, `AM-KNOPF`, `AM-LEER`, `HB-AI`, `HB-ASSISTENT`, `HB-BLOCK`, `HB-BOARD`, `HB-DARSTELLUNG`, `HB-DIALOG`, `HB-DRUCK`, `HB-ERKLAERUNG`, `HB-FAKTOR`, `HB-FELDREIHE`, `HB-KENNZAHL`, `HB-KNOPFMENUE`, `HB-KONTO`, `HB-MARKE`, `HB-MEHRFACH`, `HB-PILLE`, `HB-SEITENKOPF`, `HB-SUCHE`, `HB-SYMBOL`, `HB-TABELLE`, `HB-TEXT`, `HB-TOR`, `HB-UNTERNAV`, `HB-ZEITLEISTE`, `HB-ZUSTAND`).

## 5. Weitere Werte

- `border-radius`: **40** verschiedene. Häufigste: `8px` ×126, `999px` ×68, `6px` ×62, `50%` ×37, `10px` ×35, `4px` ×28, `12px` ×25, `0` ×18, `7px` ×18, `14px` ×9.
- `box-shadow` (ohne `none`): **51** Vorkommen, **31** verschiedene (CI: ein Schatten, nur für Schwebendes).
- `z-index`: `0`, `1`, `2`, `3`, `4`, `10`, `11`, `12`, `20`, `30`, `50`, `100`, `120`, `150`, `180`, `198`, `199`, `200`, `260`, `300`, `999`, `1000`, `1050`, `1100`, `1200`, `1400`, `1500`, `9998`, `9999`.
- Dauern in `transition`/`animation`: `0s`, `.1s`, `0.1s`, `.12s`, `.14s`, `.15s`, `.16s`, `.18s`, `.2s`, `.22s`, `.24s`, `.25s`, `.26s`, `.28s`, `.3s`, `.32s`, `.34s`, `.35s`, `.36s`, `.4s`, `.44s`, `.45s`, `.48s`, `.5s`, `.6s`, `620ms`, `.8s`, `.9s`, `1s`, `1.05s`, `1.1s`, `1.2s`, `1.25s`, `1.3s`, `1.4s`, `1.5s`, `1.6s`, `1.7s`, `2s`, `2.4s`.

## 5a. Die Werkzeuge des CI gegen Wings

- `werkzeug/app-abgleich.py static/style.css`: **149** Abweichungen von `tokens/app.css` (108 hell, 39 dunkel).
- `werkzeug/bauteile.py static/style.css --ohne-md`: Regel vor dem ersten Abschnitt ×5298; die App hat keinen Abschnitt ×32.
- Zeichen aus `icons.js` gegen die Namenstafel von `werkzeug/icons-erzeugen.py`: **43** von 64 hat das Set, **21** fehlen (`audio-lines`, `book-open`, `bot`, `braces`, `clipboard-list`, `dollar-sign`, `file-code`, `file-pen`, `git-branch`, `hash`, `layers`, `list-todo`, `loader`, `map`, `message-square`, `pause`, `plug`, `rotate-ccw`, `shuffle`, `terminal`, `undo`). Die Inline-`<svg>` aus Abschnitt 3 sind hier nicht enthalten.

| Wings (`li()`) | CI-Name |
|---|---|
| `alert-triangle` | `achtung` |
| `archive` | `datensicherung` |
| `arrow-right` | `weiter` |
| `arrow-up` | `pfeil-hoch` |
| `brain` | `gedaechtnis` |
| `calendar` | `kalender` |
| `check` | `erfolg` |
| `chevron-down` | `chevron` |
| `chevron-right` | `chevron-rechts` |
| `chevron-up` | `chevron-hoch` |
| `clock` | `frist` |
| `copy` | `kopieren` |
| `cpu` | `grafikeinheit` |
| `database` | `datenbank` |
| `download` | `herunterladen` |
| `external-link` | `extern` |
| `eye` | `anzeigen` |
| `file-text` | `dokumente` |
| `folder` | `ordner` |
| `globe` | `netzrecherche` |
| `grip-vertical` | `griff` |
| `image` | `bild` |
| `lightbulb` | `erkenntnis` |
| `link` | `verknuepfung` |
| `lock` | `schloss` |
| `paperclip` | `anhang` |
| `pencil` | `bearbeiten` |
| `play` | `lauf-gestartet` |
| `plus` | `plus` |
| `refresh-cw` | `neu-laden` |
| `save` | `speichern` |
| `search` | `suche` |
| `settings` | `einstellungen` |
| `sparkles` | `ai` |
| `square` | `stopp` |
| `star` | `standard` |
| `trash-2` | `loeschen` |
| `upload` | `hochladen` |
| `user` | `nutzer` |
| `volume-2` | `vorlesen` |
| `wrench` | `fertigkeit` |
| `x` | `schliessen` |
| `zap` | `ereignis` |

## 6. Kopplung der Tests an den Quelltext

Von **1263** Testdateien lesen **265** eine der Dateien unten als Text (Selektoren, Token-Namen, Markup als Zeichenkette). Jeder Umbau dort bricht sie, auch wenn der Browser nichts merkt.

| Datei | Testdateien, die sie nennen |
|---|---|
| style.css | 193 |
| wings.css | 3 |
| index.html | 144 |
| icons.js | 7 |

**Heute, vor jeder Änderung** (`./scripts/test.sh` über diese 265 Dateien): 3416 bestanden, **167 rot**, 13 übersprungen — rot in **83** Testdateien.

**GitHub-Workflows und ihre Zweige** (Wings arbeitet auf `main`):

| Workflow | Auslöser | Zweige |
|---|---|---|
| .github/workflows/browser-smoke.yml | pull_request, push | master |
| .github/workflows/docker-publish.yml | push, tags, workflow_dispatch | main |
| .github/workflows/docker-smoke.yml | pull_request, push, workflow_dispatch | master |
| .github/workflows/native-windows-startup.yml | pull_request, workflow_dispatch | alle |
| .github/workflows/release.yml | push, tags | alle |
| .github/workflows/tests.yml | pull_request, push | master |

## 7. Abstand zum Upstream (`nesquena/hermes-webui`)

Basis `001d7985` (Abzweig), Anker `3b9c632a` (letzte Sync-Runde), Upstream-Kopf `7a74ae1b`. Upstream seit Basis: **2486** Commits, davon **639** in `static/`. Seit Anker: **1719**, davon **418** in `static/`. Von den Testdateien aus Abschnitt 6 kamen **262** mit der Basis aus dem Upstream, **3** sind Wings' eigene.

| Datei | Zeilen in der Basis | Wings geändert (+/−) | Upstream seit Basis: Commits (+/−) | Upstream seit Anker: Commits (+/−) |
|---|---|---|---|---|
| static/style.css | 7215 | +586/−1643 | 50 (+293/−122) | 21 (+90/−28) |
| static/wings.css | — | nur Wings | 0 (+0/−0) | 0 (+0/−0) |
| static/icons.js | 95 | +6/−4 | 1 (+2/−0) | 1 (+2/−0) |
| static/index.html | 1878 | +427/−258 | 33 (+82/−39) | 21 (+34/−27) |

