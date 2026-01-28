import { createContext, useContext, useCallback, useRef, useEffect } from 'react';
import { useLayout } from './LayoutContext';

const NoteKeyboardContext = createContext(null);

/**
 * Maps keyboard keys to action names for note-level shortcuts.
 * These shortcuts are scoped to the focused pane only.
 */
const KEY_TO_ACTION = {
  'j': 'navigateDown',
  'k': 'navigateUp',
  'c': 'copy',
  's': 'star',
  'x': 'tweet',
  'b': 'browseRelated',
  'f': 'focusMode',
  'Escape': 'exitFocusMode',
  'ArrowDown': 'sentenceDown',
  'ArrowUp': 'sentenceUp',
  'h': 'highlight',
  // NotePanesView specific
  'Enter': 'openRelated',
  'ArrowLeft': 'panePrev',
  'ArrowRight': 'paneNext',
  'Backspace': 'closePane',
};

/**
 * NoteKeyboardProvider - Centralized keyboard dispatch for note-level shortcuts
 *
 * Instead of each NoteViewer/NotePanesView having its own window listener,
 * this provider maintains a single listener that dispatches actions ONLY
 * to the focused pane's registered handlers.
 *
 * Uses a ref to track focusedPaneId so the event listener remains stable
 * and doesn't get recreated on focus changes (which would cause missed events).
 */
export function NoteKeyboardProvider({ children }) {
  const { focusedPaneId } = useLayout();
  const handlersRef = useRef(new Map()); // paneId -> handlers object

  // Ref to track focused pane without listener recreation
  const focusedPaneIdRef = useRef(focusedPaneId);

  // Keep ref in sync with context value
  useEffect(() => {
    focusedPaneIdRef.current = focusedPaneId;
  }, [focusedPaneId]);

  /**
   * Register keyboard handlers for a pane
   * @param {string} paneId - The pane ID
   * @param {object} handlers - Object with action names as keys and handler functions as values
   */
  const registerHandlers = useCallback((paneId, handlers) => {
    handlersRef.current.set(paneId, handlers);
  }, []);

  /**
   * Unregister handlers when a component unmounts
   * @param {string} paneId - The pane ID to unregister
   */
  const unregisterHandlers = useCallback((paneId) => {
    handlersRef.current.delete(paneId);
  }, []);

  // Single stable event listener - no dependencies that change frequently
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Skip if typing in input
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      // Skip if command palette or search modal is open
      if (e.target.closest('.command-palette-overlay') ||
          e.target.closest('.search-modal-overlay') ||
          document.querySelector('.command-palette-overlay') ||
          document.querySelector('.search-modal-overlay')) return;

      // Read focused pane from ref (always current)
      const currentFocusedPaneId = focusedPaneIdRef.current;
      const handlers = handlersRef.current.get(currentFocusedPaneId);
      if (!handlers) return;

      // Map key to action - try exact key first, then lowercase
      const actionName = KEY_TO_ACTION[e.key] || KEY_TO_ACTION[e.key.toLowerCase()];
      if (!actionName) return;

      // Get handler for this action
      const handler = handlers[actionName];
      if (!handler) return;

      // Prevent default and stop propagation
      e.preventDefault();
      e.stopPropagation();

      // Call handler with event (for shift-key detection, etc.)
      handler(e);
    };

    // Use capture phase to intercept before other listeners
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, []); // Empty deps - listener is stable

  return (
    <NoteKeyboardContext.Provider value={{ registerHandlers, unregisterHandlers }}>
      {children}
    </NoteKeyboardContext.Provider>
  );
}

/**
 * Hook to access the note keyboard context
 * @returns {{ registerHandlers: function, unregisterHandlers: function }}
 */
export function useNoteKeyboard() {
  const context = useContext(NoteKeyboardContext);
  if (!context) {
    throw new Error('useNoteKeyboard must be used within NoteKeyboardProvider');
  }
  return context;
}
