
# Text Highlighting & Comment System - Replication Guide

A complete, portable documentation for implementing a text highlighting, commenting, and context-stacking system that allows users to annotate content and use those annotations as context for follow-up conversations.

---

## Feature Overview

**What it does:**
1. Users can highlight text in any content area
2. Add comments to highlighted text
3. Highlights persist and show on hover/click
4. Build a "context stack" of annotations
5. Submit the stack as context for a follow-up conversation (e.g., feedback to developers)

**Use case for your new app:** Users annotate content during review, build up a stack of highlighted feedback points, then submit all annotations along with overall feedback.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         FRONTEND                                     │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────────────┐    ┌───────────────────┐                      │
│  │ SelectionHandler │    │ ResponseWithComments │                   │
│  │   (utility)      │───▶│   (wrapper component) │                  │
│  └──────────────────┘    └───────────────────┘                      │
│           │                        │                                 │
│           ▼                        ▼                                 │
│  ┌──────────────────┐    ┌───────────────────┐                      │
│  │  CommentModal    │    │  FloatingComment   │                     │
│  │ (create comment) │    │  (hover popup)     │                     │
│  └──────────────────┘    └───────────────────┘                      │
│           │                                                          │
│           ▼                                                          │
│  ┌──────────────────────────────────────────┐                       │
│  │           CommitSidebar                   │                      │
│  │  (context stack + submit follow-up)       │                      │
│  └──────────────────────────────────────────┘                       │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼ REST API
┌─────────────────────────────────────────────────────────────────────┐
│                         BACKEND                                      │
├─────────────────────────────────────────────────────────────────────┤
│  POST   /api/comments          → Create comment                      │
│  GET    /api/comments          → List comments                       │
│  PUT    /api/comments/{id}     → Update comment                      │
│  DELETE /api/comments/{id}     → Delete comment                      │
│  POST   /api/threads           → Create follow-up with context       │
│  POST   /api/threads/{id}/message → Continue thread                  │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         STORAGE                                      │
│  JSON file or database with comments[], threads[]                    │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Data Structures

### Comment Object

```typescript
interface Comment {
  id: string;                    // UUID
  selection: string;             // The highlighted text
  content: string;               // User's comment/annotation
  source_content?: string;       // Full text of the parent container (for context)
  created_at: string;            // ISO timestamp
  updated_at?: string;           // ISO timestamp (if edited)

  // Source identification (adapt to your domain)
  source_type: string;           // e.g., "review", "feedback"
  section_id?: string;           // Which section was highlighted
  section_title?: string;        // Human-readable section name
}
```

### Context Segment (for pinning entire sections)

```typescript
interface ContextSegment {
  id: string;                    // UUID
  content: string;               // Full section content
  label?: string;                // e.g., "Feature Description"
  source_type: string;
  section_id?: string;
  section_title?: string;
}
```

### Thread (follow-up conversation)

```typescript
interface Thread {
  id: string;
  context: {
    comment_ids: string[];
    context_segments: ContextSegment[];
  };
  messages: ThreadMessage[];
  created_at: string;
}

interface ThreadMessage {
  role: "user" | "assistant";
  content: string;
  created_at: string;
}
```

---

## Frontend Components

### 1. SelectionHandler.js (Core Utility)

Framework-agnostic utility for text selection, highlighting, and popup positioning.

