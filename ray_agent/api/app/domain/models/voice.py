from typing import Literal

from pydantic import BaseModel, Field

VoiceEngine = Literal["local", "deepseek"]
VoicePreference = Literal["off", "local", "deepseek"]
WAV_SAMPLE_RATE = 16_000
MAX_AUDIO_BYTES = 8 * 1024 * 1024
MAX_AUDIO_SECONDS = 120


class ASRResult(BaseModel):
    request_id: str
    text: str
    duration_ms: int = Field(gt=0, le=MAX_AUDIO_SECONDS * 1000)
