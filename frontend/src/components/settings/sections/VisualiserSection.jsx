import { useState } from 'react';
import { api } from '../../../api';
import * as LucideIcons from 'lucide-react';
import './VisualiserSection.css';

// Map of common icon names for the selector
const ICON_OPTIONS = [
  { name: 'layout-grid', label: 'Grid' },
  { name: 'pen-tool', label: 'Pen' },
  { name: 'network', label: 'Network' },
  { name: 'pencil', label: 'Pencil' },
  { name: 'list-checks', label: 'Checklist' },
  { name: 'smile', label: 'Smile' },
  { name: 'image', label: 'Image' },
  { name: 'palette', label: 'Palette' },
  { name: 'shapes', label: 'Shapes' },
  { name: 'box', label: 'Box' },
  { name: 'layers', label: 'Layers' },
  { name: 'zap', label: 'Zap' },
  { name: 'sparkles', label: 'Sparkles' },
  { name: 'lightbulb', label: 'Lightbulb' },
  { name: 'chart-bar', label: 'Chart' },
];

// Convert kebab-case to PascalCase for Lucide icon lookup
function getIconComponent(iconName) {
  if (!iconName) return LucideIcons.Image;

  // Convert kebab-case to PascalCase
  const pascalCase = iconName
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');

  return LucideIcons[pascalCase] || LucideIcons.Image;
}

