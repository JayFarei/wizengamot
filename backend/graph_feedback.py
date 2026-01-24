"""Knowledge Graph Feedback Learning.

This module tracks and analyzes user correction patterns to improve
future entity and relationship extraction quality.

Features:
- Correction pattern analysis for entities and relationships
- Extraction confidence calibration (accuracy vs stated confidence)
- Rejection reason analysis
- Prompt refinement recommendations
"""

import json
import os
import logging
from datetime import datetime, timedelta
from typing import Dict, Any, List, Optional, Tuple
from collections import defaultdict
from pathlib import Path

from .knowledge_graph import load_entities, save_entities

logger = logging.getLogger(__name__)

# Data directory for feedback data
DATA_DIR = os.environ.get("DATA_DIR", "data")
FEEDBACK_DIR = os.path.join(DATA_DIR, "feedback")


def ensure_feedback_dir():
    """Ensure the feedback directory exists."""
    os.makedirs(FEEDBACK_DIR, exist_ok=True)


def get_feedback_path() -> str:
    """Get the path to the feedback data file."""
    return os.path.join(FEEDBACK_DIR, "feedback_data.json")


def load_feedback_data() -> Dict[str, Any]:
    """Load feedback data from storage."""
    ensure_feedback_dir()
    path = get_feedback_path()

    if os.path.exists(path):
        with open(path, 'r') as f:
            return json.load(f)

    return {
        "entity_corrections": [],
        "relationship_corrections": [],
        "decision_outcomes": [],  # For agentic structure review
        "updated_at": None,
    }


def save_feedback_data(data: Dict[str, Any]):
    """Save feedback data to storage."""
    ensure_feedback_dir()
    data["updated_at"] = datetime.utcnow().isoformat()

    path = get_feedback_path()
    with open(path, 'w') as f:
        json.dump(data, f, indent=2)


# =============================================================================
# Feedback Recording
# =============================================================================

def record_entity_correction(
    entity_id: str,
    action: str,  # "validate", "correct", "reject"
    original_name: Optional[str] = None,
    original_type: Optional[str] = None,
    corrected_name: Optional[str] = None,
    corrected_type: Optional[str] = None,
    rejection_reason: Optional[str] = None,
    extraction_confidence: Optional[float] = None,
    extraction_model: Optional[str] = None,
):
    """
    Record an entity validation/correction for learning.

    Args:
        entity_id: The entity ID
        action: The action taken (validate, correct, reject)
        original_name: Original entity name
        original_type: Original entity type
        corrected_name: Corrected name (for corrections)
        corrected_type: Corrected type (for corrections)
        rejection_reason: Reason for rejection
        extraction_confidence: LLM's stated confidence
        extraction_model: Model used for extraction
    """
    feedback_data = load_feedback_data()

    correction = {
        "entity_id": entity_id,
        "action": action,
        "original_name": original_name,
        "original_type": original_type,
        "corrected_name": corrected_name,
        "corrected_type": corrected_type,
        "rejection_reason": rejection_reason,
        "extraction_confidence": extraction_confidence,
        "extraction_model": extraction_model,
        "recorded_at": datetime.utcnow().isoformat(),
    }

    feedback_data["entity_corrections"].append(correction)
    save_feedback_data(feedback_data)

    return correction


def record_relationship_correction(
    relationship_id: str,
    action: str,  # "validate", "correct_type", "reject"
    original_type: Optional[str] = None,
    corrected_type: Optional[str] = None,
    rejection_reason: Optional[str] = None,
    source_entity_name: Optional[str] = None,
    target_entity_name: Optional[str] = None,
):
    """
    Record a relationship validation/correction for learning.

    Args:
        relationship_id: The relationship ID
        action: The action taken (validate, correct_type, reject)
        original_type: Original relationship type
        corrected_type: Corrected type (for type corrections)
        rejection_reason: Reason for rejection
        source_entity_name: Source entity name (for context)
        target_entity_name: Target entity name (for context)
    """
    feedback_data = load_feedback_data()

    correction = {
        "relationship_id": relationship_id,
        "action": action,
        "original_type": original_type,
        "corrected_type": corrected_type,
        "rejection_reason": rejection_reason,
        "source_entity_name": source_entity_name,
        "target_entity_name": target_entity_name,
        "recorded_at": datetime.utcnow().isoformat(),
    }

    feedback_data["relationship_corrections"].append(correction)
    save_feedback_data(feedback_data)

    return correction


