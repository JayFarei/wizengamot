import React, { useState, useEffect, useCallback } from 'react';
import { X, RefreshCw, Loader, CheckCircle, XCircle, Edit3, PlusCircle, BarChart3, ClipboardCheck, Link2, AlertCircle, Database } from 'lucide-react';
import { api } from '../api';

/**
 * KnowledgeGraphQuality - Dashboard showing overall knowledge graph health
 *
 * Features:
 * - Entity validation stats (validated/extracted/corrected/rejected/manual)
 * - Relationship validation stats
 * - Review backlog with one-click access to review modes
 * - Entity and relationship type breakdowns
 */
export default function KnowledgeGraphQuality({
  onClose,
  onStartEntityReview,
  onStartRelationshipReview,
  embedded = false,
}) {
  const [metrics, setMetrics] = useState(null);
  const [provenance, setProvenance] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Load quality metrics
  const loadMetrics = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [qualityData, provenanceData] = await Promise.all([
        api.getKnowledgeGraphQuality(),
        api.getProvenanceStats().catch(() => null),
      ]);
      setMetrics(qualityData);
      setProvenance(provenanceData);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMetrics();
  }, [loadMetrics]);

  // Calculate percentages
  const getPercentage = (part, total) => {
    if (!total) return 0;
    return Math.round((part / total) * 100);
  };

  // Format type name for display
  const formatTypeName = (type) => {
    return type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  };

  if (loading) {
    return (
      <div className={`kg-quality-panel ${embedded ? 'kg-quality-panel-embedded' : ''}`}>
        {!embedded && (
          <div className="kg-quality-header">
            <div className="kg-quality-title">
              <BarChart3 size={18} />
              <span>Quality Dashboard</span>
            </div>
            <button className="kg-icon-btn" onClick={onClose}>
              <X size={18} />
            </button>
          </div>
        )}
        <div className="kg-quality-loading">
          <Loader size={32} className="kg-spinner" />
          <p>Loading quality metrics...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`kg-quality-panel ${embedded ? 'kg-quality-panel-embedded' : ''}`}>
        {!embedded && (
          <div className="kg-quality-header">
            <div className="kg-quality-title">
              <BarChart3 size={18} />
              <span>Quality Dashboard</span>
            </div>
            <button className="kg-icon-btn" onClick={onClose}>
              <X size={18} />
            </button>
          </div>
        )}
        <div className="kg-quality-error">
          <AlertCircle size={32} />
          <p>{error}</p>
          <button className="kg-btn kg-btn-primary" onClick={loadMetrics}>
            <RefreshCw size={14} /> Retry
          </button>
        </div>
      </div>
    );
  }

  const { entities, relationships, review_backlog, entity_types, relationship_types } = metrics || {};

  return (
    <div className={`kg-quality-panel ${embedded ? 'kg-quality-panel-embedded' : ''}`}>
      {!embedded && (
        <div className="kg-quality-header">
          <div className="kg-quality-title">
            <BarChart3 size={18} />
            <span>Quality Dashboard</span>
          </div>
          <div className="kg-quality-header-actions">
            <button className="kg-icon-btn" onClick={loadMetrics} title="Refresh">
              <RefreshCw size={18} />
            </button>
            <button className="kg-icon-btn" onClick={onClose}>
              <X size={18} />
            </button>
          </div>
        </div>
      )}

      <div className="kg-quality-body">
        {/* Review Backlog - Call to Action */}
        {review_backlog && (review_backlog.unvalidated_entities > 0 || review_backlog.unvalidated_relationships > 0) && (
          <div className="kg-quality-section kg-quality-backlog">
            <h3>Review Backlog</h3>
            <div className="kg-quality-backlog-items">
              {review_backlog.unvalidated_entities > 0 && (
                <button
                  className="kg-quality-backlog-item"
                  onClick={onStartEntityReview}
                >
                  <div className="kg-quality-backlog-count">
                    {review_backlog.unvalidated_entities}
                  </div>
                  <div className="kg-quality-backlog-label">
                    <ClipboardCheck size={16} />
                    <span>Entities pending review</span>
                  </div>
                  <span className="kg-quality-backlog-action">Review</span>
                </button>
              )}
              {review_backlog.unvalidated_relationships > 0 && (
                <button
                  className="kg-quality-backlog-item"
                  onClick={onStartRelationshipReview}
                >
                  <div className="kg-quality-backlog-count">
                    {review_backlog.unvalidated_relationships}
                  </div>
                  <div className="kg-quality-backlog-label">
                    <Link2 size={16} />
                    <span>Relationships pending review</span>
                  </div>
                  <span className="kg-quality-backlog-action">Review</span>
                </button>
              )}
            </div>
          </div>
        )}

        {/* Entity Stats */}
        <div className="kg-quality-section">
          <h3>Entity Quality</h3>
          <div className="kg-quality-stats-grid">
            <div className="kg-quality-stat kg-quality-stat-total">
              <div className="kg-quality-stat-value">{entities?.total || 0}</div>
              <div className="kg-quality-stat-label">Total Entities</div>
            </div>
            <div className="kg-quality-stat kg-quality-stat-validated">
              <CheckCircle size={16} />
              <div className="kg-quality-stat-value">{entities?.validated || 0}</div>
              <div className="kg-quality-stat-label">Validated</div>
            </div>
            <div className="kg-quality-stat kg-quality-stat-extracted">
              <AlertCircle size={16} />
              <div className="kg-quality-stat-value">{entities?.extracted || 0}</div>
              <div className="kg-quality-stat-label">Pending</div>
            </div>
            <div className="kg-quality-stat kg-quality-stat-corrected">
              <Edit3 size={16} />
              <div className="kg-quality-stat-value">{entities?.corrected || 0}</div>
              <div className="kg-quality-stat-label">Corrected</div>
            </div>
            <div className="kg-quality-stat kg-quality-stat-rejected">
              <XCircle size={16} />
              <div className="kg-quality-stat-value">{entities?.rejected || 0}</div>
              <div className="kg-quality-stat-label">Rejected</div>
            </div>
            <div className="kg-quality-stat kg-quality-stat-manual">
              <PlusCircle size={16} />
              <div className="kg-quality-stat-value">{entities?.manual || 0}</div>
              <div className="kg-quality-stat-label">Manual</div>
            </div>
          </div>

          {/* Validation progress bar */}
          {entities?.total > 0 && (
            <div className="kg-quality-progress">
              <div className="kg-quality-progress-label">
                <span>Validation Progress</span>
                <span>{getPercentage(entities.validated + entities.corrected + entities.rejected, entities.total)}%</span>
              </div>
              <div className="kg-quality-progress-bar">
                <div
                  className="kg-quality-progress-fill kg-quality-progress-validated"
                  style={{ width: `${getPercentage(entities.validated, entities.total)}%` }}
                  title={`Validated: ${entities.validated}`}
                />
                <div
                  className="kg-quality-progress-fill kg-quality-progress-corrected"
                  style={{ width: `${getPercentage(entities.corrected, entities.total)}%` }}
                  title={`Corrected: ${entities.corrected}`}
                />
                <div
                  className="kg-quality-progress-fill kg-quality-progress-rejected"
                  style={{ width: `${getPercentage(entities.rejected, entities.total)}%` }}
                  title={`Rejected: ${entities.rejected}`}
                />
              </div>
            </div>
          )}
        </div>

        {/* Relationship Stats */}
        <div className="kg-quality-section">
          <h3>Relationship Quality</h3>
          <div className="kg-quality-stats-grid kg-quality-stats-grid-4">
            <div className="kg-quality-stat kg-quality-stat-total">
              <div className="kg-quality-stat-value">{relationships?.total || 0}</div>
              <div className="kg-quality-stat-label">Total</div>
            </div>
            <div className="kg-quality-stat kg-quality-stat-validated">
              <CheckCircle size={16} />
              <div className="kg-quality-stat-value">{relationships?.validated || 0}</div>
              <div className="kg-quality-stat-label">Validated</div>
            </div>
            <div className="kg-quality-stat kg-quality-stat-extracted">
              <AlertCircle size={16} />
              <div className="kg-quality-stat-value">{relationships?.extracted || 0}</div>
              <div className="kg-quality-stat-label">Pending</div>
            </div>
            <div className="kg-quality-stat kg-quality-stat-rejected">
              <XCircle size={16} />
              <div className="kg-quality-stat-value">{relationships?.rejected || 0}</div>
              <div className="kg-quality-stat-label">Rejected</div>
            </div>
          </div>

          {/* Validation progress bar */}
          {relationships?.total > 0 && (
            <div className="kg-quality-progress">
              <div className="kg-quality-progress-label">
                <span>Validation Progress</span>
                <span>{getPercentage(relationships.validated + relationships.rejected, relationships.total)}%</span>
              </div>
              <div className="kg-quality-progress-bar">
                <div
                  className="kg-quality-progress-fill kg-quality-progress-validated"
                  style={{ width: `${getPercentage(relationships.validated, relationships.total)}%` }}
                  title={`Validated: ${relationships.validated}`}
                />
                <div
                  className="kg-quality-progress-fill kg-quality-progress-rejected"
                  style={{ width: `${getPercentage(relationships.rejected, relationships.total)}%` }}
                  title={`Rejected: ${relationships.rejected}`}
                />
              </div>
            </div>
          )}
        </div>

        {/* Entity Type Breakdown */}
        {entity_types && Object.keys(entity_types).length > 0 && (
          <div className="kg-quality-section">
            <h3>Entity Types</h3>
            <div className="kg-quality-breakdown">
              {Object.entries(entity_types)
                .sort((a, b) => b[1] - a[1])
                .map(([type, count]) => (
                  <div key={type} className="kg-quality-breakdown-item">
                    <span className="kg-quality-breakdown-type">{formatTypeName(type)}</span>
                    <div className="kg-quality-breakdown-bar-container">
                      <div
                        className="kg-quality-breakdown-bar"
                        style={{
                          width: `${getPercentage(count, entities?.total || 1)}%`,
                        }}
                      />
                    </div>
                    <span className="kg-quality-breakdown-count">{count}</span>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* Relationship Type Breakdown */}
        {relationship_types && Object.keys(relationship_types).length > 0 && (
          <div className="kg-quality-section">
            <h3>Relationship Types</h3>
            <div className="kg-quality-breakdown">
              {Object.entries(relationship_types)
                .sort((a, b) => b[1] - a[1])
                .map(([type, count]) => (
                  <div key={type} className="kg-quality-breakdown-item">
                    <span className="kg-quality-breakdown-type">{formatTypeName(type)}</span>
                    <div className="kg-quality-breakdown-bar-container">
                      <div
                        className="kg-quality-breakdown-bar kg-quality-breakdown-bar-relationship"
                        style={{
                          width: `${getPercentage(count, relationships?.total || 1)}%`,
                        }}
                      />
                    </div>
                    <span className="kg-quality-breakdown-count">{count}</span>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* Provenance Stats */}
        {provenance && (provenance.by_source || provenance.by_model) && (
          <div className="kg-quality-section">
            <h3>
              <Database size={16} />
              <span>Provenance</span>
            </h3>
            <div className="kg-quality-provenance">
              {/* By Source */}
              {provenance.by_source && Object.keys(provenance.by_source).length > 0 && (
                <div className="kg-quality-provenance-group">
                  <h4>By Source</h4>
                  <div className="kg-quality-provenance-items">
                    {Object.entries(provenance.by_source)
                      .sort((a, b) => b[1] - a[1])
                      .map(([source, count]) => (
                        <div key={source} className={`kg-quality-provenance-item kg-quality-provenance-${source}`}>
                          <span className="kg-quality-provenance-label">{formatTypeName(source)}</span>
                          <span className="kg-quality-provenance-count">{count}</span>
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {/* By Model */}
              {provenance.by_model && Object.keys(provenance.by_model).length > 0 && (
                <div className="kg-quality-provenance-group">
                  <h4>By Model</h4>
                  <div className="kg-quality-provenance-items">
                    {Object.entries(provenance.by_model)
                      .sort((a, b) => b[1] - a[1])
                      .slice(0, 5)
                      .map(([model, count]) => (
                        <div key={model} className="kg-quality-provenance-item kg-quality-provenance-model">
                          <span className="kg-quality-provenance-label">{model}</span>
                          <span className="kg-quality-provenance-count">{count}</span>
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {/* By Validator */}
              {provenance.by_validator && Object.keys(provenance.by_validator).length > 0 && (
                <div className="kg-quality-provenance-group">
                  <h4>Validated By</h4>
                  <div className="kg-quality-provenance-items">
                    {Object.entries(provenance.by_validator)
                      .sort((a, b) => b[1] - a[1])
                      .map(([validator, count]) => (
                        <div key={validator} className="kg-quality-provenance-item kg-quality-provenance-validator">
                          <span className="kg-quality-provenance-label">{formatTypeName(validator)}</span>
                          <span className="kg-quality-provenance-count">{count}</span>
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Empty state */}
        {(!entities?.total && !relationships?.total) && (
          <div className="kg-quality-empty">
            <BarChart3 size={48} strokeWidth={1} />
            <p>No entities or relationships to analyze yet.</p>
            <p className="kg-quality-empty-hint">
              Use the Synthesizer to extract notes, which will populate the knowledge graph.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
