import { memo, useCallback, useMemo, useEffect } from 'react';
import { useLayout } from '../../contexts/LayoutContext';
import { usePaneState } from '../../contexts/PaneContext';
import { api } from '../../api';
import { buildHighlightsText, buildContextStackText } from '../../utils/tokenizer';
import ChatInterface from '../ChatInterface';
import CouncilDiscussionView from '../CouncilDiscussionView';
import SynthesizerInterface from '../SynthesizerInterface';
import VisualiserInterface from '../VisualiserInterface';
import PodcastInterface from '../PodcastInterface';
import CommitSidebar from '../CommitSidebar';
import ThreadContextSidebar from '../ThreadContextSidebar';
import CommentModal from '../CommentModal';
import CommentButton from '../CommentButton';
import CommandPalette from '../CommandPalette';
import { SelectionHandler } from '../../utils/SelectionHandler';
import './PaneContent.css';

/**
 * Renders the content for a single pane based on conversation mode
 * Each pane independently renders its own conversation with scoped state
 */
function PaneContent({
  paneId,
  conversations,
  availableConfig,
  onConversationsListUpdate,
  onSelectConversation,
  onAnimateTitleId,
  onOpenSettings,
  onNavigateToPodcast,
  onNavigateToVisualiser,
  onNavigateToGraphEntity,
  onNavigateToGraphSearch,
  visualiserSourceConvId,
  onClearVisualiserSource,
  podcastSourceConvId,
}) {
  const { focusedPaneId } = useLayout();
  const isFocused = focusedPaneId === paneId;

  const {
    conversationId,
    conversation,
    conversationWithThreads,
    isLoading,
    setLoading,
    updateConversation,

    // Review sessions
    reviewSessions,
    activeReviewSessionId,

    // Comments
    comments,
    contextSegments,
    autoContextSegments,
    activeCommentId,
    currentSelection,
    commentButtonPosition,
    showCommentModal,

    // Sidebar
    showCommitSidebar,
    setShowCommitSidebar,
    toggleCommitSidebar,

    // Threads
    sessionThreads,
    activeThreadContext,
    setActiveThreadContext,

    // Computed
    totalContextItems,
    hasContextItems,

    // Actions
    setActiveComment,
    handleSelectionChange,

    // Review session actions
    createReviewSession,
    switchReviewSession,
    renameReviewSession,
    deleteReviewSession,

    // Comment actions
    saveComment,
    saveCommentDirect,
    editComment,
    deleteComment,

    // Context segment actions
    addContextSegment,
    removeContextSegment,

    // Other
    selectComment,
    selectThread,
    getAvailableModels,
    getDefaultChairman,

    // Command palette
    showCommandPalette,
    openCommandPalette,
    closeCommandPalette,
  } = usePaneState();

  // Handle conversation update
  const handleConversationUpdate = useCallback((updatedConvOrFn, newTitle) => {
    if (typeof updatedConvOrFn === 'function') {
      updateConversation(updatedConvOrFn(conversation));
    } else {
      updateConversation(updatedConvOrFn);
    }

    if (newTitle && onAnimateTitleId) {
      onAnimateTitleId(conversation?.id);
    }

    // Update conversations list
    if (onConversationsListUpdate && (typeof updatedConvOrFn !== 'function')) {
      const updatedConv = updatedConvOrFn;
      onConversationsListUpdate((prev) => {
        const exists = prev.some((c) => c.id === updatedConv.id);
        const updatedMeta = {
          id: updatedConv.id,
          created_at: updatedConv.created_at,
          title: newTitle || updatedConv.title || 'Untitled',
          source_type: updatedConv.synthesizer_config?.source_type,
          total_cost: updatedConv.total_cost,
          is_deliberation: updatedConv.messages?.some(m => m.mode === 'deliberation') || false,
          is_knowledge_graph: updatedConv.messages?.some(m => m.mode === 'knowledge_graph') || false,
          message_count: updatedConv.messages?.length || 0,
          mode: updatedConv.mode,
        };
        if (exists) {
          return prev.map((c) => c.id === updatedConv.id ? { ...c, ...updatedMeta } : c);
        } else {
          return [updatedMeta, ...prev];
        }
      });
    }
  }, [conversation, updateConversation, onAnimateTitleId, onConversationsListUpdate]);

  // Send message handler for council mode
  const handleSendMessage = useCallback(async (content) => {
    if (!conversationId) return;

    setLoading(true);
    try {
      // Optimistically add user message
      const userMessage = { role: 'user', content };
      updateConversation((prev) => ({
        ...prev,
        messages: [...prev.messages, userMessage],
      }));

      // Add partial assistant message
      const assistantMessage = {
        role: 'assistant',
        stage1: null,
        stage2: null,
        stage3: null,
        metadata: null,
        loading: { stage1: false, stage2: false, stage3: false },
      };
      updateConversation((prev) => ({
        ...prev,
        messages: [...prev.messages, assistantMessage],
      }));

      // Stream the response
      await api.sendMessageStream(conversationId, content, (eventType, event) => {
        switch (eventType) {
          case 'stage1_start':
            updateConversation((prev) => {
              if (!prev?.messages?.length) return prev;
              const messages = [...prev.messages];
              const lastMsg = messages[messages.length - 1];
              if (lastMsg?.loading) lastMsg.loading.stage1 = true;
              return { ...prev, messages };
            });
            break;

          case 'stage1_complete':
            updateConversation((prev) => {
              if (!prev?.messages?.length) return prev;
              const messages = [...prev.messages];
              const lastMsg = messages[messages.length - 1];
              if (lastMsg) {
                lastMsg.stage1 = event.data;
                if (lastMsg.loading) lastMsg.loading.stage1 = false;
              }
              return { ...prev, messages };
            });
            break;

          case 'stage2_start':
            updateConversation((prev) => {
              if (!prev?.messages?.length) return prev;
              const messages = [...prev.messages];
              const lastMsg = messages[messages.length - 1];
              if (lastMsg?.loading) lastMsg.loading.stage2 = true;
              return { ...prev, messages };
            });
            break;

          case 'stage2_complete':
            updateConversation((prev) => {
              if (!prev?.messages?.length) return prev;
              const messages = [...prev.messages];
              const lastMsg = messages[messages.length - 1];
              if (lastMsg) {
                lastMsg.stage2 = event.data;
                lastMsg.metadata = event.metadata;
                if (lastMsg.loading) lastMsg.loading.stage2 = false;
              }
              return { ...prev, messages };
            });
            break;

          case 'stage3_start':
            updateConversation((prev) => {
              if (!prev?.messages?.length) return prev;
              const messages = [...prev.messages];
              const lastMsg = messages[messages.length - 1];
              if (lastMsg?.loading) lastMsg.loading.stage3 = true;
              return { ...prev, messages };
            });
            break;

          case 'stage3_complete':
            updateConversation((prev) => {
              if (!prev?.messages?.length) return prev;
              const messages = [...prev.messages];
              const lastMsg = messages[messages.length - 1];
              if (lastMsg) {
                lastMsg.stage3 = event.data;
                if (lastMsg.loading) lastMsg.loading.stage3 = false;
              }
              return { ...prev, messages };
            });
            break;

          case 'title_complete':
            if (onConversationsListUpdate) {
              onConversationsListUpdate(prev => prev.map(conv =>
                conv.id === conversationId
                  ? { ...conv, title: event.data.title }
                  : conv
              ));
            }
            if (onAnimateTitleId) onAnimateTitleId(conversationId);
            break;

          case 'cost_complete':
            if (onConversationsListUpdate) {
              onConversationsListUpdate(prev => prev.map(conv =>
                conv.id === conversationId
                  ? { ...conv, total_cost: (conv.total_cost || 0) + event.data.cost }
                  : conv
              ));
            }
            break;

          case 'summary_complete':
            if (onConversationsListUpdate) {
              onConversationsListUpdate(prev => prev.map(conv =>
                conv.id === conversationId
                  ? { ...conv, summary: event.data.summary }
                  : conv
              ));
            }
            break;

          case 'complete':
            setLoading(false);
            break;

          case 'error':
            console.error('Stream error:', event.message);
            setLoading(false);
            break;
        }
      });
    } catch (error) {
      console.error('Failed to send message:', error);
      updateConversation((prev) => ({
        ...prev,
        messages: prev.messages.slice(0, -2),
      }));
      setLoading(false);
    }
  }, [conversationId, setLoading, updateConversation, onConversationsListUpdate, onAnimateTitleId]);

  // Thread handlers
  const handleCommitAndStartThread = useCallback(async (model, question) => {
    if (!conversationId || (comments.length === 0 && contextSegments.length === 0 && autoContextSegments.length === 0)) return;

    setLoading(true);
    try {
      const commentIds = comments.map((c) => c.id);
      const isSynthesizerMode = conversation?.mode === 'synthesizer';

      const manualSegmentKeys = new Set(
        contextSegments.map((segment) =>
          segment.sourceType === 'synthesizer'
            ? `synth-${segment.noteId}`
            : `${segment.messageIndex}-${segment.stage}-${segment.model}`
        )
      );

      const combinedSegments = [
        ...contextSegments,
        ...autoContextSegments.filter((segment) => {
          const key = segment.sourceType === 'synthesizer'
            ? `synth-${segment.noteId}`
            : `${segment.messageIndex}-${segment.stage}-${segment.model}`;
          return !manualSegmentKeys.has(key);
        }),
      ];

      const contextSegmentPayload = combinedSegments
        .filter((segment) => segment.content)
        .map((segment) => ({
          id: segment.id,
          label: segment.label,
          content: segment.content,
          source_type: segment.sourceType || 'council',
          stage: segment.stage || null,
          model: segment.model || null,
          message_index: segment.messageIndex || null,
          note_id: segment.noteId || null,
          note_title: segment.noteTitle || null,
        }));

      const compiledContext = [
        buildHighlightsText(comments),
        buildContextStackText(combinedSegments),
      ]
        .filter(Boolean)
        .join('\n\n')
        .trim();

      let messageIndex = null;
      let noteIds = null;

      if (isSynthesizerMode) {
        const noteIdSet = new Set();
        comments.forEach((c) => c.note_id && noteIdSet.add(c.note_id));
        combinedSegments.forEach((s) => s.noteId && noteIdSet.add(s.noteId));
        noteIds = Array.from(noteIdSet);
      } else {
        messageIndex =
          comments[0]?.message_index ??
          contextSegments[0]?.messageIndex ??
          autoContextSegments[0]?.messageIndex;

        if (messageIndex === undefined) {
          throw new Error('Unable to determine which response these context items belong to.');
        }
      }

      // Optimistically add messages
      const followUpUserMessage = {
        role: 'follow-up-user',
        content: question,
        comments: [...comments],
        context_segments: contextSegmentPayload,
        model: model,
      };
      updateConversation((prev) => ({
        ...prev,
        messages: [...prev.messages, followUpUserMessage],
      }));

      const followUpAssistantMessage = {
        role: 'follow-up-assistant',
        content: null,
        model: model,
        loading: true,
      };
      updateConversation((prev) => ({
        ...prev,
        messages: [...prev.messages, followUpAssistantMessage],
      }));

      const thread = await api.createSessionThread(
        conversationId,
        activeReviewSessionId,
        model,
        commentIds,
        question,
        {
          messageIndex,
          noteIds,
          contextSegments: contextSegmentPayload,
          compiledContext: compiledContext || null,
        }
      );

      updateConversation((prev) => {
        const messages = [...prev.messages];
        const userMsgIdx = messages.length - 2;
        if (messages[userMsgIdx]?.role === 'follow-up-user') {
          messages[userMsgIdx].thread_id = thread.id;
        }
        const lastMsg = messages[messages.length - 1];
        if (lastMsg.role === 'follow-up-assistant') {
          lastMsg.content = thread.messages[1]?.content || 'No response received';
          lastMsg.loading = false;
          lastMsg.thread_id = thread.id;
        }
        return { ...prev, messages };
      });

      setShowCommitSidebar(false);
      setActiveComment(null);
      setLoading(false);
    } catch (error) {
      console.error('Failed to start thread:', error);
      updateConversation((prev) => ({
        ...prev,
        messages: prev.messages.filter(m => m.role !== 'follow-up-user' && m.role !== 'follow-up-assistant'),
      }));
      setLoading(false);
    }
  }, [
    conversationId, conversation, comments, contextSegments, autoContextSegments,
    activeReviewSessionId, setLoading, updateConversation, setShowCommitSidebar, setActiveComment
  ]);

  const handleContinueThread = useCallback(async (threadId, question) => {
    if (!conversationId || !threadId || !question.trim()) return;

    setLoading(true);
    try {
      const existingMessages = conversation?.messages || [];
      const threadMessage = existingMessages.find(
        (m) => m.thread_id === threadId && m.role === 'follow-up-assistant'
      );
      const model = threadMessage?.model || 'unknown';

      const followUpUserMessage = {
        role: 'follow-up-user',
        content: question,
        thread_id: threadId,
        model: model,
      };
      updateConversation((prev) => ({
        ...prev,
        messages: [...prev.messages, followUpUserMessage],
      }));

      const followUpAssistantMessage = {
        role: 'follow-up-assistant',
        content: null,
        model: model,
        thread_id: threadId,
        loading: true,
      };
      updateConversation((prev) => ({
        ...prev,
        messages: [...prev.messages, followUpAssistantMessage],
      }));

      const updatedThread = await api.continueThread(conversationId, threadId, question);

      updateConversation((prev) => {
        const messages = [...prev.messages];
        const lastMsg = messages[messages.length - 1];
        if (lastMsg.role === 'follow-up-assistant' && lastMsg.thread_id === threadId) {
          const assistantMessages = updatedThread.messages.filter((m) => m.role === 'assistant');
          const lastAssistantMsg = assistantMessages[assistantMessages.length - 1];
          lastMsg.content = lastAssistantMsg?.content || 'No response received';
          lastMsg.loading = false;
        }
        return { ...prev, messages };
      });

      setLoading(false);
    } catch (error) {
      console.error('Failed to continue thread:', error);
      updateConversation((prev) => ({
        ...prev,
        messages: prev.messages.filter(
          (m) => !(m.thread_id === threadId && m.loading)
        ),
      }));
      setLoading(false);
    }
  }, [conversationId, conversation, setLoading, updateConversation]);

  // Visualise from context
  const handleVisualiseFromContext = useCallback(async (style) => {
    if (!conversationId || (comments.length === 0 && contextSegments.length === 0 && autoContextSegments.length === 0)) return;

    setLoading(true);
    try {
      const combinedSegments = [...contextSegments, ...autoContextSegments];
      const result = await api.visualiseFromContext(conversationId, comments, combinedSegments, style);

      const newConv = {
        id: result.conversation_id,
        created_at: new Date().toISOString(),
        message_count: 1,
        title: result.conversation_title || 'Visualisation',
        mode: 'visualiser',
      };

      if (onConversationsListUpdate) {
        onConversationsListUpdate((prev) => [newConv, ...prev]);
      }

      setShowCommitSidebar(false);
      setActiveComment(null);

      if (onSelectConversation) {
        onSelectConversation(result.conversation_id);
      }
    } catch (error) {
      console.error('Failed to create visualisation:', error);
    } finally {
      setLoading(false);
    }
  }, [conversationId, comments, contextSegments, autoContextSegments, setLoading, setShowCommitSidebar, setActiveComment, onConversationsListUpdate, onSelectConversation]);

  // Comment button click
  const handleCommentButtonClick = useCallback(() => {
    // For now, just show the modal - the modal is handled at App level
    // This will be wired up properly when we update the modal handling
  }, []);

  // Build command palette actions based on current mode
  const commandPaletteActions = useMemo(() => {
    const actions = [];

    // Always available actions
    actions.push({
      id: 'settings',
      label: 'Open Settings',
      shortcut: 'Cmd+,',
      onSelect: () => onOpenSettings?.(),
    });

    actions.push({
      id: 'new-conv',
      label: 'New Conversation',
      shortcut: 'Cmd+N',
      onSelect: () => onSelectConversation?.(null),
    });

    // Mode-specific actions
    if (conversation?.mode === 'synthesizer') {
      // Generate Podcast - always available in synthesizer mode
      actions.push({
        id: 'generate-podcast',
        label: 'Generate Podcast',
        onSelect: () => window.dispatchEvent(new CustomEvent('commandPalette:action', { detail: { action: 'generatePodcast' } })),
      });

      // Create Diagram - always available in synthesizer mode
      actions.push({
        id: 'create-diagram',
        label: 'Create Diagram',
        onSelect: () => window.dispatchEvent(new CustomEvent('commandPalette:action', { detail: { action: 'createDiagram' } })),
      });

      // Linked Diagrams (flattened into individual items)
      const linkedVis = conversation?.linked_visualisations || [];
      if (linkedVis.length > 0) {
        linkedVis.forEach(vis => {
          actions.push({
            id: `linked-vis-${vis.id}`,
            label: `View: ${vis.title || 'Untitled Diagram'}`,
            badge: 'Diagram',
            onSelect: () => onSelectConversation?.(vis.id),
          });
        });
      }

      actions.push({
        id: 'browse-related',
        label: 'Browse Related Notes',
        shortcut: 'B',
        onSelect: () => window.dispatchEvent(new CustomEvent('commandPalette:action', { detail: { action: 'browseRelated' } })),
      });

      actions.push({
        id: 'copy-note',
        label: 'Copy Current Note',
        shortcut: 'C',
        onSelect: () => window.dispatchEvent(new CustomEvent('commandPalette:action', { detail: { action: 'copyNote' } })),
      });

      actions.push({
        id: 'copy-all',
        label: 'Copy All Notes',
        shortcut: 'Shift+C',
        onSelect: () => window.dispatchEvent(new CustomEvent('commandPalette:action', { detail: { action: 'copyAllNotes' } })),
      });

      // Edit Source Info - always available (opens modal to edit)
      actions.push({
        id: 'edit-source',
        label: 'Edit Source Info',
        onSelect: () => window.dispatchEvent(new CustomEvent('commandPalette:action', { detail: { action: 'editSourceInfo' } })),
      });

      // Copy Source Content (only if source content exists)
      if (conversation?.synthesizer_config?.source_content) {
        actions.push({
          id: 'copy-source',
          label: 'Copy Source Content',
          onSelect: () => window.dispatchEvent(new CustomEvent('commandPalette:action', { detail: { action: 'copySource' } })),
        });
      }

      // Open Source URL (only if URL exists)
      if (conversation?.synthesizer_config?.source_url) {
        actions.push({
          id: 'open-source-url',
          label: 'Open Source URL',
          onSelect: () => window.open(conversation.synthesizer_config.source_url, '_blank'),
        });
      }
    }

    return actions;
  }, [conversation, onOpenSettings, onSelectConversation]);

  // Listen for Cmd+Shift+P in focused pane
  useEffect(() => {
    if (!isFocused) return;

    const handleKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'P' || e.key === 'p')) {
        e.preventDefault();
        e.stopPropagation();
        if (conversationId) {
          openCommandPalette();
        }
      }
    };

    // Use capture to ensure we intercept before App.jsx handler
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isFocused, conversationId, openCommandPalette]);

  // No conversation loaded - show ChatInterface home screen
  if (!conversation) {
    return (
      <div className="pane-content-wrapper">
        <ChatInterface conversation={null} onOpenSettings={onOpenSettings} />
      </div>
    );
  }

  const mode = conversation.mode;

  // Render mode-specific interface
  const renderInterface = () => {
    if (mode === 'discovery' || mode === 'synthesizer') {
      return (
        <SynthesizerInterface
          conversation={conversation}
          onConversationUpdate={handleConversationUpdate}
          comments={comments}
          onSelectionChange={handleSelectionChange}
          onSaveComment={saveCommentDirect}
          onEditComment={editComment}
          onDeleteComment={deleteComment}
          activeCommentId={activeCommentId}
          onSetActiveComment={setActiveComment}
          reviewSessionCount={reviewSessions.length}
          onToggleReviewSidebar={toggleCommitSidebar}
          onNavigateToGraphEntity={onNavigateToGraphEntity}
          onNavigateToGraphSearch={onNavigateToGraphSearch}
          paneId={paneId}
          {...(mode === 'synthesizer' && {
            onNavigateToPodcast: () => onNavigateToPodcast?.(conversationId),
            onNavigateToVisualiser: () => onNavigateToVisualiser?.(conversationId),
            linkedVisualisations: conversation.linked_visualisations || [],
            onSelectConversation,
          })}
        />
      );
    }

    if (mode === 'visualiser') {
      return (
        <VisualiserInterface
          conversation={conversation}
          conversations={conversations}
          preSelectedConversationId={visualiserSourceConvId}
          onClearPreSelection={onClearVisualiserSource}
          onSelectConversation={onSelectConversation}
          onConversationUpdate={handleConversationUpdate}
          isPaneFocused={isFocused}
        />
      );
    }

    if (mode === 'podcast') {
      return (
        <PodcastInterface
          onOpenSettings={onOpenSettings}
          onSelectConversation={onSelectConversation}
          conversations={conversations}
          preSelectedConversationId={podcastSourceConvId}
          isPaneFocused={isFocused}
        />
      );
    }

    if (mode === 'council') {
      if (conversationWithThreads?.messages?.length === 0) {
        return (
          <ChatInterface
            conversation={conversationWithThreads}
            onSendMessage={handleSendMessage}
            isLoading={isLoading}
            comments={comments}
            contextSegments={contextSegments}
            onSelectionChange={handleSelectionChange}
            onEditComment={editComment}
            onDeleteComment={deleteComment}
            activeCommentId={activeCommentId}
            onSetActiveComment={setActiveComment}
            onAddContextSegment={addContextSegment}
            onRemoveContextSegment={removeContextSegment}
            onContinueThread={handleContinueThread}
            onSelectThread={selectThread}
            onOpenSettings={onOpenSettings}
            isPaneFocused={isFocused}
          />
        );
      }

      return (
        <CouncilDiscussionView
          conversation={conversationWithThreads}
          comments={comments}
          contextSegments={contextSegments}
          onSelectionChange={handleSelectionChange}
          onEditComment={editComment}
          onDeleteComment={deleteComment}
          activeCommentId={activeCommentId}
          onSetActiveComment={setActiveComment}
          onAddContextSegment={addContextSegment}
          onRemoveContextSegment={removeContextSegment}
          onOpenSettings={onOpenSettings}
          onContinueThread={handleContinueThread}
          onSelectThread={selectThread}
          isLoading={isLoading}
          reviewSessionCount={reviewSessions.length}
          onToggleReviewSidebar={toggleCommitSidebar}
          isPaneFocused={isFocused}
        />
      );
    }

    // Fallback for unknown modes
    return (
      <ChatInterface
        conversation={conversationWithThreads}
        onSendMessage={handleSendMessage}
        isLoading={isLoading}
        comments={comments}
        contextSegments={contextSegments}
        onSelectionChange={handleSelectionChange}
        onEditComment={editComment}
        onDeleteComment={deleteComment}
        activeCommentId={activeCommentId}
        onSetActiveComment={setActiveComment}
        onAddContextSegment={addContextSegment}
        onRemoveContextSegment={removeContextSegment}
        onContinueThread={handleContinueThread}
        onSelectThread={selectThread}
        onOpenSettings={onOpenSettings}
        isPaneFocused={isFocused}
      />
    );
  };

  return (
    <div className="pane-content-wrapper">
      <div className={`pane-main-content ${showCommitSidebar && isFocused ? 'with-sidebar' : ''}`}>
        {renderInterface()}
      </div>

      {/* Per-pane CommitSidebar - only shown for focused pane */}
      {isFocused && showCommitSidebar && (
        <CommitSidebar
          comments={comments}
          contextSegments={contextSegments}
          autoContextSegments={autoContextSegments}
          availableModels={getAvailableModels()}
          defaultChairman={getDefaultChairman()}
          onCommit={handleCommitAndStartThread}
          onClose={() => setShowCommitSidebar(false)}
          onSelectComment={selectComment}
          onEditComment={editComment}
          onDeleteComment={deleteComment}
          activeCommentId={activeCommentId}
          onRemoveContextSegment={removeContextSegment}
          onVisualise={handleVisualiseFromContext}
          reviewSessions={reviewSessions}
          activeSessionId={activeReviewSessionId}
          sessionThreads={sessionThreads}
          onCreateSession={createReviewSession}
          onSwitchSession={switchReviewSession}
          onRenameSession={renameReviewSession}
          onDeleteSession={deleteReviewSession}
        />
      )}

      {/* Thread context sidebar */}
      {isFocused && activeThreadContext && (
        <ThreadContextSidebar
          context={activeThreadContext}
          allComments={comments}
          onClose={() => setActiveThreadContext(null)}
          onCommentClick={selectComment}
        />
      )}

      {/* FAB for context items */}
      {isFocused && !showCommitSidebar && hasContextItems && (
        <button
          className={`commit-button-fab ${hasContextItems ? 'has-comments' : ''}`}
          onClick={toggleCommitSidebar}
          title="Open review context sidebar"
        >
          {`Review (${totalContextItems})`}
        </button>
      )}

      {/* Pane-scoped Command Palette */}
      {isFocused && showCommandPalette && (
        <CommandPalette
          isOpen={showCommandPalette}
          onClose={closeCommandPalette}
          mode={conversation?.mode}
          actions={commandPaletteActions}
        />
      )}
    </div>
  );
}

export default memo(PaneContent);
