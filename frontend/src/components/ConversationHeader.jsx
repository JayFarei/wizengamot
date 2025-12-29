import React from 'react';
import './ConversationHeader.css';

function ConversationHeader({
  leftContent,
  centerContent,
  rightContent,
  className = '',
}) {
  return (
    <div className={`conversation-header ${className}`.trim()}>
      <div className="header-left">
        {leftContent}
      </div>
      {centerContent && (
        <div className="header-center">
          {centerContent}
        </div>
      )}
      <div className="header-right">
        {rightContent}
      </div>
    </div>
  );
}

export default ConversationHeader;
