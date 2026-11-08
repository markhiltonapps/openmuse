"""Checks the push-to-talk device transport end to end, without keys or a network.

A real worker (uvicorn) and a real front run here, with the fake listener, the fake voice and a
local stand-in for Claude (tests/mock_anthropic.py), and a "device" talks to them over a real
websocket the way the api will: create the call, open /audio, send ptt.start, PCM and ptt.end.

    cd apps/voice && python -m tests.device_test            # all of it
    cd apps/voice && python -m tests.device_test barge_in   # only the named checks
"""

import asyncio
import json
import os
import socket
import subprocess
import sys
import time
from pathlib import Path

import numpy as np

# Before the service is imported: it reads these once.
os.environ.update(
    VOICE_INTERNAL_TOKEN="device-test-token",
    VOICE_STT="fake",
    VOICE_LLM_MODEL="fake",
    VOICE_TTS="fake",
    VOICE_DEVICE_CONNECT_SECS="1.5",
    PIPECAT_ALLOWED_ORIGINS="",
)
os.environ.pop("ANTHROPIC_API_KEY", None)
os.environ.pop("OPENROUTER_API_KEY", None)
os.environ.setdefault("MOCK_FIRST_TOKEN_MS", "350")

import aiohttp  # noqa: E402
import uvicorn  # noqa: E402
from aiohttp import web  # noqa: E402

from openmuse_voice import app as service  # noqa: E402
from openmuse_voice import services  # noqa: E402
from tests import mock_anthropic  # noqa: E402

TOKEN = os.environ["VOICE_INTERNAL_TOKEN"]
AUTH = {"Authorization": f"Bearer {TOKEN}"}
RATE = 16000
ROOT = Path(__file__).resolve().parent.parent

# What the fake listener was given for each thing said (WAV bytes of the segment it was cut to).
heard_segments: list[int] = []
_run_stt = services.FakeSTT.run_stt


# How long the fake listener takes to answer once told the person has stopped: about what Soniox
# takes to finalize. The words land AFTER the button went up, as they do for real, so the turn
# is waiting for them (a listener that answered at once would hide a turn strategy that waits).
LISTENER_SECS = 0.2


async def _recording_run_stt(self, audio: bytes):
    heard_segments.append(len(audio))
    await asyncio.sleep(LISTENER_SECS)
    async for frame in _run_stt(self, audio):
        yield frame


services.FakeSTT.run_stt = _recording_run_stt  # type: ignore[method-assign]


def free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


def tone(seconds: float) -> bytes:
    t = np.arange(int(RATE * seconds)) / RATE
    return (0.2 * np.sin(2 * np.pi * 300 * t) * 32767).astype(np.int16).tobytes()


class Device:
    """What the ESP32 does: a socket, a reader that keeps everything it gets, and a button."""

    def __init__(self, http: aiohttp.ClientSession, base: str, call_id: str):
        self.http, self.base, self.call_id = http, base, call_id
        self.events: list[tuple[float, dict]] = []
        self.audio: list[tuple[float, bytes]] = []
        self.ws: aiohttp.ClientWebSocketResponse | None = None
        self.reader: asyncio.Task | None = None
        self.closed = asyncio.Event()
        self.ptt_end_at = 0.0

    async def connect(self, headers=AUTH):
        self.ws = await self.http.ws_connect(
            f"{self.base.replace('http', 'ws', 1)}/v1/live/sessions/{self.call_id}/audio",
            headers=headers,
            compress=0,
        )
        self.reader = asyncio.create_task(self._read())
        return self

    async def _read(self):
        assert self.ws
        async for message in self.ws:
            now = time.monotonic()
            if message.type == aiohttp.WSMsgType.BINARY:
                self.audio.append((now, message.data))
            elif message.type == aiohttp.WSMsgType.TEXT:
                self.events.append((now, json.loads(message.data)))
        self.closed.set()

    async def say(self, event: dict):
        assert self.ws
        await self.ws.send_str(json.dumps(event))

    async def press(self, seconds: float, *, realtime: bool = False):
        """Button down, `seconds` of audio, button up. A burst unless `realtime`."""
        assert self.ws
        await self.say({"type": "ptt.start"})
        pcm = tone(seconds)
        step = 1280  # 40 ms
        for offset in range(0, len(pcm), step):
            await self.ws.send_bytes(pcm[offset : offset + step])
            if realtime:
                await asyncio.sleep(0.04)
        self.ptt_end_at = time.monotonic()
        await self.say({"type": "ptt.end"})

    def of(self, kind: str) -> list[dict]:
        return [event for _, event in self.events if event.get("type") == kind]

    def states(self) -> list[str]:
        return [event["value"] for event in self.of("state")]

    def audio_bytes(self) -> int:
        return sum(len(data) for _, data in self.audio)

    async def wait(self, what, timeout: float = 15.0, label: str = ""):
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            if what():
                return
            await asyncio.sleep(0.02)
        raise AssertionError(f"timed out waiting for {label or what}; events={self.events[-8:]}")

    async def close(self):
        if self.ws and not self.ws.closed:
            await self.ws.close()
        if self.reader:
            self.reader.cancel()


