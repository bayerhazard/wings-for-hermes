# Agent instructions for Hermes WebUI

This file is the shared entry point for AI assistants working in this
repository. Keep it project-specific and safe to publish. Do not put personal
machine setup, private network details, credentials, tokens, or local-only
workflow notes here.

## Read first

Before making changes, read:

1. `README.md`
2. `CONTRIBUTING.md`
3. `docs/CONTRACTS.md`
4. `CHANGELOG.md`

For architecture, testing, or setup work, also read the matching reference:

- `ARCHITECTURE.md` for design constraints and current module layout
- `TESTING.md` for local verification commands and manual test guidance
- `docs/onboarding.md` for first-run onboarding behavior
- `docs/troubleshooting.md` for diagnostic flows
- `docs/rfcs/README.md` for larger RFCs and state/durability contracts

For UI or UX work, read `docs/UIUX-GUIDE.md` and `DESIGN.md` before
changing layout, interaction flow, themes, chat rendering, or composer chrome.

## Onboarding and reinstall support

If the task involves install, reinstall, bootstrap, first-run onboarding,
provider setup, local model server setup, Docker onboarding, WSL onboarding, or
support for a failed first run, read `docs/onboarding-agent-checklist.md`
before running commands or inspecting logs.

Follow that checklist's safety rules:

- use isolated `HERMES_HOME` and `HERMES_WEBUI_STATE_DIR` for trials unless the
  human explicitly asks to use real state
- do not delete or overwrite a real `~/.hermes` directory without explicit
  approval
- do not print API keys, OAuth tokens, cookies, full `.env` files, full
  `auth.json` files, or password hashes
- collect non-secret status and log evidence before recommending a fix

## Contribution style

- Keep one logical change per PR; split unrelated refactors or cleanup.
- Read `docs/CONTRACTS.md` and the linked contract/RFC for the touched
  subsystem before editing.
- For local pytest runs, use `./scripts/test.sh` instead of bare `python3`,
  `python -m pytest`, or `pytest`. The script creates/uses the repo `.venv`,
  pins execution to Python 3.11-3.13, and installs missing dev test dependencies.
  `HERMES_WEBUI_TEST_PYTHON` selects the supported base interpreter used to
  create or rebuild `.venv`; it must not install test dependencies into a
  system/Homebrew interpreter directly.
  If a direct pytest invocation reports an unsupported interpreter, rerun through
  `./scripts/test.sh` before debugging product code.
- Prefer the existing Python + vanilla JavaScript structure. Do not add
  dependencies, build tools, frameworks, or long-lived processes without clear
  justification and a rollback story.
- Update docs when changing setup, onboarding, runtime behavior, architecture,
  testing guidance, or user-facing workflows.
- Do not edit `CHANGELOG.md` in ordinary contributor PRs. The release workflow
  owns changelog updates through release commits. If a change is release-note
  worthy, include concise release-note wording in the PR body instead.
- For UI or UX changes, include before/after evidence and test relevant
  desktop, narrow, and mobile states.
- For behavior changes, add or update automated tests where practical and list
  the manual verification performed.
- For runtime, streaming, recovery, replay, compression, or sidebar metadata
  changes, name the state layer being mutated and prove the relevant invariant.
- For Docker build changes in `docker_init.bash`, mirror directory exclusions
  in both the `rsync` and `cp -a` paths — `/opt/hermes` may contain subdirectories
  with restricted permissions (e.g. `.playwright/`).

## Before you open a PR — the change guidelines

Read [`docs/GUIDELINES.md`](docs/GUIDELINES.md) in full before non-trivial work. It is the
distilled set of habits that get a change merged in one review round instead of several. The
compressed form:

1. **Fix the class, not the instance.** A bug usually has siblings — other call sites, backends,
   companion endpoints, layouts, exit paths. Find them all and fix the shared chokepoint, or name
   the ones you left out of scope.
2. **Trace one authoritative value end-to-end** (`input → normalize → decision → action → persist →
   cleanup`); the code that *decides* and the code that *acts* must use the same resolved value.
3. **When you can't confirm something, fail closed and say so.** Never take the permissive branch on
   uncertainty; never report a failure as success. "Unknown" is not "allowed."
