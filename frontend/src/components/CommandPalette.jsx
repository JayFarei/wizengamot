import { useState, useEffect, useRef } from 'react';
import './CommandPalette.css';

const MODE_LABELS = {
  council: 'Council',
  synthesizer: 'Synthesizer',
  visualiser: 'Visualiser',
};

export default function CommandPalette({ isOpen, onClose, mode, actions = [] }) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  // Focus when modal opens
  useEffect(() => {
    if (isOpen) {
      setSelectedIndex(0);
      // Focus the container for keyboard navigation
      setTimeout(() => {
        listRef.current?.focus();
      }, 50);
    }
  }, [isOpen]);

  // Keyboard navigation
  const handleKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, actions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      handleSelect(selectedIndex);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  const handleSelect = (index) => {
    const action = actions[index];
    if (action && action.onSelect) {
      action.onSelect();
      onClose();
    }
  };

  // Scroll selected item into view
  useEffect(() => {
    if (listRef.current) {
      const selectedItem = listRef.current.querySelector('.command-item.selected');
      if (selectedItem) {
        selectedItem.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [selectedIndex]);

  if (!isOpen) return null;

  return (
    <div className="command-palette-overlay" onClick={onClose}>
      <div className="command-palette" onClick={(e) => e.stopPropagation()}>
        <div className="command-palette-header">
          <span className="command-palette-mode">{MODE_LABELS[mode] || mode} Actions</span>
          <span className="command-palette-hint">
            <kbd>esc</kbd> to close
          </span>
        </div>

        <div
          className="command-palette-list"
          ref={listRef}
          tabIndex={0}
          onKeyDown={handleKeyDown}
        >
          {actions.length === 0 ? (
            <div className="command-palette-empty">No actions available</div>
          ) : (
            actions.map((action, index) => (
              <div
                key={action.id || index}
                className={`command-item ${index === selectedIndex ? 'selected' : ''} ${action.disabled ? 'disabled' : ''}`}
                onClick={() => !action.disabled && handleSelect(index)}
                onMouseEnter={() => !action.disabled && setSelectedIndex(index)}
              >
                {action.icon && <span className="command-item-icon">{action.icon}</span>}
                <span className="command-item-label">{action.label}</span>
                {action.shortcut && (
                  <kbd className="command-item-shortcut">{action.shortcut}</kbd>
                )}
                {action.badge && (
                  <span className="command-item-badge">{action.badge}</span>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
