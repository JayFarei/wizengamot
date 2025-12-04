import { useState, useRef, useEffect } from 'react';
import './Sidebar.css';

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

  // Update text when not animating and text changes
  useEffect(() => {
    if (!isAnimating && !animatingRef.current) {
      setDisplayText(text);
    }
  }, [text, isAnimating]);

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

      {/* Conversation list - always in DOM, fades on collapse */}
      <div className="conversation-list">
        {conversations.length === 0 ? (
          <div className="no-conversations">No conversations yet</div>
        ) : (
          conversations.map((conv) => {
            const isCurrentAndLoading = conv.id === currentConversationId && isLoading;
            const shouldAnimate = conv.id === animatingTitleId;
            const isCouncil = conv.mode !== 'synthesizer';

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
                    {isCouncil ? (
                      <>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                          <circle cx="9" cy="7" r="4"/>
                          <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                          <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                        </svg>
                        <span>Council</span>
                      </>
                    ) : (
                      <>
                        {conv.source_type === 'youtube' ? (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
                          </svg>
                        ) : (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                            <polyline points="14 2 14 8 20 8"/>
                            <line x1="16" y1="13" x2="8" y2="13"/>
                            <line x1="16" y1="17" x2="8" y2="17"/>
                          </svg>
                        )}
                        <span>Notes</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })
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
