"""The voice pipeline: listen (Soniox) -> think (Claude) -> speak (Inworld or Speechify).

It takes any Pipecat transport, so the browser's WebRTC today and a phone line (Twilio's media
stream) later run the same pipeline; only the transport and how it's started differ.
"""

import asyncio
import random
import time

import aiohttp
from loguru import logger
from pipecat.adapters.schemas.function_schema import FunctionSchema
from pipecat.adapters.schemas.tools_schema import ToolsSchema
from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.audio.vad.vad_analyzer import VADParams
from pipecat.frames.frames import (
    Frame,
    BotStartedSpeakingFrame,
    BotStoppedSpeakingFrame,
    LLMMessagesAppendFrame,
    LLMRunFrame,
    MetricsFrame,
    OutputAudioRawFrame,
    TranscriptionFrame,
    TTSSpeakFrame,
    TTSTextFrame,
    TTSUpdateSettingsFrame,
    UserStartedSpeakingFrame,
    UserStoppedSpeakingFrame,
    VADUserStartedSpeakingFrame,
    VADUserStoppedSpeakingFrame,
)
from pipecat.metrics.metrics import LLMUsageMetricsData, TTSUsageMetricsData
from pipecat.observers.base_observer import BaseObserver, FramePushed
from pipecat.observers.user_bot_latency_observer import UserBotLatencyObserver
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.worker import PipelineParams, PipelineWorker
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import (
    LLMContextAggregatorPair,
    LLMUserAggregatorParams,
)
from pipecat.services.llm_service import FunctionCallParams
from pipecat.services.settings import TTSSettings
from pipecat.transports.base_transport import BaseTransport
from pipecat.workers.runner import WorkerRunner

from .call import Call
from .config import Config
from .services import make_llm, make_stt, make_tts
from .voices import RATE, Voices

# Put before the instructions the api sends (the same ones OpenAI's voice gets).
VOICE_RULES = """How this voice works:
- Keep each reply to one or two short sentences unless they ask for more.
- Everything you write is spoken aloud: no lists, markdown, emoji, symbols or links.
- To hand something off, say a short line such as "One sec" and call the hand_off tool in the same reply. Its answer comes back a little later; if they say something else meanwhile, answer as usual, and when it arrives, tell them briefly in your own words.
- Don't mention handing off; to them, it's all you.
- For how to use this app, answer from "How this app works" below when it covers the question; hand off anything it doesn't cover, and anything they want done.
- Never say you've looked something up or done something unless an answer from hand_off says so.
- The little murmurs you make while they talk ("mm-hmm", "uh-huh") can't be turned off yet. If they ask, say so kindly; never promise to stop them."""

HAND_OFF = FunctionSchema(
    name="hand_off",
    description=(
        "Hand a request to the person's own agent, which can look things up (their calendar, "
        "email, files, jobs, people, the web, how to use this app) and do things for them "
        "(reminders, notes, emails, bookings, jobs, approvals). Use it for anything you don't "
        "already know from the instructions. The answer arrives later as a result."
    ),
    properties={
        "request": {
            "type": "string",
            "description": "What they asked for, in a few words.",
        }
    },
    required=["request"],
)


class Heard(FrameProcessor):
    """After the STT: passes on what the person said."""

    def __init__(self, call: Call):
        super().__init__()
        self._call = call

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)
        if isinstance(frame, TranscriptionFrame):
            await self._call.heard(frame.text)
        await self.push_frame(frame, direction)


class Played(FrameProcessor):
    """After the speaker: passes on the words as they're played (not those cut off)."""

    def __init__(self, call: Call):
        super().__init__()
        self._call = call

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)
        if isinstance(frame, TTSTextFrame):
            await self._call.said(frame.text)
        elif isinstance(frame, BotStartedSpeakingFrame):
            self._call.bot_speaking = True
        elif isinstance(frame, BotStoppedSpeakingFrame):
            self._call.bot_speaking = False
        await self.push_frame(frame, direction)


