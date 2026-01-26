import React, { useState, useEffect, useRef } from 'react';
import {
  Plus,
  Play,
  Pause,
  Edit2,
  Trash2,
  Mic,
  Wand2,
  Volume2,
  Users,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import { api } from '../api';
import CharacterEditor from './CharacterEditor';
import './CharacterList.css';

/**
 * Voice mode badges with appropriate icons and colors.
 */
const VOICE_MODE_CONFIG = {
  clone: {
    label: 'Clone',
    icon: Mic,
    color: '#8839ef',
    bg: 'rgba(136, 57, 239, 0.15)',
  },
  design: {
    label: 'Design',
    icon: Wand2,
    color: '#04a5e5',
    bg: 'rgba(4, 165, 229, 0.15)',
  },
  prebuilt: {
    label: 'Prebuilt',
    icon: Volume2,
    color: '#40a02b',
    bg: 'rgba(64, 160, 43, 0.15)',
  },
};

/**
 * Speaking role colors.
 */
const ROLE_COLORS = {
  host: { color: '#1e66f5', bg: 'rgba(30, 102, 245, 0.15)' },
  expert: { color: '#fe640b', bg: 'rgba(254, 100, 11, 0.15)' },
  narrator: { color: '#179299', bg: 'rgba(23, 146, 153, 0.15)' },
};

/**
 * CharacterCard - Individual character display card.
 */
function CharacterCard({ character, onEdit, onDelete, onPreview }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const audioRef = useRef(null);

  const voiceConfig = VOICE_MODE_CONFIG[character.voice_mode] || VOICE_MODE_CONFIG.prebuilt;
  const VoiceIcon = voiceConfig.icon;
  const roleConfig = ROLE_COLORS[character.personality?.speaking_role] || ROLE_COLORS.host;

  const handlePreview = async () => {
    if (isPlaying && audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setIsPlaying(false);
      return;
    }

    setIsLoading(true);
    try {
      const audioBlob = await api.previewPodcastCharacter(character.id);
      const audioUrl = URL.createObjectURL(audioBlob);

      if (audioRef.current) {
        audioRef.current.src = audioUrl;
        await audioRef.current.play();
        setIsPlaying(true);
      }
    } catch (err) {
      console.error('Failed to preview voice:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAudioEnded = () => {
    setIsPlaying(false);
  };

  return (
    <div className="character-card">
      <div className="character-card-header">
        <div className="character-avatar">
          {character.name.charAt(0).toUpperCase()}
        </div>
        <div className="character-info">
          <h3 className="character-name">{character.name}</h3>
          <div className="character-badges">
            <span
              className="voice-mode-badge"
              style={{ backgroundColor: voiceConfig.bg, color: voiceConfig.color }}
            >
              <VoiceIcon size={12} />
              {voiceConfig.label}
            </span>
            <span
              className="role-badge"
              style={{ backgroundColor: roleConfig.bg, color: roleConfig.color }}
            >
              {character.personality?.speaking_role || 'host'}
            </span>
          </div>
        </div>
      </div>

      {character.personality?.traits && (
        <p className="character-traits">{character.personality.traits}</p>
      )}

      {character.personality?.key_phrases?.length > 0 && (
        <div className="character-phrases">
          {character.personality.key_phrases.slice(0, 3).map((phrase, idx) => (
            <span key={idx} className="phrase-chip">"{phrase}"</span>
          ))}
        </div>
      )}

      <div className="character-card-actions">
        <button
          className="btn-icon"
          onClick={handlePreview}
          disabled={isLoading}
          title={isPlaying ? 'Stop' : 'Play sample'}
        >
          {isLoading ? (
            <Loader2 size={16} className="spinning" />
          ) : isPlaying ? (
            <Pause size={16} />
          ) : (
            <Play size={16} />
          )}
        </button>
        <button
          className="btn-icon"
          onClick={() => onEdit(character)}
          title="Edit character"
        >
          <Edit2 size={16} />
        </button>
        <button
          className="btn-icon btn-icon-danger"
          onClick={() => onDelete(character)}
          title="Delete character"
        >
          <Trash2 size={16} />
        </button>
      </div>

      <audio
        ref={audioRef}
        onEnded={handleAudioEnded}
        style={{ display: 'none' }}
      />
    </div>
  );
}

/**
 * CharacterList - Grid view of all podcast characters.
 */
export default function CharacterList({ onClose }) {
  const [characters, setCharacters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editingCharacter, setEditingCharacter] = useState(null);
  const [showEditor, setShowEditor] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [ttsHealthy, setTtsHealthy] = useState(null);
  const [creatingDefaults, setCreatingDefaults] = useState(false);

  useEffect(() => {
    loadCharacters();
    checkTtsHealth();
  }, []);

  const loadCharacters = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.listPodcastCharacters();
      setCharacters(data.characters || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const checkTtsHealth = async () => {
    try {
      const status = await api.checkTtsHealth();
      setTtsHealthy(status.healthy);
    } catch {
      setTtsHealthy(false);
    }
  };

  const handleCreate = () => {
    setEditingCharacter(null);
    setShowEditor(true);
  };

  const handleCreateDefaults = async () => {
    setCreatingDefaults(true);
    setError(null);
    try {
      const result = await api.initDefaultCharacters();
      if (result.created?.length > 0) {
        setCharacters(result.created);
      }
    } catch (err) {
      setError(err.message || 'Failed to create default characters');
    } finally {
      setCreatingDefaults(false);
    }
  };

  const handleEdit = (character) => {
    setEditingCharacter(character);
    setShowEditor(true);
  };

  const handleDelete = (character) => {
    setDeleteConfirm(character);
  };

  const confirmDelete = async () => {
    if (!deleteConfirm) return;
    try {
      await api.deletePodcastCharacter(deleteConfirm.id);
      setCharacters(prev => prev.filter(c => c.id !== deleteConfirm.id));
      setDeleteConfirm(null);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleEditorClose = () => {
    setShowEditor(false);
    setEditingCharacter(null);
  };

  const handleEditorSave = (savedCharacter) => {
    if (editingCharacter) {
      // Update existing
      setCharacters(prev =>
        prev.map(c => (c.id === savedCharacter.id ? savedCharacter : c))
      );
    } else {
      // Add new
      setCharacters(prev => [savedCharacter, ...prev]);
    }
    handleEditorClose();
  };

  const needsMoreCharacters = characters.length < 2;

  return (
    <div className="character-list-container">
      <div className="character-list-header">
        <div className="character-list-title">
          <Users size={24} />
          <h2>Podcast Characters</h2>
        </div>
        <button className="btn-primary" onClick={handleCreate}>
          <Plus size={16} />
          Create Character
        </button>
      </div>

      {/* TTS Health Warning */}
      {ttsHealthy === false && (
        <div className="tts-warning">
          <AlertCircle size={16} />
          <span>
            Qwen3-TTS service is not running. Voice preview and generation may not work.
          </span>
        </div>
      )}

      {/* Minimum Characters Indicator */}
      {needsMoreCharacters && characters.length > 0 && (
        <div className="characters-hint">
          <AlertCircle size={16} />
          <span>
            Add at least 2 characters to enable Question Time podcast mode.
            You have {characters.length} character{characters.length === 1 ? '' : 's'}.
          </span>
        </div>
      )}

      {/* Error Display */}
      {error && (
        <div className="error-message">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      {/* Loading State */}
      {loading ? (
        <div className="loading-state">
          <Loader2 size={32} className="spinning" />
          <p>Loading characters...</p>
        </div>
      ) : characters.length === 0 ? (
        <div className="empty-state">
          <Users size={48} />
          <h3>No Characters Yet</h3>
          <p>
            Create your first podcast character with a unique voice and personality.
            You can clone a voice, design one from a description, or use a prebuilt voice.
          </p>
          <div className="empty-state-actions">
            <button
              className="btn-primary btn-large"
              onClick={handleCreateDefaults}
              disabled={creatingDefaults}
            >
              {creatingDefaults ? (
                <>
                  <Loader2 size={16} className="spinning" />
                  Creating...
                </>
              ) : (
                <>
                  <Users size={16} />
                  Create Default Characters
                </>
              )}
            </button>
            <span className="empty-state-or">or</span>
            <button className="btn-secondary" onClick={handleCreate}>
              <Plus size={16} />
              Create Custom Character
            </button>
          </div>
        </div>
      ) : (
        <div className="character-grid">
          {characters.map(character => (
            <CharacterCard
              key={character.id}
              character={character}
              onEdit={handleEdit}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className="modal-overlay" onClick={() => setDeleteConfirm(null)}>
          <div className="delete-confirm-modal" onClick={e => e.stopPropagation()}>
            <h3>Delete Character</h3>
            <p>
              Are you sure you want to delete <strong>{deleteConfirm.name}</strong>?
              This action cannot be undone.
            </p>
            <div className="modal-actions">
              <button
                className="btn-secondary"
                onClick={() => setDeleteConfirm(null)}
              >
                Cancel
              </button>
              <button className="btn-danger" onClick={confirmDelete}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Character Editor Modal */}
      {showEditor && (
        <CharacterEditor
          character={editingCharacter}
          onClose={handleEditorClose}
          onSave={handleEditorSave}
        />
      )}
    </div>
  );
}
