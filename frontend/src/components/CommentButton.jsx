import React from 'react';
import './CommentButton.css';

/**
 * Button that appears when text is selected, allowing users to add a comment
 */
function CommentButton({ position, onComment }) {
  if (!position) return null;

  return (
    <button
      className="comment-button"
      style={{
        position: 'fixed',
        left: `${position.x}px`,
        top: `${position.y}px`,
      }}
      onClick={onComment}
    >
      Add Comment
    </button>
  );
}

export default CommentButton;
