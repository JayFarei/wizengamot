import React, { useEffect, useMemo, useState } from 'react';
import './SourceMetadataModal.css';

const BASE_OPTIONS = [
  { value: 'article', label: 'Article' },
  { value: 'youtube', label: 'YouTube' },
  { value: 'podcast', label: 'Podcast' },
  { value: 'pdf', label: 'PDF' },
  { value: 'text', label: 'Text' },
];

export default function SourceMetadataModal({
  isOpen,
  initialValues,
  onSave,
  onClose,
  isSaving = false,
  error = null,
}) {
  const [formValues, setFormValues] = useState({
    sourceType: '',
    sourceTitle: '',
    sourceUrl: '',
  });

  useEffect(() => {
    if (!isOpen) return;
    setFormValues({
      sourceType: initialValues?.sourceType || '',
      sourceTitle: initialValues?.sourceTitle || '',
      sourceUrl: initialValues?.sourceUrl || '',
    });
  }, [isOpen, initialValues]);

  const options = useMemo(() => {
    const currentType = initialValues?.sourceType || '';
    if (!currentType) return BASE_OPTIONS;
    const hasCurrent = BASE_OPTIONS.some((option) => option.value === currentType);
    if (hasCurrent) return BASE_OPTIONS;
    return [{ value: currentType, label: currentType.toUpperCase() }, ...BASE_OPTIONS];
  }, [initialValues?.sourceType]);

  if (!isOpen) return null;

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormValues((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave(formValues);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      onClose();
    }
  };

  return (
    <div className="source-meta-modal-overlay" onClick={onClose}>
      <div
        className="source-meta-modal"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
        tabIndex={0}
      >
        <div className="source-meta-modal-header">
          <h3>Edit Source Info</h3>
          <button className="source-meta-modal-close" onClick={onClose}>
            &times;
          </button>
        </div>

        <form className="source-meta-modal-body" onSubmit={handleSubmit}>
          <label className="source-meta-field">
            <span>Source type</span>
            <select
              name="sourceType"
              value={formValues.sourceType}
              onChange={handleChange}
            >
              <option value="">Select type</option>
              {options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="source-meta-field">
            <span>Source title</span>
            <input
              name="sourceTitle"
              type="text"
              value={formValues.sourceTitle}
              onChange={handleChange}
              placeholder="Add a title"
            />
          </label>

          <label className="source-meta-field">
            <span>Source URL</span>
            <input
              name="sourceUrl"
              type="url"
              value={formValues.sourceUrl}
              onChange={handleChange}
              placeholder="https://"
            />
          </label>

          {error && <div className="source-meta-error">{error}</div>}
        </form>

        <div className="source-meta-modal-footer">
          <button className="btn-secondary" onClick={onClose} type="button">
            Cancel
          </button>
          <button className="btn-primary" onClick={handleSubmit} type="button" disabled={isSaving}>
            {isSaving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
