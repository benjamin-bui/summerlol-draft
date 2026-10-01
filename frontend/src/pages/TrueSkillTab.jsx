import { useMemo, useState } from "react";
import { useAppData } from "../context/AppDataContext";
import DataTable from "../components/table/DataTable";
import FunFacts from "../components/shared/FunFacts";
import PlayerSearchBox from "../components/shared/PlayerSearchBox";
import NameFilterBox, { summarizeNameList } from "../components/shared/NameFilterBox";
import { TrueSkillValue, SoloQueueRank } from "../components/shared/Cells";
import { soloQueueSortValueClient } from "../utils/format";
import { buildNameMatcher } from "../utils/nameMatch";

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
  },
  {
    key: "conservativeRating",
    label: "TrueSkill (μ)",
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
  { key: "mu", label: "μ", sortable: true, hideable: true, filterable: true, type: "number", decimals: 2, className: "adj-avg", defaultHidden: true },
  { key: "sigma", label: "σ", sortable: true, hideable: true, filterable: true, type: "number", decimals: 2, defaultHidden: true },
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
          <strong>TrueSkill: </strong>Conservative TrueSkill score μ - σ; intended to deflate players with a small number of games and high uncertainty.
        </p>
        <p>
          <strong>μ: </strong>Estimated skill score. Everyone starts at 1000.
        </p>
        <p>
          <strong>σ: </strong>Uncertainty in player skill. Everyone starts at μ/3
        </p>
        <p>
          Note that win probabilities may not properly reflect listed TrueSkill scores. This is particularly common
          when there are new players with high uncertainty. Win probabilities are calculated based on the estimated
          skill score, not the conservative skill score.
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

      <DataTable
        columns={TRUESKILL_COLUMNS}
        data={players}
        ownerKey="trueskill"
        defaultSortColumn="conservativeRating"
        pagination={{ pageSizeOptions: [40, 80, 120, "all"], defaultPageSize: 40 }}
        externalFilter={externalFilter}
        emptyMessage="No rows match the active filters"
      />
    </section>
  );
}