```javascript
// SelectionHandler.js

/**
 * Captures current text selection with metadata
 * @returns {Object|null} Selection object or null if invalid
 */
export function getSelection() {
  const selection = window.getSelection();

  if (!selection || selection.isCollapsed || !selection.toString().trim()) {
    return null;
  }

  const range = selection.getRangeAt(0);
  const rect = range.getBoundingClientRect();

  // Find the container with data attributes
  let container = range.commonAncestorContainer;
  if (container.nodeType === Node.TEXT_NODE) {
    container = container.parentElement;
  }

  // Traverse up to find annotatable container
  const annotatableContainer = container.closest('[data-annotatable]');
  if (!annotatableContainer) {
    return null;
  }

  return {
    text: selection.toString().trim(),
    range: range.cloneRange(),
    rect: {
      top: rect.top,
      left: rect.left,
      width: rect.width,
      height: rect.height,
      bottom: rect.bottom,
      right: rect.right
    },
    // Extract metadata from data attributes
    sectionId: annotatableContainer.dataset.sectionId,
    sectionTitle: annotatableContainer.dataset.sectionTitle,
    sourceContent: annotatableContainer.textContent
  };
}

/**
 * Creates persistent highlight in DOM
 * @param {HTMLElement} container - Parent container
 * @param {string} selectedText - Text to highlight
 * @param {string} commentId - Unique ID for the comment
 * @returns {HTMLElement[]} Array of created mark elements
 */
export function createHighlight(container, selectedText, commentId) {
  const textNodes = getTextNodes(container);
  const marks = [];

  // Handle multiline by splitting on newlines
  const textParts = selectedText.split('\n').filter(p => p.trim());

  for (const part of textParts) {
    const mark = createSingleHighlight(container, part.trim(), commentId, textNodes);
    if (mark) marks.push(mark);
  }

  return marks;
}

function createSingleHighlight(container, text, commentId, textNodes) {
  for (const node of textNodes) {
    const index = node.textContent.indexOf(text);
    if (index === -1) continue;

    try {
      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + text.length);

      const mark = document.createElement('mark');
      mark.className = 'text-highlight';
      mark.dataset.commentId = commentId;
      range.surroundContents(mark);

      return mark;
    } catch (e) {
      console.warn('Could not create highlight:', e);
      continue;
    }
  }
  return null;
}

/**
 * Removes highlight from DOM
 * @param {string} commentId - ID of comment to remove
 */
export function removeHighlight(commentId) {
  const marks = document.querySelectorAll(`mark[data-comment-id="${commentId}"]`);
  marks.forEach(mark => {
    const parent = mark.parentNode;
    while (mark.firstChild) {
      parent.insertBefore(mark.firstChild, mark);
    }
    parent.removeChild(mark);
    parent.normalize(); // Merge adjacent text nodes
  });
}

/**
 * Get all text nodes in element
 */
function getTextNodes(element) {
  const nodes = [];
  const walker = document.createTreeWalker(
    element,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: (node) =>
        node.textContent.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
    }
  );

  let node;
  while (node = walker.nextNode()) {
    nodes.push(node);
  }
  return nodes;
}

/**
 * Calculate popup position (avoids viewport edges)
 * @param {DOMRect} rect - Bounding rect of highlight
 * @param {number} popupWidth - Width of popup
 * @param {number} popupHeight - Height of popup
 * @returns {Object} Position {top, left}
 */
export function calculatePopupPosition(rect, popupWidth = 300, popupHeight = 200) {
  const MARGIN = 10;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  let top = rect.bottom + MARGIN;
  let left = rect.left;

  // Adjust horizontal if off-screen
  if (left + popupWidth > viewportWidth - MARGIN) {
    left = viewportWidth - popupWidth - MARGIN;
  }
  if (left < MARGIN) {
    left = MARGIN;
  }

  // Adjust vertical if off-screen
  if (top + popupHeight > viewportHeight - MARGIN) {
    top = rect.top - popupHeight - MARGIN;
  }
  if (top < MARGIN) {
    top = MARGIN;
  }

  return { top, left };
}
```

### 2. ResponseWithComments.jsx (React Wrapper)

Wraps content and manages highlights + hover behavior.

