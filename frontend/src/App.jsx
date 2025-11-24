import { useState, useEffect, useCallback } from 'react';
import Sidebar from './components/Sidebar';
import ChatInterface from './components/ChatInterface';
import ConfigModal from './components/ConfigModal';
import PromptManager from './components/PromptManager';
import CommentModal from './components/CommentModal';
import CommitSidebar from './components/CommitSidebar';
import { api } from './api';
import { SelectionHandler } from './utils/SelectionHandler';
import './App.css';

function App() {
  const [conversations, setConversations] = useState([]);
  const [currentConversationId, setCurrentConversationId] = useState(null);
  const [currentConversation, setCurrentConversation] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [showPromptManager, setShowPromptManager] = useState(false);
  const [availableConfig, setAvailableConfig] = useState(null);
  const [pendingCouncilConfig, setPendingCouncilConfig] = useState(null);

  // Comment and thread state
  const [comments, setComments] = useState([]);
  const [currentSelection, setCurrentSelection] = useState(null);
  const [commentButtonPosition, setCommentButtonPosition] = useState(null);
  const [showCommentModal, setShowCommentModal] = useState(false);
  const [showCommitSidebar, setShowCommitSidebar] = useState(false);
  const [showContextPreview, setShowContextPreview] = useState(false);
  const [activeCommentId, setActiveCommentId] = useState(null);

  // Sidebar collapse states
  const [leftSidebarCollapsed, setLeftSidebarCollapsed] = useState(false);

  // Load conversations and config on mount
  useEffect(() => {
    loadConversations();
    loadConfig();
  }, []);

  const loadConfig = async () => {
    try {
      const config = await api.getConfig();
      setAvailableConfig(config);
    } catch (error) {
      console.error('Failed to load config:', error);
    }
  };

  // Load conversation details when selected
  useEffect(() => {
    if (currentConversationId) {
      loadConversation(currentConversationId);
      loadComments(currentConversationId);
    } else {
      setComments([]);
      setActiveCommentId(null);
    }
  }, [currentConversationId]);

  const loadConversations = async () => {
    try {
      const convs = await api.listConversations();
      setConversations(convs);
    } catch (error) {
      console.error('Failed to load conversations:', error);
    }
  };

  const loadConversation = async (id) => {
    try {
      const conv = await api.getConversation(id);
      setCurrentConversation(conv);
    } catch (error) {
      console.error('Failed to load conversation:', error);
    }
  };

  const handleNewConversation = () => {
    setShowConfigModal(true);
  };

  const handleConfigSubmit = async (config) => {
    // Store the config and proceed to prompt selection
    setPendingCouncilConfig(config);
    setShowConfigModal(false);
    setShowPromptManager(true);
  };

  const handlePromptSelect = async (systemPrompt) => {
    try {
      const newConv = await api.createConversation(pendingCouncilConfig, systemPrompt);
      setConversations([
        { id: newConv.id, created_at: newConv.created_at, message_count: 0, title: newConv.title },
        ...conversations,
      ]);
      setCurrentConversationId(newConv.id);
      setShowPromptManager(false);
      setPendingCouncilConfig(null);
    } catch (error) {
      console.error('Failed to create conversation:', error);
    }
  };

  const handleSelectConversation = (id) => {
    setCurrentConversationId(id);
    setActiveCommentId(null);
  };

  const handleSendMessage = async (content) => {
    if (!currentConversationId) return;

    setIsLoading(true);
    try {
      // Optimistically add user message to UI
      const userMessage = { role: 'user', content };
      setCurrentConversation((prev) => ({
        ...prev,
        messages: [...prev.messages, userMessage],
      }));

      // Create a partial assistant message that will be updated progressively
      const assistantMessage = {
        role: 'assistant',
        stage1: null,
        stage2: null,
        stage3: null,
        metadata: null,
        loading: {
          stage1: false,
          stage2: false,
          stage3: false,
        },
      };

      // Add the partial assistant message
      setCurrentConversation((prev) => ({
        ...prev,
        messages: [...prev.messages, assistantMessage],
      }));

      // Send message with streaming
      await api.sendMessageStream(currentConversationId, content, (eventType, event) => {
        switch (eventType) {
          case 'stage1_start':
            setCurrentConversation((prev) => {
              const messages = [...prev.messages];
              const lastMsg = messages[messages.length - 1];
              lastMsg.loading.stage1 = true;
              return { ...prev, messages };
            });
            break;

          case 'stage1_complete':
            setCurrentConversation((prev) => {
              const messages = [...prev.messages];
              const lastMsg = messages[messages.length - 1];
              lastMsg.stage1 = event.data;
              lastMsg.loading.stage1 = false;
              return { ...prev, messages };
            });
            break;

          case 'stage2_start':
            setCurrentConversation((prev) => {
              const messages = [...prev.messages];
              const lastMsg = messages[messages.length - 1];
              lastMsg.loading.stage2 = true;
              return { ...prev, messages };
            });
            break;

          case 'stage2_complete':
            setCurrentConversation((prev) => {
              const messages = [...prev.messages];
              const lastMsg = messages[messages.length - 1];
              lastMsg.stage2 = event.data;
              lastMsg.metadata = event.metadata;
              lastMsg.loading.stage2 = false;
              return { ...prev, messages };
            });
            break;

          case 'stage3_start':
            setCurrentConversation((prev) => {
              const messages = [...prev.messages];
              const lastMsg = messages[messages.length - 1];
              lastMsg.loading.stage3 = true;
              return { ...prev, messages };
            });
            break;

          case 'stage3_complete':
            setCurrentConversation((prev) => {
              const messages = [...prev.messages];
              const lastMsg = messages[messages.length - 1];
              lastMsg.stage3 = event.data;
              lastMsg.loading.stage3 = false;
              return { ...prev, messages };
            });
            break;

          case 'title_complete':
            // Reload conversations to get updated title
            loadConversations();
            break;

          case 'complete':
            // Stream complete, reload conversations list
            loadConversations();
            setIsLoading(false);
            break;

          case 'error':
            console.error('Stream error:', event.message);
            setIsLoading(false);
            break;

          default:
            console.log('Unknown event type:', eventType);
        }
      });
    } catch (error) {
      console.error('Failed to send message:', error);
      // Remove optimistic messages on error
      setCurrentConversation((prev) => ({
        ...prev,
        messages: prev.messages.slice(0, -2),
      }));
      setIsLoading(false);
    }
  };

  // Comment and thread handlers
  const loadComments = async (conversationId) => {
    try {
      const loadedComments = await api.getComments(conversationId);
      setComments(loadedComments);
    } catch (error) {
      console.error('Failed to load comments:', error);
    }
  };

  const handleSelectionChange = useCallback((selection) => {
    if (selection) {
      setCurrentSelection(selection);
      // Position the comment button near the selection
      const rect = selection.range.getBoundingClientRect();
      setCommentButtonPosition({
        x: rect.right + 10,
        y: rect.top,
      });
    } else {
      setCurrentSelection(null);
      setCommentButtonPosition(null);
    }
  }, []);

  const handleCommentButtonClick = () => {
    setShowCommentModal(true);
    setCommentButtonPosition(null);
    // Don't clear currentSelection here - the modal needs it
  };

  const handleSaveComment = async (commentText) => {
    if (!currentSelection || !currentConversationId) return;

    try {
      const newComment = await api.createComment(
        currentConversationId,
        currentSelection.messageIndex,
        currentSelection.stage,
        currentSelection.model,
        currentSelection.text,
        commentText,
        currentSelection.sourceContent
      );

      setComments([...comments, newComment]);
      setShowCommentModal(false);
      setCurrentSelection(null);
      setCommentButtonPosition(null);
      SelectionHandler.clearSelection();
      
      // Auto-open sidebar when first comment is added
      if (comments.length === 0) {
        setShowCommitSidebar(true);
      }
    } catch (error) {
      console.error('Failed to save comment:', error);
    }
  };

  const handleEditComment = async (commentId, newContent) => {
    if (!currentConversationId) return;

    try {
      const updatedComment = await api.updateComment(currentConversationId, commentId, newContent);
      setComments(comments.map(c => c.id === commentId ? updatedComment : c));
    } catch (error) {
      console.error('Failed to edit comment:', error);
    }
  };

  const handleDeleteComment = async (commentId) => {
    if (!currentConversationId) return;

    try {
      await api.deleteComment(currentConversationId, commentId);
      setComments(comments.filter((c) => c.id !== commentId));
      
      // Clear active comment if it was deleted
      if (activeCommentId === commentId) {
        setActiveCommentId(null);
      }
      
      // Also remove the highlight from DOM
      SelectionHandler.removeHighlight(commentId);
    } catch (error) {
      console.error('Failed to delete comment:', error);
    }
  };

  const handleToggleCommitSidebar = () => {
    setShowCommitSidebar(!showCommitSidebar);
  };

  const handleSelectComment = (commentId) => {
    // Find the comment to get its stage and model
    const comment = comments.find(c => c.id === commentId);
    if (!comment) return;
    
    // Set active comment - this will trigger the ResponseWithComments to show it
    setActiveCommentId(commentId);
    
    // Dispatch custom event to switch tabs if needed
    window.dispatchEvent(new CustomEvent('switchToComment', { 
      detail: { stage: comment.stage, model: comment.model } 
    }));
    
    // Small delay to allow tab switch, then scroll to highlight
    setTimeout(() => {
      const highlight = document.querySelector(`[data-comment-id="${commentId}"]`);
      if (highlight) {
        highlight.scrollIntoView({ behavior: 'smooth', block: 'center' });
        highlight.classList.add('pulse');
        setTimeout(() => highlight.classList.remove('pulse'), 1000);
      }
    }, 100);
  };

  const handleSetActiveComment = useCallback((commentId) => {
    setActiveCommentId(commentId);
  }, []);

  const handleCommitAndStartThread = async (model, question) => {
    if (!currentConversationId || comments.length === 0) return;

    setIsLoading(true);
    
    try {
      const commentIds = comments.map((c) => c.id);
      const messageIndex = comments[0].message_index;

      // Create the follow-up user message with comments context
      const followUpUserMessage = {
        role: 'follow-up-user',
        content: question,
        comments: [...comments],
        model: model,
      };

      // Optimistically add user message to UI
      setCurrentConversation((prev) => ({
        ...prev,
        messages: [...prev.messages, followUpUserMessage],
      }));

      // Add loading placeholder for assistant response
      const followUpAssistantMessage = {
        role: 'follow-up-assistant',
        content: null,
        model: model,
        loading: true,
      };

      setCurrentConversation((prev) => ({
        ...prev,
        messages: [...prev.messages, followUpAssistantMessage],
      }));

      // Call the API to create the thread and get response
      const thread = await api.createThread(
        currentConversationId,
        model,
        commentIds,
        question,
        messageIndex
      );

      // Update the assistant message with the actual response
      setCurrentConversation((prev) => {
        const messages = [...prev.messages];
        const lastMsg = messages[messages.length - 1];
        if (lastMsg.role === 'follow-up-assistant') {
          lastMsg.content = thread.messages[1]?.content || 'No response received';
          lastMsg.loading = false;
        }
        return { ...prev, messages };
      });

      setShowCommitSidebar(false);
      setComments([]); // Clear comments after creating thread
      setActiveCommentId(null);
      setIsLoading(false);
    } catch (error) {
      console.error('Failed to start thread:', error);
      // Remove the optimistic messages on error
      setCurrentConversation((prev) => ({
        ...prev,
        messages: prev.messages.filter(m => m.role !== 'follow-up-user' && m.role !== 'follow-up-assistant'),
      }));
      setIsLoading(false);
    }
  };

  // Get available models for thread creation
  const getAvailableModels = () => {
    if (currentConversation?.council_config) {
      return currentConversation.council_config.council_models;
    }
    return availableConfig?.council_models || [];
  };

  const getDefaultChairman = () => {
    if (currentConversation?.council_config) {
      return currentConversation.council_config.chairman_model;
    }
    return availableConfig?.chairman_model;
  };

  return (
    <div className={`app ${leftSidebarCollapsed ? 'left-collapsed' : ''} ${showCommitSidebar ? 'right-open' : ''}`}>
      <Sidebar
        conversations={conversations}
        currentConversationId={currentConversationId}
        onSelectConversation={handleSelectConversation}
        onNewConversation={handleNewConversation}
        collapsed={leftSidebarCollapsed}
        onToggleCollapse={() => setLeftSidebarCollapsed(!leftSidebarCollapsed)}
      />
      <ChatInterface
        conversation={currentConversation}
        onSendMessage={handleSendMessage}
        isLoading={isLoading}
        comments={comments}
        onSelectionChange={handleSelectionChange}
        onEditComment={handleEditComment}
        onDeleteComment={handleDeleteComment}
        activeCommentId={activeCommentId}
        onSetActiveComment={handleSetActiveComment}
      />
      <ConfigModal
        isOpen={showConfigModal}
        onClose={() => setShowConfigModal(false)}
        onSubmit={handleConfigSubmit}
        availableModels={availableConfig?.council_models}
        defaultChairman={availableConfig?.chairman_model}
      />
      {showPromptManager && (
        <PromptManager
          onSelect={handlePromptSelect}
          onClose={() => {
            setShowPromptManager(false);
            setPendingCouncilConfig(null);
          }}
        />
      )}
      <CommentModal
        selection={currentSelection}
        onSave={handleSaveComment}
        onCancel={() => {
          setShowCommentModal(false);
          setCurrentSelection(null);
          setCommentButtonPosition(null);
          SelectionHandler.clearSelection();
        }}
      />
      {showCommitSidebar && (
        <CommitSidebar
          comments={comments}
          availableModels={getAvailableModels()}
          defaultChairman={getDefaultChairman()}
          onCommit={handleCommitAndStartThread}
          onClose={() => setShowCommitSidebar(false)}
          onSelectComment={handleSelectComment}
          onEditComment={handleEditComment}
          onDeleteComment={handleDeleteComment}
          showContextPreview={showContextPreview}
          onToggleContextPreview={() => setShowContextPreview(!showContextPreview)}
          activeCommentId={activeCommentId}
        />
      )}
      {!showCommitSidebar && (
        <button
          className={`commit-button-fab ${comments.length > 0 ? 'has-comments' : ''}`}
          onClick={handleToggleCommitSidebar}
          title={comments.length > 0 ? "Open review context sidebar" : "No annotations yet - select text to add comments"}
        >
          {comments.length > 0 ? `Review (${comments.length})` : 'Annotate'}
        </button>
      )}
    </div>
  );
}

export default App;