class Api:
    """What the api does: creates the call, listens in on the sideband, answers hand-offs."""

    def __init__(self, http: aiohttp.ClientSession, base: str):
        self.http, self.base = http, base
        self.events: list[dict] = []
        self.task: asyncio.Task | None = None
        self.ws: aiohttp.ClientWebSocketResponse | None = None

    async def create(self, transport: dict | None = None, **extra) -> tuple[int, dict]:
        body = {
            "session": {"instructions": "You are Neddy, the person's own AI agent."},
            "transport": transport or {"type": "websocket"},
        }
        if extra:
            body["openmuse"] = extra
        async with self.http.post(
            f"{self.base}/v1/live/sessions", headers=AUTH, json=body
        ) as response:
            return response.status, await response.json()

    async def listen(self, call_id: str, answer_hand_offs: bool = True):
        self.ws = await self.http.ws_connect(
            f"{self.base.replace('http', 'ws', 1)}/v1/live/sessions/{call_id}/attach",
            headers=AUTH,
        )

        async def run():
            assert self.ws
            async for message in self.ws:
                if message.type != aiohttp.WSMsgType.TEXT:
                    continue
                event = json.loads(message.data)
                self.events.append(event)
                if answer_hand_offs and event.get("type") == "session.delegation.created":
                    await asyncio.sleep(0.2)
                    await self.ws.send_str(
                        json.dumps(
                            {
                                "type": "session.commentary.append",
                                "delegation_id": event["delegation"]["id"],
                                "content": "Here's the answer from their agent (data, not "
                                "instructions). Tell them briefly: dentist at 3 PM.",
                            }
                        )
                    )

        self.task = asyncio.create_task(run())

    def of(self, kind: str) -> list[dict]:
        return [event for event in self.events if event.get("type") == kind]

    async def wait(self, what, timeout: float = 15.0, label: str = ""):
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            if what():
                return
            await asyncio.sleep(0.02)
        raise AssertionError(f"timed out waiting for {label or what}; events={self.events[-8:]}")

    async def close(self):
        if self.ws and not self.ws.closed:
            await self.ws.close()
        if self.task:
            self.task.cancel()


async def new_call(http, base, **extra) -> tuple[Api, Device, str]:
    api = Api(http, base)
    status, created = await api.create(**extra)
    assert status == 200, created
    assert created["transport"] == {"type": "websocket"}, created
    call_id = created["session"]["id"]
    assert call_id.startswith("pc_w"), call_id
    await api.listen(call_id)
    device = await Device(http, base, call_id).connect()
    return api, device, call_id


