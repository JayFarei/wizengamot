import { createContext, useContext, useReducer, useCallback, useMemo } from 'react';

const LayoutContext = createContext(null);

// Generate unique IDs
let paneIdCounter = 0;
const generatePaneId = () => `pane-${++paneIdCounter}`;

// Initial state
const createInitialState = (initialConversationId = null) => ({
  panes: {
    'pane-1': { id: 'pane-1', conversationId: initialConversationId },
  },
  layout: { type: 'leaf', paneId: 'pane-1' },
  focusedPaneId: 'pane-1',
  zoomedPaneId: null,
  pendingSearchPaneId: null, // paneId that needs conversation selection
  isLeaderActive: false, // Leader key mode active (Ctrl+; pressed)
  closingPaneId: null, // paneId that is currently animating closed
  navigationAnimation: null, // { fromPaneId, toPaneId, direction: 'left'|'right' }
  newPaneIds: new Set(), // Track panes that need enter animation
});

// Layout tree utilities
function findLeafByPaneId(node, paneId) {
  if (node.type === 'leaf') {
    return node.paneId === paneId ? node : null;
  }
  for (const child of node.children) {
    const found = findLeafByPaneId(child, paneId);
    if (found) return found;
  }
  return null;
}

function findParentOfPaneId(node, paneId, parent = null) {
  if (node.type === 'leaf') {
    return node.paneId === paneId ? parent : null;
  }
  for (let i = 0; i < node.children.length; i++) {
    const result = findParentOfPaneId(node.children[i], paneId, node);
    if (result) return result;
  }
  return null;
}

function findIndexInParent(parent, paneId) {
  if (!parent || parent.type === 'leaf') return -1;
  return parent.children.findIndex(child =>
    child.type === 'leaf' ? child.paneId === paneId : containsPaneId(child, paneId)
  );
}

function containsPaneId(node, paneId) {
  if (node.type === 'leaf') return node.paneId === paneId;
  return node.children.some(child => containsPaneId(child, paneId));
}

function getAllPaneIds(node) {
  if (node.type === 'leaf') return [node.paneId];
  return node.children.flatMap(child => getAllPaneIds(child));
}

function getAdjacentPaneId(layout, currentPaneId, direction) {
  // Get all leaf panes in order (left-to-right, top-to-bottom)
  const allPanes = getAllPaneIds(layout);
  const currentIndex = allPanes.indexOf(currentPaneId);
  if (currentIndex === -1) return null;

  // For now, simple linear navigation
  // h/k = previous, l/j = next
  if (direction === 'left' || direction === 'up') {
    return allPanes[Math.max(0, currentIndex - 1)];
  } else {
    return allPanes[Math.min(allPanes.length - 1, currentIndex + 1)];
  }
}

function replaceNode(root, targetPaneId, newNode) {
  if (root.type === 'leaf') {
    return root.paneId === targetPaneId ? newNode : root;
  }
  return {
    ...root,
    children: root.children.map(child => replaceNode(child, targetPaneId, newNode)),
  };
}

function removePane(root, targetPaneId) {
  if (root.type === 'leaf') {
    return root.paneId === targetPaneId ? null : root;
  }

  const newChildren = root.children
    .map(child => removePane(child, targetPaneId))
    .filter(Boolean);

  if (newChildren.length === 0) return null;
  if (newChildren.length === 1) return newChildren[0];

  // Redistribute sizes
  const totalSize = root.sizes.reduce((a, b) => a + b, 0);
  const remainingIndices = [];
  root.children.forEach((child, i) => {
    const newChild = removePane(child, targetPaneId);
    if (newChild) remainingIndices.push(i);
  });

  const newSizes = remainingIndices.map(i => root.sizes[i]);
  const sizeSum = newSizes.reduce((a, b) => a + b, 0);
  const normalizedSizes = newSizes.map(s => (s / sizeSum) * 100);

  return {
    ...root,
    children: newChildren,
    sizes: normalizedSizes,
  };
}

