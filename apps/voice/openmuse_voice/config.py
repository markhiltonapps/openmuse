"""Settings, all from environment variables (Railway's Variables page, or .env locally)."""

import os
from dataclasses import dataclass


def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


def _number(name: str, default: float) -> float:
    try:
        return float(_env(name) or default)
    except ValueError:
        return default


@dataclass(frozen=True)
class Config:
    # Shared with the api: it signs every request to this service.
    token: str
    # "::" for Railway's private network (IPv6); 0.0.0.0 where there's no IPv6.
    host: str
    port: int
    # "soniox", or "fake" for local runs without keys.
    stt: str
    soniox_key: str
    soniox_model: str
    # A Claude model ("claude-haiku-4-5"), or "fake".
    llm_model: str
    anthropic_key: str
    llm_max_tokens: int
    # "inworld" or "speechify", or "fake".
    tts: str
    inworld_key: str
    inworld_model: str
    inworld_voice: str
    # The model the listening sounds are made with (once per voice): Inworld's top model, which
    # follows directions such as "[softly]"; the calls themselves keep inworld_model.
    inworld_listen_model: str
    speechify_key: str
    speechify_model: str
    speechify_voice: str
    # How long a pause must last before the turn detector is asked whether they've finished.
    vad_stop_secs: float
    # Calls one process takes at once; more are turned away (the api says live talk is busy).
    max_sessions: int

    @property
    def tts_model(self) -> str:
        if self.tts == "speechify":
            return self.speechify_model
        if self.tts == "inworld":
            return self.inworld_model
        return "fake-tts"

    @property
    def stt_model(self) -> str:
        return self.soniox_model if self.stt == "soniox" else "fake-stt"

    def problems(self) -> list[str]:
        """What's missing for the chosen services, by variable name (never a value)."""
        missing = []
        if not self.token:
            missing.append("VOICE_INTERNAL_TOKEN")
        if self.stt == "soniox" and not self.soniox_key:
            missing.append("SONIOX_API_KEY")
        if self.llm_model != "fake" and not self.anthropic_key:
            missing.append("ANTHROPIC_API_KEY")
        if self.tts == "inworld" and not self.inworld_key:
            missing.append("INWORLD_API_KEY")
        if self.tts == "speechify" and not self.speechify_key:
            missing.append("SPEECHIFY_API_KEY")
        return missing


def load() -> Config:
    return Config(
        token=_env("VOICE_INTERNAL_TOKEN"),
        host=_env("HOST", "::"),
        port=int(_number("PORT", 8080)),
        stt=_env("VOICE_STT", "soniox").lower(),
        soniox_key=_env("SONIOX_API_KEY"),
        soniox_model=_env("SONIOX_MODEL", "stt-rt-v5"),
        llm_model=_env("VOICE_LLM_MODEL", "claude-haiku-4-5"),
        anthropic_key=_env("ANTHROPIC_API_KEY"),
        llm_max_tokens=int(_number("VOICE_LLM_MAX_TOKENS", 300)),
        tts=_env("VOICE_TTS", "inworld").lower(),
        inworld_key=_env("INWORLD_API_KEY"),
        inworld_model=_env("INWORLD_TTS_MODEL", "inworld-tts-2-flash"),
        # The usual voice (owner's pick, 2026-10-11); INWORLD_VOICE on Railway overrides it.
        inworld_voice=_env("INWORLD_VOICE", "Sarah"),
        inworld_listen_model=_env("INWORLD_LISTEN_MODEL", "inworld-tts-2"),
        speechify_key=_env("SPEECHIFY_API_KEY"),
        speechify_model=_env("SPEECHIFY_TTS_MODEL", "simba-3.2"),
        speechify_voice=_env("SPEECHIFY_VOICE", "geffen_32"),
        vad_stop_secs=_number("VOICE_VAD_STOP_SECS", 0.2),
        max_sessions=int(_number("VOICE_MAX_SESSIONS", 50)),
    )
