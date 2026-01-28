import { useState, useMemo, useCallback, useEffect } from 'react';
import { useLayout } from '../../contexts/LayoutContext';
import { useLeaderKey } from '../../hooks/useLeaderKey';
import LeaderIndicator from './LeaderIndicator';
import LayoutHelp from './LayoutHelp';

/**
 * Handles layout keyboard shortcuts and renders visual feedback
 * Uses leader key pattern: Ctrl+; then command key
 */
export default function LayoutKeyboardHandler({ onOpenSearch }) {
  const [showHelp, setShowHelp] = useState(false);

  const {
    splitVertical,
    splitHorizontal,
    closeFocusedPane,
    focusDirection,
    movePane,
    balance,
    toggleZoom,
    jumpToPane,
    isSplit,
    focusedPaneId,
    requestSearch,
    setLeaderActive,
  } = useLayout();

  // Per-pane Cmd+K: in split mode, open search in focused pane
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k' && isSplit) {
        e.preventDefault();
        e.stopPropagation();
        // Open search in focused pane
        requestSearch(focusedPaneId);
      }
    };

    // Use capture to intercept before App.jsx handler
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isSplit, focusedPaneId, requestSearch]);

  // Build commands object for leader key
  const commands = useMemo(() => ({
    // Split commands
    'v': () => splitVertical(),
    's': () => splitHorizontal(),

    // Focus navigation (h/j/k/l)
    'h': () => focusDirection('left'),
    'j': () => focusDirection('down'),
    'k': () => focusDirection('up'),
    'l': () => focusDirection('right'),

    // Move pane (Shift + h/j/k/l)
    'H': () => movePane('left'),
    'J': () => movePane('down'),
    'K': () => movePane('up'),
    'L': () => movePane('right'),

    // Pane management
    'x': () => closeFocusedPane(),
    'b': () => balance(),
    'z': () => toggleZoom(),
    'g': () => toggleZoom(),

    // Help
    '?': () => setShowHelp(true),

    // Jump to pane by number (1-9)
    '1': () => jumpToPane(1),
    '2': () => jumpToPane(2),
    '3': () => jumpToPane(3),
    '4': () => jumpToPane(4),
    '5': () => jumpToPane(5),
    '6': () => jumpToPane(6),
    '7': () => jumpToPane(7),
    '8': () => jumpToPane(8),
    '9': () => jumpToPane(9),
  }), [
    splitVertical,
    splitHorizontal,
    focusDirection,
    movePane,
    closeFocusedPane,
    balance,
    toggleZoom,
    jumpToPane,
  ]);

  const { leaderActive, pendingKey } = useLeaderKey(commands);

  // Sync leader state to context for Pane visual feedback
  useEffect(() => {
    setLeaderActive(leaderActive);
  }, [leaderActive, setLeaderActive]);

  const handleCloseHelp = useCallback(() => {
    setShowHelp(false);
  }, []);

  return (
    <>
      <LeaderIndicator active={leaderActive} pendingKey={pendingKey} />
      {showHelp && <LayoutHelp onClose={handleCloseHelp} />}
    </>
  );
}
