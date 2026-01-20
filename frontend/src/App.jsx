import { useState, useEffect, useCallback, useMemo } from 'react';
import Sidebar from './components/Sidebar';
import ChatInterface from './components/ChatInterface';
import CouncilDiscussionView from './components/CouncilDiscussionView';
import ConfigModal from './components/ConfigModal';
import SettingsModal from './components/SettingsModal';
import PromptManager from './components/PromptManager';
import CommentModal from './components/CommentModal';
import CommentButton from './components/CommentButton';
import CommitSidebar from './components/CommitSidebar';
import ThreadContextSidebar from './components/ThreadContextSidebar';
import ModeSelector from './components/ModeSelector';
import SynthesizerInterface from './components/SynthesizerInterface';
import MonitorInterface from './components/MonitorInterface';
import VisualiserInterface from './components/VisualiserInterface';
import PodcastInterface from './components/PodcastInterface';
import PodcastReplayView from './components/PodcastReplayView';
import ImageGallery from './components/ImageGallery';
import ConversationGallery from './components/ConversationGallery';
import PodcastGallery from './components/PodcastGallery';
import KnowledgeGraphGallery from './components/KnowledgeGraphGallery';
import SearchModal from './components/SearchModal';
import ApiKeyWarning from './components/ApiKeyWarning';
import { api } from './api';
import { SelectionHandler } from './utils/SelectionHandler';
import { buildHighlightsText, buildContextStackText } from './utils/tokenizer';
import { useTheme } from './contexts/ThemeContext';
import './App.css';

