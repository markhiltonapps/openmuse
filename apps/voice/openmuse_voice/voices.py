"""The voices people can choose for live calls, and short recordings made with them.

A hand-picked few of Inworld's voices are offered at first; the admin can browse all of Inworld's
English voices (the catalog) and add others. The service checks everything against Inworld's own
list, so the app never offers one that doesn't exist. Recordings (a sample for the app's picker,
and the murmurs a call makes while listening) are made once per process and kept; each is a few
words, so they cost next to nothing.
"""

import asyncio
import base64
import io
import time
import wave
from typing import Any

import aiohttp
import numpy as np
from loguru import logger

from .config import Config

# Offered at first, in this order: the owner's picks from Inworld's voices (2026-10-11), then
# the first hand-picked few. Descriptions are ours where we've heard them (short, about the sound,
# and whether it's a man's or a woman's voice, so "a man's voice" can be matched when said); an
# empty one is filled from Inworld's own description.
CHOICES: tuple[dict[str, str], ...] = (
    {"id": "Sarah", "description": "A woman’s voice, quick and curious"},
    {"id": "Olivia", "description": "A woman’s voice, bright and British"},
    {"id": "Piper", "description": "A woman’s voice, bright and upbeat"},
    {"id": "Brook", "description": ""},
    {"id": "Mia", "description": "A young woman’s voice, lively and expressive"},
    {"id": "Riley", "description": "A young woman’s voice, light and playful"},
    {"id": "Jessica", "description": "A woman’s voice, warm and encouraging"},
    {"id": "Ashley", "description": "A woman’s voice, warm and natural"},
    {"id": "Deborah", "description": "A woman’s voice, gentle and elegant"},
    {"id": "Elizabeth", "description": "A woman’s voice, clear and steady"},
    {"id": "Dennis", "description": "A man’s voice, calm and friendly"},
    {"id": "Alex", "description": "A man’s voice, lively and expressive"},
    {"id": "Theodore", "description": "A man’s voice, deep and unhurried"},
    {"id": "Ronald", "description": "A man’s voice, confident and British"},
)
# Stand-ins for Inworld's catalog in local runs (fake voice), beyond the choices above.
FAKE_EXTRA: tuple[dict[str, str], ...] = (
    {"id": "Hades", "description": "A man’s voice, gravelly and commanding"},
    {"id": "Pixie", "description": "A woman’s voice, high and playful"},
    {"id": "Craig", "description": "A man’s voice, older and British"},
)

SAMPLE = "Hi! This is how I'll sound when we talk. What can I help you with today?"
# Murmured now and then while they talk (see Backchannel in pipeline.py): no real words, so they
# never sound like agreeing to something. Made with Inworld's top model, which follows the
# direction in brackets; if it can't, they're made plainly with the calls' own model.
LISTENING = ("Mm-hmm.", "Mhm.", "Uh-huh.")
STEER = "[softly and briefly, like someone quietly listening on the phone] "
# How loud the murmurs play next to speech: in the background.
MURMUR_LEVEL = 0.6
# The rate calls play audio at; the recordings are made at it too.
RATE = 24000

INWORLD = "https://api.inworld.ai/tts/v1"
# How long Inworld's list is trusted, and how soon to ask again after it couldn't be read.
CHECK_EVERY = 6 * 3600
RETRY_AFTER = 300


def _hum(seconds: float, pitch: float = 220) -> bytes:
    """A soft tone standing in for speech when there's no voice service (local runs)."""
    t = np.arange(int(RATE * seconds)) / RATE
    wave_ = 0.05 * np.sin(2 * np.pi * pitch * t)
    return (wave_ * 32767).astype(np.int16).tobytes()


def _as_wav(pcm: bytes) -> bytes:
    out = io.BytesIO()
    with wave.open(out, "wb") as file:
        file.setnchannels(1)
        file.setsampwidth(2)
        file.setframerate(RATE)
        file.writeframes(pcm)
    return out.getvalue()


def _pcm(wav: bytes, level: float = MURMUR_LEVEL) -> bytes:
    """Raw 16-bit samples from a WAV, without the silence around the sound, at `level`."""
    with wave.open(io.BytesIO(wav)) as file:
        samples = np.frombuffer(file.readframes(file.getnframes()), dtype=np.int16)
    loud = np.flatnonzero(np.abs(samples) > 600)
    if loud.size:
        pad = int(RATE * 0.03)
        samples = samples[max(0, loud[0] - pad) : loud[-1] + pad]
    return (samples * level).astype(np.int16).tobytes()


