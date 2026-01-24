import React, { useState, useEffect, useCallback } from 'react';
import { Link2, Loader, AlertCircle, RefreshCw } from 'lucide-react';
import { api } from '../api';
import RelationshipReviewMode from './RelationshipReviewMode';

/**
 * RelationshipsReviewPanel - Panel for reviewing extracted relationships
 *
 * Handles:
 * - Loading unvalidated relationships
 * - Empty state when no relationships to review
 * - Error handling
 * - Launches RelationshipReviewMode when relationships are available
 */
export default function RelationshipsReviewPanel({
  onRefreshGraph,
  onClose,
}) {
  const [relationships, setRelationships] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Load unvalidated relationships
  const loadRelationships = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await api.getUnvalidatedRelationships(50);
      // API returns {relationships: [...]} so extract the array
      setRelationships(result?.relationships || []);
    } catch (err) {
      console.error('Failed to load relationships:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRelationships();
  }, [loadRelationships]);

  // Handle relationship update from review mode
  const handleRelationshipUpdated = (relationshipId, updates) => {
    if (updates.status === 'validated' || updates.status === 'rejected') {
      setRelationships(prev => prev.filter(r => r.id !== relationshipId));
    }
    if (onRefreshGraph) onRefreshGraph();
  };

  // Handle close from RelationshipReviewMode
  const handleReviewClose = () => {
    if (onClose) onClose();
  };

  // Loading state
  if (loading) {
    return (
      <div className="relationships-review-panel">
        <div className="relationships-review-loading">
          <Loader size={32} className="kg-spinner" />
          <p>Loading relationships for review...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="relationships-review-panel">
        <div className="relationships-review-error">
          <AlertCircle size={32} />
          <p>Failed to load relationships</p>
          <p className="relationships-review-error-detail">{error}</p>
          <button className="kg-btn kg-btn-primary" onClick={loadRelationships}>
            <RefreshCw size={14} /> Retry
          </button>
        </div>
      </div>
    );
  }

  // Empty state
  if (relationships.length === 0) {
    return (
      <div className="relationships-review-panel">
        <div className="relationships-review-empty">
          <Link2 size={48} strokeWidth={1} />
          <h3>No unvalidated relationships</h3>
          <p>All extracted relationships have been reviewed.</p>
          <p className="relationships-review-empty-hint">
            New relationships will appear here when notes are processed by the Synthesizer.
          </p>
          <button className="kg-btn kg-btn-secondary" onClick={loadRelationships}>
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
      </div>
    );
  }

  // Render RelationshipReviewMode with relationships
  return (
    <RelationshipReviewMode
      relationships={relationships}
      onRelationshipUpdated={handleRelationshipUpdated}
      onClose={handleReviewClose}
    />
  );
}
