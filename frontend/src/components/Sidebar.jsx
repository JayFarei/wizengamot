import './Sidebar.css';

export default function Sidebar({
  conversations,
  currentConversationId,
  onSelectConversation,
  onNewConversation,
  onDeleteConversation,
  onOpenSettings,
  collapsed,
  onToggleCollapse,
}) {
  return (
    <div className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      <button 
        className="sidebar-collapse-btn"
        onClick={onToggleCollapse}
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {collapsed ? '›' : '‹'}
      </button>
      
      {!collapsed && (
        <>
          <div className="sidebar-header">
            <h1>LLM Council</h1>
            <button className="new-conversation-btn" onClick={onNewConversation}>
              + New Conversation
            </button>
          </div>

          <div className="conversation-list">
            {conversations.length === 0 ? (
              <div className="no-conversations">No conversations yet</div>
            ) : (
              conversations.map((conv) => (
                <div
                  key={conv.id}
                  className={`conversation-item ${
                    conv.id === currentConversationId ? 'active' : ''
                  }`}
                  onClick={() => onSelectConversation(conv.id)}
                >
                  <div className="conversation-content">
                    <div className="conversation-title-row">
                      <span className="conversation-title">
                        {conv.title || 'New Conversation'}
                      </span>
                      {conv.mode === 'synthesizer' && (
                        <span className="mode-badge mode-synthesizer">Notes</span>
                      )}
                    </div>
                    <div className="conversation-meta">
                      {conv.message_count} messages
                    </div>
                  </div>
                  <button
                    className="conversation-delete-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm('Delete this conversation?')) {
                        onDeleteConversation(conv.id);
                      }
                    }}
                    title="Delete conversation"
                  >
                    ×
                  </button>
                </div>
              ))
            )}
          </div>

          <div className="sidebar-footer">
            <button className="settings-btn" onClick={onOpenSettings}>
              Settings
            </button>
          </div>
        </>
      )}
    </div>
  );
}
