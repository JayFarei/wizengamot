"""Graph curation system for identifying and fixing knowledge graph issues.

This module implements rubric-based curation workflows for:
- Duplicate entity detection
- Missing relationship identification
- Relationship validation

All curation actions require manual approval; this module only generates candidates.
"""

import json
import os
import uuid
import logging
from datetime import datetime
from pathlib import Path
from dataclasses import dataclass, field, asdict
from typing import List, Dict, Any, Optional, Tuple, Set
from difflib import SequenceMatcher
from collections import defaultdict

from .knowledge_graph import (
    load_entities,
    save_entities,
    load_manual_links,
    save_manual_links,
    find_similar_entity,
    VALID_RELATIONSHIP_TYPES
)
from .openrouter import query_model
from .settings import get_knowledge_graph_model

logger = logging.getLogger(__name__)

# Data directory for curation storage
CURATION_DIR = os.getenv("CURATION_DIR", "data/curation")


def ensure_curation_dir():
    """Ensure the curation directory exists."""
    Path(CURATION_DIR).mkdir(parents=True, exist_ok=True)


def get_curation_sessions_path() -> str:
    """Get the path to the curation sessions storage file."""
    return os.path.join(CURATION_DIR, "curation_sessions.json")


def load_curation_data() -> Dict[str, Any]:
    """Load curation sessions and history from storage."""
    ensure_curation_dir()
    path = get_curation_sessions_path()

    if os.path.exists(path):
        with open(path, 'r') as f:
            return json.load(f)

    return {
        "sessions": {},
        "history": [],
        "dismissed_candidates": [],
        "updated_at": None
    }


def save_curation_data(data: Dict[str, Any]):
    """Save curation data to storage."""
    ensure_curation_dir()
    data["updated_at"] = datetime.utcnow().isoformat()

    path = get_curation_sessions_path()
    with open(path, 'w') as f:
        json.dump(data, f, indent=2)


@dataclass
class CurationCandidate:
    """A candidate for curation action (merge, link, delete, etc.)."""
    id: str
    rubric: str  # "duplicate", "missing_relationship", "suspect_relationship"
    confidence: float  # 0.0-1.0
    entities: List[str]  # Involved entity IDs
    entity_names: List[str]  # For display
    suggested_action: str  # "merge", "create_relationship", "delete_relationship", "review"
    reasoning: str  # LLM-generated explanation
    evidence: List[Dict[str, Any]] = field(default_factory=list)  # Supporting contexts/notes
    relationship_type: Optional[str] = None  # For relationship candidates
    created_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class CurationSession:
    """A curation session with candidates for review."""
    id: str
    candidates: List[CurationCandidate]
    reviewed: List[str] = field(default_factory=list)  # Candidate IDs already processed
    created_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "candidates": [c.to_dict() for c in self.candidates],
            "reviewed": self.reviewed,
            "created_at": self.created_at
        }


# ============================================================================
# Duplicate Detection
# ============================================================================

def calculate_lexical_similarity(s1: str, s2: str) -> float:
    """Calculate lexical similarity using SequenceMatcher."""
    return SequenceMatcher(None, s1.lower().strip(), s2.lower().strip()).ratio()


def normalize_for_comparison(name: str) -> str:
    """Normalize entity name for comparison."""
    # Lowercase, strip whitespace, remove common articles
    name = name.lower().strip()
    for article in ["the ", "a ", "an "]:
        if name.startswith(article):
            name = name[len(article):]
    # Remove common suffixes
    for suffix in [" inc", " inc.", " llc", " corp", " corp."]:
        if name.endswith(suffix):
            name = name[:-len(suffix)]
    return name


