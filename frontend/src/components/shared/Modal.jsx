export default function Modal({ open, onClose, title, children }) {
  if (!open) return null;
  return (
    <div className="player-profile-modal open">
      <div className="player-profile-backdrop" onClick={onClose} />
      <div className="player-profile-panel">
        <button className="player-profile-close" onClick={onClose}>
          {"\u00d7"}
        </button>
        <h2>{title}</h2>
        <div>{children}</div>
      </div>
    </div>
  );
}
