import React, { useState } from 'react';
import { api } from '../api';
import CompetitorRow from './CompetitorRow';
import AddCompetitorModal from './AddCompetitorModal';
import MonitorTimeline from './MonitorTimeline';
import MonitorCompare from './MonitorCompare';
import MonitorUpdateDetail from './MonitorUpdateDetail';
import MonitorDigest from './MonitorDigest';
import './MonitorCard.css';

export default function MonitorCard({ monitor, onMonitorUpdate }) {
  const [activeTab, setActiveTab] = useState('summary');
  const [isCrawling, setIsCrawling] = useState(false);
  const [crawlResult, setCrawlResult] = useState(null);
  const [selectedUpdate, setSelectedUpdate] = useState(null);
  const [showAddCompetitorModal, setShowAddCompetitorModal] = useState(false);
  const [expandedCompetitors, setExpandedCompetitors] = useState([]);
  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState('');

  const hasCompetitors = monitor?.competitors?.length > 0;
  const totalPages = monitor?.competitors?.reduce(
    (sum, comp) => sum + (comp.pages?.length || 0),
    0
  ) || 0;

  const handleCrawlNow = async () => {
    if (isCrawling) return;

    setIsCrawling(true);
    setCrawlResult(null);

    try {
      const result = await api.triggerCrawl(monitor.id);
      setCrawlResult({
        success: true,
        crawled: result.crawled?.length || 0,
        failed: result.failed?.length || 0,
      });

      if (onMonitorUpdate) {
        const updatedMonitor = await api.getMonitor(monitor.id);
        onMonitorUpdate(updatedMonitor);
      }
    } catch (error) {
      setCrawlResult({
        success: false,
        error: error.message,
      });
    } finally {
      setIsCrawling(false);
    }
  };

  const handleCompetitorAdded = async () => {
    if (onMonitorUpdate) {
      const updatedMonitor = await api.getMonitor(monitor.id);
      onMonitorUpdate(updatedMonitor);
    }
  };

  const handleToggleExpand = (competitorId) => {
    setExpandedCompetitors((prev) =>
      prev.includes(competitorId)
        ? prev.filter((id) => id !== competitorId)
        : [...prev, competitorId]
    );
  };

  const handleDeleteCompetitor = async (competitorId) => {
    if (!window.confirm('Are you sure you want to remove this competitor?')) return;

    try {
      await api.removeCompetitor(monitor.id, competitorId);
      if (onMonitorUpdate) {
        const updatedMonitor = await api.getMonitor(monitor.id);
        onMonitorUpdate(updatedMonitor);
      }
    } catch (error) {
      console.error('Failed to delete competitor:', error);
    }
  };

  const handleRemovePage = async (competitorId, pageId) => {
    try {
      await api.removePage(monitor.id, competitorId, pageId);
      if (onMonitorUpdate) {
        const updatedMonitor = await api.getMonitor(monitor.id);
        onMonitorUpdate(updatedMonitor);
      }
    } catch (error) {
      console.error('Failed to remove page:', error);
    }
  };

  const handleStartEditName = () => {
    setEditedName(monitor.name);
    setIsEditingName(true);
  };

  const handleSaveName = async () => {
    if (!editedName.trim() || editedName === monitor.name) {
      setIsEditingName(false);
      return;
    }

    try {
      await api.updateMonitor(monitor.id, { name: editedName.trim() });
      if (onMonitorUpdate) {
        const updatedMonitor = await api.getMonitor(monitor.id);
        onMonitorUpdate(updatedMonitor);
      }
    } catch (error) {
      console.error('Failed to update monitor name:', error);
    } finally {
      setIsEditingName(false);
    }
  };

  const handleNameKeyDown = (e) => {
    if (e.key === 'Enter') {
      handleSaveName();
    } else if (e.key === 'Escape') {
      setIsEditingName(false);
    }
  };

  const formatRelativeTime = (timestamp) => {
    if (!timestamp) return 'Never';
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  // Empty state - centered full screen
  if (!hasCompetitors) {
    return (
      <div className="group-tracker group-tracker-empty">
        <div className="empty-state-centered">
          <div className="empty-hero-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="12" cy="12" r="10" />
              <circle cx="12" cy="12" r="6" />
              <circle cx="12" cy="12" r="2" />
              <line x1="12" y1="2" x2="12" y2="4" />
              <line x1="12" y1="20" x2="12" y2="22" />
              <line x1="2" y1="12" x2="4" y2="12" />
              <line x1="20" y1="12" x2="22" y2="12" />
            </svg>
          </div>
          <h2>Set Up Your Group Tracker</h2>
          <p>Track competitor narratives and messaging over time. Add competitors to monitor their web pages for changes.</p>
          <button
            className="primary-action-btn"
            onClick={() => setShowAddCompetitorModal(true)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Add Your First Competitor
          </button>
        </div>

        <AddCompetitorModal
          isOpen={showAddCompetitorModal}
          onClose={() => setShowAddCompetitorModal(false)}
          monitorId={monitor?.id}
          onCompetitorAdded={handleCompetitorAdded}
        />
      </div>
    );
  }

  // Render Summary tab content (competitors list)
  const renderSummary = () => (
    <div className="competitors-list">
      {monitor.competitors.map((competitor) => (
        <CompetitorRow
          key={competitor.id}
          competitor={competitor}
          isExpanded={expandedCompetitors.includes(competitor.id)}
          onToggleExpand={() => handleToggleExpand(competitor.id)}
          onEdit={() => {/* TODO: Edit competitor modal */}}
          onDelete={() => handleDeleteCompetitor(competitor.id)}
          onRemovePage={(pageId) => handleRemovePage(competitor.id, pageId)}
        />
      ))}

      {crawlResult && (
        <div className={`crawl-result ${crawlResult.success ? 'success' : 'error'}`}>
          {crawlResult.success ? (
            <>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
              Crawled {crawlResult.crawled} pages
              {crawlResult.failed > 0 && ` (${crawlResult.failed} failed)`}
            </>
          ) : (
            <>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="15" y1="9" x2="9" y2="15" />
                <line x1="9" y1="9" x2="15" y2="15" />
              </svg>
              {crawlResult.error}
            </>
          )}
        </div>
      )}
    </div>
  );

  // Populated state - full width layout
  return (
    <div className="group-tracker">
      {/* Header Bar */}
      <div className="tracker-header">
        <div className="header-left">
          {isEditingName ? (
            <input
              type="text"
              className="name-input"
              value={editedName}
              onChange={(e) => setEditedName(e.target.value)}
              onBlur={handleSaveName}
              onKeyDown={handleNameKeyDown}
              autoFocus
            />
          ) : (
            <h2 className="tracker-name" onClick={handleStartEditName}>
              {monitor.name}
              <svg className="edit-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
            </h2>
          )}
        </div>

        <div className="header-stats">
          <span className="stat">
            <strong>{monitor.competitors.length}</strong> {monitor.competitors.length === 1 ? 'competitor' : 'competitors'}
          </span>
          <span className="stat">
            <strong>{totalPages}</strong> {totalPages === 1 ? 'page' : 'pages'}
          </span>
          <span className="stat last-crawl">
            Last crawl: <strong>{formatRelativeTime(monitor.last_crawl_at)}</strong>
          </span>
        </div>

        <div className="header-actions">
          <button
            className="add-competitor-btn"
            onClick={() => setShowAddCompetitorModal(true)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Add Competitor
          </button>
          <button
            className={`crawl-button ${isCrawling ? 'crawling' : ''}`}
            onClick={handleCrawlNow}
            disabled={isCrawling}
          >
            {isCrawling ? (
              <>
                <span className="spinner"></span>
                Crawling...
              </>
            ) : (
              <>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M23 4v6h-6" />
                  <path d="M1 20v-6h6" />
                  <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                </svg>
                Crawl Now
              </>
            )}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="tracker-tabs">
        <button
          className={`tracker-tab ${activeTab === 'summary' ? 'active' : ''}`}
          onClick={() => setActiveTab('summary')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <line x1="9" y1="9" x2="15" y2="9" />
            <line x1="9" y1="13" x2="15" y2="13" />
            <line x1="9" y1="17" x2="12" y2="17" />
          </svg>
          Summary
        </button>
        <button
          className={`tracker-tab ${activeTab === 'timeline' ? 'active' : ''}`}
          onClick={() => setActiveTab('timeline')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
          Timeline
        </button>
        <button
          className={`tracker-tab ${activeTab === 'compare' ? 'active' : ''}`}
          onClick={() => setActiveTab('compare')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="20" x2="18" y2="10" />
            <line x1="12" y1="20" x2="12" y2="4" />
            <line x1="6" y1="20" x2="6" y2="14" />
          </svg>
          Compare
        </button>
        <button
          className={`tracker-tab ${activeTab === 'digests' ? 'active' : ''}`}
          onClick={() => setActiveTab('digests')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
          </svg>
          Digests
        </button>
      </div>

      {/* Tab Content */}
      <div className="tracker-tab-content">
        {activeTab === 'summary' && renderSummary()}
        {activeTab === 'timeline' && (
          <MonitorTimeline
            monitor={monitor}
            onSelectUpdate={setSelectedUpdate}
          />
        )}
        {activeTab === 'compare' && (
          <MonitorCompare monitor={monitor} />
        )}
        {activeTab === 'digests' && (
          <MonitorDigest monitor={monitor} />
        )}
      </div>

      {/* Update Detail Modal */}
      {selectedUpdate && (
        <MonitorUpdateDetail
          monitor={monitor}
          snapshotId={selectedUpdate.snapshot_id}
          onClose={() => setSelectedUpdate(null)}
        />
      )}

      {/* Add Competitor Modal */}
      <AddCompetitorModal
        isOpen={showAddCompetitorModal}
        onClose={() => setShowAddCompetitorModal(false)}
        monitorId={monitor?.id}
        onCompetitorAdded={handleCompetitorAdded}
      />
    </div>
  );
}
