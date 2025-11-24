import { useEffect } from 'react';
import ResponseWithComments from './ResponseWithComments';
import { SelectionHandler } from '../utils/SelectionHandler';
import './Stage3.css';

export default function Stage3({
  finalResponse,
  messageIndex,
  comments,
  onSelectionChange,
  onEditComment,
  onDeleteComment,
  activeCommentId,
  onSetActiveComment
}) {
  useEffect(() => {
    const handleMouseUp = () => {
      const selection = SelectionHandler.getSelection();
      if (selection && selection.stage === 3) {
        onSelectionChange(selection);
      }
    };

    document.addEventListener('mouseup', handleMouseUp);
    return () => document.removeEventListener('mouseup', handleMouseUp);
  }, [onSelectionChange]);

  if (!finalResponse) {
    return null;
  }

  const stage3Comments = comments?.filter(
    c => c.stage === 3 && c.model === finalResponse.model && c.message_index === messageIndex
  ) || [];

  // Check if active comment belongs to this response
  const activeCommentForThisResponse = activeCommentId && stage3Comments.some(c => c.id === activeCommentId)
    ? activeCommentId
    : null;

  return (
    <div className="stage stage3">
      <h3 className="stage-title">Stage 3: Final Council Answer</h3>
      <div className="final-response">
        <div className="chairman-label">
          Chairman: {finalResponse.model.split('/')[1] || finalResponse.model}
        </div>
        <ResponseWithComments
          content={finalResponse.response}
          comments={stage3Comments}
          messageIndex={messageIndex}
          stage={3}
          model={finalResponse.model}
          onEditComment={onEditComment}
          onDeleteComment={onDeleteComment}
          activeCommentId={activeCommentForThisResponse}
          onSetActiveComment={onSetActiveComment}
          className="final-text"
        />
      </div>
    </div>
  );
}
