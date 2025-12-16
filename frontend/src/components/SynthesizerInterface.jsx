import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import { api } from '../api';
import NoteViewer from './NoteViewer';
import './SynthesizerInterface.css';

/**
 * SynthesizerInterface handles URL input and note generation.
 * Features:
 * - Auto-paste URL from clipboard on focus
 * - Optional comment/guidance for processing
 * - Loading state with progress indication
 * - Renders NoteViewer after generation
 * - Supports commenting/highlighting on generated notes
 * - Shows follow-up conversations with toggle between notes and chat
 */
export default function SynthesizerInterface({
  conversation,
  onConversationUpdate,
  // Comment-related props
  comments = [],
  onSelectionChange,
  onSaveComment,
  onEditComment,
  onDeleteComment,
  activeCommentId,
  onSetActiveComment,
}) {
  const [url, setUrl] = useState('');
  const [comment, setComment] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStage, setProcessingStage] = useState('');
  const [error, setError] = useState(null);
  const [viewMode, setViewMode] = useState('notes'); // 'notes' or 'conversation'
  const [inputMode, setInputMode] = useState('url'); // 'url' or 'text'
  const [textContent, setTextContent] = useState('');
  const urlInputRef = useRef(null);
  const textInputRef = useRef(null);
  const containerRef = useRef(null);
  const conversationEndRef = useRef(null);

  // Get latest synthesizer message with notes
  const latestNotes = useMemo(() => {
    if (!conversation?.messages) return null;

    for (let i = conversation.messages.length - 1; i >= 0; i--) {
      const msg = conversation.messages[i];
      if (msg.role === 'assistant' && msg.notes && msg.notes.length > 0) {
        // Ensure each note has an ID (for backward compatibility with older conversations)
        const notesWithIds = msg.notes.map((note, index) => ({
          ...note,
          id: note.id || `note-${index + 1}`,
        }));

        return {
          notes: notesWithIds,
          sourceTitle: msg.source_title || conversation.synthesizer_config?.source_title,
          sourceType: msg.source_type || conversation.synthesizer_config?.source_type,
          sourceUrl: msg.source_url || conversation.synthesizer_config?.source_url,
          // Support both new source_content and legacy source_content_preview
          sourceContent: msg.source_content || msg.source_content_preview || null
        };
      }
    }
    return null;
  }, [conversation]);

  // Get follow-up messages (conversation thread)
  const followUpMessages = useMemo(() => {
    if (!conversation?.messages) return [];
    return conversation.messages.filter(
      (msg) => msg.role === 'follow-up-user' || msg.role === 'follow-up-assistant'
    );
  }, [conversation]);

  // Check if we have an active conversation
  const hasConversation = followUpMessages.length > 0;

  // Auto-switch to conversation view when new messages arrive
  useEffect(() => {
    if (hasConversation && viewMode === 'notes') {
      setViewMode('conversation');
    }
  }, [followUpMessages.length]);

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    if (viewMode === 'conversation' && conversationEndRef.current) {
      conversationEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [followUpMessages.length, viewMode]);

  // Helper to get short model name
  const getModelShortName = (model) => model?.split('/').pop() || model;

  // Auto-paste URL from clipboard on mount
  useEffect(() => {
    const tryPasteClipboard = async () => {
      try {
        // Check if clipboard API is available
        if (navigator.clipboard && navigator.clipboard.readText) {
          const text = await navigator.clipboard.readText();
          // Only paste if it looks like a URL
          if (text && (text.startsWith('http://') || text.startsWith('https://'))) {
            setUrl(text.trim());
          }
        }
      } catch (e) {
        // Clipboard access denied or not available, ignore
        console.log('Clipboard access not available');
      }
    };

    // Only auto-paste if we don't have notes yet and in URL mode
    if (!latestNotes && inputMode === 'url') {
      tryPasteClipboard();
    }
  }, [latestNotes, inputMode]);

  // Tab key handler to toggle between URL and Text modes
  const handleGlobalKeyDown = useCallback((e) => {
    // Tab toggles mode when not processing and no notes yet
    if (e.key === 'Tab' && !latestNotes && !isProcessing) {
      e.preventDefault();
      setInputMode(prev => prev === 'url' ? 'text' : 'url');
    }
  }, [latestNotes, isProcessing]);

  // Add global keydown listener for Tab toggle
  useEffect(() => {
    if (!latestNotes) {
      window.addEventListener('keydown', handleGlobalKeyDown);
      return () => window.removeEventListener('keydown', handleGlobalKeyDown);
    }
  }, [latestNotes, handleGlobalKeyDown]);

  // Focus appropriate input when mode changes
  useEffect(() => {
    if (!latestNotes && !isProcessing) {
      if (inputMode === 'url' && urlInputRef.current) {
        urlInputRef.current.focus();
      } else if (inputMode === 'text' && textInputRef.current) {
        textInputRef.current.focus();
      }
    }
  }, [inputMode, latestNotes, isProcessing]);

  const handleSubmit = async (e) => {
    e?.preventDefault();

    // Validate based on input mode
    if (inputMode === 'url') {
      if (!url.trim()) {
        setError('Please enter a URL');
        return;
      }
    } else {
      if (!textContent.trim()) {
        setError('Please paste some text');
        return;
      }
      if (textContent.trim().length < 50) {
        setError('Please paste at least 50 characters of text');
        return;
      }
    }

    setIsProcessing(true);
    setError(null);

    try {
      if (inputMode === 'url') {
        setProcessingStage('Detecting content type...');

        // Detect URL type for stage messaging
        const isYouTube = url.includes('youtube.com') || url.includes('youtu.be');
        const isPodcast = url.includes('pca.st') || url.includes('podcasts.apple.com') ||
                          url.includes('open.spotify.com/episode') || url.includes('overcast.fm');
        const isPDF = url.toLowerCase().endsWith('.pdf') ||
                      url.includes('arxiv.org/abs/') ||
                      url.includes('arxiv.org/pdf/');

        if (isYouTube) {
          setProcessingStage('Downloading and transcribing video...');
        } else if (isPodcast) {
          setProcessingStage('Extracting and transcribing podcast...');
        } else if (isPDF) {
          setProcessingStage('Parsing PDF document...');
        } else {
          setProcessingStage('Fetching article content...');
        }

        // Small delay to show the stage
        await new Promise(resolve => setTimeout(resolve, 500));
      } else {
        setProcessingStage('Processing pasted text...');
      }

      setProcessingStage('Generating Zettelkasten notes...');

      const result = await api.synthesize(
        conversation.id,
        inputMode === 'url' ? url.trim() : null,
        comment.trim() || null,
        null, // Use default model
        false, // Single model mode
        inputMode === 'text' ? textContent.trim() : null
      );

      // Update conversation with new message
      if (onConversationUpdate) {
        const updatedConversation = await api.getConversation(conversation.id);
        onConversationUpdate(updatedConversation, result.conversation_title);
      }

      // Clear inputs
      setUrl('');
      setTextContent('');
      setComment('');
    } catch (err) {
      console.error('Synthesize error:', err);
      setError(err.message || (inputMode === 'url' ? 'Failed to process URL' : 'Failed to process text'));
    } finally {
      setIsProcessing(false);
      setProcessingStage('');
    }
  };

  const handleKeyDown = (e) => {
    // Enter to submit (without Shift)
    if (e.key === 'Enter' && !e.shiftKey && e.target.tagName !== 'TEXTAREA') {
      e.preventDefault();
      handleSubmit();
    }
  };

  // Get pinned notes info for conversation view header
  const pinnedNotesInfo = useMemo(() => {
    if (!followUpMessages.length || !latestNotes) return [];
    // Get note titles from the first follow-up user message's context
    const firstMsg = followUpMessages.find((m) => m.role === 'follow-up-user');
    if (!firstMsg?.context_segments) return [];
    return firstMsg.context_segments
      .filter((seg) => seg.note_title || seg.note_id)
      .map((seg) => ({
        id: seg.note_id,
        title: seg.note_title || 'Note',
      }));
  }, [followUpMessages, latestNotes]);

  return (
    <div className="synthesizer-interface">
      {/* Show NoteViewer or Conversation if we have notes */}
      {latestNotes ? (
        <div className="synthesizer-content">
          {/* View toggle when conversation exists */}
          {hasConversation && (
            <div className="synth-view-toggle">
              <button
                className={`synth-toggle-btn ${viewMode === 'notes' ? 'active' : ''}`}
                onClick={() => setViewMode('notes')}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="3" width="7" height="9" rx="1" />
                  <rect x="14" y="3" width="7" height="9" rx="1" />
                  <rect x="3" y="14" width="7" height="7" rx="1" />
                  <rect x="14" y="14" width="7" height="7" rx="1" />
                </svg>
                Notes ({latestNotes.notes.length})
              </button>
              <button
                className={`synth-toggle-btn ${viewMode === 'conversation' ? 'active' : ''}`}
                onClick={() => setViewMode('conversation')}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
                Conversation ({followUpMessages.length})
              </button>
            </div>
          )}

          {/* Notes View */}
          {viewMode === 'notes' && (
            <NoteViewer
              notes={latestNotes.notes}
              sourceTitle={latestNotes.sourceTitle}
              sourceType={latestNotes.sourceType}
              sourceUrl={conversation?.synthesizer_config?.source_url || latestNotes.sourceUrl}
              sourceContent={latestNotes.sourceContent}
              comments={comments}
              onSelectionChange={onSelectionChange}
              onSaveComment={onSaveComment}
              onEditComment={onEditComment}
              onDeleteComment={onDeleteComment}
              activeCommentId={activeCommentId}
              onSetActiveComment={onSetActiveComment}
            />
          )}

          {/* Conversation View */}
          {viewMode === 'conversation' && hasConversation && (
            <div className="synth-conversation-view">
              {/* Pinned Notes Header */}
              {pinnedNotesInfo.length > 0 && (
                <div className="pinned-notes-header">
                  <div className="pinned-label">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 2L12 12M12 12L8 8M12 12L16 8" />
                      <rect x="4" y="14" width="16" height="8" rx="1" />
                    </svg>
                    Pinned Notes
                  </div>
                  <div className="pinned-notes-list">
                    {pinnedNotesInfo.map((note, idx) => (
                      <span key={note.id || idx} className="pinned-note-chip">
                        {note.title}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Conversation Thread */}
              <div className="synth-conversation-thread">
                {followUpMessages.map((msg, idx) => (
                  <div
                    key={idx}
                    className={`synth-message ${msg.role === 'follow-up-user' ? 'user' : 'assistant'}`}
                  >
                    <div className="synth-message-header">
                      {msg.role === 'follow-up-user' ? (
                        <span className="synth-message-label">You</span>
                      ) : (
                        <span className="synth-message-label">{getModelShortName(msg.model)}</span>
                      )}
                    </div>
                    <div className="synth-message-content markdown-content">
                      {msg.loading ? (
                        <div className="synth-loading">
                          <div className="spinner"></div>
                          <span>Thinking...</span>
                        </div>
                      ) : (
                        <ReactMarkdown>{msg.content}</ReactMarkdown>
                      )}
                    </div>
                  </div>
                ))}
                <div ref={conversationEndRef} />
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="synthesizer-input-container">
          <div className="synthesizer-hero">
            <div className="hero-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="3" y="3" width="7" height="9" rx="1" />
                <rect x="14" y="3" width="7" height="9" rx="1" />
                <rect x="3" y="14" width="7" height="7" rx="1" />
                <rect x="14" y="14" width="7" height="7" rx="1" />
              </svg>
            </div>
            <h2>Transform Content into Notes</h2>
            <p>
              {inputMode === 'url'
                ? 'Paste a YouTube video, podcast episode, or article URL to generate atomic Zettelkasten notes'
                : 'Paste text content directly when URLs block bot scraping'}
            </p>
          </div>

          {/* Mode toggle indicator */}
          <div className="synth-mode-toggle">
            <div className="synth-mode-buttons">
              <button
                type="button"
                className={`synth-mode-btn ${inputMode === 'url' ? 'active' : ''}`}
                onClick={() => setInputMode('url')}
                disabled={isProcessing}
              >
                URL
              </button>
              <button
                type="button"
                className={`synth-mode-btn ${inputMode === 'text' ? 'active' : ''}`}
                onClick={() => setInputMode('text')}
                disabled={isProcessing}
              >
                Text
              </button>
            </div>
            <span className="synth-mode-hint">
              <kbd>Tab</kbd> to switch
            </span>
          </div>

          <form className="synthesizer-form" onSubmit={handleSubmit}>
            {/* URL input mode */}
            {inputMode === 'url' && (
              <div className="input-group">
                <label htmlFor="url-input">URL</label>
                <input
                  ref={urlInputRef}
                  id="url-input"
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="https://youtube.com/watch?v=... or https://pca.st/episode/... or article URL"
                  disabled={isProcessing}
                  autoFocus
                />
              </div>
            )}

            {/* Text input mode */}
            {inputMode === 'text' && (
              <div className="input-group">
                <label htmlFor="text-input">Text Content</label>
                <textarea
                  ref={textInputRef}
                  id="text-input"
                  value={textContent}
                  onChange={(e) => setTextContent(e.target.value)}
                  placeholder="Paste your article, transcript, or any text content here..."
                  rows={8}
                  disabled={isProcessing}
                  autoFocus
                />
              </div>
            )}

            <div className="input-group">
              <label htmlFor="comment-input">
                Guidance <span className="optional">(optional)</span>
              </label>
              <textarea
                id="comment-input"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Focus on specific topics, themes, or aspects you want to capture..."
                rows={3}
                disabled={isProcessing}
              />
            </div>

            {error && (
              <div className="synthesizer-error">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                {error}
              </div>
            )}

            <button
              type="submit"
              className="synthesizer-submit"
              disabled={isProcessing || (inputMode === 'url' ? !url.trim() : !textContent.trim())}
            >
              {isProcessing ? (
                <>
                  <span className="spinner"></span>
                  {processingStage}
                </>
              ) : (
                <>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                  </svg>
                  Generate Notes
                </>
              )}
            </button>
          </form>

          <div className="synthesizer-tips">
            <h4>Supported Sources</h4>
            <ul>
              <li>
                <strong>YouTube</strong> - Videos are transcribed locally using Whisper
              </li>
              <li>
                <strong>Podcasts</strong> - Episodes from Pocket Casts, Apple Podcasts, Overcast, etc.
              </li>
              <li>
                <strong>PDFs</strong> - Direct PDF links and arXiv papers (full paper parsing)
              </li>
              <li>
                <strong>Articles</strong> - Web pages are parsed via Firecrawl API
              </li>
              <li>
                <strong>Pasted Text</strong> - Direct text input when URLs block bot scraping
              </li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
