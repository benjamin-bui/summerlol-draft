import { useEffect, useMemo, useRef, useState } from "react";
import { useAppData } from "../context/AppDataContext";
import DataTable from "../components/table/DataTable";
import NameFilterBox, { summarizeNameList } from "../components/shared/NameFilterBox";
import { PlayerLink, TrueSkillValue, SoloQueueRank } from "../components/shared/Cells";
import { buildNameMatcher, resolvePoolPlayerByName } from "../utils/nameMatch";
import { round1, soloQueueSortValueClient } from "../utils/format";

// Standard snake draft: round 0 goes captain 0..N-1, round 1 reverses N-1..0.
function generateSnakeSlots(nCaptains, nPicks) {
  const slots = [];
  let overall = 1;
  for (let round = 0; round < nPicks; round++) {
    const order = round % 2 === 0 ? [...Array(nCaptains).keys()] : [...Array(nCaptains).keys()].reverse();
    for (const captainIndex of order) slots.push({ round, captainIndex, overall: overall++ });
  }
  return slots;
}

const MOCK_PLAYER_COLUMNS = [
  {
    key: "group",
    label: "Player",
    sortable: true,
    hideable: false,
    filterable: true,
    type: "string",
    className: "group-name",
    render: (val, row) => (
      <PlayerLink fullName={row.group} identityKey={row.identityKey} identified={!row.manual} allowSimpleFallback />
    ),
  },
  {
    key: "conservativeRating",
    label: "TrueSkill",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "number",
    decimals: 2,
    className: "adj-avg",
    render: (val, row) => <TrueSkillValue rating={row.conservativeRating} mu={row.mu} />,
  },
  {
    key: "soloQueueRank",
    label: "Solo Queue",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "string",
    sortValue: (row) => soloQueueSortValueClient(row.soloQueueRank),
    render: (val) => <SoloQueueRank rank={val} />,
  },
  {
    key: "flexQueueRank",
    label: "Flex Queue",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "string",
    sortValue: (row) => soloQueueSortValueClient(row.flexQueueRank),
    render: (val) => <SoloQueueRank rank={val} />,
  },
  {
    key: "premade5x5Rank",
    label: "5x5 Queue",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "string",
    defaultHidden: true,
    sortValue: (row) => soloQueueSortValueClient(row.premade5x5Rank),
    render: (val) => <SoloQueueRank rank={val} />,
  },
  { key: "mu", label: "\u03bc", sortable: true, hideable: true, filterable: true, type: "number", decimals: 2, defaultHidden: true },
  { key: "sigma", label: "\u03c3", sortable: true, hideable: true, filterable: true, type: "number", decimals: 2, defaultHidden: true },
  { key: "wins", label: "Wins", sortable: true, hideable: true, filterable: true, type: "number", decimals: 0 },
  { key: "losses", label: "Losses", sortable: true, hideable: true, filterable: true, type: "number", decimals: 0 },
  {
    key: "winrate",
    label: "Win Rate %",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "number",
    decimals: 0,
    sortValue: (row) => (row.games ? row.wins / row.games : 0),
    render: (val, row) => (row.games ? ((row.wins / row.games) * 100).toFixed(1) + "%" : "0.0%"),
  },
];

const MOCK_SELECTED_COLUMNS = [
  ...MOCK_PLAYER_COLUMNS,
  { key: "pickLabel", label: "Pick", sortable: true, hideable: true, filterable: true, type: "string", sortValue: (row) => row.overall },
];

