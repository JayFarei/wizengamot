import { useState, useMemo, useEffect, useCallback } from 'react';
import { Radio, Trash2, Loader2 } from 'lucide-react';
import { formatRelativeTime } from '../utils/formatRelativeTime';
import { api } from '../api';
import './PodcastGallery.css';

// Generation step labels
const GENERATION_STEPS = {
  starting: 'Starting...',
  writing_script: 'Writing script',
  generating_audio: 'Generating audio',
  finalizing: 'Finalizing',
  complete: 'Complete',
};

// Style display names
function getStyleLabel(style) {
  const labels = {
    'rest-is-politics': 'Rest is Politics',
    'all-in': 'All-In Podcast',
    'rest-is-history': 'Rest is History',
  };
  return labels[style] || style?.replace(/-/g, ' ') || 'Podcast';
}

// Date grouping helper
function groupByDate(items) {
  const groups = {};
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const thisWeekStart = new Date(today);
  thisWeekStart.setDate(today.getDate() - today.getDay());
  const lastWeekStart = new Date(thisWeekStart);
  lastWeekStart.setDate(lastWeekStart.getDate() - 7);

  items.forEach(item => {
    const date = new Date(item.created_at);
    const itemDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    let groupKey;

    if (itemDate >= today) {
      groupKey = 'Today';
    } else if (itemDate >= thisWeekStart) {
      groupKey = 'This Week';
    } else if (itemDate >= lastWeekStart) {
      groupKey = 'Last Week';
    } else {
      const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'];
      groupKey = `${monthNames[date.getMonth()]} ${date.getFullYear()}`;
    }

    if (!groups[groupKey]) groups[groupKey] = [];
    groups[groupKey].push(item);
  });

  // Sort groups in chronological order (most recent first)
  const orderedKeys = ['Today', 'This Week', 'Last Week'];
  const monthGroups = Object.keys(groups)
    .filter(k => !orderedKeys.includes(k))
    .sort((a, b) => {
      const [monthA, yearA] = a.split(' ');
      const [monthB, yearB] = b.split(' ');
      if (yearA !== yearB) return parseInt(yearB) - parseInt(yearA);
      const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'];
      return monthNames.indexOf(monthB) - monthNames.indexOf(monthA);
    });

  const sortedGroups = {};
  [...orderedKeys, ...monthGroups].forEach(key => {
    if (groups[key]) sortedGroups[key] = groups[key];
  });

  return sortedGroups;
}

