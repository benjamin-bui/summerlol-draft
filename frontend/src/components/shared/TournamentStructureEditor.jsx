import { useEffect, useMemo, useState } from "react";
import { ApiError, editorApi } from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import {
  MAX_GROUPS,
  assignTeam,
  groupIndexOfTeam,
  groupsPayload,
  resizeGroups,
  roundsFromMatchOrder,
  suggestGroups,
  tournamentTeams,
} from "../../utils/roundRobinGroups";

const STAGE_FORMATS = [
  ["round-robin", "Round robin"],
  ["swiss", "Swiss"],
  ["single-elimination", "Single elimination"],
  ["double-elimination", "Double elimination"],
  ["custom", "Custom"],
];

function editableStages(stages) {
  return stages.map((stage) => ({
    ...stage,
    order: stage.stageOrder,
    groups: (stage.groups || []).map((group) => ({ ...group, teams: [...(group.teams || [])] })),
  }));
}

function scopeKey(row) {
  return `${row.year}::${row.tournament || ""}`;
}

function getSeriesSides(series) {
  const firstGame = series?.games[0];
  if (!firstGame) return null;
  const team1 = firstGame.team1;
  const team2 = firstGame.team2;
  const wins = { team1: 0, team2: 0 };
  const normalized = (name) => String(name || "").trim().toLowerCase();
  for (const game of series.games) {
    const winner = normalized(game.result);
    if (winner === normalized(game.team1)) {
      wins[normalized(game.team1) === normalized(team1) ? "team1" : "team2"] += 1;
    } else if (winner === normalized(game.team2)) {
      wins[normalized(game.team2) === normalized(team1) ? "team1" : "team2"] += 1;
    }
  }
  return { team1, team2, wins };
}


