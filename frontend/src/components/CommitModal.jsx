import React, { useState } from 'react';
import './CommitModal.css';

/**
 * Modal for committing comments and starting a follow-up thread with a selected councilor
 */
function CommitModal({ comments, availableModels, onCommit, onCancel }) {
  const [selectedModel, setSelectedModel] = useState('');
  const [question, setQuestion] = useState('');

  if (!comments || comments.length === 0) return null;

  const handleCommit = () => {
    if (selectedModel && question.trim()) {
      onCommit(selectedModel, question.trim());
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      handleCommit();
    } else if (e.key === 'Escape') {
      onCancel();
    }
  };

  return (
    <div className="commit-modal-overlay" onClick={onCancel}>
      <div className="commit-modal" onClick={(e) => e.stopPropagation()}>
        <div className="commit-modal-header">
          <h3>Start Follow-up Conversation</h3>
          <button className="commit-modal-close" onClick={onCancel}>
            &times;
          </button>
        </div>

        <div className="commit-modal-body">
          <div className="commit-context-summary">
            <strong>Context from {comments.length} comment{comments.length !== 1 ? 's' : ''}:</strong>
            <div className="commit-comments-list">
              {comments.map((comment, idx) => (
                <div key={comment.id} className="commit-comment-card">
                  <div className="commit-comment-header">
                    <span className="commit-comment-num">{idx + 1}</span>
                    <span className="commit-comment-stage">Stage {comment.stage}</span>
                    <span className="commit-comment-model">{comment.model}</span>
                  </div>
                  <div className="commit-comment-highlight">
                    <strong>Highlighted text:</strong>
                    <p className="commit-highlight-text">"{comment.selection}"</p>
                  </div>
                  <div className="commit-comment-content">
                    <strong>Comment:</strong>
                    <p>{comment.content}</p>
                  </div>
                  <div className="commit-comment-context-note">
                    This selection and comment will be included in the context
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="commit-model-selection">
            <label htmlFor="model-select">
              <strong>Select councilor to continue with:</strong>
            </label>
            <select
              id="model-select"
              className="commit-model-select"
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
            >
              <option value="">-- Select a model --</option>
              {availableModels.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </select>
          </div>

          <div className="commit-question">
            <label htmlFor="question-input">
              <strong>Your follow-up question:</strong>
            </label>
            <textarea
              id="question-input"
              className="commit-question-input"
              placeholder="Ask your follow-up question..."
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={4}
            />
          </div>

          <div className="commit-hint">
            Press Ctrl+Enter to start, Esc to cancel
          </div>
        </div>

        <div className="commit-modal-footer">
          <button className="btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="btn-primary"
            onClick={handleCommit}
            disabled={!selectedModel || !question.trim()}
          >
            Start Follow-up
          </button>
        </div>
      </div>
    </div>
  );
}

export default CommitModal;