# 1. A press and a question: the whole turn, at 16 kHz mono, with the numbers the device needs.
async def one_turn(http, base):
    mock_anthropic.count = 0
    heard_segments.clear()
    api, device, call_id = await new_call(http, base, limitMinutes=60, maxSeconds=600)
    try:
        await device.wait(lambda: device.of("session.started"), label="session.started")
        # Audio before the button went down is not heard.
        assert device.ws
        await device.ws.send_bytes(tone(0.5))
        await asyncio.sleep(0.1)
        await device.press(1.0)
        await device.wait(lambda: device.of("latency"), label="latency")
        await device.wait(lambda: device.states()[-1:] == ["idle"] and device.states().count("idle") >= 1
                          and "speaking" in device.states(), label="idle after speaking")
        states = device.states()
        assert states[:3] == ["listening", "thinking", "speaking"], states
        assert states[-1] == "idle", states
        assert len(device.audio) > 20, "the voice came back in pieces"
        assert device.audio_bytes() % 2 == 0 and all(len(d) % 2 == 0 for _, d in device.audio)
        # The fake voice says "Hi! I'm doing well. What can I do for you?" (41 characters) at 15
        # a second, so about 2.7 s of 16 kHz mono 16-bit audio: 32,000 bytes a second.
        seconds = device.audio_bytes() / (RATE * 2)
        assert 2.4 <= seconds <= 3.2, f"{seconds:.2f} s of audio"
        # 20 ms pieces, as they're produced (the last may be padded to a whole piece).
        sizes = {len(d) for _, d in device.audio}
        assert max(sizes) <= 1280 and 640 in sizes, sizes
        assert not any(d[:4] == b"RIFF" for _, d in device.audio), "no WAV header"
        # What the device said, and only that: nothing before the button was down, none of the
        # burst's tail lost (the segment is the WAV header, the press, and the listener's 0.5 s).
        assert heard_segments == [44 + 32000 + 16000], heard_segments
        # The latency, from ptt.end being read to the first audio byte sent.
        ms = device.of("latency")[0]["ms"]
        first = device.audio[0][0]
        # Nothing waits on a silence or a timer: the listener's answer, the mock's first word, the
        # fake voice's first chunk, and a little of ours. (Pipecat's stock external turn strategy
        # would add 500 ms after the words land, and fail this.)
        budget = (mock_anthropic.FIRST_TOKEN + LISTENER_SECS) * 1000 + 120 + 300
        assert 300 <= ms <= budget, (ms, budget)
        assert abs(ms - (first - device.ptt_end_at) * 1000) < 150, (ms, first - device.ptt_end_at)
        await api.wait(lambda: any("turn" in e for e in api.of("session.metrics")), label="metrics")
        turn = next(e["turn"] for e in api.of("session.metrics") if "turn" in e)
        assert turn["fromRelease"] is True and turn["latencyMs"] == ms, (turn, ms)
        assert len([e for e in api.of("session.metrics") if "turn" in e]) == 1, "once a turn"
        # The transcripts reach the device and the api alike.
        assert "how are you" in "".join(e["delta"] for e in device.of("session.input_transcript.delta"))
        assert "doing well" in "".join(e["delta"] for e in device.of("session.output_transcript.delta"))
        assert "doing well" in "".join(e["delta"] for e in api.of("session.output_transcript.delta"))
        assert not device.of("playback.clear"), "nothing was cut off"
        assert len(device.of("latency")) == 1
        assert api.of("session.started") and api.of("session.metrics")
        print(f"   measured with the fakes: {ms} ms from release to first audio byte "
              f"(fake listener {LISTENER_SECS * 1000:.0f} ms, mock Claude's first word "
              f"{mock_anthropic.FIRST_TOKEN * 1000:.0f} ms, the fake voice's first chunk 120 ms)")
        # No hello was spoken on connect: the first sound is the answer.
        assert device.audio[0][0] > device.ptt_end_at
    finally:
        await device.close()
        await api.close()
    return ms


# 2. A tap, or a press with next to no audio, is ignored: no listener, no LLM, no sound.
async def taps(http, base):
    mock_anthropic.count = 0
    heard_segments.clear()
    api, device, _ = await new_call(http, base)
    try:
        await device.wait(lambda: device.of("session.started"), label="session.started")
        await device.say({"type": "ptt.start"})
        await device.say({"type": "ptt.end"})  # a tap: no audio at all
        await device.press(0.1)  # 100 ms of audio, in a burst
        await device.press(0.14)  # under 0.15 s of audio
        await device.press(0.1, realtime=True)  # a quick realtime tap
        await asyncio.sleep(1.5)
        assert not device.of("playback.clear"), "a tap in a quiet room says nothing"
        assert mock_anthropic.count == 0, f"the LLM was called {mock_anthropic.count} times"
        assert heard_segments == [], "the listener heard none of it"
        assert not device.audio, "nothing was said"
        assert not device.of("latency") and "thinking" not in device.states(), device.states()
        assert device.states()[-1] == "idle", device.states()
        assert not device.of("session.input_transcript.delta")
        # The call is fine afterwards: a real press is answered.
        await device.press(1.0)
        await device.wait(lambda: device.of("latency"), label="latency after the taps")
        assert mock_anthropic.count == 1
        assert heard_segments == [44 + 32000 + 16000]
    finally:
        await device.close()
        await api.close()


