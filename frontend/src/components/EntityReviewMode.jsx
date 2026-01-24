import React, { useState, useEffect, useCallback } from 'react';
import { X, ChevronLeft, ChevronRight, Check, XCircle, Edit3, Plus, Loader } from 'lucide-react';
import { api } from '../api';

/**
 * EntityReviewMode - Full-screen keyboard-driven interface for reviewing entities
 *
 * Features:
 * - Validate, correct, or reject entities
 * - Add missing entities manually
 * - Keyboard navigation (v/c/r/s)
 * - Progress tracking
 */
export default function EntityReviewMode({
  entities,
  noteTitle,
  conversationId,
  noteId,
  onEntityUpdated,
  onClose,
}) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [actionInProgress, setActionInProgress] = useState(false);
  const [showCorrectionMode, setShowCorrectionMode] = useState(false);
  const [correctedName, setCorrectedName] = useState('');
  const [correctedType, setCorrectedType] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [showRejectionInput, setShowRejectionInput] = useState(false);
  const [showAddEntity, setShowAddEntity] = useState(false);
  const [newEntityName, setNewEntityName] = useState('');
  const [newEntityType, setNewEntityType] = useState('concept');
  const [newEntityContext, setNewEntityContext] = useState('');

  const currentEntity = entities[currentIndex];
  const totalCount = entities.length;

  // Check if we have note context (for add entity feature)
  const hasNoteContext = Boolean(conversationId && noteId);

  // Reset state when entity changes
  useEffect(() => {
    setShowCorrectionMode(false);
    setCorrectedName(currentEntity?.name || '');
    setCorrectedType(currentEntity?.type || 'concept');
    setRejectionReason('');
    setShowRejectionInput(false);
  }, [currentIndex, currentEntity]);

  // Handle validate
  const handleValidate = useCallback(async () => {
    if (!currentEntity || actionInProgress) return;

    setActionInProgress(true);
    try {
      await api.validateEntity(currentEntity.id, 'validate');
      onEntityUpdated?.(currentEntity.id, { status: 'validated' });

      // Move to next or close
      if (currentIndex >= totalCount - 1) {
        if (totalCount <= 1) {
          onClose();
        } else {
          setCurrentIndex(prev => prev - 1);
        }
      }
    } catch (err) {
      console.error('Failed to validate entity:', err);
    } finally {
      setActionInProgress(false);
    }
  }, [currentEntity, actionInProgress, currentIndex, totalCount, onEntityUpdated, onClose]);

  // Handle correct
  const handleCorrect = useCallback(async () => {
    if (!currentEntity || actionInProgress) return;

    if (!showCorrectionMode) {
      setShowCorrectionMode(true);
      setCorrectedName(currentEntity.name);
      setCorrectedType(currentEntity.type);
      return;
    }

    setActionInProgress(true);
    try {
      await api.validateEntity(currentEntity.id, 'correct', {
        correction: {
          name: correctedName,
          type: correctedType,
        },
      });
      onEntityUpdated?.(currentEntity.id, { status: 'corrected', name: correctedName, type: correctedType });

      // Move to next or close
      setShowCorrectionMode(false);
      if (currentIndex >= totalCount - 1) {
        if (totalCount <= 1) {
          onClose();
        } else {
          setCurrentIndex(prev => prev - 1);
        }
      }
    } catch (err) {
      console.error('Failed to correct entity:', err);
    } finally {
      setActionInProgress(false);
    }
  }, [currentEntity, actionInProgress, showCorrectionMode, correctedName, correctedType, currentIndex, totalCount, onEntityUpdated, onClose]);

  // Handle reject
  const handleReject = useCallback(async () => {
    if (!currentEntity || actionInProgress) return;

    if (!showRejectionInput) {
      setShowRejectionInput(true);
      return;
    }

    setActionInProgress(true);
    try {
      await api.validateEntity(currentEntity.id, 'reject', {
        reason: rejectionReason || null,
      });
      onEntityUpdated?.(currentEntity.id, { status: 'rejected' });

      // Move to next or close
      setShowRejectionInput(false);
      setRejectionReason('');
      if (currentIndex >= totalCount - 1) {
        if (totalCount <= 1) {
          onClose();
        } else {
          setCurrentIndex(prev => prev - 1);
        }
      }
    } catch (err) {
      console.error('Failed to reject entity:', err);
    } finally {
      setActionInProgress(false);
    }
  }, [currentEntity, actionInProgress, showRejectionInput, rejectionReason, currentIndex, totalCount, onEntityUpdated, onClose]);

  // Handle add entity
  const handleAddEntity = useCallback(async () => {
    if (!newEntityName.trim() || actionInProgress) return;

    setActionInProgress(true);
    try {
      await api.addManualEntity(
        conversationId,
        noteId,
        newEntityName.trim(),
        newEntityType,
        newEntityContext.trim() || null
      );
      onEntityUpdated?.('new', { name: newEntityName, type: newEntityType });

      // Reset form
      setShowAddEntity(false);
      setNewEntityName('');
      setNewEntityType('concept');
      setNewEntityContext('');
    } catch (err) {
      console.error('Failed to add entity:', err);
    } finally {
      setActionInProgress(false);
    }
  }, [conversationId, noteId, newEntityName, newEntityType, newEntityContext, actionInProgress, onEntityUpdated]);

  // Keyboard navigation
  const handleKeyDown = useCallback((e) => {
    // Don't handle keys when typing in inputs
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
      if (e.key === 'Escape') {
        e.target.blur();
        setShowCorrectionMode(false);
        setShowRejectionInput(false);
        setShowAddEntity(false);
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (showCorrectionMode) handleCorrect();
        if (showRejectionInput) handleReject();
        if (showAddEntity) handleAddEntity();
      }
      return;
    }

    switch (e.key) {
      case 'j':
        if (currentIndex < totalCount - 1) {
          setCurrentIndex(prev => prev + 1);
        }
        break;
      case 'k':
        if (currentIndex > 0) {
          setCurrentIndex(prev => prev - 1);
        }
        break;
      case 'v':
        if (!actionInProgress && !showCorrectionMode && !showRejectionInput) {
          handleValidate();
        }
        break;
      case 'c':
        if (!actionInProgress && !showRejectionInput) {
          handleCorrect();
        }
        break;
      case 'r':
        if (!actionInProgress && !showCorrectionMode) {
          handleReject();
        }
        break;
      case 's':
      case 'Tab':
        // Skip to next
        e.preventDefault();
        if (currentIndex < totalCount - 1) {
          setCurrentIndex(prev => prev + 1);
        }
        break;
      case '+':
        // Add entity (only when there's a note context)
        if (hasNoteContext) {
          setShowAddEntity(true);
        }
        break;
      case 'Escape':
        e.preventDefault();
        if (showCorrectionMode) {
          setShowCorrectionMode(false);
        } else if (showRejectionInput) {
          setShowRejectionInput(false);
        } else if (showAddEntity) {
          setShowAddEntity(false);
        } else {
          onClose();
        }
        break;
      default:
        // Number keys for quick rejection reasons
        if (showRejectionInput && e.key >= '1' && e.key <= '5') {
          const reasons = ['Too generic', 'Not a concept', 'Duplicate', 'Wrong type', 'Other'];
          const idx = parseInt(e.key) - 1;
          setRejectionReason(reasons[idx]);
        }
        // Number keys for entity type in correction mode
        if (showCorrectionMode && e.key >= '1' && e.key <= '5') {
          const types = ['person', 'organization', 'concept', 'technology', 'event'];
          const idx = parseInt(e.key) - 1;
          setCorrectedType(types[idx]);
        }
        break;
    }
  }, [currentIndex, totalCount, actionInProgress, showCorrectionMode, showRejectionInput, showAddEntity, hasNoteContext, onClose, handleValidate, handleCorrect, handleReject, handleAddEntity]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [handleKeyDown]);

  // Prevent body scroll
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  const entityTypes = [
    { value: 'person', label: 'Person', key: '1' },
    { value: 'organization', label: 'Organization', key: '2' },
    { value: 'concept', label: 'Concept', key: '3' },
    { value: 'technology', label: 'Technology', key: '4' },
    { value: 'event', label: 'Event', key: '5' },
  ];

  const rejectionReasons = [
    { label: 'Too generic', key: '1' },
    { label: 'Not a concept', key: '2' },
    { label: 'Duplicate', key: '3' },
    { label: 'Wrong type', key: '4' },
    { label: 'Other', key: '5' },
  ];

  if (!currentEntity && !showAddEntity) {
    return (
      <div className="entity-review-overlay">
        <div className="entity-review-empty">
          <p>No entities to review</p>
          <button className="kg-btn kg-btn-primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="entity-review-overlay">
      {/* Header */}
      <div className="entity-review-header">
        <div className="entity-review-header-left">
          <button className="kg-icon-btn" onClick={onClose} title="Close (Escape)">
            <X size={20} />
          </button>
          <span className="entity-review-title">Entity Review</span>
          {noteTitle && (
            <span className="entity-review-note-title">for "{noteTitle}"</span>
          )}
        </div>

        <div className="entity-review-nav">
          <button
            className="kg-icon-btn"
            onClick={() => setCurrentIndex(prev => prev - 1)}
            disabled={currentIndex === 0}
            title="Previous (k)"
          >
            <ChevronLeft size={20} />
          </button>
          <span className="entity-review-counter">
            {currentIndex + 1} / {totalCount}
          </span>
          <button
            className="kg-icon-btn"
            onClick={() => setCurrentIndex(prev => prev + 1)}
            disabled={currentIndex === totalCount - 1}
            title="Next (j)"
          >
            <ChevronRight size={20} />
          </button>
        </div>

        <div className="entity-review-kbd-hints">
          <span className="entity-review-kbd-hint"><kbd>v</kbd> validate</span>
          <span className="entity-review-kbd-hint"><kbd>c</kbd> correct</span>
          <span className="entity-review-kbd-hint"><kbd>r</kbd> reject</span>
          <span className="entity-review-kbd-hint"><kbd>s</kbd> skip</span>
          {hasNoteContext && <span className="entity-review-kbd-hint"><kbd>+</kbd> add</span>}
        </div>
      </div>

      {/* Main content */}
      <div className="entity-review-content">
        {currentEntity && !showAddEntity && (
          <div className="entity-review-card">
            <div className="entity-review-entity-header">
              <span className="entity-review-entity-type">{currentEntity.type}</span>
              {currentEntity.extraction_confidence && (
                <span className="entity-review-confidence">
                  Confidence: {Math.round(currentEntity.extraction_confidence * 100)}%
                </span>
              )}
            </div>

            <h2 className="entity-review-entity-name">{currentEntity.name}</h2>

            {/* Provenance info */}
            {currentEntity.provenance && (
              <div className="entity-review-provenance">
                <span className="entity-review-provenance-source">
                  Source: {currentEntity.provenance.source || 'extraction'}
                </span>
                {currentEntity.provenance.extraction_model && (
                  <span className="entity-review-provenance-model">
                    Model: {currentEntity.provenance.extraction_model.split('/').pop()}
                  </span>
                )}
                {currentEntity.provenance.created_at && (
                  <span className="entity-review-provenance-date">
                    {new Date(currentEntity.provenance.created_at).toLocaleDateString()}
                  </span>
                )}
              </div>
            )}

            {currentEntity.mentions?.length > 0 && (
              <div className="entity-review-contexts">
                <h4>Source Contexts</h4>
                {currentEntity.mentions.slice(0, 3).map((mention, idx) => (
                  <div key={idx} className="entity-review-context">
                    "{mention.context}"
                  </div>
                ))}
              </div>
            )}

            <p className="entity-review-question">Is this entity correctly extracted?</p>
          </div>
        )}

        {/* Correction Mode */}
        {showCorrectionMode && (
          <div className="entity-review-correction">
            <h4>Correct Entity</h4>
            <div className="entity-review-field">
              <label>Name</label>
              <input
                type="text"
                value={correctedName}
                onChange={(e) => setCorrectedName(e.target.value)}
                autoFocus
              />
            </div>
            <div className="entity-review-field">
              <label>Type (press 1-5 to select)</label>
              <div className="entity-review-type-options">
                {entityTypes.map(et => (
                  <button
                    key={et.value}
                    className={`entity-review-type-btn ${correctedType === et.value ? 'active' : ''}`}
                    onClick={() => setCorrectedType(et.value)}
                  >
                    <kbd>{et.key}</kbd> {et.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="entity-review-correction-actions">
              <button className="kg-btn kg-btn-small" onClick={() => setShowCorrectionMode(false)}>
                Cancel
              </button>
              <button
                className="kg-btn kg-btn-small kg-btn-primary"
                onClick={handleCorrect}
                disabled={actionInProgress}
              >
                {actionInProgress ? <Loader size={14} className="kg-spinner" /> : 'Save Correction'}
              </button>
            </div>
          </div>
        )}

        {/* Rejection Mode */}
        {showRejectionInput && (
          <div className="entity-review-rejection">
            <h4>Rejection Reason (optional)</h4>
            <div className="entity-review-rejection-options">
              {rejectionReasons.map(rr => (
                <button
                  key={rr.key}
                  className={`entity-review-rejection-btn ${rejectionReason === rr.label ? 'active' : ''}`}
                  onClick={() => setRejectionReason(rr.label)}
                >
                  <kbd>{rr.key}</kbd> {rr.label}
                </button>
              ))}
            </div>
            <input
              type="text"
              className="entity-review-rejection-input"
              placeholder="Or type a custom reason..."
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
            />
            <div className="entity-review-rejection-actions">
              <button className="kg-btn kg-btn-small" onClick={() => setShowRejectionInput(false)}>
                Cancel
              </button>
              <button
                className="kg-btn kg-btn-small kg-btn-danger"
                onClick={handleReject}
                disabled={actionInProgress}
              >
                {actionInProgress ? <Loader size={14} className="kg-spinner" /> : 'Reject Entity'}
              </button>
            </div>
          </div>
        )}

        {/* Add Entity Mode */}
        {showAddEntity && (
          <div className="entity-review-add">
            <h4>Add Missing Entity</h4>
            <div className="entity-review-field">
              <label>Entity Name</label>
              <input
                type="text"
                value={newEntityName}
                onChange={(e) => setNewEntityName(e.target.value)}
                placeholder="Enter entity name..."
                autoFocus
              />
            </div>
            <div className="entity-review-field">
              <label>Type</label>
              <div className="entity-review-type-options">
                {entityTypes.map(et => (
                  <button
                    key={et.value}
                    className={`entity-review-type-btn ${newEntityType === et.value ? 'active' : ''}`}
                    onClick={() => setNewEntityType(et.value)}
                  >
                    {et.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="entity-review-field">
              <label>Context (optional)</label>
              <textarea
                value={newEntityContext}
                onChange={(e) => setNewEntityContext(e.target.value)}
                placeholder="Where does this entity appear in the note?"
                rows={2}
              />
            </div>
            <div className="entity-review-add-actions">
              <button className="kg-btn kg-btn-small" onClick={() => setShowAddEntity(false)}>
                Cancel
              </button>
              <button
                className="kg-btn kg-btn-small kg-btn-primary"
                onClick={handleAddEntity}
                disabled={actionInProgress || !newEntityName.trim()}
              >
                {actionInProgress ? <Loader size={14} className="kg-spinner" /> : <><Plus size={14} /> Add Entity</>}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Action bar */}
      {!showCorrectionMode && !showRejectionInput && !showAddEntity && (
        <div className="entity-review-actions">
          <button
            className="kg-btn kg-btn-success"
            onClick={handleValidate}
            disabled={actionInProgress}
            title="Validate (v)"
          >
            {actionInProgress ? <Loader size={16} className="kg-spinner" /> : <Check size={16} />}
            Validate
          </button>
          <button
            className="kg-btn kg-btn-secondary"
            onClick={() => setShowCorrectionMode(true)}
            title="Correct (c)"
          >
            <Edit3 size={16} />
            Correct
          </button>
          <button
            className="kg-btn kg-btn-danger"
            onClick={() => setShowRejectionInput(true)}
            title="Reject (r)"
          >
            <XCircle size={16} />
            Reject
          </button>
          {hasNoteContext && (
            <button
              className="kg-btn kg-btn-secondary"
              onClick={() => setShowAddEntity(true)}
              title="Add Missing (+)"
            >
              <Plus size={16} />
              Add Missing
            </button>
          )}
        </div>
      )}
    </div>
  );
}
