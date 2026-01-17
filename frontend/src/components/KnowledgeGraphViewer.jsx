import React, { useRef, useCallback, useEffect, useState, useMemo } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import './KnowledgeGraph.css';

/**
 * Get CSS variable value from the document
 */
const getCSSVar = (name) => {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
};

/**
 * Get all Knowledge Graph colors from CSS variables
 */
const getKGColors = () => ({
  note: getCSSVar('--kg-note') || '#8aadf4',
  source: getCSSVar('--kg-source') || '#f5a97f',
  entity: {
    person: getCSSVar('--kg-entity-person') || '#c6a0f6',
    organization: getCSSVar('--kg-entity-org') || '#a6da95',
    concept: getCSSVar('--kg-entity-concept') || '#7dc4e4',
    technology: getCSSVar('--kg-entity-tech') || '#ed8796',
    event: getCSSVar('--kg-entity-event') || '#eed49f',
  },
  selected: getCSSVar('--kg-selected') || '#eed49f',
  highlighted: getCSSVar('--kg-highlighted') || '#f5a97f',
  nodeLabel: getCSSVar('--kg-node-label') || '#cad3f5',
  links: {
    sequential: getCSSVar('--kg-link-sequential') || '#8087a2',
    shared_tag: getCSSVar('--kg-link-shared-tag') || '#6e738d',
    mentions: getCSSVar('--kg-link-mentions') || '#5b6078',
    manual: getCSSVar('--kg-link-manual') || '#a6da95',
  },
});

/**
 * Source type icons (simple unicode for now)
 */
const SOURCE_ICONS = {
  youtube: '▶',
  podcast: '🎙',
  article: '📄',
  pdf: '📕',
};

/**
 * KnowledgeGraphViewer - Interactive force-directed graph visualization
 */
