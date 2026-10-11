"""Checks the listening sounds, the still-checking lines and the voice list, without keys.

    cd apps/voice && python -m tests.sounds_test
"""

import asyncio
import os

import aiohttp
from pipecat.frames.frames import (
    OutputAudioRawFrame,
    UserStartedSpeakingFrame,
    UserStoppedSpeakingFrame,
    VADUserStartedSpeakingFrame,
    VADUserStoppedSpeakingFrame,
)
from pipecat.processors.frame_processor import FrameDirection

os.environ.update(VOICE_TTS="fake", VOICE_STT="fake", VOICE_LLM_MODEL="fake")

from openmuse_voice.call import STILL_CHECKING, Call  # noqa: E402
from openmuse_voice.config import load  # noqa: E402
from openmuse_voice.pipeline import Backchannel  # noqa: E402
from openmuse_voice.voices import CHOICES, LISTENING, Voices  # noqa: E402


class Fast(Backchannel):
    MIN_TURN = 0.2
    WAIT = 0.05
    GAP = 0.6


def listener(call: Call) -> tuple[Fast, list]:
    played: list = []
    sounds = Fast(call)
    sounds.clips = [b"\x00\x01" * 100, b"\x00\x02" * 100, b"\x00\x03" * 100]

    async def push(frame, direction=FrameDirection.DOWNSTREAM):
        if isinstance(frame, OutputAudioRawFrame):
            played.append(frame.audio)

    sounds.push_frame = push  # type: ignore[method-assign]
    return sounds, played


async def say(sounds: Fast, *frames):
    for frame in frames:
        await sounds.process_frame(frame, FrameDirection.DOWNSTREAM)


async def backchannel():
    call = Call(instructions="")

    # A short turn: nothing.
    sounds, played = listener(call)
    await say(sounds, UserStartedSpeakingFrame(), VADUserStoppedSpeakingFrame())
    await asyncio.sleep(0.1)
    assert played == [], "a short turn gets no mm-hmm"

    # A long turn with a pause mid-thought: one, after the wait.
    await asyncio.sleep(0.2)
    await say(sounds, VADUserStoppedSpeakingFrame())
    await asyncio.sleep(0.02)
    assert played == [], "it waits a moment first"
    await asyncio.sleep(0.06)
    assert len(played) == 1, "a long turn with a pause gets one"

    # Another pause in the same turn: nothing (once a turn).
    await say(sounds, VADUserStartedSpeakingFrame(), VADUserStoppedSpeakingFrame())
    await asyncio.sleep(0.1)
    assert len(played) == 1, "only once a turn"

    # Talking again before the wait is over cancels it.
    sounds, played = listener(call)
    await say(sounds, UserStartedSpeakingFrame())
    await asyncio.sleep(0.25)
    await say(sounds, VADUserStoppedSpeakingFrame(), VADUserStartedSpeakingFrame())
    await asyncio.sleep(0.1)
    assert played == [], "talking again first means nothing is said"

    # The turn ending (they've finished) cancels it too: the reply comes instead.
    await say(sounds, VADUserStoppedSpeakingFrame(), UserStoppedSpeakingFrame())
    await asyncio.sleep(0.1)
    assert played == [], "a finished turn gets the reply, not a mm-hmm"

    # Never while the voice itself is talking.
    sounds, played = listener(call)
    call.bot_speaking = True
    await say(sounds, UserStartedSpeakingFrame())
    await asyncio.sleep(0.25)
    await say(sounds, VADUserStoppedSpeakingFrame())
    await asyncio.sleep(0.1)
    assert played == [], "not while the voice is talking"
    call.bot_speaking = False

    # A new turn soon after the last one: not again within GAP; later it's fine, and different.
    sounds, played = listener(call)
    for _ in range(2):
        await say(sounds, UserStartedSpeakingFrame())
        await asyncio.sleep(0.25)
        await say(sounds, VADUserStoppedSpeakingFrame())
        await asyncio.sleep(0.1)
        await say(sounds, UserStoppedSpeakingFrame())
    assert len(played) == 1, "not twice within the gap"
    await asyncio.sleep(0.6)
    await say(sounds, UserStartedSpeakingFrame())
    await asyncio.sleep(0.25)
    await say(sounds, VADUserStoppedSpeakingFrame())
    await asyncio.sleep(0.1)
    assert len(played) == 2 and played[0] != played[1], "a different sound next time"

    # No sounds made (yet): nothing.
    sounds, played = listener(call)
    sounds.clips = []
    await say(sounds, UserStartedSpeakingFrame())
    await asyncio.sleep(0.25)
    await say(sounds, VADUserStoppedSpeakingFrame())
    await asyncio.sleep(0.1)
    assert played == []


async def still_checking():
    call = Call(instructions="")
    said = [call.still_checking() for _ in range(40)]
    assert all(line in STILL_CHECKING for line in said)
    assert all(a != b for a, b in zip(said, said[1:])), "never the same line twice in a row"
    assert len(set(said)) > 2


async def voice_changes():
    voices = Voices(load())
    changed: list[str] = []

    async def set_voice(voice: str):
        changed.append(voice)

    call = Call(instructions="", voice="Ashley", accepts=voices.accepts)
    call.set_voice = set_voice
    update = lambda voice: {  # noqa: E731
        "type": "session.update",
        "session": {"audio": {"output": {"voice": voice}}},
    }
    await call.from_api(update("Dennis"))
    await call.from_api(update("Dennis"))
    await call.from_api(update("Somebody else"))
    await call.from_api(update(None))
    assert changed == ["Dennis"] and call.voice == "Dennis"


async def voice_list():
    voices = Voices(load())
    async with aiohttp.ClientSession() as http:
        offered = await voices.offered(http)
        assert [v["id"] for v in offered] == [c["id"] for c in CHOICES]
        audio, kind = await voices.sample(http, "Dennis")
        assert kind == "audio/wav" and audio.startswith(b"RIFF")
        clips = await voices.clips(http, "Dennis")
        assert len(clips) == len(LISTENING) and all(clips)
        assert all("yeah" not in m.lower() and "right" not in m.lower() for m in LISTENING)
        assert await voices.clips(http, "Dennis") is clips, "made once"
        everyone = await voices.catalog(http)
        assert {"Hades", "Theodore"} <= {v["id"] for v in everyone}, "the whole catalog"
        hades, _ = await voices.sample(http, "Hades")
        assert hades.startswith(b"RIFF"), "samples for any catalog voice"
        murmurs = await voices.listening(http, "Dennis")
        assert murmurs.startswith(b"RIFF") and len(murmurs) > 3 * 0.35 * 24000 * 2
    assert voices.accepts("Theodore") and voices.accepts("Hades"), "ours and the catalog's"
    assert not voices.accepts("Nobody") and not voices.accepts(3)


async def main():
    for test in (backchannel, still_checking, voice_changes, voice_list):
        await test()
        print(f"ok {test.__name__}")


asyncio.run(main())