```jsx
// ResponseWithComments.jsx
import React, { useRef, useEffect, useState, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import * as SelectionHandler from '../utils/SelectionHandler';
import FloatingComment from './FloatingComment';

export default function ResponseWithComments({
  content,              // Markdown/text content to render
  comments,             // Array of Comment objects
  sectionId,            // Unique section identifier
  sectionTitle,         // Human-readable title
  onDeleteComment,      // (commentId) => void
  onEditComment,        // (commentId, newContent) => void
}) {
  const containerRef = useRef(null);
  const [hoveredComment, setHoveredComment] = useState(null);
  const [pinnedComment, setPinnedComment] = useState(null);
  const [popupPosition, setPopupPosition] = useState(null);
  const hoverTimeoutRef = useRef(null);

  // Apply highlights when comments change
  useEffect(() => {
    if (!containerRef.current) return;

    // Clear existing highlights
    const existingMarks = containerRef.current.querySelectorAll('mark.text-highlight');
    existingMarks.forEach(mark => SelectionHandler.removeHighlight(mark.dataset.commentId));

    // Apply highlights for each comment
    const timeoutId = setTimeout(() => {
      comments.forEach(comment => {
        const marks = SelectionHandler.createHighlight(
          containerRef.current,
          comment.selection,
          comment.id
        );

        // Add event listeners to each mark
        marks.forEach(mark => {
          mark.addEventListener('mouseenter', () => handleHighlightHover(comment, mark));
          mark.addEventListener('mouseleave', handleHighlightLeave);
          mark.addEventListener('click', (e) => handleHighlightClick(e, comment, mark));
        });
      });
    }, 100); // Small delay for DOM readiness

    return () => clearTimeout(timeoutId);
  }, [comments]);

  const handleHighlightHover = useCallback((comment, mark) => {
    if (pinnedComment) return; // Don't change if pinned

    clearTimeout(hoverTimeoutRef.current);
    const rect = mark.getBoundingClientRect();
    setPopupPosition(SelectionHandler.calculatePopupPosition(rect));
    setHoveredComment(comment);
  }, [pinnedComment]);

  const handleHighlightLeave = useCallback(() => {
    if (pinnedComment) return;

    hoverTimeoutRef.current = setTimeout(() => {
      setHoveredComment(null);
      setPopupPosition(null);
    }, 200);
  }, [pinnedComment]);

  const handleHighlightClick = useCallback((e, comment, mark) => {
    e.stopPropagation();

    // Toggle pin
    if (pinnedComment?.id === comment.id) {
      setPinnedComment(null);
      mark.classList.remove('active');
    } else {
      // Unpin previous
      document.querySelectorAll('mark.text-highlight.active')
        .forEach(m => m.classList.remove('active'));

      setPinnedComment(comment);
      mark.classList.add('active');

      const rect = mark.getBoundingClientRect();
      setPopupPosition(SelectionHandler.calculatePopupPosition(rect));
    }
  }, [pinnedComment]);

  // Click outside to unpin
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (pinnedComment && !e.target.closest('.floating-comment') &&
          !e.target.closest('.text-highlight')) {
        setPinnedComment(null);
        document.querySelectorAll('mark.text-highlight.active')
          .forEach(m => m.classList.remove('active'));
      }
    };

    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [pinnedComment]);

  const activeComment = pinnedComment || hoveredComment;

  return (
    <div className="response-with-comments">
      <div
        ref={containerRef}
        data-annotatable="true"
        data-section-id={sectionId}
        data-section-title={sectionTitle}
        className="annotatable-content"
      >
        <ReactMarkdown>{content}</ReactMarkdown>
      </div>

      {activeComment && popupPosition && (
        <FloatingComment
          comment={activeComment}
          position={popupPosition}
          isPinned={pinnedComment?.id === activeComment.id}
          onDelete={() => onDeleteComment(activeComment.id)}
          onEdit={(newContent) => onEditComment(activeComment.id, newContent)}
          onUnpin={() => setPinnedComment(null)}
        />
      )}
    </div>
  );
}
```

### 3. FloatingComment.jsx (Hover Popup)

```jsx
// FloatingComment.jsx
import React, { useState } from 'react';
import './FloatingComment.css';

export default function FloatingComment({
  comment,
  position,
  isPinned,
  onDelete,
  onEdit,
  onUnpin,
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(comment.content);

  const handleSave = () => {
    if (editContent.trim() && editContent !== comment.content) {
      onEdit(editContent.trim());
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      handleSave();
    } else if (e.key === 'Escape') {
      setEditContent(comment.content);
      setIsEditing(false);
    }
  };

  // Clamp position to viewport
  const adjustedPosition = {
    top: Math.max(10, position.top),
    left: Math.max(10, Math.min(position.left, window.innerWidth - 320))
  };

  return (
    <div
      className={`floating-comment ${isPinned ? 'pinned' : ''}`}
      style={{
        position: 'fixed',
        top: adjustedPosition.top,
        left: adjustedPosition.left,
        zIndex: 1000
      }}
    >
      <div className="floating-comment-header">
        <span className="comment-badge">Comment</span>
        {isPinned && (
          <button className="unpin-btn" onClick={onUnpin} title="Unpin">
            &times;
          </button>
        )}
      </div>

      <div className="floating-comment-selection">
        "{comment.selection.length > 100
          ? comment.selection.slice(0, 100) + '...'
          : comment.selection}"
      </div>

      {isEditing ? (
        <div className="floating-comment-edit">
          <textarea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            onKeyDown={handleKeyDown}
            autoFocus
            rows={3}
          />
          <div className="edit-actions">
            <button onClick={handleSave}>Save</button>
            <button onClick={() => {
              setEditContent(comment.content);
              setIsEditing(false);
            }}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="floating-comment-content">
          {comment.content}
        </div>
      )}

      <div className="floating-comment-actions">
        <button onClick={() => setIsEditing(true)}>Edit</button>
        <button onClick={onDelete} className="delete-btn">Delete</button>
      </div>
    </div>
  );
}
```

### 4. CommentModal.jsx (Create Comment)

