# Canvas Thinking: Proof of Concept

## Overview

An **experimental** tmux-style canvas overlay accessible from **anywhere in the app**. Users enter leader mode (`Cmd+Alt+Space`) and can open panes to arrange notes and conversations. The canvas appears as an overlay layer on top of the current mode.

**Entry points**:
- `Cmd+Alt+Space n` from anywhere opens first pane (activates canvas)
- Floating button in bottom-left corner (4 squares icon)
- Command Palette: "Canvas: Open New Pane" (experimental badge)
- Actions dropdown: "Open Canvas Pane" under experimental section

**Exit**: `Esc` closes canvas overlay, returns to underlying mode.

## Scope (POC Only)

### In Scope
- Split panes (vertical/horizontal)
- Navigate between panes (`h/j/k/l`)
- Move/swap panes (`Shift+h/j/k/l`)
- Balance layout (`b`) - make all panes equal size
- Maximize pane (`g`) - toggle fullscreen for focused pane
- Close panes (`x`)
- Load content into panes:
  - Existing notes (from any conversation)
  - New conversation (Council mode)
- Leader mode with visual feedback (status indicator, timeout)
- anime.js layout animations for all transitions
- Single session (no persistence yet)

### Out of Scope (Future)
- Saved layouts
- Zoom mode
- Resize panes
- Search/scratch pads
- Replacing home page
- Backend persistence

## Keyboard Shortcuts

### Leader Mode (Cmd+Alt+Space)

Pressing `Cmd+Alt+Space` enters **leader mode** (visual indicator shows). The next keypress executes a command, then exits leader mode. If no key is pressed within 1.5 seconds, leader mode times out.

### Canvas Commands (in leader mode)

| Key | Action |
|-----|--------|
| `n` | New pane (opens content picker, splits in sensible direction) |
| `\` | Split vertical (new empty pane right) |
| `-` | Split horizontal (new empty pane below) |
| `h` | Focus pane left |
| `j` | Focus pane down |
| `k` | Focus pane up |
| `l` | Focus pane right |
| `H` | Move focused pane left (swap with neighbor) |
| `J` | Move focused pane down (swap with neighbor) |
| `K` | Move focused pane up (swap with neighbor) |
| `L` | Move focused pane right (swap with neighbor) |
| `b` | Balance layout (make all panes equal size) |
| `g` | Toggle maximize (zoom focused pane to fullscreen) |
| `x` | Close focused pane |
| `Space` | Open content picker for focused pane |
| `?` | Show keyboard help overlay |
| `Esc` | Cancel leader mode |

### Outside Leader Mode

| Key | Action |
|-----|--------|
| `Esc` | Exit canvas mode (return to ModeSelector) |
| `j/k` | Navigate within focused pane content |

### Visual Feedback

When in leader mode:
- Status bar shows "LEADER" indicator (like vim's mode indicator)
- Border highlight on canvas container
- Timeout bar showing remaining time (1.5s)

## Content Types (POC)

| Type | Description | Source |
|------|-------------|--------|
| **Note** | Single note display | Pick from any conversation's notes |
| **Conversation** | New council deliberation | Fresh conversation in pane |

## Architecture

### New Files

```
frontend/src/
├── components/
│   ├── canvas/
│   │   ├── CanvasOverlay.jsx        # Overlay container (fullscreen, above content)
│   │   ├── CanvasOverlay.css
│   │   ├── CanvasPane.jsx           # Individual pane wrapper
│   │   ├── CanvasPaneContent.jsx    # Routes to content components
│   │   ├── CanvasContentPicker.jsx  # Modal for content selection
│   │   └── CanvasKeyboardHelp.jsx   # Help overlay (simple)
├── contexts/
│   └── CanvasContext.jsx            # Canvas state (panes, layout, focus)
└── hooks/
    └── useCanvasKeyboard.js         # Leader key detection (works globally)
```

### State Structure

```javascript
// CanvasContext
{
  panes: {
    'pane-1': {
      id: 'pane-1',
      type: 'note' | 'conversation',
      contentId: string | null,  // noteId or conversationId
    }
  },
  layout: {
    type: 'leaf' | 'hsplit' | 'vsplit',
    paneId: 'pane-1',
    children: [layout, layout],
    sizes: [50, 50],
  },
  focusedPaneId: 'pane-1',
  leaderKeyActive: false,
}
```

### Layout Rendering (CSS Grid)

Binary tree layout renders to CSS Grid:

```javascript
// Example: vsplit with left pane and right hsplit
{
  type: 'vsplit',
  sizes: [50, 50],
  children: [
    { type: 'leaf', paneId: 'pane-1' },
    {
      type: 'hsplit',
      sizes: [60, 40],
      children: [
        { type: 'leaf', paneId: 'pane-2' },
        { type: 'leaf', paneId: 'pane-3' },
      ]
    }
  ]
}
```

Renders as:
```
┌─────────────┬─────────────┐
│             │   pane-2    │
│   pane-1    ├─────────────┤
│             │   pane-3    │
└─────────────┴─────────────┘
```

## Content Picker

When `Cmd+Alt+Space Space` is pressed:

```
┌─────────────────────────────────────┐
│  Select Content                     │
├─────────────────────────────────────┤
│                                     │
│  [New Conversation]                 │
│                                     │
│  ─── Recent Notes ───               │
│                                     │
│  > The Role of Attention...         │
│    How Neural Networks Process...   │
│    Introduction to Transformers     │
│    Understanding Embeddings         │
│                                     │
│  [Search all notes...]              │
│                                     │
└─────────────────────────────────────┘
```

Navigation: `j/k` to move, `Enter` to select, `Esc` to cancel.

## Implementation

### Step 1: Context & Keyboard Hook

**Create `frontend/src/contexts/CanvasContext.jsx`:**
- Reducer for pane/layout state
- Actions: ADD_PANE, REMOVE_PANE, SPLIT_PANE, FOCUS_PANE, SET_PANE_CONTENT

**Create `frontend/src/hooks/useCanvasKeyboard.js`:**

```javascript
// Leader mode state machine
const [leaderMode, setLeaderMode] = useState(false);
const leaderTimeoutRef = useRef(null);

