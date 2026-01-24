import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import './KGActionMenu.css';

/**
 * KGActionMenu - Reusable dropdown menu component for Knowledge Graph actions
 *
 * Props:
 * - icon: React node for the trigger button icon
 * - label: Label text for the trigger button
 * - sections: Array of section objects with:
 *   - title: Optional section header text
 *   - items: Array of menu items with:
 *     - icon: React node
 *     - label: Display text
 *     - badge: Optional count badge
 *     - onClick: Click handler
 *     - disabled: Optional boolean
 *     - loading: Optional boolean (shows spinner)
 * - disabled: Disable the entire menu
 */
export default function KGActionMenu({
  icon,
  label,
  sections = [],
  disabled = false,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef(null);

  // Close menu on click outside
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // Close menu on Escape
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  const handleItemClick = (item) => {
    if (item.disabled || item.loading) return;
    if (item.onClick) {
      item.onClick();
    }
    setIsOpen(false);
  };

  return (
    <div className="kg-action-menu" ref={menuRef}>
      <button
        className={`kg-action-menu-trigger ${isOpen ? 'active' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
        disabled={disabled}
      >
        {icon}
        <span>{label}</span>
        <ChevronDown size={14} className={`kg-action-menu-chevron ${isOpen ? 'rotated' : ''}`} />
      </button>

      {isOpen && (
        <div className="kg-action-menu-dropdown">
          {sections.map((section, sectionIdx) => (
            <div key={sectionIdx} className="kg-action-menu-section">
              {section.title && (
                <div className="kg-action-menu-section-title">{section.title}</div>
              )}
              {section.items.map((item, itemIdx) => (
                <button
                  key={itemIdx}
                  className={`kg-action-menu-item ${item.disabled ? 'disabled' : ''}`}
                  onClick={() => handleItemClick(item)}
                  disabled={item.disabled || item.loading}
                >
                  <span className="kg-action-menu-item-icon">
                    {item.loading ? (
                      <span className="kg-action-menu-spinner" />
                    ) : (
                      item.icon
                    )}
                  </span>
                  <span className="kg-action-menu-item-label">{item.label}</span>
                  {item.badge !== undefined && item.badge !== null && item.badge > 0 && (
                    <span className="kg-action-menu-item-badge">{item.badge}</span>
                  )}
                </button>
              ))}
              {sectionIdx < sections.length - 1 && (
                <div className="kg-action-menu-divider" />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
