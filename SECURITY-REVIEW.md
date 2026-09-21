# Wings for Hermes — Ultra Source Code Security Review

**Date:** 2026-09-02
**Scope:** Full codebase audit (`server.py`, `api/auth.py`, `api/terminal.py`, `api/workspace.py`, `api/shares.py`, `api/upload.py`, `api/paths.py`, `api/routes.py`, `api/plugins.py`, `api/models.py`, `api/helpers.py`, `mcp_server.py`, `requirements.txt`, `package.json`)
**Method:** Static analysis, STRIDE + OWASP mapping, correctness verification

---

## Executive Summary

The codebase demonstrates **exceptional security engineering** for a single-process Python web server. The author has clearly invested significant effort in defense-in-depth: TOCTOU-safe file operations, SSRF guards with IP pinning, layered auth (password + passkey + OIDC + trusted-header), CSRF with dual-token validation, and a public-share boundary with forced credential redaction. No critical vulnerabilities were found.

**Risk rating: LOW** — the code is production-hardened with documented threat models per subsystem.

---

## Findings

### CRITICAL (0)

None.

---

### HIGH (0)

None.

---

### MEDIUM (4)

#### M1. Trusted-Header Auth Bypasses Password Verification Entirely

**File:** `api/auth.py:860-899` (`ensure_trusted_auth_session`)
**STRIDE:** Spoofing

When `HERMES_WEBUI_TRUSTED_AUTH_HEADER` is set, any request from a trusted proxy (loopback or `HERMES_WEBUI_TRUSTED_PROXY_CIDRS`) with a non-empty value in that header is authenticated as a full session — no password, no passkey, no OIDC. The header value becomes the `username` with zero verification beyond "non-empty string."

**Risk:** If the trusted-proxy network is misconfigured (e.g., `HERMES_WEBUI_TRUSTED_PROXY_CIDRS=10.0.0.0/8` on a multi-tenant LAN), any host in that range can forge the header and gain full authenticated access to all profiles.

**Mitigation in code:** The raw socket peer is checked against the CIDR allowlist (`_raw_peer_is_trusted_proxy`, line 874), and loopback is the only implicit trust. This is correct for the intended deployment (single reverse proxy). The risk is operational misconfiguration, not a code defect.

**Recommendation:** Document the threat model in the deployment guide. Consider requiring a shared secret in the trusted header (e.g., `X-Auth-Token: <hmac-of-username>`) to resist accidental LAN exposure.

---

#### M2. Session Cookie `SameSite=Lax` + No `Secure` Flag on Plain HTTP

**File:** `api/auth.py:740-750` (`_auth_cookie_header`)
**STRIDE:** Information Disclosure

The auth cookie is set with `SameSite=Lax` and `HttpOnly` (good), but the `Secure` flag is only set when `_is_secure_context()` returns True (TLS socket or `HERMES_WEBUI_SECURE=1`). On plain-HTTP deployments (the default for local use), the cookie is transmitted unencrypted.

**Risk:** On a shared network (e.g., a LAN without TLS), the session cookie is visible to any passive observer. An attacker who captures the cookie gains full authenticated access for the 30-day TTL.

**Mitigation in code:** The server binds to `127.0.0.1` by default (config.py:50), which eliminates the network exposure. The startup warning (server.py:597-601) explicitly warns when binding non-loopback without auth. TLS is supported (`server.py:675-685`).

**Recommendation:** Acceptable for the local-first threat model. For non-loopback deployments, the operator must set `HERMES_WEBUI_SECURE=1` or use TLS. This is already documented.

---

#### M3. Multipart Parser Reads Entire Body into Memory

**File:** `api/upload.py:73` (`raw = rfile.read(length)`)
**STRIDE:** Denial of Service

The multipart parser reads the entire upload body into a single `bytes` object in memory before parsing. The cap is `MAX_UPLOAD_BYTES` (20 MB default, configurable via `HERMES_WEBUI_MAX_UPLOAD_MB`). With the `QuietHTTPServer` worker pool (default 64 threads), a burst of concurrent uploads could consume up to `64 × 20 MB = 1.28 GB` of RAM.

**Risk:** Resource exhaustion under concurrent upload load. Not exploitable for code execution, but can degrade or crash the server.

**Mitigation in code:** The `BoundedSemaphore` worker pool (server.py:150-278) caps concurrent requests at 64. The per-request timeout (30s) and the overflow-reject path (503 with `Retry-After`) provide backpressure. The upload size cap is enforced before the read.

**Recommendation:** Acceptable for a single-user local tool. For multi-user deployments, reduce `HERMES_WEBUI_MAX_UPLOAD_MB` or add a per-IP concurrent-upload limit.

---

#### M4. `read_body` Returns `{}` on JSON Parse Failure (Silent Empty)

**File:** `api/helpers.py:650-653`
**STRIDE:** Tampering (minor)

