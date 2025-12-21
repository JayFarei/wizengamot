import React, { useEffect, useRef, useState } from 'react';
import './AudioVisualizer.css';

/**
 * AudioVisualizer - Real-time audio waveform visualization using Web Audio API.
 *
 * Connects to a LiveKit audio track and displays animated frequency bars.
 */
export default function AudioVisualizer({ audioTrack, isActive = false }) {
  const canvasRef = useRef(null);
  const analyserRef = useRef(null);
  const animationRef = useRef(null);
  const audioContextRef = useRef(null);

  useEffect(() => {
    // Get the MediaStreamTrack from LiveKit
    const mediaStreamTrack = audioTrack?.track?.mediaStreamTrack;
    if (!mediaStreamTrack) return;

    // Create audio context and analyser
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 64;
    analyser.smoothingTimeConstant = 0.7;

    // Create media stream source from the audio track
    const mediaStream = new MediaStream([mediaStreamTrack]);
    const source = ctx.createMediaStreamSource(mediaStream);
    source.connect(analyser);

    analyserRef.current = analyser;
    audioContextRef.current = ctx;

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      if (ctx.state !== 'closed') {
        ctx.close();
      }
    };
  }, [audioTrack]);

  useEffect(() => {
    if (!analyserRef.current || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const analyser = analyserRef.current;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const draw = () => {
      animationRef.current = requestAnimationFrame(draw);

      analyser.getByteFrequencyData(dataArray);

      const width = canvas.width;
      const height = canvas.height;
      const barCount = 32;
      const barWidth = (width / barCount) - 2;
      const barGap = 2;

      ctx.clearRect(0, 0, width, height);

      for (let i = 0; i < barCount; i++) {
        const dataIndex = Math.floor(i * bufferLength / barCount);
        const value = dataArray[dataIndex];

        // Calculate bar height with minimum height
        const minHeight = 4;
        const barHeight = Math.max(minHeight, (value / 255) * height * 0.9);

        const x = i * (barWidth + barGap);
        const y = height - barHeight;

        // Create gradient from purple to pink
        if (isActive && value > 10) {
          const gradient = ctx.createLinearGradient(x, y, x, height);
          gradient.addColorStop(0, '#8b5cf6');
          gradient.addColorStop(1, '#ec4899');
          ctx.fillStyle = gradient;
        } else {
          ctx.fillStyle = 'rgba(139, 92, 246, 0.3)';
        }

        // Draw rounded bar
        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, barHeight, 2);
        ctx.fill();
      }
    };

    draw();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [audioContextRef.current, isActive]);

  return (
    <div className="audio-visualizer-component">
      <canvas
        ref={canvasRef}
        width={400}
        height={80}
        className="visualizer-canvas"
      />
    </div>
  );
}
