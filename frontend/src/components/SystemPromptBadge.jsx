import { useState } from 'react';
import './SystemPromptBadge.css';

/**
 * Badge component to display the active system prompt for a conversation.
 */
export default function SystemPromptBadge({ promptTitle, promptContent }) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (!promptTitle && !promptContent) {
    return null;
  }

  const displayTitle = promptTitle || 'System Prompt Active';

  return (
    <div className="system-prompt-badge">
      <div className="system-prompt-header">
        <div className="system-prompt-icon">⚙️</div>
        <div className="system-prompt-title">{displayTitle}</div>
        {promptContent && (
          <button
            className="system-prompt-toggle"
            onClick={() => setIsExpanded(!isExpanded)}
            title={isExpanded ? 'Hide prompt' : 'Show prompt'}
          >
            {isExpanded ? '▼' : '▶'}
          </button>
        )}
      </div>
      {isExpanded && promptContent && (
        <div className="system-prompt-content">
          <pre>{promptContent}</pre>
        </div>
      )}
    </div>
  );
}
