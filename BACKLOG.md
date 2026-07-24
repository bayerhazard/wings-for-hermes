# Wings for Hermes — Backlog

> Priorisiertes Backlog für Olares-Deployment. Jeder Eintrag hat eine Versions- und Deploy-Checkliste.

---

## P0 — Blocking / Häufige Frustration

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
- `ctx-tooltip` (Gauge-Tooltip)
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
| v1.5.6 | 2026-07-24 | Smart timeout, dark dialog bg, remove tooltip title | Ja |
| v1.5.5 | 2026-07-24 | Logo-Abstand fix (gap + margin) | Ja |
| v1.5.4 | 2026-07-24 | Logo-Abstand -33%, ws-panel arrow aus, search focus aus | Ja |
| v1.5.3 | 2026-07-24 | Design-Redesign, Dark-Theme, Gauge-Card, AImighty-Logo | Ja |