```jsx
// CommentModal.jsx
import React, { useState, useEffect, useRef } from 'react';
import './CommentModal.css';

export default function CommentModal({
  selection,        // Selection object from SelectionHandler
  onSave,           // (comment: string) => void
  onClose,
}) {
  const [comment, setComment] = useState('');
  const textareaRef = useRef(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      handleSave();
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  const handleSave = () => {
    if (comment.trim()) {
      onSave(comment.trim());
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="comment-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Add Comment</h3>

        <div className="selection-preview">
          <label>Selected text:</label>
          <div className="selected-text">
            "{selection.text.length > 200
              ? selection.text.slice(0, 200) + '...'
              : selection.text}"
          </div>
        </div>

        {selection.sectionTitle && (
          <div className="context-badge">
            Section: {selection.sectionTitle}
          </div>
        )}

        <div className="comment-input">
          <label>Your comment:</label>
          <textarea
            ref={textareaRef}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Add your annotation or feedback..."
            rows={4}
          />
        </div>

        <div className="modal-actions">
          <button onClick={onClose} className="cancel-btn">
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="save-btn"
            disabled={!comment.trim()}
          >
            Save (Ctrl+Enter)
          </button>
        </div>
      </div>
    </div>
  );
}
```

### 5. CommitSidebar.jsx (Context Stack + Submit)

This is the key component for your feedback use case. It shows all annotations and allows submitting them.

```jsx
// CommitSidebar.jsx
import React, { useState } from 'react';
import './CommitSidebar.css';

export default function CommitSidebar({
  comments,              // Array of Comment objects
  contextSegments,       // Array of ContextSegment objects (pinned sections)
  onDeleteComment,       // (commentId) => void
  onEditComment,         // (commentId, newContent) => void
  onRemoveSegment,       // (segmentId) => void
  onSubmitFeedback,      // (question: string, context: {comments, segments}) => void
  onJumpToHighlight,     // (commentId) => void - scroll to highlight
}) {
  const [feedbackText, setFeedbackText] = useState('');
  const [isCollapsed, setIsCollapsed] = useState(false);

  const handleSubmit = () => {
    if (!feedbackText.trim() && comments.length === 0 && contextSegments.length === 0) {
      return;
    }

    onSubmitFeedback(feedbackText.trim(), {
      comment_ids: comments.map(c => c.id),
      context_segments: contextSegments
    });
  };

  const totalItems = comments.length + contextSegments.length;

  return (
    <div className={`commit-sidebar ${isCollapsed ? 'collapsed' : ''}`}>
      <div className="sidebar-header">
        <h3>Review Context ({totalItems})</h3>
        <button
          className="collapse-toggle"
          onClick={() => setIsCollapsed(!isCollapsed)}
        >
          {isCollapsed ? '>' : '<'}
        </button>
      </div>

      {!isCollapsed && (
        <>
          {/* Comments Section */}
          <div className="comments-section">
            <h4>Highlighted Comments ({comments.length})</h4>
            {comments.length === 0 ? (
              <p className="empty-state">
                Highlight text and add comments to build your review context.
              </p>
            ) : (
              <div className="comment-cards">
                {comments.map((comment, index) => (
                  <div
                    key={comment.id}
                    className="comment-card"
                    onClick={() => onJumpToHighlight(comment.id)}
                  >
                    <div className="card-header">
                      <span className="comment-number">#{index + 1}</span>
                      {comment.sectionTitle && (
                        <span className="section-badge">{comment.sectionTitle}</span>
                      )}
                    </div>
                    <div className="card-selection">
                      "{comment.selection.slice(0, 80)}
                      {comment.selection.length > 80 ? '...' : ''}"
                    </div>
                    <div className="card-content">{comment.content}</div>
                    <div className="card-actions">
                      <button onClick={(e) => {
                        e.stopPropagation();
                        const newContent = prompt('Edit comment:', comment.content);
                        if (newContent) onEditComment(comment.id, newContent);
                      }}>Edit</button>
                      <button
                        className="delete"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteComment(comment.id);
                        }}
                      >Remove</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Pinned Segments Section */}
          {contextSegments.length > 0 && (
            <div className="segments-section">
              <h4>Pinned Sections ({contextSegments.length})</h4>
              <div className="segment-cards">
                {contextSegments.map(segment => (
                  <div key={segment.id} className="segment-card">
                    <div className="card-header">
                      {segment.label && <span className="segment-label">{segment.label}</span>}
                    </div>
                    <div className="card-content">
                      {segment.content.slice(0, 150)}
                      {segment.content.length > 150 ? '...' : ''}
                    </div>
                    <button
                      className="remove-segment"
                      onClick={() => onRemoveSegment(segment.id)}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Submit Feedback Section */}
          <div className="feedback-section">
            <h4>Overall Feedback</h4>
            <textarea
              value={feedbackText}
              onChange={(e) => setFeedbackText(e.target.value)}
              placeholder="Add your overall feedback or questions for the developers..."
              rows={4}
            />
            <button
              className="submit-btn"
              onClick={handleSubmit}
              disabled={!feedbackText.trim() && totalItems === 0}
            >
              Submit Feedback ({totalItems} annotation{totalItems !== 1 ? 's' : ''})
            </button>
          </div>
        </>
      )}
    </div>
  );
}
```

### 6. AddToContextButton.jsx (Pin Entire Sections)

