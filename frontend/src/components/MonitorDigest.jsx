import React, { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { api } from '../api';
import './MonitorDigest.css';

/**
 * MonitorDigest displays weekly/monthly digest summaries.
 * Shows list of past digests with ability to generate new ones.
 */
export default function MonitorDigest({ monitor }) {
  const [digests, setDigests] = useState([]);
  const [selectedDigest, setSelectedDigest] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatePeriod, setGeneratePeriod] = useState('weekly');

  useEffect(() => {
    if (monitor?.id) {
      loadDigests();
    }
  }, [monitor?.id]);

  const loadDigests = async () => {
    setIsLoading(true);
    try {
      const data = await api.listDigests(monitor.id);
      setDigests(data);
      // Auto-select the first digest if available
      if (data.length > 0 && !selectedDigest) {
        loadDigestDetail(data[0].id);
      }
    } catch (error) {
      console.error('Failed to load digests:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const loadDigestDetail = async (digestId) => {
    try {
      const data = await api.getDigest(monitor.id, digestId);
      setSelectedDigest(data);
    } catch (error) {
      console.error('Failed to load digest detail:', error);
    }
  };

  const handleGenerate = async () => {
    setIsGenerating(true);
    try {
      const newDigest = await api.generateDigest(monitor.id, generatePeriod);
      setSelectedDigest(newDigest);
      // Refresh the list
      await loadDigests();
    } catch (error) {
      console.error('Failed to generate digest:', error);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopyToClipboard = () => {
    if (selectedDigest?.markdown) {
      navigator.clipboard.writeText(selectedDigest.markdown);
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  if (isLoading) {
    return (
      <div className="monitor-digest">
        <div className="digest-loading">
          <div className="spinner"></div>
          Loading digests...
        </div>
      </div>
    );
  }

  return (
    <div className="monitor-digest">
      <div className="digest-header">
        <h3>Competitive Intelligence Digests</h3>
        <div className="digest-actions">
          <select
            value={generatePeriod}
            onChange={(e) => setGeneratePeriod(e.target.value)}
            className="period-select"
          >
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
          <button
            className="generate-btn"
            onClick={handleGenerate}
            disabled={isGenerating}
          >
            {isGenerating ? (
              <>
                <span className="spinner-small"></span>
                Generating...
              </>
            ) : (
              <>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="12" y1="18" x2="12" y2="12" />
                  <line x1="9" y1="15" x2="15" y2="15" />
                </svg>
                Generate Digest
              </>
            )}
          </button>
        </div>
      </div>

      <div className="digest-content">
        <div className="digest-sidebar">
          <h4>Past Digests</h4>
          {digests.length === 0 ? (
            <div className="no-digests">
              <p>No digests yet. Generate your first one!</p>
            </div>
          ) : (
            <div className="digest-list">
              {digests.map((digest) => (
                <button
                  key={digest.id}
                  className={`digest-item ${selectedDigest?.id === digest.id ? 'active' : ''}`}
                  onClick={() => loadDigestDetail(digest.id)}
                >
                  <div className="digest-item-header">
                    <span className="digest-period">{digest.period}</span>
                    <span className="digest-updates">{digest.stats?.total_updates || 0} updates</span>
                  </div>
                  <div className="digest-item-dates">
                    {formatDate(digest.start_date)} - {formatDate(digest.end_date)}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="digest-main">
          {selectedDigest ? (
            <>
              <div className="digest-toolbar">
                <div className="digest-stats">
                  <span className="stat">
                    <strong>{selectedDigest.stats?.total_updates || 0}</strong> updates
                  </span>
                  <span className="stat">
                    <strong>{selectedDigest.stats?.competitors_changed || 0}</strong> competitors
                  </span>
                </div>
                <button className="copy-btn" onClick={handleCopyToClipboard} title="Copy to clipboard">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                  Copy
                </button>
              </div>
              <div className="digest-markdown markdown-content">
                <ReactMarkdown>{selectedDigest.markdown}</ReactMarkdown>
              </div>
            </>
          ) : (
            <div className="digest-empty">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
                <polyline points="10 9 9 9 8 9" />
              </svg>
              <p>Select a digest to view or generate a new one</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
