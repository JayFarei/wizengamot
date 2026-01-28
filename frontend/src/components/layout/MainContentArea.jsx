import { useCallback, useEffect, useRef } from 'react';
import { useLayout } from '../../contexts/LayoutContext';
import { PaneProvider } from '../../contexts/PaneContext';
import PaneContainer from './PaneContainer';
import PaneContent from './PaneContent';
import PaneSearchModal from './PaneSearchModal';
import ChatInterface from '../ChatInterface';
import './MainContentArea.css';

/**
 * Main content area that supports split panes
 * Each pane independently loads and renders its own conversation
 *
 * IMPORTANT: Always renders through PaneContainer (anime.js) regardless of pane count.
 * This ensures smooth animations when transitioning between 1 and 2+ panes.
 */
export default function MainContentArea({
  children,
  conversations = [],
  currentConversationId,
  onSelectConversation,
  onConversationsListUpdate,
  onAnimateTitleId,
  availableConfig,
  onOpenSettings,
  onNavigateToPodcast,
  onNavigateToVisualiser,
  onNavigateToGraphEntity,
  onNavigateToGraphSearch,
  visualiserSourceConvId,
  onClearVisualiserSource,
  podcastSourceConvId,
  onNewConversation,
  theme,
  onToggleTheme,
}) {
  const {
    isSplit,
    panes,
    allPaneIds,
    focusedPaneId,
    pendingSearchPaneId,
    clearPendingSearch,
    setPaneConversation,
    requestSearch,
    closingPaneId,
  } = useLayout();

  // Track previous conversationId to detect external changes (sidebar clicks, etc.)
  const prevConversationIdRef = useRef(currentConversationId);

  // When currentConversationId changes from outside (sidebar, search modal),
  // update the appropriate pane to show that conversation
  useEffect(() => {
    if (currentConversationId && currentConversationId !== prevConversationIdRef.current) {
      // In split mode: update focused pane
      // In non-split mode: update pane-1 (keeps it in sync for when we split later)
      const targetPaneId = isSplit ? focusedPaneId : allPaneIds[0];
      if (targetPaneId) {
        setPaneConversation(targetPaneId, currentConversationId);
      }
    }
    prevConversationIdRef.current = currentConversationId;
  }, [currentConversationId, isSplit, focusedPaneId, allPaneIds, setPaneConversation]);

  // When a pane starts closing, immediately sync the surviving pane's conversation
  // This happens during PREPARE phase (before animation completes), preventing flash
  useEffect(() => {
    if (!closingPaneId) return;

    // Only sync when going from 2+ panes to 1
    if (allPaneIds.length <= 1) return;

    // Find the pane that will survive (not the one being closed)
    const survivingPaneId = allPaneIds.find(id => id !== closingPaneId);
    if (!survivingPaneId) return;

    const survivingPane = panes[survivingPaneId];
    const survivingConvId = survivingPane?.conversationId;

    // Pre-sync the conversation ID before animation completes
    if (survivingConvId && survivingConvId !== currentConversationId) {
      onSelectConversation?.({ id: survivingConvId });
    }
  }, [closingPaneId, allPaneIds, panes, currentConversationId, onSelectConversation]);

  // Handle pane conversation change (propagate to parent)
  const handlePaneConversationChange = useCallback((paneId, conversationId) => {
    // When a pane's conversation changes, notify parent
    if (onSelectConversation && paneId === focusedPaneId) {
      onSelectConversation({ id: conversationId }, paneId);
    }
  }, [onSelectConversation, focusedPaneId]);

  // Handle requesting a conversation for a pane (opens search modal)
  const handleRequestConversation = useCallback((paneId) => {
    requestSearch(paneId);
  }, [requestSearch]);

  // Handle selecting a conversation from the pane search modal
  const handlePaneSelect = useCallback((paneId, conversationId) => {
    setPaneConversation(paneId, conversationId);
    // Notify parent to update currentConversationId if this is focused pane
    if (onSelectConversation) {
      onSelectConversation({ id: conversationId }, paneId);
    }
  }, [setPaneConversation, onSelectConversation]);

  // Render content for a specific pane
  const renderPaneContent = useCallback((paneId) => {
    const pane = panes[paneId];
    const isPendingSearch = pendingSearchPaneId === paneId;

    // Show search modal if this pane is pending search
    if (isPendingSearch) {
      return (
        <PaneSearchModal
          paneId={paneId}
          conversations={conversations}
          onSelect={(convId) => handlePaneSelect(paneId, convId)}
          onClose={clearPendingSearch}
          onNewConversation={onNewConversation}
          onOpenSettings={() => onOpenSettings?.()}
          theme={theme}
          onToggleTheme={onToggleTheme}
        />
      );
    }

    // Render PaneContent with PaneProvider for this pane's conversation
    return (
      <PaneProvider
        paneId={paneId}
        conversationId={pane?.conversationId}
        onConversationChange={handlePaneConversationChange}
        onConversationsListUpdate={onConversationsListUpdate}
        availableConfig={availableConfig}
      >
        <PaneContent
          paneId={paneId}
          conversations={conversations}
          availableConfig={availableConfig}
          onConversationsListUpdate={onConversationsListUpdate}
          onSelectConversation={(id) => handlePaneSelect(paneId, typeof id === 'string' ? id : id?.id)}
          onAnimateTitleId={onAnimateTitleId}
          onOpenSettings={onOpenSettings}
          onNavigateToPodcast={onNavigateToPodcast}
          onNavigateToVisualiser={onNavigateToVisualiser}
          onNavigateToGraphEntity={onNavigateToGraphEntity}
          onNavigateToGraphSearch={onNavigateToGraphSearch}
          visualiserSourceConvId={visualiserSourceConvId}
          onClearVisualiserSource={onClearVisualiserSource}
          podcastSourceConvId={podcastSourceConvId}
        />
      </PaneProvider>
    );
  }, [
    panes,
    pendingSearchPaneId,
    conversations,
    handlePaneSelect,
    clearPendingSearch,
    handlePaneConversationChange,
    onConversationsListUpdate,
    availableConfig,
    onAnimateTitleId,
    onOpenSettings,
    onNavigateToPodcast,
    onNavigateToVisualiser,
    onNavigateToGraphEntity,
    onNavigateToGraphSearch,
    visualiserSourceConvId,
    onClearVisualiserSource,
    podcastSourceConvId,
    onNewConversation,
    theme,
    onToggleTheme,
  ]);

  // When going home (no conversation selected and not split), show landing page
  if (!currentConversationId && !isSplit) {
    return (
      <ChatInterface
        conversation={null}
        onOpenSettings={onOpenSettings}
      />
    );
  }

  // Always render through PaneContainer for consistent anime.js animation context.
  // This prevents re-render/refresh when transitioning between 1 and 2+ panes,
  // enabling smooth animations in both directions.
  return (
    <div className="main-content-area main-content-split">
      <PaneContainer
        renderPaneContent={renderPaneContent}
        onRequestConversation={handleRequestConversation}
      />
    </div>
  );
}