function App() {
  const { theme, toggleTheme } = useTheme();
  const [conversations, setConversations] = useState([]);
  const [currentConversationId, setCurrentConversationId] = useState(null);
  const [currentConversation, setCurrentConversation] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [settingsDefaultTab, setSettingsDefaultTab] = useState('api');
  const [settingsDefaultPrompt, setSettingsDefaultPrompt] = useState(null);
  const [showPromptManager, setShowPromptManager] = useState(false);
  const [showModeSelector, setShowModeSelector] = useState(false);
  const [availableConfig, setAvailableConfig] = useState(null);
  const [pendingCouncilConfig, setPendingCouncilConfig] = useState(null);

  // Monitor state
  const [monitors, setMonitors] = useState([]);
  const [currentMonitorId, setCurrentMonitorId] = useState(null);
  const [currentMonitor, setCurrentMonitor] = useState(null);

  // Review sessions state
  const [reviewSessions, setReviewSessions] = useState([]);
  const [activeReviewSessionId, setActiveReviewSessionId] = useState(null);

  // Comment and thread state (derived from active session)
  const [currentSelection, setCurrentSelection] = useState(null);
  const [commentButtonPosition, setCommentButtonPosition] = useState(null);
  const [showCommentModal, setShowCommentModal] = useState(false);
  const [showCommitSidebar, setShowCommitSidebar] = useState(false);
  const [activeCommentId, setActiveCommentId] = useState(null);

  // Derive comments and contextSegments from active session
  const activeSession = useMemo(() => 
    reviewSessions.find(s => s.id === activeReviewSessionId),
    [reviewSessions, activeReviewSessionId]
  );
  const comments = activeSession?.comments || [];
  const contextSegments = activeSession?.context_segments || [];
  const sessionThreads = activeSession?.threads || [];

  // Thread continuation state
  const [activeThreadContext, setActiveThreadContext] = useState(null);
  // Structure: { threadId, model, comments: [], contextSegments: [] }

  // Sidebar collapse states
  const [leftSidebarCollapsed, setLeftSidebarCollapsed] = useState(false);

  // Search modal state
  const [showSearchModal, setShowSearchModal] = useState(false);

  // Image gallery state
  const [showImageGallery, setShowImageGallery] = useState(false);

  // Conversation gallery states (Council and Notes)
  const [showCouncilGallery, setShowCouncilGallery] = useState(false);
  const [showNotesGallery, setShowNotesGallery] = useState(false);

  // Title animation state
  const [animatingTitleId, setAnimatingTitleId] = useState(null);

  // Prompt labels for sidebar display
  const [promptLabels, setPromptLabels] = useState({});

  // Visualiser settings for style icons in sidebar
  const [visualiserSettings, setVisualiserSettings] = useState(null);

  // Podcast sessions for sidebar
  const [podcastSessions, setPodcastSessions] = useState([]);
  const [showPodcastGallery, setShowPodcastGallery] = useState(false);

  // Knowledge graph gallery state
  const [showKnowledgeGraph, setShowKnowledgeGraph] = useState(false);
  const [focusedEntityId, setFocusedEntityId] = useState(null);
  const [initialSearchQuery, setInitialSearchQuery] = useState(null);
  const [initialOpenReview, setInitialOpenReview] = useState(false);
  const [showPodcastSetup, setShowPodcastSetup] = useState(false);
  const [currentPodcastId, setCurrentPodcastId] = useState(null);
  const [podcastSourceConvId, setPodcastSourceConvId] = useState(null);
  const [visualiserSourceConvId, setVisualiserSourceConvId] = useState(null);

  // API key status for warnings
  const [apiKeyStatus, setApiKeyStatus] = useState(null);

  // Credits for sidebar display
  const [credits, setCredits] = useState(null);
  const [dismissedWarnings, setDismissedWarnings] = useState(() => ({
    openrouter: localStorage.getItem('wizengamot:dismissed:openrouter-warning') === 'true',
    firecrawl: localStorage.getItem('wizengamot:dismissed:firecrawl-warning') === 'true',
  }));

  const getModelShortName = useCallback((model) => {
    return model?.split('/')[1] || model;
  }, []);

  const autoContextSegments = useMemo(() => {
    if (!comments || comments.length === 0) {
      return [];
    }

    const seenKeys = new Set();
    const segments = [];

    comments.forEach((comment) => {
      if (!comment?.source_content) {
        return;
      }

      // Determine source type - check for note_id as fallback detection
      const sourceType = comment.source_type || (comment.note_id ? 'synthesizer' : 'council');

      // Build unique key based on source type
      const key = sourceType === 'council'
        ? `council-${comment.message_index}-${comment.stage}-${comment.model}`
        : `synth-${comment.note_id}`;

      // Check if already manually added or seen
      const manualExists = contextSegments.some((seg) => {
        if (sourceType === 'council') {
          return seg.messageIndex === comment.message_index &&
                 seg.stage === comment.stage &&
                 seg.model === comment.model;
        }
        return seg.noteId === comment.note_id;
      });

      if (manualExists || seenKeys.has(key)) {
        return;
      }

      seenKeys.add(key);

      if (sourceType === 'council') {
        segments.push({
          id: `auto-${key}`,
          sourceType: 'council',
          stage: comment.stage,
          model: comment.model,
          messageIndex: comment.message_index,
          label: `Stage ${comment.stage} • ${getModelShortName(comment.model)}`,
          content: comment.source_content,
          autoGenerated: true,
        });
      } else {
        // Synthesizer
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

  // Load conversations, monitors, config, prompt labels, API key status, credits, and visualiser settings on mount
  useEffect(() => {
    loadConversations();
    loadMonitors();
    loadConfig();
    loadPromptLabels();
    loadApiKeyStatus();
    loadCredits();
    loadVisualiserSettings();
    loadPodcasts();
  }, []);

  const loadApiKeyStatus = async () => {
    try {
      const settings = await api.getSettings();
      setApiKeyStatus({
        openrouter: settings.api_key_configured,
        firecrawl: settings.firecrawl_configured,
      });
    } catch (error) {
      console.error('Failed to load API key status:', error);
    }
  };

  const loadCredits = async () => {
    try {
      const data = await api.getCredits();
      setCredits(data.remaining);
    } catch (error) {
      // Silently fail - don't show credits if fetch fails
    }
  };

  const handleDismissWarning = (keyType) => {
    localStorage.setItem(`wizengamot:dismissed:${keyType}-warning`, 'true');
    setDismissedWarnings(prev => ({ ...prev, [keyType]: true }));
  };

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.metaKey || e.ctrlKey) {
        if (e.key === 'k') {
          e.preventDefault();
          setShowSearchModal(s => !s);
        } else if (e.key === '/') {
          e.preventDefault();
          setLeftSidebarCollapsed(c => !c);
        } else if (e.key === 'd') {
          e.preventDefault();
          handleNewConversation();
        } else if (e.key === '.') {
          e.preventDefault();
          setShowSettingsModal(s => !s);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const loadConfig = async () => {
    try {
      const config = await api.getConfig();
      setAvailableConfig(config);
    } catch (error) {
      console.error('Failed to load config:', error);
    }
  };

  const loadPromptLabels = async () => {
    try {
      const labels = await api.getPromptLabels();
      setPromptLabels(labels);
    } catch (error) {
      console.error('Failed to load prompt labels:', error);
    }
  };

  const loadVisualiserSettings = async () => {
    try {
      const settings = await api.getVisualiserSettings();
      setVisualiserSettings(settings);
    } catch (error) {
      console.error('Failed to load visualiser settings:', error);
    }
  };

  const loadPodcasts = async () => {
    try {
      const sessions = await api.listPodcastSessions(null, 50);
      setPodcastSessions(sessions);
    } catch (error) {
      console.error('Failed to load podcast sessions:', error);
    }
  };

  // Load conversation details when selected
  useEffect(() => {
    if (currentConversationId) {
      loadConversation(currentConversationId);
      loadReviewSessions(currentConversationId);
    } else {
      setReviewSessions([]);
      setActiveReviewSessionId(null);
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

  const loadMonitors = async () => {
    try {
      const mons = await api.listMonitors();
      setMonitors(mons);
    } catch (error) {
      console.error('Failed to load monitors:', error);
    }
  };

  const loadMonitor = async (id) => {
    try {
      const mon = await api.getMonitor(id);
      setCurrentMonitor(mon);
    } catch (error) {
      console.error('Failed to load monitor:', error);
    }
  };

  const loadConversation = async (id) => {
    try {
      const conv = await api.getConversation(id);
      // Don't process legacy threads here - they'll be migrated to sessions
      // Thread messages will be added based on the active session
      setCurrentConversation(conv);
    } catch (error) {
      console.error('Failed to load conversation:', error);
    }
  };

  // Convert session threads to follow-up messages for display
  const conversationWithThreads = useMemo(() => {
    if (!currentConversation) return null;
    if (!sessionThreads || sessionThreads.length === 0) return currentConversation;

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
      ...currentConversation,
      messages: [...currentConversation.messages, ...threadMessages],
    };
  }, [currentConversation, sessionThreads]);

  const handleNewConversation = () => {
    setShowModeSelector(true);
  };

  // Cleanup empty synthesizer conversations when navigating away
  const cleanupEmptyConversation = async (convId) => {
    if (!convId) return;
    const conv = conversations.find(c => c.id === convId);
    // Only cleanup synthesizer conversations with no messages
    if (conv?.mode === 'synthesizer' && conv.message_count === 0) {
      try {
        await api.deleteConversation(convId);
        setConversations(prev => prev.filter(c => c.id !== convId));
      } catch (error) {
        console.error('Failed to cleanup empty conversation:', error);
      }
    }
  };

  const handleGoHome = async () => {
    await cleanupEmptyConversation(currentConversationId);
    setCurrentConversationId(null);
    setCurrentConversation(null);
    setCurrentMonitorId(null);
    setCurrentMonitor(null);
    setShowImageGallery(false);
    setShowCouncilGallery(false);
    setShowNotesGallery(false);
    setShowPodcastGallery(false);
    setShowKnowledgeGraph(false);
    setShowPodcastSetup(false);
    setCurrentPodcastId(null);
  };

  const handleOpenImageGallery = () => {
    setShowImageGallery(true);
    setShowCouncilGallery(false);
    setShowNotesGallery(false);
    setShowPodcastGallery(false);
    setShowKnowledgeGraph(false);
    setShowPodcastSetup(false);
    setCurrentConversationId(null);
    setCurrentConversation(null);
    setCurrentMonitorId(null);
    setCurrentMonitor(null);
    setCurrentPodcastId(null);
  };

  const handleOpenCouncilGallery = () => {
    setShowCouncilGallery(true);
    setShowNotesGallery(false);
    setShowImageGallery(false);
    setShowPodcastGallery(false);
    setShowKnowledgeGraph(false);
    setShowPodcastSetup(false);
    setCurrentConversationId(null);
    setCurrentConversation(null);
    setCurrentMonitorId(null);
    setCurrentMonitor(null);
    setCurrentPodcastId(null);
  };

  const handleOpenNotesGallery = () => {
    setShowNotesGallery(true);
    setShowCouncilGallery(false);
    setShowImageGallery(false);
    setShowPodcastGallery(false);
    setShowKnowledgeGraph(false);
    setShowPodcastSetup(false);
    setCurrentConversationId(null);
    setCurrentConversation(null);
    setCurrentMonitorId(null);
    setCurrentMonitor(null);
    setCurrentPodcastId(null);
  };

  const handleNewCouncilFromGallery = () => {
    setShowCouncilGallery(false);
    setShowConfigModal(true);
  };

  const handleNewNoteFromGallery = async () => {
    setShowNotesGallery(false);
    setShowKnowledgeGraph(false);
    try {
      const newConv = await api.createConversation(null, null, 'synthesizer', null);
      setConversations([
        { id: newConv.id, created_at: newConv.created_at, message_count: 0, title: newConv.title, mode: 'synthesizer' },
        ...conversations,
      ]);
      setCurrentConversationId(newConv.id);
      setCurrentMonitorId(null);
      setCurrentMonitor(null);
    } catch (error) {
      console.error('Failed to create synthesizer conversation:', error);
    }
  };

  const handleModeSelect = async (mode) => {
    setShowModeSelector(false);
    setShowImageGallery(false);
    setShowKnowledgeGraph(false);

    // Cleanup empty conversation before creating new one
    await cleanupEmptyConversation(currentConversationId);

    if (mode === 'council') {
      // Show council config modal for model selection
      setShowConfigModal(true);
    } else if (mode === 'synthesizer') {
      // Create synthesizer conversation directly
      try {
        const newConv = await api.createConversation(null, null, 'synthesizer', null);
        setConversations([
          { id: newConv.id, created_at: newConv.created_at, message_count: 0, title: newConv.title, mode: 'synthesizer' },
          ...conversations,
        ]);
        setCurrentConversationId(newConv.id);
        setCurrentMonitorId(null);
        setCurrentMonitor(null);
      } catch (error) {
        console.error('Failed to create synthesizer conversation:', error);
      }
    } else if (mode === 'monitor') {
      // Create monitor directly
      try {
        const newMonitor = await api.createMonitor('New Monitor');
        setMonitors([
          { id: newMonitor.id, name: newMonitor.name, created_at: newMonitor.created_at, competitor_count: 0 },
          ...monitors,
        ]);
        setCurrentMonitorId(newMonitor.id);
        setCurrentMonitor(newMonitor);
        setCurrentConversationId(null);
        setCurrentConversation(null);
      } catch (error) {
        console.error('Failed to create monitor:', error);
      }
    } else if (mode === 'visualiser') {
      // Create visualiser conversation directly
      try {
        const newConv = await api.createConversation(null, null, 'visualiser', null);
        setConversations([
          { id: newConv.id, created_at: newConv.created_at, message_count: 0, title: newConv.title, mode: 'visualiser' },
          ...conversations,
        ]);
        setCurrentConversationId(newConv.id);
        setCurrentMonitorId(null);
        setCurrentMonitor(null);
      } catch (error) {
        console.error('Failed to create visualiser conversation:', error);
      }
    } else if (mode === 'podcast') {
      // Show podcast gallery instead of creating a conversation
      setShowPodcastGallery(true);
      setCurrentConversationId(null);
      setCurrentPodcastId(null);
      setCurrentMonitorId(null);
      setCurrentMonitor(null);
      loadPodcasts();
    }
  };

  // Navigate to podcast mode with pre-selected source conversation
  const handleNavigateToPodcast = (sourceConversationId) => {
    // Store the source conversation ID for pre-selection
    setPodcastSourceConvId(sourceConversationId);
    // Show podcast setup interface directly (skip gallery)
    setShowPodcastSetup(true);
    setShowPodcastGallery(false);
    setCurrentConversationId(null);
    setCurrentPodcastId(null);
    setCurrentMonitorId(null);
    setCurrentMonitor(null);
  };

  // Navigate to Knowledge Graph with pre-selected entity
  const handleNavigateToGraphEntity = (entityId) => {
    setFocusedEntityId(entityId);
    setShowKnowledgeGraph(true);
    setCurrentConversationId(null);
    setCurrentConversation(null);
    setCurrentMonitorId(null);
    setCurrentMonitor(null);
    setShowImageGallery(false);
    setShowCouncilGallery(false);
    setShowNotesGallery(false);
    setShowPodcastGallery(false);
    setShowPodcastSetup(false);
    setCurrentPodcastId(null);
  };

  // Navigate to Knowledge Graph with a search query (e.g., for tag search)
  const handleNavigateToGraphSearch = (searchQuery) => {
    setInitialSearchQuery(searchQuery);
    setFocusedEntityId(null);
    setShowKnowledgeGraph(true);
    setCurrentConversationId(null);
    setCurrentConversation(null);
    setCurrentMonitorId(null);
    setCurrentMonitor(null);
    setShowImageGallery(false);
    setShowCouncilGallery(false);
    setShowNotesGallery(false);
    setShowPodcastGallery(false);
    setShowPodcastSetup(false);
    setCurrentPodcastId(null);
  };

  // Navigate to visualiser mode with pre-selected source conversation
  const handleNavigateToVisualiser = async (sourceConversationId) => {
    try {
      // Create a new visualiser conversation
      const newConv = await api.createConversation(null, null, 'visualiser', null);
      setConversations([
        { id: newConv.id, created_at: newConv.created_at, message_count: 0, title: newConv.title, mode: 'visualiser' },
        ...conversations,
      ]);
      setCurrentConversationId(newConv.id);
      setVisualiserSourceConvId(sourceConversationId);
      setCurrentMonitorId(null);
      setCurrentMonitor(null);
    } catch (error) {
      console.error('Failed to create visualiser conversation:', error);
    }
  };

  const handleConfigSubmit = async (config) => {
    // Store the config and proceed to prompt selection
    setPendingCouncilConfig(config);
    setShowConfigModal(false);
    setShowPromptManager(true);
  };

  const handlePromptSelect = async (systemPrompt) => {
    try {
      const newConv = await api.createConversation(pendingCouncilConfig, systemPrompt, 'council', null);
      setConversations([
        { ...newConv, message_count: 0 },  // Spread full response to include prompt_title, etc.
        ...conversations,
      ]);
      setCurrentConversationId(newConv.id);
      setShowPromptManager(false);
      setPendingCouncilConfig(null);
    } catch (error) {
      console.error('Failed to create conversation:', error);
    }
  };

  const handleSelectConversation = async (idOrResult) => {
    // Accept either an ID string or a result object with .id
    const id = typeof idOrResult === 'string' ? idOrResult : idOrResult?.id;

    // Cleanup empty conversation before switching (but not if selecting the same one)
    if (currentConversationId && currentConversationId !== id) {
      await cleanupEmptyConversation(currentConversationId);
    }

    // Clear monitor selection and galleries when selecting a conversation
    setCurrentMonitorId(null);
    setCurrentMonitor(null);
    setShowImageGallery(false);
    setShowCouncilGallery(false);
    setShowNotesGallery(false);
    setShowPodcastGallery(false);
    setShowKnowledgeGraph(false);
    setShowPodcastSetup(false);
    setCurrentPodcastId(null);
    setCurrentConversationId(id);
    setActiveCommentId(null);
    setActiveReviewSessionId(null);

    // Auto-mark as read if unread
    const conv = conversations.find(c => c.id === id);
    if (conv?.status?.is_unread) {
      try {
        await api.markConversationRead(id);
        setConversations(prev => prev.map(c =>
          c.id === id ? { ...c, status: { ...c.status, is_unread: false } } : c
        ));
      } catch (error) {
        console.error('Failed to mark conversation as read:', error);
      }
    }
  };

  const handleDeleteConversation = async (id) => {
    try {
      await api.deleteConversation(id);
      setConversations(conversations.filter(c => c.id !== id));
      if (currentConversationId === id) {
        setCurrentConversationId(null);
        setCurrentConversation(null);
      }
    } catch (error) {
      console.error('Failed to delete conversation:', error);
    }
  };

  // Monitor handlers
  const handleSelectMonitor = async (id) => {
    // Clear conversation and gallery selections when selecting a monitor
    setCurrentConversationId(null);
    setCurrentConversation(null);
    setShowImageGallery(false);
    setShowCouncilGallery(false);
    setShowNotesGallery(false);
    setShowPodcastGallery(false);
    setShowKnowledgeGraph(false);
    setShowPodcastSetup(false);
    setCurrentPodcastId(null);
    setCurrentMonitorId(id);
    try {
      const monitor = await api.getMonitor(id);
      setCurrentMonitor(monitor);
    } catch (error) {
      console.error('Failed to load monitor:', error);
    }
  };

  const handlePauseMonitor = async (id) => {
    try {
      await api.pauseMonitor(id);
      loadMonitors();
      if (currentMonitorId === id) {
        const monitor = await api.getMonitor(id);
        setCurrentMonitor(monitor);
      }
    } catch (error) {
      console.error('Failed to pause monitor:', error);
    }
  };

  const handleResumeMonitor = async (id) => {
    try {
      await api.resumeMonitor(id);
      loadMonitors();
      if (currentMonitorId === id) {
        const monitor = await api.getMonitor(id);
        setCurrentMonitor(monitor);
      }
    } catch (error) {
      console.error('Failed to resume monitor:', error);
    }
  };

  const handleDeleteMonitor = async (id) => {
    try {
      await api.deleteMonitor(id);
      setMonitors(monitors.filter(m => m.id !== id));
      if (currentMonitorId === id) {
        setCurrentMonitorId(null);
        setCurrentMonitor(null);
      }
    } catch (error) {
      console.error('Failed to delete monitor:', error);
    }
  };

  const handleMarkMonitorRead = async (id) => {
    try {
      await api.markMonitorRead(id);
      // Update the monitors list to reflect the change
      setMonitors(monitors.map(m =>
        m.id === id ? { ...m, unread_updates: 0 } : m
      ));
    } catch (error) {
      console.error('Failed to mark monitor as read:', error);
    }
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
              if (!prev?.messages?.length) return prev;
              const messages = [...prev.messages];
              const lastMsg = messages[messages.length - 1];
              if (lastMsg?.loading) lastMsg.loading.stage1 = true;
              return { ...prev, messages };
            });
            break;

          case 'stage1_complete':
            setCurrentConversation((prev) => {
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
            setCurrentConversation((prev) => {
              if (!prev?.messages?.length) return prev;
              const messages = [...prev.messages];
              const lastMsg = messages[messages.length - 1];
              if (lastMsg?.loading) lastMsg.loading.stage2 = true;
              return { ...prev, messages };
            });
            break;

          case 'stage2_complete':
            setCurrentConversation((prev) => {
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
            setCurrentConversation((prev) => {
              if (!prev?.messages?.length) return prev;
              const messages = [...prev.messages];
              const lastMsg = messages[messages.length - 1];
              if (lastMsg?.loading) lastMsg.loading.stage3 = true;
              return { ...prev, messages };
            });
            break;

          case 'stage3_complete':
            setCurrentConversation((prev) => {
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
            // Update conversations list with the new title directly
            setConversations(prev => prev.map(conv =>
              conv.id === currentConversationId
                ? { ...conv, title: event.data.title }
                : conv
            ));
            // Trigger title animation
            setAnimatingTitleId(currentConversationId);
            break;

          case 'cost_complete':
            // Update conversation's total_cost in sidebar
            setConversations(prev => prev.map(conv =>
              conv.id === currentConversationId
                ? { ...conv, total_cost: (conv.total_cost || 0) + event.data.cost }
                : conv
            ));
            break;

          case 'summary_complete':
            // Update conversation's summary in sidebar for gallery preview
            setConversations(prev => prev.map(conv =>
              conv.id === currentConversationId
                ? { ...conv, summary: event.data.summary }
                : conv
            ));
            break;

          case 'complete':
            // Stream complete - title already updated via title_complete event
            // Skip loadConversations to avoid race condition that overwrites title
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

  // Review session handlers
  const loadReviewSessions = async (conversationId) => {
    try {
      const result = await api.listReviewSessions(conversationId);
      setReviewSessions(result.sessions || []);
      setActiveReviewSessionId(result.active_session_id || null);
    } catch (error) {
      console.error('Failed to load review sessions:', error);
      setReviewSessions([]);
      setActiveReviewSessionId(null);
    }
  };

  const handleCreateReviewSession = async (name = null) => {
    if (!currentConversationId) return;
    try {
      const session = await api.createReviewSession(currentConversationId, name);
      setReviewSessions(prev => [...prev, session]);
      setActiveReviewSessionId(session.id);
    } catch (error) {
      console.error('Failed to create review session:', error);
    }
  };

  const handleSwitchReviewSession = async (sessionId) => {
    if (!currentConversationId || sessionId === activeReviewSessionId) return;
    try {
      await api.activateReviewSession(currentConversationId, sessionId);
      setActiveReviewSessionId(sessionId);
      setActiveCommentId(null);
    } catch (error) {
      console.error('Failed to switch review session:', error);
    }
  };

  const handleRenameReviewSession = async (sessionId, newName) => {
    if (!currentConversationId) return;
    try {
      const updated = await api.updateReviewSession(currentConversationId, sessionId, newName);
      setReviewSessions(prev => prev.map(s => s.id === sessionId ? updated : s));
    } catch (error) {
      console.error('Failed to rename review session:', error);
    }
  };

  const handleDeleteReviewSession = async (sessionId) => {
    if (!currentConversationId) return;
    try {
      await api.deleteReviewSession(currentConversationId, sessionId);
      const remaining = reviewSessions.filter(s => s.id !== sessionId);
      setReviewSessions(remaining);
      if (activeReviewSessionId === sessionId) {
        const sorted = [...remaining].sort((a, b) => 
          (b.updated_at || b.created_at).localeCompare(a.updated_at || a.created_at)
        );
        setActiveReviewSessionId(sorted[0]?.id || null);
      }
    } catch (error) {
      console.error('Failed to delete review session:', error);
    }
  };

  // Comment and thread handlers

  const handleSelectionChange = useCallback((selection) => {
    if (selection) {
      setCurrentSelection(selection);
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
      // Create a session if none exists
      let sessionId = activeReviewSessionId;
      if (!sessionId) {
        const session = await api.createReviewSession(currentConversationId);
        setReviewSessions(prev => [...prev, session]);
        setActiveReviewSessionId(session.id);
        sessionId = session.id;
      }

      const isCouncil = currentSelection.sourceType === 'council' || !currentSelection.sourceType;

      const commentData = {
        selection: currentSelection.text,
        content: commentText,
        sourceType: currentSelection.sourceType || 'council',
        sourceContent: currentSelection.sourceContent,
      };

      // Add source-type specific fields
      if (isCouncil) {
        commentData.messageIndex = currentSelection.messageIndex;
        commentData.stage = currentSelection.stage;
        commentData.model = currentSelection.model;
      } else {
        commentData.noteId = currentSelection.noteId;
        commentData.noteTitle = currentSelection.noteTitle;
        commentData.sourceUrl = currentSelection.sourceUrl;
        commentData.noteModel = currentSelection.noteModel;
      }

      const newComment = await api.createSessionComment(currentConversationId, sessionId, commentData);

      // Update the session in state
      setReviewSessions(prev => prev.map(s => 
        s.id === sessionId 
          ? { ...s, comments: [...(s.comments || []), newComment], updated_at: new Date().toISOString() }
          : s
      ));

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
    if (!currentConversationId || !activeReviewSessionId) return;

    try {
      const updatedComment = await api.updateSessionComment(
        currentConversationId, 
        activeReviewSessionId, 
        commentId, 
        newContent
      );
      // Update the session in state
      setReviewSessions(prev => prev.map(s => 
        s.id === activeReviewSessionId 
          ? { ...s, comments: s.comments.map(c => c.id === commentId ? updatedComment : c) }
          : s
      ));
    } catch (error) {
      console.error('Failed to edit comment:', error);
    }
  };

  const handleDeleteComment = async (commentId) => {
    if (!currentConversationId || !activeReviewSessionId) return;

    try {
      await api.deleteSessionComment(currentConversationId, activeReviewSessionId, commentId);
      
      // Update the session in state
      setReviewSessions(prev => prev.map(s => 
        s.id === activeReviewSessionId 
          ? { ...s, comments: s.comments.filter(c => c.id !== commentId) }
          : s
      ));

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

  // Direct comment save handler (for keyboard-triggered comments in NoteViewer)
  const handleSaveCommentDirect = async (selection, commentText) => {
    if (!selection || !currentConversationId) return;

    try {
      // Create a session if none exists
      let sessionId = activeReviewSessionId;
      if (!sessionId) {
        const session = await api.createReviewSession(currentConversationId);
        setReviewSessions(prev => [...prev, session]);
        setActiveReviewSessionId(session.id);
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

      const newComment = await api.createSessionComment(currentConversationId, sessionId, commentData);
      
      // Update the session in state
      setReviewSessions(prev => prev.map(s => 
        s.id === sessionId 
          ? { ...s, comments: [...(s.comments || []), newComment], updated_at: new Date().toISOString() }
          : s
      ));

      // Auto-open sidebar when first comment is added
      if (comments.length === 0) {
        setShowCommitSidebar(true);
      }
    } catch (error) {
      console.error('Failed to save comment:', error);
    }
  };

  const handleAddContextSegment = useCallback(async (segment) => {
    if (!currentConversationId) return;

    try {
      // Create a session if none exists
      let sessionId = activeReviewSessionId;
      if (!sessionId) {
        const session = await api.createReviewSession(currentConversationId);
        setReviewSessions(prev => [...prev, session]);
        setActiveReviewSessionId(session.id);
        sessionId = session.id;
      }

      // Check if already exists
      const existing = contextSegments.some(s => s.id === segment.id);
      if (existing) return;

      await api.addSessionContextSegment(currentConversationId, sessionId, segment);

      // Update the session in state
      setReviewSessions(prev => prev.map(s => 
        s.id === sessionId 
          ? { ...s, context_segments: [...(s.context_segments || []), segment], updated_at: new Date().toISOString() }
          : s
      ));

      if (contextSegments.length === 0 && !showCommitSidebar) {
        setShowCommitSidebar(true);
      }
    } catch (error) {
      console.error('Failed to add context segment:', error);
    }
  }, [currentConversationId, activeReviewSessionId, contextSegments, showCommitSidebar]);

  const handleRemoveContextSegment = useCallback(async (segmentId) => {
    if (!currentConversationId || !activeReviewSessionId) return;

    try {
      await api.removeSessionContextSegment(currentConversationId, activeReviewSessionId, segmentId);

      // Update the session in state
      setReviewSessions(prev => prev.map(s => 
        s.id === activeReviewSessionId 
          ? { ...s, context_segments: (s.context_segments || []).filter(seg => seg.id !== segmentId) }
          : s
      ));
    } catch (error) {
      console.error('Failed to remove context segment:', error);
    }
  }, [currentConversationId, activeReviewSessionId]);

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
    if (!currentConversationId || (comments.length === 0 && contextSegments.length === 0 && autoContextSegments.length === 0)) return;

    setIsLoading(true);

    try {
      const commentIds = comments.map((c) => c.id);
      const isSynthesizerMode = currentConversation?.mode === 'synthesizer';

      // Build segment keys differently based on mode
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

      // Build payload with mode-specific fields, filtering out segments without content
      const contextSegmentPayload = combinedSegments
        .filter((segment) => segment.content) // Ensure content exists
        .map((segment) => ({
          id: segment.id,
          label: segment.label,
          content: segment.content,
          source_type: segment.sourceType || 'council',
          // Council-specific
          stage: segment.stage || null,
          model: segment.model || null,
          message_index: segment.messageIndex || null,
          // Synthesizer-specific
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

      // Get identifiers based on mode
      let messageIndex = null;
      let noteIds = null;

      if (isSynthesizerMode) {
        // Collect unique note IDs
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

      // Create the follow-up user message with comments context
      const followUpUserMessage = {
        role: 'follow-up-user',
        content: question,
        comments: [...comments],
        context_segments: contextSegmentPayload,
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

      // Debug: log the payload being sent
      console.log('Creating thread with payload:', {
        model,
        commentIds,
        question,
        messageIndex,
        noteIds,
        contextSegments: contextSegmentPayload,
        compiledContext: compiledContext?.substring(0, 200),
      });

      // Call the API to create the thread within the session
      const thread = await api.createSessionThread(
        currentConversationId,
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

      // Update both messages with the thread_id and actual response
      setCurrentConversation((prev) => {
        const messages = [...prev.messages];
        // Find and update the follow-up-user message (second to last)
        const userMsgIdx = messages.length - 2;
        if (messages[userMsgIdx]?.role === 'follow-up-user') {
          messages[userMsgIdx].thread_id = thread.id;
        }
        // Update the assistant message (last)
        const lastMsg = messages[messages.length - 1];
        if (lastMsg.role === 'follow-up-assistant') {
          lastMsg.content = thread.messages[1]?.content || 'No response received';
          lastMsg.loading = false;
          lastMsg.thread_id = thread.id;
        }
        return { ...prev, messages };
      });

      // Update the session with the new thread
      setReviewSessions(prev => prev.map(s => 
        s.id === activeReviewSessionId 
          ? { ...s, threads: [...(s.threads || []), thread], updated_at: new Date().toISOString() }
          : s
      ));

      setShowCommitSidebar(false);
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

  // Create a visualisation from highlighted context
  const handleVisualiseFromContext = async (style) => {
    if (!currentConversationId || (comments.length === 0 && contextSegments.length === 0 && autoContextSegments.length === 0)) return;

    setIsLoading(true);
    try {
      // Combine context segments
      const combinedSegments = [...contextSegments, ...autoContextSegments];

      // Call the new API endpoint
      const result = await api.visualiseFromContext(
        currentConversationId,
        comments,
        combinedSegments,
        style
      );

      // Create conversation object for the new visualiser conversation
      const newConv = {
        id: result.conversation_id,
        created_at: new Date().toISOString(),
        message_count: 1,
        title: result.conversation_title || 'Visualisation',
        mode: 'visualiser',
      };

      // Add to conversations list
      setConversations((prev) => [newConv, ...prev]);

      // Clear context and close sidebar
      setShowCommitSidebar(false);
      setComments([]);
      setContextSegments([]);
      setActiveCommentId(null);

      // Navigate to the new visualiser conversation
      setCurrentConversationId(result.conversation_id);
      setCurrentConversation(null); // Will be fetched by useEffect

    } catch (error) {
      console.error('Failed to create visualisation:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Continue an existing thread with a new message
  const handleContinueThread = async (threadId, question) => {
    if (!currentConversationId || !threadId || !question.trim()) return;

    setIsLoading(true);
    try {
      // Find the thread's model from existing messages
      const existingMessages = currentConversation?.messages || [];
      const threadMessage = existingMessages.find(
        (m) => m.thread_id === threadId && m.role === 'follow-up-assistant'
      );
      const model = threadMessage?.model || 'unknown';

      // Optimistically add user message
      const followUpUserMessage = {
        role: 'follow-up-user',
        content: question,
        thread_id: threadId,
        model: model,
      };

      setCurrentConversation((prev) => ({
        ...prev,
        messages: [...prev.messages, followUpUserMessage],
      }));

      // Add loading placeholder for assistant response
      const followUpAssistantMessage = {
        role: 'follow-up-assistant',
        content: null,
        model: model,
        thread_id: threadId,
        loading: true,
      };

      setCurrentConversation((prev) => ({
        ...prev,
        messages: [...prev.messages, followUpAssistantMessage],
      }));

      // Call the API to continue the thread
      const updatedThread = await api.continueThread(
        currentConversationId,
        threadId,
        question
      );

      // Update the assistant message with the actual response
      setCurrentConversation((prev) => {
        const messages = [...prev.messages];
        const lastMsg = messages[messages.length - 1];
        if (lastMsg.role === 'follow-up-assistant' && lastMsg.thread_id === threadId) {
          // Get the last assistant message from the thread response
          const assistantMessages = updatedThread.messages.filter((m) => m.role === 'assistant');
          const lastAssistantMsg = assistantMessages[assistantMessages.length - 1];
          lastMsg.content = lastAssistantMsg?.content || 'No response received';
          lastMsg.loading = false;
        }
        return { ...prev, messages };
      });

      setIsLoading(false);
    } catch (error) {
      console.error('Failed to continue thread:', error);
      // Remove the optimistic messages on error
      setCurrentConversation((prev) => ({
        ...prev,
        messages: prev.messages.filter(
          (m) => !(m.thread_id === threadId && m.loading)
        ),
      }));
      setIsLoading(false);
    }
  };

  // Open thread context sidebar
  const handleSelectThread = (threadId, context) => {
    setActiveThreadContext({
      threadId,
      ...context,
    });
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

  const totalContextItems = comments.length + contextSegments.length + autoContextSegments.length;
  const hasContextItems = totalContextItems > 0;

  // Detect navigation transition state to prevent flash to home screen
  const isNavigatingToConversation = currentConversationId &&
    (!currentConversation || currentConversation.id !== currentConversationId);

  return (
    <div className={`app ${leftSidebarCollapsed ? 'left-collapsed' : ''} ${showCommitSidebar ? 'right-open' : ''}`}>
      <Sidebar
        conversations={conversations}
        currentConversationId={currentConversationId}
        onSelectConversation={handleSelectConversation}
        onNewConversation={handleNewConversation}
        onDeleteConversation={handleDeleteConversation}
        onOpenSettings={() => setShowSettingsModal(true)}
        onOpenSearch={() => setShowSearchModal(true)}
        onGoHome={handleGoHome}
        credits={credits}
        collapsed={leftSidebarCollapsed}
        onToggleCollapse={() => setLeftSidebarCollapsed(!leftSidebarCollapsed)}
        isLoading={isLoading}
        animatingTitleId={animatingTitleId}
        onTitleAnimationComplete={() => setAnimatingTitleId(null)}
        promptLabels={promptLabels}
        monitors={monitors}
        currentMonitorId={currentMonitorId}
        onSelectMonitor={handleSelectMonitor}
        onPauseMonitor={handlePauseMonitor}
        onResumeMonitor={handleResumeMonitor}
        onDeleteMonitor={handleDeleteMonitor}
        visualiserSettings={visualiserSettings}
        onOpenImageGallery={handleOpenImageGallery}
        onOpenCouncilGallery={handleOpenCouncilGallery}
        onOpenNotesGallery={handleOpenNotesGallery}
        onOpenPodcastGallery={() => setShowPodcastGallery(true)}
        onOpenKnowledgeGraph={(options = {}) => {
          setInitialOpenReview(options.openReview || false);
          setShowKnowledgeGraph(true);
        }}
      />
      <div className="main-content">
        {apiKeyStatus && !apiKeyStatus.openrouter && !dismissedWarnings.openrouter && (
          <ApiKeyWarning
            keyType="openrouter"
            onOpenSettings={() => setShowSettingsModal(true)}
            onDismiss={() => handleDismissWarning('openrouter')}
          />
        )}
        {apiKeyStatus && !apiKeyStatus.firecrawl && !dismissedWarnings.firecrawl && (
          <ApiKeyWarning
            keyType="firecrawl"
            onOpenSettings={() => setShowSettingsModal(true)}
            onDismiss={() => handleDismissWarning('firecrawl')}
          />
        )}
      </div>
      {isNavigatingToConversation ? (
        <div className="loading-navigation" />
      ) : showCouncilGallery ? (
        <ConversationGallery
          mode="council"
          items={conversations.filter(c => c.mode !== 'synthesizer' && c.mode !== 'visualiser')}
          onSelectConversation={async (id) => {
            await handleSelectConversation(id);
            setShowCouncilGallery(false);
          }}
          onClose={() => setShowCouncilGallery(false)}
          onNewItem={handleNewCouncilFromGallery}
          promptLabels={promptLabels}
        />
      ) : showNotesGallery ? (
        <ConversationGallery
          mode="synthesizer"
          items={conversations.filter(c => c.mode === 'synthesizer' || c.mode === 'discovery')}
          onSelectConversation={async (id) => {
            await handleSelectConversation(id);
            setShowNotesGallery(false);
          }}
          onClose={() => setShowNotesGallery(false)}
          onNewItem={handleNewNoteFromGallery}
        />
      ) : showPodcastGallery ? (
        <PodcastGallery
          podcasts={podcastSessions}
          onSelectPodcast={(id) => {
            setCurrentPodcastId(id);
            setCurrentConversationId(null);
            setCurrentMonitorId(null);
            setShowPodcastGallery(false);
            setShowImageGallery(false);
            setShowCouncilGallery(false);
            setShowNotesGallery(false);
          }}
          onClose={() => setShowPodcastGallery(false)}
          onNewPodcast={() => {
            setShowPodcastGallery(false);
            setShowPodcastSetup(true);
          }}
          onDeletePodcast={async (id) => {
            await api.deletePodcastSession(id);
            loadPodcasts();
            if (currentPodcastId === id) {
              setCurrentPodcastId(null);
            }
          }}
          onRefresh={loadPodcasts}
        />
      ) : showKnowledgeGraph ? (
        <KnowledgeGraphGallery
          onSelectConversation={async (id) => {
            await handleSelectConversation(id);
            setShowKnowledgeGraph(false);
            setFocusedEntityId(null);
            setInitialSearchQuery(null);
            setInitialOpenReview(false);
          }}
          onClose={() => {
            setShowKnowledgeGraph(false);
            setFocusedEntityId(null);
            setInitialSearchQuery(null);
            setInitialOpenReview(false);
          }}
          initialEntityId={focusedEntityId}
          initialSearchQuery={initialSearchQuery}
          initialOpenReview={initialOpenReview}
        />
      ) : showImageGallery ? (
        <ImageGallery
          onSelectConversation={async (id) => {
            await handleSelectConversation(id);
            setShowImageGallery(false);
          }}
          onClose={() => setShowImageGallery(false)}
          onNewVisualisation={() => {
            setShowImageGallery(false);
            handleModeSelect('visualiser');
          }}
        />
      ) : showPodcastSetup ? (
        <PodcastInterface
          onOpenSettings={(tab) => {
            setSettingsDefaultTab(tab || 'podcast');
            setShowSettingsModal(true);
          }}
          onSelectConversation={handleSelectConversation}
          conversations={conversations}
          preSelectedConversationId={podcastSourceConvId}
          onClose={() => {
            setShowPodcastSetup(false);
            setPodcastSourceConvId(null);
            setShowPodcastGallery(true);
          }}
          onPodcastCreated={(sessionId) => {
            setShowPodcastSetup(false);
            setPodcastSourceConvId(null);
            setCurrentPodcastId(sessionId);
            loadPodcasts();
          }}
        />
      ) : currentPodcastId ? (
        <PodcastReplayView
          sessionId={currentPodcastId}
          onClose={() => setCurrentPodcastId(null)}
          onNavigateToNote={(id) => {
            setCurrentPodcastId(null);
            handleSelectConversation(id);
          }}
        />
      ) : currentMonitor ? (
        <MonitorInterface
          monitor={currentMonitor}
          onMonitorUpdate={(updatedMonitor) => {
            setCurrentMonitor(updatedMonitor);
            loadMonitors();
          }}
          onMarkRead={handleMarkMonitorRead}
        />
      ) : currentConversation?.mode === 'discovery' ? (
        <SynthesizerInterface
          conversation={currentConversation}
          onConversationUpdate={(updatedConv, newTitle) => {
            setCurrentConversation(updatedConv);
            setConversations((prev) =>
              prev.map((c) => (c.id === updatedConv.id ? { ...c, ...updatedConv, title: newTitle || updatedConv.title } : c))
            );
            if (newTitle) setAnimatingTitleId(updatedConv.id);
          }}
          comments={comments}
          onSelectionChange={handleSelectionChange}
          onSaveComment={handleSaveCommentDirect}
          onEditComment={handleEditComment}
          onDeleteComment={handleDeleteComment}
          activeCommentId={activeCommentId}
          onSetActiveComment={handleSetActiveComment}
          reviewSessionCount={reviewSessions.length}
          onToggleReviewSidebar={handleToggleCommitSidebar}
          onNavigateToGraphEntity={handleNavigateToGraphEntity}
          onNavigateToGraphSearch={handleNavigateToGraphSearch}
        />
      ) : currentConversation?.mode === 'synthesizer' ? (
        <SynthesizerInterface
          conversation={currentConversation}
          onConversationUpdate={(updatedConv, newTitle) => {
            setCurrentConversation(updatedConv);
            // Always update the conversations list with full metadata
            setConversations((prev) => {
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
                mode: 'synthesizer',
              };
              if (exists) {
                return prev.map((c) => c.id === updatedConv.id ? { ...c, ...updatedMeta } : c);
              } else {
                // Conversation not in list yet - add it at the top
                return [updatedMeta, ...prev];
              }
            });
            if (newTitle) {
              setAnimatingTitleId(updatedConv.id);
            }
          }}
          comments={comments}
          onSelectionChange={handleSelectionChange}
          onSaveComment={handleSaveCommentDirect}
          onEditComment={handleEditComment}
          onDeleteComment={handleDeleteComment}
          activeCommentId={activeCommentId}
          onSetActiveComment={handleSetActiveComment}
          onNavigateToPodcast={() => handleNavigateToPodcast(currentConversationId)}
          onNavigateToVisualiser={() => handleNavigateToVisualiser(currentConversationId)}
          linkedVisualisations={currentConversation?.linked_visualisations || []}
          onSelectConversation={handleSelectConversation}
          reviewSessionCount={reviewSessions.length}
          onToggleReviewSidebar={handleToggleCommitSidebar}
          onNavigateToGraphEntity={handleNavigateToGraphEntity}
          onNavigateToGraphSearch={handleNavigateToGraphSearch}
        />
      ) : currentConversation?.mode === 'visualiser' ? (
        <VisualiserInterface
          conversation={currentConversation}
          conversations={conversations}
          preSelectedConversationId={visualiserSourceConvId}
          onClearPreSelection={() => setVisualiserSourceConvId(null)}
          onSelectConversation={handleSelectConversation}
          onConversationUpdate={(updatedConv, newTitle) => {
            setCurrentConversation(updatedConv);
            if (newTitle) {
              setConversations((prev) =>
                prev.map((c) => (c.id === updatedConv.id ? { ...c, title: newTitle } : c))
              );
              setAnimatingTitleId(updatedConv.id);
              // Skip loadConversations - title already persisted and optimistically updated
            } else {
              loadConversations();
            }
          }}
        />
      ) : currentConversation?.mode === 'podcast' ? (
        <PodcastInterface
          onOpenSettings={(tab) => {
            setSettingsDefaultTab(tab || 'podcast');
            setShowSettingsModal(true);
          }}
          onSelectConversation={handleSelectConversation}
          conversations={conversations}
          preSelectedConversationId={podcastSourceConvId}
        />
      ) : currentConversation?.mode === 'council' ? (
        conversationWithThreads?.messages?.length === 0 ? (
          <ChatInterface
            conversation={conversationWithThreads}
            onSendMessage={handleSendMessage}
            isLoading={isLoading}
            comments={comments}
            contextSegments={contextSegments}
            onSelectionChange={handleSelectionChange}
            onEditComment={handleEditComment}
            onDeleteComment={handleDeleteComment}
            activeCommentId={activeCommentId}
            onSetActiveComment={handleSetActiveComment}
            onAddContextSegment={handleAddContextSegment}
            onRemoveContextSegment={handleRemoveContextSegment}
            onContinueThread={handleContinueThread}
            onSelectThread={handleSelectThread}
            onOpenSettings={(tab) => {
              setSettingsDefaultTab(tab || 'council');
              setSettingsDefaultPrompt(null);
              setShowSettingsModal(true);
            }}
          />
        ) : (
          <CouncilDiscussionView
            conversation={conversationWithThreads}
            comments={comments}
            contextSegments={contextSegments}
            onSelectionChange={handleSelectionChange}
            onEditComment={handleEditComment}
            onDeleteComment={handleDeleteComment}
            activeCommentId={activeCommentId}
            onSetActiveComment={handleSetActiveComment}
            onAddContextSegment={handleAddContextSegment}
            onRemoveContextSegment={handleRemoveContextSegment}
            onOpenSettings={(tab, promptFilename) => {
              setSettingsDefaultTab(tab || 'api');
              setSettingsDefaultPrompt(promptFilename || null);
              setShowSettingsModal(true);
            }}
            onContinueThread={handleContinueThread}
            onSelectThread={handleSelectThread}
            isLoading={isLoading}
            reviewSessionCount={reviewSessions.length}
            onToggleReviewSidebar={handleToggleCommitSidebar}
          />
        )
      ) : (
        <ChatInterface
          conversation={conversationWithThreads}
          onSendMessage={handleSendMessage}
          isLoading={isLoading}
          comments={comments}
          contextSegments={contextSegments}
          onSelectionChange={handleSelectionChange}
          onEditComment={handleEditComment}
          onDeleteComment={handleDeleteComment}
          activeCommentId={activeCommentId}
          onSetActiveComment={handleSetActiveComment}
          onAddContextSegment={handleAddContextSegment}
          onRemoveContextSegment={handleRemoveContextSegment}
          onContinueThread={handleContinueThread}
          onSelectThread={handleSelectThread}
          onOpenSettings={(tab) => {
            setSettingsDefaultTab(tab || 'council');
            setShowSettingsModal(true);
          }}
        />
      )}
      {showModeSelector && (
        <ModeSelector
          onSelect={handleModeSelect}
          onCancel={() => setShowModeSelector(false)}
        />
      )}
      <ConfigModal
        isOpen={showConfigModal}
        onClose={() => setShowConfigModal(false)}
        onSubmit={handleConfigSubmit}
        availableModels={availableConfig?.model_pool || availableConfig?.council_models}
        defaultSelectedModels={availableConfig?.council_models}
        defaultChairman={availableConfig?.chairman_model}
      />
      <SettingsModal
        isOpen={showSettingsModal}
        onClose={() => {
          setShowSettingsModal(false);
          setSettingsDefaultTab('api'); // Reset to default tab
          setSettingsDefaultPrompt(null); // Reset prompt selection
          loadConfig(); // Reload config to pick up any model changes
          loadApiKeyStatus(); // Reload API key status in case user added keys
        }}
        defaultTab={settingsDefaultTab}
        defaultPrompt={settingsDefaultPrompt}
      />
      {showPromptManager && (
        <PromptManager
          onSelect={handlePromptSelect}
          onClose={() => {
            setShowPromptManager(false);
            setPendingCouncilConfig(null);
          }}
          onOpenSettings={() => {
            setShowPromptManager(false);
            setPendingCouncilConfig(null);
            setSettingsDefaultTab('council');
            setShowSettingsModal(true);
          }}
          mode="council"
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
      <CommentButton
        position={currentSelection ? null : commentButtonPosition}
        onComment={handleCommentButtonClick}
      />
      {showCommitSidebar && (
        <CommitSidebar
          comments={comments}
          contextSegments={contextSegments}
          autoContextSegments={autoContextSegments}
          availableModels={getAvailableModels()}
          defaultChairman={getDefaultChairman()}
          onCommit={handleCommitAndStartThread}
          onClose={() => setShowCommitSidebar(false)}
          onSelectComment={handleSelectComment}
          onEditComment={handleEditComment}
          onDeleteComment={handleDeleteComment}
          activeCommentId={activeCommentId}
          onRemoveContextSegment={handleRemoveContextSegment}
          onVisualise={handleVisualiseFromContext}
          reviewSessions={reviewSessions}
          activeSessionId={activeReviewSessionId}
          sessionThreads={sessionThreads}
          onCreateSession={handleCreateReviewSession}
          onSwitchSession={handleSwitchReviewSession}
          onRenameSession={handleRenameReviewSession}
          onDeleteSession={handleDeleteReviewSession}
        />
      )}
      {activeThreadContext && (
        <ThreadContextSidebar
          context={activeThreadContext}
          allComments={comments}
          onClose={() => setActiveThreadContext(null)}
          onCommentClick={handleSelectComment}
        />
      )}
      {!showCommitSidebar && hasContextItems && (
        <button
          className={`commit-button-fab ${hasContextItems ? 'has-comments' : ''}`}
          onClick={handleToggleCommitSidebar}
          title="Open review context sidebar"
        >
          {`Review (${totalContextItems})`}
        </button>
      )}
      <SearchModal
        isOpen={showSearchModal}
        onClose={() => setShowSearchModal(false)}
        conversations={conversations}
        onSelectConversation={(result) => {
          handleSelectConversation(result);
          setShowSearchModal(false);
        }}
        onNewConversation={handleNewConversation}
        theme={theme}
        onToggleTheme={toggleTheme}
        onOpenSettings={() => {
          setShowSearchModal(false);
          setShowSettingsModal(true);
        }}
      />
    </div>
  );
}

export default App;