export default function MockDraftTab({ active }) {
  const { players, loadTrueskill } = useAppData();
  const [pool, setPool] = useState([]);
  const [poolSummary, setPoolSummary] = useState(null);
  const [numCaptains, setNumCaptains] = useState(8);
  const [picksPerCaptain, setPicksPerCaptain] = useState(4);
  const [boardCaptains, setBoardCaptains] = useState(8);
  const [boardPicks, setBoardPicks] = useState(4);
  const [captains, setCaptains] = useState([]); // array of resolved player objects (or null)
  const [captainInputs, setCaptainInputs] = useState(Array(8).fill(""));
  const [picks, setPicks] = useState(new Map()); // "round::captainIndex" -> resolved player
  const [pickInputs, setPickInputs] = useState({});
  const [iqResults, setIqResults] = useState(null);
  const initialized = useRef(false);

  useEffect(() => {
    if (active) loadTrueskill(false);
  }, [active, loadTrueskill]);

  // Default the pool to every known player once TrueSkill data is loaded, if
  // no pool has been applied yet -- same as applyMockDraftPoolFilter("").
  useEffect(() => {
    if (!initialized.current && players.length && pool.length === 0) {
      initialized.current = true;
      applyPoolFilter("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [players]);

  function applyPoolFilter(text) {
    const trimmed = text.trim();
    if (!trimmed) {
      const all = (players || []).map((p) => ({ ...p, manual: false }));
      setPool(all);
      setPoolSummary(all.length ? `Showing all ${all.length} known players (no list applied).` : null);
      resetBoard();
      return;
    }
    const result = summarizeNameList(text, players, buildNameMatcher);
    if (!result) return;
    const newPool = result.names.map((rawName) => resolvePoolPlayerByName(rawName, players || []));
    setPool(newPool);
    setPoolSummary(
      result.unmatched.length
        ? `Matched ${result.names.length - result.unmatched.length}/${result.names.length}. New/unrecognized (added with no TrueSkill data): ${result.unmatched.join(", ")}`
        : `Matched all ${result.names.length} names.`,
    );
    resetBoard();
  }

  function resetBoard() {
    setPicks(new Map());
    setPickInputs({});
    setIqResults(null);
  }

  function handlePresetCaptains(captainNames, poolSize) {
    if (!captainNames.length) return;
    const n = captainNames.length;
    const nonCaptainCount = poolSize - n;
    const inferredPicks = Math.max(1, Math.floor(nonCaptainCount / n));
    setNumCaptains(n);
    setPicksPerCaptain(inferredPicks);
    setBoardCaptains(n);
    setBoardPicks(inferredPicks);
    // Resolve captains against the *new* pool once it's applied. Since
    // applyPoolFilter and this run in the same event, resolve against the
    // preset's own name list (already known) rather than stale pool state.
    const resolved = captainNames.map((name) => resolvePoolPlayerByName(name, players || []));
    setCaptains(resolved);
    setCaptainInputs(resolved.map((c) => c?.group || ""));
    resetBoard();
  }

  function generateBoard() {
    setBoardCaptains(numCaptains);
    setBoardPicks(picksPerCaptain);
    setCaptains((prev) => prev.slice(0, numCaptains));
    setCaptainInputs((prev) => {
      const next = prev.slice(0, numCaptains);
      while (next.length < numCaptains) next.push("");
      return next;
    });
    resetBoard();
  }

  function getAvailablePlayers() {
    const draftedKeys = new Set();
    const draftedNames = new Set();
    picks.forEach((pick) => {
      if (!pick) return;
      if (pick.identityKey) draftedKeys.add(pick.identityKey);
      else draftedNames.add(pick.group.toLowerCase());
    });
    captains.forEach((captain) => {
      if (!captain) return;
      if (captain.identityKey) draftedKeys.add(captain.identityKey);
      else draftedNames.add(captain.group.toLowerCase());
    });
    return pool.filter((p) => !draftedKeys.has(p.identityKey) && !draftedNames.has(p.group.toLowerCase()));
  }

  const available = getAvailablePlayers();
  const slots = useMemo(() => generateSnakeSlots(boardCaptains, boardPicks), [boardCaptains, boardPicks]);

  function setCaptainInput(i, value) {
    setCaptainInputs((prev) => {
      const next = [...prev];
      next[i] = value;
      return next;
    });
  }
  function commitCaptain(i) {
    const value = captainInputs[i] || "";
    setCaptains((prev) => {
      const next = [...prev];
      next[i] = value.trim() ? resolvePoolPlayerByName(value, pool) : null;
      return next;
    });
  }

  function setPickInput(key, value) {
    setPickInputs((prev) => ({ ...prev, [key]: value }));
  }
  function commitPick(key) {
    const text = (pickInputs[key] ?? "").trim();
    setPicks((prev) => {
      const next = new Map(prev);
      if (!text) next.delete(key);
      else next.set(key, resolvePoolPlayerByName(text, getAvailablePlayers()));
      return next;
    });
  }

  const selectedRows = [];
  picks.forEach((pick, key) => {
    if (!pick) return;
    const [round, captainIndex] = key.split("::").map(Number);
    const slot = slots.find((s) => s.round === round && s.captainIndex === captainIndex);
    selectedRows.push({
      ...pick,
      overall: slot?.overall ?? 0,
      pickLabel: `#${slot?.overall ?? "?"} (${captains[captainIndex]?.group || `Captain ${captainIndex + 1}`})`,
    });
  });

  function evaluateDraftIQ() {
    const rated = pool.filter((p) => p.conservativeRating !== null && p.conservativeRating !== undefined);
    const rankedByRating = [...rated].sort((a, b) => b.conservativeRating - a.conservativeRating);
    const entryRankByKey = new Map(rankedByRating.map((p, i) => [p.identityKey || p.group, i]));

    const evalPicks = [];
    picks.forEach((pick, key) => {
      if (!pick) return;
      const [round, captainIndex] = key.split("::").map(Number);
      const slot = slots.find((s) => s.round === round && s.captainIndex === captainIndex);
      if (!slot) return;
      const poolKey = pick.identityKey || pick.group;
      const entryRank = entryRankByKey.get(poolKey) ?? null;
      evalPicks.push({
        captainIndex,
        captainName: captains[captainIndex]?.group || `Captain ${captainIndex + 1}`,
        captainIdentityKey: captains[captainIndex]?.identityKey || null,
        displayName: pick.group,
        identityKey: pick.identityKey || null,
        pickOrder: slot.overall,
        entryRank,
        value: entryRank !== null ? slot.overall - entryRank : null,
      });
    });

    const byCaptain = new Map();
    evalPicks.forEach((p) => {
      if (!byCaptain.has(p.captainIndex)) byCaptain.set(p.captainIndex, []);
      byCaptain.get(p.captainIndex).push(p);
    });
    const captainResults = [...byCaptain.entries()].map(([captainIndex, captainPicks]) => {
      const valued = captainPicks.filter((p) => p.value !== null);
      const avgDraftValue = valued.length ? round1(valued.reduce((s, p) => s + p.value, 0) / valued.length) : null;
      return {
        captainName: captainPicks[0]?.captainName,
        captainIdentityKey: captainPicks[0]?.captainIdentityKey,
        avgDraftValue,
        picks: [...captainPicks].sort((a, b) => a.pickOrder - b.pickOrder),
      };
    });
    captainResults.sort((a, b) => (b.avgDraftValue ?? -Infinity) - (a.avgDraftValue ?? -Infinity));
    setIqResults(captainResults);
  }

  return (
    <section className={`tab-panel${active ? " active" : ""}`}>
      <section className="control-panel">
        <h3>Mock Draft</h3>
        <p>
          Build a player pool below, set captains and picks per captain, then fill the snake-order board by typing a
          name or picking from the dropdown. Snake draft only for now {"\u2014"} auction-style and live synced
          drafting aren{"\u2019"}t built yet.
        </p>
      </section>

      <NameFilterBox
        label="Player pool (paste names, one per line or comma-separated, or upload a file):"
        textareaId="mockDraftFilterInput"
        placeholder={"Voidliss#NA1\nXemacs#LOR\n..."}
        onApply={applyPoolFilter}
        onCaptains={handlePresetCaptains}
        applyLabel="Apply Pool"
        summary={poolSummary && <span className="name-filter-summary">{poolSummary}</span>}
      />

      <div className="control-panel mock-draft-setup">
        <label>
          Number of captains
          <input
            type="number"
            min={2}
            value={numCaptains}
            className="total-n-input"
            onChange={(e) => setNumCaptains(Math.max(2, parseInt(e.target.value, 10) || 2))}
          />
        </label>
        <label className="second-control">
          Picks per captain
          <input
            type="number"
            min={1}
            value={picksPerCaptain}
            className="total-n-input"
            onChange={(e) => setPicksPerCaptain(Math.max(1, parseInt(e.target.value, 10) || 1))}
          />
        </label>
        <button type="button" className="download-btn" style={{ marginTop: 14 }} onClick={generateBoard}>
          Generate Board
        </button>
      </div>

      <div className="mock-captain-inputs">
        {Array.from({ length: boardCaptains }, (_, i) => (
          <div className="mock-captain-input-wrap" key={i}>
            <label>Captain {i + 1}</label>
            <input
              type="text"
              list="mockDraftPlayerDatalist"
              className="mock-captain-input"
              placeholder={"Type or pick a name\u2026"}
              value={captainInputs[i] || ""}
              onChange={(e) => setCaptainInput(i, e.target.value)}
              onBlur={() => commitCaptain(i)}
            />
          </div>
        ))}
      </div>
      <datalist id="mockDraftPlayerDatalist">
        {pool.map((p) => (
          <option value={p.group} key={p.identityKey || p.group} />
        ))}
      </datalist>
      <datalist id="mockDraftAvailableDatalist">
        {available.map((p) => (
          <option value={p.group} key={p.identityKey || p.group} />
        ))}
      </datalist>

      <div className="table-section" style={{ overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              <th></th>
              {Array.from({ length: boardCaptains }, (_, i) => (
                <th key={i}>{captains[i]?.group || `Captain ${i + 1}`}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: boardPicks }, (_, round) => (
              <tr key={round}>
                <td className="round-label">Round {round + 1}</td>
                {Array.from({ length: boardCaptains }, (_, c) => {
                  const slot = slots.find((s) => s.round === round && s.captainIndex === c);
                  const key = `${round}::${c}`;
                  const pick = picks.get(key);
                  return (
                    <td key={c}>
                      <div className="mock-pick-cell">
                        {pick && pick.identityKey ? (
                          <PlayerLink fullName={pick.group} identityKey={pick.identityKey} />
                        ) : (
                          <span className="mock-pick-number">#{slot?.overall}</span>
                        )}
                        <input
                          type="text"
                          list="mockDraftAvailableDatalist"
                          className="mock-pick-input"
                          placeholder={"Type or pick\u2026"}
                          value={pickInputs[key] ?? (pick ? pick.group : "")}
                          onChange={(e) => setPickInput(key, e.target.value)}
                          onBlur={() => commitPick(key)}
                        />
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button type="button" className="download-btn" onClick={evaluateDraftIQ}>
        Evaluate Draft IQ
      </button>
      <div>
        {iqResults && (
          <>
            {iqResults.length === 0 ? (
              <p className="mock-draftiq-empty">No picks made yet {"\u2014"} fill in the board first.</p>
            ) : (
              iqResults.map((team, i) => (
                <div className="fun-facts-box" style={{ marginBottom: 12 }} key={i}>
                  <div className="collapsible-body" style={{ padding: "14px 18px" }}>
                    <h4 className="mock-draftiq-team-header">
                      <PlayerLink fullName={team.captainName} identityKey={team.captainIdentityKey} />{" "}
                      <span className="stat-formula">
                        (avg value {team.avgDraftValue !== null ? (team.avgDraftValue > 0 ? "+" : "") + team.avgDraftValue : "\u2013"})
                      </span>
                    </h4>
                    <table className="profile-history-table">
                      <thead>
                        <tr>
                          <th>Pick #</th>
                          <th>Player</th>
                          <th>Entering Rank</th>
                          <th>Value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {team.picks.map((p, j) => (
                          <tr key={j}>
                            <td>#{p.pickOrder}</td>
                            <td>
                              <PlayerLink fullName={p.displayName} identityKey={p.identityKey} />
                            </td>
                            <td>{p.entryRank !== null ? "#" + p.entryRank : "\u2013"}</td>
                            <td className={p.value > 0 ? "outcome-win" : p.value < 0 ? "outcome-loss" : ""}>
                              {p.value !== null ? (p.value > 0 ? "+" : "") + p.value : "\u2013"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))
            )}
          </>
        )}
      </div>

      <h3 className="mock-section-heading">Available Players</h3>
      <DataTable
        columns={MOCK_PLAYER_COLUMNS}
        data={available}
        ownerKey="mockavailable"
        defaultSortColumn="conservativeRating"
        emptyMessage="No players remaining -- add a pool above"
      />

      <h3 className="mock-section-heading">Selected Players</h3>
      <DataTable
        columns={MOCK_SELECTED_COLUMNS}
        data={selectedRows}
        ownerKey="mockselected"
        defaultSortColumn="pickLabel"
        defaultSortDirection="asc"
        emptyMessage="No picks made yet"
      />
    </section>
  );
}
