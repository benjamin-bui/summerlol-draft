import { useEffect, useMemo, useState } from "react";
import { ApiError, editorApi } from "../../api/client";
import { useAuth } from "../../context/AuthContext";

const STAGE_FORMATS = [
  ["round-robin", "Round robin"],
  ["swiss", "Swiss"],
  ["single-elimination", "Single elimination"],
  ["double-elimination", "Double elimination"],
  ["custom", "Custom"],
];

function scopeKey(row) {
  return `${row.year}::${row.tournament || ""}`;
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
      setStages(next.stages.map((stage) => ({ ...stage, order: stage.stageOrder })));
      setSelectedGames([]);
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
      setStages(next.stages.map((stage) => ({ ...stage, order: stage.stageOrder })));
      setSelectedGames([]);
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

  async function run(action) {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const next = await action();
      if (next?.stages && next?.games) {
        setStructure(next);
        setStages(next.stages.map((stage) => ({ ...stage, order: stage.stageOrder })));
        setGroupStageId(next.stages[0]?.stageId || "");
        setAddSeriesId(next.series.find((series) => series.games.length)?.seriesId || "");
      } else {
        await loadStructure(selected);
      }
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
      },
    ]);
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
  const gameByKey = new Map((structure?.games || []).map((game) => [game.matchKey, game]));
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
              <p className="stat-formula">Order stages as they were played. Format is descriptive; advancement is not calculated.</p>
              {stages.map((stage, index) => (
                <div className="structure-stage-row" key={stage.stageId || `new-${index}`}>
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
              ))}
              <div className="structure-actions">
                <button type="button" className="columns-btn" onClick={addStage}>Add stage</button>
                <button type="button" className="columns-btn" disabled={busy} onClick={() => run(() => editorApi.saveTournamentStages(selected.year, selected.tournament, stages, csrfToken))}>Save stages</button>
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
                  }, csrfToken))}
                >
                  Group selected games
                </button>
              </div>
              <p className="stat-formula">Select two or more games between the same teams. Grouping changes display only, not game ratings.</p>
              <div className="structure-game-list">
                {(structure.games || []).map((game) => (
                  <label className="structure-game-row" key={game.matchKey}>
                    <input type="checkbox" checked={selectedGames.includes(game.matchKey)} onChange={() => toggleGame(game.matchKey)} />
                    <span>#{game.matchOrder} {game.team1} vs {game.team2}</span>
                    <span className="stat-formula">{game.stage?.stageName || "No stage"} · {currentLabel(game)}</span>
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
                })), csrfToken))}
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
                }), csrfToken))}
              >
                Ungroup selected games
              </button>
            </section>

            <section className="structure-section">
              <h3>Add a game to a series</h3>
              {activeSeries.length ? (
                <div className="structure-series-form">
                  <label>Series
                    <select value={addSeriesId} onChange={(event) => setAddSeriesId(event.target.value)}>
                      {activeSeries.map((series) => {
                        const first = series.games[0];
                        const stage = structure.stages.find((item) => item.stageId === series.stageId);
                        return <option key={series.seriesId} value={series.seriesId}>
                          {stage?.name || "Stage"} · {series.roundLabel || `${first.team1} vs ${first.team2}`} {series.bestOf ? `(Bo${series.bestOf})` : ""}
                        </option>;
                      })}
                    </select>
                  </label>
                  <label>Result
                    <select value={addResult} onChange={(event) => setAddResult(event.target.value)}>
                      <option value="team1">Team 1 wins</option>
                      <option value="team2">Team 2 wins</option>
                      <option value="draw">Draw</option>
                    </select>
                  </label>
                  <button
                    type="button"
                    className="columns-btn"
                    disabled={busy || !addSeriesId}
                    onClick={() => run(async () => {
                      await editorApi.addSeriesGame(selected.year, selected.tournament, addSeriesId, { result: addResult }, csrfToken);
                      return editorApi.getTournamentStructure(selected.year, selected.tournament);
                    })}
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
