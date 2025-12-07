import { useState } from 'react';
import { api } from '../api';
import './AddCompetitorModal.css';

const TIER_INFO = {
  minimum: {
    label: 'Minimum',
    description: 'Essential pages only (3-5 pages)',
    icon: '1'
  },
  suggested: {
    label: 'Suggested',
    description: 'Core analyst watchlist (8-15 pages)',
    icon: '2'
  },
  generous: {
    label: 'Generous',
    description: 'Comprehensive coverage (20-30 pages)',
    icon: '3'
  },
  all: {
    label: 'All Pages',
    description: 'Track everything discovered',
    icon: '4'
  }
};

export default function AddCompetitorModal({ isOpen, onClose, monitorId, onCompetitorAdded }) {
  const [step, setStep] = useState(1);
  const [competitorName, setCompetitorName] = useState('');
  const [domainUrl, setDomainUrl] = useState('');
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [discoveryResult, setDiscoveryResult] = useState(null);
  const [selectedTier, setSelectedTier] = useState('suggested');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const handleDiscover = async () => {
    setError(null);

    if (!competitorName.trim()) {
      setError('Competitor name is required');
      return;
    }

    if (!domainUrl.trim()) {
      setError('Website URL is required');
      return;
    }

    // Validate URL
    try {
      new URL(domainUrl);
    } catch {
      setError('Please enter a valid URL (e.g., https://example.com)');
      return;
    }

    setIsDiscovering(true);
    setStep(2);

    try {
      const result = await api.discoverCompetitorPages(monitorId, domainUrl, competitorName);
      setDiscoveryResult(result);
      setStep(3);
    } catch (err) {
      setError(err.message || 'Failed to discover pages');
      setStep(1);
    } finally {
      setIsDiscovering(false);
    }
  };

  const handleAddCompetitor = async () => {
    if (!discoveryResult) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const tierPages = discoveryResult.tiers[selectedTier] || [];

      await api.addCompetitor(monitorId, {
        name: competitorName,
        domain: domainUrl,
        pages: tierPages,
        site_map_baseline: discoveryResult.site_map,
        tier: selectedTier
      });

      if (onCompetitorAdded) {
        onCompetitorAdded();
      }
      handleClose();
    } catch (err) {
      setError(err.message || 'Failed to add competitor');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setStep(1);
    setCompetitorName('');
    setDomainUrl('');
    setDiscoveryResult(null);
    setSelectedTier('suggested');
    setError(null);
    onClose();
  };

  const handleBack = () => {
    if (step === 3) {
      setStep(1);
      setDiscoveryResult(null);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal-content add-competitor-modal" onClick={(e) => e.stopPropagation()}>
        {/* Step 1: Enter Details */}
        {step === 1 && (
          <>
            <h2>Add Competitor</h2>
            <p className="modal-subtitle">
              Enter a competitor's website and we'll automatically discover and analyze their pages
            </p>

            {error && (
              <div className="modal-error">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="15" y1="9" x2="9" y2="15" />
                  <line x1="9" y1="9" x2="15" y2="15" />
                </svg>
                {error}
              </div>
            )}

            <div className="modal-section">
              <label className="input-label">Competitor Name</label>
              <input
                type="text"
                className="text-input"
                placeholder="e.g., Acme Corp"
                value={competitorName}
                onChange={(e) => setCompetitorName(e.target.value)}
                autoFocus
              />
            </div>

            <div className="modal-section">
              <label className="input-label">Website URL</label>
              <input
                type="text"
                className="text-input"
                placeholder="https://acme.com"
                value={domainUrl}
                onChange={(e) => setDomainUrl(e.target.value)}
              />
              <p className="input-hint">
                We'll map the entire site to find pages worth tracking
              </p>
            </div>

            <div className="modal-actions">
              <button className="btn-secondary" onClick={handleClose}>
                Cancel
              </button>
              <button className="btn-primary btn-orange" onClick={handleDiscover}>
                Discover Pages
              </button>
            </div>
          </>
        )}

        {/* Step 2: Discovering */}
        {step === 2 && (
          <div className="discovery-loading">
            <div className="loading-spinner" />
            <h3>Mapping {competitorName}'s website...</h3>
            <p className="loading-status">
              {isDiscovering ? 'Discovering pages and analyzing content...' : 'Processing...'}
            </p>
            <div className="loading-steps">
              <div className="loading-step active">Mapping site structure</div>
              <div className="loading-step">Analyzing pages with AI</div>
              <div className="loading-step">Categorizing by importance</div>
            </div>
          </div>
        )}

        {/* Step 3: Select Tier */}
        {step === 3 && discoveryResult && (
          <>
            <h2>Select Tracking Level</h2>
            <p className="modal-subtitle">
              Found <strong>{discoveryResult.total_pages_found}</strong> pages on {competitorName}'s site.
              Choose how many to track:
            </p>

            {error && (
              <div className="modal-error">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="15" y1="9" x2="9" y2="15" />
                  <line x1="9" y1="9" x2="15" y2="15" />
                </svg>
                {error}
              </div>
            )}

            <div className="tier-grid">
              {Object.entries(TIER_INFO).map(([tier, info]) => {
                const tierPages = discoveryResult.tiers[tier] || [];
                const pageCount = tierPages.length;
                const isSelected = selectedTier === tier;

                return (
                  <div
                    key={tier}
                    className={`tier-card ${isSelected ? 'selected' : ''}`}
                    onClick={() => setSelectedTier(tier)}
                  >
                    <div className="tier-header">
                      <span className="tier-icon">{info.icon}</span>
                      <span className="tier-label">{info.label}</span>
                      {tier === 'suggested' && <span className="tier-badge">Recommended</span>}
                    </div>
                    <div className="tier-count">{pageCount} pages</div>
                    <div className="tier-description">{info.description}</div>
                    {tierPages.length > 0 && (
                      <div className="tier-preview">
                        {tierPages.slice(0, 3).map((page, i) => (
                          <div key={i} className="preview-page">
                            <span className="preview-type">{page.type}</span>
                            <span className="preview-url" title={page.url}>
                              {new URL(page.url).pathname || '/'}
                            </span>
                          </div>
                        ))}
                        {tierPages.length > 3 && (
                          <div className="preview-more">+{tierPages.length - 3} more</div>
                        )}
                      </div>
                    )}
                    {isSelected && (
                      <div className="tier-checkmark">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {discoveryResult.tiers.reasoning && (
              <div className="ai-reasoning">
                <strong>AI Analysis:</strong> {discoveryResult.tiers.reasoning}
              </div>
            )}

            <div className="modal-actions">
              <button className="btn-secondary" onClick={handleBack}>
                Back
              </button>
              <button
                className="btn-primary btn-orange"
                onClick={handleAddCompetitor}
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Adding...' : `Add ${competitorName}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
