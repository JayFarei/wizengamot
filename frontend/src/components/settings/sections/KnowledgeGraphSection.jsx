import { useState, useEffect } from 'react';
import {
  Cpu,
  Network,
  Eye,
  Search,
  MessageSquare,
  Moon,
  Sparkles,
  Settings,
  ChevronDown,
  ChevronUp,
  ToggleLeft,
  ToggleRight,
  Edit3,
} from 'lucide-react';
import { api } from '../../../api';
import './KnowledgeGraphSection.css';

export default function KnowledgeGraphSection({
  knowledgeGraphSettings,
  modelSettings,
  loading,
  setLoading,
  setError,
  setSuccess,
  onReload,
}) {
  // Models state
  const [entityModel, setEntityModel] = useState('');
  const [discoveryModel, setDiscoveryModel] = useState('');
  const [chatModel, setChatModel] = useState('');
  const [modelsDirty, setModelsDirty] = useState(false);

  // Entity extraction state
  const [maxEntities, setMaxEntities] = useState(5);
  const [maxRelationships, setMaxRelationships] = useState(3);
  const [similarityThreshold, setSimilarityThreshold] = useState(0.85);
  const [extractionDirty, setExtractionDirty] = useState(false);

  // Visualization state
  const [nodeSizes, setNodeSizes] = useState({
    source: 8,
    entity_min: 4,
    entity_max: 9,
    note: 6,
  });
  const [linkWidths, setLinkWidths] = useState({
    manual: 2.0,
    sequential: 1.5,
    shared_tag: 1.0,
    mentions: 0.5,
  });
  const [labelZoomThreshold, setLabelZoomThreshold] = useState(1.5);
  const [visualizationDirty, setVisualizationDirty] = useState(false);

  // Search state
  const [debounceMs, setDebounceMs] = useState(200);
  const [minQueryLength, setMinQueryLength] = useState(3);
  const [resultsLimit, setResultsLimit] = useState(20);
  const [searchDirty, setSearchDirty] = useState(false);

  // Chat state
  const [contextMaxLength, setContextMaxLength] = useState(8000);
  const [historyLimit, setHistoryLimit] = useState(20);
  const [similarityWeight, setSimilarityWeight] = useState(0.7);
  const [mentionWeight, setMentionWeight] = useState(0.3);
  const [chatDirty, setChatDirty] = useState(false);

  // Sleep compute state
  const [defaultDepth, setDefaultDepth] = useState(2);
  const [defaultMaxNotes, setDefaultMaxNotes] = useState(30);
  const [defaultTurns, setDefaultTurns] = useState(3);
  const [sleepModel, setSleepModel] = useState('');
  const [sleepDirty, setSleepDirty] = useState(false);

  // Brainstorm styles state
  const [styles, setStyles] = useState([]);
  const [stylesLoading, setStylesLoading] = useState(true);
  const [editingStyle, setEditingStyle] = useState(null);
  const [styleForm, setStyleForm] = useState({
    name: '',
    description: '',
    initialPrompt: '',
    expansionPrompt: '',
  });
  const [styleDirty, setStyleDirty] = useState(false);
  const [expandedStyles, setExpandedStyles] = useState(new Set());

  // Initialize from settings
  useEffect(() => {
    if (knowledgeGraphSettings && !modelsDirty) {
      const models = knowledgeGraphSettings.models || {};
      setEntityModel(models.entity_extraction_model || '');
      setDiscoveryModel(models.discovery_model || '');
      setChatModel(models.chat_model || '');
    }
  }, [knowledgeGraphSettings?.models, modelsDirty]);

  useEffect(() => {
    if (knowledgeGraphSettings && !extractionDirty) {
      const extraction = knowledgeGraphSettings.entity_extraction || {};
      setMaxEntities(extraction.max_entities || 5);
      setMaxRelationships(extraction.max_relationships || 3);
      setSimilarityThreshold(extraction.similarity_threshold || 0.85);
    }
  }, [knowledgeGraphSettings?.entity_extraction, extractionDirty]);

  useEffect(() => {
    if (knowledgeGraphSettings && !visualizationDirty) {
      const viz = knowledgeGraphSettings.visualization || {};
      setNodeSizes(viz.node_sizes || { source: 8, entity_min: 4, entity_max: 9, note: 6 });
      setLinkWidths(viz.link_widths || { manual: 2.0, sequential: 1.5, shared_tag: 1.0, mentions: 0.5 });
      setLabelZoomThreshold(viz.label_zoom_threshold || 1.5);
    }
  }, [knowledgeGraphSettings?.visualization, visualizationDirty]);

  useEffect(() => {
    if (knowledgeGraphSettings && !searchDirty) {
      const search = knowledgeGraphSettings.search || {};
      setDebounceMs(search.debounce_ms || 200);
      setMinQueryLength(search.min_query_length || 3);
      setResultsLimit(search.results_limit || 20);
    }
  }, [knowledgeGraphSettings?.search, searchDirty]);

  useEffect(() => {
    if (knowledgeGraphSettings && !chatDirty) {
      const chat = knowledgeGraphSettings.chat || {};
      setContextMaxLength(chat.context_max_length || 8000);
      setHistoryLimit(chat.history_limit || 20);
      setSimilarityWeight(chat.similarity_weight || 0.7);
      setMentionWeight(chat.mention_weight || 0.3);
    }
  }, [knowledgeGraphSettings?.chat, chatDirty]);

  useEffect(() => {
    if (knowledgeGraphSettings && !sleepDirty) {
      const sleep = knowledgeGraphSettings.sleep_compute || {};
      setDefaultDepth(sleep.default_depth || 2);
      setDefaultMaxNotes(sleep.default_max_notes || 30);
      setDefaultTurns(sleep.default_turns || 3);
      setSleepModel(sleep.model || '');
    }
  }, [knowledgeGraphSettings?.sleep_compute, sleepDirty]);

  // Load brainstorm styles
  useEffect(() => {
    const loadStyles = async () => {
      try {
        const result = await api.listBrainstormStyles();
        setStyles(result.styles || []);
      } catch (err) {
        console.error('Failed to load brainstorm styles:', err);
      } finally {
        setStylesLoading(false);
      }
    };
    loadStyles();
  }, []);

  const getModelShortName = (model) => model?.split('/')[1] || model || '';

  // Save handlers
  const handleSaveModels = async () => {
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      await api.updateKGModels({
        entity_extraction_model: entityModel || null,
        discovery_model: discoveryModel || null,
        chat_model: chatModel || null,
      });
      setSuccess('Knowledge Graph models updated');
      setModelsDirty(false);
      await onReload();
    } catch (err) {
      setError('Failed to update models');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveExtraction = async () => {
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      await api.updateKGEntityExtractionSettings({
        max_entities: maxEntities,
        max_relationships: maxRelationships,
        similarity_threshold: similarityThreshold,
      });
      setSuccess('Entity extraction settings updated');
      setExtractionDirty(false);
      await onReload();
    } catch (err) {
      setError('Failed to update entity extraction settings');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveVisualization = async () => {
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      await api.updateKGVisualizationSettings({
        node_sizes: nodeSizes,
        link_widths: linkWidths,
        label_zoom_threshold: labelZoomThreshold,
      });
      setSuccess('Visualization settings updated');
      setVisualizationDirty(false);
      await onReload();
    } catch (err) {
      setError('Failed to update visualization settings');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveSearch = async () => {
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      await api.updateKGSearchSettings({
        debounce_ms: debounceMs,
        min_query_length: minQueryLength,
        results_limit: resultsLimit,
      });
      setSuccess('Search settings updated');
      setSearchDirty(false);
      await onReload();
    } catch (err) {
      setError('Failed to update search settings');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveChat = async () => {
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      await api.updateKGChatSettings({
        context_max_length: contextMaxLength,
        history_limit: historyLimit,
        similarity_weight: similarityWeight,
        mention_weight: mentionWeight,
      });
      setSuccess('Chat settings updated');
      setChatDirty(false);
      await onReload();
    } catch (err) {
      setError('Failed to update chat settings');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveSleep = async () => {
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      await api.updateKGSleepComputeSettings({
        default_depth: defaultDepth,
        default_max_notes: defaultMaxNotes,
        default_turns: defaultTurns,
        model: sleepModel || null,
      });
      setSuccess('Sleep compute settings updated');
      setSleepDirty(false);
      await onReload();
    } catch (err) {
      setError('Failed to update sleep compute settings');
    } finally {
      setLoading(false);
    }
  };

  // Reset handlers
  const handleResetModels = () => {
    if (knowledgeGraphSettings?.models) {
      const models = knowledgeGraphSettings.models;
      setEntityModel(models.entity_extraction_model || '');
      setDiscoveryModel(models.discovery_model || '');
      setChatModel(models.chat_model || '');
    }
    setModelsDirty(false);
  };

  const handleResetExtraction = () => {
    if (knowledgeGraphSettings?.entity_extraction) {
      const extraction = knowledgeGraphSettings.entity_extraction;
      setMaxEntities(extraction.max_entities || 5);
      setMaxRelationships(extraction.max_relationships || 3);
      setSimilarityThreshold(extraction.similarity_threshold || 0.85);
    }
    setExtractionDirty(false);
  };

  const handleResetVisualization = () => {
    if (knowledgeGraphSettings?.visualization) {
      const viz = knowledgeGraphSettings.visualization;
      setNodeSizes(viz.node_sizes || { source: 8, entity_min: 4, entity_max: 9, note: 6 });
      setLinkWidths(viz.link_widths || { manual: 2.0, sequential: 1.5, shared_tag: 1.0, mentions: 0.5 });
      setLabelZoomThreshold(viz.label_zoom_threshold || 1.5);
    }
    setVisualizationDirty(false);
  };

  const handleResetSearch = () => {
    if (knowledgeGraphSettings?.search) {
      const search = knowledgeGraphSettings.search;
      setDebounceMs(search.debounce_ms || 200);
      setMinQueryLength(search.min_query_length || 3);
      setResultsLimit(search.results_limit || 20);
    }
    setSearchDirty(false);
  };

  const handleResetChat = () => {
    if (knowledgeGraphSettings?.chat) {
      const chat = knowledgeGraphSettings.chat;
      setContextMaxLength(chat.context_max_length || 8000);
      setHistoryLimit(chat.history_limit || 20);
      setSimilarityWeight(chat.similarity_weight || 0.7);
      setMentionWeight(chat.mention_weight || 0.3);
    }
    setChatDirty(false);
  };

  const handleResetSleep = () => {
    if (knowledgeGraphSettings?.sleep_compute) {
      const sleep = knowledgeGraphSettings.sleep_compute;
      setDefaultDepth(sleep.default_depth || 2);
      setDefaultMaxNotes(sleep.default_max_notes || 30);
      setDefaultTurns(sleep.default_turns || 3);
      setSleepModel(sleep.model || '');
    }
    setSleepDirty(false);
  };

  // Brainstorm style handlers
  const handleToggleStyle = async (styleId, currentEnabled) => {
    setLoading(true);
    setError('');

    try {
      if (currentEnabled) {
        await api.disableBrainstormStyle(styleId);
      } else {
        await api.enableBrainstormStyle(styleId);
      }
      const result = await api.listBrainstormStyles();
      setStyles(result.styles || []);
      setSuccess(`Style ${currentEnabled ? 'disabled' : 'enabled'}`);
    } catch (err) {
      setError(err.message || 'Failed to toggle style');
    } finally {
      setLoading(false);
    }
  };

  const handleEditStyle = async (style) => {
    try {
      const fullStyle = await api.getBrainstormStyle(style.id);
      setEditingStyle(style.id);
      setStyleForm({
        name: fullStyle.name || '',
        description: fullStyle.description || '',
        initialPrompt: fullStyle.initial_prompt || '',
        expansionPrompt: fullStyle.expansion_prompt || '',
      });
      setStyleDirty(false);
    } catch (err) {
      setError('Failed to load style details');
    }
  };

  const handleSaveStyle = async () => {
    if (!styleForm.name.trim()) {
      setError('Style name is required');
      return;
    }

    setLoading(true);
    setError('');
    setSuccess('');

    try {
      await api.updateBrainstormStyle(editingStyle, {
        name: styleForm.name,
        description: styleForm.description,
        initialPrompt: styleForm.initialPrompt,
        expansionPrompt: styleForm.expansionPrompt,
      });
      setSuccess('Brainstorming style updated');

      const result = await api.listBrainstormStyles();
      setStyles(result.styles || []);
      setEditingStyle(null);
      setStyleDirty(false);
    } catch (err) {
      setError(err.message || 'Failed to save style');
    } finally {
      setLoading(false);
    }
  };

  const handleCancelStyleEdit = () => {
    setEditingStyle(null);
    setStyleForm({
      name: '',
      description: '',
      initialPrompt: '',
      expansionPrompt: '',
    });
    setStyleDirty(false);
  };

  const handleStyleFormChange = (field) => (e) => {
    setStyleForm((prev) => ({ ...prev, [field]: e.target.value }));
    setStyleDirty(true);
  };

  const toggleStyleExpanded = (styleId) => {
    setExpandedStyles((prev) => {
      const next = new Set(prev);
      if (next.has(styleId)) {
        next.delete(styleId);
      } else {
        next.add(styleId);
      }
      return next;
    });
  };

  return (
    <div className="settings-section knowledge-graph-section">
      {/* Models Section */}
      <div id="kg-models" className="modal-section">
        <h3>
          <Cpu size={18} />
          Models
        </h3>
        <p className="section-description">
          Configure which models are used for different Knowledge Graph operations.
        </p>

        {modelSettings && (
          <div className="kg-settings-grid">
            <div className="kg-setting-row">
              <label>Entity Extraction Model</label>
              <select
                className="setting-select"
                value={entityModel}
                onChange={(e) => {
                  setEntityModel(e.target.value);
                  setModelsDirty(true);
                }}
                disabled={loading}
              >
                {modelSettings.model_pool.map((model) => (
                  <option key={model} value={model}>
                    {getModelShortName(model)}
                  </option>
                ))}
              </select>
              <span className="field-hint">Used for extracting entities and relationships from notes</span>
            </div>

            <div className="kg-setting-row">
              <label>Discovery Model</label>
              <select
                className="setting-select"
                value={discoveryModel}
                onChange={(e) => {
                  setDiscoveryModel(e.target.value);
                  setModelsDirty(true);
                }}
                disabled={loading}
              >
                {modelSettings.model_pool.map((model) => (
                  <option key={model} value={model}>
                    {getModelShortName(model)}
                  </option>
                ))}
              </select>
              <span className="field-hint">Used for discovering connections between notes</span>
            </div>

            <div className="kg-setting-row">
              <label>Chat Model</label>
              <select
                className="setting-select"
                value={chatModel}
                onChange={(e) => {
                  setChatModel(e.target.value);
                  setModelsDirty(true);
                }}
                disabled={loading}
              >
                {modelSettings.model_pool.map((model) => (
                  <option key={model} value={model}>
                    {getModelShortName(model)}
                  </option>
                ))}
              </select>
              <span className="field-hint">Used for RAG-powered chat with your knowledge base</span>
            </div>
          </div>
        )}

        <div className="btn-group">
          <button
            className="btn-primary"
            onClick={handleSaveModels}
            disabled={loading || !modelsDirty}
          >
            {loading ? 'Saving...' : 'Save Models'}
          </button>
          {modelsDirty && (
            <button className="btn-secondary" onClick={handleResetModels} disabled={loading}>
              Reset
            </button>
          )}
        </div>
      </div>

      {/* Entity Extraction Section */}
      <div id="kg-entity-extraction" className="modal-section">
        <h3>
          <Network size={18} />
          Entity Extraction
        </h3>
        <p className="section-description">
          Configure how entities and relationships are extracted from notes.
        </p>

        <div className="kg-settings-grid">
          <div className="kg-setting-row">
            <label>Max Entities Per Note</label>
            <div className="kg-slider-group">
              <input
                type="range"
                min="1"
                max="15"
                step="1"
                value={maxEntities}
                onChange={(e) => {
                  setMaxEntities(parseInt(e.target.value));
                  setExtractionDirty(true);
                }}
                className="kg-slider"
              />
              <span className="kg-slider-value">{maxEntities}</span>
            </div>
            <span className="field-hint">Maximum entities to extract from each note</span>
          </div>

          <div className="kg-setting-row">
            <label>Max Relationships Per Note</label>
            <div className="kg-slider-group">
              <input
                type="range"
                min="1"
                max="10"
                step="1"
                value={maxRelationships}
                onChange={(e) => {
                  setMaxRelationships(parseInt(e.target.value));
                  setExtractionDirty(true);
                }}
                className="kg-slider"
              />
              <span className="kg-slider-value">{maxRelationships}</span>
            </div>
            <span className="field-hint">Maximum relationships to extract from each note</span>
          </div>

          <div className="kg-setting-row">
            <label>Similarity Threshold</label>
            <div className="kg-slider-group">
              <input
                type="range"
                min="0.5"
                max="1"
                step="0.05"
                value={similarityThreshold}
                onChange={(e) => {
                  setSimilarityThreshold(parseFloat(e.target.value));
                  setExtractionDirty(true);
                }}
                className="kg-slider"
              />
              <span className="kg-slider-value">{similarityThreshold.toFixed(2)}</span>
            </div>
            <span className="field-hint">Threshold for entity deduplication (higher = stricter)</span>
          </div>
        </div>

        <div className="btn-group">
          <button
            className="btn-primary"
            onClick={handleSaveExtraction}
            disabled={loading || !extractionDirty}
          >
            {loading ? 'Saving...' : 'Save Extraction Settings'}
          </button>
          {extractionDirty && (
            <button className="btn-secondary" onClick={handleResetExtraction} disabled={loading}>
              Reset
            </button>
          )}
        </div>
      </div>

      {/* Visualization Section */}
      <div id="kg-visualization" className="modal-section">
        <h3>
          <Eye size={18} />
          Visualization
        </h3>
        <p className="section-description">
          Configure how the knowledge graph is rendered visually.
        </p>

        <div className="kg-settings-grid">
          <h4 className="kg-subsection-title">Node Sizes</h4>
          <div className="kg-setting-row">
            <label>Source Node Size</label>
            <div className="kg-slider-group">
              <input
                type="range"
                min="4"
                max="16"
                step="1"
                value={nodeSizes.source}
                onChange={(e) => {
                  setNodeSizes((prev) => ({ ...prev, source: parseInt(e.target.value) }));
                  setVisualizationDirty(true);
                }}
                className="kg-slider"
              />
              <span className="kg-slider-value">{nodeSizes.source}</span>
            </div>
          </div>

          <div className="kg-setting-row">
            <label>Note Node Size</label>
            <div className="kg-slider-group">
              <input
                type="range"
                min="2"
                max="12"
                step="1"
                value={nodeSizes.note}
                onChange={(e) => {
                  setNodeSizes((prev) => ({ ...prev, note: parseInt(e.target.value) }));
                  setVisualizationDirty(true);
                }}
                className="kg-slider"
              />
              <span className="kg-slider-value">{nodeSizes.note}</span>
            </div>
          </div>

          <div className="kg-setting-row">
            <label>Entity Size Range</label>
            <div className="kg-range-inputs">
              <input
                type="number"
                min="2"
                max="10"
                value={nodeSizes.entity_min}
                onChange={(e) => {
                  setNodeSizes((prev) => ({ ...prev, entity_min: parseInt(e.target.value) }));
                  setVisualizationDirty(true);
                }}
                className="kg-number-input"
              />
              <span>to</span>
              <input
                type="number"
                min="5"
                max="20"
                value={nodeSizes.entity_max}
                onChange={(e) => {
                  setNodeSizes((prev) => ({ ...prev, entity_max: parseInt(e.target.value) }));
                  setVisualizationDirty(true);
                }}
                className="kg-number-input"
              />
            </div>
            <span className="field-hint">Size varies by connection count</span>
          </div>

          <h4 className="kg-subsection-title">Link Widths</h4>
          <div className="kg-setting-row">
            <label>Manual Links</label>
            <div className="kg-slider-group">
              <input
                type="range"
                min="0.5"
                max="4"
                step="0.5"
                value={linkWidths.manual}
                onChange={(e) => {
                  setLinkWidths((prev) => ({ ...prev, manual: parseFloat(e.target.value) }));
                  setVisualizationDirty(true);
                }}
                className="kg-slider"
              />
              <span className="kg-slider-value">{linkWidths.manual}</span>
            </div>
          </div>

          <div className="kg-setting-row">
            <label>Sequential Links</label>
            <div className="kg-slider-group">
              <input
                type="range"
                min="0.5"
                max="4"
                step="0.5"
                value={linkWidths.sequential}
                onChange={(e) => {
                  setLinkWidths((prev) => ({ ...prev, sequential: parseFloat(e.target.value) }));
                  setVisualizationDirty(true);
                }}
                className="kg-slider"
              />
              <span className="kg-slider-value">{linkWidths.sequential}</span>
            </div>
          </div>

          <div className="kg-setting-row">
            <label>Shared Tag Links</label>
            <div className="kg-slider-group">
              <input
                type="range"
                min="0.5"
                max="4"
                step="0.5"
                value={linkWidths.shared_tag}
                onChange={(e) => {
                  setLinkWidths((prev) => ({ ...prev, shared_tag: parseFloat(e.target.value) }));
                  setVisualizationDirty(true);
                }}
                className="kg-slider"
              />
              <span className="kg-slider-value">{linkWidths.shared_tag}</span>
            </div>
          </div>

          <div className="kg-setting-row">
            <label>Mention Links</label>
            <div className="kg-slider-group">
              <input
                type="range"
                min="0.1"
                max="2"
                step="0.1"
                value={linkWidths.mentions}
                onChange={(e) => {
                  setLinkWidths((prev) => ({ ...prev, mentions: parseFloat(e.target.value) }));
                  setVisualizationDirty(true);
                }}
                className="kg-slider"
              />
              <span className="kg-slider-value">{linkWidths.mentions}</span>
            </div>
          </div>

          <h4 className="kg-subsection-title">Labels</h4>
          <div className="kg-setting-row">
            <label>Label Zoom Threshold</label>
            <div className="kg-slider-group">
              <input
                type="range"
                min="0.5"
                max="3"
                step="0.1"
                value={labelZoomThreshold}
                onChange={(e) => {
                  setLabelZoomThreshold(parseFloat(e.target.value));
                  setVisualizationDirty(true);
                }}
                className="kg-slider"
              />
              <span className="kg-slider-value">{labelZoomThreshold.toFixed(1)}</span>
            </div>
            <span className="field-hint">Zoom level at which labels appear</span>
          </div>
        </div>

        <div className="btn-group">
          <button
            className="btn-primary"
            onClick={handleSaveVisualization}
            disabled={loading || !visualizationDirty}
          >
            {loading ? 'Saving...' : 'Save Visualization Settings'}
          </button>
          {visualizationDirty && (
            <button className="btn-secondary" onClick={handleResetVisualization} disabled={loading}>
              Reset
            </button>
          )}
        </div>
      </div>

      {/* Search Section */}
      <div id="kg-search" className="modal-section">
        <h3>
          <Search size={18} />
          Search
        </h3>
        <p className="section-description">
          Configure search behavior in the Knowledge Graph.
        </p>

        <div className="kg-settings-grid">
          <div className="kg-setting-row">
            <label>Debounce Delay (ms)</label>
            <div className="kg-slider-group">
              <input
                type="range"
                min="100"
                max="500"
                step="50"
                value={debounceMs}
                onChange={(e) => {
                  setDebounceMs(parseInt(e.target.value));
                  setSearchDirty(true);
                }}
                className="kg-slider"
              />
              <span className="kg-slider-value">{debounceMs}ms</span>
            </div>
            <span className="field-hint">Delay before search triggers while typing</span>
          </div>

          <div className="kg-setting-row">
            <label>Minimum Query Length</label>
            <div className="kg-slider-group">
              <input
                type="range"
                min="1"
                max="5"
                step="1"
                value={minQueryLength}
                onChange={(e) => {
                  setMinQueryLength(parseInt(e.target.value));
                  setSearchDirty(true);
                }}
                className="kg-slider"
              />
              <span className="kg-slider-value">{minQueryLength}</span>
            </div>
            <span className="field-hint">Characters required before search starts</span>
          </div>

          <div className="kg-setting-row">
            <label>Results Limit</label>
            <div className="kg-slider-group">
              <input
                type="range"
                min="5"
                max="50"
                step="5"
                value={resultsLimit}
                onChange={(e) => {
                  setResultsLimit(parseInt(e.target.value));
                  setSearchDirty(true);
                }}
                className="kg-slider"
              />
              <span className="kg-slider-value">{resultsLimit}</span>
            </div>
            <span className="field-hint">Maximum search results to return</span>
          </div>
        </div>

        <div className="btn-group">
          <button
            className="btn-primary"
            onClick={handleSaveSearch}
            disabled={loading || !searchDirty}
          >
            {loading ? 'Saving...' : 'Save Search Settings'}
          </button>
          {searchDirty && (
            <button className="btn-secondary" onClick={handleResetSearch} disabled={loading}>
              Reset
            </button>
          )}
        </div>
      </div>

      {/* Chat Section */}
      <div id="kg-chat" className="modal-section">
        <h3>
          <MessageSquare size={18} />
          Chat
        </h3>
        <p className="section-description">
          Configure the RAG-powered chat with your knowledge base.
        </p>

        <div className="kg-settings-grid">
          <div className="kg-setting-row">
            <label>Context Max Length</label>
            <div className="kg-slider-group">
              <input
                type="range"
                min="2000"
                max="16000"
                step="1000"
                value={contextMaxLength}
                onChange={(e) => {
                  setContextMaxLength(parseInt(e.target.value));
                  setChatDirty(true);
                }}
                className="kg-slider"
              />
              <span className="kg-slider-value">{contextMaxLength.toLocaleString()}</span>
            </div>
            <span className="field-hint">Maximum characters of context to include</span>
          </div>

          <div className="kg-setting-row">
            <label>History Limit</label>
            <div className="kg-slider-group">
              <input
                type="range"
                min="5"
                max="50"
                step="5"
                value={historyLimit}
                onChange={(e) => {
                  setHistoryLimit(parseInt(e.target.value));
                  setChatDirty(true);
                }}
                className="kg-slider"
              />
              <span className="kg-slider-value">{historyLimit}</span>
            </div>
            <span className="field-hint">Maximum conversation history to maintain</span>
          </div>

          <div className="kg-setting-row">
            <label>Similarity Weight</label>
            <div className="kg-slider-group">
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={similarityWeight}
                onChange={(e) => {
                  setSimilarityWeight(parseFloat(e.target.value));
                  setChatDirty(true);
                }}
                className="kg-slider"
              />
              <span className="kg-slider-value">{similarityWeight.toFixed(1)}</span>
            </div>
            <span className="field-hint">Weight for semantic similarity in ranking</span>
          </div>

          <div className="kg-setting-row">
            <label>Mention Weight</label>
            <div className="kg-slider-group">
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={mentionWeight}
                onChange={(e) => {
                  setMentionWeight(parseFloat(e.target.value));
                  setChatDirty(true);
                }}
                className="kg-slider"
              />
              <span className="kg-slider-value">{mentionWeight.toFixed(1)}</span>
            </div>
            <span className="field-hint">Weight for entity mentions in ranking</span>
          </div>
        </div>

        <div className="btn-group">
          <button
            className="btn-primary"
            onClick={handleSaveChat}
            disabled={loading || !chatDirty}
          >
            {loading ? 'Saving...' : 'Save Chat Settings'}
          </button>
          {chatDirty && (
            <button className="btn-secondary" onClick={handleResetChat} disabled={loading}>
              Reset
            </button>
          )}
        </div>
      </div>

      {/* Sleep Time Compute Section */}
      <div id="kg-sleep-compute" className="modal-section">
        <h3>
          <Moon size={18} />
          Sleep Time Compute
        </h3>
        <p className="section-description">
          Configure default values for sleep compute sessions. Users can override these when starting a session.
        </p>

        <div className="kg-settings-grid">
          <div className="kg-setting-row">
            <label>Default Depth</label>
            <div className="kg-slider-group">
              <input
                type="range"
                min="1"
                max="3"
                step="1"
                value={defaultDepth}
                onChange={(e) => {
                  setDefaultDepth(parseInt(e.target.value));
                  setSleepDirty(true);
                }}
                className="kg-slider"
              />
              <span className="kg-slider-value">{defaultDepth}</span>
            </div>
            <span className="field-hint">Graph traversal hops (1=shallow, 3=deep)</span>
          </div>

          <div className="kg-setting-row">
            <label>Default Max Notes</label>
            <div className="kg-slider-group">
              <input
                type="range"
                min="10"
                max="50"
                step="5"
                value={defaultMaxNotes}
                onChange={(e) => {
                  setDefaultMaxNotes(parseInt(e.target.value));
                  setSleepDirty(true);
                }}
                className="kg-slider"
              />
              <span className="kg-slider-value">{defaultMaxNotes}</span>
            </div>
            <span className="field-hint">Maximum notes to analyze per session</span>
          </div>

          <div className="kg-setting-row">
            <label>Default Turns</label>
            <div className="kg-slider-group">
              <input
                type="range"
                min="2"
                max="5"
                step="1"
                value={defaultTurns}
                onChange={(e) => {
                  setDefaultTurns(parseInt(e.target.value));
                  setSleepDirty(true);
                }}
                className="kg-slider"
              />
              <span className="kg-slider-value">{defaultTurns}</span>
            </div>
            <span className="field-hint">Brainstorming iterations per session</span>
          </div>

          {modelSettings && (
            <div className="kg-setting-row">
              <label>Model Override</label>
              <select
                className="setting-select"
                value={sleepModel}
                onChange={(e) => {
                  setSleepModel(e.target.value);
                  setSleepDirty(true);
                }}
                disabled={loading}
              >
                <option value="">Default (Claude Opus 4.5)</option>
                {modelSettings.model_pool.map((model) => (
                  <option key={model} value={model}>
                    {getModelShortName(model)}
                  </option>
                ))}
              </select>
              <span className="field-hint">Leave empty to use default model</span>
            </div>
          )}
        </div>

        <div className="btn-group">
          <button
            className="btn-primary"
            onClick={handleSaveSleep}
            disabled={loading || !sleepDirty}
          >
            {loading ? 'Saving...' : 'Save Sleep Compute Settings'}
          </button>
          {sleepDirty && (
            <button className="btn-secondary" onClick={handleResetSleep} disabled={loading}>
              Reset
            </button>
          )}
        </div>
      </div>

      {/* Brainstorm Styles Section */}
      <div id="kg-brainstorm-styles" className="modal-section">
        <h3>
          <Sparkles size={18} />
          Brainstorming Styles
        </h3>
        <p className="section-description">
          Enable/disable styles and customize their prompts. Each style applies a different
          brainstorming methodology to explore your knowledge graph.
        </p>

        {stylesLoading ? (
          <div className="styles-loading">Loading styles...</div>
        ) : (
          <div className="brainstorm-styles-list">
            {styles.map((style) => {
              const isExpanded = expandedStyles.has(style.id);
              const isEditing = editingStyle === style.id;

              return (
                <div
                  key={style.id}
                  className={`brainstorm-style-block ${style.enabled === false ? 'disabled' : ''} ${isEditing ? 'editing' : ''}`}
                >
                  <div className="brainstorm-style-header">
                    <button
                      className="brainstorm-style-toggle"
                      onClick={() => handleToggleStyle(style.id, style.enabled !== false)}
                      title={style.enabled === false ? 'Enable style' : 'Disable style'}
                    >
                      {style.enabled === false ? (
                        <ToggleLeft size={20} className="toggle-off" />
                      ) : (
                        <ToggleRight size={20} className="toggle-on" />
                      )}
                    </button>

                    <div className="brainstorm-style-info">
                      <span className="brainstorm-style-name">{style.name}</span>
                      <span className="brainstorm-style-description">{style.description}</span>
                    </div>

                    <div className="brainstorm-style-actions">
                      <button
                        className="btn-icon"
                        onClick={() => handleEditStyle(style)}
                        title="Edit prompts"
                      >
                        <Edit3 size={16} />
                      </button>
                      <button
                        className="btn-icon"
                        onClick={() => toggleStyleExpanded(style.id)}
                        title={isExpanded ? 'Collapse' : 'Expand'}
                      >
                        {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                      </button>
                    </div>
                  </div>

                  {isExpanded && style.turn_pattern && (
                    <div className="brainstorm-style-details">
                      <div className="brainstorm-style-pattern">
                        <strong>Turn Pattern:</strong> {style.turn_pattern.join(' → ')}
                      </div>
                    </div>
                  )}

                  {isEditing && (
                    <div className="brainstorm-style-editor">
                      <div className="form-row">
                        <label>Display Name</label>
                        <input
                          type="text"
                          value={styleForm.name}
                          onChange={handleStyleFormChange('name')}
                          className="style-input"
                        />
                      </div>

                      <div className="form-row">
                        <label>Description</label>
                        <input
                          type="text"
                          value={styleForm.description}
                          onChange={handleStyleFormChange('description')}
                          className="style-input"
                        />
                      </div>

                      <div className="form-row">
                        <label>Initial Prompt</label>
                        <textarea
                          value={styleForm.initialPrompt}
                          onChange={handleStyleFormChange('initialPrompt')}
                          className="style-prompt-textarea"
                          rows={10}
                          placeholder="Prompt for the first turn..."
                        />
                        <span className="field-hint">
                          Use {'{notes_content}'} to insert the collected notes
                        </span>
                      </div>

                      <div className="form-row">
                        <label>Expansion Prompt</label>
                        <textarea
                          value={styleForm.expansionPrompt}
                          onChange={handleStyleFormChange('expansionPrompt')}
                          className="style-prompt-textarea"
                          rows={10}
                          placeholder="Prompt for subsequent turns..."
                        />
                        <span className="field-hint">
                          Use {'{idea}'} for previous ideas and {'{notes_content}'} for notes
                        </span>
                      </div>

                      <div className="btn-group">
                        <button
                          className="btn-primary"
                          onClick={handleSaveStyle}
                          disabled={loading || !styleDirty}
                        >
                          {loading ? 'Saving...' : 'Save Style'}
                        </button>
                        <button
                          className="btn-secondary"
                          onClick={handleCancelStyleEdit}
                          disabled={loading}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
