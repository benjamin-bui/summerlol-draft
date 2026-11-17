import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAppData } from "../context/AppDataContext";
import DataTable from "../components/table/DataTable";
import FunFacts from "../components/shared/FunFacts";
import PlayerSearchBox from "../components/shared/PlayerSearchBox";
import NameFilterBox, { summarizeNameList } from "../components/shared/NameFilterBox";
import { TrueSkillValue, SoloQueueRank } from "../components/shared/Cells";
import { soloQueueSortValueClient } from "../utils/format";
import { buildNameMatcher } from "../utils/nameMatch";
import { tournamentRouteIdFromLabel } from "../utils/profileCompute";
import {
  filterPlayerHistory,
  getPlayerGameFilterOptions,
  roleFilterLabel,
  summarizePlayerGames,
  tournamentFilterKey,
  UNRECORDED_ROLE,
} from "../utils/playerGameFilters";

const TRUESKILL_COLUMNS = [
  { key: "rank", label: "#", sortable: false, hideable: false, filterable: false },
  {
    key: "group",
    label: "Player",
    sortable: true,
    hideable: false,
    filterable: true,
    className: "group-name",
    type: "string",
    sticky: true,
  },
  {
    key: "latestGameTournament",
    label: "Latest Tournament",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "string",
    render: (value) => {
      const tournamentId = tournamentRouteIdFromLabel(value);
      return tournamentId ? (
        <Link className="profile-tournament-link" to={`/?tab=tournaments&tournament=${tournamentId}`}>
          {value}
        </Link>
      ) : (
        value ?? "\u2013"
      );
    },
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
    render: (val, row) => <TrueSkillValue rating={row.conservativeRating} />,
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
  {
    key: "championDiversity",
    label: "Champion Diversity",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "number",
    decimals: 2,
    // Blank for players without enough games with a recorded champion: the
    // index can't exceed 1 - 1/n for n games, so small samples aren't comparable.
    render: (val, row) =>
      val == null ? (
        <span title={`Needs at least ${row.championDiversityMinGames ?? 10} games with a recorded champion`}>{"\u2013"}</span>
      ) : (
        <span title={`Gini\u2013Simpson index over ${row.championDiversityGames} games with a recorded champion (higher = more varied)`}>{val.toFixed(2)}</span>
      ),
  },
  { key: "games", label: "Games", sortable: true, hideable: true, filterable: true, type: "number", decimals: 0 },
  { key: "tournaments", label: "Tournaments", sortable: true, hideable: true, filterable: true, type: "number", decimals: 0 },
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
    render: (val, row) => {
      const games = row.games || 0;
      const wins = row.wins || 0;
      return games === 0 ? "0.0%" : ((wins / games) * 100).toFixed(1) + "%";
    },
  },
];

export default function TrueSkillTab({ active }) {
  const { players, funFacts } = useAppData();
  const [filterText, setFilterText] = useState("");
  const [summary, setSummary] = useState(null);
  const [selectedTournament, setSelectedTournament] = useState("");
  const [selectedRole, setSelectedRole] = useState("");

  const filterOptions = useMemo(() => getPlayerGameFilterOptions(players), [players]);

  // Preserve the career-wide TrueSkill and ranked ratings while recomputing
  // game-based statistics from each player's matching history.
  const tableRows = useMemo(() => {
    const byKey = new Map((funFacts?.championDiversity?.players || []).map((d) => [d.key, d]));
    const minGames = funFacts?.championDiversity?.minGames;
    const hasFilters = !!selectedTournament || !!selectedRole;
    return players.flatMap((p) => {
      const d = byKey.get(p.identityKey);
      if (!Array.isArray(p.history) || !p.history.length) {
        if (hasFilters) return [];
        return [{
          ...p,
          championDiversity: d ? d.diversity : null,
          championDiversityGames: d ? d.games : null,
          championDiversityMinGames: minGames,
        }];
      }

      const history = filterPlayerHistory(p.history, selectedTournament, selectedRole);
      if (!history.length) return [];
      return [{
        ...p,
        ...summarizePlayerGames(history, minGames),
        championDiversityMinGames: minGames,
      }];
    });
  }, [players, funFacts, selectedTournament, selectedRole]);

  const externalFilter = useMemo(() => {
    if (!filterText.trim()) return null;
    const result = summarizeNameList(filterText, players, buildNameMatcher);
    return result ? result.matcher.matches.bind(result.matcher) : null;
  }, [filterText, players]);

  function applyFilter(text) {
    setFilterText(text);
    if (!text.trim()) {
      setSummary(null);
      return;
    }
    const result = summarizeNameList(text, players, buildNameMatcher);
    if (!result) {
      setSummary(null);
      return;
    }
    setSummary(
      result.unmatched.length
        ? `Matched ${result.matchedCount}/${result.totalCount}. Unmatched: ${result.unmatched.join(", ")}`
        : `Matched all ${result.matchedCount} names.`,
    );
  }

  return (
    <section className={`tab-panel${active ? " active" : ""}`}>
      <section className="control-panel">
        <h3>Bayesian TrueSkill score, courtesy of Microsoft (or at least what is publically available and trivial to replicate).</h3>
        <p>
          Note that win probabilities may not properly reflect listed TrueSkill scores. This is particularly common
          for new players with high uncertainty. Win probabilities use estimated skill rather than the adjusted
          rating shown here.
        </p>
      </section>

      <FunFacts ff={funFacts} />

      <div className="profile-search">
        <PlayerSearchBox />
      </div>

      <NameFilterBox
        label="Filter by list (paste names, one per line or comma-separated, or upload a CSV/text file):"
        textareaId="nameFilterInput"
        placeholder={"Voidliss\nXemacs\n..."}
        onApply={applyFilter}
        summary={summary && <span className={`name-filter-summary${summary.startsWith("Matched all") ? "" : " has-misses"}`}>{summary}</span>}
      />

      <div className="player-game-filters" aria-label="Filter player statistics by game">
        <label>
          Tournament
          <select
            aria-label="Filter by tournament"
            value={selectedTournament}
            onChange={(event) => setSelectedTournament(event.target.value)}
          >
            <option value="">All tournaments</option>
            {filterOptions.tournaments.map((tournament) => (
              <option value={tournamentFilterKey(tournament)} key={tournamentFilterKey(tournament)}>
                {tournament.tournament} {tournament.year}
              </option>
            ))}
          </select>
        </label>
        <label>
          Role
          <select aria-label="Filter by role" value={selectedRole} onChange={(event) => setSelectedRole(event.target.value)}>
            <option value="">All roles</option>
            {filterOptions.roles.map((role) => (
              <option value={role} key={role}>{roleFilterLabel(role)}</option>
            ))}
            {filterOptions.hasUnrecordedRole && (
              <option value={UNRECORDED_ROLE}>{roleFilterLabel(UNRECORDED_ROLE)}</option>
            )}
          </select>
        </label>
      </div>
      <p className="player-game-filter-note">
        Game counts, win rates, and champion diversity use the selected games. TrueSkill and ranked queue ratings remain career-wide.
      </p>

      <DataTable
        columns={TRUESKILL_COLUMNS}
        data={tableRows}
        ownerKey="trueskill"
        defaultSortColumn="conservativeRating"
        pagination={{ pageSizeOptions: [40, 80, 120, "all"], defaultPageSize: 40 }}
        externalFilter={externalFilter}
        emptyMessage="No rows match the active filters"
      />
    </section>
  );
}
