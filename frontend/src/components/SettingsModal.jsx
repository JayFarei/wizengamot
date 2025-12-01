import { useState, useEffect } from 'react';
import { api } from '../api';
import './ConfigModal.css';
import './SettingsModal.css';

export default function SettingsModal({ isOpen, onClose }) {
  const [apiKey, setApiKey] = useState('');
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    if (isOpen) {
      loadSettings();
      setApiKey('');
      setError('');
      setSuccess('');
    }
  }, [isOpen]);

  const loadSettings = async () => {
    try {
      const data = await api.getSettings();
      setSettings(data);
    } catch (err) {
      console.error('Failed to load settings:', err);
    }
  };

  const handleSaveApiKey = async () => {
    if (!apiKey.trim()) {
      setError('Please enter an API key');
      return;
    }

    setLoading(true);
    setError('');
    setSuccess('');

    try {
      await api.updateApiKey(apiKey.trim());
      setSuccess('API key saved successfully');
      setApiKey('');
      await loadSettings();
    } catch (err) {
      setError('Failed to save API key');
    } finally {
      setLoading(false);
    }
  };

  const handleClearApiKey = async () => {
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      await api.clearApiKey();
      setSuccess('API key cleared (using environment variable if set)');
      await loadSettings();
    } catch (err) {
      setError('Failed to clear API key');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content settings-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Settings</h2>

        <div className="modal-section">
          <h3>OpenRouter API Key</h3>
          <p className="section-description">
            Configure your OpenRouter API key for querying LLM models.
            Get your key at <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer">openrouter.ai/keys</a>
          </p>

          {settings && (
            <div className="api-key-status">
              <span className={`status-indicator ${settings.api_key_configured ? 'configured' : 'not-configured'}`}>
                {settings.api_key_configured ? 'Configured' : 'Not Configured'}
              </span>
              {settings.api_key_configured && (
                <span className="status-source">
                  (via {settings.api_key_source === 'settings' ? 'saved settings' : 'environment variable'})
                </span>
              )}
            </div>
          )}

          <div className="api-key-input-group">
            <input
              type="password"
              className="api-key-input"
              placeholder="sk-or-v1-..."
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSaveApiKey()}
            />
            <button
              className="btn-primary"
              onClick={handleSaveApiKey}
              disabled={loading || !apiKey.trim()}
            >
              {loading ? 'Saving...' : 'Save'}
            </button>
          </div>

          {settings?.api_key_source === 'settings' && (
            <button
              className="btn-secondary btn-clear"
              onClick={handleClearApiKey}
              disabled={loading}
            >
              Clear Saved Key
            </button>
          )}

          {error && <div className="settings-error">{error}</div>}
          {success && <div className="settings-success">{success}</div>}
        </div>

        <div className="modal-actions">
          <button className="btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
