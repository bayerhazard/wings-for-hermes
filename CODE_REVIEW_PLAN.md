# Wings for Hermes — Code Review Plan

> **Status:** Dokumentiert, nicht ausgeführt
> **Erstellt:** 2026-07-29
> **Scope:** Vollständiger Code-Review des Wings for Hermes Forks (hermes-webui)

---

## Executive Summary

Wings ist ein **Olares-optimierter Fork von hermes-webui** (MIT, nesquena) mit **~4.1 MB handgeschriebenem Vanilla-JS** (15 Module), einem **Python-Backend** (63 api/ Module, 749-Zeilen server.py Shell) und **zero build tooling**. Der Code verwendet **keine Frameworks, keine ES-Module, keinen Bundler** — statische Dateien + stdlib HTTP server.

**Kritischste Erkenntnis:** Das Repo enthält **zwei divergente Frontend-Kopien** (root vs. `static/`). `static/` ist authoritative, root ist stale (initial commit frozen). Der `static/panels.js` Bug (fehlende `skin`-Variable) entstand durch Copy-Paste-Divergenz zwischen den beiden Bäumen.

---

## 1. Review-Scope & Prioritäten

| Priorität | Bereich | Begründung |
|-----------|---------|------------|
| **P0** | Frontend-Duplikation & Sync | Root/Static-Divergenz ist die Hauptquelle für Bugs wie den `skin`-Fehler |
| **P0** | `static/panels.js` Settings-System | Größte Datei (629 KB), komplexestes State-Management, letzter Bug hier |
| **P1** | SSE Streaming-Engine (`api/streaming.py`, `api/routes.py`) | Kernfunktionalität, Race-Conditions, Memory-Leaks |
| **P1** | Auth-System (`api/auth.py`, `api/passkeys.py`, `api/auth_oidc.py`) | Sicherheitskritisch, Cookie-Handling, Session-TTL |
| **P2** | Docker & Deployment (`docker_init.bash`, `Dockerfile`, `wings/templates/`) | Init-Container-Logik, UID/GID-Handling, Olares-Integration |
| **P2** | Helm-Chart & OlaresManifest | Version-Consistency, Resource-Requests, Ingress |
| **P3** | CSS/Theme-System (`static/style.css`) | 433 KB, Skin-Architektur, Theme-Flash-Prevention |
| **P3** | i18n (`static/i18n.js`) | Locale-Catalog-Konsistenz, Fallback-Handling |

---

## 2. Detaillierte Review-Items

### 2.1 P0 — Frontend-Duplikation (Root vs. `static/`)

**Problem:** Root-`boot.js`, `ui.js`, `panels.js`, `style.css`, `index.html`, `messages.js`, `i18n.js` sind stale Kopien vom Initial-Commit. `static/` hat 5+ Commits weiterentwickelt.

**Review-Fragen:**
- [ ] Kann root/ gelöscht werden ohne Seiteneffekte? (Dockerfile `COPY . /apptoo` inkludiert root, aber nichts referenziert es zur Runtime)
- [ ] Ist `.dockerignore` korrekt? (Sollte root-JS/CSS/HTML explizit ausschließen)
- [ ] Gibt es Tests die root-Dateien importieren? (tests/ prüfen)
- [ ] Sollte ein Pre-Commit-Hook oder CI-Gate root/static Sync erzwingen?

**Empfohlene Maßnahmen:**
1. **Root-Frontend-Dateien löschen** oder in `static/` verschieben (kein doppelter Source of Truth)
2. **`.dockerignore` erweitern:** `boot.js`, `ui.js`, `panels.js`, `style.css`, `index.html`, `messages.js`, `i18n.js` (root) explizit ausschließen
3. **CI-Gate:** Script das prüft ob root- und static-Kopien identisch sind, mit klarem Fehler wenn nicht

### 2.2 P0 — `static/panels.js` Settings-System (629 KB, 13k+ Zeilen)

**Kontext:** Größte Frontend-Datei, verwaltet Settings-Panel, Cron, Skills, Memory, Profiles. Der `skin`-Bug entstand durch Divergenz zwischen root/panels.js (hatte `const skin=...`) und static/panels.js (fehlte).

