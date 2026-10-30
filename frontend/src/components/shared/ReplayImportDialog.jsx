import { useEffect, useMemo, useState } from "react";
import { ROLE_LABELS } from "../../utils/format";
import { formatDuration } from "../../utils/roflReplay";
import {
  captainOptions,
  matchLabel,
  matchOptions,
  opponentOptions,
  suggestMatches,
} from "../../utils/replayMatching";

// Step 1 of importing a replay from the Match History tab: show who is in the
// replay, and let the editor say which match it belongs to by picking the two
// captains (the second list only offers captains the first has faced) and then
// the match (only meetings between them). The replay's own details are pulled
// into the match editor in the next step.

export default function ReplayImportDialog({ replay, rows, onCancel, onContinue }) {
  const [captain1, setCaptain1] = useState("");
  const [captain2, setCaptain2] = useState("");
  const [matchKey, setMatchKey] = useState("");

  const captains = useMemo(() => captainOptions(rows), [rows]);
  const opponents = useMemo(() => opponentOptions(rows, captain1), [rows, captain1]);
  const matches = useMemo(() => matchOptions(rows, captain1, captain2), [rows, captain1, captain2]);
  const suggestions = useMemo(() => suggestMatches(replay, rows), [replay, rows]);

  useEffect(() => {
    function onKey(event) {
      if (event.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  // Narrowing the captains can invalidate what was chosen further down; and a
  // pair of captains with exactly one meeting needs no third click.
  function settle(nextCaptain1, nextCaptain2, currentMatchKey) {
    const candidates = matchOptions(rows, nextCaptain1, nextCaptain2);
    setCaptain1(nextCaptain1);
    setCaptain2(nextCaptain2);
    if (nextCaptain1 && nextCaptain2 && candidates.length === 1) {
      setMatchKey(candidates[0].match_key);
    } else {
      setMatchKey(candidates.some((row) => row.match_key === currentMatchKey) ? currentMatchKey : "");
    }
  }

  function chooseCaptain1(value) {
    const stillFaced = !value || opponentOptions(rows, value).includes(captain2);
    settle(value, stillFaced ? captain2 : "", matchKey);
  }

  function chooseMatch(value) {
    setMatchKey(value);
    const row = rows.find((r) => r.match_key === value);
    if (row) {
      setCaptain1(row.team1);
      setCaptain2(row.team2);
    }
  }

  function applySuggestion(row) {
    setCaptain1(row.team1);
    setCaptain2(row.team2);
    setMatchKey(row.match_key);
  }

  const chosen = rows.find((row) => row.match_key === matchKey) || null;
  const teamLabel = (team) => (team === replay.teams[0] ? "Blue side (100)" : "Red side (200)");

  return (
    <div className="match-editor-overlay">
      <div className="match-editor-backdrop" onClick={onCancel} />
      <div className="match-editor replay-dialog" role="dialog" aria-modal="true" aria-label="Import replay">
        <div className="match-editor-header">
          <h2>Import replay</h2>
          <button type="button" className="match-editor-close" aria-label="Close" onClick={onCancel}>
            {"\u00d7"}
          </button>
        </div>
        <p className="match-editor-subtitle">
          {[replay.fileName, replay.patch && `patch ${replay.patch}`, formatDuration(replay.durationMs)]
            .filter(Boolean)
            .join(" \u00b7 ")}
        </p>

        <div className="replay-teams">
          {replay.teams.map((team) => (
            <fieldset key={team} className="match-editor-team">
              <legend>
                {teamLabel(team)}
                {replay.winnerTeam === team ? " \u2014 won" : ""}
              </legend>
              <table className="match-details-table match-editor-table">
                <thead>
                  <tr>
                    <th>Player</th>
                    <th>Role</th>
                    <th>Champion</th>
                    <th>K/D/A</th>
                  </tr>
                </thead>
                <tbody>
                  {replay.players
                    .filter((p) => p.team === team)
                    .map((p) => (
                      <tr key={p.index}>
                        <td className="match-editor-player">{p.riotId || <em>(name hidden)</em>}</td>
                        <td>{p.role ? ROLE_LABELS[p.role] : "\u2014"}</td>
                        <td>{p.champion}</td>
                        <td>
                          {p.kills ?? "\u2013"}/{p.deaths ?? "\u2013"}/{p.assists ?? "\u2013"}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </fieldset>
          ))}
        </div>
        {!replay.hasNames && (
          <p className="match-editor-notice" role="status">
            This replay doesn{"\u2019"}t include player names. Pick the match yourself; players are assigned to roster
            slots by hand in the next step.
          </p>
        )}

        <h3 className="replay-section-title">Which match is this?</h3>
        {suggestions.length > 0 && (
          <div className="replay-suggestions">
            <span>Rosters that fit this replay:</span>
            {suggestions.map(({ row, score }) => (
              <button
                key={row.match_key}
                type="button"
                className="columns-btn"
                onClick={() => applySuggestion(row)}
                title={`${score} of ${replay.players.length} players are on these rosters`}
              >
                {matchLabel(row)} ({score}/{replay.players.length})
              </button>
            ))}
          </div>
        )}
        <div className="replay-pickers">
          <label>
            Captain 1
            <select value={captain1} onChange={(e) => chooseCaptain1(e.target.value)}>
              <option value="">Any captain</option>
              {captains.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Captain 2
            <select value={captain2} onChange={(e) => settle(captain1, e.target.value, matchKey)}>
              <option value="">{captain1 ? "Any opponent" : "Any captain"}</option>
              {opponents.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label className="replay-picker-match">
            Match
            <select value={matchKey} onChange={(e) => chooseMatch(e.target.value)}>
              <option value="">
                {matches.length ? `Choose a match (${matches.length})` : "No matches for this pairing"}
              </option>
              {matches.map((row) => (
                <option key={row.match_key} value={row.match_key}>
                  {matchLabel(row)}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="match-editor-actions">
          <button type="button" className="columns-btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="download-btn" disabled={!chosen} onClick={() => onContinue(chosen)}>
            Continue to match editor
          </button>
        </div>
      </div>
    </div>
  );
}
