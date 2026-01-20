import { useState, useRef, useEffect, useCallback } from 'react';
import * as LucideIcons from 'lucide-react';
import './Sidebar.css';
import { formatRelativeTime } from '../utils/formatRelativeTime';
import { api } from '../api';

// Helper to get Lucide icon component from name
function getIconComponent(iconName) {
  if (!iconName) return LucideIcons.Image;
  const pascalCase = iconName
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
  return LucideIcons[pascalCase] || LucideIcons.Image;
}

// Mode icons for conversation entries
const MODE_ICONS = {
  council: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="7" r="4" />
      <path d="M5.5 21a6.5 6.5 0 0 1 13 0" />
      <circle cx="4" cy="9" r="2.5" />
      <path d="M1 19a4 4 0 0 1 6 0" />
      <circle cx="20" cy="9" r="2.5" />
      <path d="M17 19a4 4 0 0 1 6 0" />
    </svg>
  ),
  synthesizer: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="7" height="9" rx="1" />
      <rect x="14" y="3" width="7" height="9" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  ),
  visualiser: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="9" y1="3" x2="9" y2="21" />
      <line x1="3" y1="9" x2="21" y2="9" />
      <line x1="3" y1="15" x2="21" y2="15" />
      <line x1="15" y1="3" x2="15" y2="21" />
    </svg>
  ),
  podcast: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  ),
};

function getSourceTypeLabel(sourceType) {
  const labels = {
    youtube: 'YouTube',
    article: 'Article',
    podcast: 'Podcast',
    pdf: 'PDF',
    arxiv: 'arXiv',
    text: 'Text',
  };
  return labels[sourceType] || sourceType;
}

function getVisualiserSourceLabel(sourceType) {
  const labels = {
    conversation: 'Conversation',
    url: 'URL',
    text: 'Text'
  };
  return labels[sourceType] || sourceType;
}

function TypewriterTitle({ text, isAnimating, onAnimationComplete }) {
  const [displayText, setDisplayText] = useState(text);
  const animatingRef = useRef(false);
  const indexRef = useRef(0);
  const timerRef = useRef(null);

  // Handle animation
  useEffect(() => {
    if (isAnimating && !animatingRef.current) {
      animatingRef.current = true;
      indexRef.current = 0;

      const runAnimation = () => {
        if (indexRef.current < text.length) {
          indexRef.current += 1;
          setDisplayText(text.slice(0, indexRef.current));
          timerRef.current = setTimeout(runAnimation, 30);
        } else {
          animatingRef.current = false;
          onAnimationComplete?.();
        }
      };

      timerRef.current = setTimeout(runAnimation, 30);
    }

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [isAnimating, text, onAnimationComplete]);

  // Update text when not actively animating and text changes
  useEffect(() => {
    if (!animatingRef.current) {
      setDisplayText(text);
    }
  }, [text]);

  return <>{displayText || text}</>;
}

// Sidebar style modes
const SIDEBAR_STYLES = {
  CATEGORY: 'category',
  FOCUS: 'focus',
  LIST: 'list',
};

// Category types
const CATEGORIES = {
  NOTES: 'notes',
  COUNCIL: 'council',
  VISUALISER: 'visualiser',
  MONITOR: 'monitor',
};

// Style selector icons
const StyleIcons = {
  category: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  ),
  focus: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  ),
  list: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <circle cx="4" cy="6" r="1.5" fill="currentColor" />
      <circle cx="4" cy="12" r="1.5" fill="currentColor" />
      <circle cx="4" cy="18" r="1.5" fill="currentColor" />
    </svg>
  ),
};

// Category badge component for list mode
function CategoryBadge({ category }) {
  const colors = {
    notes: { bg: 'var(--badge-notes-bg, #e0f2fe)', text: 'var(--badge-notes-text, #0369a1)' },
    council: { bg: 'var(--badge-council-bg, #fef3c7)', text: 'var(--badge-council-text, #92400e)' },
    visualiser: { bg: 'var(--badge-visualiser-bg, #f3e8ff)', text: 'var(--badge-visualiser-text, #7e22ce)' },
    monitor: { bg: 'var(--badge-monitor-bg, #dcfce7)', text: 'var(--badge-monitor-text, #166534)' },
  };
  const style = colors[category] || colors.notes;
  const labels = { notes: 'Notes', council: 'Council', visualiser: 'Visualiser', monitor: 'Monitor' };

  return (
    <span className="category-badge" style={{ background: style.bg, color: style.text }}>
      {labels[category] || category}
    </span>
  );
}

