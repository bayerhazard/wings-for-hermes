"""Streaming TTS endpoint (/api/tts/stream) and sentence-chunker coverage.

Covers the conversational-voice port: the server splits the assistant reply
into sentences (same cutter as the Hermes agent's streaming TTS), synthesizes
each sentence, and forwards every completed sentence as an SSE event so the
browser starts speaking after the first sentence instead of after the whole
synthesis.
"""
import base64
import io
import json

import pytest

import api.routes as routes


@pytest.fixture(autouse=True)
def _reset_tts_limiter():
    if hasattr(routes._handle_tts, "_tts_limiter"):
        del routes._handle_tts._tts_limiter
    yield
    if hasattr(routes._handle_tts, "_tts_limiter"):
        del routes._handle_tts._tts_limiter


class _FakeHandler:
    def __init__(self, body: bytes, command: str = "POST", headers=None, client="1.2.3.4"):
        self.command = command
        self.rfile = io.BytesIO(body)
        self.wfile = io.BytesIO()
        self.headers = headers or {}
        self.headers.setdefault("Content-Length", str(len(body)))
        self.client_address = (client, 12345)
        self.status = None
        self.sent_headers = {}

    def send_response(self, status):
        self.status = status

    def send_header(self, key, value):
        self.sent_headers[key] = value

    def end_headers(self):
        pass

    def sse_events(self):
        """Return the list of parsed ``data:`` payloads written to wfile."""
        events = []
        for raw in self.wfile.getvalue().decode("utf-8").strip().split("\n\n"):
            raw = raw.strip()
            if not raw:
                continue
            data = raw[len("data: "):] if raw.startswith("data: ") else raw
            try:
                events.append(json.loads(data))
            except Exception:
                events.append({"raw": data})
        return events


def _post(payload, **kwargs):
    body = json.dumps(payload).encode("utf-8")
    return _FakeHandler(body, headers={"Content-Type": "application/json"}, **kwargs)


class _StubAudioResponse:
    def __init__(self, body: bytes, content_type: str = "audio/mpeg"):
        self.body = body
        self.headers = {"Content-Type": content_type}
        self._drained = False

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def read(self, _size=-1):
        if self._drained:
            return b""
        self._drained = True
        return self.body


def _make_audio(text: str) -> bytes:
    # Deterministic fake audio whose size encodes the input (so tests can
    # prove per-sentence synthesis happened).
    return b"MP3FAKE" + text.encode("utf-8") * 3


def _stub_open(monkeypatch):
    """Stub _tts_open: one fake audio response per request, echo of the
    sentence text encoded in the payload (read from req.data)."""
    calls = []

    def fake_open(req, **kwargs):
        payload = json.loads(req.data.decode("utf-8"))
        calls.append(payload["input"])
        return _StubAudioResponse(_make_audio(payload["input"]))

    monkeypatch.setattr(routes, "_tts_open", fake_open)
    monkeypatch.setattr(routes, "_TTS_TRUSTED_HOSTS_CACHE", None)
    return calls


def _setup_openai_config(monkeypatch):
    import api.config as config

    monkeypatch.setattr(
        config, "get_config", lambda: {
            "tts": {
                "openai": {
                    "base_url": "https://llm.aimighty.olares.de/v1",
                    "model": "tts-voxtral",
                    "voice": "de_female",
                    "api_key": "sk-test",
                }
            }
        }
    )
    monkeypatch.setattr(routes, "is_auth_enabled", lambda: False, raising=False)
    monkeypatch.delenv("HERMES_WEBUI_TRUST_FORWARDED_FOR", raising=False)
    monkeypatch.delenv("HERMES_WEBUI_TTS_TRUSTED_HOSTS", raising=False)


# ── SentenceChunker ──────────────────────────────────────────────────────────


def test_chunker_splits_on_sentence_boundaries():
    chunker = routes._SpeechSentenceChunker()
    sentences = chunker.feed(
        "Das ist der erste Satz. Und hier der zweite Satz! "
        "Jetzt folgt die dritte Frage?\n\nUnd ein neuer Absatz."
    ) + chunker.flush()
    # Note: the port keeps the trailing boundary whitespace on each sentence
    # (identical to the Hermes agent's SentenceChunker).
    assert len(sentences) == 4
    assert sentences[0] == "Das ist der erste Satz. "
    assert sentences[1] == "Und hier der zweite Satz! "
    assert sentences[2].startswith("Jetzt folgt die dritte Frage?")
    assert sentences[3] == "Und ein neuer Absatz."


