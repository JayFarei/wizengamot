import React, { useState, useEffect, useCallback, useRef } from 'react';
import { X, ChevronRight, ExternalLink, Link2, Tag, FileText, ArrowLeft, Clock, Youtube, Mic, Globe, RefreshCw } from 'lucide-react';
import sbd from 'sbd';
import { api } from '../api';
import { formatRelativeTime } from '../utils/formatRelativeTime';
import './NotePanesView.css';

// Entity type badge colors (matching KnowledgeGraph.css)
const ENTITY_TYPE_COLORS = {
  concept: 'var(--kg-entity-concept)',
  technology: 'var(--kg-entity-tech)',
  person: 'var(--kg-entity-person)',
  organization: 'var(--kg-entity-org)',
  event: 'var(--kg-entity-event)',
};

// Helper functions for source type display
const getSourceIcon = (type) => {
  switch (type) {
    case 'youtube': return <Youtube size={14} />;
    case 'podcast': return <Mic size={14} />;
    case 'pdf': return <FileText size={14} />;
    case 'article': return <Globe size={14} />;
    default: return <FileText size={14} />;
  }
};

const getSourceLabel = (type) => {
  switch (type) {
    case 'youtube': return 'YouTube';
    case 'podcast': return 'Podcast';
    case 'pdf': return 'PDF';
    case 'article': return 'Article';
    case 'text': return 'Text';
    default: return 'Source';
  }
};

/**
 * NotePanesView - Andy Matuschak-style sliding panes for browsing related notes
 *
 * Features:
 * - Horizontal pane stack
 * - Collapsed panes show as thin vertical strips with title
 * - Related notes sidebar
 * - Click pane to expand, others collapse
 */
