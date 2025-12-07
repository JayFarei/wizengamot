import React, { useState, useEffect } from 'react';
import { api } from '../api';
import './MonitorUpdateDetail.css';

/**
 * MonitorUpdateDetail shows expanded details for a snapshot update.
 * Includes before/after screenshots, text diff, and answer changes.
 */
export default function MonitorUpdateDetail({ monitor, snapshotId, onClose }) {
  const [detail, setDetail] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (monitor?.id && snapshotId) {
      loadDetail();
    }
  }, [monitor?.id, snapshotId]);

  const loadDetail = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.getSnapshotDetail(monitor.id, snapshotId);
      setDetail(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const formatTimestamp = (timestamp) => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
  };

  const getCompetitorName = (competitorId) => {
    const comp = monitor?.competitors?.find(c => c.id === competitorId);
    return comp?.name || competitorId;
  };

  const getPageType = (competitorId, pageId) => {
    const comp = monitor?.competitors?.find(c => c.id === competitorId);
    const page = comp?.pages?.find(p => p.id === pageId);
    return page?.type || pageId;
  };

  if (isLoading) {
    return (
      <div className="update-detail-modal">
        <div className="update-detail-content">
          <div className="update-detail-loading">
            <div className="spinner"></div>
            Loading details...
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="update-detail-modal">
        <div className="update-detail-content">
          <div className="update-detail-error">
            <p>Error: {error}</p>
            <button onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    );
  }

  if (!detail?.current) {
    return null;
  }

  const { current, previous } = detail;
  const currentScreenshotUrl = api.getScreenshotUrl(monitor.id, current.screenshot_path);
  const previousScreenshotUrl = previous ? api.getScreenshotUrl(monitor.id, previous.screenshot_path) : null;

  return (
    <div className="update-detail-modal" onClick={onClose}>
      <div className="update-detail-content" onClick={e => e.stopPropagation()}>
        <div className="update-detail-header">
          <div className="update-detail-title">
            <h2>{getCompetitorName(current.competitor_id)}</h2>
            <span className="update-detail-page">{getPageType(current.competitor_id, current.page_id)}</span>
          </div>
          <button className="update-detail-close" onClick={onClose}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="update-detail-meta">
          <span className="update-detail-time">{formatTimestamp(current.timestamp)}</span>
          {current.content_changed && (
            <span className="update-detail-changed">Content Changed</span>
          )}
          {current.impact_tags?.length > 0 && (
            <div className="update-detail-tags">
              {current.impact_tags.map(tag => (
                <span key={tag} className="impact-tag">{tag}</span>
              ))}
            </div>
          )}
        </div>

        {current.summary && (
          <div className="update-detail-summary">
            <h3>Summary</h3>
            <p>{current.summary}</p>
          </div>
        )}

        {(currentScreenshotUrl || previousScreenshotUrl) && (
          <div className="update-detail-screenshots">
            <h3>Visual Comparison</h3>
            <div className="screenshots-grid">
              {previousScreenshotUrl && (
                <div className="screenshot-panel">
                  <h4>Before</h4>
                  <div className="screenshot-wrapper">
                    <img src={previousScreenshotUrl} alt="Before" />
                  </div>
                  <span className="screenshot-date">{formatTimestamp(previous?.timestamp)}</span>
                </div>
              )}
              {currentScreenshotUrl && (
                <div className="screenshot-panel">
                  <h4>{previousScreenshotUrl ? 'After' : 'Current'}</h4>
                  <div className="screenshot-wrapper">
                    <img src={currentScreenshotUrl} alt="Current" />
                  </div>
                  <span className="screenshot-date">{formatTimestamp(current.timestamp)}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {current.diff && Object.keys(current.diff).length > 0 && (
          <div className="update-detail-diff">
            <h3>What Changed</h3>
            <div className="diff-list">
              {Object.entries(current.diff).map(([key, diff]) => (
                <div key={key} className="diff-item">
                  <div className="diff-label">{key.replace(/_/g, ' ')}</div>
                  {diff.before && (
                    <div className="diff-before">
                      <span className="diff-prefix">-</span>
                      {diff.before}
                    </div>
                  )}
                  {diff.after && (
                    <div className="diff-after">
                      <span className="diff-prefix">+</span>
                      {diff.after}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {current.answers && (
          <div className="update-detail-answers">
            <h3>Extracted Information</h3>
            <div className="answers-grid">
              {Object.entries(current.answers).map(([key, value]) => (
                <div key={key} className="answer-item">
                  <div className="answer-label">{key.replace(/_/g, ' ')}</div>
                  <div className="answer-value">{value}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="update-detail-footer">
          <a href={current.url} target="_blank" rel="noopener noreferrer" className="view-page-link">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
            View Live Page
          </a>
        </div>
      </div>
    </div>
  );
}
