# Wings an das AImighty-CI — Etappenplan

Wings schließt sich an das CI an (`ska1walker/aimighty-ci`) wie Rocket, Insilo
und Relay: **Das CI ist die Quelle** für Token, Zeichen und Bausteine; Wings hält
einen Stand `ci-YY.M.n` als Kopie und prüft sich ohne Netz dagegen
(CI `STAND.md`, `ABGLEICH.md` Paket 4). Jede Etappe ist ein eigener PR.

Alle Zahlen stehen in [`BESTAND.md`](BESTAND.md) und kommen aus
`scripts/ci/bestand.py` — dieses Dokument nennt keine eigenen. Neu messen:

```bash
git -C <klon von aimighty-ci> checkout ci-YY.M.n   # ein Stand, nie main
python3 scripts/ci/bestand.py --ci <klon von aimighty-ci> \
  --upstream <klon von nesquena/hermes-webui> --tests --md docs/ci/BESTAND.md
```

## Spielregeln

- **Das CI ist die Quelle.** Nie still in Wings abweichen. Jede Abweichung wird
  ein Eintrag im Abschnitt „Wings“ der CI-`ABGLEICH.md`, mit Kais Entscheidung.
- **CI-Änderungen zuerst ins CI** (PR dort, Merge, neuer Stand `ci-YY.M.n`);
  Wings holt danach genau diesen Stand — nie `main`, nie zur Bauzeit.
- **Wings' Eigenes trägt eine eigene Kennung** (Vorschlag unten, E1).
- **Zahlen in Berichten kommen aus Skripten**, nicht von Hand.
- **Das Versionsschema bleibt** (`YY.MM.<n>`, `AGENTS.md`) — es wird hier nicht
  angefasst.
- Gemergt wird nur auf Kais „merge“.

## Was Wings anders macht als Relay und Insilo

Wings ist ein Fork von `nesquena/hermes-webui`: reines Python und Vanilla-JS
ohne Bundler, mit eigenem Upstream-Abgleich (`UPSTREAM_SYNC.md`). Die Werkzeuge
der anderen Apps (SvelteKit/Next, Vitest, `<Symbol>`-Komponente) passen nicht —
übertragen wird das Prinzip:

| Relay / Insilo | Wings |
|---|---|
| `web/src/styles/global.css` bzw. `frontend/app/globals.css` | `static/wings.css` — schon heute die Datei nur für Wings, die kein Upstream-Sync anfasst; lädt nach `static/style.css` |
| `web/ci/` | `ci/` im Wurzelverzeichnis — **nicht** unter `static/`, das der Server öffentlich ausliefert |
| `scripts/ci-holen.mjs` (Node) | `scripts/ci-holen.mjs` — Node, weil die Action `stand` im CI `node <frontend>/scripts/ci-holen.mjs` aufruft; Node ist in Wings schon Entwicklungswerkzeug (ESLint, `package.json`) |
| Wachen in Vitest (`ci-stand`, `kennungen`, `symbole`) | Wachen in pytest (`tests/test_ci_stand.py`, `test_ci_kennungen.py`, `test_ci_symbole.py`), gestartet mit `./scripts/test.sh` |
| `<Symbol>` aus `lib/symbole.ts` | `li('name')` aus `static/icons.js`, erzeugt aus `ci/marke/icons/ui/` |
| Rundgang mit `@playwright/test` | Rundgang mit Playwright für Python — wie `tests/browser_smoke.py` schon heute |

## Die Kernfrage: Wie viel Umbau verträgt der Upstream-Abgleich?

Was die Messung sagt (`BESTAND.md` §6, §7):

1. **Das CSS ist schon weit vom Upstream weg, und der Upstream bewegt es wenig.**
   Wings hat `style.css` gegenüber der Abzweigbasis stark umgeschrieben; der
   Upstream hat die Datei seit der letzten Sync-Runde nur in wenigen Commits
   berührt. Portiert werden laut `UPSTREAM_SYNC.md` fast nur Fehlerbehebungen
   in `api/` und JS-Logik, kaum CSS. → **Token und Optik umzubauen kostet im
   Sync wenig.**
2. **Teuer sind die Tests.** Mehrere hundert Testdateien lesen `style.css`
   oder `index.html` als Text (Selektor, Token-Name, Markup als Zeichenkette),
   und fast alle kamen mit dem Upstream. Jeder umbenannte Selektor, jede
   umbenannte Variable bricht sie — und jeder spätere Port eines solchen
   Upstream-Tests stößt wieder darauf.
