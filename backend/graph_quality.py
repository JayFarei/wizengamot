"""Knowledge Graph Quality Management.

This module handles:
- Entity validation (extracted|validated|rejected|corrected)
- Relationship validation
- Provenance tracking
- Quality metrics aggregation
"""

import json
import os
import logging
from datetime import datetime
from typing import Dict, Any, List, Optional
from pathlib import Path

from .knowledge_graph import load_entities, save_entities
from .graph_feedback import record_entity_correction, record_relationship_correction

logger = logging.getLogger(__name__)

# Data directory for quality data
DATA_DIR = os.environ.get("DATA_DIR", "data")
QUALITY_DIR = os.path.join(DATA_DIR, "quality")


def ensure_quality_dir():
    """Ensure the quality directory exists."""
    os.makedirs(QUALITY_DIR, exist_ok=True)


# =============================================================================
# Entity Validation
# =============================================================================

def get_entity_validation(entity_id: str) -> Optional[Dict[str, Any]]:
    """Get validation status for an entity."""
    data = load_entities()
    entity = data.get("entities", {}).get(entity_id)
    if entity:
        return entity.get("validation")
    return None


def validate_entity(
    entity_id: str,
    action: str,  # "validate", "correct", "reject"
    correction: Optional[Dict[str, Any]] = None,
    reason: Optional[str] = None
) -> Dict[str, Any]:
    """
    Validate, correct, or reject an entity.

    Args:
        entity_id: The entity ID
        action: "validate", "correct", or "reject"
        correction: For "correct" action - dict with updated name/type
        reason: For "reject" action - reason for rejection

    Returns:
        Updated entity
    """
    data = load_entities()
    entities = data.get("entities", {})

    entity = entities.get(entity_id)
    if not entity:
        return {"error": "Entity not found"}

    # Initialize validation if not present
    if "validation" not in entity:
        entity["validation"] = {
            "status": "extracted",
            "validated_by": None,
            "validated_at": None,
            "original_name": None,
            "rejection_reason": None,
        }

    # Initialize provenance if not present
    if "provenance" not in entity:
        entity["provenance"] = {
            "source": "extraction",
            "extraction_model": None,
            "extraction_confidence": None,
            "source_note": None,
            "created_at": entity.get("created_at") or datetime.utcnow().isoformat(),
        }

    validation = entity["validation"]

    if action == "validate":
        validation["status"] = "validated"
        validation["validated_by"] = "user"
        validation["validated_at"] = datetime.utcnow().isoformat()

    elif action == "correct":
        if correction:
            # Store original before correction
            if validation.get("original_name") is None:
                validation["original_name"] = entity.get("name")

            # Apply corrections
            if correction.get("name"):
                entity["name"] = correction["name"]
            if correction.get("type"):
                entity["type"] = correction["type"]

            validation["status"] = "corrected"
            validation["validated_by"] = "user"
            validation["validated_at"] = datetime.utcnow().isoformat()
        else:
            return {"error": "Correction data required"}

    elif action == "reject":
        validation["status"] = "rejected"
        validation["validated_by"] = "user"
        validation["validated_at"] = datetime.utcnow().isoformat()
        validation["rejection_reason"] = reason

    else:
        return {"error": f"Unknown action: {action}"}

    # Save changes
    save_entities(data)

    # Record feedback for learning
    try:
        provenance = entity.get("provenance", {})
        record_entity_correction(
            entity_id=entity_id,
            action=action,
            original_name=validation.get("original_name") or entity.get("name"),
            original_type=entity.get("type"),
            corrected_name=correction.get("name") if correction else None,
            corrected_type=correction.get("type") if correction else None,
            rejection_reason=reason,
            extraction_confidence=provenance.get("extraction_confidence"),
            extraction_model=provenance.get("extraction_model"),
        )
    except Exception as e:
        logger.warning(f"Failed to record entity feedback: {e}")

    return {"success": True, "entity": entity}


