import React, { useState } from 'react';
import './CommentModal.css';

/**
 * Modal for adding a comment to selected text
 */
function CommentModal({ selection, onSave, onCancel }) {
  const [comment, setComment] = useState('');

  if (!selection) return null;

  const handleSave = () => {
    if (comment.trim()) {
      onSave(comment.trim());
      setComment('');
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      handleSave();
    } else if (e.key === 'Escape') {
      onCancel();
    }
  };

  return (
    <div className="comment-modal-overlay" onClick={onCancel}>
      <div className="comment-modal" onClick={(e) => e.stopPropagation()}>
        <div className="comment-modal-header">
          <h3>Add Comment</h3>
          <button className="comment-modal-close" onClick={onCancel}>
            &times;
          </button>
        </div>

        <div className="comment-modal-body">
          <div className="selected-text">
            <strong>Selected text:</strong>
            <p>"{selection.text}"</p>
          </div>

          <div className="comment-context">
            <span className="context-badge">Stage {selection.stage}</span>
            <span className="context-badge">{selection.model}</span>
          </div>

          <textarea
            className="comment-input"
            placeholder="Add your comment here..."
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            onKeyDown={handleKeyDown}
            autoFocus
            rows={4}
          />

          <div className="comment-hint">
            Press Ctrl+Enter to save, Esc to cancel
          </div>
        </div>

        <div className="comment-modal-footer">
          <button className="btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="btn-primary"
            onClick={handleSave}
            disabled={!comment.trim()}
          >
            Save Comment
          </button>
        </div>
      </div>
    </div>
  );
}

export default CommentModal;