```jsx
// AddToContextButton.jsx
import React from 'react';

export default function AddToContextButton({
  content,         // Full section content
  sectionId,
  sectionTitle,
  isInStack,       // Whether already pinned
  onAdd,           // () => void
  onRemove,        // () => void
}) {
  return (
    <button
      className={`add-to-context-btn ${isInStack ? 'in-stack' : ''}`}
      onClick={isInStack ? onRemove : onAdd}
      title={isInStack ? 'Remove from context' : 'Add entire section to context'}
    >
      {isInStack ? '- Remove' : '+ Stack'}
    </button>
  );
}
```

---

## CSS Styling

### Highlight Styles (index.css or global)

```css
/* Text highlight base */
mark.text-highlight {
  background-color: rgba(255, 235, 59, 0.4); /* Yellow highlight */
  border-bottom: 2px solid #ffc107;
  cursor: pointer;
  transition: background-color 0.2s ease;
  padding: 0 2px;
  border-radius: 2px;
}

mark.text-highlight:hover {
  background-color: rgba(255, 235, 59, 0.6);
}

mark.text-highlight.active {
  background-color: rgba(255, 152, 0, 0.5);
  border-bottom-color: #ff9800;
}

/* Dark mode overrides */
[data-theme="dark"] mark.text-highlight {
  background-color: rgba(255, 193, 7, 0.3);
  border-bottom-color: #ffa000;
}

[data-theme="dark"] mark.text-highlight:hover {
  background-color: rgba(255, 193, 7, 0.45);
}

[data-theme="dark"] mark.text-highlight.active {
  background-color: rgba(255, 152, 0, 0.4);
}
```

### FloatingComment.css

```css
.floating-comment {
  background: white;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  max-width: 300px;
  padding: 12px;
  animation: fadeIn 0.2s ease;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: translateY(0); }
}

.floating-comment.pinned {
  border-color: #ffc107;
  box-shadow: 0 4px 16px rgba(255, 193, 7, 0.3);
}

.floating-comment-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.comment-badge {
  background: #e3f2fd;
  color: #1976d2;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
}

.unpin-btn {
  background: none;
  border: none;
  font-size: 18px;
  cursor: pointer;
  color: #999;
}

.floating-comment-selection {
  font-style: italic;
  color: #666;
  font-size: 13px;
  margin-bottom: 8px;
  padding: 8px;
  background: #f5f5f5;
  border-radius: 4px;
  border-left: 3px solid #ffc107;
}

.floating-comment-content {
  font-size: 14px;
  line-height: 1.5;
  margin-bottom: 12px;
}

.floating-comment-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

.floating-comment-actions button {
  padding: 4px 12px;
  font-size: 12px;
  border: 1px solid #ddd;
  background: white;
  border-radius: 4px;
  cursor: pointer;
}

.floating-comment-actions button:hover {
  background: #f5f5f5;
}

.floating-comment-actions .delete-btn {
  color: #d32f2f;
  border-color: #ffcdd2;
}

.floating-comment-actions .delete-btn:hover {
  background: #ffebee;
}

/* Dark mode */
[data-theme="dark"] .floating-comment {
  background: #1e1e1e;
  border-color: #333;
}

[data-theme="dark"] .floating-comment-selection {
  background: #2d2d2d;
  color: #aaa;
}
```

### CommitSidebar.css

```css
.commit-sidebar {
  width: 320px;
  background: #fafafa;
  border-left: 1px solid #e0e0e0;
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.commit-sidebar.collapsed {
  width: 40px;
}

.sidebar-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  border-bottom: 1px solid #e0e0e0;
  background: white;
}

.sidebar-header h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}

.collapse-toggle {
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px 8px;
}

.comments-section,
.segments-section,
.feedback-section {
  padding: 16px;
  border-bottom: 1px solid #e0e0e0;
}

.comments-section h4,
.segments-section h4,
.feedback-section h4 {
  margin: 0 0 12px 0;
  font-size: 13px;
  color: #666;
}

.empty-state {
  color: #999;
  font-size: 13px;
  font-style: italic;
}

.comment-cards,
.segment-cards {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-height: 300px;
  overflow-y: auto;
}

.comment-card,
.segment-card {
  background: white;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  padding: 12px;
  cursor: pointer;
  transition: border-color 0.2s;
}

.comment-card:hover {
  border-color: #ffc107;
}

.card-header {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}

.comment-number {
  background: #ffc107;
  color: white;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
}

.section-badge,
.segment-label {
  background: #e3f2fd;
  color: #1976d2;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
}

.card-selection {
  font-style: italic;
  color: #666;
  font-size: 12px;
  margin-bottom: 8px;
}

.card-content {
  font-size: 13px;
  line-height: 1.4;
}

.card-actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}

.card-actions button {
  font-size: 11px;
  padding: 4px 8px;
  background: none;
  border: 1px solid #ddd;
  border-radius: 4px;
  cursor: pointer;
}

.card-actions button.delete {
  color: #d32f2f;
}

.feedback-section textarea {
  width: 100%;
  padding: 12px;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  resize: vertical;
  font-family: inherit;
  font-size: 14px;
  margin-bottom: 12px;
}

.submit-btn {
  width: 100%;
  padding: 12px;
  background: #4a90e2;
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s;
}

.submit-btn:hover:not(:disabled) {
  background: #357abd;
}

.submit-btn:disabled {
  background: #ccc;
  cursor: not-allowed;
}

/* Add to context button */
.add-to-context-btn {
  padding: 4px 12px;
  font-size: 12px;
  background: white;
  border: 1px solid #e0e0e0;
  border-radius: 4px;
  cursor: pointer;
}

.add-to-context-btn:hover {
  background: #f5f5f5;
}

.add-to-context-btn.in-stack {
  background: #fff3e0;
  border-color: #ffb74d;
  color: #e65100;
}
```

