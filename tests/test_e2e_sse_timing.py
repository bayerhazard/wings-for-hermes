"""End-to-end SSE streaming timing test.

Starts the real WebUI server, pushes tokens into a stream with known delays,
and measures over a raw HTTP connection whether each SSE event arrives
individually (true streaming) or only at the end (buffered as a block).

This isolates the WebUI wire path (server -> socket) from any proxy/agent
layer, so a failure here proves the server itself buffers.
"""
import json
import socket
import threading
import time

import api.config as config
from api.config import STREAMS, create_stream_channel, register_stream_owner

TEST_STREAM = "e2e-stream-timing"


def _start_server():
    import subprocess
    import os
    import pathlib
    repo = pathlib.Path(__file__).parent.parent.resolve()
    env = dict(os.environ)
    env["HERMES_HOME"] = "/tmp/hermes-e2e-home"
    env["HERMES_WEBUI_STATE_DIR"] = "/tmp/hermes-e2e-state"
    env["HERMES_WEBUI_PORT"] = "8791"
    env.pop("HERMES_WEBUI_SSE_CHUNKED", None)
    proc = subprocess.Popen(
        [str(repo / ".venv/bin/python"), "server.py"],
        cwd=str(repo), env=env,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    for _ in range(100):
        try:
            with socket.create_connection(("127.0.0.1", 8791), timeout=0.2):
                return proc
        except OSError:
            time.sleep(0.2)
    proc.kill()
    raise RuntimeError("server did not start")


def _push_tokens():
    """Push 3 tokens with 300ms gaps into the stream."""
    ch = create_stream_channel()
    STREAMS[TEST_STREAM] = ch
    register_stream_owner(TEST_STREAM, "e2e-session")
    for i, tok in enumerate(["Hello", " world", " streaming"]):
        time.sleep(0.3)
        ch.put_nowait(("token", {"text": tok}))


def test_sse_tokens_arrive_individually():
    proc = _start_server()
    try:
        # Push tokens in background
        t = threading.Thread(target=_push_tokens, daemon=True)
        t.start()
        time.sleep(0.1)  # ensure stream registered

        arrivals = []
        with socket.create_connection(("127.0.0.1", 8791), timeout=15) as s:
            s.sendall(
                b"GET /api/chat/stream?stream_id=" + TEST_STREAM.encode()
                + b" HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n"
            )
            buf = b""
            start = time.monotonic()
            while time.monotonic() - start < 8:
                try:
                    chunk = s.recv(4096)
                except socket.timeout:
                    break
                if not chunk:
                    break
                buf += chunk
                # Count how many distinct "event:" frames have fully arrived.
                frames = buf.count(b"event: token")
                if frames and (not arrivals or frames > arrivals[-1][0]):
                    arrivals.append((frames, time.monotonic() - start))

        # If the server streams, tokens arrive at ~0.3s intervals (3 arrivals
        # spread over ~0.9s). If buffered, all 3 arrive at once near the end.
        distinct_times = [t for _, t in arrivals]
        print(f"\nFrames count by time: {arrivals}")
        print(f"Distinct arrival times: {distinct_times}")
        assert len(distinct_times) >= 2, (
            f"Tokens arrived as ONE block (buffered): only {len(distinct_times)} "
            f"distinct arrival times -> {arrivals}"
        )
        spread = distinct_times[-1] - distinct_times[0]
        assert spread >= 0.3, (
            f"Tokens arrived nearly together (spread={spread:.2f}s) — "
            f"streaming not happening, block delivery: {arrivals}"
        )
    finally:
        proc.kill()
        proc.wait()
