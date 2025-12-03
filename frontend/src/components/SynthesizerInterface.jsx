import React, { useState, useEffect, useRef } from 'react';
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
 */
export default function SynthesizerInterface({ conversation, onConversationUpdate }) {
  const [url, setUrl] = useState('');
  const [comment, setComment] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStage, setProcessingStage] = useState('');
  const [error, setError] = useState(null);
  const urlInputRef = useRef(null);

  // Get latest synthesizer message with notes
  const latestNotes = React.useMemo(() => {
    if (!conversation?.messages) return null;

    for (let i = conversation.messages.length - 1; i >= 0; i--) {
      const msg = conversation.messages[i];
      if (msg.role === 'assistant' && msg.notes && msg.notes.length > 0) {
        return {
          notes: msg.notes,
          sourceTitle: msg.source_title || conversation.synthesizer_config?.source_title,
          sourceType: msg.source_type || conversation.synthesizer_config?.source_type
        };
      }
    }
    return null;
  }, [conversation]);

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

    // Only auto-paste if we don't have notes yet
    if (!latestNotes) {
      tryPasteClipboard();
    }
  }, [latestNotes]);

  const handleSubmit = async (e) => {
    e?.preventDefault();

    if (!url.trim()) {
      setError('Please enter a URL');
      return;
    }

    setIsProcessing(true);
    setError(null);
    setProcessingStage('Detecting content type...');

    try {
      // Detect URL type for stage messaging
      const isYouTube = url.includes('youtube.com') || url.includes('youtu.be');
      setProcessingStage(isYouTube ? 'Downloading and transcribing video...' : 'Fetching article content...');

      // Small delay to show the stage
      await new Promise(resolve => setTimeout(resolve, 500));

      setProcessingStage('Generating Zettelkasten notes...');

      const result = await api.synthesize(
        conversation.id,
        url.trim(),
        comment.trim() || null,
        null, // Use default model
        false // Single model mode
      );

      // Update conversation with new message
      if (onConversationUpdate) {
        const updatedConversation = await api.getConversation(conversation.id);
        onConversationUpdate(updatedConversation);
      }

      // Clear inputs
      setUrl('');
      setComment('');
    } catch (err) {
      console.error('Synthesize error:', err);
      setError(err.message || 'Failed to process URL');
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

  return (
    <div className="synthesizer-interface">
      {/* Show NoteViewer if we have notes */}
      {latestNotes ? (
        <div className="synthesizer-content">
          <NoteViewer
            notes={latestNotes.notes}
            sourceTitle={latestNotes.sourceTitle}
            sourceType={latestNotes.sourceType}
          />

          {/* Add another URL */}
          <div className="synthesizer-add-more">
            <button
              className="add-more-btn"
              onClick={() => {
                // Scroll to input, clear notes view temporarily
                urlInputRef.current?.focus();
              }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Process Another URL
            </button>
          </div>
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
            <p>Paste a YouTube video or article URL to generate atomic Zettelkasten notes</p>
          </div>

          <form className="synthesizer-form" onSubmit={handleSubmit}>
            <div className="input-group">
              <label htmlFor="url-input">URL</label>
              <input
                ref={urlInputRef}
                id="url-input"
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="https://youtube.com/watch?v=... or https://example.com/article"
                disabled={isProcessing}
                autoFocus
              />
            </div>

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
              disabled={isProcessing || !url.trim()}
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
                <strong>Articles</strong> - Web pages are parsed via Firecrawl API
              </li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
