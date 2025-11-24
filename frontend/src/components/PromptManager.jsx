import { useState, useEffect } from 'react';
import { api } from '../api';
import PromptEditor from './PromptEditor';
import './PromptManager.css';

/**
 * Full-featured prompt management component with list, create, edit, and delete.
 */
export default function PromptManager({ onSelect, onClose }) {
  const [prompts, setPrompts] = useState([]);
  const [selectedPrompt, setSelectedPrompt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showEditor, setShowEditor] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState(null);

  useEffect(() => {
    loadPrompts();
  }, []);

  const loadPrompts = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.listPrompts();
      setPrompts(data);
      if (data.length > 0 && !selectedPrompt) {
        setSelectedPrompt(data[0]);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSelect = () => {
    if (selectedPrompt) {
      onSelect(selectedPrompt.content);
    }
  };

  const handleSkip = () => {
    onSelect(null);
  };

  const handleCreateNew = () => {
    setEditingPrompt(null);
    setShowEditor(true);
  };

  const handleEdit = (prompt) => {
    setEditingPrompt(prompt);
    setShowEditor(true);
  };

  const handleDelete = async (prompt) => {
    if (!confirm(`Are you sure you want to delete "${prompt.title}"?`)) {
      return;
    }

    try {
      await api.deletePrompt(prompt.filename);
      await loadPrompts();
      if (selectedPrompt?.filename === prompt.filename) {
        setSelectedPrompt(prompts[0] || null);
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const handleEditorSave = async () => {
    setShowEditor(false);
    setEditingPrompt(null);
    await loadPrompts();
  };

  const handleEditorCancel = () => {
    setShowEditor(false);
    setEditingPrompt(null);
  };

  if (showEditor) {
    return (
      <PromptEditor
        prompt={editingPrompt}
        onSave={handleEditorSave}
        onCancel={handleEditorCancel}
      />
    );
  }

  if (loading) {
    return (
      <div className="prompt-manager-overlay">
        <div className="prompt-manager">
          <p>Loading prompts...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="prompt-manager-overlay">
      <div className="prompt-manager">
        <div className="prompt-manager-header">
          <h2>Select System Prompt</h2>
          <button onClick={handleCreateNew} className="btn-create">
            + New Prompt
          </button>
        </div>

        <p className="prompt-manager-description">
          Choose a system prompt to guide the council's responses, or skip to use the default behavior.
        </p>

        {error && <div className="error-message">{error}</div>}

        {prompts.length === 0 ? (
          <div className="no-prompts">
            <p>No prompts available yet.</p>
            <button onClick={handleCreateNew} className="btn-primary">
              Create Your First Prompt
            </button>
          </div>
        ) : (
          <div className="prompt-manager-content">
            <div className="prompt-list">
              {prompts.map((prompt) => (
                <div
                  key={prompt.filename}
                  className={`prompt-item ${
                    selectedPrompt?.filename === prompt.filename ? 'selected' : ''
                  }`}
                  onClick={() => setSelectedPrompt(prompt)}
                >
                  <div className="prompt-item-header">
                    <div className="prompt-item-title">{prompt.title}</div>
                    <div className="prompt-item-actions">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleEdit(prompt);
                        }}
                        className="btn-icon"
                        title="Edit"
                      >
                        ✏️
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(prompt);
                        }}
                        className="btn-icon"
                        title="Delete"
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                  <div className="prompt-item-preview">
                    {prompt.content.split('\n').slice(1, 3).join(' ').substring(0, 120)}...
                  </div>
                </div>
              ))}
            </div>

            {selectedPrompt && (
              <div className="prompt-preview">
                <h3>Preview: {selectedPrompt.title}</h3>
                <pre className="prompt-content">{selectedPrompt.content}</pre>
              </div>
            )}
          </div>
        )}

        <div className="prompt-manager-actions">
          <button onClick={handleSkip} className="btn-secondary">
            Skip (Use Default)
          </button>
          <button
            onClick={handleSelect}
            className="btn-primary"
            disabled={!selectedPrompt}
          >
            Use This Prompt
          </button>
        </div>
      </div>
    </div>
  );
}
