import React from 'react';
import './CompetitorRow.css';

export default function CompetitorRow({
  competitor,
  isExpanded,
  onToggleExpand,
  onEdit,
  onDelete,
  onRemovePage,
}) {
  const pageCount = competitor.pages?.length || 0;

  return (
    <div className={`competitor-row ${isExpanded ? 'expanded' : ''}`}>
      <div className="competitor-row-header" onClick={onToggleExpand}>
        <div className="expand-icon">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className={isExpanded ? 'rotated' : ''}
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </div>

        <span className="competitor-name">{competitor.name}</span>

        {competitor.domain && (
          <span className="competitor-domain">{new URL(competitor.domain).hostname}</span>
        )}

        <span className="page-count-badge">
          {pageCount} {pageCount === 1 ? 'page' : 'pages'}
        </span>

        {competitor.tier && (
          <span className={`tier-badge tier-${competitor.tier}`}>
            {competitor.tier}
          </span>
        )}

        <div className="competitor-actions" onClick={(e) => e.stopPropagation()}>
          <button className="action-btn edit" onClick={onEdit} title="Edit competitor">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
          </button>
          <button className="action-btn delete" onClick={onDelete} title="Delete competitor">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
          </button>
        </div>
      </div>

      {isExpanded && (
        <div className="competitor-row-details">
          {pageCount > 0 ? (
            <div className="pages-list">
              {competitor.pages.map((page) => (
                <div key={page.id} className="page-row">
                  <span className="page-type-badge">{page.type}</span>
                  <a
                    href={page.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="page-url"
                  >
                    {page.url}
                  </a>
                  {page.reason && (
                    <span className="page-reason" title={page.reason}>
                      {page.reason}
                    </span>
                  )}
                  <button
                    className="remove-page-inline-btn"
                    onClick={() => onRemovePage(page.id)}
                    title="Remove page"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="no-pages-message">No pages tracked yet</p>
          )}
        </div>
      )}
    </div>
  );
}