def record_curation_decision(
    candidate_id: str,
    agent_decision: str,  # "same", "related", "unrelated"
    user_action: str,  # "accept", "override_merge", "override_link", "dismiss"
    entity_a_name: str,
    entity_b_name: str,
    agent_confidence: Optional[float] = None,
    override_reason: Optional[str] = None,
):
    """
    Record a structure review decision for learning.

    Tracks whether user agreed with agent's decision for same/related/unrelated.

    Args:
        candidate_id: The curation candidate ID
        agent_decision: What the agent suggested
        user_action: What the user actually did
        entity_a_name: First entity name
        entity_b_name: Second entity name
        agent_confidence: Agent's confidence in decision
        override_reason: Reason for override if user disagreed
    """
    feedback_data = load_feedback_data()

    outcome = {
        "candidate_id": candidate_id,
        "agent_decision": agent_decision,
        "user_action": user_action,
        "user_agreed": user_action == "accept",
        "entity_a_name": entity_a_name,
        "entity_b_name": entity_b_name,
        "agent_confidence": agent_confidence,
        "override_reason": override_reason,
        "recorded_at": datetime.utcnow().isoformat(),
    }

    feedback_data["decision_outcomes"].append(outcome)
    save_feedback_data(feedback_data)

    return outcome


# =============================================================================
# Pattern Analysis
# =============================================================================

def analyze_correction_patterns() -> Dict[str, Any]:
    """
    Analyze patterns in user corrections to identify systematic issues.

    Returns:
        Dict with patterns for entity corrections, relationship rejections,
        and confidence accuracy.
    """
    feedback_data = load_feedback_data()
    entity_corrections = feedback_data.get("entity_corrections", [])
    relationship_corrections = feedback_data.get("relationship_corrections", [])

    # Analyze entity corrections by type
    entity_patterns = defaultdict(lambda: {
        "total": 0,
        "validated": 0,
        "corrected": 0,
        "rejected": 0,
        "common_corrections": defaultdict(int),
        "common_rejections": defaultdict(int),
    })

    for corr in entity_corrections:
        orig_type = corr.get("original_type") or "unknown"
        action = corr.get("action")
        pattern = entity_patterns[orig_type]

        pattern["total"] += 1
        pattern[action] = pattern.get(action, 0) + 1

        # Track correction patterns
        if action == "correct":
            # Name correction pattern
            orig_name = corr.get("original_name", "")
            corr_name = corr.get("corrected_name", "")
            if orig_name and corr_name:
                correction_type = _classify_name_correction(orig_name, corr_name)
                pattern["common_corrections"][correction_type] += 1

            # Type correction pattern
            corr_type = corr.get("corrected_type")
            if corr_type and corr_type != orig_type:
                pattern["common_corrections"][f"type:{orig_type}->{corr_type}"] += 1

        # Track rejection reasons
        if action == "reject":
            reason = corr.get("rejection_reason") or "unspecified"
            pattern["common_rejections"][reason] += 1

    # Convert defaultdicts to regular dicts
    for type_key in entity_patterns:
        entity_patterns[type_key]["common_corrections"] = dict(
            sorted(entity_patterns[type_key]["common_corrections"].items(),
                   key=lambda x: -x[1])[:5]
        )
        entity_patterns[type_key]["common_rejections"] = dict(
            sorted(entity_patterns[type_key]["common_rejections"].items(),
                   key=lambda x: -x[1])[:5]
        )

    # Analyze relationship rejections
    relationship_patterns = {
        "total": 0,
        "validated": 0,
        "type_corrected": 0,
        "rejected": 0,
        "rejection_reasons": defaultdict(int),
        "type_corrections": defaultdict(int),
    }

    for corr in relationship_corrections:
        action = corr.get("action")
        relationship_patterns["total"] += 1

        if action == "validate":
            relationship_patterns["validated"] += 1
        elif action == "correct_type":
            relationship_patterns["type_corrected"] += 1
            orig_type = corr.get("original_type") or "unknown"
            new_type = corr.get("corrected_type") or "unknown"
            relationship_patterns["type_corrections"][f"{orig_type}->{new_type}"] += 1
        elif action == "reject":
            relationship_patterns["rejected"] += 1
            reason = corr.get("rejection_reason") or "unspecified"
            relationship_patterns["rejection_reasons"][reason] += 1

    relationship_patterns["rejection_reasons"] = dict(
        sorted(relationship_patterns["rejection_reasons"].items(), key=lambda x: -x[1])[:5]
    )
    relationship_patterns["type_corrections"] = dict(
        sorted(relationship_patterns["type_corrections"].items(), key=lambda x: -x[1])[:5]
    )

    return {
        "entity_corrections": dict(entity_patterns),
        "relationship_corrections": relationship_patterns,
        "total_corrections": len(entity_corrections) + len(relationship_corrections),
    }