**Review-Fragen:**
- [ ] **State-Management:** `_settingsDirty`, `_settingsThemeOnOpen`, `_settingsSkinOnOpen` — sind diese konsistent mit dem tatsächlichen DOM-State?
- [ ] **Autosave-Pfade:** Appearance-Controls (theme/skin/fontSize) autosaven sofort, andere Settings nicht — ist das UX-konsistent dokumentiert?
- [ ] **Error-Handling:** `showToast(t('settings_save_failed')+e.message)` — wird `e.message` immer definiert sein? Was bei Network-Timeout?
- [ ] **Race-Conditions:** Mehrere schnelle Save-Calls hintereinander — wird der letzte gewinnen oder gibt es einen Abort/Debounce?
- [ ] **Memory-Leaks:** Event-Listener die nicht entfernt werden beim Panel-Wechsel?
- [ ] **Skin-Variable Fix-Verifikation:** Ist die auto-skin Ableitung (`wings-light`/`wings-dark` aus theme + prefers-color-scheme) in allen relevanten Pfaden (init, theme-change, system-theme-change) korrekt?

**Spezifische Code-Sections:**
- `saveSettings()` (Zeilen ~12330–12650): Kompletter Save-Flow
- `_applySavedSettingsUi()` (Zeilen ~11703–11786): Post-Save UI-Update
- `_resetSettingsPanelState()`, `_hideSettingsPanel()`, `_closeSettingsPanel()`: Panel-Lifecycle
- `_revertSettingsPreview()`: Was passiert bei "Discard"?

### 2.3 P1 — SSE Streaming-Engine (`api/streaming.py`, `api/routes.py`)

**Kontext:** 10,952 Zeilen streaming.py, 26,257 Zeilen routes.py. Kern der Anwendung.

**Review-Fragen:**
- [ ] **Memory-Management:** `STREAMS`, `STREAMS_LOCK`, `CANCEL_FLAGS`, `AGENT_INSTANCES` — werden diese bei Session-Ende/Abbruch korrekt bereinigt?
- [ ] **Thread-Safety:** `ThreadingHTTPServer` + shared state — gibt es Locks für alle kritischen Sections?
- [ ] **Error-Recovery:** Was passiert wenn der Agent-Prozess abstürzt mid-stream? Wird der Client korrekt benachrichtigt?
- [ ] **Backpressure:** Wenn der Client langsam liest, gibt es Flow-Control?
- [ ] **Compression:** `compression_anchor`, `compression_recovery` — sind die Recovery-Pfade robust?
- [ ] **Cancellation:** `CANCEL_FLAGS` — gibt es ein Timeout für stale Cancel-Flags?

### 2.4 P1 — Auth-System

**Review-Fragen:**
- [ ] **Cookie-Security:** `HttpOnly`, `Secure`, `SameSite` — korrekt gesetzt?
- [ ] **Session-TTL:** `_resolve_session_ttl()` — ist die Clamp-Logik [60s, 1 Jahr] sinnvoll?
- [ ] **Passkeys/WebAuthn:** Challenge-Handling, Credential-ID-Encoding, Origin-Validation
- [ ] **OIDC:** State-Parameter, PKCE, Token-Validation, Session-Fixation-Schutz
- [ ] **Password-Hashing:** Ist es bcrypt/argon2? Oder schwächer?
- [ ] **Public-Paths:** Sind `/login`, `/health`, `/favicon.ico` wirklich alle die public sein müssen? Gibt es vergessene Endpoints?

### 2.5 P2 — Docker & Deployment

**Review-Fragen:**
- [ ] **`docker_init.bash` UID/GID-Handling:** Auto-Detection-Logik (Priority 1: hermes-home, Priority 2: /workspace) — ist sie robust gegen fehlende Verzeichnisse?
- [ ] **Init-Container `agent-src`:** `cp -a /opt/hermes/. /agent-src/` — was wenn das Agent-Image zu alt ist und keine `/opt/hermes` hat?
- [ ] **Security:** `fix-kubelet-bypass` läuft mit `privileged: true` und `NET_ADMIN` — ist das notwendig? Kann es eingeschränkt werden?
- [ ] **Health-Check:** `HEALTHCHECK` im Dockerfile vs. `startupProbe`/`readinessProbe` im Helm-Chart — konsistent?
- [ ] **Resource-Limits:** `limits: cpu=4, memory=4Gi` — angemessen für einen Python-HTTP-Server?

