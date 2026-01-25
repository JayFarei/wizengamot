import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Play,
  Pause,
  Square,
  Radio,
  FileText,
  ChevronRight,
  AlertCircle,
  Settings,
  Loader2,
  Search,
  Image as ImageIcon,
  SkipBack,
  SkipForward,
  ArrowLeft,
  Download,
  Info,
  Minimize2,
  Users,
  Mic,
  MessageSquare,
  Compass,
} from 'lucide-react';
import { api } from '../api';
import { usePodcastPlayer } from '../contexts/PodcastPlayerContext';
import Teleprompter from './Teleprompter';
import EmojiReactions from './EmojiReactions';
import ActionMenu from './ActionMenu';
import './PodcastInterface.css';

/**
 * PodcastInterface - Main component for podcast mode.
 *
 * Features:
 * - Select synthesizer conversation as source
 * - Choose narration style
 * - Choose episode mode: Explainer (1 narrator) or Question Time (host + expert)
 * - Select characters for the episode
 * - Optional KG discovery for topic-based note selection
 * - Generate audio with Qwen3-TTS
 * - Play with teleprompter sync using real word timestamps
 */
export default function PodcastInterface({
  onOpenSettings,
  onSelectConversation,
  conversations = [],
  preSelectedConversationId = null,
  onClose,
  onPodcastCreated,
}) {
  // Podcast player context
  const { setSession: setPlayerSession, minimize } = usePodcastPlayer();

  // View state: 'setup', 'generating', 'player'
  const [view, setView] = useState('setup');

  // Setup state
  const [synthConversations, setSynthConversations] = useState([]);
  const [selectedConvId, setSelectedConvId] = useState(preSelectedConversationId);
  const [selectedNotes, setSelectedNotes] = useState([]);
  const [style, setStyle] = useState('rest-is-politics');
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);

  // Episode mode: 'explainer' (1 narrator) or 'question_time' (host + expert)
  const [episodeMode, setEpisodeMode] = useState('explainer');

  // Character selection
  const [characters, setCharacters] = useState([]);
  const [loadingCharacters, setLoadingCharacters] = useState(true);
  const [selectedNarrator, setSelectedNarrator] = useState(null);
  const [selectedHost, setSelectedHost] = useState(null);
  const [selectedExpert, setSelectedExpert] = useState(null);

  // KG Discovery
  const [useKgDiscovery, setUseKgDiscovery] = useState(false);
  const [kgTopic, setKgTopic] = useState('');
  const [kgDiscoveredNotes, setKgDiscoveredNotes] = useState([]);
  const [isDiscovering, setIsDiscovering] = useState(false);

  // Session state
  const [session, setSession] = useState(null);
  const [error, setError] = useState(null);

  // Generation progress
  const [generationProgress, setGenerationProgress] = useState(0);
  const [generationStatus, setGenerationStatus] = useState('');
  const [generationStep, setGenerationStep] = useState('starting');
  const [audioCurrentSegment, setAudioCurrentSegment] = useState(0);
  const [audioTotalSegments, setAudioTotalSegments] = useState(0);

  // Settings check
  const [podcastSettings, setPodcastSettings] = useState(null);
  const [checkingSettings, setCheckingSettings] = useState(true);
  const [ttsHealthy, setTtsHealthy] = useState(null);

  // Narration styles from API
  const [narrationStyles, setNarrationStyles] = useState({});
  const [stylesLoading, setStylesLoading] = useState(true);

  // Load podcast settings, styles, and characters
  useEffect(() => {
    const checkSettings = async () => {
      try {
        const settings = await api.getPodcastSettings();
        setPodcastSettings(settings);

        // Check TTS health
        try {
          const health = await api.checkTtsHealth();
          setTtsHealthy(health.healthy);
        } catch {
          setTtsHealthy(false);
        }
      } catch (err) {
        console.error('Failed to check podcast settings:', err);
      } finally {
        setCheckingSettings(false);
      }
    };
    checkSettings();

    const loadStyles = async () => {
      try {
        const styles = await api.listPodcastStyles();
        setNarrationStyles(styles);
        // Set default style to first available if current isn't in list
        const styleIds = Object.keys(styles);
        if (styleIds.length > 0 && !styles[style]) {
          setStyle(styleIds[0]);
        }
      } catch (err) {
        console.error('Failed to load narration styles:', err);
      } finally {
        setStylesLoading(false);
      }
    };
    loadStyles();

    const loadCharacters = async () => {
      try {
        const data = await api.listPodcastCharacters();
        const chars = data.characters || [];
        setCharacters(chars);

        // Auto-select first narrator for explainer mode
        const narrators = chars.filter(c => c.personality?.speaking_role === 'narrator');
        if (narrators.length > 0) {
          setSelectedNarrator(narrators[0].id);
        } else if (chars.length > 0) {
          setSelectedNarrator(chars[0].id);
        }

        // Auto-select host and expert for question time
        const hosts = chars.filter(c => c.personality?.speaking_role === 'host');
        const experts = chars.filter(c => c.personality?.speaking_role === 'expert');
        if (hosts.length > 0) {
          setSelectedHost(hosts[0].id);
        } else if (chars.length > 0) {
          setSelectedHost(chars[0].id);
        }
        if (experts.length > 0) {
          setSelectedExpert(experts[0].id);
        } else if (chars.length > 1) {
          setSelectedExpert(chars[1].id);
        }
      } catch (err) {
        console.error('Failed to load characters:', err);
      } finally {
        setLoadingCharacters(false);
      }
    };
    loadCharacters();
  }, []);

  // Filter synthesizer conversations
  useEffect(() => {
    const synthConvs = conversations.filter(c => c.mode === 'synthesizer');
    setSynthConversations(synthConvs);
    setLoadingConversations(false);
  }, [conversations]);

  // Search for conversations
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }

    const searchTimeout = setTimeout(async () => {
      setIsSearching(true);
      try {
        const results = await api.search(searchQuery, 10);
        const synthResults = results.filter(r => r.mode === 'synthesizer');
        setSearchResults(synthResults);
      } catch (err) {
        console.error('Search failed:', err);
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => clearTimeout(searchTimeout);
  }, [searchQuery]);

  // Handle KG Discovery
  const handleKgDiscover = async () => {
    if (!kgTopic.trim()) return;

    setIsDiscovering(true);
    setError(null);
    try {
      const results = await api.discoverPodcastNotes(kgTopic.trim(), 10);
      setKgDiscoveredNotes(results.notes || []);
      if (results.notes?.length === 0) {
        setError('No related notes found for this topic.');
      }
    } catch (err) {
      console.error('KG discovery failed:', err);
      setError('Failed to discover related notes.');
    } finally {
      setIsDiscovering(false);
    }
  };

  const selectedConversation = useMemo(() => {
    return conversations.find(c => c.id === selectedConvId);
  }, [conversations, selectedConvId]);

  // Check if character selection is valid
  const isCharacterSelectionValid = useMemo(() => {
    if (episodeMode === 'explainer') {
      return !!selectedNarrator;
    }
    // Question Time needs host and expert to be different
    return selectedHost && selectedExpert && selectedHost !== selectedExpert;
  }, [episodeMode, selectedNarrator, selectedHost, selectedExpert]);

  // Start podcast generation
  const handleStartPodcast = async () => {
    if (!selectedConvId && !kgDiscoveredNotes.length) return;
    if (!isCharacterSelectionValid) {
      setError('Please select valid characters for this mode.');
      return;
    }

    setError(null);
    setView('generating');
    setGenerationProgress(0);
    setGenerationStatus('Creating session...');

    try {
      // Build character config based on mode
      const characterConfig = episodeMode === 'explainer'
        ? { narrator: selectedNarrator }
        : { host: selectedHost, expert: selectedExpert };

      // Create session
      const sessionResult = await api.createPodcastSession(
        selectedConvId,
        selectedNotes.length > 0 ? selectedNotes : null,
        style,
        episodeMode,
        characterConfig
      );
      setSession(sessionResult);

      // Start generation with SSE progress tracking
      const streamUrl = api.getPodcastGenerationStreamUrl(sessionResult.session_id);
      const eventSource = new EventSource(streamUrl);

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          if (data.progress !== undefined) {
            setGenerationProgress(data.progress);
          }

          // Update status message from server
          if (data.message) {
            setGenerationStatus(data.message);
          }

          // Update step tracking
          if (data.step) {
            setGenerationStep(data.step);
          }
          if (data.audio_current !== undefined) {
            setAudioCurrentSegment(data.audio_current);
          }
          if (data.audio_total !== undefined) {
            setAudioTotalSegments(data.audio_total);
          }

          if (data.status === 'ready') {
            eventSource.close();
            setGenerationStatus('Complete!');
            // Notify parent of successful creation
            if (onPodcastCreated) {
              onPodcastCreated(sessionResult.session_id);
            } else {
              // Fallback: show player view if no callback
              api.getPodcastSession(sessionResult.session_id).then(fullSession => {
                setSession(fullSession);
                setPlayerSession(fullSession); // Set in context for MiniPlayer
                setView('player');
              });
            }
          } else if (data.status === 'error') {
            eventSource.close();
            setError(data.error || 'Generation failed');
            setView('setup');
          }
        } catch (err) {
          console.error('Failed to parse SSE message:', err);
        }
      };

      eventSource.onerror = (err) => {
        console.error('SSE error:', err);
        eventSource.close();
        // Poll session status as fallback
        pollSessionStatus(sessionResult.session_id);
      };

      // Trigger generation
      await api.startPodcastGeneration(sessionResult.session_id);

    } catch (err) {
      console.error('Failed to start podcast:', err);
      setError(err.message || 'Failed to start podcast session');
      setView('setup');
    }
  };

  // Fallback polling for generation status
  const pollSessionStatus = async (sessionId) => {
    const poll = async () => {
      try {
        const sessionData = await api.getPodcastSession(sessionId);
        setGenerationProgress(sessionData.generation_progress || 0);

        // Update status message
        if (sessionData.generation_message) {
          setGenerationStatus(sessionData.generation_message);
        }

        if (sessionData.status === 'ready') {
          setSession(sessionData);
          setPlayerSession(sessionData);
          setView('player');
          return;
        } else if (sessionData.status === 'error') {
          setError(sessionData.error || 'Generation failed');
          setView('setup');
          return;
        }

        // Continue polling
        setTimeout(poll, 1000);
      } catch (err) {
        console.error('Poll failed:', err);
        setError('Failed to check generation status');
        setView('setup');
      }
    };
    poll();
  };

  // End podcast session
  const handleEndPodcast = async () => {
    if (session?.session_id) {
      try {
        await api.endPodcastSession(session.session_id);
      } catch (err) {
        console.error('Failed to end session:', err);
      }
    }
    setSession(null);
    setView('setup');
  };

  // Handle minimize - keep playing in MiniPlayer
  const handleMinimize = () => {
    if (session) {
      setPlayerSession(session);
      minimize();
    }
    if (onClose) {
      onClose();
    }
  };

  // Loading state
  if (checkingSettings) {
    return (
      <div className="podcast-interface">
        <div className="podcast-loading">
          <Loader2 className="spin" size={24} />
          <span>Checking configuration...</span>
        </div>
      </div>
    );
  }

  // Setup required - check TTS health instead of ElevenLabs
  if (!ttsHealthy) {
    return (
      <div className="podcast-interface">
        <div className="podcast-setup-required">
          <AlertCircle size={48} className="warning-icon" />
          <h2>Setup Required</h2>
          <p>To use Podcast mode, ensure the TTS service is running:</p>

          <div className="config-checklist">
            <div className={`config-item ${ttsHealthy ? 'configured' : 'not-configured'}`}>
              <span className="config-status">
                {ttsHealthy ? '\u2713' : '\u2717'}
              </span>
              <span className="config-label">Qwen3-TTS Service</span>
              <span className="config-desc">For text-to-speech voice generation</span>
            </div>
          </div>

          <button
            className="open-settings-btn"
            onClick={() => onOpenSettings?.('podcast')}
          >
            <Settings size={16} />
            Open Podcast Settings
          </button>
          {onClose && (
            <button className="back-to-gallery-btn" onClick={onClose}>
              <ArrowLeft size={16} />
              Back to Gallery
            </button>
          )}
        </div>
      </div>
    );
  }

  // Check if we have enough characters
  const hasEnoughCharacters = characters.length >= (episodeMode === 'explainer' ? 1 : 2);

  // Generating view with stepper
  if (view === 'generating') {
    const steps = [
      { id: 'starting', label: 'Initializing', description: 'Setting up session' },
      { id: 'writing_script', label: 'Writing Script', description: 'AI is writing the dialogue' },
      { id: 'generating_audio', label: 'Generating Audio', description: audioTotalSegments > 0 ? `Segment ${audioCurrentSegment} of ${audioTotalSegments}` : 'Preparing voice synthesis' },
      { id: 'finalizing', label: 'Finalizing', description: 'Saving and processing' },
    ];

    const stepOrder = ['starting', 'writing_script', 'generating_audio', 'finalizing', 'complete'];
    const currentStepIndex = stepOrder.indexOf(generationStep);

    return (
      <div className="podcast-interface">
        <div className="podcast-generating">
          <h2>Generating Podcast</h2>

          <div className="generation-stepper">
            {steps.map((step, index) => {
              const stepIndex = stepOrder.indexOf(step.id);
              const isComplete = currentStepIndex > stepIndex;
              const isCurrent = currentStepIndex === stepIndex;
              const isPending = currentStepIndex < stepIndex;

              return (
                <div
                  key={step.id}
                  className={`stepper-item ${isComplete ? 'complete' : ''} ${isCurrent ? 'current' : ''} ${isPending ? 'pending' : ''}`}
                >
                  <div className="stepper-indicator">
                    {isComplete ? (
                      <span className="checkmark">&#10003;</span>
                    ) : isCurrent ? (
                      <Loader2 className="spin" size={16} />
                    ) : (
                      <span className="step-number">{index + 1}</span>
                    )}
                  </div>
                  <div className="stepper-content">
                    <div className="stepper-label">{step.label}</div>
                    <div className="stepper-description">{step.description}</div>
                  </div>
                </div>
              );
            })}
          </div>

          {error && (
            <div className="podcast-error stepper-error">
              <AlertCircle size={16} />
              {error}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Player view
  if (view === 'player' && session) {
    return (
      <div className="podcast-interface">
        <PodcastPlayer
          session={session}
          onEnd={handleEndPodcast}
          onMinimize={handleMinimize}
          onSelectConversation={onSelectConversation}
        />
      </div>
    );
  }

  // Get character options for dropdowns
  const narratorOptions = characters;
  const hostOptions = characters;
  const expertOptions = characters.filter(c => c.id !== selectedHost);

  // Setup view
  return (
    <div className="podcast-interface">
      <div className="podcast-setup">
        <div className="setup-header">
          {onClose && (
            <button className="back-btn" onClick={onClose} title="Back to Gallery">
              <ArrowLeft size={20} />
            </button>
          )}
          <Radio size={24} />
          <h2>New Podcast</h2>
        </div>

        <p className="setup-description">
          Generate an audio explanation of your Synthesizer notes.
        </p>

        {error && (
          <div className="podcast-error">
            <AlertCircle size={16} />
            {error}
          </div>
        )}

        {/* Episode Mode Selection */}
        <div className="setup-section">
          <label>Episode Mode</label>
          <div className="mode-selector">
            <button
              className={`mode-option ${episodeMode === 'explainer' ? 'selected' : ''}`}
              onClick={() => setEpisodeMode('explainer')}
            >
              <Mic size={20} />
              <div className="mode-info">
                <span className="mode-name">Explainer</span>
                <span className="mode-desc">Single narrator explains the content</span>
              </div>
            </button>
            <button
              className={`mode-option ${episodeMode === 'question_time' ? 'selected' : ''}`}
              onClick={() => setEpisodeMode('question_time')}
            >
              <MessageSquare size={20} />
              <div className="mode-info">
                <span className="mode-name">Question Time</span>
                <span className="mode-desc">Host interviews an expert</span>
              </div>
            </button>
          </div>
        </div>

        {/* Character Selection */}
        <div className="setup-section">
          <label>
            <Users size={16} />
            Character Selection
          </label>
          {loadingCharacters ? (
            <div className="loading-characters">
              <Loader2 className="spin" size={16} />
              Loading characters...
            </div>
          ) : !hasEnoughCharacters ? (
            <div className="characters-warning">
              <AlertCircle size={16} />
              <span>
                {episodeMode === 'explainer'
                  ? 'You need at least 1 character. Create one in Settings.'
                  : 'You need at least 2 characters for Question Time. Create more in Settings.'}
              </span>
              <button
                className="btn-link"
                onClick={() => onOpenSettings?.('podcast')}
              >
                Open Settings
              </button>
            </div>
          ) : episodeMode === 'explainer' ? (
            <div className="character-select-row">
              <label>Narrator</label>
              <select
                value={selectedNarrator || ''}
                onChange={(e) => setSelectedNarrator(e.target.value)}
              >
                <option value="">Select narrator...</option>
                {narratorOptions.map(char => (
                  <option key={char.id} value={char.id}>
                    {char.name} ({char.personality?.speaking_role || 'narrator'})
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <>
              <div className="character-select-row">
                <label>Host</label>
                <select
                  value={selectedHost || ''}
                  onChange={(e) => setSelectedHost(e.target.value)}
                >
                  <option value="">Select host...</option>
                  {hostOptions.map(char => (
                    <option key={char.id} value={char.id}>
                      {char.name} ({char.personality?.speaking_role || 'host'})
                    </option>
                  ))}
                </select>
              </div>
              <div className="character-select-row">
                <label>Expert</label>
                <select
                  value={selectedExpert || ''}
                  onChange={(e) => setSelectedExpert(e.target.value)}
                  disabled={!selectedHost}
                >
                  <option value="">Select expert...</option>
                  {expertOptions.map(char => (
                    <option key={char.id} value={char.id}>
                      {char.name} ({char.personality?.speaking_role || 'expert'})
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}
        </div>

        {/* KG Discovery Toggle */}
        <div className="setup-section">
          <label className="toggle-label">
            <input
              type="checkbox"
              checked={useKgDiscovery}
              onChange={(e) => {
                setUseKgDiscovery(e.target.checked);
                if (!e.target.checked) {
                  setKgDiscoveredNotes([]);
                  setKgTopic('');
                }
              }}
            />
            <Compass size={16} />
            <span>Discover from Knowledge Graph</span>
          </label>
          <p className="section-hint">
            Find related notes by topic instead of selecting a specific conversation.
          </p>
        </div>

        {/* Source Selection */}
        {useKgDiscovery ? (
          <div className="setup-section">
            <label>Topic Discovery</label>
            <div className="kg-discovery-input">
              <input
                type="text"
                value={kgTopic}
                onChange={(e) => setKgTopic(e.target.value)}
                placeholder="Enter a topic to discover related notes..."
                onKeyDown={(e) => e.key === 'Enter' && handleKgDiscover()}
              />
              <button
                className="btn-discover"
                onClick={handleKgDiscover}
                disabled={!kgTopic.trim() || isDiscovering}
              >
                {isDiscovering ? <Loader2 className="spin" size={16} /> : <Search size={16} />}
                Discover
              </button>
            </div>
            {kgDiscoveredNotes.length > 0 && (
              <div className="discovered-notes">
                <p className="discovered-count">Found {kgDiscoveredNotes.length} related notes</p>
                <div className="discovered-list">
                  {kgDiscoveredNotes.map(note => (
                    <div key={note.id} className="discovered-note">
                      <FileText size={14} />
                      <span>{note.title || 'Untitled'}</span>
                      <span className="note-score">{Math.round(note.score * 100)}%</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : preSelectedConversationId && selectedConversation ? (
          <div className="setup-section">
            <label>Source Notes</label>
            <div className="selected-note-badge">
              <FileText size={18} />
              <div className="selected-note-info">
                <span className="selected-note-title">{selectedConversation.title || 'Untitled'}</span>
                <span className="selected-note-date">
                  {new Date(selectedConversation.created_at).toLocaleDateString()}
                </span>
              </div>
              <button
                className="change-note-btn"
                onClick={() => setSelectedConvId(null)}
                title="Choose a different note"
              >
                Change
              </button>
            </div>
          </div>
        ) : (
          <div className="setup-section">
            <label>Source Notes</label>
            <p className="section-hint">Select a Synthesizer conversation to narrate</p>

            <div className="source-search">
              <Search size={16} className="search-icon" />
              <input
                type="text"
                placeholder="Search notes..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="source-search-input"
              />
              {isSearching && <Loader2 className="spin search-loader" size={14} />}
            </div>

            {loadingConversations ? (
              <div className="loading-conversations">
                <Loader2 className="spin" size={16} />
                Loading conversations...
              </div>
            ) : synthConversations.length === 0 ? (
              <div className="no-conversations">
                <FileText size={24} />
                <p>No Synthesizer conversations found.</p>
                <p className="hint">Create notes in Synthesizer mode first.</p>
              </div>
            ) : (
              <div className="conversation-list">
                {(searchQuery.trim() ? searchResults : synthConversations.slice(0, 5)).map(conv => (
                  <button
                    key={conv.id}
                    className={`conversation-item ${selectedConvId === conv.id ? 'selected' : ''}`}
                    onClick={() => setSelectedConvId(conv.id)}
                  >
                    <FileText size={16} />
                    <span className="conv-title">{conv.title || 'Untitled'}</span>
                    <span className="conv-date">
                      {new Date(conv.created_at).toLocaleDateString()}
                    </span>
                    {selectedConvId === conv.id && <ChevronRight size={16} />}
                  </button>
                ))}
                {searchQuery.trim() && searchResults.length === 0 && !isSearching && (
                  <div className="no-search-results">
                    No matching notes found
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Style Selection */}
        <div className="setup-section">
          <label>Narration Style</label>
          <div className="style-options">
            {stylesLoading ? (
              <div className="styles-loading">
                <Loader2 className="spin" size={16} />
                Loading styles...
              </div>
            ) : Object.keys(narrationStyles).length === 0 ? (
              <div className="no-styles">
                No narration styles configured. Add styles in Settings.
              </div>
            ) : (
              Object.entries(narrationStyles).map(([styleId, styleData]) => (
                <button
                  key={styleId}
                  className={`style-option ${style === styleId ? 'selected' : ''}`}
                  onClick={() => setStyle(styleId)}
                >
                  <span className="style-name">{styleData.name}</span>
                  <span className="style-desc">{styleData.description}</span>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Start Button */}
        <button
          className="start-podcast-btn"
          disabled={
            (!selectedConvId && !kgDiscoveredNotes.length) ||
            !isCharacterSelectionValid ||
            !hasEnoughCharacters
          }
          onClick={handleStartPodcast}
        >
          <Play size={18} />
          Generate Podcast
        </button>
      </div>
    </div>
  );
}

/**
 * PodcastPlayer - Audio player with teleprompter sync.
 */
function PodcastPlayer({ session, onEnd, onMinimize, onSelectConversation }) {
  const audioRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [duration, setDuration] = useState(0);

  // Word timing state
  const [wordTimings, setWordTimings] = useState([]);
  const [dialogueSegments, setDialogueSegments] = useState([]);
  const [currentWordIndex, setCurrentWordIndex] = useState(0);

  // Cover art
  const [coverUrl, setCoverUrl] = useState(null);
  const [coverLoading, setCoverLoading] = useState(true);

  // Load session data with timings
  useEffect(() => {
    if (!session) return;

    setWordTimings(session.word_timings || []);
    setDialogueSegments(session.dialogue_segments || []);

    if (session.cover_url) {
      setCoverUrl(session.cover_url);
      setCoverLoading(false);
    }
  }, [session]);

  // Poll for cover art if not ready
  useEffect(() => {
    if (coverUrl || !session?.session_id) return;

    let mounted = true;
    const pollCover = async () => {
      try {
        const data = await api.getPodcastSession(session.session_id);
        if (mounted && data?.cover_url) {
          setCoverUrl(data.cover_url);
          setCoverLoading(false);
        }
      } catch (err) {
        console.debug('Cover not ready');
      }
    };

    const interval = setInterval(pollCover, 3000);
    pollCover();

    const timeout = setTimeout(() => setCoverLoading(false), 60000);

    return () => {
      mounted = false;
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [session?.session_id, coverUrl]);

  // Sync teleprompter with audio time
  useEffect(() => {
    if (!wordTimings.length) return;

    // Find current word based on currentTimeMs
    let foundIndex = 0;
    for (let i = wordTimings.length - 1; i >= 0; i--) {
      if (wordTimings[i].start_ms <= currentTimeMs) {
        foundIndex = i;
        break;
      }
    }
    setCurrentWordIndex(foundIndex);
  }, [currentTimeMs, wordTimings]);

  // Audio event handlers
  const handleTimeUpdate = useCallback(() => {
    if (audioRef.current) {
      setCurrentTimeMs(audioRef.current.currentTime * 1000);
    }
  }, []);

  const handleLoadedMetadata = useCallback(() => {
    if (audioRef.current) {
      setDuration(audioRef.current.duration);
    }
  }, []);

  const handleEnded = useCallback(() => {
    setIsPlaying(false);
  }, []);

  // Playback controls
  const togglePlayPause = useCallback(() => {
    if (!audioRef.current) return;

    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
    setIsPlaying(!isPlaying);
  }, [isPlaying]);

  const handleSeek = useCallback((e) => {
    if (!audioRef.current) return;
    const newTime = parseFloat(e.target.value);
    audioRef.current.currentTime = newTime;
    setCurrentTimeMs(newTime * 1000);
  }, []);

  const skipBackward = useCallback(() => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = Math.max(0, audioRef.current.currentTime - 10);
  }, []);

  const skipForward = useCallback(() => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = Math.min(duration, audioRef.current.currentTime + 10);
  }, [duration]);

  // Emoji reaction handler
  const handleReaction = useCallback(async (emoji) => {
    if (!session?.session_id) return;
    try {
      await api.addPodcastReaction(session.session_id, emoji, Math.round(currentTimeMs));
    } catch (err) {
      console.error('Failed to save reaction:', err);
    }
  }, [session?.session_id, currentTimeMs]);

  // Format time display
  const formatTime = (ms) => {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  // Build script for teleprompter from dialogue segments
  const script = useMemo(() => {
    return dialogueSegments.map((seg, idx) => ({
      text: seg.text,
      speaker: seg.speaker,
      words: seg.text.split(/\s+/).map(word => ({ word, start: 0, end: 0 })),
    }));
  }, [dialogueSegments]);

  // Find current segment and word within segment
  const { currentSegmentIndex, currentWordInSegment } = useMemo(() => {
    if (!wordTimings.length || currentWordIndex >= wordTimings.length) {
      return { currentSegmentIndex: 0, currentWordInSegment: 0 };
    }

    const timing = wordTimings[currentWordIndex];
    return {
      currentSegmentIndex: timing?.segment_index || 0,
      currentWordInSegment: timing?.word_index || 0,
    };
  }, [wordTimings, currentWordIndex]);

  const audioUrl = api.getPodcastAudioUrl(session?.session_id);

  return (
    <div className="podcast-player">
      {/* Hidden audio element */}
      <audio
        ref={audioRef}
        src={audioUrl}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={handleEnded}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
      />

      {/* Header */}
      <div className="player-header">
        <div className="session-info">
          <Radio size={20} className={isPlaying ? 'pulse' : ''} />
          <div>
            <h3>{session?.title || 'Podcast'}</h3>
            <span className="status">
              {isPlaying ? 'Playing' : 'Paused'}
            </span>
          </div>
        </div>
        <div className="player-controls-header">
          <ActionMenu>
            {session?.source_id && onSelectConversation && (
              <ActionMenu.Item
                icon={<FileText size={16} />}
                label="View Source Notes"
                onClick={() => onSelectConversation(session.source_id)}
              />
            )}
            {session?.session_id && (
              <ActionMenu.Item
                icon={<Download size={16} />}
                label="Download Audio"
                onClick={() => window.open(api.getPodcastAudioUrl(session.session_id), '_blank')}
              />
            )}
          </ActionMenu>
          {onMinimize && (
            <button className="minimize-btn" onClick={onMinimize} title="Minimize player">
              <Minimize2 size={16} />
            </button>
          )}
          <button className="end-btn" onClick={onEnd}>
            <Square size={16} />
            Close
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div className="audio-progress">
        <span className="time-display">{formatTime(currentTimeMs)}</span>
        <input
          type="range"
          min="0"
          max={duration || 0}
          step="0.1"
          value={currentTimeMs / 1000}
          onChange={handleSeek}
          className="progress-slider"
        />
        <span className="time-display">{formatTime(duration * 1000)}</span>
      </div>

      {/* Playback controls */}
      <div className="playback-controls">
        <button onClick={skipBackward} className="skip-btn" title="Back 10s">
          <SkipBack size={20} />
        </button>
        <button onClick={togglePlayPause} className="play-pause-btn">
          {isPlaying ? <Pause size={24} /> : <Play size={24} />}
        </button>
        <button onClick={skipForward} className="skip-btn" title="Forward 10s">
          <SkipForward size={20} />
        </button>
      </div>

      {/* Main Content: Cover + Teleprompter */}
      <div className="player-content">
        {/* Cover Art */}
        <div className="cover-art-container">
          {coverUrl ? (
            <img
              src={`${api.getBaseUrl()}${coverUrl}`}
              alt="Podcast cover"
              className="cover-art"
            />
          ) : (
            <div className="cover-art-placeholder">
              {coverLoading ? (
                <>
                  <Loader2 className="spin" size={32} />
                  <span>Generating cover...</span>
                </>
              ) : (
                <>
                  <ImageIcon size={48} />
                  <span>{session?.title?.substring(0, 2)?.toUpperCase() || 'PC'}</span>
                </>
              )}
            </div>
          )}
        </div>

        {/* Teleprompter */}
        <div className="teleprompter-container">
          <Teleprompter
            script={script}
            currentSegmentIndex={currentSegmentIndex}
            currentWordIndex={currentWordInSegment}
            isPlaying={isPlaying}
            wordTimings={wordTimings}
          />
        </div>
      </div>

      {/* Emoji Reactions */}
      <div className="player-controls">
        <EmojiReactions onReaction={handleReaction} />
      </div>
    </div>
  );
}
