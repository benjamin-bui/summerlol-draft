import { useState } from "react";
import { PlayerLink } from "./Cells";

const compareNumbers = (x, y) => (x === y ? 0 : x < y ? -1 : 1);

// Same shape as CHAMPION_SORTS in profileCompute: how each column sorts and
// which way its first click goes. A null KDA means zero deaths ("Perfect"), so
// it sorts above every real number.
const PLAYER_SORTS = {
  name: { label: "Player", firstDir: "asc", compare: (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) },
  games: { label: "Games", firstDir: "desc", compare: (a, b) => compareNumbers(a.games, b.games) },
  winRate: { label: "Win rate", firstDir: "desc", compare: (a, b) => compareNumbers(a.winRate ?? -1, b.winRate ?? -1) },
  kda: { label: "Avg KDA", firstDir: "desc", compare: (a, b) => compareNumbers(a.kda === null ? Infinity : a.kda, b.kda === null ? Infinity : b.kda) },
};

function SortHeader({ column, sort, onSort }) {
  const active = sort.column === column;
  const asc = sort.dir === "asc";
  const label = PLAYER_SORTS[column].label;
  return (
    <th
      className={active ? (asc ? "sorted-asc" : "sorted-desc") : undefined}
      tabIndex={0}
      aria-sort={active ? (asc ? "ascending" : "descending") : "none"}
      title={`Sort by ${label.toLowerCase()}`}
      onClick={() => onSort(column)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSort(column);
        }
      }}
    >
      {label}
    </th>
  );
}

// Everyone who has picked the champion: their games, win rate and KDA on it.
// `players` comes from computeChampionPlayers (already most-games first).
export default function ChampionPlayersTable({ players }) {
  const [sort, setSort] = useState({ column: null, dir: "desc" });

  if (!players.length) {
    return (
      <section className="profile-block">
        <h3>Players</h3>
        <p className="stat-formula">No one has picked this champion yet.</p>
      </section>
    );
  }

  function onSort(column) {
    setSort((prev) => (prev.column === column ? { column, dir: prev.dir === "asc" ? "desc" : "asc" } : { column, dir: PLAYER_SORTS[column].firstDir }));
  }

  const sign = sort.dir === "asc" ? 1 : -1;
  const rows = sort.column
    ? players
        .map((player, index) => ({ player, index }))
        .sort((x, y) => sign * PLAYER_SORTS[sort.column].compare(x.player, y.player) || y.player.games - x.player.games || x.index - y.index)
        .map((entry) => entry.player)
    : players;

  return (
    <section className="profile-block">
      <h3>Players</h3>
      <table className="profile-champions-table champion-players-table">
        <thead>
          <tr>
            <SortHeader column="name" sort={sort} onSort={onSort} />
            <SortHeader column="games" sort={sort} onSort={onSort} />
            <SortHeader column="winRate" sort={sort} onSort={onSort} />
            <SortHeader column="kda" sort={sort} onSort={onSort} />
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.identityKey}>
              <td>
                <PlayerLink fullName={p.name} identityKey={p.identityKey} />
              </td>
              <td>{p.games}</td>
              <td>{p.winRate != null ? `${Math.round(p.winRate * 100)}%` : "\u2013"}</td>
              <td>{p.kda == null ? "Perfect" : p.kda.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
