"""The voice service's web routes: the api starts calls here and listens in on them.

Only the api talks to this service, over Railway's private network, with the shared token. The
browser's audio reaches it over WebRTC through the TURN relay (Railway takes no UDP from outside).
"""

import asyncio
import hmac
import json
import os
from typing import Any

import aiohttp
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
from loguru import logger
from pipecat.transports.base_transport import TransportParams
from pipecat.transports.smallwebrtc.connection import IceServer, SmallWebRTCConnection
from pipecat.transports.smallwebrtc.transport import SmallWebRTCTransport

from .call import Call
from .config import Config, load
from .pipeline import run_call
from .voices import Voices

config: Config = load()
voices = Voices(config)
app = FastAPI(title="OpenMuse voice")
calls: dict[str, Call] = {}
# Running calls, held so the event loop doesn't drop them.
running: set[asyncio.Task] = set()


def _refused(status: int, code: str, message: str) -> JSONResponse:
    # The same shape as OpenAI's errors, which the api already reads and logs.
    return JSONResponse({"error": {"type": "voice_service", "code": code, "message": message}}, status)


def _signed(header: str | None) -> bool:
    expected = f"Bearer {config.token}"
    return bool(config.token) and hmac.compare_digest((header or "").encode(), expected.encode())


def _ice_servers(raw: Any) -> list[IceServer]:
    """The relay for this call, as aiortc can use it: one STUN and one TURN address.

    aiortc takes only the first of each, so the TURN address is chosen here: UDP by default, or
    VOICE_TURN_TRANSPORT=tcp (or tls, port 443) if Railway won't let UDP out.
    """
    stun: str | None = None
    turns: list[tuple[str, str | None, str | None]] = []
    for item in raw if isinstance(raw, list) else []:
        if not isinstance(item, dict):
            continue
        urls = item.get("urls")
        for url in [urls] if isinstance(urls, str) else (urls or []):
            if url.startswith("stun:") and not stun:
                stun = url
            elif url.startswith(("turn:", "turns:")):
                turns.append((url, item.get("username"), item.get("credential")))
    want = os.environ.get("VOICE_TURN_TRANSPORT", "udp").lower()

    def rank(url: str) -> int:
        if want == "tls":
            return 0 if url.startswith("turns:") else 1
        return 0 if f"transport={want}" in url and url.startswith("turn:") else 1

    servers = [IceServer(urls=stun)] if stun else []
    if turns:
        url, username, credential = sorted(turns, key=lambda turn: rank(turn[0]))[0]
        servers.append(IceServer(urls=url, username=username, credential=credential))
    return servers


def _forget(call: Call):
    # Kept a little while after it ends, so a late listener still gets "session.closed".
    asyncio.get_running_loop().call_later(30, lambda: calls.pop(call.id, None))


@app.on_event("startup")
async def load_catalog():
    # Inworld's voice list, so a call can use any voice the admin added (not only ours).
    async def load():
        async with aiohttp.ClientSession() as http:
            await voices.catalog(http)

    task = asyncio.get_running_loop().create_task(load())
    running.add(task)
    task.add_done_callback(running.discard)


@app.get("/health")
async def health():
    return {"ok": not config.problems(), "calls": len(calls), "missing": config.problems()}


@app.post("/v1/live/sessions")
async def create_session(request: Request):
    if not _signed(request.headers.get("authorization")):
        return _refused(401, "unauthorized", "Wrong or missing VOICE_INTERNAL_TOKEN.")
    if config.problems():
        return _refused(503, "not_configured", f"Missing: {', '.join(config.problems())}")
    if sum(1 for call in calls.values() if not call.ended) >= config.max_sessions:
        logger.warning(f"Voice service full ({config.max_sessions} calls): turning a call away")
        return _refused(429, "busy", "Too many calls at once on this voice service.")
    body = await request.json()
    session = body.get("session") or {}
    offer = (body.get("transport") or {}).get("sdp")
    extra = body.get("openmuse") or {}
    if not isinstance(offer, str) or "v=0" not in offer:
        return _refused(400, "bad_offer", "No WebRTC offer.")
    max_seconds = extra.get("maxSeconds")
    limit_minutes = extra.get("limitMinutes")
    reference = extra.get("reference")
    voice = extra.get("voice")
    call = Call(
        instructions=str(session.get("instructions") or ""),
        max_seconds=float(max_seconds) if isinstance(max_seconds, (int, float)) else None,
        limit_minutes=float(limit_minutes) if isinstance(limit_minutes, (int, float)) else None,
        reference=reference if isinstance(reference, str) else "",
        voice=voice if voices.accepts(voice) else voices.default,
        accepts=voices.accepts,
        on_end=_forget,
    )
    connection = SmallWebRTCConnection(ice_servers=_ice_servers(extra.get("iceServers")) or None)
    try:
        await connection.initialize(sdp=offer, type="offer")
    except Exception as error:
        logger.warning(f"Voice call: couldn't answer the offer: {error}")
        return _refused(400, "bad_offer", "Couldn't answer that WebRTC offer.")
    answer = connection.get_answer()
    if not answer:
        return _refused(500, "no_answer", "No WebRTC answer.")
    call.attach_browser(connection.send_app_message)
    transport = SmallWebRTCTransport(
        webrtc_connection=connection,
        params=TransportParams(audio_in_enabled=True, audio_out_enabled=True),
    )

    @transport.event_handler("on_app_message")
    async def on_message(_transport, message, _sender):
        await call.from_browser(message)

    calls[call.id] = call
    task = asyncio.create_task(run_call(call, transport, config, voices))
    running.add(task)
    task.add_done_callback(running.discard)
    logger.info(f"Voice call {call.id} started ({len(calls)} on this service, voice {call.voice})")
    return {"session": {"id": call.id}, "transport": {"type": "webrtc", "sdp": answer["sdp"]}}


@app.websocket("/v1/live/sessions/{call_id}/attach")
async def attach(socket: WebSocket, call_id: str):
    if not _signed(socket.headers.get("authorization")):
        await socket.close(code=4401)
        return
    call = calls.get(call_id)
    if not call:
        await socket.close(code=4404)
        return
    await socket.accept()
    # One writer, so events go out in order and a slow socket never holds up the call.
    outbox: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()

    async def write():
        while (event := await outbox.get()) is not None:
            try:
                await socket.send_text(json.dumps(event))
            except Exception:
                return

    writer = asyncio.create_task(write())

    async def send(event: dict[str, Any]):
        outbox.put_nowait(event)

    await call.attach_sideband(send)
    try:
        while True:
            text = await socket.receive_text()
            try:
                event = json.loads(text)
            except ValueError:
                continue
            if isinstance(event, dict):
                await call.from_api(event)
    except WebSocketDisconnect:
        pass
    finally:
        call.detach_sideband(send)
        outbox.put_nowait(None)
        await asyncio.wait({writer}, timeout=2)


def main():
    import uvicorn

    missing = config.problems()
    logger.info(
        f"Voice service: {config.stt_model} -> {config.llm_model} -> {config.tts_model}"
        + (f" (missing: {', '.join(missing)})" if missing else "")
    )
    uvicorn.run(app, host=config.host, port=config.port, log_level="warning")


if __name__ == "__main__":
    main()
