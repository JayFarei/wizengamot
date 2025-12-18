import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import './Stage2Reviews.css';

/**
 * Stage2Reviews displays the peer review rankings from Stage 2.
 * Shows each model's evaluation with de-anonymized model names.
 */
export default function Stage2Reviews({ rankings, labelToModel }) {
  const [activeTab, setActiveTab] = useState(0);

  // Helper to get short model name
  const getModelShortName = (model) => model?.split('/').pop() || model;

  // De-anonymize text by replacing "Response X" with model names in bold
  const deAnonymizeText = (text) => {
    if (!labelToModel || !text) return text;
    let result = text;
    Object.entries(labelToModel).forEach(([label, model]) => {
      const modelShortName = getModelShortName(model);
      // Replace "Response X" with "**ModelName** (Response X)"
      const regex = new RegExp(label.replace(' ', '\\s+'), 'gi');
      result = result.replace(regex, `**${modelShortName}** (${label})`);
    });
    return result;
  };

  if (!rankings || rankings.length === 0) {
    return (
      <div className="stage2-reviews empty">
        <p>No rankings available</p>
      </div>
    );
  }

  const activeRanking = rankings[activeTab];

  return (
    <div className="stage2-reviews">
      <h4>Stage 2: Peer Reviews</h4>
      <p className="stage-description">
        Each model evaluated all note summaries alongside the original source content.
        Model names shown in <strong>bold</strong> were anonymized during evaluation.
      </p>

      <div className="reviewer-tabs">
        {rankings.map((rank, index) => (
          <button
            key={index}
            className={`reviewer-tab ${activeTab === index ? 'active' : ''}`}
            onClick={() => setActiveTab(index)}
          >
            {getModelShortName(rank.model)}
          </button>
        ))}
      </div>

      <div className="review-content">
        <div className="review-text markdown-content">
          <ReactMarkdown>{deAnonymizeText(activeRanking?.ranking || '')}</ReactMarkdown>
        </div>

        {activeRanking?.parsed_ranking && activeRanking.parsed_ranking.length > 0 && (
          <div className="extracted-ranking">
            <strong>Extracted Ranking:</strong>
            <ol>
              {activeRanking.parsed_ranking.map((label, i) => {
                const model = labelToModel?.[label];
                return (
                  <li key={i}>
                    {model ? (
                      <>
                        <span className="ranked-model">{getModelShortName(model)}</span>
                        <span className="ranked-label">({label})</span>
                      </>
                    ) : (
                      <span className="ranked-label">{label}</span>
                    )}
                  </li>
                );
              })}
            </ol>
          </div>
        )}
      </div>
    </div>
  );
}
