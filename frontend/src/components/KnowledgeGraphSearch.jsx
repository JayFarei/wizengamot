import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Search, X, FileText, Users, Folder, Hash } from 'lucide-react';
import { api } from '../api';
import './KnowledgeGraph.css';

/**
 * KnowledgeGraphSearch - Search and filter component for the knowledge graph
 *
 * Supports:
 * - Semantic search via backend API
 * - Instant client-side filtering with prefixes:
 *   @entity - filter to entities only
 *   @note - filter to notes only
 *   @source - filter to sources only
 *   @tag:tagname - search by tag name
 *   @type:person - filter entities by type
 */
export default function KnowledgeGraphSearch({
  graphData,
  onResultsChange,
  onSelectNode,
  autoFocus = false,
  initialQuery = null,
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [showDropdown, setShowDropdown] = useState(false);
  const inputRef = useRef(null);
  const dropdownRef = useRef(null);
  const searchTimeoutRef = useRef(null);

  // Parse query for prefix commands
  const parseQuery = useCallback((q) => {
    const trimmed = q.trim();

    // Check for @prefix patterns
    if (trimmed.startsWith('@entity ') || trimmed === '@entity') {
      return {
        mode: 'client',
        type: 'entity',
        searchTerm: trimmed.replace('@entity', '').trim(),
      };
    }
    if (trimmed.startsWith('@note ') || trimmed === '@note') {
      return {
        mode: 'client',
        type: 'note',
        searchTerm: trimmed.replace('@note', '').trim(),
      };
    }
    if (trimmed.startsWith('@source ') || trimmed === '@source') {
      return {
        mode: 'client',
        type: 'source',
        searchTerm: trimmed.replace('@source', '').trim(),
      };
    }
    if (trimmed.startsWith('@tag:')) {
      const tagName = trimmed.replace('@tag:', '').trim();
      return {
        mode: 'client',
        type: 'tag',
        searchTerm: tagName,
      };
    }
    if (trimmed.startsWith('@type:')) {
      const entityType = trimmed.replace('@type:', '').trim().split(' ')[0];
      const remainder = trimmed.replace(`@type:${entityType}`, '').trim();
      return {
        mode: 'client',
        type: 'entityType',
        entityType,
        searchTerm: remainder,
      };
    }

    // Default: semantic search for queries > 2 chars
    if (trimmed.length > 2) {
      return { mode: 'semantic', searchTerm: trimmed };
    }

    return { mode: 'none', searchTerm: trimmed };
  }, []);

  // Client-side filtering
  const clientFilter = useCallback((parsedQuery) => {
    if (!graphData?.nodes) return [];

    const { type, entityType, searchTerm } = parsedQuery;
    const lowerSearch = searchTerm.toLowerCase();

    return graphData.nodes.filter((node) => {
      // Type filtering
      if (type === 'entity' && node.type !== 'entity') return false;
      if (type === 'note' && node.type !== 'note') return false;
      if (type === 'source' && node.type !== 'source') return false;
      if (type === 'entityType' && node.type === 'entity' && node.entityType !== entityType) return false;

      // Tag filtering
      if (type === 'tag') {
        if (node.type !== 'note') return false;
        const nodeTags = (node.tags || []).map(t => t.toLowerCase().replace('#', ''));
        return nodeTags.some(t => t.includes(lowerSearch));
      }

      // Text search within filtered results
      if (lowerSearch) {
        const name = (node.name || node.title || '').toLowerCase();
        const tags = (node.tags || []).join(' ').toLowerCase();
        const body = (node.body || '').toLowerCase();

        return name.includes(lowerSearch) ||
               tags.includes(lowerSearch) ||
               body.includes(lowerSearch);
      }

      return true;
    }).slice(0, 20).map(node => ({
      id: node.id,
      type: node.type,
      name: node.name || node.title,
      entityType: node.entityType || '',
      tags: node.tags || [],
      score: 1,
    }));
  }, [graphData]);

  // Perform search
  const performSearch = useCallback(async (q) => {
    if (!q.trim()) {
      setResults([]);
      onResultsChange?.([]);
      setShowDropdown(false);
      return;
    }

    const parsed = parseQuery(q);

    if (parsed.mode === 'none') {
      setResults([]);
      onResultsChange?.([]);
      setShowDropdown(false);
      return;
    }

    if (parsed.mode === 'client') {
      // Instant client-side filtering
      const filtered = clientFilter(parsed);
      setResults(filtered);
      onResultsChange?.(filtered.map(r => r.id));
      setShowDropdown(filtered.length > 0);
      setSelectedIndex(0);
      return;
    }

    // Semantic search via API
    setLoading(true);
    try {
      const response = await api.searchKnowledgeGraph(parsed.searchTerm, {
        limit: 20,
      });
      setResults(response.results || []);
      onResultsChange?.((response.results || []).map(r => r.id));
      setShowDropdown((response.results || []).length > 0);
      setSelectedIndex(0);
    } catch (err) {
      console.error('Search failed:', err);
      setResults([]);
      onResultsChange?.([]);
    } finally {
      setLoading(false);
    }
  }, [parseQuery, clientFilter, onResultsChange]);

  // Debounced search effect
  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    // Instant search for client-side prefixes
    const parsed = parseQuery(query);
    if (parsed.mode === 'client') {
      performSearch(query);
      return;
    }

    // Debounced semantic search
    searchTimeoutRef.current = setTimeout(() => {
      performSearch(query);
    }, 200);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [query, parseQuery, performSearch]);

  // Handle keyboard navigation
  const handleKeyDown = useCallback((e) => {
    if (!showDropdown) {
      if (e.key === 'Escape') {
        setQuery('');
        onResultsChange?.([]);
        inputRef.current?.blur();
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex(prev => Math.min(prev + 1, results.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex(prev => Math.max(prev - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (results[selectedIndex]) {
          onSelectNode?.(results[selectedIndex].id);
          setShowDropdown(false);
        }
        break;
      case 'Escape':
        e.preventDefault();
        setShowDropdown(false);
        setQuery('');
        onResultsChange?.([]);
        break;
      default:
        break;
    }
  }, [showDropdown, results, selectedIndex, onSelectNode, onResultsChange]);

  // Handle result click
  const handleResultClick = useCallback((result) => {
    onSelectNode?.(result.id);
    setShowDropdown(false);
  }, [onSelectNode]);

  // Handle clear
  const handleClear = useCallback(() => {
    setQuery('');
    setResults([]);
    onResultsChange?.([]);
    setShowDropdown(false);
    inputRef.current?.focus();
  }, [onResultsChange]);

  // Auto-focus input when autoFocus prop is true
  useEffect(() => {
    if (autoFocus && inputRef.current) {
      inputRef.current.focus();
    }
  }, [autoFocus]);

  // Set initial query when provided (e.g., for tag or entity navigation)
  useEffect(() => {
    if (initialQuery && !query) {
      setQuery(initialQuery);
    }
  }, [initialQuery]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-select first result when initial query produces results
  useEffect(() => {
    if (initialQuery && results.length > 0 && showDropdown) {
      // Auto-select the first result
      const firstResult = results[0];
      onSelectNode?.(firstResult.id);
      setShowDropdown(false);
    }
  }, [initialQuery, results, showDropdown, onSelectNode]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target) &&
          inputRef.current && !inputRef.current.contains(e.target)) {
        setShowDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Scroll selected item into view
  useEffect(() => {
    if (dropdownRef.current && showDropdown) {
      const selectedItem = dropdownRef.current.querySelector('.kg-search-result.selected');
      if (selectedItem) {
        selectedItem.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [selectedIndex, showDropdown]);

  // Get icon for result type
  const getTypeIcon = (type) => {
    if (type === 'note') return <FileText size={14} />;
    if (type === 'source') return <Folder size={14} />;
    if (type === 'entity') return <Users size={14} />;
    return <Hash size={14} />;
  };

  // Get type badge class
  const getTypeBadgeClass = (type) => {
    if (type === 'note') return 'kg-search-badge-note';
    if (type === 'source') return 'kg-search-badge-source';
    if (type === 'entity') return 'kg-search-badge-entity';
    return '';
  };

  return (
    <div className="kg-search-container">
      <div className="kg-search-input-wrapper">
        <Search size={16} className="kg-search-icon" />
        <input
          ref={inputRef}
          type="text"
          className="kg-search-input"
          placeholder="Search nodes... @entity @note @tag:ai"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (results.length > 0) {
              setShowDropdown(true);
            }
          }}
        />
        {loading && <div className="kg-search-spinner" />}
        {query && !loading && (
          <button className="kg-search-clear" onClick={handleClear}>
            <X size={14} />
          </button>
        )}
      </div>

      {showDropdown && results.length > 0 && (
        <div className="kg-search-dropdown" ref={dropdownRef}>
          <div className="kg-search-results-header">
            {results.length} result{results.length !== 1 ? 's' : ''}
          </div>
          <ul className="kg-search-results">
            {results.map((result, index) => (
              <li
                key={result.id}
                className={`kg-search-result ${index === selectedIndex ? 'selected' : ''}`}
                onClick={() => handleResultClick(result)}
                onMouseEnter={() => setSelectedIndex(index)}
              >
                <span className={`kg-search-badge ${getTypeBadgeClass(result.type)}`}>
                  {getTypeIcon(result.type)}
                  {result.type === 'entity' ? result.entityType : result.type}
                </span>
                <span className="kg-search-result-name">{result.name}</span>
                {result.tags?.length > 0 && (
                  <span className="kg-search-result-tags">
                    {result.tags.slice(0, 2).join(' ')}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
