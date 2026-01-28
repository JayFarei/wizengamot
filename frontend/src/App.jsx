import { useState, useEffect, useCallback, useMemo } from 'react';
import Sidebar from './components/Sidebar';
import ConfigModal from './components/ConfigModal';
import SettingsModal from './components/SettingsModal';
import PromptManager from './components/PromptManager';
import ModeSelector from './components/ModeSelector';
import PodcastInterface from './components/PodcastInterface';
import PodcastReplayView from './components/PodcastReplayView';
import MiniPlayer from './components/MiniPlayer';
import { PodcastPlayerProvider } from './contexts/PodcastPlayerContext';
import ImageGallery from './components/ImageGallery';
import ConversationGallery from './components/ConversationGallery';
import PodcastGallery from './components/PodcastGallery';
import KnowledgeGraphGallery from './components/KnowledgeGraphGallery';
import SearchModal from './components/SearchModal';
// CommandPalette moved to per-pane (PaneContent)
import ApiKeyWarning from './components/ApiKeyWarning';
import { api } from './api';
import { useTheme } from './contexts/ThemeContext';
import { LayoutProvider } from './contexts/LayoutContext';
import { NoteKeyboardProvider } from './contexts/NoteKeyboardContext';
import { LayoutKeyboardHandler, MainContentArea } from './components/layout';
import './App.css';

