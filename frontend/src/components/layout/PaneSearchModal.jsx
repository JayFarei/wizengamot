import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { api } from '../../api';
import './PaneSearchModal.css';

// Mode icons for search results
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

const MODE_LABELS = {
  council: 'Council',
  synthesizer: 'Notes',
  visualiser: 'Diagram',
  podcast: 'Podcast',
};

// Filter definitions
const FILTERS = [
  { key: 'council', label: 'Council', description: 'Filter to council discussions' },
  { key: 'notes', label: 'Notes', description: 'Filter to synthesizer notes' },
  { key: 'diagrams', label: 'Diagrams', description: 'Filter to visualiser diagrams' },
];

// Parse @prefix filters from query
function parseFilterAndQuery(input) {
  for (const f of FILTERS) {
    const prefix = `@${f.key}`;
    if (input.startsWith(prefix + ' ') || input === prefix) {
      return {
        filter: f.key,
        query: input.slice(prefix.length).trim()
      };
    }
  }
  return { filter: 'all', query: input };
}

// Check if showing @ suggestions
function getFilterSuggestions(input) {
  if (!input.startsWith('@')) return [];
  const partial = input.slice(1).toLowerCase();
  for (const f of FILTERS) {
    if (input.startsWith(`@${f.key} `)) return [];
  }
  return FILTERS.filter(f => f.key.startsWith(partial));
}

// Apply type filter to results
function applyTypeFilter(results, filter) {
  if (filter === 'all') return results;
  return results.filter(r => {
    if (filter === 'council') return r.mode === 'council';
    if (filter === 'notes') return r.mode === 'synthesizer';
    if (filter === 'diagrams') return r.mode === 'visualiser';
    return true;
  });
}

/**
 * Search modal for selecting a conversation to display in a pane
 * Includes action buttons for Settings, Theme toggle, and New Conversation
 */
