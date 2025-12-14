import { useState } from 'react';
import { api } from '../../../api';
import ModelReplacementModal from '../ModelReplacementModal';
import './GeneralSection.css';

export default function GeneralSection({
  settings,
  modelSettings,
  loading,
  setLoading,
  setError,
  setSuccess,
  onReload,
}) {
  const [apiKey, setApiKey] = useState('');
  const [firecrawlKey, setFirecrawlKey] = useState('');
  const [newModel, setNewModel] = useState('');
  const [testingModel, setTestingModel] = useState(null);
  const [testResults, setTestResults] = useState({}); // model -> 'passed' | 'failed'
  const [testErrorPopup, setTestErrorPopup] = useState(null); // { model, message }
  const [replacementModal, setReplacementModal] = useState({
    isOpen: false,
    modelToRemove: null,
    dependencies: null,
  });

  // API Key handlers
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
      await onReload();
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
      await onReload();
    } catch (err) {
      setError('Failed to clear API key');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveFirecrawlKey = async () => {
    if (!firecrawlKey.trim()) {
      setError('Please enter a Firecrawl API key');
      return;
    }

    setLoading(true);
    setError('');
    setSuccess('');

    try {
      await api.updateFirecrawlApiKey(firecrawlKey.trim());
      setSuccess('Firecrawl API key saved successfully');
      setFirecrawlKey('');
      await onReload();
    } catch (err) {
      setError('Failed to save Firecrawl API key');
    } finally {
      setLoading(false);
    }
  };

  const handleClearFirecrawlKey = async () => {
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      await api.clearFirecrawlApiKey();
      setSuccess('Firecrawl API key cleared');
      await onReload();
    } catch (err) {
      setError('Failed to clear Firecrawl API key');
    } finally {
      setLoading(false);
    }
  };

  // Model Pool handlers
  const handleTestModel = async (model) => {
    setTestingModel(model);
    setTestErrorPopup(null);

    try {
      const result = await api.testModel(model);
      if (result.success) {
        setTestResults((prev) => ({ ...prev, [model]: 'passed' }));
      } else {
        setTestResults((prev) => ({ ...prev, [model]: 'failed' }));
        setTestErrorPopup({ model, message: result.error || 'Unknown error' });
      }
    } catch (err) {
      const message = typeof err === 'string' ? err : (err?.message || 'Unknown error');
      setTestResults((prev) => ({ ...prev, [model]: 'failed' }));
      setTestErrorPopup({ model, message });
    } finally {
      setTestingModel(null);
    }
  };

  const handleAddModel = async () => {
    if (!newModel.trim()) return;

    const modelId = newModel.trim();
    if (modelSettings.model_pool.includes(modelId)) {
      setError('Model already in pool');
      return;
    }

    setLoading(true);
    setError('');
    setSuccess('');

    try {
      // First test the model
      const testResult = await api.testModel(modelId);
      if (!testResult.success) {
        setError(`Cannot add model: ${testResult.error || 'Model test failed'}`);
        setLoading(false);
        return;
      }

      // Model works, add it
      const newPool = [...modelSettings.model_pool, modelId];
      await api.updateModelPool(newPool);
      setSuccess('Model added successfully');
      setNewModel('');
      await onReload();
    } catch (err) {
      const message = typeof err === 'string' ? err : (err?.message || 'Unknown error');
      setError(`Failed to add model: ${message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveModel = async (model) => {
    if (modelSettings.model_pool.length <= 1) {
      setError('Cannot remove the last model');
      return;
    }

    setLoading(true);
    setError('');
    setSuccess('');

    try {
      // Check dependencies first
      const deps = await api.getModelDependencies(model);

      if (deps.replacement_required && deps.replacement_required.length > 0) {
        // Model is in use, show replacement modal
        setReplacementModal({
          isOpen: true,
          modelToRemove: model,
          dependencies: deps,
        });
        setLoading(false);
        return;
      }

      // No dependencies, safe to remove
      const newPool = modelSettings.model_pool.filter((m) => m !== model);
      await api.updateModelPool(newPool);
      setSuccess('Model removed successfully');
      await onReload();
    } catch (err) {
      setError('Failed to remove model');
    } finally {
      setLoading(false);
    }
  };

  const handleReplacementSuccess = async () => {
    setSuccess('Model replaced and removed successfully');
    setReplacementModal({ isOpen: false, modelToRemove: null, dependencies: null });
    await onReload();
  };

  const getModelShortName = (model) => model.split('/')[1] || model;

  return (
    <div className="settings-section general-section">
      {/* API Keys */}
      <div className="modal-section">
        <h3>API Keys</h3>

        <div className="api-key-block">
          <div className="api-key-header">
            <strong>OpenRouter</strong>
            <span className="api-key-hint">
              Required for LLM queries. Get your key at{' '}
              <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer">
                openrouter.ai/keys
              </a>
            </span>
          </div>
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
            <button className="btn-primary" onClick={handleSaveApiKey} disabled={loading || !apiKey.trim()}>
              {loading ? 'Saving...' : 'Save'}
            </button>
          </div>
          {settings?.api_key_source === 'settings' && (
            <button className="btn-secondary btn-clear" onClick={handleClearApiKey} disabled={loading}>
              Clear Saved Key
            </button>
          )}
        </div>

        <div className="api-key-block">
          <div className="api-key-header">
            <strong>Firecrawl</strong>
            <span className="api-key-hint">
              Required for scraping articles. Get your key at{' '}
              <a href="https://www.firecrawl.dev/" target="_blank" rel="noopener noreferrer">
                firecrawl.dev
              </a>
            </span>
          </div>
          {settings && (
            <div className="api-key-status">
              <span className={`status-indicator ${settings.firecrawl_configured ? 'configured' : 'not-configured'}`}>
                {settings.firecrawl_configured ? 'Configured' : 'Not Configured'}
              </span>
              {settings.firecrawl_configured && settings.firecrawl_source && (
                <span className="status-source">
                  (via {settings.firecrawl_source === 'settings' ? 'saved settings' : 'environment variable'})
                </span>
              )}
            </div>
          )}
          <div className="api-key-input-group">
            <input
              type="password"
              className="api-key-input"
              placeholder="fc-..."
              value={firecrawlKey}
              onChange={(e) => setFirecrawlKey(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSaveFirecrawlKey()}
            />
            <button className="btn-primary" onClick={handleSaveFirecrawlKey} disabled={loading || !firecrawlKey.trim()}>
              {loading ? 'Saving...' : 'Save'}
            </button>
          </div>
          {settings?.firecrawl_source === 'settings' && (
            <button className="btn-secondary btn-clear" onClick={handleClearFirecrawlKey} disabled={loading}>
              Clear Saved Key
            </button>
          )}
        </div>
      </div>

      {/* Model Pool */}
      <div className="modal-section">
        <h3>Model Pool</h3>
        <p className="section-description">
          Available models for all modes. Models are tested before being added.
        </p>

        <div className="model-pool-list">
          {modelSettings?.model_pool.map((model) => {
            const testStatus = testResults[model];
            const isTesting = testingModel === model;

            return (
              <div key={model} className="model-pool-item">
                <button
                  className={`btn-test-model ${isTesting ? 'testing' : ''} ${testStatus === 'passed' ? 'passed' : ''} ${testStatus === 'failed' ? 'failed' : ''}`}
                  onClick={() => handleTestModel(model)}
                  disabled={loading || isTesting}
                  title={testStatus === 'passed' ? 'Test passed - click to retest' : testStatus === 'failed' ? 'Test failed - click to retry' : 'Click to test model'}
                >
                  {isTesting ? (
                    <svg className="spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="12" />
                    </svg>
                  ) : testStatus === 'passed' ? (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  ) : testStatus === 'failed' ? (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <circle cx="12" cy="12" r="10" />
                      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                      <line x1="12" y1="17" x2="12.01" y2="17" />
                    </svg>
                  )}
                </button>
                <span className="model-name">{model}</span>
                <button
                  className="btn-remove"
                  onClick={() => handleRemoveModel(model)}
                  disabled={loading || modelSettings.model_pool.length <= 1}
                  title="Remove model"
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>

        {/* Error Popup */}
        {testErrorPopup && (
          <div className="test-error-popup">
            <div className="test-error-content">
              <span className="test-error-icon">✕</span>
              <div className="test-error-text">
                <strong>{testErrorPopup.model.split('/')[1]}</strong>
                <span>{testErrorPopup.message}</span>
              </div>
              <button className="test-error-close" onClick={() => setTestErrorPopup(null)}>×</button>
            </div>
          </div>
        )}

        <div className="add-model-group">
          <input
            type="text"
            className="add-model-input"
            placeholder="e.g., openai/gpt-4"
            value={newModel}
            onChange={(e) => setNewModel(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddModel()}
          />
          <button className="btn-primary btn-small" onClick={handleAddModel} disabled={loading || !newModel.trim()}>
            Add
          </button>
        </div>
      </div>

      {/* Replacement Modal */}
      <ModelReplacementModal
        isOpen={replacementModal.isOpen}
        onClose={() => setReplacementModal({ isOpen: false, modelToRemove: null, dependencies: null })}
        modelToRemove={replacementModal.modelToRemove}
        dependencies={replacementModal.dependencies}
        availableModels={modelSettings?.model_pool || []}
        onSuccess={handleReplacementSuccess}
      />
    </div>
  );
}
