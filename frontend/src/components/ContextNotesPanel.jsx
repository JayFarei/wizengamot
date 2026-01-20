import React, { useState } from 'react';
import './ContextNotesPanel.css';

/**
 * ContextNotesPanel displays related notes from the knowledge graph
 * that were used as context during Knowledge Graph mode generation.
 * Reuses card and tag design patterns from NoteViewer.
 */
export default function ContextNotesPanel({ notes = [], onTagClick }) {
  const [expandedNotes, setExpandedNotes] = useState(new Set());

  const toggleNote = (noteId) => {
    setExpandedNotes((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(noteId)) {
        newSet.delete(noteId);
      } else {
        newSet.add(noteId);
      }
      return newSet;
    });
  };

  const handleTagClick = (e, tag) => {
    e.stopPropagation();
    if (onTagClick) {
      onTagClick(`@tag:${tag}`);
    }
  };

  if (notes.length === 0) {
    return (
      <div className="context-notes-panel">
        <div className="context-notes-empty">
          <p>No related notes found in your knowledge graph.</p>
          <p className="hint">
            As you add more notes to your knowledge base, the Knowledge Graph mode
            will find relevant existing notes to provide as context.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="context-notes-panel">
      <p className="panel-description">
        These notes from your knowledge graph were provided as context during generation.
      </p>

      <div className="context-notes-list">
        {notes.map((note, index) => {
          const isExpanded = expandedNotes.has(note.id || index);

          return (
            <div key={note.id || index} className="context-note-card">
              <div
                className="note-header"
                onClick={() => toggleNote(note.id || index)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && toggleNote(note.id || index)}
              >
                <span className="note-rank">{index + 1}</span>
                <div className="note-info">
                  <span className="note-title">{note.title || 'Untitled Note'}</span>
                  {(note.tags || []).length > 0 && (
                    <div className="note-tags">
                      {note.tags.map((tag, tagIndex) => (
                        <button
                          key={tagIndex}
                          className="note-tag"
                          onClick={(e) => handleTagClick(e, tag)}
                          title={`Search knowledge graph for "${tag}"`}
                        >
                          {tag}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {note.relevance_score !== undefined && (
                  <span className="relevance-score">
                    {(note.relevance_score * 100).toFixed(0)}%
                  </span>
                )}
                <svg
                  className={`expand-icon ${isExpanded ? 'expanded' : ''}`}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
              </div>

              {isExpanded && (
                <div className="note-body-expanded">
                  <div className="note-content">
                    {note.body || 'No content available'}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
