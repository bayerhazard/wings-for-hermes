# Wings an das AImighty-CI — Etappenplan

Wings schließt sich an das CI an (`ska1walker/aimighty-ci`) wie Rocket, Insilo
und Relay: **Das CI ist die Quelle** für Token, Zeichen und Bausteine; Wings hält
einen Stand `ci-YY.M.n` als Kopie und prüft sich ohne Netz dagegen
(CI `STAND.md`, `ABGLEICH.md` Paket 4). Jede Etappe ist ein eigener PR.

Die Entscheidungen dazu hat Kai am 09.10.2026 getroffen. Sie stehen im
Abschnitt „Wings“ der CI-`ABGLEICH.md` (Einträge `WG-…`) und unten unter
„Entschieden“.

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
- **Wings' Eigenes trägt die Kennung `WG-`** (CI `ABGLEICH.md` WG-K).
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

Daraus das **Schichtmodell** (entschieden mit WG-T2, WG-T3, WG-B1): Wings
übernimmt das CI vollständig in einer eigenen Schicht und fasst die
Upstream-Schicht nur an, wo es nicht anders geht.

| Schicht | Datei | Was darin passiert |
|---|---|---|
| CI | `static/wings.css` | Token-Block wörtlich `tokens/app.css`; jeder getragene `AM-`/`HB-`-Baustein wörtlich; Wings' Eigenes unter der eigenen Kennung. Geprüft mit `ci/werkzeug/bauteile.py static/wings.css --ohne-md` |
| Brücke | `static/style.css`, `:root` und `:root.dark` | Die Upstream-Namen (`--accent`, `--text`, `--muted`, `--border` …) bekommen ihren Wert **aus** `--am-*`, in **einem** Block statt fester Werte. Alle Upstream-Regeln, die sie lesen, bleiben, wie sie sind |
| Upstream | übriges `style.css`, `index.html`, JS | bleibt; geändert nur, wo eine Regel es verlangt (Rot, Schatten, Hauptaktion …), und dann mit Wert aus `--am-*` statt neuem Hex-Wert |

**Die Brücke ist ein Alias**, und das CI sagt in T2 ausdrücklich „keine
Aliasse“ (zwei Namen für einen Wert sind die zweite Wahrheit). Rocket und
Insilo durften ihre Namen behalten, weil sie ihre eigenen waren; Wings' Namen
gehören dem Upstream. Die Gegenrichtung — jede `var(--accent)` in Upstream-CSS
und -JS durch `var(--am-handlung-ruhend)` ersetzen — hielte T2 ein, bräche aber
die meisten der gekoppelten Upstream-Tests und jeden späteren CSS-Port.
Entschieden ist deshalb **WG-T2, Weg C**: die Brücke als enge Ausnahme, und
**Neues und Wings-Eigenes liest nur `--am-*`**. Eine Wache prüft, dass in
`wings.css` kein Upstream-Name steht; die Brücke wächst nie, sie schrumpft, wo
eine Upstream-Regel ohnehin angefasst wird.

## Etappen

Wie bei Relay; jede Etappe ein PR auf `claude/…`.