export default function PaneSearchModal({
  paneId,
  conversations = [],
  onSelect,
  onClose,
  onNewConversation,
  onOpenSettings,
  theme,
  onToggleTheme,
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const inputRef = useRef(null);
  const debounceRef = useRef(null);

  // Derive 5 most recent conversations for quick access
  const recentConversations = useMemo(() => {
    return [...conversations]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 5);
  }, [conversations]);

  // Parse filter from query
  const { filter: activeFilter, query: searchQuery } = parseFilterAndQuery(query);

  // Get filter suggestions when typing @
  const filterSuggestions = getFilterSuggestions(query);
  const showingFilterSuggestions = filterSuggestions.length > 0;

  // Apply filter to results
  const filteredResults = applyTypeFilter(results, activeFilter);

  // Determine which items to show
  const showingRecent = !query && !isLoading && recentConversations.length > 0;
  const displayItems = showingRecent ? recentConversations : filteredResults;

  // Navigation uses negative indices for actions, positive for results
  // Actions: -3 (Settings), -2 (Theme), -1 (New Conv)
  const ACTION_COUNT = 3;
  const maxResultIndex = displayItems.length - 1;

  // Focus input on mount with retry mechanism to ensure it works reliably
  useEffect(() => {
    const focusInput = () => {
      if (inputRef.current && document.activeElement !== inputRef.current) {
        inputRef.current.focus();
      }
    };

    // Immediate attempt
    focusInput();

    // Retry with requestAnimationFrame
    requestAnimationFrame(focusInput);

    // Backup timeout for edge cases
    const timer = setTimeout(focusInput, 50);

    return () => clearTimeout(timer);
  }, []);

  // Debounced search
  const doSearch = useCallback(async (queryText) => {
    if (!queryText.trim()) {
      setResults([]);
      return;
    }

    setIsLoading(true);
    try {
      const response = await api.searchConversations(queryText);
      setResults(response.results || []);
      setSelectedIndex(0);
    } catch (err) {
      console.error('Search failed:', err);
      setResults([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Handle query change with debounce
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(() => {
      // Use parsed searchQuery (without @prefix) for actual search
      doSearch(searchQuery);
    }, 200);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [searchQuery, doSearch]);

  // Keyboard navigation - bidirectional with negative indices for actions
  const handleKeyDown = (e) => {
    if (showingFilterSuggestions) {
      // Filter suggestions use simple positive indices
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex(i => Math.min(i + 1, filterSuggestions.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(i => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        handleSelectByIndex(selectedIndex);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(i => {
        // From actions, move toward results
        if (i < 0) return i + 1;
        // In results, move to next (cap at max)
        return Math.min(i + 1, Math.max(0, maxResultIndex));
      });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(i => {
        // In results, can go to actions
        if (i >= 0) return i - 1;
        // In actions, cap at -ACTION_COUNT
        return Math.max(i - 1, -ACTION_COUNT);
      });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      handleSelectByIndex(selectedIndex);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  const handleSelectByIndex = (index) => {
    // Handle filter suggestion selection
    if (showingFilterSuggestions) {
      const suggestion = filterSuggestions[index];
      if (suggestion) {
        setQuery(`@${suggestion.key} `);
        setSelectedIndex(0);
      }
      return;
    }

    // Actions use negative indices: -1 (New Conv), -2 (Theme), -3 (Settings)
    if (index === -1) {
      // New Conversation
      onClose();
      onNewConversation?.();
    } else if (index === -2) {
      // Toggle Theme
      onToggleTheme?.();
    } else if (index === -3) {
      // Open Settings
      onClose();
      onOpenSettings?.();
    } else if (index >= 0) {
      // Search result or recent conversation
      const item = displayItems[index];
      if (item) {
        onSelect(item.id);
      }
    }
  };

  // Format relative time
  const formatRelativeTime = (isoDate) => {
    const date = new Date(isoDate);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  return (
    <div className="pane-search-modal">
      <div className="pane-search-container">
        {/* Action items above search */}
        {!showingFilterSuggestions && (
          <div className="pane-search-actions">
            {/* Settings - index -3 */}
            <div
              className={`pane-search-action ${selectedIndex === -3 ? 'selected' : ''}`}
              onClick={() => handleSelectByIndex(-3)}
              onMouseEnter={() => setSelectedIndex(-3)}
            >
              <svg className="action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
              <span className="action-label">Settings</span>
            </div>

            {/* Toggle Theme - index -2 */}
            <div
              className={`pane-search-action ${selectedIndex === -2 ? 'selected' : ''}`}
              onClick={() => handleSelectByIndex(-2)}
              onMouseEnter={() => setSelectedIndex(-2)}
            >
              {theme === 'dark' ? (
                <svg className="action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="5" />
                  <line x1="12" y1="1" x2="12" y2="3" />
                  <line x1="12" y1="21" x2="12" y2="23" />
                  <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                  <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                  <line x1="1" y1="12" x2="3" y2="12" />
                  <line x1="21" y1="12" x2="23" y2="12" />
                  <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                  <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
                </svg>
              ) : (
                <svg className="action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                </svg>
              )}
              <span className="action-label">{theme === 'dark' ? 'Light' : 'Dark'}</span>
            </div>

            {/* New Conversation - index -1 */}
            <div
              className={`pane-search-action ${selectedIndex === -1 ? 'selected' : ''}`}
              onClick={() => handleSelectByIndex(-1)}
              onMouseEnter={() => setSelectedIndex(-1)}
            >
              <svg className="action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              <span className="action-label">New</span>
            </div>
          </div>
        )}

        <div className="pane-search-header">
          <svg className="pane-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            className="pane-search-input"
            placeholder="Search or @council, @notes, @diagrams..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            autoFocus
          />
          <span className="pane-search-hint">
            <kbd>esc</kbd> to close
          </span>
        </div>

        <div className="pane-search-results">
          {/* Filter suggestions when typing @ */}
          {showingFilterSuggestions && (
            <div className="pane-filter-suggestions">
              <div className="pane-filter-suggestions-label">Filter by type</div>
              {filterSuggestions.map((suggestion, index) => (
                <div
                  key={suggestion.key}
                  className={`pane-filter-suggestion ${index === selectedIndex ? 'selected' : ''}`}
                  onClick={() => handleSelectByIndex(index)}
                  onMouseEnter={() => setSelectedIndex(index)}
                >
                  <span className="pane-filter-suggestion-key">@{suggestion.key}</span>
                  <span className="pane-filter-suggestion-desc">{suggestion.description}</span>
                </div>
              ))}
            </div>
          )}

          {!showingFilterSuggestions && (
            <>
              {isLoading && (
                <div className="pane-search-loading">Searching...</div>
              )}

              {!isLoading && (searchQuery || activeFilter !== 'all') && filteredResults.length === 0 && (
                <div className="pane-search-empty">
                  {activeFilter !== 'all'
                    ? `No ${activeFilter} items found${searchQuery ? ` matching "${searchQuery}"` : ''}`
                    : 'No matching conversations found'}
                </div>
              )}

              {showingRecent && (
                <div className="pane-search-section-label">Recent</div>
              )}

              {!isLoading && displayItems.map((item, index) => (
                <div
                  key={item.id}
                  className={`pane-search-result ${index === selectedIndex ? 'selected' : ''}`}
                  onClick={() => handleSelectByIndex(index)}
                  onMouseEnter={() => setSelectedIndex(index)}
                >
                  <div className="pane-search-result-header">
                    <span className="pane-search-result-title">{item.title}</span>
                    <span className={`pane-search-result-mode ${item.mode}`}>
                      <span className="pane-search-result-mode-icon">
                        {MODE_ICONS[item.mode]}
                      </span>
                      {MODE_LABELS[item.mode] || item.mode}
                    </span>
                  </div>
                  <div className="pane-search-result-meta">
                    <span className="pane-search-result-time">{formatRelativeTime(item.created_at)}</span>
                    {item.similarity && (
                      <span className="pane-search-result-score">
                        {Math.round(item.similarity * 100)}% match
                      </span>
                    )}
                  </div>
                </div>
              ))}

              {!query && !isLoading && recentConversations.length === 0 && (
                <div className="pane-search-empty">
                  No conversations yet. Type to search.
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
