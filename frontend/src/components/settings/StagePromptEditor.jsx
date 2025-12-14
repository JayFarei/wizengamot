import { useState, useEffect } from 'react';
import { api } from '../../api';
import './StagePromptEditor.css';

export default function StagePromptEditor({ promptType, onClose }) {
  const [content, setContent] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const [isCustom, setIsCustom] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    loadPrompt();
  }, [promptType]);

  const loadPrompt = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.getStagePrompt(promptType);
      setContent(data.content || '');
      setOriginalContent(data.content || '');
      setIsCustom(data.is_custom || false);
    } catch (err) {
      setError('Failed to load prompt');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!content.trim()) {
      setError('Content cannot be empty');
      return;
    }

    setSaving(true);
    setError('');
    setSuccess('');

    try {
      await api.updateStagePrompt(promptType, content);
      setOriginalContent(content);
      setIsCustom(true);
      setSuccess('Prompt saved successfully');
    } catch (err) {
      setError(err.message || 'Failed to save prompt');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (!confirm('Are you sure you want to reset to the default prompt? Your custom changes will be lost.')) {
      return;
    }

    setSaving(true);
    setError('');
    setSuccess('');

    try {
      const data = await api.resetStagePrompt(promptType);
      setContent(data.content || '');
      setOriginalContent(data.content || '');
      setIsCustom(false);
      setSuccess('Prompt reset to default');
    } catch (err) {
      setError(err.message || 'Failed to reset prompt');
    } finally {
      setSaving(false);
    }
  };

  const hasChanges = content !== originalContent;

  const getTitle = () => {
    switch (promptType) {
      case 'ranking':
        return 'Stage 2: Ranking Prompt';
      case 'chairman':
        return 'Stage 3: Chairman Prompt';
      default:
        return 'Stage Prompt';
    }
  };

  const getDescription = () => {
    switch (promptType) {
      case 'ranking':
        return 'This prompt is used when models evaluate and rank each other\'s responses anonymously. Use {user_query} and {responses_text} as placeholders.';
      case 'chairman':
        return 'This prompt is used by the chairman model to synthesize the final answer. Use {user_query}, {stage1_text}, and {stage2_text} as placeholders.';
      default:
        return '';
    }
  };

  if (loading) {
    return (
      <div className="stage-prompt-editor">
        <div className="stage-prompt-loading">Loading prompt...</div>
      </div>
    );
  }

  return (
    <div className="stage-prompt-editor">
      <div className="stage-prompt-header">
        <div className="stage-prompt-title-row">
          <h4>{getTitle()}</h4>
          {isCustom && <span className="custom-badge">Custom</span>}
        </div>
        <p className="stage-prompt-description">{getDescription()}</p>
      </div>

      <textarea
        className="stage-prompt-textarea"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        disabled={saving}
        rows={16}
        placeholder="Enter prompt content..."
      />

      {error && <div className="stage-prompt-error">{error}</div>}
      {success && <div className="stage-prompt-success">{success}</div>}

      <div className="stage-prompt-actions">
        <button
          className="btn-secondary"
          onClick={handleReset}
          disabled={saving || !isCustom}
          title={isCustom ? 'Reset to built-in default' : 'Already using default'}
        >
          Reset to Default
        </button>
        <div className="stage-prompt-actions-right">
          {onClose && (
            <button className="btn-secondary" onClick={onClose} disabled={saving}>
              Cancel
            </button>
          )}
          <button
            className="btn-primary"
            onClick={handleSave}
            disabled={saving || !hasChanges}
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
