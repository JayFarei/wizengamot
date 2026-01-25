"""
Qwen3-TTS native service for podcast audio generation.

This service wraps the Qwen3-TTS model (1.7B params) to provide:
- Single speaker synthesis
- Multi-speaker dialogue synthesis (entire podcast in one call)
- Voice cloning from ~3 seconds of audio + transcript
- Voice design from text descriptions
- Word-level timing extraction via Whisper for teleprompter sync

Runs natively (not Docker) to enable MPS acceleration on Apple Silicon.
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
from datetime import datetime
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

# Paths
SERVICE_DIR = Path(__file__).parent
VOICES_DIR = SERVICE_DIR / "voices"
VOICES_DIR.mkdir(exist_ok=True)

# Voice metadata file
VOICES_METADATA_FILE = VOICES_DIR / "metadata.json"

# Global model instances (lazy loaded)
# Three specialized 1.7B models for different voice modes
_tts_models: dict = {}
_whisper_model = None

# Model map: voice_mode -> HuggingFace model name
MODEL_MAP = {
    "clone": "Qwen/Qwen3-TTS-12Hz-1.7B-Base",        # Voice cloning from audio
    "prebuilt": "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice",  # 9 prebuilt voices
    "design": "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign",    # Create from descriptions
}

# Built-in voices from Qwen3-TTS (actual model voices, lowercase IDs)
PREBUILT_VOICES = [
    {"id": "aiden", "name": "Aiden", "gender": "male", "description": "Young adult male, clear and energetic"},
    {"id": "dylan", "name": "Dylan", "gender": "male", "description": "Adult male, warm and friendly"},
    {"id": "eric", "name": "Eric", "gender": "male", "description": "Adult male, professional and calm"},
    {"id": "ryan", "name": "Ryan", "gender": "male", "description": "Adult male, warm and professional"},
    {"id": "uncle_fu", "name": "Uncle Fu", "gender": "male", "description": "Mature male, wise and measured"},
    {"id": "ono_anna", "name": "Anna", "gender": "female", "description": "Adult female, warm and expressive"},
    {"id": "serena", "name": "Serena", "gender": "female", "description": "Young adult female, bright and clear"},
    {"id": "sohee", "name": "Sohee", "gender": "female", "description": "Young female, energetic and engaging"},
    {"id": "vivian", "name": "Vivian", "gender": "female", "description": "Adult female, professional and calm"},
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

    # Clear GPU/MPS cache if torch is available
    try:
        import torch
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
            logger.info("Cleared CUDA cache")
        if hasattr(torch.mps, 'empty_cache'):
            torch.mps.empty_cache()
            logger.info("Cleared MPS cache")
    except ImportError:
        pass
    except Exception as e:
        logger.warning(f"Failed to clear GPU cache: {e}")


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
    audio_base64: str = Field(..., description="Base64-encoded audio (WAV format)")
    duration_ms: int = Field(..., description="Audio duration in milliseconds")
    word_timings: List[Dict[str, Any]] = Field(
        ...,
        description="Word-level timings: [{word, start_ms, end_ms, speaker?}]"
    )
    sample_rate: int = Field(default=24000, description="Audio sample rate")


# ---------------------------------------------------------------------------
# Model Loading
# ---------------------------------------------------------------------------


def get_device():
    """Get the best available device for inference."""
    import torch
    if torch.cuda.is_available():
        return "cuda"
    elif torch.backends.mps.is_available():
        return "mps"
    else:
        return "cpu"


def get_tts_model(mode: str = "prebuilt"):
    """
    Lazy load the appropriate Qwen3-TTS model for the voice mode.

    Args:
        mode: Voice mode - "clone", "prebuilt", or "design"

    Returns:
        The loaded TTS model (real or mock)
    """
    global _tts_models

    model_name = MODEL_MAP.get(mode, MODEL_MAP["prebuilt"])

    if model_name not in _tts_models:
        device = get_device()
        logger.info(f"Loading Qwen3-TTS model: {model_name} on device: {device}...")
        try:
            from qwen_tts import Qwen3TTSModel
            _tts_models[model_name] = Qwen3TTSModel.from_pretrained(
                model_name,
                device_map=device,
            )
            logger.info(f"Model {model_name} loaded successfully on {device}")
        except ImportError as e:
            logger.warning(f"qwen-tts import failed: {e}, using mock model for development")
            _tts_models[model_name] = MockTTSModel()
        except Exception as e:
            logger.error(f"Failed to load {model_name}: {e}")
            _tts_models[model_name] = MockTTSModel()

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


class MockTTSModel:
    """
    Mock TTS model for development/testing when qwen-tts is not installed.

    Matches the real Qwen3TTSModel API:
    - generate_custom_voice() for prebuilt voices
    - generate_voice_clone() for cloned voices
    - generate_voice_design() for designed voices
    """

    def _generate_mock_audio(self, text: str, speed: float = 1.0) -> np.ndarray:
        """Generate mock audio (silence with small noise)."""
        # Generate ~100ms of audio per word at 24kHz
        words = text.split()
        duration_samples = int(len(words) * 0.4 * 24000 / speed)
        # Small random noise to simulate audio
        audio = np.random.randn(duration_samples) * 0.01
        return audio.astype(np.float32)

    def generate_custom_voice(
        self,
        text: str,
        speaker: str,
        language: Optional[str] = None,
        instruct: Optional[str] = None,
        non_streaming_mode: bool = True,
    ) -> tuple[List[np.ndarray], int]:
        """
        Generate speech using prebuilt voices (9 premium timbres).

        Args:
            text: Text string to synthesize
            speaker: Speaker name (aiden, ryan, serena, etc.)
            language: Language code (default: "en")
            instruct: Optional style/emotion instruction

        Returns:
            Tuple of (list of audio arrays, sample_rate)
        """
        wavs = [self._generate_mock_audio(text)]
        return wavs, 24000

    def generate_voice_clone(
        self,
        text: str,
        language: Optional[str] = None,
        ref_audio: Optional[str] = None,
        ref_text: Optional[str] = None,
        non_streaming_mode: bool = False,
    ) -> tuple[List[np.ndarray], int]:
        """
        Generate speech using a cloned voice from reference audio.

        Args:
            text: Text string to synthesize
            language: Language code (default: "en")
            ref_audio: Path to reference audio file (~3s sample)
            ref_text: Transcript of the reference audio

        Returns:
            Tuple of (list of audio arrays, sample_rate)
        """
        wavs = [self._generate_mock_audio(text)]
        return wavs, 24000

    def generate_voice_design(
        self,
        text: str,
        instruct: str,
        language: Optional[str] = None,
        non_streaming_mode: bool = True,
    ) -> tuple[List[np.ndarray], int]:
        """
        Generate speech using voice created from text descriptions.

        Args:
            text: Text string to synthesize
            instruct: Voice description (e.g., "warm, mid-30s female")
            language: Language code (default: "en")

        Returns:
            Tuple of (list of audio arrays, sample_rate)
        """
        wavs = [self._generate_mock_audio(text)]
        return wavs, 24000


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
        wavs, sr = tts.generate_custom_voice(
            text=synth_text,
            speaker=voice_id,  # "aiden", "ryan", etc.
            language="english",
            instruct=emotion,  # Pass emotion as instruction
        )
        audio = wavs[0]

    elif voice_mode == "clone":
        # Use cloned voice (Base model with reference audio)
        tts = get_tts_model("clone")

        # Check for direct reference audio path first (bypasses voice registry)
        if reference_audio_path and Path(reference_audio_path).exists():
            ref_audio_path = reference_audio_path
            ref_transcript = reference_transcript or ""
        else:
            # Fall back to voice registry
            voice_data = load_voice_data(voice_id)
            if voice_data is None:
                raise ValueError(f"Cloned voice '{voice_id}' not found and no reference_audio_path provided")

            ref_audio_path = voice_data.get("reference_audio_path")
            ref_transcript = voice_data.get("reference_transcript", "")

            if not ref_audio_path or not Path(ref_audio_path).exists():
                raise ValueError(f"Reference audio for voice '{voice_id}' not found")

        wavs, sr = tts.generate_voice_clone(
            text=synth_text,
            language="english",
            ref_audio=ref_audio_path,
            ref_text=ref_transcript,
        )
        audio = wavs[0]

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

        wavs, sr = tts.generate_voice_design(
            text=synth_text,
            instruct=desc,
            language="english",
        )
        audio = wavs[0]

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
            wavs, sr = tts.generate_custom_voice(
                text=synth_text,
                speaker=config.voice_id or "aiden",
                language="english",
                instruct=segment.emotion,
            )
            audio = wavs[0]

        elif config.voice_mode == "clone":
            voice_data = voice_data_cache.get(speaker_name)
            if voice_data:
                tts = get_tts_model("clone")
                ref_audio_path = voice_data.get("reference_audio_path")
                ref_transcript = voice_data.get("reference_transcript", "")

                if ref_audio_path and Path(ref_audio_path).exists():
                    wavs, sr = tts.generate_voice_clone(
                        text=synth_text,
                        language="english",
                        ref_audio=ref_audio_path,
                        ref_text=ref_transcript,
                    )
                    audio = wavs[0]
                else:
                    # Fallback to default voice
                    logger.warning(f"Reference audio missing for speaker '{speaker_name}'")
                    tts = get_tts_model("prebuilt")
                    wavs, sr = tts.generate_custom_voice(
                        text=synth_text,
                        speaker="aiden",
                        language="english",
                    )
                    audio = wavs[0]
            else:
                # Fallback to default voice
                logger.warning(f"Voice data missing for speaker '{speaker_name}'")
                tts = get_tts_model("prebuilt")
                wavs, sr = tts.generate_custom_voice(
                    text=synth_text,
                    speaker="aiden",
                    language="english",
                )
                audio = wavs[0]

        elif config.voice_mode == "design":
            voice_data = voice_data_cache.get(speaker_name)
            if voice_data:
                tts = get_tts_model("design")
                voice_description = voice_data.get("voice_description", "neutral adult voice")
                wavs, sr = tts.generate_voice_design(
                    text=synth_text,
                    instruct=voice_description,
                    language="english",
                )
                audio = wavs[0]
            else:
                # Use inline description if provided
                if config.description:
                    tts = get_tts_model("design")
                    wavs, sr = tts.generate_voice_design(
                        text=synth_text,
                        instruct=config.description,
                        language="english",
                    )
                    audio = wavs[0]
                else:
                    # Fallback to default voice
                    logger.warning(f"Voice data missing for speaker '{speaker_name}'")
                    tts = get_tts_model("prebuilt")
                    wavs, sr = tts.generate_custom_voice(
                        text=synth_text,
                        speaker="aiden",
                        language="english",
                    )
                    audio = wavs[0]
        else:
            # Unknown mode, fallback
            tts = get_tts_model("prebuilt")
            wavs, sr = tts.generate_custom_voice(
                text=synth_text,
                speaker="aiden",
                language="english",
            )
            audio = wavs[0]

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
    """Health check endpoint."""
    # Check which models are loaded
    loaded_models = list(_tts_models.keys())
    using_mock = any(
        isinstance(model, MockTTSModel)
        for model in _tts_models.values()
    ) if _tts_models else True

    return {
        "status": "healthy",
        "service": "qwen3-tts",
        "version": "0.1.0",
        "model_loaded": len(_tts_models) > 0,
        "loaded_models": loaded_models,
        "using_mock": using_mock,
        "whisper_loaded": _whisper_model is not None,
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

        # Convert to WAV bytes
        buffer = io.BytesIO()
        sf.write(buffer, audio, 24000, format="WAV")
        audio_bytes = buffer.getvalue()

        import base64
        audio_base64 = base64.b64encode(audio_bytes).decode("utf-8")

        duration_ms = int(len(audio) / 24000 * 1000)

        return SynthesisResponse(
            audio_base64=audio_base64,
            duration_ms=duration_ms,
            word_timings=word_timings,
            sample_rate=24000,
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
    try:
        audio, word_timings, duration_ms = synthesize_dialogue(
            speakers=request.speakers,
            dialogue=request.dialogue,
        )

        # Convert to WAV bytes
        buffer = io.BytesIO()
        sf.write(buffer, audio, 24000, format="WAV")
        audio_bytes = buffer.getvalue()

        import base64
        audio_base64 = base64.b64encode(audio_bytes).decode("utf-8")

        return SynthesisResponse(
            audio_base64=audio_base64,
            duration_ms=duration_ms,
            word_timings=word_timings,
            sample_rate=24000,
        )

    except Exception as e:
        logger.exception(f"Dialogue synthesis failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/voices/clone")
async def clone_voice(
    audio: UploadFile = File(..., description="Audio file (~3 seconds)"),
    transcript: str = Form(..., description="Transcript of the audio"),
    name: str = Form(..., description="Name for the cloned voice"),
    description: str = Form(default="", description="Optional description"),
):
    """
    Clone a voice from an audio sample and transcript.

    Requires ~3 seconds of clean audio with matching transcript.
    The cloned voice can then be used for synthesis.

    Note: Unlike embedding-based approaches, Qwen3-TTS uses the reference audio
    directly at synthesis time. We save the audio file and transcript for later use.
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

        # Resample to 24kHz if needed (Qwen3-TTS expects 24kHz)
        if sample_rate != 24000:
            import scipy.signal
            num_samples = int(len(audio_data) * 24000 / sample_rate)
            audio_data = scipy.signal.resample(audio_data, num_samples)
            sample_rate = 24000

        # Save reference audio as WAV
        audio_path = get_voice_audio_path(voice_id)
        sf.write(audio_path, audio_data, sample_rate)

        # Save voice data (path and transcript)
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
            description=description or f"Cloned from audio sample",
            created_at=datetime.utcnow().isoformat(),
        )
        save_voices_metadata(voices)

        logger.info(f"Cloned voice '{name}' as {voice_id}")

        return {
            "voice_id": voice_id,
            "name": name,
            "type": "cloned",
            "description": description,
        }

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
            created_at=datetime.utcnow().isoformat(),
        )
        save_voices_metadata(voices)

        # Generate sample audio if requested
        sample_audio_base64 = None
        if request.sample_text:
            tts = get_tts_model("design")
            wavs, sr = tts.generate_voice_design(
                text=request.sample_text,
                instruct=request.description,
                language="english",
            )
            audio = wavs[0]
            buffer = io.BytesIO()
            sf.write(buffer, audio, sr, format="WAV")
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
