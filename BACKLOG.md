
---

## P0 — Sync-Analyse (ABGESCHLOSSEN, 2026-08-01)

### Analyse-Ergebnis

**Fork-Status:** Der Fork `bayerhazard/wings-for-hermes` (v1.9.6) hat **exakt den gleichen Code-Stand** wie `upstream/master` (commit `320789ae5`, 31.07.2026).

**Upstream-Divergenz:** Der Fork wurde von `v0.50.43` (14.04.2026) abgezweigt. Seitdem hat Upstream **4738 Commits** und **1690 geänderte Dateien** (+525K Zeilen, -13.5K Zeilen) hinzugefügt.

**Fork-spezifische Änderungen:** 68 Custom-Commits (UI-Redesign, Olares-Deploy, Themes, Basic/Advanced-Mode, Gauge-Card, Activity-Line, SW-Cache-Disable).

### Sync-Strategie

1. **Nicht alles auf einmal!** 4738 Commits auf einmal zu mergen würde die 68 Fork-Änderungen wahrscheinlich brechen.
2. **Patch-weise mergen** — Security-Fixes zuerst, dann Bugfixes, dann Features.
3. **Jeden Sync testen** — `olares-cli market upgrade wings -s market.AImighty --watch`
4. **Fork-Änderungen prüfen** — Nach jedem Merge prüfen, ob Classic-Layout, Neon-Theme, Gauge-Card etc. noch funktionieren.

### Priorisierte Sync-Liste

#### 🔴 P0 — Security (SOFORT)
| Issue | Titel | Datei(en) | Risiko |
|-------|-------|-----------|--------|
| #6174 | Public share links leak local attachments | `api/shares.py`, `static/share.html` | **Kritisch** — LFI/XSS |
| #6372 | `.ts`/`.tsx` files served as executable | `api/routes.py`, `server.py` | **Kritisch** — XSS |
| #5797 | `config.yaml` nicht-atomar geschrieben | `api/config.py` | **Hoch** — Datenkorruption |

#### 🟡 P1 — Wichtige Bugfixes
| Issue | Titel | Datei(en) | Impact |
|-------|-------|-----------|--------|
| #6527 | Live SSE relays hang after apperror | `api/streaming.py` | Streaming hängt sich auf |
| #6196 | Reload prefers stale cache | `api/routes.py`, `static/sw.js` | Datenverlust bei Reload |
| #6390 | Transcript jumps during streaming | `static/messages.js`, `static/ui.js` | UX-Problem |
| #6083 | New conversations become unstartable | `api/session_ops.py` | Session-Erstellung bricht |
| #5990 | False "No response" after tool-call answer | `api/streaming.py` | Falscher Error |
| #5940 | Failed turn zeigt "no response" statt Error | `api/streaming.py`, `api/routes.py` | Schlechte Error-Meldung |
| #6117 | Stale sidebar approval attention badge | `api/route_approvals.py` | Falsche Benachrichtigung |

#### 🟢 P2 — Neue Features (zur Diskussion)
| Issue | Titel | Nutzen | Empfehlung |
|-------|-------|--------|------------|
| #5913 | Pinch-to-zoom Mermaid | Mobile UX | **BEREITSTELLEN** |
| #6062 | Collapsed read_file zeigt Line-Range | Transparenz | **BEREITSTELLEN** |
| #5798 | Gateway health check single-flight | Performance | **BEREITSTELLEN** |
| #5799 | Run-journal append O(1) | Performance | **BEREITSTELLEN** |
| #5994 | Fork from here during active response | UX | **BEREITSTELLEN** |
| #5751/#5637/#5638 | Mobile scroll jump-back family | Kritisch für Mobile | **BEREITSTELLEN** |
| #5508 | Extension API | Wings hat kein Extension-System | **SPÄTER** |

