import { useState, useEffect } from 'react';
import './ConfigModal.css';

export default function ConfigModal({ isOpen, onClose, onSubmit, availableModels, defaultSelectedModels, defaultChairman }) {
  const [selectedModels, setSelectedModels] = useState([]);
  const [chairmanModel, setChairmanModel] = useState('');

  useEffect(() => {
    if (isOpen && availableModels && availableModels.length > 0) {
      // Default to the configured default council models, or all if not specified
      const defaultModels = defaultSelectedModels && defaultSelectedModels.length > 0
        ? defaultSelectedModels.filter(m => availableModels.includes(m))
        : availableModels;
      setSelectedModels(defaultModels);
      setChairmanModel(defaultChairman || availableModels[0]);
    }
  }, [isOpen, availableModels, defaultSelectedModels, defaultChairman]);

  // Enter key handler to submit, Escape to close
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Enter' && selectedModels.length > 0 && chairmanModel) {
        e.preventDefault();
        onSubmit({
          council_models: selectedModels,
          chairman_model: chairmanModel
        });
      } else if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, selectedModels, chairmanModel, onSubmit, onClose]);

  if (!isOpen) return null;

  const handleToggleModel = (model) => {
    if (selectedModels.includes(model)) {
      // Don't allow deselecting all models
      if (selectedModels.length > 1) {
        setSelectedModels(selectedModels.filter(m => m !== model));
      }
    } else {
      setSelectedModels([...selectedModels, model]);
    }
  };

  const handleSubmit = () => {
    if (selectedModels.length === 0) {
      alert('Please select at least one council member');
      return;
    }
    if (!chairmanModel) {
      alert('Please select a chairman');
      return;
    }
    onSubmit({
      council_models: selectedModels,
      chairman_model: chairmanModel
    });
  };

  const getModelShortName = (model) => {
    return model.split('/')[1] || model;
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <h2>Configure Council</h2>

        <div className="modal-section">
          <h3>Council Members</h3>
          <p className="section-description">
            Select which models will participate in the council
          </p>
          <div className="model-checkboxes">
            {availableModels && availableModels.map((model) => (
              <label key={model} className="checkbox-label">
                <input
                  type="checkbox"
                  checked={selectedModels.includes(model)}
                  onChange={() => handleToggleModel(model)}
                />
                <span>{getModelShortName(model)}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="modal-section">
          <h3>Chairman</h3>
          <p className="section-description">
            Select which model will synthesize the final answer
          </p>
          <select
            className="chairman-select"
            value={chairmanModel}
            onChange={(e) => setChairmanModel(e.target.value)}
          >
            {availableModels && availableModels.map((model) => (
              <option key={model} value={model}>
                {getModelShortName(model)}
              </option>
            ))}
          </select>
        </div>

        <div className="modal-actions">
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" onClick={handleSubmit}>
            Create Conversation
          </button>
        </div>
      </div>
    </div>
  );
}
