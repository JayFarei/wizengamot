import { useState, useEffect } from 'react';
import { api } from '../../../api';
import StagePromptEditorModal from '../StagePromptEditorModal';
import PromptEditorModal from '../../PromptEditorModal';
import './CouncilSection.css';

export default function CouncilSection({
  modelSettings,
  prompts,
  loading,
  setLoading,
  setError,
  setSuccess,
  onReload,
  defaultPrompt = null,
}) {
  const [editingStagePrompt, setEditingStagePrompt] = useState(null);
  const [showPromptEditor, setShowPromptEditor] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState(null);
  const [editingPromptContent, setEditingPromptContent] = useState('');
  const [editingPromptTitle, setEditingPromptTitle] = useState('');
  const [isNewPrompt, setIsNewPrompt] = useState(false);

  // Filter prompts to only show council prompts
  const councilPrompts = prompts.filter((p) => p.mode === 'council');

  const getModelShortName = (model) => model.split('/')[1] || model;

  // Council Models handlers
  const handleToggleCouncilModel = async (model) => {
    const isSelected = modelSettings.council_models.includes(model);
    let newCouncil;

    if (isSelected) {
      if (modelSettings.council_models.length <= 1) {
        setError('At least one council member required');
        return;
      }
      newCouncil = modelSettings.council_models.filter((m) => m !== model);
    } else {
      newCouncil = [...modelSettings.council_models, model];
    }

    setLoading(true);
    setError('');
    setSuccess('');

    try {
      await api.updateCouncilModels(newCouncil);
      setSuccess('Council updated');
      await onReload();
    } catch (err) {
      setError('Failed to update council');
    } finally {
      setLoading(false);
    }
  };

  // Chairman handler
  const handleChairmanChange = async (model) => {
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      await api.updateChairman(model);
      setSuccess('Chairman updated');
      await onReload();
    } catch (err) {
      setError('Failed to update chairman');
    } finally {
      setLoading(false);
    }
  };

  // Default Prompt handler
  const handleDefaultPromptChange = async (filename) => {
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      await api.updateDefaultPrompt(filename || null);
      setSuccess('Default prompt updated');
      await onReload();
    } catch (err) {
      setError('Failed to update default prompt');
    } finally {
      setLoading(false);
    }
  };

  // Prompt CRUD
  const handleEditPrompt = async (filename) => {
    try {
      const prompt = await api.getPrompt(filename, 'council');
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
        await api.createPrompt(title, content, 'council');
        setSuccess('Prompt created');
      } else {
        await api.updatePrompt(editingPrompt, content, 'council');
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
      await api.deletePrompt(filename, 'council');
      setSuccess('Prompt deleted');
      await onReload();
    } catch (err) {
      setError('Failed to delete prompt');
    } finally {
      setLoading(false);
    }
  };

  // Auto-open prompt editor when defaultPrompt is provided
  useEffect(() => {
    const openPromptIfExists = async () => {
      if (defaultPrompt && councilPrompts.length > 0) {
        const promptExists = councilPrompts.some(p => p.filename === defaultPrompt);
        if (promptExists) {
          try {
            const prompt = await api.getPrompt(defaultPrompt, 'council');
            setEditingPrompt(defaultPrompt);
            setEditingPromptTitle(prompt.title || defaultPrompt);
            setEditingPromptContent(prompt.content);
            setIsNewPrompt(false);
            setShowPromptEditor(true);
          } catch {
            setError('Failed to load prompt');
          }
        }
      }
    };
    openPromptIfExists();
  }, [defaultPrompt, councilPrompts, setError]);

  return (
    <div className="settings-section council-section">
      {/* Council Members */}
      <div className="modal-section">
        <h3>Default Council Members</h3>
        <p className="section-description">
          Select which models participate in new conversations by default
        </p>
        <div className="model-checkboxes">
          {modelSettings?.model_pool.map((model) => (
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

      {/* Chairman */}
      <div className="modal-section">
        <h3>Default Chairman</h3>
        <p className="section-description">Model that synthesizes the final answer</p>
        <select
          className="chairman-select"
          value={modelSettings?.chairman_model || ''}
          onChange={(e) => handleChairmanChange(e.target.value)}
          disabled={loading}
        >
          {modelSettings?.model_pool.map((model) => (
            <option key={model} value={model}>
              {getModelShortName(model)}
            </option>
          ))}
        </select>
      </div>

      {/* Stage Prompts */}
      <div className="modal-section">
        <h3>Stage Prompts</h3>
        <p className="section-description">
          Customize the prompts used for ranking (Stage 2) and synthesis (Stage 3)
        </p>

        <div className="stage-prompts-list">
          <div className="stage-prompt-item">
            <div className="stage-prompt-info">
              <span className="stage-prompt-title">Stage 2: Ranking Prompt</span>
              <span className="stage-prompt-desc">Used when models evaluate each other</span>
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
              <span className="stage-prompt-desc">Used for final synthesis</span>
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
        mode="council"
      />

      {/* System Prompts */}
      <div className="modal-section">
        <h3>Default System Prompt</h3>
        <p className="section-description">System prompt used for new Council conversations</p>
        <select
          className="chairman-select"
          value={modelSettings?.default_prompt || ''}
          onChange={(e) => handleDefaultPromptChange(e.target.value)}
          disabled={loading}
        >
          <option value="">None (default behavior)</option>
          {councilPrompts.map((prompt) => (
            <option key={prompt.filename} value={prompt.filename}>
              {prompt.title}
            </option>
          ))}
        </select>
      </div>

      <div className="modal-section">
        <div className="section-header">
          <h3>System Prompts</h3>
          <button className="btn-small btn-primary" onClick={handleNewPrompt}>
            + New Prompt
          </button>
        </div>

        <div className="prompts-list">
          {councilPrompts.length === 0 ? (
            <p className="no-prompts">No prompts yet. Create one to get started.</p>
          ) : (
            councilPrompts.map((prompt) => (
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
