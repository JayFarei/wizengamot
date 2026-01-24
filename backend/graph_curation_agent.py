"""Agentic curation system using LLM-powered semantic reasoning.

This module replaces fuzzy similarity-based curation with LLM reasoning
that can distinguish between:
- SAME: Identical concept, naming variation (should merge)
- RELATED: Distinct but connected concepts (should link, not merge)
- UNRELATED: False positive from fuzzy matching (should dismiss)

The key insight: "Bitter Lesson" and "Bitter Lesson - Compute Scaling" are
92% similar lexically but are DISTINCT concepts that should be LINKED,
not merged.
"""

import json
import re
import uuid
import logging
from datetime import datetime
from dataclasses import dataclass, field, asdict
from typing import List, Dict, Any, Optional, Tuple

from .openrouter import query_model
from .settings import get_knowledge_graph_model
from .knowledge_graph import (
    load_entities,
    save_entities,
    load_manual_links,
    save_manual_links,
    VALID_RELATIONSHIP_TYPES
)
from .graph_curation import (
    load_curation_data,
    save_curation_data,
    calculate_lexical_similarity,
    normalize_for_comparison,
    CurationCandidate,
)

logger = logging.getLogger(__name__)


@dataclass
class AgentDecision:
    """Result of LLM analysis for an entity pair."""
    decision: str  # "same", "related", "unrelated"
    confidence: float  # 0.0-1.0
    reasoning: str
    relationship_type: Optional[str] = None  # For "related" decisions
    relationship_direction: Optional[str] = None  # "a_to_b", "b_to_a", "bidirectional"

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class EnhancedCurationCandidate(CurationCandidate):
    """Extended candidate with agent analysis."""
    agent_decision: Optional[Dict[str, Any]] = None
    agent_reasoning: Optional[str] = None
    agent_confidence: Optional[float] = None
    suggested_relationship_type: Optional[str] = None
    suggested_relationship_direction: Optional[str] = None
    shared_contexts: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        base = super().to_dict()
        base.update({
            "agent_decision": self.agent_decision,
            "agent_reasoning": self.agent_reasoning,
            "agent_confidence": self.agent_confidence,
            "suggested_relationship_type": self.suggested_relationship_type,
            "suggested_relationship_direction": self.suggested_relationship_direction,
            "shared_contexts": self.shared_contexts,
        })
        return base


# Prompt for three-way entity classification
ENTITY_ANALYSIS_PROMPT = """Analyze these two entities from a knowledge graph:

Entity A: "{entity_a_name}" (type: {entity_a_type})
  - Appears in {entity_a_mentions} notes
  - Sample contexts: {entity_a_contexts}

Entity B: "{entity_b_name}" (type: {entity_b_type})
  - Appears in {entity_b_mentions} notes
  - Sample contexts: {entity_b_contexts}

{shared_context_section}

{existing_relationships_section}

QUESTION: Are these the SAME concept (just named differently), RELATED but distinct concepts, or UNRELATED (false positive)?

DECISION CRITERIA:
1. SAME - These refer to the identical concept with naming variations
   - Examples: "OpenAI" vs "Open AI", "ML" vs "Machine Learning"
   - Impact: Merging would HELP retrieval by consolidating mentions

2. RELATED - These are distinct concepts that have a meaningful connection
   - Examples: "Bitter Lesson" vs "Bitter Lesson - Compute Scaling" (second is specific aspect)
   - Examples: "Transformer" vs "BERT" (BERT builds on Transformer)
   - Impact: Should create a relationship link, NOT merge

3. UNRELATED - These are different concepts, similarity is coincidental
   - Examples: "Apple" (company) vs "Apple" (fruit) in wrong context
   - Impact: Should dismiss this candidate

RELATIONSHIP TYPES (if RELATED):
- specialization_of: B is a specific form/type of A
- enabled_by: B is powered by or depends on A
- builds_on: B extends or is built upon A
- contrasts_with: B is an alternative or opposite of A
- applies_to: B is used in or applies to A
- created_by: B was created by A

RETRIEVAL CONSIDERATION:
If merged: User searching for "{entity_a_name}" would find all {total_mentions} notes.
If linked: User could navigate from A to B to discover related content.
Which serves knowledge retrieval better?

Respond in JSON format ONLY (no other text):
{{
    "decision": "same|related|unrelated",
    "confidence": 0.0-1.0,
    "reasoning": "Brief explanation (1-2 sentences)",
    "relationship_type": "type_name or null",
    "relationship_direction": "a_to_b|b_to_a|bidirectional or null"
}}"""