def find_duplicate_candidates(
    threshold: float = 0.7,
    max_candidates: int = 50
) -> List[CurationCandidate]:
    """
    Find potential duplicate entities using fuzzy string matching.

    Args:
        threshold: Minimum similarity threshold (0-1) for considering duplicates
        max_candidates: Maximum number of candidates to return

    Returns:
        List of CurationCandidate objects for potential duplicates
    """
    data = load_entities()
    curation_data = load_curation_data()

    entities = data.get("entities", {})
    note_entities = data.get("note_entities", {})
    dismissed = set(curation_data.get("dismissed_candidates", []))

    # Build entity list with mention counts
    entity_list = []
    for entity_id, entity in entities.items():
        mention_count = len(entity.get("mentions", []))
        if mention_count > 0:  # Only consider entities with mentions
            entity_list.append({
                "id": entity_id,
                "name": entity.get("name", ""),
                "type": entity.get("type", "concept"),
                "mention_count": mention_count,
                "normalized": normalize_for_comparison(entity.get("name", ""))
            })

    candidates = []
    processed_pairs = set()

    for i, e1 in enumerate(entity_list):
        for e2 in entity_list[i + 1:]:
            # Skip already processed pairs
            pair_key = tuple(sorted([e1["id"], e2["id"]]))
            if pair_key in processed_pairs:
                continue
            processed_pairs.add(pair_key)

            # Calculate lexical similarity
            lexical_sim = calculate_lexical_similarity(e1["normalized"], e2["normalized"])

            # Also check normalized similarity
            norm_sim = calculate_lexical_similarity(e1["name"], e2["name"])

            # Combined similarity
            similarity = max(lexical_sim, norm_sim)

            if similarity >= threshold:
                # Calculate confidence based on multiple factors
                confidence = similarity * 0.6  # Base from similarity

                # Boost if same type
                if e1["type"] == e2["type"]:
                    confidence += 0.15

                # Boost if one is substring of other
                if e1["normalized"] in e2["normalized"] or e2["normalized"] in e1["normalized"]:
                    confidence += 0.1

                # Boost if high mention count for both (more likely to be significant)
                if e1["mention_count"] >= 2 and e2["mention_count"] >= 2:
                    confidence += 0.1

                confidence = min(confidence, 1.0)

                # Generate candidate ID
                candidate_id = f"dup_{e1['id']}_{e2['id']}"

                # Skip dismissed candidates
                if candidate_id in dismissed:
                    continue

                # Determine which entity should be canonical (more mentions)
                if e1["mention_count"] >= e2["mention_count"]:
                    canonical, merge_target = e1, e2
                else:
                    canonical, merge_target = e2, e1

                candidate = CurationCandidate(
                    id=candidate_id,
                    rubric="duplicate",
                    confidence=confidence,
                    entities=[canonical["id"], merge_target["id"]],
                    entity_names=[canonical["name"], merge_target["name"]],
                    suggested_action="merge",
                    reasoning=f"'{canonical['name']}' and '{merge_target['name']}' have {similarity:.0%} similarity and may refer to the same concept.",
                    evidence=[
                        {"type": "canonical", "entity_id": canonical["id"], "mention_count": canonical["mention_count"]},
                        {"type": "merge_target", "entity_id": merge_target["id"], "mention_count": merge_target["mention_count"]}
                    ]
                )
                candidates.append(candidate)

    # Sort by confidence descending
    candidates.sort(key=lambda c: -c.confidence)

    return candidates[:max_candidates]


# ============================================================================
# Missing Relationship Detection
# ============================================================================

def build_co_occurrence_matrix(entities: Dict, note_entities: Dict) -> Dict[str, Dict[str, int]]:
    """
    Build a co-occurrence matrix showing how often entities appear together.

    Returns:
        Dict mapping entity_id -> {other_entity_id: count}
    """
    co_occurrence = defaultdict(lambda: defaultdict(int))

    for note_key, entity_ids in note_entities.items():
        # Count co-occurrences for each pair in this note
        for i, e1 in enumerate(entity_ids):
            for e2 in entity_ids[i + 1:]:
                co_occurrence[e1][e2] += 1
                co_occurrence[e2][e1] += 1

    return co_occurrence


