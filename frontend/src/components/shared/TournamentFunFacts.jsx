import { useMemo, useState } from "react";
import { PlayerLink } from "./Cells";
import CalibrationChart from "./CalibrationChart";
import { predictionStats } from "../../utils/predictionStats";

const dash = "\u2013";

function winnersOf(t) {
  return (t.teams || []).filter((team) => team.placement === 1);
}

function playerCount(t) {
  const keys = new Set();
  for (const team of t.teams || []) for (const m of team.roster || []) keys.add(m.identityKey);
  return keys.size;
}

// Cross-tournament comparison: who won, how big it was, how varied the
// champion picks were, and how well the pre-game win probabilities held up.
// Everything is derived from the /api/tournaments summaries already loaded.
export default function TournamentFunFacts({ tournaments }) {
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState("all");

  const rows = useMemo(
    () =>
      tournaments.map((t) => ({
        t,
        winners: winnersOf(t),
        players: playerCount(t),
        diversity: t.summary?.diversity?.diversity ?? null,
        stats: predictionStats(t.matches),
      })),
    [tournaments],
  );
  const allMatches = useMemo(() => tournaments.flatMap((t) => t.matches || []), [tournaments]);
  const overall = useMemo(() => predictionStats(allMatches), [allMatches]);
  const chartMatches = scope === "all" ? allMatches : tournaments.find((t) => t.id === scope)?.matches || [];

  if (!tournaments.length) return null;

  const accuracyText = (s) => (s.accuracy != null ? `${Math.round(s.accuracy * 100)}% (${s.favoriteWins}/${s.favoriteGames})` : dash);
  const brierText = (s) => (s.brier != null ? s.brier.toFixed(3) : dash);
  const skillText = (s) => (s.skill != null ? `${s.skill >= 0 ? "+" : ""}${Math.round(s.skill * 100)}% vs. coin flip` : undefined);

  return (
    <div className="fun-facts-box tournament-fun-facts">
      <button className="fun-facts-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {open ? "\u25bc" : "\u25b6"} Fun facts
      </button>
      <div className="fun-facts-body" hidden={!open}>
        <h4>Tournament comparison</h4>
        <div className="table-section">
          <table className="fun-facts-table tournament-fun-facts-table">
            <thead>
              <tr>
                <th>Tournament</th>
                <th>Winner</th>
                <th>Players</th>
                <th>Games</th>
                <th title="1 minus the Gini coefficient of how often each available champion was picked or banned. Higher = more varied.">Champion diversity</th>
                <th title="How often the pre-game favorite won (games predicted at exactly 50% have no favorite).">Favorite won</th>
                <th title="Mean squared error of the win probability against the result. 0 is perfect; 0.25 is what always guessing 50% scores; higher than 0.25 is worse than a coin flip.">
                  Brier score
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ t, winners, players, diversity, stats }) => (
                <tr key={t.id}>
                  <td>{t.label}</td>
                  <td>
                    {winners.length
                      ? winners.map((w, i) => (
                          <span key={w.captainKey}>
                            {i > 0 && ", "}
                            <PlayerLink fullName={w.captainName} identityKey={w.captainKey} />
                          </span>
                        ))
                      : dash}
                  </td>
                  <td>{players}</td>
                  <td>{t.gamesPlayed}</td>
                  <td>{diversity != null ? diversity.toFixed(2) : dash}</td>
                  <td>{accuracyText(stats)}</td>
                  <td title={skillText(stats)}>{brierText(stats)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>All tournaments</td>
                <td>{dash}</td>
                <td>{dash}</td>
                <td>{tournaments.reduce((s, t) => s + t.gamesPlayed, 0)}</td>
                <td>{dash}</td>
                <td>{accuracyText(overall)}</td>
                <td title={skillText(overall)}>{brierText(overall)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="stat-formula">
          Win-probability columns use decisive games only. Brier score: 0 = perfect, 0.25 = no better than always saying 50/50. Hover a score for how it
          compares with that coin flip.
        </p>

        <h4>Win probability vs. actual results</h4>
        <div className="profile-filter-row">
          <label htmlFor="calibration-scope">Show:</label>
          <select id="calibration-scope" className="tournament-filter-select" value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="all">All tournaments</option>
            {tournaments.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <CalibrationChart matches={chartMatches} />
      </div>
    </div>
  );
}