### Sync-Checkliste (nach Genehmigung)
- [ ] `git fetch upstream`
- [ ] `git diff upstream/v0.50.43...upstream/master --stat` → Diff-Analyse
- [ ] Security-Fixes (#6174, #6372, #5797) patchen
- [ ] Empfohlene Bugfixes patchen
- [ ] Empfohlene Features patchen
- [ ] Fork-spezifische Änderungen prüfen (Classic-Layout, Gauge-Card, AImighty-Logo, Basic/Advanced)
- [ ] `helm package wings/` + `_lib.ts` update
- [ ] `_apps.ts` version bump + upgradeDescription
- [ ] Git commit + push
- [ ] Wrangler deploy
- [ ] Olares market restart + upgrade
- [ ] Hard-Refresh im Browser
- [ ] Test: Chat, Sessions, Workspace, Settings, Mobile

# Wings for Hermes — Backlog

> Priorisiertes Backlog für Olares-Deployment. Jeder Eintrag hat eine Versions- und Deploy-Checkliste.

---

## P0 — Blocking / Häufige Frustration

### [x] Gauge-Tooltip hat transparenten Hintergrund (unleserlich)
**Status:** **GELOST in v1.6.0** — Tooltip komplett entfernt (HTML+JS+CSS).
**Details:** `.ctx-tooltip` wurde aus `index.html`, `ui.js` und `style.css` entfernt. Der Ring zeigt nur noch die Token-Anzeige.
**Deployed:** v1.6.0

### [ ] Timeout-Toast bei aktivem Stream störend
**Status:** Smart-Timeout in v1.5.6 implementiert (unterdrückt Toast wenn Stream aktiv), aber noch nicht robust genug.
**Details:** Bei sehr langen Antworten (500+ tokens) kommt es vor, dass der Server langsam antwortet, der Stream aber noch aktiv ist. Der aktuelle Fix prüft `S.activeStreamId` — aber das reicht nicht für alle Fälle (z.B. wenn der Stream pausiert und dann weitermacht).
**Verbesserung:** Timeout-Countdown als nicht-störendes Inline-Element im Composer anzeigen statt Toast. Toast nur wenn Stream INAKTIV ist.
**Deploy-Checkliste:**
- [ ] `workspace.js` Timeout-Logik erweitern
- [ ] Inline-Timeout-Counter im Composer (kleines "⏱ 30s..." Text-Label)
- [ ] Version bump + deploy

---

## P1 — Theme-Konsistenz (Dark Mode)

### [x] Chatbubble-Hintergründe haben Akzentfarben
**Status:** **GELOST in v1.6.0** — User-Bubbles jetzt neutral (Anthrazit in Dark, Surface in Light).
**Details:** Globale CSS-Override am Ende von `style.css` setzt `--user-bubble-bg` auf `var(--chat-bg)` (dark) oder `var(--surface)` (light). Keine Gold/Blau-Farben mehr in User-Nachrichten.
**Deployed:** v1.6.0

### [x] Avatar-Konzept implementiert
**Status:** **GELOST in v1.6.0** — Avatare neben Nachrichten (User rechtsbündig, Hermes linksbündig).
**Details:** Avatare (32px Kreis, Anthrazit-Hintergrund, goldener Rand) stehen jetzt neben den Nachrichten. User-Nachrichten sind rechtsbündig mit Avatar rechts, Hermes-Antworten linksbündig mit Avatar links. Alte `msg-role`-Leiste ausgeblendet.
**Deployed:** v1.6.0

### [x] Smart Download-Card für erstellte Dateien
**Status:** **GELOST in v1.6.0** — Download-Card nach file-creating tool calls.
**Details:** Nach write_file/create_file/save_file/edit_file tool calls wird eine Download-Card gerendert mit Filename, Size, Timestamp und zwei Buttons: "Download file" + "Open in Workspace". Keine Emojis/Symbole, nur Text.
**Deployed:** v1.6.0

### [ ] Delete-Confirm-Dialog passt nicht zum Dark-Theme
**Status:** Teilweise gefixt in v1.5.6 (`:root.dark .app-dialog` Override). Muss verifiziert werden.
**Details:** Der Bestätigungsdialog (Rechtsklick → "Delete conversation") hat einen hellen Hintergrund, der nicht zum Anthrazit-Theme passt.
**Deploy-Checkliste:**
- [ ] `style.css` Dark-Mode-Override für `.app-dialog` + `.app-dialog-overlay`
- [ ] Alle Dialog-Typen prüfen: Delete, Confirm, Prompt, Rename
- [ ] Version bump + deploy

### [ ] Alle Dialoge/Overlays müssen Anthrazit-Hintergrund haben
**Status:** Offene Issue.
**Details:** Neben dem Delete-Confirm-Dialog gibt es weitere Dialoge/Overlays, die den hellen Default-Hintergrund nutzen:
- `app-dialog` (Confirm/Prompt dialogs)
- `app-dialog-overlay` (Overlay-Hintergrund)
- `model-dropdown` (Model-Auswahl)
- `composer-model-select` (Model-Picker)
- Extensions-Dialoge
- Settings-Overlays
**Fix:** CSS-Variable `--surface` konsistent in allen Dialog-Komponenten verwenden. Keine hardcoded helle Farben.
**Deploy-Checkliste:**
- [ ] Alle `.app-dialog*` Klassen auf `var(--surface)` prüfen
- [ ] `style.css` Dark-Mode-Overrides für alle Dialog-Typen
- [ ] Version bump + deploy

---

## P2 — Mobile-Optimierung

### [ ] Swipe-Gesten für Sessions
**Status:** Idee.
**Details:** Auf mobilen Geräten wäre Swipe-to-delete, Swipe-to-archive, Swipe-to-pin intuitiver als Hover-Kontextmenüs.
**Analogie:** iOS Messages, Gmail, Spotify.
**Umfang:**
- Swipe left: Delete / Archive / Pin ( konfigurierbar in Settings)
- Swipe right: Quick actions (share, fork)
- Long-press: Multi-select modus
- Touch-Hover-Alternative: Right-click ersetzt durch long-press menu

### [ ] Composer als Floating Sheet (Mobile)
**Status:** Idee.
**Details:** Auf mobilen Geräten nimmt der Composer die volle Bildschirmbreite ein. Besser: als Floating Sheet am unteren Rand (wie iOS Keyboard), das bei Bedarf aufklappt.
**Analogie:** iMessage, WhatsApp, Telegram.
**Umfang:**
- Composer klebt am unteren Rand, 44px hoch (Send-Button + Input)
- Bei Fokussierung: Sheet klappt nach oben auf (wie Keyboard)
- Attachments-Button bleibt sichtbar
- Model-Chip wird im Sheet-Header angezeigt

### [ ] Touch-Target-Größen audit
**Status:** Idee.
**Details:** Mindestens 44x44px Touch-Targets für alle interaktiven Elemente. Aktuell sind manche Buttons/Icons zu klein (z.B. Session-Aktionen, Workspace-Toggle, Model-Chip).
**Umfang:**
- Alle Button-Größen auditieren
- Touch-Targets auf 44px minimum bringen
- Hover-States durch active/pressed States ersetzen

### [ ] Mobile Swipe-Navigation
**Status:** Idee.
**Details:** Horizontal Swipe zwischen Sessions (wie iOS Fotos-App). Swipe left = nächste Session, swipe right = vorherige.
**Umfang:**
- Touch-Event-Listener für horizontal Swipe
- Visuelles Feedback (Session-Preview beim Swipe)
- Konfigurierbar in Settings

### [ ] Mobile Keyboard-Dismissal
**Status:** Idee.
**Details:** Auf iOS/Android bleibt die Tastatur oft sichtbar, auch wenn der User woanders hinklickt. Besser: Tap outside dismisses keyboard.
**Umfang:**
- `blur()` auf Input bei Tap outside
- Touch-Event-Listener auf Overlay-Elementen

---

## Deploy-Checkliste (alle Versionen)

1. `git add static/ OlaresManifest.yaml wings/ && git commit -m "vX.Y.Z: ..." && git push`
2. `docker buildx build --platform linux/amd64 -t ghcr.io/bayerhazard/wings-for-hermes:latest --push .`
3. `helm package wings/` → base64 encode → `_lib.ts` CHARTS dict update
4. `_apps.ts` version + upgradeDescription update
5. `git add functions/ && git commit -m "wings vX.Y.Z" && git push`
6. `wrangler pages deploy functions/ --project-name=aimighty-market`
7. `olares-cli cluster workload restart market-deployment -n os-framework --yes --kind Deployment`
8. Warten bis Version im Market angezeigt wird (60-120s)
9. `olares-cli market upgrade wings -s market.AImighty --watch`
10. `olares-cli cluster workload restart wings -n wings-aimighty --yes --kind Deployment`
11. **Hard-Refresh** (`Cmd+Shift+R`) im Browser

---

## Versions-Historie (Olares)

| Version | Datum | Thema | Deployed |
|---------|-------|-------|----------|
| v1.6.0 | 2026-07-24 | Gauge-Tooltip löschen, Smart Download-Card, Avatar-Konzept, neutrale Chatbubble-Hintergründe | — |
| v1.5.6 | 2026-07-24 | Smart timeout, dark dialog bg, remove tooltip title | Ja |
| v1.5.5 | 2026-07-24 | Logo-Abstand fix (gap + margin) | Ja |
| v1.5.4 | 2026-07-24 | Logo-Abstand -33%, ws-panel arrow aus, search focus aus | Ja |
| v1.5.3 | 2026-07-24 | Design-Redesign, Dark-Theme, Gauge-Card, AImighty-Logo | Ja |

---

## P2 — Feature: Workspace-Panel im Basic Mode

### [ ] Workspace-Panel als Pille im Composer-Footer (Basic Mode)
**Status:** **GEPLANT** — Konzept erstellt 2026-07-30.
**Details:** Das Workspace-Panel (`.rightpanel`) ist technisch im Basic Mode nicht versteckt, wird aber nicht aktivierbar gemacht. Ziel: Eine einzelne Pille im Composer-Footer ermöglicht das Öffnen/Schliessen des Panels — analog zum bestehenden Model-Chip.

#### Design-Entscheidungen
- **Eine Pille** im Composer-Footer (Basic Mode): `[📄 Workspace ▾]`
- In **Advanced Mode** bleibt der bestehende `.composer-workspace-group` (Icon im Footer) unverändert
- Die Pille spiegelt den Panel-Status visuell wider (border-color, arrow-rotation)
- Keine neuen Abhängigkeiten, keine API-Änderungen
- Mobile (<900px): bestehende Slide-In-Logik greift, Pille ausgeblendet

#### Umsetzung (4 Dateien)

**1. `static/index.html`** — Neue Pille in `#composerFooter` einfügen (ausserhalb `.composer-workspace-group`):
```html
<button class="composer-workspace-chip" id="btnWorkspaceChip" type="button"
        onclick="toggleWorkspacePanel()" aria-pressed="false"
        title="Toggle workspace panel">
  <span class="workspace-chip-icon">
    <svg><!-- folder icon --></svg>
  </span>
  <span class="workspace-chip-label">Workspace</span>
  <span class="workspace-chip-arrow" aria-hidden="true">▾</span>
</button>
```

**2. `static/style.css`** — Neue Styles + Basic-Regeln:
- `.composer-workspace-chip`: Pille-Stil (border, radius, padding, transition)
- `[data-mode="basic"] .composer-workspace-chip { display: inline-flex; }`
- `[data-mode="advanced"] .composer-workspace-chip { display: none !important; }`
- Active-State: `aria-pressed="true"` → accent border + rotated arrow

**3. `static/boot.js`** — `_setWorkspacePanelMode()` um `aria-pressed` erweitern:
```js
const chip = $('btnWorkspaceChip');
if (chip) {
  chip.setAttribute('aria-pressed', String(open));
  chip.setAttribute('aria-label', open ? 'Hide workspace panel' : 'Show workspace panel');
}
```

**4. `static/panels.js`** — Mode-Handler anpassen:
- Zeile 39: Statt Panel automatisch zu schliessen, nur Zustand speichern
- Beim Mode-Wechsel Advanced→Basic: Pille initialisieren

#### State Machine
```
Basic, Panel closed  → Klick Pille → Panel öffnet (300px)
Basic, Panel open    → Klick Pille → Panel schliesst
Advanced, Panel closed → Klick Composer-Icon → Panel öffnet
Advanced, Panel open → Klick Composer-Icon → Panel schliesst
Mode-Wechsel Basic→Advanced → Pille verschwindet, Advanced-Group erscheint
Mode-Wechsel Advanced→Basic → Pille erscheint, Panel bleibt im letzten Zustand
```

#### Deploy-Checkliste
- [ ] `static/index.html` — Pille einfügen
- [ ] `static/style.css` — Neue Styles + Basic/Advanced Regeln
- [ ] `static/boot.js` — `aria-pressed` in `_setWorkspacePanelMode()`
- [ ] `static/panels.js` — Mode-Handler anpassen
- [ ] Test: Basic Mode → Panel toggle via Pille
- [ ] Test: Advanced Mode → Panel toggle via Composer-Icon
- [ ] Test: Mode-Wechsel Basic ↔ Advanced
- [ ] Test: Mobile (<900px) — Pille ausgeblendet, Slide-In funktioniert
- [ ] Test: localStorage-Persistenz (`wings-workspace-panel`)
- [ ] Version bump + deploy

---

---

## P1 — Fork-Sync: Upstream Hermes WebUI abgleichen

### [ ] Fork mit upstream `nesquena/hermes-webui` auf aktuellen Stand bringen
**Status:** **GEPLANT** — 2026-08-01 erstellt.
**Fork-Tag:** v1.9.6 (2026-07-29)
**Upstream-stabil:** v0.52.106 (2026-07-29)
**Upstream-experimental:** exp-v0.52.158 (2026-07-30)

**Kontext:** Wings for Hermes ist ein Fork des internen Hermes WebUI. Der Fork hat seit der Abspaltung eigene Design- und Olares-Integrationen (Classic-Layout, Gauge-Card, AImighty-Branding, Basic/Advanced-Mode, Olares-Manifest). Ein Sync muss diese Fork-spezifischen Änderungen bewahren.

#### Sync-Strategie (NICHT automatisch übernehmen!)

1. **Diff analysieren:** `git fetch upstream && git diff main...upstream/master --stat`
2. **Kategorisieren:** Bugfixes, Features, Breaking Changes, Security
3. **Priorisieren:** Was muss rein? Was wollen wir? Was intentionally nicht?
4. **Abstimmen:** Jede Kategorie mit dem User genehmigen
5. **Patch-weise mergen:** Nicht alles auf einmal — lieber kleine, testbare Commits
6. **Olares-Tests:** Nach jedem Sync: `olares-cli market upgrade wings -s market.AImighty --watch`

#### A. Security-Fixes (MÜSSEN übernommen werden)

| Issue | Titel | Empfehlung |
|-------|-------|------------|
| #6174 | Public share links leak local attachments | **MUST HAVE** — Kritische XSS/LFI-Schwachstelle |
| #6372 | `.ts`/`.tsx` files served as executable | **MUST HAVE** — XSS über Workspace-Dateien |
| #5797 | `config.yaml` nicht-atomar geschrieben | **MUST HAVE** — Datenkorruption bei Crash |

#### B. Wichtige Bugfixes (EMPFOHLEN)

| Issue | Titel | Empfehlung |
|-------|-------|------------|
| #6527 | Live SSE relays hang after apperror | **EMPFEHLUNG** — Streaming hängt sich auf |
| #6196 | Reload bevorzugt stale cache über run-journal | **EMPFEHLUNG** — Datenverlust bei Reload |
| #6390 | Transcript jumps during streaming settlement | **EMPFEHLUNG** — UX-Problem beim Scrollen |
| #6323/#6309 | Terminal-error Worklog zeigt "still running" | **EMPFEHLUNG** — Falscher Zustand nach Error |
| #5723 | Message stuck after server restart mid-reply | **EMPFEHLUNG** — Composer blockiert |
| #6040 | Gateway approval cards routed by run ID | **EMPFEHLUNG** — Approvals auf falschem Run |
| #6117 | Stale sidebar approval attention badge | **EMPFEHLUNG** — Falsche Benachrichtigung |
| #6083 | New conversations become unstartable | **EMPFEHLUNG** — Session-Erstellung bricht |
| #5990 | False "No response" after tool-call answer | **EMPFEHLUNG** — Falscher Error |
| #5940 | Failed turn zeigt "no response" statt Error | **EMPFEHLUNG** — Schlechte Error-Meldung |

#### C. Neue Features (ZUR DISKUSSION)

| Issue | Titel | Nutzen für Wings | Empfehlung |
|-------|-------|-------------------|------------|
| #5508 | Extension API: session-open + transcript | NIEDRIG — Wings hat kein Extension-System | **SPÄTER** |
| #5913 | Pinch-to-zoom Mermaid | MITTEL — Nützlich für Mobile | **BEREITSTELLEN** |
| #6062 | Collapsed read_file zeigt Line-Range | MITTEL — Bessere Transparenz | **BEREITSTELLEN** |
| #6161/#6106 | Artifacts: filename first, mobile headers | MITTEL — Bessere UX | **BEREITSTELLEN** |
| #5798 | Gateway health check single-flight | HOCH — Performance-Verbesserung | **BEREITSTELLEN** |
| #5799 | Run-journal append O(1) statt O(n²) | HOCH — Performance bei langen Sessions | **BEREITSTELLEN** |
| #6362 | Sessions cache cap 300→100 | MITTEL — Weniger Memory-Usage | **BEREITSTELLEN** |
| #6315 | Image tool-results compaction | MITTEL — Weniger Memory | **BEREITSTELLEN** |
| #6183 | Hide new-chat welcome panel | HIER EIGENE LÖSUNG — Wings hat eigenes Empty-State | **NICHT ÜBERNEHMEN** |
| #5701 | Composer above keyboard on iPad | MITTEL — iOS UX | **BEREITSTELLEN** |
| #5692 | Windows: no console windows for git | NIEDRIG — Wings auf Linux/Olares | **ÜBERSPRINGEN** |
| #6088 | Manual update check works when auto off | MITTEL — Olares hat eigenes Update-System | **BEREITSTELLEN** |
| #5994 | Fork from here during active response | HOCH — Wichtige UX-Verbesserung | **BEREITSTELLEN** |
| #5979 | Proxy providers keep vendor namespace | MITTEL — Wichtig für Multi-Provider | **BEREITSTELLEN** |
| #6245 | `/sessions` and `/resume` commands | MITTEL — Slash-Commands | **BEREITSTELLEN** |
| #5836 | Terminal output broadcast to multiple tabs | MITTEL — Multi-Terminal | **BEREITSTELLEN** |
| #5844 | Abandoned terminal reaper | MITTEL — Resource leak fix | **BEREITSTELLEN** |
| #5751/#5637/#5638 | Mobile scroll jump-back family | HOCH — Kritisch für Mobile | **BEREITSTELLEN** |
| #5742 | Desktop scroll jump during streaming | HOCH — UX-Problem | **BEREITSTELLEN** |
| #5877 | Concurrent chats cross profile boundary | HOCH — Datenisolierung | **BEREITSTELLEN** |
| #6260 | Fast session recovery for large sidecars | MITTEL — Performance | **BEREITSTELLEN** |
| #6189 | Transparent Stream duplicate final answer | MITTEL — Rendering-Bug | **BEREITSTELLEN** |
| #6143 | Background subagent persistence | MITTEL — Subagent-Stabilität | **BEREITSTELLEN** |
| #5872 | Context-usage after compaction | MITTEL — Genauere Anzeige | **BEREITSTELLEN** |
| #5895 | Dictation appends instead of replaces | MITTEL — Sprach-Eingabe | **BEREITSTELLEN** |
| #5717 | Agent closing summary shows iteration limit | MITTEL — Bessere Error-Anzeige | **BEREITSTELLEN** |
| #5664 | Workspace tree no longer jumps on expand | MITTEL — UX-Verbesserung | **BEREITSTELLEN** |
| #5696 | Faster session loads on long conversations | HOCH — Performance | **BEREITSTELLEN** |
| #5674 | Sidebar grouping stays stable | MITTEL — UX-Stabilität | **BEREITSTELLEN** |
| #5645 | Profile switch serves correct models | HOCH — Profil-Stabilität | **BEREITSTELLEN** |
| #5560 | Mermaid diagrams min-height on mobile | NIEDRIG — Mobile UX | **BEREITSTELLEN** |
| #5630 | Steer uploads scoped to session | MITTEL — Upload-Stabilität | **BEREITSTELLEN** |
| #5633 | Chat header scales with font-size | NIEDRIG — Accessibility | **BEREITSTELLEN** |
| #5594 | Three-panel desktop layout floor | MITTEL — Layout-Stabilität | **BEREITSTELLEN** |
| #5644 | Markdown tables tolerate trailing whitespace | MITTEL — Robustheit | **BEREITSTELLEN** |
| #5653 | No empty italic hint on error cards | NIEDRIG — Cosmetic | **BEREITSTELLEN** |
| #6227 | Folder downloads work under subpath | MITTEL — Olares-Subpath-Support | **BEREITSTELLEN** |
| #6105/#6080 | Mobile composer model picker off-screen | HOCH — Mobile Bug | **BEREITSTELLEN** |
| #6104/#6094 | Approval/clarify popups min-width | MITTEL — Mobile Bug | **BEREITSTELLEN** |
| #6106 | Stream timestamps no-break on narrow | NIEDRIG — Cosmetic | **BEREITSTELLEN** |
| #6102 | Streaming sidebar poll cache | MITTEL — CPU-Reduktion | **BEREITSTELLEN** |
| #6056 | Delegated subagent sidebar titles | MITTEL — Bessere Übersicht | **BEREITSTELLEN** |
| #5766 | Background wakeup preserves prior reply | MITTEL — UX | **BEREITSTELLEN** |
| #5762 | Service-tier from model metadata | MITTEL — Auto-detection | **BEREITSTELLEN** |
| #5773 | Live reasoning no double render | MITTEL — Rendering-Bug | **BEREITSTELLEN** |
| #5770 | Code block CSS contain | MITTEL — Layout-Stabilität | **BEREITSTELLEN** |
| #5721 | Workspace switcher screen reader | NIEDRIG — Accessibility | **BEREITSTELLEN** |
| #5729 | Background child stream no parent reorder | NIEDRIG — Sidebar-Stabilität | **BEREITSTELLEN** |
| #5786 | Terminal reconnect from dropped connection | MITTEL — Robustheit | **BEREITSTELLEN** |
| #5785 | Passkey login Content-Length | MITTEL — HTTP-Protokoll | **BEREITSTELLEN** |
| #5784 | Session delete evicts writer locks | MITTEL — Memory leak | **BEREITSTELLEN** |
| #5783 | Reaper/drain thread race | MITTEL — Thread-Safety | **BEREITSTELLEN** |
| #5780 | state.db read-only for lineage/gateway | MITTEL — SQLite-Konkurrenz | **BEREITSTELLEN** |
| #5772 | MCP list reflects active profile | MITTEL — Profil-Korrektheit | **BEREITSTELLEN** |
| #5737 | Empty tool_calls rejected by strict providers | MITTEL — Provider-Kompatibilität | **BEREITSTELLEN** |
| #5567 | Profile switch model provider mismatch | HOCH — Routing-Bug | **BEREITSTELLEN** |
| #5419 | Session link switches to owning profile | MITTEL — Deep-Linking | **BEREITSTELLEN** |
| #5688 | Self-update recovers from .git/index.lock | MITTEL — Update-Robustheit | **BEREITSTELLEN** |
| #5696 | Profile list stale rows | MITTEL — Cache-Freshness | **BEREITSTELLEN** |
| #5672 | Off-screen tall messages keep real height | HOCH — Mobile Scroll | **BEREITSTELLEN** |
| #5666 | Android mobile scroll drift | HOCH — Mobile Scroll | **BEREITSTELLEN** |
| #5681 | History scroll jump during stream | HOCH — Mobile Scroll | **BEREITSTELLEN** |
| #5685 | Mid-stream scroll jitter | HOCH — Mobile Scroll | **BEREITSTELLEN** |
| #5605 | Mobile drawer shows dashboard/extension | MITTEL — Mobile Nav | **BEREITSTELLEN** |
| #5644 | Markdown tables trailing whitespace | MITTEL — Robustheit | **BEREITSTELLEN** |
| #5653 | Empty italic hint on error cards | NIEDRIG — Cosmetic | **BEREITSTELLEN** |

#### D. Features NICHT übernehmen (intentional)

| Issue | Titel | Grund |
|-------|-------|-------|
| #6183 | Hide new-chat welcome panel | Wings hat eigenes Empty-State |
| #6160 | (Same as above) | |
| #6403 | Japanese i18n refresh | Wings i18n separat gepflegt |
| #5761 | OpenCode Go model picker | Wings hat eigenes Model-System |
| #6329 | Docker experimental builds | Olares hat eigenes Image-System |
| #5944 | ctl.sh double-start detection | Wings hat eigenes Start-System |
| #6305 | Test-infra state-dir probe | Test-only |
| #5970 | Cross-platform test suite | Test-only |
| #6276 | Windows symlink test fallback | Test-only |
| #5801 | Login page retry clearInterval | Low-priority |

#### E. Sync-Checkliste (nach Genehmigung)

- [ ] `git fetch upstream`
- [ ] `git diff main...upstream/master --stat` → Diff-Analyse
- [ ] Security-Fixes (#6174, #6372, #5797) patchen
- [ ] Empfohlene Bugfixes patchen
- [ ] Empfohlene Features patchen
- [ ] Fork-spezifische Änderungen prüfen (Classic-Layout, Gauge-Card, AImighty-Logo, Basic/Advanced)
- [ ] `helm package wings/` + `_lib.ts` update
- [ ] `_apps.ts` version bump + upgradeDescription
- [ ] Git commit + push
- [ ] Wrangler deploy
- [ ] Olares market restart + upgrade
- [ ] Hard-Refresh im Browser
- [ ] Test: Chat, Sessions, Workspace, Settings, Mobile

---
