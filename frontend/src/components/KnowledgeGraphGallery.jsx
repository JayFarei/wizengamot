import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { X, Network, RefreshCw, Play, Square, Eye, EyeOff, ExternalLink, MessageSquare, ArrowRight, Maximize2, Minimize2, Target, ZoomOut, Search, Plus, ClipboardList, Zap, Moon, Bot, GitMerge, Link2, AlertTriangle, Wrench, Layers, FileText, BarChart3, Activity, Star, Image } from 'lucide-react';
import KnowledgeGraphViewer from './KnowledgeGraphViewer';
import KnowledgeGraphChat from './KnowledgeGraphChat';
import KnowledgeGraphSearch from './KnowledgeGraphSearch';
import KnowledgeGraphDiscover from './KnowledgeGraphDiscover';
import KnowledgeGraphReview from './KnowledgeGraphReview';
import KGActionMenu from './KGActionMenu';
import { api } from '../api';
import './KnowledgeGraph.css';

/**
 * KnowledgeGraphGallery - Main container for the knowledge graph feature
 * Includes graph viewer, migration controls, and detail panel
 */
export default function KnowledgeGraphGallery({
  onClose,
  onSelectConversation,
  onOpenImageGallery,
  initialEntityId = null,
  initialOpenReview = false,
  initialSearchQuery = null,
}) {
  const [graphData, setGraphData] = useState(null);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedNode, setSelectedNode] = useState(null);
  const [showEntities, setShowEntities] = useState(true);
  const [showSources, setShowSources] = useState(true);
  const [migrationStatus, setMigrationStatus] = useState(null);
  const [migrationPolling, setMigrationPolling] = useState(false);
  const [showChat, setShowChat] = useState(false);
  // Discover mode: 'quick' | 'sleep' | null
  const [discoverMode, setDiscoverMode] = useState(null);
  // Review view: 'insights' | 'entities' | 'relationships' | 'quality' | 'feedback' | null
  const [reviewView, setReviewView] = useState(null);
  // Review filter for insights view: 'pending' | 'approved' | 'dismissed'
  const [reviewFilter, setReviewFilter] = useState('pending');
  const [highlightedNodeId, setHighlightedNodeId] = useState(null);
  const [expandedView, setExpandedView] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [searchMatchedNodes, setSearchMatchedNodes] = useState([]);
  const [searchExpanded, setSearchExpanded] = useState(false);
  const [activeWorkers, setActiveWorkers] = useState([]);
  // Curation/tending operations loading state
  const [tendingLoading, setTendingLoading] = useState(null);
  // Curation candidates for review
  const [curationCandidates, setCurationCandidates] = useState([]);
  // Discovery stats for review badge
  const [discoveryStats, setDiscoveryStats] = useState(null);
  // Entity/relationship counts for badges
  const [unvalidatedCounts, setUnvalidatedCounts] = useState({ entities: 0, relationships: 0 });
  // Star toggle loading state
  const [starringInProgress, setStarringInProgress] = useState(false);
  const containerRef = useRef(null);
  const searchContainerRef = useRef(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

  // Find connected nodes for the selected node
  const connectedNodes = useMemo(() => {
    if (!selectedNode || !graphData?.nodes || !graphData?.links) return [];

    const connections = [];
    const nodeMap = new Map(graphData.nodes.map(n => [n.id, n]));

    for (const link of graphData.links) {
      const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
      const targetId = typeof link.target === 'object' ? link.target.id : link.target;

      if (sourceId === selectedNode.id) {
        const targetNode = nodeMap.get(targetId);
        if (targetNode) {
          connections.push({
            node: targetNode,
            linkType: link.type,
            direction: 'outgoing',
          });
        }
      } else if (targetId === selectedNode.id) {
        const sourceNode = nodeMap.get(sourceId);
        if (sourceNode) {
          connections.push({
            node: sourceNode,
            linkType: link.type,
            direction: 'incoming',
          });
        }
      }
    }

    // Sort by type: notes first, then sources, then entities
    const typeOrder = { note: 0, source: 1, entity: 2 };
    connections.sort((a, b) => (typeOrder[a.node.type] || 3) - (typeOrder[b.node.type] || 3));

    return connections;
  }, [selectedNode, graphData]);

  // Find the source node for a note
  const sourceNode = useMemo(() => {
    if (!selectedNode || selectedNode.type !== 'note' || !graphData?.nodes) return null;
    // Notes have sourceId property that points to the source node
    return graphData.nodes.find(n => n.type === 'source' && n.id === selectedNode.sourceId);
  }, [selectedNode, graphData]);

  // Create filtered subgraph when in focus mode
  const subgraphData = useMemo(() => {
    if (!focusMode || !selectedNode || !graphData) return graphData;

    // Get IDs of selected node + all connected nodes
    const nodeIds = new Set([selectedNode.id]);
    connectedNodes.forEach(conn => nodeIds.add(conn.node.id));

    // Filter nodes and links
    const filteredNodes = graphData.nodes.filter(n => nodeIds.has(n.id));
    const filteredLinks = graphData.links.filter(link => {
      const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
      const targetId = typeof link.target === 'object' ? link.target.id : link.target;
      return nodeIds.has(sourceId) && nodeIds.has(targetId);
    });

    return { nodes: filteredNodes, links: filteredLinks };
  }, [focusMode, selectedNode, connectedNodes, graphData]);

  // Load graph data
  const loadGraph = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [graph, statsData] = await Promise.all([
        api.getKnowledgeGraph(),
        api.getKnowledgeGraphStats(),
      ]);
      setGraphData(graph);
      setStats(statsData);
    } catch (err) {
      console.error('Failed to load knowledge graph:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load migration status
  const loadMigrationStatus = useCallback(async () => {
    try {
      const status = await api.getKnowledgeGraphMigrationStatus();
      setMigrationStatus(status);
      return status;
    } catch (err) {
      console.error('Failed to load migration status:', err);
    }
  }, []);

  // Load discovery stats (for review badges)
  const loadDiscoveryStats = useCallback(async () => {
    try {
      const result = await api.getDiscoveryStats();
      setDiscoveryStats(result);
    } catch (err) {
      console.error('Failed to load discovery stats:', err);
    }
  }, []);

  // Load unvalidated counts (for review badges)
  const loadUnvalidatedCounts = useCallback(async () => {
    try {
      const metrics = await api.getKnowledgeGraphQuality();
      setUnvalidatedCounts({
        entities: metrics?.review_backlog?.unvalidated_entities || 0,
        relationships: metrics?.review_backlog?.unvalidated_relationships || 0,
      });
    } catch (err) {
      console.error('Failed to load unvalidated counts:', err);
    }
  }, []);

  // Initial load
  useEffect(() => {
    loadGraph();
    loadMigrationStatus();
    loadDiscoveryStats();
    loadUnvalidatedCounts();
  }, [loadGraph, loadMigrationStatus, loadDiscoveryStats, loadUnvalidatedCounts]);

  // Poll for active sleep compute workers (persists across tab switches)
  useEffect(() => {
    const checkActiveWorkers = async () => {
      try {
        const { sessions } = await api.listSleepComputeSessions(10);
        const running = (sessions || []).filter(
          s => s.status === 'running' || s.status === 'paused'
        );
        setActiveWorkers(running);
      } catch (err) {
        console.error('Failed to check active workers:', err);
      }
    };

    checkActiveWorkers();
    const interval = setInterval(checkActiveWorkers, 5000);
    return () => clearInterval(interval);
  }, []);

  // Auto-select entity if initialEntityId is provided
  useEffect(() => {
    if (!initialEntityId || !graphData?.nodes) return;

    // Find the entity node by ID
    const entityNodeId = initialEntityId.startsWith('entity:')
      ? initialEntityId
      : `entity:${initialEntityId}`;
    const entityNode = graphData.nodes.find(n => n.id === entityNodeId);

    if (entityNode) {
      setSelectedNode(entityNode);
      setFocusMode(true); // Enable focus mode to show connected nodes
      setHighlightedNodeId(entityNode.id);
      setTimeout(() => setHighlightedNodeId(null), 2000);
    }
  }, [initialEntityId, graphData]);

  // Auto-open Review panel when initialOpenReview is true
  useEffect(() => {
    if (initialOpenReview) {
      setReviewView('insights');
      setReviewFilter('pending');
      setDiscoverMode(null);
      setShowChat(false);
    }
  }, [initialOpenReview]);

  // Auto-expand search when initialSearchQuery is provided
  useEffect(() => {
    if (initialSearchQuery && !loading && graphData?.nodes?.length > 0) {
      setSearchExpanded(true);
    }
  }, [initialSearchQuery, loading, graphData]);

  // Poll migration status while running
  useEffect(() => {
    if (!migrationPolling) return;

    const interval = setInterval(async () => {
      const status = await loadMigrationStatus();
      if (status && !status.running) {
        setMigrationPolling(false);
        loadGraph(); // Refresh graph when migration completes
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [migrationPolling, loadMigrationStatus, loadGraph]);

  // Handle container resize
  useEffect(() => {
    if (!containerRef.current) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setDimensions({ width, height });
      }
    });

    resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
  }, []);

  // Force dimension recalculation when chat panel opens/closes
  useEffect(() => {
    if (!containerRef.current) return;

    // Small delay to allow DOM to update after chat panel toggle
    const timer = setTimeout(() => {
      const rect = containerRef.current.getBoundingClientRect();
      setDimensions({ width: rect.width, height: rect.height });
    }, 50);

    return () => clearTimeout(timer);
  }, [showChat]);

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Cmd+Shift+V to open search (avoiding Cmd+K which is global palette)
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'v') {
        e.preventDefault();
        if (!loading && graphData?.nodes?.length > 0) {
          setSearchExpanded(true);
        }
      }
      if (e.key === 'Escape') {
        if (searchExpanded) {
          setSearchExpanded(false);
          setSearchMatchedNodes([]);
        } else if (selectedNode) {
          setSelectedNode(null);
        } else {
          onClose();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, selectedNode, searchExpanded, loading, graphData]);

  // Handle click outside search to collapse
  useEffect(() => {
    if (!searchExpanded) return;

    const handleClickOutside = (e) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target)) {
        setSearchExpanded(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [searchExpanded]);

  // Start migration
  const handleStartMigration = async () => {
    try {
      await api.startKnowledgeGraphMigration(false);
      setMigrationPolling(true);
      loadMigrationStatus();
    } catch (err) {
      console.error('Failed to start migration:', err);
      setError(err.message);
    }
  };

  // Rebuild entire graph
  const handleRebuild = async () => {
    try {
      await api.rebuildKnowledgeGraph();
      setMigrationPolling(true);
      loadMigrationStatus();
    } catch (err) {
      console.error('Failed to rebuild graph:', err);
      setError(err.message);
    }
  };

  // Cancel migration
  const handleCancelMigration = async () => {
    try {
      await api.cancelKnowledgeGraphMigration();
      loadMigrationStatus();
    } catch (err) {
      console.error('Failed to cancel migration:', err);
    }
  };

  // ==========================================================================
  // Tend Graph / Curation Actions (for Create menu)
  // ==========================================================================

  // Run curation analysis with specific rubrics
  const handleTendGraph = async (rubrics, useAgent = false) => {
    setTendingLoading(rubrics.join('-'));
    try {
      let result;
      if (useAgent && rubrics.includes('duplicates')) {
        result = await api.analyzeCurationWithAgent({ rubrics });
      } else {
        result = await api.analyzeCuration({ rubrics });
      }

      if (result.candidates?.length > 0) {
        // Store candidates and open review panel in curation mode
        setCurationCandidates(result.candidates);
        setReviewView('curation');
        setDiscoverMode(null);
        setShowChat(false);
      } else {
        // No candidates found - clear any existing candidates
        setCurationCandidates([]);
        console.log('No curation candidates found');
      }
    } catch (err) {
      console.error('Curation analysis failed:', err);
    } finally {
      setTendingLoading(null);
    }
  };

  // Normalize entities
  const handleNormalizeEntities = async () => {
    setTendingLoading('normalize');
    try {
      await api.normalizeEntities();
      loadGraph();
    } catch (err) {
      console.error('Normalize entities failed:', err);
    } finally {
      setTendingLoading(null);
    }
  };

  // ==========================================================================
  // Panel Opening Helpers
  // ==========================================================================

  // Open discover panel in specified mode
  const openDiscover = (mode) => {
    setDiscoverMode(mode);
    setReviewView(null);
    setShowChat(false);
  };

  // Open review panel with specified view
  const openReview = (view, filter = 'pending') => {
    setReviewView(view);
    if (view === 'insights') {
      setReviewFilter(filter);
    }
    setDiscoverMode(null);
    setShowChat(false);
  };

  // Open chat panel
  const openChat = () => {
    setShowChat(true);
    setDiscoverMode(null);
    setReviewView(null);
  };

  // Handle node click
  const handleNodeClick = useCallback((node) => {
    setSelectedNode(node);
    setFocusMode(true); // Auto-focus on click to show subgraph
    setExpandedView(false); // Reset expanded view when selecting new node
    setSearchMatchedNodes([]); // Clear search filter when navigating to a node
  }, []);

  // Navigate to a connected node
  const handleConnectionClick = useCallback((node) => {
    setSelectedNode(node);
    setExpandedView(false);
    setSearchMatchedNodes([]); // Clear search filter when navigating to a node
    // Also highlight it briefly
    setHighlightedNodeId(node.id);
    setTimeout(() => setHighlightedNodeId(null), 2000);
  }, []);

  // Navigate to conversation
  const handleViewConversation = useCallback(() => {
    if (selectedNode) {
      let conversationId = null;
      if (selectedNode.type === 'note') {
        // sourceId format is "source:{conversationId}", extract the conversation ID
        conversationId = selectedNode.sourceId?.replace('source:', '');
      } else if (selectedNode.type === 'source') {
        conversationId = selectedNode.conversationId;
      }
      if (conversationId && onSelectConversation) {
        onSelectConversation(conversationId);
        onClose();
      }
    }
  }, [selectedNode, onSelectConversation, onClose]);

  // Highlight a node from chat citation click
  const handleHighlightNode = useCallback((noteId) => {
    setHighlightedNodeId(noteId);
    // Find the node and select it
    if (graphData?.nodes) {
      const node = graphData.nodes.find(n => n.id === noteId);
      if (node) {
        setSelectedNode(node);
      }
    }
    // Clear highlight after a few seconds
    setTimeout(() => setHighlightedNodeId(null), 3000);
  }, [graphData]);

  // Handle search results change
  const handleSearchResultsChange = useCallback((matchedIds) => {
    setSearchMatchedNodes(matchedIds || []);
  }, []);

  // Handle search result selection
  const handleSearchSelectNode = useCallback((nodeId) => {
    if (graphData?.nodes) {
      const node = graphData.nodes.find(n => n.id === nodeId);
      if (node) {
        setSelectedNode(node);
        setFocusMode(true);
        setExpandedView(false);
        setSearchMatchedNodes([]); // Clear search filter when navigating to a node
        // Also highlight briefly
        setHighlightedNodeId(nodeId);
        setTimeout(() => setHighlightedNodeId(null), 2000);
      }
    }
  }, [graphData]);

  // Handle toggling star status for a note
  const handleToggleStar = useCallback(async () => {
    if (!selectedNode || selectedNode.type !== 'note' || starringInProgress) return;

    // Extract conversation ID and note ID from node ID format: "note:{convId}:{noteId}"
    const parts = selectedNode.id.split(':');
    const conversationId = parts[1];
    const noteId = parts.slice(2).join(':');

    const newStarred = !selectedNode.quality?.starred;

    setStarringInProgress(true);
    try {
      await api.toggleNoteStar(conversationId, noteId, newStarred);

      // Update selected node state
      setSelectedNode(prev => ({
        ...prev,
        quality: { ...prev.quality, starred: newStarred }
      }));

      // Update graph data to persist change
      setGraphData(prev => ({
        ...prev,
        nodes: prev.nodes.map(n =>
          n.id === selectedNode.id
            ? { ...n, quality: { ...n.quality, starred: newStarred } }
            : n
        )
      }));
    } catch (err) {
      console.error('Failed to toggle star:', err);
    } finally {
      setStarringInProgress(false);
    }
  }, [selectedNode, starringInProgress]);

  // Calculate pending conversations
  const pendingConversations = stats
    ? stats.total_conversations - stats.processed_conversations
    : 0;

  return (
    <div className="kg-gallery">
      {/* Header */}
      <div className={`kg-gallery-header ${searchExpanded ? 'search-active' : ''}`}>
        <div className="kg-gallery-title">
          <Network size={24} />
          <h2>Knowledge Graph</h2>
          {/* Compact stats shown next to title when not searching */}
          {!searchExpanded && stats && (
            <div className="kg-compact-stats">
              <span>{stats.total_notes} notes</span>
              <span className="kg-stat-dot">·</span>
              <span>{stats.total_entities} entities</span>
            </div>
          )}
        </div>

        {/* Modern Search - Pill when collapsed, full input when expanded */}
        <div className={`kg-search-area ${searchExpanded ? 'expanded' : ''}`} ref={searchContainerRef}>
          {searchExpanded ? (
            <div className="kg-search-expanded">
              <KnowledgeGraphSearch
                graphData={graphData}
                onResultsChange={handleSearchResultsChange}
                onSelectNode={(nodeId) => {
                  handleSearchSelectNode(nodeId);
                  setSearchExpanded(false);
                }}
                autoFocus={true}
                initialQuery={initialSearchQuery}
              />
              <button
                className="kg-search-close"
                onClick={() => {
                  setSearchExpanded(false);
                  setSearchMatchedNodes([]);
                }}
              >
                <X size={14} />
              </button>
            </div>
          ) : (
            !loading && graphData?.nodes?.length > 0 && (
              <button
                className="kg-search-pill"
                onClick={() => setSearchExpanded(true)}
              >
                <Search size={14} />
                <span className="kg-search-pill-text">Search nodes...</span>
                <kbd className="kg-search-shortcut">⇧⌘V</kbd>
              </button>
            )
          )}
        </div>

        <div className={`kg-gallery-actions ${searchExpanded ? 'hidden' : ''}`}>
          {/* Create Menu */}
          <KGActionMenu
            icon={<Plus size={16} />}
            label="Create"
            sections={[
              {
                title: 'Generate Insights',
                items: [
                  {
                    icon: <Zap size={14} />,
                    label: 'Quick Prompt',
                    onClick: () => openDiscover('quick'),
                  },
                  {
                    icon: <Moon size={14} />,
                    label: 'Sleep Compute',
                    badge: activeWorkers.length,
                    onClick: () => openDiscover('sleep'),
                  },
                ],
              },
              {
                title: 'Tend Graph',
                items: [
                  {
                    icon: <Bot size={14} />,
                    label: 'Structure Review (AI)',
                    loading: tendingLoading === 'duplicates',
                    onClick: () => handleTendGraph(['duplicates'], true),
                  },
                  {
                    icon: <GitMerge size={14} />,
                    label: 'Find Duplicates',
                    loading: tendingLoading === 'duplicates-fast',
                    onClick: () => handleTendGraph(['duplicates'], false),
                  },
                  {
                    icon: <Link2 size={14} />,
                    label: 'Missing Relations',
                    loading: tendingLoading === 'missing',
                    onClick: () => handleTendGraph(['missing']),
                  },
                  {
                    icon: <AlertTriangle size={14} />,
                    label: 'Validate Relations',
                    loading: tendingLoading === 'suspect',
                    onClick: () => handleTendGraph(['suspect']),
                  },
                  {
                    icon: <Wrench size={14} />,
                    label: 'Full Analysis',
                    loading: tendingLoading === 'duplicates-missing-suspect',
                    onClick: () => handleTendGraph(['duplicates', 'missing', 'suspect']),
                  },
                  {
                    icon: <Layers size={14} />,
                    label: 'Normalize Entities',
                    loading: tendingLoading === 'normalize',
                    onClick: handleNormalizeEntities,
                  },
                ],
              },
              {
                items: [
                  {
                    icon: <RefreshCw size={14} />,
                    label: 'Re-index Graph',
                    onClick: handleRebuild,
                  },
                ],
              },
            ]}
          />

          {/* Review Menu */}
          <KGActionMenu
            icon={<ClipboardList size={16} />}
            label="Review"
            sections={[
              {
                title: 'Generated Insights',
                items: [
                  {
                    icon: <FileText size={14} />,
                    label: 'Pending',
                    badge: discoveryStats?.pending,
                    onClick: () => openReview('insights', 'pending'),
                  },
                  {
                    icon: <FileText size={14} />,
                    label: 'Approved',
                    onClick: () => openReview('insights', 'approved'),
                  },
                  {
                    icon: <FileText size={14} />,
                    label: 'Dismissed',
                    onClick: () => openReview('insights', 'dismissed'),
                  },
                ],
              },
              {
                title: 'Validate Extractions',
                items: [
                  {
                    icon: <Layers size={14} />,
                    label: 'Entities',
                    badge: unvalidatedCounts.entities > 0 ? unvalidatedCounts.entities : null,
                    onClick: () => openReview('entities'),
                  },
                  {
                    icon: <Link2 size={14} />,
                    label: 'Relationships',
                    badge: unvalidatedCounts.relationships > 0 ? unvalidatedCounts.relationships : null,
                    onClick: () => openReview('relationships'),
                  },
                ],
              },
              {
                title: 'Dashboards',
                items: [
                  {
                    icon: <BarChart3 size={14} />,
                    label: 'Quality',
                    onClick: () => openReview('quality'),
                  },
                  {
                    icon: <Activity size={14} />,
                    label: 'Feedback Learning',
                    onClick: () => openReview('feedback'),
                  },
                ],
              },
            ]}
          />

          {/* Chat Quick Action */}
          <button
            className={`kg-icon-btn ${showChat ? 'active' : ''}`}
            onClick={() => showChat ? setShowChat(false) : openChat()}
            title={showChat ? 'Hide Chat' : 'Ask Knowledge Graph'}
          >
            <MessageSquare size={16} />
          </button>

          {/* Gallery Quick Action */}
          {onOpenImageGallery && (
            <button
              className="kg-icon-btn"
              onClick={onOpenImageGallery}
              title="Open Image Gallery (⌘G)"
            >
              <Image size={16} />
            </button>
          )}

          {/* Close Button */}
          <button className="kg-close-btn" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
      </div>

      {/* Migration panel - show if there are pending conversations */}
      {(pendingConversations > 0 || migrationStatus?.running) && (
        <div className="kg-migration-panel">
          {migrationStatus?.running ? (
            <>
              <div className="kg-migration-title">Migration in Progress</div>
              <div className="kg-migration-progress">
                <div
                  className="kg-migration-bar"
                  style={{
                    width: `${((migrationStatus.processed + migrationStatus.failed) / migrationStatus.total) * 100}%`,
                  }}
                />
              </div>
              <div className="kg-migration-status">
                {migrationStatus.processed} of {migrationStatus.total} conversations processed
              </div>
              {migrationStatus.current && (
                <div className="kg-migration-current">
                  Currently: {migrationStatus.current}
                </div>
              )}
              <div className="kg-migration-actions">
                <button
                  className="kg-btn kg-btn-danger"
                  onClick={handleCancelMigration}
                >
                  <Square size={14} /> Cancel
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="kg-migration-status">
                {stats?.total_conversations} conversations, {pendingConversations} not yet indexed
              </div>
              <div className="kg-migration-actions">
                <button
                  className="kg-btn kg-btn-primary"
                  onClick={handleStartMigration}
                >
                  <Play size={14} /> Run Migration
                </button>
                <button
                  className="kg-btn kg-btn-secondary"
                  onClick={handleRebuild}
                >
                  <RefreshCw size={14} /> Re-index All
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Main content */}
      <div className={`kg-gallery-content ${showChat ? 'chat-open' : ''} ${discoverMode ? 'discover-open' : ''} ${reviewView ? 'review-open' : ''}`}>
        {/* Graph container */}
        <div className="kg-graph-container" ref={containerRef}>
          {loading ? (
            <div className="kg-loading-state">
              <div className="kg-loading-spinner"></div>
              <h3>Loading Knowledge Graph</h3>
              <p>Fetching your notes and connections...</p>
            </div>
          ) : !loading && stats?.total_notes === 0 && pendingConversations > 0 && !migrationStatus?.running ? (
            <div className="kg-migration-welcome">
              <div className="kg-migration-welcome-icon">
                <Network size={64} strokeWidth={1} />
              </div>
              <h2>Index Your Knowledge Graph</h2>
              <p>You have {pendingConversations} Synthesizer conversation{pendingConversations !== 1 ? 's' : ''} ready to be indexed.</p>
              <p className="kg-migration-subtext">
                This will extract entities and connections from your notes.
              </p>
              <button className="kg-btn kg-btn-primary kg-btn-large" onClick={handleStartMigration}>
                <Play size={18} /> Run Migration
              </button>
            </div>
          ) : error ? (
            <div className="kg-empty-state">
              <div className="kg-empty-icon">⚠️</div>
              <h3>Error Loading Graph</h3>
              <p>{error}</p>
              <button className="kg-btn kg-btn-primary" onClick={loadGraph}>
                Try Again
              </button>
            </div>
          ) : (
            <KnowledgeGraphViewer
              key={showChat ? 'with-chat' : 'no-chat'}
              graphData={focusMode ? subgraphData : graphData}
              onNodeClick={handleNodeClick}
              selectedNodeId={selectedNode?.id}
              highlightedNodes={highlightedNodeId ? [highlightedNodeId] : []}
              matchedNodes={searchMatchedNodes}
              showEntities={showEntities}
              showSources={showSources}
              width={dimensions.width}
              height={dimensions.height}
            />
          )}

          {/* Show All button when in focus mode */}
          {focusMode && (
            <button
              className="kg-btn kg-btn-secondary kg-show-all-btn"
              onClick={() => setFocusMode(false)}
            >
              <ZoomOut size={14} />
              Show Full Graph
            </button>
          )}

          {/* Controls */}
          <div className="kg-controls">
            <div className="kg-control-group">
              <label>
                <input
                  type="checkbox"
                  checked={showEntities}
                  onChange={(e) => setShowEntities(e.target.checked)}
                />
                {showEntities ? <Eye size={14} /> : <EyeOff size={14} />}
                Show Entities
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={showSources}
                  onChange={(e) => setShowSources(e.target.checked)}
                />
                {showSources ? <Eye size={14} /> : <EyeOff size={14} />}
                Show Sources
              </label>
            </div>
          </div>

          {/* Legend */}
          <div className="kg-legend">
            <h4>Legend</h4>
            <div className="kg-legend-item">
              <div className="kg-legend-dot" style={{ background: 'var(--kg-note)' }} />
              Note
            </div>
            <div className="kg-legend-item">
              <div className="kg-legend-dot" style={{ background: 'var(--kg-source)', transform: 'rotate(45deg)' }} />
              Source
            </div>
            <div className="kg-legend-item">
              <div className="kg-legend-dot" style={{ background: 'var(--kg-entity-person)' }} />
              Person
            </div>
            <div className="kg-legend-item">
              <div className="kg-legend-dot" style={{ background: 'var(--kg-entity-org)' }} />
              Organization
            </div>
            <div className="kg-legend-item">
              <div className="kg-legend-dot" style={{ background: 'var(--kg-entity-concept)' }} />
              Concept
            </div>
            <div className="kg-legend-item">
              <div className="kg-legend-dot" style={{ background: 'var(--kg-entity-tech)' }} />
              Technology
            </div>
            <div className="kg-legend-item">
              <div className="kg-legend-dot" style={{ background: 'var(--kg-entity-event)' }} />
              Event
            </div>
            <div className="kg-legend-item">
              <div className="kg-legend-line" style={{ background: 'var(--kg-link-sequential)' }} />
              Sequential
            </div>
            <div className="kg-legend-item">
              <div className="kg-legend-line" style={{ background: 'var(--kg-link-shared-tag)', borderStyle: 'dashed' }} />
              Shared Tag
            </div>
          </div>
        </div>

        {/* Detail panel */}
        {selectedNode && (
          <div className={`kg-detail-panel ${expandedView ? 'kg-detail-expanded' : ''}`}>
            <div className="kg-detail-header">
              <div className="kg-detail-header-top">
                <div className="kg-detail-type">
                  {selectedNode.type === 'entity' ? selectedNode.entityType : selectedNode.type}
                </div>
                <div className="kg-detail-header-btns">
                  {selectedNode.type === 'note' && (
                    <button
                      className={`kg-detail-star-btn ${selectedNode.quality?.starred ? 'starred' : ''}`}
                      onClick={handleToggleStar}
                      disabled={starringInProgress}
                      title={selectedNode.quality?.starred ? 'Unstar note' : 'Star note'}
                    >
                      <Star size={16} fill={selectedNode.quality?.starred ? 'currentColor' : 'none'} />
                    </button>
                  )}
                  <button
                    className="kg-detail-focus-btn"
                    onClick={() => setFocusMode(!focusMode)}
                    title={focusMode ? 'Show full graph' : 'Focus on this node'}
                  >
                    {focusMode ? <ZoomOut size={16} /> : <Target size={16} />}
                  </button>
                  {selectedNode.type === 'note' && selectedNode.body && (
                    <button
                      className="kg-detail-expand-btn"
                      onClick={() => setExpandedView(!expandedView)}
                      title={expandedView ? 'Collapse' : 'Expand to full view'}
                    >
                      {expandedView ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                    </button>
                  )}
                </div>
              </div>
              <h3 className="kg-detail-title">
                {selectedNode.type === 'entity' ? selectedNode.name : selectedNode.title}
              </h3>
            </div>

            <div className="kg-detail-body">
              {/* Tags for notes */}
              {selectedNode.type === 'note' && selectedNode.tags?.length > 0 && (
                <div className="kg-detail-section">
                  <h4>Tags</h4>
                  <div className="kg-detail-tags">
                    {selectedNode.tags.map((tag, i) => (
                      <span key={i} className="kg-detail-tag">{tag}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Full note content */}
              {selectedNode.type === 'note' && selectedNode.body && (
                <div className={`kg-detail-section kg-detail-content ${expandedView ? 'kg-content-expanded' : ''}`}>
                  <h4>Content</h4>
                  <div className="kg-note-body">
                    {selectedNode.body}
                  </div>
                </div>
              )}

              {/* Source info */}
              {selectedNode.type === 'source' && (
                <div className="kg-detail-section">
                  <h4>Source Type</h4>
                  <p className="kg-detail-text">{selectedNode.sourceType}</p>
                  {selectedNode.url && (
                    <a
                      href={selectedNode.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="kg-external-link"
                    >
                      <ExternalLink size={14} />
                      Open Source
                    </a>
                  )}
                </div>
              )}

              {/* Entity mentions */}
              {selectedNode.type === 'entity' && (
                <div className="kg-detail-section">
                  <h4>Mentions</h4>
                  <p className="kg-detail-text">
                    Found in {selectedNode.mentionCount} note(s)
                  </p>
                </div>
              )}

              {/* Connections section */}
              {connectedNodes.length > 0 && (
                <div className="kg-detail-section kg-detail-connections-section">
                  <h4>Connections ({connectedNodes.length})</h4>
                  <ul className="kg-detail-connections">
                    {connectedNodes.map((conn, i) => (
                      <li
                        key={i}
                        className="kg-detail-connection"
                        onClick={() => handleConnectionClick(conn.node)}
                      >
                        <span className={`kg-conn-type-badge kg-conn-${conn.node.type}`}>
                          {conn.node.type === 'entity' ? conn.node.entityType : conn.node.type}
                        </span>
                        <span className="kg-conn-title">
                          {conn.node.type === 'entity' ? conn.node.name : conn.node.title}
                        </span>
                        <span className="kg-conn-link-type">{conn.linkType}</span>
                        <ArrowRight size={12} className="kg-conn-arrow" />
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <div className="kg-detail-footer">
              {/* Source info with external link */}
              {selectedNode.type === 'note' && sourceNode && (
                sourceNode.url ? (
                  <a
                    href={sourceNode.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="kg-detail-source-footer kg-source-clickable"
                  >
                    <span className="kg-source-type-badge">{sourceNode.sourceType}</span>
                    <span className="kg-source-footer-title">{sourceNode.title}</span>
                    <ExternalLink size={14} className="kg-source-link-icon" />
                  </a>
                ) : (
                  <div className="kg-detail-source-footer">
                    <span className="kg-source-type-badge">{sourceNode.sourceType}</span>
                    <span className="kg-source-footer-title">{sourceNode.title}</span>
                  </div>
                )
              )}

              {/* Action buttons */}
              <div className="kg-detail-action-buttons">
                {(selectedNode.type === 'note' || selectedNode.type === 'source') && (
                  <button
                    className="kg-btn kg-btn-secondary kg-btn-primary-action"
                    onClick={handleViewConversation}
                  >
                    <ExternalLink size={14} />
                    View in Conversation
                  </button>
                )}
                <button
                  className="kg-btn kg-btn-secondary kg-btn-close-action"
                  onClick={() => {
                    setSelectedNode(null);
                    setExpandedView(false);
                  }}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Chat panel */}
        {showChat && (
          <KnowledgeGraphChat
            onClose={() => setShowChat(false)}
            onSelectConversation={onSelectConversation}
            onHighlightNode={handleHighlightNode}
          />
        )}

        {/* Generate (Discovery) panel */}
        {discoverMode && (
          <KnowledgeGraphDiscover
            mode={discoverMode}
            onClose={() => setDiscoverMode(null)}
            onRefreshGraph={loadGraph}
            activeWorkers={activeWorkers}
            setActiveWorkers={setActiveWorkers}
          />
        )}

        {/* Review panel */}
        {reviewView && (
          <KnowledgeGraphReview
            view={reviewView}
            initialFilter={reviewFilter}
            onClose={() => {
              setReviewView(null);
              setCurationCandidates([]);
            }}
            onSelectConversation={onSelectConversation}
            onRefreshGraph={() => {
              loadGraph();
              loadDiscoveryStats();
              loadUnvalidatedCounts();
            }}
            curationCandidates={curationCandidates}
          />
        )}
      </div>
    </div>
  );
}