class Backchannel(FrameProcessor):
    """Murmurs "mm-hmm" now and then while they talk, as people do on the phone.

    Sparingly: only once they've been talking a while (MIN_TURN), when they pause but the turn
    detector hasn't decided they've finished, after a short silence (WAIT), at most once a turn
    and never within GAP of the last one. If they start talking again first, nothing is said.
    The sounds are short recordings in the call's voice, made once (no cost per call).
    """

    MIN_TURN = 5.0
    WAIT = 0.45
    GAP = 15.0

    def __init__(self, call: Call):
        super().__init__()
        self._call = call
        self.clips: list[bytes] = []
        self._turn_started: float | None = None
        self._said_this_turn = False
        # So the first one of a call doesn't wait for GAP.
        self._last = -self.GAP
        self._last_clip = -1
        self._pending: asyncio.Task | None = None

    def _cancel(self):
        if self._pending and not self._pending.done():
            self._pending.cancel()
        self._pending = None

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)
        if isinstance(frame, UserStartedSpeakingFrame):
            self._turn_started = time.monotonic()
            self._said_this_turn = False
        elif isinstance(frame, UserStoppedSpeakingFrame):
            self._turn_started = None
            self._cancel()
        elif isinstance(frame, VADUserStartedSpeakingFrame):
            self._cancel()
        elif isinstance(frame, VADUserStoppedSpeakingFrame) and self._due():
            self._cancel()
            self._pending = asyncio.create_task(self._after_pause())
        await self.push_frame(frame, direction)

    def _due(self) -> bool:
        now = time.monotonic()
        return (
            bool(self.clips)
            and self._turn_started is not None
            and not self._said_this_turn
            and now - self._turn_started >= self.MIN_TURN
            and now - self._last >= self.GAP
            and not self._call.bot_speaking
        )

    async def _after_pause(self):
        await asyncio.sleep(self.WAIT)
        # Still in their turn, still quiet, and nothing else being said.
        if not self._due():
            return
        index = random.choice([i for i in range(len(self.clips)) if i != self._last_clip] or [0])
        self._last_clip, self._said_this_turn, self._last = index, True, time.monotonic()
        await self.push_frame(
            OutputAudioRawFrame(audio=self.clips[index], sample_rate=RATE, num_channels=1)
        )

    async def cleanup(self):
        self._cancel()
        await super().cleanup()


class Usage(BaseObserver):
    """Tokens and characters used, and whether the person is talking (each frame seen once)."""

    def __init__(self, call: Call, config: Config):
        # Seeing every hop of every audio frame costs real CPU; the first push is enough here.
        super().__init__(observe_every_push=False)
        self._call = call
        self._config = config

    async def on_push_frame(self, data: FramePushed):
        frame = data.frame
        call = self._call
        if isinstance(frame, UserStartedSpeakingFrame):
            call.user_speaking = True
        elif isinstance(frame, UserStoppedSpeakingFrame):
            call.user_speaking = False
        elif isinstance(frame, MetricsFrame):
            for item in frame.data:
                if isinstance(item, LLMUsageMetricsData):
                    usage = item.value
                    await call.metrics(
                        llm={
                            "model": item.model or self._config.llm_model,
                            # Anthropic reports input net of the cache, with the cache apart.
                            "input": usage.prompt_tokens,
                            "cacheRead": usage.cache_read_input_tokens or 0,
                            "cacheWrite": usage.cache_creation_input_tokens or 0,
                            "output": usage.completion_tokens,
                        }
                    )
                elif isinstance(item, TTSUsageMetricsData):
                    await call.metrics(
                        tts={"model": self._config.tts_model, "characters": int(item.value)}
                    )


