"""The voices people can choose for live calls, and short recordings made with them.

A hand-picked few of Inworld's voices. The service checks them against Inworld's own list, so the
app never offers one that doesn't exist. Recordings (a sample for the app's picker, and the
"mm-hmm" sounds a call makes while listening) are made once per process and kept; each is a few
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

# Shown in the app in this order. Descriptions are ours: short, about the sound, and whether it's
# a man's or a woman's voice (so "a man's voice" can be matched when said).
CHOICES: tuple[dict[str, str], ...] = (
    {"id": "Ashley", "description": "A woman’s voice, warm and natural"},
    {"id": "Deborah", "description": "A woman’s voice, gentle and elegant"},
    {"id": "Olivia", "description": "A woman’s voice, bright and British"},
    {"id": "Elizabeth", "description": "A woman’s voice, clear and steady"},
    {"id": "Dennis", "description": "A man’s voice, calm and friendly"},
    {"id": "Alex", "description": "A man’s voice, lively and expressive"},
    {"id": "Theodore", "description": "A man’s voice, deep and unhurried"},
    {"id": "Ronald", "description": "A man’s voice, confident and British"},
)

SAMPLE = "Hi! This is how I'll sound when we talk. What can I help you with today?"
# Said now and then while they talk (see Backchannel in pipeline.py).
LISTENING = ("Mm-hmm.", "Yeah.", "Right.")
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


def _pcm(wav: bytes) -> bytes:
    """Raw 16-bit samples from a WAV, without the silence around the word, a little quieter."""
    with wave.open(io.BytesIO(wav)) as file:
        samples = np.frombuffer(file.readframes(file.getnframes()), dtype=np.int16)
    loud = np.flatnonzero(np.abs(samples) > 600)
    if loud.size:
        pad = int(RATE * 0.03)
        samples = samples[max(0, loud[0] - pad) : loud[-1] + pad]
    return (samples * 0.8).astype(np.int16).tobytes()


class Voices:
    def __init__(self, config: Config):
        self._config = config
        self._found: set[str] | None = None
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
        """A voice a call may use: one of ours, or the configured default."""
        return (
            self.choosable
            and isinstance(voice, str)
            and (voice == self.default or any(c["id"] == voice for c in CHOICES))
        )

    async def _check(self, http: aiohttp.ClientSession) -> set[str] | None:
        """Inworld's English voices by id, or None when the list can't be read."""
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
        found = set()
        for item in body.get("voices") or []:
            if isinstance(item, dict):
                for key in ("voiceId", "name", "displayName"):
                    if isinstance(item.get(key), str):
                        found.add(item[key].split("/")[-1])
        return found

    async def offered(self, http: aiohttp.ClientSession) -> list[dict[str, str]]:
        """The choices that really exist, for the app's picker."""
        if not self.choosable:
            return []
        if self._config.tts == "fake":
            return [dict(c) for c in CHOICES]
        async with self._lock:
            stale = time.monotonic() - self._checked > (
                CHECK_EVERY if self._found is not None else RETRY_AFTER
            )
            if stale:
                self._checked = time.monotonic()
                try:
                    found = await self._check(http)
                except Exception as error:
                    logger.warning(f"Inworld's voice list couldn't be read: {error}")
                    found = None
                if found is not None:
                    self._found = found
                    missing = [c["id"] for c in CHOICES if c["id"] not in found]
                    logger.info(
                        f"Inworld has {len(found)} English voices; offering "
                        f"{len(CHOICES) - len(missing)} of ours"
                        + (f" (not found: {', '.join(missing)})" if missing else "")
                    )
        if self._found is None:
            # Unknown: only the voice calls already use, so a choice can't break a call.
            return [c for c in CHOICES if c["id"] == self.default] or [
                {"id": self.default, "description": "The usual voice"}
            ]
        return [dict(c) for c in CHOICES if c["id"] in self._found]

    async def _speak(
        self, http: aiohttp.ClientSession, text: str, voice: str, encoding: str
    ) -> bytes:
        async with http.post(
            f"{INWORLD}/voice",
            json={
                "text": text,
                "voiceId": voice,
                "modelId": self._config.inworld_model,
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
        """A short hello in that voice, and its content type."""
        if voice not in self._samples:
            if self._config.tts == "fake":
                pitch = 180 + 20 * [c["id"] for c in CHOICES].index(voice)
                self._samples[voice] = (_as_wav(_hum(1.5, pitch)), "audio/wav")
            else:
                audio = await self._speak(http, SAMPLE, voice, "MP3")
                self._samples[voice] = (audio, "audio/mpeg")
        return self._samples[voice]

    def clips(self, http: aiohttp.ClientSession, voice: str) -> "asyncio.Task[list[bytes]]":
        """The listening sounds in that voice (raw 16-bit audio at RATE), made once."""
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
            clips = [_pcm(await self._speak(http, text, voice, "LINEAR16")) for text in LISTENING]
        else:
            clips = []
        self._clips[voice] = clips
        return clips