def find_missing_relationship_candidates(
    min_co_occurrence: int = 3,
    max_candidates: int = 50,
    model: Optional[str] = None
) -> List[CurationCandidate]:
    """
    Find entity pairs that co-occur frequently but have no existing relationship.

    Args:
        min_co_occurrence: Minimum number of co-occurrences to consider
        max_candidates: Maximum candidates to return
        model: Model for generating reasoning (optional, can be async)

    Returns:
        List of CurationCandidate objects for potential relationships
    """
    data = load_entities()
    curation_data = load_curation_data()

    entities = data.get("entities", {})
    note_entities = data.get("note_entities", {})
    relationships = data.get("entity_relationships", [])
    dismissed = set(curation_data.get("dismissed_candidates", []))

    # Build set of existing relationships
    existing_rels = set()
    for rel in relationships:
        pair = tuple(sorted([rel.get("source_entity_id"), rel.get("target_entity_id")]))
        existing_rels.add(pair)

    # Build co-occurrence matrix
    co_occurrence = build_co_occurrence_matrix(entities, note_entities)

    candidates = []

    for e1_id, co_occurrences in co_occurrence.items():
        e1 = entities.get(e1_id)
        if not e1:
            continue

        for e2_id, count in co_occurrences.items():
            if count < min_co_occurrence:
                continue

            e2 = entities.get(e2_id)
            if not e2:
                continue

            # Check if relationship already exists
            pair = tuple(sorted([e1_id, e2_id]))
            if pair in existing_rels:
                continue

            # Generate candidate ID
            candidate_id = f"rel_{e1_id}_{e2_id}"

            # Skip dismissed candidates
            if candidate_id in dismissed:
                continue

            # Skip if we already have this candidate (pairs are symmetric)
            if any(c.id == candidate_id for c in candidates):
                continue

            # Calculate confidence based on co-occurrence count
            # Higher co-occurrence = higher confidence
            confidence = min(0.3 + (count - min_co_occurrence) * 0.1, 0.9)

            # Boost if both entities have high mention counts
            e1_mentions = len(e1.get("mentions", []))
            e2_mentions = len(e2.get("mentions", []))
            if e1_mentions >= 3 and e2_mentions >= 3:
                confidence += 0.1
            confidence = min(confidence, 1.0)

            # Find shared notes for evidence
            shared_notes = []
            for note_key, entity_ids in note_entities.items():
                if e1_id in entity_ids and e2_id in entity_ids:
                    shared_notes.append(note_key)

            candidate = CurationCandidate(
                id=candidate_id,
                rubric="missing_relationship",
                confidence=confidence,
                entities=[e1_id, e2_id],
                entity_names=[e1.get("name", ""), e2.get("name", "")],
                suggested_action="create_relationship",
                reasoning=f"'{e1.get('name')}' and '{e2.get('name')}' appear together in {count} notes but have no relationship defined.",
                evidence=[{"shared_notes": shared_notes[:5], "co_occurrence_count": count}]
            )
            candidates.append(candidate)

    # Sort by confidence descending
    candidates.sort(key=lambda c: -c.confidence)

    return candidates[:max_candidates]


# ============================================================================
# Relationship Validation
# ============================================================================

def validate_existing_relationships(
    max_candidates: int = 50
) -> List[CurationCandidate]:
    """
    Find auto-generated relationships that may be suspect.

    Flags relationships that:
    - Are auto-generated and haven't been manually validated
    - Connect entities with low co-occurrence (may not be meaningful)
    - Have types that don't match entity types well

    Returns:
        List of CurationCandidate objects for suspect relationships
    """
    data = load_entities()
    curation_data = load_curation_data()

    entities = data.get("entities", {})
    note_entities = data.get("note_entities", {})
    relationships = data.get("entity_relationships", [])
    dismissed = set(curation_data.get("dismissed_candidates", []))

    # Build co-occurrence matrix for validation
    co_occurrence = build_co_occurrence_matrix(entities, note_entities)

    candidates = []

    for rel in relationships:
        # Only check auto-generated relationships
        if not rel.get("auto_generated", False):
            continue

        source_id = rel.get("source_entity_id")
        target_id = rel.get("target_entity_id")
        rel_type = rel.get("type")

        source = entities.get(source_id)
        target = entities.get(target_id)

        if not source or not target:
            continue

        candidate_id = f"suspect_{rel.get('id', 'unknown')}"

        # Skip dismissed candidates
        if candidate_id in dismissed:
            continue

        # Calculate suspicion score
        suspicion_score = 0.0
        reasons = []

        # Check co-occurrence
        co_count = co_occurrence.get(source_id, {}).get(target_id, 0)
        if co_count == 0:
            suspicion_score += 0.4
            reasons.append("entities never appear together in any note")
        elif co_count == 1:
            suspicion_score += 0.2
            reasons.append("entities only appear together once")

        # Check if relationship type makes sense for entity types
        source_type = source.get("type", "concept")
        target_type = target.get("type", "concept")

        # Some relationship-type combinations are questionable
        if rel_type == "created_by" and target_type != "person" and target_type != "organization":
            suspicion_score += 0.3
            reasons.append(f"'created_by' relationship targets a {target_type} instead of person/organization")

        if rel_type == "published_on" and target_type != "organization" and target_type != "publication":
            suspicion_score += 0.3
            reasons.append(f"'published_on' relationship targets a {target_type}")

        # Only flag if suspicion is high enough
        if suspicion_score < 0.3:
            continue

        confidence = min(suspicion_score, 1.0)

        candidate = CurationCandidate(
            id=candidate_id,
            rubric="suspect_relationship",
            confidence=confidence,
            entities=[source_id, target_id],
            entity_names=[source.get("name", ""), target.get("name", "")],
            suggested_action="review",
            reasoning=f"Relationship '{source.get('name')}' {rel_type} '{target.get('name')}' may be suspect: {'; '.join(reasons)}.",
            evidence=[{
                "relationship_id": rel.get("id"),
                "relationship_type": rel_type,
                "co_occurrence_count": co_count,
                "source_note": rel.get("source_note")
            }],
            relationship_type=rel_type
        )
        candidates.append(candidate)

    # Sort by confidence descending
    candidates.sort(key=lambda c: -c.confidence)

    return candidates[:max_candidates]


