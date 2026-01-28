import { createContext, useContext, useReducer, useCallback, useMemo, useEffect } from 'react';
import { api } from '../api';
import { SelectionHandler } from '../utils/SelectionHandler';
import { buildHighlightsText, buildContextStackText } from '../utils/tokenizer';

const PaneContext = createContext(null);

// Initial state for a pane
const createInitialPaneState = () => ({
  conversationId: null,
  conversation: null,
  isLoading: false,

  // Review sessions state
  reviewSessions: [],
  activeReviewSessionId: null,

  // Comment state
  activeCommentId: null,
  currentSelection: null,
  commentButtonPosition: null,
  showCommentModal: false,

  // Sidebar state
  showCommitSidebar: false,

  // Thread state
  activeThreadContext: null,

  // Command palette state
  showCommandPalette: false,
});

// Reducer for pane state
function paneReducer(state, action) {
  switch (action.type) {
    case 'SET_CONVERSATION_ID':
      return { ...state, conversationId: action.payload };

    case 'SET_CONVERSATION':
      return { ...state, conversation: action.payload };

    case 'SET_LOADING':
      return { ...state, isLoading: action.payload };

    case 'SET_REVIEW_SESSIONS':
      return { ...state, reviewSessions: action.payload };

    case 'SET_ACTIVE_REVIEW_SESSION':
      return { ...state, activeReviewSessionId: action.payload };

    case 'ADD_REVIEW_SESSION':
      return {
        ...state,
        reviewSessions: [...state.reviewSessions, action.payload],
        activeReviewSessionId: action.payload.id,
      };

    case 'UPDATE_REVIEW_SESSION':
      return {
        ...state,
        reviewSessions: state.reviewSessions.map(s =>
          s.id === action.payload.id ? action.payload : s
        ),
      };

    case 'DELETE_REVIEW_SESSION': {
      const remaining = state.reviewSessions.filter(s => s.id !== action.payload);
      let newActiveId = state.activeReviewSessionId;
      if (state.activeReviewSessionId === action.payload) {
        const sorted = [...remaining].sort((a, b) =>
          (b.updated_at || b.created_at).localeCompare(a.updated_at || a.created_at)
        );
        newActiveId = sorted[0]?.id || null;
      }
      return {
        ...state,
        reviewSessions: remaining,
        activeReviewSessionId: newActiveId,
      };
    }

    case 'SET_ACTIVE_COMMENT':
      return { ...state, activeCommentId: action.payload };

    case 'SET_CURRENT_SELECTION':
      return { ...state, currentSelection: action.payload };

    case 'SET_COMMENT_BUTTON_POSITION':
      return { ...state, commentButtonPosition: action.payload };

    case 'SET_SHOW_COMMENT_MODAL':
      return { ...state, showCommentModal: action.payload };

    case 'SET_SHOW_COMMIT_SIDEBAR':
      return { ...state, showCommitSidebar: action.payload };

    case 'SET_ACTIVE_THREAD_CONTEXT':
      return { ...state, activeThreadContext: action.payload };

    case 'UPDATE_CONVERSATION':
      return { ...state, conversation: action.payload };

    case 'SET_SHOW_COMMAND_PALETTE':
      return { ...state, showCommandPalette: action.payload };

    case 'RESET':
      return createInitialPaneState();

    default:
      return state;
  }
}

