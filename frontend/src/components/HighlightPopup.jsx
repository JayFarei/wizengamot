import React, { useState, useEffect, useRef } from 'react';
import './HighlightPopup.css';

/**
 * Responsive popup that appears next to highlighted text
 * Shows comment content and allows deletion
 */
function HighlightPopup({ comment, onDelete, position }) {
  const [isVisible, setIsVisible] = useState(false);
  const popupRef = useRef(null);

  useEffect(() => {
    // Slight delay for smooth appearance
    const timer = setTimeout(() => setIsVisible(true), 50);
    return () => clearTimeout(timer);
  }, []);

  if (!comment || !position) return null;

  return (
    <div
      ref={popupRef}
      className={`highlight-popup ${isVisible ? 'visible' : ''}`}
      style={{
        top: `${position.top}px`,
        left: `${position.left}px`,
      }}
    >
      <div className="highlight-popup-header">
        <span className="highlight-popup-label">Comment</span>
        {onDelete && (
          <button
            className="highlight-popup-delete"
            onClick={() => onDelete(comment.id)}
            title="Delete comment"
          >
            ×
          </button>
        )}
      </div>
      <div className="highlight-popup-content">
        {comment.content}
      </div>
      <div className="highlight-popup-meta">
        <span className="highlight-popup-stage">
          Stage {comment.stage}
        </span>
        <span className="highlight-popup-time">
          {new Date(comment.created_at).toLocaleString()}
        </span>
      </div>
      <div className="highlight-popup-arrow" />
    </div>
  );
}

export default HighlightPopup;
