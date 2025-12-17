import React from 'react';
import './ThreadContextSidebar.css';

/**
 * Sidebar for viewing thread context (read-only)
 * Shows all comments and context segments used in a thread
 */
function ThreadContextSidebar({
  context,
  allComments,
  onClose,
  onCommentClick,
}) {
  if (!context) return null;

  const getModelShortName = (model) => {
    return model?.split('/')[1] || model;
  };

  // Get comments that belong to this thread
  const threadComments = context.comments || [];
  const threadSegments = context.contextSegments || [];
  const totalItems = threadComments.length + threadSegments.length;

  return (
    <div className="thread-context-sidebar">
      <div className="thread-context-sidebar-header">
        <div className="sidebar-title">
          <h3>Thread Context</h3>
          <span className="context-count">{totalItems}</span>
        </div>
        <button className="btn-close" onClick={onClose} title="Close sidebar">
          &times;
        </button>
      </div>

      <div className="thread-context-sidebar-content">
        {totalItems === 0 && (
          <div className="empty-context">
            <p>No context for this thread</p>
          </div>
        )}

        {/* Comments/Highlights section */}
        {threadComments.length > 0 && (
          <div className="context-section">
            <div className="context-section-title">
              Highlights ({threadComments.length})
            </div>
            {threadComments.map((comment, index) => (
              <div
                key={comment.id || index}
                className="context-card"
                onClick={() => onCommentClick && onCommentClick(comment.id)}
              >
                <div className="context-card-header">
                  <span className="context-number">#{index + 1}</span>
                  {comment.stage && (
                    <span className="context-badge stage">Stage {comment.stage}</span>
                  )}
                  {comment.model && (
                    <span className="context-badge model">
                      {getModelShortName(comment.model)}
                    </span>
                  )}
                  {comment.note_title && (
                    <span className="context-badge note">{comment.note_title}</span>
                  )}
                </div>
                <div className="context-selection">
                  "{comment.selection?.length > 100
                    ? `${comment.selection.substring(0, 100)}...`
                    : comment.selection}"
                </div>
                {comment.content && (
                  <div className="context-annotation">{comment.content}</div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Context Stack section */}
        {threadSegments.length > 0 && (
          <div className="context-section">
            <div className="context-section-title">
              Context Stack ({threadSegments.length})
            </div>
            {threadSegments.map((segment, index) => (
              <div key={segment.id || index} className="context-card segment">
                <div className="context-card-header">
                  <span className="context-number">#{index + 1}</span>
                  {segment.stage && (
                    <span className="context-badge stage">Stage {segment.stage}</span>
                  )}
                  {segment.model && (
                    <span className="context-badge model">
                      {getModelShortName(segment.model)}
                    </span>
                  )}
                  {segment.label && (
                    <span className="context-badge label">{segment.label}</span>
                  )}
                </div>
                <div className="context-snippet">
                  {segment.content?.length > 200
                    ? `${segment.content.substring(0, 200)}...`
                    : segment.content}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default ThreadContextSidebar;
