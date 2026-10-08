import { useLayoutEffect, useMemo, useRef, useState } from "react";
import FilterPopover from "./FilterPopover";
import { applyColumnFilters, formatCell, sortRows } from "./tableLogic";
import { PlayerLink } from "../shared/Cells";

// A generic, reusable data table used by every tab that shows tabular data
// (TrueSkill, Draft IQ, Team Balance, Mock Draft, Draft Data, Match History).
// Replaces the old public/js/table-utils.js createTabTable(): same feature
// set (click-to-sort, per-column filter popovers, show/hide columns,
// optional pagination, optional expandable detail rows, sticky leading
// columns) but as a controlled React component instead of DOM-mutating code
// wired to specific element ids.
//
// Column shape: { key, label, sortable, hideable, filterable, filterType,
//   type: 'string'|'number', decimals, percentage, className, sticky,
//   defaultHidden, sortValue(row), render(value, row) => node, playerLink }
export default function DataTable({
  columns,
  data,
  ownerKey,
  defaultSortColumn,
  defaultSortDirection = "desc",
  emptyMessage = "No rows match the active filters",
  expandable, // { getDetail(row) => node }
  pagination, // { pageSizeOptions: [40,80,'all'], defaultPageSize: 40 }
  externalFilter, // (row) => boolean
  extraControls, // extra buttons (e.g. "Download CSV") rendered in the same control bar as Columns
}) {
  const [sortColumn, setSortColumn] = useState(defaultSortColumn);
  const [sortDirection, setSortDirection] = useState(defaultSortDirection);
  const [hiddenColumns, setHiddenColumns] = useState(
    () => new Set(columns.filter((c) => c.defaultHidden).map((c) => c.key)),
  );
  const [filters, setFilters] = useState({});
  const [openFilterKey, setOpenFilterKey] = useState(null);
  const [filterAnchor, setFilterAnchor] = useState(null);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [expandedRows, setExpandedRows] = useState(() => new Set());
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(pagination?.defaultPageSize ?? "all");

  const visibleColumns = useMemo(
    () => columns.filter((c) => !hiddenColumns.has(c.key)),
    [columns, hiddenColumns],
  );

  const filtered = useMemo(() => {
    let rows = applyColumnFilters(data, columns, filters);
    if (externalFilter) rows = rows.filter(externalFilter);
    return rows;
  }, [data, columns, filters, externalFilter]);

  const sorted = useMemo(
    () => sortRows(filtered, columns, sortColumn, sortDirection),
    [filtered, columns, sortColumn, sortDirection],
  );

  const total = sorted.length;
  const effectivePageSize = pagination ? (pageSize === "all" ? total || 1 : pageSize) : total || 1;
  const totalPages = pagination ? Math.max(1, Math.ceil(total / effectivePageSize)) : 1;
  const clampedPage = Math.min(Math.max(1, page), totalPages);
  const startIndex = pagination ? (clampedPage - 1) * effectivePageSize : 0;
  const pageRows = pagination
    ? effectivePageSize >= total
      ? sorted
      : sorted.slice(startIndex, startIndex + effectivePageSize)
    : sorted;

  function handleSort(col) {
    if (!col.sortable) return;
    if (sortColumn === col.key) {
      setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortColumn(col.key);
      setSortDirection(col.key === "group" ? "asc" : "desc");
    }
    setPage(1);
  }

  function handleFilterChange(col, value) {
    setFilters((prev) => {
      const next = { ...prev };
      if (value) next[col.key] = value;
      else delete next[col.key];
      return next;
    });
    setPage(1);
  }

  function toggleExpand(rowKey) {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(rowKey)) next.delete(rowKey);
      else next.add(rowKey);
      return next;
    });
  }

  const [colWidths, setColWidths] = useState({});
  const stickyOffsets = useStickyOffsets(visibleColumns, colWidths);
  const reportWidth = (key, width) =>
    setColWidths((prev) => (prev[key] === width ? prev : { ...prev, [key]: width }));

  return (
    <>
      <div className="table-controls">
        <ColumnsButton
          columns={columns}
          hiddenColumns={hiddenColumns}
          setHiddenColumns={setHiddenColumns}
          open={columnsOpen}
          setOpen={setColumnsOpen}
        />
        {extraControls}
      </div>
      <div className={`table-section${expandable ? " table-section-expandable" : ""}`}>
        <table>
          <thead>
            <tr>
              {expandable && !expandable.hideToggle && <th className="not-sortable" />}
              {visibleColumns.map((col, i) => (
                <HeaderCell
                  key={col.key}
                  col={col}
                  sortColumn={sortColumn}
                  sortDirection={sortDirection}
                  filters={filters}
                  onSort={() => handleSort(col)}
                  onOpenFilter={(rect) => {
                    setOpenFilterKey(col.key === openFilterKey ? null : col.key);
                    setFilterAnchor(rect);
                  }}
                  isFilterOpen={openFilterKey === col.key}
                  stickyLeft={stickyOffsets.left[i]}
                  stickyLast={stickyOffsets.lastIndex === i}
                  isSticky={col.sticky}
                  onMeasure={(w) => reportWidth(col.key, w)}
                />
              ))}
            </tr>
          </thead>
          <tbody>
            {total === 0 ? (
              <tr>
                <td colSpan={visibleColumns.length + (expandable && !expandable.hideToggle ? 1 : 0)} className="empty">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              pageRows.map((row, localI) => {
                const i = startIndex + localI;
                const rowKey = row.__rowKey ?? row.identityKey ?? row.key ?? i;
                const isOpen = expandedRows.has(rowKey);
                return (
                  <RowGroup
                    key={rowKey}
                    row={row}
                    i={i}
                    visibleColumns={visibleColumns}
                    stickyOffsets={stickyOffsets}
                    expandable={expandable}
                    isOpen={isOpen}
                    onToggle={() => toggleExpand(rowKey)}
                  />
                );
              })
            )}
          </tbody>
        </table>
      </div>
      {openFilterKey && (
        <FilterPopover
          col={columns.find((c) => c.key === openFilterKey)}
          rows={data}
          filter={filters[openFilterKey]}
          anchorRect={filterAnchor}
          onChange={(value) => handleFilterChange(columns.find((c) => c.key === openFilterKey), value)}
          onClose={() => setOpenFilterKey(null)}
        />
      )}
      {pagination && (
        <div className="table-footer">
          <div className="table-footer-spacer" />
          <div className="table-page-size">
            {pagination.pageSizeOptions.map((opt) => (
              <button
                key={opt}
                type="button"
                className={`page-size-btn ${(opt === "all" ? pageSize === "all" : pageSize === opt) ? "active" : ""}`}
                onClick={() => {
                  setPageSize(opt);
                  setPage(1);
                }}
              >
                {opt === "all" ? "All" : opt}
              </button>
            ))}
          </div>
          <div className="table-pagination">
            <button
              type="button"
              className="page-nav-btn"
              disabled={clampedPage <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              {"\u2039"} Prev
            </button>
            <span className="page-indicator">
              {total === 0 ? 0 : startIndex + 1}
              {"\u2013"}
              {Math.min(total, startIndex + effectivePageSize)} of {total}
            </span>
            <button
              type="button"
              className="page-nav-btn"
              disabled={clampedPage >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next {"\u203a"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function HeaderCell({ col, sortColumn, sortDirection, filters, onSort, onOpenFilter, isFilterOpen, stickyLeft, stickyLast, isSticky, onMeasure }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    if (!isSticky || !ref.current) return;
    const measure = () => onMeasure(ref.current.offsetWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(ref.current);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSticky]);
  const sortedClass = col.key === sortColumn ? (sortDirection === "asc" ? "sorted-asc" : "sorted-desc") : "";
  const classes = [col.sortable ? "" : "not-sortable", sortedClass, stickyLeft != null ? "sticky-col" : "", stickyLast ? "sticky-col-last" : ""]
    .filter(Boolean)
    .join(" ");
  const style = stickyLeft != null ? { left: stickyLeft } : undefined;
  return (
    <th ref={ref} className={classes || undefined} style={style} onClick={onSort}>
      <span>{col.label}</span>
      {col.filterable !== false && (
        <span
          className={`filter-icon${filters[col.key] ? " active" : ""}`}
          onClick={(e) => {
            e.stopPropagation();
            onOpenFilter(ref.current.getBoundingClientRect());
          }}
        >
          {"\u25be"}
        </span>
      )}
    </th>
  );
}

function RowGroup({ row, i, visibleColumns, stickyOffsets, expandable, isOpen, onToggle }) {
  return (
    <>
      <tr>
        {expandable && !expandable.hideToggle && (
          <td>
            <button className="roster-toggle" aria-expanded={isOpen} onClick={onToggle}>
              {isOpen ? "\u25bc" : "\u25b6"}
            </button>
          </td>
        )}
        {visibleColumns.map((col, ci) => (
          <Cell
            key={col.key}
            col={col}
            row={row}
            i={i}
            stickyLeft={stickyOffsets.left[ci]}
            stickyLast={stickyOffsets.lastIndex === ci}
            expandable={expandable}
            isOpen={isOpen}
            onToggle={onToggle}
          />
        ))}
      </tr>
      {expandable && isOpen && (
        <tr className="roster-detail-row">
          <td colSpan={visibleColumns.length + (expandable.hideToggle ? 0 : 1)}>{expandable.getDetail(row)}</td>
        </tr>
      )}
    </>
  );
}

function Cell({ col, row, i, stickyLeft, stickyLast, expandable, isOpen, onToggle }) {
  const classes = [col.className || (col.key === "rank" ? "rank" : ""), stickyLeft != null ? "sticky-col" : "", stickyLast ? "sticky-col-last" : ""]
    .filter(Boolean)
    .join(" ");
  const style = stickyLeft != null ? { left: stickyLeft } : undefined;

  if (expandable?.toggleColumn === col.key) {
    const value = col.key === "rank" ? i + 1 : row[col.key];
    return (
      <td className={classes || undefined} style={style}>
        <button type="button" className="table-expand-link" aria-expanded={isOpen} onClick={onToggle}>
          {col.render ? col.render(value, row) : formatCell(value, col)}
        </button>
      </td>
    );
  }

  if (col.playerLink || col.key === "group") {
    // A plain "group" column (TrueSkill, Mock Draft) reads identityKey and
    // profileUrl straight off the row. playerLink:true (Draft Data's
    // "Player" column, sourced from the raw CSV/DB rows) remaps a
    // differently-named value column through the same underscore-prefixed
    // fields the backend attaches to those rows, so both shapes funnel
    // through the same PlayerLink call -- matching the old table-utils.js,
    // which did this same remap before calling its shared renderPlayerCell.
    const fullName = col.playerLink ? row[col.key] : (row.group ?? row[col.key]);
    const identityKey = row.identityKey ?? row._playerIdentityKey ?? undefined;
    const profileUrl = row.profileUrl ?? row._playerProfileUrl ?? null;
    return (
      <td className={classes || undefined} style={style}>
        <PlayerLink fullName={fullName} identityKey={identityKey} profileUrl={profileUrl} />
      </td>
    );
  }
  const val = col.key === "rank" ? i + 1 : row[col.key];
  return (
    <td className={classes || undefined} style={style}>
      {col.render ? col.render(val, row) : formatCell(val, col)}
    </td>
  );
}

// Computes left-offset px for a contiguous run of sticky columns, and the
// index of the last sticky column (for the "last sticky" border shadow) --
// same idea as applyStickyColumns in the old table-utils.js, just derived
// once for the header and reused by every body row instead of walking the
// DOM after every render.
function useStickyOffsets(visibleColumns, widths) {
  // Sticky offsets are computed from measured widths (see HeaderCell's
  // ResizeObserver above), falling back to a sane default so layout
  // doesn't jump before the first measurement pass.
  const runStart = visibleColumns.findIndex((c) => c.sticky);
  if (runStart === -1) return { left: {}, lastIndex: -1 };
  let runEnd = runStart;
  while (runEnd + 1 < visibleColumns.length && visibleColumns[runEnd + 1].sticky) runEnd++;
  const left = {};
  let cumulative = 0;
  for (let i = runStart; i <= runEnd; i++) {
    left[i] = cumulative;
    cumulative += widths[visibleColumns[i].key] || 160;
  }
  return { left, lastIndex: runEnd };
}

function ColumnsButton({ columns, hiddenColumns, setHiddenColumns, open, setOpen }) {
  const ref = useRef(null);
  const hideable = columns.filter((c) => c.hideable);

  useLayoutEffect(() => {
    if (!open) return;
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open, setOpen]);

  if (!hideable.length) return null;

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <button type="button" className="columns-btn" onClick={() => setOpen((o) => !o)}>
        Columns {"\u25be"}
      </button>
      <div className={`columns-panel${open ? "" : " hidden"}`}>
        {hideable.map((col) => (
          <label key={col.key}>
            <input
              type="checkbox"
              checked={!hiddenColumns.has(col.key)}
              onChange={(e) => {
                setHiddenColumns((prev) => {
                  const next = new Set(prev);
                  if (e.target.checked) next.delete(col.key);
                  else next.add(col.key);
                  return next;
                });
              }}
            />
            {col.label}
          </label>
        ))}
      </div>
    </div>
  );
}
