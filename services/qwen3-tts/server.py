"""
Qwen3-TTS native service for podcast audio generation.

This service wraps mlx-audio models for Apple Silicon optimization:
- Single speaker synthesis (prebuilt voices: Aiden, Chelsie, Dylan, Eric, Ethan, Ryan, Serena, Vivian)
- Multi-speaker dialogue synthesis (entire podcast in one call)
- Voice cloning via Qwen3-TTS-1.7B-Base with reference audio
- Voice design from text descriptions (Qwen3-TTS-1.7B-VoiceDesign)
- Word-level timing extraction via Whisper for teleprompter sync
- Audio transcription via Whisper for auto-transcribe workflow

All voice modes work locally via mlx-audio, no external dependencies.

Models:
- Prebuilt: Qwen3-TTS-0.6B-CustomVoice-8bit (fast, prebuilt voices)
- Clone: Qwen3-TTS-1.7B-Base-bf16 (high quality voice cloning)
- Design: Qwen3-TTS-1.7B-VoiceDesign-8bit (voice from description)

Output formats: WAV (default), MP3

Environment variables:
- QWEN_TTS_PORT: Service port (default: 7860)
"""

import asyncio
import gc
import io
import json
import logging
import os
import shutil
import tempfile
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np
import soundfile as sf
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel, Field

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# mlx-audio compatibility
# ---------------------------------------------------------------------------
# Requires mlx-audio >= 0.3.0 for Qwen3-TTS model support.
# v0.3.1+ (from git main) includes fixes for:
# - Speaker encoder tensor format (NCL/NLC handling)
# - Lazy evaluation hangs (mx.eval() calls in generation loop)
# Earlier versions (0.2.10) have incompatible model architecture handling.
_MLX_AUDIO_AVAILABLE = False
_MLX_AUDIO_ERROR = None

try:
    import mlx_audio.tts.utils as mlx_tts_utils
    # Verify qwen3_tts is in MODEL_REMAPPING (added in 0.3.0rc1)
    if 'qwen3_tts' in mlx_tts_utils.MODEL_REMAPPING:
        _MLX_AUDIO_AVAILABLE = True
        logger.info("mlx-audio >= 0.3.0rc1 detected, Qwen3-TTS models supported")
    else:
        _MLX_AUDIO_ERROR = (
            "mlx-audio version too old. Qwen3-TTS requires mlx-audio >= 0.3.0rc1. "
            "Upgrade with: pip install -U mlx-audio --pre"
        )
        logger.warning(_MLX_AUDIO_ERROR)
except ImportError as e:
    _MLX_AUDIO_ERROR = f"mlx-audio not installed: {e}. Install with: pip install mlx-audio"
    logger.info(_MLX_AUDIO_ERROR)
except Exception as e:
    _MLX_AUDIO_ERROR = f"mlx-audio error: {e}"
    logger.warning(_MLX_AUDIO_ERROR)


# Paths
SERVICE_DIR = Path(__file__).parent
VOICES_DIR = SERVICE_DIR / "voices"
VOICES_DIR.mkdir(exist_ok=True)

# Voice metadata file
VOICES_METADATA_FILE = VOICES_DIR / "metadata.json"

# Global model instances (lazy loaded)
# Three specialized models for different voice modes (MLX quantized for speed)
_tts_models: dict = {}
_whisper_model = None

# Model map: voice_mode -> mlx-community model name
# Using MLX-optimized models for Apple Silicon
# Note: Base models support both prebuilt voices AND voice cloning
# The 1.7B model produces better quality cloning but is slower
MODEL_MAP = {
    "prebuilt": "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-4bit",  # Prebuilt voices (0.6B, 4-bit)
    "clone": "mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16",      # Voice cloning (1.7B, bf16 - better quality)
    "design": "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-4bit",     # Voice design (0.6B, 4-bit)
}

# Built-in voices from Qwen3-TTS Base models (lowercase names)
# Available: serena, vivian, uncle_fu, ryan, aiden, ono_anna, sohee, eric, dylan
PREBUILT_VOICES = [
    {"id": "aiden", "name": "Aiden", "gender": "male", "description": "Young adult male, clear and energetic"},
    {"id": "dylan", "name": "Dylan", "gender": "male", "description": "Adult male, warm and friendly"},
    {"id": "eric", "name": "Eric", "gender": "male", "description": "Adult male, professional and calm"},
    {"id": "ryan", "name": "Ryan", "gender": "male", "description": "Adult male, confident and clear"},
    {"id": "uncle_fu", "name": "Uncle Fu", "gender": "male", "description": "Older male, warm and wise"},
    {"id": "serena", "name": "Serena", "gender": "female", "description": "Young adult female, bright and clear"},
    {"id": "vivian", "name": "Vivian", "gender": "female", "description": "Adult female, professional and calm"},
    {"id": "ono_anna", "name": "Ono Anna", "gender": "female", "description": "Adult female, expressive"},
    {"id": "sohee", "name": "Sohee", "gender": "female", "description": "Adult female, clear and pleasant"},
]


# ---------------------------------------------------------------------------
# Lifecycle Management
# ---------------------------------------------------------------------------