def _classify_name_correction(original: str, corrected: str) -> str:
    """Classify the type of name correction made."""
    orig_lower = original.lower().strip()
    corr_lower = corrected.lower().strip()

    # Capitalization only
    if orig_lower == corr_lower and original != corrected:
        return "capitalization"

    # Whitespace/formatting
    if orig_lower.replace(" ", "") == corr_lower.replace(" ", ""):
        return "spacing"

    # Abbreviation expansion
    if len(corrected) > len(original) * 1.5:
        return "abbreviation_expanded"

    # Abbreviation contraction
    if len(original) > len(corrected) * 1.5:
        return "abbreviation_contracted"

    # Title included in name (e.g., "Dr. John Smith" -> "John Smith")
    title_prefixes = ["dr.", "mr.", "ms.", "mrs.", "prof.", "the "]
    for prefix in title_prefixes:
        if orig_lower.startswith(prefix) and not corr_lower.startswith(prefix):
            return "title_removed"

    # Organization suffix removed
    org_suffixes = [" inc", " inc.", " llc", " corp", " corp.", " ltd"]
    for suffix in org_suffixes:
        if orig_lower.endswith(suffix) and not corr_lower.endswith(suffix):
            return "org_suffix_removed"

    return "other"


def analyze_confidence_accuracy() -> Dict[str, Any]:
    """
    Analyze how well extraction confidence predicts validation success.

    Returns:
        Dict with accuracy metrics by confidence bracket.
    """
    feedback_data = load_feedback_data()
    entity_corrections = feedback_data.get("entity_corrections", [])

    # Group by confidence brackets
    brackets = {
        "0.0-0.5": {"total": 0, "validated": 0},
        "0.5-0.7": {"total": 0, "validated": 0},
        "0.7-0.85": {"total": 0, "validated": 0},
        "0.85-0.95": {"total": 0, "validated": 0},
        "0.95-1.0": {"total": 0, "validated": 0},
        "unknown": {"total": 0, "validated": 0},
    }

    for corr in entity_corrections:
        confidence = corr.get("extraction_confidence")
        action = corr.get("action")
        is_validated = action in ("validate", "correct")

        if confidence is None:
            bracket = "unknown"
        elif confidence < 0.5:
            bracket = "0.0-0.5"
        elif confidence < 0.7:
            bracket = "0.5-0.7"
        elif confidence < 0.85:
            bracket = "0.7-0.85"
        elif confidence < 0.95:
            bracket = "0.85-0.95"
        else:
            bracket = "0.95-1.0"

        brackets[bracket]["total"] += 1
        if is_validated:
            brackets[bracket]["validated"] += 1

    # Calculate accuracy for each bracket
    for bracket, stats in brackets.items():
        if stats["total"] > 0:
            stats["accuracy"] = round(stats["validated"] / stats["total"], 3)
        else:
            stats["accuracy"] = None

    # Calculate overall calibration score
    # Perfect calibration: accuracy matches confidence
    calibration_error = 0.0
    calibration_count = 0

    bracket_midpoints = {
        "0.0-0.5": 0.25,
        "0.5-0.7": 0.6,
        "0.7-0.85": 0.775,
        "0.85-0.95": 0.9,
        "0.95-1.0": 0.975,
    }

    for bracket, midpoint in bracket_midpoints.items():
        stats = brackets[bracket]
        if stats["accuracy"] is not None and stats["total"] >= 5:
            error = abs(stats["accuracy"] - midpoint)
            calibration_error += error * stats["total"]
            calibration_count += stats["total"]

    avg_calibration_error = None
    if calibration_count > 0:
        avg_calibration_error = round(calibration_error / calibration_count, 3)

    return {
        "confidence_brackets": brackets,
        "avg_calibration_error": avg_calibration_error,
        "interpretation": _interpret_calibration(brackets, avg_calibration_error),
    }