export default function KnowledgeGraphViewer({
  graphData,
  onNodeClick,
  onNodeHover,
  selectedNodeId,
  highlightedNodes = [],
  matchedNodes = [],
  width,
  height,
  showEntities = true,
  showSources = true,
}) {
  const fgRef = useRef();
  const [hoveredNode, setHoveredNode] = useState(null);
  const [colors, setColors] = useState(getKGColors);

  // Update colors when theme changes
  useEffect(() => {
    const updateColors = () => setColors(getKGColors());

    // Listen for theme changes via MutationObserver on data-theme attribute
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.attributeName === 'data-theme') {
          updateColors();
        }
      });
    });

    observer.observe(document.documentElement, { attributes: true });

    return () => observer.disconnect();
  }, []);

  // Filter nodes based on visibility settings
  const filteredData = useMemo(() => {
    if (!graphData) return { nodes: [], links: [] };

    let nodes = graphData.nodes || [];
    let links = graphData.links || [];

    if (!showEntities) {
      const entityIds = new Set(nodes.filter(n => n.type === 'entity').map(n => n.id));
      nodes = nodes.filter(n => n.type !== 'entity');
      links = links.filter(l => !entityIds.has(l.source) && !entityIds.has(l.target)
        && !entityIds.has(l.source?.id) && !entityIds.has(l.target?.id));
    }

    if (!showSources) {
      const sourceIds = new Set(nodes.filter(n => n.type === 'source').map(n => n.id));
      nodes = nodes.filter(n => n.type !== 'source');
      links = links.filter(l => !sourceIds.has(l.source) && !sourceIds.has(l.target)
        && !sourceIds.has(l.source?.id) && !sourceIds.has(l.target?.id));
    }

    return { nodes, links };
  }, [graphData, showEntities, showSources]);

  // Check if search filtering is active
  const isSearchActive = matchedNodes.length > 0;

  // Check if a node is matched by search
  const isNodeMatched = useCallback((nodeId) => {
    return matchedNodes.includes(nodeId);
  }, [matchedNodes]);

  // Get node color based on type
  const getNodeColor = useCallback((node, alpha = 1) => {
    if (node.id === selectedNodeId) return colors.selected;
    if (highlightedNodes.includes(node.id)) return colors.highlighted;

    let baseColor;
    if (node.type === 'note') baseColor = colors.note;
    else if (node.type === 'source') baseColor = colors.source;
    else if (node.type === 'entity') {
      baseColor = colors.entity[node.entityType] || colors.entity.concept;
    } else {
      baseColor = colors.links.sequential;
    }

    // Dim non-matched nodes when search is active
    if (isSearchActive && !isNodeMatched(node.id) && alpha === 1) {
      // Return dimmed version by appending alpha
      if (baseColor.startsWith('#')) {
        // Convert hex to rgba with 30% opacity
        return baseColor + '4D'; // 4D is ~30% in hex
      }
      return baseColor;
    }

    return baseColor;
  }, [selectedNodeId, highlightedNodes, colors, isSearchActive, isNodeMatched]);

  // Get node size based on type
  const getNodeSize = useCallback((node) => {
    if (node.type === 'source') return 8;
    if (node.type === 'entity') return 4 + Math.min(node.mentionCount || 1, 5);
    return 6;
  }, []);

  // Get link color
  const getLinkColor = useCallback((link) => {
    return colors.links[link.type] || colors.links.sequential;
  }, [colors]);

  // Get link width
  const getLinkWidth = useCallback((link) => {
    if (link.type === 'manual') return 2;
    if (link.type === 'sequential') return 1.5;
    if (link.type === 'shared_tag') return 1;
    return 0.5;
  }, []);

  // Get link dash pattern
  const getLinkDash = useCallback((link) => {
    if (link.type === 'shared_tag') return [5, 5];
    if (link.type === 'mentions') return [2, 2];
    return null;
  }, []);

  // Custom node rendering
  const nodeCanvasObject = useCallback((node, ctx, globalScale) => {
    const size = getNodeSize(node);
    const color = getNodeColor(node);
    const isHovered = hoveredNode?.id === node.id;
    const isSelected = node.id === selectedNodeId;
    const isMatched = isSearchActive && isNodeMatched(node.id);
    const isDimmed = isSearchActive && !isMatched && !isSelected;

    // Draw glow for matched nodes
    if (isMatched && !isSelected) {
      ctx.beginPath();
      if (node.type === 'source') {
        ctx.moveTo(node.x, node.y - size - 4);
        ctx.lineTo(node.x + size + 4, node.y);
        ctx.lineTo(node.x, node.y + size + 4);
        ctx.lineTo(node.x - size - 4, node.y);
        ctx.closePath();
      } else {
        ctx.arc(node.x, node.y, size + 4, 0, 2 * Math.PI, false);
      }
      ctx.fillStyle = colors.highlighted + '40'; // 25% alpha glow
      ctx.fill();
    }

    // Draw node
    ctx.beginPath();

    if (node.type === 'source') {
      // Diamond shape for sources
      ctx.moveTo(node.x, node.y - size);
      ctx.lineTo(node.x + size, node.y);
      ctx.lineTo(node.x, node.y + size);
      ctx.lineTo(node.x - size, node.y);
      ctx.closePath();
    } else {
      // Circle for notes and entities
      ctx.arc(node.x, node.y, size, 0, 2 * Math.PI, false);
    }

    // Apply dimming via globalAlpha for non-matched nodes
    if (isDimmed) {
      ctx.globalAlpha = 0.3;
    }

    ctx.fillStyle = color;
    ctx.fill();

    // Border for selected/hovered/matched
    if (isSelected || isHovered || isMatched) {
      ctx.strokeStyle = isSelected ? colors.selected : (isMatched ? colors.highlighted : colors.nodeLabel);
      ctx.lineWidth = (isMatched ? 3 : 2) / globalScale;
      ctx.stroke();
    }

    // Reset alpha
    if (isDimmed) {
      ctx.globalAlpha = 1;
    }

    // Draw label when zoomed in or hovered or matched
    if (globalScale > 1.5 || isHovered || isSelected || isMatched) {
      const label = node.type === 'entity' ? node.name : node.title;
      if (label) {
        const fontSize = Math.min(12 / globalScale, 14);
        ctx.font = `${fontSize}px Inter, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillStyle = isDimmed ? colors.nodeLabel + '4D' : colors.nodeLabel;
        ctx.fillText(
          label.length > 30 ? label.substring(0, 27) + '...' : label,
          node.x,
          node.y + size + 2
        );
      }
    }

    // Draw sequence number for notes
    if (node.type === 'note' && node.sequence && globalScale > 2) {
      ctx.font = `${8 / globalScale}px Inter, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#fff';
      ctx.fillText(node.sequence.toString(), node.x, node.y);
    }

    // Draw source icon
    if (node.type === 'source' && globalScale > 1) {
      const icon = SOURCE_ICONS[node.sourceType] || SOURCE_ICONS.article;
      ctx.font = `${10 / globalScale}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#fff';
      ctx.fillText(icon, node.x, node.y);
    }
  }, [getNodeSize, getNodeColor, hoveredNode, selectedNodeId, colors, isSearchActive, isNodeMatched]);

  // Handle node click
  const handleNodeClick = useCallback((node) => {
    if (onNodeClick) {
      onNodeClick(node);
    }
  }, [onNodeClick]);

  // Handle node hover
  const handleNodeHover = useCallback((node) => {
    setHoveredNode(node);
    if (onNodeHover) {
      onNodeHover(node);
    }
  }, [onNodeHover]);

  // Zoom to fit on initial load
  useEffect(() => {
    if (fgRef.current && filteredData.nodes.length > 0) {
      // Small delay to ensure graph is rendered
      setTimeout(() => {
        fgRef.current.zoomToFit(400, 50);
      }, 500);
    }
  }, [filteredData.nodes.length]);

  // Center on selected node
  useEffect(() => {
    if (fgRef.current && selectedNodeId) {
      const node = filteredData.nodes.find(n => n.id === selectedNodeId);
      if (node) {
        fgRef.current.centerAt(node.x, node.y, 300);
        fgRef.current.zoom(3, 300);
      }
    }
  }, [selectedNodeId, filteredData.nodes]);

  if (!filteredData.nodes.length) {
    return (
      <div className="kg-empty-state">
        <div className="kg-empty-icon">🕸️</div>
        <h3>No Knowledge Graph Yet</h3>
        <p>Run migration to build your knowledge graph from existing notes.</p>
      </div>
    );
  }

  return (
    <div className="kg-viewer">
      <ForceGraph2D
        ref={fgRef}
        graphData={filteredData}
        width={width}
        height={height}
        nodeCanvasObject={nodeCanvasObject}
        nodePointerAreaPaint={(node, color, ctx) => {
          const size = getNodeSize(node);
          ctx.beginPath();
          ctx.arc(node.x, node.y, size + 2, 0, 2 * Math.PI, false);
          ctx.fillStyle = color;
          ctx.fill();
        }}
        linkColor={getLinkColor}
        linkWidth={getLinkWidth}
        linkLineDash={getLinkDash}
        linkDirectionalParticles={0}
        onNodeClick={handleNodeClick}
        onNodeHover={handleNodeHover}
        cooldownTicks={100}
        onEngineStop={() => {
          if (fgRef.current) {
            fgRef.current.zoomToFit(400, 50);
          }
        }}
        d3AlphaDecay={0.02}
        d3VelocityDecay={0.3}
        // Group notes by source with stronger forces
        d3Force={(d3) => {
          // Strengthen link forces for sequential links
          d3.link()
            .strength(link => {
              if (link.type === 'sequential') return 0.8;
              if (link.type === 'from_source') return 0.5;
              return 0.2;
            })
            .distance(link => {
              if (link.type === 'sequential') return 30;
              if (link.type === 'from_source') return 50;
              return 100;
            });
        }}
      />

      {/* Hover tooltip */}
      {hoveredNode && (
        <div className="kg-tooltip">
          <div className="kg-tooltip-type">{hoveredNode.type}</div>
          <div className="kg-tooltip-title">
            {hoveredNode.type === 'entity' ? hoveredNode.name : hoveredNode.title}
          </div>
          {hoveredNode.type === 'note' && hoveredNode.tags && (
            <div className="kg-tooltip-tags">
              {hoveredNode.tags.slice(0, 3).join(' ')}
            </div>
          )}
          {hoveredNode.type === 'source' && (
            <div className="kg-tooltip-source-type">
              {SOURCE_ICONS[hoveredNode.sourceType]} {hoveredNode.sourceType}
            </div>
          )}
          {hoveredNode.type === 'entity' && (
            <div className="kg-tooltip-entity-type">
              {hoveredNode.entityType} ({hoveredNode.mentionCount} mentions)
            </div>
          )}
        </div>
      )}
    </div>
  );
}
