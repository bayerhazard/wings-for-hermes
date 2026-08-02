# Upstream-Sync: Hermes WebUI → Wings for Hermes

> Dieser Leitfaden dokumentiert, worauf der Fork basiert, welchen Stand Wings hat
> und wie bei einem neuen Hermes-WebUI-Release der Sync-Check abläuft.
> **Zweck:** Wings funktional NICHT verändern — nur bekannte Fehlerbehebungen und
> klar bewertete Features aus `nesquena/hermes-webui` übernehmen.

---

## 1. Worauf der Fork basiert

| Fakt | Wert |
|------|------|
| Upstream-Repo | `nesquena/hermes-webui` |
| Abzweigpunkt (Code-Stand) | upstream-Commit `001d7985` (2026-07-13) |
| Fork-Root-Commit | `e83c683f` "Wings for Hermes v1.0.0" (2026-07-20) |
| History-Typ | **Squash-Snapshot** — keine gemeinsame History mit upstream |

### ⚠️ Korrektur der früheren Annahme

Das Commit-Message des Fork-Roots behauptet "fork of hermes-webui **0.50.43**".
**Das ist falsch.** Messung über exakte Blob-Hashes mehrerer Kerndateien:

- `api/streaming.py`, `api/shares.py` matchen upstream `001d7985` (13.07.) **exakt**
- 11/20 Kern-Dateien identisch mit `001d7985`, nur 1/20 mit `master`/`exp-v0.52.158`
- v0.50.43 ist nur 670 Zeilen in `streaming.py`; der Fork hat ~10.900

