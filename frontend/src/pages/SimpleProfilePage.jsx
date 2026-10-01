import { useNavigate, useParams } from "react-router-dom";
import { routeState } from "../utils/routeState";

export default function SimpleProfilePage() {
  const { slug } = useParams();
  const navigate = useNavigate();

  const idx = slug.lastIndexOf("-");
  const gameName = idx === -1 ? slug : slug.slice(0, idx);
  const tagLine = idx === -1 ? null : slug.slice(idx + 1);
  const displayName = tagLine ? `${gameName}#${tagLine}` : gameName;
  const link = gameName && tagLine ? `https://op.gg/lol/summoners/na/${encodeURIComponent(gameName)}-${encodeURIComponent(tagLine)}` : null;

  function goBack() {
    const cameFromThisSite = document.referrer && document.referrer.startsWith(window.location.origin);
    if (cameFromThisSite && window.history.length > 1) navigate(-1);
    else navigate(`/?tab=${routeState.lastKnownTab}`);
  }

  return (
    <div className="wrap">
      <div className="player-profile-header">
        <button className="player-profile-back" onClick={goBack}>
          {"\u2190"} Back
        </button>
      </div>
      <h2 className="player-profile-title">{displayName}</h2>
      <div className="profile-summary">
        {link ? (
          <a href={link} target="_blank" rel="noopener noreferrer">
            Open op.gg
          </a>
        ) : (
          <span className="stat-formula">No # tag to build an op.gg link from.</span>
        )}
      </div>
      <p className="stat-formula" style={{ marginTop: 12 }}>
        No TrueSkill history for this name yet.
      </p>
    </div>
  );
}