function balanceSizes(root) {
  if (root.type === 'leaf') return root;
  const balancedChildren = root.children.map(child => balanceSizes(child));
  const equalSize = 100 / balancedChildren.length;
  return {
    ...root,
    children: balancedChildren,
    sizes: balancedChildren.map(() => equalSize),
  };
}

// Animate a pane's size to 0 (for smooth close animation)
function animatePaneSizeToZero(root, targetPaneId) {
  if (root.type === 'leaf') return root;

  // Check if this split directly contains the target pane
  const childIndex = root.children.findIndex(child =>
    child.type === 'leaf' && child.paneId === targetPaneId
  );

  if (childIndex !== -1) {
    // Found it - set this child's size to 0, redistribute remaining space
    const totalRemaining = root.sizes.reduce((sum, s, i) => i === childIndex ? sum : sum + s, 0);
    const newSizes = root.sizes.map((size, i) => {
      if (i === childIndex) return 0;
      // Scale up remaining sizes proportionally to fill 100%
      return totalRemaining > 0 ? (size / totalRemaining) * 100 : 100 / (root.sizes.length - 1);
    });
    return { ...root, sizes: newSizes };
  }

  // Recurse into children
  return {
    ...root,
    children: root.children.map(child => animatePaneSizeToZero(child, targetPaneId)),
  };
}