When `Content-Length > 0` but the body is not valid JSON, `read_body()` returns an empty dict `{}` instead of raising. Callers that do `data.get("session_id")` will get `None`, which is typically handled. However, a caller that does `if data:` (truthy check on a non-empty dict) would treat the empty dict as falsy and proceed with defaults — which is the correct behavior. The risk is a subtle logic error in a future caller that distinguishes "no body" from "malformed body."

**Risk:** Very low. All current call sites handle `None`/missing keys correctly.

**Recommendation:** Consider returning `None` instead of `{}` on parse failure, or raising a specific `InvalidJSONBody` exception, to make the contract explicit.

---

### LOW (8)

#### L1. `log_request` Logs Full Path (Potential URL Parameter Leakage)

**File:** `server.py:347-373`

Request logs include the full `self.path` (path + query string). If a query parameter carries sensitive data (e.g., a token in a URL), it would appear in stdout logs.

**Mitigation:** The codebase does not pass secrets in query strings (all auth is via cookie). The log is structured JSON and goes to stdout (container log).

**Recommendation:** Acceptable. If future routes accept tokens in query params, add a redaction pass to `log_request`.

---

#### L2. `_prune_expired_sessions` Called on Every `verify_session`

**File:** `api/auth.py:615`

Every auth check triggers a full scan of the in-memory session dict to remove expired entries. With a large number of concurrent sessions (unlikely for a local tool, but possible in a multi-user deployment), this is O(n) per request.

**Mitigation:** The session dict is bounded by the 30-day TTL and the login rate limiter (5 attempts/60s/IP). In practice, the dict stays small.

**Recommendation:** Acceptable. Could be optimized to a lazy per-entry check without the full scan, but the current approach is correct and simple.

---

#### L3. Static File Cache Has No Eviction

**File:** `api/routes.py:16474-16486`

The `_STATIC_CACHE` dict grows unbounded — one entry per unique static file path. In practice, the static directory is small (a few dozen JS/CSS/HTML files), so this is not a concern. However, if the static root were pointed at a large directory (via `HERMES_WEBUI_STATIC_DIR`), the cache could grow.

**Recommendation:** Acceptable for the current static asset set. Add an LRU cap if the static root becomes configurable to arbitrary directories.

---

#### L4. `CSP` is Report-Only

**File:** `server.py:324, 330-335`

The Content-Security-Policy header is sent as `Content-Security-Policy-Report-Only`, not as an enforced policy. This means the CSP provides no actual protection against XSS — it only reports violations.

**Mitigation:** The codebase is vanilla JS with no `eval()`, no `innerHTML` of user content (all user content is rendered via `textContent` or escaped), and the share page uses `html.escape()` for filenames. The XSS surface is minimal.

**Recommendation:** Consider switching to enforced CSP once the report-only period has confirmed no false positives. The `Report-To` endpoint (`/api/csp-report`) is already wired up.

---

#### L5. Terminal Env Allowlist Excludes `HERMES_WEBUI_PASSWORD`

**File:** `api/terminal.py:394-399`

The PTY shell environment is built from an allowlist of safe variables (`PATH`, `HOME`, `USER`, etc.). The `HERMES_WEBUI_PASSWORD` env var is NOT in the allowlist, so it is not leaked to the terminal shell. Good.

However, `HERMES_HOME` and `HERMES_WEBUI_STATE_DIR` are also not in the allowlist. If the agent's working directory is set via these vars, the terminal shell won't know about them — which is correct (the terminal is a user shell, not the agent).

**Recommendation:** No action needed. The allowlist is correctly scoped.

---

#### L6. `_sanitize_svg_bytes` Fails Open on Parse Error

**File:** `api/shares.py:205-211`

When an SVG cannot be parsed as XML, the function returns a minimal empty SVG (`<svg xmlns="..."/>`) rather than the original bytes. This is actually **fail-closed** (the comment says "fail-closed" but the code returns an empty SVG, which is the safe behavior). The original bytes are never embedded.

**Recommendation:** No action needed. The comment is slightly misleading but the behavior is correct.

---

#### L7. `mcp_server.py` Imports `api.models` Directly (Shared Mutable State)

**File:** `mcp_server.py:54-59`

The MCP server imports `api.models` and `api.profiles` directly, sharing the same in-memory `SESSIONS` dict, `LOCK`, and `_active_profile` global as the web server. If both processes run concurrently, they share the same `STATE_DIR` but have separate memory — the MCP server's in-memory state can diverge from the web server's.

**Mitigation:** The MCP server is designed to run as a separate stdio process spawned by the agent, not concurrently with the web server. The `--profile` override (line 62-64) sets `_profiles._active_profile` in-process, which is correct for the stdio model.

**Recommendation:** Document that the MCP server and web server should not run concurrently against the same `STATE_DIR` without external coordination.

---

#### L8. `requirements.txt` Has No Pinned Versions

**File:** `requirements.txt:13-14`