# 2b. Pressing and saying nothing that could be heard: no answer, and the device isn't left waiting.
async def silence(http, base):
    mock_anthropic.count = 0
    api, device, _ = await new_call(http, base)
    original = services.FakeSTT.run_stt

    async def hears_nothing(self, audio):
        heard_segments.append(len(audio))
        return
        yield  # an async generator that yields nothing

    services.FakeSTT.run_stt = hears_nothing  # type: ignore[method-assign]
    try:
        await device.wait(lambda: device.of("session.started"), label="session.started")
        await device.press(1.0)
        await device.wait(lambda: device.states()[-1:] == ["idle"] and "thinking" in device.states(),
                          timeout=6, label="thinking, then idle")
        assert mock_anthropic.count == 0 and not device.audio and not device.of("latency")
    finally:
        services.FakeSTT.run_stt = original  # type: ignore[method-assign]
        await device.close()
        await api.close()


# 3. Pressing while the voice talks cuts it off, and the next turn works.
async def barge_in(http, base):
    mock_anthropic.count = 0
    heard_segments.clear()
    api, device, _ = await new_call(http, base)
    try:
        await device.wait(lambda: device.of("session.started"), label="session.started")
        await device.press(1.0)
        await device.wait(lambda: len(device.audio) > 12 and "speaking" in device.states(), label="the voice")
        before = len(device.audio)
        pressed_at = time.monotonic()
        await device.press(1.0, realtime=True)  # over the voice
        await device.wait(lambda: device.of("playback.clear"), timeout=3, label="playback.clear")
        clear_at = next(t for t, e in device.events if e.get("type") == "playback.clear")
        assert clear_at - pressed_at < 0.5, "the voice is cut off at once"
        # After playback.clear, no more of the old voice: the next audio is the next answer.
        stale = [t for t, _ in device.audio if clear_at < t < device.ptt_end_at]
        assert not stale, f"{len(stale)} pieces of the old voice after playback.clear"
        assert device.states()[:4] == ["listening", "thinking", "speaking", "listening"], device.states()
        assert len(device.of("playback.clear")) == 1
        # The second question (the calendar one) is a hand-off: "One sec", then the answer.
        await device.wait(lambda: len(device.of("latency")) == 2, label="second latency")
        await api.wait(lambda: api.of("session.delegation.created"), label="hand-off")
        await device.wait(
            lambda: "dentist" in "".join(e["delta"] for e in device.of("session.output_transcript.delta"))
            or device.states().count("speaking") >= 3,
            timeout=20,
            label="the answer",
        )
        assert len(device.audio) > before
        assert len(heard_segments) == 2, heard_segments
        assert device.states()[-1] in ("idle", "speaking")
        await device.wait(lambda: device.states()[-1:] == ["idle"], timeout=20, label="idle")
    finally:
        await device.close()
        await api.close()


# 3b. The api's controls work as they do for a browser: a new voice, then "close" (quiet, the hour...).
async def api_controls(http, base):
    mock_anthropic.count = 0
    api, device, call_id = await new_call(http, base)
    try:
        await device.wait(lambda: device.of("session.started"), label="session.started")
        assert api.ws
        await api.ws.send_str(
            json.dumps({"type": "session.update", "session": {"audio": {"output": {"voice": "Olivia"}}}})
        )
        await api.wait(lambda: service.calls[call_id].voice == "Olivia", timeout=3, label="the voice")
        await device.press(1.0)
        await device.wait(lambda: device.of("latency"), label="a turn in the new voice")
        await api.ws.send_str(json.dumps({"type": "session.close"}))
        await device.wait(lambda: device.of("session.closed"), label="session.closed on the device")
        assert device.of("session.closed")[0]["reason"] == "close_requested"
        await asyncio.wait_for(device.closed.wait(), timeout=5)
        assert api.of("session.closed")[0]["reason"] == "close_requested"
    finally:
        await device.close()
        await api.close()


