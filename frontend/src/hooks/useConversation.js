import { useState, useCallback, useMemo } from 'react';
import { api } from '../api';

/**
 * Hook for managing conversation sending and streaming
 * Extracted from App.jsx to be used per-pane
 */
export function useConversation({
  conversationId,
  conversation,
  onConversationUpdate,
  onConversationsListUpdate,
  onAnimateTitleId,
}) {
  const [isLoading, setIsLoading] = useState(false);

  const sendMessage = useCallback(async (content) => {
    if (!conversationId) return;

    setIsLoading(true);
    try {
      // Optimistically add user message to UI
      const userMessage = { role: 'user', content };
      onConversationUpdate((prev) => ({
        ...prev,
        messages: [...prev.messages, userMessage],
      }));

      // Create a partial assistant message that will be updated progressively
      const assistantMessage = {
        role: 'assistant',
        stage1: null,
        stage2: null,
        stage3: null,
        metadata: null,
        loading: {
          stage1: false,
          stage2: false,
          stage3: false,
        },
      };

      // Add the partial assistant message
      onConversationUpdate((prev) => ({
        ...prev,
        messages: [...prev.messages, assistantMessage],
      }));

      // Send message with streaming
      await api.sendMessageStream(conversationId, content, (eventType, event) => {
        switch (eventType) {
          case 'stage1_start':
            onConversationUpdate((prev) => {
              if (!prev?.messages?.length) return prev;
              const messages = [...prev.messages];
              const lastMsg = messages[messages.length - 1];
              if (lastMsg?.loading) lastMsg.loading.stage1 = true;
              return { ...prev, messages };
            });
            break;

          case 'stage1_complete':
            onConversationUpdate((prev) => {
              if (!prev?.messages?.length) return prev;
              const messages = [...prev.messages];
              const lastMsg = messages[messages.length - 1];
              if (lastMsg) {
                lastMsg.stage1 = event.data;
                if (lastMsg.loading) lastMsg.loading.stage1 = false;
              }
              return { ...prev, messages };
            });
            break;

          case 'stage2_start':
            onConversationUpdate((prev) => {
              if (!prev?.messages?.length) return prev;
              const messages = [...prev.messages];
              const lastMsg = messages[messages.length - 1];
              if (lastMsg?.loading) lastMsg.loading.stage2 = true;
              return { ...prev, messages };
            });
            break;

          case 'stage2_complete':
            onConversationUpdate((prev) => {
              if (!prev?.messages?.length) return prev;
              const messages = [...prev.messages];
              const lastMsg = messages[messages.length - 1];
              if (lastMsg) {
                lastMsg.stage2 = event.data;
                lastMsg.metadata = event.metadata;
                if (lastMsg.loading) lastMsg.loading.stage2 = false;
              }
              return { ...prev, messages };
            });
            break;

          case 'stage3_start':
            onConversationUpdate((prev) => {
              if (!prev?.messages?.length) return prev;
              const messages = [...prev.messages];
              const lastMsg = messages[messages.length - 1];
              if (lastMsg?.loading) lastMsg.loading.stage3 = true;
              return { ...prev, messages };
            });
            break;

          case 'stage3_complete':
            onConversationUpdate((prev) => {
              if (!prev?.messages?.length) return prev;
              const messages = [...prev.messages];
              const lastMsg = messages[messages.length - 1];
              if (lastMsg) {
                lastMsg.stage3 = event.data;
                if (lastMsg.loading) lastMsg.loading.stage3 = false;
              }
              return { ...prev, messages };
            });
            break;

          case 'title_complete':
            if (onConversationsListUpdate) {
              onConversationsListUpdate(prev => prev.map(conv =>
                conv.id === conversationId
                  ? { ...conv, title: event.data.title }
                  : conv
              ));
            }
            if (onAnimateTitleId) {
              onAnimateTitleId(conversationId);
            }
            break;

          case 'cost_complete':
            if (onConversationsListUpdate) {
              onConversationsListUpdate(prev => prev.map(conv =>
                conv.id === conversationId
                  ? { ...conv, total_cost: (conv.total_cost || 0) + event.data.cost }
                  : conv
              ));
            }
            break;

          case 'summary_complete':
            if (onConversationsListUpdate) {
              onConversationsListUpdate(prev => prev.map(conv =>
                conv.id === conversationId
                  ? { ...conv, summary: event.data.summary }
                  : conv
              ));
            }
            break;

          case 'complete':
            setIsLoading(false);
            break;

          case 'error':
            console.error('Stream error:', event.message);
            setIsLoading(false);
            break;

          default:
            console.log('Unknown event type:', eventType);
        }
      });
    } catch (error) {
      console.error('Failed to send message:', error);
      // Remove optimistic messages on error
      onConversationUpdate((prev) => ({
        ...prev,
        messages: prev.messages.slice(0, -2),
      }));
      setIsLoading(false);
    }
  }, [conversationId, onConversationUpdate, onConversationsListUpdate, onAnimateTitleId]);

  return {
    isLoading,
    setIsLoading,
    sendMessage,
  };
}

export default useConversation;
