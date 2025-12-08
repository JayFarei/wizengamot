import React, { useState, useRef, useEffect, useMemo } from 'react';
import { computeTokenBreakdown } from '../utils/tokenizer';
import './CommitSidebar.css';

/**
 * Sidebar for managing comments and creating follow-up threads
 * Shows all comments, allows editing/deletion, jumping to highlights,
 * and includes councilor selector with input box
 */
function CommitSidebar({
  comments,
  contextSegments = [],
  autoContextSegments = [],
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
  onRemoveContextSegment,
}) {
  const [selectedModel, setSelectedModel] = useState(defaultChairman || '');
  const [followUpQuestion, setFollowUpQuestion] = useState('');
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const [editingCommentId, setEditingCommentId] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [isStackCollapsed, setIsStackCollapsed] = useState(false);
  const [stackToggledManually, setStackToggledManually] = useState(false);
  const [copied, setCopied] = useState(false);
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

  const combinedStackSegments = useMemo(
    () => [...contextSegments, ...autoContextSegments],
    [contextSegments, autoContextSegments]
  );
  const totalContextItems = comments.length + combinedStackSegments.length;
  const hasContext = totalContextItems > 0;
  const autoCollapseThreshold = 3;

  useEffect(() => {
    if (combinedStackSegments.length === 0) {
      setIsStackCollapsed(false);
      setStackToggledManually(false);
      return;
    }

    if (!stackToggledManually) {
      setIsStackCollapsed(combinedStackSegments.length > autoCollapseThreshold);
    }
  }, [combinedStackSegments.length, stackToggledManually]);

  const handleToggleStackCollapse = () => {
    setIsStackCollapsed((prev) => !prev);
    setStackToggledManually(true);
  };

  const handleCopyToSlack = async () => {
    if (comments.length === 0) return;

    const formatted = comments.map(comment => {
      const highlight = comment.selection.trim();
      const commentary = comment.content.trim();
      return `"${highlight}"\n=> ${commentary}`;
    }).join('\n\n');

    try {
      await navigator.clipboard.writeText(formatted);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const tokenBreakdown = useMemo(
    () =>
      computeTokenBreakdown({
        question: followUpQuestion,
        comments,
        segments: combinedStackSegments,
        model: selectedModel,
      }),
    [followUpQuestion, comments, combinedStackSegments, selectedModel]
  );

  const promptPct = tokenBreakdown.total
    ? (tokenBreakdown.promptTokens / tokenBreakdown.total) * 100
    : 0;
  const highlightPct = tokenBreakdown.total
    ? (tokenBreakdown.highlightTokens / tokenBreakdown.total) * 100
    : 0;
  const stackPct = tokenBreakdown.total
    ? Math.max(0, 100 - promptPct - highlightPct)
    : 0;

  return (
    <div className="commit-sidebar">
      <div className="commit-sidebar-header">
        <div className="sidebar-title">
          <h3>Review Context</h3>
          <span className="comment-count">{totalContextItems}</span>
        </div>
        {comments.length > 0 && (
          <button
            className="btn-copy-slack"
            onClick={handleCopyToSlack}
            title="Copy highlights to clipboard"
          >
            {copied ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
            )}
          </button>
        )}
        <button className="btn-close" onClick={onClose} title="Close sidebar">
          ×
        </button>
      </div>

      <div className="commit-sidebar-comments">
        {comments.length === 0 && contextSegments.length === 0 && (
          <div className="empty-comments">
            <p>No context yet</p>
            <p className="empty-hint">Highlight text or pin sections to build your stack</p>
          </div>
        )}
        {comments.length > 0 && comments.map((comment, index) => (
          <div 
            key={comment.id} 
            className={`comment-card ${activeCommentId === comment.id ? 'active' : ''}`}
          >
            <div className="comment-card-header">
              <span className="comment-number">#{index + 1}</span>
              <div className="comment-badges">
                {(comment.source_type || (comment.note_id ? 'synthesizer' : 'council')) === 'council' ? (
                  <>
                    <span className="badge-stage">Stage {comment.stage}</span>
                    <span className="badge-model">{getModelShortName(comment.model)}</span>
                  </>
                ) : (
                  <>
                    <span className="badge-note">Note</span>
                    <span className="badge-title">{comment.note_title || 'Untitled'}</span>
                  </>
                )}
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
        ))}

        <div className="context-stack-section">
          <div className="context-stack-title">
            <span>Context Stack</span>
            <div className="context-stack-actions">
              <span className="stack-count">{combinedStackSegments.length}</span>
              {combinedStackSegments.length > 0 && (
                <button
                  className="btn-fold-stack"
                  onClick={handleToggleStackCollapse}
                >
                  {isStackCollapsed ? 'Expand' : 'Collapse'}
                </button>
              )}
            </div>
          </div>
          {combinedStackSegments.length === 0 ? (
            <p className="context-stack-empty">
              Highlights automatically pull their full section here. Click the stack icon on any stage to pin anything extra.
            </p>
          ) : isStackCollapsed ? (
            <p className="context-stack-collapsed">
              Stack hidden to save space. Expand when you need to inspect the pinned context.
            </p>
          ) : (
            combinedStackSegments.map((segment, index) => (
              <div key={segment.id} className="context-stack-card">
                <div className="context-stack-header">
                  <div className="context-stack-meta">
                    <span className="stack-index">#{index + 1}</span>
                    <span className="stack-model">
                      {(segment.sourceType || (segment.noteId ? 'synthesizer' : 'council')) === 'council'
                        ? `Stage ${segment.stage} · ${getModelShortName(segment.model)}`
                        : `Note · ${segment.noteTitle || 'Untitled'}`}
                    </span>
                    {segment.label && (
                      <span className="stack-label-pill">{segment.label}</span>
                    )}
                    {segment.autoGenerated && (
                      <span className="stack-label-pill auto">Auto</span>
                    )}
                  </div>
                  {!segment.autoGenerated && (
                    <button
                      className="btn-remove-stack"
                      onClick={() => onRemoveContextSegment?.(segment.id)}
                      title="Remove from context stack"
                    >
                      ×
                    </button>
                  )}
                </div>
                <div className="context-stack-preview">
                  {segment.content.length > 200
                    ? `${segment.content.substring(0, 200)}...`
                    : segment.content}
                </div>
              </div>
            ))
          )}
        </div>
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

        <div className="token-meter">
          <div className="token-meter-header">
            <span className="token-meter-title">Token estimate</span>
            <span className="token-meter-total">{tokenBreakdown.total} tokens</span>
          </div>
          <div className="token-meter-track">
            <div
              className="token-meter-segment prompt"
              style={{ width: `${promptPct}%` }}
              title={`Prompt: ${tokenBreakdown.promptTokens} tokens`}
            />
            <div
              className="token-meter-segment highlights"
              style={{ width: `${highlightPct}%` }}
              title={`Highlights: ${tokenBreakdown.highlightTokens} tokens`}
            />
            <div
              className="token-meter-segment stack"
              style={{ width: `${stackPct}%` }}
              title={`Context stack: ${tokenBreakdown.stackTokens} tokens`}
            />
          </div>
          <div className="token-meter-legend">
            <div className="token-legend-item">
              <span className="token-swatch prompt" />
              <span>Prompt · {tokenBreakdown.promptTokens}</span>
            </div>
            <div className="token-legend-item">
              <span className="token-swatch highlights" />
              <span>Highlights · {tokenBreakdown.highlightTokens}</span>
            </div>
            <div className="token-legend-item">
              <span className="token-swatch stack" />
              <span>Context stack · {tokenBreakdown.stackTokens}</span>
            </div>
            <div className="token-legend-item encoding">
              <span className="encoding-label">Encoding</span>
              <span className="encoding-value">{tokenBreakdown.encodingName}</span>
            </div>
          </div>
        </div>

        <div className="input-actions">
          <div className="input-hint">
            ⌘/Ctrl+Enter to send
          </div>
          <button
            className="btn-commit"
            onClick={handleSubmit}
            disabled={!followUpQuestion.trim() || !selectedModel || !hasContext}
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
            {combinedStackSegments.length > 0 && (
              isStackCollapsed ? (
                <div className="context-section">
                  <strong>Context Stack:</strong> Collapsed above. Expand to preview pinned sections.
                </div>
              ) : (
                <div className="context-section">
                  <strong>Context Stack ({combinedStackSegments.length}):</strong>
                  {combinedStackSegments.map((segment, idx) => (
                    <div key={segment.id} className="context-item-block">
                      <div className="context-item-header">
                        <span className="context-num">{idx + 1}.</span>
                        <span className="context-meta">[{getModelShortName(segment.model)}, Stage {segment.stage}]</span>
                        {segment.label && (
                          <span className="context-stack-label">{segment.label}</span>
                        )}
                        {segment.autoGenerated && (
                          <span className="context-stack-label auto">Auto</span>
                        )}
                      </div>
                      <div className="context-segment-preview">
                        {segment.content.length > 300
                          ? `${segment.content.substring(0, 300)}...`
                          : segment.content}
                      </div>
                    </div>
                  ))}
                </div>
              )
            )}
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
