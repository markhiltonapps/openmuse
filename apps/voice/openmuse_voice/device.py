"""A push-to-talk device (a small ESP32 with a button) talking to the voice pipeline.

One WebSocket carries everything, and the api just pipes bytes between the device and it:

- device -> server, BINARY: PCM signed 16-bit little-endian, mono, 16 kHz, any chunk size, sent
  only while the button is held.
- device -> server, TEXT: {"type": "ptt.start"}, {"type": "ptt.end"}, {"type": "session.close"}.
- server -> device, BINARY: PCM s16le mono 16 kHz, as the voice makes it (no header).
- server -> device, TEXT: the call's events (session.started, session.input_transcript.delta,
  session.output_transcript.delta, session.commentary.appended, session.closed), plus
    {"type": "state", "value": "idle|listening|thinking|speaking"},
    {"type": "playback.clear"}   (the person pressed while the voice was talking: flush the speaker),
    {"type": "latency", "ms": N} (once a turn: from ptt.end being read to the first audio byte sent).

The pieces, in pipeline order (see run_call):

    transport.input()   reads the socket; DeviceSerializer turns bytes into audio frames and text
                        into PushToTalkControlFrame (stamped with when it was read)
    PushToTalk          the button: turns presses into the frames a spoken turn is made of
    stt, Heard          as for any call
    user aggregator     ExternalUserTurnStartStrategy + PushToTalkTurnStop: the turn is whatever
                        the button says, and the LLM runs the moment the final transcript lands
    llm, tts            as for any call
    transport.output()  DeviceSerializer sends audio and (on an interruption) playback.clear
    Played              as for any call, and tells Device when the voice has stopped

Everything written to the socket goes through DeviceLink's single writer task, so audio and events
never interleave badly and a slow socket never holds up the call.
"""

import asyncio
import json
import time
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from loguru import logger
from pipecat.frames.frames import (
    Frame,
    InputAudioRawFrame,
    InterruptionFrame,
    OutputAudioRawFrame,
    ProposedUserStartedSpeakingFrame,
    ProposedUserStoppedSpeakingFrame,
    SystemFrame,
    VADUserStartedSpeakingFrame,
    VADUserStoppedSpeakingFrame,
)
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor
from pipecat.serializers.base_serializer import FrameSerializer
from pipecat.turns.user_stop import ExternalUserTurnStopStrategy

# What the device sends and plays: 16 kHz, 16-bit, mono.
RATE = 16000
BYTES_PER_SECOND = RATE * 2

# A press shorter than this (the longer of how long it was held and how much audio came) is a
# tap, not a question; and so is one with less audio than this. Neither reaches the LLM.
MIN_PRESS_SECS = 0.2
MIN_AUDIO_SECS = 0.15
# The first part of a press is held back from the listener until it is clearly a real one, so a
# tap is never heard (nor transcribed). At the press's end a real press releases whatever it held.
HOLD_BACK_BYTES = int(MIN_PRESS_SECS * BYTES_PER_SECOND)
# Audio waiting to be written to the socket never grows past this (about a second).
MAX_BACKLOG_BYTES = BYTES_PER_SECOND
# A control message waits for the audio that was read before it; it never waits longer than this.
CONTROL_PATIENCE_SECS = 0.5
# A press with no words heard after this long ends quietly: nothing to answer.
EMPTY_AFTER_SECS = 2.0

CONTROL_KINDS = {"ptt.start": "start", "ptt.end": "end", "session.close": "close"}


@dataclass
class PushToTalkControlFrame(SystemFrame):
    """A text message from the device, in the order it was read.

    `audio_before` is how many audio bytes had been read before it, so it can be applied after
    that audio has come through the input transport's own queue (audio is queued there; text isn't).
    `read_at` is when the message was read (time.monotonic()), for the latency measurement.
    """

    kind: str = ""
    read_at: float = 0.0
    audio_before: int = 0


@dataclass
class PushToTalkStoppedFrame(ProposedUserStoppedSpeakingFrame):
    """The button went up. `discard`: it was a tap, so end the turn with nothing to answer."""

    discard: bool = False


