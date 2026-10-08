import { useMemo, useState } from "react";
import { PlayerLink } from "./Cells";
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

  if (!tournaments.length) return null;

  const accuracyText = (s) => (s.accuracy != null ? `${Math.round(s.accuracy * 100)}% (${s.favoriteWins}/${s.favoriteGames})` : dash);
  // Skill score: 0 = no better than a coin flip, 1 = perfect, negative = worse
  // than a coin flip. Rounded first so a value like -0.003 reads "0.00" rather
  // than "-0.00"; negatives get a true minus sign so they can't be misread.
  const skillText = (s) => {
    if (s.skill == null) return dash;
    const v = Math.round(s.skill * 100) / 100;
    return v < 0 ? `\u2212${Math.abs(v).toFixed(2)}` : v.toFixed(2);
  };
  const brierTitle = (s) => (s.brier != null ? `Brier score ${s.brier.toFixed(3)} (0 = perfect, 0.25 = coin flip)` : undefined);

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
                <th title="How much better the pre-game win probabilities were than always guessing 50/50, as a Brier skill score: 0 = no better than a coin flip, 1 = perfect, negative = worse than a coin flip.">
                  Prediction skill
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
                  <td title={brierTitle(stats)}>{skillText(stats)}</td>
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
                <td title={brierTitle(overall)}>{skillText(overall)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="stat-formula">
          Win-probability columns use decisive games only. Prediction skill is 0 when the pre-game win probabilities were no better than always saying 50/50
          and 1 when they were perfect; a negative value means worse than a coin flip. Hover a score for the underlying Brier score.
        </p>
      </div>
    </div>
  );
}
