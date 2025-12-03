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
   * List all available prompts.
   */
  async listPrompts() {
    const response = await fetch(`${API_BASE}/api/prompts`);
    if (!response.ok) {
      throw new Error('Failed to list prompts');
    }
    return response.json();
  },

  /**
   * Get a specific prompt by filename.
   */
  async getPrompt(filename) {
    const response = await fetch(`${API_BASE}/api/prompts/${filename}`);
    if (!response.ok) {
      throw new Error('Failed to get prompt');
    }
    return response.json();
  },

  /**
   * Create a new prompt.
   */
  async createPrompt(title, content) {
    const response = await fetch(`${API_BASE}/api/prompts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ title, content }),
    });
    if (!response.ok) {
      throw new Error('Failed to create prompt');
    }
    return response.json();
  },

  /**
   * Update an existing prompt.
   */
  async updatePrompt(filename, content) {
    const response = await fetch(`${API_BASE}/api/prompts/${filename}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ content }),
    });
    if (!response.ok) {
      throw new Error('Failed to update prompt');
    }
    return response.json();
  },

  /**
   * Delete a prompt.
   */
  async deletePrompt(filename) {
    const response = await fetch(`${API_BASE}/api/prompts/${filename}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      throw new Error('Failed to delete prompt');
    }
    return response.json();
  },

  /**
   * Create a comment on a response.
   */
  async createComment(conversationId, messageIndex, stage, model, selection, content, sourceContent = null) {
    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}/comments`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message_index: messageIndex,
          stage,
          model,
          selection,
          content,
          source_content: sourceContent,
        }),
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
  async createThread(conversationId, model, commentIds, question, messageIndex, contextSegments = [], compiledContext = null) {
    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}/threads`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          comment_ids: commentIds,
          question,
          message_index: messageIndex,
          context_segments: contextSegments,
          compiled_context: compiledContext,
        }),
      }
    );
    if (!response.ok) {
      throw new Error('Failed to create thread');
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
  // Synthesizer API Methods
  // ==========================================================================

  /**
   * Process a URL and generate Zettelkasten notes.
   * @param {string} conversationId - The conversation ID
   * @param {string} url - URL to process
   * @param {string} comment - Optional user comment/guidance
   * @param {string} model - Optional model override
   * @param {boolean} useCouncil - Whether to use multiple models
   */
  async synthesize(conversationId, url, comment = null, model = null, useCouncil = false) {
    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}/synthesize`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url,
          comment,
          model,
          use_council: useCouncil,
        }),
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
};
