"""The front of the voice service: spreads calls over worker processes.

One Python process carries about four calls before its event loop falls behind (WebRTC's audio
packets are handled in Python by aiortc), so the service runs VOICE_WORKERS copies of the app on
local ports and this front sends each new call to the least busy one. A call's id names its
worker ("pc_w3_…"), so the api's sideband for that call goes to the same place. The audio itself
goes straight to the worker over WebRTC, not through here.
"""

import asyncio
import hmac
import os
import re
import sys

from aiohttp import ClientSession, ClientTimeout, WSMsgType, web
from loguru import logger

from .config import load
from .voices import Voices

config = load()
voices = Voices(config)
WORKERS = max(1, int(os.environ.get("VOICE_WORKERS", "2")))
PER_WORKER = max(1, int(os.environ.get("VOICE_CALLS_PER_WORKER", "4")))
BASE_PORT = int(os.environ.get("VOICE_WORKER_BASE_PORT", "8100"))


class Worker:
    def __init__(self, index: int):
        self.index = index
        self.port = BASE_PORT + index
        self.process: asyncio.subprocess.Process | None = None
        self.calls = 0
        self.healthy = False

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.port}"

    async def start(self):
        env = {
            **os.environ,
            "VOICE_WORKER_INDEX": str(self.index),
            "HOST": "127.0.0.1",
            "PORT": str(self.port),
            "VOICE_MAX_SESSIONS": str(PER_WORKER),
        }
        self.process = await asyncio.create_subprocess_exec(
            sys.executable, "-m", "openmuse_voice.app", env=env
        )
        self.healthy = False


workers = [Worker(index) for index in range(WORKERS)]
http: ClientSession | None = None


def _signed(header: str | None) -> bool:
    expected = f"Bearer {config.token}"
    return bool(config.token) and hmac.compare_digest((header or "").encode(), expected.encode())


def _refused(status: int, code: str, message: str) -> web.Response:
    return web.json_response(
        {"error": {"type": "voice_service", "code": code, "message": message}}, status=status
    )


async def watch():
    """Restarts a worker that stops, and keeps each worker's call count fresh."""
    assert http
    while True:
        for worker in workers:
            if worker.process and worker.process.returncode is not None:
                logger.warning(f"Voice worker {worker.index} stopped; starting it again")
                await worker.start()
            try:
                async with http.get(f"{worker.url}/health", timeout=ClientTimeout(total=2)) as r:
                    worker.calls = int((await r.json()).get("calls", 0))
                    worker.healthy = r.status == 200
            except Exception:
                worker.healthy = False
        await asyncio.sleep(2)


async def health(_request: web.Request):
    ready = [w for w in workers if w.healthy]
    return web.json_response(
        {
            "ok": bool(ready) and not config.problems(),
            "calls": sum(w.calls for w in workers),
            "workers": len(ready),
            "capacity": len(ready) * PER_WORKER,
            "missing": config.problems(),
        }
    )


async def create_session(request: web.Request):
    assert http
    if not _signed(request.headers.get("authorization")):
        return _refused(401, "unauthorized", "Wrong or missing VOICE_INTERNAL_TOKEN.")
    free = [w for w in workers if w.healthy and w.calls < PER_WORKER]
    if not free:
        logger.warning(f"Voice service full ({WORKERS} workers x {PER_WORKER} calls)")
        return _refused(429, "busy", "Too many calls at once on this voice service.")
    worker = min(free, key=lambda w: w.calls)
    # Counted now, so calls arriving together don't all pick the same worker.
    worker.calls += 1
    body = await request.read()
    async with http.post(
        f"{worker.url}/v1/live/sessions",
        data=body,
        headers={
            "authorization": request.headers.get("authorization", ""),
            "content-type": "application/json",
        },
        timeout=ClientTimeout(total=30),
    ) as response:
        return web.Response(
            body=await response.read(),
            status=response.status,
            content_type="application/json",
        )


async def attach(request: web.Request):
    assert http
    if not _signed(request.headers.get("authorization")):
        return _refused(401, "unauthorized", "Wrong or missing VOICE_INTERNAL_TOKEN.")
    call_id = request.match_info["call_id"]
    match = re.match(r"pc_w(\d+)_", call_id)
    worker = workers[int(match.group(1))] if match and int(match.group(1)) < WORKERS else None
    if not worker:
        return _refused(404, "not_found", "No such call.")
    upstream = await http.ws_connect(
        f"ws://127.0.0.1:{worker.port}/v1/live/sessions/{call_id}/attach",
        headers={"authorization": request.headers.get("authorization", "")},
    )
    downstream = web.WebSocketResponse(heartbeat=20)
    await downstream.prepare(request)

    async def pipe(source, target):
        async for message in source:
            if message.type == WSMsgType.TEXT:
                await target.send_str(message.data)
            else:
                break

    tasks = [
        asyncio.create_task(pipe(upstream, downstream)),
        asyncio.create_task(pipe(downstream, upstream)),
    ]
    await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
    for task in tasks:
        task.cancel()
    await upstream.close()
    await downstream.close()
    return downstream


async def list_voices(request: web.Request):
    """The voices people can choose for live calls (empty when the voice can't be chosen)."""
    assert http
    if not _signed(request.headers.get("authorization")):
        return _refused(401, "unauthorized", "Wrong or missing VOICE_INTERNAL_TOKEN.")
    return web.json_response({"voices": await voices.offered(http), "default": voices.default})


async def voice_sample(request: web.Request):
    """A short hello in one voice, for the app's Play button."""
    assert http
    if not _signed(request.headers.get("authorization")):
        return _refused(401, "unauthorized", "Wrong or missing VOICE_INTERNAL_TOKEN.")
    voice = request.match_info["voice"]
    if not any(choice["id"] == voice for choice in await voices.offered(http)):
        return _refused(404, "no_voice", "That voice isn't offered.")
    try:
        audio, kind = await voices.sample(http, voice)
    except Exception as error:
        logger.warning(f"Voice sample for {voice} couldn't be made: {error}")
        return _refused(502, "no_sample", "The sample couldn't be made just now.")
    return web.Response(
        body=audio, content_type=kind, headers={"cache-control": "private, max-age=86400"}
    )


async def on_startup(_app: web.Application):
    global http
    http = ClientSession()
    for worker in workers:
        await worker.start()
    asyncio.get_running_loop().create_task(watch())
    # Checks the offered voices against Inworld's list now, so the log says which exist.
    asyncio.get_running_loop().create_task(voices.offered(http))


async def on_cleanup(_app: web.Application):
    for worker in workers:
        if worker.process and worker.process.returncode is None:
            worker.process.terminate()
    if http:
        await http.close()


def main():
    missing = config.problems()
    logger.info(
        f"Voice service: {config.stt_model} -> {config.llm_model} -> {config.tts_model}, "
        f"{WORKERS} workers x {PER_WORKER} calls"
        + (f" (missing: {', '.join(missing)})" if missing else "")
    )
    app = web.Application()
    app.router.add_get("/health", health)
    app.router.add_post("/v1/live/sessions", create_session)
    app.router.add_get("/v1/live/sessions/{call_id}/attach", attach)
    app.router.add_get("/v1/voices", list_voices)
    app.router.add_get("/v1/voices/{voice}/sample", voice_sample)
    app.on_startup.append(on_startup)
    app.on_cleanup.append(on_cleanup)
    web.run_app(app, host=config.host, port=config.port, print=None)
