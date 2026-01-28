import { useState, useCallback, useEffect, useRef } from 'react';
import { useLayout } from '../../contexts/LayoutContext';
import './Pane.css';

export default function Pane({
  paneId,
  index,
  children,
  onRequestConversation,
  isNew = false,
}) {
  const { focusedPaneId, focusPane, paneCount, isLeaderActive, closePane, closingPaneId, navigationAnimation, clearNavigationAnimation, clearNewPane } = useLayout();
  const isFocused = focusedPaneId === paneId;
  const isClosing = closingPaneId === paneId;
  const [isIndicatorHovered, setIsIndicatorHovered] = useState(false);
  const animationTimeoutRef = useRef(null);

  // Clear the new pane flag after animation completes
  useEffect(() => {
    if (isNew) {
      animationTimeoutRef.current = setTimeout(() => {
        clearNewPane(paneId);
      }, 250); // Match animation duration
    }
    return () => {
      if (animationTimeoutRef.current) {
        clearTimeout(animationTimeoutRef.current);
      }
    };
  }, [isNew, paneId, clearNewPane]);

  // Navigation animation state
  const isNavigatingOut = navigationAnimation?.fromPaneId === paneId;
  const isNavigatingIn = navigationAnimation?.toPaneId === paneId;
  const navDirection = navigationAnimation?.direction;

  // Clear animation after transition
  useEffect(() => {
    if (isNavigatingIn || isNavigatingOut) {
      const timer = setTimeout(clearNavigationAnimation, 200);
      return () => clearTimeout(timer);
    }
  }, [isNavigatingIn, isNavigatingOut, clearNavigationAnimation]);

  const handleClick = useCallback((e) => {
    // Focus pane on click if not already focused
    if (!isFocused) {
      focusPane(paneId);
    }
  }, [isFocused, focusPane, paneId]);

  const handleClose = useCallback((e) => {
    e.stopPropagation();
    closePane(paneId);
  }, [closePane, paneId]);

  // Determine pane class based on focus, leader mode, closing state, navigation, and new state
  const paneClass = [
    'pane',
    isNew ? 'pane-new' : '', // Only new panes get enter animation
    isFocused && !isLeaderActive && paneCount > 1 ? 'pane-focused' : '',
    isFocused && isLeaderActive ? 'pane-leader-active' : '',
    isClosing ? 'pane-closing' : '',
    isNavigatingOut ? `pane-nav-out-${navDirection}` : '',
    isNavigatingIn ? `pane-nav-in-${navDirection}` : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      className={paneClass}
      onClick={handleClick}
      data-pane-id={paneId}
    >
      {paneCount > 1 && (
        <div
          className="pane-indicator"
          onMouseEnter={() => setIsIndicatorHovered(true)}
          onMouseLeave={() => setIsIndicatorHovered(false)}
        >
          <span
            className={`pane-number ${isIndicatorHovered ? 'pane-number-close' : ''}`}
            onClick={handleClose}
            title={isIndicatorHovered ? 'Close pane' : `Pane ${index + 1}`}
          >
            {isIndicatorHovered ? '×' : index + 1}
          </span>
          {/* Badges only show when not hovered */}
          {!isIndicatorHovered && isFocused && !isLeaderActive && (
            <span className="pane-focus-badge">focused</span>
          )}
          {!isIndicatorHovered && isFocused && isLeaderActive && (
            <span className="pane-focus-badge pane-leader-badge">shortcut</span>
          )}
        </div>
      )}
      <div className="pane-content">
        {children}
      </div>
    </div>
  );
}
