import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import sbd from 'sbd';
import ResponseWithComments from './ResponseWithComments';
import TweetModal from './TweetModal';
import CommentModal from './CommentModal';
import FloatingComment from './FloatingComment';
import ActionMenu from './ActionMenu';
import ReviewSessionsButton from './ReviewSessionsButton';
import SourceMetadataModal from './SourceMetadataModal';
import NotePanesView from './NotePanesView';
import { api } from '../api';
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
  // Council deliberation props - for displaying badges
  isDeliberation = false,
  modelCount,
  chairmanModel,
  // Podcast navigation
  onNavigateToPodcast,
  // Visualiser navigation
  onNavigateToVisualiser,
  // Linked visualisations
  linkedVisualisations = [],
  onSelectConversation,
  // Tweet persistence
  conversationId,
  onNoteTweetSaved,
  onSourceMetadataUpdate,
  // Review sessions
  reviewSessionCount = 0,
  onToggleReviewSidebar,
  // Knowledge graph navigation
  onNavigateToGraphEntity,
}) {
  const [viewMode, setViewMode] = useState('swipe'); // 'swipe' or 'list'
  const [showPanesView, setShowPanesView] = useState(false);

  // Helper to get short model name
  const getModelShortName = (model) => model?.split('/').pop() || model;
  const [currentIndex, setCurrentIndex] = useState(0);
  const [focusMode, setFocusMode] = useState(false);
  const [showSourceInfo, setShowSourceInfo] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState(null);
  const [showTweetModal, setShowTweetModal] = useState(false);
  const [showSourceMetadataModal, setShowSourceMetadataModal] = useState(false);
  const [sourceMetadataError, setSourceMetadataError] = useState(null);
  const [isSavingSourceMetadata, setIsSavingSourceMetadata] = useState(false);
  const containerRef = useRef(null);
  const sourceInfoRef = useRef(null);

  // Keyboard sentence navigation state (focus mode only)
  const [sentences, setSentences] = useState([]);
  const [sentenceCursor, setSentenceCursor] = useState(0);
  const [selectionStart, setSelectionStart] = useState(null);
  const [selectionEnd, setSelectionEnd] = useState(null);
  const [keyboardSelection, setKeyboardSelection] = useState(null);
  const [showKeyboardCommentModal, setShowKeyboardCommentModal] = useState(false);

  // Focus mode floating comment state
  const [focusModeComment, setFocusModeComment] = useState(null);
  const [focusModeCommentPosition, setFocusModeCommentPosition] = useState(null);
  const focusModeHoverTimeoutRef = useRef(null);

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
      case 'pdf': return 'PDF Content';
      case 'text': return 'Text Content';
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

  // Parse note body into array of sentences for keyboard navigation
  // Uses sbd (Sentence Boundary Detection) library for robust parsing
  const parseSentences = useCallback((body) => {
    if (!body) return [];

    const sentences = sbd.sentences(body, {
      newline_boundaries: false,
      html_boundaries: false,
      sanitize: false,
      allowed_tags: false,
    });

    return sentences.filter(s => s.trim().length > 0);
  }, []);

  // Format note body with empty line after each sentence
  const formatNoteBody = useCallback((body) => {
    if (!body) return '';
    return parseSentences(body).join('\n\n').trim();
  }, [parseSentences]);

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
    if (sourceUrl) {
      const linkText = sourceTitle?.trim() ? sourceTitle.trim() : sourceUrl;
      parts.push(`[${linkText}](${sourceUrl})`);
    } else {
      parts.push('');
    }
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
  }, [currentIndex, notes, formatNoteBody, sourceTitle, sourceUrl]);

  // Copy all notes to clipboard in markdown format
  const copyAllNotesToClipboard = useCallback(async () => {
    if (!notes?.length) return;

    const parts = [];

    // Header with source as H1
    parts.push(`# ${sourceTitle || sourceUrl || 'Source'}`);
    parts.push('');

    // Each note
    notes.forEach((note, index) => {
      // Format tags as hashtags inline with title
      const tagsStr = note.tags?.length
        ? ` (${note.tags.map((t) => `#${t.replace(/^#/, '')}`).join(' ')})`
        : '';

      // Note title as H3 with tags
      parts.push(`### ${note.title}${tagsStr}`);

      // Body with sentences separated by empty lines
      const body = note.body?.trim() || '';
      if (body) {
        // Split by sentence-ending punctuation followed by space or newline
        const sentences = body
          .split(/(?<=[.!?])\s+/)
          .map((s) => s.trim())
          .filter((s) => s && !/^-{2,}$/.test(s)); // Filter empty and horizontal rules
        sentences.forEach((sentence) => {
          parts.push(sentence);
          parts.push(''); // Empty line after each sentence
        });
      }

      // Add extra empty line between notes (total 2 empty lines)
      if (index < notes.length - 1) {
        parts.push('');
      }
    });

    const formattedText = parts.join('\n').trimEnd();

    try {
      await navigator.clipboard.writeText(formattedText);
      setCopyFeedback('All notes copied!');
      setTimeout(() => setCopyFeedback(null), 2000);
    } catch (err) {
      setCopyFeedback('Failed to copy');
      setTimeout(() => setCopyFeedback(null), 2000);
    }
  }, [notes, sourceTitle, sourceUrl]);

  const handleOpenSourceMetadata = useCallback(() => {
    setSourceMetadataError(null);
    setShowSourceMetadataModal(true);
  }, []);

  const handleCloseSourceMetadata = useCallback(() => {
    setShowSourceMetadataModal(false);
    setSourceMetadataError(null);
  }, []);

  const handleSaveSourceMetadata = useCallback(async (draft) => {
    if (!conversationId) return;

    const normalizeValue = (value) => {
      if (value === null || value === undefined) return null;
      const trimmed = value.trim();
      return trimmed.length ? trimmed : null;
    };

    const currentType = normalizeValue(sourceType);
    const currentTitle = normalizeValue(sourceTitle);
    const currentUrl = normalizeValue(sourceUrl);
    const nextType = normalizeValue(draft.sourceType);
    const nextTitle = normalizeValue(draft.sourceTitle);
    const nextUrl = normalizeValue(draft.sourceUrl);

    const updates = {};
    if (currentType !== nextType) updates.source_type = nextType;
    if (currentTitle !== nextTitle) updates.source_title = nextTitle;
    if (currentUrl !== nextUrl) updates.source_url = nextUrl;

    if (Object.keys(updates).length === 0) {
      setShowSourceMetadataModal(false);
      return;
    }

    setIsSavingSourceMetadata(true);
    setSourceMetadataError(null);
    try {
      const updated = await api.updateSynthesizerSource(conversationId, updates);
      onSourceMetadataUpdate?.(updated);
      setShowSourceMetadataModal(false);
    } catch (error) {
      setSourceMetadataError(error.message || 'Failed to update source info');
    } finally {
      setIsSavingSourceMetadata(false);
    }
  }, [conversationId, sourceType, sourceTitle, sourceUrl, onSourceMetadataUpdate]);

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
    if (showSourceMetadataModal) return;
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

    // B key toggles browse related view (in swipe view or focus mode)
    if ((e.key === 'b' || e.key === 'B') && (viewMode === 'swipe' || focusMode)) {
      e.preventDefault();
      setShowPanesView(prev => !prev);
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
      setFocusModeComment(null);
      setFocusModeCommentPosition(null);
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
      sourceUrl, showKeyboardCommentModal, showSourceMetadataModal, copyNoteToClipboard,
      openTweetModal, getSelectedSentencesText]);

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

  // Apply highlights to keyboard sentence container in focus mode
  useEffect(() => {
    if (!focusMode || !currentNoteComments.length) return;

    const container = document.querySelector('.keyboard-sentence-container');
    if (!container) return;

    // Clear existing highlights
    const existingHighlights = container.querySelectorAll('.text-highlight');
    existingHighlights.forEach(highlight => {
      const parent = highlight.parentNode;
      while (highlight.firstChild) {
        parent.insertBefore(highlight.firstChild, highlight);
      }
      parent.removeChild(highlight);
      parent.normalize();
    });

    // Apply highlights after DOM settles
    const timer = setTimeout(() => {
      currentNoteComments.forEach(comment => {
        const highlights = SelectionHandler.createHighlight(
          container,
          comment.selection,
          comment.id
        );

        highlights.forEach((highlight) => {
          highlight.addEventListener('mouseenter', (e) => {
            clearTimeout(focusModeHoverTimeoutRef.current);
            const rect = e.target.getBoundingClientRect();
            setFocusModeCommentPosition({ top: rect.bottom + 8, left: rect.left });
            setFocusModeComment(comment);
            highlight.classList.add('hover');
          });

          highlight.addEventListener('mouseleave', () => {
            highlight.classList.remove('hover');
            focusModeHoverTimeoutRef.current = setTimeout(() => {
              setFocusModeComment(null);
              setFocusModeCommentPosition(null);
            }, 200);
          });

          highlight.addEventListener('click', (e) => {
            e.stopPropagation();
            const rect = e.target.getBoundingClientRect();
            setFocusModeCommentPosition({ top: rect.bottom + 8, left: rect.left });
            setFocusModeComment(comment);
            onSetActiveComment?.(comment.id);
          });
        });
      });
    }, 100);

    return () => {
      clearTimeout(timer);
      clearTimeout(focusModeHoverTimeoutRef.current);
    };
  }, [focusMode, currentNoteComments, onSetActiveComment]);

  // Extra safety check
  if (!currentNote) {
    return (
      <div className="note-viewer-empty">
        <p>Loading notes...</p>
      </div>
    );
  }

  // Show panes view when active
  if (showPanesView) {
    return (
      <NotePanesView
        initialNote={currentNote}
        conversationId={conversationId}
        sourceTitle={sourceTitle}
        onClose={() => setShowPanesView(false)}
        onViewConversation={onSelectConversation}
        onNavigateToGraph={onNavigateToGraphEntity}
      />
    );
  }

  return (
    <div className="note-viewer" tabIndex={0} ref={containerRef}>
      {/* Header */}
      <div className="note-viewer-header">
        <div className="note-viewer-source">
          {/* Source type badge */}
          {sourceType && (
            <span className={`source-badge source-${sourceType}`}>
              {sourceType.toUpperCase()}
            </span>
          )}

          {/* Council icon */}
          {isDeliberation && (
            <span className="council-icon" title="Council Deliberation">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="7" r="4" />
                <path d="M5.5 21a6.5 6.5 0 0 1 13 0" />
                <circle cx="4" cy="9" r="2.5" />
                <path d="M1 19a4 4 0 0 1 6 0" />
                <circle cx="20" cy="9" r="2.5" />
                <path d="M17 19a4 4 0 0 1 6 0" />
              </svg>
            </span>
          )}

          {sourceTitle && <span className="source-title">{sourceTitle}</span>}
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
          <ReviewSessionsButton
            sessionCount={reviewSessionCount}
            onClick={onToggleReviewSidebar}
          />
          <ActionMenu>
            {onNavigateToPodcast && (
              <ActionMenu.Item
                icon={
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                    <line x1="12" y1="19" x2="12" y2="23" />
                    <line x1="8" y1="23" x2="16" y2="23" />
                  </svg>
                }
                label="Generate Podcast"
                onClick={onNavigateToPodcast}
              />
            )}
            {onNavigateToVisualiser && (
              <ActionMenu.Item
                icon={
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <line x1="9" y1="3" x2="9" y2="21" />
                    <line x1="3" y1="9" x2="21" y2="9" />
                  </svg>
                }
                label="Create Diagram"
                onClick={onNavigateToVisualiser}
              />
            )}
            {linkedVisualisations.length > 0 && onSelectConversation && (
              <ActionMenu.Submenu
                id="linked-diagrams"
                icon={
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="3" width="7" height="7" rx="1" />
                    <rect x="14" y="3" width="7" height="7" rx="1" />
                    <rect x="3" y="14" width="7" height="7" rx="1" />
                    <rect x="14" y="14" width="7" height="7" rx="1" />
                  </svg>
                }
                label="View Linked Diagrams"
                badge={linkedVisualisations.length}
              >
                {linkedVisualisations.map((vis) => (
                  <ActionMenu.Item
                    key={vis.id}
                    icon={
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="3" y="3" width="18" height="18" rx="2" />
                        <line x1="9" y1="3" x2="9" y2="21" />
                        <line x1="3" y1="9" x2="21" y2="9" />
                      </svg>
                    }
                    label={vis.title}
                    onClick={() => onSelectConversation(vis.id)}
                  />
                ))}
              </ActionMenu.Submenu>
            )}
            {(onNavigateToPodcast || onNavigateToVisualiser || linkedVisualisations.length > 0) && <ActionMenu.Divider />}
            <ActionMenu.Item
              icon={
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                </svg>
              }
              label="Browse Related"
              onClick={() => setShowPanesView(true)}
            />
            <ActionMenu.Item
              icon={
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              }
              label={copyFeedback || "Copy Note"}
              onClick={copyNoteToClipboard}
            />
            <ActionMenu.Item
              icon={
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  <line x1="12" y1="12" x2="12" y2="18" />
                  <line x1="9" y1="15" x2="15" y2="15" />
                </svg>
              }
              label="Copy All Notes"
              onClick={copyAllNotesToClipboard}
            />
            {conversationId && onSourceMetadataUpdate && (
              <ActionMenu.Item
                icon={
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
                  </svg>
                }
                label="Edit Source Info"
                onClick={handleOpenSourceMetadata}
              />
            )}
            {sourceContent && (
              <ActionMenu.Item
                icon={
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                }
                label={`Copy ${getSourceTypeLabel()}`}
                onClick={handleCopySource}
              />
            )}
            {sourceUrl && (
              <ActionMenu.Item
                icon={
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                    <polyline points="15 3 21 3 21 9" />
                    <line x1="10" y1="14" x2="21" y2="3" />
                  </svg>
                }
                label="Open Source URL"
                onClick={() => window.open(sourceUrl, '_blank')}
              />
            )}
          </ActionMenu>
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
            <kbd>J</kbd> / <kbd>K</kbd> navigate, <kbd>F</kbd> focus mode, <kbd>B</kbd> browse related, <kbd>C</kbd> copy, <kbd>X</kbd> tweet
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
      {copyFeedback && (copyFeedback.includes('Note') || copyFeedback.includes('notes')) && (
        <div className="copy-toast">{copyFeedback}</div>
      )}

      {showSourceMetadataModal && (
        <SourceMetadataModal
          isOpen={showSourceMetadataModal}
          initialValues={{
            sourceType: sourceType || '',
            sourceTitle: sourceTitle || '',
            sourceUrl: sourceUrl || '',
          }}
          onSave={handleSaveSourceMetadata}
          onClose={handleCloseSourceMetadata}
          isSaving={isSavingSourceMetadata}
          error={sourceMetadataError}
        />
      )}

      {/* Focus Mode Overlay */}
      {focusMode && currentNote && (
        <div className="focus-overlay" onClick={() => {
          setFocusMode(false);
          setFocusModeComment(null);
          setFocusModeCommentPosition(null);
        }}>
          <div className="focus-container" onClick={(e) => e.stopPropagation()}>
            <button
              className="focus-close-btn"
              onClick={() => {
                setFocusMode(false);
                setFocusModeComment(null);
                setFocusModeCommentPosition(null);
              }}
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
                        <div
                          key={index}
                          className={`keyboard-sentence ${isSelected ? 'selected' : ''} markdown-content`}
                          data-sentence-index={index}
                        >
                          <ReactMarkdown>{sentence}</ReactMarkdown>
                        </div>
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

            {/* Floating comment for focus mode highlights */}
            {focusModeComment && focusModeCommentPosition && (
              <FloatingComment
                comment={focusModeComment}
                position={focusModeCommentPosition}
                onDelete={onDeleteComment}
                isPinned={false}
                onClose={() => {
                  setFocusModeComment(null);
                  setFocusModeCommentPosition(null);
                }}
                onMouseEnter={() => clearTimeout(focusModeHoverTimeoutRef.current)}
                onMouseLeave={() => {
                  focusModeHoverTimeoutRef.current = setTimeout(() => {
                    setFocusModeComment(null);
                    setFocusModeCommentPosition(null);
                  }, 200);
                }}
              />
            )}
          </div>
        </div>
      )}

      {/* Tweet Modal */}
      {showTweetModal && currentNote && (
        <TweetModal
          note={currentNote}
          sourceUrl={sourceUrl}
          conversationId={conversationId}
          onClose={closeTweetModal}
          onTweetSaved={onNoteTweetSaved}
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
