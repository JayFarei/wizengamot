import React, { useState, useCallback, useRef } from 'react';
import { useRailAnimation } from './useRailAnimation';
import './ProgressRail.css';

/**
 * ProgressRail - Zoomable navigation component with lens effect.
 *
 * @param {Object[]} items - Array of items with { id, title, index, commentCount }
 * @param {number} activeIndex - Currently active item index
 * @param {function} onIndexChange - Callback when user clicks a tick
 * @param {boolean} showLabels - Whether to show hover labels (default: true)
 * @param {boolean} showCommentDots - Whether to show comment indicators (default: true)
 */
export default function ProgressRail({
  items = [],
  activeIndex = 0,
  onIndexChange,
  showLabels = true,
  showCommentDots = true,
}) {
  const [hoveredIndex, setHoveredIndex] = useState(null);
  const railRef = useRef(null);
  const { setTickRef, animateLensIn, animateLensOut } = useRailAnimation(items.length);

  // Handle tick hover
  const handleTickHover = useCallback((index) => {
    setHoveredIndex(index);
    animateLensIn(index);
  }, [animateLensIn]);

  // Handle tick leave
  const handleTickLeave = useCallback(() => {
    setHoveredIndex(null);
    animateLensOut();
  }, [animateLensOut]);

  // Handle tick click
  const handleTickClick = useCallback((index) => {
    onIndexChange?.(index);
  }, [onIndexChange]);

  // Keyboard navigation
  const handleKeyDown = useCallback((e) => {
    if (!items.length) return;

    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault();
        onIndexChange?.(Math.max(0, activeIndex - 1));
        break;
      case 'ArrowRight':
        e.preventDefault();
        onIndexChange?.(Math.min(items.length - 1, activeIndex + 1));
        break;
      case 'Home':
        e.preventDefault();
        onIndexChange?.(0);
        break;
      case 'End':
        e.preventDefault();
        onIndexChange?.(items.length - 1);
        break;
      default:
        break;
    }
  }, [items.length, activeIndex, onIndexChange]);

  // Get comment dot configuration based on count
  const getCommentDots = useCallback((count) => {
    if (count === 0) return [];
    if (count <= 2) return [{ glow: false }];
    if (count <= 5) return [{ glow: false }, { glow: false }];
    return [{ glow: true }, { glow: true }, { glow: true }];
  }, []);

  // Get hovered item for label
  const hoveredItem = hoveredIndex !== null ? items[hoveredIndex] : null;

  if (items.length === 0) {
    return null;
  }

  return (
    <div
      ref={railRef}
      className="progress-rail"
      tabIndex={0}
      role="slider"
      aria-label="Note navigation"
      aria-valuemin={1}
      aria-valuemax={items.length}
      aria-valuenow={activeIndex + 1}
      aria-valuetext={items[activeIndex]?.title || `Note ${activeIndex + 1}`}
      onKeyDown={handleKeyDown}
    >
      {/* Ticks */}
      <div className="progress-rail-ticks">
        {items.map((item, index) => {
          const dots = showCommentDots ? getCommentDots(item.commentCount) : [];
          const isActive = index === activeIndex;

          return (
            <button
              key={item.id || index}
              ref={setTickRef(index)}
              className={`progress-rail-tick ${isActive ? 'active' : ''}`}
              onClick={() => handleTickClick(index)}
              onMouseEnter={() => handleTickHover(index)}
              onMouseLeave={handleTickLeave}
              aria-label={`${item.title || `Note ${index + 1}`}${item.commentCount ? `, ${item.commentCount} comments` : ''}`}
              type="button"
            >
              <div className="tick-marker" />
              {dots.length > 0 && (
                <div className="comment-dots">
                  {dots.map((dot, i) => (
                    <div key={i} className={`comment-dot ${dot.glow ? 'glow' : ''}`} />
                  ))}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Card counter below */}
      <span className="progress-rail-counter">
        {activeIndex + 1}/{items.length}
      </span>

      {/* Hover label */}
      {showLabels && hoveredItem && hoveredIndex !== null && (
        <div
          className="progress-rail-label"
          style={{
            left: `${(hoveredIndex / Math.max(1, items.length - 1)) * 100}%`,
          }}
        >
          <div className="progress-rail-label-title">
            {hoveredIndex + 1}. {hoveredItem.title || `Note ${hoveredIndex + 1}`}
          </div>
          {hoveredItem.commentCount > 0 && (
            <div className="progress-rail-label-meta">
              <span className="progress-rail-label-comments">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
                {hoveredItem.commentCount}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
