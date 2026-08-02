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
| Aktuelle Wings-Version | **v1.9.8** (Sync-Runde 2026-08-02) |
| Image | `ghcr.io/bayerhazard/wings-for-hermes:1.9.8` |
| Olares-Source | `market.AImighty` |
| Baseline | upstream `001d7985` (13.07.2026) + 14 portierte Fixes |

### Portierte Fixes — Runde 1 (v1.9.7)

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

### Portierte Fixes — Runde 2 (v1.9.8)

| Fix | Inhalt | Bereich |
|-----|--------|---------|
| #6642 | Gateway-Terminal-Error-Persistenz + Recovery nach Run-ID (Erweiterung #6040) | Bugfix |
| #6488 | Qwen-Reasoning-Heuristik für prefixed Model-IDs (z.B. `al-qwen3.8-max-preview`) | Bugfix |
| #6529 | Trivial-Echo-Titel (pong/ok/cool) werden als Titel verworfen | Bugfix |
| #6419 | Pending-Merge-Helper: Session-Reconnect-Ordering + Dedupe | Bugfix |
| #6307 | Stale-File-Workspace-Recovery + Session-Lock-Registry (WeakValueDictionary) | Bugfix |

### Bewusst NICHT portiert (Runde 2 — mit Begründung)

| Fix | Inhalt | Grund |
|-----|--------|-------|
| #6481 | Verification-Evidence-Contamination (Streaming-Context) | **Baut auf #6283 auf** (Async-Delegation-Delivery, 2082 Zeilen, neues Modul `api/process_event_utils.py`), das im Fork **komplett fehlt**. Ein Port von #6481 allein crasht (Import-Abhängigkeit). Gemeinsamer Port = ~3800 Zeilen + neues Architektur-Modul + hohe Konfliktrisiken in `streaming.py`. Nutzen im Fork nicht belegt → **nicht übernommen** (Stand 2026-08-02) |
| #5844 (Verfeinerungen) | Terminal-Reaper-TOCTOU + fd-leak-Feinschliff | Fork hat ein **eigenes Terminal-Modell** (`_sub_lock`/`_backlog` statt upstream `self.output`). Die späteren Reaper-Patches (07d110a0, a31cdb77) passen nicht auf die Fork-Struktur. Basis-Reaper (#5844-Kern) ist bereits im Fork enthalten |
| #6389 | Stream-Teardown-Leak | **Im Fork bereits gelöst**: Der Fork hat kein `clear_offline_buffer()` im Teardown; `unregister_stream_owner` + `AGENT_INSTANCES.pop` sind schon vorhanden (teils durch #6040-Port-Kontext) |

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
abgeschlossen hat.
- Runde 1 (v1.9.7): `#6040`-Stand (`d2a4ecb7`, 22.07.2026)
- Runde 2 (v1.9.8): `#6307`-Stand (`41321f6f`, 29.07.2026)

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

**Bewertung 2026-08-02 (nach Runde 2 / v1.9.8):**

- ✅ **Runde 2 abgeschlossen:** Die ~115 Commits seit dem 22.07.2026 wurden
  gesichtet. 5 relevante Fixes portiert (#6642, #6488, #6529, #6419, #6307),
  jeweils mit Tests (Gesamt: 587 passed, 45 skipped, 1 pre-existing #5260-Fail).
  #6481/#5844-Verfeinerungen/#6389 bewusst nicht übernommen (Begründungen in §2).

- ⚠️ **Upstream bewegt sich weiter.** Nach dem #6307-Stand (29.07.) sind weitere
  Commits dazugekommen (Stand master `320789ae`, 31.07.2026; neuester exp-Tag
  `exp-v0.52.158`). Noch **nicht gesichtete** Bereiche für die nächste Runde:

  | Issue | Inhalt | Relevanz für Wings |
  |-------|--------|--------------------|
  | #6481 | Verification-Evidence-Contamination | siehe §2 — blockiert durch fehlendes #6283 |
  | #6283 | Async-Delegation-Delivery (Grundlage für #6481) | hoch, aber 2082-Zeilen-Refactor |
  | #6148 | Alias-Präfix-Model-Routing | mittel |
  | #6408/#6349 | Anchor-Prose/Composer-Fixes | mittel (UI) |
  | #6457 | Reconnect-Transcript-Ordering | mittel (SSE) |
  | #6507 | Hard-Refresh-Session-Restore | mittel |

  **Fazit:** Wings ist bezüglich der in Runde 2 identifizierten Backlog-Fixes
  sauber und deployed. Der verbleibende upstream-Rückstand ist der
  Normalzustand; die nächste Runde startet beim #6307-Anker (`41321f6f`).

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
