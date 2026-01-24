import React, { useState, useEffect, useCallback } from 'react';
import { Layers, Loader, AlertCircle, RefreshCw } from 'lucide-react';
import { api } from '../api';
import EntityReviewMode from './EntityReviewMode';

/**
 * EntitiesReviewPanel - Panel for reviewing extracted entities
 *
 * Handles:
 * - Loading unvalidated entities
 * - Empty state when no entities to review
 * - Error handling
 * - Launches EntityReviewMode when entities are available
 */
export default function EntitiesReviewPanel({
  onRefreshGraph,
  onClose,
}) {
  const [entities, setEntities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Load unvalidated entities
  const loadEntities = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await api.getUnvalidatedEntities(50);
      // API returns {entities: [...]} so extract the array
      setEntities(result?.entities || []);
    } catch (err) {
      console.error('Failed to load entities:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadEntities();
  }, [loadEntities]);

  // Handle entity update from review mode
  const handleEntityUpdated = (entityId, updates) => {
    if (updates.status === 'validated' || updates.status === 'rejected' || updates.status === 'corrected') {
      setEntities(prev => prev.filter(e => e.id !== entityId));
    }
    if (onRefreshGraph) onRefreshGraph();
  };

  // Handle close from EntityReviewMode
  const handleReviewClose = () => {
    if (onClose) onClose();
  };

  // Loading state
  if (loading) {
    return (
      <div className="entities-review-panel">
        <div className="entities-review-loading">
          <Loader size={32} className="kg-spinner" />
          <p>Loading entities for review...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="entities-review-panel">
        <div className="entities-review-error">
          <AlertCircle size={32} />
          <p>Failed to load entities</p>
          <p className="entities-review-error-detail">{error}</p>
          <button className="kg-btn kg-btn-primary" onClick={loadEntities}>
            <RefreshCw size={14} /> Retry
          </button>
        </div>
      </div>
    );
  }

  // Empty state
  if (entities.length === 0) {
    return (
      <div className="entities-review-panel">
        <div className="entities-review-empty">
          <Layers size={48} strokeWidth={1} />
          <h3>No unvalidated entities</h3>
          <p>All extracted entities have been reviewed.</p>
          <p className="entities-review-empty-hint">
            New entities will appear here when notes are processed by the Synthesizer.
          </p>
          <button className="kg-btn kg-btn-secondary" onClick={loadEntities}>
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
      </div>
    );
  }

  // Render EntityReviewMode with entities
  return (
    <EntityReviewMode
      entities={entities}
      onEntityUpdated={handleEntityUpdated}
      onClose={handleReviewClose}
    />
  );
}
