import React, { useState } from 'react';
import NoteViewer from './NoteViewer';
import Stage1Notes from './Stage1Notes';
import Stage2Reviews from './Stage2Reviews';
import './DeliberationNoteViewer.css';

/**
 * DeliberationNoteViewer displays synthesizer notes generated via council deliberation.
 * Shows final notes prominently with an expandable section showing the deliberation process.
 */
export default function DeliberationNoteViewer({
  notes,
  deliberation,
  stage3Raw,
  sourceTitle,
  sourceType,
  sourceUrl,
  sourceContent,
  models,
  chairmanModel,
  // Comment props passed to NoteViewer
  comments = [],
  onSelectionChange,
  onSaveComment,
  onEditComment,
  onDeleteComment,
  activeCommentId,
  onSetActiveComment,
}) {
  const [showDeliberation, setShowDeliberation] = useState(false);
  const [deliberationTab, setDeliberationTab] = useState('stage1');

  // Helper to get short model name
  const getModelShortName = (model) => model?.split('/').pop() || model;

  return (
    <div className="deliberation-note-viewer">
      {/* Final Notes - Uses NoteViewer with council badges */}
      <div className="final-notes-section">
        <NoteViewer
          notes={notes}
          sourceTitle={sourceTitle}
          sourceType={sourceType}
          sourceUrl={sourceUrl}
          sourceContent={sourceContent}
          comments={comments}
          onSelectionChange={onSelectionChange}
          onSaveComment={onSaveComment}
          onEditComment={onEditComment}
          onDeleteComment={onDeleteComment}
          activeCommentId={activeCommentId}
          onSetActiveComment={onSetActiveComment}
          isDeliberation={true}
          modelCount={models?.length}
          chairmanModel={chairmanModel}
        />
      </div>

      {/* Bottom Sheet Deliberation Panel */}
      {deliberation && (
        <div className={`deliberation-panel ${showDeliberation ? 'expanded' : 'collapsed'}`}>
          {/* Collapsed dock bar */}
          {!showDeliberation && (
            <button
              className="deliberation-dock"
              onClick={() => setShowDeliberation(true)}
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
              <span>Show Deliberation Process</span>
              {deliberation.stage1 && (
                <span className="dock-summary">
                  {deliberation.stage1.length} models, {
                    deliberation.stage1.reduce((sum, r) => sum + (r.notes?.length || 0), 0)
                  } total notes generated
                </span>
              )}
            </button>
          )}

          {/* Expanded full-screen panel */}
          {showDeliberation && (
            <div className="deliberation-fullscreen">
              {/* Panel header */}
              <div className="panel-header">
                <h3>Deliberation Process</h3>
                {deliberation.stage1 && (
                  <span className="panel-summary">
                    {deliberation.stage1.length} models, {
                      deliberation.stage1.reduce((sum, r) => sum + (r.notes?.length || 0), 0)
                    } total notes generated
                  </span>
                )}
                <button
                  className="panel-close"
                  onClick={() => setShowDeliberation(false)}
                  title="Close"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                  </svg>
                </button>
              </div>

              {/* Tabs */}
              <div className="deliberation-tabs">
                <button
                  className={deliberationTab === 'stage1' ? 'active' : ''}
                  onClick={() => setDeliberationTab('stage1')}
                >
                  Stage 1: Individual Notes
                </button>
                <button
                  className={deliberationTab === 'stage2' ? 'active' : ''}
                  onClick={() => setDeliberationTab('stage2')}
                >
                  Stage 2: Peer Reviews
                </button>
                <button
                  className={deliberationTab === 'rankings' ? 'active' : ''}
                  onClick={() => setDeliberationTab('rankings')}
                >
                  Rankings
                </button>
              </div>

              {/* Scrollable content */}
              <div className="deliberation-content">
                {deliberationTab === 'stage1' && deliberation.stage1 && (
                  <Stage1Notes
                    responses={deliberation.stage1}
                    labelToModel={deliberation.label_to_model}
                  />
                )}

                {deliberationTab === 'stage2' && deliberation.stage2 && (
                  <Stage2Reviews
                    rankings={deliberation.stage2}
                    labelToModel={deliberation.label_to_model}
                  />
                )}

                {deliberationTab === 'rankings' && deliberation.aggregate_rankings && (
                  <div className="aggregate-rankings">
                    <h4>Aggregate Rankings</h4>
                    <p className="rankings-description">
                      Average position across all peer evaluations (lower is better)
                    </p>
                    <div className="rankings-list">
                      {deliberation.aggregate_rankings.map((rank, index) => (
                        <div key={rank.model} className="ranking-item">
                          <span className="rank-position">{index + 1}</span>
                          <span className="rank-model">{getModelShortName(rank.model)}</span>
                          <span className="rank-score">
                            Avg: {rank.average_rank.toFixed(2)}
                          </span>
                          <span className="rank-votes">
                            ({rank.rankings_count} votes)
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