// Reducer
function layoutReducer(state, action) {
  switch (action.type) {
    case 'SPLIT_PANE': {
      const { direction, conversationId = null } = action.payload;
      const { focusedPaneId, layout, panes } = state;

      const newPaneId = generatePaneId();
      const splitType = direction === 'vertical' ? 'vsplit' : 'hsplit';

      // Create new split node
      const newSplitNode = {
        type: splitType,
        sizes: [50, 50],
        children: [
          { type: 'leaf', paneId: focusedPaneId },
          { type: 'leaf', paneId: newPaneId },
        ],
      };

      // Replace the focused leaf with the new split
      const newLayout = replaceNode(layout, focusedPaneId, newSplitNode);

      return {
        ...state,
        panes: {
          ...panes,
          [newPaneId]: { id: newPaneId, conversationId },
        },
        layout: newLayout,
        focusedPaneId: newPaneId,
        pendingSearchPaneId: newPaneId, // Trigger search modal in new pane
        newPaneIds: new Set([newPaneId]), // Only the new pane animates
      };
    }

    case 'CLEAR_NEW_PANE': {
      const { paneId } = action.payload;
      const newPaneIds = new Set(state.newPaneIds);
      newPaneIds.delete(paneId);
      return { ...state, newPaneIds };
    }

    case 'PREPARE_CLOSE_PANE': {
      // Phase 1 of two-phase close: animate sizes to 0, keep pane in DOM
      const { paneId } = action.payload;
      const { layout, panes } = state;

      // Can't close the last pane
      const allPaneIds = getAllPaneIds(layout);
      if (allPaneIds.length <= 1) return state;

      // Animate the closing pane's size to 0
      const updatedLayout = animatePaneSizeToZero(layout, paneId);

      return {
        ...state,
        layout: updatedLayout,
        closingPaneId: paneId,
      };
    }

    case 'CLOSE_PANE': {
      const { paneId } = action.payload;
      const { layout, panes, focusedPaneId } = state;

      // Can't close the last pane
      const allPaneIds = getAllPaneIds(layout);
      if (allPaneIds.length <= 1) return state;

      // Find next pane to focus
      const currentIndex = allPaneIds.indexOf(paneId);
      let nextFocusId = focusedPaneId === paneId
        ? allPaneIds[currentIndex > 0 ? currentIndex - 1 : currentIndex + 1]
        : focusedPaneId;

      // Remove pane from layout
      const newLayout = removePane(layout, paneId);

      // Remove pane from panes map
      const { [paneId]: removed, ...remainingPanes } = panes;

      return {
        ...state,
        panes: remainingPanes,
        layout: newLayout,
        focusedPaneId: nextFocusId,
        zoomedPaneId: state.zoomedPaneId === paneId ? null : state.zoomedPaneId,
        closingPaneId: null, // Clear closing state
      };
    }

    case 'FOCUS_PANE': {
      const { paneId } = action.payload;
      if (!state.panes[paneId]) return state;
      return { ...state, focusedPaneId: paneId };
    }

    case 'FOCUS_DIRECTION': {
      const { direction } = action.payload;
      const { layout, focusedPaneId } = state;
      const nextPaneId = getAdjacentPaneId(layout, focusedPaneId, direction);
      if (!nextPaneId || nextPaneId === focusedPaneId) return state;

      const allPanes = getAllPaneIds(layout);
      const fromIndex = allPanes.indexOf(focusedPaneId);
      const toIndex = allPanes.indexOf(nextPaneId);
      const visualDirection = toIndex > fromIndex ? 'right' : 'left';

      return {
        ...state,
        focusedPaneId: nextPaneId,
        navigationAnimation: {
          fromPaneId: focusedPaneId,
          toPaneId: nextPaneId,
          direction: visualDirection,
        },
      };
    }

    case 'CLEAR_NAVIGATION_ANIMATION':
      return { ...state, navigationAnimation: null };

    case 'MOVE_PANE': {
      // Swap positions with adjacent pane
      const { direction } = action.payload;
      const { layout, focusedPaneId, panes } = state;

      const allPaneIds = getAllPaneIds(layout);
      const currentIndex = allPaneIds.indexOf(focusedPaneId);
      if (currentIndex === -1) return state;

      let targetIndex;
      if (direction === 'left' || direction === 'up') {
        targetIndex = Math.max(0, currentIndex - 1);
      } else {
        targetIndex = Math.min(allPaneIds.length - 1, currentIndex + 1);
      }

      if (targetIndex === currentIndex) return state;

      // Swap the conversation IDs between panes
      const targetPaneId = allPaneIds[targetIndex];
      const currentPane = panes[focusedPaneId];
      const targetPane = panes[targetPaneId];

      return {
        ...state,
        panes: {
          ...panes,
          [focusedPaneId]: { ...currentPane, conversationId: targetPane.conversationId },
          [targetPaneId]: { ...targetPane, conversationId: currentPane.conversationId },
        },
        focusedPaneId: targetPaneId,
      };
    }

    case 'BALANCE': {
      return {
        ...state,
        layout: balanceSizes(state.layout),
      };
    }

    case 'TOGGLE_ZOOM': {
      const { zoomedPaneId, focusedPaneId } = state;
      return {
        ...state,
        zoomedPaneId: zoomedPaneId ? null : focusedPaneId,
      };
    }

    case 'SET_PANE_CONVERSATION': {
      const { paneId, conversationId } = action.payload;
      if (!state.panes[paneId]) return state;
      return {
        ...state,
        panes: {
          ...state.panes,
          [paneId]: { ...state.panes[paneId], conversationId },
        },
        pendingSearchPaneId: null, // Clear pending search after setting conversation
      };
    }

    case 'CLEAR_PENDING_SEARCH': {
      return { ...state, pendingSearchPaneId: null };
    }

    case 'SET_PENDING_SEARCH': {
      const { paneId } = action.payload;
      if (!state.panes[paneId]) return state;
      return { ...state, pendingSearchPaneId: paneId };
    }

    case 'JUMP_TO_PANE': {
      const { index } = action.payload;
      const allPaneIds = getAllPaneIds(state.layout);
      const paneId = allPaneIds[index - 1]; // 1-indexed
      if (!paneId) return state;
      return { ...state, focusedPaneId: paneId };
    }

    case 'RESET': {
      const { conversationId } = action.payload || {};
      paneIdCounter = 0;
      return createInitialState(conversationId);
    }

    case 'SET_LEADER_ACTIVE': {
      const { isActive } = action.payload;
      return { ...state, isLeaderActive: isActive };
    }

    default:
      return state;
  }
}

