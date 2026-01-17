import React, { useState, useRef, useEffect } from 'react';
import { Send, X, MessageSquare, ExternalLink, RefreshCw } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { api } from '../api';
import './KnowledgeGraph.css';

/**
 * KnowledgeGraphChat - Chat interface for querying the knowledge graph
 */
export default function KnowledgeGraphChat({
  onClose,
  onSelectConversation,
  onHighlightNode,
}) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const userMessage = input.trim();
    setInput('');
    setLoading(true);

    // Add user message immediately
    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);

    try {
      const response = await api.chatWithKnowledgeGraph(userMessage, sessionId);

      // Store session ID for continuity
      if (response.session_id) {
        setSessionId(response.session_id);
      }

      // Add assistant response
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: response.answer,
        citations: response.citations || [],
        follow_ups: response.follow_ups || [],
        notes_searched: response.notes_searched || 0
      }]);
    } catch (error) {
      console.error('Chat error:', error);
      const errorMessage = error.message || 'Unknown error';
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Sorry, I encountered an error while searching your knowledge graph: ${errorMessage}. Make sure you have indexed some notes using the migration feature.`,
        error: true
      }]);
    } finally {
      setLoading(false);
    }
  };

  const handleFollowUp = (question) => {
    setInput(question);
    inputRef.current?.focus();
  };

  // Handle keyboard shortcuts: Enter to send, Shift+Enter for newline
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (input.trim() && !loading) {
        handleSubmit(e);
      }
    }
  };

  const handleCitationClick = (citation) => {
    if (citation.conversation_id && onSelectConversation) {
      onSelectConversation(citation.conversation_id);
    }
    if (citation.note_id && onHighlightNode) {
      onHighlightNode(citation.note_id);
    }
  };

  const handleClearChat = () => {
    setMessages([]);
    setSessionId(null);
    if (sessionId) {
      api.clearKnowledgeGraphChatSession(sessionId).catch(console.error);
    }
  };

  return (
    <div className="kg-chat">
      <div className="kg-chat-header">
        <div className="kg-chat-title">
          <MessageSquare size={18} />
          <span>Knowledge Graph Chat</span>
        </div>
        <div className="kg-chat-actions">
          {messages.length > 0 && (
            <button
              className="kg-btn kg-btn-secondary"
              onClick={handleClearChat}
              title="Clear chat"
            >
              <RefreshCw size={14} />
            </button>
          )}
          <button className="kg-close-btn" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
      </div>

      <div className="kg-chat-messages">
        {messages.length === 0 ? (
          <div className="kg-chat-empty">
            <MessageSquare size={48} strokeWidth={1} />
            <h3>Ask your knowledge graph</h3>
            <p>Ask questions about your notes and I'll find relevant information.</p>
            <div className="kg-chat-suggestions">
              <button onClick={() => handleFollowUp("What are the main topics in my notes?")}>
                What are the main topics in my notes?
              </button>
              <button onClick={() => handleFollowUp("What have I learned about AI?")}>
                What have I learned about AI?
              </button>
              <button onClick={() => handleFollowUp("Summarize my recent learnings")}>
                Summarize my recent learnings
              </button>
            </div>
          </div>
        ) : (
          messages.map((msg, idx) => (
            <div
              key={idx}
              className={`kg-chat-message ${msg.role} ${msg.error ? 'error' : ''}`}
            >
              <div className="kg-chat-message-content">
                {msg.role === 'assistant' ? (
                  <ReactMarkdown>{msg.content}</ReactMarkdown>
                ) : (
                  msg.content
                )}
              </div>

              {msg.citations && msg.citations.length > 0 && (
                <div className="kg-chat-citations">
                  <div className="kg-chat-citations-title">Sources:</div>
                  {msg.citations.map((citation, i) => (
                    <button
                      key={i}
                      className="kg-chat-citation"
                      onClick={() => handleCitationClick(citation)}
                    >
                      <ExternalLink size={12} />
                      <span className="citation-title">{citation.title}</span>
                    </button>
                  ))}
                </div>
              )}

              {msg.follow_ups && msg.follow_ups.length > 0 && (
                <div className="kg-chat-followups">
                  <div className="kg-chat-followups-title">Follow-up questions:</div>
                  {msg.follow_ups.map((question, i) => (
                    <button
                      key={i}
                      className="kg-chat-followup"
                      onClick={() => handleFollowUp(question)}
                    >
                      {question}
                    </button>
                  ))}
                </div>
              )}

              {msg.notes_searched > 0 && (
                <div className="kg-chat-meta">
                  Searched {msg.notes_searched} note{msg.notes_searched !== 1 ? 's' : ''}
                </div>
              )}
            </div>
          ))
        )}
        {loading && (
          <div className="kg-chat-message assistant loading">
            <div className="kg-chat-loading">
              <span></span>
              <span></span>
              <span></span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <form className="kg-chat-input-form" onSubmit={handleSubmit}>
        <div className="kg-chat-input-wrapper">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your knowledge..."
            disabled={loading}
            className="kg-chat-textarea"
            rows={2}
          />
          <button
            type="submit"
            disabled={!input.trim() || loading}
            className="kg-chat-send-btn"
          >
            <Send size={16} />
          </button>
        </div>
        <div className="kg-chat-input-hint">
          Enter to send
        </div>
      </form>
    </div>
  );
}