export default function NotePanesView({
  initialNote,
  conversationId,
  sourceTitle,
  onClose,
  onViewConversation,
  onNavigateToGraph,
}) {
  const [paneStack, setPaneStack] = useState([]);
  const [relatedNotes, setRelatedNotes] = useState(null);
  const [loadingRelated, setLoadingRelated] = useState(false);
  const [selectedRelatedIndex, setSelectedRelatedIndex] = useState(0);
  const [noteEntities, setNoteEntities] = useState(null);
  const [loadingEntities, setLoadingEntities] = useState(false);
  const [extractingEntities, setExtractingEntities] = useState(false);
  const containerRef = useRef(null);

  // Parse note body into sentences for formatting
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

  // Initialize with the first note
  useEffect(() => {
    if (initialNote) {
      setPaneStack([{
        noteId: initialNote.id,
        noteData: initialNote,
        isFocused: true,
        conversationId: conversationId,
      }]);
    }
  }, [initialNote, conversationId]);

  // Load related notes when focused pane changes
  useEffect(() => {
    const focusedPane = paneStack.find(p => p.isFocused);
    if (!focusedPane) return;

    const loadRelated = async () => {
      setLoadingRelated(true);
      try {
        // Build the full note ID for the API
        // If noteId already has the full format (from related notes API), use it directly
        // Otherwise construct it (for initial note from NoteViewer)
        const fullNoteId = focusedPane.noteId.startsWith('note:')
          ? focusedPane.noteId
          : `note:${focusedPane.conversationId}:${focusedPane.noteId}`;
        const result = await api.getRelatedNotes(fullNoteId);
        setRelatedNotes(result);
      } catch (err) {
        console.error('Failed to load related notes:', err);
        setRelatedNotes(null);
      } finally {
        setLoadingRelated(false);
      }
    };

    loadRelated();
  }, [paneStack]);

  // Load entities for the focused note
  useEffect(() => {
    const focusedPane = paneStack.find(p => p.isFocused);
    if (!focusedPane) return;

    const loadEntities = async () => {
      setLoadingEntities(true);
      try {
        const fullNoteId = focusedPane.noteId.startsWith('note:')
          ? focusedPane.noteId
          : `note:${focusedPane.conversationId}:${focusedPane.noteId}`;
        const result = await api.getNoteEntities(fullNoteId);
        setNoteEntities(result);
      } catch (err) {
        console.error('Failed to load note entities:', err);
        setNoteEntities(null);
      } finally {
        setLoadingEntities(false);
      }
    };

    loadEntities();
  }, [paneStack]);

  // Re-extract entities for the current conversation
  const handleReextractEntities = useCallback(async () => {
    const focusedPane = paneStack.find(p => p.isFocused);
    if (!focusedPane) return;

    setExtractingEntities(true);
    try {
      await api.extractEntities(focusedPane.conversationId);
      // Reload entities after extraction
      const fullNoteId = focusedPane.noteId.startsWith('note:')
        ? focusedPane.noteId
        : `note:${focusedPane.conversationId}:${focusedPane.noteId}`;
      const result = await api.getNoteEntities(fullNoteId);
      setNoteEntities(result);
    } catch (err) {
      console.error('Failed to re-extract entities:', err);
    } finally {
      setExtractingEntities(false);
    }
  }, [paneStack]);

  // Open a related note in a new pane
  const openRelatedNote = useCallback((note) => {
    setPaneStack(prev => {
      // Collapse all existing panes
      const collapsed = prev.map(p => ({ ...p, isFocused: false }));

      // Check if note is already in stack
      // Handle both full ID format (note:conv:id) and simple ID format
      const existingIndex = collapsed.findIndex(p => {
        // If both are full format, compare directly
        if (p.noteId.startsWith('note:') && note.id.startsWith('note:')) {
          return p.noteId === note.id;
        }
        // Otherwise compare by conversation + note ID
        return p.noteId === note.id && p.conversationId === note.group;
      });

      if (existingIndex !== -1) {
        // Focus existing pane
        collapsed[existingIndex].isFocused = true;
        return collapsed;
      }

      // Add new pane as focused
      return [...collapsed, {
        noteId: note.id,
        noteData: note,
        isFocused: true,
        conversationId: note.group,
      }];
    });
  }, []);

  // Focus a specific pane
  const focusPane = useCallback((index) => {
    setPaneStack(prev =>
      prev.map((p, i) => ({ ...p, isFocused: i === index }))
    );
  }, []);

  // Close a pane
  const closePane = useCallback((index) => {
    setPaneStack(prev => {
      const newStack = prev.filter((_, i) => i !== index);
      // If we closed the focused pane, focus the last one
      if (prev[index].isFocused && newStack.length > 0) {
        newStack[newStack.length - 1].isFocused = true;
      }
      return newStack;
    });
  }, []);

  // Scroll to focused pane
  useEffect(() => {
    if (!containerRef.current) return;
    const focusedIndex = paneStack.findIndex(p => p.isFocused);
    if (focusedIndex === -1) return;

    const panes = containerRef.current.querySelectorAll('.note-pane');
    if (panes[focusedIndex]) {
      panes[focusedIndex].scrollIntoView({
        behavior: 'smooth',
        inline: 'start',
        block: 'nearest'
      });
    }
  }, [paneStack]);

  // Get all related notes as a flat list for the sidebar
  // Combine all connection types and sort by score for a unified ranking
  const allRelatedNotes = relatedNotes?.related ? [
    ...(relatedNotes.related.shared_entity || []),    // Direct entity matches (score: 10)
    ...(relatedNotes.related.via_relationship || []), // Multi-hop via relationships (score: 7)
    ...(relatedNotes.related.shared_tag || []),       // Cross-source via tags (score: 5)
    ...(relatedNotes.related.sequential || []).slice(0, 2),  // Same source neighbors (score: 3)
    ...(relatedNotes.related.same_source || []).slice(0, 2), // Same source others (score: 2)
  ] : [];

  // Remove duplicates and sort by score
  const deduplicatedNotes = allRelatedNotes
    .filter((note, index, self) => self.findIndex(n => n.id === note.id) === index)
    .sort((a, b) => (b.score || 0) - (a.score || 0));

  // Filter out notes that are already open in the pane stack
  const openedNoteIds = new Set(paneStack.map(p => p.noteId));
  const uniqueRelatedNotes = deduplicatedNotes.filter(
    note => !openedNoteIds.has(note.id)
  );

  // Reset selection when related notes change
  useEffect(() => {
    setSelectedRelatedIndex(0);
  }, [relatedNotes]);

  // Keyboard navigation handler
  const handleKeyDown = useCallback((e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    const relatedCount = uniqueRelatedNotes.length;
    const focusedIdx = paneStack.findIndex(p => p.isFocused);

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedRelatedIndex(prev => Math.min(prev + 1, relatedCount - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedRelatedIndex(prev => Math.max(prev - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (uniqueRelatedNotes[selectedRelatedIndex]) {
          openRelatedNote(uniqueRelatedNotes[selectedRelatedIndex]);
        }
        break;
      case 'ArrowLeft':
        e.preventDefault();
        // Focus previous pane in stack
        if (focusedIdx > 0) {
          focusPane(focusedIdx - 1);
        }
        break;
      case 'ArrowRight':
        e.preventDefault();
        // Focus next pane in stack (if we've moved back)
        if (focusedIdx < paneStack.length - 1) {
          focusPane(focusedIdx + 1);
        }
        break;
      case 'Backspace':
        e.preventDefault();
        // Close current pane (if more than one)
        if (paneStack.length > 1) {
          closePane(focusedIdx);
        }
        break;
      case 'Escape':
        e.preventDefault();
        // Close entire panes view
        onClose();
        break;
      default:
        break;
    }
  }, [uniqueRelatedNotes, selectedRelatedIndex, paneStack, openRelatedNote, focusPane, closePane, onClose]);

  // Add keyboard event listener
  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Scroll selected card into view
  useEffect(() => {
    const selectedCard = document.querySelector('.related-note-card.selected');
    if (selectedCard) {
      selectedCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [selectedRelatedIndex]);

  // Get connection type icon
  const getConnectionIcon = (type) => {
    switch (type) {
      case 'sequential': return <ChevronRight size={12} />;
      case 'shared_tag': return <Tag size={12} />;
      case 'shared_entity': return <Link2 size={12} />;
      case 'via_relationship': return <Link2 size={12} />;
      case 'same_source': return <FileText size={12} />;
      default: return <Link2 size={12} />;
    }
  };

  // Fallback explanation generator for notes without explanation field
  const _getDefaultExplanation = (note) => {
    switch (note.connectionType) {
      case 'shared_tag':
        if (note.sharedTags?.length > 0) {
          const tag = note.sharedTags[0].replace(/^#/, '');
          return note.sharedTags.length > 1
            ? `Both tagged #${tag} (+${note.sharedTags.length - 1})`
            : `Both tagged #${tag}`;
        }
        return 'Shares tags';
      case 'shared_entity':
        return note.sharedEntity ? `Both discuss '${note.sharedEntity}'` : 'Shares entities';
      case 'via_relationship':
        return note.sourceEntity && note.targetEntity
          ? `'${note.sourceEntity}' → '${note.targetEntity}'`
          : 'Connected via concepts';
      case 'sequential':
        return 'Next in source';
      case 'same_source':
        return 'From the same source';
      default:
        return 'Related';
    }
  };

  if (paneStack.length === 0) {
    return null;
  }

  return (
    <div className="note-panes-container">
      {/* Back button */}
      <button className="note-panes-back" onClick={onClose}>
        <ArrowLeft size={18} />
        Back to Notes
      </button>

      {/* Panes */}
      <div className="note-panes-stack" ref={containerRef}>
        {paneStack.map((pane, index) => (
          <div
            key={`${pane.conversationId}:${pane.noteId}`}
            className={`note-pane ${pane.isFocused ? 'focused' : 'collapsed'}`}
            onClick={() => !pane.isFocused && focusPane(index)}
          >
            {/* Collapsed strip */}
            {!pane.isFocused && (
              <div className="note-pane-strip">
                <span className="strip-title">{pane.noteData.title}</span>
              </div>
            )}

            {/* Expanded content */}
            {pane.isFocused && (
              <div className="note-pane-content">
                <div className="note-pane-header">
                  <h3 className="note-pane-title">{pane.noteData.title}</h3>
                  <div className="note-pane-actions">
                    {paneStack.length > 1 && (
                      <button
                        className="note-pane-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          closePane(index);
                        }}
                        title="Close pane"
                      >
                        <X size={16} />
                      </button>
                    )}
                  </div>
                </div>

                {/* Source metadata bar */}
                <div className="note-pane-source-bar">
                  <div className="source-bar-left">
                    <span className="source-icon">
                      {getSourceIcon(pane.noteData.sourceType)}
                    </span>
                    <span className="source-label">
                      {getSourceLabel(pane.noteData.sourceType)}
                    </span>
                  </div>

                  <div className="source-bar-center">
                    {pane.noteData.sourceUrl && (
                      <a
                        href={pane.noteData.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="source-url"
                        title={pane.noteData.sourceUrl}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <ExternalLink size={12} />
                        {(() => {
                          try {
                            return new URL(pane.noteData.sourceUrl).hostname;
                          } catch {
                            return pane.noteData.sourceUrl.substring(0, 25);
                          }
                        })()}
                      </a>
                    )}
                    {pane.noteData.created_at && (
                      <span className="source-time">
                        <Clock size={12} />
                        {formatRelativeTime(pane.noteData.created_at)}
                      </span>
                    )}
                  </div>

                  {onViewConversation && (
                    <button
                      className="source-bar-cta"
                      onClick={(e) => {
                        e.stopPropagation();
                        onViewConversation(pane.conversationId);
                      }}
                    >
                      View in Conversation
                    </button>
                  )}
                </div>

                {/* Tags */}
                {pane.noteData.tags?.length > 0 && (
                  <div className="note-pane-tags">
                    {pane.noteData.tags.map((tag, i) => (
                      <span key={i} className="note-pane-tag">{tag}</span>
                    ))}
                  </div>
                )}

                {/* Body */}
                <div className="note-pane-body">
                  {formatNoteBody(pane.noteData.body)}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Keyboard hints */}
      <p className="panes-nav-hint">
        <kbd>↑</kbd>/<kbd>↓</kbd> select, <kbd>Enter</kbd> open, <kbd>←</kbd>/<kbd>→</kbd> history, <kbd>⌫</kbd> close pane, <kbd>Esc</kbd> exit
      </p>

      {/* Related Notes Sidebar */}
      <div className="related-notes-sidebar">
        {/* Related Notes Header */}
        <div className="related-notes-header">
          <h4>Related Notes</h4>
          {loadingRelated && <span className="loading-spinner" />}
        </div>

        {uniqueRelatedNotes.length === 0 && !loadingRelated ? (
          <div className="related-notes-empty">
            No related notes found
          </div>
        ) : (
          <div className="related-notes-list">
            {uniqueRelatedNotes.map((note, index) => (
              <div
                key={note.id}
                className={`related-note-card ${index === selectedRelatedIndex ? 'selected' : ''}`}
                onClick={() => openRelatedNote(note)}
              >
                <div className="related-note-card-header">
                  <span className="related-note-icon">
                    {getConnectionIcon(note.connectionType)}
                  </span>
                  <span className="related-note-title">{note.title}</span>
                </div>
                {note.body && (
                  <p className="related-note-preview">
                    {note.body.length > 120 ? `${note.body.substring(0, 120)}...` : note.body}
                  </p>
                )}

                {/* Connection explanation */}
                <div className="related-note-why">
                  <span className="why-explanation">
                    {note.explanation || _getDefaultExplanation(note)}
                  </span>
                  <ChevronRight size={14} className="related-note-arrow" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Entities Section */}
        <div className="entities-section">
          <div className="entities-header">
            <h4>Entities ({noteEntities?.entities?.length || 0})</h4>
            {loadingEntities && <span className="loading-spinner" />}
          </div>

          {!loadingEntities && (!noteEntities?.entities?.length) ? (
            <div className="entities-empty">
              {noteEntities?.isProcessed === false ? (
                <>
                  <p>Entities not extracted yet</p>
                  <button
                    className="reextract-btn"
                    onClick={handleReextractEntities}
                    disabled={extractingEntities}
                  >
                    {extractingEntities ? (
                      <>
                        <RefreshCw size={14} className="spinning" />
                        Extracting...
                      </>
                    ) : (
                      <>
                        <RefreshCw size={14} />
                        Extract Entities
                      </>
                    )}
                  </button>
                </>
              ) : (
                <p>No entities found</p>
              )}
            </div>
          ) : (
            <div className="entities-list">
              {noteEntities?.entities?.map((entity) => (
                <div
                  key={entity.id}
                  className="entity-card"
                  onClick={() => onNavigateToGraph?.(entity.id)}
                  title={entity.context || `View ${entity.name} in Knowledge Graph`}
                >
                  <span
                    className="entity-type-badge"
                    style={{ backgroundColor: ENTITY_TYPE_COLORS[entity.type] || ENTITY_TYPE_COLORS.concept }}
                  >
                    {entity.type?.toUpperCase() || 'CONCEPT'}
                  </span>
                  <span className="entity-name">{entity.name}</span>
                  {entity.mentionCount > 1 && (
                    <span className="entity-mentions">{entity.mentionCount} mentions</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