# ============================================================================
# Curation Session Management
# ============================================================================

def create_curation_session(
    rubrics: List[str] = None,
    threshold: float = 0.7,
    min_co_occurrence: int = 3
) -> CurationSession:
    """
    Create a new curation session with candidates from specified rubrics.

    Args:
        rubrics: List of rubrics to analyze ("duplicates", "missing", "suspect")
        threshold: Similarity threshold for duplicate detection
        min_co_occurrence: Minimum co-occurrence for relationship suggestions

    Returns:
        CurationSession with generated candidates
    """
    if rubrics is None:
        rubrics = ["duplicates", "missing", "suspect"]

    all_candidates = []

    if "duplicates" in rubrics:
        duplicates = find_duplicate_candidates(threshold=threshold)
        all_candidates.extend(duplicates)
        logger.info(f"Found {len(duplicates)} duplicate candidates")

    if "missing" in rubrics:
        missing = find_missing_relationship_candidates(min_co_occurrence=min_co_occurrence)
        all_candidates.extend(missing)
        logger.info(f"Found {len(missing)} missing relationship candidates")

    if "suspect" in rubrics:
        suspect = validate_existing_relationships()
        all_candidates.extend(suspect)
        logger.info(f"Found {len(suspect)} suspect relationship candidates")

    # Create session
    session = CurationSession(
        id=str(uuid.uuid4())[:8],
        candidates=all_candidates
    )

    # Save session
    curation_data = load_curation_data()
    curation_data["sessions"][session.id] = session.to_dict()
    save_curation_data(curation_data)

    return session


def get_curation_session(session_id: str) -> Optional[CurationSession]:
    """Get a curation session by ID."""
    curation_data = load_curation_data()
    session_data = curation_data.get("sessions", {}).get(session_id)

    if not session_data:
        return None

    return CurationSession(
        id=session_data["id"],
        candidates=[CurationCandidate(**c) for c in session_data.get("candidates", [])],
        reviewed=session_data.get("reviewed", []),
        created_at=session_data.get("created_at", "")
    )


def list_curation_sessions(limit: int = 20) -> List[Dict[str, Any]]:
    """List recent curation sessions."""
    curation_data = load_curation_data()
    sessions = []

    for session_id, session_data in curation_data.get("sessions", {}).items():
        sessions.append({
            "id": session_id,
            "candidate_count": len(session_data.get("candidates", [])),
            "reviewed_count": len(session_data.get("reviewed", [])),
            "created_at": session_data.get("created_at", "")
        })

    # Sort by created_at descending
    sessions.sort(key=lambda s: s.get("created_at", ""), reverse=True)

    return sessions[:limit]


# ============================================================================
# Curation Action Execution
# ============================================================================

def execute_merge(
    canonical_id: str,
    merge_ids: List[str],
    candidate_id: Optional[str] = None
) -> Dict[str, Any]:
    """
    Execute a merge action: combine entities into a canonical one.

    Args:
        canonical_id: The entity ID to keep
        merge_ids: List of entity IDs to merge into the canonical
        candidate_id: Optional curation candidate ID to mark as reviewed

    Returns:
        Updated canonical entity
    """
    from .knowledge_graph import merge_entities

    result = merge_entities(canonical_id, merge_ids)

    # Record in history
    curation_data = load_curation_data()
    curation_data["history"].append({
        "timestamp": datetime.utcnow().isoformat(),
        "action": "merge",
        "candidate_id": candidate_id,
        "canonical_id": canonical_id,
        "merged_ids": merge_ids,
        "result_entity": canonical_id
    })

    # Mark candidate as reviewed if provided
    if candidate_id:
        for session_id, session_data in curation_data.get("sessions", {}).items():
            if candidate_id not in session_data.get("reviewed", []):
                session_data["reviewed"].append(candidate_id)

    save_curation_data(curation_data)

    return result


