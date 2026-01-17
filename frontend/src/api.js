/**
 * API client for the LLM Council backend.
 */

// Use relative URLs in production (Docker), full URL in development
const API_BASE = import.meta.env.DEV ? 'http://localhost:8001' : '';

export const api = {
  /**
   * Get the current council configuration.
   */
  async getConfig() {
    const response = await fetch(`${API_BASE}/api/config`);
    if (!response.ok) {
      throw new Error('Failed to get config');
    }
    return response.json();
  },

  /**
   * Search conversations by semantic similarity.
   * @param {string} query - Search query
   * @param {number} limit - Maximum results to return
   */
  async searchConversations(query, limit = 10) {
    const response = await fetch(
      `${API_BASE}/api/search?q=${encodeURIComponent(query)}&limit=${limit}`
    );
    if (!response.ok) {
      throw new Error('Failed to search conversations');
    }
    return response.json();
  },

  /**
   * Get the features list for the splash screen.
   */
  async getFeatures() {
    const response = await fetch(`${API_BASE}/api/features`);
    if (!response.ok) {
      throw new Error('Failed to get features');
    }
    return response.json();
  },

  /**
   * Get version info for OTA updates.
   * Returns local commit, remote commit, and how many commits behind.
   * @param {boolean} force - If true, bypass cache and fetch fresh data
   */
  async getVersion(force = false) {
    const url = force ? `${API_BASE}/api/version?force=true` : `${API_BASE}/api/version`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error('Failed to get version');
    }
    return response.json();
  },

  /**
   * Trigger git pull and server restart.
   * Server will restart after successful pull.
   */
  async triggerUpdate() {
    const response = await fetch(`${API_BASE}/api/update`, {
      method: 'POST',
    });
    if (!response.ok) {
      throw new Error('Failed to trigger update');
    }
    return response.json();
  },

  /**
   * List all conversations.
   */
  async listConversations() {
    const response = await fetch(`${API_BASE}/api/conversations`);
    if (!response.ok) {
      throw new Error('Failed to list conversations');
    }
    return response.json();
  },

  /**
   * Create a new conversation.
   * @param {Object} councilConfig - Optional council configuration
   * @param {Array<string>} councilConfig.council_models - List of model identifiers
   * @param {string} councilConfig.chairman_model - Chairman model identifier
   * @param {string} systemPrompt - Optional system prompt content
   * @param {string} mode - Conversation mode: "council" or "synthesizer"
   * @param {Object} synthesizerConfig - Optional synthesizer configuration
   */
  async createConversation(councilConfig = null, systemPrompt = null, mode = 'council', synthesizerConfig = null) {
    const body = { mode };
    if (councilConfig) body.council_config = councilConfig;
    if (systemPrompt) body.system_prompt = systemPrompt;
    if (synthesizerConfig) body.synthesizer_config = synthesizerConfig;

    const response = await fetch(`${API_BASE}/api/conversations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error('Failed to create conversation');
    }
    return response.json();
  },

  /**
   * Get a specific conversation.
   */
  async getConversation(conversationId) {
    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}`
    );
    if (!response.ok) {
      throw new Error('Failed to get conversation');
    }
    return response.json();
  },

  /**
   * Delete a conversation.
   */
  async deleteConversation(conversationId) {
    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}`,
      {
        method: 'DELETE',
      }
    );
    if (!response.ok) {
      throw new Error('Failed to delete conversation');
    }
    return response.json();
  },

  async updateSynthesizerSource(conversationId, updates) {
    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}/synthesizer-source`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updates),
      }
    );
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || 'Failed to update source info');
    }
    return response.json();
  },

  /**
   * Mark a conversation as read.
   */
  async markConversationRead(conversationId) {
    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}/mark-read`,
      {
        method: 'POST',
      }
    );
    if (!response.ok) {
      throw new Error('Failed to mark conversation as read');
    }
    return response.json();
  },

  /**
   * Send a message in a conversation.
   */
  async sendMessage(conversationId, content) {
    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}/message`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content }),
      }
    );
    if (!response.ok) {
      throw new Error('Failed to send message');
    }
    return response.json();
  },

  /**
   * Send a message and receive streaming updates.
   * @param {string} conversationId - The conversation ID
   * @param {string} content - The message content
   * @param {function} onEvent - Callback function for each event: (eventType, data) => void
   * @returns {Promise<void>}
   */
  async sendMessageStream(conversationId, content, onEvent) {
    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}/message/stream`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content }),
      }
    );

    if (!response.ok) {
      throw new Error('Failed to send message');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split('\n');

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          try {
            const event = JSON.parse(data);
            onEvent(event.type, event);
          } catch (e) {
            console.error('Failed to parse SSE event:', e);
          }
        }
      }
    }
  },

  /**
   * List all available prompts (with labels).
   * @param {string} mode - Optional mode filter ('council' or 'synthesizer')
   */
  async listPrompts(mode = null) {
    const url = mode
      ? `${API_BASE}/api/prompts?mode=${mode}`
      : `${API_BASE}/api/prompts`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error('Failed to list prompts');
    }
    return response.json();
  },

  /**
   * Get prompt labels mapping (title -> label).
   */
  async getPromptLabels() {
    const response = await fetch(`${API_BASE}/api/prompts/labels`);
    if (!response.ok) {
      throw new Error('Failed to get prompt labels');
    }
    return response.json();
  },

  /**
   * Get a specific prompt by filename.
   * @param {string} filename - The prompt filename
   * @param {string} mode - Optional mode ('council' or 'synthesizer')
   */
  async getPrompt(filename, mode = null) {
    const url = mode
      ? `${API_BASE}/api/prompts/${filename}?mode=${mode}`
      : `${API_BASE}/api/prompts/${filename}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error('Failed to get prompt');
    }
    return response.json();
  },

  /**
   * Create a new prompt.
   * @param {string} title - The prompt title
   * @param {string} content - The prompt content
   * @param {string} mode - Optional mode ('council' or 'synthesizer')
   */
  async createPrompt(title, content, mode = null) {
    const body = { title, content };
    if (mode) body.mode = mode;

    const response = await fetch(`${API_BASE}/api/prompts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error('Failed to create prompt');
    }
    return response.json();
  },

  /**
   * Update an existing prompt.
   * @param {string} filename - The prompt filename
   * @param {string} content - The new content
   * @param {string} mode - Optional mode ('council' or 'synthesizer')
   */
  async updatePrompt(filename, content, mode = null) {
    const body = { content };
    if (mode) body.mode = mode;

    const response = await fetch(`${API_BASE}/api/prompts/${filename}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error('Failed to update prompt');
    }
    return response.json();
  },

  /**
   * Delete a prompt.
   * @param {string} filename - The prompt filename
   * @param {string} mode - Optional mode ('council' or 'synthesizer')
   */
  async deletePrompt(filename, mode = null) {
    const url = mode
      ? `${API_BASE}/api/prompts/${filename}?mode=${mode}`
      : `${API_BASE}/api/prompts/${filename}`;
    const response = await fetch(url, {
      method: 'DELETE',
    });
    if (!response.ok) {
      throw new Error('Failed to delete prompt');
    }
    return response.json();
  },

  // ==========================================================================
  // Question Sets API Methods
  // ==========================================================================

  /**
   * List all available question sets.
   */
  async listQuestionSets() {
    const response = await fetch(`${API_BASE}/api/question-sets`);
    if (!response.ok) {
      throw new Error('Failed to list question sets');
    }
    return response.json();
  },

  /**
   * Get a specific question set by filename.
   * @param {string} filename - Question set filename (e.g., 'default-b2b-saas.md')
   */
  async getQuestionSet(filename) {
    const response = await fetch(`${API_BASE}/api/question-sets/${filename}`);
    if (!response.ok) {
      throw new Error('Failed to get question set');
    }
    return response.json();
  },

  /**
   * Create a new question set.
   * @param {string} title - Question set title
   * @param {Object} questions - Questions as key-value pairs {key: questionText}
   * @param {string} description - Optional description
   * @param {Object} outputSchema - Optional output schema {key: description}
   */
  async createQuestionSet(title, questions, description = '', outputSchema = null) {
    const response = await fetch(`${API_BASE}/api/question-sets`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title,
        questions,
        description,
        output_schema: outputSchema,
      }),
    });
    if (!response.ok) {
      throw new Error('Failed to create question set');
    }
    return response.json();
  },

  /**
   * Update an existing question set.
   * @param {string} filename - Question set filename
   * @param {Object} updates - Fields to update: content, questions, description, output_schema
   */
  async updateQuestionSet(filename, updates) {
    const response = await fetch(`${API_BASE}/api/question-sets/${filename}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(updates),
    });
    if (!response.ok) {
      throw new Error('Failed to update question set');
    }
    return response.json();
  },

  /**
   * Delete a question set.
   * @param {string} filename - Question set filename
   */
  async deleteQuestionSet(filename) {
    const response = await fetch(`${API_BASE}/api/question-sets/${filename}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      throw new Error('Failed to delete question set');
    }
    return response.json();
  },

  /**
   * Create a comment on a response. Supports both Council and Synthesizer modes.
   * @param {string} conversationId - The conversation ID
   * @param {Object} commentData - Comment data object
   * @param {string} commentData.selection - Highlighted text
   * @param {string} commentData.content - Comment text
   * @param {string} [commentData.sourceType='council'] - 'council' or 'synthesizer'
   * @param {string} [commentData.sourceContent] - Full source content
   * Council-specific:
   * @param {number} [commentData.messageIndex] - Message index
   * @param {number} [commentData.stage] - Stage (1, 2, or 3)
   * @param {string} [commentData.model] - Model identifier
   * Synthesizer-specific:
   * @param {string} [commentData.noteId] - Note ID
   * @param {string} [commentData.noteTitle] - Note title
   * @param {string} [commentData.sourceUrl] - Source URL
   * @param {string} [commentData.noteModel] - Model that generated the note
   */
  async createComment(conversationId, commentData) {
    const body = {
      selection: commentData.selection,
      content: commentData.content,
      source_type: commentData.sourceType || 'council',
      source_content: commentData.sourceContent || null,
    };

    // Add council-specific fields
    if (commentData.sourceType === 'council' || !commentData.sourceType) {
      body.message_index = commentData.messageIndex;
      body.stage = commentData.stage;
      body.model = commentData.model;
    }

    // Add synthesizer-specific fields
    if (commentData.sourceType === 'synthesizer') {
      body.note_id = commentData.noteId;
      body.note_title = commentData.noteTitle;
      body.source_url = commentData.sourceUrl;
      body.note_model = commentData.noteModel;
    }

    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}/comments`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }
    );
    if (!response.ok) {
      throw new Error('Failed to create comment');
    }
    return response.json();
  },

  /**
   * Get comments for a conversation.
   */
  async getComments(conversationId, messageIndex = null) {
    const url = messageIndex !== null
      ? `${API_BASE}/api/conversations/${conversationId}/comments?message_index=${messageIndex}`
      : `${API_BASE}/api/conversations/${conversationId}/comments`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error('Failed to get comments');
    }
    return response.json();
  },

  /**
   * Update a comment.
   */
  async updateComment(conversationId, commentId, content) {
    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}/comments/${commentId}`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content }),
      }
    );
    if (!response.ok) {
      throw new Error('Failed to update comment');
    }
    return response.json();
  },

  /**
   * Delete a comment.
   */
  async deleteComment(conversationId, commentId) {
    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}/comments/${commentId}`,
      {
        method: 'DELETE',
      }
    );
    if (!response.ok) {
      throw new Error('Failed to delete comment');
    }
    return response.json();
  },

  /**
   * Create a follow-up thread with a specific model.
   */
  async createThread(conversationId, model, commentIds, question, options = {}) {
    const { messageIndex, noteIds, contextSegments = [], compiledContext = null } = options;

    const body = {
      model,
      comment_ids: commentIds,
      question,
      context_segments: contextSegments,
      compiled_context: compiledContext,
    };

    // Add mode-specific fields
    if (messageIndex !== undefined && messageIndex !== null) {
      body.message_index = messageIndex;
    }
    if (noteIds && noteIds.length > 0) {
      body.note_ids = noteIds;
    }

    console.log('API createThread body:', JSON.stringify(body, null, 2));

    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}/threads`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }
    );
    if (!response.ok) {
      const errorText = await response.text();
      console.error('Thread creation failed:', response.status, errorText);
      throw new Error(`Failed to create thread: ${errorText}`);
    }
    return response.json();
  },

  /**
   * Get a specific thread.
   */
  async getThread(conversationId, threadId) {
    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}/threads/${threadId}`
    );
    if (!response.ok) {
      throw new Error('Failed to get thread');
    }
    return response.json();
  },

  /**
   * Continue a thread with a new question.
   */
  async continueThread(conversationId, threadId, question) {
    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}/threads/${threadId}/message`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ question }),
      }
    );
    if (!response.ok) {
      throw new Error('Failed to continue thread');
    }
    return response.json();
  },

  // ==========================================================================
  // Review Sessions API Methods
  // ==========================================================================

  /**
   * List all review sessions for a conversation.
   * @param {string} conversationId - The conversation ID
   * @returns {Promise<{sessions: Array, active_session_id: string|null}>}
   */
  async listReviewSessions(conversationId) {
    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}/review-sessions`
    );
    if (!response.ok) {
      throw new Error('Failed to list review sessions');
    }
    return response.json();
  },

  /**
   * Create a new review session.
   * @param {string} conversationId - The conversation ID
   * @param {string} [name] - Optional session name (auto-generated if not provided)
   */
  async createReviewSession(conversationId, name = null) {
    const body = {};
    if (name) body.name = name;

    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}/review-sessions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }
    );
    if (!response.ok) {
      throw new Error('Failed to create review session');
    }
    return response.json();
  },

  /**
   * Get the active review session for a conversation.
   * @param {string} conversationId - The conversation ID
   */
  async getActiveReviewSession(conversationId) {
    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}/review-sessions/active`
    );
    if (!response.ok) {
      throw new Error('Failed to get active review session');
    }
    return response.json();
  },

  /**
   * Get a specific review session.
   * @param {string} conversationId - The conversation ID
   * @param {string} sessionId - The session ID
   */
  async getReviewSession(conversationId, sessionId) {
    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}/review-sessions/${sessionId}`
    );
    if (!response.ok) {
      throw new Error('Failed to get review session');
    }
    return response.json();
  },

  /**
   * Update a review session (rename).
   * @param {string} conversationId - The conversation ID
   * @param {string} sessionId - The session ID
   * @param {string} name - New session name
   */
  async updateReviewSession(conversationId, sessionId, name) {
    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}/review-sessions/${sessionId}`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name }),
      }
    );
    if (!response.ok) {
      throw new Error('Failed to update review session');
    }
    return response.json();
  },

  /**
   * Delete a review session and all its threads.
   * @param {string} conversationId - The conversation ID
   * @param {string} sessionId - The session ID
   */
  async deleteReviewSession(conversationId, sessionId) {
    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}/review-sessions/${sessionId}`,
      {
        method: 'DELETE',
      }
    );
    if (!response.ok) {
      throw new Error('Failed to delete review session');
    }
    return response.json();
  },

  /**
   * Set a review session as active.
   * @param {string} conversationId - The conversation ID
   * @param {string} sessionId - The session ID
   */
  async activateReviewSession(conversationId, sessionId) {
    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}/review-sessions/${sessionId}/activate`,
      {
        method: 'POST',
      }
    );
    if (!response.ok) {
      throw new Error('Failed to activate review session');
    }
    return response.json();
  },

  // ==========================================================================
  // Session-scoped Comments API Methods
  // ==========================================================================

  /**
   * Create a comment within a review session.
   * @param {string} conversationId - The conversation ID
   * @param {string} sessionId - The session ID
   * @param {Object} commentData - Comment data
   */
  async createSessionComment(conversationId, sessionId, commentData) {
    const body = {
      selection: commentData.selection,
      content: commentData.content,
      source_type: commentData.sourceType || 'council',
      source_content: commentData.sourceContent || null,
    };

    if (commentData.sourceType === 'council' || !commentData.sourceType) {
      body.message_index = commentData.messageIndex;
      body.stage = commentData.stage;
      body.model = commentData.model;
    }

    if (commentData.sourceType === 'synthesizer') {
      body.note_id = commentData.noteId;
      body.note_title = commentData.noteTitle;
      body.source_url = commentData.sourceUrl;
      body.note_model = commentData.noteModel;
    }

    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}/review-sessions/${sessionId}/comments`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }
    );
    if (!response.ok) {
      throw new Error('Failed to create session comment');
    }
    return response.json();
  },

  /**
   * Get comments for a review session.
   * @param {string} conversationId - The conversation ID
   * @param {string} sessionId - The session ID
   * @param {number} [messageIndex] - Optional message index filter
   */
  async getSessionComments(conversationId, sessionId, messageIndex = null) {
    let url = `${API_BASE}/api/conversations/${conversationId}/review-sessions/${sessionId}/comments`;
    if (messageIndex !== null) {
      url += `?message_index=${messageIndex}`;
    }
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error('Failed to get session comments');
    }
    return response.json();
  },

  /**
   * Update a comment within a session.
   * @param {string} conversationId - The conversation ID
   * @param {string} sessionId - The session ID
   * @param {string} commentId - The comment ID
   * @param {string} content - New content
   */
  async updateSessionComment(conversationId, sessionId, commentId, content) {
    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}/review-sessions/${sessionId}/comments/${commentId}`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content }),
      }
    );
    if (!response.ok) {
      throw new Error('Failed to update session comment');
    }
    return response.json();
  },

  /**
   * Delete a comment from a session.
   * @param {string} conversationId - The conversation ID
   * @param {string} sessionId - The session ID
   * @param {string} commentId - The comment ID
   */
  async deleteSessionComment(conversationId, sessionId, commentId) {
    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}/review-sessions/${sessionId}/comments/${commentId}`,
      {
        method: 'DELETE',
      }
    );
    if (!response.ok) {
      throw new Error('Failed to delete session comment');
    }
    return response.json();
  },

  // ==========================================================================
  // Session-scoped Context Segments API Methods
  // ==========================================================================

  /**
   * Add a context segment to a review session.
   * @param {string} conversationId - The conversation ID
   * @param {string} sessionId - The session ID
   * @param {Object} segment - Segment data
   */
  async addSessionContextSegment(conversationId, sessionId, segment) {
    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}/review-sessions/${sessionId}/segments`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(segment),
      }
    );
    if (!response.ok) {
      throw new Error('Failed to add context segment');
    }
    return response.json();
  },

  /**
   * Remove a context segment from a session.
   * @param {string} conversationId - The conversation ID
   * @param {string} sessionId - The session ID
   * @param {string} segmentId - The segment ID
   */
  async removeSessionContextSegment(conversationId, sessionId, segmentId) {
    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}/review-sessions/${sessionId}/segments/${segmentId}`,
      {
        method: 'DELETE',
      }
    );
    if (!response.ok) {
      throw new Error('Failed to remove context segment');
    }
    return response.json();
  },

  // ==========================================================================
  // Session-scoped Threads API Methods
  // ==========================================================================

  /**
   * Create a thread within a review session.
   * @param {string} conversationId - The conversation ID
   * @param {string} sessionId - The session ID
   * @param {string} model - Model to use
   * @param {Array<string>} commentIds - Comment IDs for context
   * @param {string} question - Initial question
   * @param {Object} options - Additional options
   */
  async createSessionThread(conversationId, sessionId, model, commentIds, question, options = {}) {
    const { messageIndex, noteIds, contextSegments = [], compiledContext = null } = options;

    const body = {
      model,
      comment_ids: commentIds,
      question,
      context_segments: contextSegments,
      compiled_context: compiledContext,
    };

    if (messageIndex !== undefined && messageIndex !== null) {
      body.message_index = messageIndex;
    }
    if (noteIds && noteIds.length > 0) {
      body.note_ids = noteIds;
    }

    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}/review-sessions/${sessionId}/threads`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }
    );
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to create session thread: ${errorText}`);
    }
    return response.json();
  },

  /**
   * Get a thread from a session.
   * @param {string} conversationId - The conversation ID
   * @param {string} sessionId - The session ID
   * @param {string} threadId - The thread ID
   */
  async getSessionThread(conversationId, sessionId, threadId) {
    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}/review-sessions/${sessionId}/threads/${threadId}`
    );
    if (!response.ok) {
      throw new Error('Failed to get session thread');
    }
    return response.json();
  },

  /**
   * Continue a thread within a session.
   * @param {string} conversationId - The conversation ID
   * @param {string} sessionId - The session ID
   * @param {string} threadId - The thread ID
   * @param {string} question - New question
   */
  async continueSessionThread(conversationId, sessionId, threadId, question) {
    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}/review-sessions/${sessionId}/threads/${threadId}/message`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ question }),
      }
    );
    if (!response.ok) {
      throw new Error('Failed to continue session thread');
    }
    return response.json();
  },

  /**
   * Get current settings status.
   */
  async getSettings() {
    const response = await fetch(`${API_BASE}/api/settings`);
    if (!response.ok) {
      throw new Error('Failed to get settings');
    }
    return response.json();
  },

  /**
   * Get OpenRouter credits information.
   * Returns: { limit, usage, remaining, is_free_tier, rate_limit }
   */
  async getCredits() {
    const response = await fetch(`${API_BASE}/api/credits`);
    if (!response.ok) {
      throw new Error('Failed to get credits');
    }
    return response.json();
  },

  /**
   * Update the OpenRouter API key.
   */
  async updateApiKey(apiKey) {
    const response = await fetch(`${API_BASE}/api/settings/api-key`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ api_key: apiKey }),
    });
    if (!response.ok) {
      throw new Error('Failed to update API key');
    }
    return response.json();
  },

  /**
   * Clear the API key from settings.
   */
  async clearApiKey() {
    const response = await fetch(`${API_BASE}/api/settings/api-key`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      throw new Error('Failed to clear API key');
    }
    return response.json();
  },

  /**
   * Get model configuration settings.
   */
  async getModelSettings() {
    const response = await fetch(`${API_BASE}/api/settings/models`);
    if (!response.ok) {
      throw new Error('Failed to get model settings');
    }
    return response.json();
  },

  /**
   * Update the model pool.
   */
  async updateModelPool(models) {
    const response = await fetch(`${API_BASE}/api/settings/model-pool`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ models }),
    });
    if (!response.ok) {
      throw new Error('Failed to update model pool');
    }
    return response.json();
  },

  /**
   * Update the default council models.
   */
  async updateCouncilModels(models) {
    const response = await fetch(`${API_BASE}/api/settings/council-models`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ models }),
    });
    if (!response.ok) {
      throw new Error('Failed to update council models');
    }
    return response.json();
  },

  /**
   * Update the default chairman model.
   */
  async updateChairman(model) {
    const response = await fetch(`${API_BASE}/api/settings/chairman`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model }),
    });
    if (!response.ok) {
      throw new Error('Failed to update chairman');
    }
    return response.json();
  },

  /**
   * Update the default system prompt.
   */
  async updateDefaultPrompt(promptFilename) {
    const response = await fetch(`${API_BASE}/api/settings/default-prompt`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prompt_filename: promptFilename }),
    });
    if (!response.ok) {
      throw new Error('Failed to update default prompt');
    }
    return response.json();
  },

  // ==========================================================================
  // Model Management API Methods
  // ==========================================================================

  /**
   * Test a model with a smoke test query.
   * @param {string} modelId - The model ID to test
   */
  async testModel(modelId) {
    const response = await fetch(`${API_BASE}/api/settings/test-model`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: modelId }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || 'Failed to test model');
    }
    return response.json();
  },

  /**
   * Get dependencies for a model (which features use it).
   * @param {string} modelId - The model ID to check
   */
  async getModelDependencies(modelId) {
    const response = await fetch(
      `${API_BASE}/api/settings/model-dependencies/${encodeURIComponent(modelId)}`
    );
    if (!response.ok) {
      throw new Error('Failed to get model dependencies');
    }
    return response.json();
  },

  /**
   * Replace a model across all usages.
   * @param {string} oldModel - The model to replace
   * @param {string} newModel - The replacement model
   * @param {boolean} removeOld - Whether to remove the old model from pool
   */
  async replaceModel(oldModel, newModel, removeOld = true) {
    const response = await fetch(`${API_BASE}/api/settings/replace-model`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        old_model: oldModel,
        new_model: newModel,
        remove_old: removeOld,
      }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || 'Failed to replace model');
    }
    return response.json();
  },

  // ==========================================================================
  // Usage Statistics API Methods
  // ==========================================================================

  /**
   * Get usage statistics (spending by mode, top conversations, etc.).
   */
  async getUsageStats() {
    const response = await fetch(`${API_BASE}/api/usage-stats`);
    if (!response.ok) {
      throw new Error('Failed to get usage stats');
    }
    return response.json();
  },

  // ==========================================================================
  // Stage Prompts API Methods
  // ==========================================================================

  /**
   * List all stage prompts (ranking and chairman).
   */
  async listStagePrompts() {
    const response = await fetch(`${API_BASE}/api/stage-prompts`);
    if (!response.ok) {
      throw new Error('Failed to list stage prompts');
    }
    return response.json();
  },

  /**
   * Get a specific stage prompt.
   * @param {string} promptType - 'ranking' or 'chairman'
   */
  async getStagePrompt(promptType) {
    const response = await fetch(`${API_BASE}/api/stage-prompts/${promptType}`);
    if (!response.ok) {
      throw new Error('Failed to get stage prompt');
    }
    return response.json();
  },

  /**
   * Update a stage prompt.
   * @param {string} promptType - 'ranking' or 'chairman'
   * @param {string} content - The new prompt content
   */
  async updateStagePrompt(promptType, content) {
    const response = await fetch(`${API_BASE}/api/stage-prompts/${promptType}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ content }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || 'Failed to update stage prompt');
    }
    return response.json();
  },

  /**
   * Reset a stage prompt to the built-in default.
   * @param {string} promptType - 'ranking' or 'chairman'
   */
  async resetStagePrompt(promptType) {
    const response = await fetch(`${API_BASE}/api/stage-prompts/${promptType}/reset`, {
      method: 'POST',
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || 'Failed to reset stage prompt');
    }
    return response.json();
  },

  // ==========================================================================
  // Synthesizer Stage Prompts API Methods
  // ==========================================================================

  /**
   * List all synthesizer stage prompts (ranking and chairman for deliberation).
   */
  async listSynthStagePrompts() {
    const response = await fetch(`${API_BASE}/api/synth-stage-prompts`);
    if (!response.ok) {
      throw new Error('Failed to list synthesizer stage prompts');
    }
    return response.json();
  },

  /**
   * Get a specific synthesizer stage prompt.
   * @param {string} promptType - 'ranking' or 'chairman'
   */
  async getSynthStagePrompt(promptType) {
    const response = await fetch(`${API_BASE}/api/synth-stage-prompts/${promptType}`);
    if (!response.ok) {
      throw new Error('Failed to get synthesizer stage prompt');
    }
    return response.json();
  },

  /**
   * Update a synthesizer stage prompt.
   * @param {string} promptType - 'ranking' or 'chairman'
   * @param {string} content - The new prompt content
   */
  async updateSynthStagePrompt(promptType, content) {
    const response = await fetch(`${API_BASE}/api/synth-stage-prompts/${promptType}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ content }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || 'Failed to update synthesizer stage prompt');
    }
    return response.json();
  },

  /**
   * Reset a synthesizer stage prompt to the built-in default.
   * @param {string} promptType - 'ranking' or 'chairman'
   */
  async resetSynthStagePrompt(promptType) {
    const response = await fetch(`${API_BASE}/api/synth-stage-prompts/${promptType}/reset`, {
      method: 'POST',
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || 'Failed to reset synthesizer stage prompt');
    }
    return response.json();
  },

  // ==========================================================================
  // Synthesizer API Methods
  // ==========================================================================

  /**
   * Process a URL or raw text and generate Zettelkasten notes.
   * @param {string} conversationId - The conversation ID
   * @param {string} url - URL to process (null if using text)
   * @param {string} comment - Optional user comment/guidance
   * @param {string} model - Optional model override
   * @param {boolean} useCouncil - Whether to use multiple models
   * @param {string} text - Direct text input (null if using URL)
   * @param {boolean} useDeliberation - Whether to use full 3-stage council deliberation
   * @param {Array<string>} councilModels - Optional models for deliberation mode
   * @param {string} chairmanModel - Optional chairman for deliberation mode
   */
  async synthesize(conversationId, url, comment = null, model = null, useCouncil = false, text = null, useDeliberation = false, councilModels = null, chairmanModel = null) {
    const body = {
      url: url || null,
      text: text || null,
      comment,
      model,
      use_council: useCouncil,
      use_deliberation: useDeliberation,
    };

    // Only include council config if deliberation mode is enabled
    if (useDeliberation && councilModels) {
      body.council_models = councilModels;
    }
    if (useDeliberation && chairmanModel) {
      body.chairman_model = chairmanModel;
    }

    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}/synthesize`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }
    );
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || 'Failed to synthesize');
    }
    return response.json();
  },

  /**
   * Get synthesizer settings.
   */
  async getSynthesizerSettings() {
    const response = await fetch(`${API_BASE}/api/settings/synthesizer`);
    if (!response.ok) {
      throw new Error('Failed to get synthesizer settings');
    }
    return response.json();
  },

  /**
   * Update synthesizer settings.
   */
  async updateSynthesizerSettings(model = null, mode = null, prompt = null) {
    const body = {};
    if (model !== null) body.model = model;
    if (mode !== null) body.mode = mode;
    if (prompt !== null) body.prompt = prompt;

    const response = await fetch(`${API_BASE}/api/settings/synthesizer`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error('Failed to update synthesizer settings');
    }
    return response.json();
  },

  // ==========================================================================
  // Visualiser API Methods
  // ==========================================================================

  /**
   * Get the API base URL.
   * Used for constructing image URLs.
   */
  getBaseUrl() {
    return API_BASE;
  },

  /**
   * List all visualiser images with metadata for gallery view.
   * @param {number} limit - Maximum images to return (default 100)
   * @param {number} offset - Offset for pagination (default 0)
   * @returns {Promise<{images: Array, total: number, limit: number, offset: number}>}
   */
  async listImages(limit = 100, offset = 0) {
    const response = await fetch(`${API_BASE}/api/images?limit=${limit}&offset=${offset}`);
    if (!response.ok) {
      throw new Error('Failed to list images');
    }
    return response.json();
  },

  /**
   * Generate a diagram from content.
   * @param {string} conversationId - The conversation ID
   * @param {Object} options - Visualisation options
   * @param {string} options.source_type - 'conversation', 'url', or 'text'
   * @param {string} [options.source_id] - Source conversation ID (if source_type='conversation')
   * @param {string} [options.source_url] - Source URL (if source_type='url')
   * @param {string} [options.source_text] - Source text (if source_type='text')
   * @param {string} options.style - Diagram style
   * @param {string} [options.model] - Optional model override
   */
  async visualise(conversationId, options) {
    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}/visualise`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(options),
      }
    );
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || 'Failed to generate diagram');
    }
    return response.json();
  },

  /**
   * Create a visualisation from highlighted context in a conversation.
   * @param {string} conversationId - The source conversation ID
   * @param {Array} comments - Array of comment/highlight objects
   * @param {Array} contextSegments - Array of pinned context segments
   * @param {string} style - Diagram style (default: 'bento')
   * @param {string} [model] - Optional model override
   * @returns {Promise<{conversation_id, conversation_title, image_id, image_url, style, model}>}
   */
  async visualiseFromContext(conversationId, comments, contextSegments = [], style = 'bento', model = null) {
    const body = {
      comments,
      context_segments: contextSegments,
      style,
    };
    if (model) body.model = model;

    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}/visualise-context`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }
    );
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || 'Failed to create visualisation from context');
    }
    return response.json();
  },

  /**
   * Edit/regenerate a diagram to create a new version.
   * @param {string} conversationId - The conversation ID
   * @param {string} editPrompt - Description of changes to make
   * @param {string} [model] - Optional model override
   */
  async editVisualisation(conversationId, editPrompt, model = null) {
    const body = { edit_prompt: editPrompt };
    if (model) body.model = model;

    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}/visualise/edit`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }
    );
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || 'Failed to edit diagram');
    }
    return response.json();
  },

  /**
   * Get visualiser settings including diagram styles.
   */
  async getVisualiserSettings() {
    const response = await fetch(`${API_BASE}/api/settings/visualiser`);
    if (!response.ok) {
      throw new Error('Failed to get visualiser settings');
    }
    return response.json();
  },

  /**
   * Update visualiser default model.
   * @param {string} model - Model to use for visualisation
   */
  async updateVisualiserModel(model) {
    const response = await fetch(`${API_BASE}/api/settings/visualiser/model`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model }),
    });
    if (!response.ok) {
      throw new Error('Failed to update visualiser model');
    }
    return response.json();
  },

  /**
   * Get all diagram styles.
   */
  async getDiagramStyles() {
    const response = await fetch(`${API_BASE}/api/settings/visualiser/styles`);
    if (!response.ok) {
      throw new Error('Failed to get diagram styles');
    }
    return response.json();
  },

  /**
   * Get a specific diagram style.
   * @param {string} styleId - The style ID
   */
  async getDiagramStyle(styleId) {
    const response = await fetch(`${API_BASE}/api/settings/visualiser/styles/${styleId}`);
    if (!response.ok) {
      throw new Error('Failed to get diagram style');
    }
    return response.json();
  },

  /**
   * Create a new diagram style.
   * @param {string} id - Style ID (alphanumeric and underscores)
   * @param {string} name - Display name
   * @param {string} description - Short description
   * @param {string} icon - Lucide icon name
   * @param {string} prompt - Full prompt text
   */
  async createDiagramStyle(id, name, description, icon, prompt) {
    const response = await fetch(`${API_BASE}/api/settings/visualiser/styles`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ id, name, description, icon, prompt }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || 'Failed to create diagram style');
    }
    return response.json();
  },

  /**
   * Update a diagram style.
   * @param {string} styleId - The style ID
   * @param {string} name - Display name
   * @param {string} description - Short description
   * @param {string} icon - Lucide icon name
   * @param {string} prompt - Full prompt text
   */
  async updateDiagramStyle(styleId, name, description, icon, prompt) {
    const response = await fetch(`${API_BASE}/api/settings/visualiser/styles/${styleId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name, description, icon, prompt }),
    });
    if (!response.ok) {
      throw new Error('Failed to update diagram style');
    }
    return response.json();
  },

  /**
   * Delete a diagram style.
   * @param {string} styleId - The style ID to delete
   */
  async deleteDiagramStyle(styleId) {
    const response = await fetch(`${API_BASE}/api/settings/visualiser/styles/${styleId}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || 'Failed to delete diagram style');
    }
    return response.json();
  },

  /**
   * Spell check a visualisation and generate a corrected version if errors are found.
   * @param {string} conversationId - The conversation ID
   * @param {string} [model] - Optional model override for image regeneration
   * @returns {Promise<{has_errors: boolean, errors_found: string[], image_id?: string, image_url?: string, message?: string}>}
   */
  async spellCheckVisualisation(conversationId, model = null) {
    const body = {};
    if (model) body.model = model;

    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}/visualise/spellcheck`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }
    );
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || 'Failed to spell check diagram');
    }
    return response.json();
  },

  /**
   * Update Firecrawl API key.
   */
  async updateFirecrawlApiKey(apiKey) {
    const response = await fetch(`${API_BASE}/api/settings/firecrawl-api-key`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ api_key: apiKey }),
    });
    if (!response.ok) {
      throw new Error('Failed to update Firecrawl API key');
    }
    return response.json();
  },

  /**
   * Clear Firecrawl API key.
   */
  async clearFirecrawlApiKey() {
    const response = await fetch(`${API_BASE}/api/settings/firecrawl-api-key`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      throw new Error('Failed to clear Firecrawl API key');
    }
    return response.json();
  },

  // ==========================================================================
  // Crawler Settings API Methods
  // ==========================================================================

  /**
   * Get crawler health status including memory, CPU, and uptime.
   * Returns: { healthy, memory_percent, cpu_percent, uptime_seconds, error }
   */
  async getCrawlerHealth() {
    const response = await fetch(`${API_BASE}/api/crawler/health`);
    if (!response.ok) {
      throw new Error('Failed to get crawler health');
    }
    return response.json();
  },

  /**
   * Get crawler settings including provider and URL configuration.
   * Returns: { provider, crawl4ai_url, firecrawl_configured, auto_fallback }
   */
  async getCrawlerSettings() {
    const response = await fetch(`${API_BASE}/api/settings/crawler`);
    if (!response.ok) {
      throw new Error('Failed to get crawler settings');
    }
    return response.json();
  },

  /**
   * Update crawler settings.
   * @param {Object} settings - Settings to update
   * @param {string} [settings.provider] - 'crawl4ai' or 'firecrawl'
   * @param {string} [settings.crawl4ai_url] - Crawl4AI service URL
   * @param {boolean} [settings.auto_fallback] - Auto-fallback to Firecrawl
   */
  async updateCrawlerSettings(settings) {
    const response = await fetch(`${API_BASE}/api/settings/crawler`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(settings),
    });
    if (!response.ok) {
      throw new Error('Failed to update crawler settings');
    }
    return response.json();
  },

  // ==========================================================================
  // Tweet Generation
  // ==========================================================================

  /**
   * Generate a tweet from a note.
   * @param {string} noteBody - The note content
   * @param {string} noteTitle - The note title
   * @param {Array} comments - Optional comments on the note
   * @param {string} customPrompt - Optional customization prompt
   */
  async generateTweet(noteBody, noteTitle, comments = null, customPrompt = null) {
    const response = await fetch(`${API_BASE}/api/generate-tweet`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        note_body: noteBody,
        note_title: noteTitle,
        comments: comments,
        custom_prompt: customPrompt,
      }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || 'Failed to generate tweet');
    }
    return response.json();
  },

  /**
   * Save a generated tweet to a note.
   * @param {string} conversationId - The conversation ID
   * @param {string} noteId - The note ID (e.g., "note-1")
   * @param {string} tweet - The generated tweet text
   */
  async saveNoteTweet(conversationId, noteId, tweet) {
    const response = await fetch(`${API_BASE}/api/conversations/${conversationId}/notes/${noteId}/tweet`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ tweet }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || 'Failed to save tweet');
    }
    return response.json();
  },

  // ==========================================================================
  // Monitor API Methods
  // ==========================================================================

  /**
   * List all monitors.
   */
  async listMonitors() {
    const response = await fetch(`${API_BASE}/api/monitors`);
    if (!response.ok) {
      throw new Error('Failed to list monitors');
    }
    return response.json();
  },

  /**
   * Create a new monitor.
   * @param {string} name - Monitor name
   * @param {string} questionSet - Question set to use (default: 'default_b2b_saas_v1')
   */
  async createMonitor(name, questionSet = 'default_b2b_saas_v1') {
    const response = await fetch(`${API_BASE}/api/monitors`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name, question_set: questionSet }),
    });
    if (!response.ok) {
      throw new Error('Failed to create monitor');
    }
    return response.json();
  },

  /**
   * Get a specific monitor.
   * @param {string} monitorId - The monitor ID
   */
  async getMonitor(monitorId) {
    const response = await fetch(`${API_BASE}/api/monitors/${monitorId}`);
    if (!response.ok) {
      throw new Error('Failed to get monitor');
    }
    return response.json();
  },

  /**
   * Update a monitor's configuration.
   * @param {string} monitorId - The monitor ID
   * @param {Object} updates - Fields to update
   */
  async updateMonitor(monitorId, updates) {
    const response = await fetch(`${API_BASE}/api/monitors/${monitorId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(updates),
    });
    if (!response.ok) {
      throw new Error('Failed to update monitor');
    }
    return response.json();
  },

  /**
   * Delete a monitor.
   * @param {string} monitorId - The monitor ID
   */
  async deleteMonitor(monitorId) {
    const response = await fetch(`${API_BASE}/api/monitors/${monitorId}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      throw new Error('Failed to delete monitor');
    }
    return response.json();
  },

  /**
   * Mark a monitor as read (reset unread_updates counter).
   * @param {string} monitorId - The monitor ID
   */
  async markMonitorRead(monitorId) {
    const response = await fetch(`${API_BASE}/api/monitors/${monitorId}/mark-read`, {
      method: 'POST',
    });
    if (!response.ok) {
      throw new Error('Failed to mark monitor as read');
    }
    return response.json();
  },

  /**
   * Pause a monitor (stop scheduled crawls).
   * @param {string} monitorId - The monitor ID
   */
  async pauseMonitor(monitorId) {
    return this.updateMonitor(monitorId, { status: 'paused' });
  },

  /**
   * Resume a monitor (restart scheduled crawls).
   * @param {string} monitorId - The monitor ID
   */
  async resumeMonitor(monitorId) {
    return this.updateMonitor(monitorId, { status: 'running' });
  },

  /**
   * Send a message to a monitor.
   * @param {string} monitorId - The monitor ID
   * @param {string} content - The message content
   */
  async sendMonitorMessage(monitorId, content) {
    const response = await fetch(`${API_BASE}/api/monitors/${monitorId}/message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ content }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || 'Failed to send message to monitor');
    }
    return response.json();
  },

  /**
   * Discover pages on a competitor's website using Firecrawl map.
   * Returns tiered page recommendations from LLM analysis.
   * @param {string} monitorId - The monitor ID
   * @param {string} url - The competitor's website URL
   * @param {string} name - Competitor name
   */
  async discoverCompetitorPages(monitorId, url, name) {
    const response = await fetch(`${API_BASE}/api/monitors/${monitorId}/discover`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url, name }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || 'Failed to discover pages');
    }
    return response.json();
  },

  /**
   * Add a competitor to a monitor.
   * @param {string} monitorId - The monitor ID
   * @param {object} competitorData - Object with name, domain, pages, site_map_baseline, tier
   */
  async addCompetitor(monitorId, competitorData) {
    const response = await fetch(`${API_BASE}/api/monitors/${monitorId}/competitors`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(competitorData),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || 'Failed to add competitor');
    }
    return response.json();
  },

  /**
   * Get site structure changes for a competitor.
   * @param {string} monitorId - The monitor ID
   * @param {string} competitorId - The competitor ID
   */
  async getStructureChanges(monitorId, competitorId) {
    const response = await fetch(
      `${API_BASE}/api/monitors/${monitorId}/competitors/${competitorId}/structure-changes`
    );
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || 'Failed to get structure changes');
    }
    return response.json();
  },

  /**
   * Update a competitor's site map baseline to current state.
   * @param {string} monitorId - The monitor ID
   * @param {string} competitorId - The competitor ID
   */
  async updateCompetitorBaseline(monitorId, competitorId) {
    const response = await fetch(
      `${API_BASE}/api/monitors/${monitorId}/competitors/${competitorId}/update-baseline`,
      { method: 'POST' }
    );
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || 'Failed to update baseline');
    }
    return response.json();
  },

  /**
   * Remove a competitor from a monitor.
   * @param {string} monitorId - The monitor ID
   * @param {string} competitorId - The competitor ID
   */
  async removeCompetitor(monitorId, competitorId) {
    const response = await fetch(
      `${API_BASE}/api/monitors/${monitorId}/competitors/${competitorId}`,
      { method: 'DELETE' }
    );
    if (!response.ok) {
      throw new Error('Failed to remove competitor');
    }
    return response.json();
  },

  /**
   * Add a page to track for a competitor.
   * @param {string} monitorId - The monitor ID
   * @param {string} competitorId - The competitor ID
   * @param {string} url - Page URL
   * @param {string} pageType - Page type (homepage, pricing, etc.)
   */
  async addPage(monitorId, competitorId, url, pageType = 'page') {
    const response = await fetch(
      `${API_BASE}/api/monitors/${monitorId}/competitors/${competitorId}/pages`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url, page_type: pageType }),
      }
    );
    if (!response.ok) {
      throw new Error('Failed to add page');
    }
    return response.json();
  },

  /**
   * Remove a page from tracking.
   * @param {string} monitorId - The monitor ID
   * @param {string} competitorId - The competitor ID
   * @param {string} pageId - The page ID
   */
  async removePage(monitorId, competitorId, pageId) {
    const response = await fetch(
      `${API_BASE}/api/monitors/${monitorId}/competitors/${competitorId}/pages/${pageId}`,
      { method: 'DELETE' }
    );
    if (!response.ok) {
      throw new Error('Failed to remove page');
    }
    return response.json();
  },

  /**
   * Trigger an immediate crawl for a monitor.
   * @param {string} monitorId - The monitor ID
   */
  async triggerCrawl(monitorId) {
    const response = await fetch(`${API_BASE}/api/monitors/${monitorId}/crawl`, {
      method: 'POST',
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || 'Failed to trigger crawl');
    }
    return response.json();
  },

  /**
   * List snapshots for a monitor.
   * @param {string} monitorId - The monitor ID
   * @param {string} competitorId - Optional competitor filter
   * @param {string} pageId - Optional page filter
   * @param {number} limit - Maximum snapshots to return
   */
  async listSnapshots(monitorId, competitorId = null, pageId = null, limit = 100) {
    let url = `${API_BASE}/api/monitors/${monitorId}/snapshots?limit=${limit}`;
    if (competitorId) url += `&competitor_id=${competitorId}`;
    if (pageId) url += `&page_id=${pageId}`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error('Failed to list snapshots');
    }
    return response.json();
  },

  /**
   * Get full snapshot details including previous snapshot for comparison.
   * @param {string} monitorId - The monitor ID
   * @param {string} snapshotId - The snapshot ID
   */
  async getSnapshotDetail(monitorId, snapshotId) {
    const response = await fetch(`${API_BASE}/api/monitors/${monitorId}/snapshot/${snapshotId}`);
    if (!response.ok) {
      throw new Error('Failed to get snapshot details');
    }
    return response.json();
  },

  /**
   * Get screenshot URL for a monitor.
   * @param {string} monitorId - The monitor ID
   * @param {string} screenshotPath - The relative screenshot path
   */
  getScreenshotUrl(monitorId, screenshotPath) {
    if (!screenshotPath) return null;
    return `${API_BASE}/api/monitors/${monitorId}/screenshot/${screenshotPath}`;
  },

  /**
   * List digests for a monitor.
   * @param {string} monitorId - The monitor ID
   * @param {number} limit - Maximum digests to return
   */
  async listDigests(monitorId, limit = 10) {
    const response = await fetch(`${API_BASE}/api/monitors/${monitorId}/digests?limit=${limit}`);
    if (!response.ok) {
      throw new Error('Failed to list digests');
    }
    return response.json();
  },

  /**
   * Get a specific digest.
   * @param {string} monitorId - The monitor ID
   * @param {string} digestId - The digest ID
   */
  async getDigest(monitorId, digestId) {
    const response = await fetch(`${API_BASE}/api/monitors/${monitorId}/digests/${digestId}`);
    if (!response.ok) {
      throw new Error('Failed to get digest');
    }
    return response.json();
  },

  /**
   * Generate a new digest.
   * @param {string} monitorId - The monitor ID
   * @param {string} period - 'weekly' or 'monthly'
   */
  async generateDigest(monitorId, period = 'weekly') {
    const response = await fetch(`${API_BASE}/api/monitors/${monitorId}/digests?period=${period}`, {
      method: 'POST',
    });
    if (!response.ok) {
      throw new Error('Failed to generate digest');
    }
    return response.json();
  },

  // ==========================================================================
  // Podcast API Methods
  // ==========================================================================

  /**
   * Get podcast settings and configuration status.
   * Returns ElevenLabs config with host and expert speaker settings.
   */
  async getPodcastSettings() {
    const response = await fetch(`${API_BASE}/api/settings/podcast`);
    if (!response.ok) {
      throw new Error('Failed to get podcast settings');
    }
    return response.json();
  },

  /**
   * Set the ElevenLabs API key for TTS voice generation.
   * @param {string} apiKey - The ElevenLabs API key
   */
  async updateElevenLabsApiKey(apiKey) {
    const response = await fetch(`${API_BASE}/api/settings/podcast/elevenlabs-api-key`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ api_key: apiKey }),
    });
    if (!response.ok) {
      throw new Error('Failed to update ElevenLabs API key');
    }
    return response.json();
  },

  /**
   * Clear the ElevenLabs API key from settings.
   */
  async clearElevenLabsApiKey() {
    const response = await fetch(`${API_BASE}/api/settings/podcast/elevenlabs-api-key`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      throw new Error('Failed to clear ElevenLabs API key');
    }
    return response.json();
  },

  /**
   * Update ElevenLabs voice settings.
   * @param {Object} settings - Voice settings
   * @param {string} [settings.voice_id] - Voice ID
   * @param {string} [settings.model] - Model ID
   * @param {number} [settings.stability] - Stability (0-1)
   * @param {number} [settings.similarity_boost] - Similarity boost (0-1)
   * @param {number} [settings.style] - Style (0-1)
   * @param {number} [settings.speed] - Speed (0.5-2)
   */
  async updateElevenLabsVoiceSettings(settings) {
    const response = await fetch(`${API_BASE}/api/settings/podcast/elevenlabs-voice`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(settings),
    });
    if (!response.ok) {
      throw new Error('Failed to update ElevenLabs voice settings');
    }
    return response.json();
  },

  /**
   * Set the OpenAI API key for TTS voice generation.
   * @param {string} apiKey - The OpenAI API key
   */
  async updateOpenaiApiKey(apiKey) {
    const response = await fetch(`${API_BASE}/api/settings/podcast/openai-api-key`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ api_key: apiKey }),
    });
    if (!response.ok) {
      throw new Error('Failed to update OpenAI API key');
    }
    return response.json();
  },

  /**
   * Clear the OpenAI API key from settings.
   */
  async clearOpenaiApiKey() {
    const response = await fetch(`${API_BASE}/api/settings/podcast/openai-api-key`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      throw new Error('Failed to clear OpenAI API key');
    }
    return response.json();
  },

  /**
   * Update host speaker configuration.
   * @param {Object} config - Host config (voice_id, model, stability, similarity_boost, style, speed, system_prompt)
   */
  async updateHostConfig(config) {
    const response = await fetch(`${API_BASE}/api/settings/podcast/host`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
    if (!response.ok) {
      throw new Error('Failed to update host configuration');
    }
    return response.json();
  },

  /**
   * Update expert speaker configuration.
   * @param {Object} config - Expert config (voice_id, model, stability, similarity_boost, style, speed, system_prompt)
   */
  async updateExpertConfig(config) {
    const response = await fetch(`${API_BASE}/api/settings/podcast/expert`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
    if (!response.ok) {
      throw new Error('Failed to update expert configuration');
    }
    return response.json();
  },

  /**
   * Update the podcast cover art prompt.
   * @param {string} prompt - The cover art generation prompt
   */
  async updatePodcastCoverPrompt(prompt) {
    const response = await fetch(`${API_BASE}/api/settings/podcast/cover-prompt`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prompt }),
    });
    if (!response.ok) {
      throw new Error('Failed to update cover prompt');
    }
    return response.json();
  },

  /**
   * Update the podcast cover art model.
   * @param {string} model - The OpenRouter model ID for cover generation
   */
  async updatePodcastCoverModel(model) {
    const response = await fetch(`${API_BASE}/api/settings/podcast/cover-model`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model }),
    });
    if (!response.ok) {
      throw new Error('Failed to update cover model');
    }
    return response.json();
  },

  /**
   * List all podcast narration styles.
   */
  async listPodcastStyles() {
    const response = await fetch(`${API_BASE}/api/settings/podcast/styles`);
    if (!response.ok) {
      throw new Error('Failed to list podcast styles');
    }
    return response.json();
  },

  /**
   * Get a specific podcast narration style.
   * @param {string} styleId - The style ID
   */
  async getPodcastStyle(styleId) {
    const response = await fetch(`${API_BASE}/api/settings/podcast/styles/${styleId}`);
    if (!response.ok) {
      throw new Error('Failed to get podcast style');
    }
    return response.json();
  },

  /**
   * Create a new podcast narration style.
   * @param {Object} style - Style data with id, name, description, prompt
   */
  async createPodcastStyle(style) {
    const response = await fetch(`${API_BASE}/api/settings/podcast/styles`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(style),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || 'Failed to create podcast style');
    }
    return response.json();
  },

  /**
   * Update an existing podcast narration style.
   * @param {string} styleId - The style ID
   * @param {Object} updates - Updated name, description, prompt
   */
  async updatePodcastStyle(styleId, updates) {
    const response = await fetch(`${API_BASE}/api/settings/podcast/styles/${styleId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(updates),
    });
    if (!response.ok) {
      throw new Error('Failed to update podcast style');
    }
    return response.json();
  },

  /**
   * Delete a podcast narration style.
   * @param {string} styleId - The style ID
   */
  async deletePodcastStyle(styleId) {
    const response = await fetch(`${API_BASE}/api/settings/podcast/styles/${styleId}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || 'Failed to delete podcast style');
    }
    return response.json();
  },

  /**
   * Create a new podcast session from Synthesizer notes.
   * @param {string} conversationId - The synthesizer conversation ID
   * @param {Array<string>} noteIds - Optional specific note IDs to include (null = all)
   * @param {string} style - Narration style: 'conversational', 'educational', 'storytelling'
   */
  async createPodcastSession(conversationId, noteIds = null, style = 'conversational') {
    const response = await fetch(`${API_BASE}/api/podcast/sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        conversation_id: conversationId,
        note_ids: noteIds,
        style,
      }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || 'Failed to create podcast session');
    }
    return response.json();
  },

  /**
   * List podcast sessions.
   * @param {string} conversationId - Optional filter by source conversation
   * @param {number} limit - Maximum sessions to return
   */
  async listPodcastSessions(conversationId = null, limit = 50) {
    let url = `${API_BASE}/api/podcast/sessions?limit=${limit}`;
    if (conversationId) {
      url += `&conversation_id=${encodeURIComponent(conversationId)}`;
    }
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error('Failed to list podcast sessions');
    }
    return response.json();
  },

  /**
   * Get a specific podcast session.
   * @param {string} sessionId - The session ID
   */
  async getPodcastSession(sessionId) {
    const response = await fetch(`${API_BASE}/api/podcast/sessions/${sessionId}`);
    if (!response.ok) {
      throw new Error('Failed to get podcast session');
    }
    return response.json();
  },

  /**
   * Start audio generation for a podcast session.
   * @param {string} sessionId - The session ID
   * @returns {Object} Status and progress info
   */
  async startPodcastGeneration(sessionId) {
    const response = await fetch(`${API_BASE}/api/podcast/sessions/${sessionId}/generate`, {
      method: 'POST',
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || 'Failed to start podcast generation');
    }
    return response.json();
  },

  /**
   * Get SSE URL for generation progress updates.
   * @param {string} sessionId - The session ID
   * @returns {string} SSE endpoint URL
   */
  getPodcastGenerationStreamUrl(sessionId) {
    return `${API_BASE}/api/podcast/sessions/${sessionId}/generate/stream`;
  },

  /**
   * End a podcast session.
   * @param {string} sessionId - The session ID
   */
  async endPodcastSession(sessionId) {
    const response = await fetch(`${API_BASE}/api/podcast/sessions/${sessionId}/end`, {
      method: 'POST',
    });
    if (!response.ok) {
      throw new Error('Failed to end podcast session');
    }
    return response.json();
  },

  /**
   * Get the transcript for a podcast session.
   * @param {string} sessionId - The session ID
   */
  async getPodcastTranscript(sessionId) {
    const response = await fetch(`${API_BASE}/api/podcast/sessions/${sessionId}/transcript`);
    if (!response.ok) {
      throw new Error('Failed to get podcast transcript');
    }
    return response.json();
  },

  /**
   * Get word timings for teleprompter sync during replay.
   * Returns word-level timing data for accurate text highlighting
   * synchronized with audio playback at any speed.
   * @param {string} sessionId - The session ID
   */
  async getPodcastWordTimings(sessionId) {
    const response = await fetch(`${API_BASE}/api/podcast/sessions/${sessionId}/word-timings`);
    if (!response.ok) {
      throw new Error('Failed to get podcast word timings');
    }
    return response.json();
  },

  /**
   * Delete a podcast session.
   * @param {string} sessionId - The session ID
   */
  async deletePodcastSession(sessionId) {
    const response = await fetch(`${API_BASE}/api/podcast/sessions/${sessionId}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      throw new Error('Failed to delete podcast session');
    }
    return response.json();
  },

  /**
   * Add an emoji reaction to a podcast session.
   * @param {string} sessionId - The session ID
   * @param {string} emoji - The emoji character
   * @param {number} timestampMs - Playback position in milliseconds
   */
  async addPodcastReaction(sessionId, emoji, timestampMs) {
    const response = await fetch(`${API_BASE}/api/podcast/sessions/${sessionId}/reactions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ emoji, timestamp_ms: timestampMs }),
    });
    if (!response.ok) {
      throw new Error('Failed to add podcast reaction');
    }
    return response.json();
  },

  /**
   * Get all reactions for a podcast session.
   * @param {string} sessionId - The session ID
   */
  async getPodcastReactions(sessionId) {
    const response = await fetch(`${API_BASE}/api/podcast/sessions/${sessionId}/reactions`);
    if (!response.ok) {
      throw new Error('Failed to get podcast reactions');
    }
    return response.json();
  },

  /**
   * Upload recorded podcast audio.
   * @param {string} sessionId - The session ID
   * @param {Blob} audioBlob - The audio data as a Blob
   */
  async uploadPodcastAudio(sessionId, audioBlob) {
    const formData = new FormData();
    formData.append('audio', audioBlob, `${sessionId}.webm`);

    const response = await fetch(`${API_BASE}/api/podcast/sessions/${sessionId}/audio`, {
      method: 'POST',
      body: formData,
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || 'Failed to upload podcast audio');
    }
    return response.json();
  },

  /**
   * Get the audio URL for a podcast session.
   * @param {string} sessionId - The session ID
   * @returns {string} The audio URL
   */
  getPodcastAudioUrl(sessionId) {
    return `${API_BASE}/api/podcast/sessions/${sessionId}/audio`;
  },

  // ==========================================================================
  // Knowledge Graph API Methods
  // ==========================================================================

  /**
   * Get the full knowledge graph.
   * @param {string} tags - Optional comma-separated list of tags to filter by
   */
  async getKnowledgeGraph(tags = null) {
    const url = tags
      ? `${API_BASE}/api/knowledge-graph?tags=${encodeURIComponent(tags)}`
      : `${API_BASE}/api/knowledge-graph`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error('Failed to get knowledge graph');
    }
    return response.json();
  },

  /**
   * Get knowledge graph statistics.
   */
  async getKnowledgeGraphStats() {
    const response = await fetch(`${API_BASE}/api/knowledge-graph/stats`);
    if (!response.ok) {
      throw new Error('Failed to get knowledge graph stats');
    }
    return response.json();
  },

  /**
   * Search knowledge graph nodes by semantic similarity.
   * @param {string} query - Search query string
   * @param {Object} options - Search options
   * @param {string[]} options.types - Node types to filter (entity, note, source)
   * @param {string[]} options.entityTypes - Entity types to filter (person, organization, etc.)
   * @param {string[]} options.tags - Tags to filter notes by
   * @param {number} options.limit - Maximum results to return
   * @returns {Object} Results with id, type, name, score, and metadata
   */
  async searchKnowledgeGraph(query, options = {}) {
    const params = new URLSearchParams();
    params.set('q', query);
    if (options.types?.length) {
      params.set('types', options.types.join(','));
    }
    if (options.entityTypes?.length) {
      params.set('entity_types', options.entityTypes.join(','));
    }
    if (options.tags?.length) {
      params.set('tags', options.tags.join(','));
    }
    if (options.limit) {
      params.set('limit', options.limit.toString());
    }

    const response = await fetch(`${API_BASE}/api/knowledge-graph/search?${params}`);
    if (!response.ok) {
      throw new Error('Failed to search knowledge graph');
    }
    return response.json();
  },

  /**
   * Get notes related to a specific note via the knowledge graph.
   * @param {string} noteId - The full note ID (e.g., "note:conversation_id:note_id")
   * @returns {Object} Related notes grouped by connection type
   */
  async getRelatedNotes(noteId) {
    const response = await fetch(`${API_BASE}/api/knowledge-graph/notes/${encodeURIComponent(noteId)}/related`);
    if (!response.ok) {
      throw new Error('Failed to get related notes');
    }
    return response.json();
  },

  /**
   * Extract entities from a conversation.
   * @param {string} conversationId - The conversation ID
   */
  async extractEntities(conversationId) {
    const response = await fetch(`${API_BASE}/api/knowledge-graph/extract/${conversationId}`, {
      method: 'POST',
    });
    if (!response.ok) {
      throw new Error('Failed to extract entities');
    }
    return response.json();
  },

  /**
   * Start migration of all synthesizer conversations.
   * @param {boolean} force - If true, reprocess already-processed conversations
   */
  async startKnowledgeGraphMigration(force = false) {
    const response = await fetch(`${API_BASE}/api/knowledge-graph/migrate?force=${force}`, {
      method: 'POST',
    });
    if (!response.ok) {
      throw new Error('Failed to start migration');
    }
    return response.json();
  },

  /**
   * Get migration status.
   */
  async getKnowledgeGraphMigrationStatus() {
    const response = await fetch(`${API_BASE}/api/knowledge-graph/migrate/status`);
    if (!response.ok) {
      throw new Error('Failed to get migration status');
    }
    return response.json();
  },

  /**
   * Cancel running migration.
   */
  async cancelKnowledgeGraphMigration() {
    const response = await fetch(`${API_BASE}/api/knowledge-graph/migrate/cancel`, {
      method: 'POST',
    });
    if (!response.ok) {
      throw new Error('Failed to cancel migration');
    }
    return response.json();
  },

  /**
   * Rebuild the entire knowledge graph.
   */
  async rebuildKnowledgeGraph() {
    const response = await fetch(`${API_BASE}/api/knowledge-graph/rebuild`, {
      method: 'POST',
    });
    if (!response.ok) {
      throw new Error('Failed to rebuild knowledge graph');
    }
    return response.json();
  },

  /**
   * Create a manual link between two nodes.
   * @param {string} source - Source node ID
   * @param {string} target - Target node ID
   * @param {string} label - Link label
   */
  async createManualLink(source, target, label = 'related') {
    const response = await fetch(`${API_BASE}/api/knowledge-graph/links`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source, target, label }),
    });
    if (!response.ok) {
      throw new Error('Failed to create manual link');
    }
    return response.json();
  },

  /**
   * Delete a manual link.
   * @param {string} linkId - The link ID
   */
  async deleteManualLink(linkId) {
    const response = await fetch(`${API_BASE}/api/knowledge-graph/links/${linkId}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      throw new Error('Failed to delete manual link');
    }
    return response.json();
  },

  /**
   * Dismiss a suggested link.
   * @param {string} linkId - The link ID
   */
  async dismissSuggestedLink(linkId) {
    const response = await fetch(`${API_BASE}/api/knowledge-graph/links/${linkId}/dismiss`, {
      method: 'POST',
    });
    if (!response.ok) {
      throw new Error('Failed to dismiss link');
    }
    return response.json();
  },

  // Knowledge Graph Linkage Session

  /**
   * Get linkage session data including duplicates and stats.
   */
  async getLinkageSession() {
    const response = await fetch(`${API_BASE}/api/knowledge-graph/linkage`);
    if (!response.ok) {
      throw new Error('Failed to get linkage session');
    }
    return response.json();
  },

  /**
   * Get potential duplicate entities.
   * @param {number} threshold - Similarity threshold (0-1)
   */
  async getDuplicateEntities(threshold = 0.7) {
    const response = await fetch(`${API_BASE}/api/knowledge-graph/linkage/duplicates?threshold=${threshold}`);
    if (!response.ok) {
      throw new Error('Failed to get duplicate entities');
    }
    return response.json();
  },

  /**
   * Merge multiple entities into a canonical one.
   * @param {string} canonicalId - The entity ID to keep
   * @param {string[]} mergeIds - Entity IDs to merge
   */
  async mergeEntities(canonicalId, mergeIds) {
    const response = await fetch(`${API_BASE}/api/knowledge-graph/linkage/merge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ canonical_id: canonicalId, merge_ids: mergeIds }),
    });
    if (!response.ok) {
      throw new Error('Failed to merge entities');
    }
    return response.json();
  },

  /**
   * Mark an entity as reviewed.
   * @param {string} entityId - The entity ID
   */
  async markEntityReviewed(entityId) {
    const response = await fetch(`${API_BASE}/api/knowledge-graph/linkage/entities/${entityId}/review`, {
      method: 'POST',
    });
    if (!response.ok) {
      throw new Error('Failed to mark entity as reviewed');
    }
    return response.json();
  },

  /**
   * Get AI-generated connection suggestions.
   * @param {number} limit - Maximum suggestions to return
   */
  async getConnectionSuggestions(limit = 10) {
    const response = await fetch(`${API_BASE}/api/knowledge-graph/linkage/suggestions?limit=${limit}`);
    if (!response.ok) {
      throw new Error('Failed to get connection suggestions');
    }
    return response.json();
  },

  // Graph RAG Chat

  /**
   * Send a message to the knowledge graph chat.
   * @param {string} message - The user's message
   * @param {string|null} sessionId - Optional session ID for conversation continuity
   */
  async chatWithKnowledgeGraph(message, sessionId = null) {
    const body = { message };
    if (sessionId) {
      body.session_id = sessionId;
    }

    const response = await fetch(`${API_BASE}/api/knowledge-graph/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error('Failed to chat with knowledge graph');
    }
    return response.json();
  },

  /**
   * Get chat history for a session.
   * @param {string} sessionId - The session ID
   */
  async getKnowledgeGraphChatHistory(sessionId) {
    const response = await fetch(`${API_BASE}/api/knowledge-graph/chat/${sessionId}/history`);
    if (!response.ok) {
      throw new Error('Failed to get chat history');
    }
    return response.json();
  },

  /**
   * Clear a chat session.
   * @param {string} sessionId - The session ID
   */
  async clearKnowledgeGraphChatSession(sessionId) {
    const response = await fetch(`${API_BASE}/api/knowledge-graph/chat/${sessionId}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      throw new Error('Failed to clear chat session');
    }
    return response.json();
  },

  /**
   * List all active chat sessions.
   */
  async listKnowledgeGraphChatSessions() {
    const response = await fetch(`${API_BASE}/api/knowledge-graph/chat/sessions`);
    if (!response.ok) {
      throw new Error('Failed to list chat sessions');
    }
    return response.json();
  },

  // =============================================================================
  // Knowledge Graph Settings
  // =============================================================================

  /**
   * Get knowledge graph settings.
   */
  async getKnowledgeGraphSettings() {
    const response = await fetch(`${API_BASE}/api/settings/knowledge-graph`);
    if (!response.ok) {
      throw new Error('Failed to get knowledge graph settings');
    }
    return response.json();
  },

  /**
   * Set knowledge graph model.
   * @param {string} model - The model identifier
   */
  async setKnowledgeGraphModel(model) {
    const response = await fetch(`${API_BASE}/api/settings/knowledge-graph/model`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model }),
    });
    if (!response.ok) {
      throw new Error('Failed to set knowledge graph model');
    }
    return response.json();
  },
};