---

## Backend Implementation

### API Endpoints (FastAPI Example)

```python
# main.py
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Optional, List
import uuid
from datetime import datetime

app = FastAPI()

# --- Pydantic Models ---

class CreateCommentRequest(BaseModel):
    selection: str
    content: str
    source_type: str = "feedback"
    source_content: Optional[str] = None
    section_id: Optional[str] = None
    section_title: Optional[str] = None

class UpdateCommentRequest(BaseModel):
    content: str

class ContextSegment(BaseModel):
    id: str
    content: str
    label: Optional[str] = None
    section_id: Optional[str] = None
    section_title: Optional[str] = None

class SubmitFeedbackRequest(BaseModel):
    question: str
    comment_ids: List[str]
    context_segments: List[ContextSegment]

# --- Endpoints ---

@app.post("/api/sessions/{session_id}/comments")
async def create_comment(session_id: str, request: CreateCommentRequest):
    comment = {
        "id": str(uuid.uuid4()),
        "selection": request.selection,
        "content": request.content,
        "source_type": request.source_type,
        "source_content": request.source_content,
        "section_id": request.section_id,
        "section_title": request.section_title,
        "created_at": datetime.utcnow().isoformat()
    }
    # Save to storage (implement storage.add_comment)
    storage.add_comment(session_id, comment)
    return comment

@app.get("/api/sessions/{session_id}/comments")
async def list_comments(session_id: str):
    return storage.get_comments(session_id)

@app.put("/api/sessions/{session_id}/comments/{comment_id}")
async def update_comment(session_id: str, comment_id: str, request: UpdateCommentRequest):
    comment = storage.update_comment(session_id, comment_id, request.content)
    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")
    return comment

@app.delete("/api/sessions/{session_id}/comments/{comment_id}")
async def delete_comment(session_id: str, comment_id: str):
    success = storage.delete_comment(session_id, comment_id)
    if not success:
        raise HTTPException(status_code=404, detail="Comment not found")
    return {"success": True}

@app.post("/api/sessions/{session_id}/feedback")
async def submit_feedback(session_id: str, request: SubmitFeedbackRequest):
    """
    Compile all comments and segments into context, then process feedback.
    """
    # Get comments by IDs
    comments = storage.get_comments_by_ids(session_id, request.comment_ids)

    # Compile context
    compiled_context = compile_feedback_context(
        comments=comments,
        segments=request.context_segments,
        question=request.question
    )

    # Process feedback (send to LLM, store, notify developers, etc.)
    result = process_feedback(session_id, compiled_context)

    return {
        "success": True,
        "feedback_id": result["id"],
        "compiled_context": compiled_context
    }
```

### Context Compilation

```python
# context.py

def compile_feedback_context(
    comments: list,
    segments: list,
    question: str
) -> str:
    """
    Compile comments and segments into a structured context string.
    """
    parts = []

    # Add highlighted comments
    if comments:
        parts.append("## Highlighted Feedback Points\n")
        for i, comment in enumerate(comments, 1):
            section_info = f" (Section: {comment.get('section_title', 'Unknown')})" if comment.get('section_title') else ""
            parts.append(f"""
### Point #{i}{section_info}

**Highlighted text:**
> {comment['selection']}

**Feedback:**
{comment['content']}
""")

    # Add pinned segments
    if segments:
        parts.append("\n## Additional Context (Pinned Sections)\n")
        for segment in segments:
            label = f" - {segment.get('label')}" if segment.get('label') else ""
            parts.append(f"""
### Pinned Section{label}

{segment['content']}
""")

    # Add overall question/feedback
    if question:
        parts.append(f"\n## Overall Feedback\n\n{question}")

    return "\n".join(parts)
```

