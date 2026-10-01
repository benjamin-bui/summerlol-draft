import { useEffect, useState } from "react";
import { api } from "../api/client";
import DataTable from "../components/table/DataTable";
import { TrueSkillValue } from "../components/shared/Cells";

const TEAM_BALANCE_COLUMNS = [
  { key: "year", label: "Year", sortable: true, hideable: true, filterable: true, type: "number", decimals: 0 },
  { key: "tournament", label: "Tournament", sortable: true, hideable: true, filterable: true, type: "string", filterType: "checkbox" },
  { key: "captain", label: "Captain", sortable: true, hideable: false, filterable: true, type: "string", className: "group-name" },
  { key: "avgEntryRating", label: "Avg Entry TrueSkill", sortable: true, hideable: true, filterable: true, type: "number", decimals: 2, className: "adj-avg" },
  { key: "finalStage", label: "Final Stage", sortable: true, hideable: true, filterable: true, type: "string", filterType: "checkbox" },
  { key: "wins", label: "Wins", sortable: true, hideable: true, filterable: true, type: "number", decimals: 0 },
  { key: "losses", label: "Losses", sortable: true, hideable: true, filterable: true, type: "number", decimals: 0 },
  { key: "winRate", label: "Win Rate", sortable: true, hideable: true, filterable: true, type: "number", decimals: 0, percentage: true },
];

function TeamMatchDetail({ row }) {
  const roster = row.roster || [];
  const matches = row.matches || [];
  return (
    <>
      <div className="roster-detail">
        <div>
          <strong>Roster</strong>
          {roster.length ? (
            <ul className="roster-detail-list">
              {roster.map((m, i) => (
                <li key={i}>
                  {m.displayName} <span className="roster-rating"><TrueSkillValue rating={m.conservativeRating} /></span>
                </li>
              ))}
            </ul>
          ) : (
            <p>No roster on file.</p>
          )}
        </div>
      </div>
      <div className="team-matches-section">
        <strong>Matches</strong>
        {matches.length ? (
          <table className="profile-history-table">
            <thead>
              <tr>
                <th>Opponent(s)</th>
                <th>Result</th>
                <th>Stage</th>
                <th>Win Prob. %</th>
              </tr>
            </thead>
            <tbody>
              {matches.map((m, i) => {
                const outcomeClass = m.outcome === "win" ? "outcome-win" : m.outcome === "loss" ? "outcome-loss" : "outcome-draw";
                return (
                  <tr key={i}>
                    <td>{m.opponentName}</td>
                    <td className={outcomeClass}>{m.outcome}</td>
                    <td>{m.matchStage || "\u2013"}</td>
                    <td>{Math.round((m.predictedWinProb ?? 0) * 100)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p>No matches recorded.</p>
        )}
      </div>
    </>
  );
}

export default function TeamBalanceTab({ active }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    if (active && !data) {
      api.draftAnalysis().then((d) => setData(d.teamBalance));
    }
  }, [active, data]);

  return (
    <section className={`tab-panel${active ? " active" : ""}`}>
      {data ? (
        <DataTable
          columns={TEAM_BALANCE_COLUMNS}
          data={data}
          ownerKey="teambalance"
          defaultSortColumn="avgEntryRating"
          emptyMessage="No team balance data available"
          expandable={{ getDetail: (row) => <TeamMatchDetail row={row} /> }}
        />
      ) : (
        <p>Loading{"\u2026"}</p>
      )}
    </section>
  );
}
