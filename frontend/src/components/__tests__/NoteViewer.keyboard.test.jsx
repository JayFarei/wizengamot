import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import NoteViewer from '../NoteViewer';
import { NoteKeyboardProvider } from '../../contexts/NoteKeyboardContext';
import { LayoutProvider } from '../../contexts/LayoutContext';

// Mock sbd (sentence boundary detection)
vi.mock('sbd', () => ({
  default: {
    sentences: (text) => text.split('. ').filter(s => s.trim()),
  },
}));

// Mock ResponseWithComments component
vi.mock('../ResponseWithComments', () => ({
  default: ({ content }) => <div data-testid="response-content">{content}</div>,
}));

// Mock TweetModal
vi.mock('../TweetModal', () => ({
  default: () => null,
}));

// Mock CommentModal
vi.mock('../CommentModal', () => ({
  default: () => null,
}));

// Mock FloatingComment
vi.mock('../FloatingComment', () => ({
  default: () => null,
}));

// Mock ActionMenu with subcomponents
vi.mock('../ActionMenu', () => {
  const ActionMenu = ({ children }) => <div data-testid="action-menu">{children}</div>;
  ActionMenu.Item = () => null;
  ActionMenu.Submenu = () => null;
  ActionMenu.Divider = () => null;
  ActionMenu.Hint = () => null;
  return { default: ActionMenu };
});

// Mock ReviewSessionsButton
vi.mock('../ReviewSessionsButton', () => ({
  default: () => null,
}));

// Mock SourceMetadataModal
vi.mock('../SourceMetadataModal', () => ({
  default: () => null,
}));

// Mock NotePanesView
vi.mock('../NotePanesView', () => ({
  default: () => <div data-testid="panes-view">NotePanesView</div>,
}));

// Mock ProgressRail
vi.mock('../ProgressRail', () => ({
  default: ({ activeIndex }) => <div data-testid="progress-rail">{activeIndex}</div>,
}));

// Mock SelectionHandler
vi.mock('../../utils/SelectionHandler', () => ({
  SelectionHandler: {
    getSelection: () => null,
    createHighlight: () => [],
  },
}));

// Mock api
vi.mock('../../api', () => ({
  api: {
    toggleNoteStar: vi.fn().mockResolvedValue({}),
  },
}));

// Test wrapper with contexts
function TestWrapper({ children }) {
  return (
    <LayoutProvider>
      <NoteKeyboardProvider>
        {children}
      </NoteKeyboardProvider>
    </LayoutProvider>
  );
}

// Sample notes for testing
const sampleNotes = [
  {
    id: 'note-1',
    title: 'First Note',
    body: 'This is the first note body. It has multiple sentences.',
    tags: ['tag1', 'tag2'],
  },
  {
    id: 'note-2',
    title: 'Second Note',
    body: 'This is the second note body. Another sentence here.',
    tags: ['tag3'],
  },
  {
    id: 'note-3',
    title: 'Third Note',
    body: 'This is the third note body.',
    tags: [],
  },
];

