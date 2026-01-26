"""Default podcast characters for quick start."""

from typing import Any, Dict, List

DEFAULT_CHARACTERS: List[Dict[str, Any]] = [
    {
        "name": "Alex",
        "voice_mode": "design",
        "voice_config": {
            "description": "Warm, engaging male voice in mid-30s. Friendly and curious tone, speaks clearly with natural enthusiasm. American accent.",
        },
        "personality": {
            "traits": "Curious, friendly, asks insightful questions",
            "key_phrases": ["That's fascinating!", "Tell me more about..."],
            "expertise_areas": [],
            "speaking_role": "host",
            "emotion_style": "Enthusiastic but measured",
        },
    },
    {
        "name": "Dr. Morgan",
        "voice_mode": "design",
        "voice_config": {
            "description": "Authoritative female voice in early 40s. Warm but professional, clear articulation. Slight British accent.",
        },
        "personality": {
            "traits": "Knowledgeable, explains complex topics clearly, uses analogies",
            "key_phrases": ["The key insight here is...", "Let me break this down..."],
            "expertise_areas": [],
            "speaking_role": "expert",
            "emotion_style": "Confident and measured with occasional enthusiasm",
        },
    },
]
