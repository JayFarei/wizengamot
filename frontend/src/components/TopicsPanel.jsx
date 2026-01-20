import React from 'react';
import './TopicsPanel.css';

/**
 * TopicsPanel displays topics and entities extracted from source content
 * during the first pass of Knowledge Graph mode.
 * Matches the exact design of kg-detail-connection from KnowledgeGraph.
 */
export default function TopicsPanel({ topics = [], entities = [], domain = 'general', onEntityClick }) {
  const getEntityType = (entity) => {
    const lowerEntity = entity.toLowerCase();

    if (lowerEntity.includes('ai') || lowerEntity.includes('ml') ||
        lowerEntity.includes('algorithm') || lowerEntity.includes('framework') ||
        lowerEntity.includes('model') || lowerEntity.includes('network')) {
      return 'tech';
    }
    if (lowerEntity.includes('inc') || lowerEntity.includes('corp') ||
        lowerEntity.includes('co.') || lowerEntity.includes('company') ||
        lowerEntity.includes('university') || lowerEntity.includes('lab')) {
      return 'org';
    }
    // Check for capitalized words that might be names (two capitalized words)
    if (/^[A-Z][a-z]+ [A-Z][a-z]+$/.test(entity)) {
      return 'person';
    }
    return 'concept';
  };

  const typeLabels = {
    tech: 'TECH',
    org: 'ORG',
    person: 'PERSON',
    concept: 'CONCEPT'
  };

  return (
    <div className="topics-panel">
      {/* Domain section */}
      <div className="topics-section">
        <h4>Domain</h4>
        <div className="domain-text">
          {domain}
        </div>
      </div>

      {/* Topics section - reuses note-tag styling */}
      {topics.length > 0 && (
        <div className="topics-section">
          <h4>Topics ({topics.length})</h4>
          <div className="topics-list">
            {topics.map((topic, index) => (
              <span key={index} className="topic-tag">
                {topic}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Entities section - matches kg-detail-connection exactly */}
      {entities.length > 0 && (
        <div className="topics-section">
          <h4>Entities ({entities.length})</h4>
          <div className="entities-list">
            {entities.map((entity, index) => {
              const entityType = getEntityType(entity);
              return (
                <div
                  key={index}
                  className="entity-card"
                  onClick={() => onEntityClick?.(`@entity ${entity}`)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && onEntityClick?.(`@entity ${entity}`)}
                >
                  <span className={`entity-type-badge entity-${entityType}`}>
                    {typeLabels[entityType]}
                  </span>
                  <span className="entity-name">{entity}</span>
                  <svg
                    className="entity-arrow"
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <polyline points="9 18 15 12 9 6"></polyline>
                  </svg>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {topics.length === 0 && entities.length === 0 && (
        <div className="topics-empty">
          <p>No topics or entities were extracted from the source content.</p>
          <p className="hint">This may happen with very short or abstract content.</p>
        </div>
      )}
    </div>
  );
}
