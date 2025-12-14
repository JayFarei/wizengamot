import { useState } from 'react';
import { api } from '../../api';
import './ModelReplacementModal.css';

export default function ModelReplacementModal({
  isOpen,
  onClose,
  modelToRemove,
  dependencies,
  availableModels,
  onSuccess,
}) {
  const [replacementModel, setReplacementModel] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen || !modelToRemove) return null;

  const dependencyList = dependencies?.replacement_required || [];

  const getDependencyLabel = (dep) => {
    switch (dep) {
      case 'council_members':
        return 'Council Members';
      case 'chairman':
        return 'Chairman';
      case 'synthesizer':
        return 'Synthesizer';
      case 'visualiser':
        return 'Visualiser';
      default:
        return dep;
    }
  };

  const getDependencyDescription = (dep) => {
    switch (dep) {
      case 'council_members':
        return 'Used as a default council member';
      case 'chairman':
        return 'Set as the default chairman model';
      case 'synthesizer':
        return 'Set as the default synthesizer model';
      case 'visualiser':
        return 'Set as the default visualiser model';
      default:
        return 'Used in settings';
    }
  };

  const otherModels = availableModels.filter(m => m !== modelToRemove);

  const handleReplace = async () => {
    if (!replacementModel) {
      setError('Please select a replacement model');
      return;
    }

    setLoading(true);
    setError('');

    try {
      await api.replaceModel(modelToRemove, replacementModel, true);
      onSuccess?.();
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to replace model');
    } finally {
      setLoading(false);
    }
  };

  const getModelShortName = (model) => {
    return model.split('/')[1] || model;
  };

  return (
    <div className="modal-overlay replacement-modal-overlay" onClick={onClose}>
      <div className="modal-content replacement-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Model In Use</h2>

        <div className="replacement-warning">
          <span className="warning-icon">⚠️</span>
          <p>
            <strong>{getModelShortName(modelToRemove)}</strong> cannot be removed because it is currently in use.
          </p>
        </div>

        <div className="dependency-list">
          <h4>Currently used as:</h4>
          <ul>
            {dependencyList.map((dep) => (
              <li key={dep}>
                <strong>{getDependencyLabel(dep)}</strong>
                <span className="dep-description">{getDependencyDescription(dep)}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="replacement-section">
          <h4>Select Replacement Model</h4>
          <p className="replacement-hint">
            Choose a model to replace <strong>{getModelShortName(modelToRemove)}</strong> in all the above usages:
          </p>

          {otherModels.length === 0 ? (
            <div className="no-alternatives">
              No other models available. Add another model to the pool first.
            </div>
          ) : (
            <select
              className="replacement-select"
              value={replacementModel}
              onChange={(e) => setReplacementModel(e.target.value)}
              disabled={loading}
            >
              <option value="">Select a model...</option>
              {otherModels.map((model) => (
                <option key={model} value={model}>
                  {getModelShortName(model)}
                </option>
              ))}
            </select>
          )}
        </div>

        {error && <div className="replacement-error">{error}</div>}

        <div className="modal-actions">
          <button className="btn-secondary" onClick={onClose} disabled={loading}>
            Cancel
          </button>
          <button
            className="btn-danger"
            onClick={handleReplace}
            disabled={loading || !replacementModel || otherModels.length === 0}
          >
            {loading ? 'Replacing...' : 'Replace & Remove'}
          </button>
        </div>
      </div>
    </div>
  );
}
