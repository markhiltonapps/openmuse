"""One call: its state, and the events it shares with the api and the browser.

The events have the same names and shapes as OpenAI's live voice, so the api's call handling
(hand-offs, saved calls, approving by voice, minutes) and the app's call screen work unchanged:

- to the api (the "sideband" websocket) and the browser (the WebRTC data channel):
  session.started, session.input_transcript.delta, session.output_transcript.delta,
  session.delegation.created, session.commentary.appended, session.closed
- to the api only: session.usage.updated, and session.metrics (ours: tokens, characters, latency)
- from the api: session.commentary.append, session.thinking.append, session.close, and
  session.update (ours: a new voice chosen during the call)
- from the browser: session.close
"""

import asyncio
import os
import random
import time
import uuid
from collections.abc import Awaitable, Callable
from typing import Any

from loguru import logger

Send = Callable[[dict[str, Any]], Awaitable[None]]

# Said by the voice when a hand-off has been quiet for a while and nobody is talking; never the
# same line twice in a row.
STILL_CHECKING = (
    "Still on it, one moment.",
    "Bear with me, nearly there.",
    "Still checking, one sec.",
    "Just a moment more.",
    "Hang on, still looking.",
)


class Call:
    def __init__(
        self,
        *,
        instructions: str,
        max_seconds: float | None = None,
        limit_minutes: float | None = None,
        reference: str = "",
        voice: str = "",
        accepts: Callable[[Any], bool] | None = None,
        on_end: Callable[["Call"], None] | None = None,
    ):
        # Which worker process holds it, so the front router sends its sideband there.
        self.id = f"pc_w{os.environ.get('VOICE_WORKER_INDEX', '0')}_{uuid.uuid4().hex}"
        self.instructions = instructions
        self.max_seconds = max_seconds
        # Their month's minutes on this voice (max_seconds is what's left of them).
        self.limit_minutes = limit_minutes
        # How the app works (the api's guide and Help topics), the same for everyone.
        self.reference = reference
        # The voice it speaks with, and which voices it may switch to during the call.
        self.voice = voice
        self._accepts = accepts or (lambda _voice: False)
        self._last_still = ""
        self.started = time.monotonic()
        self.ended = False
        self.reason: str | None = None
        self._on_end = on_end
        self._sideband: list[Send] = []
        # Events from before the api attached, so nothing is missed.
        self._backlog: list[dict[str, Any]] = []
        self._browser: Callable[[dict[str, Any]], None] | None = None
        self._hand_offs: dict[str, asyncio.Future[str]] = {}
        # Hooks the pipeline sets: say a fixed line, add a note to the conversation, stop.
        self.speak: Callable[[str], Awaitable[None]] | None = None
        self.note: Callable[[str], Awaitable[None]] | None = None
        self.stop: Callable[[], Awaitable[None]] | None = None
        self.set_voice: Callable[[str], Awaitable[None]] | None = None
        self.bot_speaking = False
        self.user_speaking = False
        self._ticker: asyncio.Task | None = None

    # The browser's data channel and the api's sideband.
    def attach_browser(self, send: Callable[[dict[str, Any]], None]):
        self._browser = send

    async def attach_sideband(self, send: Send):
        self._sideband.append(send)
        backlog, self._backlog = self._backlog, []
        for event in backlog:
            await send(event)

    def detach_sideband(self, send: Send):
        if send in self._sideband:
            self._sideband.remove(send)

    async def emit(self, event: dict[str, Any], browser: bool = True):
        if browser and self._browser:
            try:
                self._browser(event)
            except Exception as error:  # The channel closed; the call is ending.
                logger.debug(f"Voice call {self.id}: browser event not sent: {error}")
        if not self._sideband:
            self._backlog.append(event)
            return
        for send in list(self._sideband):
            try:
                await send(event)
            except Exception as error:
                logger.debug(f"Voice call {self.id}: api event not sent: {error}")

    @property
    def seconds(self) -> float:
        return time.monotonic() - self.started

    # What was said.
    async def heard(self, text: str):
        if text.strip():
            await self.emit({"type": "session.input_transcript.delta", "delta": f"{text.strip()} "})

    async def said(self, text: str):
        if text.strip():
            await self.emit({"type": "session.output_transcript.delta", "delta": f"{text.strip()} "})

    async def metrics(self, **values: Any):
        await self.emit({"type": "session.metrics", **values}, browser=False)

    # Hand-offs: the voice asks the person's agent (on the api) and waits for its answer.
    async def hand_off(self) -> str:
        delegation_id = f"dg_{uuid.uuid4().hex[:16]}"
        future: asyncio.Future[str] = asyncio.get_running_loop().create_future()
        self._hand_offs[delegation_id] = future
        await self.emit({"type": "session.delegation.created", "delegation": {"id": delegation_id}})
        try:
            return await future
        finally:
            self._hand_offs.pop(delegation_id, None)

    async def from_api(self, event: dict[str, Any]):
        kind = event.get("type")
        content = str(event.get("content") or "")
        delegation_id = event.get("delegation_id")
        if kind == "session.close":
            # As OpenAI says it: the app then asks the api why (quiet, the hour, another call).
            await self.end("close_requested")
        elif kind == "session.commentary.append":
            waiting = self._hand_offs.get(delegation_id) if delegation_id else None
            if waiting and not waiting.done():
                waiting.set_result(content)
                # The app fetches what was put on screen when it sees this.
                await self.emit(
                    {"type": "session.commentary.appended", "delegation_id": delegation_id}
                )
            elif self.note:
                # Something urgent, or an answer whose question has already moved on.
                await self.note(content)
        elif kind == "session.thinking.append":
            # Progress notes are for the voice's ears only; a long silence gets a short word.
            if (
                content.startswith("Still checking")
                and self.speak
                and not self.bot_speaking
                and not self.user_speaking
            ):
                await self.speak(self.still_checking())
        elif kind == "session.update":
            # A voice chosen during the call: used from the next thing said.
            voice = (((event.get("session") or {}).get("audio") or {}).get("output") or {}).get(
                "voice"
            )
            if voice != self.voice and self._accepts(voice) and self.set_voice:
                self.voice = voice
                await self.set_voice(voice)

    def still_checking(self) -> str:
        line = random.choice([line for line in STILL_CHECKING if line != self._last_still])
        self._last_still = line
        return line

    async def from_browser(self, message: Any):
        if isinstance(message, dict) and message.get("type") == "session.close":
            await self.end("ended")

    # The clock: minutes for the api, and the end of the person's monthly allowance.
    def start_clock(self):
        self._ticker = asyncio.create_task(self._tick())

    def allowance_note(self) -> str:
        """A line for the instructions: the minutes they have left this month, if limited."""
        if self.max_seconds is None or not self.limit_minutes:
            return ""
        left = max(0, round(self.max_seconds / 60))
        line = (
            f"Live talk this month: they have about {left} of their {round(self.limit_minutes)} "
            "minutes left. Mention it only if they ask"
        )
        if left <= 10:
            line += ", except once in your hello, in a few words, since they're nearly out"
        return line + "."

    async def _tick(self):
        warned = False
        while not self.ended:
            await asyncio.sleep(1)
            if self.max_seconds is not None:
                if self.seconds >= self.max_seconds:
                    await self.end("limit")
                    return
                # A word before the month's minutes run out, rather than a sudden hang-up.
                if not warned and self.max_seconds - self.seconds <= 20 and self.note:
                    warned = True
                    await self.note(
                        "Their live-talk minutes for this month run out in about 20 seconds. "
                        "Tell them now, in one short sentence, that the call will end soon and "
                        "that they can still type to you."
                    )
            if int(self.seconds) % 10 == 0:
                await self.emit(
                    {"type": "session.usage.updated", "usage": {"seconds": self.seconds}},
                    browser=False,
                )

    async def end(self, reason: str):
        if self.ended:
            return
        self.ended = True
        self.reason = reason
        for future in self._hand_offs.values():
            if not future.done():
                future.cancel()
        await self.emit(
            {"type": "session.closed", "reason": reason, "usage": {"seconds": self.seconds}}
        )
        # Long enough for "session.closed" (and its reason) to reach the browser before the
        # connection goes; the app says why the call ended from it.
        if reason != "connection_lost":
            await asyncio.sleep(0.5)
        if self._ticker and self._ticker is not asyncio.current_task():
            self._ticker.cancel()
        if self.stop:
            try:
                await self.stop()
            except Exception as error:
                logger.warning(f"Voice call {self.id}: stopping: {error}")
        if self._on_end:
            self._on_end(self)
