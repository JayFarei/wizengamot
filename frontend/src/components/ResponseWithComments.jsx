import React, { useState, useEffect, useRef, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import FloatingComment from './FloatingComment';
import { SelectionHandler } from '../utils/SelectionHandler';
import './ResponseWithComments.css';

/**
 * Component that renders a response with inline comment highlights and floating comments
 * Supports click-to-pin, hover preview, and bidirectional sync with sidebar
 */
function ResponseWithComments({
  content,
  comments,
  messageIndex,
  stage,
  model,
  onDeleteComment,
  onEditComment,
  activeCommentId,
  onSetActiveComment,
  className = ''
}) {
  const [hoveredComment, setHoveredComment] = useState(null);
  const [pinnedComment, setPinnedComment] = useState(null);
  const [commentPosition, setCommentPosition] = useState(null);
  const containerRef = useRef(null);
  const hoverTimeoutRef = useRef(null);

  // Clear pinned comment when activeCommentId from sidebar changes
  useEffect(() => {
    if (activeCommentId) {
      const comment = comments?.find(c => c.id === activeCommentId);
      if (comment) {
        setPinnedComment(comment);
        // Find and scroll to the highlight
        setTimeout(() => {
          const highlight = containerRef.current?.querySelector(`[data-comment-id="${activeCommentId}"]`);
          if (highlight) {
            highlight.scrollIntoView({ behavior: 'smooth', block: 'center' });
            const rect = highlight.getBoundingClientRect();
            setCommentPosition({
              top: rect.bottom + 8,
              left: rect.left
            });
          }
        }, 100);
      }
    }
  }, [activeCommentId, comments]);

  // Apply highlights when component mounts or comments change
  useEffect(() => {
    if (!containerRef.current || !comments || comments.length === 0) return;

    // Clear existing highlights first
    const existingHighlights = containerRef.current.querySelectorAll('.text-highlight');
    existingHighlights.forEach(highlight => {
      const parent = highlight.parentNode;
      while (highlight.firstChild) {
        parent.insertBefore(highlight.firstChild, highlight);
      }
      parent.removeChild(highlight);
      parent.normalize();
    });

    // Apply new highlights with a delay to ensure DOM is ready
    const applyHighlights = () => {
      comments.forEach(comment => {
        const highlight = SelectionHandler.createHighlight(
          containerRef.current,
          comment.selection,
          comment.id
        );

        if (highlight) {
          // Mouse enter - show preview
          highlight.addEventListener('mouseenter', (e) => {
            if (pinnedComment) return; // Don't show hover if something is pinned
            
            clearTimeout(hoverTimeoutRef.current);
            const rect = e.target.getBoundingClientRect();
            setCommentPosition({
              top: rect.bottom + 8,
              left: rect.left
            });
            setHoveredComment(comment);
            highlight.classList.add('hover');
          });

          // Mouse leave - hide preview with delay
          highlight.addEventListener('mouseleave', () => {
            if (pinnedComment) return;
            
            highlight.classList.remove('hover');
            hoverTimeoutRef.current = setTimeout(() => {
              setHoveredComment(null);
              setCommentPosition(null);
            }, 200);
          });

          // Click - pin the comment
          highlight.addEventListener('click', (e) => {
            e.stopPropagation();
            const rect = e.target.getBoundingClientRect();
            setCommentPosition({
              top: rect.bottom + 8,
              left: rect.left
            });
            setPinnedComment(comment);
            setHoveredComment(null);
            onSetActiveComment?.(comment.id);
            
            // Add active class
            containerRef.current.querySelectorAll('.text-highlight').forEach(h => {
              h.classList.remove('active');
            });
            highlight.classList.add('active');
          });
        }
      });
    };

    // Small delay to ensure markdown is rendered
    const timer = setTimeout(applyHighlights, 100);

    return () => {
      clearTimeout(timer);
      clearTimeout(hoverTimeoutRef.current);
    };
  }, [comments, content, pinnedComment, onSetActiveComment]);

  // Handle clicking outside to unpin
  useEffect(() => {
    const handleDocumentClick = (e) => {
      // Don't unpin if clicking on a highlight or floating comment
      if (e.target.closest('.text-highlight') || e.target.closest('.floating-comment')) {
        return;
      }
      if (pinnedComment) {
        setPinnedComment(null);
        setCommentPosition(null);
        onSetActiveComment?.(null);
        
        // Remove active class from all highlights
        containerRef.current?.querySelectorAll('.text-highlight').forEach(h => {
          h.classList.remove('active');
        });
      }
    };

    document.addEventListener('click', handleDocumentClick);
    return () => document.removeEventListener('click', handleDocumentClick);
  }, [pinnedComment, onSetActiveComment]);

  const handleDeleteComment = useCallback((commentId) => {
    // Remove highlight from DOM
    SelectionHandler.removeHighlight(commentId);
    
    // Clear pinned/hovered state
    if (pinnedComment?.id === commentId) {
      setPinnedComment(null);
    }
    if (hoveredComment?.id === commentId) {
      setHoveredComment(null);
    }
    setCommentPosition(null);
    onSetActiveComment?.(null);
    
    // Call parent handler
    if (onDeleteComment) {
      onDeleteComment(commentId);
    }
  }, [pinnedComment, hoveredComment, onDeleteComment, onSetActiveComment]);

  const handleEditComment = useCallback((commentId, newContent) => {
    if (onEditComment) {
      onEditComment(commentId, newContent);
    }
    // Update local state if the edited comment is pinned
    if (pinnedComment?.id === commentId) {
      setPinnedComment(prev => ({ ...prev, content: newContent }));
    }
  }, [pinnedComment, onEditComment]);

  const handlePin = useCallback(() => {
    if (hoveredComment) {
      setPinnedComment(hoveredComment);
      setHoveredComment(null);
      onSetActiveComment?.(hoveredComment.id);
    }
  }, [hoveredComment, onSetActiveComment]);

  const handleUnpin = useCallback(() => {
    setPinnedComment(null);
    setCommentPosition(null);
    onSetActiveComment?.(null);
    
    // Remove active class
    containerRef.current?.querySelectorAll('.text-highlight').forEach(h => {
      h.classList.remove('active');
    });
  }, [onSetActiveComment]);

  const handleFloatingMouseEnter = useCallback(() => {
    // Keep the comment visible when hovering over it
    clearTimeout(hoverTimeoutRef.current);
  }, []);

  const handleFloatingMouseLeave = useCallback(() => {
    // Only hide if not pinned
    if (!pinnedComment && hoveredComment) {
      hoverTimeoutRef.current = setTimeout(() => {
        setHoveredComment(null);
        setCommentPosition(null);
      }, 200);
    }
  }, [pinnedComment, hoveredComment]);

  // Determine which comment to show
  const activeComment = pinnedComment || hoveredComment;

  return (
    <div className={`response-with-comments ${className}`}>
      <div
        ref={containerRef}
        className="response-content markdown-content"
        data-message-index={messageIndex}
        data-stage={stage}
        data-model={model}
      >
        <ReactMarkdown>{content}</ReactMarkdown>
      </div>

      {activeComment && commentPosition && (
        <FloatingComment
          comment={activeComment}
          position={commentPosition}
          onEdit={handleEditComment}
          onDelete={handleDeleteComment}
          isPinned={!!pinnedComment}
          onPin={handlePin}
          onUnpin={handleUnpin}
          onMouseEnter={handleFloatingMouseEnter}
          onMouseLeave={handleFloatingMouseLeave}
        />
      )}
    </div>
  );
}

export default ResponseWithComments;
