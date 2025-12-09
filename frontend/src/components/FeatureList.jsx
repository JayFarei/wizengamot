import { useState, useEffect, useRef } from 'react';
import { api } from '../api';
import './FeatureList.css';

export default function FeatureList() {
  const [features, setFeatures] = useState([]);
  const [loading, setLoading] = useState(true);
  const [canScroll, setCanScroll] = useState(false);
  const [isAtBottom, setIsAtBottom] = useState(false);
  const listRef = useRef(null);

  useEffect(() => {
    loadFeatures();
  }, []);

  useEffect(() => {
    checkScrollable();
  }, [features]);

  const loadFeatures = async () => {
    try {
      const result = await api.getFeatures();
      if (result.content) {
        const parsed = parseFeatures(result.content);
        setFeatures(parsed);
      }
    } catch (error) {
      console.error('Failed to load features:', error);
    } finally {
      setLoading(false);
    }
  };

  const parseFeatures = (markdown) => {
    const lines = markdown.split('\n');
    const featureList = [];

    for (const line of lines) {
      // Match pattern: "Dec 9 - Feature text so that benefit"
      const match = line.match(/^([A-Z][a-z]{2}\s+\d+)\s*-\s*(.+)$/);
      if (match) {
        featureList.push({
          date: match[1],
          text: match[2],
        });
      }
    }

    return featureList;
  };

  const checkScrollable = () => {
    if (listRef.current) {
      const { scrollHeight, clientHeight } = listRef.current;
      setCanScroll(scrollHeight > clientHeight);
      setIsAtBottom(false);
    }
  };

  const handleScroll = () => {
    if (listRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = listRef.current;
      const atBottom = scrollTop + clientHeight >= scrollHeight - 10;
      setIsAtBottom(atBottom);
    }
  };

  if (loading) {
    return <div className="feature-list-loading">Loading features...</div>;
  }

  if (features.length === 0) {
    return null;
  }

  return (
    <div className={`feature-list ${canScroll ? 'scrollable' : ''} ${isAtBottom ? 'at-bottom' : ''}`}>
      <ul
        className="feature-items"
        ref={listRef}
        onScroll={handleScroll}
      >
        {features.map((feature, index) => (
          <li key={index} className="feature-item">
            <span className="feature-date">{feature.date}</span>
            <span className="feature-text">{feature.text}</span>
          </li>
        ))}
      </ul>
      {canScroll && !isAtBottom && (
        <div className="scroll-indicator">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M4 6L8 10L12 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
      )}
    </div>
  );
}
