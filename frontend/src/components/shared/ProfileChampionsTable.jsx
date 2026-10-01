import { ChampionIcon } from "./Cells";
import { CHAMPION_SORTS, sortChampionStats } from "../../utils/profileCompute";

function SortHeader({ column, hint, extraClass, sort, onSort }) {
  const active = sort?.column === column;
  const asc = sort?.dir === "asc";
  const cls = [extraClass, active ? (asc ? "sorted-asc" : "sorted-desc") : ""].filter(Boolean).join(" ");
  const label = CHAMPION_SORTS[column].label;
  const title = hint ? `${hint} Click to sort.` : `Sort by ${label.toLowerCase()}`;
  return (
    <th
      className={cls || undefined}
      tabIndex={0}
      aria-sort={active ? (asc ? "ascending" : "descending") : "none"}
      title={title}
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

export default function ProfileChampionsTable({ championStats, extras = [], sort, setSort }) {
  if (!championStats.length) {
    return (
      <section className="profile-block">
        <h3>Champions</h3>
        <p className="stat-formula">No champion data recorded yet.</p>
      </section>
    );
  }

  function onSort(column) {
    setSort((prev) => (prev?.column === column ? { column, dir: prev.dir === "asc" ? "desc" : "asc" } : { column, dir: CHAMPION_SORTS[column].firstDir }));
  }

  const sorted = sortChampionStats(championStats, sort);
  const showBannedAgainst = extras.includes("bannedAgainst");

  return (
    <section className="profile-block">
      <h3>Champions</h3>
      <table className="profile-champions-table">
        <thead>
          <tr>
            <SortHeader column="champion" sort={sort} onSort={onSort} />
            <SortHeader column="games" sort={sort} onSort={onSort} />
            <SortHeader column="winRate" sort={sort} onSort={onSort} />
            <SortHeader column="kda" sort={sort} onSort={onSort} />
            {showBannedAgainst && (
              <SortHeader
                column="bannedAgainst"
                extraClass="col-banned-against"
                hint="Games where an opposing team banned this champion. Bans are a team-level choice, so this isn't specific to this player. Champions banned against them but never played show 0 games."
                sort={sort}
                onSort={onSort}
              />
            )}
          </tr>
        </thead>
        <tbody>
          {sorted.map((c) => {
            const played = c.games > 0;
            const winRate = played && c.winRate != null ? `${Math.round(c.winRate * 100)}%` : "\u2013";
            const kda = !played ? "\u2013" : c.kda == null ? "Perfect" : c.kda.toFixed(2);
            return (
              <tr key={c.key || c.champion}>
                <td>
                  <ChampionIcon champion={c.champion} />
                </td>
                <td>{c.games}</td>
                <td>{winRate}</td>
                <td>{kda}</td>
                {showBannedAgainst && <td>{c.bannedAgainst == null ? "\u2013" : String(c.bannedAgainst)}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
