import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import CouncilStagesView from './CouncilStagesView';
import CouncilConversationView from './CouncilConversationView';
import ModelInfoPopover from './ModelInfoPopover';
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
              <ReactMarkdown>{userQuestion}</ReactMarkdown>
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
              onClick={() => onOpenSettings?.('council')}
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
        <div className="council-header-toggles">
          <button
            className={`header-toggle-pill ${viewMode === 'stages' ? 'active' : ''}`}
            onClick={() => setViewMode('stages')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="7" height="7" rx="1" />
              <rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" />
              <rect x="14" y="14" width="7" height="7" rx="1" />
            </svg>
            Stages ({stageCount})
          </button>
          <button
            className={`header-toggle-pill ${viewMode === 'conversation' ? 'active' : ''}`}
            onClick={() => setViewMode('conversation')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            Conversation{followUpCount > 0 && ` (${followUpCount})`}
          </button>
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
            <ReactMarkdown>{userQuestion}</ReactMarkdown>
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
