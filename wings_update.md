# wings_update.md — Upstream-Sync-Betriebsanleitung (lebendes Dokument)

> **Zweck:** this file is the machine- and agent-readable contract for syncing
> `nesquena/hermes-webui` → `bayerhazard/wings-for-hermes`. It replaces manual
> archaeology: every sync round starts here, ends with a release, and updates
> the state block below. `UPSTREAM_SYNC.md` remains as historical record
> (Runden 1–3, manuelle Port-Phase).

## 0. Maschinenlesbarer Zustand

```yaml
upstream_repo: nesquena/hermes-webui
upstream_anchor: e168b67e          # exp-v0.52.264 — Vorfahre via -s ours Merge
upstream_anchor_date: 2026-08-26
wings_version: 26.9.6            # wird bei jedem Release aktualisiert
sync_mode: merge                   # AB ANKER: git merge upstream/<tag> (kein manuelles Portieren)
last_sync_round: 4
round4_outcome:
  ported: []                       # nichts zu portieren — einziger Fix #6826 = SKIP (Klasse 4)
  skipped: ["#6826"]
  structural:
    - "anchor merge -s ours e168b67e (merge-base ist jetzt upstream-Code)"
    - "Voice-Backend extrahiert: api/wings_voice.py"
    - "Wings-CSS extrahiert: static/wings.css"
    - "node_modules + 9 Root-JS aus Git entfernt"
```

## 1. Preserve-Liste — Wings-only, NIEMALS bei Sync überschreiben

