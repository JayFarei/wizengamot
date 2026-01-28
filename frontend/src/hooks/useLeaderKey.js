import { useState, useEffect, useRef } from 'react';

const LEADER_TIMEOUT = 1500; // 1.5 seconds

/**
 * Custom hook for leader key detection (tmux-style)
 * Leader: Ctrl+; (semicolon)
 * After leader is pressed, next key within timeout executes command
 *
 * Uses refs to track state values so the event listener remains stable
 * and doesn't get recreated on state changes (which would cause missed events).
 */
export function useLeaderKey(commands, enabled = true) {
  const [leaderActive, setLeaderActive] = useState(false);
  const [pendingKey, setPendingKey] = useState(null);
  const timeoutRef = useRef(null);

  // Refs to track current values without effect re-runs
  const leaderActiveRef = useRef(leaderActive);
  const commandsRef = useRef(commands);

  // Keep refs in sync with state/props
  useEffect(() => {
    leaderActiveRef.current = leaderActive;
  }, [leaderActive]);

  useEffect(() => {
    commandsRef.current = commands;
  }, [commands]);

  // Single stable event listener - only depends on 'enabled'
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e) => {
      const isLeaderKey = e.ctrlKey && e.key === ';';
      const isLeaderActive = leaderActiveRef.current;

      if (!isLeaderActive && isLeaderKey) {
        e.preventDefault();
        e.stopPropagation();
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        setLeaderActive(true);
        setPendingKey(null);
        timeoutRef.current = setTimeout(() => {
          setLeaderActive(false);
          setPendingKey(null);
        }, LEADER_TIMEOUT);
        return;
      }

      if (isLeaderActive) {
        e.preventDefault();
        e.stopPropagation();

        // Escape cancels leader mode
        if (e.key === 'Escape') {
          if (timeoutRef.current) clearTimeout(timeoutRef.current);
          setLeaderActive(false);
          setPendingKey(null);
          return;
        }

        // Build command key (e.g., 'v', 'H' for shift+h)
        let commandKey = e.key.toLowerCase();
        if (e.shiftKey && /^[a-z]$/.test(e.key.toLowerCase())) {
          commandKey = e.key.toUpperCase();
        }

        // Execute command from ref (always current)
        const command = commandsRef.current[commandKey];
        if (command) command();

        // Store pending key for visual feedback
        setPendingKey(e.key);

        // Deactivate leader mode after command (or invalid key)
        setTimeout(() => {
          if (timeoutRef.current) clearTimeout(timeoutRef.current);
          setLeaderActive(false);
          setPendingKey(null);
        }, 50);
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [enabled]); // Only 'enabled' - listener is stable otherwise

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  return {
    leaderActive,
    pendingKey,
  };
}