useEffect(() => {
  const handleKeyDown = (e) => {
    // Enter leader mode
    if ((e.metaKey || e.ctrlKey) && e.altKey && e.key === ' ') {
      e.preventDefault();
      setLeaderMode(true);
      // Auto-exit after 1.5s
      leaderTimeoutRef.current = setTimeout(() => setLeaderMode(false), 1500);
      return;
    }

    // In leader mode, handle command keys
    if (leaderMode) {
      clearTimeout(leaderTimeoutRef.current);
      setLeaderMode(false);

      const command = LEADER_COMMANDS[e.key]; // Map: 'n' -> 'NEW_PANE', etc.
      if (command) {
        e.preventDefault();
        dispatch({ type: command, shift: e.shiftKey });
      }
      return;
    }

    // Outside leader mode
    if (e.key === 'Escape') {
      onExitCanvas();
    }
  };

  window.addEventListener('keydown', handleKeyDown);
  return () => window.removeEventListener('keydown', handleKeyDown);
}, [leaderMode, dispatch]);

return { leaderMode }; // For visual indicator
```

Key features:
- State machine: normal → leader (Cmd+Alt+Space) → command → normal
- 1.5 second timeout returns to normal mode
- Shift detection for move commands (`H/J/K/L`)
- Returns `leaderMode` for UI to show indicator

### Step 2: Canvas Overlay

**Create `frontend/src/components/canvas/CanvasOverlay.jsx`:**
- Fixed position, full viewport, z-index above main content
- Semi-transparent backdrop (`rgba(0,0,0,0.5)`)
- Wrap with CanvasContext provider
- Render layout as CSS Grid inside centered container
- Click on backdrop closes overlay
- Receives `onClose` prop from App.jsx

**Create `frontend/src/components/canvas/CanvasOverlay.css`:**
```css
.canvas-overlay {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(2px);
}

.canvas-container {
  width: 90vw;
  height: 85vh;
  display: grid;
  gap: 4px;
  background: var(--bg-secondary);
  border-radius: 12px;
  padding: 8px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
}
```

### Step 3: Pane Components

**Create `frontend/src/components/canvas/CanvasPane.jsx`:**
- Pane wrapper with focus ring
- Header showing pane type/title
- Close button (X)

**Create `frontend/src/components/canvas/CanvasPaneContent.jsx`:**
- Route `type='note'` → simplified note display
- Route `type='conversation'` → embedded ChatInterface

### Step 4: Content Picker

**Create `frontend/src/components/canvas/CanvasContentPicker.jsx`:**
- Modal with note list
- Fetch recent notes from all conversations
- "New Conversation" option at top
- Keyboard navigation (j/k, Enter, Esc)

### Step 5: Integration

**Modify `frontend/src/App.jsx`:**
- Add `canvasActive` state (boolean)
- Render `<CanvasOverlay>` when active (positioned above current mode content)
- Pass `onClose` callback to hide overlay
- Register global keyboard handler for `Cmd+Alt+Space n` to activate

**Modify `frontend/src/components/CommandPalette.jsx`:**
- Add "Canvas: Open New Pane" action with experimental badge
- Action triggers canvas activation

**Modify existing ActionMenu/dropdown components:**
- Add "Open Canvas Pane" under an "Experimental" section
- Shows in all modes (Council, Synthesizer, Visualiser, Podcast)

**Create `frontend/src/components/canvas/CanvasOverlay.jsx`:**
- Positioned fixed, full viewport
- Semi-transparent backdrop (click to close, optional)
- Contains the canvas grid
- z-index above main content but below modals

### Step 6: anime.js Layout Integration

**Install anime.js v4:**
```bash
cd frontend && npm install animejs@4
```

**Best Practices from anime.js Layout API:**

The Layout API uses a **record → modify → animate** pattern:

```javascript
import { createLayout, stagger } from 'animejs';