def get_entity_contexts(entity: Dict[str, Any], max_contexts: int = 3) -> List[str]:
    """Extract sample contexts from entity mentions."""
    contexts = []
    mentions = entity.get("mentions", [])

    for mention in mentions[:max_contexts]:
        context = mention.get("context", "").strip()
        if context:
            # Truncate long contexts
            if len(context) > 150:
                context = context[:147] + "..."
            contexts.append(context)

    return contexts


def format_contexts_for_prompt(contexts: List[str]) -> str:
    """Format contexts for display in prompt."""
    if not contexts:
        return "(no context available)"
    return "; ".join(f'"{c}"' for c in contexts)


def find_shared_notes(
    entity_a_id: str,
    entity_b_id: str,
    note_entities: Dict[str, List[str]]
) -> List[str]:
    """Find notes that mention both entities."""
    shared = []
    for note_key, entity_ids in note_entities.items():
        if entity_a_id in entity_ids and entity_b_id in entity_ids:
            shared.append(note_key)
    return shared


def get_existing_relationships_for_entity(
    entity_id: str,
    relationships: List[Dict[str, Any]],
    entities: Dict[str, Any]
) -> List[Dict[str, Any]]:
    """Get existing relationships involving an entity."""
    relevant = []
    for rel in relationships:
        if rel.get("source_entity_id") == entity_id or rel.get("target_entity_id") == entity_id:
            relevant.append({
                "source": rel.get("source_entity_name", ""),
                "target": rel.get("target_entity_name", ""),
                "type": rel.get("type", ""),
            })
    return relevant[:5]  # Limit for prompt context