export default function VisualiserSection({
  visualiserSettings,
  loading,
  setLoading,
  setError,
  setSuccess,
  onReload,
}) {
  const [editingStyle, setEditingStyle] = useState(null);
  const [editingStyleName, setEditingStyleName] = useState('');
  const [editingStyleDescription, setEditingStyleDescription] = useState('');
  const [editingStyleIcon, setEditingStyleIcon] = useState('image');
  const [editingStylePrompt, setEditingStylePrompt] = useState('');
  const [isNewStyle, setIsNewStyle] = useState(false);
  const [showStyleEditor, setShowStyleEditor] = useState(false);
  const [newStyleId, setNewStyleId] = useState('');

  // Model handler
  const handleVisualiserModelChange = async (model) => {
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      await api.updateVisualiserModel(model);
      setSuccess('Visualiser model updated');
      await onReload();
    } catch (err) {
      setError('Failed to update visualiser model');
    } finally {
      setLoading(false);
    }
  };

  // Style handlers
  const handleEditStyle = (styleId) => {
    const style = visualiserSettings?.diagram_styles?.[styleId];
    if (!style) return;

    setEditingStyle(styleId);
    setEditingStyleName(style.name || '');
    setEditingStyleDescription(style.description || '');
    setEditingStyleIcon(style.icon || 'image');
    setEditingStylePrompt(style.prompt || '');
    setIsNewStyle(false);
    setShowStyleEditor(true);
  };

  const handleNewStyle = () => {
    setEditingStyle(null);
    setNewStyleId('');
    setEditingStyleName('');
    setEditingStyleDescription('');
    setEditingStyleIcon('image');
    setEditingStylePrompt('');
    setIsNewStyle(true);
    setShowStyleEditor(true);
  };

  const handleSaveStyle = async () => {
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      if (isNewStyle) {
        if (!newStyleId.trim()) {
          setError('Style ID is required');
          setLoading(false);
          return;
        }
        await api.createDiagramStyle(
          newStyleId.trim(),
          editingStyleName.trim(),
          editingStyleDescription.trim(),
          editingStyleIcon,
          editingStylePrompt
        );
        setSuccess('Style created');
      } else {
        await api.updateDiagramStyle(
          editingStyle,
          editingStyleName.trim(),
          editingStyleDescription.trim(),
          editingStyleIcon,
          editingStylePrompt
        );
        setSuccess('Style updated');
      }
      setShowStyleEditor(false);
      setEditingStyle(null);
      await onReload();
    } catch (err) {
      setError(isNewStyle ? 'Failed to create style' : 'Failed to update style');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteStyle = async (styleId, e) => {
    e.stopPropagation();
    if (!confirm('Are you sure you want to delete this diagram style?')) return;

    setLoading(true);
    setError('');
    setSuccess('');

    try {
      await api.deleteDiagramStyle(styleId);
      setSuccess('Style deleted');
      await onReload();
    } catch (err) {
      setError('Failed to delete style (must have at least one style)');
    } finally {
      setLoading(false);
    }
  };

  const styles = visualiserSettings?.diagram_styles || {};
  const styleEntries = Object.entries(styles);

  return (
    <div className="settings-section visualiser-section">
      <div className="modal-section">
        <h3>Image Generation Model</h3>
        <p className="section-description">
          Model used for generating diagram images. Must support image output (e.g.,
          gemini-3-pro-image-preview).
        </p>
        {visualiserSettings && (
          <div className="visualiser-model-input-group">
            <input
              type="text"
              className="visualiser-model-input"
              placeholder="e.g., google/gemini-3-pro-image-preview"
              defaultValue={visualiserSettings.default_model || ''}
              onBlur={(e) => {
                const newModel = e.target.value.trim();
                if (newModel && newModel !== visualiserSettings.default_model) {
                  handleVisualiserModelChange(newModel);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const newModel = e.target.value.trim();
                  if (newModel && newModel !== visualiserSettings.default_model) {
                    handleVisualiserModelChange(newModel);
                  }
                }
              }}
              disabled={loading}
            />
          </div>
        )}
      </div>

      <div className="modal-section">
        <div className="section-header">
          <h3>Diagram Styles</h3>
          <button className="btn-small btn-primary" onClick={handleNewStyle}>
            + New Style
          </button>
        </div>
        <p className="section-description">
          Manage diagram style prompts. Each style defines a visual approach for infographics.
        </p>

        <div className="style-cards-grid">
          {styleEntries.length === 0 ? (
            <p className="no-prompts">No styles yet. Create one to get started.</p>
          ) : (
            styleEntries.map(([styleId, style]) => {
              const IconComponent = getIconComponent(style.icon);
              return (
                <div
                  key={styleId}
                  className="style-card"
                  onClick={() => handleEditStyle(styleId)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && handleEditStyle(styleId)}
                >
                  <div className="style-card-icon">
                    <IconComponent size={32} />
                  </div>
                  <div className="style-card-content">
                    <h4 className="style-card-name">{style.name}</h4>
                    <p className="style-card-description">{style.description}</p>
                    <span className="style-card-id">{styleId}</span>
                  </div>
                  {styleEntries.length > 1 && (
                    <button
                      className="style-card-delete"
                      onClick={(e) => handleDeleteStyle(styleId, e)}
                      disabled={loading}
                      title="Delete style"
                    >
                      <LucideIcons.Trash2 size={16} />
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Style Editor Modal */}
      {showStyleEditor && (
        <div className="modal-overlay style-editor-overlay" onClick={() => setShowStyleEditor(false)}>
          <div className="modal-content style-editor-modal" onClick={(e) => e.stopPropagation()}>
            <h2>{isNewStyle ? 'Create New Style' : `Edit Style: ${editingStyleName}`}</h2>

            {isNewStyle && (
              <div className="form-group">
                <label>Style ID</label>
                <input
                  type="text"
                  className="style-id-input"
                  placeholder="e.g., my_custom_style"
                  value={newStyleId}
                  onChange={(e) =>
                    setNewStyleId(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))
                  }
                />
                <span className="form-hint">Lowercase letters, numbers, and underscores only</span>
              </div>
            )}

            <div className="form-group">
              <label>Name</label>
              <input
                type="text"
                className="style-name-input"
                placeholder="Display name for this style"
                value={editingStyleName}
                onChange={(e) => setEditingStyleName(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label>Description</label>
              <input
                type="text"
                className="style-description-input"
                placeholder="Short description of the visual approach"
                value={editingStyleDescription}
                onChange={(e) => setEditingStyleDescription(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label>Icon</label>
              <div className="icon-selector">
                {ICON_OPTIONS.map((option) => {
                  const IconComp = getIconComponent(option.name);
                  return (
                    <button
                      key={option.name}
                      type="button"
                      className={`icon-option ${editingStyleIcon === option.name ? 'selected' : ''}`}
                      onClick={() => setEditingStyleIcon(option.name)}
                      title={option.label}
                    >
                      <IconComp size={20} />
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="form-group">
              <label>Prompt</label>
              <textarea
                className="style-prompt-textarea"
                placeholder="Full prompt for generating diagrams in this style..."
                value={editingStylePrompt}
                onChange={(e) => setEditingStylePrompt(e.target.value)}
                rows={12}
              />
            </div>

            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => setShowStyleEditor(false)}>
                Cancel
              </button>
              <button
                className="btn-primary"
                onClick={handleSaveStyle}
                disabled={loading || !editingStyleName.trim() || (isNewStyle && !newStyleId.trim())}
              >
                {loading ? 'Saving...' : isNewStyle ? 'Create Style' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
