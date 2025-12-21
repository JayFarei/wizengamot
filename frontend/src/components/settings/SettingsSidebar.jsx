import './SettingsSidebar.css';

const SECTIONS = [
  {
    id: 'general',
    label: 'General',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="3" />
        <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
      </svg>
    ),
  },
  {
    id: 'usage',
    label: 'Usage',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M3 3v18h18" />
        <path d="M7 16l4-4 4 4 5-6" />
      </svg>
    ),
  },
  { id: 'divider' },
  {
    id: 'council',
    label: 'Council',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="7" r="4" />
        <path d="M5.5 21a6.5 6.5 0 0 1 13 0" />
        <circle cx="4" cy="9" r="2.5" />
        <path d="M1 19a4 4 0 0 1 6 0" />
        <circle cx="20" cy="9" r="2.5" />
        <path d="M17 19a4 4 0 0 1 6 0" />
      </svg>
    ),
  },
  {
    id: 'synthesizer',
    label: 'Synthesizer',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="3" width="7" height="9" rx="1" />
        <rect x="14" y="3" width="7" height="9" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
        <line x1="6.5" y1="6" x2="8" y2="6" />
        <line x1="6.5" y1="8" x2="8" y2="8" />
        <line x1="17.5" y1="6" x2="19" y2="6" />
        <line x1="17.5" y1="8" x2="19" y2="8" />
      </svg>
    ),
  },
  {
    id: 'monitor',
    label: 'Monitor',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10" />
        <circle cx="12" cy="12" r="6" />
        <circle cx="12" cy="12" r="2" />
        <line x1="12" y1="2" x2="12" y2="4" />
        <line x1="12" y1="20" x2="12" y2="22" />
        <line x1="2" y1="12" x2="4" y2="12" />
        <line x1="20" y1="12" x2="22" y2="12" />
      </svg>
    ),
  },
  {
    id: 'visualiser',
    label: 'Visualiser',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <line x1="9" y1="3" x2="9" y2="21" />
        <line x1="3" y1="9" x2="21" y2="9" />
        <line x1="3" y1="15" x2="21" y2="15" />
        <line x1="15" y1="3" x2="15" y2="21" />
      </svg>
    ),
  },
  {
    id: 'podcast',
    label: 'Podcast',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
        <line x1="12" y1="19" x2="12" y2="23" />
        <line x1="8" y1="23" x2="16" y2="23" />
      </svg>
    ),
  },
];

export default function SettingsSidebar({ activeSection, onSectionChange }) {
  return (
    <nav className="settings-sidebar">
      {SECTIONS.map((section) =>
        section.id === 'divider' ? (
          <div key="divider" className="settings-sidebar-divider" />
        ) : (
          <button
            key={section.id}
            className={`settings-sidebar-item ${activeSection === section.id ? 'active' : ''}`}
            onClick={() => onSectionChange(section.id)}
          >
            <span className="settings-sidebar-icon">{section.icon}</span>
            <span className="settings-sidebar-label">{section.label}</span>
          </button>
        )
      )}
    </nav>
  );
}
