import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import { api } from '../api';
import NoteViewer from './NoteViewer';
import DeliberationNoteViewer from './DeliberationNoteViewer';
import KnowledgeGraphNoteViewer from './KnowledgeGraphNoteViewer';
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
  // Podcast navigation
  onNavigateToPodcast,
  // Visualiser navigation
  onNavigateToVisualiser,
  // Linked visualisations
  linkedVisualisations = [],
  onSelectConversation,
  // Review sessions
  reviewSessionCount = 0,
  onToggleReviewSidebar,
  // Knowledge graph navigation
  onNavigateToGraphEntity,
  onNavigateToGraphSearch,
}) {
  const [url, setUrl] = useState('');
  const [comment, setComment] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStage, setProcessingStage] = useState('');
  const [error, setError] = useState(null);
  const [viewMode, setViewMode] = useState('notes'); // 'notes' or 'conversation'
  const [inputMode, setInputMode] = useState('url'); // 'url' or 'text'
  const [textContent, setTextContent] = useState('');
  const [generationMode, setGenerationMode] = useState('single'); // 'single', 'deliberation', or 'knowledge_graph'
  // Model selection for deliberation mode
  const [availableModels, setAvailableModels] = useState([]);
  const [selectedModels, setSelectedModels] = useState([]);
  const [chairmanModel, setChairmanModel] = useState('');
  const [defaultCouncilModels, setDefaultCouncilModels] = useState([]);
  const [defaultChairman, setDefaultChairman] = useState('');
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
          sourceContent: msg.source_content || msg.source_content_preview || null,
          // Deliberation mode data
          isDeliberation: msg.mode === 'deliberation',
          deliberation: msg.deliberation || null,
          stage3Raw: msg.stage3_raw || null,
          models: msg.models || null,
          chairmanModel: msg.chairman_model || null,
          // Knowledge graph mode data
          isKnowledgeGraph: msg.mode === 'knowledge_graph',
          contextNotes: msg.context_notes || null,
          topicsExtracted: msg.topics_extracted || null,
          model: msg.model || null,
          rawResponse: msg.raw_response || null,
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

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    if (viewMode === 'conversation' && conversationEndRef.current) {
      conversationEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [followUpMessages.length, viewMode]);

  // Helper to get short model name
  const getModelShortName = (model) => model?.split('/').pop() || model;

  // Fetch available models when deliberation mode is selected
  useEffect(() => {
    if (generationMode === 'deliberation' && availableModels.length === 0) {
      const fetchModels = async () => {
        try {
          const settings = await api.getModelSettings();
          setAvailableModels(settings.model_pool || []);
          setDefaultCouncilModels(settings.council_models || []);
          setDefaultChairman(settings.chairman || '');
          // Set defaults
          setSelectedModels(settings.council_models || settings.model_pool || []);
          setChairmanModel(settings.chairman || (settings.model_pool?.[0] || ''));
        } catch (err) {
          console.error('Failed to fetch models:', err);
        }
      };
      fetchModels();
    }
  }, [generationMode, availableModels.length]);

  // Toggle model selection
  const handleToggleModel = (model) => {
    if (selectedModels.includes(model)) {
      // Don't allow deselecting all models
      if (selectedModels.length > 1) {
        setSelectedModels(selectedModels.filter(m => m !== model));
      }
    } else {
      setSelectedModels([...selectedModels, model]);
    }
  };

  // Keyboard handler for step navigation
  const handleStepKeyDown = (e, step) => {
    const toggleButtons = e.target.closest('.synth-toggle-buttons')?.querySelectorAll('.synth-toggle-btn');

    if (e.key === 'Tab' && toggleButtons) {
      // Tab cycles within the step
      e.preventDefault();
      const currentIndex = Array.from(toggleButtons).indexOf(e.target);
      const nextIndex = (currentIndex + 1) % toggleButtons.length;
      toggleButtons[nextIndex].focus();
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      e.target.click(); // Select current option

      // Advance to next step
      if (step === 'mode') {
        document.querySelector('.synth-step-source .synth-toggle-btn')?.focus();
      } else if (step === 'source') {
        const targetRef = inputMode === 'url' ? urlInputRef : textInputRef;
        targetRef.current?.focus();
      }
    }
  };

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


  // Focus first step button on mount (keyboard-driven flow)
  useEffect(() => {
    if (!latestNotes && !isProcessing) {
      // Focus the first toggle button for keyboard navigation
      const firstButton = document.querySelector('.synth-step-mode .synth-toggle-btn');
      if (firstButton) {
        firstButton.focus();
      }
    }
  }, [latestNotes, isProcessing]);

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

      // Update stage message based on generation mode
      if (generationMode === 'deliberation') {
        setProcessingStage('Stage 1: Models generating notes...');
      } else if (generationMode === 'knowledge_graph') {
        setProcessingStage('Analyzing content and querying knowledge graph...');
      } else {
        setProcessingStage('Generating Zettelkasten notes...');
      }

      const result = await api.synthesize(
        conversation.id,
        inputMode === 'url' ? url.trim() : null,
        comment.trim() || null,
        null, // Use default model
        false, // Single model mode (use_council)
        inputMode === 'text' ? textContent.trim() : null,
        generationMode === 'deliberation', // use_deliberation
        generationMode === 'deliberation' ? selectedModels : null, // council_models
        generationMode === 'deliberation' ? chairmanModel : null, // chairman_model
        generationMode === 'knowledge_graph' // use_knowledge_graph
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

  // Handle tweet saved - refresh conversation to get updated note with tweet
  const handleNoteTweetSaved = useCallback(async (noteId, tweet) => {
    if (onConversationUpdate && conversation?.id) {
      try {
        const updatedConversation = await api.getConversation(conversation.id);
        onConversationUpdate(updatedConversation);
      } catch (err) {
        console.error('Failed to refresh conversation after tweet save:', err);
      }
    }
  }, [conversation?.id, onConversationUpdate]);

  const handleSourceMetadataUpdate = useCallback((updatedConversation) => {
    if (onConversationUpdate) {
      onConversationUpdate(updatedConversation);
    }
  }, [onConversationUpdate]);

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
            latestNotes.isKnowledgeGraph ? (
              <KnowledgeGraphNoteViewer
                notes={latestNotes.notes}
                contextNotes={latestNotes.contextNotes}
                topicsExtracted={latestNotes.topicsExtracted}
                rawResponse={latestNotes.rawResponse}
                sourceTitle={latestNotes.sourceTitle}
                sourceType={latestNotes.sourceType}
                sourceUrl={conversation?.synthesizer_config?.source_url || latestNotes.sourceUrl}
                sourceContent={latestNotes.sourceContent}
                model={latestNotes.model}
                conversationId={conversation?.id}
                comments={comments}
                onSelectionChange={onSelectionChange}
                onSaveComment={onSaveComment}
                onEditComment={onEditComment}
                onDeleteComment={onDeleteComment}
                activeCommentId={activeCommentId}
                onSetActiveComment={onSetActiveComment}
                onSourceMetadataUpdate={handleSourceMetadataUpdate}
                reviewSessionCount={reviewSessionCount}
                onToggleReviewSidebar={onToggleReviewSidebar}
                onNavigateToGraphSearch={onNavigateToGraphSearch}
              />
            ) : latestNotes.isDeliberation ? (
              <DeliberationNoteViewer
                notes={latestNotes.notes}
                deliberation={latestNotes.deliberation}
                stage3Raw={latestNotes.stage3Raw}
                sourceTitle={latestNotes.sourceTitle}
                sourceType={latestNotes.sourceType}
                sourceUrl={conversation?.synthesizer_config?.source_url || latestNotes.sourceUrl}
                sourceContent={latestNotes.sourceContent}
                models={latestNotes.models}
                chairmanModel={latestNotes.chairmanModel}
                conversationId={conversation?.id}
                comments={comments}
                onSelectionChange={onSelectionChange}
                onSaveComment={onSaveComment}
                onEditComment={onEditComment}
                onDeleteComment={onDeleteComment}
                activeCommentId={activeCommentId}
                onSetActiveComment={onSetActiveComment}
                onSourceMetadataUpdate={handleSourceMetadataUpdate}
                reviewSessionCount={reviewSessionCount}
                onToggleReviewSidebar={onToggleReviewSidebar}
              />
            ) : (
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
                onNavigateToPodcast={onNavigateToPodcast}
                onNavigateToVisualiser={onNavigateToVisualiser}
                linkedVisualisations={linkedVisualisations}
                onSelectConversation={onSelectConversation}
                conversationId={conversation?.id}
                onNoteTweetSaved={handleNoteTweetSaved}
                onSourceMetadataUpdate={handleSourceMetadataUpdate}
                reviewSessionCount={reviewSessionCount}
                onToggleReviewSidebar={onToggleReviewSidebar}
                onNavigateToGraphEntity={onNavigateToGraphEntity}
              />
            )
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
            <p>Generate atomic Zettelkasten notes from any content</p>
            <p className="synth-keyboard-hint"><kbd>Tab</kbd> switch <kbd>Enter</kbd> next</p>
          </div>

          {/* Step 1: Mode selection */}
          <div className="synth-step synth-step-mode">
            <div className="synth-step-header">
              <span className="synth-step-number">1</span>
              <span className="synth-step-label">Mode</span>
            </div>
            <div className="synth-toggle-buttons">
              <button
                type="button"
                className={`synth-toggle-btn ${generationMode === 'single' ? 'active' : ''}`}
                onClick={() => setGenerationMode('single')}
                onKeyDown={(e) => handleStepKeyDown(e, 'mode')}
                disabled={isProcessing}
              >
                Single
              </button>
              <button
                type="button"
                className={`synth-toggle-btn ${generationMode === 'deliberation' ? 'active' : ''}`}
                onClick={() => setGenerationMode('deliberation')}
                onKeyDown={(e) => handleStepKeyDown(e, 'mode')}
                disabled={isProcessing}
              >
                Council
              </button>
              <button
                type="button"
                className={`synth-toggle-btn ${generationMode === 'knowledge_graph' ? 'active' : ''}`}
                onClick={() => setGenerationMode('knowledge_graph')}
                onKeyDown={(e) => handleStepKeyDown(e, 'mode')}
                disabled={isProcessing}
              >
                Knowledge Graph
              </button>
            </div>
            <p className="synth-step-desc">
              {generationMode === 'single'
                ? 'One model generates all notes from the content.'
                : generationMode === 'deliberation'
                ? 'Multiple models generate notes, review each other\'s work, then a chairman synthesizes the best.'
                : 'Notes generated with awareness of your existing knowledge graph for consistency and gap-filling.'}
            </p>

            {/* Collapsible Council Settings */}
            {generationMode === 'deliberation' && availableModels.length > 0 && (
              <details className="synth-council-settings">
                <summary>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                  Council Settings
                  <span className="synth-settings-preview">
                    {selectedModels.length} models, {getModelShortName(chairmanModel)} chairman
                  </span>
                </summary>
                <div className="synth-settings-content">
                  <div className="synth-model-section">
                    <h4>Council Members</h4>
                    <div className="synth-model-checkboxes">
                      {availableModels.map((model) => (
                        <label key={model} className="synth-checkbox-label">
                          <input
                            type="checkbox"
                            tabIndex={-1}
                            checked={selectedModels.includes(model)}
                            onChange={() => handleToggleModel(model)}
                            disabled={isProcessing}
                          />
                          <span>{getModelShortName(model)}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                  <div className="synth-model-section">
                    <h4>Chairman</h4>
                    <select
                      className="synth-chairman-select"
                      tabIndex={-1}
                      value={chairmanModel}
                      onChange={(e) => setChairmanModel(e.target.value)}
                      disabled={isProcessing}
                    >
                      {availableModels.map((model) => (
                        <option key={model} value={model}>
                          {getModelShortName(model)}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </details>
            )}
          </div>

          {/* Step 2: Source selection */}
          <div className="synth-step synth-step-source">
            <div className="synth-step-header">
              <span className="synth-step-number">2</span>
              <span className="synth-step-label">Source</span>
            </div>
            <div className="synth-toggle-buttons">
              <button
                type="button"
                className={`synth-toggle-btn ${inputMode === 'url' ? 'active' : ''}`}
                onClick={() => setInputMode('url')}
                onKeyDown={(e) => handleStepKeyDown(e, 'source')}
                disabled={isProcessing}
              >
                URL
              </button>
              <button
                type="button"
                className={`synth-toggle-btn ${inputMode === 'text' ? 'active' : ''}`}
                onClick={() => setInputMode('text')}
                onKeyDown={(e) => handleStepKeyDown(e, 'source')}
                disabled={isProcessing}
              >
                Text
              </button>
            </div>
            <p className="synth-step-desc">
              {inputMode === 'url'
                ? 'Paste a YouTube, podcast, PDF, or article URL.'
                : 'Paste text directly when URLs block bot scraping.'}
            </p>
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