export function PaneProvider({
  paneId,
  conversationId: initialConversationId,
  onConversationChange,
  onConversationsListUpdate,
  availableConfig,
  children
}) {
  const [state, dispatch] = useReducer(paneReducer, null, createInitialPaneState);

  // Sync conversationId from parent
  useEffect(() => {
    if (initialConversationId !== state.conversationId) {
      dispatch({ type: 'SET_CONVERSATION_ID', payload: initialConversationId });
    }
  }, [initialConversationId, state.conversationId]);

  // Load conversation when conversationId changes
  useEffect(() => {
    if (state.conversationId) {
      loadConversation(state.conversationId);
      loadReviewSessions(state.conversationId);
    } else {
      dispatch({ type: 'SET_CONVERSATION', payload: null });
      dispatch({ type: 'SET_REVIEW_SESSIONS', payload: [] });
      dispatch({ type: 'SET_ACTIVE_REVIEW_SESSION', payload: null });
      dispatch({ type: 'SET_ACTIVE_COMMENT', payload: null });
    }
  }, [state.conversationId]);

  // Load conversation data
  const loadConversation = async (id) => {
    try {
      const conv = await api.getConversation(id);
      dispatch({ type: 'SET_CONVERSATION', payload: conv });
    } catch (error) {
      console.error('Failed to load conversation:', error);
    }
  };

  // Load review sessions
  const loadReviewSessions = async (conversationId) => {
    try {
      const result = await api.listReviewSessions(conversationId);
      dispatch({ type: 'SET_REVIEW_SESSIONS', payload: result.sessions || [] });
      dispatch({ type: 'SET_ACTIVE_REVIEW_SESSION', payload: result.active_session_id || null });
    } catch (error) {
      console.error('Failed to load review sessions:', error);
      dispatch({ type: 'SET_REVIEW_SESSIONS', payload: [] });
      dispatch({ type: 'SET_ACTIVE_REVIEW_SESSION', payload: null });
    }
  };

  // Derived state: active session
  const activeSession = useMemo(() =>
    state.reviewSessions.find(s => s.id === state.activeReviewSessionId),
    [state.reviewSessions, state.activeReviewSessionId]
  );

  const comments = activeSession?.comments || [];
  const contextSegments = activeSession?.context_segments || [];
  const sessionThreads = activeSession?.threads || [];

  // Helper to get model short name
  const getModelShortName = useCallback((model) => {
    return model?.split('/')[1] || model;
  }, []);

  // Auto-generated context segments from comments
  const autoContextSegments = useMemo(() => {
    if (!comments || comments.length === 0) return [];

    const seenKeys = new Set();
    const segments = [];

    comments.forEach((comment) => {
      if (!comment?.source_content) return;

      const sourceType = comment.source_type || (comment.note_id ? 'synthesizer' : 'council');
      const key = sourceType === 'council'
        ? `council-${comment.message_index}-${comment.stage}-${comment.model}`
        : `synth-${comment.note_id}`;

      const manualExists = contextSegments.some((seg) => {
        if (sourceType === 'council') {
          return seg.messageIndex === comment.message_index &&
                 seg.stage === comment.stage &&
                 seg.model === comment.model;
        }
        return seg.noteId === comment.note_id;
      });

      if (manualExists || seenKeys.has(key)) return;
      seenKeys.add(key);

      if (sourceType === 'council') {
        segments.push({
          id: `auto-${key}`,
          sourceType: 'council',
          stage: comment.stage,
          model: comment.model,
          messageIndex: comment.message_index,
          label: `Stage ${comment.stage} - ${getModelShortName(comment.model)}`,
          content: comment.source_content,
          autoGenerated: true,
        });
      } else {
        segments.push({
          id: `auto-${key}`,
          sourceType: 'synthesizer',
          noteId: comment.note_id,
          noteTitle: comment.note_title,
          sourceUrl: comment.source_url,
          noteModel: comment.note_model,
          label: comment.note_title || 'Note',
          content: comment.source_content,
          autoGenerated: true,
        });
      }
    });

    return segments;
  }, [comments, contextSegments, getModelShortName]);

  // Conversation with threads merged
  const conversationWithThreads = useMemo(() => {
    if (!state.conversation) return null;
    if (!sessionThreads || sessionThreads.length === 0) return state.conversation;

    const threadMessages = [];
    sessionThreads.forEach(thread => {
      thread.messages.forEach(msg => {
        if (msg.role === 'user') {
          threadMessages.push({
            role: 'follow-up-user',
            content: msg.content,
            model: thread.model,
            thread_id: thread.id,
            comments: [],
            context_segments: thread.context?.context_segments || [],
          });
        } else if (msg.role === 'assistant') {
          threadMessages.push({
            role: 'follow-up-assistant',
            content: msg.content,
            model: thread.model,
            thread_id: thread.id,
            loading: false,
          });
        }
      });
    });

    return {
      ...state.conversation,
      messages: [...state.conversation.messages, ...threadMessages],
    };
  }, [state.conversation, sessionThreads]);

  // Actions
  const setConversationId = useCallback((id) => {
    dispatch({ type: 'SET_CONVERSATION_ID', payload: id });
    if (onConversationChange) {
      onConversationChange(paneId, id);
    }
  }, [paneId, onConversationChange]);

  const setLoading = useCallback((loading) => {
    dispatch({ type: 'SET_LOADING', payload: loading });
  }, []);

  const setActiveComment = useCallback((commentId) => {
    dispatch({ type: 'SET_ACTIVE_COMMENT', payload: commentId });
  }, []);

  const setShowCommitSidebar = useCallback((show) => {
    dispatch({ type: 'SET_SHOW_COMMIT_SIDEBAR', payload: show });
  }, []);

  const toggleCommitSidebar = useCallback(() => {
    dispatch({ type: 'SET_SHOW_COMMIT_SIDEBAR', payload: !state.showCommitSidebar });
  }, [state.showCommitSidebar]);

  const setActiveThreadContext = useCallback((context) => {
    dispatch({ type: 'SET_ACTIVE_THREAD_CONTEXT', payload: context });
  }, []);

  // Command palette actions
  const setShowCommandPalette = useCallback((show) => {
    dispatch({ type: 'SET_SHOW_COMMAND_PALETTE', payload: show });
  }, []);

  const openCommandPalette = useCallback(() => {
    dispatch({ type: 'SET_SHOW_COMMAND_PALETTE', payload: true });
  }, []);

  const closeCommandPalette = useCallback(() => {
    dispatch({ type: 'SET_SHOW_COMMAND_PALETTE', payload: false });
  }, []);

  // Selection handlers
  const handleSelectionChange = useCallback((selection) => {
    if (selection) {
      dispatch({ type: 'SET_CURRENT_SELECTION', payload: selection });
      const rect = selection.range.getBoundingClientRect();
      dispatch({ type: 'SET_COMMENT_BUTTON_POSITION', payload: { x: rect.right + 10, y: rect.top } });
    } else {
      dispatch({ type: 'SET_CURRENT_SELECTION', payload: null });
      dispatch({ type: 'SET_COMMENT_BUTTON_POSITION', payload: null });
    }
  }, []);

  // Review session handlers
  const createReviewSession = useCallback(async (name = null) => {
    if (!state.conversationId) return;
    try {
      const session = await api.createReviewSession(state.conversationId, name);
      dispatch({ type: 'ADD_REVIEW_SESSION', payload: session });
      return session;
    } catch (error) {
      console.error('Failed to create review session:', error);
    }
  }, [state.conversationId]);

  const switchReviewSession = useCallback(async (sessionId) => {
    if (!state.conversationId || sessionId === state.activeReviewSessionId) return;
    try {
      await api.activateReviewSession(state.conversationId, sessionId);
      dispatch({ type: 'SET_ACTIVE_REVIEW_SESSION', payload: sessionId });
      dispatch({ type: 'SET_ACTIVE_COMMENT', payload: null });
    } catch (error) {
      console.error('Failed to switch review session:', error);
    }
  }, [state.conversationId, state.activeReviewSessionId]);

  const renameReviewSession = useCallback(async (sessionId, newName) => {
    if (!state.conversationId) return;
    try {
      const updated = await api.updateReviewSession(state.conversationId, sessionId, newName);
      dispatch({ type: 'UPDATE_REVIEW_SESSION', payload: updated });
    } catch (error) {
      console.error('Failed to rename review session:', error);
    }
  }, [state.conversationId]);

  const deleteReviewSession = useCallback(async (sessionId) => {
    if (!state.conversationId) return;
    try {
      await api.deleteReviewSession(state.conversationId, sessionId);
      dispatch({ type: 'DELETE_REVIEW_SESSION', payload: sessionId });
    } catch (error) {
      console.error('Failed to delete review session:', error);
    }
  }, [state.conversationId]);

  // Comment handlers
  const saveComment = useCallback(async (commentText) => {
    if (!state.currentSelection || !state.conversationId) return;

    try {
      let sessionId = state.activeReviewSessionId;
      if (!sessionId) {
        const session = await api.createReviewSession(state.conversationId);
        dispatch({ type: 'ADD_REVIEW_SESSION', payload: session });
        sessionId = session.id;
      }

      const isCouncil = state.currentSelection.sourceType === 'council' || !state.currentSelection.sourceType;

      const commentData = {
        selection: state.currentSelection.text,
        content: commentText,
        sourceType: state.currentSelection.sourceType || 'council',
        sourceContent: state.currentSelection.sourceContent,
      };

      if (isCouncil) {
        commentData.messageIndex = state.currentSelection.messageIndex;
        commentData.stage = state.currentSelection.stage;
        commentData.model = state.currentSelection.model;
      } else {
        commentData.noteId = state.currentSelection.noteId;
        commentData.noteTitle = state.currentSelection.noteTitle;
        commentData.sourceUrl = state.currentSelection.sourceUrl;
        commentData.noteModel = state.currentSelection.noteModel;
      }

      const newComment = await api.createSessionComment(state.conversationId, sessionId, commentData);

      // Update the session in state
      dispatch({
        type: 'UPDATE_REVIEW_SESSION',
        payload: {
          ...activeSession,
          id: sessionId,
          comments: [...(activeSession?.comments || []), newComment],
          updated_at: new Date().toISOString(),
        },
      });

      dispatch({ type: 'SET_SHOW_COMMENT_MODAL', payload: false });
      dispatch({ type: 'SET_CURRENT_SELECTION', payload: null });
      dispatch({ type: 'SET_COMMENT_BUTTON_POSITION', payload: null });
      SelectionHandler.clearSelection();

      // Auto-open sidebar when first comment
      if (comments.length === 0) {
        dispatch({ type: 'SET_SHOW_COMMIT_SIDEBAR', payload: true });
      }
    } catch (error) {
      console.error('Failed to save comment:', error);
    }
  }, [state.currentSelection, state.conversationId, state.activeReviewSessionId, activeSession, comments.length]);

  const saveCommentDirect = useCallback(async (selection, commentText) => {
    if (!selection || !state.conversationId) return;

    try {
      let sessionId = state.activeReviewSessionId;
      if (!sessionId) {
        const session = await api.createReviewSession(state.conversationId);
        dispatch({ type: 'ADD_REVIEW_SESSION', payload: session });
        sessionId = session.id;
      }

      const commentData = {
        selection: selection.text,
        content: commentText,
        sourceType: 'synthesizer',
        sourceContent: selection.sourceContent,
        noteId: selection.noteId,
        noteTitle: selection.noteTitle,
        sourceUrl: selection.sourceUrl,
        noteModel: selection.noteModel,
      };

      const newComment = await api.createSessionComment(state.conversationId, sessionId, commentData);

      dispatch({
        type: 'UPDATE_REVIEW_SESSION',
        payload: {
          ...activeSession,
          id: sessionId,
          comments: [...(activeSession?.comments || []), newComment],
          updated_at: new Date().toISOString(),
        },
      });

      if (comments.length === 0) {
        dispatch({ type: 'SET_SHOW_COMMIT_SIDEBAR', payload: true });
      }
    } catch (error) {
      console.error('Failed to save comment:', error);
    }
  }, [state.conversationId, state.activeReviewSessionId, activeSession, comments.length]);

  const editComment = useCallback(async (commentId, newContent) => {
    if (!state.conversationId || !state.activeReviewSessionId) return;

    try {
      const updatedComment = await api.updateSessionComment(
        state.conversationId,
        state.activeReviewSessionId,
        commentId,
        newContent
      );

      dispatch({
        type: 'UPDATE_REVIEW_SESSION',
        payload: {
          ...activeSession,
          comments: activeSession.comments.map(c => c.id === commentId ? updatedComment : c),
        },
      });
    } catch (error) {
      console.error('Failed to edit comment:', error);
    }
  }, [state.conversationId, state.activeReviewSessionId, activeSession]);

  const deleteComment = useCallback(async (commentId) => {
    if (!state.conversationId || !state.activeReviewSessionId) return;

    try {
      await api.deleteSessionComment(state.conversationId, state.activeReviewSessionId, commentId);

      dispatch({
        type: 'UPDATE_REVIEW_SESSION',
        payload: {
          ...activeSession,
          comments: activeSession.comments.filter(c => c.id !== commentId),
        },
      });

      if (state.activeCommentId === commentId) {
        dispatch({ type: 'SET_ACTIVE_COMMENT', payload: null });
      }

      SelectionHandler.removeHighlight(commentId);
    } catch (error) {
      console.error('Failed to delete comment:', error);
    }
  }, [state.conversationId, state.activeReviewSessionId, activeSession, state.activeCommentId]);

  // Context segment handlers
  const addContextSegment = useCallback(async (segment) => {
    if (!state.conversationId) return;

    try {
      let sessionId = state.activeReviewSessionId;
      if (!sessionId) {
        const session = await api.createReviewSession(state.conversationId);
        dispatch({ type: 'ADD_REVIEW_SESSION', payload: session });
        sessionId = session.id;
      }

      const existing = contextSegments.some(s => s.id === segment.id);
      if (existing) return;

      await api.addSessionContextSegment(state.conversationId, sessionId, segment);

      dispatch({
        type: 'UPDATE_REVIEW_SESSION',
        payload: {
          ...activeSession,
          id: sessionId,
          context_segments: [...(activeSession?.context_segments || []), segment],
          updated_at: new Date().toISOString(),
        },
      });

      if (contextSegments.length === 0 && !state.showCommitSidebar) {
        dispatch({ type: 'SET_SHOW_COMMIT_SIDEBAR', payload: true });
      }
    } catch (error) {
      console.error('Failed to add context segment:', error);
    }
  }, [state.conversationId, state.activeReviewSessionId, activeSession, contextSegments, state.showCommitSidebar]);

  const removeContextSegment = useCallback(async (segmentId) => {
    if (!state.conversationId || !state.activeReviewSessionId) return;

    try {
      await api.removeSessionContextSegment(state.conversationId, state.activeReviewSessionId, segmentId);

      dispatch({
        type: 'UPDATE_REVIEW_SESSION',
        payload: {
          ...activeSession,
          context_segments: (activeSession.context_segments || []).filter(seg => seg.id !== segmentId),
        },
      });
    } catch (error) {
      console.error('Failed to remove context segment:', error);
    }
  }, [state.conversationId, state.activeReviewSessionId, activeSession]);

  // Select comment handler
  const selectComment = useCallback((commentId) => {
    const comment = comments.find(c => c.id === commentId);
    if (!comment) return;

    dispatch({ type: 'SET_ACTIVE_COMMENT', payload: commentId });

    window.dispatchEvent(new CustomEvent('switchToComment', {
      detail: { stage: comment.stage, model: comment.model }
    }));

    setTimeout(() => {
      const highlight = document.querySelector(`[data-comment-id="${commentId}"]`);
      if (highlight) {
        highlight.scrollIntoView({ behavior: 'smooth', block: 'center' });
        highlight.classList.add('pulse');
        setTimeout(() => highlight.classList.remove('pulse'), 1000);
      }
    }, 100);
  }, [comments]);

  // Thread handlers
  const selectThread = useCallback((threadId, context) => {
    dispatch({ type: 'SET_ACTIVE_THREAD_CONTEXT', payload: { threadId, ...context } });
  }, []);

  // Get available models
  const getAvailableModels = useCallback(() => {
    if (state.conversation?.council_config) {
      return state.conversation.council_config.council_models;
    }
    return availableConfig?.council_models || [];
  }, [state.conversation, availableConfig]);

  const getDefaultChairman = useCallback(() => {
    if (state.conversation?.council_config) {
      return state.conversation.council_config.chairman_model;
    }
    return availableConfig?.chairman_model;
  }, [state.conversation, availableConfig]);

  // Update conversation state
  const updateConversation = useCallback((updatedConv) => {
    dispatch({ type: 'UPDATE_CONVERSATION', payload: updatedConv });
  }, []);

  // Computed values
  const totalContextItems = comments.length + contextSegments.length + autoContextSegments.length;
  const hasContextItems = totalContextItems > 0;

  const value = useMemo(() => ({
    // State
    paneId,
    conversationId: state.conversationId,
    conversation: state.conversation,
    conversationWithThreads,
    isLoading: state.isLoading,

    // Review sessions
    reviewSessions: state.reviewSessions,
    activeReviewSessionId: state.activeReviewSessionId,
    activeSession,

    // Comments
    comments,
    contextSegments,
    autoContextSegments,
    activeCommentId: state.activeCommentId,
    currentSelection: state.currentSelection,
    commentButtonPosition: state.commentButtonPosition,
    showCommentModal: state.showCommentModal,

    // Sidebar
    showCommitSidebar: state.showCommitSidebar,

    // Threads
    sessionThreads,
    activeThreadContext: state.activeThreadContext,

    // Command palette
    showCommandPalette: state.showCommandPalette,

    // Computed
    totalContextItems,
    hasContextItems,

    // Actions
    setConversationId,
    setLoading,
    setActiveComment,
    setShowCommitSidebar,
    toggleCommitSidebar,
    setActiveThreadContext,
    updateConversation,
    setShowCommandPalette,
    openCommandPalette,
    closeCommandPalette,

    // Selection
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

    // Reload functions
    loadConversation,
    loadReviewSessions,
  }), [
    paneId,
    state,
    conversationWithThreads,
    activeSession,
    comments,
    contextSegments,
    autoContextSegments,
    sessionThreads,
    totalContextItems,
    hasContextItems,
    setConversationId,
    setLoading,
    setActiveComment,
    setShowCommitSidebar,
    toggleCommitSidebar,
    setActiveThreadContext,
    updateConversation,
    setShowCommandPalette,
    openCommandPalette,
    closeCommandPalette,
    handleSelectionChange,
    createReviewSession,
    switchReviewSession,
    renameReviewSession,
    deleteReviewSession,
    saveComment,
    saveCommentDirect,
    editComment,
    deleteComment,
    addContextSegment,
    removeContextSegment,
    selectComment,
    selectThread,
    getAvailableModels,
    getDefaultChairman,
  ]);

  return (
    <PaneContext.Provider value={value}>
      {children}
    </PaneContext.Provider>
  );
}

export function usePaneState() {
  const context = useContext(PaneContext);
  if (!context) {
    throw new Error('usePaneState must be used within PaneProvider');
  }
  return context;
}

export default PaneContext;
