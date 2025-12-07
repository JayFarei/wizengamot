import React, { useState, useEffect } from 'react';
import { api } from '../api';
import './MonitorTimeline.css';

/**
 * MonitorTimeline shows a scrollable timeline of updates.
 * Supports filtering by competitor, tags, and time range.
 */
export default function MonitorTimeline({ monitor, onSelectUpdate }) {
  const [updates, setUpdates] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filters, setFilters] = useState({
    competitorId: '',
    tags: '',
    since: '',
  });

  useEffect(() => {
    if (monitor?.id) {
      loadUpdates();
    }
  }, [monitor?.id, filters]);

  const loadUpdates = async () => {
    setIsLoading(true);
    try {
      // Build query params
      const params = new URLSearchParams();
      if (filters.competitorId) params.append('competitor_id', filters.competitorId);
      if (filters.tags) params.append('tags', filters.tags);
      if (filters.since) params.append('since', filters.since);
      params.append('limit', '100');

      const response = await fetch(
        `${import.meta.env.DEV ? 'http://localhost:8001' : ''}/api/monitors/${monitor.id}/updates?${params}`
      );
      if (response.ok) {
        const data = await response.json();
        setUpdates(data);
      }
    } catch (error) {
      console.error('Failed to load updates:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const formatTimestamp = (timestamp) => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const getTagColor = (tag) => {
    const colors = {
      pricing: '#ef4444',
      security: '#8b5cf6',
      icp: '#3b82f6',
      high_impact: '#f59e0b',
      value_props: '#10b981',
      themes: '#6366f1',
      problem: '#ec4899',
    };
    return colors[tag] || '#6b7280';
  };

  return (
    <div className="monitor-timeline">
      <div className="timeline-header">
        <h3>Update Timeline</h3>
        <div className="timeline-filters">
          <select
            value={filters.competitorId}
            onChange={(e) => setFilters({ ...filters, competitorId: e.target.value })}
          >
            <option value="">All Competitors</option>
            {monitor?.competitors?.map((comp) => (
              <option key={comp.id} value={comp.id}>
                {comp.name}
              </option>
            ))}
          </select>

          <select
            value={filters.since}
            onChange={(e) => setFilters({ ...filters, since: e.target.value })}
          >
            <option value="">All Time</option>
            <option value={new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()}>
              Last 7 Days
            </option>
            <option value={new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()}>
              Last 30 Days
            </option>
          </select>
        </div>
      </div>

      <div className="timeline-content">
        {isLoading ? (
          <div className="timeline-loading">
            <div className="spinner"></div>
            Loading updates...
          </div>
        ) : updates.length === 0 ? (
          <div className="timeline-empty">
            <p>No updates yet. Run a crawl to start tracking changes.</p>
          </div>
        ) : (
          <div className="timeline-list">
            {updates.map((update) => (
              <div
                key={update.snapshot_id}
                className="timeline-item"
                onClick={() => onSelectUpdate && onSelectUpdate(update)}
              >
                <div className="timeline-marker"></div>
                <div className="timeline-card">
                  <div className="timeline-meta">
                    <span className="timeline-time">{formatTimestamp(update.timestamp)}</span>
                    <span className="timeline-competitor">{update.competitor_name}</span>
                    <span className="timeline-page">{update.page_type}</span>
                  </div>
                  <div className="timeline-summary">{update.summary}</div>
                  {update.impact_tags?.length > 0 && (
                    <div className="timeline-tags">
                      {update.impact_tags.map((tag) => (
                        <span
                          key={tag}
                          className="impact-tag"
                          style={{ backgroundColor: getTagColor(tag) + '20', color: getTagColor(tag) }}
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