describe('NoteViewer keyboard shortcuts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('J/K note navigation', () => {
    it('should navigate to next note when J is pressed', async () => {
      render(
        <TestWrapper>
          <NoteViewer
            notes={sampleNotes}
            paneId="pane-1"
          />
        </TestWrapper>
      );

      // Initially on first note
      expect(screen.getByText('First Note')).toBeInTheDocument();

      // Press J to go to next note
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true }));
      });

      // Wait for state update
      await waitFor(() => {
        expect(screen.getByText('Second Note')).toBeInTheDocument();
      });
    });

    it('should navigate to previous note when K is pressed', async () => {
      render(
        <TestWrapper>
          <NoteViewer
            notes={sampleNotes}
            paneId="pane-1"
          />
        </TestWrapper>
      );

      // Navigate to second note first
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true }));
      });

      await waitFor(() => {
        expect(screen.getByText('Second Note')).toBeInTheDocument();
      });

      // Press K to go back to first note
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', bubbles: true }));
      });

      await waitFor(() => {
        expect(screen.getByText('First Note')).toBeInTheDocument();
      });
    });

    it('should not go below index 0 when K is pressed on first note', async () => {
      render(
        <TestWrapper>
          <NoteViewer
            notes={sampleNotes}
            paneId="pane-1"
          />
        </TestWrapper>
      );

      // Initially on first note
      expect(screen.getByText('First Note')).toBeInTheDocument();

      // Press K multiple times
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', bubbles: true }));
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', bubbles: true }));
      });

      // Should still be on first note
      expect(screen.getByText('First Note')).toBeInTheDocument();
    });

    it('should not go beyond last note when J is pressed on last note', async () => {
      render(
        <TestWrapper>
          <NoteViewer
            notes={sampleNotes}
            paneId="pane-1"
          />
        </TestWrapper>
      );

      // Navigate to last note
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true }));
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true }));
      });

      await waitFor(() => {
        expect(screen.getByText('Third Note')).toBeInTheDocument();
      });

      // Press J again
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true }));
      });

      // Should still be on last note
      expect(screen.getByText('Third Note')).toBeInTheDocument();
    });
  });

  describe('Focus mode', () => {
    it('should enter focus mode when F is pressed', async () => {
      render(
        <TestWrapper>
          <NoteViewer
            notes={sampleNotes}
            paneId="pane-1"
          />
        </TestWrapper>
      );

      // Press F to enter focus mode
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true }));
      });

      // Focus overlay should appear
      await waitFor(() => {
        expect(document.querySelector('.focus-overlay')).toBeInTheDocument();
      });
    });

    it('should exit focus mode when Escape is pressed', async () => {
      render(
        <TestWrapper>
          <NoteViewer
            notes={sampleNotes}
            paneId="pane-1"
          />
        </TestWrapper>
      );

      // Enter focus mode
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true }));
      });

      await waitFor(() => {
        expect(document.querySelector('.focus-overlay')).toBeInTheDocument();
      });

      // Press Escape to exit
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      });

      await waitFor(() => {
        expect(document.querySelector('.focus-overlay')).not.toBeInTheDocument();
      });
    });
  });

  describe('paneId handling', () => {
    it('should work with paneId prop', async () => {
      const { container } = render(
        <TestWrapper>
          <NoteViewer
            notes={sampleNotes}
            paneId="pane-1"
          />
        </TestWrapper>
      );

      expect(container.querySelector('.note-viewer')).toBeInTheDocument();

      // Keyboard should work
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true }));
      });

      await waitFor(() => {
        expect(screen.getByText('Second Note')).toBeInTheDocument();
      });
    });

    it('should fall back to pane-1 when paneId is undefined', async () => {
      const { container } = render(
        <TestWrapper>
          <NoteViewer
            notes={sampleNotes}
            // paneId intentionally omitted
          />
        </TestWrapper>
      );

      expect(container.querySelector('.note-viewer')).toBeInTheDocument();

      // Keyboard should still work with fallback paneId
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true }));
      });

      await waitFor(() => {
        expect(screen.getByText('Second Note')).toBeInTheDocument();
      });
    });

    it('should not crash when paneId is null', async () => {
      const { container } = render(
        <TestWrapper>
          <NoteViewer
            notes={sampleNotes}
            paneId={null}
          />
        </TestWrapper>
      );

      expect(container.querySelector('.note-viewer')).toBeInTheDocument();
    });
  });

  describe('Browse related (B key)', () => {
    it('should open panes view when B is pressed', async () => {
      render(
        <TestWrapper>
          <NoteViewer
            notes={sampleNotes}
            paneId="pane-1"
            conversationId="conv-123"
          />
        </TestWrapper>
      );

      // Press B to open browse related
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', bubbles: true }));
      });

      // NotePanesView should appear
      await waitFor(() => {
        expect(screen.getByTestId('panes-view')).toBeInTheDocument();
      });
    });
  });

  describe('Copy (C key)', () => {
    it('should copy note when C is pressed', async () => {
      const writeTextSpy = vi.spyOn(navigator.clipboard, 'writeText');

      render(
        <TestWrapper>
          <NoteViewer
            notes={sampleNotes}
            paneId="pane-1"
          />
        </TestWrapper>
      );

      // Press C to copy
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', bubbles: true }));
      });

      // Clipboard should be called
      await waitFor(() => {
        expect(writeTextSpy).toHaveBeenCalled();
      });
    });
  });

  describe('empty notes handling', () => {
    it('should render empty state when no notes', () => {
      render(
        <TestWrapper>
          <NoteViewer
            notes={[]}
            paneId="pane-1"
          />
        </TestWrapper>
      );

      expect(screen.getByText('No notes generated yet.')).toBeInTheDocument();
    });

    it('should not crash on keyboard events with no notes', async () => {
      render(
        <TestWrapper>
          <NoteViewer
            notes={[]}
            paneId="pane-1"
          />
        </TestWrapper>
      );

      // Press J - should not crash
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true }));
      });

      expect(screen.getByText('No notes generated yet.')).toBeInTheDocument();
    });
  });
});
