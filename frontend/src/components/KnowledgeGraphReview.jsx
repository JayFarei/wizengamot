import React, { useState, useCallback } from 'react';
import { X, Maximize2, Minimize2, FileText, Layers, Link2, BarChart3, Activity } from 'lucide-react';
import InsightsReviewPanel from './InsightsReviewPanel';
import EntitiesReviewPanel from './EntitiesReviewPanel';
import RelationshipsReviewPanel from './RelationshipsReviewPanel';
import KnowledgeGraphQuality from './KnowledgeGraphQuality';
import FeedbackDashboard from './FeedbackDashboard';
import CurationReviewMode from './CurationReviewMode';
import { api } from '../api';

/**
 * KnowledgeGraphReview - Router/container for all review panels
 *
 * This component acts as a simple router that renders the appropriate
 * review panel based on the `view` prop.
 *
 * Views:
 * - 'insights': Pending/Approved/Dismissed discoveries (InsightsReviewPanel)
 * - 'entities': Entity validation (EntitiesReviewPanel)
 * - 'relationships': Relationship validation (RelationshipsReviewPanel)
 * - 'quality': Quality dashboard (KnowledgeGraphQuality)
 * - 'feedback': Feedback learning dashboard (FeedbackDashboard)
 * - 'curation': Curation review mode (CurationReviewMode)
 *
 * Props:
 * - view: 'insights' | 'entities' | 'relationships' | 'quality' | 'feedback' | 'curation'
 * - initialFilter: 'pending' | 'approved' | 'dismissed' (for insights view)
 * - onClose: close handler
 * - onSelectConversation: callback to navigate to a conversation
 * - onRefreshGraph: callback to refresh the graph
 * - curationCandidates: array of curation candidates (for curation view)
 */
export default function KnowledgeGraphReview({
  view = 'insights',
  initialFilter = 'pending',
  onClose,
  onSelectConversation,
  onRefreshGraph,
  curationCandidates = [],
}) {
  const [fullScreen, setFullScreen] = useState(false);

  // Get view title and icon
  const getViewInfo = () => {
    switch (view) {
      case 'insights':
        return { title: 'Review Insights', icon: <FileText size={18} /> };
      case 'entities':
        return { title: 'Review Entities', icon: <Layers size={18} /> };
      case 'relationships':
        return { title: 'Review Relationships', icon: <Link2 size={18} /> };
      case 'quality':
        return { title: 'Quality Dashboard', icon: <BarChart3 size={18} /> };
      case 'feedback':
        return { title: 'Feedback Learning', icon: <Activity size={18} /> };
      case 'curation':
        return { title: 'Structure Review', icon: <Layers size={18} /> };
      default:
        return { title: 'Review', icon: <FileText size={18} /> };
    }
  };

  const viewInfo = getViewInfo();

  // Handle curation actions
  const handleCurationAction = useCallback(async (candidate, action, params = {}) => {
    try {
      await api.executeCurationAction(candidate.id, action, params);
      if (onRefreshGraph) onRefreshGraph();
    } catch (err) {
      console.error('Curation action failed:', err);
    }
  }, [onRefreshGraph]);

  const handleCurationDismiss = useCallback(async (candidate) => {
    try {
      await api.dismissCurationCandidate(candidate.id);
    } catch (err) {
      console.error('Curation dismiss failed:', err);
    }
  }, []);

  // Handle entity review starting from quality dashboard
  const handleStartEntityReview = useCallback(() => {
    // This would need to be handled by the parent to switch views
    // For now, we close and let the parent handle it
    if (onClose) onClose();
  }, [onClose]);

  const handleStartRelationshipReview = useCallback(() => {
    if (onClose) onClose();
  }, [onClose]);

  // Render the appropriate panel based on view
  const renderPanel = () => {
    switch (view) {
      case 'insights':
        return (
          <InsightsReviewPanel
            initialFilter={initialFilter}
            onSelectConversation={onSelectConversation}
            onRefreshGraph={onRefreshGraph}
          />
        );

      case 'entities':
        return (
          <EntitiesReviewPanel
            onRefreshGraph={onRefreshGraph}
            onClose={onClose}
          />
        );

      case 'relationships':
        return (
          <RelationshipsReviewPanel
            onRefreshGraph={onRefreshGraph}
            onClose={onClose}
          />
        );

      case 'quality':
        return (
          <KnowledgeGraphQuality
            embedded={true}
            onClose={onClose}
            onStartEntityReview={handleStartEntityReview}
            onStartRelationshipReview={handleStartRelationshipReview}
          />
        );

      case 'feedback':
        return (
          <FeedbackDashboard
            onClose={onClose}
          />
        );

      case 'curation':
        if (curationCandidates.length === 0) {
          return (
            <div className="curation-review-empty">
              <Layers size={48} strokeWidth={1} />
              <h3>No curation candidates</h3>
              <p>Run a curation analysis from the Create menu to find candidates.</p>
            </div>
          );
        }
        return (
          <CurationReviewMode
            candidates={curationCandidates}
            initialIndex={0}
            onAction={handleCurationAction}
            onDismiss={handleCurationDismiss}
            onClose={onClose}
          />
        );

      default:
        return (
          <div className="kg-review-unknown">
            <p>Unknown view: {view}</p>
          </div>
        );
    }
  };

  // Check if the view needs a header (some views have their own)
  const needsHeader = view === 'insights' || view === 'quality' || view === 'feedback';

  // Check if the view is full-screen overlay (entities, relationships, curation)
  const isOverlayView = view === 'entities' || view === 'relationships' || view === 'curation';

  // For overlay views, render directly without wrapper
  if (isOverlayView) {
    return renderPanel();
  }

  return (
    <div className={`kg-review-panel ${fullScreen ? 'kg-review-fullscreen' : ''}`}>
      {/* Header */}
      <div className="kg-review-header">
        <div className="kg-review-title">
          {viewInfo.icon}
          <span>{viewInfo.title}</span>
        </div>
        <div className="kg-review-header-actions">
          <button
            className="kg-icon-btn"
            onClick={() => setFullScreen(!fullScreen)}
            title={fullScreen ? 'Exit Full Screen' : 'Full Screen'}
          >
            {fullScreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
          </button>
          <button className="kg-icon-btn" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Body - render the appropriate panel */}
      <div className="kg-review-body">
        {renderPanel()}
      </div>
    </div>
  );
}
