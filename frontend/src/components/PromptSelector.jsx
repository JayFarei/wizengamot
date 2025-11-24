import { useState, useEffect } from 'react';
import { api } from '../api';
import './PromptSelector.css';

/**
 * Component for selecting or managing system prompts.
 */
export default function PromptSelector({ onSelect, onClose }) {
  const [prompts, setPrompts] = useState([]);
  const [selectedPrompt, setSelectedPrompt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadPrompts();
  }, []);

  const loadPrompts = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.listPrompts();
      setPrompts(data);
      if (data.length > 0) {
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

  if (loading) {
    return (
      <div className="prompt-selector-overlay">
        <div className="prompt-selector">
          <p>Loading prompts...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="prompt-selector-overlay">
        <div className="prompt-selector">
          <h2>Error Loading Prompts</h2>
          <p className="error-message">{error}</p>
          <div className="prompt-selector-actions">
            <button onClick={handleSkip}>Continue Without Prompt</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="prompt-selector-overlay">
      <div className="prompt-selector">
        <h2>Select System Prompt</h2>
        <p className="prompt-selector-description">
          Choose a system prompt to guide the council's responses, or skip to use the default behavior.
        </p>

        {prompts.length === 0 ? (
          <div className="no-prompts">
            <p>No prompts available yet.</p>
          </div>
        ) : (
          <div className="prompt-list">
            {prompts.map((prompt) => (
              <div
                key={prompt.filename}
                className={`prompt-item ${
                  selectedPrompt?.filename === prompt.filename ? 'selected' : ''
                }`}
                onClick={() => setSelectedPrompt(prompt)}
              >
                <div className="prompt-item-title">{prompt.title}</div>
                <div className="prompt-item-preview">
                  {prompt.content.split('\n').slice(1, 3).join(' ').substring(0, 150)}...
                </div>
              </div>
            ))}
          </div>
        )}

        {selectedPrompt && (
          <div className="prompt-preview">
            <h3>Preview</h3>
            <pre className="prompt-content">{selectedPrompt.content}</pre>
          </div>
        )}

        <div className="prompt-selector-actions">
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
