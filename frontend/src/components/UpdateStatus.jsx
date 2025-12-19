import { useState, useEffect } from 'react';
import { api } from '../api';
import { formatRelativeTime } from '../utils/formatRelativeTime';
import './UpdateStatus.css';

export default function UpdateStatus() {
  const [versionInfo, setVersionInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState(null);
  const [updateMessage, setUpdateMessage] = useState(null);

  useEffect(() => {
    loadVersion();
  }, []);

  const loadVersion = async (force = false) => {
    try {
      setError(null);
      if (force) setRefreshing(true);
      const result = await api.getVersion(force);
      setVersionInfo(result);
    } catch (err) {
      console.error('Failed to load version:', err);
      setError('Could not fetch version info');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const handleRefresh = () => {
    if (!refreshing) {
      loadVersion(true);
    }
  };

  const handleUpdate = async () => {
    if (updating) return;

    setUpdating(true);
    setUpdateMessage(null);
    setError(null);

    try {
      const result = await api.triggerUpdate();
      if (result.success) {
        setUpdateMessage('Update successful! Server restarting...');
        // Show reconnect message after a moment
        setTimeout(() => {
          setUpdateMessage('Reconnecting...');
          // Try to reload after giving server time to restart
          setTimeout(() => {
            window.location.reload();
          }, 3000);
        }, 2000);
      } else {
        setError(result.error || 'Update failed');
        setUpdating(false);
      }
    } catch (err) {
      setError('Failed to trigger update');
      setUpdating(false);
    }
  };

  if (loading) {
    return (
      <div className="update-status loading">
        <span className="status-text">Checking for updates...</span>
      </div>
    );
  }

  if (error && !versionInfo) {
    return (
      <div className="update-status error">
        <span className="status-text">{error}</span>
      </div>
    );
  }

  if (!versionInfo || !versionInfo.local) {
    return null;
  }

  const { local, remote, behind, up_to_date } = versionInfo;

  return (
    <div className="update-status">
      <div className="version-info">
        <span className="version-label">Version:</span>
        <code className="version-commit">{local.commit}</code>
        <span className="version-date">({formatRelativeTime(local.date)})</span>
        <button
          className="refresh-btn"
          onClick={handleRefresh}
          disabled={refreshing}
          title="Check for updates"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className={refreshing ? 'spinning' : ''}
          >
            <path d="M23 4v6h-6" />
            <path d="M1 20v-6h6" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </svg>
        </button>
      </div>

      {!up_to_date && behind > 0 && (
        <div className="update-available">
          <span className="update-badge">
            {behind} update{behind > 1 ? 's' : ''} available
          </span>
          <button
            className="update-button"
            onClick={handleUpdate}
            disabled={updating}
          >
            {updating ? 'Updating...' : 'Update Now'}
          </button>
        </div>
      )}

      {up_to_date && (
        <div className="up-to-date">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
          <span>Up to date</span>
        </div>
      )}

      {updateMessage && (
        <div className="update-message">{updateMessage}</div>
      )}

      {error && (
        <div className="update-error">{error}</div>
      )}
    </div>
  );
}
