import { useState, useEffect, useMemo, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import CouncilConfigBar from './CouncilConfigBar';
import CouncilViewToggle from './CouncilViewToggle';
import CouncilStagesView from './CouncilStagesView';
import CouncilConversationView from './CouncilConversationView';
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
}) {
  const [viewMode, setViewMode] = useState('stages');
  const [activeStage, setActiveStage] = useState(3); // Default to final answer
  const [activeModelIndex, setActiveModelIndex] = useState(0); // Active model tab index
  const [isPromptCollapsed, setIsPromptCollapsed] = useState(false);

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

  // Auto-collapse prompt when scrolling down, expand when at top
  const handleScrollChange = useCallback((direction) => {
    if (direction === 'down' && !isPromptCollapsed) {
      setIsPromptCollapsed(true);
    } else if (direction === 'top' && isPromptCollapsed) {
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

  return (
    <div className="council-discussion-view">
      {/* Config bar */}
      {councilConfig && (
        <CouncilConfigBar
          councilModels={councilConfig.council_models}
          chairmanModel={councilConfig.chairman_model}
        />
      )}

      {/* User's original question (collapsible with auto-collapse on scroll) */}
      {userQuestion && (
        <div className={`council-user-question ${isPromptCollapsed ? 'collapsed' : ''}`}>
          <button
            className="prompt-collapse-toggle"
            onClick={() => setIsPromptCollapsed(!isPromptCollapsed)}
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

      {/* Primary navigation toggle */}
      <CouncilViewToggle
        viewMode={viewMode}
        onViewChange={setViewMode}
        stageCount={hasStage3 ? 3 : hasStage2 ? 2 : 1}
        conversationCount={followUpCount}
      />

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

    </div>
  );
}
