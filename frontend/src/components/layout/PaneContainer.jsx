import { useRef, useEffect, useCallback } from 'react';
import { createLayout } from 'animejs';
import { useLayout } from '../../contexts/LayoutContext';
import Pane from './Pane';
import './PaneContainer.css';

/**
 * Renders layout tree as nested CSS Grid
 * Supports vsplit (columns) and hsplit (rows)
 * Uses anime.js Layout API for smooth transitions
 */

function LayoutNode({
  node,
  renderPane,
  isZoomed,
  zoomedPaneId,
  depth = 0,
}) {
  if (node.type === 'leaf') {
    // Check if this pane should be hidden (zoom mode)
    if (isZoomed && node.paneId !== zoomedPaneId) {
      return null;
    }

    // At depth 0 (root), wrap single leaf in a grid for consistent structure
    // This allows anime.js to animate from 1fr to 50fr 50fr when splitting
    if (depth === 0) {
      return (
        <div
          className="layout-split layout-vsplit"
          style={{ gridTemplateColumns: '1fr' }}
          data-depth={depth}
        >
          {renderPane(node.paneId, 0)}
        </div>
      );
    }

    // Nested leaves don't need wrapper (parent split handles grid)
    return renderPane(node.paneId, getAllPaneIdsLocal(node).indexOf(node.paneId));
  }

  // Split node
  const { type, sizes, children } = node;
  const isVertical = type === 'vsplit';

  // Filter children for zoom mode
  const visibleChildren = isZoomed
    ? children.filter(child => containsPaneIdLocal(child, zoomedPaneId))
    : children;

  // If only one child visible (zoom), render it directly
  if (visibleChildren.length === 1) {
    return (
      <LayoutNode
        node={visibleChildren[0]}
        renderPane={renderPane}
        isZoomed={isZoomed}
        zoomedPaneId={zoomedPaneId}
        depth={depth}
      />
    );
  }

  // Build grid template
  const gridTemplate = sizes.map(s => `${s}fr`).join(' ');
  const style = isVertical
    ? { gridTemplateColumns: gridTemplate }
    : { gridTemplateRows: gridTemplate };

  return (
    <div
      className={`layout-split layout-${type}`}
      style={style}
      data-depth={depth}
    >
      {children.map((child, i) => (
        <LayoutNode
          key={child.type === 'leaf' ? child.paneId : `split-${depth}-${i}`}
          node={child}
          renderPane={renderPane}
          isZoomed={isZoomed}
          zoomedPaneId={zoomedPaneId}
          depth={depth + 1}
        />
      ))}
    </div>
  );
}

// Local utility functions (duplicated to avoid circular deps)
function getAllPaneIdsLocal(node) {
  if (node.type === 'leaf') return [node.paneId];
  return node.children.flatMap(child => getAllPaneIdsLocal(child));
}

function containsPaneIdLocal(node, paneId) {
  if (node.type === 'leaf') return node.paneId === paneId;
  return node.children.some(child => containsPaneIdLocal(child, paneId));
}

export default function PaneContainer({
  renderPaneContent,
  onRequestConversation,
}) {
  const { layout, zoomedPaneId, allPaneIds, closingPaneId, completeClosePane, newPaneIds } = useLayout();
  const containerRef = useRef(null);
  const animationRef = useRef(null);

  // Initialize anime.js layout on mount
  useEffect(() => {
    if (!containerRef.current) return;

    try {
      animationRef.current = createLayout(containerRef.current, {
        duration: 250,
        easing: 'easeOutCubic',
      });
    } catch (err) {
      // anime.js Layout API may not be available in all versions
      console.log('anime.js Layout API not available, using CSS transitions');
    }

    return () => {
      if (animationRef.current?.revert) {
        animationRef.current.revert();
      }
    };
  }, []);

  // Trigger layout update on changes
  useEffect(() => {
    if (animationRef.current?.refresh) {
      animationRef.current.refresh();
    }
  }, [layout, zoomedPaneId]);

  // Listen for transition end to complete pane close
  useEffect(() => {
    if (!closingPaneId || !containerRef.current) return;

    const handleTransitionEnd = (e) => {
      if (e.propertyName.includes('grid-template')) {
        completeClosePane(closingPaneId);
      }
    };

    const container = containerRef.current;
    container.addEventListener('transitionend', handleTransitionEnd);

    // Fallback in case transition doesn't fire
    const fallback = setTimeout(() => completeClosePane(closingPaneId), 300);

    return () => {
      container.removeEventListener('transitionend', handleTransitionEnd);
      clearTimeout(fallback);
    };
  }, [closingPaneId, completeClosePane]);

  const renderPane = useCallback((paneId, index) => {
    const isNew = newPaneIds?.has?.(paneId) || false;
    return (
      <Pane
        key={paneId}
        paneId={paneId}
        index={allPaneIds.indexOf(paneId)}
        onRequestConversation={onRequestConversation}
        isNew={isNew}
      >
        {renderPaneContent(paneId)}
      </Pane>
    );
  }, [renderPaneContent, onRequestConversation, allPaneIds, newPaneIds]);

  const isZoomed = zoomedPaneId !== null;

  return (
    <div ref={containerRef} className="pane-container">
      <LayoutNode
        node={layout}
        renderPane={renderPane}
        isZoomed={isZoomed}
        zoomedPaneId={zoomedPaneId}
      />
    </div>
  );
}
