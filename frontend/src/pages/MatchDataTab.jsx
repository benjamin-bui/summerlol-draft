import { useEffect, useState } from "react";
import { api, downloadUrl } from "../api/client";
import DataTable from "../components/table/DataTable";
import { coerceNumericColumns } from "../components/table/tableLogic";
import { ChampionIcon, BanList, RoleIcon, TrueSkillValue } from "../components/shared/Cells";
import { sortByRole } from "../utils/format";

const MATCH_DATA_COLUMNS = [
  {
    key: "year",
    label: "Year",
    sortable: true,
    hideable: true,
    filterable: true,
    filterType: "checkbox",
    type: "number",
    decimals: 0,
    sortValue: (row) => {
      const summerFirst = String(row.tournament || "").toLowerCase() === "summer" ? 1 : 0;
      return Number(row.year || 0) * 1000000000 + summerFirst * 10000000 + Number(row.match_order || 0);
    },
  },
  { key: "tournament", label: "Tournament", sortable: true, hideable: true, filterable: true, type: "string", filterType: "checkbox" },
  { key: "team1", label: "Team 1", sortable: true, hideable: true, filterable: true, type: "string" },
  { key: "team2", label: "Team 2", sortable: true, hideable: true, filterable: true, type: "string" },
  { key: "result", label: "Result", sortable: true, hideable: true, filterable: true, type: "string" },
  { key: "match_order", label: "Match Order", sortable: true, hideable: true, filterable: true, type: "number", decimals: 0 },
  { key: "match_stage", label: "Match Stage", sortable: true, hideable: true, filterable: true, type: "string" },
  { key: "csv_row_index", label: "CSV Row", sortable: true, hideable: true, filterable: true, type: "number", decimals: 0, defaultHidden: true },
];

function MatchRosterDetail({ row }) {
  const normalizePlayer = (value) => String(value || "").trim().toLowerCase();
  const detailsByPlayer = new Map((row.match_details || []).map((detail) => [normalizePlayer(detail.player), detail]));
  const matchHasRoles = (row.match_details || []).some((d) => d.role);
  const hasBans = (row.bans?.team1?.length || 0) + (row.bans?.team2?.length || 0) > 0;

  const teamTable = (team, name, bans) => {
    const roster = sortByRole(team?.roster || [], (member) => detailsByPlayer.get(normalizePlayer(member.displayName))?.role);
    const hasDetails = !!row.match_details?.length;
    return (
      <div>
        <strong>{name}</strong> - avg TrueSkill: <TrueSkillValue rating={team?.avg} mu={team?.avgMu} />
        {hasBans && <BanList bans={bans} />}
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
            {roster.map((member, i) => {
              const detail = detailsByPlayer.get(normalizePlayer(member.displayName));
              return (
                <tr key={i}>
                  <td>
                    <RoleIcon role={detail?.role} reserveSpace={matchHasRoles} />
                    {member.displayName}
                  </td>
                  <td>
                    <TrueSkillValue rating={member.conservativeRating} mu={member.mu} />
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
  };

  return (
    <div className="roster-detail">
      {teamTable(row._team1Roster, row._team1Roster?.name || row.team1, row.bans?.team1)}
      {teamTable(row._team2Roster, row._team2Roster?.name || row.team2, row.bans?.team2)}
    </div>
  );
}

export default function MatchDataTab({ active }) {
  const [rows, setRows] = useState(null);

  useEffect(() => {
    if (active && !rows) {
      api.rawMatches().then((data) => {
        coerceNumericColumns(MATCH_DATA_COLUMNS.map((c) => c.key), data.rows);
        setRows(data.rows);
      });
    }
  }, [active, rows]);

  return (
    <section className={`tab-panel${active ? " active" : ""}`}>
      {rows ? (
        <DataTable
          columns={MATCH_DATA_COLUMNS}
          data={rows}
          ownerKey="matchdata"
          defaultSortColumn="year"
          emptyMessage="No rows match the active filters"
          expandable={{ getDetail: (row) => <MatchRosterDetail row={row} /> }}
          extraControls={
            <button className="download-btn" onClick={() => downloadUrl("/api/raw-matches.csv", "match-data.csv")}>
              Download CSV
            </button>
          }
        />
      ) : (
        <p>Loading{"\u2026"}</p>
      )}
    </section>
  );
}
