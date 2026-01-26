import { useState, useEffect, useCallback } from 'react';
import { api } from '../api';
import './PodcastProgressModal.css';

/**
 * Modal overlay showing detailed podcast generation progress.
 * Opens when clicking a generating podcast in the sidebar.
 */
export default function PodcastProgressModal({ podcast, ttsHealth, onClose, onDelete }) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [cancelStatus, setCancelStatus] = useState('');

  // Close on escape key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (showConfirm) {
          setShowConfirm(false);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, showConfirm]);

  // Close when clicking backdrop
  const handleBackdropClick = useCallback((e) => {
    // Only close if clicking directly on the backdrop
    if (e.target === e.currentTarget) {
      onClose();
    }
  }, [onClose]);

  // Handle stop and delete - now cancels generation first
  const handleStopRecording = useCallback(async () => {
    if (!podcast?.id) return;

    setIsDeleting(true);
    setCancelStatus('Cancelling...');

    try {
      // First, cancel the generation
      await api.cancelPodcastGeneration(podcast.id);
      setCancelStatus('Waiting for generation to stop...');

      // Wait a moment for the cancellation to take effect
      // The backend will stop at the next segment boundary
      await new Promise(resolve => setTimeout(resolve, 1500));

      // Then delete the session
      setCancelStatus('Cleaning up...');
      await onDelete(podcast.id);
      onClose();
    } catch (err) {
      console.error('Failed to stop recording:', err);
      setCancelStatus('');
      setIsDeleting(false);
      setShowConfirm(false);
    }
  }, [podcast?.id, onDelete, onClose]);

  if (!podcast) return null;

  const progress = Math.round((podcast.generation_progress || 0) * 100);
  const audioSegments = podcast.audio_total_segments || 0;
  const currentSegment = podcast.audio_current_segment || 0;

  // Get step description
  const getStepDescription = (step) => {
    switch (step) {
      case 'loading_characters':
        return 'Loading voice characters and preparing for generation...';
      case 'writing_script':
        return 'AI is writing the podcast dialogue script...';
      case 'generating_audio':
        return 'Converting script to speech with AI voices...';
      case 'finalizing':
        return 'Saving and processing the final audio file...';
      case 'complete':
        return 'Podcast generation complete!';
      default:
        return 'Starting podcast generation...';
    }
  };

  // Check for stall (no progress for 5+ minutes)
  const checkForStall = () => {
    if (!podcast.last_progress_at) return false;
    const lastProgress = new Date(podcast.last_progress_at);
    const now = new Date();
    const diffMinutes = (now - lastProgress) / (1000 * 60);
    return diffMinutes > 5;
  };

  const isStalled = checkForStall();
  const isTtsHealthy = ttsHealth?.healthy !== false;

  return (
    <div className="podcast-progress-backdrop" onClick={handleBackdropClick}>
      <div className="podcast-progress-modal" onClick={(e) => e.stopPropagation()}>
        {/* Close button */}
        <button className="podcast-progress-close" onClick={onClose}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        {/* Recording indicator */}
        <div className="podcast-progress-header">
          <div className="recording-indicator">
            <span className="recording-dot-large" />
            <span>RECORDING</span>
          </div>
        </div>

        {/* Title */}
        <h2 className="podcast-progress-title">
          {podcast.title || 'Podcast'}
        </h2>

        {/* Progress bar */}
        <div className="podcast-progress-bar-container">
          <div className="podcast-progress-bar">
            <div
              className="podcast-progress-bar-fill"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="podcast-progress-percentage">{progress}%</div>
        </div>

        {/* Step info */}
        <div className="podcast-progress-step">
          <div className="podcast-progress-step-label">
            {getStepDescription(podcast.generation_step)}
          </div>
          {audioSegments > 0 && (
            <div className="podcast-progress-segment-count">
              Audio: Segment {currentSegment} of {audioSegments}
            </div>
          )}
        </div>

        {/* Warnings */}
        <div className="podcast-progress-warnings">
          {!isTtsHealthy && (
            <div className="podcast-progress-warning tts-warning">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2L1 21h22L12 2zm0 3.5L19.5 19H4.5L12 5.5zM11 10v4h2v-4h-2zm0 6v2h2v-2h-2z"/>
              </svg>
              <span>TTS Service: {ttsHealth?.details || 'Unavailable'}</span>
            </div>
          )}
          {isTtsHealthy && ttsHealth && (
            <div className="podcast-progress-status healthy">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                <polyline points="22 4 12 14.01 9 11.01"/>
              </svg>
              <span>TTS Service: Healthy</span>
            </div>
          )}
          {isStalled && (
            <div className="podcast-progress-warning stall-warning">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2L1 21h22L12 2zm0 3.5L19.5 19H4.5L12 5.5zM11 10v4h2v-4h-2zm0 6v2h2v-2h-2z"/>
              </svg>
              <span>Generation may be stalled (no progress for 5+ minutes)</span>
            </div>
          )}
        </div>

        {/* Stop Recording Button */}
        <div className="podcast-progress-actions">
          {!showConfirm ? (
            <button
              className="podcast-stop-btn"
              onClick={() => setShowConfirm(true)}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="6" width="12" height="12" rx="1" />
              </svg>
              Stop Recording
            </button>
          ) : (
            <div className="podcast-confirm-delete">
              <span className="confirm-text">Stop and delete this recording?</span>
              <div className="confirm-actions">
                <button
                  className="confirm-btn cancel"
                  onClick={() => setShowConfirm(false)}
                  disabled={isDeleting}
                >
                  Cancel
                </button>
                <button
                  className="confirm-btn delete"
                  onClick={handleStopRecording}
                  disabled={isDeleting}
                >
                  {isDeleting ? (cancelStatus || 'Stopping...') : 'Yes, Stop'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
