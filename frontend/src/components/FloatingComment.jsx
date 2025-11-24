import React, { useState, useEffect, useRef } from 'react';
import './FloatingComment.css';

/**
 * Floating comment that appears near highlighted text
 * Supports click-to-pin, inline editing, and deletion
 */
function FloatingComment({ 
  comment, 
  position, 
  onEdit, 
  onDelete, 
  isPinned = false,
  onPin,
  onUnpin,
  onMouseEnter,
  onMouseLeave
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(comment?.content || '');
  const commentRef = useRef(null);
  const textareaRef = useRef(null);

  useEffect(() => {
    if (comment) {
      setEditValue(comment.content);
    }
  }, [comment]);

  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.select();
    }
  }, [isEditing]);

  // Handle click outside to unpin
  useEffect(() => {
    if (!isPinned) return;

    const handleClickOutside = (e) => {
      if (commentRef.current && !commentRef.current.contains(e.target)) {
        // Check if clicking on a highlight - if so, don't unpin
        if (e.target.closest('.text-highlight')) return;
        onUnpin?.();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isPinned, onUnpin]);

  const handleSaveEdit = () => {
    if (editValue.trim() && editValue !== comment.content) {
      onEdit(comment.id, editValue.trim());
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSaveEdit();
    } else if (e.key === 'Escape') {
      setEditValue(comment.content);
      setIsEditing(false);
    }
  };

  const handleDelete = () => {
    onDelete(comment.id);
  };

  if (!position || !comment) return null;

  // Calculate position ensuring it stays in viewport
  const adjustedPosition = {
    top: Math.max(10, position.top),
    left: Math.max(10, Math.min(position.left, window.innerWidth - 320))
  };

  return (
    <div
      ref={commentRef}
      className={`floating-comment ${isPinned ? 'pinned' : ''}`}
      style={{
        position: 'fixed',
        top: `${adjustedPosition.top}px`,
        left: `${adjustedPosition.left}px`,
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={(e) => {
        e.stopPropagation();
        if (!isPinned && onPin) {
          onPin();
        }
      }}
    >
      <div className="floating-comment-header">
        <span className="floating-comment-badge">
          Stage {comment.stage}
        </span>
        <span className="floating-comment-model">
          {comment.model?.split('/')[1] || comment.model}
        </span>
        {isPinned && (
          <button 
            className="btn-unpin" 
            onClick={(e) => {
              e.stopPropagation();
              onUnpin?.();
            }}
            title="Close"
          >
            ×
          </button>
        )}
      </div>

      <div className="floating-comment-selection">
        "{comment.selection?.substring(0, 60)}{comment.selection?.length > 60 ? '...' : ''}"
      </div>

      {isEditing ? (
        <div className="floating-comment-edit">
          <textarea
            ref={textareaRef}
            className="floating-comment-textarea"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onClick={(e) => e.stopPropagation()}
            rows={3}
          />
          <div className="floating-comment-edit-actions">
            <button
              className="btn-save"
              onClick={(e) => {
                e.stopPropagation();
                handleSaveEdit();
              }}
              disabled={!editValue.trim()}
            >
              Save
            </button>
            <button
              className="btn-cancel"
              onClick={(e) => {
                e.stopPropagation();
                setEditValue(comment.content);
                setIsEditing(false);
              }}
            >
              Cancel
            </button>
          </div>
          <div className="floating-comment-hint">
            ⌘/Ctrl+Enter to save, Esc to cancel
          </div>
        </div>
      ) : (
        <>
          <div className="floating-comment-content">
            {comment.content}
          </div>
          <div className="floating-comment-actions">
            <button
              className="btn-edit"
              onClick={(e) => {
                e.stopPropagation();
                setIsEditing(true);
              }}
              title="Edit comment"
            >
              Edit
            </button>
            <button
              className="btn-delete"
              onClick={(e) => {
                e.stopPropagation();
                handleDelete();
              }}
              title="Delete comment and highlight"
            >
              Delete
            </button>
          </div>
        </>
      )}

      <div className="floating-comment-arrow" />
    </div>
  );
}

export default FloatingComment;
