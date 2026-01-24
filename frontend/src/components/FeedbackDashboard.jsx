import React, { useState, useEffect, useCallback } from 'react';
import { X, RefreshCw, Loader, TrendingUp, AlertTriangle, CheckCircle, Activity, Target, Lightbulb } from 'lucide-react';
import { api } from '../api';

/**
 * FeedbackDashboard - Shows feedback learning analytics and recommendations
 *
 * Features:
 * - Health score indicator
 * - Correction pattern analysis
 * - Confidence calibration metrics
 * - Prompt refinement recommendations
 */
export default function FeedbackDashboard({ onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Load feedback data
  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const feedbackData = await api.getKnowledgeGraphFeedback();
      setData(feedbackData);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Get health score color
  const getHealthColor = (score) => {
    if (score >= 80) return '#22c55e'; // green
    if (score >= 60) return '#f59e0b'; // amber
    return '#ef4444'; // red
  };

  // Get severity color
  const getSeverityColor = (severity) => {
    if (severity === 'high') return '#ef4444';
    if (severity === 'medium') return '#f59e0b';
    return '#3b82f6';
  };

  if (loading) {
    return (
      <div className="feedback-dashboard">
        <div className="feedback-dashboard-header">
          <div className="feedback-dashboard-title">
            <Activity size={18} />
            <span>Feedback Learning</span>
          </div>
          <button className="kg-icon-btn" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="feedback-dashboard-loading">
          <Loader size={32} className="kg-spinner" />
          <p>Loading feedback analytics...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="feedback-dashboard">
        <div className="feedback-dashboard-header">
          <div className="feedback-dashboard-title">
            <Activity size={18} />
            <span>Feedback Learning</span>
          </div>
          <button className="kg-icon-btn" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="feedback-dashboard-error">
          <AlertTriangle size={32} />
          <p>{error}</p>
          <button className="kg-btn kg-btn-primary" onClick={loadData}>
            <RefreshCw size={14} /> Retry
          </button>
        </div>
      </div>
    );
  }

  const {
    health_score,
    total_feedback,
    stats,
    correction_patterns,
    confidence_accuracy,
    agent_accuracy,
    recommendations,
  } = data || {};

  return (
    <div className="feedback-dashboard">
      <div className="feedback-dashboard-header">
        <div className="feedback-dashboard-title">
          <Activity size={18} />
          <span>Feedback Learning</span>
        </div>
        <div className="feedback-dashboard-header-actions">
          <button className="kg-icon-btn" onClick={loadData} title="Refresh">
            <RefreshCw size={18} />
          </button>
          <button className="kg-icon-btn" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
      </div>

      <div className="feedback-dashboard-body">
        {/* Health Score */}
        <div className="feedback-section feedback-health">
          <div className="feedback-health-score">
            <svg viewBox="0 0 100 100" className="feedback-health-circle">
              <circle
                cx="50"
                cy="50"
                r="45"
                fill="none"
                stroke="#e5e7eb"
                strokeWidth="10"
              />
              <circle
                cx="50"
                cy="50"
                r="45"
                fill="none"
                stroke={getHealthColor(health_score || 0)}
                strokeWidth="10"
                strokeLinecap="round"
                strokeDasharray={`${(health_score || 0) * 2.83} 283`}
                transform="rotate(-90 50 50)"
              />
            </svg>
            <div className="feedback-health-value">
              <span className="feedback-health-number">{health_score || 0}</span>
              <span className="feedback-health-label">Health</span>
            </div>
          </div>
          <div className="feedback-health-stats">
            <div className="feedback-stat-item">
              <span className="feedback-stat-value">{total_feedback || 0}</span>
              <span className="feedback-stat-label">Total Feedback</span>
            </div>
            <div className="feedback-stat-item">
              <span className="feedback-stat-value">{stats?.entity_feedback_count || 0}</span>
              <span className="feedback-stat-label">Entity Reviews</span>
            </div>
            <div className="feedback-stat-item">
              <span className="feedback-stat-value">{stats?.relationship_feedback_count || 0}</span>
              <span className="feedback-stat-label">Relationship Reviews</span>
            </div>
          </div>
        </div>

        {/* Recommendations */}
        {recommendations?.recommendations?.length > 0 && (
          <div className="feedback-section">
            <h3>
              <Lightbulb size={16} />
              <span>Recommendations</span>
            </h3>
            <div className="feedback-recommendations">
              {recommendations.recommendations.slice(0, 5).map((rec, idx) => (
                <div key={idx} className="feedback-recommendation" style={{ borderLeftColor: getSeverityColor(rec.severity) }}>
                  <div className="feedback-recommendation-header">
                    <span className={`feedback-severity feedback-severity-${rec.severity}`}>
                      {rec.severity}
                    </span>
                    <span className="feedback-category">{rec.category.replace('_', ' ')}</span>
                  </div>
                  <p className="feedback-recommendation-message">{rec.message}</p>
                  {rec.details && (
                    <p className="feedback-recommendation-details">{rec.details}</p>
                  )}
                  <p className="feedback-recommendation-suggestion">{rec.suggestion}</p>
                </div>
              ))}
            </div>
            {recommendations.summary && (
              <p className="feedback-summary">{recommendations.summary}</p>
            )}
          </div>
        )}

        {/* Confidence Calibration */}
        {confidence_accuracy?.confidence_brackets && (
          <div className="feedback-section">
            <h3>
              <Target size={16} />
              <span>Confidence Calibration</span>
            </h3>
            <div className="feedback-calibration">
              {Object.entries(confidence_accuracy.confidence_brackets)
                .filter(([bracket]) => bracket !== 'unknown')
                .map(([bracket, stats]) => (
                  <div key={bracket} className="feedback-calibration-row">
                    <span className="feedback-calibration-bracket">{bracket}</span>
                    <div className="feedback-calibration-bar-container">
                      <div
                        className="feedback-calibration-bar"
                        style={{
                          width: `${(stats.accuracy || 0) * 100}%`,
                          backgroundColor: stats.accuracy !== null
                            ? (Math.abs(stats.accuracy - parseFloat(bracket.split('-')[0])) < 0.15
                              ? '#22c55e'
                              : '#f59e0b')
                            : '#e5e7eb',
                        }}
                      />
                    </div>
                    <span className="feedback-calibration-accuracy">
                      {stats.accuracy !== null ? `${Math.round(stats.accuracy * 100)}%` : '-'}
                    </span>
                    <span className="feedback-calibration-count">
                      ({stats.total})
                    </span>
                  </div>
                ))}
            </div>
            {confidence_accuracy.interpretation && (
              <p className="feedback-interpretation">{confidence_accuracy.interpretation}</p>
            )}
          </div>
        )}

        {/* Agent Accuracy */}
        {agent_accuracy?.total_decisions > 0 && (
          <div className="feedback-section">
            <h3>
              <CheckCircle size={16} />
              <span>Agent Review Accuracy</span>
            </h3>
            <div className="feedback-agent-stats">
              <div className="feedback-agent-stat">
                <span className="feedback-agent-value">
                  {agent_accuracy.agreement_rate !== null
                    ? `${Math.round(agent_accuracy.agreement_rate * 100)}%`
                    : '-'}
                </span>
                <span className="feedback-agent-label">Agreement Rate</span>
              </div>
              <div className="feedback-agent-stat">
                <span className="feedback-agent-value">{agent_accuracy.total_decisions}</span>
                <span className="feedback-agent-label">Total Decisions</span>
              </div>
            </div>
            {agent_accuracy.interpretation && (
              <p className="feedback-interpretation">{agent_accuracy.interpretation}</p>
            )}
            {Object.keys(agent_accuracy.common_override_reasons || {}).length > 0 && (
              <div className="feedback-override-reasons">
                <h4>Common Override Reasons</h4>
                <ul>
                  {Object.entries(agent_accuracy.common_override_reasons).slice(0, 3).map(([reason, count]) => (
                    <li key={reason}>
                      <span className="feedback-reason">{reason}</span>
                      <span className="feedback-count">{count}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Correction Patterns */}
        {correction_patterns?.total_corrections > 0 && (
          <div className="feedback-section">
            <h3>
              <TrendingUp size={16} />
              <span>Correction Patterns</span>
            </h3>
            <div className="feedback-patterns">
              {Object.entries(correction_patterns.entity_corrections || {})
                .filter(([_, stats]) => stats.total >= 5)
                .slice(0, 3)
                .map(([entityType, stats]) => (
                  <div key={entityType} className="feedback-pattern-card">
                    <div className="feedback-pattern-header">
                      <span className="feedback-pattern-type">{entityType}</span>
                      <span className="feedback-pattern-total">{stats.total} reviews</span>
                    </div>
                    <div className="feedback-pattern-stats">
                      <span className="feedback-pattern-stat feedback-pattern-validated">
                        {stats.validated || 0} validated
                      </span>
                      <span className="feedback-pattern-stat feedback-pattern-corrected">
                        {stats.corrected || 0} corrected
                      </span>
                      <span className="feedback-pattern-stat feedback-pattern-rejected">
                        {stats.rejected || 0} rejected
                      </span>
                    </div>
                    {Object.keys(stats.common_rejections || {}).length > 0 && (
                      <div className="feedback-pattern-rejections">
                        <span className="feedback-pattern-label">Top rejection reasons:</span>
                        {Object.entries(stats.common_rejections).slice(0, 2).map(([reason, count]) => (
                          <span key={reason} className="feedback-pattern-reason">
                            {reason} ({count})
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* Empty state */}
        {total_feedback === 0 && (
          <div className="feedback-empty">
            <Activity size={48} strokeWidth={1} />
            <p>No feedback data yet.</p>
            <p className="feedback-empty-hint">
              Review entities and relationships to build feedback patterns.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