async def analyze_entity_pair(
    entity_a: Dict[str, Any],
    entity_b: Dict[str, Any],
    shared_notes: List[str] = None,
    existing_relationships: List[Dict[str, Any]] = None,
    model: Optional[str] = None
) -> AgentDecision:
    """
    Use LLM to determine relationship between two similar entities.

    Returns:
        AgentDecision with classification (same/related/unrelated)
    """
    if model is None:
        model = get_knowledge_graph_model()

    # Get contexts for each entity
    a_contexts = get_entity_contexts(entity_a)
    b_contexts = get_entity_contexts(entity_b)

    # Build shared context section
    shared_context_section = ""
    if shared_notes:
        shared_context_section = f"\nSHARED NOTES: These entities appear together in {len(shared_notes)} notes."

    # Build existing relationships section
    existing_rels_section = ""
    if existing_relationships:
        rels_text = "\n".join(
            f"  - {r['source']} {r['type']} {r['target']}"
            for r in existing_relationships[:5]
        )
        existing_rels_section = f"\nEXISTING RELATIONSHIPS in graph:\n{rels_text}"

    # Calculate total mentions for retrieval consideration
    a_mentions = len(entity_a.get("mentions", []))
    b_mentions = len(entity_b.get("mentions", []))
    total_mentions = a_mentions + b_mentions

    prompt = ENTITY_ANALYSIS_PROMPT.format(
        entity_a_name=entity_a.get("name", ""),
        entity_a_type=entity_a.get("type", "concept"),
        entity_a_mentions=a_mentions,
        entity_a_contexts=format_contexts_for_prompt(a_contexts),
        entity_b_name=entity_b.get("name", ""),
        entity_b_type=entity_b.get("type", "concept"),
        entity_b_mentions=b_mentions,
        entity_b_contexts=format_contexts_for_prompt(b_contexts),
        shared_context_section=shared_context_section,
        existing_relationships_section=existing_rels_section,
        total_mentions=total_mentions,
    )

    messages = [{"role": "user", "content": prompt}]

    try:
        response = await query_model(model, messages, timeout=30.0)

        if response is None:
            logger.warning("No response from model for entity pair analysis")
            return _fallback_decision(entity_a, entity_b)

        content = response.get("content", "").strip()

        # Parse JSON from response
        if content.startswith("```"):
            content = re.sub(r'^```(?:json)?\n?', '', content)
            content = re.sub(r'\n?```$', '', content)

        result = json.loads(content)

        # Validate decision
        decision = result.get("decision", "").lower()
        if decision not in ("same", "related", "unrelated"):
            logger.warning(f"Invalid decision '{decision}', using fallback")
            return _fallback_decision(entity_a, entity_b)

        # Validate relationship type if related
        rel_type = result.get("relationship_type")
        if decision == "related" and rel_type and rel_type not in VALID_RELATIONSHIP_TYPES:
            rel_type = "related"  # Default to generic

        return AgentDecision(
            decision=decision,
            confidence=min(max(float(result.get("confidence", 0.5)), 0.0), 1.0),
            reasoning=result.get("reasoning", "No reasoning provided"),
            relationship_type=rel_type if decision == "related" else None,
            relationship_direction=result.get("relationship_direction") if decision == "related" else None,
        )

    except json.JSONDecodeError as e:
        logger.warning(f"Failed to parse agent response: {e}")
        return _fallback_decision(entity_a, entity_b)
    except Exception as e:
        logger.error(f"Error in entity pair analysis: {e}")
        return _fallback_decision(entity_a, entity_b)


def _fallback_decision(entity_a: Dict[str, Any], entity_b: Dict[str, Any]) -> AgentDecision:
    """
    Fallback to lexical similarity when LLM is unavailable.
    Uses stricter thresholds than before to avoid false merges.
    """
    name_a = entity_a.get("name", "").lower()
    name_b = entity_b.get("name", "").lower()

    # Exact match (including spacing variations)
    if name_a.replace(" ", "") == name_b.replace(" ", ""):
        return AgentDecision(
            decision="same",
            confidence=0.95,
            reasoning="Names are identical (ignoring spacing)",
        )

    # One is substring of other - likely RELATED not SAME
    if name_a in name_b or name_b in name_a:
        return AgentDecision(
            decision="related",
            confidence=0.6,
            reasoning="One entity name contains the other, likely a specialization",
            relationship_type="specialization_of",
            relationship_direction="b_to_a" if name_a in name_b else "a_to_b",
        )

    # High similarity but not identical - conservative approach
    similarity = calculate_lexical_similarity(name_a, name_b)
    if similarity >= 0.95:
        return AgentDecision(
            decision="same",
            confidence=similarity * 0.8,
            reasoning=f"Very high lexical similarity ({similarity:.0%})",
        )
    elif similarity >= 0.7:
        # Previously this would suggest merge, now we're more conservative
        return AgentDecision(
            decision="related",
            confidence=0.5,
            reasoning=f"Moderate lexical similarity ({similarity:.0%}), needs manual review",
            relationship_type=None,  # User should choose
        )

    return AgentDecision(
        decision="unrelated",
        confidence=0.4,
        reasoning="Insufficient similarity for automatic classification",
    )