def add_manual_entity(
    note_id: str,
    name: str,
    entity_type: str,
    context: Optional[str] = None
) -> Dict[str, Any]:
    """
    Manually add an entity that was missed by extraction.

    Args:
        note_id: The note ID where this entity appears
        name: Entity name
        entity_type: Entity type (person, organization, concept, technology, event)
        context: Context where the entity appears

    Returns:
        Created entity
    """
    import uuid

    data = load_entities()
    entities = data.get("entities", {})

    # Create new entity ID
    entity_id = str(uuid.uuid4())

    # Create entity
    entity = {
        "id": entity_id,
        "name": name,
        "type": entity_type,
        "aliases": [],
        "mentions": [],
        "validation": {
            "status": "validated",  # Manual entities are auto-validated
            "validated_by": "user",
            "validated_at": datetime.utcnow().isoformat(),
            "original_name": None,
            "rejection_reason": None,
        },
        "provenance": {
            "source": "manual",
            "extraction_model": None,
            "extraction_confidence": None,
            "source_note": note_id,
            "created_at": datetime.utcnow().isoformat(),
        },
        "created_at": datetime.utcnow().isoformat(),
    }

    # Add mention if context provided
    if context:
        entity["mentions"].append({
            "note_id": note_id,
            "context": context,
            "created_at": datetime.utcnow().isoformat(),
        })

    # Add to entities
    entities[entity_id] = entity

    # Update note_entities mapping
    note_entities = data.get("note_entities", {})
    if note_id not in note_entities:
        note_entities[note_id] = []
    if entity_id not in note_entities[note_id]:
        note_entities[note_id].append(entity_id)

    # Save changes
    save_entities(data)

    return {"success": True, "entity": entity}


def get_unvalidated_entities(limit: int = 50) -> List[Dict[str, Any]]:
    """Get entities pending review, sorted by extraction confidence (low first)."""
    data = load_entities()
    entities = data.get("entities", {})

    unvalidated = []
    for entity_id, entity in entities.items():
        validation = entity.get("validation", {})
        status = validation.get("status", "extracted")

        # Only include extracted (not yet reviewed) entities
        if status == "extracted":
            provenance = entity.get("provenance", {})
            unvalidated.append({
                "id": entity_id,
                "name": entity.get("name"),
                "type": entity.get("type"),
                "mentions": entity.get("mentions", []),
                "mention_count": len(entity.get("mentions", [])),
                "extraction_confidence": provenance.get("extraction_confidence"),
                "source_note": provenance.get("source_note"),
                "created_at": entity.get("created_at"),
            })

    # Sort by extraction confidence (low first), then by created_at
    unvalidated.sort(key=lambda e: (
        e.get("extraction_confidence") or 1.0,  # None treated as high confidence
        e.get("created_at") or "",
    ))

    return unvalidated[:limit]


def get_entities_for_note(note_id: str) -> List[Dict[str, Any]]:
    """Get all entities associated with a note."""
    data = load_entities()
    entities = data.get("entities", {})
    note_entities = data.get("note_entities", {})

    entity_ids = note_entities.get(note_id, [])
    result = []

    for entity_id in entity_ids:
        entity = entities.get(entity_id)
        if entity:
            result.append({
                "id": entity_id,
                "name": entity.get("name"),
                "type": entity.get("type"),
                "validation": entity.get("validation", {}),
                "provenance": entity.get("provenance", {}),
                "mention_count": len(entity.get("mentions", [])),
            })

    return result


# =============================================================================
# Relationship Validation
# =============================================================================

