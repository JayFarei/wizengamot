import { useEffect, useState } from 'react';
import { api } from '../api';

export default function ImageGalleryModal({
  item,
  onOpenConversation,
  onClose
}) {
  const [versions, setVersions] = useState([]);
  const [versionIndex, setVersionIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  // Load full conversation data to get all image versions
  useEffect(() => {
    const loadConversation = async () => {
      setIsLoading(true);
      try {
        const conv = await api.getConversation(item.conversationId);
        const imageVersions = (conv.messages || [])
          .filter(m => m.role === 'assistant' && m.image_id)
          .map((m, i) => ({
            version: i + 1,
            imageId: m.image_id,
            imageUrl: `${api.getBaseUrl()}/api/images/${m.image_id}`,
            style: m.style,
            editPrompt: m.edit_prompt
          }));
        setVersions(imageVersions);
        setVersionIndex(imageVersions.length - 1); // Start at latest version
      } catch (error) {
        console.error('Failed to load conversation:', error);
        // Fallback to single image from metadata
        setVersions([{
          version: 1,
          imageId: item.imageId,
          imageUrl: item.imageUrl,
          style: item.diagramStyle,
          editPrompt: null
        }]);
        setVersionIndex(0);
      }
      setIsLoading(false);
    };

    loadConversation();
  }, [item]);

  const currentVersion = versions[versionIndex];
  const hasPrev = versionIndex > 0;
  const hasNext = versionIndex < versions.length - 1;

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowLeft' && hasPrev) {
        setVersionIndex(versionIndex - 1);
      } else if (e.key === 'ArrowRight' && hasNext) {
        setVersionIndex(versionIndex + 1);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, hasPrev, hasNext, versionIndex]);

  const getStyleLabel = (styleId) => {
    const labels = {
      bento: 'Bento',
      whiteboard: 'Whiteboard',
      system_diagram: 'System Diagram',
      napkin: 'Napkin Sketch',
      cheatsheet: 'Cheatsheet',
      cartoon: 'Cartoon'
    };
    return labels[styleId] || styleId;
  };

  if (isLoading || !currentVersion) {
    return (
      <div className="image-modal-overlay" onClick={onClose}>
        <div className="image-modal" onClick={e => e.stopPropagation()}>
          <div className="image-modal-loading">Loading...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="image-modal-overlay" onClick={onClose}>
      <div className="image-modal" onClick={e => e.stopPropagation()}>
        <div className="image-modal-header">
          <div className="image-modal-title-row">
            <h3>{item.title}</h3>
            {currentVersion.style && (
              <span className="image-modal-style-badge">
                {getStyleLabel(currentVersion.style)}
              </span>
            )}
          </div>
          <button className="image-modal-close" onClick={onClose}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="image-modal-content">
          {hasPrev && (
            <button
              className="image-modal-nav prev"
              onClick={() => setVersionIndex(versionIndex - 1)}
              title="Previous version"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
          )}

          <div className="image-modal-image-container">
            <img src={currentVersion.imageUrl} alt={item.title} />
          </div>

          {hasNext && (
            <button
              className="image-modal-nav next"
              onClick={() => setVersionIndex(versionIndex + 1)}
              title="Next version"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          )}
        </div>

        <div className="image-modal-footer">
          {versions.length > 1 && (
            <div className="image-modal-version-info">
              <span className="version-indicator">
                v{versionIndex + 1} / {versions.length}
              </span>
              {currentVersion.editPrompt && (
                <span className="version-edit-prompt" title={currentVersion.editPrompt}>
                  {currentVersion.editPrompt}
                </span>
              )}
            </div>
          )}

          <button className="image-modal-open-btn" onClick={onOpenConversation}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
            Open Conversation
          </button>
        </div>
      </div>
    </div>
  );
}