def _interpret_calibration(brackets: Dict, calibration_error: Optional[float]) -> str:
    """Generate human-readable interpretation of calibration results."""
    if calibration_error is None:
        return "Not enough data to assess calibration."

    interpretations = []

    # Check for overconfidence (high confidence but low accuracy)
    high_conf = brackets.get("0.95-1.0", {})
    if high_conf.get("accuracy") is not None and high_conf.get("total", 0) >= 5:
        if high_conf["accuracy"] < 0.85:
            interpretations.append(
                f"Model is overconfident: {int(high_conf['accuracy']*100)}% accuracy at 95%+ confidence"
            )

    # Check for underconfidence (low confidence but high accuracy)
    low_conf = brackets.get("0.5-0.7", {})
    if low_conf.get("accuracy") is not None and low_conf.get("total", 0) >= 5:
        if low_conf["accuracy"] > 0.85:
            interpretations.append(
                f"Model is underconfident: {int(low_conf['accuracy']*100)}% accuracy at 50-70% confidence"
            )

    if calibration_error < 0.1:
        interpretations.append("Overall calibration is good")
    elif calibration_error < 0.2:
        interpretations.append("Overall calibration is acceptable")
    else:
        interpretations.append("Model confidence needs recalibration")

    return "; ".join(interpretations) if interpretations else "Calibration is within acceptable range"


def analyze_agent_accuracy() -> Dict[str, Any]:
    """
    Analyze how often users agree with agent's structure review decisions.

    Returns:
        Dict with agent accuracy metrics.
    """
    feedback_data = load_feedback_data()
    decision_outcomes = feedback_data.get("decision_outcomes", [])

    if not decision_outcomes:
        return {
            "total_decisions": 0,
            "agreement_rate": None,
            "by_decision_type": {},
            "interpretation": "No agent decisions recorded yet.",
        }

    total = len(decision_outcomes)
    agreed = sum(1 for d in decision_outcomes if d.get("user_agreed"))

    # Breakdown by agent decision type
    by_decision = defaultdict(lambda: {"total": 0, "agreed": 0})
    for outcome in decision_outcomes:
        decision = outcome.get("agent_decision", "unknown")
        by_decision[decision]["total"] += 1
        if outcome.get("user_agreed"):
            by_decision[decision]["agreed"] += 1

    # Calculate accuracy per decision type
    for decision_type in by_decision:
        stats = by_decision[decision_type]
        if stats["total"] > 0:
            stats["agreement_rate"] = round(stats["agreed"] / stats["total"], 3)

    # Analyze override patterns
    override_reasons = defaultdict(int)
    for outcome in decision_outcomes:
        if not outcome.get("user_agreed"):
            reason = outcome.get("override_reason") or "no reason given"
            override_reasons[reason] += 1

    return {
        "total_decisions": total,
        "agreement_rate": round(agreed / total, 3) if total > 0 else None,
        "by_decision_type": dict(by_decision),
        "common_override_reasons": dict(
            sorted(override_reasons.items(), key=lambda x: -x[1])[:5]
        ),
        "interpretation": _interpret_agent_accuracy(agreed, total, by_decision),
    }


