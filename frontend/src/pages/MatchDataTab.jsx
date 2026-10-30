import { useEffect, useRef, useState } from "react";
import { api, downloadUrl } from "../api/client";
import DataTable from "../components/table/DataTable";
import { coerceNumericColumns } from "../components/table/tableLogic";
import { ChampionLink, BanList, RoleIcon, TrueSkillValue } from "../components/shared/Cells";
import MatchDetailEditor from "../components/shared/MatchDetailEditor";
import ReplayImportDialog from "../components/shared/ReplayImportDialog";
import TournamentStructureEditor from "../components/shared/TournamentStructureEditor";
import { ReplayError, readReplayFile } from "../utils/roflReplay";
import { useAuth } from "../context/AuthContext";
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
  { key: "stage_name", label: "Tournament Stage", sortable: true, hideable: true, filterable: true, type: "string" },
  { key: "series_round", label: "Series / Round", sortable: true, hideable: true, filterable: true, type: "string" },
  { key: "best_of", label: "Best Of", sortable: true, hideable: true, filterable: true, type: "number", decimals: 0 },
  { key: "game_number", label: "Game In Series", sortable: true, hideable: true, filterable: true, type: "number", decimals: 0 },
  { key: "csv_row_index", label: "CSV Row", sortable: true, hideable: true, filterable: true, type: "number", decimals: 0, defaultHidden: true },
];

function MatchRosterDetail({ row, onEdit }) {
  const normalizePlayer = (value) => String(value || "").trim().toLowerCase();
  const detailsByPlayer = new Map((row.match_details || []).map((detail) => [normalizePlayer(detail.player), detail]));
  const matchHasRoles = (row.match_details || []).some((d) => d.role);
  const hasBans = (row.bans?.team1?.length || 0) + (row.bans?.team2?.length || 0) > 0;

  const teamTable = (team, name, bans) => {
    const roster = sortByRole(team?.roster || [], (member) => detailsByPlayer.get(normalizePlayer(member.displayName))?.role);
    const hasDetails = !!row.match_details?.length;
    return (
      <div className="match-roster">
        <strong className="match-roster-name">{name}</strong> - avg TrueSkill: <TrueSkillValue rating={team?.avg} mu={team?.avgMu} />
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
                      <td>{detail ? <ChampionLink champion={detail.champion} championKey={detail.championKey} /> : "\u2013"}</td>
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
    <div className="match-rosters">
      {onEdit && (
        <div className="match-editor-launch">
          <button type="button" className="columns-btn" onClick={() => onEdit(row)}>
            Edit match details
          </button>
        </div>
      )}
      <div className="roster-detail match-rosters-grid">
        {teamTable(row._team1Roster, row._team1Roster?.name || row.team1, row.bans?.team1)}
        {teamTable(row._team2Roster, row._team2Roster?.name || row.team2, row.bans?.team2)}
      </div>
    </div>
  );
}

export default function MatchDataTab({ active }) {
  const [rows, setRows] = useState(null);
  // { row, replay }: the match being edited, and a replay to pull details from (or null).
  const [editing, setEditing] = useState(null);
  const [editingStructure, setEditingStructure] = useState(false);
  const [pendingReplay, setPendingReplay] = useState(null);
  const [replayError, setReplayError] = useState(null);
  const replayInput = useRef(null);
  const { canEdit } = useAuth();

  async function chooseReplayFile(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setReplayError(null);
    try {
      setPendingReplay(await readReplayFile(file));
    } catch (error) {
      setReplayError(error instanceof ReplayError ? error.message : "Could not read that replay file.");
    }
  }

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
      {canEdit && rows && (
        <div className="replay-import-bar">
          <input ref={replayInput} type="file" accept=".rofl" hidden aria-label="Replay file to import" onChange={chooseReplayFile} />
          <button type="button" className="columns-btn" onClick={() => replayInput.current?.click()}>
            Import replay (.rofl){"\u2026"}
          </button>
          <button type="button" className="columns-btn" onClick={() => setEditingStructure(true)}>
            Manage tournament structure
          </button>
          <span className="replay-upload-hint">
            Fills in champions, K/D/A and roles from a replay. Read in your browser; nothing is uploaded.
          </span>
          {replayError && (
            <p className="match-editor-error" role="alert">
              {replayError}
            </p>
          )}
        </div>
      )}
      {rows ? (
        <DataTable
          columns={MATCH_DATA_COLUMNS}
          data={rows}
          ownerKey="matchdata"
          defaultSortColumn="year"
          emptyMessage="No rows match the active filters"
          expandable={{ getDetail: (row) => <MatchRosterDetail row={row} onEdit={canEdit ? (row) => setEditing({ row, replay: null }) : null} /> }}
          extraControls={
            <button className="download-btn" onClick={() => downloadUrl("/api/raw-matches.csv", "match-data.csv")}>
              Download CSV
            </button>
          }
        />
      ) : (
        <p>Loading{"\u2026"}</p>
      )}
      {canEdit && pendingReplay && (
        <ReplayImportDialog
          replay={pendingReplay}
          rows={rows}
          onCancel={() => setPendingReplay(null)}
          onContinue={(row) => {
            setEditing({ row, replay: pendingReplay });
            setPendingReplay(null);
          }}
        />
      )}
      {canEdit && editing && (
        <MatchDetailEditor
          matchKey={editing.row.match_key}
          replay={editing.replay}
          title={`${editing.row.team1} vs ${editing.row.team2} \u00b7 ${editing.row.tournament} ${editing.row.year} \u00b7 ${editing.row.match_stage}`}
          onClose={() => setEditing(null)}
          onSaved={(saved) =>
            setRows((current) =>
              current.map((r) =>
                r.match_key === saved.matchKey ? { ...r, match_details: saved.matchDetails, bans: saved.bans } : r,
              ),
            )
          }
        />
      )}
      {canEdit && editingStructure && rows && (
        <TournamentStructureEditor
          rows={rows}
          onClose={() => setEditingStructure(false)}
          onChanged={async () => {
            const data = await api.rawMatches();
            coerceNumericColumns(MATCH_DATA_COLUMNS.map((column) => column.key), data.rows);
            setRows(data.rows);
          }}
        />
      )}
    </section>
  );
}
