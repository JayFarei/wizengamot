import React, { useState, useEffect, useCallback } from 'react';
import { X, Sparkles, Check, XCircle, Edit3, ChevronDown, ChevronUp, ExternalLink, FileText, Clock, Loader, Maximize2, Minimize2, Trash2, Rows } from 'lucide-react';
import { api } from '../api';
import ReactMarkdown from 'react-markdown';
import ImmersiveReviewMode from './ImmersiveReviewMode';

/**
 * KnowledgeGraphReview - Panel for reviewing and managing discovered insights
 * Extracted from KnowledgeGraphDiscover to separate generation from review
 */
export default function KnowledgeGraphReview({
  onClose,
  onSelectConversation,
  onRefreshGraph,
}) {
  const [discoveries, setDiscoveries] = useState([]);
  const [stats, setStats] = useState(null);
  const [filter, setFilter] = useState('pending');
  const [selectedDiscovery, setSelectedDiscovery] = useState(null);
  const [editMode, setEditMode] = useState(false);
  const [editedTitle, setEditedTitle] = useState('');
  const [editedBody, setEditedBody] = useState('');
  const [editedTags, setEditedTags] = useState('');
  const [expandedDiscoveries, setExpandedDiscoveries] = useState(new Set());
  const [sourceNotesData, setSourceNotesData] = useState({});
  const [loadingNotes, setLoadingNotes] = useState(new Set());
  const [expandedNotes, setExpandedNotes] = useState(new Set());
  const [fullScreen, setFullScreen] = useState(false);
  const [immersiveMode, setImmersiveMode] = useState(false);
  const [immersiveIndex, setImmersiveIndex] = useState(0);
  const [error, setError] = useState(null);

  // Load discoveries on mount
  useEffect(() => {
    loadDiscoveries();
    loadStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadDiscoveries = useCallback(async () => {
    try {
      const result = await api.listDiscoveries({ status: filter === 'all' ? null : filter });
      setDiscoveries(result.discoveries || []);
    } catch (err) {
      console.error('Failed to load discoveries:', err);
    }
  }, [filter]);

  const loadStats = useCallback(async () => {
    try {
      const result = await api.getDiscoveryStats();
      setStats(result);
    } catch (err) {
      console.error('Failed to load stats:', err);
    }
  }, []);

  // Reload when filter changes
  useEffect(() => {
    loadDiscoveries();
  }, [filter, loadDiscoveries]);

  // Fetch note data for a discovery
  const fetchNoteData = useCallback(async (noteId) => {
    if (sourceNotesData[noteId] || loadingNotes.has(noteId)) return;

    setLoadingNotes(prev => new Set(prev).add(noteId));

    try {
      // noteId format: "note:conversationId:noteId"
      const parts = noteId.split(':');
      if (parts.length >= 3) {
        const conversationId = parts[1];
        const conv = await api.getConversation(conversationId);

        if (conv) {
          // Find the note in the conversation
          for (const msg of conv.messages || []) {
            if (msg.role === 'assistant' && msg.notes) {
              const note = msg.notes.find(n => n.id === parts[2]);
              if (note) {
                setSourceNotesData(prev => ({
                  ...prev,
                  [noteId]: {
                    ...note,
                    sourceTitle: conv.title,
                    conversationId,
                  }
                }));
                break;
              }
            }
          }
        }
      }
    } catch (err) {
      console.error('Failed to fetch note:', noteId, err);
    } finally {
      setLoadingNotes(prev => {
        const next = new Set(prev);
        next.delete(noteId);
        return next;
      });
    }
  }, [sourceNotesData, loadingNotes]);

  // Toggle note expansion and fetch data if needed
  const toggleNoteExpanded = (noteId) => {
    if (!expandedNotes.has(noteId)) {
      fetchNoteData(noteId);
    }
    setExpandedNotes(prev => {
      const next = new Set(prev);
      if (next.has(noteId)) {
        next.delete(noteId);
      } else {
        next.add(noteId);
      }
      return next;
    });
  };

  // Approve discovery
  const handleApprove = async (discovery) => {
    try {
      const edits = editMode ? {
        title: editedTitle || discovery.suggested_title,
        body: editedBody || discovery.suggested_body,
        tags: editedTags ? editedTags.split(',').map(t => t.trim()).filter(Boolean) : discovery.suggested_tags,
      } : null;

      const result = await api.approveDiscovery(discovery.id, edits);

      if (result.error) {
        setError(result.error);
      } else {
        setDiscoveries(prev => prev.filter(d => d.id !== discovery.id));
        setSelectedDiscovery(null);
        setEditMode(false);
        loadStats();
        if (onRefreshGraph) onRefreshGraph();
      }
    } catch (err) {
      setError(err.message);
    }
  };

  // Dismiss discovery
  const handleDismiss = async (discovery) => {
    try {
      await api.dismissDiscovery(discovery.id);
      setDiscoveries(prev => prev.filter(d => d.id !== discovery.id));
      setSelectedDiscovery(null);
      loadStats();
    } catch (err) {
      setError(err.message);
    }
  };

  // Delete discovery permanently
  const handleDelete = async (discovery) => {
    if (!window.confirm('Permanently delete this discovery? This cannot be undone.')) return;
    try {
      await api.deleteDiscovery(discovery.id);
      setDiscoveries(prev => prev.filter(d => d.id !== discovery.id));
      setSelectedDiscovery(null);
      loadStats();
      if (onRefreshGraph) onRefreshGraph();
    } catch (err) {
      setError(err.message);
    }
  };

  // Toggle expanded state for a discovery
  const toggleExpanded = (discoveryId) => {
    setExpandedDiscoveries(prev => {
      const next = new Set(prev);
      if (next.has(discoveryId)) {
        next.delete(discoveryId);
      } else {
        next.add(discoveryId);
      }
      return next;
    });
  };

  // Open detail/edit modal
  const openDetail = (discovery) => {
    setSelectedDiscovery(discovery);
    setEditedTitle(discovery.suggested_title);
    setEditedBody(discovery.suggested_body);
    setEditedTags(discovery.suggested_tags?.join(', ') || '');
    setEditMode(false);
    // Pre-fetch all source notes
    discovery.source_notes?.forEach(noteId => fetchNoteData(noteId));
  };

  // Open immersive review mode
  const openImmersiveMode = (index = 0) => {
    setImmersiveIndex(index);
    setImmersiveMode(true);
    setSelectedDiscovery(null); // Close modal if open
    // Pre-fetch all source notes for all discoveries
    discoveries.forEach(d => {
      d.source_notes?.forEach(noteId => fetchNoteData(noteId));
    });
  };

  // Handle approve from immersive mode (with optional edits)
  // OPTIMISTIC: Update state immediately, run API in background
  const handleImmersiveApprove = (discovery, edits = null) => {
    // 1. OPTIMISTIC: Remove from local state immediately
    setDiscoveries(prev => prev.filter(d => d.id !== discovery.id));

    // 2. Fire API in background (don't await)
    api.approveDiscovery(discovery.id, edits)
      .then(result => {
        if (result.error) {
          console.error('Approval failed:', result.error);
          // Could restore item on error, but for now just log
        } else {
          loadStats();
          if (onRefreshGraph) onRefreshGraph();
        }
      })
      .catch(err => {
        console.error('Approval failed:', err.message);
      });
  };

  // Handle dismiss from immersive mode
  const handleImmersiveDismiss = async (discovery) => {
    try {
      await api.dismissDiscovery(discovery.id);
      setDiscoveries(prev => prev.filter(d => d.id !== discovery.id));
      loadStats();
    } catch (err) {
      setError(err.message);
    }
  };

  // Handle delete from immersive mode
  const handleImmersiveDelete = async (discovery) => {
    try {
      await api.deleteDiscovery(discovery.id);
      setDiscoveries(prev => prev.filter(d => d.id !== discovery.id));
      loadStats();
      if (onRefreshGraph) onRefreshGraph();
    } catch (err) {
      setError(err.message);
    }
  };

  // Format relative time
  const formatTime = (isoString) => {
    if (!isoString) return '';
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
  };

  // Render a source note card
  const renderSourceNote = (noteId, compact = false) => {
    const noteData = sourceNotesData[noteId];
    const isExpanded = expandedNotes.has(noteId);
    const isLoading = loadingNotes.has(noteId);

    // Extract just the note ID for display
    const shortId = noteId.split(':').pop();

    if (compact) {
      return (
        <div key={noteId} className="kg-discover-source-note-compact">
          <button
            className="kg-discover-source-note-btn"
            onClick={() => toggleNoteExpanded(noteId)}
          >
            <FileText size={14} />
            <span className="kg-discover-source-note-title">
              {noteData?.title || `Note ${shortId}`}
            </span>
            {isLoading && <Loader size={12} className="kg-spinner" />}
            {!isLoading && (isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}
          </button>

          {isExpanded && noteData && (
            <div className="kg-discover-source-note-content">
              {noteData.sourceTitle && (
                <div className="kg-discover-source-note-source">
                  From: {noteData.sourceTitle}
                </div>
              )}
              <div className="kg-discover-source-note-body markdown-content">
                <ReactMarkdown>{noteData.body}</ReactMarkdown>
              </div>
              {noteData.tags?.length > 0 && (
                <div className="kg-discover-source-note-tags">
                  {noteData.tags.map((tag, idx) => (
                    <span key={idx} className="kg-discover-tag">{tag}</span>
                  ))}
                </div>
              )}
              {noteData.conversationId && (
                <button
                  className="kg-discover-view-conv-btn"
                  onClick={() => onSelectConversation && onSelectConversation(noteData.conversationId)}
                >
                  <ExternalLink size={12} /> View in Conversation
                </button>
              )}
            </div>
          )}
        </div>
      );
    }

    // Full card view for modal
    return (
      <div key={noteId} className="kg-discover-source-note-full">
        <div className="kg-discover-source-note-header">
          <FileText size={16} />
          <span className="kg-discover-source-note-title">
            {noteData?.title || `Note ${shortId}`}
          </span>
          {isLoading && <Loader size={14} className="kg-spinner" />}
        </div>
        {noteData ? (
          <>
            {noteData.sourceTitle && (
              <div className="kg-discover-source-note-source">
                From: {noteData.sourceTitle}
              </div>
            )}
            <div className="kg-discover-source-note-body markdown-content">
              <ReactMarkdown>{noteData.body}</ReactMarkdown>
            </div>
            {noteData.tags?.length > 0 && (
              <div className="kg-discover-source-note-tags">
                {noteData.tags.map((tag, idx) => (
                  <span key={idx} className="kg-discover-tag">{tag}</span>
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="kg-discover-source-note-loading">
            {isLoading ? 'Loading note...' : 'Note not found'}
          </div>
        )}
      </div>
    );
  };

  // Render discovery card
  const renderDiscoveryCard = (discovery) => {
    const isExpanded = expandedDiscoveries.has(discovery.id);

    return (
      <div key={discovery.id} className="kg-discover-card">
        <div className="kg-discover-card-header" onClick={() => toggleExpanded(discovery.id)}>
          <div className="kg-discover-card-icon">
            <Sparkles size={16} />
          </div>
          <div className="kg-discover-card-title">
            {discovery.suggested_title || 'Untitled Bridge Note'}
          </div>
          <button className="kg-discover-expand-btn">
            {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
        </div>

        {isExpanded && (
          <div className="kg-discover-card-body">
            {/* Show the prompt that generated this discovery */}
            {discovery.user_prompt && (
              <div className="kg-discover-prompt-info">
                <Clock size={12} />
                <span>Prompt: "{discovery.user_prompt}"</span>
                <span className="kg-discover-time">{formatTime(discovery.created_at)}</span>
              </div>
            )}

            <div className="kg-discover-card-meta">
              <span className="kg-discover-strength" data-strength={discovery.connection_strength}>
                {discovery.connection_strength}
              </span>
              <span className="kg-discover-type">
                {discovery.connection_type}
              </span>
            </div>

            <div className="kg-discover-reasoning">
              {discovery.reasoning}
            </div>

            <div className="kg-discover-sources">
              <strong>Connects {discovery.source_notes?.length || 0} Notes:</strong>
              <div className="kg-discover-sources-list">
                {discovery.source_notes?.map((noteId) => renderSourceNote(noteId, true))}
              </div>
            </div>

            <div className="kg-discover-preview">
              <div className="kg-discover-preview-label">Suggested Bridge Note:</div>
              <div className="kg-discover-preview-body markdown-content">
                <ReactMarkdown>{discovery.suggested_body}</ReactMarkdown>
              </div>
              <div className="kg-discover-preview-tags">
                {discovery.suggested_tags?.map((tag, idx) => (
                  <span key={idx} className="kg-discover-tag">{tag}</span>
                ))}
              </div>
            </div>

            <div className="kg-discover-card-actions">
              <button
                className="kg-btn kg-btn-small kg-btn-primary"
                onClick={(e) => { e.stopPropagation(); openDetail(discovery); }}
              >
                <Edit3 size={14} /> Preview & Edit
              </button>
              <button
                className="kg-btn kg-btn-small kg-btn-success"
                onClick={(e) => { e.stopPropagation(); handleApprove(discovery); }}
              >
                <Check size={14} /> Approve
              </button>
              <button
                className="kg-btn kg-btn-small kg-btn-danger"
                onClick={(e) => { e.stopPropagation(); handleDismiss(discovery); }}
              >
                <XCircle size={14} /> Dismiss
              </button>
              <button
                className="kg-btn kg-btn-small kg-btn-ghost"
                onClick={(e) => { e.stopPropagation(); handleDelete(discovery); }}
                title="Permanently delete"
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className={`kg-review-panel ${fullScreen ? 'kg-review-fullscreen' : ''}`}>
      <div className="kg-review-header">
        <div className="kg-review-title">
          <Check size={18} />
          <span>Review Insights</span>
        </div>
        <div className="kg-review-header-actions">
          {discoveries.length > 0 && (
            <button
              className="kg-icon-btn"
              onClick={() => openImmersiveMode(0)}
              title="Immersive Review Mode"
            >
              <Rows size={18} />
            </button>
          )}
          <button
            className="kg-icon-btn"
            onClick={() => setFullScreen(!fullScreen)}
            title={fullScreen ? 'Exit Full Screen' : 'Full Screen'}
          >
            {fullScreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
          </button>
          <button className="kg-icon-btn" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Scrollable body wrapper */}
      <div className="kg-review-body">
        {/* Error */}
        {error && (
          <div className="kg-discover-error">
            {error}
          </div>
        )}

        {/* Filter Tabs */}
        <div className="kg-review-tabs">
          <button
            className={`kg-review-tab ${filter === 'pending' ? 'active' : ''}`}
            onClick={() => setFilter('pending')}
          >
            Pending {stats?.pending > 0 && `(${stats.pending})`}
          </button>
          <button
            className={`kg-review-tab ${filter === 'approved' ? 'active' : ''}`}
            onClick={() => setFilter('approved')}
          >
            Approved {stats?.approved > 0 && `(${stats.approved})`}
          </button>
          <button
            className={`kg-review-tab ${filter === 'dismissed' ? 'active' : ''}`}
            onClick={() => setFilter('dismissed')}
          >
            Dismissed {stats?.dismissed > 0 && `(${stats.dismissed})`}
          </button>
        </div>

        {/* Discoveries list */}
        <div className="kg-discover-list">
          {discoveries.length === 0 ? (
            <div className="kg-discover-empty">
              <Sparkles size={32} strokeWidth={1} />
              <p>No discoveries yet</p>
              <p className="kg-discover-empty-hint">
                Use the Generate panel to discover new connections in your knowledge graph
              </p>
            </div>
          ) : (
            discoveries.map(renderDiscoveryCard)
          )}
        </div>
      </div>

      {/* Detail/Edit Modal */}
      {selectedDiscovery && (
        <div className="kg-discover-modal-overlay" onClick={() => setSelectedDiscovery(null)}>
          <div className="kg-discover-modal kg-discover-modal-large" onClick={(e) => e.stopPropagation()}>
            <div className="kg-discover-modal-header">
              <h3>Bridge Note Preview</h3>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  className="kg-icon-btn"
                  onClick={() => {
                    const idx = discoveries.findIndex(d => d.id === selectedDiscovery.id);
                    openImmersiveMode(idx >= 0 ? idx : 0);
                  }}
                  title="Open in Immersive Mode"
                >
                  <Rows size={18} />
                </button>
                <button className="kg-icon-btn" onClick={() => setSelectedDiscovery(null)}>
                  <X size={18} />
                </button>
              </div>
            </div>

            <div className="kg-discover-modal-body">
              <div className="kg-discover-modal-columns">
                {/* Left column: Source notes */}
                <div className="kg-discover-modal-col">
                  <h4>Source Notes ({selectedDiscovery.source_notes?.length || 0})</h4>
                  <div className="kg-discover-source-notes-list">
                    {selectedDiscovery.source_notes?.map((noteId) => renderSourceNote(noteId, false))}
                  </div>
                </div>

                {/* Right column: Bridge note */}
                <div className="kg-discover-modal-col">
                  <h4>Bridge Note</h4>

                  {/* Title */}
                  <div className="kg-discover-field">
                    <label>Title</label>
                    {editMode ? (
                      <input
                        type="text"
                        value={editedTitle}
                        onChange={(e) => setEditedTitle(e.target.value)}
                        className="kg-discover-edit-input"
                      />
                    ) : (
                      <div className="kg-discover-field-value">{selectedDiscovery.suggested_title}</div>
                    )}
                  </div>

                  {/* Body */}
                  <div className="kg-discover-field">
                    <label>Content</label>
                    {editMode ? (
                      <textarea
                        value={editedBody}
                        onChange={(e) => setEditedBody(e.target.value)}
                        className="kg-discover-edit-textarea"
                        rows={8}
                      />
                    ) : (
                      <div className="kg-discover-field-value markdown-content">
                        <ReactMarkdown>{selectedDiscovery.suggested_body}</ReactMarkdown>
                      </div>
                    )}
                  </div>

                  {/* Tags */}
                  <div className="kg-discover-field">
                    <label>Tags</label>
                    {editMode ? (
                      <input
                        type="text"
                        value={editedTags}
                        onChange={(e) => setEditedTags(e.target.value)}
                        className="kg-discover-edit-input"
                        placeholder="tag1, tag2, tag3"
                      />
                    ) : (
                      <div className="kg-discover-field-tags">
                        {selectedDiscovery.suggested_tags?.map((tag, idx) => (
                          <span key={idx} className="kg-discover-tag">{tag}</span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Reasoning */}
                  <div className="kg-discover-field">
                    <label>Why Connected</label>
                    <div className="kg-discover-field-value kg-discover-reasoning-detail">
                      {selectedDiscovery.reasoning}
                    </div>
                  </div>

                  {/* Original prompt */}
                  {selectedDiscovery.user_prompt && (
                    <div className="kg-discover-field">
                      <label>Discovery Prompt</label>
                      <div className="kg-discover-field-value kg-discover-prompt-detail">
                        "{selectedDiscovery.user_prompt}"
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="kg-discover-modal-actions">
              <button
                className="kg-btn kg-btn-secondary"
                onClick={() => setEditMode(!editMode)}
              >
                <Edit3 size={14} />
                {editMode ? 'Cancel Edit' : 'Edit Before Save'}
              </button>
              <button
                className="kg-btn kg-btn-danger"
                onClick={() => handleDismiss(selectedDiscovery)}
              >
                <XCircle size={14} /> Dismiss
              </button>
              <button
                className="kg-btn kg-btn-ghost"
                onClick={() => handleDelete(selectedDiscovery)}
                title="Permanently delete"
              >
                <Trash2 size={14} /> Delete
              </button>
              <button
                className="kg-btn kg-btn-success"
                onClick={() => handleApprove(selectedDiscovery)}
              >
                <Check size={14} /> {editMode ? 'Save & Approve' : 'Approve'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Immersive Review Mode */}
      {immersiveMode && (
        <ImmersiveReviewMode
          discoveries={discoveries}
          initialIndex={immersiveIndex}
          sourceNotesData={sourceNotesData}
          loadingNotes={loadingNotes}
          fetchNoteData={fetchNoteData}
          onApprove={handleImmersiveApprove}
          onDismiss={handleImmersiveDismiss}
          onDelete={handleImmersiveDelete}
          onClose={() => setImmersiveMode(false)}
        />
      )}
    </div>
  );
}
