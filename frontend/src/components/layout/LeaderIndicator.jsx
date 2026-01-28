import { useEffect, useState } from 'react';
import './LeaderIndicator.css';

const COMMANDS = {
  'v': 'Split vertical',
  's': 'Split horizontal',
  'h': 'Focus left',
  'j': 'Focus down',
  'k': 'Focus up',
  'l': 'Focus right',
  'H': 'Move left',
  'J': 'Move down',
  'K': 'Move up',
  'L': 'Move right',
  'x': 'Close pane',
  'b': 'Balance panes',
  'z': 'Toggle zoom',
  'g': 'Toggle zoom',
  '?': 'Show help',
  '1-9': 'Jump to pane',
};

export default function LeaderIndicator({ active, pendingKey }) {
  const [visible, setVisible] = useState(false);
  const [fadeOut, setFadeOut] = useState(false);

  useEffect(() => {
    if (active) {
      setVisible(true);
      setFadeOut(false);
    } else if (visible) {
      // Fade out animation
      setFadeOut(true);
      const timer = setTimeout(() => {
        setVisible(false);
        setFadeOut(false);
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [active, visible]);

  if (!visible) return null;

  return (
    <div className={`leader-indicator ${fadeOut ? 'fade-out' : ''}`}>
      <div className="leader-indicator-content">
        <div className="leader-badge">
          <kbd>Ctrl</kbd> + <kbd>;</kbd>
        </div>
        {pendingKey ? (
          <span className="leader-status">
            Executing <kbd>{pendingKey}</kbd>
          </span>
        ) : (
          <div className="leader-shortcuts">
            <div className="leader-shortcut-row">
              <span><kbd>v</kbd> split</span>
              <span><kbd>h</kbd><kbd>j</kbd><kbd>k</kbd><kbd>l</kbd> focus</span>
              <span><kbd>g</kbd> zoom</span>
            </div>
            <div className="leader-shortcut-row">
              <span><kbd>x</kbd> close</span>
              <span><kbd>b</kbd> balance</span>
              <span><kbd>?</kbd> help</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
