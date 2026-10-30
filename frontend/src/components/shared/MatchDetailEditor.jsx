import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ApiError, editorApi } from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import { ROLE_LABELS } from "../../utils/format";
import { applyReplayToForm, planReplayImport, slotKey } from "../../utils/replayMatching";
import { ReplayError, formatDuration, readReplayFile } from "../../utils/roflReplay";

// A form for one match's per-player details (champion, K/D/A, role) and each
// team's bans. Only ever opened for signed-in editors; the server independently
// refuses anyone else, so this component trusts nothing about its own gating.

const blankIfNull = (value) => (value === null || value === undefined ? "" : String(value));

function toForm(state) {
  const pad = (bans) => {
    const names = bans.map((ban) => ban.champion);
    while (names.length < state.maxBans) names.push("");
    return names;
  };
  return {
    teams: state.teams.map((team) => ({
      side: team.side,
      name: team.name,
      players: team.players.map((p) => ({
        player: p.player,
        displayName: p.displayName,
        isCaptain: p.isCaptain,
        champion: blankIfNull(p.champion),
        kills: blankIfNull(p.kills),
        deaths: blankIfNull(p.deaths),
        assists: blankIfNull(p.assists),
        role: blankIfNull(p.role),
      })),
    })),
    bans: { team1: pad(state.bans.team1), team2: pad(state.bans.team2) },
  };
}

const orNull = (text) => (text.trim() === "" ? null : text.trim());
const numberOrNull = (text) => (String(text).trim() === "" ? null : Number(text));

function toPayload(form, rev) {
  return {
    baseRev: rev,
    players: form.teams.flatMap((team) =>
      team.players.map((p) => ({
        player: p.player,
        champion: orNull(p.champion),
        kills: numberOrNull(p.kills),
        deaths: numberOrNull(p.deaths),
        assists: numberOrNull(p.assists),
        role: orNull(p.role),
      })),
    ),
    bans: {
      team1: form.bans.team1.map(orNull).filter(Boolean),
      team2: form.bans.team2.map(orNull).filter(Boolean),
    },
  };
}

// Server problems name fields like "players[3].kills"; say whose row that is.
function describeProblems(problems, form) {
  const flat = form.teams.flatMap((team) => team.players);
  return problems.map((problem) => {
    const match = /^players\[(\d+)\]/.exec(problem.field || "");
    const who = match ? flat[Number(match[1])]?.displayName : null;
    return who ? `${who}: ${problem.message}` : problem.message;
  });
}

