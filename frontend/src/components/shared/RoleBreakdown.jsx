// Summary block listing the share of games played in each role. Reads the
// role off each history entry's own playerDetails, so it works for a player's
// history and for a champion's (where every entry is one pick of the champion).
import { ROLES, ROLE_LABELS } from "../../utils/format";

export default function RoleBreakdown({ history }) {
  const counts = new Map(ROLES.map((r) => [r, 0]));
  let total = 0;
  for (const entry of history) {
    const role = entry.playerDetails?.[0]?.role;
    if (!counts.has(role)) continue;
    counts.set(role, counts.get(role) + 1);
    total += 1;
  }
  if (!total) return null;
  return (
    <div className="profile-summary-roles">
      <h4>
        Role breakdown <span className="stat-formula">({total} {total === 1 ? "game" : "games"} with a role)</span>
      </h4>
      {ROLES.map((role) => {
        const games = counts.get(role);
        const pct = Math.round((games / total) * 100);
        return (
          <div className="role-row" title={`${games} of ${total} games`} key={role}>
            <span>{ROLE_LABELS[role]}</span>
            <span className="role-bar">
              <span style={{ width: `${(games / total) * 100}%` }} />
            </span>
            <strong>{pct}%</strong>
          </div>
        );
      })}
    </div>
  );
}
