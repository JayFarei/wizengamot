import React, { useState, useMemo, useRef, useEffect } from 'react';
import { api } from '../api';
import SearchModal from './SearchModal';
import './VisualiserInterface.css';

export default function VisualiserInterface({ conversation, onConversationUpdate }) {
  // Diagram styles loaded from API
  const [diagramStyles, setDiagramStyles] = useState([]);
  const [sourceType, setSourceType] = useState(null);
  const [selectedConversationId, setSelectedConversationId] = useState(null);
  const [selectedConversationTitle, setSelectedConversationTitle] = useState(null);
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [selectedStyle, setSelectedStyle] = useState('bento');
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStage, setProcessingStage] = useState('');
  const [error, setError] = useState(null);
  const [showConversationSearch, setShowConversationSearch] = useState(false);
  const [showSourceInfo, setShowSourceInfo] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState(null);
  const [fullscreenMode, setFullscreenMode] = useState(false);
  const [currentVersionIndex, setCurrentVersionIndex] = useState(null);
  const [editPrompt, setEditPrompt] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [isSpellChecking, setIsSpellChecking] = useState(false);
  const [spellCheckStage, setSpellCheckStage] = useState('');
  const [spellCheckResult, setSpellCheckResult] = useState(null);
  const [showPromptModal, setShowPromptModal] = useState(false);
  const sourceInfoRef = useRef(null);
  const sourceOptionsRef = useRef(null);

  // Keyboard navigation for source selection
  const sourceTypes = ['conversation', 'url', 'text'];
  const [selectedSourceIndex, setSelectedSourceIndex] = useState(0);
  const [selectedStyleIndex, setSelectedStyleIndex] = useState(0);
  const styleGridRef = useRef(null);

  // Get all versions (assistant messages with images)
  const allVersions = useMemo(() => {
    if (!conversation?.messages) return [];
    return conversation.messages
      .filter(msg => msg.role === 'assistant' && msg.image_id)
      .map((msg, index) => ({
        version: index + 1,
        imageId: msg.image_id,
        imageUrl: `${api.getBaseUrl()}/api/images/${msg.image_id}`,
        style: msg.style,
        sourceContent: msg.source_content,
        editPrompt: msg.edit_prompt || null,
      }));
  }, [conversation]);

  // Current displayed image (default to latest)
  const currentImage = useMemo(() => {
    if (allVersions.length === 0) return null;
    const idx = currentVersionIndex ?? allVersions.length - 1;
    return allVersions[idx];
  }, [allVersions, currentVersionIndex]);

  // Reset to latest when new version is added
  const latestImage = currentImage; // Alias for compatibility

  // Get source info from user message
  const sourceInfo = useMemo(() => {
    if (!conversation?.messages) return null;

    for (const msg of conversation.messages) {
      if (msg.role === 'user') {
        return {
          sourceType: msg.source_type,
          sourceTitle: msg.source_title,
          sourceUrl: msg.source_url,
          sourceId: msg.source_id,
        };
      }
    }
    return null;
  }, [conversation]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (sourceInfoRef.current && !sourceInfoRef.current.contains(event.target)) {
        setShowSourceInfo(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event) => {
      // Escape closes fullscreen or prompt modal
      if (event.key === 'Escape') {
        if (fullscreenMode) setFullscreenMode(false);
        if (showPromptModal) setShowPromptModal(false);
      }

      // 'd' for download (only when not typing in an input)
      if (event.key === 'd' && !event.metaKey && !event.ctrlKey) {
        const activeElement = document.activeElement;
        const isTyping = activeElement?.tagName === 'INPUT' ||
                         activeElement?.tagName === 'TEXTAREA' ||
                         activeElement?.isContentEditable;
        if (!isTyping && currentImage) {
          event.preventDefault();
          handleDownload();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [fullscreenMode, showPromptModal, currentImage]);

  // Focus source options for keyboard navigation when no image exists
  useEffect(() => {
    if (!latestImage && sourceOptionsRef.current) {
      sourceOptionsRef.current.focus();
    }
  }, [latestImage]);

  // Auto-open search modal when conversation source type is selected
  useEffect(() => {
    if (sourceType === 'conversation' && !selectedConversationId) {
      setShowConversationSearch(true);
    }
  }, [sourceType, selectedConversationId]);

  // Focus style grid when conversation is selected and style step is visible
  useEffect(() => {
    if (sourceType === 'conversation' && selectedConversationId && styleGridRef.current) {
      styleGridRef.current.focus();
    }
  }, [sourceType, selectedConversationId]);

  // Keyboard handler for source selection
  const handleSourceKeyDown = (e) => {
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      setSelectedSourceIndex((prev) => (prev < sourceTypes.length - 1 ? prev + 1 : 0));
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      setSelectedSourceIndex((prev) => (prev > 0 ? prev - 1 : sourceTypes.length - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      setSourceType(sourceTypes[selectedSourceIndex]);
    }
  };

  // Keyboard handler for style grid (3 columns layout)
  const handleStyleKeyDown = (e) => {
    const cols = 3;
    const total = diagramStyles.length;

    if (e.key === 'ArrowRight') {
      e.preventDefault();
      setSelectedStyleIndex((prev) => (prev + 1) % total);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      setSelectedStyleIndex((prev) => (prev - 1 + total) % total);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedStyleIndex((prev) => (prev + cols < total ? prev + cols : prev));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedStyleIndex((prev) => (prev - cols >= 0 ? prev - cols : prev));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (diagramStyles[selectedStyleIndex]) {
        setSelectedStyle(diagramStyles[selectedStyleIndex].id);
        // Submit the form
        handleGenerate();
      }
    }
  };

  // Sync selectedStyleIndex with selectedStyle when styles load
  useEffect(() => {
    const idx = diagramStyles.findIndex(s => s.id === selectedStyle);
    if (idx >= 0) setSelectedStyleIndex(idx);
  }, [diagramStyles, selectedStyle]);

  // Load diagram styles from API
  useEffect(() => {
    const loadDiagramStyles = async () => {
      try {
        const styles = await api.getDiagramStyles();
        // Convert from object to array format
        const stylesArray = Object.entries(styles).map(([id, style]) => ({
          id,
          name: style.name,
          description: style.description,
        }));
        setDiagramStyles(stylesArray);
        // Ensure selected style exists in loaded styles, otherwise use first available
        if (stylesArray.length > 0) {
          const styleExists = stylesArray.some(s => s.id === selectedStyle);
          if (!styleExists) {
            setSelectedStyle(stylesArray[0].id);
          }
        }
      } catch (err) {
        console.error('Failed to load diagram styles:', err);
        // Fallback to default styles if API fails
        setDiagramStyles([
          { id: 'bento', name: 'Bento', description: 'Modular dashboard layout with cards' },
          { id: 'whiteboard', name: 'Whiteboard', description: 'Hand-drawn explanation style' },
          { id: 'system_diagram', name: 'System Diagram', description: 'Technical reference poster' },
          { id: 'napkin', name: 'Napkin Sketch', description: 'Simple conceptual sketch' },
          { id: 'cheatsheet', name: 'Cheatsheet', description: 'Dense reference card' },
          { id: 'cartoon', name: 'Cartoon', description: 'Comic book style illustration' },
        ]);
      }
    };

    loadDiagramStyles();
  }, []);

  const handleGenerate = async () => {
    if (!sourceType) {
      setError('Please select a content source');
      return;
    }

    if (sourceType === 'conversation' && !selectedConversationId) {
      setError('Please select a conversation');
      return;
    }

    if (sourceType === 'url' && !url.trim()) {
      setError('Please enter a URL');
      return;
    }

    if (sourceType === 'text' && !text.trim()) {
      setError('Please enter some text');
      return;
    }

    setIsProcessing(true);
    setError(null);
    setProcessingStage('Preparing content...');

    try {
      setProcessingStage('Generating diagram...');

      const result = await api.visualise(conversation.id, {
        source_type: sourceType,
        source_id: sourceType === 'conversation' ? selectedConversationId : undefined,
        source_url: sourceType === 'url' ? url.trim() : undefined,
        source_text: sourceType === 'text' ? text.trim() : undefined,
        style: selectedStyle,
      });

      // Update conversation
      if (onConversationUpdate) {
        const updatedConversation = await api.getConversation(conversation.id);
        onConversationUpdate(updatedConversation, result.conversation_title);
      }

      // Clear inputs
      setSourceType(null);
      setSelectedConversationId(null);
      setSelectedConversationTitle(null);
      setUrl('');
      setText('');
    } catch (err) {
      console.error('Visualise error:', err);
      setError(err.message || 'Failed to generate diagram');
    } finally {
      setIsProcessing(false);
      setProcessingStage('');
    }
  };

  const handleDownload = () => {
    if (!currentImage) return;

    const filename = `${currentImage.style}-diagram-v${currentVersionNum}.png`;
    const downloadUrl = `${api.getBaseUrl()}/api/images/${currentImage.imageId}/download?filename=${encodeURIComponent(filename)}`;

    // Open download URL - backend serves with Content-Disposition: attachment
    window.open(downloadUrl, '_blank');
  };

  const handleNewDiagram = () => {
    setSourceType(null);
    setSelectedConversationId(null);
    setSelectedConversationTitle(null);
    setUrl('');
    setText('');
    setError(null);
  };

  const handleConversationSelect = (conv) => {
    setSelectedConversationId(conv.id);
    setSelectedConversationTitle(conv.title);
    setShowConversationSearch(false);
  };

  const handleCopySource = async () => {
    if (!latestImage?.sourceContent) return;

    try {
      await navigator.clipboard.writeText(latestImage.sourceContent);
      setCopyFeedback('Copied!');
      setTimeout(() => setCopyFeedback(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
      setCopyFeedback('Failed to copy');
      setTimeout(() => setCopyFeedback(null), 2000);
    }
  };

  const handleEdit = async () => {
    if (!editPrompt.trim() || isEditing) return;

    setIsEditing(true);
    setError(null);

    try {
      await api.editVisualisation(conversation.id, editPrompt.trim());

      // Update conversation to get new version
      if (onConversationUpdate) {
        const updatedConversation = await api.getConversation(conversation.id);
        onConversationUpdate(updatedConversation);
      }

      // Clear edit prompt and reset to latest version
      setEditPrompt('');
      setCurrentVersionIndex(null);
    } catch (err) {
      console.error('Edit error:', err);
      setError(err.message || 'Failed to generate new version');
    } finally {
      setIsEditing(false);
    }
  };

  const handleSpellCheck = async () => {
    if (isSpellChecking) return;

    setIsSpellChecking(true);
    setSpellCheckStage('Analyzing image for spelling errors...');
    setError(null);
    setSpellCheckResult(null);

    try {
      const result = await api.spellCheckVisualisation(conversation.id);

      if (result.has_errors) {
        setSpellCheckStage('Generating corrected version...');
        // Small delay to show the stage change before result appears
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      setSpellCheckResult(result);

      if (result.has_errors) {
        // Update conversation to get new version
        if (onConversationUpdate) {
          const updatedConversation = await api.getConversation(conversation.id);
          onConversationUpdate(updatedConversation);
        }
        // Reset to latest version to show the corrected image
        setCurrentVersionIndex(null);
      }

      // Clear the result message after a few seconds
      setTimeout(() => setSpellCheckResult(null), 8000);
    } catch (err) {
      console.error('Spell check error:', err);
      setError(err.message || 'Failed to spell check diagram');
    } finally {
      setIsSpellChecking(false);
      setSpellCheckStage('');
    }
  };

  // Version navigation helpers
  const currentVersionNum = (currentVersionIndex ?? allVersions.length - 1) + 1;
  const goPrevVersion = () => {
    const current = currentVersionIndex ?? allVersions.length - 1;
    if (current > 0) setCurrentVersionIndex(current - 1);
  };
  const goNextVersion = () => {
    const current = currentVersionIndex ?? allVersions.length - 1;
    if (current < allVersions.length - 1) setCurrentVersionIndex(current + 1);
  };
  const atFirstVersion = (currentVersionIndex ?? allVersions.length - 1) === 0;
  const atLastVersion = (currentVersionIndex ?? allVersions.length - 1) === allVersions.length - 1;

  const getSourceTypeLabel = () => {
    const labels = {
      conversation: 'Conversation',
      url: 'URL',
      text: 'Text'
    };
    return labels[sourceInfo?.sourceType] || 'Source';
  };

  const getStyleName = (styleId) => {
    const style = diagramStyles.find(s => s.id === styleId);
    return style?.name || styleId;
  };

  return (
    <div className="visualiser-interface">
      {latestImage ? (
        <div className="visualiser-result">
          {/* Header bar - matches NoteViewer */}
          <div className="visualiser-header">
            <div className="visualiser-source">
              {sourceInfo?.sourceType && (
                <span className={`source-badge source-${sourceInfo.sourceType}`}>
                  {getSourceTypeLabel()}
                </span>
              )}
              {sourceInfo?.sourceTitle && (
                <span className="source-title">{sourceInfo.sourceTitle}</span>
              )}

              {/* Source Info Button */}
              {(sourceInfo?.sourceUrl || latestImage?.sourceContent) && (
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
                      {sourceInfo?.sourceUrl && (
                        <a
                          href={sourceInfo.sourceUrl}
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
                      {latestImage?.sourceContent && (
                        <button
                          className="source-info-item"
                          onClick={handleCopySource}
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                          </svg>
                          {copyFeedback || 'Copy Source Content'}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="visualiser-controls">
              {allVersions.length > 1 && (
                <div className="version-nav">
                  <button
                    className="version-nav-btn"
                    onClick={goPrevVersion}
                    disabled={atFirstVersion}
                    title="Previous version"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="15 18 9 12 15 6" />
                    </svg>
                  </button>
                  <span className="version-label">v{currentVersionNum} / {allVersions.length}</span>
                  <button
                    className="version-nav-btn"
                    onClick={goNextVersion}
                    disabled={atLastVersion}
                    title="Next version"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </button>
                </div>
              )}
              <span className="style-badge">{getStyleName(latestImage?.style)}</span>
              <button
                className="fullscreen-btn"
                onClick={() => setFullscreenMode(true)}
                title="View fullscreen"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
                </svg>
              </button>
            </div>
          </div>

          {/* Image Content Area */}
          <div className="visualiser-content">
            <div className="visualiser-image-container">
              <img
                src={currentImage.imageUrl}
                alt={`${currentImage.style} diagram`}
                className="visualiser-image"
                onClick={() => setFullscreenMode(true)}
                style={{ cursor: 'pointer' }}
              />
            </div>

            {/* Show the edit prompt that generated this version */}
            {currentImage?.editPrompt && (
              <div
                className="version-prompt"
                onClick={() => setShowPromptModal(true)}
                title="Click to expand"
              >
                <span className="version-prompt-label">Edit:</span>
                <span className="version-prompt-text">{currentImage.editPrompt}</span>
                <span className="version-prompt-expand">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                    <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
                  </svg>
                </span>
              </div>
            )}

            <div className="visualiser-actions">
              <button onClick={handleDownload} className="visualiser-download-btn">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7,10 12,15 17,10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                Download
              </button>
              <button
                onClick={handleSpellCheck}
                disabled={isSpellChecking}
                className="visualiser-spellcheck-btn"
              >
                {isSpellChecking ? (
                  <>
                    <span className="visualiser-spinner"></span>
                    Spell Check
                  </>
                ) : (
                  <>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 20h9" />
                      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                    </svg>
                    Spell Check
                  </>
                )}
              </button>
              <button onClick={handleNewDiagram} className="visualiser-new-btn">
                Create New Diagram
              </button>
            </div>

            {/* Spell check progress indicator */}
            {isSpellChecking && spellCheckStage && (
              <div className="visualiser-spellcheck-progress">
                <span className="visualiser-spinner"></span>
                <span>{spellCheckStage}</span>
              </div>
            )}

            {/* Spell check result message */}
            {spellCheckResult && (
              <div className={`visualiser-spellcheck-result ${spellCheckResult.has_errors ? 'has-errors' : 'no-errors'}`}>
                {spellCheckResult.has_errors ? (
                  <>
                    <strong>Found {spellCheckResult.errors_found.length} spelling error{spellCheckResult.errors_found.length !== 1 ? 's' : ''}:</strong>
                    <ul>
                      {spellCheckResult.errors_found.slice(0, 5).map((error, idx) => (
                        <li key={idx}>{error}</li>
                      ))}
                      {spellCheckResult.errors_found.length > 5 && (
                        <li>...and {spellCheckResult.errors_found.length - 5} more</li>
                      )}
                    </ul>
                    <span className="result-note">A corrected version has been generated.</span>
                  </>
                ) : (
                  <span>No spelling errors found in this diagram.</span>
                )}
              </div>
            )}

            {/* Edit prompt section - always visible */}
            <div className="visualiser-edit-section">
              <input
                type="text"
                value={editPrompt}
                onChange={(e) => setEditPrompt(e.target.value)}
                placeholder="Describe changes for new version..."
                className="visualiser-edit-input"
                disabled={isEditing}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && editPrompt.trim()) {
                    e.preventDefault();
                    handleEdit();
                  }
                }}
              />
              <button
                onClick={handleEdit}
                disabled={!editPrompt.trim() || isEditing}
                className="visualiser-edit-btn"
              >
                {isEditing ? (
                  <>
                    <span className="visualiser-spinner"></span>
                    Generating...
                  </>
                ) : (
                  <>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 5v14M5 12h14" />
                    </svg>
                    New Version
                  </>
                )}
              </button>
            </div>

            {error && <div className="visualiser-error">{error}</div>}
          </div>

          {/* Fullscreen Mode */}
          {fullscreenMode && (
            <div className="visualiser-fullscreen">
              <div className="visualiser-fullscreen-header">
                <span className="visualiser-fullscreen-title">
                  {sourceInfo?.sourceTitle || 'Diagram'}
                </span>
                <div className="visualiser-fullscreen-actions">
                  <button className="visualiser-fullscreen-btn" onClick={handleDownload}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7,10 12,15 17,10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                    Download
                  </button>
                  <button
                    className="visualiser-fullscreen-close"
                    onClick={() => setFullscreenMode(false)}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              </div>
              <div className="visualiser-fullscreen-content">
                <img
                  src={latestImage.imageUrl}
                  alt={`${latestImage.style} diagram`}
                />
              </div>
            </div>
          )}

          {/* Prompt Modal */}
          {showPromptModal && currentImage?.editPrompt && (
            <div className="prompt-modal-overlay" onClick={() => setShowPromptModal(false)}>
              <div className="prompt-modal" onClick={(e) => e.stopPropagation()}>
                <div className="prompt-modal-header">
                  <h3>Edit Prompt (v{currentVersionNum})</h3>
                  <button
                    className="prompt-modal-close"
                    onClick={() => setShowPromptModal(false)}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
                <div className="prompt-modal-content">
                  {currentImage.editPrompt}
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="visualiser-input-container">
          <div className="visualiser-hero">
            <div className="visualiser-hero-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <line x1="9" y1="3" x2="9" y2="21" />
                <line x1="3" y1="9" x2="21" y2="9" />
              </svg>
            </div>
            <h2>Generate Visual Diagrams</h2>
            <p>Transform content into beautiful infographics and diagrams</p>
          </div>

          <div className="visualiser-form">
            {/* Step 1: Select Source */}
            <div className="visualiser-step">
            <h3>1. Choose Content Source</h3>
            <p className="visualiser-source-hint">Use arrow keys to navigate, Enter to select</p>
            <div
              className="visualiser-source-options"
              ref={sourceOptionsRef}
              tabIndex={-1}
              onKeyDown={handleSourceKeyDown}
            >
              <button
                className={`visualiser-source-btn ${sourceType === 'conversation' ? 'selected' : ''} ${!sourceType && selectedSourceIndex === 0 ? 'focused' : ''}`}
                onClick={() => setSourceType('conversation')}
                onMouseEnter={() => !sourceType && setSelectedSourceIndex(0)}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
                <span>Existing Conversation</span>
              </button>
              <button
                className={`visualiser-source-btn ${sourceType === 'url' ? 'selected' : ''} ${!sourceType && selectedSourceIndex === 1 ? 'focused' : ''}`}
                onClick={() => setSourceType('url')}
                onMouseEnter={() => !sourceType && setSelectedSourceIndex(1)}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                </svg>
                <span>URL</span>
              </button>
              <button
                className={`visualiser-source-btn ${sourceType === 'text' ? 'selected' : ''} ${!sourceType && selectedSourceIndex === 2 ? 'focused' : ''}`}
                onClick={() => setSourceType('text')}
                onMouseEnter={() => !sourceType && setSelectedSourceIndex(2)}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14,2 14,8 20,8" />
                  <line x1="16" y1="13" x2="8" y2="13" />
                  <line x1="16" y1="17" x2="8" y2="17" />
                </svg>
                <span>Plain Text</span>
              </button>
            </div>
          </div>

          {/* Step 2: Source Input */}
          {sourceType && (
            <div className="visualiser-step">
              <h3>
                2.{' '}
                {sourceType === 'conversation'
                  ? 'Select Conversation'
                  : sourceType === 'url'
                  ? 'Enter URL'
                  : 'Enter Text'}
              </h3>

              {sourceType === 'conversation' && (
                <div className="visualiser-conversation-select">
                  <button
                    className="visualiser-search-btn"
                    onClick={() => setShowConversationSearch(true)}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="11" cy="11" r="8" />
                      <path d="m21 21-4.35-4.35" />
                    </svg>
                    {selectedConversationTitle || 'Search Conversations'}
                  </button>
                  {selectedConversationId && (
                    <span className="visualiser-selected-badge">Selected</span>
                  )}
                </div>
              )}

              {sourceType === 'url' && (
                <input
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://example.com/article"
                  className="visualiser-url-input"
                />
              )}

              {sourceType === 'text' && (
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Paste or type content to visualize..."
                  rows={6}
                  className="visualiser-text-input"
                />
              )}
            </div>
          )}

          {/* Step 3: Select Style */}
          {sourceType && (
            <div className="visualiser-step">
              <h3>3. Choose Diagram Style</h3>
              <p className="visualiser-style-hint">Use arrow keys to navigate, Enter to generate</p>
              <div
                className="visualiser-style-grid"
                ref={styleGridRef}
                tabIndex={0}
                onKeyDown={handleStyleKeyDown}
              >
                {diagramStyles.map((style, idx) => (
                  <button
                    key={style.id}
                    className={`visualiser-style-card ${selectedStyle === style.id ? 'selected' : ''} ${idx === selectedStyleIndex ? 'focused' : ''}`}
                    onClick={() => {
                      setSelectedStyle(style.id);
                      setSelectedStyleIndex(idx);
                    }}
                    onMouseEnter={() => setSelectedStyleIndex(idx)}
                  >
                    <span className="visualiser-style-name">{style.name}</span>
                    <span className="visualiser-style-desc">{style.description}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {error && <div className="visualiser-error">{error}</div>}

          {sourceType && (
            <button
              className="visualiser-submit"
              onClick={handleGenerate}
              disabled={isProcessing}
            >
              {isProcessing ? (
                <>
                  <span className="visualiser-spinner"></span>
                  {processingStage}
                </>
              ) : (
                <>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                  </svg>
                  Generate Diagram
                </>
              )}
            </button>
          )}
          </div>
        </div>
      )}

      {showConversationSearch && (
        <SearchModal
          isOpen={true}
          onClose={() => setShowConversationSearch(false)}
          onSelectConversation={handleConversationSelect}
          onNewConversation={() => setShowConversationSearch(false)}
          selectMode={true}
        />
      )}
    </div>
  );
}
