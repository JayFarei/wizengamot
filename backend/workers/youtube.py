"""YouTube transcription worker using yt-dlp and Whisper."""

import tempfile
import logging
from pathlib import Path
from typing import Dict, Any, Optional

import yt_dlp
import whisper

logger = logging.getLogger(__name__)


def transcribe_youtube(
    url: str,
    whisper_model: str = "base",
    start_seconds: Optional[int] = None
) -> Dict[str, Any]:
    """
    Download YouTube audio and transcribe with Whisper.

    Args:
        url: YouTube video URL
        whisper_model: Whisper model size ("tiny", "base", "small", "medium", "large")
        start_seconds: Optional start time to trim audio from

    Returns:
        {
            "transcript": str,
            "title": str,
            "duration": float,
            "channel": str
        }

    Raises:
        RuntimeError: If download or transcription fails
    """
    with tempfile.TemporaryDirectory() as tmpdir:
        # 1. Download audio using yt-dlp Python API
        ydl_opts = {
            'format': 'bestaudio/best',
            'outtmpl': f'{tmpdir}/%(title)s.%(ext)s',
            'postprocessors': [{
                'key': 'FFmpegExtractAudio',
                'preferredcodec': 'mp3',
                'preferredquality': '192',
            }],
            'quiet': True,
            'no_warnings': True,
        }

        logger.info(f"Downloading audio from: {url}")

        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=True)
                title = info.get('title', 'Unknown')
                duration = info.get('duration', 0)
                channel = info.get('channel', info.get('uploader', 'Unknown'))
        except Exception as e:
            logger.error(f"Failed to download YouTube audio: {e}")
            raise RuntimeError(f"Failed to download YouTube audio: {e}")

        # 2. Find the downloaded MP3
        mp3_files = list(Path(tmpdir).glob('*.mp3'))
        if not mp3_files:
            # Try other audio formats as fallback
            audio_files = list(Path(tmpdir).glob('*.*'))
            audio_files = [f for f in audio_files if f.suffix in ('.mp3', '.m4a', '.webm', '.opus')]
            if not audio_files:
                raise RuntimeError("No audio file downloaded")
            audio_path = str(audio_files[0])
        else:
            audio_path = str(mp3_files[0])

        logger.info(f"Audio downloaded: {audio_path}")

        # 3. Handle optional trimming (if start_seconds provided)
        if start_seconds is not None and start_seconds > 0:
            import subprocess
            trimmed_path = f"{tmpdir}/trimmed.mp3"
            try:
                subprocess.run(
                    ['ffmpeg', '-nostdin', '-loglevel', 'error', '-y',
                     '-ss', str(start_seconds), '-i', audio_path,
                     '-acodec', 'copy', trimmed_path],
                    check=True,
                    capture_output=True
                )
                audio_path = trimmed_path
                logger.info(f"Audio trimmed from {start_seconds}s")
            except subprocess.CalledProcessError as e:
                logger.warning(f"Failed to trim audio: {e}, using full audio")

        # 4. Transcribe with Whisper
        logger.info(f"Loading Whisper model: {whisper_model}")
        model = whisper.load_model(whisper_model)

        logger.info("Transcribing audio...")
        result = model.transcribe(audio_path)

        transcript = result.get("text", "").strip()
        logger.info(f"Transcription complete: {len(transcript)} characters")

        return {
            "transcript": transcript,
            "title": title,
            "duration": duration,
            "channel": channel
        }


def extract_start_time(url: str) -> Optional[int]:
    """
    Extract start time from YouTube URL parameter.

    Supports formats:
    - ?t=123 (seconds)
    - ?t=1m30s
    - ?t=1h2m30s

    Args:
        url: YouTube URL

    Returns:
        Start time in seconds, or None if not present
    """
    import re

    match = re.search(r'[?&]t=([^&#]+)', url)
    if not match:
        return None

    tval = match.group(1)

    # Try hours/minutes/seconds format
    hms_match = re.match(r'^(\d+)h(\d+)m(\d+)s?$', tval)
    if hms_match:
        return int(hms_match.group(1)) * 3600 + int(hms_match.group(2)) * 60 + int(hms_match.group(3))

    # Try minutes/seconds format
    ms_match = re.match(r'^(\d+)m(\d+)s?$', tval)
    if ms_match:
        return int(ms_match.group(1)) * 60 + int(ms_match.group(2))

    # Try seconds only
    s_match = re.match(r'^(\d+)s?$', tval)
    if s_match:
        return int(s_match.group(1))

    return None