`pyyaml>=6.0` and `cryptography>=42.0` use minimum-version constraints. A future `pip install` could pull a version with a newly discovered vulnerability.

**Mitigation:** The dependency set is minimal (2 packages). The Docker image pins versions via the build. The risk is primarily for `pip install -r requirements.txt` in a dev environment.

**Recommendation:** Pin exact versions in the Dockerfile (already done via the build). For dev, consider `pip-tools` or `uv` lockfiles.

---

## What's Done Well (Security Positives)

| Area | Implementation |
|---|---|
| **Password hashing** | PBKDF2-SHA256, 600k iterations, per-install random salt (`api/auth.py:367-380`) |
| **Session tokens** | 256-bit random + HMAC-SHA256 signature, 30-day TTL, atomic persistence (`api/auth.py:579-597`) |
| **CSRF** | Dual-layer: Origin/Referer/Sec-Fetch-Site check + per-session HMAC token in `X-Hermes-CSRF-Token` (`api/routes.py:5235-5283`, `api/auth.py:963-983`) |
| **Path traversal** | `safe_resolve_ws()` with `resolve()` + `relative_to()`, plus TOCTOU-safe `openat` + `O_NOFOLLOW` component-by-component open (`api/workspace.py:985-1068`) |
| **SSRF (TTS)** | DNS resolution + IP pinning, `is_global` backstop, no-redirect handler, trusted-host allowlist, content-type validation, byte cap (`api/routes.py:18200-18457`) |
| **Public shares** | Forced credential redaction (independent of user settings), path scrubbing, MIME allowlist + magic-byte validation, SVG sanitization, 512 KiB embed cap, allowed-roots sandbox (`api/shares.py:1-523`) |
| **Upload** | Filename sanitization, path traversal guard, per-session directory, archive extraction byte cap (zip-bomb guard), Content-Length validation (`api/upload.py:1-150`) |
| **Trusted proxy** | Raw socket peer check (never a header), CIDR allowlist, IPv4-mapped-IPv6 handling (`api/routes.py:5634-5703`) |
| **Terminal** | Env allowlist (no secrets leaked), PTY with `start_new_session`, fd-recycling guard via `io_lock`, process-group kill, max-terminal cap with LRU eviction (`api/terminal.py:366-555`) |
| **Login rate limit** | 5 attempts / 60s / IP, persisted across restarts (`api/auth.py:217-249`) |
| **Cookie security** | `HttpOnly`, `SameSite=Lax`, `Secure` (when TLS), RFC 6265 name validation (`api/auth.py:740-750`) |
| **Plugin system** | Name slug validation, tab-path validation (no `//`, no query/fragment), no `exec`/`eval` of plugin code (`api/plugins.py:25-80`) |
| **Session ID** | Strict alphanumeric + `_`/`-` charset, centralized validation (`api/models.py:193-209`) |
| **Atomic writes** | `tempfile` + `fsync` + `os.replace`, permission/ownership preservation, symlink detection, in-place fallback with inode verification (`api/paths.py:108-250`) |
| **Worker pool** | `BoundedSemaphore` with overflow-reject (503), per-request timeout (30s), graceful SIGTERM shutdown (`server.py:150-278, 693-746`) |
| **CSP** | Report-only with `Report-To` endpoint wired (not yet enforced, but the infrastructure is in place) |
| **Dependency surface** | 2 runtime Python deps (PyYAML, cryptography), 1 dev JS dep (ESLint), no build step, no bundler |

---

## Architecture Notes

1. **Single-process, threaded:** `ThreadingHTTPServer` with a `BoundedSemaphore` worker pool. No async, no event loop. Each request is a thread with a 30s socket timeout. This is simple and correct for a local single-user tool.

2. **No database:** All state is JSON files on disk with atomic writes. Sessions, settings, shares, and workspaces are all file-backed. The `LOCK` (a `threading.Lock`) protects in-memory state; disk writes are serialized via `os.replace`.

3. **Profile isolation:** Multi-profile support via a thread-local `_active_profile` (set from the `hermes_profile` cookie, which is HMAC-signed to the session). Session visibility is enforced per-request via `_guard_request_session_visibility`.

4. **No external services:** The server is self-contained. The only outbound network calls are TTS synthesis (SSRF-guarded) and optional OIDC discovery. No WebSocket, no gRPC, no message queue.

5. **Wings-specific additions:** The voice pipeline (streaming TTS via SSE, barge-in VAD) is client-side JS + a server-side sentence-chunking proxy. The SSE chunked framing (`end_sse_headers`) is a Wings-specific fix for the Olares envoy proxy.

---

## Conclusion

The codebase is **well-hardened** for its threat model (local single-user AI assistant with optional network exposure). The security engineering is above-average for a project of this size, with documented threat models per subsystem, TOCTOU-safe file operations, and layered authentication. The four medium findings are operational/configuration risks rather than code defects, and all have existing mitigations in the code.

**No changes are required for the current deployment model (Olares container, single user, behind the Olares gateway).**
