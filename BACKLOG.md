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