export default function Sidebar({
  conversations,
  currentConversationId,
  onSelectConversation,
  onNewConversation,
  onDeleteConversation,
  onOpenSettings,
  onOpenSearch,
  onGoHome,
  credits,
  collapsed,
  onToggleCollapse,
  isLoading,
  animatingTitleId,
  onTitleAnimationComplete,
  promptLabels = {},
  monitors = [],
  currentMonitorId,
  onSelectMonitor,
  onPauseMonitor,
  onResumeMonitor,
  onDeleteMonitor,
  visualiserSettings,
  onOpenImageGallery,
  onOpenCouncilGallery,
  onOpenNotesGallery,
  onOpenPodcastGallery,
  onOpenKnowledgeGraph,
}) {
  const [pendingDeleteId, setPendingDeleteId] = useState(null);
  const [discoveryStats, setDiscoveryStats] = useState({ pending: 0, total_discoveries: 0 });
  const [activeWorkers, setActiveWorkers] = useState(0);

  // Sidebar style state with localStorage persistence
  const [sidebarStyle, setSidebarStyle] = useState(() => {
    const saved = localStorage.getItem('sidebarStyle');
    return saved && Object.values(SIDEBAR_STYLES).includes(saved) ? saved : SIDEBAR_STYLES.LIST;
  });
  const [focusedCategory, setFocusedCategory] = useState(CATEGORIES.NOTES);

  // Filter and sort state
  const [sortBy, setSortBy] = useState('recent'); // 'recent' | 'cost'
  const [selectedTypes, setSelectedTypes] = useState([]); // source_type filter
  const [modeFilter, setModeFilter] = useState(null); // 'agent' | 'user' | null
  const [typeDropdownOpen, setTypeDropdownOpen] = useState(false);

  // Persist sidebar style to localStorage
  useEffect(() => {
    localStorage.setItem('sidebarStyle', sidebarStyle);
  }, [sidebarStyle]);

  // Fetch discovery stats and worker status
  const fetchDiscoveryData = useCallback(async () => {
    try {
      // Fetch discovery stats
      const stats = await api.getDiscoveryStats();
      setDiscoveryStats(stats);

      // Fetch active workers (sessions with status "running")
      const { sessions } = await api.listSleepComputeSessions(10);
      const runningCount = sessions.filter(s => s.status === 'running').length;
      setActiveWorkers(runningCount);
    } catch (err) {
      // Silently fail - discovery features may not be available
      console.debug('Failed to fetch discovery data:', err);
    }
  }, []);

  // Fetch on mount and poll when workers are running
  useEffect(() => {
    fetchDiscoveryData();

    // Poll every 5 seconds when there are active workers
    const pollInterval = setInterval(() => {
      if (activeWorkers > 0) {
        fetchDiscoveryData();
      }
    }, 5000);

    // Also poll every 30 seconds regardless (to catch new workers)
    const slowPollInterval = setInterval(fetchDiscoveryData, 30000);

    return () => {
      clearInterval(pollInterval);
      clearInterval(slowPollInterval);
    };
  }, [fetchDiscoveryData, activeWorkers]);

  // Click outside to cancel delete confirmation
  useEffect(() => {
    if (!pendingDeleteId) return;

    const handleClickOutside = () => setPendingDeleteId(null);
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [pendingDeleteId]);

  // Close type dropdown when clicking outside
  useEffect(() => {
    if (!typeDropdownOpen) return;

    const handleClick = (e) => {
      if (!e.target.closest('.filter-dropdown-wrapper')) {
        setTypeDropdownOpen(false);
      }
    };
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, [typeDropdownOpen]);

  // Helper: Get category for a conversation
  const getConversationCategory = useCallback((conv) => {
    if (conv.mode === 'synthesizer' || conv.mode === 'discovery') return CATEGORIES.NOTES;
    if (conv.mode === 'visualiser') return CATEGORIES.VISUALISER;
    // Default to council for council mode or undefined
    return CATEGORIES.COUNCIL;
  }, []);

  // Helper: Filter and sort conversations
  const filterAndSortConversations = useCallback((convs) => {
    let filtered = [...convs];

    // Filter by source_type
    if (selectedTypes.length > 0) {
      filtered = filtered.filter(c => c.source_type && selectedTypes.includes(c.source_type));
    }

    // Filter by mode (agent vs user)
    if (modeFilter === 'agent') {
      filtered = filtered.filter(c => c.mode === 'discovery');
    } else if (modeFilter === 'user') {
      filtered = filtered.filter(c => c.mode !== 'discovery');
    }

    // Sort
    if (sortBy === 'cost') {
      filtered.sort((a, b) => (b.total_cost || 0) - (a.total_cost || 0));
    } else {
      // Default: sort by created_at descending
      filtered.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }

    return filtered;
  }, [selectedTypes, modeFilter, sortBy]);

  // Get conversations by category (memoized)
  const notesConversations = filterAndSortConversations(
    conversations.filter(c => c.mode === 'synthesizer' || c.mode === 'discovery')
  );
  const councilConversations = filterAndSortConversations(
    conversations.filter(c => c.mode !== 'synthesizer' && c.mode !== 'visualiser' && c.mode !== 'discovery')
  );
  const visualiserConversations = filterAndSortConversations(
    conversations.filter(c => c.mode === 'visualiser')
  );

  // All conversations for list mode
  const allConversations = filterAndSortConversations(conversations);

  // Toggle type filter
  const toggleType = (type) => {
    setSelectedTypes(prev =>
      prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
    );
  };

  // Toggle mode filter
  const toggleModeFilter = () => {
    setModeFilter(prev => {
      if (prev === null) return 'agent';
      if (prev === 'agent') return 'user';
      return null;
    });
  };

  return (
    <div className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      {/* Top actions - always visible */}
      <div className="sidebar-top">
        <button className="sidebar-action-btn" onClick={onToggleCollapse} title={collapsed ? 'Open sidebar (⌘/)' : 'Close sidebar (⌘/)'}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="18" height="18" rx="2"/>
            <path d="M9 3v18"/>
          </svg>
          <span className="action-text">{collapsed ? 'Open sidebar' : 'Close sidebar'}</span>
          <span className="shortcut">⌘/</span>
        </button>
        <button className="sidebar-action-btn" onClick={onNewConversation} title="New discussion (⌘D)">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 5v14M5 12h14"/>
          </svg>
          <span className="action-text">New discussion</span>
          <span className="shortcut">⌘D</span>
        </button>
        <button className="sidebar-action-btn" onClick={onOpenSearch} title="Search chats (⌘K)">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8"/>
            <path d="m21 21-4.35-4.35"/>
          </svg>
          <span className="action-text">Search chats</span>
          <span className="shortcut">⌘K</span>
        </button>
      </div>

      {/* Separator line */}
      <div className="sidebar-separator"></div>

      {/* Style selector - below top actions */}
      {!collapsed && (
        <div className="sidebar-style-selector">
          <button
            className={`style-btn ${sidebarStyle === SIDEBAR_STYLES.LIST ? 'active' : ''}`}
            onClick={() => setSidebarStyle(SIDEBAR_STYLES.LIST)}
            title="List view"
          >
            {StyleIcons.list}
            <span>All List</span>
          </button>
          <span className="style-divider">|</span>
          <button
            className={`style-btn ${sidebarStyle === SIDEBAR_STYLES.CATEGORY ? 'active' : ''}`}
            onClick={() => setSidebarStyle(SIDEBAR_STYLES.CATEGORY)}
            title="Category view"
          >
            {StyleIcons.category}
            <span>Category</span>
          </button>
          <span className="style-divider">|</span>
          <button
            className={`style-btn ${sidebarStyle === SIDEBAR_STYLES.FOCUS ? 'active' : ''}`}
            onClick={() => setSidebarStyle(SIDEBAR_STYLES.FOCUS)}
            title="Focus view"
          >
            {StyleIcons.focus}
            <span>Single</span>
          </button>
        </div>
      )}

      {/* Filter bar - shown in Focus and List modes */}
      {!collapsed && (sidebarStyle === SIDEBAR_STYLES.FOCUS || sidebarStyle === SIDEBAR_STYLES.LIST) && (
        <div className="sidebar-filter-bar">
          <button
            className={`filter-btn ${sortBy === 'recent' ? 'active' : ''}`}
            onClick={() => setSortBy('recent')}
          >
            Recent
          </button>
          <button
            className={`filter-btn ${sortBy === 'cost' ? 'active' : ''}`}
            onClick={() => setSortBy('cost')}
          >
            Cost
          </button>
          <button
            className={`filter-btn ${typeDropdownOpen || selectedTypes.length > 0 ? 'active' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              setTypeDropdownOpen(!typeDropdownOpen);
            }}
          >
            Type {selectedTypes.length > 0 && `(${selectedTypes.length})`}
          </button>
          <button
            className={`filter-btn ${modeFilter ? 'active' : ''}`}
            onClick={toggleModeFilter}
          >
            Mode {modeFilter && `(${modeFilter})`}
          </button>
        </div>
      )}
      {/* Type filter dropdown - positioned below filter bar */}
      {!collapsed && typeDropdownOpen && (
        <div className="sidebar-filter-dropdown">
          {['youtube', 'podcast', 'pdf', 'article', 'text'].map(type => (
            <label key={type} className="filter-dropdown-item">
              <input
                type="checkbox"
                checked={selectedTypes.includes(type)}
                onChange={() => toggleType(type)}
              />
              {type.charAt(0).toUpperCase() + type.slice(1)}
            </label>
          ))}
        </div>
      )}

      {/* Conversation sections - supports Category, Focus, and List modes */}
      {/* New order: Notes → Council → Visualiser → Monitor */}
      <div className={`conversation-sections ${sidebarStyle}`}>
        {conversations.length === 0 && monitors.length === 0 ? (
          <div className="no-conversations">No conversations yet</div>
        ) : sidebarStyle === SIDEBAR_STYLES.LIST ? (
          /* LIST MODE - Flat list with category badges */
          <div className="sidebar-section scrollable list-mode">
            <div className="section-list">
              {allConversations.map((conv) => {
                const isCurrentAndLoading = conv.id === currentConversationId && isLoading;
                const shouldAnimate = conv.id === animatingTitleId;
                const category = getConversationCategory(conv);

                return (
                  <div
                    key={conv.id}
                    className={`conversation-item ${
                      conv.id === currentConversationId ? 'active' : ''
                    } ${isCurrentAndLoading ? 'loading' : ''} ${pendingDeleteId === conv.id ? 'pending-delete' : ''}`}
                    onClick={() => pendingDeleteId !== conv.id && onSelectConversation(conv.id)}
                  >
                    {pendingDeleteId === conv.id ? (
                      <div className="delete-confirm" onClick={(e) => e.stopPropagation()}>
                        <span className="delete-confirm-text">Delete?</span>
                        <div className="delete-confirm-actions">
                          <button
                            className="delete-confirm-btn yes"
                            onClick={(e) => {
                              e.stopPropagation();
                              onDeleteConversation(conv.id);
                              setPendingDeleteId(null);
                            }}
                          >
                            Yes
                          </button>
                          <button
                            className="delete-confirm-btn no"
                            onClick={(e) => {
                              e.stopPropagation();
                              setPendingDeleteId(null);
                            }}
                          >
                            No
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="conversation-content">
                        <div className="conversation-title-row">
                          {isCurrentAndLoading && (
                            <span className="loading-indicator">
                              <span className="loading-dot"></span>
                              <span className="loading-dot"></span>
                              <span className="loading-dot"></span>
                            </span>
                          )}
                          {conv.status?.is_unread && !isCurrentAndLoading && (
                            <span className="unread-dot" />
                          )}
                          {conv.mode === 'discovery' && !isCurrentAndLoading && (
                            <span className="auto-discovery-icon" title="Auto-discovered">
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <rect x="3" y="11" width="18" height="10" rx="2" />
                                <circle cx="12" cy="5" r="3" />
                                <path d="M12 8v3" />
                                <circle cx="8" cy="16" r="1" fill="currentColor" />
                                <circle cx="16" cy="16" r="1" fill="currentColor" />
                              </svg>
                            </span>
                          )}
                          <span className={`conversation-title ${shouldAnimate ? 'animating' : ''}`}>
                            <TypewriterTitle
                              text={conv.title || 'New Conversation'}
                              isAnimating={shouldAnimate}
                              onAnimationComplete={onTitleAnimationComplete}
                            />
                          </span>
                          <button
                            className="conversation-delete-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              setPendingDeleteId(conv.id);
                            }}
                            title="Delete conversation"
                          >
                            ×
                          </button>
                        </div>
                        <div className="conversation-meta">
                          <CategoryBadge category={category} />
                          <span className="meta-separator">·</span>
                          <span className="meta-timestamp">{formatRelativeTime(conv.created_at)}</span>
                          {conv.total_cost > 0 && (
                            <>
                              <span className="meta-separator">·</span>
                              <span className="meta-cost">${conv.total_cost.toFixed(3)}</span>
                            </>
                          )}
                          {conv.source_type && (
                            <>
                              <span className="meta-separator">·</span>
                              <span className="source-type-label">{getSourceTypeLabel(conv.source_type)}</span>
                            </>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          /* CATEGORY and FOCUS MODES */
          <>
            {/* 1. Notes section */}
            {(sidebarStyle === SIDEBAR_STYLES.CATEGORY || focusedCategory === CATEGORIES.NOTES) && notesConversations.length > 0 && (
              <div className={`sidebar-section ${sidebarStyle === SIDEBAR_STYLES.CATEGORY ? 'scrollable' : ''} ${sidebarStyle === SIDEBAR_STYLES.FOCUS && focusedCategory === CATEGORIES.NOTES ? 'focused scrollable' : ''}`}>
                <div
                  className="section-header clickable"
                  onClick={() => {
                    if (sidebarStyle === SIDEBAR_STYLES.CATEGORY) {
                      setSidebarStyle(SIDEBAR_STYLES.FOCUS);
                      setFocusedCategory(CATEGORIES.NOTES);
                    } else if (sidebarStyle === SIDEBAR_STYLES.FOCUS) {
                      setFocusedCategory(CATEGORIES.NOTES);
                    }
                  }}
                >
                  <span className="section-header-icon">{MODE_ICONS.synthesizer}</span>
                  Notes
                  <span className="section-count">{notesConversations.length}</span>
                  <button
                    className="section-header-action"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenNotesGallery?.();
                    }}
                    title="View all notes"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="3" width="7" height="7" rx="1" />
                      <rect x="14" y="3" width="7" height="7" rx="1" />
                      <rect x="3" y="14" width="7" height="7" rx="1" />
                      <rect x="14" y="14" width="7" height="7" rx="1" />
                    </svg>
                  </button>
                </div>
                {(sidebarStyle === SIDEBAR_STYLES.CATEGORY || focusedCategory === CATEGORIES.NOTES) && (
                  <div className="section-list">
                    {notesConversations.map((conv) => {
                      const isCurrentAndLoading = conv.id === currentConversationId && isLoading;
                      const shouldAnimate = conv.id === animatingTitleId;

                      return (
                        <div
                          key={conv.id}
                          className={`conversation-item ${
                            conv.id === currentConversationId ? 'active' : ''
                          } ${isCurrentAndLoading ? 'loading' : ''} ${pendingDeleteId === conv.id ? 'pending-delete' : ''}`}
                          onClick={() => pendingDeleteId !== conv.id && onSelectConversation(conv.id)}
                        >
                          {pendingDeleteId === conv.id ? (
                            <div className="delete-confirm" onClick={(e) => e.stopPropagation()}>
                              <span className="delete-confirm-text">Delete?</span>
                              <div className="delete-confirm-actions">
                                <button
                                  className="delete-confirm-btn yes"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onDeleteConversation(conv.id);
                                    setPendingDeleteId(null);
                                  }}
                                >
                                  Yes
                                </button>
                                <button
                                  className="delete-confirm-btn no"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setPendingDeleteId(null);
                                  }}
                                >
                                  No
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="conversation-content">
                              <div className="conversation-title-row">
                                {isCurrentAndLoading && (
                                  <span className="loading-indicator">
                                    <span className="loading-dot"></span>
                                    <span className="loading-dot"></span>
                                    <span className="loading-dot"></span>
                                  </span>
                                )}
                                {conv.status?.is_unread && !isCurrentAndLoading && (
                                  <span className="unread-dot" />
                                )}
                                {conv.mode === 'discovery' && !isCurrentAndLoading && (
                                  <span className="auto-discovery-icon" title="Auto-discovered">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                      <rect x="3" y="11" width="18" height="10" rx="2" />
                                      <circle cx="12" cy="5" r="3" />
                                      <path d="M12 8v3" />
                                      <circle cx="8" cy="16" r="1" fill="currentColor" />
                                      <circle cx="16" cy="16" r="1" fill="currentColor" />
                                    </svg>
                                  </span>
                                )}
                                {conv.is_deliberation && !isCurrentAndLoading && (
                                  <span className="council-deliberation-icon" title="Council Deliberation">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                      <circle cx="12" cy="7" r="4" />
                                      <path d="M5.5 21a6.5 6.5 0 0 1 13 0" />
                                      <circle cx="4" cy="9" r="2.5" />
                                      <path d="M1 19a4 4 0 0 1 6 0" />
                                      <circle cx="20" cy="9" r="2.5" />
                                      <path d="M17 19a4 4 0 0 1 6 0" />
                                    </svg>
                                  </span>
                                )}
                                <span className={`conversation-title ${shouldAnimate ? 'animating' : ''}`}>
                                  <TypewriterTitle
                                    text={conv.title || 'New Conversation'}
                                    isAnimating={shouldAnimate}
                                    onAnimationComplete={onTitleAnimationComplete}
                                  />
                                </span>
                                <button
                                  className="conversation-delete-btn"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setPendingDeleteId(conv.id);
                                  }}
                                  title="Delete conversation"
                                >
                                  ×
                                </button>
                              </div>
                              <div className="conversation-meta">
                                <span className="meta-timestamp">{formatRelativeTime(conv.created_at)}</span>
                                {conv.total_cost > 0 && (
                                  <>
                                    <span className="meta-separator">·</span>
                                    <span className="meta-cost">${conv.total_cost.toFixed(3)}</span>
                                  </>
                                )}
                                {conv.source_type && (
                                  <>
                                    <span className="meta-separator">·</span>
                                    <span className="source-type-label">{getSourceTypeLabel(conv.source_type)}</span>
                                  </>
                                )}
                                {conv.thread_count > 0 && (
                                  <>
                                    <span className="meta-separator">·</span>
                                    <span className="turns-indicator">
                                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                                      </svg>
                                      {conv.thread_count}
                                    </span>
                                  </>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Notes collapsed header for Focus mode */}
            {sidebarStyle === SIDEBAR_STYLES.FOCUS && focusedCategory !== CATEGORIES.NOTES && notesConversations.length > 0 && (
              <div
                className="section-header clickable collapsed-header"
                onClick={() => setFocusedCategory(CATEGORIES.NOTES)}
              >
                <span className="section-header-icon">{MODE_ICONS.synthesizer}</span>
                Notes
                <span className="section-count">{notesConversations.length}</span>
              </div>
            )}

            {/* Separator */}
            {sidebarStyle === SIDEBAR_STYLES.CATEGORY && notesConversations.length > 0 && councilConversations.length > 0 && (
              <div className="sidebar-separator"></div>
            )}

            {/* 2. Council section */}
            {(sidebarStyle === SIDEBAR_STYLES.CATEGORY || focusedCategory === CATEGORIES.COUNCIL) && councilConversations.length > 0 && (
              <div className={`sidebar-section ${sidebarStyle === SIDEBAR_STYLES.CATEGORY ? 'scrollable' : ''} ${sidebarStyle === SIDEBAR_STYLES.FOCUS && focusedCategory === CATEGORIES.COUNCIL ? 'focused scrollable' : ''}`}>
                <div
                  className="section-header clickable"
                  onClick={() => {
                    if (sidebarStyle === SIDEBAR_STYLES.CATEGORY) {
                      setSidebarStyle(SIDEBAR_STYLES.FOCUS);
                      setFocusedCategory(CATEGORIES.COUNCIL);
                    } else if (sidebarStyle === SIDEBAR_STYLES.FOCUS) {
                      setFocusedCategory(CATEGORIES.COUNCIL);
                    }
                  }}
                >
                  <span className="section-header-icon">{MODE_ICONS.council}</span>
                  Council
                  <span className="section-count">{councilConversations.length}</span>
                  <button
                    className="section-header-action"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenCouncilGallery?.();
                    }}
                    title="View all council discussions"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="3" width="7" height="7" rx="1" />
                      <rect x="14" y="3" width="7" height="7" rx="1" />
                      <rect x="3" y="14" width="7" height="7" rx="1" />
                      <rect x="14" y="14" width="7" height="7" rx="1" />
                    </svg>
                  </button>
                </div>
                {(sidebarStyle === SIDEBAR_STYLES.CATEGORY || focusedCategory === CATEGORIES.COUNCIL) && (
                  <div className="section-list">
                    {councilConversations.map((conv) => {
                      const isCurrentAndLoading = conv.id === currentConversationId && isLoading;
                      const shouldAnimate = conv.id === animatingTitleId;

                      return (
                        <div
                          key={conv.id}
                          className={`conversation-item ${
                            conv.id === currentConversationId ? 'active' : ''
                          } ${isCurrentAndLoading ? 'loading' : ''} ${pendingDeleteId === conv.id ? 'pending-delete' : ''}`}
                          onClick={() => pendingDeleteId !== conv.id && onSelectConversation(conv.id)}
                        >
                          {pendingDeleteId === conv.id ? (
                            <div className="delete-confirm" onClick={(e) => e.stopPropagation()}>
                              <span className="delete-confirm-text">Delete?</span>
                              <div className="delete-confirm-actions">
                                <button
                                  className="delete-confirm-btn yes"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onDeleteConversation(conv.id);
                                    setPendingDeleteId(null);
                                  }}
                                >
                                  Yes
                                </button>
                                <button
                                  className="delete-confirm-btn no"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setPendingDeleteId(null);
                                  }}
                                >
                                  No
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="conversation-content">
                              <div className="conversation-title-row">
                                {isCurrentAndLoading && (
                                  <span className="loading-indicator">
                                    <span className="loading-dot"></span>
                                    <span className="loading-dot"></span>
                                    <span className="loading-dot"></span>
                                  </span>
                                )}
                                {conv.status?.is_unread && !isCurrentAndLoading && (
                                  <span className="unread-dot" />
                                )}
                                <span className={`conversation-title ${shouldAnimate ? 'animating' : ''}`}>
                                  <TypewriterTitle
                                    text={conv.title || 'New Conversation'}
                                    isAnimating={shouldAnimate}
                                    onAnimationComplete={onTitleAnimationComplete}
                                  />
                                </span>
                                <button
                                  className="conversation-delete-btn"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setPendingDeleteId(conv.id);
                                  }}
                                  title="Delete conversation"
                                >
                                  ×
                                </button>
                              </div>
                              <div className="conversation-meta">
                                <span className="meta-timestamp">{formatRelativeTime(conv.created_at)}</span>
                                {conv.total_cost > 0 && (
                                  <>
                                    <span className="meta-separator">·</span>
                                    <span className="meta-cost">${conv.total_cost.toFixed(3)}</span>
                                  </>
                                )}
                                {conv.thread_count > 0 && (
                                  <>
                                    <span className="meta-separator">·</span>
                                    <span className="turns-indicator">
                                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                                      </svg>
                                      {conv.thread_count}
                                    </span>
                                  </>
                                )}
                                {conv.prompt_title && promptLabels[conv.prompt_title] && (
                                  <>
                                    <span className="meta-separator">·</span>
                                    <span className="source-type-label">{promptLabels[conv.prompt_title]}</span>
                                  </>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Council collapsed header for Focus mode */}
            {sidebarStyle === SIDEBAR_STYLES.FOCUS && focusedCategory !== CATEGORIES.COUNCIL && councilConversations.length > 0 && (
              <div
                className="section-header clickable collapsed-header"
                onClick={() => setFocusedCategory(CATEGORIES.COUNCIL)}
              >
                <span className="section-header-icon">{MODE_ICONS.council}</span>
                Council
                <span className="section-count">{councilConversations.length}</span>
              </div>
            )}

            {/* Separator */}
            {sidebarStyle === SIDEBAR_STYLES.CATEGORY && councilConversations.length > 0 && visualiserConversations.length > 0 && (
              <div className="sidebar-separator"></div>
            )}

            {/* 3. Visualiser section */}
            {(sidebarStyle === SIDEBAR_STYLES.CATEGORY || focusedCategory === CATEGORIES.VISUALISER) && visualiserConversations.length > 0 && (
              <div className={`sidebar-section ${sidebarStyle === SIDEBAR_STYLES.CATEGORY ? 'scrollable' : ''} ${sidebarStyle === SIDEBAR_STYLES.FOCUS && focusedCategory === CATEGORIES.VISUALISER ? 'focused scrollable' : ''}`}>
                <div
                  className="section-header clickable"
                  onClick={() => {
                    if (sidebarStyle === SIDEBAR_STYLES.CATEGORY) {
                      setSidebarStyle(SIDEBAR_STYLES.FOCUS);
                      setFocusedCategory(CATEGORIES.VISUALISER);
                    } else if (sidebarStyle === SIDEBAR_STYLES.FOCUS) {
                      setFocusedCategory(CATEGORIES.VISUALISER);
                    }
                  }}
                >
                  <span className="section-header-icon">{MODE_ICONS.visualiser}</span>
                  Visualiser
                  <span className="section-count">{visualiserConversations.length}</span>
                  <button
                    className="section-header-action"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenImageGallery?.();
                    }}
                    title="View all images"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="3" width="7" height="7" rx="1" />
                      <rect x="14" y="3" width="7" height="7" rx="1" />
                      <rect x="3" y="14" width="7" height="7" rx="1" />
                      <rect x="14" y="14" width="7" height="7" rx="1" />
                    </svg>
                  </button>
                </div>
                {(sidebarStyle === SIDEBAR_STYLES.CATEGORY || focusedCategory === CATEGORIES.VISUALISER) && (
                  <div className="section-list">
                    {visualiserConversations.map((conv) => {
                      const isCurrentAndLoading = conv.id === currentConversationId && isLoading;
                      const shouldAnimate = conv.id === animatingTitleId;

                      return (
                        <div
                          key={conv.id}
                          className={`conversation-item ${
                            conv.id === currentConversationId ? 'active' : ''
                          } ${isCurrentAndLoading ? 'loading' : ''} ${pendingDeleteId === conv.id ? 'pending-delete' : ''}`}
                          onClick={() => pendingDeleteId !== conv.id && onSelectConversation(conv.id)}
                        >
                          {pendingDeleteId === conv.id ? (
                            <div className="delete-confirm" onClick={(e) => e.stopPropagation()}>
                              <span className="delete-confirm-text">Delete?</span>
                              <div className="delete-confirm-actions">
                                <button
                                  className="delete-confirm-btn yes"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onDeleteConversation(conv.id);
                                    setPendingDeleteId(null);
                                  }}
                                >
                                  Yes
                                </button>
                                <button
                                  className="delete-confirm-btn no"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setPendingDeleteId(null);
                                  }}
                                >
                                  No
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="conversation-content">
                              <div className="conversation-title-row">
                                {isCurrentAndLoading && (
                                  <span className="loading-indicator">
                                    <span className="loading-dot"></span>
                                    <span className="loading-dot"></span>
                                    <span className="loading-dot"></span>
                                  </span>
                                )}
                                {conv.status?.is_unread && !isCurrentAndLoading && (
                                  <span className="unread-dot" />
                                )}
                                <span className={`conversation-title ${shouldAnimate ? 'animating' : ''}`}>
                                  <TypewriterTitle
                                    text={conv.title || 'New Conversation'}
                                    isAnimating={shouldAnimate}
                                    onAnimationComplete={onTitleAnimationComplete}
                                  />
                                </span>
                                <button
                                  className="conversation-delete-btn"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setPendingDeleteId(conv.id);
                                  }}
                                  title="Delete conversation"
                                >
                                  ×
                                </button>
                              </div>
                              <div className="conversation-meta">
                                <span className="meta-timestamp">{formatRelativeTime(conv.created_at)}</span>
                                {conv.total_cost > 0 && (
                                  <>
                                    <span className="meta-separator">·</span>
                                    <span className="meta-cost">${conv.total_cost.toFixed(3)}</span>
                                  </>
                                )}
                                {(conv.diagram_style || conv.source_type) && (
                                  <>
                                    <span className="meta-separator">·</span>
                                    {conv.diagram_style && visualiserSettings?.diagram_styles?.[conv.diagram_style] && (
                                      <span className="style-icon" title={visualiserSettings.diagram_styles[conv.diagram_style].name}>
                                        {(() => {
                                          const IconComponent = getIconComponent(visualiserSettings.diagram_styles[conv.diagram_style].icon);
                                          return <IconComponent size={12} />;
                                        })()}
                                      </span>
                                    )}
                                    {conv.source_type && (
                                      <span className="source-type-label">{getVisualiserSourceLabel(conv.source_type)}</span>
                                    )}
                                  </>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Visualiser collapsed header for Focus mode */}
            {sidebarStyle === SIDEBAR_STYLES.FOCUS && focusedCategory !== CATEGORIES.VISUALISER && visualiserConversations.length > 0 && (
              <div
                className="section-header clickable collapsed-header"
                onClick={() => setFocusedCategory(CATEGORIES.VISUALISER)}
              >
                <span className="section-header-icon">{MODE_ICONS.visualiser}</span>
                Visualiser
                <span className="section-count">{visualiserConversations.length}</span>
              </div>
            )}

            {/* Separator */}
            {sidebarStyle === SIDEBAR_STYLES.CATEGORY && visualiserConversations.length > 0 && monitors.length > 0 && (
              <div className="sidebar-separator"></div>
            )}

            {/* 4. Monitor section - compact in Category mode (1 slot) */}
            {(sidebarStyle === SIDEBAR_STYLES.CATEGORY || focusedCategory === CATEGORIES.MONITOR) && monitors.length > 0 && (
              <div className={`sidebar-section ${sidebarStyle === SIDEBAR_STYLES.CATEGORY ? 'compact' : ''} ${sidebarStyle === SIDEBAR_STYLES.FOCUS && focusedCategory === CATEGORIES.MONITOR ? 'focused scrollable' : ''}`}>
                <div
                  className="section-header clickable"
                  onClick={() => {
                    if (sidebarStyle === SIDEBAR_STYLES.CATEGORY) {
                      setSidebarStyle(SIDEBAR_STYLES.FOCUS);
                      setFocusedCategory(CATEGORIES.MONITOR);
                    } else if (sidebarStyle === SIDEBAR_STYLES.FOCUS) {
                      setFocusedCategory(CATEGORIES.MONITOR);
                    }
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
                  </svg>
                  Monitor
                  <span className="section-count">{monitors.length}</span>
                </div>
                {(sidebarStyle === SIDEBAR_STYLES.CATEGORY || focusedCategory === CATEGORIES.MONITOR) && (
                  <div className="section-list">
                    {monitors.map((monitor) => (
                      <div
                        key={monitor.id}
                        className={`monitor-sidebar-item ${monitor.id === currentMonitorId ? 'active' : ''}`}
                        onClick={() => onSelectMonitor?.(monitor.id)}
                      >
                        <div className={`monitor-status-dot ${monitor.status || 'running'}`} title={monitor.status === 'paused' ? 'Paused' : 'Running'} />
                        <div className="monitor-info">
                          <span className="monitor-name">{monitor.name}</span>
                          <span className="monitor-last-run">
                            {monitor.last_crawl_at
                              ? formatRelativeTime(monitor.last_crawl_at)
                              : 'Never crawled'}
                          </span>
                        </div>
                        {monitor.unread_updates > 0 && (
                          <span className="updates-badge">{monitor.unread_updates}</span>
                        )}
                        <div className="monitor-actions">
                          {monitor.status === 'paused' ? (
                            <button
                              className="monitor-action-btn play"
                              onClick={(e) => {
                                e.stopPropagation();
                                onResumeMonitor?.(monitor.id);
                              }}
                              title="Resume"
                            >
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                                <polygon points="5 3 19 12 5 21 5 3"/>
                              </svg>
                            </button>
                          ) : (
                            <button
                              className="monitor-action-btn pause"
                              onClick={(e) => {
                                e.stopPropagation();
                                onPauseMonitor?.(monitor.id);
                              }}
                              title="Pause"
                            >
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                                <rect x="6" y="4" width="4" height="16"/>
                                <rect x="14" y="4" width="4" height="16"/>
                              </svg>
                            </button>
                          )}
                          <button
                            className="monitor-action-btn delete"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (confirm('Delete this monitor and all its data?')) {
                                onDeleteMonitor?.(monitor.id);
                              }
                            }}
                            title="Delete"
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <polyline points="3 6 5 6 21 6"/>
                              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                            </svg>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Monitor collapsed header for Focus mode */}
            {sidebarStyle === SIDEBAR_STYLES.FOCUS && focusedCategory !== CATEGORIES.MONITOR && monitors.length > 0 && (
              <div
                className="section-header clickable collapsed-header"
                onClick={() => setFocusedCategory(CATEGORIES.MONITOR)}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
                </svg>
                Monitor
                <span className="section-count">{monitors.length}</span>
              </div>
            )}
          </>
        )}
      </div>

      {/* Sticky Discovery Tab */}
      {(activeWorkers > 0 || discoveryStats.pending > 0) && (
        <div
          className={`sidebar-discovery-tab ${collapsed ? 'collapsed' : ''}`}
          onClick={() => onOpenKnowledgeGraph({ openReview: discoveryStats.pending > 0 })}
          title="View Knowledge Discovery"
        >
          <div className="sidebar-discovery-header">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
            </svg>
            <span className="sidebar-discovery-title">Discovery</span>
            {(activeWorkers + discoveryStats.pending) > 0 && (
              <span className="sidebar-badge">{activeWorkers + discoveryStats.pending}</span>
            )}
          </div>

          {activeWorkers > 0 && (
            <div className="sidebar-discovery-sub">
              <span className="worker-spinner" />
              <span>{activeWorkers} worker{activeWorkers > 1 ? 's' : ''} running</span>
            </div>
          )}

          {discoveryStats.pending > 0 && (
            <div className="sidebar-discovery-sub">
              <span>{discoveryStats.pending} to review</span>
            </div>
          )}
        </div>
      )}

      {/* Footer with home, credits, settings */}
      <div className="sidebar-footer">
        <button className="footer-icon-btn" onClick={onGoHome} title="Home">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
            <polyline points="9 22 9 12 15 12 15 22"/>
          </svg>
        </button>
        {credits !== null && (
          <span className={`footer-credits ${credits < 2 ? 'warning' : ''}`}>
            {credits < 2 && (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2L1 21h22L12 2zm0 3.5L19.5 19H4.5L12 5.5zM11 10v4h2v-4h-2zm0 6v2h2v-2h-2z"/>
              </svg>
            )}
            ${credits.toFixed(2)}
          </span>
        )}
        <button className="footer-icon-btn" onClick={onOpenPodcastGallery} title="Podcasts">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 18v-6a9 9 0 0 1 18 0v6"/>
            <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/>
          </svg>
        </button>
        <button className="footer-icon-btn" onClick={onOpenKnowledgeGraph} title="Knowledge Graph">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="6" cy="6" r="3"/>
            <circle cx="18" cy="6" r="3"/>
            <circle cx="12" cy="18" r="3"/>
            <line x1="8.5" y1="7.5" x2="10" y2="15"/>
            <line x1="15.5" y1="7.5" x2="14" y2="15"/>
            <line x1="9" y1="6" x2="15" y2="6"/>
          </svg>
        </button>
        <button className="footer-icon-btn" onClick={onOpenSettings} title="Settings">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
        </button>
      </div>
    </div>
  );
}