4. **Enumerate the state-space before editing** — entry point, backend, item count (0/1/many), every
   lifecycle exit (success/error/cancel/replace/teardown), auth on/off, concurrency, hostile input —
   and cover each or mark it out of scope. Most redo rounds are one un-considered dimension.
5. **Assume inputs and check-then-use gaps are adversarial** — validate at the point of use (hold a
   handle, don't re-resolve a path), scope caches by complete identity, handle crafted input.
6. **A test must fail before your fix and pass after it.** Assert observable behavior, not a source
   string or a mock of the thing under test; use multiple items if selection is what's being tested.
7. **Name the owner of every piece of state and prove it's released on every exit** (success, error,
   cancel, replace, shrink, teardown) — not just the happy path.
8. **Fallbacks/defaults are contracts — extend the mechanism, don't copy it.** Editing N parallel
   blocks identically means you missed a chokepoint (e.g. new copy goes in the `en` locale only).
9. **The diff is the task and nothing else.** Extras go in the PR description, not the diff; run the
   affected + neighboring tests before opening.
10. **A visible control costs attention on every visit** — place it by frequency of use and by where
    mainstream chat apps put the equivalent, not by where your diff already is; verify with
    before/after images at desktop and narrow widths.

Show the work in the PR body: the siblings you found, proof the test failed before the fix, the
verification run, before/after images for visible changes, and an explicit list of what you could
not verify.

## Local state and secrets

Hermes WebUI can read and write real agent state, sessions, workspaces,
credentials, and cron data. Treat local validation as potentially destructive
unless you have confirmed the active state directories.

Prefer isolated trial state for experiments:

```bash
HERMES_HOME=/tmp/hermes-webui-agent-home \
HERMES_WEBUI_STATE_DIR=/tmp/hermes-webui-agent-state \
HERMES_WEBUI_PORT=8789 \
python3 bootstrap.py
```

Do not include private machine instructions in this tracked file. Use a
git-ignored local note for personal workflow details.

---

# Wings-specific: Voice pipeline & Olares deployment

Wings is a fork of `nesquena/hermes-webui` deployed as an Olares app (Helm
chart in `wings/`, image `ghcr.io/bayerhazard/wings-for-hermes`). The
AImighty voice assistant runs on Wings: **streaming TTS** (sentence-by-
sentence, progressive playback) + **barge-in** (voice interruption during
generation and playback) against the local ASR/TTS models.

## Voice architecture (where things live)