async def analyze_duplicate_candidates_with_agent(
    candidates: List[CurationCandidate],
    model: Optional[str] = None,
    batch_size: int = 10
) -> List[EnhancedCurationCandidate]:
    """
    Enhance duplicate candidates with LLM analysis.

    Processes candidates in batches, building context as decisions are made.

    Args:
        candidates: List of CurationCandidate objects from find_duplicate_candidates
        model: Model to use for analysis
        batch_size: Number of candidates per batch

    Returns:
        List of EnhancedCurationCandidate with agent decisions
    """
    if model is None:
        model = get_knowledge_graph_model()

    data = load_entities()
    entities = data.get("entities", {})
    note_entities = data.get("note_entities", {})
    relationships = data.get("entity_relationships", [])

    enhanced_candidates = []
    decided_relationships = []  # Track for context in subsequent decisions

    for candidate in candidates:
        if len(candidate.entities) < 2:
            continue

        entity_a_id = candidate.entities[0]
        entity_b_id = candidate.entities[1]

        entity_a = entities.get(entity_a_id, {})
        entity_b = entities.get(entity_b_id, {})

        if not entity_a or not entity_b:
            continue

        # Find shared notes
        shared_notes = find_shared_notes(entity_a_id, entity_b_id, note_entities)

        # Get existing relationships for context
        existing_rels = (
            get_existing_relationships_for_entity(entity_a_id, relationships, entities) +
            get_existing_relationships_for_entity(entity_b_id, relationships, entities)
        )

        # Add recently decided relationships for context
        existing_rels.extend(decided_relationships[-5:])

        # Analyze with agent
        decision = await analyze_entity_pair(
            entity_a,
            entity_b,
            shared_notes=shared_notes,
            existing_relationships=existing_rels,
            model=model,
        )

        # Create enhanced candidate
        enhanced = EnhancedCurationCandidate(
            id=candidate.id,
            rubric=candidate.rubric,
            confidence=decision.confidence,  # Override with agent confidence
            entities=candidate.entities,
            entity_names=candidate.entity_names,
            suggested_action=_map_decision_to_action(decision),
            reasoning=decision.reasoning,
            evidence=candidate.evidence,
            relationship_type=decision.relationship_type,
            created_at=candidate.created_at,
            agent_decision=decision.to_dict(),
            agent_reasoning=decision.reasoning,
            agent_confidence=decision.confidence,
            suggested_relationship_type=decision.relationship_type,
            suggested_relationship_direction=decision.relationship_direction,
            shared_contexts=[],  # Could populate from shared notes
        )

        enhanced_candidates.append(enhanced)

        # Track relationship decisions for context
        if decision.decision == "related" and decision.relationship_type:
            decided_relationships.append({
                "source": entity_a.get("name", ""),
                "target": entity_b.get("name", ""),
                "type": decision.relationship_type,
            })

    return enhanced_candidates


def _map_decision_to_action(decision: AgentDecision) -> str:
    """Map agent decision to suggested action."""
    if decision.decision == "same":
        return "merge"
    elif decision.decision == "related":
        return "create_relationship"
    else:
        return "dismiss"


# =============================================================================
# Decision Tracking for Learning Loop
# =============================================================================

def get_decision_history_path() -> str:
    """Get path to decision history file."""
    from pathlib import Path
    from .graph_curation import CURATION_DIR
    return str(Path(CURATION_DIR) / "agent_decisions.json")


def load_decision_history() -> Dict[str, Any]:
    """Load agent decision history."""
    import os
    from pathlib import Path
    from .graph_curation import ensure_curation_dir

    ensure_curation_dir()
    path = get_decision_history_path()

    if os.path.exists(path):
        with open(path, 'r') as f:
            return json.load(f)

    return {
        "decisions": [],
        "accuracy_stats": {
            "total": 0,
            "agreements": 0,
            "overrides": 0,
            "by_decision_type": {
                "same": {"total": 0, "agreed": 0},
                "related": {"total": 0, "agreed": 0},
                "unrelated": {"total": 0, "agreed": 0},
            }
        },
        "updated_at": None
    }


