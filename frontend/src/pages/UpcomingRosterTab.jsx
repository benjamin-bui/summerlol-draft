import { useEffect, useState } from "react";
import { api } from "../api/client";
import { TrueSkillValue, SoloQueueRank, PlayerLink } from "../components/shared/Cells";

export default function UpcomingRosterTab({ active, onTitle }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    api
      .upcomingRoster()
      .then((res) => {
        if (res && res.exists) {
          setData(res);
          onTitle(res.title);
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!data) return null;

  return (
    <section className={`tab-panel${active ? " active" : ""}`}>
      {data.teams.map((team, i) => {
        const captain = team.captain;
        return (
          <div className="fun-facts-box" style={{ marginBottom: 16 }} key={i}>
            <div className="collapsible-body" style={{ padding: "16px 18px" }}>
              <h4>
                <PlayerLink
                  fullName={captain.displayName}
                  identityKey={captain.identityKey}
                  identified={captain.identified}
                  profileUrl={captain.profileUrl}
                  allowSimpleFallback
                />
              </h4>
              <div className="profile-summary">
                <span>
                  Avg Entry TrueSkill: {team.avgEntryRating !== null ? <TrueSkillValue rating={team.avgEntryRating} /> : "\u2013"} ({team.ratedCount}/
                  {team.totalCount} rated)
                </span>
                <span>Draft IQ: {team.draftIQ !== null ? (team.draftIQ > 0 ? "+" : "") + team.draftIQ : "\u2013"}</span>
              </div>
              <table className="profile-history-table">
                <thead>
                  <tr>
                    <th>Pick #</th>
                    <th>Player</th>
                    <th>TrueSkill</th>
                    <th>Solo Queue</th>
                    <th>Flex Queue</th>
                    <th>Rank</th>
                    <th>Value</th>
                  </tr>
                </thead>
                <tbody>
                  {team.roster.map((p, j) => (
                    <tr key={j} className={p.isCaptain ? "roster-captain-row" : ""}>
                      <td>{p.isCaptain ? "Cap" : `#${p.pickOrder}`}</td>
                      <td>
                        <PlayerLink
                          fullName={p.displayName}
                          identityKey={p.identityKey}
                          identified={p.identified}
                          profileUrl={p.profileUrl}
                          allowSimpleFallback
                        />
                      </td>
                      <td>
                        {p.conservativeRating !== null ? (
                          <TrueSkillValue rating={p.conservativeRating} mu={p.mu} />
                        ) : (
                          <span className="stat-formula">Unrated (No games yet)</span>
                        )}
                      </td>
                      <td>
                        <SoloQueueRank rank={p.soloQueueRank} />
                      </td>
                      <td>
                        <SoloQueueRank rank={p.flexQueueRank} />
                      </td>
                      <td>{p.entryRank !== null ? `#${p.entryRank}` : "\u2013"}</td>
                      <td className={p.value > 0 ? "outcome-win" : p.value < 0 ? "outcome-loss" : ""}>
                        {p.value !== null ? (p.value > 0 ? "+" : "") + p.value : "\u2013"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </section>
  );
}
