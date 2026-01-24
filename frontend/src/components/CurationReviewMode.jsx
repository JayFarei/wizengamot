import React, { useState, useEffect, useCallback } from 'react';
import { X, ChevronLeft, ChevronRight, Check, XCircle, GitMerge, Link2, AlertTriangle, ArrowRight, Loader, Brain, MessageSquare } from 'lucide-react';
import { api } from '../api';

/**
 * CurationReviewMode - Full-screen immersive review interface for curation candidates
 *
 * Features:
 * - Full-screen overlay
 * - Before/After layout for merge and relationship candidates
 * - Agent reasoning display with confidence indicator
 * - Three-way classification support: SAME (merge), RELATED (link), UNRELATED (dismiss)
 * - Keyboard navigation (j/k/a/m/d/t/Escape)
 * - Override tracking when user disagrees with agent
 */
export default function CurationReviewMode({
  candidates,
  initialIndex = 0,
  onAction,
  onDismiss,
  onClose,
}) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [actionInProgress, setActionInProgress] = useState(false);
  const [showCheckmark, setShowCheckmark] = useState(false);
  const [selectedRelationType, setSelectedRelationType] = useState('related');
  const [showOverrideReason, setShowOverrideReason] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const [pendingAction, setPendingAction] = useState(null);

  const currentCandidate = candidates[currentIndex];
  const totalCount = candidates.length;

  // Check if this candidate has agent analysis
  const hasAgentAnalysis = currentCandidate?.agent_decision != null;
  const agentDecision = currentCandidate?.agent_decision?.decision;
  const agentConfidence = currentCandidate?.agent_confidence || currentCandidate?.agent_decision?.confidence || 0;
  const agentReasoning = currentCandidate?.agent_reasoning || currentCandidate?.agent_decision?.reasoning || currentCandidate?.reasoning;

  // Reset state when candidate changes
  useEffect(() => {
    if (currentCandidate?.relationship_type) {
      setSelectedRelationType(currentCandidate.relationship_type);
    } else if (currentCandidate?.suggested_relationship_type) {
      setSelectedRelationType(currentCandidate.suggested_relationship_type);
    } else {
      setSelectedRelationType('related');
    }
    setShowOverrideReason(false);
    setOverrideReason('');
    setPendingAction(null);
  }, [currentIndex, currentCandidate]);

  // Record feedback for agent learning
  const recordFeedback = useCallback(async (userAction) => {
    if (!hasAgentAnalysis || !currentCandidate) return;

    const agentDecisionType = currentCandidate.agent_decision?.decision;
    const userDecisionType = {
      'merge': 'same',
      'create_relationship': 'related',
      'dismiss': 'unrelated',
    }[userAction] || userAction;

    // Only record if there's a discrepancy
    if (agentDecisionType && agentDecisionType !== userDecisionType) {
      try {
        await api.recordAgentFeedback({
          candidateId: currentCandidate.id,
          agentDecision: agentDecisionType,
          agentReasoning: agentReasoning,
          userAction: userAction,
          overrideReason: overrideReason || null,
        });
      } catch (err) {
        console.error('Failed to record agent feedback:', err);
      }
    }
  }, [hasAgentAnalysis, currentCandidate, agentReasoning, overrideReason]);

  // Execute action
  const executeAction = useCallback(async (action, params = {}) => {
    if (!currentCandidate || actionInProgress) return;

    // Check if this is an override of agent suggestion
    const userDecisionType = {
      'merge': 'same',
      'create_relationship': 'related',
      'dismiss': 'unrelated',
    }[action];

    const isOverride = hasAgentAnalysis && agentDecision && agentDecision !== userDecisionType;

    // If overriding agent without reason, prompt for one
    if (isOverride && !overrideReason && !showOverrideReason) {
      setShowOverrideReason(true);
      setPendingAction({ action, params });
      return;
    }

    setActionInProgress(true);
    setShowCheckmark(true);

    // Wait for animation
    await new Promise(resolve => setTimeout(resolve, 400));

    // Calculate next index before action
    const nextIndex = currentIndex >= totalCount - 1
      ? Math.max(0, currentIndex - 1)
      : currentIndex;
    const shouldClose = totalCount <= 1;

    // Record feedback
    await recordFeedback(action);

    // Fire action
    onAction(currentCandidate, action, params);

    // Clear animation and transition
    setShowCheckmark(false);
    setActionInProgress(false);
    setShowOverrideReason(false);
    setOverrideReason('');
    setPendingAction(null);

    // Handle navigation
    if (shouldClose) {
      onClose();
    } else {
      setCurrentIndex(nextIndex);
    }
  }, [currentCandidate, actionInProgress, currentIndex, totalCount, hasAgentAnalysis, agentDecision, overrideReason, showOverrideReason, recordFeedback, onAction, onClose]);

  // Accept agent suggestion
  const handleAcceptAgent = useCallback(async () => {
    if (!currentCandidate || actionInProgress || !hasAgentAnalysis) return;

    let action = 'dismiss';
    let params = {};

    if (agentDecision === 'same') {
      action = 'merge';
      params = {
        canonical_id: currentCandidate.entities[0],
        merge_ids: currentCandidate.entities.slice(1),
      };
    } else if (agentDecision === 'related') {
      action = 'create_relationship';
      params = {
        source_id: currentCandidate.entities[0],
        target_id: currentCandidate.entities[1],
        relationship_type: currentCandidate.suggested_relationship_type || selectedRelationType,
      };
    }

    await executeAction(action, params);
  }, [currentCandidate, actionInProgress, hasAgentAnalysis, agentDecision, selectedRelationType, executeAction]);

  // Override: Merge entities
  const handleMerge = useCallback(async () => {
    if (!currentCandidate || actionInProgress) return;

    await executeAction('merge', {
      canonical_id: currentCandidate.entities[0],
      merge_ids: currentCandidate.entities.slice(1),
    });
  }, [currentCandidate, actionInProgress, executeAction]);

  // Override: Create relationship
  const handleCreateRelationship = useCallback(async () => {
    if (!currentCandidate || actionInProgress) return;

    await executeAction('create_relationship', {
      source_id: currentCandidate.entities[0],
      target_id: currentCandidate.entities[1],
      relationship_type: selectedRelationType,
    });
  }, [currentCandidate, actionInProgress, selectedRelationType, executeAction]);

  // Handle dismiss
  const handleDismiss = useCallback(async () => {
    if (!currentCandidate || actionInProgress) return;

    // Check for override
    const isOverride = hasAgentAnalysis && agentDecision && agentDecision !== 'unrelated';
    if (isOverride && !overrideReason && !showOverrideReason) {
      setShowOverrideReason(true);
      setPendingAction({ action: 'dismiss', params: {} });
      return;
    }

    await recordFeedback('dismiss');
    await onDismiss(currentCandidate);

    setShowOverrideReason(false);
    setOverrideReason('');

    if (totalCount <= 1) {
      onClose();
    } else if (currentIndex >= totalCount - 1) {
      setCurrentIndex(prev => Math.max(0, prev - 1));
    }
  }, [currentCandidate, actionInProgress, hasAgentAnalysis, agentDecision, overrideReason, showOverrideReason, totalCount, currentIndex, recordFeedback, onDismiss, onClose]);

  // Submit override with reason
  const handleSubmitOverride = useCallback(async () => {
    if (!pendingAction) return;
    await executeAction(pendingAction.action, pendingAction.params);
  }, [pendingAction, executeAction]);

  // Skip override reason
  const handleSkipOverrideReason = useCallback(async () => {
    if (!pendingAction) return;
    await executeAction(pendingAction.action, pendingAction.params);
  }, [pendingAction, executeAction]);

  // Keyboard navigation
  const handleKeyDown = useCallback((e) => {
    // Don't handle keys when typing in inputs
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') {
      if (e.key === 'Escape') {
        e.target.blur();
        setShowOverrideReason(false);
        setPendingAction(null);
      }
      if (e.key === 'Enter' && showOverrideReason) {
        e.preventDefault();
        handleSubmitOverride();
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
      case 'a':
        // Accept agent suggestion
        if (!actionInProgress && hasAgentAnalysis) handleAcceptAgent();
        break;
      case 'm':
        // Override: Merge
        if (!actionInProgress) handleMerge();
        break;
      case 'l':
        // Override: Create link/relationship
        if (!actionInProgress) handleCreateRelationship();
        break;
      case 'd':
        // Dismiss
        handleDismiss();
        break;
      case 't':
        // Cycle through relationship types
        if (currentCandidate?.rubric === 'duplicate' || currentCandidate?.rubric === 'missing_relationship') {
          const types = ['specialization_of', 'enabled_by', 'builds_on', 'contrasts_with', 'applies_to', 'created_by', 'related'];
          const currentIdx = types.indexOf(selectedRelationType);
          setSelectedRelationType(types[(currentIdx + 1) % types.length]);
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
        e.stopPropagation();
        if (showOverrideReason) {
          setShowOverrideReason(false);
          setPendingAction(null);
        } else {
          onClose();
        }
        break;
      default:
        // Number keys 1-6 for quick relationship type selection
        if (e.key >= '1' && e.key <= '6') {
          const types = ['specialization_of', 'builds_on', 'enabled_by', 'contrasts_with', 'applies_to', 'created_by'];
          const idx = parseInt(e.key) - 1;
          if (idx < types.length) {
            setSelectedRelationType(types[idx]);
          }
        }
        break;
    }
  }, [currentIndex, totalCount, actionInProgress, hasAgentAnalysis, showOverrideReason, selectedRelationType, currentCandidate, onClose, handleAcceptAgent, handleMerge, handleCreateRelationship, handleDismiss, handleSubmitOverride]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [handleKeyDown]);

  // Prevent body scroll when modal is open
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  const goToPrev = () => {
    if (currentIndex > 0) setCurrentIndex(prev => prev - 1);
  };

  const goToNext = () => {
    if (currentIndex < totalCount - 1) setCurrentIndex(prev => prev + 1);
  };

  // Get icon for rubric type
  const getRubricIcon = (rubric) => {
    switch (rubric) {
      case 'duplicate':
        return <GitMerge size={16} />;
      case 'missing_relationship':
        return <Link2 size={16} />;
      case 'suspect_relationship':
        return <AlertTriangle size={16} />;
      default:
        return null;
    }
  };

  // Get label for rubric type
  const getRubricLabel = (rubric) => {
    switch (rubric) {
      case 'duplicate':
        return 'Structure Review';
      case 'missing_relationship':
        return 'Missing Relationship';
      case 'suspect_relationship':
        return 'Suspect Relationship';
      default:
        return 'Review';
    }
  };

  // Get agent decision label
  const getAgentDecisionLabel = (decision) => {
    switch (decision) {
      case 'same':
        return 'Merge (Same Concept)';
      case 'related':
        return 'Link (Related Concepts)';
      case 'unrelated':
        return 'Dismiss (Unrelated)';
      default:
        return 'Unknown';
    }
  };

  // Get confidence color
  const getConfidenceColor = (confidence) => {
    if (confidence >= 0.8) return 'var(--color-success)';
    if (confidence >= 0.6) return 'var(--color-warning)';
    return 'var(--color-danger)';
  };

  // Relationship type options
  const relationshipTypes = [
    { value: 'specialization_of', label: 'is a form of', key: '1' },
    { value: 'builds_on', label: 'builds on', key: '2' },
    { value: 'enabled_by', label: 'is enabled by', key: '3' },
    { value: 'contrasts_with', label: 'contrasts with', key: '4' },
    { value: 'applies_to', label: 'applies to', key: '5' },
    { value: 'created_by', label: 'was created by', key: '6' },
    { value: 'related', label: 'is related to', key: '' },
  ];

  // Render before panel
  const renderBeforePanel = () => {
    if (!currentCandidate) return null;

    const canonical = currentCandidate.evidence?.find(e => e.type === 'canonical') || {};
    const mergeTarget = currentCandidate.evidence?.find(e => e.type === 'merge_target') || {};

    return (
      <div className="curation-before-content">
        <div className="curation-entity-card">
          <div className="curation-entity-label">Entity A</div>
          <div className="curation-entity-name">{currentCandidate.entity_names[0]}</div>
          <div className="curation-entity-meta">
            <span className="curation-mention-count">{canonical.mention_count || 0} mentions</span>
          </div>
        </div>

        <div className="curation-entity-card">
          <div className="curation-entity-label">Entity B</div>
          <div className="curation-entity-name">{currentCandidate.entity_names[1]}</div>
          <div className="curation-entity-meta">
            <span className="curation-mention-count">{mergeTarget.mention_count || 0} mentions</span>
          </div>
        </div>
      </div>
    );
  };

  // Render after panel based on agent suggestion
  const renderAfterPanel = () => {
    if (!currentCandidate) return null;

    const canonical = currentCandidate.evidence?.find(e => e.type === 'canonical') || {};
    const mergeTarget = currentCandidate.evidence?.find(e => e.type === 'merge_target') || {};
    const totalMentions = (canonical.mention_count || 0) + (mergeTarget.mention_count || 0);

    // For agent-analyzed candidates, show what the agent suggests
    if (hasAgentAnalysis) {
      if (agentDecision === 'same') {
        return (
          <div className="curation-after-content">
            <div className="curation-merged-entity-card">
              <div className="curation-entity-label">Merged Entity</div>
              <div className="curation-entity-name">{currentCandidate.entity_names[0]}</div>
              <div className="curation-entity-meta">
                <span className="curation-mention-count">{totalMentions} mentions (combined)</span>
              </div>
              <div className="curation-aliases">
                <span className="curation-alias-label">Aliases:</span>
                <span className="curation-alias">{currentCandidate.entity_names[1]}</span>
              </div>
            </div>
          </div>
        );
      }

      if (agentDecision === 'related') {
        const suggestedType = currentCandidate.suggested_relationship_type || selectedRelationType;
        const direction = currentCandidate.suggested_relationship_direction;

        return (
          <div className="curation-after-content">
            <div className="curation-entity-card">
              <div className="curation-entity-name">
                {direction === 'b_to_a' ? currentCandidate.entity_names[1] : currentCandidate.entity_names[0]}
              </div>
            </div>

            <div className="curation-new-link">
              <select
                value={selectedRelationType}
                onChange={(e) => setSelectedRelationType(e.target.value)}
                className="curation-relationship-select"
              >
                {relationshipTypes.map(rt => (
                  <option key={rt.value} value={rt.value}>
                    {rt.label} {rt.key && `[${rt.key}]`}
                  </option>
                ))}
              </select>
            </div>

            <div className="curation-entity-card">
              <div className="curation-entity-name">
                {direction === 'b_to_a' ? currentCandidate.entity_names[0] : currentCandidate.entity_names[1]}
              </div>
            </div>
          </div>
        );
      }

      if (agentDecision === 'unrelated') {
        return (
          <div className="curation-after-content">
            <div className="curation-dismissed-card">
              <div className="curation-dismissed-label">No Action Needed</div>
              <p>These entities are distinct and unrelated. No merge or link will be created.</p>
            </div>
          </div>
        );
      }
    }

    // Fallback for non-agent candidates
    if (currentCandidate.rubric === 'duplicate') {
      return (
        <div className="curation-after-content">
          <div className="curation-merged-entity-card">
            <div className="curation-entity-label">Merged Entity</div>
            <div className="curation-entity-name">{currentCandidate.entity_names[0]}</div>
            <div className="curation-entity-meta">
              <span className="curation-mention-count">{totalMentions} mentions (combined)</span>
            </div>
            <div className="curation-aliases">
              <span className="curation-alias-label">Aliases:</span>
              <span className="curation-alias">{currentCandidate.entity_names[1]}</span>
            </div>
          </div>
        </div>
      );
    }

    if (currentCandidate.rubric === 'missing_relationship') {
      return (
        <div className="curation-after-content">
          <div className="curation-entity-card">
            <div className="curation-entity-name">{currentCandidate.entity_names[0]}</div>
          </div>

          <div className="curation-new-link">
            <select
              value={selectedRelationType}
              onChange={(e) => setSelectedRelationType(e.target.value)}
              className="curation-relationship-select"
            >
              {relationshipTypes.map(rt => (
                <option key={rt.value} value={rt.value}>{rt.label}</option>
              ))}
            </select>
          </div>

          <div className="curation-entity-card">
            <div className="curation-entity-name">{currentCandidate.entity_names[1]}</div>
          </div>
        </div>
      );
    }

    if (currentCandidate.rubric === 'suspect_relationship') {
      return (
        <div className="curation-after-content">
          <div className="curation-entity-card">
            <div className="curation-entity-name">{currentCandidate.entity_names[0]}</div>
          </div>

          <div className="curation-removed-link">
            <span>Relationship removed</span>
          </div>

          <div className="curation-entity-card">
            <div className="curation-entity-name">{currentCandidate.entity_names[1]}</div>
          </div>
        </div>
      );
    }

    return null;
  };

  if (!currentCandidate) {
    return (
      <div className="curation-review-overlay">
        <div className="curation-review-empty">
          <p>No curation candidates to review</p>
          <button className="kg-btn kg-btn-primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="curation-review-overlay">
      {/* Header */}
      <div className="curation-review-header">
        <div className="curation-review-header-left">
          <button className="kg-icon-btn" onClick={onClose} title="Close (Escape)">
            <X size={20} />
          </button>
          <span className="curation-review-title">Curate Graph</span>
          <span className={`curation-rubric-badge curation-rubric-${currentCandidate.rubric}`}>
            {getRubricIcon(currentCandidate.rubric)}
            {getRubricLabel(currentCandidate.rubric)}
          </span>
        </div>

        <div className="curation-review-nav">
          <button
            className="kg-icon-btn"
            onClick={goToPrev}
            disabled={currentIndex === 0}
            title="Previous (k)"
          >
            <ChevronLeft size={20} />
          </button>
          <span className="curation-review-counter">
            {currentIndex + 1} / {totalCount}
          </span>
          <button
            className="kg-icon-btn"
            onClick={goToNext}
            disabled={currentIndex === totalCount - 1}
            title="Next (j)"
          >
            <ChevronRight size={20} />
          </button>
        </div>

        <div className="curation-review-kbd-hints">
          <span className="curation-kbd-hint"><kbd>j</kbd>/<kbd>k</kbd> nav</span>
          {hasAgentAnalysis && <span className="curation-kbd-hint"><kbd>a</kbd> accept</span>}
          <span className="curation-kbd-hint"><kbd>m</kbd> merge</span>
          <span className="curation-kbd-hint"><kbd>l</kbd> link</span>
          <span className="curation-kbd-hint"><kbd>d</kbd> dismiss</span>
          <span className="curation-kbd-hint"><kbd>t</kbd> type</span>
        </div>
      </div>

      {/* Agent Analysis Section */}
      {hasAgentAnalysis && (
        <div className="curation-agent-section">
          <div className="curation-agent-header">
            <Brain size={16} />
            <span>Agent Analysis</span>
            <span
              className="curation-agent-confidence"
              style={{ color: getConfidenceColor(agentConfidence) }}
            >
              {Math.round(agentConfidence * 100)}% confident
            </span>
          </div>
          <div className="curation-agent-decision">
            <span className={`curation-agent-decision-badge curation-decision-${agentDecision}`}>
              {getAgentDecisionLabel(agentDecision)}
            </span>
            {currentCandidate.suggested_relationship_type && agentDecision === 'related' && (
              <span className="curation-agent-rel-type">
                Suggested: {currentCandidate.suggested_relationship_type}
              </span>
            )}
          </div>
          <div className="curation-agent-reasoning">
            <MessageSquare size={14} />
            <p>{agentReasoning}</p>
          </div>
        </div>
      )}

      {/* Main content - Before/After layout */}
      <div className="curation-review-content">
        {/* Before panel */}
        <div className="curation-panel curation-before-panel">
          {showCheckmark && (
            <div className="curation-approval-overlay">
              <div className="curation-approval-checkmark">
                <Check size={64} />
              </div>
            </div>
          )}
          <h3>Current State</h3>
          {renderBeforePanel()}
        </div>

        {/* Arrow between panels */}
        <div className="curation-arrow">
          <ArrowRight size={32} />
        </div>

        {/* After panel */}
        <div className="curation-panel curation-after-panel">
          <h3>{hasAgentAnalysis ? 'Agent Suggestion' : 'After Action'}</h3>
          {renderAfterPanel()}
        </div>
      </div>

      {/* Relationship Type Selection (for related/missing_relationship) */}
      {(agentDecision === 'related' || currentCandidate.rubric === 'missing_relationship' || currentCandidate.rubric === 'duplicate') && (
        <div className="curation-relationship-types">
          <span className="curation-rt-label">Relationship Type (if linking):</span>
          <div className="curation-rt-options">
            {relationshipTypes.filter(rt => rt.key).map(rt => (
              <button
                key={rt.value}
                className={`curation-rt-btn ${selectedRelationType === rt.value ? 'active' : ''}`}
                onClick={() => setSelectedRelationType(rt.value)}
                title={`Press ${rt.key} to select`}
              >
                <kbd>{rt.key}</kbd> {rt.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Override Reason Input */}
      {showOverrideReason && (
        <div className="curation-override-section">
          <div className="curation-override-header">
            <AlertTriangle size={16} />
            <span>You're overriding the agent's suggestion</span>
          </div>
          <input
            type="text"
            className="curation-override-input"
            placeholder="Why are you overriding? (optional but helps improve the agent)"
            value={overrideReason}
            onChange={(e) => setOverrideReason(e.target.value)}
            autoFocus
          />
          <div className="curation-override-actions">
            <button className="kg-btn kg-btn-small" onClick={handleSkipOverrideReason}>
              Skip
            </button>
            <button className="kg-btn kg-btn-small kg-btn-primary" onClick={handleSubmitOverride}>
              Continue
            </button>
          </div>
        </div>
      )}

      {/* Action bar */}
      <div className="curation-review-actions">
        {hasAgentAnalysis && (
          <button
            className="kg-btn kg-btn-primary"
            onClick={handleAcceptAgent}
            disabled={actionInProgress}
            title="Accept Agent Suggestion (a)"
          >
            {actionInProgress ? <Loader size={16} className="kg-spinner" /> : <Check size={16} />}
            Accept Suggestion
          </button>
        )}
        <button
          className="kg-btn kg-btn-secondary"
          onClick={handleMerge}
          disabled={actionInProgress}
          title="Override: Merge (m)"
        >
          <GitMerge size={16} />
          Merge
        </button>
        <button
          className="kg-btn kg-btn-secondary"
          onClick={handleCreateRelationship}
          disabled={actionInProgress}
          title="Override: Create Link (l)"
        >
          <Link2 size={16} />
          Link
        </button>
        <button
          className="kg-btn kg-btn-danger"
          onClick={handleDismiss}
          title="Dismiss (d)"
        >
          <XCircle size={16} />
          Dismiss
        </button>
      </div>
    </div>
  );
}
