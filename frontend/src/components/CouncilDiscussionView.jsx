import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import CouncilStagesView from './CouncilStagesView';
import CouncilConversationView from './CouncilConversationView';
import ModelInfoPopover from './ModelInfoPopover';
import ActionMenu from './ActionMenu';
import ReviewSessionsButton from './ReviewSessionsButton';
import './CouncilDiscussionView.css';

export default function CouncilDiscussionView({
  conversation,
  comments,
  contextSegments,
  onSelectionChange,
  onEditComment,
  onDeleteComment,
  activeCommentId,
  onSetActiveComment,
  onAddContextSegment,
  onRemoveContextSegment,
  onOpenSettings,
  onContinueThread,
  onSelectThread,
  isLoading,
  reviewSessionCount = 0,
  onToggleReviewSidebar,
}) {
  const [viewMode, setViewMode] = useState('stages');
  const [activeStage, setActiveStage] = useState(3); // Default to final answer
  const [activeModelIndex, setActiveModelIndex] = useState(0); // Active model tab index
  const [isPromptCollapsed, setIsPromptCollapsed] = useState(false);
  const userManuallyCollapsedRef = useRef(false); // Track if user manually collapsed prompt

  // Responsive header popover state
  const [showModelPopover, setShowModelPopover] = useState(false);
  const [popoverType, setPopoverType] = useState(null); // 'council' | 'chairman'
  const [popoverPosition, setPopoverPosition] = useState({ top: 0, left: 0 });
  const [isCompactMode, setIsCompactMode] = useState(false);
  const councilButtonRef = useRef(null);
  const chairmanButtonRef = useRef(null);
  const headerBarRef = useRef(null);
  const headerConfigRef = useRef(null);

  // Get the latest assistant message with council data (or loading state)
  const latestCouncilMessage = useMemo(() => {
    if (!conversation?.messages) return null;

    for (let i = conversation.messages.length - 1; i >= 0; i--) {
      const msg = conversation.messages[i];
      // Include messages with stage data OR loading state
      if (msg.role === 'assistant' && (msg.stage1 || msg.stage2 || msg.stage3 || msg.loading)) {
        return { message: msg, index: i };
      }
    }
    return null;
  }, [conversation]);

  // Track loading states for each stage
  const loadingStage1 = latestCouncilMessage?.message?.loading?.stage1 ?? false;
  const loadingStage2 = latestCouncilMessage?.message?.loading?.stage2 ?? false;
  const loadingStage3 = latestCouncilMessage?.message?.loading?.stage3 ?? false;

  // Get the user's original question
  const userQuestion = useMemo(() => {
    if (!conversation?.messages) return null;

    for (const msg of conversation.messages) {
      if (msg.role === 'user') {
        return msg.content;
      }
    }
    return null;
  }, [conversation]);

  // Count follow-up messages for conversation tab badge
  const followUpCount = useMemo(() => {
    if (!conversation?.messages) return 0;
    return conversation.messages.filter(
      (msg) => msg.role === 'follow-up-user' || msg.role === 'follow-up-assistant'
    ).length;
  }, [conversation]);

  // Determine available stages
  const hasStage2 = Boolean(latestCouncilMessage?.message?.stage2);
  const hasStage3 = Boolean(latestCouncilMessage?.message?.stage3);

  // Adjust activeStage if current stage is not available
  useEffect(() => {
    if (activeStage === 3 && !hasStage3) {
      setActiveStage(hasStage2 ? 2 : 1);
    } else if (activeStage === 2 && !hasStage2) {
      setActiveStage(1);
    }
  }, [activeStage, hasStage2, hasStage3]);

  // Auto-switch to conversation view when new follow-ups arrive
  useEffect(() => {
    if (followUpCount > 0 && viewMode === 'stages') {
      // Only auto-switch if this is a new follow-up (not initial load)
      const lastMsg = conversation?.messages?.[conversation.messages.length - 1];
      if (lastMsg?.role === 'follow-up-assistant' || lastMsg?.role === 'follow-up-user') {
        setViewMode('conversation');
      }
    }
  }, [followUpCount]);

  const getModelShortName = (model) => {
    return model?.split('/')[1] || model;
  };

  // Detect compact mode when header content would wrap (height exceeds single line)
  useEffect(() => {
    const headerConfig = headerConfigRef.current;
    if (!headerConfig) return;

    // Single line height threshold (approximate)
    const SINGLE_LINE_HEIGHT = 30;

    const checkOverflow = () => {
      // If in compact mode, we can't measure full content height
      // So we check if we can switch back to full mode
      if (isCompactMode) {
        // Try switching to full mode temporarily to measure
        // This is handled by the resize observer - when window gets bigger
        // we might be able to fit the full content
        return;
      }

      // In full mode, check if content is wrapping (height > single line)
      const configHeight = headerConfig.offsetHeight;
      const needsCompact = configHeight > SINGLE_LINE_HEIGHT;

      if (needsCompact) {
        setIsCompactMode(true);
      }
    };

    // Check if we can expand back to full mode
    const checkCanExpand = () => {
      if (!isCompactMode) return;

      // Create a temporary hidden element to measure full content width
      const headerBar = headerBarRef.current;
      if (!headerBar) return;

      const toggles = headerBar.querySelector('.council-header-toggles');
      const promptLabel = headerBar.querySelector('.header-prompt-label');
      const togglesWidth = toggles ? toggles.offsetWidth : 0;
      const promptWidth = promptLabel ? promptLabel.offsetWidth + 16 : 0; // +16 for gap

      const headerBarStyle = getComputedStyle(headerBar);
      const headerBarPadding = parseFloat(headerBarStyle.paddingLeft) + parseFloat(headerBarStyle.paddingRight);
      const gap = parseFloat(headerBarStyle.gap) || 16;

      // Available space for model names
      const availableWidth = headerBar.offsetWidth - togglesWidth - promptWidth - headerBarPadding - gap * 2;

      // Estimate full content width based on model names
      const councilConfig = conversation?.council_config;
      if (!councilConfig) return;

      const councilText = councilConfig.council_models.map(m => m.split('/')[1] || m).join(', ');
      const chairmanText = councilConfig.chairman_model.split('/')[1] || councilConfig.chairman_model;

      // Rough estimate: ~7px per character + labels + gaps
      const estimatedWidth = (councilText.length + chairmanText.length) * 7 + 180;

      if (estimatedWidth < availableWidth) {
        setIsCompactMode(false);
        setShowModelPopover(false);
      }
    };

    // Initial check
    requestAnimationFrame(() => {
      checkOverflow();
    });

    // Watch for size changes
    const resizeObserver = new ResizeObserver(() => {
      if (isCompactMode) {
        checkCanExpand();
      } else {
        checkOverflow();
      }
    });

    if (headerBarRef.current) {
      resizeObserver.observe(headerBarRef.current);
    }

    return () => {
      resizeObserver.disconnect();
    };
  }, [isCompactMode, conversation?.council_config]);

  // Handle opening model info popover
  const handleOpenModelPopover = (type) => {
    const buttonRef = type === 'council' ? councilButtonRef : chairmanButtonRef;
    if (!buttonRef.current) return;

    const rect = buttonRef.current.getBoundingClientRect();
    let left = rect.left;

    // Check if popover would go off-screen
    const popoverWidth = 320;
    if (left + popoverWidth > window.innerWidth) {
      left = window.innerWidth - popoverWidth - 16;
    }

    setPopoverPosition({
      top: rect.bottom + 8,
      left: Math.max(8, left)
    });
    setPopoverType(type);
    setShowModelPopover(true);
  };

  const handleCloseModelPopover = () => {
    setShowModelPopover(false);
    setPopoverType(null);
  };

  // Get models for current stage (for mini-nav expert buttons)
  const stageModels = useMemo(() => {
    if (activeStage === 1) {
      return latestCouncilMessage?.message?.stage1?.map(r => r.model) || [];
    } else if (activeStage === 2) {
      return latestCouncilMessage?.message?.stage2?.map(r => r.model) || [];
    }
    return []; // Stage 3 has no model tabs
  }, [activeStage, latestCouncilMessage]);

  // Reset model index when stage changes
  useEffect(() => {
    setActiveModelIndex(0);
  }, [activeStage]);

  // Command palette action listener
  useEffect(() => {
    const handleCommandPaletteAction = async (e) => {
      const { action } = e.detail;
      switch (action) {
        case 'copyResponse':
          // Copy current stage response to clipboard
          if (latestCouncilMessage?.message) {
            let content = '';
            if (activeStage === 3 && latestCouncilMessage.message.stage3) {
              content = latestCouncilMessage.message.stage3;
            } else if (activeStage === 2 && latestCouncilMessage.message.stage2?.[activeModelIndex]) {
              content = latestCouncilMessage.message.stage2[activeModelIndex].evaluation;
            } else if (activeStage === 1 && latestCouncilMessage.message.stage1?.[activeModelIndex]) {
              content = latestCouncilMessage.message.stage1[activeModelIndex].content;
            }
            if (content) {
              try {
                await navigator.clipboard.writeText(content);
              } catch (err) {
                console.error('Failed to copy:', err);
              }
            }
          }
          break;
        case 'addToContext':
          // Add current response to context stack
          if (onAddContextSegment && latestCouncilMessage?.message) {
            let content = '';
            let label = '';
            if (activeStage === 3 && latestCouncilMessage.message.stage3) {
              content = latestCouncilMessage.message.stage3;
              label = 'Stage 3 - Final Answer';
            } else if (activeStage === 2 && latestCouncilMessage.message.stage2?.[activeModelIndex]) {
              const model = latestCouncilMessage.message.stage2[activeModelIndex].model;
              content = latestCouncilMessage.message.stage2[activeModelIndex].evaluation;
              label = `Stage 2 - ${model?.split('/')[1] || model}`;
            } else if (activeStage === 1 && latestCouncilMessage.message.stage1?.[activeModelIndex]) {
              const model = latestCouncilMessage.message.stage1[activeModelIndex].model;
              content = latestCouncilMessage.message.stage1[activeModelIndex].content;
              label = `Stage 1 - ${model?.split('/')[1] || model}`;
            }
            if (content) {
              onAddContextSegment({
                id: `stage-${activeStage}-${activeModelIndex}-${Date.now()}`,
                sourceType: 'council',
                stage: activeStage,
                model: activeStage === 3 ? 'chairman' : (latestCouncilMessage.message[`stage${activeStage}`]?.[activeModelIndex]?.model || 'unknown'),
                messageIndex: latestCouncilMessage.index,
                label: label,
                content: content,
              });
            }
          }
          break;
        case 'exportConversation':
          // Export full conversation as markdown
          if (conversation?.messages) {
            const parts = [];
            parts.push(`# Council Discussion: ${conversation.title || 'Untitled'}`);
            parts.push('');

            for (const msg of conversation.messages) {
              if (msg.role === 'user') {
                parts.push('## Question');
                parts.push(msg.content);
                parts.push('');
              } else if (msg.role === 'assistant') {
                if (msg.stage1) {
                  parts.push('## Stage 1: Individual Responses');
                  msg.stage1.forEach((r, i) => {
                    parts.push(`### ${r.model?.split('/')[1] || r.model}`);
                    parts.push(r.content);
                    parts.push('');
                  });
                }
                if (msg.stage3) {
                  parts.push('## Final Answer');
                  parts.push(msg.stage3);
                  parts.push('');
                }
              }
            }

            try {
              await navigator.clipboard.writeText(parts.join('\n'));
            } catch (err) {
              console.error('Failed to export:', err);
            }
          }
          break;
        default:
          break;
      }
    };

    window.addEventListener('commandPalette:action', handleCommandPaletteAction);
    return () => window.removeEventListener('commandPalette:action', handleCommandPaletteAction);
  }, [activeStage, activeModelIndex, latestCouncilMessage, onAddContextSegment, conversation]);

  // Get current active model
  const activeModel = stageModels[activeModelIndex] || null;

  const handleModelChange = (model) => {
    const index = stageModels.indexOf(model);
    if (index !== -1) {
      setActiveModelIndex(index);
    }
  };

  // Handle manual toggle of prompt collapse
  const handleTogglePromptCollapse = useCallback(() => {
    const newCollapsed = !isPromptCollapsed;
    setIsPromptCollapsed(newCollapsed);
    userManuallyCollapsedRef.current = newCollapsed; // Track manual state
  }, [isPromptCollapsed]);

  // Auto-collapse prompt when scrolling down, expand when at top (unless manually collapsed)
  const handleScrollChange = useCallback((direction) => {
    if (direction === 'down' && !isPromptCollapsed) {
      setIsPromptCollapsed(true);
      // Don't update userManuallyCollapsedRef - this is auto-collapse
    } else if (direction === 'top' && isPromptCollapsed && !userManuallyCollapsedRef.current) {
      // Only auto-expand if user didn't manually collapse
      setIsPromptCollapsed(false);
    }
  }, [isPromptCollapsed]);

  if (!latestCouncilMessage) {
    // Fallback loading state (shouldn't happen in normal flow)
    return (
      <div className="council-discussion-view">
        {userQuestion && (
          <div className="council-user-question">
            <button className="prompt-collapse-toggle">
              <svg className="collapse-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="6 9 12 15 18 9" />
              </svg>
              <span>Your Question</span>
            </button>
            <div className="council-user-question-content markdown-content">
              <ReactMarkdown components={{ img: ({ src, ...props }) => src ? <img src={src} {...props} /> : null }}>{userQuestion}</ReactMarkdown>
            </div>
          </div>
        )}
        <div className="council-loading-state">
          <div className="spinner"></div>
          <span>Preparing council deliberation...</span>
        </div>
      </div>
    );
  }

  const councilConfig = conversation.council_config;
  const hasConversation = followUpCount > 0;

  const stageCount = hasStage3 ? 3 : hasStage2 ? 2 : 1;

  return (
    <div className="council-discussion-view">
      {/* Unified header bar: config info + view toggles */}
      <div className="council-header-bar" ref={headerBarRef}>
        <div className="council-header-config" ref={headerConfigRef}>
          {councilConfig && (
            <>
              <div className="config-info">
                <span className="config-label">Council:</span>
                {isCompactMode ? (
                  <button
                    ref={councilButtonRef}
                    className="config-value-compact"
                    onClick={() => handleOpenModelPopover('council')}
                    aria-label={`View ${councilConfig.council_models.length} council models`}
                    aria-expanded={showModelPopover && popoverType === 'council'}
                    aria-haspopup="dialog"
                  >
                    ({councilConfig.council_models.length})
                  </button>
                ) : (
                  <span className="config-value">
                    {councilConfig.council_models.map(getModelShortName).join(', ')}
                  </span>
                )}
              </div>
              <div className="config-info">
                <span className="config-label">Chairman:</span>
                {isCompactMode ? (
                  <button
                    ref={chairmanButtonRef}
                    className="config-value-compact"
                    onClick={() => handleOpenModelPopover('chairman')}
                    aria-label="View chairman model"
                    aria-expanded={showModelPopover && popoverType === 'chairman'}
                    aria-haspopup="dialog"
                  >
                    (1)
                  </button>
                ) : (
                  <span className="config-value">
                    {getModelShortName(councilConfig.chairman_model)}
                  </span>
                )}
              </div>
            </>
          )}
          {conversation.prompt_title && (
            <button
              className="header-prompt-label"
              onClick={() => onOpenSettings?.('council', conversation.prompt_filename)}
              title="View system prompt"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
              </svg>
              {conversation.prompt_title}
            </button>
          )}
        </div>
        <div className="council-header-controls">
          <div className="council-header-toggles">
            <div className="view-toggle">
              <button
                className={`toggle-btn ${viewMode === 'stages' ? 'active' : ''}`}
                onClick={() => setViewMode('stages')}
                title="Council view"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="7" cy="12" r="2" />
                  <circle cx="17" cy="8" r="2" />
                  <circle cx="17" cy="16" r="2" />
                  <path d="M8.8 11l6-2" />
                  <path d="M8.8 13l6 2" />
                </svg>
              </button>
              <button
                className={`toggle-btn ${viewMode === 'conversation' ? 'active' : ''}`}
                onClick={() => setViewMode('conversation')}
                title="Chat view"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M20 15a2 2 0 0 1-2 2h-5l-4 3v-3H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z" />
                  <path d="M8 9h8" />
                  <path d="M8 12h5" />
                </svg>
              </button>
            </div>
            <span className="toggle-label">
              {viewMode === 'stages' ? `Council (${stageCount})` : `Chat${followUpCount > 0 ? ` (${followUpCount})` : ''}`}
            </span>
          </div>
          <div className="council-header-actions">
            <ReviewSessionsButton
              sessionCount={reviewSessionCount}
              onClick={onToggleReviewSidebar}
            />
            <ActionMenu>
              <ActionMenu.Item
                icon={
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                }
                label="Copy Conversation"
                onClick={() => {
                  const text = conversation?.messages
                    ?.map(m => `${m.role}: ${m.content || ''}`)
                    .join('\n\n');
                  if (text) navigator.clipboard.writeText(text);
                }}
              />
              <ActionMenu.Item
                icon={
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="16" y1="13" x2="8" y2="13" />
                    <line x1="16" y1="17" x2="8" y2="17" />
                  </svg>
                }
                label="Copy as Markdown"
                onClick={() => {
                  const md = conversation?.messages
                    ?.map(m => `**${m.role}:**\n${m.content || ''}`)
                    .join('\n\n---\n\n');
                  if (md) navigator.clipboard.writeText(md);
                }}
              />
              {onToggleReviewSidebar && <ActionMenu.Divider />}
              {onToggleReviewSidebar && (
                <ActionMenu.Item
                  icon={
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12.89 1.45l8 4A2 2 0 0 1 22 7.24v9.53a2 2 0 0 1-1.11 1.79l-8 4a2 2 0 0 1-1.79 0l-8-4a2 2 0 0 1-1.1-1.8V7.24a2 2 0 0 1 1.11-1.79l8-4a2 2 0 0 1 1.78 0z" />
                      <polyline points="2.32 6.16 12 11 21.68 6.16" />
                      <line x1="12" y1="22.76" x2="12" y2="11" />
                    </svg>
                  }
                  label="Review Sessions"
                  onClick={onToggleReviewSidebar}
                />
              )}
              <ActionMenu.Hint>
                <kbd>⌘</kbd><kbd>⇧</kbd><kbd>P</kbd> Command Palette
              </ActionMenu.Hint>
            </ActionMenu>
          </div>
        </div>
      </div>

      {/* User's original question (collapsible with auto-collapse on scroll) */}
      {userQuestion && (
        <div className={`council-user-question ${isPromptCollapsed ? 'collapsed' : ''}`}>
          <button
            className="prompt-collapse-toggle"
            onClick={handleTogglePromptCollapse}
          >
            <svg
              className={`collapse-chevron ${isPromptCollapsed ? 'rotated' : ''}`}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
            <span>Your Question</span>
          </button>
          <div className="council-user-question-content markdown-content">
            <ReactMarkdown components={{ img: ({ src, ...props }) => src ? <img src={src} {...props} /> : null }}>{userQuestion}</ReactMarkdown>
          </div>
        </div>
      )}

      {/* Main content area */}
      {viewMode === 'stages' ? (
        <CouncilStagesView
          activeStage={activeStage}
          onStageChange={setActiveStage}
          activeModelIndex={activeModelIndex}
          onModelIndexChange={setActiveModelIndex}
          message={latestCouncilMessage.message}
          messageIndex={latestCouncilMessage.index}
          comments={comments}
          contextSegments={contextSegments}
          onSelectionChange={onSelectionChange}
          onEditComment={onEditComment}
          onDeleteComment={onDeleteComment}
          activeCommentId={activeCommentId}
          onSetActiveComment={onSetActiveComment}
          onAddContextSegment={onAddContextSegment}
          onRemoveContextSegment={onRemoveContextSegment}
          onScrollChange={handleScrollChange}
          stageModels={stageModels}
          activeModel={activeModel}
          onModelChange={handleModelChange}
          loadingStage1={loadingStage1}
          loadingStage2={loadingStage2}
          loadingStage3={loadingStage3}
        />
      ) : (
        <CouncilConversationView
          messages={conversation.messages}
          getModelShortName={getModelShortName}
          onContinueThread={onContinueThread}
          onSelectThread={onSelectThread}
          isLoading={isLoading}
        />
      )}

      {/* Model info popover for compact mode */}
      {showModelPopover && councilConfig && (
        <ModelInfoPopover
          isOpen={showModelPopover}
          type={popoverType}
          models={
            popoverType === 'council'
              ? councilConfig.council_models
              : [councilConfig.chairman_model]
          }
          position={popoverPosition}
          onClose={handleCloseModelPopover}
          getModelShortName={getModelShortName}
        />
      )}
    </div>
  );
}
