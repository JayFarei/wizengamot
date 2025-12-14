import { useState, useEffect } from 'react';
import { api } from '../../api';
import './UsageStatsPanel.css';

export default function UsageStatsPanel() {
  const [stats, setStats] = useState(null);
  const [credits, setCredits] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    setLoading(true);
    setError(null);
    try {
      const [usageData, creditsData] = await Promise.all([
        api.getUsageStats(),
        api.getCredits().catch(() => null),
      ]);
      setStats(usageData);
      setCredits(creditsData);
    } catch (err) {
      setError('Failed to load usage statistics');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (value) => {
    if (value === null || value === undefined) return '$0.00';
    return `$${value.toFixed(2)}`;
  };

  const getModeIcon = (mode) => {
    switch (mode) {
      case 'council':
        return '👥';
      case 'synthesizer':
        return '📝';
      case 'monitor':
        return '🎯';
      case 'visualiser':
        return '🖼️';
      default:
        return '📊';
    }
  };

  if (loading) {
    return (
      <div className="usage-stats-panel">
        <div className="usage-stats-loading">Loading usage statistics...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="usage-stats-panel">
        <div className="usage-stats-error">{error}</div>
        <button className="btn-secondary btn-small" onClick={loadStats}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="usage-stats-panel">
      <div className="usage-stats-header">
        <h4>Usage & Spending</h4>
        <button className="btn-small btn-secondary" onClick={loadStats}>
          Refresh
        </button>
      </div>

      <div className="usage-stats-grid">
        {credits && credits.remaining !== null && (
          <div className="usage-stat-card credits">
            <div className="stat-label">Credits Remaining</div>
            <div className="stat-value">{formatCurrency(credits.remaining)}</div>
            {credits.is_free_tier && (
              <div className="stat-note">Free tier</div>
            )}
          </div>
        )}

        <div className="usage-stat-card total">
          <div className="stat-label">Total Spent</div>
          <div className="stat-value">{formatCurrency(stats?.total_spent)}</div>
          <div className="stat-note">{stats?.conversation_count || 0} conversations</div>
        </div>
      </div>

      {stats?.by_mode && Object.keys(stats.by_mode).length > 0 && (
        <div className="usage-by-mode">
          <h5>Spending by Mode</h5>
          <div className="mode-breakdown">
            {Object.entries(stats.by_mode).map(([mode, amount]) => (
              <div key={mode} className="mode-item">
                <span className="mode-icon">{getModeIcon(mode)}</span>
                <span className="mode-name">{mode}</span>
                <span className="mode-amount">{formatCurrency(amount)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {stats?.top_conversations && stats.top_conversations.length > 0 && (
        <div className="top-conversations">
          <h5>Top Conversations by Cost</h5>
          <div className="top-list">
            {stats.top_conversations.slice(0, 5).map((conv, index) => (
              <div key={conv.id} className="top-item">
                <span className="top-rank">#{index + 1}</span>
                <span className="top-title" title={conv.title}>
                  {conv.title || 'Untitled'}
                </span>
                <span className="top-cost">{formatCurrency(conv.total_cost)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
