import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Mic,
  Wand2,
  Volume2,
  Upload,
  Play,
  Pause,
  Loader2,
  Plus,
  Trash2,
  AlertCircle,
  Check,
  RefreshCw,
} from 'lucide-react';
import { api } from '../api';
import './CharacterEditor.css';

/**
 * Voice mode tab configurations.
 */
const VOICE_MODES = [
  { id: 'clone', label: 'Clone Voice', icon: Mic, description: 'Upload audio to clone a real voice' },
  { id: 'design', label: 'Design Voice', icon: Wand2, description: 'Describe the voice you want' },
  { id: 'prebuilt', label: 'Prebuilt', icon: Volume2, description: 'Choose from 9 ready-to-use voices' },
];

/**
 * Speaking roles.
 */
const SPEAKING_ROLES = [
  { id: 'host', label: 'Host', description: 'Leads the conversation and asks questions' },
  { id: 'expert', label: 'Expert', description: 'Provides insights and explanations' },
  { id: 'narrator', label: 'Narrator', description: 'Describes scenes and transitions' },
];

/**
 * CharacterEditor - Modal form for creating/editing characters.
 */
export default function CharacterEditor({ character, onClose, onSave }) {
  const isEditing = !!character;

  // Basic info
  const [name, setName] = useState(character?.name || '');

  // Voice settings
  const [voiceMode, setVoiceMode] = useState(character?.voice_mode || 'prebuilt');

  // Clone mode state
  const [audioFile, setAudioFile] = useState(null);
  const [audioFileName, setAudioFileName] = useState('');
  const [audioPreviewUrl, setAudioPreviewUrl] = useState(null);
  const [transcript, setTranscript] = useState(character?.voice?.reference_transcript || '');

  // Design mode state
  const [voiceDescription, setVoiceDescription] = useState(character?.voice?.description || '');

  // Prebuilt mode state
  const [prebuiltVoice, setPrebuiltVoice] = useState(character?.voice?.prebuilt_voice || 'aiden');
  const [prebuiltVoices, setPrebuiltVoices] = useState([]);
  const [loadingVoices, setLoadingVoices] = useState(true);

  // Personality settings
  const [traits, setTraits] = useState(character?.personality?.traits || '');
  const [keyPhrases, setKeyPhrases] = useState(character?.personality?.key_phrases || []);
  const [newPhrase, setNewPhrase] = useState('');
  const [expertiseAreas, setExpertiseAreas] = useState(character?.personality?.expertise_areas || []);
  const [newExpertise, setNewExpertise] = useState('');
  const [speakingRole, setSpeakingRole] = useState(character?.personality?.speaking_role || 'host');
  const [emotionStyle, setEmotionStyle] = useState(character?.personality?.emotion_style || '');

  // UI state
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [reRegistering, setReRegistering] = useState(false);
  const [reRegisterSuccess, setReRegisterSuccess] = useState(false);

  const fileInputRef = useRef(null);
  const audioPreviewRef = useRef(null);
  const prebuiltAudioRef = useRef(null);
  const [playingVoiceId, setPlayingVoiceId] = useState(null);

  // Load prebuilt voices
  useEffect(() => {
    const loadVoices = async () => {
      try {
        const data = await api.getPrebuiltVoices();
        setPrebuiltVoices(data.voices || []);
      } catch (err) {
        console.error('Failed to load prebuilt voices:', err);
      } finally {
        setLoadingVoices(false);
      }
    };
    loadVoices();
  }, []);

  // Escape key handler
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  // Handle audio file selection
  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      setAudioFile(file);
      setAudioFileName(file.name);
      setAudioPreviewUrl(URL.createObjectURL(file));
    }
  };

  // Play/pause audio preview (for clone mode)
  const toggleAudioPreview = () => {
    if (!audioPreviewRef.current || !audioPreviewUrl) return;

    if (previewPlaying) {
      audioPreviewRef.current.pause();
    } else {
      audioPreviewRef.current.play();
    }
    setPreviewPlaying(!previewPlaying);
  };

  // Play prebuilt voice sample
  const playPrebuiltSample = async (voiceId) => {
    if (playingVoiceId === voiceId) {
      prebuiltAudioRef.current?.pause();
      setPlayingVoiceId(null);
      return;
    }

    setPreviewLoading(true);
    try {
      // Create a temporary character to preview
      const formData = new FormData();
      formData.append('name', 'Preview');
      formData.append('voice_mode', 'prebuilt');
      formData.append('voice_config', JSON.stringify({ prebuilt_voice: voiceId }));
      formData.append('personality', JSON.stringify({ speaking_role: 'host' }));

      // Note: For preview we'll call the TTS directly via synthesize endpoint
      // For now, just show it's selected since preview requires a created character
      setPlayingVoiceId(voiceId);
      setTimeout(() => setPlayingVoiceId(null), 100);
    } catch (err) {
      console.error('Failed to preview voice:', err);
    } finally {
      setPreviewLoading(false);
    }
  };

  // Re-register voice with TTS service
  const handleReRegisterVoice = async () => {
    if (!character?.id) return;

    setReRegistering(true);
    setError(null);
    setReRegisterSuccess(false);

    try {
      const updated = await api.reRegisterCharacterVoice(character.id);
      setReRegisterSuccess(true);
      // Update the parent with the new character data
      if (onSave) {
        onSave(updated);
      }
      // Clear success message after 3 seconds
      setTimeout(() => setReRegisterSuccess(false), 3000);
    } catch (err) {
      setError(err.message || 'Failed to re-register voice');
    } finally {
      setReRegistering(false);
    }
  };

  // Add key phrase
  const addKeyPhrase = () => {
    if (newPhrase.trim() && !keyPhrases.includes(newPhrase.trim())) {
      setKeyPhrases([...keyPhrases, newPhrase.trim()]);
      setNewPhrase('');
    }
  };

  // Remove key phrase
  const removeKeyPhrase = (phrase) => {
    setKeyPhrases(keyPhrases.filter(p => p !== phrase));
  };

  // Add expertise area
  const addExpertise = () => {
    if (newExpertise.trim() && !expertiseAreas.includes(newExpertise.trim())) {
      setExpertiseAreas([...expertiseAreas, newExpertise.trim()]);
      setNewExpertise('');
    }
  };

  // Remove expertise area
  const removeExpertise = (area) => {
    setExpertiseAreas(expertiseAreas.filter(a => a !== area));
  };

  // Validate form
  const validateForm = () => {
    if (!name.trim()) {
      setError('Please enter a character name');
      return false;
    }

    if (voiceMode === 'clone') {
      if (!isEditing && !audioFile) {
        setError('Please upload an audio file for voice cloning');
        return false;
      }
      if (!transcript.trim()) {
        setError('Please enter the transcript of the audio');
        return false;
      }
    }

    if (voiceMode === 'design' && !voiceDescription.trim()) {
      setError('Please describe the voice you want');
      return false;
    }

    return true;
  };

  // Save character
  const handleSave = async () => {
    if (!validateForm()) return;

    setSaving(true);
    setError(null);

    try {
      const personality = {
        traits,
        key_phrases: keyPhrases,
        expertise_areas: expertiseAreas,
        speaking_role: speakingRole,
        emotion_style: emotionStyle,
      };

      let voiceConfig = {};
      if (voiceMode === 'prebuilt') {
        voiceConfig = { prebuilt_voice: prebuiltVoice };
      } else if (voiceMode === 'design') {
        voiceConfig = { description: voiceDescription };
      } else if (voiceMode === 'clone') {
        voiceConfig = { reference_transcript: transcript };
      }

      let savedCharacter;

      if (isEditing) {
        // Update existing character
        savedCharacter = await api.updatePodcastCharacter(character.id, {
          name,
          personality,
          voice_config: voiceConfig,
        });
      } else {
        // Create new character
        const formData = new FormData();
        formData.append('name', name);
        formData.append('voice_mode', voiceMode);
        formData.append('voice_config', JSON.stringify(voiceConfig));
        formData.append('personality', JSON.stringify(personality));

        if (voiceMode === 'clone' && audioFile) {
          formData.append('audio_file', audioFile);
        }

        savedCharacter = await api.createPodcastCharacter(formData);
      }

      onSave(savedCharacter);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="character-editor-overlay" onClick={onClose}>
      <div className="character-editor" onClick={e => e.stopPropagation()}>
        <div className="editor-header">
          <h2>{isEditing ? 'Edit Character' : 'Create Character'}</h2>
          <button className="btn-close" onClick={onClose} title="Close (Esc)">
            <X size={20} />
          </button>
        </div>

        <div className="editor-content">
          {/* Name Input */}
          <div className="form-section">
            <label className="form-label">Character Name</label>
            <input
              type="text"
              className="form-input"
              placeholder="e.g., Sarah, The Professor"
              value={name}
              onChange={e => setName(e.target.value)}
            />
          </div>

          {/* Voice Mode Tabs */}
          <div className="form-section">
            <label className="form-label">Voice Type</label>
            <div className="voice-mode-tabs">
              {VOICE_MODES.map(mode => {
                const Icon = mode.icon;
                return (
                  <button
                    key={mode.id}
                    className={`voice-mode-tab ${voiceMode === mode.id ? 'active' : ''}`}
                    onClick={() => setVoiceMode(mode.id)}
                    disabled={isEditing && mode.id !== character?.voice_mode}
                  >
                    <Icon size={18} />
                    <span className="tab-label">{mode.label}</span>
                    <span className="tab-description">{mode.description}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Voice Configuration based on mode */}
          <div className="form-section voice-config-section">
            {voiceMode === 'clone' && (
              <div className="clone-config">
                <div className="audio-upload">
                  <label className="form-label">Voice Sample (3-10 seconds)</label>
                  <div className="upload-area" onClick={() => fileInputRef.current?.click()}>
                    {audioFileName ? (
                      <div className="upload-preview">
                        <span className="file-name">{audioFileName}</span>
                        {audioPreviewUrl && (
                          <button
                            className="btn-icon"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleAudioPreview();
                            }}
                          >
                            {previewPlaying ? <Pause size={16} /> : <Play size={16} />}
                          </button>
                        )}
                      </div>
                    ) : (
                      <>
                        <Upload size={24} />
                        <span>Click to upload WAV or MP3</span>
                      </>
                    )}
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="audio/*"
                    onChange={handleFileSelect}
                    style={{ display: 'none' }}
                  />
                  <audio
                    ref={audioPreviewRef}
                    src={audioPreviewUrl}
                    onEnded={() => setPreviewPlaying(false)}
                    style={{ display: 'none' }}
                  />
                </div>

                <div className="transcript-input">
                  <label className="form-label">Transcript of Audio</label>
                  <textarea
                    className="form-textarea"
                    placeholder="Type exactly what is said in the audio sample..."
                    value={transcript}
                    onChange={e => setTranscript(e.target.value)}
                    rows={3}
                  />
                </div>

                {/* Re-register button for editing existing clone characters */}
                {isEditing && character?.voice?.reference_audio && (
                  <div className="re-register-section">
                    <button
                      className={`btn-re-register ${reRegisterSuccess ? 'success' : ''}`}
                      onClick={handleReRegisterVoice}
                      disabled={reRegistering}
                    >
                      {reRegistering ? (
                        <>
                          <Loader2 size={16} className="spinning" />
                          Re-registering...
                        </>
                      ) : reRegisterSuccess ? (
                        <>
                          <Check size={16} />
                          Voice Registered
                        </>
                      ) : (
                        <>
                          <RefreshCw size={16} />
                          Re-register Voice
                        </>
                      )}
                    </button>
                    <p className="form-hint">
                      Use this if voice preview fails after TTS service restart.
                    </p>
                  </div>
                )}
              </div>
            )}

            {voiceMode === 'design' && (
              <div className="design-config">
                <label className="form-label">Voice Description</label>
                <textarea
                  className="form-textarea"
                  placeholder="Describe the voice you want, e.g., 'Warm female voice, mid-30s, slightly raspy, speaks with confidence and enthusiasm'"
                  value={voiceDescription}
                  onChange={e => setVoiceDescription(e.target.value)}
                  rows={4}
                />
                <p className="form-hint">
                  Be specific about age, gender, tone, accent, and speaking style.
                </p>
              </div>
            )}

            {voiceMode === 'prebuilt' && (
              <div className="prebuilt-config">
                <label className="form-label">Select Voice</label>
                {loadingVoices ? (
                  <div className="loading-voices">
                    <Loader2 size={20} className="spinning" />
                    <span>Loading voices...</span>
                  </div>
                ) : (
                  <div className="prebuilt-voices-grid">
                    {prebuiltVoices.map(voice => (
                      <button
                        key={voice.id}
                        className={`prebuilt-voice-option ${prebuiltVoice === voice.id ? 'selected' : ''}`}
                        onClick={() => setPrebuiltVoice(voice.id)}
                      >
                        <div className="voice-option-header">
                          <span className="voice-name">{voice.name}</span>
                          <span className={`voice-gender ${voice.gender}`}>
                            {voice.gender === 'male' ? 'M' : 'F'}
                          </span>
                        </div>
                        <p className="voice-description">{voice.description}</p>
                        {prebuiltVoice === voice.id && (
                          <Check size={16} className="selected-check" />
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Personality Section */}
          <div className="form-section personality-section">
            <h3 className="section-title">Personality</h3>

            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Speaking Role</label>
                <div className="role-selector">
                  {SPEAKING_ROLES.map(role => (
                    <button
                      key={role.id}
                      className={`role-option ${speakingRole === role.id ? 'selected' : ''}`}
                      onClick={() => setSpeakingRole(role.id)}
                    >
                      <span className="role-label">{role.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Character Traits</label>
              <textarea
                className="form-textarea"
                placeholder="e.g., Warm, curious, asks insightful questions, uses humor to explain complex topics"
                value={traits}
                onChange={e => setTraits(e.target.value)}
                rows={2}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Key Phrases</label>
              <div className="chips-input">
                <div className="chips-list">
                  {keyPhrases.map((phrase, idx) => (
                    <span key={idx} className="chip">
                      "{phrase}"
                      <button onClick={() => removeKeyPhrase(phrase)}>
                        <X size={12} />
                      </button>
                    </span>
                  ))}
                </div>
                <div className="chip-input-row">
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Add a signature phrase..."
                    value={newPhrase}
                    onChange={e => setNewPhrase(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addKeyPhrase();
                      }
                    }}
                  />
                  <button className="btn-icon" onClick={addKeyPhrase}>
                    <Plus size={16} />
                  </button>
                </div>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Expertise Areas</label>
              <div className="chips-input">
                <div className="chips-list">
                  {expertiseAreas.map((area, idx) => (
                    <span key={idx} className="chip chip-expertise">
                      {area}
                      <button onClick={() => removeExpertise(area)}>
                        <X size={12} />
                      </button>
                    </span>
                  ))}
                </div>
                <div className="chip-input-row">
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Add an expertise area..."
                    value={newExpertise}
                    onChange={e => setNewExpertise(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addExpertise();
                      }
                    }}
                  />
                  <button className="btn-icon" onClick={addExpertise}>
                    <Plus size={16} />
                  </button>
                </div>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Emotion Style</label>
              <textarea
                className="form-textarea"
                placeholder="e.g., Enthusiastic, uses laughter, builds excitement, occasionally pauses for dramatic effect"
                value={emotionStyle}
                onChange={e => setEmotionStyle(e.target.value)}
                rows={2}
              />
            </div>
          </div>
        </div>

        {/* Error Display */}
        {error && (
          <div className="editor-error">
            <AlertCircle size={16} />
            {error}
          </div>
        )}

        {/* Actions */}
        <div className="editor-actions">
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn-primary"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? (
              <>
                <Loader2 size={16} className="spinning" />
                Saving...
              </>
            ) : (
              isEditing ? 'Save Changes' : 'Create Character'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
