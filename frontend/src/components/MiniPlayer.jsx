import React, { useCallback, useMemo } from 'react';
import { Play, Pause, Maximize2, X, Radio } from 'lucide-react';
import { usePodcastPlayer } from '../contexts/PodcastPlayerContext';
import './MiniPlayer.css';

/**
 * MiniPlayer - Floating minimized podcast player.
 *
 * Features:
 * - Fixed bottom-right positioning
 * - Episode title (truncated)
 * - Play/pause toggle
 * - Clickable progress bar for seeking
 * - Time display (current / total)
 * - Expand button to return to full player
 * - Close button to stop and dismiss
 *
 * Integration points (to be implemented in integration phase):
 * - App.jsx: Render <MiniPlayer /> at root level, outside main content area
 * - PodcastInterface.jsx: Use minimize() from context when user clicks minimize button
 */
export default function MiniPlayer() {
  const {
    session,
    isPlaying,
    isMinimized,
    currentTime,
    duration,
    play,
    pause,
    seek,
    expand,
    clearSession,
  } = usePodcastPlayer();

  // Format time as MM:SS
  const formatTime = useCallback((seconds) => {
    if (!seconds || isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }, []);

  // Calculate progress percentage
  const progress = useMemo(() => {
    if (!duration || duration === 0) return 0;
    return (currentTime / duration) * 100;
  }, [currentTime, duration]);

  // Handle progress bar click for seeking
  const handleProgressClick = useCallback((e) => {
    const bar = e.currentTarget;
    const rect = bar.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const percentage = clickX / rect.width;
    const newTime = percentage * duration;
    seek(newTime);
  }, [duration, seek]);

  // Toggle play/pause
  const handlePlayPause = useCallback(() => {
    if (isPlaying) {
      pause();
    } else {
      play();
    }
  }, [isPlaying, play, pause]);

  // Close and clear session
  const handleClose = useCallback(() => {
    clearSession();
  }, [clearSession]);

  // Expand to full player
  const handleExpand = useCallback(() => {
    expand();
  }, [expand]);

  // Truncate title to ~30 characters
  const truncatedTitle = useMemo(() => {
    const title = session?.title || 'Podcast';
    if (title.length <= 30) return title;
    return title.substring(0, 27) + '...';
  }, [session?.title]);

  // Only render when minimized and session exists
  if (!isMinimized || !session) {
    return null;
  }

  return (
    <div className="mini-player">
      {/* Thumbnail/Icon */}
      <div className="mini-player-thumbnail">
        <Radio size={20} className={isPlaying ? 'pulse' : ''} />
      </div>

      {/* Info Section */}
      <div className="mini-player-info">
        <span className="mini-player-title" title={session?.title}>
          {truncatedTitle}
        </span>

        {/* Progress Bar */}
        <div
          className="mini-player-progress"
          onClick={handleProgressClick}
          role="slider"
          aria-valuemin={0}
          aria-valuemax={duration}
          aria-valuenow={currentTime}
          aria-label="Seek"
          tabIndex={0}
        >
          <div
            className="mini-player-progress-fill"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Time Display */}
      <div className="mini-player-time">
        <span>{formatTime(currentTime)}</span>
        <span className="mini-player-time-separator">/</span>
        <span>{formatTime(duration)}</span>
      </div>

      {/* Controls */}
      <div className="mini-player-controls">
        <button
          className="mini-player-btn play-pause"
          onClick={handlePlayPause}
          aria-label={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying ? <Pause size={18} /> : <Play size={18} />}
        </button>

        <button
          className="mini-player-btn expand"
          onClick={handleExpand}
          aria-label="Expand player"
          title="Expand player"
        >
          <Maximize2 size={16} />
        </button>

        <button
          className="mini-player-btn close"
          onClick={handleClose}
          aria-label="Close player"
          title="Stop and close"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
