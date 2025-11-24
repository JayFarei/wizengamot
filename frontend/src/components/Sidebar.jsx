import { useState, useEffect } from 'react';
import './Sidebar.css';
import { api } from '../api';

export default function Sidebar({
  conversations,
  currentConversationId,
  onSelectConversation,
  onNewConversation,
  collapsed,
  onToggleCollapse,
}) {
  const [config, setConfig] = useState(null);
  const [showConfig, setShowConfig] = useState(false);

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    try {
      const configData = await api.getConfig();
      setConfig(configData);
    } catch (error) {
      console.error('Failed to load config:', error);
    }
  };

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

          {config && (
            <div className="council-config">
              <button
                className="config-toggle"
                onClick={() => setShowConfig(!showConfig)}
              >
                {showConfig ? '▼' : '▶'} Council Members ({config.council_models.length})
              </button>
              {showConfig && (
                <div className="config-details">
                  <div className="config-section">
                    <div className="config-label">Council:</div>
                    <ul className="model-list">
                      {config.council_models.map((model, index) => (
                        <li key={index}>{model.split('/')[1] || model}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="config-section">
                    <div className="config-label">Chairman:</div>
                    <div className="chairman-model">
                      {config.chairman_model.split('/')[1] || config.chairman_model}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

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
                  <div className="conversation-title">
                    {conv.title || 'New Conversation'}
                  </div>
                  <div className="conversation-meta">
                    {conv.message_count} messages
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