def execute_create_relationship(
    source_id: str,
    target_id: str,
    relationship_type: str,
    candidate_id: Optional[str] = None
) -> Dict[str, Any]:
    """
    Execute a create relationship action.

    Args:
        source_id: Source entity ID
        target_id: Target entity ID
        relationship_type: Type of relationship
        candidate_id: Optional curation candidate ID to mark as reviewed

    Returns:
        Created relationship
    """
    if relationship_type not in VALID_RELATIONSHIP_TYPES:
        return {"error": f"Invalid relationship type: {relationship_type}"}

    data = load_entities()
    entities = data.get("entities", {})
    relationships = data.get("entity_relationships", [])

    source = entities.get(source_id)
    target = entities.get(target_id)

    if not source or not target:
        return {"error": "Entity not found"}

    # Check if relationship already exists
    for rel in relationships:
        if (rel.get("source_entity_id") == source_id and
            rel.get("target_entity_id") == target_id and
            rel.get("type") == relationship_type):
            return {"error": "Relationship already exists"}

    # Create relationship
    rel_id = f"rel_cur_{uuid.uuid4().hex[:8]}"
    relationship = {
        "id": rel_id,
        "source_entity_id": source_id,
        "target_entity_id": target_id,
        "source_entity_name": source.get("name", ""),
        "target_entity_name": target.get("name", ""),
        "type": relationship_type,
        "bidirectional": relationship_type == "contrasts_with",
        "source_note": None,
        "manually_created": True
    }

    relationships.append(relationship)
    data["entity_relationships"] = relationships
    save_entities(data)

    # Record in history
    curation_data = load_curation_data()
    curation_data["history"].append({
        "timestamp": datetime.utcnow().isoformat(),
        "action": "create_relationship",
        "candidate_id": candidate_id,
        "relationship": relationship
    })

    # Mark candidate as reviewed if provided
    if candidate_id:
        for session_id, session_data in curation_data.get("sessions", {}).items():
            if candidate_id not in session_data.get("reviewed", []):
                session_data["reviewed"].append(candidate_id)

    save_curation_data(curation_data)

    return relationship


def execute_delete_relationship(
    relationship_id: str,
    candidate_id: Optional[str] = None
) -> Dict[str, Any]:
    """
    Execute a delete relationship action.

    Args:
        relationship_id: ID of the relationship to delete
        candidate_id: Optional curation candidate ID to mark as reviewed

    Returns:
        Deleted relationship
    """
    data = load_entities()
    relationships = data.get("entity_relationships", [])

    # Find and remove relationship
    deleted = None
    remaining = []
    for rel in relationships:
        if rel.get("id") == relationship_id:
            deleted = rel
        else:
            remaining.append(rel)

    if not deleted:
        return {"error": "Relationship not found"}

    data["entity_relationships"] = remaining
    save_entities(data)

    # Record in history
    curation_data = load_curation_data()
    curation_data["history"].append({
        "timestamp": datetime.utcnow().isoformat(),
        "action": "delete_relationship",
        "candidate_id": candidate_id,
        "relationship": deleted
    })

    # Mark candidate as reviewed if provided
    if candidate_id:
        for session_id, session_data in curation_data.get("sessions", {}).items():
            if candidate_id not in session_data.get("reviewed", []):
                session_data["reviewed"].append(candidate_id)

    save_curation_data(curation_data)

    return deleted


def dismiss_candidate(candidate_id: str) -> Dict[str, Any]:
    """
    Dismiss a curation candidate (won't be suggested again).

    Args:
        candidate_id: ID of the candidate to dismiss

    Returns:
        Success status
    """
    curation_data = load_curation_data()

    if candidate_id not in curation_data.get("dismissed_candidates", []):
        curation_data["dismissed_candidates"].append(candidate_id)

    # Also mark as reviewed in any sessions
    for session_id, session_data in curation_data.get("sessions", {}).items():
        if candidate_id not in session_data.get("reviewed", []):
            session_data["reviewed"].append(candidate_id)

    # Record in history
    curation_data["history"].append({
        "timestamp": datetime.utcnow().isoformat(),
        "action": "dismiss",
        "candidate_id": candidate_id
    })

    save_curation_data(curation_data)

    return {"success": True, "candidate_id": candidate_id}


