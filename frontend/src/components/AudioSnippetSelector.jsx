import React, { useState, useEffect, useRef, useCallback } from 'react';
import WaveSurfer from 'wavesurfer.js';
import { Play, Pause, RotateCcw, AlertCircle, Check, Loader2 } from 'lucide-react';
import './AudioSnippetSelector.css';

/**
 * AudioSnippetSelector - Waveform-based audio snippet selector for voice cloning.
 *
 * Allows users to visually select a 10-15 second region from their audio file
 * for optimal voice cloning quality.
 *
 * @param {File} audioFile - The uploaded audio file
 * @param {function} onSnippetSelect - Callback when snippet is selected (snippetBlob, startTime, endTime)
 * @param {number} minDuration - Minimum snippet duration in seconds (default: 10)
 * @param {number} maxDuration - Maximum snippet duration in seconds (default: 15)
 * @param {function} onDurationInfo - Callback with audio duration info
 */
export default function AudioSnippetSelector({
  audioFile,
  onSnippetSelect,
  minDuration = 10,
  maxDuration = 15,
  onDurationInfo,
}) {
  const containerRef = useRef(null);
  const wavesurferRef = useRef(null);
  const audioContextRef = useRef(null);
  const audioBufferRef = useRef(null);

  const [isLoading, setIsLoading] = useState(true);
  const [isReady, setIsReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [regionStart, setRegionStart] = useState(0);
  const [regionEnd, setRegionEnd] = useState(0);
  const [isDragging, setIsDragging] = useState(null); // 'start', 'end', 'region', or null
  const [error, setError] = useState(null);

  // Calculate selected duration
  const selectedDuration = regionEnd - regionStart;
  const isValidDuration = selectedDuration >= minDuration && selectedDuration <= maxDuration;

  // Initialize WaveSurfer
  useEffect(() => {
    if (!containerRef.current || !audioFile) return;

    setError(null);
    setIsReady(false);
    setIsLoading(true);

    let ws = null;
    let audioContext = null;
    let objectUrl = null;

    const initializeAudio = async () => {
      try {
        // First, decode the audio using AudioContext (more reliable for MP3)
        const arrayBuffer = await audioFile.arrayBuffer();
        audioContext = new (window.AudioContext || window.webkitAudioContext)();

        // Clone the arrayBuffer since decodeAudioData consumes it
        const bufferClone = arrayBuffer.slice(0);

        let buffer;
        try {
          buffer = await audioContext.decodeAudioData(bufferClone);
        } catch (decodeErr) {
          console.error('AudioContext decode failed:', decodeErr);
          throw new Error(`Unable to decode audio file. Format may not be supported.`);
        }

        audioContextRef.current = audioContext;
        audioBufferRef.current = buffer;

        // Create WaveSurfer instance
        ws = WaveSurfer.create({
          container: containerRef.current,
          waveColor: '#4a90e2',
          progressColor: '#2d6cb5',
          cursorColor: 'transparent',
          barWidth: 2,
          barGap: 1,
          barRadius: 2,
          height: 80,
          normalize: true,
          interact: false,
        });

        wavesurferRef.current = ws;

        ws.on('error', (err) => {
          console.error('WaveSurfer playback error:', err);
          // Don't set error state here since waveform might still be usable
        });

        ws.on('finish', () => {
          setIsPlaying(false);
        });

        // Try multiple loading strategies for better format support
        let loadSuccess = false;

        // Strategy 1: Load from blob (works well for WAV)
        try {
          await ws.loadBlob(audioFile);
          loadSuccess = true;
        } catch (blobErr) {
          console.warn('loadBlob failed, trying URL method:', blobErr);
        }

        // Strategy 2: Load from object URL (fallback for MP3 and others)
        if (!loadSuccess) {
          try {
            objectUrl = URL.createObjectURL(audioFile);
            await ws.load(objectUrl);
            loadSuccess = true;
          } catch (urlErr) {
            console.warn('URL load failed:', urlErr);
          }
        }

        // Strategy 3: Generate waveform from decoded AudioBuffer (most reliable)
        if (!loadSuccess && buffer) {
          try {
            // Convert AudioBuffer to Float32Array for WaveSurfer
            const channelData = buffer.getChannelData(0);
            // Create a temporary audio element with the blob
            objectUrl = URL.createObjectURL(audioFile);
            const audio = new Audio(objectUrl);
            audio.preload = 'metadata';
            await new Promise((resolve, reject) => {
              audio.onloadedmetadata = resolve;
              audio.onerror = reject;
              setTimeout(reject, 5000); // 5 second timeout
            });
            ws.setOptions({ media: audio });
            await ws.load(objectUrl);
            loadSuccess = true;
          } catch (bufferErr) {
            console.warn('AudioBuffer waveform generation failed:', bufferErr);
          }
        }

        if (!loadSuccess) {
          throw new Error('Unable to load audio for waveform display');
        }

        const audioDuration = buffer.duration || ws.getDuration();
        setDuration(audioDuration);
        setIsReady(true);
        setIsLoading(false);

        // Set initial region (first 10-15 seconds, or full audio if shorter)
        const initialEnd = Math.min(audioDuration, maxDuration);
        setRegionStart(0);
        setRegionEnd(initialEnd);

        if (onDurationInfo) {
          onDurationInfo({
            totalDuration: audioDuration,
            needsSelection: audioDuration > maxDuration,
          });
        }
      } catch (err) {
        console.error('Audio initialization error:', err);
        setError(err.message || 'Failed to load audio file. Please try a different format (WAV recommended).');
        setIsLoading(false);
      }
    };

    initializeAudio();

    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      if (ws) ws.destroy();
      if (audioContext && audioContext.state !== 'closed') {
        audioContext.close().catch(() => {});
      }
    };
  }, [audioFile, maxDuration, onDurationInfo]);

  // Extract snippet when region changes
  useEffect(() => {
    if (!isReady || !audioBufferRef.current || !isValidDuration) return;

    const extractSnippet = async () => {
      try {
        const buffer = audioBufferRef.current;
        const sampleRate = buffer.sampleRate;
        const startSample = Math.floor(regionStart * sampleRate);
        const endSample = Math.floor(regionEnd * sampleRate);
        const length = endSample - startSample;

        // Create offline context for the snippet
        const offlineContext = new OfflineAudioContext(
          1, // mono
          length,
          sampleRate
        );

        // Create buffer for snippet
        const snippetBuffer = offlineContext.createBuffer(1, length, sampleRate);
        const sourceData = buffer.getChannelData(0);
        const targetData = snippetBuffer.getChannelData(0);

        // Copy data
        for (let i = 0; i < length; i++) {
          targetData[i] = sourceData[startSample + i] || 0;
        }

        // Convert to WAV blob
        const wavBlob = audioBufferToWav(snippetBuffer, sampleRate);

        if (onSnippetSelect) {
          onSnippetSelect(wavBlob, regionStart, regionEnd);
        }
      } catch (err) {
        console.error('Failed to extract snippet:', err);
      }
    };

    // Debounce extraction
    const timeoutId = setTimeout(extractSnippet, 300);
    return () => clearTimeout(timeoutId);
  }, [isReady, regionStart, regionEnd, isValidDuration, onSnippetSelect]);

  // Convert AudioBuffer to WAV Blob
  const audioBufferToWav = (buffer, sampleRate) => {
    const numChannels = 1;
    const length = buffer.length * numChannels * 2;
    const arrayBuffer = new ArrayBuffer(44 + length);
    const view = new DataView(arrayBuffer);
    const samples = buffer.getChannelData(0);

    // WAV header
    const writeString = (offset, string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };

    writeString(0, 'RIFF');
    view.setUint32(4, 36 + length, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true); // fmt chunk size
    view.setUint16(20, 1, true); // PCM format
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * 2, true); // byte rate
    view.setUint16(32, numChannels * 2, true); // block align
    view.setUint16(34, 16, true); // bits per sample
    writeString(36, 'data');
    view.setUint32(40, length, true);

    // Write samples
    let offset = 44;
    for (let i = 0; i < samples.length; i++) {
      const sample = Math.max(-1, Math.min(1, samples[i]));
      const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
      view.setInt16(offset, intSample, true);
      offset += 2;
    }

    return new Blob([arrayBuffer], { type: 'audio/wav' });
  };

  // Play/pause snippet
  const togglePlay = useCallback(() => {
    if (!wavesurferRef.current || !isReady) return;

    const ws = wavesurferRef.current;

    if (isPlaying) {
      ws.pause();
      setIsPlaying(false);
    } else {
      // Seek to region start and play
      ws.setTime(regionStart);
      ws.play();
      setIsPlaying(true);

      // Stop at region end
      const checkEnd = setInterval(() => {
        if (ws.getCurrentTime() >= regionEnd) {
          ws.pause();
          setIsPlaying(false);
          clearInterval(checkEnd);
        }
      }, 50);
    }
  }, [isReady, isPlaying, regionStart, regionEnd]);

  // Reset selection to start
  const resetSelection = useCallback(() => {
    if (!isReady) return;
    const newEnd = Math.min(duration, maxDuration);
    setRegionStart(0);
    setRegionEnd(newEnd);
  }, [isReady, duration, maxDuration]);

  // Handle mouse events for region selection
  const handleMouseDown = useCallback((e, target) => {
    e.preventDefault();
    setIsDragging(target);
  }, []);

  const handleMouseMove = useCallback((e) => {
    if (!isDragging || !containerRef.current || !isReady) return;

    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percent = Math.max(0, Math.min(1, x / rect.width));
    const time = percent * duration;

    if (isDragging === 'start') {
      const newStart = Math.min(time, regionEnd - minDuration);
      setRegionStart(Math.max(0, newStart));
    } else if (isDragging === 'end') {
      const newEnd = Math.max(time, regionStart + minDuration);
      setRegionEnd(Math.min(duration, newEnd));
    } else if (isDragging === 'region') {
      // Move entire region
      const regionDuration = regionEnd - regionStart;
      const centerOffset = regionDuration / 2;
      const newCenter = time;
      let newStart = newCenter - centerOffset;
      let newEnd = newCenter + centerOffset;

      // Clamp to bounds
      if (newStart < 0) {
        newStart = 0;
        newEnd = regionDuration;
      }
      if (newEnd > duration) {
        newEnd = duration;
        newStart = duration - regionDuration;
      }

      setRegionStart(Math.max(0, newStart));
      setRegionEnd(Math.min(duration, newEnd));
    }
  }, [isDragging, isReady, duration, regionStart, regionEnd, minDuration]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(null);
  }, []);

  // Global mouse events for dragging
  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, handleMouseMove, handleMouseUp]);

  // Format time as MM:SS.s
  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toFixed(1).padStart(4, '0')}`;
  };

  if (error) {
    return (
      <div className="audio-snippet-selector error">
        <AlertCircle size={20} />
        <span>{error}</span>
      </div>
    );
  }

  return (
    <div className="audio-snippet-selector">
      <div className="waveform-container">
        <div ref={containerRef} className="waveform" />

        {isReady && (
          <div className="region-overlay">
            {/* Before region (dimmed) */}
            <div
              className="region-dim region-before"
              style={{ width: `${(regionStart / duration) * 100}%` }}
            />

            {/* Selected region */}
            <div
              className="region-selected"
              style={{
                left: `${(regionStart / duration) * 100}%`,
                width: `${((regionEnd - regionStart) / duration) * 100}%`,
              }}
              onMouseDown={(e) => handleMouseDown(e, 'region')}
            >
              {/* Start handle */}
              <div
                className="region-handle region-handle-start"
                onMouseDown={(e) => { e.stopPropagation(); handleMouseDown(e, 'start'); }}
              />

              {/* End handle */}
              <div
                className="region-handle region-handle-end"
                onMouseDown={(e) => { e.stopPropagation(); handleMouseDown(e, 'end'); }}
              />
            </div>

            {/* After region (dimmed) */}
            <div
              className="region-dim region-after"
              style={{
                left: `${(regionEnd / duration) * 100}%`,
                width: `${((duration - regionEnd) / duration) * 100}%`,
              }}
            />
          </div>
        )}
      </div>

      {isReady && (
        <>
          <div className="snippet-info">
            <div className="time-range">
              <span className="time-label">Start: {formatTime(regionStart)}</span>
              <span className="time-separator">to</span>
              <span className="time-label">End: {formatTime(regionEnd)}</span>
            </div>

            <div className={`duration-badge ${isValidDuration ? 'valid' : 'invalid'}`}>
              {isValidDuration ? <Check size={14} /> : <AlertCircle size={14} />}
              <span>{selectedDuration.toFixed(1)}s selected</span>
              <span className="duration-hint">({minDuration}-{maxDuration}s required)</span>
            </div>
          </div>

          <div className="snippet-controls">
            <button
              className="btn-snippet-control"
              onClick={togglePlay}
              title={isPlaying ? 'Pause' : 'Play snippet'}
            >
              {isPlaying ? <Pause size={16} /> : <Play size={16} />}
              <span>{isPlaying ? 'Pause' : 'Play Snippet'}</span>
            </button>

            <button
              className="btn-snippet-control btn-secondary"
              onClick={resetSelection}
              title="Reset to start"
            >
              <RotateCcw size={16} />
              <span>Reset</span>
            </button>
          </div>

          <p className="snippet-hint">
            Drag the handles or the selected region to adjust. For best cloning quality,
            select a clear 10-15 second segment with natural speech.
          </p>
        </>
      )}

      {isLoading && !error && (
        <div className="waveform-loading">
          <Loader2 size={20} className="spinning" />
          <span>Processing audio...</span>
        </div>
      )}
    </div>
  );
}
