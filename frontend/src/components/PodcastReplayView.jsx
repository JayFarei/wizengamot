import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Play,
  Pause,
  Radio,
  FileText,
  Clock,
  Volume2,
  VolumeX,
  Loader2,
  SkipBack,
  SkipForward,
  ExternalLink,
} from 'lucide-react';
import { api } from '../api';
import Teleprompter, { findCurrentWord } from './Teleprompter';
import './PodcastReplayView.css';

/**
 * PodcastReplayView - View and replay completed podcast sessions.
 *
 * Features:
 * - Full-width two-column layout
 * - Audio playback for recorded podcasts
 * - Teleprompter with word-level sync
 * - Reaction timeline with markers
 * - Navigate to source notes
 */
export default function PodcastReplayView({ sessionId, onClose, onNavigateToNote }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [reactions, setReactions] = useState([]);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);

  // Teleprompter state
  const [script, setScript] = useState([]);
  const [wordTimings, setWordTimings] = useState([]);
  const [currentSegmentIndex, setCurrentSegmentIndex] = useState(0);
  const [currentWordIndex, setCurrentWordIndex] = useState(0);

  const SPEED_OPTIONS = [1, 1.25, 1.5, 2];

  const audioRef = useRef(null);

  // Convert word timings to script format for teleprompter
  // Also adds word_index to each timing since backend doesn't store it
  const convertTimingsToScript = useCallback((timings) => {
    if (!timings || timings.length === 0) return { script: [], timingsWithIndex: [] };

    const segments = {};
    const wordCountPerSegment = {};
    const timingsWithIndex = [];

    timings.forEach(t => {
      const segIdx = t.segment_index;
      if (!segments[segIdx]) {
        segments[segIdx] = { words: [], speaker: t.speaker };
        wordCountPerSegment[segIdx] = 0;
      }

      // Compute word_index within segment
      const wordIdx = wordCountPerSegment[segIdx];
      wordCountPerSegment[segIdx]++;

      segments[segIdx].words.push({
        word: t.word,
        start: t.start_ms,
        end: t.end_ms
      });

      // Store timing with computed word_index
      timingsWithIndex.push({
        ...t,
        word_index: wordIdx
      });
    });

    // Convert to array and ensure proper order
    const script = Object.keys(segments)
      .sort((a, b) => parseInt(a) - parseInt(b))
      .map(key => segments[key]);

    return { script, timingsWithIndex };
  }, []);

  // Load session data
  useEffect(() => {
    const loadSession = async () => {
      try {
        setLoading(true);
        const sessionData = await api.getPodcastSession(sessionId);
        setSession(sessionData);

        // Load reactions
        const reactionsData = await api.getPodcastReactions(sessionId);
        setReactions(reactionsData?.reactions || []);

        // Load word timings for teleprompter
        try {
          const timingsData = await api.getPodcastWordTimings(sessionId);
          const timings = timingsData.word_timings || [];
          // Convert timings to script format and add word_index to timings
          const { script: scriptData, timingsWithIndex } = convertTimingsToScript(timings);
          setWordTimings(timingsWithIndex);
          setScript(scriptData);
        } catch (timingErr) {
          // Word timings may not be available for older sessions
          console.log('Teleprompter not available:', timingErr.message);
        }
      } catch (err) {
        console.error('Failed to load podcast session:', err);
        setError(err.message || 'Failed to load podcast');
      } finally {
        setLoading(false);
      }
    };

    loadSession();
  }, [sessionId, convertTimingsToScript]);

  // Sync playback speed with audio element
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackSpeed;
    }
  }, [playbackSpeed]);

  // Update current word based on playback time
  useEffect(() => {
    if (wordTimings.length > 0) {
      const { segmentIndex, wordIndex } = findCurrentWord(wordTimings, currentTime);
      setCurrentSegmentIndex(segmentIndex);
      setCurrentWordIndex(wordIndex);
    }
  }, [currentTime, wordTimings]);

  // Audio event handlers
  const handleTimeUpdate = useCallback(() => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime * 1000); // Convert to ms
    }
  }, []);

  const handleLoadedMetadata = useCallback(() => {
    if (audioRef.current) {
      setDuration(audioRef.current.duration * 1000); // Convert to ms
    }
  }, []);

  const handleEnded = useCallback(() => {
    setIsPlaying(false);
    setCurrentTime(0);
  }, []);

  // Playback controls
  const togglePlay = useCallback(() => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
      } else {
        audioRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  }, [isPlaying]);

  const toggleMute = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.muted = !isMuted;
      setIsMuted(!isMuted);
    }
  }, [isMuted]);

  const handleVolumeChange = useCallback((e) => {
    const newVolume = parseFloat(e.target.value);
    setVolume(newVolume);
    if (audioRef.current) {
      audioRef.current.volume = newVolume;
    }
    if (newVolume === 0) {
      setIsMuted(true);
    } else if (isMuted) {
      setIsMuted(false);
    }
  }, [isMuted]);

  const seekTo = useCallback((timeMs) => {
    if (audioRef.current) {
      audioRef.current.currentTime = timeMs / 1000;
      setCurrentTime(timeMs);
    }
  }, []);

  const handleProgressClick = useCallback((e) => {
    if (!duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const percent = (e.clientX - rect.left) / rect.width;
    seekTo(percent * duration);
  }, [duration, seekTo]);

  const skip = useCallback((seconds) => {
    if (audioRef.current) {
      const newTime = Math.max(0, Math.min(duration / 1000, audioRef.current.currentTime + seconds));
      audioRef.current.currentTime = newTime;
      setCurrentTime(newTime * 1000);
    }
  }, [duration]);

  // Format time as MM:SS
  const formatTime = (ms) => {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  // Handle source note navigation
  const handleSourceNoteClick = useCallback(() => {
    if (session?.source_conversation_id && onNavigateToNote) {
      onNavigateToNote(session.source_conversation_id);
    }
  }, [session?.source_conversation_id, onNavigateToNote]);

  // Handle clicking a word in teleprompter to seek to that position
  const handleWordClick = useCallback((segmentIdx, wordIdx) => {
    const timing = wordTimings.find(
      t => t.segment_index === segmentIdx && t.word_index === wordIdx
    );
    if (timing && audioRef.current) {
      audioRef.current.currentTime = timing.start_ms / 1000;
      setCurrentTime(timing.start_ms);
    }
  }, [wordTimings]);

  // Loading state
  if (loading) {
    return (
      <div className="podcast-replay-view">
        <div className="replay-loading">
          <Loader2 className="spin" size={32} />
          <span>Loading podcast...</span>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="podcast-replay-view">
        <div className="replay-error">
          <p>{error}</p>
          <button onClick={onClose}>Go Back</button>
        </div>
      </div>
    );
  }

  // No audio available
  const hasAudio = session?.audio_path;

  return (
    <div className="podcast-replay-view">
      {/* Header */}
      <div className="replay-header">
        <button className="replay-back-btn" onClick={onClose} title="Back">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <div className="replay-header-content">
          <div className="replay-title-row">
            <Radio size={18} className="replay-radio-icon" />
            <h1>{session?.title || 'Podcast'}</h1>
          </div>
          <div className="replay-meta-row">
            {session?.style && (
              <span className="replay-style-badge">
                {session.style.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
              </span>
            )}
            {session?.created_at && (
              <span className="replay-date">
                {new Date(session.created_at).toLocaleDateString()}
              </span>
            )}
            {duration > 0 && (
              <span className="replay-duration">{formatTime(duration)}</span>
            )}
          </div>
        </div>
        {session?.source_conversation_id && onNavigateToNote && (
          <button className="replay-source-btn" onClick={handleSourceNoteClick}>
            <FileText size={16} />
            <span>View Source</span>
            <ExternalLink size={14} />
          </button>
        )}
      </div>

      {/* Main Content - Two Column Layout */}
      <div className="replay-main">
        {/* Left Column - Cover & Info */}
        <div className="replay-left-column">
          {/* Cover Art */}
          <div className="replay-cover-container">
            {session?.cover_url ? (
              <img
                src={`${api.getBaseUrl()}${session.cover_url}`}
                alt="Podcast cover"
                className="replay-cover"
              />
            ) : (
              <div className="replay-cover-placeholder">
                <Radio size={48} />
                <span>{session?.title?.substring(0, 2)?.toUpperCase() || 'PC'}</span>
              </div>
            )}
          </div>

          {/* Session Info Card */}
          <div className="replay-info-card">
            <div className="info-item">
              <Clock size={14} />
              <span>
                {session?.created_at
                  ? new Date(session.created_at).toLocaleString()
                  : 'Unknown'}
              </span>
            </div>
            {session?.note_count > 0 && (
              <div className="info-item">
                <FileText size={14} />
                <span>{session.note_count} source notes</span>
              </div>
            )}
            {reactions.length > 0 && (
              <div className="info-item reactions-preview">
                {reactions.slice(0, 5).map((r, i) => (
                  <span key={i} className="reaction-emoji-small">{r.emoji}</span>
                ))}
                {reactions.length > 5 && (
                  <span className="reaction-count">+{reactions.length - 5}</span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right Column - Teleprompter */}
        <div className="replay-right-column">
          {script.length > 0 ? (
            <div className="replay-teleprompter-wrapper">
              <Teleprompter
                script={script}
                currentSegmentIndex={currentSegmentIndex}
                currentWordIndex={currentWordIndex}
                isPlaying={isPlaying}
                wordTimings={wordTimings}
                onWordClick={handleWordClick}
              />
            </div>
          ) : (
            <div className="replay-no-transcript">
              <FileText size={32} />
              <p>Transcript not available</p>
            </div>
          )}
        </div>
      </div>

      {/* Player Controls - Bottom */}
      {hasAudio ? (
        <div className="replay-player">
          <audio
            ref={audioRef}
            src={api.getPodcastAudioUrl(sessionId)}
            onTimeUpdate={handleTimeUpdate}
            onLoadedMetadata={handleLoadedMetadata}
            onEnded={handleEnded}
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
          />

          {/* Progress Bar */}
          <div className="replay-progress-container" onClick={handleProgressClick}>
            <div className="replay-progress-bar">
              <div
                className="replay-progress-fill"
                style={{ width: `${duration ? (currentTime / duration) * 100 : 0}%` }}
              />
            </div>
            {/* Reaction markers on progress bar */}
            {reactions.map((reaction, idx) => (
              <div
                key={idx}
                className="replay-reaction-marker"
                style={{
                  left: `${duration ? (reaction.timestamp_ms / duration) * 100 : 0}%`
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  seekTo(reaction.timestamp_ms);
                }}
                title={`${reaction.emoji} at ${formatTime(reaction.timestamp_ms)}`}
              >
                {reaction.emoji}
              </div>
            ))}
          </div>

          {/* Controls Row */}
          <div className="replay-controls-row">
            {/* Time Display */}
            <div className="replay-time-display">
              <span className="current-time">{formatTime(currentTime)}</span>
              <span className="time-separator">/</span>
              <span className="total-time">{formatTime(duration)}</span>
            </div>

            {/* Playback Controls */}
            <div className="replay-playback-controls">
              <button className="replay-skip-btn" onClick={() => skip(-10)} title="Back 10s">
                <SkipBack size={18} />
              </button>

              <button className="replay-play-btn" onClick={togglePlay}>
                {isPlaying ? <Pause size={22} /> : <Play size={22} />}
              </button>

              <button className="replay-skip-btn" onClick={() => skip(10)} title="Forward 10s">
                <SkipForward size={18} />
              </button>
            </div>

            {/* Right Controls */}
            <div className="replay-right-controls">
              {/* Volume */}
              <div className="replay-volume-control">
                <button className="replay-volume-btn" onClick={toggleMute}>
                  {isMuted || volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
                </button>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.1"
                  value={isMuted ? 0 : volume}
                  onChange={handleVolumeChange}
                  className="replay-volume-slider"
                />
              </div>

              {/* Speed */}
              <div className="replay-speed-control">
                {SPEED_OPTIONS.map(speed => (
                  <button
                    key={speed}
                    className={`replay-speed-btn ${playbackSpeed === speed ? 'active' : ''}`}
                    onClick={() => setPlaybackSpeed(speed)}
                  >
                    {speed}x
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="replay-no-audio">
          <VolumeX size={24} />
          <span>No audio recording available</span>
        </div>
      )}
    </div>
  );
}
