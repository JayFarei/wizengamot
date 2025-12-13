import './CouncilDiscussionView.css';

export default function StageTabs({
  activeStage,
  onStageChange,
  stage1ModelCount = 0,
  hasStage2 = true,
  hasStage3 = true,
  loadingStage1 = false,
  loadingStage2 = false,
  loadingStage3 = false,
}) {
  return (
    <div className="stage-tabs">
      <button
        className={`stage-tab ${activeStage === 1 ? 'active' : ''}`}
        onClick={() => onStageChange(1)}
      >
        Stage 1: Responses {stage1ModelCount > 0 && `(${stage1ModelCount})`}
        {loadingStage1 && <span className="tab-spinner"></span>}
      </button>
      <button
        className={`stage-tab ${activeStage === 2 ? 'active' : ''} ${!hasStage2 && !loadingStage2 ? 'disabled' : ''}`}
        onClick={() => (hasStage2 || loadingStage2) && onStageChange(2)}
        disabled={!hasStage2 && !loadingStage2}
      >
        Stage 2: Rankings
        {loadingStage2 && <span className="tab-spinner"></span>}
      </button>
      <button
        className={`stage-tab ${activeStage === 3 ? 'active' : ''} ${!hasStage3 && !loadingStage3 ? 'disabled' : ''}`}
        onClick={() => (hasStage3 || loadingStage3) && onStageChange(3)}
        disabled={!hasStage3 && !loadingStage3}
      >
        Stage 3: Synthesis
        {loadingStage3 && <span className="tab-spinner"></span>}
      </button>
    </div>
  );
}