def cleanup_models():
    """Unload all loaded models and free resources."""
    global _tts_models, _whisper_model

    # Unload TTS models
    for model_name in list(_tts_models.keys()):
        logger.info(f"Unloading TTS model: {model_name}")
        del _tts_models[model_name]
    _tts_models.clear()

    # Unload Whisper model
    if _whisper_model is not None:
        logger.info("Unloading Whisper model")
        del _whisper_model
        _whisper_model = None

    # Force garbage collection to release memory
    gc.collect()

    # Clear MLX cache if available
    try:
        import mlx.core as mx
        mx.metal.clear_cache()
        logger.info("Cleared MLX Metal cache")
    except (ImportError, AttributeError):
        pass
    except Exception as e:
        logger.warning(f"Failed to clear MLX cache: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage application lifespan - startup and shutdown."""
    # Startup
    logger.info("Qwen3-TTS service starting...")
    yield
    # Shutdown
    logger.info("Shutting down Qwen3-TTS service...")
    cleanup_models()
    logger.info("Qwen3-TTS service shutdown complete")


app = FastAPI(
    title="Qwen3-TTS Service",
    description="Native TTS service for podcast audio generation with Qwen3-TTS",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS middleware for frontend access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000", "http://localhost:8001"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Pydantic Models
# ---------------------------------------------------------------------------


class SynthesizeRequest(BaseModel):
    """Request for single-speaker synthesis."""
    text: str = Field(..., description="Text to synthesize")
    voice_id: str = Field(..., description="Voice ID (prebuilt name, or registered voice ID)")
    voice_mode: str = Field(
        default="prebuilt",
        description="Voice mode: 'prebuilt', 'clone', or 'design'"
    )
    emotion: Optional[str] = Field(
        default=None,
        description="Emotion/prosody hint (e.g., 'enthusiastic', 'calm', 'warm')"
    )
    speed: float = Field(default=1.0, description="Speech speed multiplier")
    # Optional direct paths for clone mode (bypass voice registry)
    reference_audio_path: Optional[str] = Field(
        default=None,
        description="Direct path to reference audio file (clone mode only)"
    )
    reference_transcript: Optional[str] = Field(
        default=None,
        description="Transcript of reference audio (clone mode only)"
    )
    # Optional description for design mode (bypass voice registry)
    voice_description: Optional[str] = Field(
        default=None,
        description="Voice description text (design mode only)"
    )
    output_format: str = Field(
        default="wav",
        description="Output audio format: 'wav' or 'mp3'"
    )


class SpeakerConfig(BaseModel):
    """Configuration for a speaker in dialogue."""
    voice_mode: str = Field(..., description="Voice mode: 'prebuilt', 'clone', or 'design'")
    voice_id: Optional[str] = Field(default=None, description="Voice ID for prebuilt/clone modes")
    description: Optional[str] = Field(default=None, description="Voice description for design mode")


class DialogueSegment(BaseModel):
    """A single segment in a dialogue."""
    speaker: str = Field(..., description="Speaker name (must match a key in speakers)")
    text: str = Field(..., description="Text for this segment")
    emotion: Optional[str] = Field(default=None, description="Emotion/prosody for this segment")


class SynthesizeDialogueRequest(BaseModel):
    """Request for multi-speaker dialogue synthesis."""
    speakers: Dict[str, SpeakerConfig] = Field(
        ...,
        description="Speaker configurations keyed by speaker name"
    )
    dialogue: List[DialogueSegment] = Field(
        ...,
        description="List of dialogue segments in order"
    )
    output_format: str = Field(
        default="wav",
        description="Output audio format: 'wav' or 'mp3'"
    )


class VoiceCloneRequest(BaseModel):
    """Request for voice cloning (used with form data)."""
    transcript: str = Field(..., description="Transcript of the audio sample")
    name: str = Field(..., description="Name for the cloned voice")
    description: Optional[str] = Field(default=None, description="Optional description")


class VoiceDesignRequest(BaseModel):
    """Request for voice design from text description."""
    description: str = Field(
        ...,
        description="Text description of desired voice (e.g., 'warm, mid-30s female, slightly raspy')"
    )
    name: str = Field(..., description="Name for the designed voice")
    sample_text: Optional[str] = Field(
        default="Hello, this is a sample of my voice. I hope you find it pleasant to listen to.",
        description="Text to generate sample audio with"
    )


class VoiceInfo(BaseModel):
    """Information about a voice."""
    id: str
    name: str
    type: str = Field(description="Type: 'prebuilt', 'cloned', or 'designed'")
    description: Optional[str] = None
    gender: Optional[str] = None
    created_at: Optional[str] = None


class SynthesisResponse(BaseModel):
    """Response from synthesis endpoints."""
    audio_base64: str = Field(..., description="Base64-encoded audio")
    duration_ms: int = Field(..., description="Audio duration in milliseconds")
    word_timings: List[Dict[str, Any]] = Field(
        ...,
        description="Word-level timings: [{word, start_ms, end_ms, speaker?}]"
    )
    sample_rate: int = Field(default=24000, description="Audio sample rate")
    format: str = Field(default="wav", description="Audio format: 'wav' or 'mp3'")


class TranscribeResponse(BaseModel):
    """Response from transcription endpoint."""
    transcript: str = Field(..., description="Transcribed text")
    duration_seconds: float = Field(..., description="Audio duration in seconds")


class WarmRequest(BaseModel):
    """Request to warm up models."""
    modes: List[str] = Field(
        default=["clone", "design"],
        description="Voice modes to pre-load: 'prebuilt', 'clone', 'design'"
    )


class WarmResponse(BaseModel):
    """Response from warm endpoint."""
    warmed: List[str] = Field(..., description="Models that were warmed up")
    memory_mb: float = Field(..., description="Approximate memory usage in MB")


# ---------------------------------------------------------------------------
# Model Loading
# ---------------------------------------------------------------------------


# Environment variable to explicitly enable mock mode for development
ENABLE_MOCK_TTS = os.environ.get("ENABLE_MOCK_TTS", "").lower() in ("1", "true", "yes")


def get_tts_model(mode: str = "prebuilt"):
    """
    Lazy load the appropriate Qwen3-TTS model for the voice mode.

    Uses mlx-audio for Apple Silicon optimization.

    Args:
        mode: Voice mode - "clone", "prebuilt", or "design"

    Returns:
        The loaded TTS model

    Raises:
        RuntimeError: If models cannot be loaded and mock mode is not enabled
    """
    global _tts_models

    model_name = MODEL_MAP.get(mode, MODEL_MAP["prebuilt"])

    if model_name not in _tts_models:
        logger.info(f"Loading mlx-audio model: {model_name}...")

        # Check if we should use mock mode (for development/testing)
        if ENABLE_MOCK_TTS:
            logger.warning(
                f"ENABLE_MOCK_TTS=true: Using mock TTS model for {model_name}. "
                "Audio output will be static noise, not speech."
            )
            _tts_models[model_name] = MockTTSModel()
            return _tts_models[model_name]

        # Check for mlx-audio availability
        if not _MLX_AUDIO_AVAILABLE:
            raise RuntimeError(
                f"TTS models unavailable: {_MLX_AUDIO_ERROR}\n"
                f"Set ENABLE_MOCK_TTS=true to use mock mode for development."
            )

        try:
            from mlx_audio.tts.utils import load_model
            _tts_models[model_name] = load_model(model_name)
            logger.info(f"Model {model_name} loaded successfully (MLX Metal)")
        except ImportError as e:
            error_msg = (
                f"mlx-audio import failed: {e}\n"
                f"Install with: pip install mlx-audio>=0.3.0rc1 --pre\n"
                f"Set ENABLE_MOCK_TTS=true to use mock mode for development."
            )
            logger.error(error_msg)
            raise RuntimeError(error_msg)
        except Exception as e:
            error_msg = (
                f"Failed to load model {model_name}: {e}\n"
                f"Set ENABLE_MOCK_TTS=true to use mock mode for development."
            )
            logger.error(error_msg)
            raise RuntimeError(error_msg)

    return _tts_models[model_name]


def get_whisper_model():
    """Lazy load the Whisper model for word timing extraction."""
    global _whisper_model
    if _whisper_model is None:
        logger.info("Loading Whisper model for word timing extraction...")
        try:
            from faster_whisper import WhisperModel
            # Use small model for speed, runs on CPU by default
            _whisper_model = WhisperModel("base", device="cpu", compute_type="int8")
            logger.info("faster-whisper model loaded successfully")
        except ImportError:
            logger.warning("faster-whisper not installed, using mock model for development")
            _whisper_model = MockWhisperModel()
        except Exception as e:
            logger.error(f"Failed to load Whisper: {e}")
            _whisper_model = MockWhisperModel()
    return _whisper_model


class MockTTSResult:
    """Mock result object matching mlx-audio's generator output."""

    def __init__(self, audio: np.ndarray, sample_rate: int = 24000):
        self.audio = audio
        self.sample_rate = sample_rate


class MockTTSModel:
    """
    Mock TTS model for development/testing when mlx-audio is not installed.

    Matches the mlx-audio generate() API which returns a generator yielding
    results with .audio attribute (mx.array, converted to numpy).
    """

    def _generate_mock_audio(self, text: str, speed: float = 1.0) -> np.ndarray:
        """Generate mock audio (silence with small noise)."""
        # Generate ~400ms of audio per word at 24kHz
        words = text.split()
        duration_samples = int(len(words) * 0.4 * 24000 / speed)
        # Small random noise to simulate audio
        audio = np.random.randn(duration_samples) * 0.01
        return audio.astype(np.float32)

    def generate(
        self,
        text: str,
        voice: Optional[str] = None,
        ref_audio: Optional[str] = None,
        ref_text: Optional[str] = None,
        voice_description: Optional[str] = None,
        language: str = "English",
        **kwargs,
    ):
        """
        Generate speech using mlx-audio's unified API.

        This is a generator that yields results with .audio attribute.

        Args:
            text: Text string to synthesize
            voice: Prebuilt voice name (Aiden, Chelsie, etc.)
            ref_audio: Path to reference audio file (~3s sample) for cloning
            ref_text: Transcript of the reference audio for cloning
            voice_description: Text description for voice design
            language: Language (default: "English")

        Yields:
            MockTTSResult with .audio attribute (numpy array)
        """
        audio = self._generate_mock_audio(text)
        yield MockTTSResult(audio)


class MockWhisperModel:
    """Mock Whisper model for development/testing."""

    def transcribe(
        self,
        audio_path: str,
        word_timestamps: bool = True,
    ) -> Dict[str, Any]:
        """Generate mock word timings."""
        # Read audio to estimate duration
        try:
            audio, sr = sf.read(audio_path)
            duration_ms = int(len(audio) / sr * 1000)
        except Exception:
            duration_ms = 5000

        # Generate fake word timings
        words = ["Hello", "this", "is", "a", "test", "of", "the", "speech", "system"]
        word_duration = duration_ms / len(words)

        segments = [{
            "words": [
                {
                    "word": word,
                    "start": i * word_duration / 1000,
                    "end": (i + 1) * word_duration / 1000,
                }
                for i, word in enumerate(words)
            ]
        }]

        return {"segments": segments}


# ---------------------------------------------------------------------------
# Voice Storage
# ---------------------------------------------------------------------------


def load_voices_metadata() -> Dict[str, VoiceInfo]:
    """Load voices metadata from disk."""
    if not VOICES_METADATA_FILE.exists():
        return {}
    try:
        with open(VOICES_METADATA_FILE, "r") as f:
            data = json.load(f)
            return {k: VoiceInfo(**v) for k, v in data.items()}
    except Exception as e:
        logger.error(f"Failed to load voices metadata: {e}")
        return {}


def save_voices_metadata(voices: Dict[str, VoiceInfo]):
    """Save voices metadata to disk."""
    try:
        data = {k: v.model_dump() for k, v in voices.items()}
        with open(VOICES_METADATA_FILE, "w") as f:
            json.dump(data, f, indent=2)
    except Exception as e:
        logger.error(f"Failed to save voices metadata: {e}")


def get_voice_data_path(voice_id: str) -> Path:
    """Get path to voice data file (JSON with metadata)."""
    return VOICES_DIR / f"{voice_id}.json"


def get_voice_audio_path(voice_id: str) -> Path:
    """Get path to voice reference audio file (for cloned voices)."""
    return VOICES_DIR / f"{voice_id}.wav"


def save_voice_data(voice_id: str, voice_data: Dict[str, Any]):
    """
    Save voice data to disk.

    For cloned voices, this stores:
      - reference_audio_path: path to the WAV file
      - reference_transcript: transcript of the audio

    For designed voices, this stores:
      - voice_description: the text description
    """
    path = get_voice_data_path(voice_id)
    with open(path, "w") as f:
        json.dump(voice_data, f, indent=2)


def load_voice_data(voice_id: str) -> Optional[Dict[str, Any]]:
    """Load voice data from disk."""
    path = get_voice_data_path(voice_id)
    if not path.exists():
        return None
    with open(path, "r") as f:
        return json.load(f)


def save_voice_reference_audio(voice_id: str, audio_data: np.ndarray, sample_rate: int = 24000):
    """Save reference audio for a cloned voice."""
    audio_path = get_voice_audio_path(voice_id)
    sf.write(audio_path, audio_data, sample_rate)
    return str(audio_path)


# ---------------------------------------------------------------------------
# Word Timing Extraction
# ---------------------------------------------------------------------------


def extract_word_timings(audio: np.ndarray, sample_rate: int = 24000) -> List[Dict[str, Any]]:
    """
    Extract word-level timings from audio using Whisper.

    Args:
        audio: Audio samples as numpy array
        sample_rate: Audio sample rate

    Returns:
        List of word timings: [{word, start_ms, end_ms}]
    """
    whisper_model = get_whisper_model()

    # Save audio to temp file (Whisper needs a file path)
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        tmp_path = tmp.name
        sf.write(tmp_path, audio, sample_rate)

    try:
        # Check if using mock model
        if isinstance(whisper_model, MockWhisperModel):
            result = whisper_model.transcribe(tmp_path, word_timestamps=True)
            word_timings = []
            for segment in result.get("segments", []):
                for word_info in segment.get("words", []):
                    word_timings.append({
                        "word": word_info.get("word", "").strip(),
                        "start_ms": int(word_info.get("start", 0) * 1000),
                        "end_ms": int(word_info.get("end", 0) * 1000),
                    })
            return word_timings

        # Use faster-whisper API (different from openai-whisper)
        segments, info = whisper_model.transcribe(tmp_path, word_timestamps=True)

        # Extract word timings from faster-whisper format
        word_timings = []
        for segment in segments:
            if segment.words:
                for word in segment.words:
                    word_timings.append({
                        "word": word.word.strip(),
                        "start_ms": int(word.start * 1000),
                        "end_ms": int(word.end * 1000),
                    })

        return word_timings

    finally:
        # Clean up temp file
        try:
            os.unlink(tmp_path)
        except Exception:
            pass


# ---------------------------------------------------------------------------
# Synthesis Functions
# ---------------------------------------------------------------------------


def load_reference_audio(audio_path: str) -> "mx.array":
    """
    Load audio file and convert to mx.array for mlx-audio voice cloning.

    The mlx-audio library expects ref_audio to be an mx.array of audio samples,
    NOT a file path string. This function handles:
    - Loading the audio file
    - Converting stereo to mono if needed
    - Resampling to 24kHz (Qwen3-TTS requirement)
    - Converting to mx.array

    Args:
        audio_path: Path to the reference audio file

    Returns:
        mx.array of audio samples at 24kHz
    """
    import mlx.core as mx

    # Load audio from file
    audio_data, sr = sf.read(audio_path)

    # Convert to mono if stereo
    if len(audio_data.shape) > 1:
        audio_data = audio_data.mean(axis=1)

    # Resample to 24kHz if needed (Qwen3-TTS expects 24kHz)
    if sr != 24000:
        import scipy.signal
        num_samples = int(len(audio_data) * 24000 / sr)
        audio_data = scipy.signal.resample(audio_data, num_samples)

    # Convert to mx.array (mlx-audio expects this, not a file path)
    return mx.array(audio_data.astype(np.float32))


def transcribe_audio(audio_data: np.ndarray, sample_rate: int = 24000) -> str:
    """
    Transcribe audio using Whisper model.

    Args:
        audio_data: Audio samples as numpy array
        sample_rate: Audio sample rate (default 24000)

    Returns:
        Transcribed text string
    """
    whisper = get_whisper_model()

    # Save to temp file (faster-whisper needs file path)
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        tmp_path = tmp.name
        sf.write(tmp_path, audio_data, sample_rate)

    try:
        if isinstance(whisper, MockWhisperModel):
            return "transcription unavailable"

        segments, _ = whisper.transcribe(tmp_path)
        text = " ".join(segment.text.strip() for segment in segments)
        return text
    finally:
        try:
            os.unlink(tmp_path)
        except Exception:
            pass


def encode_audio(audio: np.ndarray, sample_rate: int = 24000, output_format: str = "wav") -> bytes:
    """
    Encode audio to specified format.

    Args:
        audio: Audio samples as numpy array
        sample_rate: Audio sample rate
        output_format: Output format ('wav' or 'mp3')

    Returns:
        Encoded audio bytes
    """
    buffer = io.BytesIO()

    if output_format.lower() == "mp3":
        from pydub import AudioSegment

        audio_int16 = (audio * 32767).astype(np.int16)
        segment = AudioSegment(
            audio_int16.tobytes(),
            frame_rate=sample_rate,
            sample_width=2,
            channels=1
        )
        segment.export(buffer, format="mp3", bitrate="192k")
    else:
        sf.write(buffer, audio, sample_rate, format="WAV")

    return buffer.getvalue()


def get_memory_usage() -> float:
    """Get approximate memory usage of loaded models in MB."""
    try:
        import mlx.core as mx
        return mx.metal.get_active_memory() / (1024 * 1024)
    except (ImportError, AttributeError):
        return 0.0


def prepare_reference_audio(
    audio_path: str,
    max_duration_seconds: float = 15.0
) -> tuple["mx.array", str]:
    """
    Load and prepare reference audio for Qwen3-TTS voice cloning.

    Qwen3-TTS recommends 3-15 seconds of clear reference audio for
    optimal voice cloning quality. Longer samples may be truncated.

    This function:
    - Loads audio from various formats (tries soundfile first, falls back to pydub)
    - Truncates audio to max_duration_seconds if needed
    - Uses Whisper to transcribe the truncated portion for accurate ref_text

    Args:
        audio_path: Path to the reference audio file
        max_duration_seconds: Maximum duration to use (default 15s, recommended 10-15s)

    Returns:
        Tuple of (mx.array of audio, transcribed text)
    """
    import mlx.core as mx

    samples = None
    sr = 24000

    # Try soundfile first (works well for proper WAV files)
    try:
        audio_data, orig_sr = sf.read(audio_path)
        # Convert to mono
        if len(audio_data.shape) > 1:
            audio_data = audio_data.mean(axis=1)
        # Resample to 24kHz if needed
        if orig_sr != 24000:
            import scipy.signal
            num_samples = int(len(audio_data) * 24000 / orig_sr)
            audio_data = scipy.signal.resample(audio_data, num_samples)
        samples = audio_data.astype(np.float32)
        logger.info(f"Loaded reference audio using soundfile: {audio_path} ({len(samples)/sr:.1f}s)")
    except Exception as e:
        logger.warning(f"soundfile failed ({e}), trying pydub...")

        # Fall back to pydub (handles MP3 files disguised as .wav, etc.)
        try:
            from pydub import AudioSegment
            audio_segment = AudioSegment.from_file(audio_path)

            # Convert to mono and 24kHz
            audio_segment = audio_segment.set_channels(1).set_frame_rate(24000)

            # Convert to numpy array (pydub stores as 16-bit PCM)
            samples = np.array(audio_segment.get_array_of_samples(), dtype=np.float32)
            # Normalize to [-1, 1] range
            samples = samples / 32768.0

            logger.info(f"Loaded reference audio using pydub: {audio_path} ({len(samples)/sr:.1f}s)")
        except Exception as e2:
            raise ValueError(f"Failed to load audio from {audio_path}: soundfile error: {e}, pydub error: {e2}")

    # Truncate to max duration
    max_samples = int(max_duration_seconds * sr)
    if len(samples) > max_samples:
        original_duration = len(samples) / sr
        logger.info(f"Truncating reference audio from {original_duration:.1f}s to {max_duration_seconds}s")
        samples = samples[:max_samples]

    # Transcribe truncated audio using Whisper
    ref_text = transcribe_audio(samples, sr)
    logger.info(f"Transcribed reference audio: '{ref_text[:100]}...' " if len(ref_text) > 100 else f"Transcribed reference audio: '{ref_text}'")

    return mx.array(samples.astype(np.float32)), ref_text


def _collect_audio_from_generator(generator) -> tuple[np.ndarray, int]:
    """
    Collect audio and sample_rate from mlx-audio generator and convert to numpy.

    mlx-audio's generate() yields results with .audio attribute (mx.array).
    We collect the final result and convert to numpy.

    Returns:
        Tuple of (audio_array, sample_rate)
    """
    import mlx.core as mx
    import time

    audio = None
    sample_rate = 24000  # Default for Qwen3-TTS
    chunk_count = 0
    start_time = time.time()

    logger.info("Starting audio generation loop...")

    for result in generator:
        chunk_count += 1
        audio = result.audio
        # Extract sample_rate if available on the result
        sample_rate = getattr(result, 'sample_rate', 24000)

        # Force evaluation to prevent lazy evaluation buildup
        if hasattr(audio, 'shape'):
            mx.eval(audio)

        # Log progress every chunk
        elapsed = time.time() - start_time
        if hasattr(audio, 'shape'):
            samples = audio.shape[0] if len(audio.shape) == 1 else audio.shape[-1]
            duration_so_far = samples / sample_rate
            logger.info(f"Generation chunk {chunk_count}: {samples} samples ({duration_so_far:.1f}s audio) in {elapsed:.1f}s")

    total_time = time.time() - start_time
    logger.info(f"Generation complete: {chunk_count} chunks in {total_time:.1f}s")

    if audio is None:
        logger.warning("Generator produced no audio!")
        return np.array([], dtype=np.float32), sample_rate

    # Convert mx.array to numpy if needed
    if hasattr(audio, 'tolist'):
        # mx.array - convert via tolist() for proper conversion
        audio = np.array(audio.tolist(), dtype=np.float32)
    elif not isinstance(audio, np.ndarray):
        audio = np.array(audio, dtype=np.float32)

    logger.info(f"Final audio: {len(audio)} samples ({len(audio)/sample_rate:.1f}s)")
    return audio.astype(np.float32), sample_rate


def synthesize_single(
    text: str,
    voice_id: str,
    voice_mode: str = "prebuilt",
    emotion: Optional[str] = None,
    speed: float = 1.0,
    reference_audio_path: Optional[str] = None,
    reference_transcript: Optional[str] = None,
    voice_description: Optional[str] = None,
) -> tuple[np.ndarray, List[Dict[str, Any]]]:
    """
    Synthesize speech for a single speaker.

    Args:
        text: Text to synthesize
        voice_id: Voice identifier (prebuilt name or registered voice ID)
        voice_mode: 'prebuilt', 'clone', or 'design'
        emotion: Optional emotion/prosody hint (incorporated into text if provided)
        speed: Speech speed multiplier
        reference_audio_path: Direct path to reference audio (clone mode, bypasses registry)
        reference_transcript: Transcript of reference audio (clone mode)
        voice_description: Voice description (design mode, bypasses registry)

    Returns:
        Tuple of (audio_array, word_timings)
    """
    # Add emotion hint to text if provided (Qwen3-TTS supports prosody in text)
    synth_text = text
    if emotion:
        synth_text = f"[{emotion}] {text}"

    if voice_mode == "prebuilt":
        # Use prebuilt voice (CustomVoice model)
        tts = get_tts_model("prebuilt")
        generator = tts.generate(
            text=synth_text,
            voice=voice_id,  # "Aiden", "Chelsie", etc.
            language="English",
        )
        audio, _ = _collect_audio_from_generator(generator)

    elif voice_mode == "clone":
        # Use CSM model for voice cloning
        tts = get_tts_model("clone")

        # Get reference audio path - either from direct parameter or voice registry
        ref_audio_path = reference_audio_path

        if not ref_audio_path:
            # Load from voice registry
            voice_data = load_voice_data(voice_id)
            if not voice_data:
                raise ValueError(f"Cloned voice '{voice_id}' not found")
            ref_audio_path = voice_data.get("reference_audio_path")

        if not ref_audio_path:
            raise ValueError(f"No reference audio available for voice '{voice_id}'")

        # Prepare reference audio: truncate to safe length and transcribe
        # CSM has sequence length limits, so we truncate long samples and
        # use Whisper to get accurate transcription of the truncated portion
        ref_audio, ref_text = prepare_reference_audio(ref_audio_path)

        # Generate speech using CSM with reference audio
        generator = tts.generate(
            text=synth_text,
            ref_audio=ref_audio,
            ref_text=ref_text,
            language="English",
        )
        audio, _ = _collect_audio_from_generator(generator)

    elif voice_mode == "design":
        # Use designed voice (VoiceDesign model with description)
        tts = get_tts_model("design")

        # Check for direct voice description first (bypasses voice registry)
        if voice_description:
            desc = voice_description
        else:
            # Fall back to voice registry
            voice_data = load_voice_data(voice_id)
            if voice_data is None:
                raise ValueError(f"Designed voice '{voice_id}' not found and no voice_description provided")

            desc = voice_data.get("voice_description", "neutral adult voice")

        generator = tts.generate(
            text=synth_text,
            voice_description=desc,
            language="English",
        )
        audio, _ = _collect_audio_from_generator(generator)

    else:
        raise ValueError(f"Unknown voice_mode: {voice_mode}")

    # Extract word timings
    word_timings = extract_word_timings(audio)

    return audio, word_timings


def synthesize_dialogue(
    speakers: Dict[str, SpeakerConfig],
    dialogue: List[DialogueSegment],
) -> tuple[np.ndarray, List[Dict[str, Any]], int]:
    """
    Synthesize multi-speaker dialogue.

    This is the key feature: generates an entire podcast conversation
    in one call, with proper speaker transitions.

    Args:
        speakers: Speaker configurations
        dialogue: List of dialogue segments

    Returns:
        Tuple of (combined_audio, word_timings_with_speaker, total_duration_ms)
    """
    all_audio = []
    all_word_timings = []
    cumulative_offset_ms = 0

    # Pre-load voice data for custom voices
    voice_data_cache = {}
    for speaker_name, config in speakers.items():
        if config.voice_mode in ("clone", "design") and config.voice_id:
            voice_data = load_voice_data(config.voice_id)
            if voice_data:
                voice_data_cache[speaker_name] = voice_data

    for segment in dialogue:
        speaker_name = segment.speaker
        config = speakers.get(speaker_name)

        if config is None:
            logger.warning(f"Unknown speaker '{speaker_name}', skipping segment")
            continue

        text = segment.text
        if not text.strip():
            continue

        # Add emotion hint to text if provided
        synth_text = text
        if segment.emotion:
            synth_text = f"[{segment.emotion}] {text}"

        # Synthesize segment based on voice mode
        if config.voice_mode == "prebuilt":
            tts = get_tts_model("prebuilt")
            generator = tts.generate(
                text=synth_text,
                voice=config.voice_id or "Aiden",
                language="English",
            )
            audio, _ = _collect_audio_from_generator(generator)

        elif config.voice_mode == "clone":
            voice_data = voice_data_cache.get(speaker_name)
            ref_audio_path = voice_data.get("reference_audio_path") if voice_data else None

            if ref_audio_path:
                # Use CSM for cloned voice synthesis
                try:
                    tts = get_tts_model("clone")
                    # Prepare reference audio: truncate to safe length and transcribe
                    ref_audio, ref_text = prepare_reference_audio(ref_audio_path)
                    generator = tts.generate(
                        text=synth_text,
                        ref_audio=ref_audio,
                        ref_text=ref_text,
                        language="English",
                    )
                    audio, _ = _collect_audio_from_generator(generator)
                except Exception as e:
                    logger.warning(f"CSM synthesis failed for speaker '{speaker_name}': {e}")
                    # Fallback to default voice
                    tts = get_tts_model("prebuilt")
                    generator = tts.generate(
                        text=synth_text,
                        voice="Aiden",
                        language="English",
                    )
                    audio, _ = _collect_audio_from_generator(generator)
            else:
                # Fallback to default voice
                logger.warning(f"Voice data missing for speaker '{speaker_name}'")
                tts = get_tts_model("prebuilt")
                generator = tts.generate(
                    text=synth_text,
                    voice="Aiden",
                    language="English",
                )
                audio, _ = _collect_audio_from_generator(generator)

        elif config.voice_mode == "design":
            voice_data = voice_data_cache.get(speaker_name)
            if voice_data:
                tts = get_tts_model("design")
                desc = voice_data.get("voice_description", "neutral adult voice")
                generator = tts.generate(
                    text=synth_text,
                    voice_description=desc,
                    language="English",
                )
                audio, _ = _collect_audio_from_generator(generator)
            else:
                # Use inline description if provided
                if config.description:
                    tts = get_tts_model("design")
                    generator = tts.generate(
                        text=synth_text,
                        voice_description=config.description,
                        language="English",
                    )
                    audio, _ = _collect_audio_from_generator(generator)
                else:
                    # Fallback to default voice
                    logger.warning(f"Voice data missing for speaker '{speaker_name}'")
                    tts = get_tts_model("prebuilt")
                    generator = tts.generate(
                        text=synth_text,
                        voice="Aiden",
                        language="English",
                    )
                    audio, _ = _collect_audio_from_generator(generator)
        else:
            # Unknown mode, fallback
            tts = get_tts_model("prebuilt")
            generator = tts.generate(
                text=synth_text,
                voice="Aiden",
                language="English",
            )
            audio, _ = _collect_audio_from_generator(generator)

        # Extract word timings for this segment
        segment_timings = extract_word_timings(audio)

        # Add speaker info and adjust offsets
        for timing in segment_timings:
            timing["speaker"] = speaker_name
            timing["start_ms"] += cumulative_offset_ms
            timing["end_ms"] += cumulative_offset_ms

        all_word_timings.extend(segment_timings)

        # Calculate segment duration
        segment_duration_ms = int(len(audio) / 24000 * 1000)
        cumulative_offset_ms += segment_duration_ms

        all_audio.append(audio)

    # Concatenate all audio
    if all_audio:
        combined_audio = np.concatenate(all_audio)
    else:
        combined_audio = np.array([], dtype=np.float32)

    total_duration_ms = int(len(combined_audio) / 24000 * 1000)

    return combined_audio, all_word_timings, total_duration_ms


# ---------------------------------------------------------------------------
# API Endpoints
# ---------------------------------------------------------------------------


@app.get("/health")
async def health_check():
    """Health check endpoint with detailed TTS status."""
    # Check which models are loaded
    loaded_models = list(_tts_models.keys())
    using_mock = any(
        isinstance(model, MockTTSModel)
        for model in _tts_models.values()
    ) if _tts_models else False

    # Determine TTS status
    if not _MLX_AUDIO_AVAILABLE and not ENABLE_MOCK_TTS:
        tts_status = "unavailable"
        tts_message = _MLX_AUDIO_ERROR or "mlx-audio not available"
    elif ENABLE_MOCK_TTS or using_mock:
        tts_status = "mock"
        tts_message = "Using mock TTS - output will be static noise, not speech"
    elif len(_tts_models) > 0 and not using_mock:
        tts_status = "ready"
        tts_message = "Real TTS models loaded"
    else:
        tts_status = "available"
        tts_message = "mlx-audio ready - models will load on first synthesis request"

    return {
        "status": "healthy",
        "service": "qwen3-tts",
        "version": "0.7.0",
        "tts_status": tts_status,
        "tts_message": tts_message,
        "mlx_audio_available": _MLX_AUDIO_AVAILABLE,
        "model_loaded": len(_tts_models) > 0,
        "loaded_models": loaded_models,
        "model_map": MODEL_MAP,
        "using_mock": using_mock,
        "mock_mode_enabled": ENABLE_MOCK_TTS,
        "mlx_audio_error": _MLX_AUDIO_ERROR,
        "whisper_loaded": _whisper_model is not None,
        "voice_cloning_available": _MLX_AUDIO_AVAILABLE and not using_mock,
        "voice_modes": ["prebuilt", "clone", "design"],
        "output_formats": ["wav", "mp3"],
    }


@app.post("/synthesize", response_model=SynthesisResponse)
async def synthesize(request: SynthesizeRequest):
    """
    Generate speech for a single speaker.

    Returns audio with word-level timings for teleprompter sync.

    For clone mode, you can either:
    - Use a registered voice_id (voice must be created via /voices/clone first)
    - Provide reference_audio_path and reference_transcript directly (bypasses registry)

    For design mode, you can either:
    - Use a registered voice_id (voice must be created via /voices/design first)
    - Provide voice_description directly (bypasses registry)
    """
    # Check TTS availability before attempting synthesis
    if not _MLX_AUDIO_AVAILABLE and not ENABLE_MOCK_TTS:
        raise HTTPException(
            status_code=503,
            detail={
                "error": "TTS service unavailable",
                "message": _MLX_AUDIO_ERROR or "mlx-audio not available",
                "hint": "Install mlx-audio>=0.3.0rc1 or set ENABLE_MOCK_TTS=true for development",
            }
        )

    try:
        audio, word_timings = synthesize_single(
            text=request.text,
            voice_id=request.voice_id,
            voice_mode=request.voice_mode,
            emotion=request.emotion,
            speed=request.speed,
            reference_audio_path=request.reference_audio_path,
            reference_transcript=request.reference_transcript,
            voice_description=request.voice_description,
        )

        output_format = request.output_format.lower()
        audio_bytes = encode_audio(audio, 24000, output_format)

        import base64
        audio_base64 = base64.b64encode(audio_bytes).decode("utf-8")

        duration_ms = int(len(audio) / 24000 * 1000)

        return SynthesisResponse(
            audio_base64=audio_base64,
            duration_ms=duration_ms,
            word_timings=word_timings,
            sample_rate=24000,
            format=output_format,
        )

    except Exception as e:
        logger.exception(f"Synthesis failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/synthesize-dialogue", response_model=SynthesisResponse)
async def synthesize_dialogue_endpoint(request: SynthesizeDialogueRequest):
    """
    Generate multi-speaker dialogue audio.

    This is the key feature for podcast generation: synthesizes an entire
    conversation in one call with automatic speaker transitions.

    Returns combined audio with word-level timings including speaker attribution.
    """
    # Check TTS availability before attempting synthesis
    if not _MLX_AUDIO_AVAILABLE and not ENABLE_MOCK_TTS:
        raise HTTPException(
            status_code=503,
            detail={
                "error": "TTS service unavailable",
                "message": _MLX_AUDIO_ERROR or "mlx-audio not available",
                "hint": "Install mlx-audio>=0.3.0rc1 or set ENABLE_MOCK_TTS=true for development",
            }
        )

    try:
        audio, word_timings, duration_ms = synthesize_dialogue(
            speakers=request.speakers,
            dialogue=request.dialogue,
        )

        output_format = request.output_format.lower()
        audio_bytes = encode_audio(audio, 24000, output_format)

        import base64
        audio_base64 = base64.b64encode(audio_bytes).decode("utf-8")

        return SynthesisResponse(
            audio_base64=audio_base64,
            duration_ms=duration_ms,
            word_timings=word_timings,
            sample_rate=24000,
            format=output_format,
        )

    except Exception as e:
        logger.exception(f"Dialogue synthesis failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/voices/clone")
async def clone_voice(
    audio: UploadFile = File(..., description="Audio file (10-15 seconds recommended)"),
    transcript: str = Form(..., description="Transcript of the audio"),
    name: str = Form(..., description="Name for the cloned voice"),
    description: str = Form(default="", description="Optional description"),
):
    """
    Clone a voice from an audio sample and transcript using Qwen3-TTS.

    Requirements:
    - Duration: 10-15 seconds recommended for best quality
    - Format: WAV (16-bit), MP3, M4A
    - Sample rate: >= 24kHz recommended
    - Channels: Mono preferred
    - Quality: Clear reading, no background noise
    - Transcript: Accurate transcript significantly improves clone quality

    Voice cloning is processed locally using Qwen3-TTS-1.7B-Base.
    The reference audio is stored and used at synthesis time.
    """
    try:
        # Generate unique ID
        voice_id = f"clone_{uuid.uuid4().hex[:8]}"

        # Read uploaded audio
        audio_bytes = await audio.read()
        buffer = io.BytesIO(audio_bytes)

        # Try to read with soundfile (supports multiple formats)
        try:
            audio_data, sample_rate = sf.read(buffer)
        except Exception:
            # Try with pydub for MP3/other formats
            from pydub import AudioSegment
            buffer.seek(0)
            audio_segment = AudioSegment.from_file(buffer)
            audio_data = np.array(audio_segment.get_array_of_samples(), dtype=np.float32)
            audio_data = audio_data / 32768.0  # Normalize
            sample_rate = audio_segment.frame_rate

        # Ensure mono audio
        if len(audio_data.shape) > 1:
            audio_data = audio_data.mean(axis=1)

        # Resample to 24kHz if needed (CSM/Qwen3-TTS expects 24kHz)
        if sample_rate != 24000:
            import scipy.signal
            num_samples = int(len(audio_data) * 24000 / sample_rate)
            audio_data = scipy.signal.resample(audio_data, num_samples)
            sample_rate = 24000

        # Save reference audio as WAV
        audio_path = get_voice_audio_path(voice_id)
        sf.write(audio_path, audio_data, sample_rate)

        logger.info(f"Registering cloned voice '{name}' as {voice_id}")

        # Save voice data (reference audio path and transcript for CSM)
        voice_data = {
            "reference_audio_path": str(audio_path),
            "reference_transcript": transcript,
            "sample_rate": sample_rate,
        }
        save_voice_data(voice_id, voice_data)

        # Update metadata
        voices = load_voices_metadata()
        voices[voice_id] = VoiceInfo(
            id=voice_id,
            name=name,
            type="cloned",
            description=description or "Voice cloned with CSM",
            created_at=datetime.now(timezone.utc).isoformat(),
        )
        save_voices_metadata(voices)

        logger.info(f"Cloned voice '{name}' registered as {voice_id}")

        return {
            "voice_id": voice_id,
            "name": name,
            "type": "cloned",
            "description": description,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Voice cloning failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/voices/design")
async def design_voice(request: VoiceDesignRequest):
    """
    Create a voice from a text description.

    Describes desired voice characteristics (e.g., "warm, mid-30s female,
    slightly raspy"). Unlike embedding-based approaches, Qwen3-TTS uses
    the description directly at synthesis time.
    """
    # Check TTS availability for sample generation
    if request.sample_text and not _MLX_AUDIO_AVAILABLE and not ENABLE_MOCK_TTS:
        raise HTTPException(
            status_code=503,
            detail={
                "error": "TTS service unavailable for sample generation",
                "message": _MLX_AUDIO_ERROR or "mlx-audio not available",
                "hint": "Remove sample_text or set ENABLE_MOCK_TTS=true",
            }
        )

    try:
        # Generate unique ID
        voice_id = f"design_{uuid.uuid4().hex[:8]}"

        # Save voice data (description for use at synthesis time)
        voice_data = {
            "voice_description": request.description,
        }
        save_voice_data(voice_id, voice_data)

        # Update metadata
        voices = load_voices_metadata()
        voices[voice_id] = VoiceInfo(
            id=voice_id,
            name=request.name,
            type="designed",
            description=request.description,
            created_at=datetime.now(timezone.utc).isoformat(),
        )
        save_voices_metadata(voices)

        # Generate sample audio if requested
        sample_audio_base64 = None
        if request.sample_text:
            tts = get_tts_model("design")
            generator = tts.generate(
                text=request.sample_text,
                voice_description=request.description,
                language="English",
            )
            audio, sample_rate = _collect_audio_from_generator(generator)
            buffer = io.BytesIO()
            sf.write(buffer, audio, sample_rate, format="WAV")
            import base64
            sample_audio_base64 = base64.b64encode(buffer.getvalue()).decode("utf-8")

        logger.info(f"Designed voice '{request.name}' as {voice_id}")

        return {
            "voice_id": voice_id,
            "name": request.name,
            "type": "designed",
            "description": request.description,
            "sample_audio_base64": sample_audio_base64,
        }

    except Exception as e:
        logger.exception(f"Voice design failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/voices")
async def list_voices():
    """
    List all registered voices (cloned and designed).

    Does not include prebuilt voices (use /voices/prebuilt for those).
    """
    voices = load_voices_metadata()
    return {
        "voices": [v.model_dump() for v in voices.values()],
        "count": len(voices),
    }


@app.get("/voices/prebuilt")
async def list_prebuilt_voices():
    """
    List the 9 built-in Qwen3-TTS voices.

    These are ready to use without any setup.
    """
    return {
        "voices": PREBUILT_VOICES,
        "count": len(PREBUILT_VOICES),
    }


@app.post("/transcribe", response_model=TranscribeResponse)
async def transcribe_audio_endpoint(
    audio: UploadFile = File(..., description="Audio file to transcribe")
):
    """
    Transcribe audio using Whisper.

    Accepts WAV, MP3, M4A, and other common audio formats.
    Returns the transcript and audio duration.
    """
    try:
        audio_bytes = await audio.read()
        buffer = io.BytesIO(audio_bytes)

        try:
            audio_data, sample_rate = sf.read(buffer)
        except Exception:
            from pydub import AudioSegment
            buffer.seek(0)
            audio_segment = AudioSegment.from_file(buffer)
            audio_data = np.array(audio_segment.get_array_of_samples(), dtype=np.float32)
            audio_data = audio_data / 32768.0
            sample_rate = audio_segment.frame_rate

        if len(audio_data.shape) > 1:
            audio_data = audio_data.mean(axis=1)

        if sample_rate != 24000:
            import scipy.signal
            num_samples = int(len(audio_data) * 24000 / sample_rate)
            audio_data = scipy.signal.resample(audio_data, num_samples)
            sample_rate = 24000

        transcript = transcribe_audio(audio_data.astype(np.float32), sample_rate)
        duration_seconds = len(audio_data) / sample_rate

        return TranscribeResponse(
            transcript=transcript,
            duration_seconds=duration_seconds
        )

    except Exception as e:
        logger.exception(f"Transcription failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/warm", response_model=WarmResponse)
async def warm_models(request: WarmRequest = None):
    """
    Pre-load models for faster first generation.

    Call this when entering podcast mode to warm up the models.
    By default, warms both clone and design models.
    """
    if request is None:
        modes_to_warm = ["clone", "design"]
    else:
        modes_to_warm = request.modes

    warmed = []
    for mode in modes_to_warm:
        if mode in MODEL_MAP:
            logger.info(f"Warming model for mode: {mode}")
            get_tts_model(mode)
            warmed.append(mode)
        else:
            logger.warning(f"Unknown mode: {mode}, skipping")

    memory_mb = get_memory_usage()
    logger.info(f"Warmed models: {warmed}, memory usage: {memory_mb:.1f} MB")

    return WarmResponse(warmed=warmed, memory_mb=memory_mb)


@app.delete("/voices/{voice_id}")
async def delete_voice(voice_id: str):
    """
    Remove a cloned or designed voice.

    Cannot delete prebuilt voices.
    """
    # Check if it's a prebuilt voice
    if any(v["id"] == voice_id for v in PREBUILT_VOICES):
        raise HTTPException(status_code=400, detail="Cannot delete prebuilt voices")

    # Check if voice exists
    voices = load_voices_metadata()
    if voice_id not in voices:
        raise HTTPException(status_code=404, detail="Voice not found")

    # Delete voice data file (JSON)
    data_path = get_voice_data_path(voice_id)
    if data_path.exists():
        data_path.unlink()

    # Delete reference audio file (WAV) if it exists
    audio_path = get_voice_audio_path(voice_id)
    if audio_path.exists():
        audio_path.unlink()

    # Remove from metadata
    del voices[voice_id]
    save_voices_metadata(voices)

    logger.info(f"Deleted voice {voice_id}")

    return {"deleted": voice_id}


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("QWEN_TTS_PORT", 7860))
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=port,
        timeout_graceful_shutdown=5,  # 5 seconds to finish pending requests
    )
