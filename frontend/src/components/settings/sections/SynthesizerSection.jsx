import { useState } from 'react';
import { api } from '../../../api';
import PromptEditorModal from '../../PromptEditorModal';
import StagePromptEditorModal from '../StagePromptEditorModal';
import './SynthesizerSection.css';

export default function SynthesizerSection({
  modelSettings,
  synthesizerSettings,
  prompts,
  loading,
  setLoading,
  setError,
  setSuccess,
  onReload,
}) {
  const [showPromptEditor, setShowPromptEditor] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState(null);
  const [editingPromptContent, setEditingPromptContent] = useState('');
  const [editingPromptTitle, setEditingPromptTitle] = useState('');
  const [isNewPrompt, setIsNewPrompt] = useState(false);
  const [editingStagePrompt, setEditingStagePrompt] = useState(null);

  // Filter prompts to only show synthesizer prompts
  const synthesizerPrompts = prompts.filter((p) => p.mode === 'synthesizer');

  const getModelShortName = (model) => model.split('/')[1] || model;

  // Synthesizer Settings handlers
  const handleSynthesizerModelChange = async (model) => {
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      await api.updateSynthesizerSettings(model, null, null);
      setSuccess('Synthesizer model updated');
      await onReload();
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
      await onReload();
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
      await onReload();
    } catch (err) {
      setError('Failed to update synthesizer prompt');
    } finally {
      setLoading(false);
    }
  };

  // Prompt CRUD
  const handleEditPrompt = async (filename) => {
    try {
      const prompt = await api.getPrompt(filename, 'synthesizer');
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
        await api.createPrompt(title, content, 'synthesizer');
        setSuccess('Prompt created');
      } else {
        await api.updatePrompt(editingPrompt, content, 'synthesizer');
        setSuccess('Prompt saved');
      }
      setShowPromptEditor(false);
      setEditingPrompt(null);
      await onReload();
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
      await api.deletePrompt(filename, 'synthesizer');
      setSuccess('Prompt deleted');
      await onReload();
    } catch (err) {
      setError('Failed to delete prompt');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="settings-section synthesizer-section">
      <div id="synthesizer-settings" className="modal-section">
        <h3>Synthesizer Settings</h3>
        <p className="section-description">
          Configure default behavior for the Synthesizer mode
        </p>

        {synthesizerSettings && modelSettings && (
          <>
            <div className="setting-row">
              <label>Default Model</label>
              <select
                className="setting-select"
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
                className="setting-select"
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
                className="setting-select"
                value={synthesizerSettings.default_prompt || 'zettel.md'}
                onChange={(e) => handleSynthesizerPromptChange(e.target.value)}
                disabled={loading}
              >
                {synthesizerPrompts.map((prompt) => (
                  <option key={prompt.filename} value={prompt.filename}>
                    {prompt.title}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}
      </div>

      <div id="synthesizer-prompts" className="modal-section">
        <div className="section-header">
          <h3>Synthesizer Prompts</h3>
          <button className="btn-small btn-primary" onClick={handleNewPrompt}>
            + New Prompt
          </button>
        </div>

        <div className="prompts-list">
          {synthesizerPrompts.length === 0 ? (
            <p className="no-prompts">No prompts yet. Create one to get started.</p>
          ) : (
            synthesizerPrompts.map((prompt) => (
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

      {/* Stage Prompts for Deliberation Mode */}
      <div id="synthesizer-stage-prompts" className="modal-section">
        <h3>Stage Prompts</h3>
        <p className="section-description">
          Customize the prompts used for ranking and synthesis in deliberation mode
        </p>

        <div className="stage-prompts-list">
          <div className="stage-prompt-item">
            <div className="stage-prompt-info">
              <span className="stage-prompt-title">Stage 2: Ranking Prompt</span>
              <span className="stage-prompt-desc">Used when models evaluate each other&apos;s notes</span>
            </div>
            <button
              className="btn-small btn-secondary"
              onClick={() => setEditingStagePrompt('ranking')}
            >
              Edit
            </button>
          </div>
          <div className="stage-prompt-item">
            <div className="stage-prompt-info">
              <span className="stage-prompt-title">Stage 3: Chairman Prompt</span>
              <span className="stage-prompt-desc">Used for final note synthesis</span>
            </div>
            <button
              className="btn-small btn-secondary"
              onClick={() => setEditingStagePrompt('chairman')}
            >
              Edit
            </button>
          </div>
        </div>

      </div>

      <StagePromptEditorModal
        isOpen={!!editingStagePrompt}
        onClose={() => setEditingStagePrompt(null)}
        promptType={editingStagePrompt}
        mode="synthesizer"
      />

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