class DeviceSerializer(FrameSerializer):
    """Binary <-> audio frames; text control messages <-> PushToTalkControlFrame."""

    def __init__(self, link: "DeviceLink"):
        super().__init__()
        self._link = link
        self._read = 0
        self._odd = b""

    async def deserialize(self, data: str | bytes) -> Frame | None:
        if isinstance(data, (bytes, bytearray)):
            if self._odd:
                data = self._odd + bytes(data)
                self._odd = b""
            if len(data) % 2:
                # A sample is two bytes; the odd one waits for its other half.
                self._odd = bytes(data[-1:])
                data = data[:-1]
            if not data:
                return None
            self._read += len(data)
            return InputAudioRawFrame(audio=bytes(data), sample_rate=RATE, num_channels=1)
        # The latency is measured from here: the moment a message was read.
        read_at = time.monotonic()
        try:
            message = json.loads(data)
        except ValueError:
            return None
        kind = CONTROL_KINDS.get(message.get("type")) if isinstance(message, dict) else None
        if not kind:
            return None
        return PushToTalkControlFrame(kind=kind, read_at=read_at, audio_before=self._read)

    async def serialize(self, frame: Frame) -> str | bytes | None:
        if isinstance(frame, OutputAudioRawFrame):
            return frame.audio
        if isinstance(frame, InterruptionFrame):
            # Stopped by someone pressing the button (or anything else that interrupts): what is
            # waiting to be written is dropped, and the device flushes what it has. Said only when
            # the device may still hold audio, so a press while the voice is quiet says nothing.
            if self._link.interrupt():
                return json.dumps({"type": "playback.clear"})
        return None


class DeviceLink:
    """The device's socket: one writer for audio and events, and a clock of what it's playing.

    It stands in for the WebSocket where Pipecat's transport expects one (receive, send_bytes,
    send_text, close, and its states), so the transport itself is Pipecat's own.
    """

    def __init__(self, socket: Any, *, lead_secs: float = 0.5):
        self._socket = socket
        self._lead = lead_secs
        # (is_audio, payload), in the order to be written.
        self._items: deque[tuple[bool, bytes | str]] = deque()
        self._audio_bytes = 0
        self._wake = asyncio.Event()
        self._closing = False
        self._dead = False
        # When the device will have played everything sent so far.
        self.play_until = 0.0
        # Called, in the writer, just before each audio chunk goes out.
        self.on_audio_sent: Callable[[], None] | None = None
        self._writer = asyncio.get_running_loop().create_task(self._write())

    def __getattr__(self, name: str) -> Any:
        # headers, client_state, application_state: the real socket's.
        return getattr(self._socket, name)

    async def receive(self) -> dict[str, Any]:
        return await self._socket.receive()

    # What Call uses (attach_browser): never waits.
    def send_event(self, event: dict[str, Any]):
        self._put(False, json.dumps(event, separators=(",", ":")))

    async def send_text(self, text: str):
        self._put(False, text)

    async def send_bytes(self, data: bytes):
        if self._dead or self._closing:
            return
        # Never more than `lead` ahead of what the device is playing: the device needs little
        # memory, and a press cuts the voice off within a moment.
        ahead = self.play_until - time.monotonic()
        if ahead > self._lead:
            await asyncio.sleep(ahead - self._lead)
        # A socket that can't keep up holds the voice back rather than piling audio up.
        while self._audio_bytes > MAX_BACKLOG_BYTES and not (self._dead or self._closing):
            await asyncio.sleep(0.005)
        self.play_until = max(self.play_until, time.monotonic()) + len(data) / BYTES_PER_SECOND
        self._audio_bytes += len(data)
        self._put(True, bytes(data))

    def _put(self, is_audio: bool, payload: bytes | str):
        if self._dead or self._closing:
            return
        self._items.append((is_audio, payload))
        self._wake.set()

    async def _write(self):
        while True:
            while not self._items:
                if self._closing:
                    return
                self._wake.clear()
                await self._wake.wait()
            is_audio, payload = self._items.popleft()
            try:
                if is_audio:
                    self._audio_bytes -= len(payload)
                    if self.on_audio_sent:
                        self.on_audio_sent()
                    await self._socket.send_bytes(payload)
                else:
                    await self._socket.send_text(payload)
            except Exception as error:
                logger.debug(f"Device socket: write failed: {error}")
                self._dead = True
                self._items.clear()
                self._audio_bytes = 0
                return

    def holding_audio(self) -> bool:
        """Whether the device may still be playing (or about to play) what was sent."""
        return self._audio_bytes > 0 or time.monotonic() < self.play_until

    def interrupt(self) -> bool:
        """Drops audio not yet written, and says whether the device may hold some."""
        holding = self.holding_audio()
        self._items = deque(item for item in self._items if not item[0])
        self._audio_bytes = 0
        self.play_until = 0.0
        return holding

    async def close(self, code: int = 1000, reason: str | None = None):
        """Writes what is queued (the last events), then closes the socket."""
        if self._closing:
            return
        self._closing = True
        self._wake.set()
        try:
            await asyncio.wait_for(asyncio.shield(self._writer), timeout=1.0)
        except Exception:
            pass
        if not self._writer.done():
            self._writer.cancel()
        try:
            await self._socket.close(code=code, reason=reason)
        except Exception:
            pass