export default function PodcastGallery({
  podcasts,
  onSelectPodcast,
  onClose,
  onNewPodcast,
  onDeletePodcast,
  onRefresh,
}) {
  const [viewMode, setViewMode] = useState('grid');
  const [sortBy, setSortBy] = useState('date');
  const [generatingProgress, setGeneratingProgress] = useState({});

  // Poll for generating podcasts progress
  const generatingPodcasts = useMemo(
    () => podcasts.filter(p => p.status === 'generating'),
    [podcasts]
  );

  useEffect(() => {
    if (generatingPodcasts.length === 0) return;

    const pollProgress = async () => {
      const updates = {};
      for (const podcast of generatingPodcasts) {
        try {
          const session = await api.getPodcastSession(podcast.id);
          updates[podcast.id] = {
            step: session.generation_step || 'starting',
            progress: session.generation_progress || 0,
          };
          // If status changed to ready/ended, trigger refresh
          if (session.status === 'ready' || session.status === 'ended') {
            onRefresh?.();
          }
        } catch (err) {
          console.debug('Failed to poll podcast status:', err);
        }
      }
      setGeneratingProgress(prev => ({ ...prev, ...updates }));
    };

    pollProgress();
    const interval = setInterval(pollProgress, 2000);
    return () => clearInterval(interval);
  }, [generatingPodcasts, onRefresh]);

  // Sort items
  const sortedItems = useMemo(() => {
    const sorted = [...podcasts];
    switch (sortBy) {
      case 'date':
        sorted.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        break;
      case 'title':
        sorted.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
        break;
      case 'style':
        sorted.sort((a, b) => (a.style || '').localeCompare(b.style || ''));
        break;
      default:
        break;
    }
    return sorted;
  }, [podcasts, sortBy]);

  // Group items by date
  const groupedItems = useMemo(() => groupByDate(sortedItems), [sortedItems]);

  const handleCardClick = (podcast) => {
    onSelectPodcast(podcast.id);
  };

  const handleDelete = (e, podcastId) => {
    e.stopPropagation();
    if (window.confirm('Delete this podcast? This cannot be undone.')) {
      onDeletePodcast?.(podcastId);
    }
  };

  const renderCard = (podcast) => {
    const isLive = podcast.status === 'active';
    const isGenerating = podcast.status === 'generating';
    const progress = generatingProgress[podcast.id];
    const stepLabel = progress?.step ? GENERATION_STEPS[progress.step] || progress.step : 'Starting...';

    return (
      <div
        key={podcast.id}
        className={`podcast-gallery-card ${isLive ? 'live' : ''} ${isGenerating ? 'generating' : ''}`}
        onClick={() => !isGenerating && handleCardClick(podcast)}
      >
        {/* Cover Art Thumbnail */}
        <div className="podcast-gallery-card-cover">
          {podcast.cover_url ? (
            <img
              src={`${api.getBaseUrl()}${podcast.cover_url}`}
              alt={podcast.title || 'Podcast cover'}
              className="podcast-gallery-cover-image"
            />
          ) : (
            <div className="podcast-gallery-cover-placeholder">
              <Radio size={24} />
            </div>
          )}
          {isLive && <span className="podcast-gallery-live-badge">Live</span>}
          {isGenerating && (
            <div className="podcast-gallery-generating-overlay">
              <Loader2 className="spin" size={24} />
              <span className="generating-step">{stepLabel}</span>
              {progress?.progress > 0 && (
                <div className="generating-progress-bar">
                  <div
                    className="generating-progress-fill"
                    style={{ width: `${progress.progress}%` }}
                  />
                </div>
              )}
            </div>
          )}
          {onDeletePodcast && !isLive && !isGenerating && (
            <button
              className="podcast-gallery-delete-btn"
              onClick={(e) => handleDelete(e, podcast.id)}
              title="Delete podcast"
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>

        <div className="podcast-gallery-card-info">
          <div className="podcast-gallery-card-title">
            {podcast.title || (isGenerating ? 'Generating...' : 'Podcast')}
          </div>
          {podcast.summary && !isGenerating && (
            <div className="podcast-gallery-card-summary">
              {podcast.summary.length > 100
                ? podcast.summary.substring(0, 100) + '...'
                : podcast.summary}
            </div>
          )}
          <div className="podcast-gallery-card-meta">
            {isGenerating ? (
              <span className="podcast-gallery-badge generating">
                Generating
              </span>
            ) : (
              <span className="podcast-gallery-badge style">
                {getStyleLabel(podcast.style)}
              </span>
            )}
            <span className="podcast-gallery-card-date">
              {formatRelativeTime(podcast.created_at)}
            </span>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="podcast-gallery">
      <header className="podcast-gallery-header">
        <button className="podcast-gallery-back-btn" onClick={onClose} title="Back">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <h2>Podcasts</h2>
        <span className="podcast-gallery-count">{podcasts.length} episodes</span>
        <div className="podcast-gallery-view-options">
          <button
            className={`podcast-gallery-view-btn ${viewMode === 'grid' ? 'active' : ''}`}
            onClick={() => setViewMode('grid')}
            title="Grid view"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="7" height="7" rx="1" />
              <rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" />
              <rect x="14" y="14" width="7" height="7" rx="1" />
            </svg>
          </button>
          <button
            className={`podcast-gallery-view-btn ${viewMode === 'list' ? 'active' : ''}`}
            onClick={() => setViewMode('list')}
            title="List view"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
          <select
            className="podcast-gallery-sort-select"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
          >
            <option value="date">Date</option>
            <option value="title">Title</option>
            <option value="style">Style</option>
          </select>
        </div>
      </header>

      <div className="podcast-gallery-content">
        {/* Empty state */}
        {podcasts.length === 0 && (
          <div className="podcast-gallery-empty">
            <Radio size={48} />
            <h3>No podcasts yet</h3>
            <p>Create your first podcast from any Synthesizer conversation</p>
            <button className="podcast-gallery-create-btn" onClick={onNewPodcast}>
              Create Podcast
            </button>
          </div>
        )}

        {podcasts.length > 0 && (
          viewMode === 'list' ? (
            <table className="podcast-gallery-table">
              <thead>
                <tr>
                  <th className="table-col-name">Name</th>
                  <th className="table-col-style">Style</th>
                  <th className="table-col-status">Status</th>
                  <th className="table-col-date">Date</th>
                  {onDeletePodcast && <th className="table-col-actions"></th>}
                </tr>
              </thead>
              <tbody>
                {Object.entries(groupedItems).map(([groupName, groupItems]) => (
                  <>
                    <tr key={`group-${groupName}`} className="table-group-header">
                      <td colSpan={onDeletePodcast ? 5 : 4}>{groupName}</td>
                    </tr>
                    {groupItems.map(podcast => {
                      const isLive = podcast.status === 'active';
                      const isGenerating = podcast.status === 'generating';
                      const progress = generatingProgress[podcast.id];
                      const stepLabel = progress?.step ? GENERATION_STEPS[progress.step] || progress.step : 'Starting...';
                      return (
                        <tr
                          key={podcast.id}
                          className={`table-row ${isLive ? 'live' : ''} ${isGenerating ? 'generating' : ''}`}
                          onClick={() => !isGenerating && handleCardClick(podcast)}
                        >
                          <td className="table-cell-name">
                            <div className="table-cell-content">
                              {isLive && <span className="podcast-live-indicator small" />}
                              {isGenerating && <Loader2 className="spin table-generating-icon" size={14} />}
                              <div className="table-title">{podcast.title || (isGenerating ? 'Generating...' : 'Podcast')}</div>
                              {podcast.source_title && !isGenerating && (
                                <div className="table-preview">{podcast.source_title}</div>
                              )}
                            </div>
                          </td>
                          <td className="table-cell-style">
                            <span className="table-tag style">
                              {getStyleLabel(podcast.style)}
                            </span>
                          </td>
                          <td className="table-cell-status">
                            {isLive ? (
                              <span className="table-tag live">Live</span>
                            ) : isGenerating ? (
                              <span className="table-tag generating">{stepLabel}</span>
                            ) : podcast.status === 'ended' ? (
                              <span className="table-tag completed">Completed</span>
                            ) : (
                              <span className="table-tag">-</span>
                            )}
                          </td>
                          <td className="table-cell-date">
                            {formatRelativeTime(podcast.created_at)}
                          </td>
                          {onDeletePodcast && (
                            <td className="table-cell-actions">
                              {!isLive && !isGenerating && (
                                <button
                                  className="podcast-gallery-delete-btn table"
                                  onClick={(e) => handleDelete(e, podcast.id)}
                                  title="Delete podcast"
                                >
                                  <Trash2 size={14} />
                                </button>
                              )}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </>
                ))}
              </tbody>
            </table>
          ) : (
            <>
              {Object.entries(groupedItems).map(([groupName, groupItems]) => (
                <div key={groupName} className="podcast-gallery-date-group">
                  <div className="podcast-gallery-date-header">{groupName}</div>
                  <div className="podcast-gallery-grid">
                    {groupItems.map(podcast => renderCard(podcast))}
                  </div>
                </div>
              ))}

              {/* Add new button */}
              <div className="podcast-gallery-date-group">
                <div className="podcast-gallery-grid">
                  <div
                    className="podcast-gallery-card podcast-gallery-card-add"
                    onClick={onNewPodcast}
                  >
                    <div className="podcast-gallery-add-icon">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="12" y1="5" x2="12" y2="19" />
                        <line x1="5" y1="12" x2="19" y2="12" />
                      </svg>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )
        )}
      </div>
    </div>
  );
}
