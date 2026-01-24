import React, { useState, useEffect, useCallback } from 'react';
import { X, ChevronLeft, ChevronRight, Check, XCircle, RefreshCw, Loader, ArrowRight } from 'lucide-react';
import { api } from '../api';

/**
 * RelationshipReviewMode - Full-screen keyboard-driven interface for reviewing relationships
 *
 * Features:
 * - Validate, reject, or correct relationship type
 * - Keyboard navigation (v/r/t/s)
 * - Visual graph representation of relationship
 * - Progress tracking
 */
export default function RelationshipReviewMode({
  relationships,
  onRelationshipUpdated,
  onClose,
}) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [actionInProgress, setActionInProgress] = useState(false);
  const [showTypeCorrection, setShowTypeCorrection] = useState(false);
  const [selectedType, setSelectedType] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [showRejectionInput, setShowRejectionInput] = useState(false);

  const currentRelationship = relationships[currentIndex];
  const totalCount = relationships.length;

  // Relationship types
  const relationshipTypes = [
    { value: 'specialization_of', label: 'Specialization Of', key: '1' },
    { value: 'builds_on', label: 'Builds On', key: '2' },
    { value: 'enabled_by', label: 'Enabled By', key: '3' },
    { value: 'contrasts_with', label: 'Contrasts With', key: '4' },
    { value: 'applies_to', label: 'Applies To', key: '5' },
    { value: 'created_by', label: 'Created By', key: '6' },
    { value: 'related_to', label: 'Related To', key: '7' },
    { value: 'part_of', label: 'Part Of', key: '8' },
  ];

  const rejectionReasons = [
    { label: 'Too generic', key: '1' },
    { label: 'Wrong direction', key: '2' },
    { label: 'Not actually related', key: '3' },
    { label: 'Duplicate relationship', key: '4' },
    { label: 'Other', key: '5' },
  ];

  // Reset state when relationship changes
  useEffect(() => {
    setShowTypeCorrection(false);
    setSelectedType(currentRelationship?.type || '');
    setRejectionReason('');
    setShowRejectionInput(false);
  }, [currentIndex, currentRelationship]);

  // Handle validate
  const handleValidate = useCallback(async () => {
    if (!currentRelationship || actionInProgress) return;

    setActionInProgress(true);
    try {
      await api.validateRelationship(currentRelationship.id, 'validate');
      onRelationshipUpdated?.(currentRelationship.id, { status: 'validated' });

      // Move to next or close
      if (currentIndex >= totalCount - 1) {
        if (totalCount <= 1) {
          onClose();
        } else {
          setCurrentIndex(prev => prev - 1);
        }
      }
    } catch (err) {
      console.error('Failed to validate relationship:', err);
    } finally {
      setActionInProgress(false);
    }
  }, [currentRelationship, actionInProgress, currentIndex, totalCount, onRelationshipUpdated, onClose]);

  // Handle type correction
  const handleCorrectType = useCallback(async () => {
    if (!currentRelationship || actionInProgress) return;

    if (!showTypeCorrection) {
      setShowTypeCorrection(true);
      setSelectedType(currentRelationship.type);
      return;
    }

    if (!selectedType) return;

    setActionInProgress(true);
    try {
      await api.validateRelationship(currentRelationship.id, 'correct_type', {
        new_type: selectedType,
      });
      onRelationshipUpdated?.(currentRelationship.id, { status: 'validated', type: selectedType });

      // Move to next or close
      setShowTypeCorrection(false);
      if (currentIndex >= totalCount - 1) {
        if (totalCount <= 1) {
          onClose();
        } else {
          setCurrentIndex(prev => prev - 1);
        }
      }
    } catch (err) {
      console.error('Failed to correct relationship type:', err);
    } finally {
      setActionInProgress(false);
    }
  }, [currentRelationship, actionInProgress, showTypeCorrection, selectedType, currentIndex, totalCount, onRelationshipUpdated, onClose]);

  // Handle reject
  const handleReject = useCallback(async () => {
    if (!currentRelationship || actionInProgress) return;

    if (!showRejectionInput) {
      setShowRejectionInput(true);
      return;
    }

    setActionInProgress(true);
    try {
      await api.validateRelationship(currentRelationship.id, 'reject', {
        reason: rejectionReason || null,
      });
      onRelationshipUpdated?.(currentRelationship.id, { status: 'rejected' });

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
      console.error('Failed to reject relationship:', err);
    } finally {
      setActionInProgress(false);
    }
  }, [currentRelationship, actionInProgress, showRejectionInput, rejectionReason, currentIndex, totalCount, onRelationshipUpdated, onClose]);

  // Keyboard navigation
  const handleKeyDown = useCallback((e) => {
    // Don't handle keys when typing in inputs
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
      if (e.key === 'Escape') {
        e.target.blur();
        setShowTypeCorrection(false);
        setShowRejectionInput(false);
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (showTypeCorrection) handleCorrectType();
        if (showRejectionInput) handleReject();
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
        if (!actionInProgress && !showTypeCorrection && !showRejectionInput) {
          handleValidate();
        }
        break;
      case 't':
        if (!actionInProgress && !showRejectionInput) {
          handleCorrectType();
        }
        break;
      case 'r':
        if (!actionInProgress && !showTypeCorrection) {
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
      case 'Escape':
        e.preventDefault();
        if (showTypeCorrection) {
          setShowTypeCorrection(false);
        } else if (showRejectionInput) {
          setShowRejectionInput(false);
        } else {
          onClose();
        }
        break;
      default:
        // Number keys for quick rejection reasons
        if (showRejectionInput && e.key >= '1' && e.key <= '5') {
          const idx = parseInt(e.key) - 1;
          setRejectionReason(rejectionReasons[idx].label);
        }
        // Number keys for relationship type in correction mode
        if (showTypeCorrection && e.key >= '1' && e.key <= '8') {
          const idx = parseInt(e.key) - 1;
          if (relationshipTypes[idx]) {
            setSelectedType(relationshipTypes[idx].value);
          }
        }
        break;
    }
  }, [currentIndex, totalCount, actionInProgress, showTypeCorrection, showRejectionInput, onClose, handleValidate, handleCorrectType, handleReject, rejectionReasons, relationshipTypes]);

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

  // Format relationship type for display
  const formatRelType = (type) => {
    return type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  };

  if (!currentRelationship) {
    return (
      <div className="relationship-review-overlay">
        <div className="relationship-review-empty">
          <p>No relationships to review</p>
          <button className="kg-btn kg-btn-primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relationship-review-overlay">
      {/* Header */}
      <div className="relationship-review-header">
        <div className="relationship-review-header-left">
          <button className="kg-icon-btn" onClick={onClose} title="Close (Escape)">
            <X size={20} />
          </button>
          <span className="relationship-review-title">Relationship Review</span>
        </div>

        <div className="relationship-review-nav">
          <button
            className="kg-icon-btn"
            onClick={() => setCurrentIndex(prev => prev - 1)}
            disabled={currentIndex === 0}
            title="Previous (k)"
          >
            <ChevronLeft size={20} />
          </button>
          <span className="relationship-review-counter">
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

        <div className="relationship-review-kbd-hints">
          <span className="relationship-review-kbd-hint"><kbd>v</kbd> validate</span>
          <span className="relationship-review-kbd-hint"><kbd>t</kbd> change type</span>
          <span className="relationship-review-kbd-hint"><kbd>r</kbd> reject</span>
          <span className="relationship-review-kbd-hint"><kbd>s</kbd> skip</span>
        </div>
      </div>

      {/* Main content */}
      <div className="relationship-review-content">
        <div className="relationship-review-card">
          {/* Visual representation */}
          <div className="relationship-review-visual">
            <div className="relationship-review-entity">
              <span className="relationship-review-entity-name">
                {currentRelationship.source_entity_name}
              </span>
            </div>
            <div className="relationship-review-connector">
              <ArrowRight size={24} />
              <span className="relationship-review-type">
                {formatRelType(currentRelationship.type)}
              </span>
            </div>
            <div className="relationship-review-entity">
              <span className="relationship-review-entity-name">
                {currentRelationship.target_entity_name}
              </span>
            </div>
          </div>

          {/* Provenance info */}
          {currentRelationship.provenance && (
            <div className="relationship-review-provenance">
              <span>Source: {currentRelationship.provenance.source || 'extraction'}</span>
              {currentRelationship.provenance.source_note && (
                <span>From note: {currentRelationship.provenance.source_note}</span>
              )}
            </div>
          )}

          <p className="relationship-review-question">
            Is this relationship correctly extracted?
          </p>
        </div>

        {/* Type Correction Mode */}
        {showTypeCorrection && (
          <div className="relationship-review-correction">
            <h4>Change Relationship Type</h4>
            <div className="relationship-review-type-options">
              {relationshipTypes.map(rt => (
                <button
                  key={rt.value}
                  className={`relationship-review-type-btn ${selectedType === rt.value ? 'active' : ''}`}
                  onClick={() => setSelectedType(rt.value)}
                >
                  <kbd>{rt.key}</kbd> {rt.label}
                </button>
              ))}
            </div>
            <div className="relationship-review-correction-actions">
              <button className="kg-btn kg-btn-small" onClick={() => setShowTypeCorrection(false)}>
                Cancel
              </button>
              <button
                className="kg-btn kg-btn-small kg-btn-primary"
                onClick={handleCorrectType}
                disabled={actionInProgress || !selectedType}
              >
                {actionInProgress ? <Loader size={14} className="kg-spinner" /> : 'Save Type'}
              </button>
            </div>
          </div>
        )}

        {/* Rejection Mode */}
        {showRejectionInput && (
          <div className="relationship-review-rejection">
            <h4>Rejection Reason (optional)</h4>
            <div className="relationship-review-rejection-options">
              {rejectionReasons.map(rr => (
                <button
                  key={rr.key}
                  className={`relationship-review-rejection-btn ${rejectionReason === rr.label ? 'active' : ''}`}
                  onClick={() => setRejectionReason(rr.label)}
                >
                  <kbd>{rr.key}</kbd> {rr.label}
                </button>
              ))}
            </div>
            <input
              type="text"
              className="relationship-review-rejection-input"
              placeholder="Or type a custom reason..."
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
            />
            <div className="relationship-review-rejection-actions">
              <button className="kg-btn kg-btn-small" onClick={() => setShowRejectionInput(false)}>
                Cancel
              </button>
              <button
                className="kg-btn kg-btn-small kg-btn-danger"
                onClick={handleReject}
                disabled={actionInProgress}
              >
                {actionInProgress ? <Loader size={14} className="kg-spinner" /> : 'Reject Relationship'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Action bar */}
      {!showTypeCorrection && !showRejectionInput && (
        <div className="relationship-review-actions">
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
            onClick={() => setShowTypeCorrection(true)}
            title="Change Type (t)"
          >
            <RefreshCw size={16} />
            Change Type
          </button>
          <button
            className="kg-btn kg-btn-danger"
            onClick={() => setShowRejectionInput(true)}
            title="Reject (r)"
          >
            <XCircle size={16} />
            Reject
          </button>
        </div>
      )}
    </div>
  );
}