### Storage (Simple JSON Example)

```python
# storage.py
import json
from pathlib import Path
from datetime import datetime

DATA_DIR = Path("data/sessions")

def _get_session_path(session_id: str) -> Path:
    return DATA_DIR / f"{session_id}.json"

def _load_session(session_id: str) -> dict:
    path = _get_session_path(session_id)
    if path.exists():
        return json.loads(path.read_text())
    return {"id": session_id, "comments": [], "threads": []}

def _save_session(session_id: str, data: dict):
    path = _get_session_path(session_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2))

def add_comment(session_id: str, comment: dict):
    session = _load_session(session_id)
    session["comments"].append(comment)
    _save_session(session_id, session)
    return comment

def get_comments(session_id: str) -> list:
    session = _load_session(session_id)
    return session.get("comments", [])

def get_comments_by_ids(session_id: str, comment_ids: list) -> list:
    comments = get_comments(session_id)
    return [c for c in comments if c["id"] in comment_ids]

def update_comment(session_id: str, comment_id: str, content: str) -> dict:
    session = _load_session(session_id)
    for comment in session["comments"]:
        if comment["id"] == comment_id:
            comment["content"] = content
            comment["updated_at"] = datetime.utcnow().isoformat()
            _save_session(session_id, session)
            return comment
    return None

def delete_comment(session_id: str, comment_id: str) -> bool:
    session = _load_session(session_id)
    original_len = len(session["comments"])
    session["comments"] = [c for c in session["comments"] if c["id"] != comment_id]
    if len(session["comments"]) < original_len:
        _save_session(session_id, session)
        return True
    return False
```

---

## Integration Guide (Main App Component)

```jsx
// FeedbackMode.jsx - Main orchestration component
import React, { useState, useCallback } from 'react';
import ResponseWithComments from './components/ResponseWithComments';
import CommentModal from './components/CommentModal';
import CommitSidebar from './components/CommitSidebar';
import AddToContextButton from './components/AddToContextButton';
import * as SelectionHandler from './utils/SelectionHandler';
import * as api from './api';

export default function FeedbackMode({ sessionId, content, sections }) {
  const [comments, setComments] = useState([]);
  const [contextSegments, setContextSegments] = useState([]);
  const [pendingSelection, setPendingSelection] = useState(null);
  const [showCommentModal, setShowCommentModal] = useState(false);

  // Handle text selection
  const handleMouseUp = useCallback(() => {
    const selection = SelectionHandler.getSelection();
    if (selection && selection.text.length > 3) {
      setPendingSelection(selection);
      setShowCommentModal(true);
    }
  }, []);

  // Create new comment
  const handleSaveComment = async (commentText) => {
    const newComment = await api.createComment(sessionId, {
      selection: pendingSelection.text,
      content: commentText,
      section_id: pendingSelection.sectionId,
      section_title: pendingSelection.sectionTitle,
      source_content: pendingSelection.sourceContent
    });

    setComments(prev => [...prev, newComment]);
    setShowCommentModal(false);
    setPendingSelection(null);
  };

  // Delete comment
  const handleDeleteComment = async (commentId) => {
    await api.deleteComment(sessionId, commentId);
    SelectionHandler.removeHighlight(commentId);
    setComments(prev => prev.filter(c => c.id !== commentId));
  };

  // Edit comment
  const handleEditComment = async (commentId, newContent) => {
    const updated = await api.updateComment(sessionId, commentId, newContent);
    setComments(prev => prev.map(c => c.id === commentId ? updated : c));
  };

  // Add section to context stack
  const handleAddToStack = (section) => {
    const segment = {
      id: `segment-${Date.now()}`,
      content: section.content,
      label: section.title,
      section_id: section.id,
      section_title: section.title
    };
    setContextSegments(prev => [...prev, segment]);
  };

  // Remove from context stack
  const handleRemoveFromStack = (segmentId) => {
    setContextSegments(prev => prev.filter(s => s.id !== segmentId));
  };

  // Submit all feedback
  const handleSubmitFeedback = async (question, context) => {
    const result = await api.submitFeedback(sessionId, {
      question,
      comment_ids: context.comment_ids,
      context_segments: context.context_segments
    });

    // Handle success (show confirmation, navigate, etc.)
    console.log('Feedback submitted:', result);
  };

  // Jump to highlight
  const handleJumpToHighlight = (commentId) => {
    const mark = document.querySelector(`mark[data-comment-id="${commentId}"]`);
    if (mark) {
      mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
      mark.classList.add('active');
      setTimeout(() => mark.classList.remove('active'), 2000);
    }
  };

  return (
    <div className="feedback-mode" onMouseUp={handleMouseUp}>
      <div className="content-area">
        {sections.map(section => (
          <div key={section.id} className="section">
            <div className="section-header">
              <h2>{section.title}</h2>
              <AddToContextButton
                content={section.content}
                sectionId={section.id}
                sectionTitle={section.title}
                isInStack={contextSegments.some(s => s.section_id === section.id)}
                onAdd={() => handleAddToStack(section)}
                onRemove={() => {
                  const seg = contextSegments.find(s => s.section_id === section.id);
                  if (seg) handleRemoveFromStack(seg.id);
                }}
              />
            </div>
            <ResponseWithComments
              content={section.content}
              comments={comments.filter(c => c.section_id === section.id)}
              sectionId={section.id}
              sectionTitle={section.title}
              onDeleteComment={handleDeleteComment}
              onEditComment={handleEditComment}
            />
          </div>
        ))}
      </div>

      <CommitSidebar
        comments={comments}
        contextSegments={contextSegments}
        onDeleteComment={handleDeleteComment}
        onEditComment={handleEditComment}
        onRemoveSegment={handleRemoveFromStack}
        onSubmitFeedback={handleSubmitFeedback}
        onJumpToHighlight={handleJumpToHighlight}
      />

      {showCommentModal && pendingSelection && (
        <CommentModal
          selection={pendingSelection}
          onSave={handleSaveComment}
          onClose={() => {
            setShowCommentModal(false);
            setPendingSelection(null);
          }}
        />
      )}
    </div>
  );
}
```