function App() {
  const { theme, toggleTheme } = useTheme();

  // Global state - conversations list
  const [conversations, setConversations] = useState([]);
  const [currentConversationId, setCurrentConversationId] = useState(null);

  // Modal states
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [settingsDefaultTab, setSettingsDefaultTab] = useState('api');
  const [settingsDefaultPrompt, setSettingsDefaultPrompt] = useState(null);
  const [showPromptManager, setShowPromptManager] = useState(false);
  const [showModeSelector, setShowModeSelector] = useState(false);
  const [pendingCouncilConfig, setPendingCouncilConfig] = useState(null);

  // Config state
  const [availableConfig, setAvailableConfig] = useState(null);

  // Sidebar state
  const [leftSidebarCollapsed, setLeftSidebarCollapsed] = useState(false);

  // Search modal state
  const [showSearchModal, setShowSearchModal] = useState(false);

  // Command palette state (moved to per-pane in PaneContext)
  // const [showCommandPalette, setShowCommandPalette] = useState(false);

  // Gallery states
  const [showImageGallery, setShowImageGallery] = useState(false);
  const [showCouncilGallery, setShowCouncilGallery] = useState(false);
  const [showNotesGallery, setShowNotesGallery] = useState(false);
  const [showPodcastGallery, setShowPodcastGallery] = useState(false);
  const [showKnowledgeGraph, setShowKnowledgeGraph] = useState(false);

  // Title animation state
  const [animatingTitleId, setAnimatingTitleId] = useState(null);

  // Prompt labels for sidebar display
  const [promptLabels, setPromptLabels] = useState({});

  // Visualiser settings for style icons in sidebar
  const [visualiserSettings, setVisualiserSettings] = useState(null);

  // Podcast sessions for sidebar
  const [podcastSessions, setPodcastSessions] = useState([]);

  // Knowledge graph state
  const [focusedEntityId, setFocusedEntityId] = useState(null);
  const [initialSearchQuery, setInitialSearchQuery] = useState(null);
  const [initialOpenReview, setInitialOpenReview] = useState(false);

  // Podcast state
  const [showPodcastSetup, setShowPodcastSetup] = useState(false);
  const [currentPodcastId, setCurrentPodcastId] = useState(null);
  const [podcastSourceConvId, setPodcastSourceConvId] = useState(null);

  // Visualiser source state
  const [visualiserSourceConvId, setVisualiserSourceConvId] = useState(null);

  // API key status for warnings
  const [apiKeyStatus, setApiKeyStatus] = useState(null);

  // Credits for sidebar display
  const [credits, setCredits] = useState(null);
  const [dismissedWarnings, setDismissedWarnings] = useState(() => ({
    openrouter: localStorage.getItem('wizengamot:dismissed:openrouter-warning') === 'true',
    firecrawl: localStorage.getItem('wizengamot:dismissed:firecrawl-warning') === 'true',
  }));

  // Load conversations, config, prompt labels, API key status, credits, and visualiser settings on mount
  useEffect(() => {
    loadConversations();
    loadConfig();
    loadPromptLabels();
    loadApiKeyStatus();
    loadCredits();
    loadVisualiserSettings();
    loadPodcasts();
  }, []);

  // Set CSS variable for sidebar width (used by CommandPalette positioning)
  useEffect(() => {
    const sidebarWidth = leftSidebarCollapsed ? '56px' : '280px';
    document.documentElement.style.setProperty('--sidebar-width', sidebarWidth);
  }, [leftSidebarCollapsed]);

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
        // Cmd+Shift+P handled in separate useEffect
        if ((e.key === 'P' || e.key === 'p') && e.shiftKey) {
          return;
        }
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
        } else if (e.key === 'u') {
          e.preventDefault();
          setShowKnowledgeGraph(true);
          setShowSearchModal(false);
          setCurrentConversationId(null);
          setShowImageGallery(false);
          setShowCouncilGallery(false);
          setShowNotesGallery(false);
          setShowPodcastGallery(false);
          setShowPodcastSetup(false);
          setCurrentPodcastId(null);
        } else if (e.key === 'o') {
          e.preventDefault();
          setShowPodcastGallery(true);
          setShowSearchModal(false);
          setCurrentConversationId(null);
          setCurrentPodcastId(null);
          setShowImageGallery(false);
          setShowCouncilGallery(false);
          setShowNotesGallery(false);
          setShowKnowledgeGraph(false);
          setShowPodcastSetup(false);
          loadPodcasts();
        } else if (e.key === 'g') {
          e.preventDefault();
          setShowImageGallery(true);
          setShowSearchModal(false);
          setCurrentConversationId(null);
          setCurrentPodcastId(null);
          setShowCouncilGallery(false);
          setShowNotesGallery(false);
          setShowKnowledgeGraph(false);
          setShowPodcastGallery(false);
          setShowPodcastSetup(false);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Command palette shortcut (moved to per-pane in PaneContent)
  // Cmd+Shift+P is now handled at the pane level

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

  const loadConversations = async () => {
    try {
      const convs = await api.listConversations();
      setConversations(convs);
    } catch (error) {
      console.error('Failed to load conversations:', error);
    }
  };

  const handleNewConversation = () => {
    setShowModeSelector(true);
  };

  // Cleanup empty synthesizer conversations when navigating away
  const cleanupEmptyConversation = async (convId) => {
    if (!convId) return;
    const conv = conversations.find(c => c.id === convId);
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
    } catch (error) {
      console.error('Failed to create synthesizer conversation:', error);
    }
  };

  const handleModeSelect = async (mode) => {
    // If no mode provided (e.g., from pane "New" button), show mode selector
    if (!mode) {
      setShowModeSelector(true);
      return;
    }

    setShowModeSelector(false);
    setShowImageGallery(false);
    setShowKnowledgeGraph(false);
    setShowPodcastGallery(false);
    setShowPodcastSetup(false);
    setShowCouncilGallery(false);
    setShowNotesGallery(false);

    await cleanupEmptyConversation(currentConversationId);

    if (mode === 'council') {
      setShowConfigModal(true);
    } else if (mode === 'synthesizer') {
      try {
        const newConv = await api.createConversation(null, null, 'synthesizer', null);
        setConversations([
          { id: newConv.id, created_at: newConv.created_at, message_count: 0, title: newConv.title, mode: 'synthesizer' },
          ...conversations,
        ]);
        setCurrentConversationId(newConv.id);
      } catch (error) {
        console.error('Failed to create synthesizer conversation:', error);
      }
    } else if (mode === 'visualiser') {
      try {
        const newConv = await api.createConversation(null, null, 'visualiser', null);
        setConversations([
          { id: newConv.id, created_at: newConv.created_at, message_count: 0, title: newConv.title, mode: 'visualiser' },
          ...conversations,
        ]);
        setCurrentConversationId(newConv.id);
      } catch (error) {
        console.error('Failed to create visualiser conversation:', error);
      }
    } else if (mode === 'podcast') {
      setShowPodcastGallery(true);
      setCurrentConversationId(null);
      setCurrentPodcastId(null);
      loadPodcasts();
    }
  };

  // Navigate to podcast mode with pre-selected source conversation
  const handleNavigateToPodcast = (sourceConversationId) => {
    setPodcastSourceConvId(sourceConversationId);
    setShowPodcastSetup(true);
    setShowPodcastGallery(false);
    setCurrentConversationId(null);
    setCurrentPodcastId(null);
  };

  // Navigate to Knowledge Graph with pre-selected entity
  const handleNavigateToGraphEntity = (entityId) => {
    setFocusedEntityId(entityId);
    setShowKnowledgeGraph(true);
    setCurrentConversationId(null);
    setShowImageGallery(false);
    setShowCouncilGallery(false);
    setShowNotesGallery(false);
    setShowPodcastGallery(false);
    setShowPodcastSetup(false);
    setCurrentPodcastId(null);
  };

  // Navigate to Knowledge Graph with a search query
  const handleNavigateToGraphSearch = (searchQuery) => {
    setInitialSearchQuery(searchQuery);
    setFocusedEntityId(null);
    setShowKnowledgeGraph(true);
    setCurrentConversationId(null);
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
      const newConv = await api.createConversation(null, null, 'visualiser', null);
      setConversations([
        { id: newConv.id, created_at: newConv.created_at, message_count: 0, title: newConv.title, mode: 'visualiser' },
        ...conversations,
      ]);
      setCurrentConversationId(newConv.id);
      setVisualiserSourceConvId(sourceConversationId);
    } catch (error) {
      console.error('Failed to create visualiser conversation:', error);
    }
  };

  const handleConfigSubmit = async (config) => {
    setPendingCouncilConfig(config);
    setShowConfigModal(false);
    setShowPromptManager(true);
  };

  const handlePromptSelect = async (systemPrompt) => {
    try {
      const newConv = await api.createConversation(pendingCouncilConfig, systemPrompt, 'council', null);
      setConversations([
        { ...newConv, message_count: 0 },
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
    const id = typeof idOrResult === 'string' ? idOrResult : idOrResult?.id;

    if (currentConversationId && currentConversationId !== id) {
      await cleanupEmptyConversation(currentConversationId);
    }

    // Clear galleries when selecting a conversation
    setShowImageGallery(false);
    setShowCouncilGallery(false);
    setShowNotesGallery(false);
    setShowPodcastGallery(false);
    setShowKnowledgeGraph(false);
    setShowPodcastSetup(false);
    setCurrentPodcastId(null);
    setCurrentConversationId(id);

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
      }
    } catch (error) {
      console.error('Failed to delete conversation:', error);
    }
  };

  // Handle expand from MiniPlayer - navigate to podcast replay
  const handleExpandPodcast = useCallback((session) => {
    if (session?.session_id) {
      setCurrentPodcastId(session.session_id);
      setCurrentConversationId(null);
      setShowPodcastGallery(false);
      setShowImageGallery(false);
      setShowCouncilGallery(false);
      setShowNotesGallery(false);
      setShowKnowledgeGraph(false);
      setShowPodcastSetup(false);
    }
  }, []);

  // Handle settings open with tab
  const handleOpenSettings = useCallback((tab, promptFilename) => {
    setSettingsDefaultTab(tab || 'api');
    setSettingsDefaultPrompt(promptFilename || null);
    setShowSettingsModal(true);
  }, []);

  // Get current conversation for context-aware actions
  const currentConversation = useMemo(() => {
    return conversations.find(c => c.id === currentConversationId);
  }, [conversations, currentConversationId]);

  // Command palette actions moved to per-pane (PaneContent)

  // Detect if we're showing a gallery or other non-conversation view
  const isShowingGallery = showCouncilGallery || showNotesGallery || showPodcastGallery ||
    showKnowledgeGraph || showImageGallery || showPodcastSetup || currentPodcastId;

  return (
    <LayoutProvider initialConversationId={currentConversationId}>
    <NoteKeyboardProvider>
    <PodcastPlayerProvider onExpand={handleExpandPodcast}>
    <div className={`app ${leftSidebarCollapsed ? 'left-collapsed' : ''}`}>
      <LayoutKeyboardHandler onOpenSearch={() => setShowSearchModal(true)} />
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
        isLoading={false}
        animatingTitleId={animatingTitleId}
        onTitleAnimationComplete={() => setAnimatingTitleId(null)}
        promptLabels={promptLabels}
        visualiserSettings={visualiserSettings}
        onOpenImageGallery={handleOpenImageGallery}
        onOpenCouncilGallery={handleOpenCouncilGallery}
        onOpenNotesGallery={handleOpenNotesGallery}
        onOpenPodcastGallery={() => {
          setShowPodcastGallery(true);
          setShowKnowledgeGraph(false);
          setShowImageGallery(false);
          setShowCouncilGallery(false);
          setShowNotesGallery(false);
          setShowPodcastSetup(false);
        }}
        onOpenKnowledgeGraph={(options = {}) => {
          setInitialOpenReview(options.openReview || false);
          setShowKnowledgeGraph(true);
          setShowPodcastGallery(false);
          setShowImageGallery(false);
          setShowCouncilGallery(false);
          setShowNotesGallery(false);
          setShowPodcastSetup(false);
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
      {showCouncilGallery ? (
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
          onOpenImageGallery={() => {
            setShowKnowledgeGraph(false);
            setShowImageGallery(true);
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
      ) : (
        <MainContentArea
          conversations={conversations}
          currentConversationId={currentConversationId}
          onSelectConversation={handleSelectConversation}
          onConversationsListUpdate={setConversations}
          onAnimateTitleId={setAnimatingTitleId}
          availableConfig={availableConfig}
          onOpenSettings={handleOpenSettings}
          onNavigateToPodcast={handleNavigateToPodcast}
          onNavigateToVisualiser={handleNavigateToVisualiser}
          onNavigateToGraphEntity={handleNavigateToGraphEntity}
          onNavigateToGraphSearch={handleNavigateToGraphSearch}
          visualiserSourceConvId={visualiserSourceConvId}
          onClearVisualiserSource={() => setVisualiserSourceConvId(null)}
          podcastSourceConvId={podcastSourceConvId}
          onNewConversation={handleModeSelect}
          theme={theme}
          onToggleTheme={toggleTheme}
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
          setSettingsDefaultTab('api');
          setSettingsDefaultPrompt(null);
          loadConfig();
          loadApiKeyStatus();
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
      {/* CommandPalette moved to per-pane (PaneContent) */}
      <MiniPlayer />
    </div>
    </PodcastPlayerProvider>
    </NoteKeyboardProvider>
    </LayoutProvider>
  );
}

export default App;