| Feature | Ort (Wings-Inseln) | Isolation | Sync-Behandlung |
|---|---|---|---|
| Voice-Backend (TTS sync+stream, Satz-Chunker, SSRF-Pinning, Rate-Limiter, Config-Resolution inkl. `HERMES_WEBUI_TTS_VOICE`) | `api/wings_voice.py` | ✅ eigenständig | Datei nie anfassen; nur `routes.py`-Hook (`from api.wings_voice import _handle_tts, _handle_tts_stream`) + Dispatch-Zeilen (`/api/tts`, `/api/tts/stream`) bei Upstream-Refactoren nachziehen |
| STT-Model-Pin (`HERMES_WEBUI_STT_MODEL`) | `api/upload.py` (`handle_transcribe`, ~Z. 442) | ❌ inline (klein) | Bei Konflikten: Env-Override-Block wieder einsetzen (Fallback `whisper-1` → Gateway-401) |
| Basic/Advanced-Mode — **CSS** | `static/wings.css` (Interface-Mode, Sidebar-Footer, Mode-Switch, Activity-Line, Micro-Interactions, **Relay-Design-Port**: Marken-Rampe/Hell/Dunkel-Tokens, `--am-header-h`, Basic-Shell 220px, Logo-Block, Footer-Zeilen, Session-Item-Styling) | ✅ eigenständig | Datei nie anfassen; nur `index.html`-Link nach style.css erhalten |
| Basic-Shell-Markup (Relay-Port) | `static/index.html` (`.wings-brand` Logo-Block in `#panelChat`, `.sidebar-footer` mit zwei `.wings-footer-row`, `.composer-center` im Composer-Footer, `#wingsModuleRow`-ID, Attach→Paperclip, `ctxGaugeTokens` init `display:none`, Inline-`<style>`-Block bereinigt) | ❌ inline | index.html-Konflikt: Brand-Block + Footer-Struktur + `#composerCenter` erhalten; Inline-Block darf keine Footer-Search-/Gauge-Maße mehr enthalten (leben in wings.css) |
| Basic/Advanced-Mode — **JS-Guards** | `static/panels.js` (`getUIMode/setUIMode/ADVANCED_PANELS`, switchPanel-Guards, **`_relocateGaugePill()`** — Gauge-Karte basic↔advanced zwischen `#composerCenter` und panel-head, New-Chat-Plus zwischen `#wingsModuleRow` (Modul-Reihe, erste Position) und Karte) | ❌ inline | panels.js-Konflikt: Guard-Blöcke manuell zurücksetzen; Liste mit `wings.css`-Selektoren synchron halten; `_relocateGaugePill`-Aufrufe (setUIMode, mq-Change, Init, DOMContentLoaded) behalten |
| Voice-Mode-Client (Barge-In, Auto-Read, SSE-Playback) | `static/boot.js` (voice-mode IIFE), `static/ui.js` (`_playOpenaiTts`, `stopTTS`) | ❌ inline (Runde-5-Kandidat für `static/wings_voice.js`) | Bei Konflikten: IIFE-Blöcke am Stück wieder einsetzen; Fallstricke 1–5 in `AGENTS.md` (Wings-Repo) beachten |
| Rebranding + i18n (en/de, AImighty-Texte) | `static/i18n.js` (Voll-Rewrite), `static/index.html` (Titel/Logo/Meta), Favicons/SVG/Fonts | ❌ schwerster Drift | i18n.js-Konflikte: Wings-Fassung behalten, Upstream-NEUE Keys per `git show <upstream>:static/i18n.js` ergänzen (nur `en`+`de`) |
| Design-Theme (Hanseatenblau/dark, Designguide) | `static/style.css` (Theme-Blöcke) + **kanonisch seit Relay-Port: `static/wings.css`** (`:root:not(.dark)`/`:root.dark`-Überschreiber gewinnen) | ❌ inline | Theme-Blöcke (`:root`, `:root.dark`, `--am-*`) bei Konflikten bevorzugen; Farbabstimmung immer in wings.css, nie in style.css |
| No-op Service Worker | `static/sw.js` | ✅ eigenständig | Upstream-SW-Änderungen sind KATEGORIE SKIP (begründet: stale-cache-Fix #6196 existiert nicht mehr) |
| Olares-Packaging | `wings/` (Chart), `OlaresManifest.yaml` (Root+Chart), `Dockerfile*`, `.github/workflows/`, `values.yaml` | ✅ 100 % Wings-only | von Upstream unberührt |
| Activityline-Modul | `static/activityline.js` | ✅ eigenständig | CSS dazu in `wings.css` |
| **Mobile-/iOS-PWA-Schicht** | `static/wings_mobile.js` (Safe-Area-Probe mit iOS-26.1-Fallback, Long-Press-Sheet), `static/wings.css` (Mobile-Block: Safe-Area-Variablen, Navbar, Touch-Ziele, Sheet, Drag), `index.html` (`viewport-fit=cover`, `color-scheme`, theme-color, Splash-Links, Titelbar-Reaktivierung), `static/splash-*.png` | ✅ eigenständig (außer index.html/boot.js unten) | Dateien nie von Upstream überschreiben. Bei `index.html`-Konflikten: Viewport-Zeile, Splash-Links, `.app-titlebar`-Mobile-Regel im Inline-Block erhalten. `boot.js`: nur die Wings-Helfer (`_canFollowSidebarDrag`, `_isSidebarCloseSwipeTarget`, `_finishSidebarDrag`, `_WINGS_SIDEBAR_CLOSE_TRIGGER`) wieder einsetzen; `test_wings_mobile.py` ist die Wings-Insel-Prüfung |
| **Projektordner nach Beacon** | `static/wings.css` (`.session-folder-header` + Zähler + `folder-aktiv`, Tokens `--am-raum-1/2/3`, `--am-ziel-zeiger`, `--am-radius-klein`), `static/sessions.js` → `_renderFolderHeader(key, group)` (Icon, Zähler, Aktiv-Zustand, Einzelklick-Umschalter statt `ondblclick`), `static/i18n.js` (`session_folder_unassigned`) | ❌ inline | `sessions.js`-Konflikt: den Block `const _renderFolderHeader=` bis `if(folderGrouping){` am Stück wieder einsetzen — Aufrufstelle `_renderFolderHeader(group.key, group)`. **`ondblclick` nie zurückbringen** (iOS synthetisiert es bei Touch nicht → Ordner ließen sich am iPhone nicht öffnen). Prüfung: `test_wings_sidebar.py` |
| **Marken-Lockup (Empty State)** | `static/wings-shield.svg` (Goldschild + weiße AI-Buchstaben), Inline-Block in `static/index.html` (`.wings-lockup`, `--wings-mark-size`, Faktor `.56`), `static/i18n.js` (`empty_title` = „Wings" in en+de) | ✅ Asset eigenständig, CSS inline | SVG nie „aufräumen": **keine doppelten Bindestriche im XML-Kommentar** (`--`) — sonst ist die Datei kein wohlgeformtes XML und ein `<img>` rendert stillschweigend nichts. Die Schriftgröße ist aus der Geometrie abgeleitet (AI-Kappe 59,599/150 = 39,73 %, Geist-Kappe 0,71 em → 0,56 × Markenhöhe); wer die Markenhöhe ändert, ändert die Schrift mit. Prüfung: `test_wings_brand.py` |
| **Brand-Lockup im Empty State** | `static/wings-shield.svg` (eigenständig), `static/index.html` Inline-Block (`.wings-lockup`, `--wings-mark-size`, Faktor 0,56), `i18n.js` (`empty_title` = „Wings" in en+de) | ✅ Asset eigenständig / ❌ Inline-Block | Inline-Block beim Konflikt neu einsetzen (er MUSS dort stehen, weil er `style.css` schlagen muss). Das SVG ist **XML** — im Kommentar keine doppelten Bindestriche, sonst rendert ein `<img>` still gar nichts. Prüfung: `test_wings_brand.py` |

**Grundregel bei Konflikten:** Wings-Insel (✅) gewinnen immer; Upstream-Code
gewinnt in Nicht-Inseln; bei ❌-Inline-Drift entscheidet die Preserve-Liste.

## 2. Skip-Liste — bewusst NICHT übernommene Upstream-Architektur

| Upstream-Modul/Fix | Grund | Wieder aufgreifen wenn |
|---|---|---|
| `api/agent_runtime.py`, `api/process_event_utils.py`, `api/subprocess_utils.py`, `api/media_snapshots.py`, `api/extension_sidecar_auth.py` (#6283-Async-Delegation-Architektur) | Wings hat eigenes, schlankeres Runtime-Modell; Port = ~3800 Z. + neues Architektur-Modul | Upstream-Feature wird für Wings-Nutzer Pflicht (z. B. Security-Fix darauf gebaut) |
| #6481, #7133/#7230, #7006, #7128, #7212, #7231, #6621, #6677 | bauen auf die fehlende Row-Identity-/Cache-Maschinerie auf oder sind Refactors funktionierender Wings-Pfade | Architektur-Adoption (Zeile 1) |
| **#6826 Fast-Regenerate (Runde 4)** | baut auf `plan_regeneration`/`regeneration_context`/`with_revision`-Fence auf — **existiert in Wings nicht** (Wings hat eigenen Retry-Pfad in `api/session_ops.py`); Port = komplettes Subsystem, Nutzen null | Wings-Regenerate zeigt reales Performance-Problem → dann Subsystem-Adoption als eigenes Projekt |
| Upstream-SW-Cache-Änderungen (`static/sw.js`) | Wings betreibt No-op-SW (bewusst, #6196-hinfällig) | nie |
| Upstream-Locales `ja/zh/...` | Wings pflegt nur en+de | nie |

## 3. Sync-Algorithmus (der neue Weg — ab Anker `e168b67e`)

```bash
cd wings-for-hermes
git fetch upstream --tags
NEW=$(git describe --tags upstream/master)        # z. B. exp-v0.52.271
git merge upstream/master -m "sync: upstream <NEW>"
#   → Konflikte NUR in Wings-angefassten Dateien (Preserve-Liste ❌-Einträge)
#   → Wings-Inseln (wings_voice.py, wings.css, wings/, activityline.js) bleiben unangetastet
```

Konflikt-Lösungsreihenfolge pro Datei:
1. **Preserve-Liste §1** konsultieren — Wings-Insel-Code hat Vorrang, Upstream-NEUES
   (neue Funktionen/Endpoints) wird daneben übernommen.
2. `static/i18n.js`: Wings-Fassung als Basis, Upstream-Neukeys (nur `en`,`de`) ergänzen.
3. `api/routes.py`: Upstream-Struktur + Wings-Hook/Dispatch-Zeilen wieder einsetzen.
4. Nach jedem Merge: `python3 -m py_compile` über `api/`, dann Voice-Suite + Fix-Tests
   (§6 Befehle), Failset gegen Vorher-Baseline vergleichen (`/tmp/fail_*.txt`-Muster).
5. Merge-Commit ins Repo pushen; Release-Kette §5.

**Warum das funktioniert:** der `-s ours`-Anker-Merge (`08869990`) macht den kompletten
Upstream bis `e168b67e` zum Vorfahren. `git merge-base HEAD upstream/master` =
Upstream-Stand → 3-Way-Merge rechnet nur noch Deltas seit dem letzten Sync.

**Einmalige Folgen des Anker-Merges (bewusst):** alle Upstream-Änderungen 13.07.–26.08.
gelten als „adjudiziert" (portiert lt. Runden 1–3 oder skippt lt. §2). Git wird sie
nie erneut anbieten. Neue Upstream-Änderungen an Modulen, die Wings nie hatte
(z. B. `agent_runtime.py`), erscheinen als neue Dateien — dann §2 prüfen.

## 4. Klassifizierung neuer Upstream-Änderungen (Regeln bleiben)

1. **Security** (LFI/XSS/Auth/Race) → MÜSSEN rein; falls auf fehlender Architektur:
   §2-Eintrag mit Zwangsumweg prüfen (nie still überspringen).
2. **Bugfix** → betrifft er Wings-Logik? Meist ja → rein (per Merge automatisch).
3. **Feature/UX** → bewerten; Wings-Design (Basic-Mode, Theme) darf nicht aufbrechen.
4. **SKIP** → i18n-Batches (außer en/de-Keys), Docker/CI/Test-Infra upstream-seitig,
   Windows-only, Module von §2.

## 5. Release-Kette (unverändert bewährt)

Versionsschema `YY.M.<n>` (Monat ohne führende Null, Zähler pro App,
Monatsreset). **26.9.1 = erster Release im neuen Schema + erste Runde mit
Anker-Merge.** Alle 5+ Stellen identisch:

| Datei | Feld |
|---|---|
| `wings/Chart.yaml` | `version:` + `appVersion:` |
| `wings/OlaresManifest.yaml` | `metadata.version` + `spec.versionName` + `upgradeDescription` |
| `OlaresManifest.yaml` (Root) | dito |
| `wings/values.yaml` | `image.tag` (OHNE `v`-Präfix) |
| Market `_apps.ts` | `metadata.version` + `upgradeDescription` |
| Market `_lib.ts` | CHARTS-Key `wings-<ver>.tgz` + FRISCHES base64 |

```bash
# 1. yaml.safe_load() über BEIDE Manifeste VOR helm package (Quote-Falle!)
# 2. git add . && git commit -m "v26.9.1: …" && git push origin main
# 3. git tag v26.9.1 && git push origin v26.9.1     # CI → ghcr (Tag OHNE v)
# 4. helm package wings/
# 5. Market-Source: _apps.ts + _lib.ts (frisch base64), wrangler deploy --branch main
# 6. olares-cli market uninstall wings && olares-cli market install wings -s market.AImighty --watch
#    (IMMER uninstall+install; market upgrade blockiert bei 26.0x.x Altformat)
# 7. olares-cli settings apps domain set wings wings --third-level wings
```

## 6. Verifikations-Befehle

```bash
# Voice-Suite (Failset muss gegen Baseline identisch sein):
HERMES_HOME=/tmp/x HERMES_WEBUI_STATE_DIR=/tmp/y ./scripts/test.sh \
  tests/test_issue4982_openai_tts.py tests/test_issue_tts_stream.py \
  tests/test_issue3510_elevenlabs_tts.py tests/test_issue2931_edge_tts_endpoint.py \
  tests/test_issue3582_tts_content_length.py tests/test_french_voices_tts_allowlist.py
# Sync-Basis-Check:
git merge-base HEAD upstream/master   # == letzter Sync-Commit
git log --oneline $(git merge-base HEAD upstream/master)..upstream/master | wc -l  # neue Upstream-Commits
# Live-Rauchtests nach Deploy:
curl -s -o /dev/null -w "%{http_code}\n" https://wings.aimighty.olares.de/static/wings.css
curl -s -X POST https://wings.aimighty.olares.de/api/tts -H 'Content-Type: application/json' \
  -d '{"text":"Test","engine":"openai"}' -o /tmp/t.mp3 -w "%{http_code} %{size_download}\n"
```

## 7. Historie

| Runde | Datum | Upstream-Stand | Modus | Ergebnis |
|---|---|---|---|---|
| 1 | 2026-07-22 | `d2a4ecb7` | manuell portiert | v1.9.7, 9 Fixes |
| 2 | 2026-08-02 | `41321f6f` | manuell portiert | v1.9.8, 5 Fixes |
| 3 | 2026-08-25 | `3b9c632a` | manuell portiert | v26.08.9, 13 Fixes + Agent 0.20.5 |
| **4** | **2026-09-06** | **`e168b67e`** | **ANKER-MERGE** | **#6826 skippt; Struktur: wings_voice.py, wings.css, Hygiene** |
| 5a | 2026-09-06 | — (Wings-only) | Relay-Design-Port | Basic-Shell nach Relay-One: Tokens (Rampe/Hell/Dunkel), Sidebar 220px, Logo-Block (ModuleLogo-SVG, Klick→Settings), Filter-Pille 34px, Modul-Icons 32px/16px/stroke-1.5, Session-Items wie folder-item; `li()` +stroke-Parameter; NICHT released (Screenshots: wings-relay-*.png) |
| 5c | 2026-09-06 | — (Wings-only) | Dark-Flächen + Plus-Umzug | Dark: Sidebar b-150 / rechte Seite inkl. composer-box einheitlich b-100, Such-Pille b-100; New-Chat-Plus vom Composer in die Modul-Reihe (erstes Icon, Ghost-Stil wie Nachbarn); released als 26.9.3 |
| 5b | 2026-09-06 | — (Wings-only) | Composer-Cluster | Gauge-Footer-Pille aufgelöst: Karte komplett → `.composer-center` (absolut zentriert; Ring 18px + Modell-Pill r=999 ohne „Modell:"-Prefix + Token-Wert mono), New-Chat-Plus → `.composer-right` vor Mic, Attach→Paperclip (Plus-Kollision), Dropdown öffnet nach oben, Token-Empty-Hide (ui.js 2 Zeilen + init display:none), Mobile ≤480px: Cluster static/rechts + Tokens aus; Advanced unverändert (Rückverschiebung beweisen); NICHT released (Screenshots: composer-*.png) |
| 6a | 2026-09-16 | — (Wings-only) | M1 Safe-Area + M2 Navbar | `viewport-fit=cover` + `color-scheme` je Theme + theme-color auf Palette; `--wings-inset-*` = `max(env(),Fallback)`; Composer-/Footer-/Brand-Insets; Edge-Guard auf 44px-Navbar; Standalone-`100vh` (WebKit 254868); neue Wings-Navbar (Menü · Titel exakt zentriert 17px · Neu-Chat, 44px-Zeile, Safe-Top) über Reaktivierung der vorhandenen `#appTitlebar`; Sidebar-X auf die Brand-Zeile zentriert; `wings_mobile.js` mit env()-Probe + iOS-26.1-Fallback (nur iOS-Standalone, nur Hochformat); 2 Upstream-Tests auf die neue Cover-Intent umgeschrieben |
| 6b | 2026-09-16 | — (Wings-only) | M3 Composer + M4 Gesten | M3: Cluster links an das Paperclip (`.composer-left{flex:0 0 auto}` statt Freiraum-Fresser), Ring 20px **in** der 44px-Modell-Pille (pointer-events:none → Klick öffnet weiter das Dropdown), toter Wrapper aus; M4a: Edge-Follow (Sidebar hängt am Finger, nur in der installierten PWA — Safari-Tabs behalten das Schwellen-Öffnen) + Swipe-links-zum-Schließen (56px), Commit unabhängig vom Follow; M4b: Long-Press auf eine Nachricht → iOS-Bottom-Sheet, das **nur die real vorhandenen** `.msg-action-btn` spiegelt (kein erfundenes Verzweigen/Löschen), Escape/Scrim/Scroll schließen |
| 6c | 2026-09-16 | — (Wings-only) | M5 Touch + M6 PWA | M5: alle Ziele ≥44px (Modul-Icons 32→44, Such-Pille 34→44, Attach/Mikro 40→44, Session-Tabs 24→40), Such-Input 16px (killt den iOS-Fokus-Zoom bei gemessenen 13,1px), Message-Body 15px auf dem Phone, `@media (hover:none)` neutralisiert Sticky-Hover; M6: 7 iOS-Splash-Screens (solides #051729, pure Python/zlib); neues `tests/test_wings_mobile.py` (9 Assertions) |
| 6d | 2026-09-16 | — (Wings-only) | Projektordner nach Beacon + mobile Farbflächen | Ordnerzeile = Beacons `.huelle-nav-item`: 14px/400 ohne Versalien, führendes 18px-Icon (folder, „Nicht zugewiesen" = archive) stroke 1.75, 12px Abstand, 8/12 Polster, 40px Zielhöhe (44px Touch), 4px Radius, `--muted`, Hover `--active-wash`, aktiv gold+600 wenn die offene Sitzung drinliegt; Zähler rechts in Mono (nur > 0). `ondblclick` → Einzelklick über `pointerdown`/`pointerup` (≤8px), dazu `role=button`/`tabindex`/`aria-expanded`/Enter. Neu: Tokens `--am-raum-1/2/3`, `--am-ziel-zeiger:40px`, `--am-radius-klein` (Wings' Root ist 15px, `2.5rem` wären 37,5px). Mobil: Navbar und Composer-**Feld** auf `--sidebar` (Band bleibt `--chat-bg`), theme-color/manifest nachgezogen. i18n `session_folder_unassigned`. `tests/test_wings_sidebar.py` (9 Assertions). Live geprüft: Zähler = sichtbare Zeilen |
| 6e | 2026-09-16 | — (Wings-only) | Marken-Lockup im Chatfenster | Breite „AImighty"-Wortmarke (200×71, Paar hell/dunkel) + separate Zeile „Wings for Hermes" ersetzt durch ein Lockup: Schild `wings-shield.svg` (ein Asset für beide Themes, weiße AI auf Gold) + Wort „Wings". Schriftgröße **abgeleitet** statt geraten: AI-Kappe 59,599/150 = 39,73 % der Box, Geist-Kappe 0,71 em → 0,56 × Markenhöhe (80px → 44,8px). Gewicht 600, Satz −0,02em, seitlicher Abstand optisch kompensiert (SVG hat 13,3 % transparenten Rand). Mobil ≤640px gestapelt/zentriert, gleiche Größe. `alt=""` (das `<h2>` daneben nennt den Namen). `empty_title` → „Wings" (en+de). **Falle: doppelter Bindestrich im SVG-Kommentar macht die Datei ungültig, `<img>` bleibt leer.** `tests/test_wings_brand.py` (5 Assertions); `test_issue856`-Ordner-Test auf den Einzelklick-Vertrag umgeschrieben |
| 6f | 2026-09-16 | — (Wings-only) | Ordnerflucht + kein Fett | Chat-Titel stehen auf der Flucht des Ordnernamens: eigener Einzug `calc(--am-raum-3 * 2 + --wings-nav-icon)` statt der 4px aus `style.css:493` (die ließen den Chat 25px links vom Namen stehen); Unter-Sitzungen eine Stufe tiefer. Neues Token `--wings-nav-icon:18px` als eine Quelle für Symbolbreite und Einzug. Schriftgewichte: Chat-Titel 500 → 400, aktive Session und aktiver Ordner 600 → 400 — Auszeichnung nur noch über Farbe und Fläche, im ganzen Baum ist nichts fett. `test_wings_sidebar.py` um zwei Assertions erweitert |