---

## Implementation Checklist

### Phase 1: Core Text Selection
- [ ] Create `SelectionHandler.js` utility
- [ ] Add `data-annotatable` attributes to content containers
- [ ] Implement `getSelection()` with metadata extraction
- [ ] Test selection captures correct text and context

### Phase 2: Highlighting
- [ ] Implement `createHighlight()` with `<mark>` elements
- [ ] Implement `removeHighlight()` with DOM cleanup
- [ ] Add highlight CSS styles (light + dark mode)
- [ ] Test multiline selections

### Phase 3: Comment Creation
- [ ] Create `CommentModal` component
- [ ] Wire up keyboard shortcuts (Ctrl+Enter, Escape)
- [ ] Create comment API endpoint
- [ ] Store comments with unique IDs

### Phase 4: Floating Popup
- [ ] Create `FloatingComment` component
- [ ] Implement smart positioning (viewport awareness)
- [ ] Add hover/click interactions
- [ ] Add pin/unpin functionality
- [ ] Wire up edit and delete

### Phase 5: Context Sidebar
- [ ] Create `CommitSidebar` component
- [ ] Show comment cards with metadata
- [ ] Implement inline editing
- [ ] Add "jump to highlight" functionality
- [ ] Track token/character counts (optional)

### Phase 6: Context Stack
- [ ] Create `AddToContextButton` component
- [ ] Implement segment pinning/unpinning
- [ ] Show pinned segments in sidebar
- [ ] Collapse/expand for many items

### Phase 7: Submit Flow
- [ ] Add overall feedback textarea
- [ ] Implement context compilation
- [ ] Create submit API endpoint
- [ ] Handle success state

### Phase 8: Polish
- [ ] Add loading states
- [ ] Handle errors gracefully
- [ ] Add animations/transitions
- [ ] Test dark mode thoroughly
- [ ] Mobile responsiveness (optional)

---

## Key Differences for Your Use Case

Since you're building a **feedback mode for developers** rather than a multi-model council:

1. **Simplify source_type**: You probably only need one type (e.g., "feedback" or "review")

2. **Remove model selection**: No need to select which model to query

3. **Feedback destination**: Instead of querying an LLM, you might:
   - Store feedback for developer review
   - Send notifications
   - Create GitHub issues
   - Trigger a Slack message

4. **Context compilation**: Adjust `compile_feedback_context()` to format for your specific use case

5. **Thread continuation**: You may not need the thread feature if it's one-way feedback

---

## Files to Copy

Minimal files needed for replication:

```
frontend/
├── utils/
│   └── SelectionHandler.js         # Core utility (framework-agnostic)
├── components/
│   ├── ResponseWithComments.jsx    # Wrapper + highlight management
│   ├── FloatingComment.jsx         # Hover popup
│   ├── FloatingComment.css
│   ├── CommentModal.jsx            # Create comment modal
│   ├── CommentModal.css
│   ├── CommitSidebar.jsx           # Context stack + submit
│   ├── CommitSidebar.css
│   └── AddToContextButton.jsx      # Pin sections
└── styles/
    └── highlights.css              # Highlight styling

backend/
├── main.py                         # API endpoints
├── storage.py                      # Data persistence
└── context.py                      # Context compilation
```
