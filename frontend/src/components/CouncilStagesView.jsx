import { useEffect, useRef, useCallback } from 'react';
import StageTabs from './StageTabs';
import Stage1 from './Stage1';
import Stage2 from './Stage2';
import Stage3 from './Stage3';
import CouncilMiniNav from './CouncilMiniNav';
import './CouncilDiscussionView.css';

export default function CouncilStagesView({
  activeStage,
  onStageChange,
  activeModelIndex,
  onModelIndexChange,
  message,
  messageIndex,
  comments,
  contextSegments,
  onSelectionChange,
  onEditComment,
  onDeleteComment,
  activeCommentId,
  onSetActiveComment,
  onAddContextSegment,
  onRemoveContextSegment,
  onScrollChange,
  // Mini-nav props
  stageModels,
  activeModel,
  onModelChange,
  // Loading state props
  loadingStage1 = false,
  loadingStage2 = false,
  loadingStage3 = false,
}) {
  const contentRef = useRef(null);
  const lastScrollTop = useRef(0);

  // Scroll to top when stage changes
  useEffect(() => {
    if (contentRef.current) {
      contentRef.current.scrollTop = 0;
      lastScrollTop.current = 0;
    }
  }, [activeStage]);

  // Auto-advance to appropriate stage based on available data
  useEffect(() => {
    // If viewing Stage 3 but it's not ready, fall back to Stage 2 or 1
    if (activeStage === 3 && !message.stage3 && !loadingStage3) {
      if (message.stage2 || loadingStage2) {
        onStageChange(2);
      } else {
        onStageChange(1);
      }
    }
    // If viewing Stage 2 but it's not ready, fall back to Stage 1
    else if (activeStage === 2 && !message.stage2 && !loadingStage2) {
      onStageChange(1);
    }
  }, [activeStage, message.stage2, message.stage3, loadingStage2, loadingStage3, onStageChange]);

  // Handle scroll events for auto-collapse
  const handleScroll = useCallback(() => {
    if (!contentRef.current || !onScrollChange) return;

    const scrollTop = contentRef.current.scrollTop;
    const isScrollingDown = scrollTop > lastScrollTop.current;

    // Notify parent when scrolling down past threshold or back to top
    if (isScrollingDown && scrollTop > 50) {
      onScrollChange('down');
    } else if (scrollTop === 0) {
      onScrollChange('top');
    }

    lastScrollTop.current = scrollTop;
  }, [onScrollChange]);

  // Attach scroll listener
  useEffect(() => {
    const element = contentRef.current;
    if (!element) return;

    element.addEventListener('scroll', handleScroll, { passive: true });
    return () => element.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Only handle if not in an input/textarea
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        return;
      }

      if (e.key === '1') {
        onStageChange(1);
      } else if (e.key === '2' && message.stage2) {
        onStageChange(2);
      } else if (e.key === '3' && message.stage3) {
        onStageChange(3);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (activeStage > 1) {
          onStageChange(activeStage - 1);
        }
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        const maxStage = message.stage3 ? 3 : message.stage2 ? 2 : 1;
        if (activeStage < maxStage) {
          onStageChange(activeStage + 1);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeStage, onStageChange, message]);

  const stage1ModelCount = message.stage1?.length || 0;
  const hasStage2 = Boolean(message.stage2);
  const hasStage3 = Boolean(message.stage3);

  return (
    <div className="council-stages-view">
      <StageTabs
        activeStage={activeStage}
        onStageChange={onStageChange}
        stage1ModelCount={stage1ModelCount}
        hasStage2={hasStage2}
        hasStage3={hasStage3}
        loadingStage1={loadingStage1}
        loadingStage2={loadingStage2}
        loadingStage3={loadingStage3}
      />

      <div className="council-stages-content" ref={contentRef}>
        {activeStage === 1 && (
          message.stage1 ? (
            <Stage1
              responses={message.stage1}
              messageIndex={messageIndex}
              comments={comments}
              contextSegments={contextSegments}
              onSelectionChange={onSelectionChange}
              onEditComment={onEditComment}
              onDeleteComment={onDeleteComment}
              activeCommentId={activeCommentId}
              onSetActiveComment={onSetActiveComment}
              onAddContextSegment={onAddContextSegment}
              onRemoveContextSegment={onRemoveContextSegment}
              activeTab={activeModelIndex}
              onActiveTabChange={onModelIndexChange}
            />
          ) : loadingStage1 ? (
            <div className="stage-loading">
              <div className="spinner"></div>
              <span>Stage 1: Collecting individual expert responses...</span>
            </div>
          ) : null
        )}

        {activeStage === 2 && (
          message.stage2 ? (
            <Stage2
              rankings={message.stage2}
              labelToModel={message.metadata?.label_to_model}
              aggregateRankings={message.metadata?.aggregate_rankings}
              messageIndex={messageIndex}
              comments={comments}
              contextSegments={contextSegments}
              onSelectionChange={onSelectionChange}
              onEditComment={onEditComment}
              onDeleteComment={onDeleteComment}
              activeCommentId={activeCommentId}
              onSetActiveComment={onSetActiveComment}
              onAddContextSegment={onAddContextSegment}
              onRemoveContextSegment={onRemoveContextSegment}
              activeTab={activeModelIndex}
              onActiveTabChange={onModelIndexChange}
            />
          ) : loadingStage2 ? (
            <div className="stage-loading">
              <div className="spinner"></div>
              <span>Stage 2: Collecting peer rankings...</span>
            </div>
          ) : null
        )}

        {activeStage === 3 && (
          message.stage3 ? (
            <Stage3
              finalResponse={message.stage3}
              messageIndex={messageIndex}
              comments={comments}
              contextSegments={contextSegments}
              onSelectionChange={onSelectionChange}
              onEditComment={onEditComment}
              onDeleteComment={onDeleteComment}
              activeCommentId={activeCommentId}
              onSetActiveComment={onSetActiveComment}
              onAddContextSegment={onAddContextSegment}
              onRemoveContextSegment={onRemoveContextSegment}
            />
          ) : loadingStage3 ? (
            <div className="stage-loading">
              <div className="spinner"></div>
              <span>Stage 3: Synthesizing final response...</span>
            </div>
          ) : null
        )}
      </div>

      {/* Floating mini navigation - outside scrollable content for fixed positioning */}
      <CouncilMiniNav
        viewMode="stages"
        activeStage={activeStage}
        models={stageModels}
        activeModel={activeModel}
        onModelChange={onModelChange}
      />
    </div>
  );
}
