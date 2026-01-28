import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { NoteKeyboardProvider, useNoteKeyboard } from '../NoteKeyboardContext';
import { LayoutProvider } from '../LayoutContext';
import { useEffect } from 'react';

// Test component that registers handlers
function TestHandlerComponent({ paneId, handlers, onMount }) {
  const { registerHandlers, unregisterHandlers } = useNoteKeyboard();

  useEffect(() => {
    registerHandlers(paneId, handlers);
    onMount?.();
    return () => unregisterHandlers(paneId);
  }, [paneId, handlers, registerHandlers, unregisterHandlers, onMount]);

  return <div data-testid={`handler-${paneId}`}>Handler for {paneId}</div>;
}

// Wrapper that provides both Layout and NoteKeyboard contexts
function TestWrapper({ children }) {
  return (
    <LayoutProvider>
      <NoteKeyboardProvider>
        {children}
      </NoteKeyboardProvider>
    </LayoutProvider>
  );
}

describe('NoteKeyboardContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('handler registration', () => {
    it('should register handlers for a pane', () => {
      const handlers = {
        navigateDown: vi.fn(),
        navigateUp: vi.fn(),
      };
      let mounted = false;

      render(
        <TestWrapper>
          <TestHandlerComponent
            paneId="pane-1"
            handlers={handlers}
            onMount={() => { mounted = true; }}
          />
        </TestWrapper>
      );

      expect(mounted).toBe(true);
      expect(screen.getByTestId('handler-pane-1')).toBeInTheDocument();
    });

    it('should allow multiple panes to register handlers', () => {
      const handlers1 = { navigateDown: vi.fn() };
      const handlers2 = { navigateDown: vi.fn() };

      render(
        <TestWrapper>
          <TestHandlerComponent paneId="pane-1" handlers={handlers1} />
          <TestHandlerComponent paneId="pane-2" handlers={handlers2} />
        </TestWrapper>
      );

      expect(screen.getByTestId('handler-pane-1')).toBeInTheDocument();
      expect(screen.getByTestId('handler-pane-2')).toBeInTheDocument();
    });
  });

  describe('key dispatch', () => {
    it('should dispatch key events to the focused pane handlers', async () => {
      const handlers = {
        navigateDown: vi.fn(),
        navigateUp: vi.fn(),
      };

      render(
        <TestWrapper>
          <TestHandlerComponent paneId="pane-1" handlers={handlers} />
        </TestWrapper>
      );

      // Simulate pressing 'j' key (navigateDown)
      await act(async () => {
        const event = new KeyboardEvent('keydown', {
          key: 'j',
          bubbles: true,
        });
        window.dispatchEvent(event);
      });

      expect(handlers.navigateDown).toHaveBeenCalledTimes(1);
    });

    it('should map j to navigateDown and k to navigateUp', async () => {
      const handlers = {
        navigateDown: vi.fn(),
        navigateUp: vi.fn(),
      };

      render(
        <TestWrapper>
          <TestHandlerComponent paneId="pane-1" handlers={handlers} />
        </TestWrapper>
      );

      // Press 'j'
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true }));
      });
      expect(handlers.navigateDown).toHaveBeenCalledTimes(1);

      // Press 'k'
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', bubbles: true }));
      });
      expect(handlers.navigateUp).toHaveBeenCalledTimes(1);
    });

    it('should map f to focusMode and Escape to exitFocusMode', async () => {
      const handlers = {
        focusMode: vi.fn(),
        exitFocusMode: vi.fn(),
      };

      render(
        <TestWrapper>
          <TestHandlerComponent paneId="pane-1" handlers={handlers} />
        </TestWrapper>
      );

      // Press 'f'
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true }));
      });
      expect(handlers.focusMode).toHaveBeenCalledTimes(1);

      // Press 'Escape'
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      });
      expect(handlers.exitFocusMode).toHaveBeenCalledTimes(1);
    });

    it('should not dispatch to handlers when no handler is registered for the action', async () => {
      const handlers = {
        navigateDown: vi.fn(),
        // navigateUp not registered
      };

      render(
        <TestWrapper>
          <TestHandlerComponent paneId="pane-1" handlers={handlers} />
        </TestWrapper>
      );

      // Press 'k' (navigateUp) - should not call anything
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', bubbles: true }));
      });

      expect(handlers.navigateDown).not.toHaveBeenCalled();
    });
  });

  describe('input field bypass', () => {
    it('should not dispatch events when target is an INPUT element', async () => {
      const handlers = {
        navigateDown: vi.fn(),
      };

      render(
        <TestWrapper>
          <TestHandlerComponent paneId="pane-1" handlers={handlers} />
          <input data-testid="text-input" />
        </TestWrapper>
      );

      const input = screen.getByTestId('text-input');
      input.focus();

      // Simulate keydown on input
      await act(async () => {
        const event = new KeyboardEvent('keydown', {
          key: 'j',
          bubbles: true,
        });
        Object.defineProperty(event, 'target', { value: input });
        window.dispatchEvent(event);
      });

      expect(handlers.navigateDown).not.toHaveBeenCalled();
    });

    it('should not dispatch events when target is a TEXTAREA element', async () => {
      const handlers = {
        navigateDown: vi.fn(),
      };

      render(
        <TestWrapper>
          <TestHandlerComponent paneId="pane-1" handlers={handlers} />
          <textarea data-testid="text-area" />
        </TestWrapper>
      );

      const textarea = screen.getByTestId('text-area');
      textarea.focus();

      // Simulate keydown on textarea
      await act(async () => {
        const event = new KeyboardEvent('keydown', {
          key: 'j',
          bubbles: true,
        });
        Object.defineProperty(event, 'target', { value: textarea });
        window.dispatchEvent(event);
      });

      expect(handlers.navigateDown).not.toHaveBeenCalled();
    });
  });

  describe('handler unregistration', () => {
    it('should unregister handlers on unmount', async () => {
      const handlers = {
        navigateDown: vi.fn(),
      };

      const { unmount } = render(
        <TestWrapper>
          <TestHandlerComponent paneId="pane-1" handlers={handlers} />
        </TestWrapper>
      );

      // First verify the handler works
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true }));
      });
      expect(handlers.navigateDown).toHaveBeenCalledTimes(1);

      // Unmount the component
      unmount();

      // Re-render just the wrapper to have a valid context, but no handlers
      render(<TestWrapper><div>Empty</div></TestWrapper>);

      // Press 'j' again - should not call the handler since it was unregistered
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true }));
      });

      // Handler count should still be 1 (not 2)
      expect(handlers.navigateDown).toHaveBeenCalledTimes(1);
    });
  });

  describe('all key mappings', () => {
    const keyMappings = [
      ['j', 'navigateDown'],
      ['k', 'navigateUp'],
      ['c', 'copy'],
      ['s', 'star'],
      ['x', 'tweet'],
      ['b', 'browseRelated'],
      ['f', 'focusMode'],
      ['Escape', 'exitFocusMode'],
      ['ArrowDown', 'sentenceDown'],
      ['ArrowUp', 'sentenceUp'],
      ['h', 'highlight'],
      ['Enter', 'openRelated'],
      ['ArrowLeft', 'panePrev'],
      ['ArrowRight', 'paneNext'],
      ['Backspace', 'closePane'],
    ];

    keyMappings.forEach(([key, actionName]) => {
      it(`should map '${key}' to '${actionName}'`, async () => {
        const handler = vi.fn();
        const handlers = { [actionName]: handler };

        render(
          <TestWrapper>
            <TestHandlerComponent paneId="pane-1" handlers={handlers} />
          </TestWrapper>
        );

        await act(async () => {
          window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
        });

        expect(handler).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('event object passed to handler', () => {
    it('should pass the keyboard event to the handler', async () => {
      const handlers = {
        sentenceDown: vi.fn(),
      };

      render(
        <TestWrapper>
          <TestHandlerComponent paneId="pane-1" handlers={handlers} />
        </TestWrapper>
      );

      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'ArrowDown',
          shiftKey: true,
          bubbles: true,
        }));
      });

      expect(handlers.sentenceDown).toHaveBeenCalledTimes(1);
      const eventArg = handlers.sentenceDown.mock.calls[0][0];
      expect(eventArg.shiftKey).toBe(true);
    });
  });
});
