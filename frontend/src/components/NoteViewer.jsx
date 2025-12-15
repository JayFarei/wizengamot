import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import ResponseWithComments from './ResponseWithComments';
import TweetModal from './TweetModal';
import CommentModal from './CommentModal';
import { SelectionHandler } from '../utils/SelectionHandler';
import './NoteViewer.css';

/**
 * NoteViewer displays Zettelkasten notes in two modes:
 * - Swipe view: Single note at a time with J/K navigation
 * - List view: All notes in sequence
 *
 * Supports commenting/highlighting on notes via ResponseWithComments.
 */
export default function NoteViewer({
  notes,
  sourceTitle,
  sourceType,
  sourceUrl,
  sourceContent,
  // Comment-related props
  comments = [],
  onSelectionChange,
  onSaveComment,
  onEditComment,
  onDeleteComment,
  activeCommentId,
  onSetActiveComment,
}) {
  const [viewMode, setViewMode] = useState('swipe'); // 'swipe' or 'list'
  const [currentIndex, setCurrentIndex] = useState(0);
  const [focusMode, setFocusMode] = useState(false);
  const [showSourceInfo, setShowSourceInfo] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState(null);
  const [showTweetModal, setShowTweetModal] = useState(false);
  const containerRef = useRef(null);
  const sourceInfoRef = useRef(null);

  // Keyboard sentence navigation state (focus mode only)
  const [sentences, setSentences] = useState([]);
  const [sentenceCursor, setSentenceCursor] = useState(0);
  const [selectionStart, setSelectionStart] = useState(null);
  const [selectionEnd, setSelectionEnd] = useState(null);
  const [keyboardSelection, setKeyboardSelection] = useState(null);
  const [showKeyboardCommentModal, setShowKeyboardCommentModal] = useState(false);

  // Close source info dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (sourceInfoRef.current && !sourceInfoRef.current.contains(e.target)) {
        setShowSourceInfo(false);
      }
    };
    if (showSourceInfo) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showSourceInfo]);

  // Copy source content to clipboard
  const handleCopySource = async () => {
    if (!sourceContent) return;
    try {
      await navigator.clipboard.writeText(sourceContent);
      setCopyFeedback('Copied!');
      setTimeout(() => setCopyFeedback(null), 2000);
    } catch (err) {
      setCopyFeedback('Failed to copy');
      setTimeout(() => setCopyFeedback(null), 2000);
    }
  };

  // Get label for source type
  const getSourceTypeLabel = () => {
    switch (sourceType) {
      case 'youtube': return 'YouTube Transcript';
      case 'podcast': return 'Podcast Transcript';
      case 'article': return 'Article Content';
      default: return 'Source Content';
    }
  };

  // Handle text selection for comments
  useEffect(() => {
    if (!onSelectionChange) return;

    const handleMouseUp = () => {
      const selection = SelectionHandler.getSelection();
      if (selection && selection.sourceType === 'synthesizer') {
        onSelectionChange(selection);
      }
    };

    document.addEventListener('mouseup', handleMouseUp);
    return () => document.removeEventListener('mouseup', handleMouseUp);
  }, [onSelectionChange]);

  // Format note body with empty line after each sentence
  const formatNoteBody = useCallback((body) => {
    if (!body) return '';
    // Split on sentence endings (. ! ?) followed by space or end
    // Keep the punctuation with the sentence, then add double newline
    return body
      .replace(/([.!?])\s+/g, '$1\n\n')
      .trim();
  }, []);

  // Parse note body into array of sentences for keyboard navigation
  const parseSentences = useCallback((body) => {
    if (!body) return [];

    // Common abbreviations that should not end sentences
    const abbreviations = ['e\\.g\\.', 'i\\.e\\.', 'etc\\.', 'vs\\.', 'Dr\\.', 'Mr\\.', 'Mrs\\.', 'Ms\\.', 'Prof\\.', 'Sr\\.', 'Jr\\.', 'no\\.', 'vol\\.', 'pp\\.', 'cf\\.', 'al\\.'];

    // Temporarily replace abbreviations with placeholders
    let processed = body;
    const placeholders = [];
    abbreviations.forEach((abbr, i) => {
      const regex = new RegExp(abbr, 'gi');
      processed = processed.replace(regex, (match) => {
        placeholders.push({ placeholder: `__ABBR${i}_${placeholders.length}__`, original: match });
        return `__ABBR${i}_${placeholders.length - 1}__`;
      });
    });

    // Match sentences ending with . ! ? followed by whitespace or end of string
    const sentenceRegex = /[^.!?]*[.!?]+(?:\s|$)/g;
    const matches = processed.match(sentenceRegex);

    if (!matches) return [body.trim()];

    // Restore abbreviations
    return matches.map(s => {
      let restored = s;
      placeholders.forEach(p => {
        restored = restored.replace(p.placeholder, p.original);
      });
      return restored.trim();
    }).filter(s => s.length > 0);
  }, []);

  // Helper to get the range of selected sentences
  const getSelectionRange = useCallback(() => {
    if (selectionStart !== null && selectionEnd !== null) {
      return {
        start: Math.min(selectionStart, selectionEnd),
        end: Math.max(selectionStart, selectionEnd),
      };
    }
    return { start: sentenceCursor, end: sentenceCursor };
  }, [sentenceCursor, selectionStart, selectionEnd]);

  // Helper to get text of selected sentence(s)
  const getSelectedSentencesText = useCallback(() => {
    if (sentences.length === 0) return null;
    const range = getSelectionRange();
    return sentences.slice(range.start, range.end + 1).join(' ').trim();
  }, [sentences, getSelectionRange]);

  // Copy current note to clipboard in Zettelkasten format
  const copyNoteToClipboard = useCallback(async () => {
    if (!notes?.length) return;

    const safeIndex = Math.min(currentIndex, notes.length - 1);
    const note = notes[safeIndex];
    if (!note) return;

    // Build the formatted note
    const parts = [];

    // # heading
    parts.push(`# ${note.title}`);
    parts.push('');

    // #tags (one per line or space-separated)
    if (note.tags && note.tags.length > 0) {
      const formattedTags = note.tags.map(tag =>
        tag.startsWith('#') ? tag : `#${tag.replace(/\s+/g, '-')}`
      ).join(' ');
      parts.push(formattedTags);
      parts.push('');
    }

    // Note body with empty lines after sentences
    parts.push(formatNoteBody(note.body));
    parts.push('');

    // ### Up and ### Down sections
    parts.push('### Up');
    parts.push('');
    parts.push('### Down');
    parts.push('');

    const formattedNote = parts.join('\n');

    try {
      await navigator.clipboard.writeText(formattedNote);
      setCopyFeedback('Note copied!');
      setTimeout(() => setCopyFeedback(null), 2000);
    } catch (err) {
      setCopyFeedback('Failed to copy');
      setTimeout(() => setCopyFeedback(null), 2000);
    }
  }, [currentIndex, notes, formatNoteBody]);

  // Open tweet modal
  const openTweetModal = useCallback(() => {
    setShowTweetModal(true);
  }, []);

  // Close tweet modal
  const closeTweetModal = useCallback(() => {
    setShowTweetModal(false);
  }, []);

  // Keyboard navigation
  const handleKeyDown = useCallback((e) => {
    // Skip if user is typing in an input or comment modal is open
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (showKeyboardCommentModal) return;
    if (!notes?.length) return;

    // C key copies the current note (in swipe view or focus mode)
    if ((e.key === 'c' || e.key === 'C') && (viewMode === 'swipe' || focusMode)) {
      e.preventDefault();
      copyNoteToClipboard();
      return;
    }

    // X key opens tweet modal (in swipe view or focus mode)
    if ((e.key === 'x' || e.key === 'X') && (viewMode === 'swipe' || focusMode)) {
      e.preventDefault();
      openTweetModal();
      return;
    }

    // F key toggles focus mode (only in swipe view)
    if ((e.key === 'f' || e.key === 'F') && viewMode === 'swipe') {
      e.preventDefault();
      setFocusMode((prev) => {
        if (!prev) {
          // Entering focus mode, reset sentence selection
          setSentenceCursor(0);
          setSelectionStart(null);
          setSelectionEnd(null);
        }
        return !prev;
      });
      return;
    }

    // Escape exits focus mode and clears sentence selection
    if (e.key === 'Escape' && focusMode) {
      e.preventDefault();
      setFocusMode(false);
      setSentenceCursor(0);
      setSelectionStart(null);
      setSelectionEnd(null);
      return;
    }

    // FOCUS MODE ONLY: Arrow keys for sentence navigation, H for highlight
    if (focusMode && sentences.length > 0) {
      // Arrow Down: move sentence cursor down OR extend selection
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (e.shiftKey) {
          // Extend selection downward
          setSelectionEnd((prev) => {
            const current = prev ?? sentenceCursor;
            return Math.min(current + 1, sentences.length - 1);
          });
          if (selectionStart === null) {
            setSelectionStart(sentenceCursor);
          }
        } else {
          // Single sentence navigation
          setSentenceCursor((prev) => Math.min(prev + 1, sentences.length - 1));
          setSelectionStart(null);
          setSelectionEnd(null);
        }
        return;
      }

      // Arrow Up: move sentence cursor up OR extend selection
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (e.shiftKey) {
          // Extend selection upward
          setSelectionEnd((prev) => {
            const current = prev ?? sentenceCursor;
            return Math.max(current - 1, 0);
          });
          if (selectionStart === null) {
            setSelectionStart(sentenceCursor);
          }
        } else {
          // Single sentence navigation
          setSentenceCursor((prev) => Math.max(prev - 1, 0));
          setSelectionStart(null);
          setSelectionEnd(null);
        }
        return;
      }

      // H key: open CommentModal with selected sentence(s)
      if (e.key === 'h' || e.key === 'H') {
        e.preventDefault();
        const selectedText = getSelectedSentencesText();
        if (selectedText) {
          const currentNote = notes[Math.min(currentIndex, notes.length - 1)];
          setKeyboardSelection({
            text: selectedText,
            sourceType: 'synthesizer',
            noteId: currentNote.id,
            noteTitle: currentNote.title,
            sourceUrl: sourceUrl,
            noteModel: currentNote.source_model,
            sourceContent: currentNote.body,
          });
          setShowKeyboardCommentModal(true);
        }
        return;
      }
    }

    // J/K navigation works in swipe view and focus mode (for note navigation)
    if (viewMode !== 'swipe' && !focusMode) return;

    if (e.key === 'j' || e.key === 'J') {
      e.preventDefault();
      setCurrentIndex((prev) => Math.min(prev + 1, notes.length - 1));
    } else if (e.key === 'k' || e.key === 'K') {
      e.preventDefault();
      setCurrentIndex((prev) => Math.max(prev - 1, 0));
    }
  }, [viewMode, focusMode, notes, currentIndex, sentences, sentenceCursor, selectionStart,
      sourceUrl, showKeyboardCommentModal, copyNoteToClipboard, openTweetModal, getSelectedSentencesText]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Auto-focus container when notes are loaded
  useEffect(() => {
    if (notes?.length > 0 && containerRef.current) {
      containerRef.current.focus();
    }
  }, [notes]);

  // Reset index when notes change
  useEffect(() => {
    setCurrentIndex(0);
  }, [notes]);

  // Compute currentNote early for use in effects
  const safeIndexForEffects = notes?.length ? Math.min(currentIndex, notes.length - 1) : 0;
  const currentNoteForEffects = notes?.[safeIndexForEffects];

  // Parse sentences when current note changes
  useEffect(() => {
    if (currentNoteForEffects?.body) {
      setSentences(parseSentences(currentNoteForEffects.body));
      setSentenceCursor(0);
      setSelectionStart(null);
      setSelectionEnd(null);
    } else {
      setSentences([]);
    }
  }, [currentNoteForEffects?.body, parseSentences]);

  // Scroll current sentence into view in focus mode
  useEffect(() => {
    if (focusMode && sentences.length > 0) {
      const sentenceEl = document.querySelector(`[data-sentence-index="${sentenceCursor}"]`);
      if (sentenceEl) {
        sentenceEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [focusMode, sentenceCursor, sentences.length]);

  // Handle keyboard comment save
  const handleKeyboardCommentSave = useCallback(async (commentText) => {
    if (!keyboardSelection || !onSaveComment) return;
    try {
      await onSaveComment(keyboardSelection, commentText);
      setShowKeyboardCommentModal(false);
      setKeyboardSelection(null);
    } catch (error) {
      console.error('Failed to save comment:', error);
    }
  }, [keyboardSelection, onSaveComment]);

  if (!notes || notes.length === 0) {
    return (
      <div className="note-viewer-empty">
        <p>No notes generated yet.</p>
      </div>
    );
  }

  // Ensure currentIndex is within bounds
  const safeIndex = Math.min(currentIndex, notes.length - 1);
  const currentNote = notes[safeIndex];

  // Filter comments for the current note (in swipe view)
  const currentNoteComments = useMemo(() => {
    if (!currentNote || !comments.length) return [];
    return comments.filter((c) => c.note_id === currentNote.id);
  }, [comments, currentNote]);

  // Helper to get comments for a specific note (in list view)
  const getCommentsForNote = useCallback(
    (noteId) => comments.filter((c) => c.note_id === noteId),
    [comments]
  );

  // Extra safety check
  if (!currentNote) {
    return (
      <div className="note-viewer-empty">
        <p>Loading notes...</p>
      </div>
    );
  }

  return (
    <div className="note-viewer" tabIndex={0} ref={containerRef}>
      {/* Header */}
      <div className="note-viewer-header">
        <div className="note-viewer-source">
          {sourceType && (
            <span className={`source-badge source-${sourceType}`}>
              {sourceType === 'youtube' ? 'YouTube' : sourceType === 'podcast' ? 'Podcast' : 'Article'}
            </span>
          )}
          {sourceTitle && <span className="source-title">{sourceTitle}</span>}

          {/* Source Info Button */}
          {(sourceUrl || sourceContent) && (
            <div className="source-info-container" ref={sourceInfoRef}>
              <button
                className="source-info-btn"
                onClick={() => setShowSourceInfo(!showSourceInfo)}
                title="View source info"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="16" x2="12" y2="12" />
                  <line x1="12" y1="8" x2="12.01" y2="8" />
                </svg>
              </button>

              {showSourceInfo && (
                <div className="source-info-dropdown">
                  {sourceUrl && (
                    <a
                      href={sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="source-info-item"
                      onClick={() => setShowSourceInfo(false)}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                        <polyline points="15 3 21 3 21 9" />
                        <line x1="10" y1="14" x2="21" y2="3" />
                      </svg>
                      Open Source URL
                    </a>
                  )}
                  {sourceContent && (
                    <button
                      className="source-info-item"
                      onClick={handleCopySource}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                      </svg>
                      {copyFeedback || `Copy ${getSourceTypeLabel()}`}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="note-viewer-controls">
          <span className="note-count">{notes.length} notes</span>
          <div className="view-toggle">
            <button
              className={`toggle-btn ${viewMode === 'swipe' ? 'active' : ''}`}
              onClick={() => setViewMode('swipe')}
              title="Card view (J/K to navigate)"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="4" y="4" width="16" height="16" rx="2" />
              </svg>
            </button>
            <button
              className={`toggle-btn ${viewMode === 'list' ? 'active' : ''}`}
              onClick={() => setViewMode('list')}
              title="List view"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="4" y1="6" x2="20" y2="6" />
                <line x1="4" y1="12" x2="20" y2="12" />
                <line x1="4" y1="18" x2="20" y2="18" />
              </svg>
            </button>
          </div>
          {viewMode === 'swipe' && (
            <button
              className="toggle-btn focus-btn"
              onClick={() => setFocusMode(true)}
              title="Focus mode (F)"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      {viewMode === 'swipe' ? (
        <div className="swipe-view">
          <div className="note-card">
            <div className="note-card-header">
              <h3 className="note-title">{currentNote.title}</h3>
              {currentNote.source_model && (
                <span className="note-model" title="Generated by">
                  {currentNote.source_model.split('/').pop()}
                </span>
              )}
            </div>

            {currentNote.tags && currentNote.tags.length > 0 && (
              <div className="note-tags">
                {currentNote.tags.map((tag, i) => (
                  <span key={i} className="note-tag">{tag}</span>
                ))}
              </div>
            )}

            <div className="note-body">
              <ResponseWithComments
                content={formatNoteBody(currentNote.body)}
                comments={currentNoteComments}
                sourceType="synthesizer"
                noteId={currentNote.id}
                noteTitle={currentNote.title}
                sourceUrl={sourceUrl}
                noteModel={currentNote.source_model}
                onEditComment={onEditComment}
                onDeleteComment={onDeleteComment}
                activeCommentId={activeCommentId}
                onSetActiveComment={onSetActiveComment}
              />
            </div>
          </div>

          {/* Navigation */}
          <div className="swipe-navigation">
            <button
              className="nav-btn nav-prev"
              onClick={() => setCurrentIndex((prev) => Math.max(prev - 1, 0))}
              disabled={safeIndex === 0}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>

            <div className="nav-indicator">
              <span className="nav-current">{safeIndex + 1}</span>
              <span className="nav-separator">/</span>
              <span className="nav-total">{notes.length}</span>
            </div>

            <button
              className="nav-btn nav-next"
              onClick={() => setCurrentIndex((prev) => Math.min(prev + 1, notes.length - 1))}
              disabled={safeIndex === notes.length - 1}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </div>

          <p className="nav-hint">
            <kbd>J</kbd> / <kbd>K</kbd> navigate, <kbd>F</kbd> focus mode, <kbd>C</kbd> copy note, <kbd>X</kbd> tweet
          </p>
        </div>
      ) : (
        <div className="list-view">
          {notes.map((note, index) => (
            <div key={note.id || index} className="note-list-item">
              <div className="note-list-header">
                <span className="note-number">{index + 1}</span>
                <h3 className="note-title">{note.title}</h3>
                {note.source_model && (
                  <span className="note-model" title="Generated by">
                    {note.source_model.split('/').pop()}
                  </span>
                )}
              </div>

              {note.tags && note.tags.length > 0 && (
                <div className="note-tags">
                  {note.tags.map((tag, i) => (
                    <span key={i} className="note-tag">{tag}</span>
                  ))}
                </div>
              )}

              <div className="note-body">
                <ResponseWithComments
                  content={formatNoteBody(note.body)}
                  comments={getCommentsForNote(note.id)}
                  sourceType="synthesizer"
                  noteId={note.id}
                  noteTitle={note.title}
                  sourceUrl={sourceUrl}
                  noteModel={note.source_model}
                  onEditComment={onEditComment}
                  onDeleteComment={onDeleteComment}
                  activeCommentId={activeCommentId}
                  onSetActiveComment={onSetActiveComment}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Copy Feedback Toast */}
      {copyFeedback && copyFeedback.includes('Note') && (
        <div className="copy-toast">{copyFeedback}</div>
      )}

      {/* Focus Mode Overlay */}
      {focusMode && currentNote && (
        <div className="focus-overlay" onClick={() => setFocusMode(false)}>
          <div className="focus-container" onClick={(e) => e.stopPropagation()}>
            <button
              className="focus-close-btn"
              onClick={() => setFocusMode(false)}
              title="Exit focus mode (Esc)"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>

            <div className="focus-card">
              <div className="note-card-header">
                <h3 className="note-title">{currentNote.title}</h3>
                {currentNote.source_model && (
                  <span className="note-model" title="Generated by">
                    {currentNote.source_model.split('/').pop()}
                  </span>
                )}
              </div>

              {currentNote.tags && currentNote.tags.length > 0 && (
                <div className="note-tags">
                  {currentNote.tags.map((tag, i) => (
                    <span key={i} className="note-tag">{tag}</span>
                  ))}
                </div>
              )}

              <div className="note-body">
                {/* Keyboard sentence navigation view */}
                {sentences.length > 0 ? (
                  <div
                    className="keyboard-sentence-container"
                    data-source-type="synthesizer"
                    data-note-id={currentNote.id}
                    data-note-title={currentNote.title}
                    data-source-url={sourceUrl}
                    data-note-model={currentNote.source_model}
                  >
                    {sentences.map((sentence, index) => {
                      const range = getSelectionRange();
                      const isSelected = index >= range.start && index <= range.end;
                      return (
                        <p
                          key={index}
                          className={`keyboard-sentence ${isSelected ? 'selected' : ''}`}
                          data-sentence-index={index}
                        >
                          {sentence}
                        </p>
                      );
                    })}
                  </div>
                ) : (
                  <ResponseWithComments
                    content={formatNoteBody(currentNote.body)}
                    comments={currentNoteComments}
                    sourceType="synthesizer"
                    noteId={currentNote.id}
                    noteTitle={currentNote.title}
                    sourceUrl={sourceUrl}
                    noteModel={currentNote.source_model}
                    onEditComment={onEditComment}
                    onDeleteComment={onDeleteComment}
                    activeCommentId={activeCommentId}
                    onSetActiveComment={onSetActiveComment}
                  />
                )}
              </div>
            </div>

            <div className="focus-navigation">
              <button
                className="nav-btn nav-prev"
                onClick={() => setCurrentIndex((prev) => Math.max(prev - 1, 0))}
                disabled={safeIndex === 0}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>

              <div className="nav-indicator">
                <span className="nav-current">{safeIndex + 1}</span>
                <span className="nav-separator">/</span>
                <span className="nav-total">{notes.length}</span>
              </div>

              <button
                className="nav-btn nav-next"
                onClick={() => setCurrentIndex((prev) => Math.min(prev + 1, notes.length - 1))}
                disabled={safeIndex === notes.length - 1}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
            </div>

            <p className="focus-hint">
              <kbd>J</kbd>/<kbd>K</kbd> notes, <kbd>↑</kbd>/<kbd>↓</kbd> sentences, <kbd>Shift+↑↓</kbd> multi-select, <kbd>H</kbd> highlight, <kbd>C</kbd> copy, <kbd>X</kbd> tweet, <kbd>Esc</kbd> exit
            </p>
          </div>
        </div>
      )}

      {/* Tweet Modal */}
      {showTweetModal && currentNote && (
        <TweetModal
          note={currentNote}
          sourceUrl={sourceUrl}
          onClose={closeTweetModal}
        />
      )}

      {/* Keyboard-triggered Comment Modal */}
      {showKeyboardCommentModal && keyboardSelection && (
        <CommentModal
          selection={keyboardSelection}
          onSave={handleKeyboardCommentSave}
          onCancel={() => {
            setShowKeyboardCommentModal(false);
            setKeyboardSelection(null);
          }}
        />
      )}
    </div>
  );
}
