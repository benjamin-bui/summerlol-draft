// Summary block listing the share of games played in each role. Reads the
// role off each history entry's own playerDetails, so it works for a player's
// history and for a champion's (where every entry is one pick of the champion).
import { ROLES, ROLE_LABELS } from "../../utils/format";

export default function RoleBreakdown({ history }) {
  const counts = new Map(ROLES.map((r) => [r, { games: 0, wins: 0, losses: 0, draws: 0 }]));
  let total = 0;
  for (const entry of history) {
    const role = entry.playerDetails?.[0]?.role;
    if (!counts.has(role)) continue;
    const count = counts.get(role);
    count.games += 1;
    if (entry.outcome === "win") count.wins += 1;
    else if (entry.outcome === "loss") count.losses += 1;
    else if (entry.outcome === "draw") count.draws += 1;
    total += 1;
  }
  if (!total) return null;
  return (
    <div className="profile-summary-roles">
      <h4>
        Role breakdown <span className="stat-formula">({total} {total === 1 ? "game" : "games"} with a role)</span>
      </h4>
      <div className="role-row role-row-header" aria-hidden="true">
        <span />
        <span />
        <span>% Games</span>
        <span>Win rate</span>
      </div>
      {ROLES.map((role) => {
        const { games, wins, losses, draws } = counts.get(role);
        const gameShare = (games / total) * 100;
        const winRate = games ? Math.round((wins / games) * 100) : null;
        const gameLabel = `${Math.round(gameShare)}%`;
        const winRateLabel = winRate == null ? "\u2013" : `${winRate}%`;
        return (
          <div className="role-row" title={`${games} of ${total} games; ${wins} wins, ${losses} losses${draws ? `, ${draws} draws` : ""}`} key={role}>
            <span>{ROLE_LABELS[role]}</span>
            <span className="role-bar">
              <span className="role-bar-fill" style={{ width: `${gameShare}%` }} role="img" aria-label={`${wins} wins, ${losses} losses, ${draws} draws`}>
                <span className="role-bar-win" style={{ flex: wins }} />
                <span className="role-bar-loss" style={{ flex: losses }} />
                {draws > 0 && <span className="role-bar-draw" style={{ flex: draws }} />}
              </span>
            </span>
            <strong>{gameLabel}</strong>
            <strong>{winRateLabel}</strong>
          </div>
        );
      })}
    </div>
  );
}