def save_decision_history(data: Dict[str, Any]):
    """Save agent decision history."""
    data["updated_at"] = datetime.utcnow().isoformat()
    path = get_decision_history_path()
    with open(path, 'w') as f:
        json.dump(data, f, indent=2)


def record_decision_outcome(
    candidate_id: str,
    agent_decision: str,
    agent_reasoning: str,
    user_action: str,
    user_override_reason: Optional[str] = None
):
    """
    Record whether user agreed with agent's decision.

    Args:
        candidate_id: The curation candidate ID
        agent_decision: What the agent suggested (same/related/unrelated)
        agent_reasoning: Agent's reasoning
        user_action: What the user actually did (merge/create_relationship/dismiss)
        user_override_reason: If user disagreed, why
    """
    history = load_decision_history()

    # Map user action to decision type
    user_decision = {
        "merge": "same",
        "create_relationship": "related",
        "dismiss": "unrelated",
    }.get(user_action, user_action)

    agreed = (agent_decision == user_decision)

    # Record individual decision
    history["decisions"].append({
        "timestamp": datetime.utcnow().isoformat(),
        "candidate_id": candidate_id,
        "agent_decision": agent_decision,
        "agent_reasoning": agent_reasoning,
        "user_action": user_action,
        "user_decision": user_decision,
        "agreed": agreed,
        "override_reason": user_override_reason,
    })

    # Keep only last 1000 decisions
    if len(history["decisions"]) > 1000:
        history["decisions"] = history["decisions"][-1000:]

    # Update accuracy stats
    stats = history["accuracy_stats"]
    stats["total"] += 1
    if agreed:
        stats["agreements"] += 1
    else:
        stats["overrides"] += 1

    # Update per-type stats
    type_stats = stats["by_decision_type"].get(agent_decision, {"total": 0, "agreed": 0})
    type_stats["total"] += 1
    if agreed:
        type_stats["agreed"] += 1
    stats["by_decision_type"][agent_decision] = type_stats

    save_decision_history(history)


def get_agent_accuracy_stats() -> Dict[str, Any]:
    """Get agent accuracy statistics."""
    history = load_decision_history()
    stats = history.get("accuracy_stats", {})

    total = stats.get("total", 0)
    agreements = stats.get("agreements", 0)

    accuracy = agreements / total if total > 0 else 0.0

    # Per-type accuracy
    type_accuracy = {}
    for decision_type, type_stats in stats.get("by_decision_type", {}).items():
        type_total = type_stats.get("total", 0)
        type_agreed = type_stats.get("agreed", 0)
        type_accuracy[decision_type] = {
            "total": type_total,
            "agreed": type_agreed,
            "accuracy": type_agreed / type_total if type_total > 0 else 0.0,
        }

    return {
        "total_decisions": total,
        "agreements": agreements,
        "overrides": stats.get("overrides", 0),
        "overall_accuracy": accuracy,
        "by_decision_type": type_accuracy,
    }


# =============================================================================
# Integration with Existing Curation System
# =============================================================================

async def find_duplicate_candidates_with_agent(
    threshold: float = 0.7,
    max_candidates: int = 50,
    model: Optional[str] = None
) -> List[EnhancedCurationCandidate]:
    """
    Find duplicate candidates and enhance with LLM analysis.

    This replaces the simple fuzzy matching with semantic reasoning.
    """
    from .graph_curation import find_duplicate_candidates

    # First get candidates using lexical similarity
    base_candidates = find_duplicate_candidates(threshold=threshold, max_candidates=max_candidates * 2)

    # Then enhance with agent analysis
    enhanced = await analyze_duplicate_candidates_with_agent(
        base_candidates[:max_candidates],
        model=model,
    )

    # Sort by agent confidence
    enhanced.sort(key=lambda c: -c.agent_confidence if c.agent_confidence else 0)

    return enhanced[:max_candidates]
