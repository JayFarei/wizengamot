import { createContext, useContext, useState, useRef, useCallback, useEffect } from 'react';

/**
 * PodcastPlayerContext - Global state for podcast audio playback.
 *
 * This context allows the podcast player to persist across mode changes,
 * enabling users to continue listening while browsing other parts of the app.
 *
 * Integration points (to be implemented in integration phase):
 * - App.jsx: Wrap with PodcastPlayerProvider, render MiniPlayer at root level
 * - PodcastInterface.jsx: Add minimize button, use context for audio state sharing
 */

const PodcastPlayerContext = createContext({
  // Session data
  session: null,

  // Playback state
  isPlaying: false,
  isMinimized: false,
  currentTime: 0,
  duration: 0,

  // Audio element ref (managed by context)
  audioRef: null,

  // Actions
  minimize: () => {},
  expand: () => {},
  play: () => {},
  pause: () => {},
  seek: (time) => {},
  setSession: (session) => {},
  clearSession: () => {},
});

export function PodcastPlayerProvider({ children, onExpand }) {
  const audioRef = useRef(null);

  // Session state
  const [session, setSessionState] = useState(null);

  // Playback state
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  // Set up audio element and event listeners
  useEffect(() => {
    if (!audioRef.current) {
      audioRef.current = new Audio();
    }

    const audio = audioRef.current;

    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
    };

    const handleLoadedMetadata = () => {
      setDuration(audio.duration);
    };

    const handleEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };

    const handlePlay = () => {
      setIsPlaying(true);
    };

    const handlePause = () => {
      setIsPlaying(false);
    };

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePause);

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handlePause);
    };
  }, []);

  // Set session and load audio
  const setSession = useCallback((newSession) => {
    setSessionState(newSession);

    if (newSession && audioRef.current) {
      // Construct audio URL - this matches the pattern in PodcastInterface
      const baseUrl = import.meta.env.DEV ? 'http://localhost:8001' : '';
      const audioUrl = `${baseUrl}/api/podcast/${newSession.session_id}/audio`;

      // Only load if different from current
      if (audioRef.current.src !== audioUrl) {
        audioRef.current.src = audioUrl;
        audioRef.current.load();
      }
    }
  }, []);

  // Clear session and stop playback
  const clearSession = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
    }
    setSessionState(null);
    setIsPlaying(false);
    setIsMinimized(false);
    setCurrentTime(0);
    setDuration(0);
  }, []);

  // Minimize player
  const minimize = useCallback(() => {
    setIsMinimized(true);
  }, []);

  // Expand player (return to full view)
  const expand = useCallback(() => {
    setIsMinimized(false);
    if (onExpand && session) {
      onExpand(session);
    }
  }, [onExpand, session]);

  // Play audio
  const play = useCallback(() => {
    if (audioRef.current && session) {
      audioRef.current.play().catch(err => {
        console.error('Failed to play audio:', err);
      });
    }
  }, [session]);

  // Pause audio
  const pause = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
    }
  }, []);

  // Seek to specific time
  const seek = useCallback((time) => {
    if (audioRef.current) {
      audioRef.current.currentTime = time;
      setCurrentTime(time);
    }
  }, []);

  const value = {
    session,
    isPlaying,
    isMinimized,
    currentTime,
    duration,
    audioRef,
    minimize,
    expand,
    play,
    pause,
    seek,
    setSession,
    clearSession,
  };

  return (
    <PodcastPlayerContext.Provider value={value}>
      {children}
    </PodcastPlayerContext.Provider>
  );
}

export function usePodcastPlayer() {
  const context = useContext(PodcastPlayerContext);
  if (!context) {
    throw new Error('usePodcastPlayer must be used within PodcastPlayerProvider');
  }
  return context;
}

export default PodcastPlayerContext;