export function LayoutProvider({ children, initialConversationId = null }) {
  const [state, dispatch] = useReducer(
    layoutReducer,
    initialConversationId,
    createInitialState
  );

  // Action creators
  const splitVertical = useCallback((conversationId = null) => {
    dispatch({ type: 'SPLIT_PANE', payload: { direction: 'vertical', conversationId } });
  }, []);

  const splitHorizontal = useCallback((conversationId = null) => {
    dispatch({ type: 'SPLIT_PANE', payload: { direction: 'horizontal', conversationId } });
  }, []);

  const closePane = useCallback((paneId) => {
    // Phase 1 only: Animate sizes to 0
    dispatch({ type: 'PREPARE_CLOSE_PANE', payload: { paneId } });
    // Phase 2 is now triggered by PaneContainer on transitionend
  }, []);

  const completeClosePane = useCallback((paneId) => {
    dispatch({ type: 'CLOSE_PANE', payload: { paneId } });
  }, []);

  const closeFocusedPane = useCallback(() => {
    // Use two-phase close for consistent animation
    closePane(state.focusedPaneId);
  }, [state.focusedPaneId, closePane]);

  const focusPane = useCallback((paneId) => {
    dispatch({ type: 'FOCUS_PANE', payload: { paneId } });
  }, []);

  const focusDirection = useCallback((direction) => {
    dispatch({ type: 'FOCUS_DIRECTION', payload: { direction } });
  }, []);

  const movePane = useCallback((direction) => {
    dispatch({ type: 'MOVE_PANE', payload: { direction } });
  }, []);

  const balance = useCallback(() => {
    dispatch({ type: 'BALANCE' });
  }, []);

  const toggleZoom = useCallback(() => {
    dispatch({ type: 'TOGGLE_ZOOM' });
  }, []);

  const setPaneConversation = useCallback((paneId, conversationId) => {
    dispatch({ type: 'SET_PANE_CONVERSATION', payload: { paneId, conversationId } });
  }, []);

  const jumpToPane = useCallback((index) => {
    dispatch({ type: 'JUMP_TO_PANE', payload: { index } });
  }, []);

  const reset = useCallback((conversationId = null) => {
    dispatch({ type: 'RESET', payload: { conversationId } });
  }, []);

  const clearPendingSearch = useCallback(() => {
    dispatch({ type: 'CLEAR_PENDING_SEARCH' });
  }, []);

  const requestSearch = useCallback((paneId) => {
    dispatch({ type: 'SET_PENDING_SEARCH', payload: { paneId } });
  }, []);

  const setLeaderActive = useCallback((isActive) => {
    dispatch({ type: 'SET_LEADER_ACTIVE', payload: { isActive } });
  }, []);

  const clearNavigationAnimation = useCallback(() => {
    dispatch({ type: 'CLEAR_NAVIGATION_ANIMATION' });
  }, []);

  const clearNewPane = useCallback((paneId) => {
    dispatch({ type: 'CLEAR_NEW_PANE', payload: { paneId } });
  }, []);

  // Computed values
  const paneCount = useMemo(() => getAllPaneIds(state.layout).length, [state.layout]);
  const allPaneIds = useMemo(() => getAllPaneIds(state.layout), [state.layout]);
  const isSplit = paneCount > 1;

  const value = useMemo(() => ({
    // State
    ...state,
    paneCount,
    allPaneIds,
    isSplit,

    // Actions
    splitVertical,
    splitHorizontal,
    closePane,
    completeClosePane,
    closeFocusedPane,
    focusPane,
    focusDirection,
    movePane,
    balance,
    toggleZoom,
    setPaneConversation,
    jumpToPane,
    reset,
    clearPendingSearch,
    requestSearch,
    setLeaderActive,
    clearNavigationAnimation,
    clearNewPane,
  }), [
    state,
    paneCount,
    allPaneIds,
    isSplit,
    splitVertical,
    splitHorizontal,
    closePane,
    completeClosePane,
    closeFocusedPane,
    focusPane,
    focusDirection,
    movePane,
    balance,
    toggleZoom,
    setPaneConversation,
    jumpToPane,
    reset,
    clearPendingSearch,
    requestSearch,
    setLeaderActive,
    clearNavigationAnimation,
    clearNewPane,
  ]);

  return (
    <LayoutContext.Provider value={value}>
      {children}
    </LayoutContext.Provider>
  );
}

export function useLayout() {
  const context = useContext(LayoutContext);
  if (!context) {
    throw new Error('useLayout must be used within LayoutProvider');
  }
  return context;
}
