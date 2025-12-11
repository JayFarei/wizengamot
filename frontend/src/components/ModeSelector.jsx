import React, { useState, useEffect, useRef } from 'react';
import './ModeSelector.css';

/**
 * Mode selection screen shown when creating a new conversation.
 * Two-card layout for choosing between Council and Synthesizer modes.
 * Supports keyboard navigation: left/right arrows, Enter to select, Escape to cancel.
 */
export default function ModeSelector({ onSelect, onCancel }) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const modes = ['council', 'synthesizer', 'monitor', 'visualiser'];
  const containerRef = useRef(null);

  useEffect(() => {
    // Focus the container for keyboard events
    if (containerRef.current) {
      containerRef.current.focus();
    }
  }, []);

  const handleKeyDown = (e) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : modes.length - 1));
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev < modes.length - 1 ? prev + 1 : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      onSelect(modes[selectedIndex]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  };

  return (
    <div
      className="mode-selector-overlay"
      ref={containerRef}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
    >
      <div className="mode-selector-container">
        <h2 className="mode-selector-title">Start a New Conversation</h2>
        <p className="mode-selector-subtitle">Choose how you want to interact with the council</p>
        <p className="mode-selector-hint">Use arrow keys to select, Enter to confirm</p>

        <div className="mode-cards">
          <button
            className={`mode-card mode-card-council ${selectedIndex === 0 ? 'selected' : ''}`}
            onClick={() => onSelect('council')}
            onMouseEnter={() => setSelectedIndex(0)}
          >
            <div className="mode-card-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="7" r="4" />
                <path d="M5.5 21a6.5 6.5 0 0 1 13 0" />
                <circle cx="4" cy="9" r="2.5" />
                <path d="M1 19a4 4 0 0 1 6 0" />
                <circle cx="20" cy="9" r="2.5" />
                <path d="M17 19a4 4 0 0 1 6 0" />
              </svg>
            </div>
            <h3 className="mode-card-title">Council</h3>
            <p className="mode-card-description">
              Multi-model deliberation with peer ranking. Get perspectives from multiple LLMs,
              see how they evaluate each other, and receive a synthesized answer.
            </p>
            <div className="mode-card-features">
              <span className="feature-tag">Multiple Models</span>
              <span className="feature-tag">Peer Review</span>
              <span className="feature-tag">Synthesis</span>
            </div>
          </button>

          <button
            className={`mode-card mode-card-synthesizer ${selectedIndex === 1 ? 'selected' : ''}`}
            onClick={() => onSelect('synthesizer')}
            onMouseEnter={() => setSelectedIndex(1)}
          >
            <div className="mode-card-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="7" height="9" rx="1" />
                <rect x="14" y="3" width="7" height="9" rx="1" />
                <rect x="3" y="14" width="7" height="7" rx="1" />
                <rect x="14" y="14" width="7" height="7" rx="1" />
                <line x1="6.5" y1="6" x2="8" y2="6" />
                <line x1="6.5" y1="8" x2="8" y2="8" />
                <line x1="17.5" y1="6" x2="19" y2="6" />
                <line x1="17.5" y1="8" x2="19" y2="8" />
              </svg>
            </div>
            <h3 className="mode-card-title">Synthesizer</h3>
            <p className="mode-card-description">
              Transform URLs into atomic Zettelkasten notes. Paste a YouTube video, article, or PDF
              and get structured notes with titles, tags, and concise content.
            </p>
            <div className="mode-card-features">
              <span className="feature-tag">YouTube</span>
              <span className="feature-tag">Articles</span>
              <span className="feature-tag">PDF</span>
              <span className="feature-tag">Zettelkasten</span>
            </div>
          </button>

          <button
            className={`mode-card mode-card-monitor ${selectedIndex === 2 ? 'selected' : ''}`}
            onClick={() => onSelect('monitor')}
            onMouseEnter={() => setSelectedIndex(2)}
          >
            <div className="mode-card-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <circle cx="12" cy="12" r="6" />
                <circle cx="12" cy="12" r="2" />
                <line x1="12" y1="2" x2="12" y2="4" />
                <line x1="12" y1="20" x2="12" y2="22" />
                <line x1="2" y1="12" x2="4" y2="12" />
                <line x1="20" y1="12" x2="22" y2="12" />
              </svg>
            </div>
            <h3 className="mode-card-title">Monitor</h3>
            <p className="mode-card-description">
              Track how competitor narratives change over time: ICP, promises, pricing, and proof.
              Get alerts when websites update.
            </p>
            <div className="mode-card-features">
              <span className="feature-tag">Competitors</span>
              <span className="feature-tag">Timeline</span>
              <span className="feature-tag">Change Detection</span>
            </div>
          </button>

          <button
            className={`mode-card mode-card-visualiser ${selectedIndex === 3 ? 'selected' : ''}`}
            onClick={() => onSelect('visualiser')}
            onMouseEnter={() => setSelectedIndex(3)}
          >
            <div className="mode-card-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <line x1="9" y1="3" x2="9" y2="21" />
                <line x1="3" y1="9" x2="21" y2="9" />
                <line x1="3" y1="15" x2="21" y2="15" />
                <line x1="15" y1="3" x2="15" y2="21" />
              </svg>
            </div>
            <h3 className="mode-card-title">Visualiser</h3>
            <p className="mode-card-description">
              Transform content into visual diagrams. Create bento layouts, whiteboard sketches,
              system diagrams, and more from conversations, URLs, or text.
            </p>
            <div className="mode-card-features">
              <span className="feature-tag">6 Styles</span>
              <span className="feature-tag">AI Generated</span>
              <span className="feature-tag">Download</span>
            </div>
          </button>
        </div>

        <button className="mode-selector-cancel" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
