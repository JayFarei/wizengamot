import React, { useState, useEffect } from 'react';
import './MonitorCompare.css';

/**
 * MonitorCompare shows comparison data for a specific question across competitors.
 */
export default function MonitorCompare({ monitor }) {
  const [selectedQuestion, setSelectedQuestion] = useState('pricing');
  const [comparison, setComparison] = useState([]);
  const [isLoading, setIsLoading] = useState(false);

  const questions = [
    { key: 'icp', label: 'Ideal Customer' },
    { key: 'pricing', label: 'Pricing' },
    { key: 'security', label: 'Security' },
    { key: 'value_props', label: 'Value Props' },
    { key: 'themes', label: 'Themes' },
    { key: 'problem', label: 'Problem' },
  ];

  useEffect(() => {
    if (monitor?.id && selectedQuestion) {
      loadComparison();
    }
  }, [monitor?.id, selectedQuestion]);

  const loadComparison = async () => {
    setIsLoading(true);
    try {
      const response = await fetch(
        `${import.meta.env.DEV ? 'http://localhost:8001' : ''}/api/monitors/${monitor.id}/compare?question=${selectedQuestion}`
      );
      if (response.ok) {
        const data = await response.json();
        setComparison(data);
      }
    } catch (error) {
      console.error('Failed to load comparison:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const getLatestAnswer = (history) => {
    if (!history || history.length === 0) return 'No data';
    return history[history.length - 1]?.answer || 'No data';
  };

  const hasChanged = (history) => {
    if (!history || history.length < 2) return false;
    const first = history[0]?.answer?.toLowerCase().trim();
    const last = history[history.length - 1]?.answer?.toLowerCase().trim();
    return first !== last;
  };

  return (
    <div className="monitor-compare">
      <div className="compare-header">
        <h3>Compare Competitors</h3>
        <div className="question-selector">
          {questions.map((q) => (
            <button
              key={q.key}
              className={`question-btn ${selectedQuestion === q.key ? 'active' : ''}`}
              onClick={() => setSelectedQuestion(q.key)}
            >
              {q.label}
            </button>
          ))}
        </div>
      </div>

      <div className="compare-content">
        {isLoading ? (
          <div className="compare-loading">
            <div className="spinner"></div>
            Loading comparison...
          </div>
        ) : comparison.length === 0 ? (
          <div className="compare-empty">
            <p>No data available. Crawl your competitors to start comparing.</p>
          </div>
        ) : (
          <div className="compare-grid">
            {comparison.map((comp) => (
              <div key={comp.competitor_id} className="compare-card">
                <div className="compare-card-header">
                  <h4>{comp.competitor_name}</h4>
                  {hasChanged(comp.history) && (
                    <span className="changed-badge">Changed</span>
                  )}
                </div>
                <div className="compare-card-content">
                  {getLatestAnswer(comp.history)}
                </div>
                {comp.history?.length > 1 && (
                  <div className="compare-card-history">
                    <span className="history-count">
                      {comp.history.length} snapshots
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
