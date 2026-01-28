import { useEffect } from 'react';
import './LayoutHelp.css';

const COMMAND_GROUPS = [
  {
    title: 'Split',
    commands: [
      { key: 'v', description: 'Split vertical (new pane right)' },
      { key: 's', description: 'Split horizontal (new pane below)' },
    ],
  },
  {
    title: 'Focus',
    commands: [
      { key: 'h', description: 'Focus pane left' },
      { key: 'j', description: 'Focus pane down' },
      { key: 'k', description: 'Focus pane up' },
      { key: 'l', description: 'Focus pane right' },
      { key: '1-9', description: 'Jump to pane by number' },
    ],
  },
  {
    title: 'Move',
    commands: [
      { key: 'H', description: 'Move pane left (Shift+H)' },
      { key: 'J', description: 'Move pane down (Shift+J)' },
      { key: 'K', description: 'Move pane up (Shift+K)' },
      { key: 'L', description: 'Move pane right (Shift+L)' },
    ],
  },
  {
    title: 'Manage',
    commands: [
      { key: 'x', description: 'Close focused pane' },
      { key: 'b', description: 'Balance panes (equal sizes)' },
      { key: 'g / z', description: 'Toggle zoom (maximize/restore)' },
    ],
  },
];

export default function LayoutHelp({ onClose }) {
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' || e.key === '?') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div className="layout-help-overlay" onClick={onClose}>
      <div className="layout-help-modal" onClick={e => e.stopPropagation()}>
        <div className="layout-help-header">
          <h2>Layout Shortcuts</h2>
          <span className="layout-help-prefix">
            <kbd>Ctrl</kbd> + <kbd>;</kbd> then:
          </span>
        </div>

        <div className="layout-help-content">
          {COMMAND_GROUPS.map(group => (
            <div key={group.title} className="layout-help-group">
              <h3>{group.title}</h3>
              <div className="layout-help-commands">
                {group.commands.map(cmd => (
                  <div key={cmd.key} className="layout-help-command">
                    <kbd>{cmd.key}</kbd>
                    <span>{cmd.description}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="layout-help-footer">
          <span className="layout-help-hint">Press <kbd>?</kbd> or <kbd>Esc</kbd> to close</span>
        </div>
      </div>
    </div>
  );
}