3. **Teuer sind auch Klassennamen in Markup und JS.** `index.html` und die
   JS-Dateien bauen das Markup mit Upstream-Klassen; der Upstream ändert
   `index.html` deutlich öfter als `icons.js`. Ein Wechsel auf CI-Klassen
   (`btn btn-primaer`, `feld` …) in Upstream-Markup würde jeden Port in diesen
   Dateien zur Handarbeit machen.
4. **Viele dieser Tests sind heute schon rot**, und die Workflows hören auf
   `master`, Wings arbeitet auf `main` — in GitHub läuft für Wings-PRs keine
   Testsuite (§6). Eine Wache wacht nur, wenn ihr Workflow auf `main` läuft.

Daraus der Vorschlag: **Schichtmodell.** Wings übernimmt das CI vollständig in
einer eigenen Schicht und fasst die Upstream-Schicht nur an, wo es nicht anders
geht.

| Schicht | Datei | Was darin passiert |
|---|---|---|
| CI | `static/wings.css` | Token-Block wörtlich `tokens/app.css`; jeder getragene `AM-`/`HB-`-Baustein wörtlich; Wings' Eigenes unter der eigenen Kennung. Geprüft mit `ci/werkzeug/bauteile.py static/wings.css --ohne-md` |
| Brücke | `static/style.css`, `:root` und `:root.dark` | Die Upstream-Namen (`--accent`, `--text`, `--muted`, `--border` …) bekommen ihren Wert **aus** `--am-*`, in **einem** Block statt fester Werte. Alle Upstream-Regeln, die sie lesen, bleiben, wie sie sind |
| Upstream | übriges `style.css`, `index.html`, JS | bleibt; geändert nur, wo eine Regel es verlangt (Rot, Schatten, Hauptaktion …), und dann mit Wert aus `--am-*` statt neuem Hex-Wert |

**Der Haken: Die Brücke ist ein Alias**, und das CI sagt in T2 ausdrücklich
„keine Aliasse“ (zwei Namen für einen Wert sind die zweite Wahrheit). Rocket
und Insilo durften ihre Namen behalten, weil sie ihre eigenen waren; Wings'
Namen gehören dem Upstream. Die Brücke braucht deshalb einen Eintrag mit
Entscheidung (E2). Die Gegenrichtung — jede `var(--accent)` in Upstream-CSS
und -JS durch `var(--am-handlung-ruhend)` ersetzen — hält T2 ein, bricht aber
die meisten der gekoppelten Upstream-Tests und jeden späteren CSS-Port.

## Etappen

Wie bei Relay; jede Etappe ein PR auf `claude/…`.

