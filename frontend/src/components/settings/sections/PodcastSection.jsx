import { useState, useEffect } from 'react';
import { Info, Image, Mic, User, GraduationCap, ChevronDown, ChevronUp, Radio, Plus, Trash2, Edit3 } from 'lucide-react';
import { api } from '../../../api';
import './PodcastSection.css';

export default function PodcastSection({
  podcastSettings,
  loading,
  setLoading,
  setError,
  setSuccess,
  onReload,
}) {
  // ElevenLabs API Key state
  const [elevenLabsKey, setElevenLabsKey] = useState('');

  // Host speaker state
  const [hostConfig, setHostConfig] = useState({
    voice_id: '',
    model: '',
    stability: 0.5,
    similarity_boost: 0.75,
    style: 0.3,
    speed: 1.0,
    system_prompt: '',
  });
  const [hostDirty, setHostDirty] = useState(false);
  const [hostExpanded, setHostExpanded] = useState(true);

  // Expert speaker state
  const [expertConfig, setExpertConfig] = useState({
    voice_id: '',
    model: '',
    stability: 0.5,
    similarity_boost: 0.75,
    style: 0.3,
    speed: 1.0,
    system_prompt: '',
  });
  const [expertDirty, setExpertDirty] = useState(false);
  const [expertExpanded, setExpertExpanded] = useState(false);

  // Cover art state
  const [coverPrompt, setCoverPrompt] = useState('');
  const [coverPromptDirty, setCoverPromptDirty] = useState(false);
  const [coverModel, setCoverModel] = useState('');
  const [coverModelDirty, setCoverModelDirty] = useState(false);

  // Narration styles state
  const [narrationStyles, setNarrationStyles] = useState({});
  const [stylesLoading, setStylesLoading] = useState(true);
  const [editingStyle, setEditingStyle] = useState(null); // style id being edited
  const [styleForm, setStyleForm] = useState({ id: '', name: '', description: '', prompt: '' });
  const [styleDirty, setStyleDirty] = useState(false);
  const [showNewStyleForm, setShowNewStyleForm] = useState(false);

  // Initialize host config from settings
  useEffect(() => {
    if (podcastSettings?.host_config && !hostDirty) {
      const hc = podcastSettings.host_config;
      setHostConfig({
        voice_id: hc.voice_id || '',
        model: hc.model || '',
        stability: hc.voice_settings?.stability ?? 0.5,
        similarity_boost: hc.voice_settings?.similarity_boost ?? 0.75,
        style: hc.voice_settings?.style ?? 0.3,
        speed: hc.voice_settings?.speed ?? 1.0,
        system_prompt: hc.system_prompt || '',
      });
    }
  }, [podcastSettings?.host_config, hostDirty]);

  // Initialize expert config from settings
  useEffect(() => {
    if (podcastSettings?.expert_config && !expertDirty) {
      const ec = podcastSettings.expert_config;
      setExpertConfig({
        voice_id: ec.voice_id || '',
        model: ec.model || '',
        stability: ec.voice_settings?.stability ?? 0.5,
        similarity_boost: ec.voice_settings?.similarity_boost ?? 0.75,
        style: ec.voice_settings?.style ?? 0.3,
        speed: ec.voice_settings?.speed ?? 1.0,
        system_prompt: ec.system_prompt || '',
      });
    }
  }, [podcastSettings?.expert_config, expertDirty]);

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

  // ElevenLabs API Key handlers
  const handleSaveElevenLabsKey = async () => {
    if (!elevenLabsKey.trim()) {
      setError('Please enter an ElevenLabs API key');
      return;
    }

    setLoading(true);
    setError('');
    setSuccess('');

    try {
      await api.updateElevenLabsApiKey(elevenLabsKey.trim());
      setSuccess('ElevenLabs API key saved successfully');
      setElevenLabsKey('');
      await onReload();
    } catch (err) {
      setError('Failed to save ElevenLabs API key');
    } finally {
      setLoading(false);
    }
  };

  const handleClearElevenLabsKey = async () => {
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      await api.clearElevenLabsApiKey();
      setSuccess('ElevenLabs API key cleared');
      await onReload();
    } catch (err) {
      setError('Failed to clear ElevenLabs API key');
    } finally {
      setLoading(false);
    }
  };

  // Host config handlers
  const handleHostChange = (field) => (e) => {
    const value = e.target.type === 'range' ? parseFloat(e.target.value) : e.target.value;
    setHostConfig(prev => ({ ...prev, [field]: value }));
    setHostDirty(true);
  };

  const handleSaveHostConfig = async () => {
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      await api.updateHostConfig({
        voice_id: hostConfig.voice_id,
        model: hostConfig.model,
        stability: hostConfig.stability,
        similarity_boost: hostConfig.similarity_boost,
        style: hostConfig.style,
        speed: hostConfig.speed,
        system_prompt: hostConfig.system_prompt,
      });
      setSuccess('Host configuration saved successfully');
      setHostDirty(false);
      await onReload();
    } catch (err) {
      setError('Failed to save host configuration');
    } finally {
      setLoading(false);
    }
  };

  const handleResetHostConfig = () => {
    if (podcastSettings?.host_config) {
      const hc = podcastSettings.host_config;
      setHostConfig({
        voice_id: hc.voice_id || '',
        model: hc.model || '',
        stability: hc.voice_settings?.stability ?? 0.5,
        similarity_boost: hc.voice_settings?.similarity_boost ?? 0.75,
        style: hc.voice_settings?.style ?? 0.3,
        speed: hc.voice_settings?.speed ?? 1.0,
        system_prompt: hc.system_prompt || '',
      });
    }
    setHostDirty(false);
  };

  // Expert config handlers
  const handleExpertChange = (field) => (e) => {
    const value = e.target.type === 'range' ? parseFloat(e.target.value) : e.target.value;
    setExpertConfig(prev => ({ ...prev, [field]: value }));
    setExpertDirty(true);
  };

  const handleSaveExpertConfig = async () => {
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      await api.updateExpertConfig({
        voice_id: expertConfig.voice_id,
        model: expertConfig.model,
        stability: expertConfig.stability,
        similarity_boost: expertConfig.similarity_boost,
        style: expertConfig.style,
        speed: expertConfig.speed,
        system_prompt: expertConfig.system_prompt,
      });
      setSuccess('Expert configuration saved successfully');
      setExpertDirty(false);
      await onReload();
    } catch (err) {
      setError('Failed to save expert configuration');
    } finally {
      setLoading(false);
    }
  };

  const handleResetExpertConfig = () => {
    if (podcastSettings?.expert_config) {
      const ec = podcastSettings.expert_config;
      setExpertConfig({
        voice_id: ec.voice_id || '',
        model: ec.model || '',
        stability: ec.voice_settings?.stability ?? 0.5,
        similarity_boost: ec.voice_settings?.similarity_boost ?? 0.75,
        style: ec.voice_settings?.style ?? 0.3,
        speed: ec.voice_settings?.speed ?? 1.0,
        system_prompt: ec.system_prompt || '',
      });
    }
    setExpertDirty(false);
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

  // Get available voices and models from settings
  const availableVoices = podcastSettings?.available_voices || {};
  const availableModels = podcastSettings?.available_models || {};

  // Render speaker config section
  const renderSpeakerConfig = (
    title,
    icon,
    config,
    handleChange,
    handleSave,
    handleReset,
    isDirty,
    expanded,
    setExpanded,
    colorClass
  ) => (
    <div className={`speaker-config-block ${colorClass}`}>
      <button
        className="speaker-header"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="speaker-title">
          {icon}
          <span>{title}</span>
          {isDirty && <span className="dirty-indicator">*</span>}
        </div>
        {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
      </button>

      {expanded && (
        <div className="speaker-content">
          {/* Voice Selection */}
          <div className="voice-setting-row">
            <label>Voice</label>
            <select
              value={config.voice_id}
              onChange={handleChange('voice_id')}
            >
              {Object.entries(availableVoices).map(([id, voice]) => (
                <option key={id} value={id}>
                  {voice.name} - {voice.description}
                </option>
              ))}
            </select>
          </div>

          {/* Model Selection */}
          <div className="voice-setting-row">
            <label>Model</label>
            <select
              value={config.model}
              onChange={handleChange('model')}
            >
              {Object.entries(availableModels).map(([id, model]) => (
                <option key={id} value={id}>
                  {model.name} - {model.description}
                </option>
              ))}
            </select>
          </div>

          {/* Stability Slider */}
          <div className="voice-setting-row slider-row">
            <label>
              Stability
              <span className="slider-value">{config.stability.toFixed(2)}</span>
            </label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={config.stability}
              onChange={handleChange('stability')}
            />
            <div className="slider-labels">
              <span>Variable</span>
              <span>Stable</span>
            </div>
          </div>

          {/* Similarity Boost Slider */}
          <div className="voice-setting-row slider-row">
            <label>
              Similarity Boost
              <span className="slider-value">{config.similarity_boost.toFixed(2)}</span>
            </label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={config.similarity_boost}
              onChange={handleChange('similarity_boost')}
            />
            <div className="slider-labels">
              <span>Low</span>
              <span>High</span>
            </div>
          </div>

          {/* Style Slider */}
          <div className="voice-setting-row slider-row">
            <label>
              Style
              <span className="slider-value">{config.style.toFixed(2)}</span>
            </label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={config.style}
              onChange={handleChange('style')}
            />
            <div className="slider-labels">
              <span>Neutral</span>
              <span>Expressive</span>
            </div>
          </div>

          {/* Speed Slider */}
          <div className="voice-setting-row slider-row">
            <label>
              Speed
              <span className="slider-value">{config.speed.toFixed(2)}x</span>
            </label>
            <input
              type="range"
              min="0.5"
              max="2"
              step="0.05"
              value={config.speed}
              onChange={handleChange('speed')}
            />
            <div className="slider-labels">
              <span>0.5x</span>
              <span>2x</span>
            </div>
          </div>

          {/* System Prompt */}
          <div className="voice-setting-row">
            <label>System Prompt</label>
            <textarea
              className="system-prompt-textarea"
              value={config.system_prompt}
              onChange={handleChange('system_prompt')}
              placeholder={`Enter the ${title.toLowerCase()}'s personality and speaking style...`}
              rows={6}
            />
          </div>

          {/* Save/Reset buttons */}
          <div className="btn-group">
            <button
              className="btn-primary"
              onClick={handleSave}
              disabled={loading || !isDirty}
            >
              {loading ? 'Saving...' : `Save ${title} Config`}
            </button>
            {isDirty && (
              <button
                className="btn-secondary"
                onClick={handleReset}
                disabled={loading}
              >
                Reset
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="settings-section podcast-section">
      {/* ElevenLabs API Key Section */}
      <div className="modal-section">
        <h3>
          <Mic size={18} />
          ElevenLabs TTS
        </h3>
        <p className="section-description">
          Configure ElevenLabs API for high-quality text-to-speech voice generation.
          Get your API key at{' '}
          <a href="https://elevenlabs.io" target="_blank" rel="noopener noreferrer">
            elevenlabs.io
          </a>
        </p>

        <div className="api-key-block">
          <div className="api-key-header">
            <strong>API Key</strong>
          </div>
          {podcastSettings && (
            <div className="api-key-status">
              <span className={`status-indicator ${podcastSettings.elevenlabs_configured ? 'configured' : 'not-configured'}`}>
                {podcastSettings.elevenlabs_configured ? 'Configured' : 'Not Configured'}
              </span>
              {podcastSettings.elevenlabs_configured && podcastSettings.elevenlabs_source && (
                <span className="status-source">
                  (via {podcastSettings.elevenlabs_source === 'settings' ? 'saved settings' : 'environment variable'})
                </span>
              )}
            </div>
          )}
          <input
            type="password"
            placeholder="Enter ElevenLabs API key..."
            value={elevenLabsKey}
            onChange={(e) => setElevenLabsKey(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSaveElevenLabsKey()}
          />
          <div className="btn-group">
            <button
              className="btn-primary"
              onClick={handleSaveElevenLabsKey}
              disabled={loading || !elevenLabsKey.trim()}
            >
              {loading ? 'Saving...' : 'Save Key'}
            </button>
            {podcastSettings?.elevenlabs_source === 'settings' && (
              <button
                className="btn-secondary"
                onClick={handleClearElevenLabsKey}
                disabled={loading}
              >
                Clear
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Speaker Configuration - only show if ElevenLabs is configured */}
      {podcastSettings?.elevenlabs_configured && (
        <div className="modal-section">
          <h3>Speaker Configuration</h3>
          <p className="section-description">
            Configure the two speakers for your podcast. Each speaker has their own voice, settings, and personality prompt.
          </p>

          {/* Host Configuration */}
          {renderSpeakerConfig(
            'Host',
            <User size={18} />,
            hostConfig,
            handleHostChange,
            handleSaveHostConfig,
            handleResetHostConfig,
            hostDirty,
            hostExpanded,
            setHostExpanded,
            'host-config'
          )}

          {/* Expert Configuration */}
          {renderSpeakerConfig(
            'Expert',
            <GraduationCap size={18} />,
            expertConfig,
            handleExpertChange,
            handleSaveExpertConfig,
            handleResetExpertConfig,
            expertDirty,
            expertExpanded,
            setExpertExpanded,
            'expert-config'
          )}

          <div className="info-box">
            <Info size={20} />
            <p>
              The Host introduces topics and guides the conversation while the Expert provides detailed explanations and insights.
              Customize their voices and personalities to match your podcast style.
            </p>
          </div>
        </div>
      )}

      {/* Cover Art Settings */}
      <div className="modal-section">
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
      <div className="modal-section">
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
