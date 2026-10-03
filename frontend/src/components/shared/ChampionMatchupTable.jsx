import { ChampionLink } from "./Cells";
import { ROLE_LABELS } from "../../utils/format";

export default function ChampionMatchupTable({ matchups }) {
  return (
    <section className="profile-block">
      <h3>Champion Matchups</h3>
      {matchups.length ? (
        <table className="profile-champions-table champion-matchup-table">
          <thead>
            <tr>
              <th>Role</th>
              <th>Enemy champion</th>
              <th>Games</th>
              <th>Win rate</th>
              <th>KDA</th>
            </tr>
          </thead>
          <tbody>
            {matchups.map((matchup) => (
              <tr key={matchup.key}>
                <td>{ROLE_LABELS[matchup.role] || matchup.role}</td>
                <td>
                  <ChampionLink champion={matchup.champion} championKey={matchup.championKey} />
                </td>
                <td>{matchup.games}</td>
                <td>{matchup.winRate != null ? `${Math.round(matchup.winRate * 100)}%` : "–"}</td>
                <td>{matchup.kda == null ? "Perfect" : matchup.kda.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="stat-formula">No same-role matchups recorded.</p>
      )}
    </section>
  );
}