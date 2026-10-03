import { seasonRankLocal, tournamentKey } from "../../utils/profileCompute";

// "Filtered for:" tournament dropdown shared by the player and champion
// profile pages. `tournaments` is any list of { year, tournament }.
export default function ProfileTournamentFilter({ tournaments, value, onChange }) {
  if (!tournaments.length) return null;
  const sorted = [...tournaments].sort((a, b) => b.year - a.year || seasonRankLocal(b.tournament) - seasonRankLocal(a.tournament));
  return (
    <section className="profile-block profile-filter-block">
      <div className="profile-filter-row">
        <span>Filtered for:</span>
        <select className="tournament-filter-select" value={value || ""} onChange={(e) => onChange(e.target.value || null)}>
          <option value="">All</option>
          {sorted.map((t) => (
            <option value={tournamentKey(t)} key={tournamentKey(t)}>
              {t.tournament} {t.year}
            </option>
          ))}
        </select>
      </div>
    </section>
  );
}
