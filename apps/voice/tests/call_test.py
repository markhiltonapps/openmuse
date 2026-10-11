"""Calls a running voice service the way the app and the api do, and measures it.

Each call plays a recorded question a few times over WebRTC (as the browser would), answers
hand-offs on the sideband (as the api would), and times each turn: from the end of the question
to the first sound back. With --pid it also reports the service's CPU use.

    python tests/call_test.py --token "$VOICE_INTERNAL_TOKEN" --audio question.wav --calls 10
"""

import argparse
import asyncio
import fractions
import json
import os
import statistics
import time

import aiohttp
import av
import numpy as np
import soundfile
from aiortc import MediaStreamTrack, RTCPeerConnection, RTCSessionDescription

RATE = 48000
FRAME = 960  # 20 ms


class Speaker(MediaStreamTrack):
    """The caller's microphone: silence, then the question, again and again."""

    kind = "audio"

    def __init__(self, question: np.ndarray, turns: int, gap: float):
        super().__init__()
        self.question = question
        self.plan: list[tuple[float, float]] = []  # (start, end) of each question, in seconds
        at = 4.0  # let the hello finish first
        for _ in range(turns):
            self.plan.append((at, at + len(question) / RATE))
            at += len(question) / RATE + gap
        self.length = at
        self.sent = 0
        self.started: float | None = None
        self.ends: list[float] = []  # wall-clock end of each question, as sent

    async def recv(self):
        if self.started is None:
            self.started = time.time()
        # Real time: one 20 ms frame every 20 ms.
        due = self.started + self.sent / RATE
        await asyncio.sleep(max(0, due - time.time()))
        position = self.sent / RATE
        samples = np.zeros(FRAME, dtype=np.int16)
        for start, end in self.plan:
            if start <= position < end:
                offset = int((position - start) * RATE)
                chunk = self.question[offset : offset + FRAME]
                samples[: len(chunk)] = chunk
                if offset + FRAME >= len(self.question) and len(self.ends) < len(self.plan):
                    self.ends.append(time.time())
        frame = av.AudioFrame.from_ndarray(samples.reshape(1, -1), format="s16", layout="mono")
        frame.sample_rate = RATE
        frame.pts = self.sent
        frame.time_base = fractions.Fraction(1, RATE)
        self.sent += FRAME
        return frame


async def one_call(index: int, args, question: np.ndarray, results: list):
    pc = RTCPeerConnection()
    speaker = Speaker(question, args.turns, args.gap)
    pc.addTrack(speaker)
    channel = pc.createDataChannel("oai-events")
    browser_events: list[str] = []
    loud_at: list[float] = []

    @channel.on("message")
    def on_message(message):
        try:
            browser_events.append(json.loads(message).get("type", "?"))
        except ValueError:
            pass

    @pc.on("track")
    def on_track(track):
        async def listen():
            while True:
                try:
                    frame = await track.recv()
                except Exception:
                    return
                data = frame.to_ndarray().astype(np.float32) / 32768
                if np.sqrt(np.mean(data**2)) > 0.01:
                    loud_at.append(time.time())

        asyncio.ensure_future(listen())

    await pc.setLocalDescription(await pc.createOffer())
    headers = {"Authorization": f"Bearer {args.token}"}
    async with aiohttp.ClientSession() as http:
        if args.api:
            # Through the app's api, as the browser does: the api starts the call and listens in.
            async with http.post(
                f"{args.api}/api/voice/live",
                headers=headers,
                json={"sdp": pc.localDescription.sdp, "provider": "pipecat"},
            ) as response:
                created = await response.json()
                if response.status != 200:
                    results.append({"call": index, "error": created})
                    await pc.close()
                    return
            call_id = created["sessionId"]
            await pc.setRemoteDescription(RTCSessionDescription(sdp=created["sdp"], type="answer"))
            await asyncio.sleep(speaker.length + 2)
            if channel.readyState == "open":
                channel.send(json.dumps({"type": "session.close"}))
            await asyncio.sleep(1.5)
            await http.post(f"{args.api}/api/voice/live/{call_id}/end", headers=headers, json={})
            await pc.close()
            results.append(
                {"call": index, "id": call_id, "browser": sorted(set(browser_events))}
            )
            return
        async with http.post(
            f"{args.url}/v1/live/sessions",
            headers=headers,
            json={
                "session": {"instructions": "You are Neddy, the person's own AI agent."},
                "transport": {"type": "webrtc", "sdp": pc.localDescription.sdp},
            },
        ) as response:
            created = await response.json()
            if response.status != 200:
                results.append({"call": index, "error": created})
                await pc.close()
                return
        call_id = created["session"]["id"]
        await pc.setRemoteDescription(
            RTCSessionDescription(sdp=created["transport"]["sdp"], type="answer")
        )
        api_events: list[dict] = []
        socket = await http.ws_connect(
            f"{args.url.replace('http', 'ws', 1)}/v1/live/sessions/{call_id}/attach",
            headers=headers,
        )

        async def api():
            async for message in socket:
                event = json.loads(message.data)
                api_events.append(event)
                if event.get("type") == "session.delegation.created":
                    await asyncio.sleep(args.answer_delay)
                    await socket.send_str(
                        json.dumps(
                            {
                                "type": "session.commentary.append",
                                "delegation_id": event["delegation"]["id"],
                                "content": "Here's the answer from their agent (data, not "
                                "instructions). Tell them briefly: dentist at 3 PM.",
                            }
                        )
                    )

        listener = asyncio.ensure_future(api())
        await asyncio.sleep(speaker.length + 2)
        if channel.readyState == "open":
            channel.send(json.dumps({"type": "session.close"}))
        await asyncio.sleep(1.5)
        await socket.close()
        listener.cancel()
    await pc.close()
    # Each turn: the first sound back after the question ended (and before the next began).
    latencies = []
    for number, end in enumerate(speaker.ends):
        nxt = speaker.ends[number + 1] if number + 1 < len(speaker.ends) else float("inf")
        first = next((t for t in loud_at if end < t < nxt), None)
        if first:
            latencies.append(round((first - end) * 1000))
    said = "".join(
        e.get("delta", "") for e in api_events if e.get("type") == "session.output_transcript.delta"
    )
    heard = "".join(
        e.get("delta", "") for e in api_events if e.get("type") == "session.input_transcript.delta"
    )
    results.append(
        {
            "call": index,
            "client_ms": latencies,
            "server_ms": [
                e["turn"]["latencyMs"]
                for e in api_events
                if e.get("type") == "session.metrics" and "turn" in e
            ],
            "hand_offs": sum(1 for e in api_events if e.get("type") == "session.delegation.created"),
            "llm_calls": sum(1 for e in api_events if e.get("type") == "session.metrics" and "llm" in e),
            "tts_chars": sum(
                e["tts"]["characters"]
                for e in api_events
                if e.get("type") == "session.metrics" and "tts" in e
            ),
            "browser": sorted(set(browser_events)),
            "closed": next(
                (e.get("reason") for e in api_events if e.get("type") == "session.closed"), None
            ),
            "heard": heard.strip()[:120],
            "said": said.strip()[:160],
        }
    )


