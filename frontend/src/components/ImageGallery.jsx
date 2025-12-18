import { useState, useEffect } from 'react';
import { api } from '../api';
import ImageGalleryModal from './ImageGalleryModal';
import './ImageGallery.css';

export default function ImageGallery({ onSelectConversation, onClose, onNewVisualisation }) {
  const [galleryItems, setGalleryItems] = useState([]);
  const [selectedImage, setSelectedImage] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  // Fetch images from the dedicated API endpoint
  useEffect(() => {
    const loadImages = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const result = await api.listImages();
        setGalleryItems(result.images.map(img => ({
          conversationId: img.conversation_id,
          title: img.title,
          imageId: img.latest_image_id,
          imageUrl: `${api.getBaseUrl()}${img.latest_image_url}`,
          style: img.style,
          imageCount: img.version_count,
          createdAt: img.created_at,
          totalCost: img.total_cost
        })));
      } catch (err) {
        console.error('Failed to load images:', err);
        setError('Failed to load images');
      }
      setIsLoading(false);
    };

    loadImages();
  }, []);

  const handleImageClick = (item) => {
    setSelectedImage(item);
  };

  const handleOpenConversation = () => {
    if (selectedImage) {
      onSelectConversation(selectedImage.conversationId);
    }
  };

  return (
    <div className="image-gallery">
      <header className="image-gallery-header">
        <button className="gallery-back-btn" onClick={onClose} title="Back">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <h2>All Visualisations</h2>
        <span className="gallery-count">{galleryItems.length} images</span>
      </header>

      {isLoading ? (
        <div className="gallery-loading">Loading images...</div>
      ) : error ? (
        <div className="gallery-error">{error}</div>
      ) : (
        <div className="image-gallery-grid">
          {galleryItems.map(item => (
            <div
              key={item.conversationId}
              className="gallery-item"
              onClick={() => handleImageClick(item)}
            >
              <img
                src={item.imageUrl}
                alt={item.title}
                loading="lazy"
              />
              <div className="gallery-item-overlay">
                <span className="gallery-item-title">{item.title}</span>
                {item.imageCount > 1 && (
                  <span className="gallery-item-versions">
                    {item.imageCount} versions
                  </span>
                )}
              </div>
            </div>
          ))}

          {/* Add new visualisation button */}
          <div
            className="gallery-item gallery-item-add"
            onClick={onNewVisualisation}
          >
            <div className="gallery-add-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </div>
          </div>
        </div>
      )}

      {selectedImage && (
        <ImageGalleryModal
          item={selectedImage}
          onOpenConversation={handleOpenConversation}
          onClose={() => setSelectedImage(null)}
        />
      )}
    </div>
  );
}