// Initialize once when canvas mounts
const layout = createLayout('.canvas-grid', {
  duration: 300,
  easing: 'easeOutExpo',
});

// Use update() for atomic layout changes (recommended)
const splitPane = (direction) => {
  layout.update(({ root }) => {
    // DOM modifications happen inside callback
    addNewPaneToDOM(direction);
  }, {
    duration: 300,
    delay: stagger(50),  // Stagger if multiple elements animate
    enterFrom: { opacity: 0, scale: 0.95 },  // New panes fade in
  });
};

// For closing panes
const closePane = (paneId) => {
  layout.update(() => {
    removePaneFromDOM(paneId);
  }, {
    duration: 250,
    leaveTo: { opacity: 0, scale: 0.95 },  // Closing panes fade out
  });
};

// For balancing (resize all panes equally)
const balanceLayout = () => {
  layout.update(() => {
    // Update CSS grid template
    document.querySelector('.canvas-grid').style.gridTemplateColumns = '1fr 1fr';
  });
};
```

**Key Layout API features we'll use:**
1. `createLayout(selector)` - Initialize on canvas container
2. `layout.update(callback, options)` - Record → modify → animate in one call
3. `enterFrom` / `leaveTo` - Define entrance/exit animations
4. `stagger(delay)` - Offset animations for multiple panes
5. Automatic CSS Grid property animation (no manual FLIP)

**CSS Grid Structure:**
```css
.canvas-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;  /* Animated by anime.js */
  grid-template-rows: 1fr;          /* Animated by anime.js */
  gap: 4px;
  height: 100%;
}

.canvas-pane {
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  overflow: hidden;
}
```

The layout engine handles interpolating grid-template-* properties automatically.

## Files Summary

| File | Action |
|------|--------|
| `frontend/src/contexts/CanvasContext.jsx` | Create |
| `frontend/src/hooks/useCanvasKeyboard.js` | Create |
| `frontend/src/components/canvas/CanvasOverlay.jsx` | Create (main overlay container) |
| `frontend/src/components/canvas/CanvasOverlay.css` | Create |
| `frontend/src/components/canvas/CanvasPane.jsx` | Create |
| `frontend/src/components/canvas/CanvasPaneContent.jsx` | Create |
| `frontend/src/components/canvas/CanvasContentPicker.jsx` | Create |
| `frontend/src/components/canvas/CanvasKeyboardHelp.jsx` | Create |
| `frontend/src/App.jsx` | Modify (add canvasActive state, render overlay) |
| `frontend/src/components/CommandPalette.jsx` | Modify (add Canvas action with experimental badge) |

## Verification

### Activation (from any mode)
1. **From keyboard**: In Council mode, press `Cmd+Alt+Space n`, canvas overlay appears with content picker
2. **From button**: Click floating button in bottom-left corner
3. **From Command Palette**: `Cmd+Shift+P`, type "canvas", select "Canvas: Open New Pane [Experimental]"
4. **From Actions menu**: Click actions dropdown, find "Open Canvas Pane" in Experimental section
5. **Overlay appears**: Canvas shows above current mode, slightly darkened backdrop

### Leader Mode
6. **Indicator**: Press `Cmd+Alt+Space`, see "LEADER" indicator (subtle toast or status bar)
7. **Timeout**: Wait 1.5s without key press, indicator disappears, returns to normal

### Pane Operations
8. **First pane**: `Cmd+Alt+Space n` opens content picker, select note, first pane created
9. **Split vertical**: `Cmd+Alt+Space \` creates empty pane to the right
10. **Split horizontal**: `Cmd+Alt+Space -` creates empty pane below
11. **Navigate**: `Cmd+Alt+Space h/j/k/l` moves focus between panes (border highlight changes)
12. **Close pane**: `Cmd+Alt+Space x` closes focused pane, sibling expands
13. **Close last pane**: Closing the only pane closes the canvas overlay entirely

### Advanced Operations
14. **Move pane**: `Cmd+Alt+Space Shift+L` swaps focused pane with right neighbor
15. **Balance**: `Cmd+Alt+Space b` makes all panes equal size
16. **Maximize**: `Cmd+Alt+Space g` zooms focused pane to fullscreen, `g` again restores

### Content
17. **Load note**: `Cmd+Alt+Space Space` opens picker, select note, renders in pane
18. **New conversation**: Select "New Conversation" in picker, Council UI appears in pane

### Exit
19. **Esc key**: Press `Esc` (outside leader mode), canvas overlay closes
20. **Backdrop click**: Click outside panes (on backdrop), canvas closes
21. **Return**: Underlying mode (Council, Synthesizer, etc.) is still there, unchanged

### Animation Quality
22. Overlay fades in smoothly when activated
23. All split/close/balance operations animate (300ms)
24. New panes fade in with slight scale (0.95 → 1.0)
25. Overlay fades out on close

## Future Enhancements (Post-POC)

After validating the concept:
- Zoom mode (fullscreen single pane)
- Resize panes (Shift+h/j/k/l)
- Save/load layouts
- More content types (images, search, scratch)
- Replace home page option
- Backend persistence