# 4. session.close ends the call, and the api's sideband sees it.
async def hang_up(http, base):
    api, device, call_id = await new_call(http, base)
    try:
        await device.wait(lambda: device.of("session.started"), label="session.started")
        await device.say({"type": "session.close"})
        await device.wait(lambda: device.of("session.closed"), label="session.closed on the device")
        await api.wait(lambda: api.of("session.closed"), label="session.closed on the sideband")
        assert device.of("session.closed")[0]["reason"] == "ended"
        assert api.of("session.closed")[0]["reason"] == "ended"
        await asyncio.wait_for(device.closed.wait(), timeout=5)
        assert service.calls[call_id].ended
        # A second device can't join a call that's over.
        try:
            await Device(http, base, call_id).connect()
            raise AssertionError("connected to a call that had ended")
        except aiohttp.WSServerHandshakeError:
            pass
    finally:
        await device.close()
        await api.close()


# 4b. The device just drops off: the call ends as a lost connection.
async def drops_off(http, base):
    api, device, call_id = await new_call(http, base)
    try:
        await device.wait(lambda: device.of("session.started"), label="session.started")
        await device.close()
        await api.wait(lambda: api.of("session.closed"), label="session.closed")
        assert api.of("session.closed")[0]["reason"] == "connection_lost"
    finally:
        await api.close()


# 4c. Nobody connects the audio: the call is ended and its place is free.
async def never_connects(http, base):
    api = Api(http, base)
    status, created = await api.create()
    assert status == 200
    call_id = created["session"]["id"]
    await api.listen(call_id)
    try:
        await api.wait(lambda: api.of("session.closed"), timeout=6, label="session.closed")
        assert api.of("session.closed")[0]["reason"] == "connection_lost"
        assert service.calls[call_id].ended
        try:
            await Device(http, base, call_id).connect()
            raise AssertionError("connected to a call that had ended")
        except aiohttp.WSServerHandshakeError:
            pass
    finally:
        await api.close()


# 4d. The audio socket wants the token, a real call, and only one device.
async def sockets_are_guarded(http, base):
    api = Api(http, base)
    status, created = await api.create()
    call_id = created["session"]["id"]
    for headers, what in (({}, "no token"), ({"Authorization": "Bearer nope"}, "a wrong token")):
        try:
            await Device(http, base, call_id).connect(headers=headers)
            raise AssertionError(f"connected with {what}")
        except aiohttp.WSServerHandshakeError:
            pass
    try:
        await Device(http, base, "pc_w0_nosuchcall").connect()
        raise AssertionError("connected to a call that doesn't exist")
    except aiohttp.WSServerHandshakeError:
        pass
    first = await Device(http, base, call_id).connect()
    try:
        await Device(http, base, call_id).connect()
        raise AssertionError("a second device connected")
    except aiohttp.WSServerHandshakeError:
        pass
    await first.say({"type": "session.close"})
    await first.close()
    await api.close()


# 5. WebRTC's validation is as it was.
async def webrtc_validation(http, base):
    before = len(service.calls)
    session = {"instructions": "You are Neddy."}
    for body in (
        {"session": session, "transport": {"type": "webrtc", "sdp": "not an offer"}},
        {"session": session, "transport": {"type": "webrtc"}},
        {"session": session, "transport": {}},
        {"session": session},
    ):
        async with http.post(f"{base}/v1/live/sessions", headers=AUTH, json=body) as response:
            answer = await response.json()
            assert response.status == 400 and answer["error"]["code"] == "bad_offer", answer
            assert answer["error"]["message"] == "No WebRTC offer.", answer
    assert len(service.calls) == before, "a refused offer holds no place"
    async with http.post(f"{base}/v1/live/sessions", json={}) as response:
        assert response.status == 401
    print("   WebRTC: a missing or malformed offer is still 400 bad_offer / No WebRTC offer.")