### 2.6 P2 — Helm-Chart & OlaresManifest

**Review-Fragen:**
- [ ] **Version-Consistency:** `OlaresManifest.yaml` (root) = `wings/OlaresManifest.yaml` (byte-identical) = `wings/Chart.yaml` — wird das enforced?
- [ ] **Image-Tag:** `values.yaml` tag `v1.9.1` — existiert das Image wirklich auf GHCR? (Docker V2 Manifest, nicht OCI)
- [ ] **Entrance-Config:** `host: wings`, `port: 8787`, `openMethod: window` — korrekt?
- [ ] **Dependencies:** `hermesagent >= 1.0.0` — ist das die richtige Minimum-Version?

### 2.7 P3 — CSS/Theme-System

**Review-Fragen:**
- [ ] **Skin-Architektur:** `data-skin` Attribut vs. `.dark` Klasse — sind die CSS-Selektoren spezifisch genug?
- [ ] **Theme-Flash-Prevention:** Inline `<head>` Script — deckt es alle Edge-Cases ab (localStorage vs. Server-Settings)?
- [ ] **Skin-Liste:** `wings-light`, `wings-dark` in `commands.js`, `index.html`, `style.css` — synchron?
- [ ] **Unused CSS:** 433 KB — gibt es tote Regeln von entfernten Features?

### 2.8 P3 — i18n

**Review-Fragen:**
- [ ] **Locale-Coverage:** `de` Übersetzung für `settings_save_failed` — vorhanden?
- [ ] **Fallback:** Was passiert bei fehlendem Key? Fallback auf `en`?
- [ ] **Plurals:** Gibt es Plural-Forms für Sprachen mit komplexen Pluralregeln (ru, zh)?

---

## 3. Review-Methodik

### Phase 1: Statische Analyse (bereits teilweise durchgeführt)
- ESLint runtime-guard: `npm run lint:runtime`
- Ruff forward-lint: `python3 scripts/ruff_lint.py --diff origin/master`
- Ruff whole-tree: `python3 scripts/ruff_lint.py --all` (informational)
- Scope/undef-gate: `python3 scripts/scope_undef_gate.py`
- Python compileall: `python3 -m compileall -q api server.py bootstrap.py mcp_server.py tests scripts`

### Phase 2: Manuelle Code-Review
- **Pair-Review** der kritischen P0/P1 Bereiche
- **Diff-Review** der letzten 5 Commits (v1.7.13 → v1.9.2)
- **Cross-Reference** zwischen `static/` und root/ (Divergenz-Analyse)

### Phase 3: Dynamische Tests
- `./scripts/test.sh` (volle Test-Suite, 5 Shards × 3 Python-Versionen)
- Browser-Smoke-Test (Playwright)
- Docker-Smoke-Test
- **Spezifisch:** Settings-Save mit allen Theme/Skin-Kombinationen durchspielen

### Phase 4: Security-Review
- Cookie-Flags
- Auth-Bypass-Versuche
- Path-Traversal in Workspace-Browser
- XSS in Markdown-Rendering (`renderMd`)

---

## 4. Bekannte Issues & Risiken

| Issue | Risiko | Status |
|-------|--------|--------|
| Root/Static Divergenz | Bugs durch stale Kopien | **P0 — Fix erforderlich** |
| `static/panels.js` skin-Bug | Settings-Save komplett broken | **Fixed (uncommitted)** |
| 26k Zeilen routes.py | God-Object, schwer wartbar | Technical Debt |
| 13k Zeilen panels.js | Monolith, hohe Komplexität | Technical Debt |
| 433 KB style.css | Performance, Unused CSS | Technical Debt |
| Kein Build-Step | Kein Tree-Shaking, kein Minification | By Design |
| Docker V2 vs OCI Manifest | Olares app-service Kompatibilität | **Fixed in v1.9.2** |

---

## 5. Empfohlene Maßnahmen (kurzfristig)

### Sofort (vor v1.9.3 Release):
1. **Root-Frontend-Dateien löschen** — `boot.js`, `ui.js`, `panels.js`, `style.css`, `index.html`, `messages.js`, `i18n.js` aus root entfernen
2. **`.dockerignore` erweitern** — Root-JS/CSS/HTML explizit ausschließen
3. **CI-Gate für root/static Sync** — Script das bei PR prüft ob root-Dateien existieren (sollten nicht)
4. **Settings-Save Test** — Manuell durchspielen: Theme ändern → Skin auto-derived → Save → Reload → Verify