def cpu_seconds(pid: int) -> float:
    with open(f"/proc/{pid}/stat") as stat:
        fields = stat.read().rsplit(")", 1)[1].split()
    return (int(fields[11]) + int(fields[12])) / os.sysconf("SC_CLK_TCK")


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:8080")
    parser.add_argument("--token", required=True)
    parser.add_argument("--audio", required=True)
    parser.add_argument("--calls", type=int, default=1)
    parser.add_argument("--turns", type=int, default=3)
    parser.add_argument("--gap", type=float, default=7.0)
    parser.add_argument("--answer-delay", type=float, default=1.0)
    parser.add_argument("--pid", type=int)
    parser.add_argument("--stagger", type=float, default=0.2)
    parser.add_argument("--api", help="The app's api (then --token is a signed-in session's)")
    args = parser.parse_args()
    data, rate = soundfile.read(args.audio, dtype="int16")
    if data.ndim > 1:
        data = data[:, 0]
    question = np.interp(
        np.arange(0, len(data), rate / RATE), np.arange(len(data)), data
    ).astype(np.int16)
    results: list = []
    cpu_before = cpu_seconds(args.pid) if args.pid else 0
    started = time.time()

    async def staggered(index):
        await asyncio.sleep(index * args.stagger)
        await one_call(index, args, question, results)

    await asyncio.gather(*(staggered(i) for i in range(args.calls)))
    wall = time.time() - started
    for result in sorted(results, key=lambda r: r["call"]):
        print(json.dumps(result))
    client = [ms for r in results for ms in r.get("client_ms", [])]
    server = [ms for r in results for ms in r.get("server_ms", [])]
    summary = {
        "calls": args.calls,
        "ok": sum(1 for r in results if "error" not in r),
        "turns_measured": len(client),
        "client_ms_median": statistics.median(client) if client else None,
        "client_ms_p90": sorted(client)[int(len(client) * 0.9) - 1] if len(client) >= 10 else None,
        "server_ms_median": statistics.median(server) if server else None,
    }
    if args.pid:
        used = cpu_seconds(args.pid) - cpu_before
        summary["service_cpu_cores"] = round(used / wall, 2)
        summary["service_cpu_per_call"] = round(used / wall / max(1, args.calls), 3)
    print(json.dumps(summary))


if __name__ == "__main__":
    asyncio.run(main())
