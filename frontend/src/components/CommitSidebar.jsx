import React, { useState, useRef, useEffect } from 'react';
import './CommitSidebar.css';

/**
 * Sidebar for managing comments and creating follow-up threads
 * Shows all comments, allows editing/deletion, jumping to highlights,
 * and includes councilor selector with input box
 */
function CommitSidebar({
  comments,
  availableModels,
  defaultChairman,
  onCommit,
  onClose,
  onSelectComment,
  onEditComment,
  onDeleteComment,
  showContextPreview,
  onToggleContextPreview,
  activeCommentId,
}) {
  const [selectedModel, setSelectedModel] = useState(defaultChairman || '');
  const [followUpQuestion, setFollowUpQuestion] = useState('');
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const [editingCommentId, setEditingCommentId] = useState(null);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef(null);
  const dropdownRef = useRef(null);
  const editTextareaRef = useRef(null);

  useEffect(() => {
    // Set default chairman when it becomes available
    if (!selectedModel && defaultChairman) {
      setSelectedModel(defaultChairman);
    }
  }, [defaultChairman, selectedModel]);

  useEffect(() => {
    // Close dropdown when clicking outside
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setShowModelDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (editingCommentId && editTextareaRef.current) {
      editTextareaRef.current.focus();
      editTextareaRef.current.select();
    }
  }, [editingCommentId]);

  const handleSubmit = () => {
    if (followUpQuestion.trim() && selectedModel) {
      onCommit(selectedModel, followUpQuestion.trim());
      setFollowUpQuestion('');
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      handleSubmit();
    }
  };

  const handleStartEdit = (comment) => {
    setEditingCommentId(comment.id);
    setEditValue(comment.content);
  };

  const handleSaveEdit = (commentId) => {
    if (editValue.trim()) {
      onEditComment(commentId, editValue.trim());
    }
    setEditingCommentId(null);
    setEditValue('');
  };

  const handleCancelEdit = () => {
    setEditingCommentId(null);
    setEditValue('');
  };

  const handleEditKeyDown = (e, commentId) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSaveEdit(commentId);
    } else if (e.key === 'Escape') {
      handleCancelEdit();
    }
  };

  const getModelShortName = (model) => {
    return model?.split('/')[1] || model;
  };

  const allModels = [
    ...(defaultChairman ? [{ value: defaultChairman, label: `Chairman: ${getModelShortName(defaultChairman)}` }] : []),
    ...availableModels.filter(m => m !== defaultChairman).map(m => ({ value: m, label: getModelShortName(m) })),
  ];

  return (
    <div className="commit-sidebar">
      <div className="commit-sidebar-header">
        <div className="sidebar-title">
          <h3>Review Context</h3>
          <span className="comment-count">{comments.length}</span>
        </div>
        <button className="btn-close" onClick={onClose} title="Close sidebar">
          ×
        </button>
      </div>

      <div className="commit-sidebar-comments">
        {comments.length === 0 ? (
          <div className="empty-comments">
            <p>No annotations yet</p>
            <p className="empty-hint">Select text and add comments to build your review context</p>
          </div>
        ) : (
          comments.map((comment, index) => (
            <div 
              key={comment.id} 
              className={`comment-card ${activeCommentId === comment.id ? 'active' : ''}`}
            >
              <div className="comment-card-header">
                <span className="comment-number">#{index + 1}</span>
                <div className="comment-badges">
                  <span className="badge-stage">Stage {comment.stage}</span>
                  <span className="badge-model">{getModelShortName(comment.model)}</span>
                </div>
                <div className="comment-card-actions">
                  {editingCommentId !== comment.id && (
                    <button
                      className="btn-edit-small"
                      onClick={() => handleStartEdit(comment)}
                      title="Edit comment"
                    >
                      ✎
                    </button>
                  )}
                  <button
                    className="btn-delete-small"
                    onClick={() => onDeleteComment(comment.id)}
                    title="Remove annotation"
                  >
                    ×
                  </button>
                </div>
              </div>
              
              <div
                className="comment-selection"
                onClick={() => onSelectComment(comment.id)}
                title="Jump to highlighted text"
              >
                "{comment.selection.substring(0, 80)}
                {comment.selection.length > 80 ? '...' : ''}"
              </div>
              
              {editingCommentId === comment.id ? (
                <div className="comment-edit-inline">
                  <textarea
                    ref={editTextareaRef}
                    className="comment-edit-textarea"
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onKeyDown={(e) => handleEditKeyDown(e, comment.id)}
                    rows={3}
                  />
                  <div className="comment-edit-actions">
                    <button 
                      className="btn-save-small"
                      onClick={() => handleSaveEdit(comment.id)}
                      disabled={!editValue.trim()}
                    >
                      Save
                    </button>
                    <button 
                      className="btn-cancel-small"
                      onClick={handleCancelEdit}
                    >
                      Cancel
                    </button>
                  </div>
                  <div className="edit-hint">⌘/Ctrl+Enter to save, Esc to cancel</div>
                </div>
              ) : (
                <div className="comment-content">{comment.content}</div>
              )}
            </div>
          ))
        )}
      </div>

      <div className="commit-sidebar-input">
        <div className="input-header">
          <label>Ask a follow-up question:</label>
          <button
            className={`btn-preview ${showContextPreview ? 'active' : ''}`}
            onClick={onToggleContextPreview}
            title="Toggle context preview"
          >
            {showContextPreview ? 'Hide' : 'Show'} Context
          </button>
        </div>

        <div className="input-with-selector">
          <div className="model-selector" ref={dropdownRef}>
            <button
              className="model-selector-button"
              onClick={() => setShowModelDropdown(!showModelDropdown)}
              title="Select model"
            >
              <span className="model-icon">🤖</span>
              <span className="model-name">
                {selectedModel
                  ? allModels.find(m => m.value === selectedModel)?.label || getModelShortName(selectedModel)
                  : 'Select model'}
              </span>
              <span className="dropdown-arrow">▼</span>
            </button>
            {showModelDropdown && (
              <div className="model-dropdown">
                {allModels.map((model) => (
                  <div
                    key={model.value}
                    className={`model-option ${selectedModel === model.value ? 'selected' : ''}`}
                    onClick={() => {
                      setSelectedModel(model.value);
                      setShowModelDropdown(false);
                      inputRef.current?.focus();
                    }}
                  >
                    {model.label}
                  </div>
                ))}
              </div>
            )}
          </div>

          <textarea
            ref={inputRef}
            className="commit-input"
            placeholder="Add your follow-up question..."
            value={followUpQuestion}
            onChange={(e) => setFollowUpQuestion(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={3}
          />
        </div>

        <div className="input-actions">
          <div className="input-hint">
            ⌘/Ctrl+Enter to send
          </div>
          <button
            className="btn-commit"
            onClick={handleSubmit}
            disabled={!followUpQuestion.trim() || !selectedModel || comments.length === 0}
          >
            Start Conversation
          </button>
        </div>
      </div>

      {showContextPreview && (
        <div className="context-preview">
          <div className="context-preview-header">
            Context Preview
          </div>
          <div className="context-preview-content">
            <div className="context-section">
              <strong>Annotations ({comments.length}):</strong>
              {comments.map((c, i) => (
                <div key={c.id} className="context-item-block">
                  <div className="context-item-header">
                    <span className="context-num">{i + 1}.</span>
                    <span className="context-meta">[{getModelShortName(c.model)}, Stage {c.stage}]</span>
                  </div>
                  {c.source_content && (
                    <div className="context-source">
                      <span className="source-label">Source:</span>
                      <span className="source-content">
                        {c.source_content.length > 200 
                          ? c.source_content.substring(0, 200) + '...' 
                          : c.source_content}
                      </span>
                    </div>
                  )}
                  <div className="context-highlight">
                    <span className="highlight-label">Highlighted:</span>
                    <span className="context-selection">"{c.selection}"</span>
                  </div>
                  <div className="context-annotation">
                    <span className="annotation-arrow">→</span>
                    <span className="context-comment">{c.content}</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="context-section target-section">
              <strong>Target Councilor:</strong> {getModelShortName(selectedModel)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default CommitSidebar;