def test_chunker_merges_short_fragments():
    chunker = routes._SpeechSentenceChunker(min_len=20)
    out = chunker.feed("Ja. Das ist hier der ausreichend lange zweite Satz. "
                       "Nein. Und noch ein ausreichend langer Satz danach.") + chunker.flush()
    assert len(out) == 2
    assert out[0].startswith("Ja. Das ist hier")
    assert out[1].startswith("Nein. Und noch")


def test_chunker_strips_think_blocks():
    chunker = routes._SpeechSentenceChunker()
    out = chunker.feed("<think>This is internal reasoning.</think> "
                       "Hier kommt die eigentliche Antwort. Und der Rest.") + chunker.flush()
    assert len(out) == 2
    assert "think" not in out[0] and "<think>" not in out[0]


def test_chunker_flush_returns_tail():
    chunker = routes._SpeechSentenceChunker()
    assert chunker.feed("Ein vollständiger Satz. Noch ein Satz ohne Punkt am Ende") == [
        "Ein vollständiger Satz. "
    ]
    assert chunker.flush() == ["Noch ein Satz ohne Punkt am Ende"]


# ── /api/tts/stream ──────────────────────────────────────────────────────────


def test_tts_stream_emits_one_event_per_sentence(monkeypatch):
    _setup_openai_config(monkeypatch)
    calls = _stub_open(monkeypatch)
    text = ("Das ist der erste ausreichend lange Satz. "
            "Und das ist der zweite ausreichend lange Satz. "
            "Dazu kommt noch der dritte ausreichend lange Satz.")
    h = _post({"text": text})
    routes._handle_tts_stream(h, None)

    events = h.sse_events()
    audio_events = [e for e in events if "b64" in e]
    assert len(audio_events) == 3
    assert [e["idx"] for e in audio_events] == [0, 1, 2]
    assert len(calls) == 3
    assert events[-1] == {"done": True}
    assert h.sent_headers.get("Content-Type", "").startswith("text/event-stream")
    assert h.sent_headers.get("Cache-Control") == "no-store"
    for idx, event in enumerate(audio_events):
        assert base64.b64decode(event["b64"]) == _make_audio(calls[idx])


def test_tts_stream_uses_chunked_sse_framing(monkeypatch):
    # Regression: without Transfer-Encoding: chunked, buffering reverse
    # proxies (Olares gateway / envoy) hold every SSE event until the
    # connection dies — the browser then receives only the final "done" and
    # voice mode hangs on "Sprechen" with no audio.
    _setup_openai_config(monkeypatch)
    _stub_open(monkeypatch)
    monkeypatch.setenv("HERMES_WEBUI_SSE_CHUNKED", "1")
    h = _post({"text": "Das ist der erste ausreichend lange Satz. Und hier der zweite ausreichend lange Satz."})
    routes._handle_tts_stream(h, None)
    assert h.sent_headers.get("Transfer-Encoding") == "chunked"


def test_tts_stream_unsplittable_text_speaks_whole(monkeypatch):
    _setup_openai_config(monkeypatch)
    calls = _stub_open(monkeypatch)
    h = _post({"text": "Kurzer Text"})
    routes._handle_tts_stream(h, None)
    events = h.sse_events()
    assert len([e for e in events if "b64" in e]) == 1
    assert calls == ["Kurzer Text"]
    assert events[-1] == {"done": True}


def test_tts_stream_missing_key_returns_503(monkeypatch):
    import api.config as config

    monkeypatch.setattr(
        config, "get_config", lambda: {"tts": {"openai": {"base_url": "https://llm.example.com/v1"}}}
    )
    monkeypatch.setattr(routes, "is_auth_enabled", lambda: False, raising=False)
    monkeypatch.delenv("VOICE_TOOLS_OPENAI_KEY", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.setattr(routes, "_TTS_TRUSTED_HOSTS_CACHE", None)
    h = _post({"text": "Erster Satz. Zweiter Satz."})
    routes._handle_tts_stream(h, None)
    assert h.status == 503


def test_tts_stream_requires_text(monkeypatch):
    monkeypatch.setattr(routes, "is_auth_enabled", lambda: False, raising=False)
    h = _post({"text": "   "})
    routes._handle_tts_stream(h, None)
    assert h.status == 400


def test_tts_stream_emits_error_event_on_upstream_failure(monkeypatch):
    _setup_openai_config(monkeypatch)

    def failing_open(req, **kwargs):
        raise ConnectionError("upstream down")

    monkeypatch.setattr(routes, "_tts_open", failing_open)
    h = _post({"text": "Erster Satz. Zweiter Satz."})
    routes._handle_tts_stream(h, None)
    events = h.sse_events()
    assert any("error" in e for e in events)
