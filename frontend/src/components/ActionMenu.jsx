import React, { useState, useRef, useEffect } from 'react';
import './ActionMenu.css';

/**
 * ActionMenu - A reusable 3-dot menu component for secondary actions
 *
 * Usage:
 * <ActionMenu>
 *   <ActionMenu.Item icon={<SvgIcon />} label="Action" onClick={handler} />
 *   <ActionMenu.Item icon={<SvgIcon />} label="With Badge" onClick={handler} badge={3} />
 *   <ActionMenu.Divider />
 *   <ActionMenu.Item icon={<SvgIcon />} label="Another" onClick={handler} disabled />
 *   <ActionMenu.Submenu icon={<SvgIcon />} label="Nested Menu" badge={2}>
 *     <ActionMenu.Item label="Nested Item" onClick={handler} />
 *   </ActionMenu.Submenu>
 * </ActionMenu>
 */

export default function ActionMenu({ children, className = '' }) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeSubmenu, setActiveSubmenu] = useState(null);
  const menuRef = useRef(null);

  // Reset submenu when menu closes
  useEffect(() => {
    if (!isOpen) {
      setActiveSubmenu(null);
    }
  }, [isOpen]);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (activeSubmenu) {
          setActiveSubmenu(null);
        } else {
          setIsOpen(false);
        }
      }
    };
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen, activeSubmenu]);

  // Find active submenu content
  const activeSubmenuData = activeSubmenu ? React.Children.toArray(children).find(
    child => child?.type === ActionMenuSubmenu && child.props.id === activeSubmenu
  ) : null;

  return (
    <div className={`action-menu ${className}`} ref={menuRef}>
      <button
        className={`action-menu-trigger ${isOpen ? 'active' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
        title="More actions"
      >
        <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
          <circle cx="12" cy="5" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="12" cy="19" r="2" />
        </svg>
      </button>
      {isOpen && (
        <div className="action-menu-dropdown">
          {activeSubmenu && activeSubmenuData ? (
            // Submenu view
            <div className="action-menu-submenu-view">
              <button
                className="action-menu-submenu-back"
                onClick={() => setActiveSubmenu(null)}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
                <span>{activeSubmenuData.props.label}</span>
              </button>
              <div className="action-menu-divider" />
              {React.Children.map(activeSubmenuData.props.children, child => {
                if (!child) return null;
                if (child.type === ActionMenuItem) {
                  return React.cloneElement(child, {
                    onCloseMenu: () => setIsOpen(false)
                  });
                }
                return child;
              })}
            </div>
          ) : (
            // Main menu view
            React.Children.map(children, child => {
              if (!child) return null;
              if (child.type === ActionMenuItem) {
                return React.cloneElement(child, {
                  onCloseMenu: () => setIsOpen(false)
                });
              }
              if (child.type === ActionMenuSubmenu) {
                return React.cloneElement(child, {
                  onOpenSubmenu: () => setActiveSubmenu(child.props.id)
                });
              }
              return child;
            })
          )}
        </div>
      )}
    </div>
  );
}

function ActionMenuItem({ icon, label, onClick, badge, disabled, onCloseMenu }) {
  const handleClick = () => {
    if (disabled) return;
    onClick?.();
    onCloseMenu?.();
  };

  return (
    <button
      className={`action-menu-item ${disabled ? 'disabled' : ''}`}
      onClick={handleClick}
      disabled={disabled}
    >
      {icon && <span className="action-menu-item-icon">{icon}</span>}
      <span className="action-menu-item-label">{label}</span>
      {badge !== undefined && badge > 0 && (
        <span className="action-menu-item-badge">{badge}</span>
      )}
    </button>
  );
}

function ActionMenuDivider() {
  return <div className="action-menu-divider" />;
}

function ActionMenuSubmenu({ id, icon, label, badge, children, onOpenSubmenu }) {
  const handleClick = () => {
    onOpenSubmenu?.();
  };

  return (
    <button className="action-menu-item action-menu-submenu-trigger" onClick={handleClick}>
      {icon && <span className="action-menu-item-icon">{icon}</span>}
      <span className="action-menu-item-label">{label}</span>
      {badge !== undefined && badge > 0 && (
        <span className="action-menu-item-badge">{badge}</span>
      )}
      <span className="action-menu-item-arrow">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </span>
    </button>
  );
}

// Attach sub-components
ActionMenu.Item = ActionMenuItem;
ActionMenu.Divider = ActionMenuDivider;
ActionMenu.Submenu = ActionMenuSubmenu;
