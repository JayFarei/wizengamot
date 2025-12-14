import { useState, useEffect } from 'react';
import { api } from '../../../api';
import './UsageSection.css';

const MODE_COLORS = {
  council: '#4a90e2',
  synthesizer: '#5cb85c',
  monitor: '#f0ad4e',
  visualiser: '#9b59b6',
};

const MODE_LABELS = {
  council: 'Council',
  synthesizer: 'Synthesizer',
  monitor: 'Monitor',
  visualiser: 'Visualiser',
};

export default function UsageSection() {
  const [stats, setStats] = useState(null);
  const [credits, setCredits] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [hoveredBar, setHoveredBar] = useState(null);

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

  const formatDate = (dateStr) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  // Calculate this month's spending from daily_spending
  const getThisMonthSpending = () => {
    if (!stats?.daily_spending) return 0;
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    return stats.daily_spending
      .filter((day) => {
        const date = new Date(day.date);
        return date.getMonth() === currentMonth && date.getFullYear() === currentYear;
      })
      .reduce((sum, day) => sum + day.total, 0);
  };

  // Get max daily total for scaling histogram
  const getMaxDailyTotal = () => {
    if (!stats?.daily_spending) return 1;
    const max = Math.max(...stats.daily_spending.map((d) => d.total));
    return max > 0 ? max : 1;
  };

  if (loading) {
    return (
      <div className="settings-section usage-section">
        <div className="usage-loading">Loading usage statistics...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="settings-section usage-section">
        <div className="usage-error">{error}</div>
        <button className="btn-secondary btn-small" onClick={loadStats}>
          Retry
        </button>
      </div>
    );
  }

  const maxDailyTotal = getMaxDailyTotal();
  const thisMonthSpending = getThisMonthSpending();

  return (
    <div className="settings-section usage-section">
      {/* Header */}
      <div className="usage-header">
        <h3>Usage & Spending</h3>
        <button className="btn-small btn-secondary" onClick={loadStats}>
          Refresh
        </button>
      </div>

      {/* Summary Cards */}
      <div className="usage-summary-cards">
        {credits && credits.remaining !== null && (
          <div className="usage-card credits">
            <div className="usage-card-label">Credits</div>
            <div className="usage-card-value">{formatCurrency(credits.remaining)}</div>
            {credits.is_free_tier && <div className="usage-card-note">Free tier</div>}
          </div>
        )}
        <div className="usage-card total">
          <div className="usage-card-label">Total Spent</div>
          <div className="usage-card-value">{formatCurrency(stats?.total_spent)}</div>
        </div>
        <div className="usage-card conversations">
          <div className="usage-card-label">Conversations</div>
          <div className="usage-card-value">{stats?.conversation_count || 0}</div>
        </div>
        <div className="usage-card month">
          <div className="usage-card-label">This Month</div>
          <div className="usage-card-value">{formatCurrency(thisMonthSpending)}</div>
        </div>
      </div>

      {/* Spending Histogram */}
      {stats?.daily_spending && stats.daily_spending.length > 0 && (
        <div className="usage-histogram-section">
          <h4>Daily Spending (Last 30 Days)</h4>
          <div className="histogram-legend">
            {Object.entries(MODE_LABELS).map(([mode, label]) => (
              <div key={mode} className="legend-item">
                <span className="legend-color" style={{ backgroundColor: MODE_COLORS[mode] }} />
                <span className="legend-label">{label}</span>
              </div>
            ))}
          </div>
          <div className="histogram-container">
            <div className="histogram">
              {stats.daily_spending.map((day, index) => (
                <div
                  key={day.date}
                  className={`histogram-bar-wrapper ${hoveredBar === index ? 'hovered' : ''}`}
                  onMouseEnter={() => setHoveredBar(index)}
                  onMouseLeave={() => setHoveredBar(null)}
                >
                  <div className="histogram-bar">
                    {['visualiser', 'monitor', 'synthesizer', 'council'].map((mode) => {
                      const modeAmount = day.by_mode[mode] || 0;
                      const heightPercent = (modeAmount / maxDailyTotal) * 100;
                      if (heightPercent === 0) return null;
                      return (
                        <div
                          key={mode}
                          className={`histogram-segment ${mode}`}
                          style={{
                            height: `${heightPercent}%`,
                            backgroundColor: MODE_COLORS[mode],
                          }}
                        />
                      );
                    })}
                  </div>
                  {hoveredBar === index && (
                    <div className="histogram-tooltip">
                      <div className="tooltip-date">{formatDate(day.date)}</div>
                      <div className="tooltip-total">{formatCurrency(day.total)}</div>
                      {day.total > 0 && (
                        <div className="tooltip-breakdown">
                          {Object.entries(day.by_mode)
                            .filter(([, v]) => v > 0)
                            .map(([mode, amount]) => (
                              <div key={mode} className="tooltip-mode">
                                <span
                                  className="tooltip-mode-dot"
                                  style={{ backgroundColor: MODE_COLORS[mode] }}
                                />
                                {MODE_LABELS[mode]}: {formatCurrency(amount)}
                              </div>
                            ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="histogram-axis">
              <span>{formatDate(stats.daily_spending[0]?.date)}</span>
              <span>Today</span>
            </div>
          </div>
        </div>
      )}

      {/* Spending by Mode */}
      {stats?.by_mode && Object.keys(stats.by_mode).length > 0 && (
        <div className="usage-by-mode-section">
          <h4>Spending by Mode</h4>
          <div className="mode-bars">
            {Object.entries(stats.by_mode).map(([mode, amount]) => {
              const percentage = stats.total_spent > 0 ? (amount / stats.total_spent) * 100 : 0;
              return (
                <div key={mode} className="mode-bar-row">
                  <div className="mode-bar-label">
                    <span className="mode-bar-name">{MODE_LABELS[mode]}</span>
                    <span className="mode-bar-amount">{formatCurrency(amount)}</span>
                  </div>
                  <div className="mode-bar-track">
                    <div
                      className="mode-bar-fill"
                      style={{
                        width: `${percentage}%`,
                        backgroundColor: MODE_COLORS[mode],
                      }}
                    />
                  </div>
                  <span className="mode-bar-percent">{percentage.toFixed(0)}%</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Top Conversations */}
      {stats?.top_conversations && stats.top_conversations.length > 0 && (
        <div className="usage-top-conversations">
          <h4>Top Conversations by Cost</h4>
          <div className="top-list">
            {stats.top_conversations.slice(0, 5).map((conv, index) => (
              <div key={conv.id} className="top-item">
                <span className="top-rank">#{index + 1}</span>
                <div className="top-info">
                  <span className="top-title" title={conv.title}>
                    {conv.title || 'Untitled'}
                  </span>
                  <span className="top-meta">
                    <span
                      className="top-mode-badge"
                      style={{ backgroundColor: MODE_COLORS[conv.mode] }}
                    >
                      {MODE_LABELS[conv.mode]}
                    </span>
                    {conv.created_at && (
                      <span className="top-date">{formatDate(conv.created_at)}</span>
                    )}
                  </span>
                </div>
                <span className="top-cost">{formatCurrency(conv.cost)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
