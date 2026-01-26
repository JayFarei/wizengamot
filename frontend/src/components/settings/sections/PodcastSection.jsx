import { useState, useEffect } from 'react';
import { Info, Image, Radio, Plus, Trash2, Edit3, Check, X, AlertCircle, RefreshCw, Users } from 'lucide-react';
import { api } from '../../../api';
import CharacterList from '../../CharacterList';
import './PodcastSection.css';

export default function PodcastSection({
  podcastSettings,
  loading,
  setLoading,
  setError,
  setSuccess,
  onReload,
}) {
  // TTS Health state
  const [ttsHealth, setTtsHealth] = useState(null);
  const [checkingHealth, setCheckingHealth] = useState(true);

  // Cover art state
  const [coverPrompt, setCoverPrompt] = useState('');
  const [coverPromptDirty, setCoverPromptDirty] = useState(false);
  const [coverModel, setCoverModel] = useState('');
  const [coverModelDirty, setCoverModelDirty] = useState(false);

  // Narration styles state
  const [narrationStyles, setNarrationStyles] = useState({});
  const [stylesLoading, setStylesLoading] = useState(true);
  const [editingStyle, setEditingStyle] = useState(null);
  const [styleForm, setStyleForm] = useState({ id: '', name: '', description: '', prompt: '' });
  const [styleDirty, setStyleDirty] = useState(false);
  const [showNewStyleForm, setShowNewStyleForm] = useState(false);

  // Characters view toggle
  const [showCharacters, setShowCharacters] = useState(false);

  // Check TTS health on mount
  useEffect(() => {
    checkTtsHealth();
  }, []);

  // Initialize cover prompt from settings
  useEffect(() => {
    if (podcastSettings?.cover_prompt && !coverPromptDirty) {
      setCoverPrompt(podcastSettings.cover_prompt);
    }
  }, [podcastSettings?.cover_prompt, coverPromptDirty]);

  // Initialize cover model from settings
  useEffect(() => {
    if (podcastSettings?.cover_model && !coverModelDirty) {
      setCoverModel(podcastSettings.cover_model);
    }
  }, [podcastSettings?.cover_model, coverModelDirty]);

  // Load narration styles
  useEffect(() => {
    const loadStyles = async () => {
      try {
        const styles = await api.listPodcastStyles();
        setNarrationStyles(styles);
      } catch (err) {
        console.error('Failed to load narration styles:', err);
      } finally {
        setStylesLoading(false);
      }
    };
    loadStyles();
  }, []);

  // TTS health check
  const checkTtsHealth = async () => {
    setCheckingHealth(true);
    try {
      const health = await api.checkTtsHealth();
      setTtsHealth(health);
    } catch (err) {
      console.error('Failed to check TTS health:', err);
      setTtsHealth({ healthy: false, error: 'Failed to connect to TTS service' });
    } finally {
      setCheckingHealth(false);
    }
  };

  // Cover prompt handlers
  const handleSaveCoverPrompt = async () => {
    if (!coverPrompt.trim()) {
      setError('Cover prompt cannot be empty');
      return;
    }

    setLoading(true);
    setError('');
    setSuccess('');

    try {
      await api.updatePodcastCoverPrompt(coverPrompt.trim());
      setSuccess('Cover art prompt saved successfully');
      setCoverPromptDirty(false);
      await onReload();
    } catch (err) {
      setError('Failed to save cover prompt');
    } finally {
      setLoading(false);
    }
  };

  const handleCoverPromptChange = (e) => {
    setCoverPrompt(e.target.value);
    setCoverPromptDirty(true);
  };

  // Cover model handlers
  const handleSaveCoverModel = async () => {
    if (!coverModel.trim()) {
      setError('Cover model cannot be empty');
      return;
    }

    setLoading(true);
    setError('');
    setSuccess('');

    try {
      await api.updatePodcastCoverModel(coverModel.trim());
      setSuccess('Cover art model saved successfully');
      setCoverModelDirty(false);
      await onReload();
    } catch (err) {
      setError('Failed to save cover model');
    } finally {
      setLoading(false);
    }
  };

  const handleCoverModelChange = (e) => {
    setCoverModel(e.target.value);
    setCoverModelDirty(true);
  };

  // Narration style handlers
  const handleEditStyle = (styleId) => {
    const style = narrationStyles[styleId];
    if (style) {
      setStyleForm({
        id: styleId,
        name: style.name,
        description: style.description,
        prompt: style.prompt,
      });
      setEditingStyle(styleId);
      setStyleDirty(false);
      setShowNewStyleForm(false);
    }
  };

  const handleNewStyle = () => {
    setStyleForm({ id: '', name: '', description: '', prompt: '' });
    setEditingStyle(null);
    setShowNewStyleForm(true);
    setStyleDirty(false);
  };

  const handleStyleFormChange = (field) => (e) => {
    setStyleForm(prev => ({ ...prev, [field]: e.target.value }));
    setStyleDirty(true);
  };

  const handleSaveStyle = async () => {
    if (!styleForm.name.trim() || !styleForm.prompt.trim()) {
      setError('Style name and prompt are required');
      return;
    }

    setLoading(true);
    setError('');
    setSuccess('');

    try {
      if (showNewStyleForm) {
        // Creating new style
        if (!styleForm.id.trim()) {
          setError('Style ID is required');
          setLoading(false);
          return;
        }
        await api.createPodcastStyle({
          id: styleForm.id.trim(),
          name: styleForm.name.trim(),
          description: styleForm.description.trim(),
          prompt: styleForm.prompt.trim(),
        });
        setSuccess('Narration style created successfully');
      } else {
        // Updating existing style
        await api.updatePodcastStyle(editingStyle, {
          name: styleForm.name.trim(),
          description: styleForm.description.trim(),
          prompt: styleForm.prompt.trim(),
        });
        setSuccess('Narration style updated successfully');
      }

      // Reload styles
      const styles = await api.listPodcastStyles();
      setNarrationStyles(styles);
      setStyleDirty(false);
      setShowNewStyleForm(false);
      setEditingStyle(null);
    } catch (err) {
      setError(err.message || 'Failed to save narration style');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteStyle = async (styleId) => {
    if (!confirm(`Delete narration style "${narrationStyles[styleId]?.name}"?`)) {
      return;
    }

    setLoading(true);
    setError('');
    setSuccess('');

    try {
      await api.deletePodcastStyle(styleId);
      setSuccess('Narration style deleted');

      // Reload styles
      const styles = await api.listPodcastStyles();
      setNarrationStyles(styles);

      // Clear form if we were editing this style
      if (editingStyle === styleId) {
        setEditingStyle(null);
        setStyleForm({ id: '', name: '', description: '', prompt: '' });
      }
    } catch (err) {
      setError(err.message || 'Failed to delete narration style');
    } finally {
      setLoading(false);
    }
  };

  const handleCancelStyleEdit = () => {
    setEditingStyle(null);
    setShowNewStyleForm(false);
    setStyleForm({ id: '', name: '', description: '', prompt: '' });
    setStyleDirty(false);
  };

  // Render characters view
  if (showCharacters) {
    return (
      <div className="settings-section podcast-section">
        <div className="characters-back-header">
          <button className="btn-back" onClick={() => setShowCharacters(false)}>
            <X size={16} />
            Back to Settings
          </button>
        </div>
        <CharacterList />
      </div>
    );
  }

  return (
    <div className="settings-section podcast-section">
      {/* TTS Service Status Section */}
      <div id="podcast-tts" className="modal-section">
        <h3>
          <Radio size={18} />
          Voice Service Status
        </h3>
        <p className="section-description">
          Podcast voice generation uses Qwen3-TTS for high-quality text-to-speech synthesis.
        </p>

        <div className="tts-status-block">
          {checkingHealth ? (
            <div className="tts-status checking">
              <RefreshCw size={16} className="spinning" />
              <span>Checking TTS service...</span>
            </div>
          ) : ttsHealth?.healthy ? (
            <div className="tts-status healthy">
              <Check size={16} />
              <div className="tts-status-info">
                <span className="tts-status-label">Qwen3-TTS Service</span>
                <span className="tts-status-text">Connected and ready</span>
              </div>
            </div>
          ) : (
            <div className="tts-status unhealthy">
              <AlertCircle size={16} />
              <div className="tts-status-info">
                <span className="tts-status-label">Qwen3-TTS Service</span>
                <span className="tts-status-text">
                  {ttsHealth?.error || 'Not available'}
                </span>
              </div>
            </div>
          )}
          <button
            className="btn-refresh"
            onClick={checkTtsHealth}
            disabled={checkingHealth}
            title="Refresh status"
          >
            <RefreshCw size={14} className={checkingHealth ? 'spinning' : ''} />
          </button>
        </div>

        {!ttsHealth?.healthy && !checkingHealth && (
          <div className="tts-setup-hint">
            <Info size={16} />
            <p>
              To use podcast voice generation, ensure the Qwen3-TTS service is running.
              Check the documentation for setup instructions.
            </p>
          </div>
        )}

        {/* Voice cloning info */}
        {ttsHealth?.healthy && (
          <div className="voice-cloning-info">
            <Check size={16} />
            <span>Voice cloning available via local CSM model</span>
          </div>
        )}
      </div>

      {/* Characters Section */}
      <div id="podcast-characters" className="modal-section">
        <h3>
          <Users size={18} />
          Voice Characters
        </h3>
        <p className="section-description">
          Create and manage podcast characters with unique voices and personalities.
          Each character can be assigned as host, expert, or narrator.
        </p>

        <button
          className="btn-manage-characters"
          onClick={() => setShowCharacters(true)}
        >
          <Users size={16} />
          Manage Characters
        </button>

        <div className="info-box">
          <Info size={20} />
          <p>
            You need at least 2 characters for Question Time mode (host + expert).
            Explainer mode requires only 1 narrator character.
          </p>
        </div>
      </div>

      {/* Cover Art Settings */}
      <div id="podcast-cover-art" className="modal-section">
        <h3>
          <Image size={18} />
          Cover Art Generation
        </h3>
        <p className="section-description">
          Configure the model and prompt used to generate podcast cover art.
          The episode title and topics will be appended to the prompt.
        </p>

        {/* Cover Model */}
        <div className="cover-model-block">
          <label>Cover Art Model</label>
          <p className="field-description">
            OpenRouter model ID for generating cover images (e.g., google/gemini-2.5-flash-image)
          </p>
          <input
            type="text"
            value={coverModel}
            onChange={handleCoverModelChange}
            placeholder="e.g., google/gemini-2.5-flash-image"
          />
          <div className="btn-group">
            <button
              className="btn-primary"
              onClick={handleSaveCoverModel}
              disabled={loading || !coverModelDirty}
            >
              {loading ? 'Saving...' : 'Save Model'}
            </button>
            {coverModelDirty && (
              <button
                className="btn-secondary"
                onClick={() => {
                  setCoverModel(podcastSettings?.cover_model || '');
                  setCoverModelDirty(false);
                }}
                disabled={loading}
              >
                Reset
              </button>
            )}
          </div>
        </div>

        {/* Cover Prompt */}
        <div className="cover-prompt-block">
          <label>Cover Art Prompt</label>
          <textarea
            className="cover-prompt-textarea"
            value={coverPrompt}
            onChange={handleCoverPromptChange}
            placeholder="Enter the cover art generation prompt..."
            rows={12}
          />
          <div className="btn-group">
            <button
              className="btn-primary"
              onClick={handleSaveCoverPrompt}
              disabled={loading || !coverPromptDirty}
            >
              {loading ? 'Saving...' : 'Save Prompt'}
            </button>
            {coverPromptDirty && (
              <button
                className="btn-secondary"
                onClick={() => {
                  setCoverPrompt(podcastSettings?.cover_prompt || '');
                  setCoverPromptDirty(false);
                }}
                disabled={loading}
              >
                Reset
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Narration Styles */}
      <div id="podcast-narration" className="modal-section">
        <h3>
          <Radio size={18} />
          Narration Styles
        </h3>
        <p className="section-description">
          Define narration styles for podcast generation. Each style has a name, description, and full prompt
          that guides how the AI generates the podcast dialogue.
        </p>

        {/* Style List */}
        <div className="narration-styles-list">
          {stylesLoading ? (
            <div className="styles-loading">Loading styles...</div>
          ) : (
            Object.entries(narrationStyles).map(([id, style]) => (
              <div
                key={id}
                className={`narration-style-item ${editingStyle === id ? 'editing' : ''}`}
              >
                <div className="style-info">
                  <span className="style-name">{style.name}</span>
                  <span className="style-description">{style.description}</span>
                  <span className="style-id">ID: {id}</span>
                </div>
                <div className="style-actions">
                  <button
                    className="btn-icon"
                    onClick={() => handleEditStyle(id)}
                    title="Edit style"
                  >
                    <Edit3 size={16} />
                  </button>
                  <button
                    className="btn-icon btn-danger"
                    onClick={() => handleDeleteStyle(id)}
                    title="Delete style"
                    disabled={Object.keys(narrationStyles).length <= 1}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Add New Style Button */}
        {!showNewStyleForm && !editingStyle && (
          <button className="btn-secondary add-style-btn" onClick={handleNewStyle}>
            <Plus size={16} />
            Add New Style
          </button>
        )}

        {/* Style Editor Form */}
        {(showNewStyleForm || editingStyle) && (
          <div className="style-editor-form">
            <h4>{showNewStyleForm ? 'Create New Style' : `Edit: ${styleForm.name}`}</h4>

            {showNewStyleForm && (
              <div className="form-row">
                <label>Style ID</label>
                <input
                  type="text"
                  value={styleForm.id}
                  onChange={handleStyleFormChange('id')}
                  placeholder="e.g., my-custom-style"
                  className="style-input"
                />
                <span className="field-hint">Unique identifier, used internally (lowercase, hyphens allowed)</span>
              </div>
            )}

            <div className="form-row">
              <label>Display Name</label>
              <input
                type="text"
                value={styleForm.name}
                onChange={handleStyleFormChange('name')}
                placeholder="e.g., My Custom Style"
                className="style-input"
              />
            </div>

            <div className="form-row">
              <label>Short Description</label>
              <input
                type="text"
                value={styleForm.description}
                onChange={handleStyleFormChange('description')}
                placeholder="Brief description shown in style picker"
                className="style-input"
              />
            </div>

            <div className="form-row">
              <label>Full Prompt</label>
              <textarea
                value={styleForm.prompt}
                onChange={handleStyleFormChange('prompt')}
                placeholder="Enter the full narration style prompt..."
                className="style-prompt-textarea"
                rows={15}
              />
            </div>

            <div className="btn-group">
              <button
                className="btn-primary"
                onClick={handleSaveStyle}
                disabled={loading || !styleDirty}
              >
                {loading ? 'Saving...' : showNewStyleForm ? 'Create Style' : 'Save Changes'}
              </button>
              <button
                className="btn-secondary"
                onClick={handleCancelStyleEdit}
                disabled={loading}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
