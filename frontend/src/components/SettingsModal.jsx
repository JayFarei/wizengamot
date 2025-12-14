import { useState, useEffect } from 'react';
import { api } from '../api';
import SettingsSidebar from './settings/SettingsSidebar';
import GeneralSection from './settings/sections/GeneralSection';
import UsageSection from './settings/sections/UsageSection';
import CouncilSection from './settings/sections/CouncilSection';
import SynthesizerSection from './settings/sections/SynthesizerSection';
import MonitorSection from './settings/sections/MonitorSection';
import VisualiserSection from './settings/sections/VisualiserSection';
import './SettingsModal.css';

// Map old tab names to new section names for backwards compatibility
const TAB_TO_SECTION = {
  api: 'general',
  models: 'council',
  prompts: 'council',
  synthesizer: 'synthesizer',
  questionsets: 'monitor',
  visualiser: 'visualiser',
  // New section names map to themselves
  general: 'general',
  usage: 'usage',
  council: 'council',
  monitor: 'monitor',
};

export default function SettingsModal({ isOpen, onClose, defaultTab = 'general' }) {
  const [activeSection, setActiveSection] = useState(TAB_TO_SECTION[defaultTab] || 'general');
  const [settings, setSettings] = useState(null);
  const [modelSettings, setModelSettings] = useState(null);
  const [prompts, setPrompts] = useState([]);
  const [synthesizerSettings, setSynthesizerSettings] = useState(null);
  const [visualiserSettings, setVisualiserSettings] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    if (isOpen) {
      setActiveSection(TAB_TO_SECTION[defaultTab] || 'general');
      loadAllSettings();
      setError('');
      setSuccess('');
    }
  }, [isOpen, defaultTab]);

  const loadAllSettings = async () => {
    try {
      const [settingsData, modelData, councilPrompts, synthPrompts, synthData, visData] = await Promise.all([
        api.getSettings(),
        api.getModelSettings(),
        api.listPrompts('council'),
        api.listPrompts('synthesizer'),
        api.getSynthesizerSettings(),
        api.getVisualiserSettings(),
      ]);
      setSettings(settingsData);
      setModelSettings(modelData);
      // Combine prompts with their modes properly indicated
      setPrompts([...councilPrompts, ...synthPrompts]);
      setSynthesizerSettings(synthData);
      setVisualiserSettings(visData);
    } catch (err) {
      console.error('Failed to load settings:', err);
    }
  };

  if (!isOpen) return null;

  const renderSection = () => {
    switch (activeSection) {
      case 'general':
        return (
          <GeneralSection
            settings={settings}
            modelSettings={modelSettings}
            loading={loading}
            setLoading={setLoading}
            setError={setError}
            setSuccess={setSuccess}
            onReload={loadAllSettings}
          />
        );
      case 'usage':
        return <UsageSection />;
      case 'council':
        return (
          <CouncilSection
            modelSettings={modelSettings}
            prompts={prompts}
            loading={loading}
            setLoading={setLoading}
            setError={setError}
            setSuccess={setSuccess}
            onReload={loadAllSettings}
          />
        );
      case 'synthesizer':
        return (
          <SynthesizerSection
            modelSettings={modelSettings}
            synthesizerSettings={synthesizerSettings}
            prompts={prompts}
            loading={loading}
            setLoading={setLoading}
            setError={setError}
            setSuccess={setSuccess}
            onReload={loadAllSettings}
          />
        );
      case 'monitor':
        return <MonitorSection />;
      case 'visualiser':
        return (
          <VisualiserSection
            visualiserSettings={visualiserSettings}
            loading={loading}
            setLoading={setLoading}
            setError={setError}
            setSuccess={setSuccess}
            onReload={loadAllSettings}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content settings-modal-sidebar" onClick={(e) => e.stopPropagation()}>
        <div className="settings-modal-header">
          <h2>Settings</h2>
          <button className="settings-close-btn" onClick={onClose}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="settings-modal-body">
          <SettingsSidebar activeSection={activeSection} onSectionChange={setActiveSection} />

          <div className="settings-content">
            {renderSection()}

            {error && <div className="settings-error">{error}</div>}
            {success && <div className="settings-success">{success}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
