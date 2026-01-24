import React, { useState, useEffect, useCallback, useRef } from 'react';
import { X, Sparkles, Maximize2, Minimize2, Moon, Zap, Loader, Users } from 'lucide-react';
import { api } from '../api';
import ChatInput from './ChatInput';
import BrainstormStyleSelector from './BrainstormStyleSelector';
import BudgetControls from './BudgetControls';
import SleepComputeStatus from './SleepComputeStatus';
import EntryPointSelector from './EntryPointSelector';

/**
 * KnowledgeGraphDiscover - Discovery panel for generating new insights
 * Supports two modes:
 * - Quick Discover: Fast single-turn discovery using Claude Opus 4.5
 * - Sleep Time Compute: Multi-turn brainstorming with style selection and budget controls
 *
 * Note: Review functionality has been moved to KnowledgeGraphReview component
 *
 * Props:
 * - mode: 'quick' | 'sleep' - the discovery mode (passed from parent)
 * - onClose: close handler
 * - onRefreshGraph: callback to refresh the graph
 * - activeWorkers: array of active sleep compute workers
 * - setActiveWorkers: setter for active workers
 */
export default function KnowledgeGraphDiscover({
  mode: initialMode = 'quick',
  onClose,
  onRefreshGraph,
  activeWorkers = [],      // Lifted to parent for persistence
  setActiveWorkers = null, // Lifted to parent for persistence
}) {
  // Mode state - initialized from prop, can be toggled by user within panel
  const [mode, setMode] = useState(initialMode);

  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [fullScreen, setFullScreen] = useState(false);

  // Sleep Time Compute state
  const [selectedStyle, setSelectedStyle] = useState('big_mind_mapping');
  const [depth, setDepth] = useState(2);
  const [maxNotes, setMaxNotes] = useState(30);
  const [turns, setTurns] = useState(3);
  const [notesTarget, setNotesTarget] = useState(10);
  const [entryPoints, setEntryPoints] = useState([]);

  // Maximum concurrent workers
  const MAX_WORKERS = 3;

  // Ref to track polling interval for quick discovery status
  const pollingIntervalRef = useRef(null);

  // Example prompts for user guidance
  const examplePrompts = [
    "Find connections between AI and philosophy",
    "What patterns am I missing in my research?",
    "Suggest bridge notes connecting different domains",
  ];

  // Sync mode when prop changes
  useEffect(() => {
    setMode(initialMode);
  }, [initialMode]);

  // Auto-switch to sleep mode when there are active workers
  useEffect(() => {
    if (activeWorkers.length > 0) {
      setMode('sleep');
    }
  }, [activeWorkers.length]);

  // Load sleep compute default settings
  useEffect(() => {
    const loadSleepSettings = async () => {
      try {
        const settings = await api.getSleepComputeSettings();
        if (settings.default_depth) setDepth(settings.default_depth);
        if (settings.default_max_notes) setMaxNotes(settings.default_max_notes);
        if (settings.default_turns) setTurns(settings.default_turns);
      } catch (err) {
        console.error('Failed to load sleep compute settings:', err);
      }
    };
    loadSleepSettings();
  }, []);

  // Cleanup polling interval on unmount
  useEffect(() => {
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
    };
  }, []);

  // Helper to stop polling
  const stopPolling = useCallback(() => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
  }, []);

  // Run discovery (Quick mode)
  const handleRunDiscovery = async () => {
    if (!prompt.trim() || loading) return;

    setLoading(true);
    setError(null);
    setStatus({ phase: 'starting', progress: 0 });

    // Start polling for status updates
    pollingIntervalRef.current = setInterval(async () => {
      try {
        const statusResponse = await api.getDiscoveryStatus();
        if (statusResponse && statusResponse.phase) {
          setStatus({
            phase: statusResponse.phase,
            progress: statusResponse.progress || 0,
          });
        }
      } catch (pollErr) {
        // Ignore polling errors, the main request will handle failures
        console.debug('Status poll error (expected if discovery completed):', pollErr);
      }
    }, 500);

    try {
      const result = await api.runDiscovery(prompt.trim());

      if (result.error) {
        setError(result.error);
      } else {
        setPrompt('');
        if (onRefreshGraph) onRefreshGraph();
      }
    } catch (err) {
      setError(err.message);
    } finally {
      stopPolling();
      setLoading(false);
      setStatus(null);
    }
  };

  // Check if can start more workers
  const canStartWorker = activeWorkers.length < MAX_WORKERS;

  // Run Sleep Time Compute (Sleep mode) - starts a new worker
  const handleRunSleepCompute = async () => {
    if (loading || !canStartWorker) return;

    if (!selectedStyle) {
      setError('Please select a brainstorming style');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Generate a prompt from entry points for backend compatibility
      const generatedPrompt = entryPoints.length > 0
        ? `Explore connections starting from: ${entryPoints.map(ep => ep.title).join(', ')}`
        : 'Explore connections across the knowledge graph';

      const result = await api.startSleepCompute({
        prompt: generatedPrompt,
        styleId: selectedStyle,
        depth,
        maxNotes,
        turns,
        notesTarget,
        entryPoints: entryPoints.map(ep => ({
          id: ep.id,
          type: ep.type,
          title: ep.title,
        })),
      });

      if (result.error) {
        setError(result.error);
        setLoading(false);
      } else {
        // Add new worker to active list
        const newWorker = {
          id: result.session_id,
          status: 'running',
          config: { style: selectedStyle, depth, maxNotes, turns },
          entry_points: entryPoints,
          created_at: new Date().toISOString(),
        };
        if (setActiveWorkers) {
          setActiveWorkers(prev => [...prev, newWorker]);
        }
        setEntryPoints([]);
        setLoading(false);
      }
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  // Handle worker completion
  const handleWorkerComplete = useCallback((sessionId) => {
    // Remove from active workers
    if (setActiveWorkers) {
      setActiveWorkers(prev => prev.filter(w => w.id !== sessionId));
    }
    if (onRefreshGraph) onRefreshGraph();
  }, [onRefreshGraph, setActiveWorkers]);

  // Handle worker cancel
  const handleWorkerCancel = useCallback((sessionId) => {
    // Remove from active workers
    if (setActiveWorkers) {
      setActiveWorkers(prev => prev.filter(w => w.id !== sessionId));
    }
  }, [setActiveWorkers]);

  return (
    <div className={`kg-discover-panel ${fullScreen ? 'kg-discover-fullscreen' : ''}`}>
      <div className="kg-discover-header">
        <div className="kg-discover-title">
          <Sparkles size={18} />
          <span>Generate Insights</span>
        </div>
        <div className="kg-discover-header-actions">
          <button
            className="kg-icon-btn"
            onClick={() => setFullScreen(!fullScreen)}
            title={fullScreen ? 'Exit Full Screen' : 'Full Screen'}
          >
            {fullScreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
          </button>
          <button className="kg-icon-btn" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Scrollable body wrapper */}
      <div className="kg-discover-body">
        {/* Mode Toggle */}
        <div className="kg-discover-mode-toggle">
        <button
          className={`kg-discover-mode-btn ${mode === 'quick' ? 'active' : ''}`}
          onClick={() => setMode('quick')}
          disabled={activeWorkers.length > 0}
        >
          <Zap size={14} />
          <span>Quick Discover</span>
        </button>
        <button
          className={`kg-discover-mode-btn ${mode === 'sleep' ? 'active' : ''}`}
          onClick={() => setMode('sleep')}
        >
          <Moon size={14} />
          <span>Sleep Time Compute</span>
          {activeWorkers.length > 0 && (
            <span className="kg-discover-mode-badge">{activeWorkers.length}</span>
          )}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="kg-discover-error">
          {error}
        </div>
      )}

      {/* Status (during discovery) */}
      {loading && status && (
        <div className="kg-discover-status">
          <div className="kg-discover-status-phase">
            {status.phase === 'starting' && 'Starting discovery...'}
            {status.phase === 'searching' && 'Searching knowledge base...'}
            {status.phase === 'analyzing' && 'Analyzing connections...'}
            {status.phase === 'generating' && 'Generating bridge notes...'}
          </div>
          <div className="kg-discover-progress">
            <div
              className="kg-discover-progress-bar"
              style={{ width: `${status.progress || 10}%` }}
            />
          </div>
        </div>
      )}

      {/* Quick mode - Prompt input */}
      {mode === 'quick' && (
        <div className="kg-discover-input-section">
          <ChatInput
            value={prompt}
            onChange={setPrompt}
            onSubmit={handleRunDiscovery}
            placeholder="What connections would you like to explore?"
            disabled={loading}
            loading={loading}
            rows={2}
            minHeight="60px"
            maxHeight="120px"
            hint="Enter to send"
          />

          {/* Example prompts */}
          <div className="kg-discover-examples">
            {examplePrompts.map((example, idx) => (
              <button
                key={idx}
                className="kg-discover-example"
                onClick={() => setPrompt(example)}
                disabled={loading}
              >
                {example}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Sleep Time Compute mode */}
      {mode === 'sleep' && (
        <>
          {/* Active Workers List */}
          {activeWorkers.length > 0 && (
            <div className="kg-discover-workers-list">
              <div className="kg-discover-workers-header">
                <Users size={14} />
                <span>Active Workers ({activeWorkers.length}/{MAX_WORKERS})</span>
              </div>
              {activeWorkers.map((worker) => (
                <div key={worker.id} className="kg-discover-worker-status">
                  <SleepComputeStatus
                    sessionId={worker.id}
                    onComplete={(status) => handleWorkerComplete(worker.id, status)}
                    onCancel={() => handleWorkerCancel(worker.id)}
                  />
                </div>
              ))}
            </div>
          )}

          {/* New Worker Configuration (if under limit) */}
          {canStartWorker && (
            <div className="kg-discover-sleep-config">
              <div className="kg-discover-sleep-config-header">
                {activeWorkers.length > 0 ? 'Start Another Worker' : 'Start a Worker'}
              </div>

              <EntryPointSelector
                selectedEntryPoints={entryPoints}
                onEntryPointsChange={setEntryPoints}
                disabled={loading}
                minRequired={0}
              />

              <BrainstormStyleSelector
                selectedStyle={selectedStyle}
                onStyleSelect={setSelectedStyle}
                disabled={loading}
              />

              <BudgetControls
                depth={depth}
                maxNotes={maxNotes}
                turns={turns}
                notesTarget={notesTarget}
                onDepthChange={setDepth}
                onMaxNotesChange={setMaxNotes}
                onTurnsChange={setTurns}
                onNotesTargetChange={setNotesTarget}
                disabled={loading}
              />

              <button
                className="kg-btn kg-btn-primary kg-btn-sleep-start"
                onClick={handleRunSleepCompute}
                disabled={loading || !selectedStyle}
              >
                {loading ? (
                  <>
                    <Loader size={14} className="kg-spinner" />
                    Starting...
                  </>
                ) : (
                  <>
                    <Moon size={14} />
                    Start a Worker
                  </>
                )}
              </button>
            </div>
          )}

          {/* Max workers reached message */}
          {!canStartWorker && (
            <div className="kg-discover-max-workers">
              Maximum workers running. Wait for one to complete before starting another.
            </div>
          )}
        </>
      )}

      {/* Info text */}
      <div className="kg-discover-info">
        <p>Generated insights will appear in the Review panel for approval.</p>
      </div>
      </div>{/* End scrollable body wrapper */}
    </div>
  );
}
