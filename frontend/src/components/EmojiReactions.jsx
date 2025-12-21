import React, { useState, useCallback } from 'react';
import './EmojiReactions.css';

const REACTION_EMOJIS = ['👍', '❤️', '😂', '🤯', '💡', '👏'];

/**
 * EmojiReactions - Interactive emoji reaction buttons with floating animation.
 *
 * Users can tap emojis during podcast playback to react to content.
 * Each tap triggers a scale animation on the button and spawns a
 * floating emoji that rises and fades out.
 */
export default function EmojiReactions({ onReaction }) {
  const [recentReaction, setRecentReaction] = useState(null);
  const [floatingEmojis, setFloatingEmojis] = useState([]);

  const handleReaction = useCallback((emoji) => {
    // Trigger button animation
    setRecentReaction(emoji);
    setTimeout(() => setRecentReaction(null), 200);

    // Add floating emoji animation
    const id = Date.now() + Math.random();
    const x = 10 + Math.random() * 80; // Random horizontal position 10-90%
    setFloatingEmojis(prev => [...prev, { id, emoji, x }]);

    // Remove floating emoji after animation completes
    setTimeout(() => {
      setFloatingEmojis(prev => prev.filter(e => e.id !== id));
    }, 1500);

    // Callback to parent
    onReaction?.(emoji);
  }, [onReaction]);

  return (
    <div className="emoji-reactions">
      {/* Floating emoji animations */}
      <div className="floating-emojis">
        {floatingEmojis.map(({ id, emoji, x }) => (
          <span
            key={id}
            className="floating-emoji"
            style={{ left: `${x}%` }}
          >
            {emoji}
          </span>
        ))}
      </div>

      {/* Emoji buttons */}
      <div className="emoji-buttons">
        {REACTION_EMOJIS.map(emoji => (
          <button
            key={emoji}
            className={`emoji-btn ${recentReaction === emoji ? 'active' : ''}`}
            onClick={() => handleReaction(emoji)}
            aria-label={`React with ${emoji}`}
          >
            {emoji}
          </button>
        ))}
      </div>
    </div>
  );
}
