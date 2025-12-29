import React, { useState, useRef, useEffect, useMemo } from 'react';
import { computeTokenBreakdown } from '../utils/tokenizer';
import { api } from '../api';
import ReviewSessionSelector from './ReviewSessionSelector';
import './CommitSidebar.css';

/**
 * Sidebar for managing comments and creating follow-up threads
 * Shows all comments, allows editing/deletion, jumping to highlights,
 * and includes councilor selector with input box.
 * Also supports creating visualisations from highlighted context.
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
  activeCommentId,
  onRemoveContextSegment,
  onVisualise,
  reviewSessions = [],
  activeSessionId,
  sessionThreads = [],
  onCreateSession,
  onSwitchSession,
  onRenameSession,
  onDeleteSession,
}) {
  const [selectedModel, setSelectedModel] = useState(defaultChairman || '');
  const [followUpQuestion, setFollowUpQuestion] = useState('');
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const [editingCommentId, setEditingCommentId] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [isStackCollapsed, setIsStackCollapsed] = useState(false);
  const [stackToggledManually, setStackToggledManually] = useState(false);
  const [copied, setCopied] = useState(false);
  // Visualisation state
  const [selectedStyle, setSelectedStyle] = useState('bento');
  const [showStyleDropdown, setShowStyleDropdown] = useState(false);
  const [diagramStyles, setDiagramStyles] = useState([]);
  const [isVisualising, setIsVisualising] = useState(false);
  const inputRef = useRef(null);
  const dropdownRef = useRef(null);
  const styleDropdownRef = useRef(null);
  const editTextareaRef = useRef(null);

  useEffect(() => {
    // Set default chairman when it becomes available
    if (!selectedModel && defaultChairman) {
      setSelectedModel(defaultChairman);
    }
  }, [defaultChairman, selectedModel]);

  useEffect(() => {
    // Close dropdowns when clicking outside
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setShowModelDropdown(false);
      }
      if (styleDropdownRef.current && !styleDropdownRef.current.contains(e.target)) {
        setShowStyleDropdown(false);
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

  // Load diagram styles on mount
  useEffect(() => {
    const loadStyles = async () => {
      try {
        const styles = await api.getDiagramStyles();
        const styleList = Object.entries(styles).map(([id, s]) => ({
          id,
          name: s.name,
          icon: s.icon,
        }));
        setDiagramStyles(styleList);
      } catch (err) {
        console.error('Failed to load diagram styles:', err);
      }
    };
    loadStyles();
  }, []);

  const handleSubmit = () => {
    if (followUpQuestion.trim() && selectedModel) {
      onCommit(selectedModel, followUpQuestion.trim());
      setFollowUpQuestion('');
    }
  };

  const handleVisualise = async () => {
    if (!onVisualise || !hasContext) return;
    setIsVisualising(true);
    try {
      await onVisualise(selectedStyle);
    } finally {
      setIsVisualising(false);
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

      {reviewSessions.length > 0 && (
        <div className="session-selector-row">
          <ReviewSessionSelector
            sessions={reviewSessions}
            activeSessionId={activeSessionId}
            onSessionSelect={onSwitchSession}
            onCreateSession={onCreateSession}
            onRenameSession={onRenameSession}
            onDeleteSession={onDeleteSession}
          />
        </div>
      )}

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

        {sessionThreads.length > 0 && (
          <div className="threads-section">
            <div className="threads-section-title">
              <span>Threads</span>
              <span className="threads-count">{sessionThreads.length}</span>
            </div>
            {sessionThreads.map((thread) => (
              <div
                key={thread.id}
                className="thread-card"
                onClick={() => {
                  const threadEl = document.querySelector(`[data-thread-id="${thread.id}"]`);
                  if (threadEl) {
                    threadEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    const input = threadEl.querySelector('.thread-input input, .thread-input textarea');
                    if (input) {
                      setTimeout(() => input.focus(), 300);
                    }
                  }
                }}
                title="Click to continue this thread"
              >
                <div className="thread-card-header">
                  <span className="thread-model">{getModelShortName(thread.model)}</span>
                  <span className="thread-msg-count">{thread.messages?.length || 0} msgs</span>
                </div>
                <div className="thread-card-preview">
                  {thread.messages?.[0]?.content?.substring(0, 60) || 'Thread'}
                  {thread.messages?.[0]?.content?.length > 60 ? '...' : ''}
                </div>
              </div>
            ))}
          </div>
        )}

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
        {/* Follow-up Question Section */}
        <div className="followup-section">
          <h4 className="sidebar-section-title">Ask a follow-up question</h4>
          
          <div className="model-selector" ref={dropdownRef}>
            <button
              className="model-selector-button"
              onClick={() => setShowModelDropdown(!showModelDropdown)}
              title="Select model"
            >
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

          <div className="followup-input-wrapper">
            <textarea
              ref={inputRef}
              className="followup-textarea"
              placeholder="Type your question..."
              value={followUpQuestion}
              onChange={(e) => setFollowUpQuestion(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={4}
            />
            <button
              className="followup-send-btn"
              onClick={handleSubmit}
              disabled={!followUpQuestion.trim() || !selectedModel || !hasContext}
              title="Send (⌘/Ctrl+Enter)"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="19" x2="12" y2="5"></line>
                <polyline points="5 12 12 5 19 12"></polyline>
              </svg>
            </button>
          </div>

          <div className="followup-info-row">
            <span className="encoding-info">Encoding {tokenBreakdown.encodingName}</span>
            <span className="shortcut-hint">⌘/Ctrl+Enter to send</span>
          </div>

          <div className="token-bar-simple">
            <div className="token-bar-header">
              <span className="token-bar-percentage">{Math.round((tokenBreakdown.total / 200000) * 100)}%</span>
              <div className="token-bar-track">
                <div
                  className="token-bar-fill"
                  style={{ width: `${Math.min((tokenBreakdown.total / 200000) * 100, 100)}%` }}
                />
              </div>
              <span className="token-bar-label">Max Tokens</span>
            </div>
            <div className="token-bar-legend">
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
                <span>Stack · {tokenBreakdown.stackTokens}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Divider */}
        {onVisualise && <div className="sidebar-divider" />}

        {/* Visualise Annotations Section */}
        {onVisualise && (
          <div className="visualise-section">
            <h4 className="sidebar-section-title">Visualise Annotations</h4>
            <div className="visualise-controls">
              <div className="style-selector" ref={styleDropdownRef}>
                <button
                  className="style-selector-button"
                  onClick={() => setShowStyleDropdown(!showStyleDropdown)}
                  title="Select diagram style"
                  disabled={isVisualising}
                >
                  <span className="style-name">
                    {diagramStyles.find(s => s.id === selectedStyle)?.name || 'Bento'}
                  </span>
                  <span className="dropdown-arrow">▼</span>
                </button>
                {showStyleDropdown && (
                  <div className="style-dropdown">
                    {diagramStyles.map((style) => (
                      <div
                        key={style.id}
                        className={`style-option ${selectedStyle === style.id ? 'selected' : ''}`}
                        onClick={() => {
                          setSelectedStyle(style.id);
                          setShowStyleDropdown(false);
                        }}
                      >
                        {style.name}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <button
                className="btn-visualise"
                onClick={handleVisualise}
                disabled={isVisualising || !hasContext}
                title="Create a visual diagram from your highlights"
              >
                {isVisualising ? 'Creating...' : 'Visualise'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default CommitSidebar;
