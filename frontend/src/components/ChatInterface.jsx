import { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import Stage1 from './Stage1';
import Stage2 from './Stage2';
import Stage3 from './Stage3';
import SystemPromptBadge from './SystemPromptBadge';
import FeatureList from './FeatureList';
import './ChatInterface.css';

export default function ChatInterface({
  conversation,
  onSendMessage,
  isLoading,
  comments,
  contextSegments,
  onSelectionChange,
  onEditComment,
  onDeleteComment,
  activeCommentId,
  onSetActiveComment,
  onAddContextSegment,
  onRemoveContextSegment,
}) {
  const [input, setInput] = useState('');
  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [conversation]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (input.trim() && !isLoading) {
      onSendMessage(input);
      setInput('');
    }
  };

  const handleKeyDown = (e) => {
    // Submit on Enter (without Shift)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  if (!conversation) {
    return (
      <div className="chat-interface">
        <div className="empty-state">
          <div className="logo-container">
            <svg className="council-logo" viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg">
              <defs>
                {/* Glow filter for center */}
                <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
                  <feGaussianBlur stdDeviation="8" result="coloredBlur"/>
                  <feMerge>
                    <feMergeNode in="coloredBlur"/>
                    <feMergeNode in="SourceGraphic"/>
                  </feMerge>
                </filter>
                {/* Gradient for center sphere */}
                <radialGradient id="sphereGradient" cx="40%" cy="40%">
                  <stop offset="0%" stopColor="#fcd34d"/>
                  <stop offset="50%" stopColor="#f59e0b"/>
                  <stop offset="100%" stopColor="#d97706"/>
                </radialGradient>
                {/* Outer glow */}
                <radialGradient id="outerGlow" cx="50%" cy="50%">
                  <stop offset="0%" stopColor="#fef3c7" stopOpacity="0.8"/>
                  <stop offset="100%" stopColor="#fef3c7" stopOpacity="0"/>
                </radialGradient>
              </defs>

              {/* Outer glow halo */}
              <circle cx="100" cy="100" r="35" fill="url(#outerGlow)"/>

              {/* Orbital rings - 5 ellipses at different rotations */}
              {[0, 36, 72, 108, 144].map((rotation, i) => (
                <ellipse
                  key={`ring-${i}`}
                  cx="100"
                  cy="100"
                  rx="80"
                  ry="35"
                  fill="none"
                  stroke={i % 2 === 0 ? 'currentColor' : '#f59e0b'}
                  strokeWidth="1.5"
                  opacity={i % 2 === 0 ? 0.4 : 0.7}
                  transform={`rotate(${rotation} 100 100)`}
                />
              ))}

              {/* Nodes on orbits */}
              {[
                { angle: 30, ring: 0, isOrange: false },
                { angle: 150, ring: 0, isOrange: false },
                { angle: 270, ring: 0, isOrange: true },
                { angle: 60, ring: 1, isOrange: true },
                { angle: 180, ring: 1, isOrange: false },
                { angle: 300, ring: 1, isOrange: false },
                { angle: 0, ring: 2, isOrange: false },
                { angle: 120, ring: 2, isOrange: true },
                { angle: 240, ring: 2, isOrange: false },
                { angle: 45, ring: 3, isOrange: false },
                { angle: 165, ring: 3, isOrange: true },
                { angle: 285, ring: 3, isOrange: false },
                { angle: 90, ring: 4, isOrange: true },
                { angle: 210, ring: 4, isOrange: false },
                { angle: 330, ring: 4, isOrange: false },
              ].map((node, i) => {
                const ringRotation = [0, 36, 72, 108, 144][node.ring];
                const rad = (node.angle) * Math.PI / 180;
                const x = 80 * Math.cos(rad);
                const y = 35 * Math.sin(rad);
                const rotRad = ringRotation * Math.PI / 180;
                const finalX = 100 + x * Math.cos(rotRad) - y * Math.sin(rotRad);
                const finalY = 100 + x * Math.sin(rotRad) + y * Math.cos(rotRad);
                return (
                  <circle
                    key={`node-${i}`}
                    cx={finalX}
                    cy={finalY}
                    r="4"
                    fill={node.isOrange ? '#f59e0b' : 'currentColor'}
                    opacity={node.isOrange ? 1 : 0.6}
                  />
                );
              })}

              {/* Center glowing sphere */}
              <circle cx="100" cy="100" r="18" fill="url(#sphereGradient)" filter="url(#glow)"/>
            </svg>
            <h1 className="brand-title">WIZENGAMOT</h1>
            <p className="brand-tagline">A personal agentic sounding board</p>
          </div>
          <FeatureList />
        </div>
      </div>
    );
  }

  const getModelShortName = (model) => {
    return model?.split('/')[1] || model;
  };

  return (
    <div className="chat-interface">
      {conversation.council_config && (
        <div className="council-config-bar">
          <div className="config-info">
            <span className="config-label">Council:</span>
            <span className="config-value">
              {conversation.council_config.council_models.map(getModelShortName).join(', ')}
            </span>
          </div>
          <div className="config-info">
            <span className="config-label">Chairman:</span>
            <span className="config-value">
              {getModelShortName(conversation.council_config.chairman_model)}
            </span>
          </div>
        </div>
      )}
      <div className="messages-container">
        {(conversation.system_prompt || conversation.prompt_title) && (
          <SystemPromptBadge
            promptTitle={conversation.prompt_title}
            promptContent={conversation.system_prompt}
          />
        )}
        {conversation.messages.length === 0 ? (
          <div className="empty-state">
            <h2>Start a conversation</h2>
            <p>Ask a question to consult the LLM Council</p>
          </div>
        ) : (
          conversation.messages.map((msg, index) => (
            <div key={index} className="message-group">
              {msg.role === 'user' ? (
                <div className="user-message">
                  <div className="message-label">You</div>
                  <div className="message-content">
                    <div className="markdown-content">
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    </div>
                  </div>
                </div>
              ) : msg.role === 'follow-up-user' ? (
                <div className="user-message follow-up-message">
                  <div className="message-label">
                    You <span className="follow-up-badge">Follow-up to {getModelShortName(msg.model)}</span>
                  </div>
                  <div className="message-content">
                    {msg.comments && msg.comments.length > 0 && (
                      <div className="follow-up-context">
                        <div className="context-header">Annotations ({msg.comments.length}):</div>
                        {msg.comments.map((comment, idx) => (
                          <div key={comment.id} className="context-comment">
                            <div className="context-comment-header">
                              <span className="context-num">{idx + 1}.</span>
                              <span className="context-source">[{getModelShortName(comment.model)}, Stage {comment.stage}]</span>
                            </div>
                            <div className="context-selection">"{comment.selection}"</div>
                            <div className="context-annotation">→ {comment.content}</div>
                          </div>
                        ))}
                      </div>
                    )}
                    {msg.context_segments && msg.context_segments.length > 0 && (
                      <div className="follow-up-context stack-context">
                        <div className="context-header">Context Stack ({msg.context_segments.length}):</div>
                        {msg.context_segments.map((segment, idx) => (
                          <div key={segment.id || idx} className="context-comment">
                            <div className="context-comment-header">
                              <span className="context-num">{idx + 1}.</span>
                              <span className="context-source">
                                [{getModelShortName(segment.model)}, Stage {segment.stage}]
                              </span>
                              {segment.label && (
                                <span className="context-stack-label">{segment.label}</span>
                              )}
                              {segment.autoGenerated && (
                                <span className="context-stack-label auto">Auto</span>
                              )}
                            </div>
                            <div className="context-stack-snippet">
                              {segment.content?.length > 240
                                ? `${segment.content.substring(0, 240)}...`
                                : segment.content}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="follow-up-question">
                      <div className="markdown-content">
                        <ReactMarkdown>{msg.content}</ReactMarkdown>
                      </div>
                    </div>
                  </div>
                </div>
              ) : msg.role === 'follow-up-assistant' ? (
                <div className="assistant-message follow-up-response">
                  <div className="message-label">{getModelShortName(msg.model)}</div>
                  {msg.loading ? (
                    <div className="stage-loading">
                      <div className="spinner"></div>
                      <span>Thinking...</span>
                    </div>
                  ) : (
                    <div className="follow-up-content markdown-content">
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    </div>
                  )}
                </div>
              ) : (
                <div className="assistant-message">
                  <div className="message-label">LLM Council</div>

                  {/* Stage 1 */}
                  {msg.loading?.stage1 && (
                    <div className="stage-loading">
                      <div className="spinner"></div>
                      <span>Running Stage 1: Collecting individual responses...</span>
                    </div>
                  )}
                  {msg.stage1 && (
                    <Stage1
                      responses={msg.stage1}
                      messageIndex={index}
                      comments={comments}
                      contextSegments={contextSegments}
                      onSelectionChange={onSelectionChange}
                      onEditComment={onEditComment}
                      onDeleteComment={onDeleteComment}
                      activeCommentId={activeCommentId}
                      onSetActiveComment={onSetActiveComment}
                      onAddContextSegment={onAddContextSegment}
                      onRemoveContextSegment={onRemoveContextSegment}
                    />
                  )}

                  {/* Stage 2 */}
                  {msg.loading?.stage2 && (
                    <div className="stage-loading">
                      <div className="spinner"></div>
                      <span>Running Stage 2: Peer rankings...</span>
                    </div>
                  )}
                  {msg.stage2 && (
                    <Stage2
                      rankings={msg.stage2}
                      labelToModel={msg.metadata?.label_to_model}
                      aggregateRankings={msg.metadata?.aggregate_rankings}
                      messageIndex={index}
                      comments={comments}
                      contextSegments={contextSegments}
                      onSelectionChange={onSelectionChange}
                      onEditComment={onEditComment}
                      onDeleteComment={onDeleteComment}
                      activeCommentId={activeCommentId}
                      onSetActiveComment={onSetActiveComment}
                      onAddContextSegment={onAddContextSegment}
                      onRemoveContextSegment={onRemoveContextSegment}
                    />
                  )}

                  {/* Stage 3 */}
                  {msg.loading?.stage3 && (
                    <div className="stage-loading">
                      <div className="spinner"></div>
                      <span>Running Stage 3: Final synthesis...</span>
                    </div>
                  )}
                  {msg.stage3 && (
                    <Stage3
                      finalResponse={msg.stage3}
                      messageIndex={index}
                      comments={comments}
                      contextSegments={contextSegments}
                      onSelectionChange={onSelectionChange}
                      onEditComment={onEditComment}
                      onDeleteComment={onDeleteComment}
                      activeCommentId={activeCommentId}
                      onSetActiveComment={onSetActiveComment}
                      onAddContextSegment={onAddContextSegment}
                      onRemoveContextSegment={onRemoveContextSegment}
                    />
                  )}
                </div>
              )}
            </div>
          ))
        )}

        {isLoading && (
          <div className="loading-indicator">
            <div className="spinner"></div>
            <span>Consulting the council...</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {conversation.messages.length === 0 && (
        <form className="input-form" onSubmit={handleSubmit}>
          <textarea
            className="message-input"
            placeholder="Ask your question... (Shift+Enter for new line, Enter to send)"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isLoading}
            rows={3}
          />
          <button
            type="submit"
            className="send-button"
            disabled={!input.trim() || isLoading}
          >
            Send
          </button>
        </form>
      )}
    </div>
  );
}