async def run_call(
    call: Call, transport: BaseTransport, config: Config, voices: Voices | None = None
) -> None:
    """Runs one call until it ends; `call.stop` ends it from outside."""
    async with aiohttp.ClientSession() as http:
        stt = make_stt(config)
        # What's the same for everyone first (rules, how the app works), then this person and
        # their day, then this month's minutes. Claude Haiku caches only prompts of 4,096 tokens
        # or more; the reference takes it past that, so each turn after the first is cheap.
        system = "\n\n".join(
            part
            for part in (VOICE_RULES, call.reference, call.instructions, call.allowance_note())
            if part
        )
        llm = make_llm(config, system)
        tts = make_tts(config, http, call.voice)
        listening = Backchannel(call)

        async def load_clips(voice: str):
            if not voices:
                return
            try:
                clips = await voices.clips(http, voice)
            except Exception as error:
                logger.warning(f"Voice call {call.id}: no listening sounds for {voice}: {error}")
                return
            if call.voice == voice:
                listening.clips = clips

        if voices and voices.choosable:
            asyncio.create_task(load_clips(call.voice))

        async def on_hand_off(params: FunctionCallParams):
            logger.info(f"Voice call {call.id}: hand-off")
            try:
                answer = await call.hand_off()
            except Exception:
                # The call ended first; the api finishes it and adds it to the saved call.
                return
            await params.result_callback(answer)

        # Not cancelled when they talk over it: the agent keeps working, as with OpenAI.
        llm.register_function("hand_off", on_hand_off, cancel_on_interruption=False, timeout_secs=240)

        context = LLMContext(tools=ToolsSchema(standard_tools=[HAND_OFF]))
        # Silero hears speech start and stop; the smart-turn model (the default stop strategy)
        # decides whether a pause means they've finished. Speaking over the voice interrupts it.
        user, assistant = LLMContextAggregatorPair(
            context,
            user_params=LLMUserAggregatorParams(
                vad_analyzer=SileroVADAnalyzer(params=VADParams(stop_secs=config.vad_stop_secs))
            ),
        )
        pipeline = Pipeline(
            [
                transport.input(),
                stt,
                Heard(call),
                user,
                llm,
                tts,
                listening,
                transport.output(),
                Played(call),
                assistant,
            ]
        )
        latency = UserBotLatencyObserver()

        @latency.event_handler("on_latency_measured")
        async def on_latency(_observer, seconds: float):
            await call.metrics(turn={"latencyMs": round(seconds * 1000)})

        worker = PipelineWorker(
            pipeline,
            params=PipelineParams(enable_metrics=True, enable_usage_metrics=True),
            observers=[Usage(call, config), latency],
            # The api hangs up quiet calls; the pipeline itself never times out.
            idle_timeout_secs=None,
            enable_rtvi=False,
        )

        async def speak(text: str):
            await worker.queue_frames([TTSSpeakFrame(text)])

        async def note(text: str):
            await worker.queue_frames(
                [
                    LLMMessagesAppendFrame(
                        messages=[{"role": "developer", "content": text}], run_llm=True
                    )
                ]
            )

        async def stop():
            await worker.cancel()

        async def set_voice(voice: str):
            logger.info(f"Voice call {call.id}: voice changed to {voice}")
            listening.clips = []
            await worker.queue_frames([TTSUpdateSettingsFrame(delta=TTSSettings(voice=voice))])
            asyncio.create_task(load_clips(voice))

        call.speak, call.note, call.stop, call.set_voice = speak, note, stop, set_voice

        # A service that can't do its job (out of credit, a key turned down) would leave the
        # call deaf or silent: say so and hang up, so they aren't talking to no one.
        @worker.event_handler("on_pipeline_error")
        async def on_error(_worker, frame):
            processor = getattr(frame, "processor", None)
            if processor is None or processor.is_usable or call.ended:
                return
            logger.error(f"Voice call {call.id}: {processor} stopped working: {frame.error}")
            try:
                await speak(
                    "Sorry, something's gone wrong on my side, so I have to hang up. "
                    "Try again in a bit, or type to me."
                )
                await asyncio.sleep(4)
            finally:
                await call.end("unavailable")

        @transport.event_handler("on_client_connected")
        async def on_connected(_transport, _client):
            await call.emit({"type": "session.started"})
            call.start_clock()
            # The instructions ask for a short hello when the call starts.
            context.add_message({"role": "developer", "content": "The call just connected."})
            await worker.queue_frames([LLMRunFrame()])

        @transport.event_handler("on_client_disconnected")
        async def on_disconnected(_transport, _client):
            # A hang-up from the app says so first ("ended"); this is a lost connection.
            await call.end("connection_lost")

        runner = WorkerRunner(handle_sigint=False)
        await runner.add_workers(worker)
        try:
            await runner.run()
        finally:
            await call.end(call.reason or "ended")
