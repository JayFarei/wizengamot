import React, { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import './MonitorChat.css';

/**
 * MonitorChat provides the conversation interface for Monitor mode.
 * Users can configure monitors and ask questions via natural language.
 */
export default function MonitorChat({
  monitor,
  onSendMessage,
  isLoading,
  error,
  inputOnly = false,
}) {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState([]);
  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);

  // Initialize messages from monitor
  useEffect(() => {
    if (monitor?.messages) {
      setMessages(monitor.messages);
    }
  }, [monitor?.messages]);

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 150)}px`;
    }
  }, [input]);

  const handleSubmit = async (e) => {
    e?.preventDefault();

    const trimmedInput = input.trim();
    if (!trimmedInput || isLoading) return;

    // Optimistically add user message
    const userMessage = {
      role: 'user',
      content: trimmedInput,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMessage]);
    setInput('');

    try {
      const result = await onSendMessage(trimmedInput);

      // Add assistant response
      if (result?.content) {
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: result.content,
            timestamp: new Date().toISOString(),
            action: result.action,
            action_result: result.action_result,
          },
        ]);
      }
    } catch (err) {
      // Error is handled by parent, but we can show it in chat
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: `Error: ${err.message || 'Failed to process message'}`,
          timestamp: new Date().toISOString(),
          isError: true,
        },
      ]);
    }
  };

  const handleKeyDown = (e) => {
    // Enter to submit, Shift+Enter for new line
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className={`monitor-chat ${inputOnly ? 'input-only' : ''}`}>
      {!inputOnly && (
        <div className="monitor-messages">
          {messages.length === 0 ? (
            <div className="monitor-chat-empty">
              <p>
                Start by telling me which competitors you want to track and what pages to monitor.
              </p>
            </div>
          ) : (
            messages.map((msg, idx) => (
              <div
                key={idx}
                className={`monitor-message ${msg.role} ${msg.isError ? 'error' : ''}`}
              >
                <div className="message-header">
                  <span className="message-role">
                    {msg.role === 'user' ? 'You' : 'Monitor'}
                  </span>
                  {msg.timestamp && (
                    <span className="message-time">
                      {new Date(msg.timestamp).toLocaleTimeString()}
                    </span>
                  )}
                </div>
                <div className="message-content markdown-content">
                  <ReactMarkdown>{msg.content}</ReactMarkdown>
                </div>
                {msg.action_result && (
                  <div className={`action-result ${msg.action_result.success ? 'success' : 'failure'}`}>
                    {msg.action_result.success ? (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                        <polyline points="22 4 12 14.01 9 11.01" />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="15" y1="9" x2="9" y2="15" />
                        <line x1="9" y1="9" x2="15" y2="15" />
                      </svg>
                    )}
                    {msg.action_result.message}
                  </div>
                )}
              </div>
            ))
          )}
          {isLoading && (
            <div className="monitor-message assistant loading">
              <div className="message-content">
                <div className="typing-indicator">
                  <span></span>
                  <span></span>
                  <span></span>
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      )}

      <form className="monitor-input-form" onSubmit={handleSubmit}>
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Tell me which competitors to track, ask questions, or request changes..."
          disabled={isLoading}
          rows={1}
        />
        <button type="submit" disabled={!input.trim() || isLoading}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </form>

      {error && (
        <div className="monitor-error">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          {error}
        </div>
      )}
    </div>
  );
}
