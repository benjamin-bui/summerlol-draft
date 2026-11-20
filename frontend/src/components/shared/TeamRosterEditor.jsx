import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ApiError, editorApi } from "../../api/client";
import { useAuth } from "../../context/AuthContext";

const MAX_ROSTER_SIZE = 20;

export default function TeamRosterEditor({
  year,
  tournament,
  team,
  players = [],
  csrfToken,
  onClose,
  onSaved,
}) {
  const { refresh } = useAuth();
  const listId = `team-roster-players-${useId()}`;
  const dialogRef = useRef(null);
  const [roster, setRoster] = useState([]);
  const [initialRoster, setInitialRoster] = useState(null);
  const [baseRev, setBaseRev] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const dirty = initialRoster !== null && JSON.stringify(roster) !== JSON.stringify(initialRoster);

  useEffect(() => {
    let cancelled = false;
    editorApi.getTeamRoster(year, tournament, team.captainKey, team.captainName)
      .then((state) => {
        if (cancelled) return;
        const names = state.players.map((player) => player.name);
        setRoster(names);
        setInitialRoster(names);
        setBaseRev(state.baseRev);
      })
      .catch((requestError) => {
        if (!cancelled) {
          if (requestError instanceof ApiError && (requestError.status === 401 || requestError.status === 403)) {
            refresh();
            setError("Your editing session has ended or this account can't edit. Sign in again to continue.");
          } else {
            setError(requestError instanceof Error ? requestError.message : "Could not load this team's roster.");
          }
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [year, tournament, team.captainKey, team.captainName, refresh]);

  const requestClose = useCallback(() => {
    if (saving) return;
    if (dirty && !window.confirm("Discard your unsaved roster changes?")) return;
    onClose();
  }, [dirty, onClose, saving]);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(event) {
      if (event.key === "Escape") requestClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [requestClose]);

  const knownNames = [...new Set(
    players.flatMap((player) => [player.group, ...(player.pastNames || [])])
      .filter((name) => typeof name === "string" && name.trim())
      .map((name) => name.trim()),
  )].sort((a, b) => a.localeCompare(b));

  function updatePlayer(index, value) {
    setRoster((current) => current.map((name, i) => (i === index ? value : name)));
  }

  async function save(event) {
    event.preventDefault();
    const names = roster.map((name) => name.trim());
    if (names.some((name) => !name)) {
      setError("Fill in or remove every blank roster entry before saving.");
      return;
    }
    if (!names.length) {
      setError("A team must have at least one draft player.");
      return;
    }
    setSaving(true);
    setError(null);
    let saved = false;
    try {
      await editorApi.saveTeamRoster(
        year,
        tournament,
        { captainKey: team.captainKey, captainName: team.captainName, baseRev, players: names },
        csrfToken,
      );
      saved = true;
    } catch (requestError) {
      if (requestError instanceof ApiError && (requestError.status === 401 || requestError.status === 403)) {
        refresh();
        setError("Your editing session has ended or this account can't edit. Sign in again to continue.");
      } else {
        setError(requestError instanceof Error ? requestError.message : "Could not save this team's roster.");
      }
    } finally {
      setSaving(false);
    }
    if (saved) {
      onClose();
      onSaved();
    }
  }

  return (
    <div className="match-editor-overlay">
      <div className="match-editor-backdrop" onClick={requestClose} />
      <div
        className="match-editor team-roster-editor"
        role="dialog"
        aria-modal="true"
        aria-label={`Edit roster for ${team.captainName}`}
        tabIndex={-1}
        ref={dialogRef}
      >
        <div className="match-editor-header">
          <h2>Edit team roster</h2>
          <button type="button" className="match-editor-close" aria-label="Close" disabled={saving} onClick={requestClose}>
            {"\u00d7"}
          </button>
        </div>
        <p className="match-editor-subtitle">
          {tournament} {year} {"\u00b7"} Captain: {team.captainName}
        </p>
        <p className="match-editor-notice">
          Edit drafted players and pick order. The captain and recorded match lineups are not changed.
          Choose a known player or type a new name.
        </p>
        {error && <p className="match-editor-error" role="alert">{error}</p>}
        {loading ? (
          <p>Loading roster{"\u2026"}</p>
        ) : initialRoster === null ? (
          <p className="stat-formula">The roster could not be loaded. Close this dialog and try again.</p>
        ) : (
          <form onSubmit={save}>
            <datalist id={listId}>
              {knownNames.map((name) => <option key={name} value={name} />)}
            </datalist>
            <div className="team-roster-edit-list">
              {roster.map((name, index) => (
                <label className="team-roster-edit-row" key={index}>
                  <span>Pick {index + 1}</span>
                  <input
                    type="text"
                    list={listId}
                    autoComplete="off"
                    aria-label={`Pick ${index + 1}`}
                    value={name}
                    onChange={(event) => updatePlayer(index, event.target.value)}
                  />
                  <button
                    type="button"
                    className="columns-btn"
                    aria-label={`Remove pick ${index + 1}`}
                    disabled={saving}
                    onClick={() => setRoster((current) => current.filter((_, i) => i !== index))}
                  >
                    Remove
                  </button>
                </label>
              ))}
            </div>
            <button
              type="button"
              className="columns-btn"
              disabled={saving || roster.length >= MAX_ROSTER_SIZE}
              onClick={() => setRoster((current) => [...current, ""])}
            >
              Add player
            </button>
            <div className="match-editor-actions">
              <button type="button" className="columns-btn" disabled={saving} onClick={requestClose}>Cancel</button>
              <button type="submit" className="columns-btn" disabled={saving || !dirty || roster.length > MAX_ROSTER_SIZE}>
                {saving ? "Saving\u2026" : "Save roster"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