// Group count, names and team allocation for one round-robin stage. Allocation
// is per team (a select each) so a team can never sit in two groups.
function RoundRobinGroupsEditor({ label, groups, teams, stageGames, onChange }) {
  const suggestion = suggestGroups(stageGames);
  const unassigned = teams.filter((team) => groupIndexOfTeam(groups, team) === -1);
  return (
    <div className="structure-groups" role="group" aria-label={`${label} groups`}>
      <div className="structure-groups-head">
        <label>
          Number of groups
          <input
            type="number"
            min="0"
            max={MAX_GROUPS}
            aria-label={`${label} number of groups`}
            value={groups.length}
            onChange={(event) => onChange(resizeGroups(groups, event.target.value))}
          />
        </label>
        <button
          type="button"
          className="columns-btn"
          disabled={!suggestion.length}
          title={suggestion.length ? "Group teams that play each other in this stage's games" : "Assign games to this stage and save first"}
          onClick={() => onChange(suggestion.map((group, index) => ({ ...group, groupId: groups[index]?.groupId })))}
        >
          Suggest from games
        </button>
      </div>
      {groups.length === 0 ? (
        <p className="stat-formula">No groups: results show as one list of matches.</p>
      ) : (
        <>
          <div className="structure-group-names">
            {groups.map((group, groupIndex) => (
              <label key={group.groupId || `new-${groupIndex}`}>
                Group {groupIndex + 1} name
                <input
                  type="text"
                  aria-label={`${label} group ${groupIndex + 1} name`}
                  value={group.name}
                  maxLength={40}
                  onChange={(event) => onChange(groups.map((item, i) => (i === groupIndex ? { ...item, name: event.target.value } : item)))}
                />
              </label>
            ))}
          </div>
          <div className="structure-group-teams">
            {teams.map((team) => (
              <label key={team} className="structure-group-team">
                <span>{team}</span>
                <select
                  aria-label={`${label} group for ${team}`}
                  value={groupIndexOfTeam(groups, team)}
                  onChange={(event) => onChange(assignTeam(groups, team, Number(event.target.value)))}
                >
                  <option value={-1}>Unassigned</option>
                  {groups.map((group, groupIndex) => (
                    <option key={groupIndex} value={groupIndex}>{group.name || `Group ${groupIndex + 1}`}</option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <p className="stat-formula">
            {unassigned.length
              ? `${unassigned.length} unassigned: ${unassigned.join(", ")}. `
              : ""}
            Games between two teams of one group appear in that group; any others are listed separately.
          </p>
        </>
      )}
    </div>
  );
}

export default function TournamentStructureEditor({ rows, onClose, onChanged }) {
  const { csrfToken, refresh } = useAuth();
  const tournaments = useMemo(() => {
    const unique = new Map();
    for (const row of rows || []) {
      const key = scopeKey(row);
      if (!unique.has(key)) {
        unique.set(key, {
          year: Number(row.year),
          tournament: row.tournament || "",
          label: `${row.tournament || "Tournament"} ${row.year}`,
        });
      }
    }
    return [...unique.values()].sort((a, b) => b.year - a.year || a.tournament.localeCompare(b.tournament));
  }, [rows]);
  const [selectedScope, setSelectedScope] = useState("");
  const selected = tournaments.find((item) => scopeKey(item) === selectedScope) || tournaments[0];
  const [structure, setStructure] = useState(null);
  const [stages, setStages] = useState([]);
  const [selectedGames, setSelectedGames] = useState([]);
  const [roundName, setRoundName] = useState("");
  const [gameStageFilter, setGameStageFilter] = useState("all");
  const [groupStageId, setGroupStageId] = useState("");
  const [roundLabel, setRoundLabel] = useState("");
  const [bestOf, setBestOf] = useState("3");
  const [addSeriesId, setAddSeriesId] = useState("");
  const [addResult, setAddResult] = useState("team1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const selectedYear = selected?.year;
  const selectedTournament = selected?.tournament;

  async function loadStructure(scope = selected) {
    if (!scope) return;
    setBusy(true);
    setError(null);
    try {
      const next = await editorApi.getTournamentStructure(scope.year, scope.tournament);
      setStructure(next);
      setStages(editableStages(next.stages));
      setSelectedGames([]);
      setGameStageFilter("all");
      setGroupStageId(next.stages[0]?.stageId || "");
      setAddSeriesId(next.series.find((series) => series.games.length)?.seriesId || "");
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) refresh();
      setError(err.message || "Could not load tournament structure.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!selectedYear || !selectedTournament) return undefined;
    let cancelled = false;
    editorApi.getTournamentStructure(selectedYear, selectedTournament).then((next) => {
      if (cancelled) return;
      setStructure(next);
      setStages(editableStages(next.stages));
      setSelectedGames([]);
      setGameStageFilter("all");
      setGroupStageId(next.stages[0]?.stageId || "");
      setAddSeriesId(next.series.find((series) => series.games.length)?.seriesId || "");
    }).catch((err) => {
      if (cancelled) return;
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) refresh();
      setError(err.message || "Could not load tournament structure.");
    });
    return () => {
      cancelled = true;
    };
  }, [selectedYear, selectedTournament, refresh]);

  async function run(action, { clearSelection = false } = {}) {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const next = await action();
      if (next?.stages && next?.games) {
        setStructure(next);
        setStages(editableStages(next.stages));
        setGroupStageId(next.stages[0]?.stageId || "");
        setAddSeriesId(next.series.find((series) => series.games.length)?.seriesId || "");
      } else {
        await loadStructure(selected);
      }
      if (clearSelection) setSelectedGames([]);
      await onChanged();
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) refresh();
      setError(err.message || "Could not update tournament structure.");
    } finally {
      setBusy(false);
    }
  }

  function toggleGame(matchKey) {
    setSelectedGames((current) =>
      current.includes(matchKey) ? current.filter((key) => key !== matchKey) : [...current, matchKey],
    );
  }

  function addStage() {
    setStages((current) => [
      ...current,
      {
        stageId: "",
        name: `Stage ${current.length + 1}`,
        format: "custom",
        order: current.length + 1,
        groups: [],
      },
    ]);
  }

  function updateStage(index, change) {
    setStages((current) => current.map((item, i) => (i === index ? { ...item, ...change } : item)));
  }

  if (!selected) {
    return (
      <div className="match-editor-overlay">
        <div className="match-editor-backdrop" onClick={onClose} />
        <div className="match-editor" role="dialog" aria-modal="true" aria-label="Tournament structure">
          <div className="match-editor-header">
            <h2>Tournament structure</h2>
            <button type="button" className="match-editor-close" aria-label="Close" onClick={onClose}>{"\u00d7"}</button>
          </div>
          <p>No tournament games are available.</p>
        </div>
      </div>
    );
  }

  const activeSeries = (structure?.series || []).filter((series) => series.games.length);
  const selectedSeries = activeSeries.find((series) => series.seriesId === addSeriesId);
  const seriesSides = getSeriesSides(selectedSeries);
  const gameByKey = new Map((structure?.games || []).map((game) => [game.matchKey, game]));
  const teams = tournamentTeams(structure?.games);
  const visibleGames = (structure?.games || []).filter(
    (game) =>
      gameStageFilter === "all" ||
      (gameStageFilter === "unassigned" ? !game.stageId : game.stageId === gameStageFilter),
  );
  const currentLabel = (game) => {
    const series = game.seriesId ? structure?.series.find((item) => item.seriesId === game.seriesId) : null;
    return series
      ? `${series.roundLabel || "Series"} · Game ${game.gameNumber}${series.bestOf ? ` of ${series.bestOf}` : ""}`
      : "Standalone game";
  };

  return (
    <div className="match-editor-overlay">
      <div className="match-editor-backdrop" onClick={onClose} />
      <div className="match-editor structure-editor" role="dialog" aria-modal="true" aria-label="Tournament structure">
        <div className="match-editor-header">
          <h2>Tournament structure</h2>
          <button type="button" className="match-editor-close" aria-label="Close" onClick={onClose}>{"\u00d7"}</button>
        </div>
        <label className="structure-tournament-select">
          Tournament
          <select
            value={scopeKey(selected)}
            onChange={(event) => {
              const nextKey = event.target.value;
              setSelectedScope(nextKey);
              setStructure(null);
              setSelectedGames([]);
            }}
          >
            {tournaments.map((item) => <option key={scopeKey(item)} value={scopeKey(item)}>{item.label}</option>)}
          </select>
        </label>

        {error && <p className="match-editor-error" role="alert">{error}</p>}
        {busy && !structure ? <p>Loading tournament structure{"\u2026"}</p> : null}
        {structure && (
          <>
            <section className="structure-section">
              <h3>Stages</h3>
              <p className="stat-formula">Order stages as they were played. Format is descriptive; advancement is not calculated. Round-robin stages can be split into named groups, which the results page shows as standings tables.</p>
              {stages.map((stage, index) => (
                <div className="structure-stage" key={stage.stageId || `new-${index}`}>
                <div className="structure-stage-row">
                  <input
                    type="text"
                    aria-label={`Stage ${index + 1} name`}
                    value={stage.name}
                    maxLength={80}
                    onChange={(event) => setStages((current) => current.map((item, i) => i === index ? { ...item, name: event.target.value } : item))}
                  />
                  <select
                    aria-label={`Stage ${index + 1} format`}
                    value={stage.format}
                    onChange={(event) => setStages((current) => current.map((item, i) => i === index ? { ...item, format: event.target.value } : item))}
                  >
                    {STAGE_FORMATS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                  <input
                    type="number"
                    min="1"
                    aria-label={`Stage ${index + 1} order`}
                    value={stage.order}
                    onChange={(event) => setStages((current) => current.map((item, i) => i === index ? { ...item, order: Number(event.target.value) } : item))}
                  />
                  {stages.length > 1 && <button type="button" className="columns-btn" onClick={() => setStages((current) => current.filter((_, i) => i !== index))}>Remove</button>}
                </div>
                {stage.format === "round-robin" && (
                  <RoundRobinGroupsEditor
                    label={`Stage ${index + 1}`}
                    groups={stage.groups || []}
                    teams={teams}
                    stageGames={structure.games.filter((game) => stage.stageId && game.stageId === stage.stageId)}
                    onChange={(groups) => updateStage(index, { groups })}
                  />
                )}
                </div>
              ))}
              <div className="structure-actions">
                <button type="button" className="columns-btn" onClick={addStage}>Add stage</button>
                <button type="button" className="columns-btn" disabled={busy} onClick={() => run(() => editorApi.saveTournamentStages(selected.year, selected.tournament, stages.map((stage) => ({ ...stage, groups: groupsPayload(stage) })), csrfToken))}>Save stages</button>
              </div>
            </section>

            <section className="structure-section">
              <h3>Group existing games into a series</h3>
              <div className="structure-series-form">
                <label>Stage
                  <select value={groupStageId} onChange={(event) => setGroupStageId(event.target.value)}>
                    {stages.filter((stage) => stage.stageId).map((stage) => <option key={stage.stageId} value={stage.stageId}>{stage.name}</option>)}
                  </select>
                </label>
                <label>Round label
                  <input type="text" value={roundLabel} maxLength={80} onChange={(event) => setRoundLabel(event.target.value)} placeholder="e.g. Final" />
                </label>
                <label>Best of
                  <select value={bestOf} onChange={(event) => setBestOf(event.target.value)}>
                    <option value="">Unspecified</option>
                    {[1, 3, 5, 7].map((value) => <option key={value} value={value}>Bo{value}</option>)}
                  </select>
                </label>
                <button
                  type="button"
                  className="columns-btn"
                  disabled={busy || selectedGames.length < 2 || !groupStageId}
                  onClick={() => run(() => editorApi.createSeries(selected.year, selected.tournament, {
                    matchKeys: selectedGames,
                    stageId: groupStageId,
                    roundLabel,
                    bestOf: bestOf ? Number(bestOf) : null,
                  }, csrfToken), { clearSelection: true })}
                >
                  Group selected games
                </button>
              </div>
              <p className="stat-formula">Select two or more games between the same teams. Grouping changes display only, not game ratings.</p>
              <div className="structure-selection-toolbar">
                <label>
                  Show games
                  <select
                    value={gameStageFilter}
                    onChange={(event) => {
                      setGameStageFilter(event.target.value);
                      setSelectedGames([]);
                    }}
                  >
                    <option value="all">All stages</option>
                    {structure.stages.map((stage) => (
                      <option key={stage.stageId} value={stage.stageId}>{stage.name}</option>
                    ))}
                    <option value="unassigned">No stage</option>
                  </select>
                </label>
                <span className="stat-formula">
                  {selectedGames.length} selected
                  {visibleGames.length !== structure.games.length ? ` · ${visibleGames.length} shown` : ""}
                </span>
                <button
                  type="button"
                  className="columns-btn"
                  disabled={!visibleGames.length || visibleGames.every((game) => selectedGames.includes(game.matchKey))}
                  onClick={() => setSelectedGames((current) => [
                    ...new Set([...current, ...visibleGames.map((game) => game.matchKey)]),
                  ])}
                >
                  Select all shown
                </button>
                <button
                  type="button"
                  className="columns-btn"
                  disabled={!selectedGames.length}
                  onClick={() => setSelectedGames([])}
                >
                  Clear selection
                </button>
              </div>
              <div className="structure-game-list">
                {visibleGames.map((game) => (
                  <label className="structure-game-row" key={game.matchKey}>
                    <input type="checkbox" checked={selectedGames.includes(game.matchKey)} onChange={() => toggleGame(game.matchKey)} />
                    <span>#{game.matchOrder} {game.team1} vs {game.team2}</span>
                    <span className="stat-formula">{game.stage?.stageName || "No stage"} · {currentLabel(game)}{game.round ? ` · ${game.round}` : ""}</span>
                  </label>
                ))}
              </div>
              <button
                type="button"
                className="columns-btn"
                disabled={busy || selectedGames.length === 0 || !groupStageId}
                onClick={() => run(() => editorApi.updateGameStructure(selected.year, selected.tournament, selectedGames.map((matchKey) => ({
                  matchKey,
                  stageId: groupStageId,
                  seriesId: null,
                })), csrfToken), { clearSelection: true })}
              >
                Move selected games to stage (ungroup series)
              </button>{" "}
              <button
                type="button"
                className="columns-btn"
                disabled={busy || !selectedGames.some((key) => gameByKey.get(key)?.seriesId)}
                onClick={() => run(() => editorApi.updateGameStructure(selected.year, selected.tournament, selectedGames.map((matchKey) => {
                  const game = gameByKey.get(matchKey);
                  return { matchKey, stageId: game?.stageId || null, seriesId: null };
                }), csrfToken), { clearSelection: true })}
              >
                Ungroup selected games
              </button>
              <div className="structure-round-form">
                <label>
                  Round
                  <input
                    type="text"
                    aria-label="Round name"
                    placeholder="e.g. Round 1"
                    maxLength={80}
                    value={roundName}
                    onChange={(event) => setRoundName(event.target.value)}
                  />
                </label>
                <button
                  type="button"
                  className="columns-btn"
                  disabled={busy || selectedGames.length === 0 || !roundName.trim()}
                  onClick={() => run(() => editorApi.updateGameRounds(selected.year, selected.tournament, selectedGames.map((matchKey) => ({
                    matchKey,
                    round: roundName.trim(),
                  })), csrfToken), { clearSelection: true })}
                >
                  Set round on selected games
                </button>
                <button
                  type="button"
                  className="columns-btn"
                  disabled={busy || selectedGames.length === 0}
                  title="Games played at the same time (same match order) share a round"
                  onClick={() => run(() => editorApi.updateGameRounds(selected.year, selected.tournament, roundsFromMatchOrder(selectedGames.map((key) => gameByKey.get(key)).filter(Boolean)), csrfToken), { clearSelection: true })}
                >
                  Number rounds from match order
                </button>
                <button
                  type="button"
                  className="columns-btn"
                  disabled={busy || !selectedGames.some((key) => gameByKey.get(key)?.round)}
                  onClick={() => run(() => editorApi.updateGameRounds(selected.year, selected.tournament, selectedGames.map((matchKey) => ({
                    matchKey,
                    round: null,
                  })), csrfToken), { clearSelection: true })}
                >
                  Clear round
                </button>
              </div>
              <p className="stat-formula">Rounds order a round-robin stage&apos;s matches on the results page. A series keeps one round for all its games; this is separate from the series label.</p>
            </section>

            <section className="structure-section">
              <h3>Add a game to a series</h3>
              {activeSeries.length ? (
                <div className="structure-series-form">
                  <label>Series
                    <select value={addSeriesId} onChange={(event) => setAddSeriesId(event.target.value)}>
                      {activeSeries.map((series) => {
                        const stage = structure.stages.find((item) => item.stageId === series.stageId);
                        const sides = getSeriesSides(series);
                        const score = `${sides.team1} ${sides.wins.team1}\u2013${sides.wins.team2} ${sides.team2}`;
                        return <option key={series.seriesId} value={series.seriesId}>
                          {stage?.name || "Stage"} · {series.roundLabel || "Series"} · {score} {series.bestOf ? `(Bo${series.bestOf})` : ""}
                        </option>;
                      })}
                    </select>
                  </label>
                  <label>Result
                    <select value={addResult} onChange={(event) => setAddResult(event.target.value)}>
                      <option value="team1">
                        {seriesSides?.team1 || "Team 1"} wins ({seriesSides?.wins.team1 || 0} {seriesSides?.wins.team1 === 1 ? "win" : "wins"})
                      </option>
                      <option value="team2">
                        {seriesSides?.team2 || "Team 2"} wins ({seriesSides?.wins.team2 || 0} {seriesSides?.wins.team2 === 1 ? "win" : "wins"})
                      </option>
                      <option value="draw">Draw</option>
                    </select>
                  </label>
                  {seriesSides && (
                    <p className="stat-formula structure-series-score">
                      Current score: {seriesSides.team1} {seriesSides.wins.team1}{"\u2013"}{seriesSides.wins.team2} {seriesSides.team2}
                    </p>
                  )}
                  <button
                    type="button"
                    className="columns-btn"
                    disabled={busy || !addSeriesId}
                    onClick={() => run(async () => {
                      await editorApi.addSeriesGame(selected.year, selected.tournament, addSeriesId, { result: addResult }, csrfToken);
                      return editorApi.getTournamentStructure(selected.year, selected.tournament);
                    }, { clearSelection: true })}
                  >
                    Add next game
                  </button>
                </div>
              ) : <p className="stat-formula">Group existing games first to create a series.</p>}
            </section>
          </>
        )}
        <div className="match-editor-actions">
          <button type="button" className="columns-btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
