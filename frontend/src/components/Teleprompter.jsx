import React, { useState, useEffect, useRef, useCallback } from 'react';
import { FileText, ArrowDown, User, GraduationCap } from 'lucide-react';
import './Teleprompter.css';

/**
 * Teleprompter - Karaoke-style synced text display for podcast mode.
 *
 * Features:
 * - Word-level highlighting synced to audio using stored timestamps
 * - Speaker labels (Host/Expert) for two-speaker dialogue
 * - Auto-scroll to keep current word visible
 * - Manual scroll override with "Jump to live" button
 * - Past/current/upcoming word styling
 */
export default function Teleprompter({
  script = [],
  currentSegmentIndex = 0,
  currentWordIndex = 0,
  isPlaying = false,
  wordTimings = [],
  onWordClick,
}) {
  const contentRef = useRef(null);
  const activeWordRef = useRef(null);
  const [isManualScrolling, setIsManualScrolling] = useState(false);
  const [showJumpToLive, setShowJumpToLive] = useState(false);
  const manualScrollTimeout = useRef(null);
  const lastAutoScrollTime = useRef(0);

  // Calculate total words for progress indicator
  const totalWords = script.reduce((acc, segment) => acc + (segment.words?.length || 0), 0);
  const currentGlobalWordIndex = script.slice(0, currentSegmentIndex).reduce(
    (acc, segment) => acc + (segment.words?.length || 0),
    0
  ) + currentWordIndex;
  const progress = totalWords > 0 ? (currentGlobalWordIndex / totalWords) * 100 : 0;

  // Handle manual scroll detection
  const handleScroll = useCallback(() => {
    const now = Date.now();
    // If we scrolled within 100ms of auto-scroll, ignore it
    if (now - lastAutoScrollTime.current < 100) {
      return;
    }

    // User manually scrolled
    setIsManualScrolling(true);

    // Clear existing timeout
    if (manualScrollTimeout.current) {
      clearTimeout(manualScrollTimeout.current);
    }

    // Resume auto-scroll after 3 seconds of no manual scrolling
    manualScrollTimeout.current = setTimeout(() => {
      setIsManualScrolling(false);
    }, 3000);

    // Check if we should show "Jump to live" button
    if (activeWordRef.current && contentRef.current) {
      const container = contentRef.current;
      const activeWord = activeWordRef.current;
      const containerRect = container.getBoundingClientRect();
      const wordRect = activeWord.getBoundingClientRect();

      // Show button if active word is not visible
      const isWordVisible =
        wordRect.top >= containerRect.top &&
        wordRect.bottom <= containerRect.bottom;

      setShowJumpToLive(!isWordVisible);
    }
  }, []);

  // Auto-scroll to active word
  useEffect(() => {
    if (!isManualScrolling && activeWordRef.current && contentRef.current && isPlaying) {
      lastAutoScrollTime.current = Date.now();
      activeWordRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
      setShowJumpToLive(false);
    }
  }, [currentSegmentIndex, currentWordIndex, isManualScrolling, isPlaying]);

  // Jump to live button click
  const handleJumpToLive = () => {
    setIsManualScrolling(false);
    setShowJumpToLive(false);
    if (activeWordRef.current) {
      lastAutoScrollTime.current = Date.now();
      activeWordRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }
  };

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (manualScrollTimeout.current) {
        clearTimeout(manualScrollTimeout.current);
      }
    };
  }, []);

  // Determine word state
  const getWordState = (segmentIdx, wordIdx) => {
    if (segmentIdx < currentSegmentIndex) return 'past';
    if (segmentIdx > currentSegmentIndex) return 'upcoming';
    if (wordIdx < currentWordIndex) return 'past';
    if (wordIdx > currentWordIndex) return 'upcoming';
    return 'active';
  };

  // Get speaker display info
  const getSpeakerInfo = (speaker) => {
    if (speaker === 'host') {
      return {
        label: 'Host',
        icon: User,
        className: 'speaker-host',
      };
    }
    return {
      label: 'Expert',
      icon: GraduationCap,
      className: 'speaker-expert',
    };
  };

  // Empty state
  if (!script || script.length === 0) {
    return (
      <div className="teleprompter">
        <div className="teleprompter-empty">
          <FileText size={32} />
          <p>Teleprompter</p>
          <span className="hint">Text will appear here as the podcast plays</span>
        </div>
      </div>
    );
  }

  return (
    <div className="teleprompter">
      {/* Progress indicator */}
      <div className="teleprompter-scroll-indicator">
        <div
          className="teleprompter-scroll-progress"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Script content */}
      <div
        ref={contentRef}
        className={`teleprompter-content ${isManualScrolling ? 'manual-scrolling' : 'auto-scrolling'}`}
        onScroll={handleScroll}
      >
        {script.map((segment, segmentIdx) => {
          const speakerInfo = getSpeakerInfo(segment.speaker);
          const SpeakerIcon = speakerInfo.icon;

          return (
            <div key={segmentIdx} className={`teleprompter-segment ${speakerInfo.className}`}>
              {/* Speaker label */}
              <div className="speaker-label">
                <SpeakerIcon size={14} />
                <span>{speakerInfo.label}</span>
              </div>

              {/* Words */}
              <div className="segment-text">
                {segment.words?.map((wordData, wordIdx) => {
                  const state = getWordState(segmentIdx, wordIdx);
                  const isActive = state === 'active';
                  const word = typeof wordData === 'string' ? wordData : wordData.word;

                  return (
                    <span
                      key={`${segmentIdx}-${wordIdx}`}
                      ref={isActive ? activeWordRef : null}
                      className={`teleprompter-word ${state}`}
                      onClick={() => onWordClick?.(segmentIdx, wordIdx)}
                    >
                      {word}{' '}
                    </span>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Jump to live button */}
      {showJumpToLive && isPlaying && (
        <button className="jump-to-live-btn" onClick={handleJumpToLive}>
          <ArrowDown size={16} />
          Jump to Live
        </button>
      )}
    </div>
  );
}

/**
 * Find the current word based on playback time using stored word timings.
 * @param {Array} wordTimings - Array of {word, start_ms, end_ms, segment_index, word_index}
 * @param {number} currentTimeMs - Current playback time in milliseconds
 * @returns {{segmentIndex: number, wordIndex: number}}
 */
export function findCurrentWord(wordTimings, currentTimeMs) {
  if (!wordTimings || wordTimings.length === 0) {
    return { segmentIndex: 0, wordIndex: 0 };
  }

  // Binary search for efficiency with large timing arrays
  let low = 0;
  let high = wordTimings.length - 1;
  let result = 0;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const timing = wordTimings[mid];

    if (timing.start_ms <= currentTimeMs) {
      result = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  const timing = wordTimings[result];
  return {
    segmentIndex: timing?.segment_index || 0,
    wordIndex: timing?.word_index || 0,
  };
}