def validate_relationship(
    relationship_id: str,
    action: str,  # "validate", "reject", "correct_type"
    new_type: Optional[str] = None,
    reason: Optional[str] = None
) -> Dict[str, Any]:
    """
    Validate, reject, or correct a relationship.

    Args:
        relationship_id: The relationship ID
        action: "validate", "reject", or "correct_type"
        new_type: For "correct_type" action - the new relationship type
        reason: For "reject" action - reason for rejection

    Returns:
        Updated relationship
    """
    data = load_entities()
    relationships = data.get("entity_relationships", [])

    # Find the relationship
    relationship = None
    rel_idx = None
    for idx, rel in enumerate(relationships):
        if rel.get("id") == relationship_id:
            relationship = rel
            rel_idx = idx
            break

    if relationship is None:
        return {"error": "Relationship not found"}

    # Initialize validation if not present
    if "validation" not in relationship:
        relationship["validation"] = {
            "status": "extracted",
            "validated_by": None,
            "validated_at": None,
            "rejection_reason": None,
        }

    validation = relationship["validation"]

    if action == "validate":
        validation["status"] = "validated"
        validation["validated_by"] = "user"
        validation["validated_at"] = datetime.utcnow().isoformat()

    elif action == "correct_type":
        if new_type:
            relationship["type"] = new_type
            validation["status"] = "validated"
            validation["validated_by"] = "user"
            validation["validated_at"] = datetime.utcnow().isoformat()
        else:
            return {"error": "New type required for correct_type action"}

    elif action == "reject":
        validation["status"] = "rejected"
        validation["validated_by"] = "user"
        validation["validated_at"] = datetime.utcnow().isoformat()
        validation["rejection_reason"] = reason

    else:
        return {"error": f"Unknown action: {action}"}

    # Update relationship in list
    relationships[rel_idx] = relationship

    # Save changes
    save_entities(data)

    # Record feedback for learning
    try:
        record_relationship_correction(
            relationship_id=relationship_id,
            action=action,
            original_type=relationship.get("type") if action != "correct_type" else None,
            corrected_type=new_type,
            rejection_reason=reason,
            source_entity_name=relationship.get("source_entity_name"),
            target_entity_name=relationship.get("target_entity_name"),
        )
    except Exception as e:
        logger.warning(f"Failed to record relationship feedback: {e}")

    return {"success": True, "relationship": relationship}


def get_unvalidated_relationships(limit: int = 50) -> List[Dict[str, Any]]:
    """Get relationships pending review."""
    data = load_entities()
    relationships = data.get("entity_relationships", [])
    entities = data.get("entities", {})

    unvalidated = []
    for rel in relationships:
        validation = rel.get("validation", {})
        status = validation.get("status", "extracted")

        # Only include extracted (not yet reviewed) relationships
        if status == "extracted":
            source_entity = entities.get(rel.get("source_entity_id"), {})
            target_entity = entities.get(rel.get("target_entity_id"), {})

            unvalidated.append({
                "id": rel.get("id"),
                "source_entity_id": rel.get("source_entity_id"),
                "source_entity_name": source_entity.get("name") or rel.get("source_entity_name"),
                "target_entity_id": rel.get("target_entity_id"),
                "target_entity_name": target_entity.get("name") or rel.get("target_entity_name"),
                "type": rel.get("type"),
                "provenance": rel.get("provenance", {}),
                "created_at": rel.get("created_at"),
            })

    return unvalidated[:limit]


# =============================================================================
# Quality Metrics
# =============================================================================

def get_quality_metrics() -> Dict[str, Any]:
    """Get overall quality metrics for the knowledge graph."""
    data = load_entities()
    entities = data.get("entities", {})
    relationships = data.get("entity_relationships", [])

    # Entity metrics
    entity_stats = {
        "total": len(entities),
        "extracted": 0,
        "validated": 0,
        "corrected": 0,
        "rejected": 0,
        "manual": 0,
    }

    for entity in entities.values():
        validation = entity.get("validation", {})
        status = validation.get("status", "extracted")
        entity_stats[status] = entity_stats.get(status, 0) + 1

        provenance = entity.get("provenance", {})
        if provenance.get("source") == "manual":
            entity_stats["manual"] += 1

    # Relationship metrics
    relationship_stats = {
        "total": len(relationships),
        "extracted": 0,
        "validated": 0,
        "rejected": 0,
    }

    for rel in relationships:
        validation = rel.get("validation", {})
        status = validation.get("status", "extracted")
        relationship_stats[status] = relationship_stats.get(status, 0) + 1

    # Review backlog
    review_backlog = {
        "unvalidated_entities": entity_stats["extracted"],
        "unvalidated_relationships": relationship_stats["extracted"],
    }

    # Entity type breakdown
    entity_types = {}
    for entity in entities.values():
        entity_type = entity.get("type", "unknown")
        entity_types[entity_type] = entity_types.get(entity_type, 0) + 1

    # Relationship type breakdown
    relationship_types = {}
    for rel in relationships:
        rel_type = rel.get("type", "unknown")
        relationship_types[rel_type] = relationship_types.get(rel_type, 0) + 1

    return {
        "entities": entity_stats,
        "relationships": relationship_stats,
        "review_backlog": review_backlog,
        "entity_types": entity_types,
        "relationship_types": relationship_types,
    }