### Mittelfristig (v1.10.x):
5. **`panels.js` modularisieren** — In `settings.js`, `cron.js`, `skills.js`, `memory.js`, `profiles.js` aufteilen
6. **`routes.py` modularisieren** — Route-Handler in separate Module extrahieren
7. **CSS-Audit** — Unused CSS identifizieren und entfernen

### Langfristig:
8. **ES-Module Migration** — Von script-tags zu ES-Modules für bessere Tree-Shaking
9. **Build-Step evaluieren** — Esbuild/Rollup für Minification (optional, nicht zwingend)
10. **TypeScript evaluieren** — Für die größten Module (panels.js, messages.js, sessions.js)

---

## 6. Review-Checkliste (für den Reviewer)

### Vor dem Review:
- [ ] Branch ist auf neuestem Stand (`git pull origin main`)
- [ ] Alle lokalen Änderungen committed oder gestashed
- [ ] Tests laufen lokal (`./scripts/test.sh`)
- [ ] Lint-Gates laufen (`npm run lint:runtime`, `python3 scripts/ruff_lint.py --all`)

### Während des Reviews:
- [ ] Jede P0-Frage beantwortet und dokumentiert
- [ ] Jede P1-Frage mindestens oberflächlich geprüft
- [ ] Code-Referenzen (Zeilennummern) für jedes Finding notiert
- [ ] Screenshots/Logs für UI-Findings angehängt

### Nach dem Review:
- [ ] Findings nach Schweregrad klassifiziert (Blocker / Major / Minor / Nit)
- [ ] Blocker vor Merge behoben
- [ ] Major-Issues als Tickets erfasst
- [ ] Minor/Nit-Issues optional im selben PR oder separat

---

## 7. Offene Fragen (vor Review-Start klären)

1. **Review-Tiefe:** Soll der Code Zeile für Zeile durchgegangen werden (sehr zeitaufwändig) oder die Architektur und kritischen Pfade fokussiert?

2. **Root/Static-Duplikation:** Können root-Frontend-Dateien jetzt gelöscht werden oder werden sie noch für irgendetwas benötigt?

3. **Testing:** Soll die volle Test-Suite laufen oder nur die relevanten Shards?

4. **Release-Timing:** Ist v1.9.3 der nächste Release oder gibt es noch andere Features die vorher rein müssen?

5. **Review-Output:** Soll ein Review-Dokument erstellt werden (Markdown) oder direkt Code-Änderungen vorgeschlagen werden?

---

## Anhang: Datei-Struktur Übersicht

```
wings-for-hermes/
├── server.py                 # HTTP Shell (749 lines)
├── bootstrap.py              # Launcher
├── api/                      # 63 Backend-Module
│   ├── routes.py             # 26k Zeilen, Route-Handler
│   ├── streaming.py          # 11k Zeilen, SSE Engine
│   ├── config.py             # 9.6k Zeilen, Konfiguration
│   ├── auth.py               # Auth, Passkeys, OIDC
│   └── ...
├── static/                   # Frontend (authoritative)
│   ├── index.html            # 220 KB
│   ├── style.css             # 433 KB
│   ├── panels.js             # 629 KB (Settings/Cron/Skills/Memory)
│   ├── messages.js           # 409 KB (SSE, Streaming)
│   ├── sessions.js           # 426 KB
│   ├── ui.js                 # 952 KB (DOM, Markdown, Tool-Cards)
│   ├── boot.js               # 160 KB (Theme, Init)
│   ├── workspace.js          # 63 KB (api() Wrapper)
│   └── ...
├── wings/                    # Helm Chart
│   ├── Chart.yaml            # v1.9.2
│   ├── values.yaml           # image: v1.9.1
│   └── templates/
│       ├── deployment.yaml   # 3 InitContainers, 1 Main
│       └── service.yaml
├── Dockerfile                # python:3.12-slim
├── docker_init.bash          # UID/GID Init (494 lines)
├── OlaresManifest.yaml       # v3, v1.9.2
└── package.json              # ESLint only (dev-tool)
```

---

*Ende des Code-Review-Plans*
