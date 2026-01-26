import { useRef, useCallback, useEffect } from 'react';
import { animate, createTimeline } from 'animejs';

/**
 * Custom hook for anime.js lens effect on progress rail ticks.
 * Creates a "local lens" effect where hovered tick grows, neighbors grow mildly.
 */
export function useRailAnimation(itemCount) {
  const ticksRef = useRef([]);
  const animationRef = useRef(null);
  const prefersReducedMotion = useRef(false);

  // Check for reduced motion preference
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    prefersReducedMotion.current = mediaQuery.matches;

    const handler = (e) => {
      prefersReducedMotion.current = e.matches;
    };
    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, []);

  // Set ref for a tick element
  const setTickRef = useCallback((index) => (el) => {
    ticksRef.current[index] = el;
  }, []);

  // Calculate scale based on distance from hovered index (macOS Dock genie effect)
  // Uses scale-DOWN approach: elements are rendered at MAX size and scaled down for crispness
  const getScaleForDistance = (distance) => {
    if (distance === 0) return { scaleX: 1.0, scaleY: 1.0, translateY: -6 };   // Full size (6px x 28px)
    if (distance === 1) return { scaleX: 0.6, scaleY: 0.7, translateY: -3 };   // ~3.6px x ~20px
    if (distance === 2) return { scaleX: 0.45, scaleY: 0.6, translateY: -1 };  // ~2.7px x ~17px
    if (distance === 3) return { scaleX: 0.38, scaleY: 0.55, translateY: 0 };  // ~2.3px x ~15px
    return { scaleX: 0.33, scaleY: 0.5, translateY: 0 };                        // Default: ~2px x 14px
  };

  // Animate lens effect when hovering a tick
  const animateLensIn = useCallback((hoveredIndex) => {
    if (prefersReducedMotion.current) return;

    // Cancel any ongoing animation
    if (animationRef.current) {
      animationRef.current.pause();
    }

    const targets = ticksRef.current.filter(Boolean);
    if (targets.length === 0) return;

    // Build animation timeline for coordinated effect
    const timeline = createTimeline({
      defaults: {
        ease: 'outQuad',
        duration: 150,
      },
    });

    targets.forEach((tick, index) => {
      const distance = Math.abs(index - hoveredIndex);
      const { scaleX, scaleY, translateY } = getScaleForDistance(distance);

      timeline.add(tick, {
        scaleX,
        scaleY,
        translateY,
      }, 0); // All start at same time
    });

    animationRef.current = timeline;
  }, []);

  // Reset all ticks to normal scale
  const animateLensOut = useCallback(() => {
    if (prefersReducedMotion.current) return;

    // Cancel any ongoing animation
    if (animationRef.current) {
      animationRef.current.pause();
    }

    const targets = ticksRef.current.filter(Boolean);
    if (targets.length === 0) return;

    // Return to scaled-down default state (not 1,1 since we render at max size)
    animationRef.current = animate(targets, {
      scaleX: 0.33,
      scaleY: 0.5,
      translateY: 0,
      ease: 'outQuad',
      duration: 200,
    });
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (animationRef.current) {
        animationRef.current.pause();
      }
    };
  }, []);

  return {
    setTickRef,
    animateLensIn,
    animateLensOut,
  };
}
