"""The three services a call uses (listening, thinking, speaking), chosen by the settings.

"fake" stand-ins let the whole call run without keys or a network: the sandbox this was built in
can't reach Soniox, Inworld or Speechify, and a load test shouldn't spend money.
"""

import asyncio
from collections.abc import AsyncGenerator

import aiohttp
import numpy as np
from pipecat.frames.frames import Frame, TranscriptionFrame, TTSAudioRawFrame
from pipecat.services.anthropic.llm import AnthropicLLMService
from pipecat.services.settings import STTSettings, TTSSettings
from pipecat.services.stt_service import SegmentedSTTService
from pipecat.services.tts_service import TTSService
from pipecat.utils.time import time_now_iso8601

from .config import Config


class FakeSTT(SegmentedSTTService):
    """Hears each thing said (cut by the voice detector) as one of a few fixed questions."""

    QUESTIONS = (
        "Hi, how are you today?",
        "What's on my calendar this afternoon?",
        "Thanks, that's all for now.",
    )

    def __init__(self, **kwargs):
        super().__init__(settings=STTSettings(model="fake-stt", language=None), **kwargs)
        self._said = 0

    def can_generate_metrics(self) -> bool:
        return True

    async def run_stt(self, audio: bytes) -> AsyncGenerator[Frame | None, None]:
        await self.start_processing_metrics()
        text = self.QUESTIONS[self._said % len(self.QUESTIONS)]
        self._said += 1
        await self.stop_processing_metrics()
        yield TranscriptionFrame(text, self._user_id, time_now_iso8601())


class FakeTTS(TTSService):
    """Speaks a soft hum, about as long as the words would take (15 characters a second)."""

    def __init__(self, **kwargs):
        super().__init__(
            sample_rate=24000,
            settings=TTSSettings(model="fake-tts", voice=None, language=None),
            **kwargs,
        )

    def can_generate_metrics(self) -> bool:
        return True

    async def run_tts(self, text: str, context_id: str) -> AsyncGenerator[Frame | None, None]:
        await self.start_tts_usage_metrics(text)
        rate = self.sample_rate
        seconds = max(0.3, len(text) / 15)
        # A first chunk after a typical provider's first-byte time.
        await asyncio.sleep(0.12)
        await self.stop_ttfb_metrics()
        chunk = int(rate * 0.04)
        t = np.arange(chunk) / rate
        for index in range(int(seconds / 0.04)):
            phase = index * chunk / rate
            wave = 0.05 * np.sin(2 * np.pi * 220 * (t + phase))
            yield TTSAudioRawFrame(
                audio=(wave * 32767).astype(np.int16).tobytes(),
                sample_rate=rate,
                num_channels=1,
                context_id=context_id,
            )
            # Real services send faster than real time; the transport paces playback.
            await asyncio.sleep(0)


def make_stt(config: Config):
    if config.stt == "fake":
        return FakeSTT()
    from pipecat.services.soniox.stt import SonioxSTTService

    return SonioxSTTService(
        api_key=config.soniox_key,
        settings=SonioxSTTService.Settings(model=config.soniox_model),
    )


class _CountOnce:
    """Anthropic's stream gives the input token count twice: in message_start, and again
    (cumulative) in message_delta. Pipecat 1.12 adds both, doubling the prompt's size and cost;
    the second is zeroed so it's counted once."""

    def __init__(self, stream):
        self._stream = stream

    def __aiter__(self):
        return self

    async def __anext__(self):
        event = await self._stream.__anext__()
        usage = getattr(event, "usage", None) if event.type == "message_delta" else None
        if usage is not None and getattr(usage, "input_tokens", None):
            usage.input_tokens = 0
        return event

    def __getattr__(self, name):
        return getattr(self._stream, name)


class _AnthropicLLM(AnthropicLLMService):
    async def _create_message_stream(self, api_call, params):
        return _CountOnce(await super()._create_message_stream(api_call, params))


def make_llm(config: Config, instructions: str):
    """Claude, with the instructions cached: they're the same for every turn of a call.

    A local mock of Anthropic's API can stand in through ANTHROPIC_BASE_URL (the SDK reads it).
    """
    return _AnthropicLLM(
        api_key=config.anthropic_key or "local-mock",
        settings=AnthropicLLMService.Settings(
            model=config.llm_model,
            system_instruction=instructions,
            max_tokens=config.llm_max_tokens,
            enable_prompt_caching=True,
        ),
    )


def make_tts(config: Config, session: aiohttp.ClientSession):
    if config.tts == "fake":
        return FakeTTS()
    if config.tts == "speechify":
        from pipecat.services.speechify.tts import SpeechifyHttpTTSService

        return SpeechifyHttpTTSService(
            api_key=config.speechify_key,
            aiohttp_session=session,
            settings=SpeechifyHttpTTSService.Settings(
                model=config.speechify_model, voice=config.speechify_voice
            ),
        )
    if config.tts == "inworld":
        from pipecat.services.inworld.tts import InworldTTSService

        return InworldTTSService(
            api_key=config.inworld_key,
            settings=InworldTTSService.Settings(
                model=config.inworld_model, voice=config.inworld_voice
            ),
        )
    raise ValueError(f"VOICE_TTS must be inworld, speechify or fake (not {config.tts!r})")

