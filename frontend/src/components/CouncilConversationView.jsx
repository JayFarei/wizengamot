import { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import './CouncilDiscussionView.css';

export default function CouncilConversationView({
  messages,
  getModelShortName,
  onContinueThread,
  onSelectThread,
  isLoading,
}) {
  const threadEndRef = useRef(null);
  const [threadInputs, setThreadInputs] = useState({}); // { threadId: inputValue }

  // Filter for follow-up messages only
  const followUpMessages = messages.filter(
    (msg) => msg.role === 'follow-up-user' || msg.role === 'follow-up-assistant'
  );

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    if (threadEndRef.current) {
      threadEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [followUpMessages.length]);

  // Thread continuation handlers
  const handleThreadInputChange = (threadId, value) => {
    setThreadInputs((prev) => ({ ...prev, [threadId]: value }));
  };

  const handleThreadSubmit = (threadId) => {
    const inputValue = threadInputs[threadId]?.trim();
    if (!inputValue || isLoading || !onContinueThread) return;

    onContinueThread(threadId, inputValue);
    setThreadInputs((prev) => ({ ...prev, [threadId]: '' }));
  };

  const handleThreadKeyDown = (e, threadId) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleThreadSubmit(threadId);
    }
  };

  // Check if a message is the last message of its thread
  const isLastMessageOfThread = (idx, threadId) => {
    if (!threadId) return false;

    // Look at all subsequent messages
    for (let i = idx + 1; i < followUpMessages.length; i++) {
      if (followUpMessages[i].thread_id === threadId) {
        return false;
      }
    }
    return true;
  };

  // Handle clicking on follow-up-user to open context sidebar
  const handleFollowUpClick = (msg) => {
    if (!onSelectThread || !msg.thread_id) return;

    onSelectThread(msg.thread_id, {
      model: msg.model,
      comments: msg.comments || [],
      contextSegments: msg.context_segments || [],
    });
  };

  if (followUpMessages.length === 0) {
    return (
      <div className="council-conversation-view">
        <div className="council-conversation-empty">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          <h3>No follow-up conversations yet</h3>
          <p>
            Highlight text in any stage response and add a comment to start a follow-up
            conversation with a specific model.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="council-conversation-view">
      <div className="council-conversation-thread">
        {followUpMessages.map((msg, idx) => (
          <div key={idx}>
            <div
              className={`council-message ${msg.role === 'follow-up-user' ? 'user' : 'assistant'}`}
            >
              <div
                className={`council-message-header ${msg.role === 'follow-up-user' && (msg.comments?.length > 0 || msg.context_segments?.length > 0) ? 'clickable' : ''}`}
                onClick={msg.role === 'follow-up-user' ? () => handleFollowUpClick(msg) : undefined}
                title={msg.role === 'follow-up-user' && msg.thread_id ? 'Click to view thread context' : undefined}
              >
                {msg.role === 'follow-up-user' ? (
                  <>
                    You
                    {msg.model && (
                      <span className="council-context-badge">
                        → {getModelShortName(msg.model)}
                      </span>
                    )}
                    {(msg.comments?.length > 0 || msg.context_segments?.length > 0) && (
                      <span className="context-indicator">View context</span>
                    )}
                  </>
                ) : (
                  getModelShortName(msg.model)
                )}
              </div>

              {/* Show context badges for user messages with context */}
              {msg.role === 'follow-up-user' && (msg.comments?.length > 0 || msg.context_segments?.length > 0) && (
                <div className="council-context-badges">
                  {msg.comments?.map((comment, cidx) => (
                    <span key={comment.id || cidx} className="council-context-badge">
                      Stage {comment.stage} • {getModelShortName(comment.model)}
                    </span>
                  ))}
                  {msg.context_segments?.map((segment, sidx) => (
                    <span key={segment.id || sidx} className="council-context-badge">
                      {segment.label || `Stage ${segment.stage}`}
                    </span>
                  ))}
                </div>
              )}

              <div className="council-message-content">
                {msg.loading ? (
                  <div className="council-message-loading">
                    <div className="spinner"></div>
                    <span>Thinking...</span>
                  </div>
                ) : (
                  <div className="markdown-content">
                    <ReactMarkdown>{msg.content}</ReactMarkdown>
                  </div>
                )}
              </div>
            </div>

            {/* Thread continuation input - shows after last message of each thread */}
            {msg.role === 'follow-up-assistant' && !msg.loading && msg.thread_id && isLastMessageOfThread(idx, msg.thread_id) && (
              <div className="thread-continue-input">
                <div className="thread-continue-label">
                  Continue with {getModelShortName(msg.model)}
                </div>
                <div className="thread-continue-form">
                  <textarea
                    className="thread-continue-textarea"
                    placeholder="Type your follow-up..."
                    value={threadInputs[msg.thread_id] || ''}
                    onChange={(e) => handleThreadInputChange(msg.thread_id, e.target.value)}
                    onKeyDown={(e) => handleThreadKeyDown(e, msg.thread_id)}
                    disabled={isLoading}
                    rows={2}
                  />
                  <button
                    className="thread-continue-submit"
                    onClick={() => handleThreadSubmit(msg.thread_id)}
                    disabled={!threadInputs[msg.thread_id]?.trim() || isLoading}
                  >
                    Send
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
        <div ref={threadEndRef} />
      </div>
    </div>
  );
}