| # | Etappe | Inhalt | Upstream-Last |
|---|---|---|---|
| 0 | **Bestandsaufnahme** | `scripts/ci/bestand.py`, `docs/ci/BESTAND.md`, dieser Plan | keine |
| 1 | **Token** | Token-Block wörtlich in `wings.css`; Brücke in `style.css` (WG-T2); Dunkel: CI schaltet `html.dunkel`, Wings `.dark` — an den drei Stellen, die das Thema setzen (Inline-Skripte in `index.html` und `share.html`, `boot.js`), wird zusätzlich `dunkel` gesetzt, eine Wache prüft den Gleichlauf (WG-T3); feste Hex-Werte in Wings' eigenen Dateien raus; Kontrast hell und dunkel nachrechnen. Ziel: `app-abgleich.py` meldet für den Block nichts mehr | klein: eine Stelle in `style.css`, drei Zeilen Theme-Code |
| 2 | **Regeln** | Sie-Form und „AI“ im deutschen Text (R3, Wache wie Relays `wording`); Knöpfe: eine Hauptaktion je Ansicht, Rot nur für Löschen mit Objekt (R1, G2); Schatten nur für Schwebendes (R6); Bewegung auf die drei CI-Dauern und `--am-kurve` (T6); englische Reste im Block `de` übersetzt (WG-R3); Name: die App heißt „Wings“, der Agent wird umschrieben, technische Namen bleiben „Hermes“ (WG-R4) | mittel: `i18n.js` `de` ist Wings' eigene Pflege (`UPSTREAM_SYNC.md`: i18n-Batches werden nicht übernommen); CSS-Regeln einzeln |
| 3 | **Zeichen** | `static/icons.js` wird aus `ci/marke/icons/ui/` erzeugt; die Aufrufe `li('lucide-name')` bleiben über eine Namenstafel, damit Upstream-Ports nicht brechen; für die Zeichen, die dem Set fehlen, wird je Zeichen geprüft, ob eines des Sets dieselbe Bedeutung trägt, sonst kommen sie per CI-PR über `icons-erzeugen.py` (WG-Z1, offen); Inline-`<svg>` und Emoji als Zeichen raus (R2, G4); Größen 16/20/24/40, Strich 1,5; Favicon und App-Icon mit der **Feder** (R5, G7 — schon entschieden) | `icons.js` klein; Inline-SVG in `index.html` und JS mittel |
| 4 | **Kennungen + Bausteine** | Vorsilbe `WG-` in `bauteile.py` (CI-PR, WG-K); jeder Abschnitt in `wings.css` mit Kennung; getragene `AM-`/`HB-`-Bausteine wörtlich; Upstream-Oberflächen, die wie ein CI-Baustein aussehen sollen, bekommen einen `WG-`-Abschnitt, der die Upstream-Selektoren nur aus `--am-*` zeichnet; die Zuordnung „Upstream-Klasse → CI-Baustein“ kommt als Tabelle in die CI-`ABGLEICH.md` (WG-B1); Wings' Eigenes (Stimm-Modus, Aktivitätszeile, Einfach/Erweitert, Markenzeile) unter der eigenen Kennung; was andere Apps brauchen könnten, als Vorschlag `CI ← App` (WG-B2, offen) | keine in `style.css` |
| 5 | **CI-Kopie + Wachen** | `ci/` mit `stand.json`, `scripts/ci-holen.mjs`; pytest-Wachen für Kopie, Token-Block, Bausteine, Kennungen, Zeichen; Zeile in `werkzeug/apps.json` mit `css: static/wings.css` und eigenem Geheimnis (wie `RELAY_TOKEN`, weil `bayerhazard/*`) — CI-PR (WG-V2, offen: wer legt das Token an); eigener Workflow auf `main`, der nur die Wachen fährt (WG-V1); Regel in `AGENTS.md` | keine |
| 6 | **Grundgerüst** | G1–G8 für Wings: Spalte 240, Kopfecke mit Wortmarke und Name (R4, HB-MARKE), Kopfleiste und Profil (HB-KONTO) statt Fuß in der Navigation, Seitentitel 28, Tab-Titel „Seite · Wings“, Handy mit unterer Leiste (G5); Einfach/Erweitert und die Rail einordnen | hoch: Hülle und Navigation sind Upstream-Markup — eigener Abgleich vor der Etappe |
| 7 | **Rundgang im Browser** | jede Seite hell und dunkel, Desktop und Handy, mit Lageprüfung wie bei Relay; Grundlage `tests/browser_smoke.py` (startet `server.py` ohne Agent). Ob axe mitprüft, ist eine Abhängigkeitsfrage (`AGENTS.md`: keine neuen Abhängigkeiten ohne Begründung) | keine |

Die Stimm-Pipeline (`AGENTS.md`, „Fallstricke“) bleibt in jeder Etappe
unberührt; wo eine Etappe `boot.js` oder `ui.js` anfasst, läuft die
Prüfung der Barge-in- und TTS-Logs mit.

## Entschieden (Kai, 09.10.2026)

| # | Frage | Entscheidung | CI |
|---|---|---|---|
| E1 | Kennung für Wings' Eigenes | **`WG-`** | WG-K |
| E2 | Upstream-Namen und CI-Token | **Weg C:** ein Brückenblock in `style.css` gibt den Upstream-Namen ihre Werte aus `--am-*`; Neues und Wings-Eigenes liest nur `--am-*`, eine Wache prüft das | WG-T2 |
| E3 | Dunkelmodus | **`dark` und `dunkel` zugleich** an den drei Stellen, die das Thema setzen; eine Wache prüft den Gleichlauf | WG-T3 |
| E4 | Upstream-Oberflächen | **CI-Optik auf Upstream-Selektoren** in `WG-`-Abschnitten, nur aus `--am-*`; CI-Klassen nur in eigenem Markup | WG-B1 |
| E5 | Name in der Oberfläche | **App „Wings“, Agent umschrieben, technische Namen „Hermes“** | WG-R4 |
| E6 | Prüfungen in GitHub | **eigener Workflow für die CI-Wachen auf `main`**; die rote Testsuite wird getrennt gesichtet (eigene Aufgabe); erst wenn sie grün ist, hören die Upstream-Workflows auf `main` | WG-V1 |
| F1–F4 | Zuordnung der Brücke (vor Etappe 1) | Bedienränder `--am-rand-betont-farbe`, Auswahl `--am-auswahl-flaeche`, Dichte 1,1 wie das CI, Eingabefeld des Chats `--am-radius-gross` | WG-T2 |
| F5 | Grundgrad | **16 px fest**; die Schriftgrößen-Einstellung ändert nur die Lesetexte über ihre Variablen | WG-T4 |

## Noch offen

| CI | Frage | Wann |
|---|---|---|
| WG-Z1 | die Zeichen, die dem Set fehlen (`BESTAND.md` §5a) | vor Etappe 3 |
| WG-B2 | Stimm-Modus, Aktivitätszeile, Einfach/Erweitert als CI-Bausteine | nach Etappe 4 |
| Paket 5 | Grundgerüst für Wings | eigener Abgleich vor Etappe 6 |
| WG-V2 | wer das Token für die Action `stand` anlegt | vor Etappe 5 |

Der Abschnitt „Wings“ steht im CI-PR `ska1walker/aimighty-ci#33`.
