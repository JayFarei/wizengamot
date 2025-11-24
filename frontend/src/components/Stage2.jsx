import { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import ResponseWithComments from './ResponseWithComments';
import { SelectionHandler } from '../utils/SelectionHandler';
import './Stage2.css';

function deAnonymizeText(text, labelToModel) {
  if (!labelToModel) return text;

  let result = text;
  // Replace each "Response X" with the actual model name
  Object.entries(labelToModel).forEach(([label, model]) => {
    const modelShortName = model.split('/')[1] || model;
    result = result.replace(new RegExp(label, 'g'), `**${modelShortName}**`);
  });
  return result;
}

export default function Stage2({
  rankings,
  labelToModel,
  aggregateRankings,
  messageIndex,
  comments,
  onSelectionChange,
  onEditComment,
  onDeleteComment,
  activeCommentId,
  onSetActiveComment
}) {
  const [activeTab, setActiveTab] = useState(0);

  useEffect(() => {
    const handleMouseUp = () => {
      const selection = SelectionHandler.getSelection();
      if (selection && selection.stage === 2) {
        onSelectionChange(selection);
      }
    };

    document.addEventListener('mouseup', handleMouseUp);
    return () => document.removeEventListener('mouseup', handleMouseUp);
  }, [onSelectionChange]);

  // Listen for tab switch events from sidebar
  useEffect(() => {
    const handleSwitchToComment = (e) => {
      if (e.detail.stage === 2 && rankings) {
        const tabIndex = rankings.findIndex(r => r.model === e.detail.model);
        if (tabIndex !== -1) {
          setActiveTab(tabIndex);
        }
      }
    };
    
    window.addEventListener('switchToComment', handleSwitchToComment);
    return () => window.removeEventListener('switchToComment', handleSwitchToComment);
  }, [rankings]);

  if (!rankings || rankings.length === 0) {
    return null;
  }

  const activeRanking = rankings[activeTab];
  const rankingComments = comments?.filter(
    c => c.stage === 2 && c.model === activeRanking.model && c.message_index === messageIndex
  ) || [];

  // Check if active comment belongs to this response
  const activeCommentForThisResponse = activeCommentId && rankingComments.some(c => c.id === activeCommentId)
    ? activeCommentId
    : null;

  return (
    <div className="stage stage2">
      <h3 className="stage-title">Stage 2: Peer Rankings</h3>

      <h4>Raw Evaluations</h4>
      <p className="stage-description">
        Each model evaluated all responses (anonymized as Response A, B, C, etc.) and provided rankings.
        Below, model names are shown in <strong>bold</strong> for readability, but the original evaluation used anonymous labels.
      </p>

      <div className="tabs">
        {rankings.map((rank, index) => (
          <button
            key={index}
            className={`tab ${activeTab === index ? 'active' : ''}`}
            onClick={() => setActiveTab(index)}
          >
            {rank.model.split('/')[1] || rank.model}
          </button>
        ))}
      </div>

      <div className="tab-content">
        <div className="ranking-model">
          {activeRanking.model}
        </div>
        <ResponseWithComments
          content={deAnonymizeText(activeRanking.ranking, labelToModel)}
          comments={rankingComments}
          messageIndex={messageIndex}
          stage={2}
          model={activeRanking.model}
          onEditComment={onEditComment}
          onDeleteComment={onDeleteComment}
          activeCommentId={activeCommentForThisResponse}
          onSetActiveComment={onSetActiveComment}
          className="ranking-content"
        />

        {activeRanking.parsed_ranking &&
         activeRanking.parsed_ranking.length > 0 && (
          <div className="parsed-ranking">
            <strong>Extracted Ranking:</strong>
            <ol>
              {activeRanking.parsed_ranking.map((label, i) => (
                <li key={i}>
                  {labelToModel && labelToModel[label]
                    ? labelToModel[label].split('/')[1] || labelToModel[label]
                    : label}
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>

      {aggregateRankings && aggregateRankings.length > 0 && (
        <div className="aggregate-rankings">
          <h4>Aggregate Rankings (Street Cred)</h4>
          <p className="stage-description">
            Combined results across all peer evaluations (lower score is better):
          </p>
          <div className="aggregate-list">
            {aggregateRankings.map((agg, index) => (
              <div key={index} className="aggregate-item">
                <span className="rank-position">#{index + 1}</span>
                <span className="rank-model">
                  {agg.model.split('/')[1] || agg.model}
                </span>
                <span className="rank-score">
                  Avg: {agg.average_rank.toFixed(2)}
                </span>
                <span className="rank-count">
                  ({agg.rankings_count} votes)
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
