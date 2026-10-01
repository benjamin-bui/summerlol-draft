import { useState } from "react";
import { RankBadge } from "./Cells";

export default function FunFacts({ ff }) {
  const [open, setOpen] = useState(false);
  if (!ff) return null;

  return (
    <div className="fun-facts-box">
      <button className="fun-facts-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {open ? "\u25bc" : "\u25b6"} Fun facts
      </button>
      <div className="fun-facts-body" hidden={!open}>
        <h4>TrueSkill percentile cutoffs (League of Legends rank equivalent)</h4>
        <table className="fun-facts-table">
          <thead>
            <tr>
              <th>Rank</th>
              <th>Percentile</th>
              <th>Rating cutoff</th>
            </tr>
          </thead>
          <tbody>
            {(ff.staticCutoffs || []).map((p) => (
              <tr key={p.name}>
                <td className="rank-cell">
                  <RankBadge input={p.name} /> <span>{p.name}</span>
                </td>
                <td>{p.percentile}%</td>
                <td>{Number.isFinite(p.ratingCutoff) ? p.ratingCutoff : "\u2013"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <ul className="fun-facts-list">
          {ff.biggestUpset && (
            <li>
              <strong>Biggest upset:</strong> {ff.biggestUpset.winnerName} (avg {ff.biggestUpset.winnerAvgBefore})
              over {ff.biggestUpset.loserName} (avg {ff.biggestUpset.loserAvgBefore}) in {ff.biggestUpset.tournament}{" "}
              {ff.biggestUpset.year} - only a {Math.round(ff.biggestUpset.predictedWinProbForWinner * 100)}% predicted
              chance.{" "}
              {ff.biggestUpset.mvpName
                ? `${ff.biggestUpset.mvpName} swung ${ff.biggestUpset.mvpRatingChange > 0 ? "+" : ""}${ff.biggestUpset.mvpRatingChange} TrueSkill.`
                : ""}
            </li>
          )}
          {ff.longestStreak && (
            <li>
              <strong>Longest win streak:</strong> {ff.longestStreak.displayName}, {ff.longestStreak.streak} games
            </li>
          )}
          {ff.longestLossStreak && (
            <li>
              <strong>Longest losing streak:</strong> {ff.longestLossStreak.displayName}, {ff.longestLossStreak.streak}{" "}
              games
            </li>
          )}
          {ff.peakRating && (
            <li>
              <strong>Highest TrueSkill ever reached:</strong> {ff.peakRating.displayName},{" "}
              {ff.peakRating.conservativeRating} ({ff.peakRating.tournament} {ff.peakRating.year})
            </li>
          )}
          {ff.mostGamesPlayed && (
            <li>
              <strong>Most games played:</strong> {ff.mostGamesPlayed.displayName}, {ff.mostGamesPlayed.games} games
            </li>
          )}
          {ff.mostActiveRivalry && (
            <li>
              <strong>Most active rivalry:</strong> {ff.mostActiveRivalry.teamAName} vs {ff.mostActiveRivalry.teamBName},{" "}
              {ff.mostActiveRivalry.gamesPlayed} games played ({ff.mostActiveRivalry.teamAWins}-
              {ff.mostActiveRivalry.teamBWins})
            </li>
          )}
          {ff.everMaster && (
            <li>
              <strong>Ever hit Master rank ({ff.everMaster.length}):</strong>{" "}
              {ff.everMaster.map((p) => p.group || p.displayName).join(", ")}
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}
