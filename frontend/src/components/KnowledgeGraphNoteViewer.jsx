import React, { useState, useEffect } from 'react';
import NoteViewer from './NoteViewer';
import TopicsPanel from './TopicsPanel';
import ContextNotesPanel from './ContextNotesPanel';
import './KnowledgeGraphNoteViewer.css';

/**
 * KnowledgeGraphNoteViewer displays synthesizer notes generated with knowledge graph awareness.
 * Shows final notes prominently with an expandable section showing the knowledge graph context.
 */
export default function KnowledgeGraphNoteViewer({
  notes,
  contextNotes,
  topicsExtracted,
  rawResponse,
  sourceTitle,
  sourceType,
  sourceUrl,
  sourceContent,
  model,
  conversationId,
  // Comment props passed to NoteViewer
  comments = [],
  onSelectionChange,
  onSaveComment,
  onEditComment,
  onDeleteComment,
  activeCommentId,
  onSetActiveComment,
  onSourceMetadataUpdate,
  // Review sessions
  reviewSessionCount = 0,
  onToggleReviewSidebar,
  // Knowledge graph navigation
  onNavigateToGraphSearch,
}) {
  const [showPanel, setShowPanel] = useState(false);
  const [activeTab, setActiveTab] = useState('topics');

  // ESC key to close panel
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && showPanel) {
        setShowPanel(false);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [showPanel]);

  const hasContext = contextNotes?.length > 0 || topicsExtracted?.topics?.length > 0;

  return (
    <div className="kg-note-viewer">
      {/* Final Notes - Uses NoteViewer with knowledge graph badge */}
      <div className="final-notes-section">
        <NoteViewer
          notes={notes}
          sourceTitle={sourceTitle}
          sourceType={sourceType}
          sourceUrl={sourceUrl}
          sourceContent={sourceContent}
          conversationId={conversationId}
          comments={comments}
          onSelectionChange={onSelectionChange}
          onSaveComment={onSaveComment}
          onEditComment={onEditComment}
          onDeleteComment={onDeleteComment}
          activeCommentId={activeCommentId}
          onSetActiveComment={onSetActiveComment}
          isKnowledgeGraph={true}
          contextNoteCount={contextNotes?.length}
          onSourceMetadataUpdate={onSourceMetadataUpdate}
          reviewSessionCount={reviewSessionCount}
          onToggleReviewSidebar={onToggleReviewSidebar}
        />
      </div>

      {/* Bottom Sheet Knowledge Graph Context Panel */}
      {hasContext && (
        <div className={`kg-panel ${showPanel ? 'expanded' : 'collapsed'}`}>
          {/* Collapsed dock bar */}
          {!showPanel && (
            <button
              className="kg-dock"
              onClick={() => setShowPanel(true)}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="chevron-up"
              >
                <polyline points="18 15 12 9 6 15"></polyline>
              </svg>
              <span>Show Knowledge Graph Context</span>
              <span className="dock-summary">
                {contextNotes?.length || 0} related notes, {topicsExtracted?.topics?.length || 0} topics
              </span>
            </button>
          )}

          {/* Expanded full-screen panel */}
          {showPanel && (
            <div className="kg-fullscreen">
              {/* Panel header - clickable to close */}
              <div
                className="panel-header clickable"
                onClick={() => setShowPanel(false)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && setShowPanel(false)}
              >
                <h3>Knowledge Graph Context</h3>
                <span className="panel-summary">
                  {contextNotes?.length || 0} related notes, {topicsExtracted?.topics?.length || 0} topics extracted
                </span>
                <button
                  className="panel-close"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowPanel(false);
                  }}
                  title="Close"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                  </svg>
                </button>
              </div>

              {/* Tabs */}
              <div className="kg-tabs">
                <button
                  className={activeTab === 'topics' ? 'active' : ''}
                  onClick={() => setActiveTab('topics')}
                >
                  Topics Extracted
                </button>
                <button
                  className={activeTab === 'context' ? 'active' : ''}
                  onClick={() => setActiveTab('context')}
                >
                  Related Notes Used
                </button>
              </div>

              {/* Scrollable content */}
              <div className="kg-content">
                {activeTab === 'topics' && (
                  <TopicsPanel
                    topics={topicsExtracted?.topics || []}
                    entities={topicsExtracted?.entities || []}
                    domain={topicsExtracted?.domain || 'general'}
                    onEntityClick={onNavigateToGraphSearch}
                  />
                )}

                {activeTab === 'context' && (
                  <ContextNotesPanel
                    notes={contextNotes || []}
                    onTagClick={onNavigateToGraphSearch}
                  />
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