def _interpret_agent_accuracy(agreed: int, total: int, by_decision: Dict) -> str:
    """Generate interpretation of agent accuracy."""
    if total == 0:
        return "No decisions to analyze."

    rate = agreed / total

    interpretations = []

    if rate >= 0.9:
        interpretations.append("Excellent agent accuracy (90%+)")
    elif rate >= 0.8:
        interpretations.append("Good agent accuracy (80%+)")
    elif rate >= 0.7:
        interpretations.append("Acceptable agent accuracy (70%+)")
    else:
        interpretations.append("Agent accuracy needs improvement (<70%)")

    # Check for specific weak spots
    for decision_type, stats in by_decision.items():
        if stats["total"] >= 5:
            type_rate = stats.get("agreement_rate", 0)
            if type_rate < 0.7:
                interpretations.append(
                    f"Agent struggles with '{decision_type}' decisions ({int(type_rate*100)}% accuracy)"
                )

    return "; ".join(interpretations)


# =============================================================================
# Prompt Refinement Recommendations
# =============================================================================

def get_prompt_recommendations() -> Dict[str, Any]:
    """
    Generate recommendations for improving extraction prompts based on feedback.

    Returns:
        Dict with specific recommendations for entity and relationship extraction.
    """
    patterns = analyze_correction_patterns()
    confidence = analyze_confidence_accuracy()
    agent_accuracy = analyze_agent_accuracy()

    recommendations = []

    # Entity recommendations
    entity_patterns = patterns.get("entity_corrections", {})

    # Check for type-specific issues
    for entity_type, stats in entity_patterns.items():
        if stats["total"] < 5:
            continue

        rejection_rate = stats.get("rejected", 0) / stats["total"]
        correction_rate = stats.get("corrected", 0) / stats["total"]

        if rejection_rate > 0.3:
            top_reasons = list(stats.get("common_rejections", {}).keys())[:2]
            recommendations.append({
                "category": "entity_extraction",
                "severity": "high" if rejection_rate > 0.5 else "medium",
                "message": f"High rejection rate ({int(rejection_rate*100)}%) for '{entity_type}' entities",
                "details": f"Common reasons: {', '.join(top_reasons) if top_reasons else 'various'}",
                "suggestion": f"Add guidance to avoid extracting generic {entity_type} entities",
            })

        if correction_rate > 0.3:
            top_corrections = list(stats.get("common_corrections", {}).keys())[:2]
            recommendations.append({
                "category": "entity_extraction",
                "severity": "medium",
                "message": f"High correction rate ({int(correction_rate*100)}%) for '{entity_type}' entities",
                "details": f"Common corrections: {', '.join(top_corrections) if top_corrections else 'various'}",
                "suggestion": f"Improve normalization rules for {entity_type} entities",
            })

    # Relationship recommendations
    rel_patterns = patterns.get("relationship_corrections", {})
    if rel_patterns.get("total", 0) >= 5:
        rel_rejection_rate = rel_patterns.get("rejected", 0) / rel_patterns["total"]
        if rel_rejection_rate > 0.2:
            top_reasons = list(rel_patterns.get("rejection_reasons", {}).keys())[:2]
            recommendations.append({
                "category": "relationship_extraction",
                "severity": "high" if rel_rejection_rate > 0.4 else "medium",
                "message": f"Relationship rejection rate is {int(rel_rejection_rate*100)}%",
                "details": f"Common reasons: {', '.join(top_reasons) if top_reasons else 'various'}",
                "suggestion": "Add validation rules to filter low-quality relationships",
            })

        # Type correction patterns
        type_corrections = rel_patterns.get("type_corrections", {})
        if type_corrections:
            most_common = list(type_corrections.items())[0]
            recommendations.append({
                "category": "relationship_extraction",
                "severity": "low",
                "message": f"Common type correction: {most_common[0]}",
                "details": f"Occurred {most_common[1]} times",
                "suggestion": "Review relationship type definitions in extraction prompt",
            })

    # Confidence calibration recommendations
    calibration_error = confidence.get("avg_calibration_error")
    if calibration_error is not None and calibration_error > 0.15:
        recommendations.append({
            "category": "confidence_calibration",
            "severity": "medium",
            "message": f"Extraction confidence is poorly calibrated (error: {calibration_error})",
            "details": confidence.get("interpretation", ""),
            "suggestion": "Consider adjusting confidence thresholds or retraining",
        })

    # Agent accuracy recommendations
    if agent_accuracy.get("agreement_rate") is not None:
        if agent_accuracy["agreement_rate"] < 0.8:
            override_reasons = agent_accuracy.get("common_override_reasons", {})
            recommendations.append({
                "category": "agent_curation",
                "severity": "high" if agent_accuracy["agreement_rate"] < 0.7 else "medium",
                "message": f"Agent structure review accuracy is {int(agent_accuracy['agreement_rate']*100)}%",
                "details": f"Common overrides: {', '.join(list(override_reasons.keys())[:2]) if override_reasons else 'various'}",
                "suggestion": "Review agent reasoning prompts and decision criteria",
            })

    # Sort by severity
    severity_order = {"high": 0, "medium": 1, "low": 2}
    recommendations.sort(key=lambda r: severity_order.get(r["severity"], 3))

    return {
        "recommendations": recommendations,
        "summary": _summarize_recommendations(recommendations),
        "total_feedback_records": patterns.get("total_corrections", 0),
    }