| Layer | Location | Role |
|---|---|---|
| Server TTS proxy | `api/routes.py` → `_handle_tts_stream` (`/api/tts/stream`) | Splits text into sentences (`_SpeechSentenceChunker`, port of the Hermes agent's `SentenceChunker`), synthesizes each sentence via the configured OpenAI-compatible endpoint, streams each completed sentence as an SSE event |
| Server sync TTS | `api/routes.py` → `_handle_tts` (`/api/tts`) | Buffered fallback (used when the client has no ReadableStream) |
| Config resolution | `api/routes.py` → `_resolve_openai_tts_config` | Shared by sync + stream: `tts.openai.*` from the shared Hermes `config.yaml` (SSRF-guarded), then `VOICE_TOOLS_OPENAI_KEY` / `OPENAI_API_KEY` / `.env` |
| Client playback | `static/ui.js` → `_playOpenaiTts(text, btn, onDone)` | SSE fetch + parser → base64→Blob queue → sequential `Audio` elements; abortable via `stopTTS()` |
| Voice mode | `static/boot.js` voice-mode IIFE | `_speakResponse` (auto-read on reply completion), state machine `idle/listening/thinking/speaking`, recognition restart handling |
| Barge-in VAD | `static/boot.js` → `_bargeTick` | Web-Audio mic RMS monitor, port of the agent's `full_duplex_listen`: quiet-room calibration at turn start, rolling bleed floor during playback, windowed-majority trip |

## Voice pipeline (flow)

```
user speaks → SpeechRecognition → _voiceModeSend() → state=thinking
  → _bargeStart() (mic monitor armed, calibrates quiet room)
  → agent reply streams → messages.js 'done' → autoReadLastAssistant()
  → _speakResponse() → state=speaking → _playOpenaiTts()
  → /api/tts/stream → sentence chunks (SSE) → progressive playback
  → barge-in: mic VAD trips → stopTTS + interruption note on next send
```

## Fallstricke — never regress these (all browser-verified root causes)

1. **SSE MUST use chunked framing.** `handler.end_headers()` is NOT enough —
   buffering proxies (Olares gateway / envoy) hold unframed SSE bodies until
   connection close (~31 s); the browser then receives only the tiny `done`
   event. Use `end_sse_headers(handler)` (`api/sse_chunked.py`,
   `HERMES_WEBUI_SSE_CHUNKED=1`) and **terminate the stream** with
   `handler.wfile.terminate()` after the final event — otherwise the fetch
   reader rejects with `TypeError: Failed to fetch`, which the client
   surfaced as an error toast AND killed the still-playing audio queue.
2. **Recognition `onerror` restart must check the state.** `_voiceModeSend()`
   aborts the recognition, which fires `onerror('aborted')` moments later;
   restarting without a `state==='listening'` guard yanks voice mode back to
   "Hören" ~800 ms after every send, so the reply arrives while the mic is
   already listening again and `_speakResponse` never runs.
3. **The autoReadLastAssistant patch must stay installed.** `_deactivate`
   used to restore the original (and `_activate` never re-installed it), so
   toggling voice mode off/on silently disabled voice-mode TTS — the state
   stayed on "thinking". The patch is a superset (delegates to the original
   when voice mode is inactive) — keep it permanent (`_installVoiceAutoReadPatch`).
4. **Barge VAD must not trip on speaker bleed or room noise.** The playback
   phase needs the adaptive bleed floor (seed during the first ~1.8 s trip-
   free grace, 4× over the rolling 90th percentile, cap 4000) AND the whole
   `speaking` state (including the wait for the first chunk) must hold the
   ≥1500 playback trigger floor — the quiet-generation trigger (~600) kills
   the TTS before the first audible sentence.
5. **The pinned HTTPS opener rejects private targets unless the host is
   allowlisted.** `HERMES_WEBUI_TTS_TRUSTED_HOSTS` must include the gateway
   host from `tts.openai.base_url`, or every sentence silently fails
   (`ValueError` → only `done` is emitted → "Sprechen" flashes, no audio).

## Diagnosis (permanent, always on)

`[wings-tts]` / `[wings-barge]` `console.debug` logs in the browser console:
`stream start`, `chunk idx=N (bytes)`, `done event, queue/played`, `audio
element error`, `AUTOPLAY BLOCKED`, `TRIPPED rms/trigger/phase`. These
distinguish: chunks-not-arriving vs autoplay-block vs audio-blob failure vs
barge false-trip — check them before touching the server.

## Olares deployment (compact)

- **Chart**: `wings/` (Chart.yaml + `wings/OlaresManifest.yaml` +
  repo-root `OlaresManifest.yaml`). Version `YY.MM.<n>` at **all** places:
  Chart.yaml, both OlaresManifests (`version` + `spec.versionName`),
  `values.yaml` image tag, and the market source (`_apps.ts` + `_lib.ts`
  base64 key).
- **Agent source**: `values.yaml` → `agentImage.tag` (e.g. `v2026.8.3-uid1000`).
  The init container stages it into the WebUI; `docker_init.bash` installs
  its deps with `uv pip install -e` — **editable install is mandatory**
  (newer agent builds refuse sdist/wheel builds with exit 42).
- **Image build**: MUST be multi-arch (`docker buildx build --platform
  linux/amd64,linux/arm64 --push`) — an arm64-only image fails Olares'
  platform check on amd64 nodes (`no match for platform in manifest`).
- **Release**: commit + push repo → build/push image → `helm package wings/`
  → update market source (`_apps.ts` version + fresh base64 in `_lib.ts`) →
  Cloudflare Pages deploy → Olares sync (5 min) → **uninstall + install**
  (never `upgrade` — values/init changes don't apply on upgrade).
- **Route**: custom third-level domain is set per-user after install via
  `settings apps domain set`, never in the chart.
- **Verify**: browser console `[wings-tts]`/`[wings-barge]` logs; server-side
  the voxtral app logs every synthesized sentence (`serving_speech.py`) —
  synthesis OK + no browser chunks = client/delivery issue, not the engine.