| # | Etappe | Inhalt | Upstream-Last |
|---|---|---|---|
| 0 | **Bestandsaufnahme** | `scripts/ci/bestand.py`, `docs/ci/BESTAND.md`, dieser Plan | keine |
| 1 | **Token** | Token-Block wörtlich in `wings.css`; Brücke in `style.css` (E2); Dunkel: CI schaltet `html.dunkel`, Wings `.dark` — an den Stellen, die das Thema setzen (Inline-Skripte in `index.html` und `share.html`, `boot.js`), wird zusätzlich `dunkel` gesetzt (E3); feste Hex-Werte in Wings' eigenen Dateien raus; Kontrast hell und dunkel nachrechnen. Ziel: `app-abgleich.py` meldet für den Block nichts mehr | klein: eine Stelle in `style.css`, drei Zeilen Theme-Code |
| 2 | **Regeln** | Sie-Form und „AI“ im deutschen Text (R3, Wache wie Relays `wording`); Knöpfe: eine Hauptaktion je Ansicht, Rot nur für Löschen mit Objekt (R1, G2); Schatten nur für Schwebendes (R6); Bewegung auf die drei CI-Dauern und `--am-kurve` (T6); Modell- und Bausteinnamen aus dem Fließtext (wie IN-R4/RL-R4); Name der Anwendung in der Oberfläche (E5) | mittel: `i18n.js` `de` ist Wings' eigene Pflege (`UPSTREAM_SYNC.md`: i18n-Batches werden nicht übernommen); CSS-Regeln einzeln |
| 3 | **Zeichen** | `static/icons.js` wird aus `ci/marke/icons/ui/` erzeugt; die Aufrufe `li('lucide-name')` bleiben über eine Namenstafel, damit Upstream-Ports nicht brechen; die Zeichen, die dem Set fehlen, kommen per CI-PR über `icons-erzeugen.py`; Inline-`<svg>` und Emoji als Zeichen raus (R2, G4); Größen 16/20/24/40, Strich 1,5; Favicon und App-Icon mit der **Feder** (R5, G7 — schon entschieden) | `icons.js` klein; Inline-SVG in `index.html` und JS mittel |
| 4 | **Kennungen + Bausteine** | eigene Vorsilbe in `bauteile.py` (CI-PR, E1); jeder Abschnitt in `wings.css` mit Kennung; getragene `AM-`/`HB-`-Bausteine wörtlich; Upstream-Oberflächen, die wie ein CI-Baustein aussehen sollen, bekommen einen eigenen Abschnitt, der die Upstream-Selektoren mit CI-Werten zeichnet (E4); Wings' Eigenes (Stimm-Modus, Aktivitätszeile, Einfach/Erweitert, Markenzeile) unter der eigenen Kennung; was andere Apps brauchen könnten, als Vorschlag `CI ← App` | keine in `style.css`, wenn E4 wie empfohlen |
| 5 | **CI-Kopie + Wachen** | `ci/` mit `stand.json`, `scripts/ci-holen.mjs`; pytest-Wachen für Kopie, Token-Block, Bausteine, Kennungen, Zeichen; Zeile in `werkzeug/apps.json` mit `css: static/wings.css` und eigenem Geheimnis (wie `RELAY_TOKEN`, weil `bayerhazard/*`) — CI-PR; Workflow auf `main`, der die Wachen fährt (E6); Regel in `AGENTS.md` | keine |
| 6 | **Grundgerüst** | G1–G8 für Wings: Spalte 240, Kopfecke mit Wortmarke und Name (R4, HB-MARKE), Kopfleiste und Profil (HB-KONTO) statt Fuß in der Navigation, Seitentitel 28, Tab-Titel „Seite · Wings“, Handy mit unterer Leiste (G5); Einfach/Erweitert und die Rail einordnen | hoch: Hülle und Navigation sind Upstream-Markup — eigener Abgleich vor der Etappe |
| 7 | **Rundgang im Browser** | jede Seite hell und dunkel, Desktop und Handy, mit Lageprüfung wie bei Relay; Grundlage `tests/browser_smoke.py` (startet `server.py` ohne Agent). Ob axe mitprüft, ist eine Abhängigkeitsfrage (`AGENTS.md`: keine neuen Abhängigkeiten ohne Begründung) | keine |

Die Stimm-Pipeline (`AGENTS.md`, „Fallstricke“) bleibt in jeder Etappe
unberührt; wo eine Etappe `boot.js` oder `ui.js` anfasst, läuft die
Prüfung der Barge-in- und TTS-Logs mit.

## Zu entscheiden (Kai)

| # | Frage | Vorschlag |
|---|---|---|
| E1 | Kennung für Wings' Eigenes | **`WG-`** (Wings), zwei Buchstaben wie `RK-`, `IN-`, `RL-`. Alternative `WI-` |
| E2 | Brücke von den Upstream-Namen auf `--am-*` (gegen T2) | **beide**: ein Brückenblock in `style.css` als dokumentierte Ausnahme für den Fork, mit Zuordnungstabelle in `medien/app.md`; neue Wings-Regeln lesen nur `--am-*`. Eintrag `WG-T2` im CI |
| E3 | Dunkelmodus: `.dark` (Upstream) neben `dunkel` (CI) | beide Klassen an den drei Stellen setzen, die das Thema bestimmen; kein Umbenennen der Upstream-Regeln |
| E4 | Upstream-Oberflächen (Knöpfe, Dialoge, Felder): CI-Klassen ins Markup oder CI-Optik auf Upstream-Selektoren | **CI-Optik auf Upstream-Selektoren** in eigenen `WG-`-Abschnitten; CI-Klassen nur in Wings' eigenem Markup. Eintrag im CI, weil diese Abschnitte nicht wörtlich `bauteile/` sind |
| E5 | Name in der Oberfläche: „Hermes“ steht im deutschen Text oft, „Wings“ kaum (`BESTAND.md` §3a); R4 verlangt Wortmarke + Name der Anwendung | „Wings“ für die Anwendung, „Hermes“ nur, wo der Agent gemeint ist — in Etappe 2 |
| E6 | Workflows hören auf `master` | eigener Workflow für die CI-Wachen auf `main` (Etappe 5); die rote Testsuite ist ein eigenes Thema außerhalb dieses Anschlusses — Vorschlag: getrennt sichten |

Nach den Entscheidungen entsteht der Abschnitt „Wings“ in der CI-`ABGLEICH.md`
(Befund, Empfehlung, Entscheidung je Eintrag, wie bei Relay) als erster CI-PR.