def _summarize_recommendations(recommendations: List[Dict]) -> str:
    """Summarize recommendations into a single message."""
    high_priority = [r for r in recommendations if r["severity"] == "high"]
    medium_priority = [r for r in recommendations if r["severity"] == "medium"]

    if not recommendations:
        return "No significant issues detected. Extraction quality is good."

    parts = []
    if high_priority:
        parts.append(f"{len(high_priority)} high-priority issues need attention")
    if medium_priority:
        parts.append(f"{len(medium_priority)} medium-priority improvements suggested")

    return "; ".join(parts) if parts else "Minor improvements suggested"


# =============================================================================
# Feedback Dashboard Data
# =============================================================================

def get_feedback_dashboard() -> Dict[str, Any]:
    """
    Get all feedback analysis data for the dashboard.

    Returns:
        Comprehensive feedback analysis for display.
    """
    correction_patterns = analyze_correction_patterns()
    confidence_accuracy = analyze_confidence_accuracy()
    agent_accuracy = analyze_agent_accuracy()
    recommendations = get_prompt_recommendations()

    # Quick stats
    feedback_data = load_feedback_data()
    total_entity_feedback = len(feedback_data.get("entity_corrections", []))
    total_relationship_feedback = len(feedback_data.get("relationship_corrections", []))
    total_agent_feedback = len(feedback_data.get("decision_outcomes", []))

    # Calculate overall health score (0-100)
    health_score = 100

    # Deduct for high rejection rates
    entity_patterns = correction_patterns.get("entity_corrections", {})
    for stats in entity_patterns.values():
        if stats["total"] >= 5:
            rejection_rate = stats.get("rejected", 0) / stats["total"]
            if rejection_rate > 0.3:
                health_score -= 10
            elif rejection_rate > 0.2:
                health_score -= 5

    # Deduct for poor calibration
    calibration_error = confidence_accuracy.get("avg_calibration_error")
    if calibration_error is not None:
        if calibration_error > 0.2:
            health_score -= 15
        elif calibration_error > 0.15:
            health_score -= 10

    # Deduct for poor agent accuracy
    if agent_accuracy.get("agreement_rate") is not None:
        if agent_accuracy["agreement_rate"] < 0.7:
            health_score -= 15
        elif agent_accuracy["agreement_rate"] < 0.8:
            health_score -= 10

    health_score = max(0, min(100, health_score))

    return {
        "health_score": health_score,
        "total_feedback": total_entity_feedback + total_relationship_feedback + total_agent_feedback,
        "stats": {
            "entity_feedback_count": total_entity_feedback,
            "relationship_feedback_count": total_relationship_feedback,
            "agent_decision_count": total_agent_feedback,
        },
        "correction_patterns": correction_patterns,
        "confidence_accuracy": confidence_accuracy,
        "agent_accuracy": agent_accuracy,
        "recommendations": recommendations,
    }
