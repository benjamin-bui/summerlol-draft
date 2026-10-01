export function sortRows(rows, columns, sortColumn, sortDirection) {
  const col = columns.find((c) => c.key === sortColumn);
  const dir = sortDirection === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (sortColumn === "latestGameTournament") {
      const parseTournamentValue = (row) => {
        const raw = String(row.latestGameTournament || "").trim();
        const match = raw.match(/^(winter|summer)\s*(\d{4})?$/i);
        if (!match) return { year: 0, seasonRank: 2, raw };
        return {
          year: parseInt(match[2] || "0", 10),
          seasonRank: match[1].toLowerCase() === "winter" ? 0 : 1,
          raw,
        };
      };
      const av = parseTournamentValue(a);
      const bv = parseTournamentValue(b);
      if (av.year !== bv.year) return dir * (bv.year - av.year);
      if (av.seasonRank !== bv.seasonRank) return av.seasonRank - bv.seasonRank;
      return dir * String(av.raw).localeCompare(String(bv.raw));
    }
    const av = col && typeof col.sortValue === "function" ? col.sortValue(a) : a[sortColumn];
    const bv = col && typeof col.sortValue === "function" ? col.sortValue(b) : b[sortColumn];
    if (av === null || av === undefined) return 1;
    if (bv === null || bv === undefined) return -1;
    if (typeof av === "number" || typeof bv === "number") {
      return dir * (Number(av) - Number(bv));
    }
    if (col && col.type === "string") return dir * String(av).localeCompare(String(bv));
    if (typeof av === "string" || typeof bv === "string") {
      return dir * String(av).localeCompare(String(bv));
    }
    return dir * (av - bv);
  });
}

export function rowPassesFilter(row, col, filter) {
  if (!filter) return true;
  const value = row[col.key];

  if (filter.type === "checkbox") {
    if (!filter.values || filter.values.length === 0) return true;
    return filter.values.includes(String(value ?? ""));
  }
  if (filter.type === "regex") {
    if (!filter.pattern) return true;
    try {
      const re = new RegExp(filter.pattern, "i");
      return re.test(String(value ?? ""));
    } catch {
      return true;
    }
  }
  if (value === null || value === undefined || Number.isNaN(value)) return false;
  if (filter.type === "gt") return filter.value !== null && value > filter.value;
  if (filter.type === "lt") return filter.value !== null && value < filter.value;
  if (filter.type === "between") {
    if (filter.min === null || filter.max === null) return true;
    return value >= filter.min && value <= filter.max;
  }
  return true;
}

export function applyColumnFilters(rows, columns, filterState) {
  const activeCols = columns.filter((c) => filterState[c.key]);
  if (activeCols.length === 0) return rows;
  return rows.filter((row) => activeCols.every((col) => rowPassesFilter(row, col, filterState[col.key])));
}

export function formatCell(value, col) {
  if (value === null || value === undefined) return "\u2013";
  if (col.type === "number" && typeof value === "number") {
    if (col.percentage) return (value * 100).toFixed(col.decimals ?? 0) + "%";
    return value.toFixed(col.decimals ?? 0);
  }
  return String(value);
}

// Coerces raw (often string) values in the given columns to numbers when
// every non-blank value in the column parses cleanly -- same heuristic the
// old client used for CSV/DB-sourced rows (Draft Data, Match History).
export function coerceNumericColumns(columns, rows) {
  columns.forEach((colName) => {
    let sawValue = false;
    const allNumericOrBlank = rows.every((row) => {
      const val = row[colName];
      if (val === null || val === undefined || val === "") return true;
      sawValue = true;
      return !Number.isNaN(parseFloat(val)) && String(val).trim() !== "";
    });
    if (allNumericOrBlank && sawValue) {
      rows.forEach((row) => {
        const val = row[colName];
        row[colName] = val === null || val === undefined || val === "" ? null : parseFloat(val);
      });
    }
  });
}

export function checkboxFilterValues(rows, col) {
  const values = [
    ...new Set(
      rows
        .map((row) => row[col.key])
        .filter((v) => v !== null && v !== undefined && String(v).trim() !== "")
        .map(String),
    ),
  ];
  // Same parse as the popover in the original table-utils.js: summer before
  // winter within a year (note this differs from the main sort's tiebreak,
  // which orders winter first -- kept as-is to match legacy behavior).
  const parseTournamentValue = (value) => {
    const raw = String(value || "").trim();
    const match = raw.match(/^(winter|summer)\s*(\d{4})?$/i);
    if (!match) return { year: 0, seasonRank: 2, raw };
    return {
      year: parseInt(match[2] || "0", 10),
      seasonRank: match[1].toLowerCase() === "summer" ? 0 : 1,
      raw,
    };
  };
  return values.sort((a, b) => {
    const av = parseTournamentValue(a);
    const bv = parseTournamentValue(b);
    if (av.year !== bv.year) return bv.year - av.year;
    if (av.seasonRank !== bv.seasonRank) return av.seasonRank - bv.seasonRank;
    return String(av.raw).localeCompare(String(bv.raw));
  });
}
