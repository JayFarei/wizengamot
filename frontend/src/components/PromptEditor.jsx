import { useState, useEffect } from 'react';
import { api } from '../api';
import './PromptEditor.css';

/**
 * Component for creating or editing system prompts.
 */
export default function PromptEditor({ prompt, onSave, onCancel }) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const isEditing = !!prompt;

  useEffect(() => {
    if (prompt) {
      // Extract title from first line
      const lines = prompt.content.split('\n');
      const firstLine = lines[0] || '';
      const extractedTitle = firstLine.startsWith('# ')
        ? firstLine.substring(2).trim()
        : prompt.title;

      setTitle(extractedTitle);
      setContent(prompt.content);
    }
  }, [prompt]);

  const handleSave = async () => {
    if (!title.trim()) {
      setError('Title is required');
      return;
    }

    if (!content.trim()) {
      setError('Content is required');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      // Ensure content starts with title as H1
      let finalContent = content.trim();
      if (!finalContent.startsWith(`# ${title}`)) {
        finalContent = `# ${title}\n\n${finalContent}`;
      }

      if (isEditing) {
        await api.updatePrompt(prompt.filename, finalContent);
      } else {
        await api.createPrompt(title, finalContent);
      }

      onSave();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="prompt-editor-overlay">
      <div className="prompt-editor">
        <h2>{isEditing ? 'Edit Prompt' : 'Create New Prompt'}</h2>

        {error && <div className="error-message">{error}</div>}

        <div className="form-group">
          <label htmlFor="prompt-title">Title</label>
          <input
            id="prompt-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g., Technical Expert"
            disabled={saving}
          />
        </div>

        <div className="form-group">
          <label htmlFor="prompt-content">Content</label>
          <textarea
            id="prompt-content"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Enter the system prompt that will guide the AI models..."
            rows={15}
            disabled={saving}
          />
          <div className="form-hint">
            The title will automatically be added as a markdown heading.
          </div>
        </div>

        <div className="prompt-editor-actions">
          <button onClick={onCancel} className="btn-secondary" disabled={saving}>
            Cancel
          </button>
          <button onClick={handleSave} className="btn-primary" disabled={saving}>
            {saving ? 'Saving...' : isEditing ? 'Update' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