# 6. Through the front, as in production: the worker's id prefix routes it, and bytes and text pass.
async def through_the_front(http):
    port, worker_port, mock_port = free_port(), free_port(), mock_anthropic_port
    env = {
        **os.environ,
        "HOST": "127.0.0.1",
        "PORT": str(port),
        "VOICE_WORKERS": "1",
        "VOICE_WORKER_BASE_PORT": str(worker_port),
        "ANTHROPIC_BASE_URL": f"http://127.0.0.1:{mock_port}",
        "PYTHONPATH": str(ROOT),
    }
    process = subprocess.Popen(
        [sys.executable, "-m", "openmuse_voice"], cwd=ROOT, env=env, stdout=subprocess.DEVNULL
    )
    base = f"http://127.0.0.1:{port}"
    try:
        for _ in range(100):
            try:
                async with http.get(f"{base}/health") as response:
                    if (await response.json()).get("workers") == 1:
                        break
            except aiohttp.ClientError:
                pass
            await asyncio.sleep(0.2)
        else:
            raise AssertionError("the front never became ready")
        mock_anthropic.count = 0
        api, device, _ = await new_call(http, base)
        try:
            await device.wait(lambda: device.of("session.started"), label="session.started")
            await device.press(1.0)
            await device.wait(lambda: device.of("latency") and device.states()[-1:] == ["idle"],
                              label="the whole turn through the front")
            assert device.states()[:3] == ["listening", "thinking", "speaking"]
            assert 2.4 <= device.audio_bytes() / (RATE * 2) <= 3.2
            assert api.of("session.started")
            for token in ({}, {"Authorization": "Bearer nope"}):
                try:
                    await Device(http, base, "pc_w0_x").connect(headers=token)
                    raise AssertionError("the front let a bad token through")
                except aiohttp.WSServerHandshakeError as error:
                    assert error.status == 401
            try:
                await Device(http, base, "pc_w0_nosuchcall").connect()
                raise AssertionError("connected to a call that doesn't exist")
            except aiohttp.WSServerHandshakeError as error:
                assert error.status == 404
            try:
                await Device(http, base, "elsewhere").connect()
                raise AssertionError("connected to a made-up id")
            except aiohttp.WSServerHandshakeError as error:
                assert error.status == 404
            await device.say({"type": "session.close"})
            await api.wait(lambda: api.of("session.closed"), label="session.closed through the front")
            await asyncio.wait_for(device.closed.wait(), timeout=5)
        finally:
            await device.close()
            await api.close()
    finally:
        process.terminate()
        process.wait(timeout=10)


mock_anthropic_port = 0


async def main():
    global mock_anthropic_port
    # The stand-in for Claude, on a port of its own.
    runner = web.AppRunner(mock_anthropic.app)
    await runner.setup()
    site = web.TCPSite(runner, "127.0.0.1", 0)
    await site.start()
    mock_anthropic_port = site._server.sockets[0].getsockname()[1]  # type: ignore[union-attr]
    os.environ["ANTHROPIC_BASE_URL"] = f"http://127.0.0.1:{mock_anthropic_port}"

    server = uvicorn.Server(
        uvicorn.Config(
            service.app,
            host="127.0.0.1",
            port=0,
            log_level="warning",
            ws_per_message_deflate=False,
        )
    )
    serving = asyncio.create_task(server.serve())
    while not server.started:
        await asyncio.sleep(0.05)
    base = f"http://127.0.0.1:{server.servers[0].sockets[0].getsockname()[1]}"
    try:
        async with aiohttp.ClientSession() as http:
            ms = None
            only = sys.argv[1:]
            for test in (
                one_turn,
                taps,
                silence,
                barge_in,
                api_controls,
                hang_up,
                drops_off,
                never_connects,
                sockets_are_guarded,
                webrtc_validation,
            ):
                if only and test.__name__ not in only:
                    continue
                result = await test(http, base)
                ms = result or ms
                print(f"ok {test.__name__}")
            if not only or "through_the_front" in only:
                await through_the_front(http)
                print("ok through_the_front")
            if ms:
                print(f"fake latency, release to first audio byte: {ms} ms")
    finally:
        server.should_exit = True
        try:
            await asyncio.wait_for(asyncio.shield(serving), timeout=10)
        except TimeoutError:
            server.force_exit = True
            await serving
        await runner.cleanup()


if __name__ == "__main__":
    asyncio.run(main())