class Device:
    """What the device is doing, told to it (state), and how fast the voice answered (latency)."""

    def __init__(self, call: Any, link: DeviceLink):
        self.call = call
        self.link = link
        self.state = "idle"
        self.held = False
        # When the last ptt.end was read, until the first audio answers it.
        self.awaiting: float | None = None
        self._audio = 0
        self._settle: asyncio.Task | None = None
        self._tasks: set[asyncio.Task] = set()
        link.on_audio_sent = self.audio_sent

    def _set(self, value: str):
        if value != self.state:
            self.state = value
            self.link.send_event({"type": "state", "value": value})

    def _resting(self) -> str:
        return "speaking" if self.link.holding_audio() else "idle"

    def pressed(self):
        self.held = True
        self.awaiting = None
        self._cancel_settle()
        self._set("listening")

    def released(self, real: bool, read_at: float):
        self.held = False
        if real:
            self.awaiting = read_at
            self._set("thinking")
        else:
            self._set(self._resting())

    def audio_sent(self):
        """The writer is about to send a chunk of the voice."""
        now = time.monotonic()
        self._audio += 1
        if not self.held:
            self._set("speaking")
        if self.awaiting is not None:
            ms = round((now - self.awaiting) * 1000)
            self.awaiting = None
            self.link.send_event({"type": "latency", "ms": ms})
            logger.info(f"Voice call {self.call.id}: turn answered {ms} ms after release")
            self._spawn(self.call.metrics(turn={"latencyMs": ms, "fromRelease": True}))

    def bot_stopped(self):
        """The voice has said its last word; the device may still be playing the end of it."""
        self._cancel_settle()
        delay = max(0.0, self.link.play_until - time.monotonic()) + 0.05
        self._settle = asyncio.get_running_loop().create_task(self._settle_idle(self._audio, delay))

    async def _settle_idle(self, audio: int, delay: float):
        await asyncio.sleep(delay)
        if audio == self._audio and not self.held and self.awaiting is None:
            self._set("idle")

    def turn_empty(self):
        """A press that heard nothing: no answer is coming."""
        if self.awaiting is not None and not self.held:
            self.awaiting = None
            self._set(self._resting())

    def _cancel_settle(self):
        if self._settle and not self._settle.done():
            self._settle.cancel()
        self._settle = None

    def _spawn(self, coroutine):
        task = asyncio.get_running_loop().create_task(coroutine)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    def spawn(self, coroutine):
        self._spawn(coroutine)

    def stop(self):
        self._cancel_settle()


class PushToTalk(FrameProcessor):
    """Right after the input: the button makes the turn, and audio is heard only while it's held.

    ptt.start -> VADUserStartedSpeakingFrame (the STT starts a segment) and
                 ProposedUserStartedSpeakingFrame (the aggregator opens the turn and interrupts
                 the voice, as speaking over it would)
    ptt.end   -> VADUserStoppedSpeakingFrame (Soniox is told to finalize at once) and
                 PushToTalkStoppedFrame (the turn ends when the final transcript lands, or at
                 once, with nothing to answer, for a tap)

    No voice detector and no turn-detection model are involved, so nothing waits on silence.
    """

    def __init__(self, call: Any, device: Device):
        super().__init__()
        self._call = call
        self._device = device
        self._held = False
        self._read = 0
        self._press_read_at = 0.0
        self._press_bytes = 0
        self._held_back = bytearray()
        self._held_back_frames: list[InputAudioRawFrame] = []
        self._released = False
        self._waiting: deque[PushToTalkControlFrame] = deque()
        self._timer: asyncio.Task | None = None

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)
        if isinstance(frame, InputAudioRawFrame):
            self._read += len(frame.audio)
            if self._held:
                await self._hear(frame)
            # Audio while the button isn't held is dropped.
            await self._apply_due()
        elif isinstance(frame, PushToTalkControlFrame):
            self._waiting.append(frame)
            await self._apply_due()
            if self._waiting:
                self._arm()
        else:
            await self.push_frame(frame, direction)

    async def _hear(self, frame: InputAudioRawFrame):
        self._press_bytes += len(frame.audio)
        if self._released:
            await self.push_frame(frame)
            return
        self._held_back_frames.append(frame)
        if self._press_bytes >= HOLD_BACK_BYTES:
            await self._release_held_back()

    async def _release_held_back(self):
        self._released = True
        frames, self._held_back_frames = self._held_back_frames, []
        for held in frames:
            await self.push_frame(held)

    # Control messages wait for the audio read before them, which comes through the input
    # transport's queue; text doesn't, so without this the end of a press could overtake its tail.
    async def _apply_due(self, force: bool = False):
        while self._waiting and (force or self._waiting[0].audio_before <= self._read):
            await self._apply(self._waiting.popleft())

    def _arm(self):
        if self._timer is None or self._timer.done():
            self._timer = self.create_task(self._patience(), f"{self}::patience")

    async def _patience(self):
        await asyncio.sleep(CONTROL_PATIENCE_SECS)
        await self._apply_due(force=True)

    async def _apply(self, control: PushToTalkControlFrame):
        if control.kind == "start":
            if self._held:
                return
            self._held = True
            self._released = False
            self._press_read_at = control.read_at
            self._press_bytes = 0
            self._held_back_frames = []
            self._device.pressed()
            await self.push_frame(VADUserStartedSpeakingFrame(start_secs=0.0))
            await self.push_frame(ProposedUserStartedSpeakingFrame())
        elif control.kind == "end":
            if not self._held:
                return
            self._held = False
            audio = self._press_bytes / BYTES_PER_SECOND
            press = max(audio, control.read_at - self._press_read_at)
            real = press >= MIN_PRESS_SECS and audio >= MIN_AUDIO_SECS
            self._device.released(real, control.read_at)
            logger.info(
                f"Voice call {self._call.id}: button released after {press * 1000:.0f} ms, "
                f"{audio * 1000:.0f} ms of audio, {'answering' if real else 'ignored as a tap'}"
            )
            if real:
                if not self._released:
                    await self._release_held_back()
                await self.push_frame(VADUserStoppedSpeakingFrame(stop_secs=0.0))
            else:
                # A tap: the listener heard nothing of it, and isn't asked to finalize.
                self._held_back_frames = []
                logger.debug(
                    f"Voice call {self._call.id}: ignored a tap ({press * 1000:.0f} ms, "
                    f"{audio * 1000:.0f} ms of audio)"
                )
            await self.push_frame(PushToTalkStoppedFrame(discard=not real))
        elif control.kind == "close":
            # Not from inside the pipeline: ending the call stops the pipeline.
            self._device.spawn(self._call.from_browser({"type": "session.close"}))

    async def cleanup(self):
        if self._timer and not self._timer.done():
            self._timer.cancel()
        await super().cleanup()


