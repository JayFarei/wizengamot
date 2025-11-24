import React from 'react';
import './CommentAnnotation.css';

/**
 * Display existing comments on a response
 */
function CommentAnnotation({ comments, onDelete }) {
  if (!comments || comments.length === 0) {
    return null;
  }

  return (
    <div className="comment-annotations">
      <div className="comment-annotations-header">
        <strong>{comments.length} comment{comments.length !== 1 ? 's' : ''}</strong>
      </div>
      {comments.map((comment) => (
        <div key={comment.id} className="comment-annotation">
          <div className="comment-annotation-selection">
            "{comment.selection}"
          </div>
          <div className="comment-annotation-content">
            {comment.content}
          </div>
          <div className="comment-annotation-footer">
            <span className="comment-annotation-time">
              {new Date(comment.created_at).toLocaleString()}
            </span>
            {onDelete && (
              <button
                className="comment-annotation-delete"
                onClick={() => onDelete(comment.id)}
                title="Delete comment"
              >
                Delete
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export default CommentAnnotation;
