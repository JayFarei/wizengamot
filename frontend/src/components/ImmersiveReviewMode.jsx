import React, { useState, useEffect, useCallback } from 'react';
import { X, ChevronLeft, ChevronRight, Edit3, Check, XCircle, Trash2, FileText, Loader } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

// Format text with line breaks after each sentence for better readability
const formatSentences = (text) => {
  if (!text) return '';
  // Split on sentence endings (. ! ?) followed by space and capital letter or end of string
  // But preserve existing paragraph breaks
  return text
    .split(/\n\n+/) // Split on existing paragraph breaks
    .map(paragraph =>
      paragraph
        .replace(/([.!?])\s+(?=[A-Z])/g, '$1\n\n') // Add breaks after sentences
        .trim()
    )
    .join('\n\n');
};

/**
 * ImmersiveReviewMode - Full-screen immersive review interface for discoveries
 *
 * Features:
 * - Full-screen overlay
 * - 2-column source notes grid on left (60%)
 * - Bridge note panel on right (40%)
 * - Keyboard navigation (j/k/e/a/d/D/Escape)
 */
export default function ImmersiveReviewMode({
  discoveries,
  initialIndex = 0,
  sourceNotesData,
  loadingNotes,
  fetchNoteData,
  onApprove,
  onDismiss,
  onDelete,
  onClose,
}) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [editMode, setEditMode] = useState(false);
  const [editedTitle, setEditedTitle] = useState('');
  const [editedBody, setEditedBody] = useState('');
  const [editedTags, setEditedTags] = useState('');
  const [approvingId, setApprovingId] = useState(null);
  const [showCheckmark, setShowCheckmark] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);

  const currentDiscovery = discoveries[currentIndex];
  const totalCount = discoveries.length;

  // Initialize edit fields when discovery changes
  useEffect(() => {
    if (currentDiscovery) {
      setEditedTitle(currentDiscovery.suggested_title || '');
      setEditedBody(currentDiscovery.suggested_body || '');
      setEditedTags(currentDiscovery.suggested_tags?.join(', ') || '');
      setEditMode(false);
      // Pre-fetch source notes
      currentDiscovery.source_notes?.forEach(noteId => fetchNoteData(noteId));
    }
  }, [currentIndex, currentDiscovery, fetchNoteData]);

  // Action handlers (wrapped in useCallback to avoid stale closures)
  const handleApprove = useCallback(async () => {
    if (!currentDiscovery || approvingId) return;  // Prevent double-click

    const edits = editMode ? {
      title: editedTitle || currentDiscovery.suggested_title,
      body: editedBody || currentDiscovery.suggested_body,
      tags: editedTags ? editedTags.split(',').map(t => t.trim()).filter(Boolean) : currentDiscovery.suggested_tags,
    } : null;

    // 1. Start checkmark animation
    setApprovingId(currentDiscovery.id);
    setShowCheckmark(true);

    // 2. Wait for checkmark pop animation
    await new Promise(resolve => setTimeout(resolve, 400));

    // 3. Calculate next index BEFORE calling onApprove (which removes the item)
    const nextIndex = currentIndex >= totalCount - 1
      ? Math.max(0, currentIndex - 1)
      : currentIndex;
    const shouldClose = totalCount <= 1;

    // 4. Fire onApprove - parent updates state immediately (optimistic)
    onApprove(currentDiscovery, edits);

    // 5. Clear animation and transition
    setShowCheckmark(false);
    setApprovingId(null);
    setIsTransitioning(false);

    // 6. Handle navigation
    if (shouldClose) {
      onClose();
    } else {
      setCurrentIndex(nextIndex);
    }
  }, [currentDiscovery, approvingId, editMode, editedTitle, editedBody, editedTags, totalCount, currentIndex, onApprove, onClose]);

  const handleDismiss = useCallback(async () => {
    if (!currentDiscovery) return;
    await onDismiss(currentDiscovery);
    if (totalCount <= 1) {
      onClose();
    } else if (currentIndex >= totalCount - 1) {
      setCurrentIndex(prev => Math.max(0, prev - 1));
    }
  }, [currentDiscovery, totalCount, currentIndex, onDismiss, onClose]);

  const handleDelete = useCallback(async () => {
    if (!currentDiscovery) return;
    if (!window.confirm('Permanently delete this discovery? This cannot be undone.')) return;
    await onDelete(currentDiscovery);
    if (totalCount <= 1) {
      onClose();
    } else if (currentIndex >= totalCount - 1) {
      setCurrentIndex(prev => Math.max(0, prev - 1));
    }
  }, [currentDiscovery, totalCount, currentIndex, onDelete, onClose]);

  // Keyboard navigation
  const handleKeyDown = useCallback((e) => {
    // Don't handle keys when typing in inputs
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
      if (e.key === 'Escape') {
        e.target.blur();
        setEditMode(false);
      }
      return;
    }

    switch (e.key) {
      case 'j':
        // Next discovery
        if (currentIndex < totalCount - 1) {
          setCurrentIndex(prev => prev + 1);
        }
        break;
      case 'k':
        // Previous discovery
        if (currentIndex > 0) {
          setCurrentIndex(prev => prev - 1);
        }
        break;
      case 'e':
        // Toggle edit mode
        setEditMode(prev => !prev);
        break;
      case 'a':
        // Approve (blocked during animation)
        if (!approvingId) handleApprove();
        break;
      case 'd':
        // Dismiss (lowercase)
        handleDismiss();
        break;
      case 'D':
        // Delete (uppercase/shift+d)
        handleDelete();
        break;
      case 'Escape':
        // Always close immersive mode and return to previous view
        e.preventDefault();
        e.stopPropagation();
        onClose();
        break;
      default:
        break;
    }
  }, [currentIndex, totalCount, editMode, approvingId, onClose, handleApprove, handleDismiss, handleDelete]);

  useEffect(() => {
    // Use capture phase to intercept Escape before other handlers
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [handleKeyDown]);

  // Prevent body scroll when modal is open
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  const goToPrev = () => {
    if (currentIndex > 0) setCurrentIndex(prev => prev - 1);
  };

  const goToNext = () => {
    if (currentIndex < totalCount - 1) setCurrentIndex(prev => prev + 1);
  };

  // Render source note card
  const renderSourceNote = (noteId) => {
    const noteData = sourceNotesData[noteId];
    const isLoading = loadingNotes.has(noteId);
    const shortId = noteId.split(':').pop();

    return (
      <div key={noteId} className="immersive-source-card">
        <div className="immersive-source-card-header">
          <FileText size={14} />
          <span className="immersive-source-card-title">
            {noteData?.title || `Note ${shortId}`}
          </span>
          {noteData?.sourceTitle && (
            <span className="immersive-source-card-source">{noteData.sourceTitle}</span>
          )}
          {isLoading && <Loader size={12} className="kg-spinner" />}
        </div>
        {noteData ? (
          <>
            <div className="immersive-source-card-body markdown-content">
              <ReactMarkdown>{formatSentences(noteData.body)}</ReactMarkdown>
            </div>
            {noteData.tags?.length > 0 && (
              <div className="immersive-source-card-tags">
                {noteData.tags.map((tag, idx) => (
                  <span key={idx} className="kg-discover-tag">{tag}</span>
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="immersive-source-card-loading">
            {isLoading ? 'Loading...' : 'Note not found'}
          </div>
        )}
      </div>
    );
  };

  if (!currentDiscovery) {
    return (
      <div className="immersive-review-overlay">
        <div className="immersive-review-empty">
          <p>No discoveries to review</p>
          <button className="kg-btn kg-btn-primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="immersive-review-overlay">
      {/* Header */}
      <div className="immersive-review-header">
        <div className="immersive-review-header-left">
          <button className="kg-icon-btn" onClick={onClose} title="Close (Escape)">
            <X size={20} />
          </button>
          <span className="immersive-review-title">Immersive Review</span>
        </div>

        <div className="immersive-review-nav">
          <button
            className="kg-icon-btn"
            onClick={goToPrev}
            disabled={currentIndex === 0}
            title="Previous (k)"
          >
            <ChevronLeft size={20} />
          </button>
          <span className="immersive-review-counter">
            {currentIndex + 1} / {totalCount}
          </span>
          <button
            className="kg-icon-btn"
            onClick={goToNext}
            disabled={currentIndex === totalCount - 1}
            title="Next (j)"
          >
            <ChevronRight size={20} />
          </button>
        </div>

        <div className="immersive-review-kbd-hints">
          <span className="immersive-kbd-hint"><kbd>j</kbd> next</span>
          <span className="immersive-kbd-hint"><kbd>k</kbd> prev</span>
          <span className="immersive-kbd-hint"><kbd>e</kbd> edit</span>
          <span className="immersive-kbd-hint"><kbd>a</kbd> approve</span>
          <span className="immersive-kbd-hint"><kbd>d</kbd> dismiss</span>
        </div>
      </div>

      {/* Main content */}
      <div className={`immersive-review-content ${isTransitioning ? 'transitioning' : ''}`}>
        {/* Left: Source notes */}
        <div className="immersive-source-panel">
          <h3>Source Notes ({currentDiscovery.source_notes?.length || 0})</h3>
          <div className="immersive-source-grid">
            {currentDiscovery.source_notes?.map(noteId => renderSourceNote(noteId))}
          </div>
        </div>

        {/* Right: Bridge note */}
        <div className="immersive-bridge-panel">
          {/* Approval animation overlay */}
          {showCheckmark && (
            <div className="immersive-approval-overlay">
              <div className="immersive-approval-checkmark">
                <Check size={64} />
              </div>
            </div>
          )}
          <h3>Bridge Note</h3>

          <div className="immersive-bridge-content">
            {/* Title */}
            <div className="immersive-bridge-field">
              <label>Title</label>
              {editMode ? (
                <input
                  type="text"
                  value={editedTitle}
                  onChange={(e) => setEditedTitle(e.target.value)}
                  className="immersive-bridge-input"
                  autoFocus
                />
              ) : (
                <div className="immersive-bridge-value">
                  {currentDiscovery.suggested_title}
                </div>
              )}
            </div>

            {/* Tags */}
            <div className="immersive-bridge-field">
              <label>Tags</label>
              {editMode ? (
                <input
                  type="text"
                  value={editedTags}
                  onChange={(e) => setEditedTags(e.target.value)}
                  className="immersive-bridge-input"
                  placeholder="tag1, tag2"
                />
              ) : (
                <div className="immersive-bridge-tags">
                  {currentDiscovery.suggested_tags?.map((tag, idx) => (
                    <span key={idx} className="kg-discover-tag">{tag}</span>
                  ))}
                </div>
              )}
            </div>

            {/* Body */}
            <div className="immersive-bridge-field immersive-bridge-field-grow">
              <label>Content</label>
              {editMode ? (
                <textarea
                  value={editedBody}
                  onChange={(e) => setEditedBody(e.target.value)}
                  className="immersive-bridge-textarea"
                  rows={10}
                />
              ) : (
                <div className="immersive-bridge-value markdown-content">
                  <ReactMarkdown>{formatSentences(currentDiscovery.suggested_body)}</ReactMarkdown>
                </div>
              )}
            </div>

            {/* Reasoning (read-only) */}
            <div className="immersive-bridge-field">
              <label>Why Connected</label>
              <div className="immersive-bridge-reasoning">
                {currentDiscovery.reasoning}
              </div>
            </div>

            {/* Connection metadata */}
            <div className="immersive-bridge-meta">
              <span className="kg-discover-strength" data-strength={currentDiscovery.connection_strength}>
                {currentDiscovery.connection_strength}
              </span>
              <span className="kg-discover-type">
                {currentDiscovery.connection_type}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Action bar */}
      <div className="immersive-review-actions">
        <button
          className={`kg-btn ${editMode ? 'kg-btn-primary' : 'kg-btn-secondary'}`}
          onClick={() => setEditMode(!editMode)}
          title="Toggle edit mode (e)"
        >
          <Edit3 size={16} />
          {editMode ? 'Editing' : 'Edit'}
        </button>
        <button
          className="kg-btn kg-btn-success"
          onClick={handleApprove}
          disabled={!!approvingId}
          title="Approve (a)"
        >
          <Check size={16} />
          {editMode ? 'Save & Approve' : 'Approve'}
        </button>
        <button
          className="kg-btn kg-btn-danger"
          onClick={handleDismiss}
          title="Dismiss (d)"
        >
          <XCircle size={16} />
          Dismiss
        </button>
        <button
          className="kg-btn kg-btn-ghost"
          onClick={handleDelete}
          title="Delete (Shift+D)"
        >
          <Trash2 size={16} />
          Delete
        </button>
      </div>
    </div>
  );
}
