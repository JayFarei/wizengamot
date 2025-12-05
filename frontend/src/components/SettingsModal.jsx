import { useState, useEffect } from 'react';
import { api } from '../api';
import PromptEditorModal from './PromptEditorModal';
import './ConfigModal.css';
import './SettingsModal.css';

export default function SettingsModal({ isOpen, onClose }) {
  const [activeTab, setActiveTab] = useState('api');
  const [apiKey, setApiKey] = useState('');
  const [settings, setSettings] = useState(null);
  const [modelSettings, setModelSettings] = useState(null);
  const [prompts, setPrompts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Model pool management
  const [newModel, setNewModel] = useState('');

  // Integrations
  const [firecrawlKey, setFirecrawlKey] = useState('');
  const [synthesizerSettings, setSynthesizerSettings] = useState(null);

  // Prompt editor modal
  const [showPromptEditor, setShowPromptEditor] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState(null);
  const [editingPromptContent, setEditingPromptContent] = useState('');
  const [editingPromptTitle, setEditingPromptTitle] = useState('');
  const [isNewPrompt, setIsNewPrompt] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadAllSettings();
      setApiKey('');
      setError('');
      setSuccess('');
      setShowPromptEditor(false);
      setEditingPrompt(null);
      setIsNewPrompt(false);
    }
  }, [isOpen]);

  const loadAllSettings = async () => {
    try {
      const [settingsData, modelData, promptsData, synthData] = await Promise.all([
        api.getSettings(),
        api.getModelSettings(),
        api.listPrompts(),
        api.getSynthesizerSettings(),
      ]);
      setSettings(settingsData);
      setModelSettings(modelData);
      setPrompts(promptsData);
      setSynthesizerSettings(synthData);
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
      await loadAllSettings();
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
      await loadAllSettings();
    } catch (err) {
      setError('Failed to clear API key');
    } finally {
      setLoading(false);
    }
  };

  // Model Pool Management
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
      const newPool = [...modelSettings.model_pool, modelId];
      await api.updateModelPool(newPool);
      setSuccess('Model added successfully');
      setNewModel('');
      await loadAllSettings();
    } catch (err) {
      setError('Failed to add model');
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
      const newPool = modelSettings.model_pool.filter(m => m !== model);
      await api.updateModelPool(newPool);
      setSuccess('Model removed successfully');
      await loadAllSettings();
    } catch (err) {
      setError('Failed to remove model');
    } finally {
      setLoading(false);
    }
  };

  // Council Models Management
  const handleToggleCouncilModel = async (model) => {
    const isSelected = modelSettings.council_models.includes(model);
    let newCouncil;

    if (isSelected) {
      if (modelSettings.council_models.length <= 1) {
        setError('At least one council member required');
        return;
      }
      newCouncil = modelSettings.council_models.filter(m => m !== model);
    } else {
      newCouncil = [...modelSettings.council_models, model];
    }

    setLoading(true);
    setError('');
    setSuccess('');

    try {
      await api.updateCouncilModels(newCouncil);
      setSuccess('Council updated');
      await loadAllSettings();
    } catch (err) {
      setError('Failed to update council');
    } finally {
      setLoading(false);
    }
  };

  // Chairman Management
  const handleChairmanChange = async (model) => {
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      await api.updateChairman(model);
      setSuccess('Chairman updated');
      await loadAllSettings();
    } catch (err) {
      setError('Failed to update chairman');
    } finally {
      setLoading(false);
    }
  };

  // Default Prompt Management
  const handleDefaultPromptChange = async (filename) => {
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      await api.updateDefaultPrompt(filename || null);
      setSuccess('Default prompt updated');
      await loadAllSettings();
    } catch (err) {
      setError('Failed to update default prompt');
    } finally {
      setLoading(false);
    }
  };

  // Prompt CRUD
  const handleEditPrompt = async (filename) => {
    try {
      const prompt = await api.getPrompt(filename);
      setEditingPrompt(filename);
      setEditingPromptTitle(prompt.title || filename);
      setEditingPromptContent(prompt.content);
      setIsNewPrompt(false);
      setShowPromptEditor(true);
    } catch (err) {
      setError('Failed to load prompt');
    }
  };

  const handleNewPrompt = () => {
    setEditingPrompt(null);
    setEditingPromptTitle('');
    setEditingPromptContent('');
    setIsNewPrompt(true);
    setShowPromptEditor(true);
  };

  const handleSavePromptFromEditor = async (title, content) => {
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      if (isNewPrompt) {
        await api.createPrompt(title, content);
        setSuccess('Prompt created');
      } else {
        await api.updatePrompt(editingPrompt, content);
        setSuccess('Prompt saved');
      }
      setShowPromptEditor(false);
      setEditingPrompt(null);
      await loadAllSettings();
    } catch (err) {
      setError(isNewPrompt ? 'Failed to create prompt' : 'Failed to save prompt');
    } finally {
      setLoading(false);
    }
  };

  const handleDeletePrompt = async (filename) => {
    if (!confirm('Are you sure you want to delete this prompt?')) return;

    setLoading(true);
    setError('');
    setSuccess('');

    try {
      await api.deletePrompt(filename);
      setSuccess('Prompt deleted');
      await loadAllSettings();
    } catch (err) {
      setError('Failed to delete prompt');
    } finally {
      setLoading(false);
    }
  };

  const getModelShortName = (model) => {
    return model.split('/')[1] || model;
  };

  // Firecrawl API Key
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
      await loadAllSettings();
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
      await loadAllSettings();
    } catch (err) {
      setError('Failed to clear Firecrawl API key');
    } finally {
      setLoading(false);
    }
  };

  // Synthesizer Settings
  const handleSynthesizerModelChange = async (model) => {
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      await api.updateSynthesizerSettings(model, null, null);
      setSuccess('Synthesizer model updated');
      await loadAllSettings();
    } catch (err) {
      setError('Failed to update synthesizer model');
    } finally {
      setLoading(false);
    }
  };

  const handleSynthesizerModeChange = async (mode) => {
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      await api.updateSynthesizerSettings(null, mode, null);
      setSuccess('Synthesizer mode updated');
      await loadAllSettings();
    } catch (err) {
      setError('Failed to update synthesizer mode');
    } finally {
      setLoading(false);
    }
  };

  const handleSynthesizerPromptChange = async (prompt) => {
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      await api.updateSynthesizerSettings(null, null, prompt || null);
      setSuccess('Synthesizer prompt updated');
      await loadAllSettings();
    } catch (err) {
      setError('Failed to update synthesizer prompt');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content settings-modal-full" onClick={(e) => e.stopPropagation()}>
        <h2>Settings</h2>

        <div className="settings-tabs">
          <button
            className={`settings-tab ${activeTab === 'api' ? 'active' : ''}`}
            onClick={() => setActiveTab('api')}
          >
            API Keys
          </button>
          <button
            className={`settings-tab ${activeTab === 'models' ? 'active' : ''}`}
            onClick={() => setActiveTab('models')}
          >
            Models
          </button>
          <button
            className={`settings-tab ${activeTab === 'prompts' ? 'active' : ''}`}
            onClick={() => setActiveTab('prompts')}
          >
            Prompts
          </button>
          <button
            className={`settings-tab ${activeTab === 'synthesizer' ? 'active' : ''}`}
            onClick={() => setActiveTab('synthesizer')}
          >
            Synthesizer
          </button>
        </div>

        {/* API Keys Tab */}
        {activeTab === 'api' && (
          <>
            <div className="modal-section">
              <h3>OpenRouter</h3>
            <p className="section-description">
              Required for querying LLM models in Council mode.
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
          </div>

          <div className="modal-section">
            <h3>Firecrawl</h3>
            <p className="section-description">
              Required for scraping articles in Synthesizer mode.
              Get your key at <a href="https://www.firecrawl.dev/" target="_blank" rel="noopener noreferrer">firecrawl.dev</a>
            </p>

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
              <button
                className="btn-primary"
                onClick={handleSaveFirecrawlKey}
                disabled={loading || !firecrawlKey.trim()}
              >
                {loading ? 'Saving...' : 'Save'}
              </button>
            </div>

            {settings?.firecrawl_source === 'settings' && (
              <button
                className="btn-secondary btn-clear"
                onClick={handleClearFirecrawlKey}
                disabled={loading}
              >
                Clear Saved Key
              </button>
            )}
          </div>
          </>
        )}

        {/* Models Tab */}
        {activeTab === 'models' && modelSettings && (
          <>
            <div className="modal-section">
              <h3>Model Pool</h3>
              <p className="section-description">
                Available models for the council. Format: provider/model-name
              </p>

              <div className="model-pool-list">
                {modelSettings.model_pool.map((model) => (
                  <div key={model} className="model-pool-item">
                    <span>{model}</span>
                    <button
                      className="btn-remove"
                      onClick={() => handleRemoveModel(model)}
                      disabled={loading || modelSettings.model_pool.length <= 1}
                      title="Remove model"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>

              <div className="add-model-group">
                <input
                  type="text"
                  className="add-model-input"
                  placeholder="e.g., openai/gpt-4"
                  value={newModel}
                  onChange={(e) => setNewModel(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddModel()}
                />
                <button
                  className="btn-primary btn-small"
                  onClick={handleAddModel}
                  disabled={loading || !newModel.trim()}
                >
                  Add
                </button>
              </div>
            </div>

            <div className="modal-section">
              <h3>Default Council Members</h3>
              <p className="section-description">
                Select which models participate in new conversations by default
              </p>
              <div className="model-checkboxes">
                {modelSettings.model_pool.map((model) => (
                  <label key={model} className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={modelSettings.council_models.includes(model)}
                      onChange={() => handleToggleCouncilModel(model)}
                      disabled={loading}
                    />
                    <span>{getModelShortName(model)}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="modal-section">
              <h3>Default Chairman</h3>
              <p className="section-description">
                Model that synthesizes the final answer
              </p>
              <select
                className="chairman-select"
                value={modelSettings.chairman_model}
                onChange={(e) => handleChairmanChange(e.target.value)}
                disabled={loading}
              >
                {modelSettings.model_pool.map((model) => (
                  <option key={model} value={model}>
                    {getModelShortName(model)}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}

        {/* Prompts Tab */}
        {activeTab === 'prompts' && (
          <>
            <div className="modal-section">
              <h3>Default System Prompt</h3>
              <p className="section-description">
                System prompt used for new conversations
              </p>
              <select
                className="chairman-select"
                value={modelSettings?.default_prompt || ''}
                onChange={(e) => handleDefaultPromptChange(e.target.value)}
                disabled={loading}
              >
                <option value="">None (default behavior)</option>
                {prompts.map((prompt) => (
                  <option key={prompt.filename} value={prompt.filename}>
                    {prompt.title}
                  </option>
                ))}
              </select>
            </div>

            <div className="modal-section">
              <div className="section-header">
                <h3>System Prompts</h3>
                <button
                  className="btn-small btn-primary"
                  onClick={handleNewPrompt}
                >
                  + New Prompt
                </button>
              </div>

              <div className="prompts-list">
                {prompts.length === 0 ? (
                  <p className="no-prompts">No prompts yet. Create one to get started.</p>
                ) : (
                  prompts.map((prompt) => (
                    <div key={prompt.filename} className="prompt-item">
                      <div className="prompt-info">
                        <span className="prompt-title">{prompt.title}</span>
                        <span className="prompt-filename">{prompt.filename}</span>
                      </div>
                      <div className="prompt-actions">
                        <button
                          className="btn-small btn-secondary"
                          onClick={() => handleEditPrompt(prompt.filename)}
                        >
                          Edit
                        </button>
                        <button
                          className="btn-small btn-danger"
                          onClick={() => handleDeletePrompt(prompt.filename)}
                          disabled={loading}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </>
        )}

        {/* Synthesizer Tab */}
        {activeTab === 'synthesizer' && (
          <>
            <div className="modal-section">
              <h3>Synthesizer Settings</h3>
              <p className="section-description">
                Configure default behavior for the Synthesizer mode
              </p>

              {synthesizerSettings && modelSettings && (
                <>
                  <div className="setting-row">
                    <label>Default Model</label>
                    <select
                      className="chairman-select"
                      value={synthesizerSettings.default_model || ''}
                      onChange={(e) => handleSynthesizerModelChange(e.target.value)}
                      disabled={loading}
                    >
                      {modelSettings.model_pool.map((model) => (
                        <option key={model} value={model}>
                          {getModelShortName(model)}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="setting-row">
                    <label>Generation Mode</label>
                    <select
                      className="chairman-select"
                      value={synthesizerSettings.default_mode || 'single'}
                      onChange={(e) => handleSynthesizerModeChange(e.target.value)}
                      disabled={loading}
                    >
                      <option value="single">Single Model</option>
                      <option value="council">Council (Multiple Models)</option>
                    </select>
                  </div>

                  <div className="setting-row">
                    <label>Default Prompt</label>
                    <select
                      className="chairman-select"
                      value={synthesizerSettings.default_prompt || 'zettel.md'}
                      onChange={(e) => handleSynthesizerPromptChange(e.target.value)}
                      disabled={loading}
                    >
                      {prompts.map((prompt) => (
                        <option key={prompt.filename} value={prompt.filename}>
                          {prompt.title}
                        </option>
                      ))}
                    </select>
                  </div>
                </>
              )}
            </div>
          </>
        )}

        {error && <div className="settings-error">{error}</div>}
        {success && <div className="settings-success">{success}</div>}

        <div className="modal-actions">
          <button className="btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>

      <PromptEditorModal
        isOpen={showPromptEditor}
        onClose={() => {
          setShowPromptEditor(false);
          setEditingPrompt(null);
        }}
        onSave={handleSavePromptFromEditor}
        initialTitle={editingPromptTitle}
        initialContent={editingPromptContent}
        isNew={isNewPrompt}
        loading={loading}
      />
    </div>
  );
}