def get_curation_history(limit: int = 50) -> List[Dict[str, Any]]:
    """Get recent curation action history."""
    curation_data = load_curation_data()
    history = curation_data.get("history", [])

    # Sort by timestamp descending and limit
    history.sort(key=lambda h: h.get("timestamp", ""), reverse=True)

    return history[:limit]


# ============================================================================
# LLM-Enhanced Curation (Optional)
# ============================================================================

DUPLICATE_REASONING_PROMPT = """Analyze whether these two entities should be merged.

Entity A: "{entity_a_name}" (type: {entity_a_type})
Entity B: "{entity_b_name}" (type: {entity_b_type})

Provide a brief (1-2 sentence) analysis of whether these refer to the same concept
and if merging is appropriate. Consider synonyms, abbreviations, and naming variations.

Return ONLY a JSON object:
{{"should_merge": true/false, "reasoning": "explanation", "confidence": 0.0-1.0}}"""


async def enhance_duplicate_reasoning(
    entity_a: Dict[str, Any],
    entity_b: Dict[str, Any],
    model: Optional[str] = None
) -> Dict[str, Any]:
    """
    Use LLM to generate enhanced reasoning for a duplicate candidate.

    Args:
        entity_a: First entity
        entity_b: Second entity
        model: Model to use (defaults to settings)

    Returns:
        Enhanced reasoning and confidence
    """
    if model is None:
        model = get_knowledge_graph_model()

    prompt = DUPLICATE_REASONING_PROMPT.format(
        entity_a_name=entity_a.get("name", ""),
        entity_a_type=entity_a.get("type", "concept"),
        entity_b_name=entity_b.get("name", ""),
        entity_b_type=entity_b.get("type", "concept")
    )

    messages = [{"role": "user", "content": prompt}]

    try:
        response = await query_model(model, messages, timeout=30.0)

        if response is None:
            return {}

        import re
        content = response.get("content", "").strip()

        # Parse JSON from response
        if content.startswith("```"):
            content = re.sub(r'^```(?:json)?\n?', '', content)
            content = re.sub(r'\n?```$', '', content)

        return json.loads(content)

    except Exception as e:
        logger.warning(f"Failed to get LLM duplicate reasoning: {e}")
        return {}


RELATIONSHIP_SUGGESTION_PROMPT = """Suggest the most appropriate relationship type between these entities.

Entity A: "{entity_a_name}" (type: {entity_a_type})
Entity B: "{entity_b_name}" (type: {entity_b_type})

Context: These entities appear together in {co_occurrence_count} notes.

Available relationship types:
- specialization_of: A is a specific form of B
- enabled_by: A is powered by or depends on B
- builds_on: A extends or is built upon B
- contrasts_with: A is an alternative or opposite of B
- applies_to: A is used in or applies to B
- created_by: A was created by B
- published_on: A was published on/by B

Return ONLY a JSON object:
{{"relationship_type": "type_name", "reasoning": "why this relationship", "confidence": 0.0-1.0}}"""


async def suggest_relationship_type(
    entity_a: Dict[str, Any],
    entity_b: Dict[str, Any],
    co_occurrence_count: int,
    model: Optional[str] = None
) -> Dict[str, Any]:
    """
    Use LLM to suggest the best relationship type between two entities.

    Args:
        entity_a: First entity
        entity_b: Second entity
        co_occurrence_count: How often they appear together
        model: Model to use (defaults to settings)

    Returns:
        Suggested relationship type and reasoning
    """
    if model is None:
        model = get_knowledge_graph_model()

    prompt = RELATIONSHIP_SUGGESTION_PROMPT.format(
        entity_a_name=entity_a.get("name", ""),
        entity_a_type=entity_a.get("type", "concept"),
        entity_b_name=entity_b.get("name", ""),
        entity_b_type=entity_b.get("type", "concept"),
        co_occurrence_count=co_occurrence_count
    )

    messages = [{"role": "user", "content": prompt}]

    try:
        response = await query_model(model, messages, timeout=30.0)

        if response is None:
            return {}

        import re
        content = response.get("content", "").strip()

        # Parse JSON from response
        if content.startswith("```"):
            content = re.sub(r'^```(?:json)?\n?', '', content)
            content = re.sub(r'\n?```$', '', content)

        return json.loads(content)

    except Exception as e:
        logger.warning(f"Failed to get LLM relationship suggestion: {e}")
        return {}
