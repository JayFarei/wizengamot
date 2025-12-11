import { useState, useRef, useEffect } from 'react';
import './Sidebar.css';
import { formatRelativeTime } from '../utils/formatRelativeTime';

function getSourceTypeLabel(sourceType) {
  const labels = {
    youtube: 'YouTube',
    article: 'Article',
    podcast: 'Podcast',
    pdf: 'PDF',
    arxiv: 'arXiv'
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

export default function Sidebar({
  conversations,
  currentConversationId,
  onSelectConversation,
  onNewConversation,
  onDeleteConversation,
  onOpenSettings,
  onOpenSearch,
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
}) {
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

      {/* Monitors section */}
      {monitors.length > 0 && (
        <div className="sidebar-section">
          <div className="section-header">Monitors</div>
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
        </div>
      )}

      {/* Conversation sections - equal height, independent scroll */}
      <div className="conversation-sections">
        {conversations.length === 0 ? (
          <div className="no-conversations">No conversations yet</div>
        ) : (
          <>
            {/* Council section */}
            {conversations.filter(c => c.mode !== 'synthesizer' && c.mode !== 'visualiser').length > 0 && (
              <div className="sidebar-section scrollable">
                <div className="section-header">Council</div>
                <div className="section-list">
                  {conversations
                    .filter(c => c.mode !== 'synthesizer' && c.mode !== 'visualiser')
                    .map((conv) => {
                      const isCurrentAndLoading = conv.id === currentConversationId && isLoading;
                      const shouldAnimate = conv.id === animatingTitleId;

                      return (
                        <div
                          key={conv.id}
                          className={`conversation-item ${
                            conv.id === currentConversationId ? 'active' : ''
                          } ${isCurrentAndLoading ? 'loading' : ''}`}
                          onClick={() => onSelectConversation(conv.id)}
                        >
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
                                  if (confirm('Delete this conversation?')) {
                                    onDeleteConversation(conv.id);
                                  }
                                }}
                                title="Delete conversation"
                              >
                                ×
                              </button>
                            </div>
                            <div className="conversation-meta">
                              <span className="meta-timestamp">{formatRelativeTime(conv.created_at)}</span>
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
                        </div>
                      );
                    })}
                </div>
              </div>
            )}

            {/* Separator between Council and Notes */}
            {conversations.filter(c => c.mode !== 'synthesizer' && c.mode !== 'visualiser').length > 0 &&
             conversations.filter(c => c.mode === 'synthesizer').length > 0 && (
              <div className="sidebar-separator"></div>
            )}

            {/* Notes section */}
            {conversations.filter(c => c.mode === 'synthesizer').length > 0 && (
              <div className="sidebar-section scrollable">
                <div className="section-header">Notes</div>
                <div className="section-list">
                  {conversations
                    .filter(c => c.mode === 'synthesizer')
                    .map((conv) => {
                      const isCurrentAndLoading = conv.id === currentConversationId && isLoading;
                      const shouldAnimate = conv.id === animatingTitleId;

                      return (
                        <div
                          key={conv.id}
                          className={`conversation-item ${
                            conv.id === currentConversationId ? 'active' : ''
                          } ${isCurrentAndLoading ? 'loading' : ''}`}
                          onClick={() => onSelectConversation(conv.id)}
                        >
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
                                  if (confirm('Delete this conversation?')) {
                                    onDeleteConversation(conv.id);
                                  }
                                }}
                                title="Delete conversation"
                              >
                                ×
                              </button>
                            </div>
                            <div className="conversation-meta">
                              <span className="meta-timestamp">{formatRelativeTime(conv.created_at)}</span>
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
                        </div>
                      );
                    })}
                </div>
              </div>
            )}

            {/* Separator before Visualiser */}
            {conversations.filter(c => c.mode === 'visualiser').length > 0 &&
             conversations.filter(c => c.mode !== 'visualiser').length > 0 && (
              <div className="sidebar-separator"></div>
            )}

            {/* Visualiser section */}
            {conversations.filter(c => c.mode === 'visualiser').length > 0 && (
              <div className="sidebar-section scrollable">
                <div className="section-header">Visualiser</div>
                <div className="section-list">
                  {conversations
                    .filter(c => c.mode === 'visualiser')
                    .map((conv) => {
                      const isCurrentAndLoading = conv.id === currentConversationId && isLoading;
                      const shouldAnimate = conv.id === animatingTitleId;

                      return (
                        <div
                          key={conv.id}
                          className={`conversation-item ${
                            conv.id === currentConversationId ? 'active' : ''
                          } ${isCurrentAndLoading ? 'loading' : ''}`}
                          onClick={() => onSelectConversation(conv.id)}
                        >
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
                                  if (confirm('Delete this conversation?')) {
                                    onDeleteConversation(conv.id);
                                  }
                                }}
                                title="Delete conversation"
                              >
                                ×
                              </button>
                            </div>
                            <div className="conversation-meta">
                              <span className="meta-timestamp">{formatRelativeTime(conv.created_at)}</span>
                              {conv.source_type && (
                                <>
                                  <span className="meta-separator">·</span>
                                  <span className="source-type-label">{getVisualiserSourceLabel(conv.source_type)}</span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Settings button - always in DOM */}
      <div className="sidebar-footer">
        <button className="sidebar-action-btn" onClick={onOpenSettings} title="Settings">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
          <span className="action-text">Settings</span>
        </button>
      </div>
    </div>
  );
}