def _described(item: dict[str, Any]) -> str:
    """A short line for a voice from Inworld's own words: its first sentence, kept brief."""
    text = item.get("description") if isinstance(item.get("description"), str) else ""
    first = text.strip().split(". ")[0].rstrip(".")
    return first if len(first) <= 90 else f"{first[:87].rstrip()}…"


class Voices:
    def __init__(self, config: Config):
        self._config = config
        # Inworld's English voices, by id: {id, description}.
        self._catalog: dict[str, dict[str, str]] | None = None
        self._checked = 0.0
        self._lock = asyncio.Lock()
        self._samples: dict[str, tuple[bytes, str]] = {}
        self._clips: dict[str, list[bytes]] = {}
        self._making: dict[str, asyncio.Task] = {}

    @property
    def choosable(self) -> bool:
        """Only Inworld's voices are offered; Speechify keeps its one voice."""
        return self._config.tts in ("inworld", "fake")

    @property
    def default(self) -> str:
        return self._config.inworld_voice if self._config.tts == "inworld" else CHOICES[0]["id"]

    def accepts(self, voice: Any) -> bool:
        """A voice a call may use: the default, one of ours, or any in Inworld's catalog."""
        if not (self.choosable and isinstance(voice, str)):
            return False
        if voice == self.default or any(c["id"] == voice for c in CHOICES):
            return True
        if self._config.tts == "fake":
            return any(c["id"] == voice for c in FAKE_EXTRA)
        return self._catalog is not None and voice in self._catalog

    async def _check(self, http: aiohttp.ClientSession) -> dict[str, dict[str, str]] | None:
        """Inworld's English voices, or None when the list can't be read."""
        async with http.get(
            f"{INWORLD}/voices",
            params={"filter": "language=en"},
            headers={"Authorization": f"Basic {self._config.inworld_key}"},
            timeout=aiohttp.ClientTimeout(total=15),
        ) as response:
            if response.status != 200:
                logger.warning(f"Inworld's voice list: {response.status} {await response.text()}")
                return None
            body = await response.json()
        found: dict[str, dict[str, str]] = {}
        for item in body.get("voices") or []:
            if not isinstance(item, dict):
                continue
            raw = item.get("voiceId") or item.get("name") or item.get("displayName")
            if isinstance(raw, str) and raw:
                voice = raw.split("/")[-1]
                found[voice] = {"id": voice, "description": _described(item)}
        return found

    async def _fresh(self, http: aiohttp.ClientSession):
        """Reads Inworld's list when it's due (logging what's offered the first time)."""
        async with self._lock:
            due = time.monotonic() - self._checked > (
                CHECK_EVERY if self._catalog is not None else RETRY_AFTER
            )
            if not due:
                return
            self._checked = time.monotonic()
            try:
                found = await self._check(http)
            except Exception as error:
                logger.warning(f"Inworld's voice list couldn't be read: {error}")
                found = None
            if found is not None:
                self._catalog = found
                missing = [c["id"] for c in CHOICES if c["id"] not in found]
                if self.default not in found:
                    logger.warning(f"The usual voice {self.default} isn't one of Inworld's")
                # Ours without a description of their own borrow Inworld's: log what they got,
                # so an empty one can be written (the card shows "A voice from Inworld").
                borrowed = [c["id"] for c in CHOICES if not c["description"] and c["id"] in found]
                for voice in borrowed:
                    logger.info(
                        f"Inworld describes {voice} as: {found[voice]['description'] or '(nothing)'}"
                    )
                logger.info(
                    f"Inworld has {len(found)} English voices; offering "
                    f"{len(CHOICES) - len(missing)} of ours"
                    + (f" (not found: {', '.join(missing)})" if missing else "")
                )

    async def offered(self, http: aiohttp.ClientSession) -> list[dict[str, str]]:
        """Our hand-picked choices that really exist, for the app's picker."""
        if not self.choosable:
            return []
        if self._config.tts == "fake":
            return [self._filled(c) for c in CHOICES]
        await self._fresh(http)
        if self._catalog is None:
            # Unknown: only the voice calls already use, so a choice can't break a call.
            return [self._filled(c) for c in CHOICES if c["id"] == self.default] or [
                {"id": self.default, "description": "The usual voice"}
            ]
        return [self._filled(c) for c in CHOICES if c["id"] in self._catalog]

    def _filled(self, choice: dict[str, str]) -> dict[str, str]:
        """Our description, or Inworld's when we haven't written one."""
        if choice["description"]:
            return dict(choice)
        inworld = (self._catalog or {}).get(choice["id"], {}).get("description", "")
        return {"id": choice["id"], "description": inworld or "A voice from Inworld"}

    async def catalog(self, http: aiohttp.ClientSession) -> list[dict[str, str]]:
        """All of Inworld's English voices, for the admin's browser (ours keep our descriptions)."""
        if not self.choosable:
            return []
        if self._config.tts == "fake":
            return [self._filled(c) for c in (*CHOICES, *FAKE_EXTRA)]
        await self._fresh(http)
        if self._catalog is None:
            return []
        ours = {c["id"]: c for c in CHOICES if c["description"]}
        return sorted(
            (dict(ours.get(voice, entry)) for voice, entry in self._catalog.items()),
            key=lambda entry: entry["id"].lower(),
        )

    async def _speak(
        self,
        http: aiohttp.ClientSession,
        text: str,
        voice: str,
        encoding: str,
        model: str | None = None,
    ) -> bytes:
        async with http.post(
            f"{INWORLD}/voice",
            json={
                "text": text,
                "voiceId": voice,
                "modelId": model or self._config.inworld_model,
                "audioConfig": {"audioEncoding": encoding, "sampleRateHertz": RATE},
            },
            headers={"Authorization": f"Basic {self._config.inworld_key}"},
            timeout=aiohttp.ClientTimeout(total=20),
        ) as response:
            if response.status != 200:
                raise RuntimeError(f"Inworld {response.status}: {await response.text()}")
            body = await response.json()
        return base64.b64decode(body["audioContent"])

    async def sample(self, http: aiohttp.ClientSession, voice: str) -> tuple[bytes, str]:
        """A short hello in that voice (as calls sound), and its content type."""
        if voice not in self._samples:
            if self._config.tts == "fake":
                names = [c["id"] for c in (*CHOICES, *FAKE_EXTRA)]
                pitch = 180 + 15 * (names.index(voice) if voice in names else 0)
                self._samples[voice] = (_as_wav(_hum(1.5, pitch)), "audio/wav")
            else:
                audio = await self._speak(http, SAMPLE, voice, "MP3")
                self._samples[voice] = (audio, "audio/mpeg")
        return self._samples[voice]

    def clips(self, http: aiohttp.ClientSession, voice: str) -> "asyncio.Task[list[bytes]]":
        """The listening murmurs in that voice (raw 16-bit audio at RATE), made once."""
        task = self._making.get(voice)
        if task is None or (task.done() and (task.cancelled() or task.exception())):
            task = asyncio.create_task(self._make_clips(http, voice))
            self._making[voice] = task
        return task

    async def _make_clips(self, http: aiohttp.ClientSession, voice: str) -> list[bytes]:
        if voice in self._clips:
            return self._clips[voice]
        if self._config.tts == "fake":
            clips = [_hum(0.35, 300) for _ in LISTENING]
        elif self._config.tts == "inworld":
            try:
                clips = [
                    _pcm(
                        await self._speak(
                            http,
                            STEER + text,
                            voice,
                            "LINEAR16",
                            self._config.inworld_listen_model,
                        )
                    )
                    for text in LISTENING
                ]
            except Exception as error:
                # The top model or its directions aren't available: plain, with the calls' model.
                logger.warning(f"Listening sounds for {voice} made plainly: {error}")
                clips = [
                    _pcm(await self._speak(http, text, voice, "LINEAR16")) for text in LISTENING
                ]
        else:
            clips = []
        self._clips[voice] = clips
        return clips

    async def listening(self, http: aiohttp.ClientSession, voice: str) -> bytes:
        """The murmurs one after another (a WAV), for the admin to hear how calls will sound."""
        clips = await self.clips(http, voice)
        gap = b"\x00\x00" * int(RATE * 0.7)
        return _as_wav(gap.join(clips))
