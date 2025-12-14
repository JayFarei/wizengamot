import QuestionSetManager from '../../QuestionSetManager';
import './MonitorSection.css';

export default function MonitorSection() {
  return (
    <div className="settings-section monitor-section">
      <div className="modal-section">
        <h3>Question Sets</h3>
        <p className="section-description">
          Manage reusable question sets for monitor analysis. Question sets define what information
          to extract from monitored URLs.
        </p>
        <QuestionSetManager />
      </div>
    </div>
  );
}