**Konsequenz:** Fixes, die **vor dem 13.07.2026** im Upstream erschienen, sind
bereits im Fork enthalten (u.a. #5990, #5940, #5723). Nur Fixes **nach dem
13.07.** sind überhaupt zu portieren.

---

## 2. Stand von Wings

| Stand | Wert |
|-------|------|
| Aktuelle Wings-Version | **v1.9.7** (deployed 2026-08-02) |
| Image | `ghcr.io/bayerhazard/wings-for-hermes:1.9.7` |
| Olares-Source | `market.AImighty` |
| Baseline | upstream `001d7985` (13.07.2026) + 9 portierte Fixes |

### Bereits portierte Fixes (v1.9.7)

| Fix | Inhalt | Bereich |
|-----|--------|---------|
| 🔴 #6174 | Public-Share-Media-LFI/XSS gehärtet (Path-Allowlist, MIME, Magic-Bytes, SVG-Sanitize) | Security |
| 🔴 #6372 | `.ts`/`.tsx` als `text/plain` statt Skript (XSS) | Security |
| 🔴 #5797 | Atomic config.yaml-Writes (crash-sicher) | Security |
| #6527 | SSE-Relay schließt bei `apperror` (hing vorher) | Bugfix |
| #6390 | Scroll-Position bleibt bei Stream-Settlement stabil | Bugfix |
| #6083 | Neue Chats nicht mehr unstartbar (LRU-Grace-Window) + PW-Autofill-Schutz | Bugfix |
| #6117 | Stale Approval-Badge wird korrekt geleert | Bugfix |
| #6323/#6309 | Terminal-Error: Turn-Duration + Tool-Row-Seal | Bugfix |
| #6040 | Gateway-Approvals nach Run-ID geroutet (großer Architektur-Batch) | Bugfix |

### Bereits im Fork enthalten (vor Abzweigpunkt, NICHT portieren)

- #5990 (False "No response" nach Tool-Call), #5940 (Failed-Turn-Error),
  #5723 (Stale-Busy-Cleanup)

### Fork-seitig bewusst anders gelöst

- **#6196** (Reload bevorzugt stale Cache): Wings hat den Service Worker in
  v1.7.13 durch einen No-op-Cache-Clearing-SW ersetzt → das Problem existiert
  dort nicht. Kein Port nötig.

---

## 3. Sync-Check bei einem neuen Upstream-Release

### 3.1 Vorbereitung

```bash
cd wings-for-hermes
git fetch upstream master
# Aktuellen Abstand messen:
git rev-list --count <letzter-port-anchor>..upstream/master
```

Letzter Port-Anker = der Tag/Commit, bis zu dem Wings die letzte Sync-Runde
abgeschlossen hat. Für v1.9.7 ist das der #6040-Stand (`d2a4ecb7`, 22.07.2026).

### 3.2 Kategorisieren (nicht automatisch übernehmen!)

Jede neue upstream-Änderung in eine von vier Klassen:

1. **Security-Fixes** → MÜSSEN rein (#-Issues mit LFI/XSS/Auth/Race)
2. **Bugfixes** → prüfen: betrifft er Wings-Logik? Meist ja → rein
3. **Features/UX** → bewerten: bringt es Wings-Vorteil? Sonst NICHT (Wings hat
   eigenes Design, eigene i18n, eigene Mobile-Logik)
4. **NICHT übernehmen** → i18n-Batches (Wings pflegt en/de separat),
   Docker/ctl/Test-Infra, Windows/Test-only, OpenCode-Go-Picker, neue App-Dateien

### 3.3 Was beim Portieren zu beachten ist (Fallen — alle live erlebt)

| # | Falle | Konsequenz |
|---|-------|-----------|
| 1 | **Fork = Squash-Root** — kein `git cherry-pick` möglich | Fixes **manuell** portieren: Diff des upstream-Fix-Commits holen, per `git show <commit> -- <file> \| git apply --check` prüfen, dann anwenden |
| 2 | **Abweichende Datei-Basis** — Patch-Kontext matcht nicht | Fork-Importe/Variablen manuell angleichen. Erlebt bei #6040: `uuid`, `AGENT_INSTANCES`, `unregister_stream_owner` fehlten im Fork |
| 3 | **Wings-Rebranding** — "Hermes"→"Wings", eigene Locales | i18n-Patches nur auf en+de anwenden (Fork hat keine weiteren Locales); Tests mit `ja:`/`zh:` auf `de:` umschreiben |
| 4 | **Fork-Design-Abweichungen** — Classic-Layout, Gauge-Card, Basic/Advanced, deaktivierter `_sessionHtmlCache` | Test-Assertions, die auf deaktivierte Fork-Features prüfen, sind pre-existing-Red (z.B. #5260-Cache-Guard). **Nicht** "fixen", sondern dokumentieren |
| 5 | **Neue upstream-Architektur-Dateien** | Wenn ein Fix neue Module voraussetzt (z.B. `api/agent_runtime.py`), erst prüfen, ob die abhängigen Funktionen im Fork existieren; sonst Tests an Fork-Signatur anpassen |
| 6 | **Fork-Signatur statt upstream-Signatur** | Tests, die auf neue Parameter (z.B. `external_runtime_owned`, `_agent_runtime_barrier_response`) zugreifen, auf den Fork-Weg umschreiben (`webui_gateway_chat_enabled`) |

### 3.4 Ablauf nach einem Port

1. **Tests:** `HERMES_HOME=/tmp/x HERMES_WEBUI_STATE_DIR=/tmp/y ./scripts/test.sh tests/test_<fix>_*.py`
2. **Regression:** alle bisherigen Fix-Tests zusammen (Erwartung: grün bis auf dokumentierte pre-existing)
3. **Smoke:** `.venv/bin/python3.12 server.py` → HTTP 200
4. **Fork-Kennzeichen prüfen:** Classic-Layout, Gauge-Card, Basic/Advanced, AImighty-Branding intakt
5. **Version bump** (alle 5 Stellen identisch, siehe §5)
6. **Deploy-Kette** (siehe §5)

---

## 4. Stand: Ist Wings mit dem aktuellen Upstream "sauber"?

**Bewertung 2026-08-02 (nach v1.9.7):**

- ✅ **Backlog-Fixes aus der letzten Sync-Runde sind vollständig übernommen.**
  Alle 9 identifizierten Fixes (3 Security + 6 Bugfixes inkl. #6040) sind
  portiert, getestet und deployed. Die im Backlog gelisteten Fixes
  (#5990/#5940/#5723) waren bereits im Fork enthalten.

- ⚠️ **Upstream hat sich seit unserem letzten Port weiterbewegt.** Seit dem
  22.07.2026 (#6040) sind **~115 upstream-Commits** dazugekommen (Stand
  master `320789ae`, 31.07.2026; neuester exp-Tag `exp-v0.52.158`). Diese
  **wurden noch nicht gesichtet** — es sind weitere Bugfixes darunter, z.B.:

  | Issue | Inhalt | Relevanz für Wings |
  |-------|--------|--------------------|
  | #6419 | Pending-Turn-Recovery vereinheitlicht | hoch (Streaming) |
  | #6481 | Pending-Turns-Materialisierung / Display-Ownership | hoch (Streaming) |
  | #6307 | Stale-File-Workspaces-Recovery | mittel |
  | #6416/#6389 | Stream-Teardown-Leak | hoch (Streaming) |
  | #6148 | Alias-Präfix-Model-Routing | mittel |
  | #6408/#6349 | Anchor-Prose/Composer-Fixes | mittel (UI) |
  | Gateway-Terminal-Persistence (#6642 u.a.) | Gateway-Error-Durability | hoch (Gateway) |

  **Fazit:** Wings ist *bezüglich der identifizierten Backlog-Fixes* sauber,
  aber *bezüglich des aktuellen upstream master* nicht vollständig — es gibt
  einen Rückstand von ~115 Commits, der bei der nächsten Sync-Runde zu sichten
  ist. Das ist der Normalzustand nach jedem Release; die Dokumentation in §3
  beschreibt, wie der nächste Check abläuft.

---

## 5. Deploy-Kette (bewährter Flow)

### 5.1 Version bump — alle 5 Stellen identisch

| Datei | Feld |
|-------|------|
| `wings/Chart.yaml` | `version:` |
| `wings/OlaresManifest.yaml` | `metadata.version` + `spec.versionName` + `upgradeDescription` |
| `OlaresManifest.yaml` (Root) | `metadata.version` + `spec.versionName` + `upgradeDescription` |
| `wings/values.yaml` | `image.tag` (**ohne** `v`-Präfix!) |
| Market-Source `functions/_apps.ts` | `metadata.version` + `upgradeDescription` |
| Market-Source `functions/_lib.ts` | CHARTS-Key `"wings-<ver>.tgz"` + frischer base64 |

### 5.2 Ablauf

```bash
# 1. Fixes + Version bump committen, pushen
git add . && git commit -m "vX.Y.Z: ..." && git push origin main

# 2. Tag (triggert GitHub Actions "Release & Docker" → ghcr.io Image <ver> OHNE v)
git tag vX.Y.Z && git push origin vX.Y.Z
# warten bis Actions grün; ghcr-Tag prüfen:
#   https://ghcr.io/v2/bayerhazard/wings-for-hermes/tags/list

# 3. Chart packen
helm package wings/

# 4. Market-Source: _apps.ts Version + _lib.ts CHARTS-Eintrag mit frischem base64
#    (NIE alten base64 wiederverwenden!)

# 5. Market deployen (Wrangler — Token nötig):
export CLOUDFLARE_API_TOKEN="cfut_..."
./node_modules/.bin/wrangler pages deploy functions/ --project-name=aimighty-market --branch main
# NIE --branch production (deploys sonst in preview, wenn production_branch=main)

# 6. Live prüfen:
curl -s https://aimighty-market.pages.dev/api/v1/appstore/info | ... wings
curl -s -o /dev/null -w "%{http_code}" https://aimighty-market.pages.dev/api/v1/applications/wings/chart

# 7. Olares: IMMER uninstall + install (nie upgrade bei values-Änderung!)
olares-cli market uninstall wings
olares-cli market install wings -s market.AImighty --compute-mode nvidia --watch

# 8. Domain: NUR wenn die App wirklich eine Custom-Domain braucht.
#    Wings läuft auf seiner Hash-Entrance; `expert` gehört aimqwen36llama!
```

### 5.3 Fallen beim Deploy

| Falle | Fix |
|-------|-----|
| Image-Tag mit `v`-Präfix | ghcr bekommt `1.9.7` (OHNE v) — Workflow-Match `pattern=v(\d+\.\d+(?:\.\d+)?),group=1` |
| `market upgrade` statt uninstall+install | Values-Freeze: ConfigMap bleibt auf Vorversions-Stand. IMMER uninstall+install |
| Custom-Domain nach Reinstall | Hash-Entrance ändert sich. Nur setzen, wenn wirklich nötig; **`expert` gehört aimqwen36llama** |
| Alter base64 wiederverwenden | Kann deploy-seitig korrupt werden → immer frisch encoden |
| Wrangler `--branch production` | Deploys in preview wenn production_branch=main → immer `--branch main` |