class PushToTalkTurnStop(ExternalUserTurnStopStrategy):
    """Ends a turn when the button is up and the final transcript is in: nothing else is waited for.

    The stock external strategy waits half a second after the last transcript for another to
    follow; with push-to-talk the button is the end, and Soniox sends the whole turn at once when
    it's told to finalize, so the LLM runs as soon as the words land. A tap ends at once with
    nothing to answer; a press where nothing was heard at all ends a couple of seconds after.
    """

    def __init__(self, device: Device, *, empty_after: float = EMPTY_AFTER_SECS):
        super().__init__(wait_for_transcript=True)
        self._device = device
        self._empty_after = empty_after
        self._discard = False
        self._giveup: asyncio.Task | None = None

    async def _task_handler(self):
        # The stock handler polls on its half-second timeout; nothing here needs it.
        await asyncio.Event().wait()

    async def cleanup(self):
        self._cancel_giveup()
        await super().cleanup()

    def _cancel_giveup(self):
        if self._giveup and not self._giveup.done() and self._giveup is not asyncio.current_task():
            self._giveup.cancel()
        self._giveup = None

    async def process_frame(self, frame: Frame):
        if isinstance(frame, PushToTalkStoppedFrame):
            self._discard = frame.discard
        return await super().process_frame(frame)

    async def _reset(self):
        self._cancel_giveup()
        self._discard = False
        await super()._reset()

    async def _handle_user_started_speaking(self, *, announced_elsewhere: bool):
        self._cancel_giveup()
        await super()._handle_user_started_speaking(announced_elsewhere=announced_elsewhere)

    async def _handle_user_stopped_speaking(self, *, announced_elsewhere: bool):
        if self._discard:
            self._user_speaking = False
            self._text = ""
            await self._end_empty()
            return
        await super()._handle_user_stopped_speaking(announced_elsewhere=announced_elsewhere)
        if self._turn_open and not self._user_speaking and not self._text:
            self._cancel_giveup()
            self._giveup = self.create_task(self._give_up(), f"{self}::give_up")

    async def _handle_transcription(self, frame):
        await super()._handle_transcription(frame)
        if self._turn_open:
            self._cancel_giveup()
            await self._maybe_trigger_user_turn_stopped()

    async def _give_up(self):
        await asyncio.sleep(self._empty_after)
        # Words still on their way (some were heard while the button was down): the stop timeout
        # of the user aggregator covers those.
        if (
            self._turn_open
            and not self._user_speaking
            and not self._text
            and not self._seen_interim_results
        ):
            logger.debug("Push to talk: nothing was heard, ending the turn")
            await self._end_empty()

    async def _end_empty(self):
        if self._turn_open:
            self._device.turn_empty()
            await self._trigger_user_turn_stopped()
