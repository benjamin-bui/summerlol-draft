import { useState } from "react";
import { PlayerLink, ChampionIcon, BanList, RoleIcon, TrueSkillValue } from "./Cells";
import { sortByRole, ROLE_LABELS } from "../../utils/format";

function RosterTable({ team, name, bans, gameHasBans, gameHasRoles, hasDetails, detailsByPlayer }) {
  const normalizePlayer = (v) => String(v || "").trim().toLowerCase();
  const orderedRoster = sortByRole(team?.roster || [], (member) => detailsByPlayer.get(normalizePlayer(member.displayName))?.role);
  return (
    <div>
      <strong>{name}</strong>
      {gameHasBans && <BanList bans={bans} />}
      <table className="match-details-table">
        <thead>
          <tr>
            <th>Player</th>
            <th>TrueSkill</th>
            {hasDetails && (
              <>
                <th>Champion</th>
                <th>K</th>
                <th>D</th>
                <th>A</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {orderedRoster.map((member, i) => {
            const detail = detailsByPlayer.get(normalizePlayer(member.displayName));
            return (
              <tr key={i}>
                <td>
                  <RoleIcon role={detail?.role} reserveSpace={gameHasRoles} />
                  <PlayerLink fullName={member.displayName} identityKey={member.identityKey} />
                </td>
                <td>
                  <TrueSkillValue rating={member.conservativeRating} />
                </td>
                {hasDetails && (
                  <>
                    <td>{detail ? <ChampionIcon champion={detail.champion} /> : "\u2013"}</td>
                    <td>{detail?.kills ?? "\u2013"}</td>
                    <td>{detail?.deaths ?? "\u2013"}</td>
                    <td>{detail?.assists ?? "\u2013"}</td>
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function HistoryRow({ entry, showRole }) {
  const [open, setOpen] = useState(false);
  const outcomeClass = entry.outcome === "win" ? "outcome-win" : entry.outcome === "loss" ? "outcome-loss" : "outcome-draw";
  const playerDetail = entry.playerDetails?.[0];
  const normalizePlayer = (v) => String(v || "").trim().toLowerCase();
  const detailsByPlayer = new Map((entry.details || []).map((d) => [normalizePlayer(d.player), d]));
  const hasDetails = (entry.details || []).length > 0;
  const gameHasRoles = (entry.details || []).some((d) => d.role);
  const gameHasBans = (entry.bans?.own?.length || 0) + (entry.bans?.opponent?.length || 0) > 0;
  const changeClass = entry.ratingChange > 0 ? "outcome-win" : entry.ratingChange < 0 ? "outcome-loss" : "";
  const changeLabel = entry.ratingChange > 0 ? `+${entry.ratingChange}` : `${entry.ratingChange}`;
  const predWinPct = Math.round((entry.predictedWinProb ?? 0) * 100);

  return (
    <>
      <tr>
        <td className="col-toggle">
          <button className="roster-toggle" aria-expanded={open} aria-label="Show match details" onClick={() => setOpen((o) => !o)}>
            {open ? "\u25bc" : "\u25b6"}
          </button>
        </td>
        <td className="col-match">
          <span className="cell-primary">
            {entry.year ?? "\u2013"} {entry.tournament || "\u2013"}
          </span>
          {entry.matchStage && <span className="cell-secondary">{entry.matchStage}</span>}
        </td>
        <td className="col-secondary col-matchup">
          <span className="cell-primary">{entry.ownTeam?.name || "\u2013"}</span>
          <span className="cell-secondary">vs {entry.opponent || "\u2013"}</span>
        </td>
        {showRole && (
          <td className="col-secondary col-role">
            <RoleIcon role={playerDetail?.role} />
          </td>
        )}
        <td>{playerDetail ? <ChampionIcon champion={playerDetail.champion} /> : "\u2013"}</td>
        <td>{playerDetail ? `${playerDetail.kills ?? "\u2013"}/${playerDetail.deaths ?? "\u2013"}/${playerDetail.assists ?? "\u2013"}` : "\u2013"}</td>
        <td className="col-result">
          <span className={`cell-primary ${outcomeClass}`}>{entry.outcome || "\u2013"}</span>
          <span className="cell-secondary">{predWinPct}% Win Prob.</span>
        </td>
        <td className="col-secondary col-ratings">
          <span className="cell-primary">{entry.ownTeam?.avgConservativeRating ?? "\u2013"}</span>
          <span className="cell-secondary">vs {entry.opponentTeam?.avgConservativeRating ?? "\u2013"}</span>
        </td>
        <td className="col-secondary col-trueskill">
          <span className="cell-primary">
            <TrueSkillValue rating={entry.conservativeRating} /> <span className={changeClass}>{changeLabel}</span>
          </span>
          <span className="cell-secondary">
            {"\u03bc"}
            {entry.mu ?? "\u2013"} {"\u03c3"}
            {entry.sigma ?? "\u2013"}
          </span>
        </td>
      </tr>
      {open && (
        <tr className="roster-detail-row">
          <td colSpan={showRole ? 9 : 8}>
            <div className="roster-detail">
              <RosterTable
                team={entry.ownTeam}
                name={entry.ownTeam?.name || "Your team"}
                bans={entry.bans?.own}
                gameHasBans={gameHasBans}
                gameHasRoles={gameHasRoles}
                hasDetails={hasDetails}
                detailsByPlayer={detailsByPlayer}
              />
              <RosterTable
                team={entry.opponentTeam}
                name={entry.opponentName || "Opponent"}
                bans={entry.bans?.opponent}
                gameHasBans={gameHasBans}
                gameHasRoles={gameHasRoles}
                hasDetails={hasDetails}
                detailsByPlayer={detailsByPlayer}
              />
            </div>
            <div className="match-extra-stats">
              {showRole && playerDetail?.role && (
                <div>
                  <span>Role</span>
                  <strong>{ROLE_LABELS[playerDetail.role] || playerDetail.role}</strong>
                </div>
              )}
              <div>
                <span>Captain</span>
                <strong>{entry.ownTeam?.name || "\u2013"}</strong>
              </div>
              <div>
                <span>Opponent</span>
                <strong>{entry.opponent || "\u2013"}</strong>
              </div>
              <div>
                <span>Your Team Avg</span>
                <strong>{entry.ownTeam?.avgConservativeRating ?? "\u2013"}</strong>
              </div>
              <div>
                <span>Opp Avg</span>
                <strong>{entry.opponentTeam?.avgConservativeRating ?? "\u2013"}</strong>
              </div>
              <div>
                <span>TrueSkill</span>
                <strong>
                  <TrueSkillValue rating={entry.conservativeRating} />
                </strong>
              </div>
              <div>
                <span>Change</span>
                <strong className={changeClass}>{changeLabel}</strong>
              </div>
              <div>
                <span>{"\u03bc"}</span>
                <strong>{entry.mu ?? "\u2013"}</strong>
              </div>
              <div>
                <span>{"\u03c3"}</span>
                <strong>{entry.sigma ?? "\u2013"}</strong>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default function ProfileHistoryTable({ entries, showRole }) {
  if (!entries.length) return <p>No matching games.</p>;
  return (
    <table className="profile-history-table">
      <thead>
        <tr>
          <th className="col-toggle">
            <span className="sr-only">Expand</span>
          </th>
          <th className="col-match">Match</th>
          <th className="col-secondary col-matchup">Matchup</th>
          {showRole && <th className="col-secondary col-role">Role</th>}
          <th>Champion</th>
          <th>K/D/A</th>
          <th className="col-result">Result</th>
          <th className="col-secondary col-ratings">Avg Rating</th>
          <th className="col-secondary col-trueskill">TrueSkill</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((entry, i) => (
          <HistoryRow entry={entry} showRole={showRole} key={i} />
        ))}
      </tbody>
    </table>
  );
}
