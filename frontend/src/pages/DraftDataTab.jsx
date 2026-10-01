import { useEffect, useState } from "react";
import { api, downloadUrl } from "../api/client";
import DataTable from "../components/table/DataTable";
import { coerceNumericColumns } from "../components/table/tableLogic";

const DRAFT_DATA_COLUMNS = [
  { key: "Tournament", label: "Tournament", sortable: true, hideable: true, filterable: true, type: "string", filterType: "checkbox" },
  { key: "Year", label: "Year", sortable: true, hideable: true, filterable: true, type: "number", decimals: 0 },
  { key: "Captain", label: "Captain", sortable: true, hideable: true, filterable: true, type: "string" },
  {
    key: "Player",
    label: "Player",
    sortable: true,
    hideable: false,
    filterable: true,
    type: "string",
    className: "group-name",
    // playerLink:true: this column's value isn't named "group", so
    // DataTable remaps it (and the row's _playerIdentityKey/
    // _playerProfileUrl, which the backend attaches to these raw rows)
    // through its shared player-link rendering.
    playerLink: true,
  },
  { key: "Pick Order", label: "Pick Order", sortable: true, hideable: true, filterable: true, type: "number", decimals: 0 },
  { key: "Rank", label: "Rank", sortable: true, hideable: true, filterable: true, type: "number", decimals: 1 },
];

export default function DraftDataTab({ active }) {
  const [rows, setRows] = useState(null);

  useEffect(() => {
    if (active && !rows) {
      api.raw().then((data) => {
        coerceNumericColumns(DRAFT_DATA_COLUMNS.map((c) => c.key), data.rows);
        setRows(data.rows);
      });
    }
  }, [active, rows]);

  return (
    <section className={`tab-panel${active ? " active" : ""}`}>
      {rows ? (
        <DataTable
          columns={DRAFT_DATA_COLUMNS}
          data={rows}
          ownerKey="draftdata"
          defaultSortColumn="Year"
          emptyMessage="No rows match the active filters"
          extraControls={
            <button className="download-btn" onClick={() => downloadUrl("/api/raw.csv", "draft-data.csv")}>
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