// Shows how a replay was lined up with this match and lets the editor correct
// it: which replay team is which side, and which roster slot each replay
// player fills. Every change here just re-fills the form below; nothing is
// saved until "Save changes".
function ReplayPanel({ info, state, onSwap, onAssign }) {
  const { replay, plan } = info;
  const teamNames = (replayTeam) => state.teams[plan.sideOf(replayTeam)].name;
  return (
    <section className="replay-panel" aria-label="Replay import">
      <div className="replay-panel-header">
        <strong>Imported from replay</strong>
        <span>
          {[replay.fileName, replay.patch && `patch ${replay.patch}`, formatDuration(replay.durationMs)]
            .filter(Boolean)
            .join(" \u00b7 ")}
        </span>
        <button type="button" className="columns-btn" onClick={onSwap}>
          Swap teams
        </button>
      </div>
      {plan.warnings.map((warning, i) => (
        <p key={i} className={warning.level === "alert" ? "match-editor-error" : "match-editor-notice"} role={warning.level === "alert" ? "alert" : "status"}>
          {warning.text}
        </p>
      ))}
      <div className="replay-teams">
        {replay.teams.map((team) => {
          const side = plan.sideOf(team);
          return (
            <div key={team} className="replay-panel-team">
              <div className="replay-panel-team-name">
                {teamNames(team)}
                {replay.winnerTeam === team ? " \u2014 won in replay" : ""}
              </div>
              <table className="match-details-table match-editor-table">
                <tbody>
                  {replay.players
                    .filter((p) => p.team === team)
                    .map((p) => (
                      <tr key={p.index}>
                        <td className="match-editor-player">{p.riotId || <em>(name hidden)</em>}</td>
                        <td>{p.champion}</td>
                        <td>
                          {p.kills ?? "\u2013"}/{p.deaths ?? "\u2013"}/{p.assists ?? "\u2013"}
                        </td>
                        <td>
                          <select
                            aria-label={`Roster slot for ${p.riotId || `${p.champion} (${team})`}`}
                            value={plan.assign[p.index] ?? ""}
                            onChange={(e) => onAssign(p.index, e.target.value || null)}
                          >
                            <option value="">{"\u2014 not imported \u2014"}</option>
                            {state.teams[side].players.map((slot, playerIndex) => (
                              <option key={slot.player} value={slotKey(side, playerIndex)}>
                                {slot.displayName}
                              </option>
                            ))}
                          </select>
                          {plan.guessed.includes(p.index) && <span className="replay-guess"> check</span>}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
      <p className="replay-panel-note">Changing the teams or an assignment redoes the import. Bans aren{"\u2019"}t in replays; enter them below.</p>
    </section>
  );
}

export default function MatchDetailEditor({ matchKey, title, replay: initialReplay = null, onClose, onSaved }) {
  const { csrfToken, refresh } = useAuth();
  const listId = useId();
  const dialogRef = useRef(null);
  const [state, setState] = useState(null);
  const [form, setForm] = useState(null);
  const [initial, setInitial] = useState("");
  const [saving, setSaving] = useState(false);
  const [problems, setProblems] = useState([]);
  const [notice, setNotice] = useState(null);
  const [fatal, setFatal] = useState(null);
  const [replayInfo, setReplayInfo] = useState(null);
  const [replayError, setReplayError] = useState(null);
  const fileInput = useRef(null);

  const adopt = useCallback((next) => {
    const nextForm = toForm(next);
    setState(next);
    setForm(nextForm);
    setInitial(JSON.stringify(nextForm));
  }, []);

  // Lines a replay up with the match and fills the form from it. `baseForm` is
  // what the form looked like before any replay, so re-doing the import (new
  // assignment, swapped teams) always starts from that.
  const beginReplay = useCallback((replay, loaded, baseForm, options) => {
    const plan = planReplayImport(replay, loaded, options);
    setReplayInfo({ replay, plan, base: baseForm });
    setForm(applyReplayToForm(baseForm, replay, plan.assign, loaded.championSuggestions));
  }, []);

  const explain = useCallback(
    (error) => {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        refresh(); // the header should stop offering edit controls too
        return "Your editing session has ended or this account can't edit. Sign in again to continue.";
      }
      if (error instanceof ApiError) return error.message;
      return "Could not reach the server.";
    },
    [refresh],
  );

  useEffect(() => {
    let cancelled = false;
    editorApi
      .getMatch(matchKey)
      .then((loaded) => {
        if (cancelled) return;
        adopt(loaded);
        if (initialReplay) beginReplay(initialReplay, loaded, toForm(loaded));
      })
      .catch((error) => {
        if (!cancelled) setFatal(explain(error));
      });
    return () => {
      cancelled = true;
    };
    // The replay handed in at open time is applied once, when the match loads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchKey, adopt, explain, beginReplay]);

  const dirty = form !== null && JSON.stringify(form) !== initial;

  const requestClose = useCallback(() => {
    if (dirty && !window.confirm("Discard your unsaved changes?")) return;
    onClose();
  }, [dirty, onClose]);

  useEffect(() => {
    function onKey(event) {
      if (event.key === "Escape") requestClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [requestClose]);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  function setPlayerField(teamIndex, playerIndex, field, value) {
    setForm((current) => ({
      ...current,
      teams: current.teams.map((team, t) =>
        t !== teamIndex
          ? team
          : { ...team, players: team.players.map((p, i) => (i === playerIndex ? { ...p, [field]: value } : p)) },
      ),
    }));
  }

  function setBan(teamKey, index, value) {
    setForm((current) => ({
      ...current,
      bans: { ...current.bans, [teamKey]: current.bans[teamKey].map((ban, i) => (i === index ? value : ban)) },
    }));
  }

  async function chooseReplayFile(event) {
    const file = event.target.files?.[0];
    event.target.value = ""; // lets the same file be chosen again
    if (!file) return;
    setReplayError(null);
    try {
      const replay = await readReplayFile(file);
      beginReplay(replay, state, replayInfo ? replayInfo.base : form);
    } catch (error) {
      setReplayError(error instanceof ReplayError ? error.message : "Could not read that replay file.");
    }
  }

  function swapReplayTeams() {
    beginReplay(replayInfo.replay, state, replayInfo.base, { swap: !replayInfo.plan.swap });
  }

  function assignReplayPlayer(replayIndex, key) {
    const { replay, plan, base } = replayInfo;
    const assign = { ...plan.assign };
    if (key) {
      for (const index of Object.keys(assign)) if (assign[index] === key) assign[index] = null;
    }
    assign[replayIndex] = key;
    const guessed = plan.guessed.filter((index) => index !== replayIndex && assign[index]);
    setReplayInfo({ replay, plan: { ...plan, assign, guessed }, base });
    setForm(applyReplayToForm(base, replay, assign, state.championSuggestions));
  }

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    setProblems([]);
    setNotice(null);
    try {
      const saved = await editorApi.saveMatch(matchKey, toPayload(form, state.rev), csrfToken);
      onSaved(saved);
      onClose();
    } catch (error) {
      if (error instanceof ApiError && error.status === 400 && error.data?.problems) {
        setProblems(describeProblems(error.data.problems, form));
      } else if (error instanceof ApiError && error.status === 409 && error.data?.current) {
        adopt(error.data.current);
        setReplayInfo(null);
        setNotice(
          "Someone else saved changes to this match while you were editing. Their version is shown now; make your changes again.",
        );
      } else {
        setProblems([explain(error)]);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="match-editor-overlay">
      <div className="match-editor-backdrop" onClick={requestClose} />
      <div
        className="match-editor"
        role="dialog"
        aria-modal="true"
        aria-label={`Edit match details: ${title}`}
        tabIndex={-1}
        ref={dialogRef}
      >
        <div className="match-editor-header">
          <h2>Edit match details</h2>
          <button type="button" className="match-editor-close" aria-label="Close" onClick={requestClose}>
            {"\u00d7"}
          </button>
        </div>
        <p className="match-editor-subtitle">{title}</p>

        {fatal && (
          <p className="match-editor-error" role="alert">
            {fatal}
          </p>
        )}
        {!fatal && !form && <p>Loading{"\u2026"}</p>}

        {form && (
          <form onSubmit={save}>
            <datalist id={listId}>
              {state.championSuggestions.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>

            {notice && (
              <p className="match-editor-notice" role="status">
                {notice}
              </p>
            )}

            <div className="replay-upload">
              <input
                ref={fileInput}
                type="file"
                accept=".rofl"
                hidden
                aria-label="Replay file"
                onChange={chooseReplayFile}
              />
              <button type="button" className="columns-btn" onClick={() => fileInput.current?.click()}>
                {replayInfo ? "Use a different replay\u2026" : "Import from replay (.rofl)\u2026"}
              </button>
              <span className="replay-upload-hint">
                Reads champions, K/D/A and roles from the file in your browser; nothing is uploaded.
              </span>
            </div>
            {replayError && (
              <p className="match-editor-error" role="alert">
                {replayError}
              </p>
            )}
            {replayInfo && (
              <ReplayPanel info={replayInfo} state={state} onSwap={swapReplayTeams} onAssign={assignReplayPlayer} />
            )}

            <div className="match-editor-teams">
              {form.teams.map((team, teamIndex) => {
                const banKey = teamIndex === 0 ? "team1" : "team2";
                return (
                  <fieldset key={team.side} className="match-editor-team">
                    <legend>{team.name}</legend>
                    <table className="match-details-table match-editor-table">
                      <thead>
                        <tr>
                          <th>Player</th>
                          <th>Role</th>
                          <th>Champion</th>
                          <th>K</th>
                          <th>D</th>
                          <th>A</th>
                        </tr>
                      </thead>
                      <tbody>
                        {team.players.map((p, playerIndex) => (
                          <tr key={p.player}>
                            <td className="match-editor-player">{p.displayName}</td>
                            <td>
                              <select
                                aria-label={`${p.displayName} role`}
                                value={p.role}
                                onChange={(e) => setPlayerField(teamIndex, playerIndex, "role", e.target.value)}
                              >
                                <option value="">{"\u2014"}</option>
                                {state.roles.map((role) => (
                                  <option key={role} value={role}>
                                    {ROLE_LABELS[role] || role}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td>
                              <input
                                type="text"
                                list={listId}
                                maxLength={30}
                                autoComplete="off"
                                aria-label={`${p.displayName} champion`}
                                value={p.champion}
                                onChange={(e) => setPlayerField(teamIndex, playerIndex, "champion", e.target.value)}
                              />
                            </td>
                            {["kills", "deaths", "assists"].map((field) => (
                              <td key={field}>
                                <input
                                  type="number"
                                  className="match-editor-stat"
                                  min="0"
                                  max="99"
                                  step="1"
                                  inputMode="numeric"
                                  aria-label={`${p.displayName} ${field}`}
                                  value={p[field]}
                                  onChange={(e) => setPlayerField(teamIndex, playerIndex, field, e.target.value)}
                                />
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className="match-editor-bans">
                      <span className="ban-list-label">Bans</span>
                      {form.bans[banKey].map((ban, index) => (
                        <input
                          key={index}
                          type="text"
                          list={listId}
                          maxLength={30}
                          autoComplete="off"
                          aria-label={`${team.name} ban ${index + 1}`}
                          value={ban}
                          onChange={(e) => setBan(banKey, index, e.target.value)}
                        />
                      ))}
                    </div>
                  </fieldset>
                );
              })}
            </div>

            {problems.length > 0 && (
              <ul className="match-editor-error" role="alert">
                {problems.map((message, i) => (
                  <li key={i}>{message}</li>
                ))}
              </ul>
            )}

            <div className="match-editor-actions">
              <button type="button" className="columns-btn" onClick={requestClose}>
                Cancel
              </button>
              <button type="submit" className="download-btn" disabled={saving || !dirty}>
                {saving ? "Saving\u2026" : "Save changes"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
