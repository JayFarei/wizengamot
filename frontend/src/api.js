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
   */
  async listPrompts() {
    const response = await fetch(`${API_BASE}/api/prompts`);
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
   * @param {string} prompt - Full prompt text
   */
  async createDiagramStyle(id, name, description, prompt) {
    const response = await fetch(`${API_BASE}/api/settings/visualiser/styles`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ id, name, description, prompt }),
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
   * @param {string} prompt - Full prompt text
   */
  async updateDiagramStyle(styleId, name, description, prompt) {
    const response = await fetch(`${API_BASE}/api/settings/visualiser/styles/${styleId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name, description, prompt }),
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
};
