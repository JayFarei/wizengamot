import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../api';
import './SearchModal.css';

// Filter definitions
const FILTERS = [
  { key: 'council', label: 'Council', description: 'Filter to council discussions' },
  { key: 'notes', label: 'Notes', description: 'Filter to synthesizer notes' },
  { key: 'monitors', label: 'Monitors', description: 'Filter to monitors' },
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
  // Don't show suggestions if we already have a complete filter with space
  for (const f of FILTERS) {
    if (input.startsWith(`@${f.key} `)) return [];
  }
  // Filter suggestions by partial match
  return FILTERS.filter(f => f.key.startsWith(partial));
}

// Apply type filter to results
function applyTypeFilter(results, filter) {
  if (filter === 'all') return results;
  return results.filter(r => {
    if (filter === 'council') return r.mode === 'council';
    if (filter === 'notes') return r.mode === 'synthesizer';
    if (filter === 'monitors') return r.type === 'monitor';
    if (filter === 'diagrams') return r.mode === 'visualiser';
    return true;
  });
}

export default function SearchModal({ isOpen, onClose, onSelectConversation, onNewConversation, theme, onToggleTheme, onOpenSettings }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const inputRef = useRef(null);
  const debounceRef = useRef(null);

  // Parse filter from query
  const { filter: activeFilter, query: searchQuery } = parseFilterAndQuery(query);

  // Get filter suggestions when typing @
  const filterSuggestions = getFilterSuggestions(query);
  const showingFilterSuggestions = filterSuggestions.length > 0;

  // Apply filter to results
  const filteredResults = applyTypeFilter(results, activeFilter);

  // Navigation uses negative indices for actions, positive for results
  // Actions: -3 (Settings), -2 (Theme), -1 (New Conv)
  // Results: 0, 1, 2, ...
  const ACTION_COUNT = 3;
  const maxResultIndex = filteredResults.length - 1;

  // Focus input when modal opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
      setQuery('');
      setResults([]);
      setSelectedIndex(0);
    }
  }, [isOpen]);

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
      onNewConversation();
    } else if (index === -2) {
      // Toggle Theme
      onToggleTheme?.();
    } else if (index === -3) {
      // Open Settings
      onClose();
      onOpenSettings?.();
    } else if (index >= 0) {
      // Search result
      const result = filteredResults[index];
      if (result) {
        onSelectConversation(result);
        onClose();
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

  if (!isOpen) return null;

  return (
    <div className="search-modal-overlay" onClick={onClose}>
      <div className="search-modal" onClick={e => e.stopPropagation()}>
        {/* Action items above search - ordered: Settings (top), Theme, New Conv (bottom/closest to search) */}
        {!showingFilterSuggestions && (
        <div className="search-actions">
          {/* Settings - index -3 */}
          <div
            className={`search-action ${selectedIndex === -3 ? 'selected' : ''}`}
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
            className={`search-action ${selectedIndex === -2 ? 'selected' : ''}`}
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
            <span className="action-label">{theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}</span>
            <kbd className="action-badge">{theme === 'dark' ? 'Light' : 'Dark'}</kbd>
          </div>

          {/* New Conversation - index -1 (closest to search bar) */}
          <div
            className={`search-action ${selectedIndex === -1 ? 'selected' : ''}`}
            onClick={() => handleSelectByIndex(-1)}
            onMouseEnter={() => setSelectedIndex(-1)}
          >
            <svg className="action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            <span className="action-label">New Conversation</span>
          </div>
        </div>
        )}

        <div className="search-input-wrapper">
          <svg className="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            className="search-input"
            placeholder="Search or @council, @notes, @diagrams..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <span className="search-hint">
            <kbd>esc</kbd> to close
          </span>
        </div>

        <div className="search-results">
          {/* Filter suggestions when typing @ */}
          {showingFilterSuggestions && (
            <div className="filter-suggestions">
              <div className="filter-suggestions-label">Filter by type</div>
              {filterSuggestions.map((suggestion, index) => (
                <div
                  key={suggestion.key}
                  className={`filter-suggestion ${index === selectedIndex ? 'selected' : ''}`}
                  onClick={() => handleSelectByIndex(index)}
                  onMouseEnter={() => setSelectedIndex(index)}
                >
                  <span className="filter-suggestion-key">@{suggestion.key}</span>
                  <span className="filter-suggestion-desc">{suggestion.description}</span>
                </div>
              ))}
            </div>
          )}

          {!showingFilterSuggestions && <div className="search-divider" />}

          {!showingFilterSuggestions && (
            <>
              {isLoading && (
                <div className="search-loading">Searching...</div>
              )}

              {!isLoading && (searchQuery || activeFilter !== 'all') && filteredResults.length === 0 && (
                <div className="search-empty">
                  {activeFilter !== 'all'
                    ? `No ${activeFilter} items found${searchQuery ? ` matching "${searchQuery}"` : ''}`
                    : 'No matching conversations found'}
                </div>
              )}

              {!isLoading && filteredResults.map((result, index) => (
                <div
                  key={result.id}
                  className={`search-result ${index === selectedIndex ? 'selected' : ''}`}
                  onClick={() => handleSelectByIndex(index)}
                  onMouseEnter={() => setSelectedIndex(index)}
                >
                  <div className="search-result-header">
                    <span className="search-result-title">{result.title}</span>
                    <span className={`search-result-mode ${result.mode}`}>
                      {result.mode === 'synthesizer' ? 'notes' : 'council'}
                    </span>
                  </div>
                  <div className="search-result-meta">
                    <span className="search-result-time">{formatRelativeTime(result.created_at)}</span>
                    {result.similarity && (
                      <span className="search-result-score">
                        {Math.round(result.similarity * 100)}% match
                      </span>
                    )}
                  </div>
                </div>
              ))}

              {!query && !isLoading && (
                <div className="search-hint-text">
                  Type to search, or @ to filter by type
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