# =============================================================================
# Provenance Queries
# =============================================================================

def get_entities_by_provenance(
    source: Optional[str] = None,
    model: Optional[str] = None,
    validated_by: Optional[str] = None,
    limit: int = 100
) -> List[Dict[str, Any]]:
    """
    Get entities filtered by provenance criteria.

    Args:
        source: Filter by provenance source (extraction, manual, inference)
        model: Filter by extraction model
        validated_by: Filter by who validated (user, auto)
        limit: Maximum entities to return

    Returns:
        List of entities matching criteria
    """
    data = load_entities()
    entities = data.get("entities", {})

    results = []
    for entity_id, entity in entities.items():
        provenance = entity.get("provenance", {})
        validation = entity.get("validation", {})

        # Apply filters
        if source and provenance.get("source") != source:
            continue

        if model and model not in (provenance.get("extraction_model") or ""):
            continue

        if validated_by and validation.get("validated_by") != validated_by:
            continue

        results.append({
            "id": entity_id,
            "name": entity.get("name"),
            "type": entity.get("type"),
            "validation": validation,
            "provenance": provenance,
            "mention_count": len(entity.get("mentions", [])),
            "created_at": provenance.get("created_at"),
        })

    # Sort by created_at descending
    results.sort(key=lambda e: e.get("created_at") or "", reverse=True)

    return results[:limit]


def get_provenance_stats() -> Dict[str, Any]:
    """
    Get statistics about entity provenance.

    Returns:
        Dict with provenance statistics
    """
    data = load_entities()
    entities = data.get("entities", {})

    by_source = {}
    by_model = {}
    by_validator = {}

    for entity in entities.values():
        provenance = entity.get("provenance", {})
        validation = entity.get("validation", {})

        # Count by source
        source = provenance.get("source") or "unknown"
        by_source[source] = by_source.get(source, 0) + 1

        # Count by model
        model = provenance.get("extraction_model")
        if model:
            model_short = model.split("/")[-1] if "/" in model else model
            by_model[model_short] = by_model.get(model_short, 0) + 1

        # Count by validator
        validator = validation.get("validated_by")
        if validator:
            by_validator[validator] = by_validator.get(validator, 0) + 1

    return {
        "by_source": by_source,
        "by_model": by_model,
        "by_validator": by_validator,
        "total_entities": len(entities),
    }


def get_entity_provenance_detail(entity_id: str) -> Optional[Dict[str, Any]]:
    """
    Get detailed provenance information for an entity.

    Args:
        entity_id: The entity ID

    Returns:
        Dict with full provenance and validation history
    """
    data = load_entities()
    entity = data.get("entities", {}).get(entity_id)

    if not entity:
        return None

    provenance = entity.get("provenance", {})
    validation = entity.get("validation", {})

    return {
        "id": entity_id,
        "name": entity.get("name"),
        "type": entity.get("type"),
        "provenance": {
            "source": provenance.get("source", "unknown"),
            "extraction_model": provenance.get("extraction_model"),
            "extraction_confidence": provenance.get("extraction_confidence"),
            "source_note": provenance.get("source_note"),
            "created_at": provenance.get("created_at"),
        },
        "validation": {
            "status": validation.get("status", "extracted"),
            "validated_by": validation.get("validated_by"),
            "validated_at": validation.get("validated_at"),
            "original_name": validation.get("original_name"),
            "rejection_reason": validation.get("rejection_reason"),
        },
        "mentions": entity.get("mentions", []),
        "mention_count": len(entity.get("mentions", [])),
    }
