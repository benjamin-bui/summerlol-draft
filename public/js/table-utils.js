import { escapeHtml, renderPlayerCell } from "./utils.js";

export function formatCell(value, col) {
  if (value === null || value === undefined) return "–";
  if (col.type === "number" && typeof value === "number") {
    if (col.percentage) return (value * 100).toFixed(col.decimals) + "%";
    return value.toFixed(col.decimals);
  }
  return String(value);
}

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

    const av =
      col && typeof col.sortValue === "function"
        ? col.sortValue(a)
        : a[sortColumn];
    const bv =
      col && typeof col.sortValue === "function"
        ? col.sortValue(b)
        : b[sortColumn];
    if (av === null || av === undefined) return 1;
    if (bv === null || bv === undefined) return -1;
    if (typeof av === "number" || typeof bv === "number") {
      return dir * (Number(av) - Number(bv));
    }
    if (col && col.type === "string")
      return dir * String(av).localeCompare(String(bv));
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
  if (value === null || value === undefined || Number.isNaN(value))
    return false;

  if (filter.type === "gt")
    return filter.value !== null && value > filter.value;
  if (filter.type === "lt")
    return filter.value !== null && value < filter.value;
  if (filter.type === "between") {
    if (filter.min === null || filter.max === null) return true;
    return value >= filter.min && value <= filter.max;
  }
  return true;
}

export function applyColumnFilters(rows, columns, filterState) {
  const activeCols = columns.filter((c) => filterState[c.key]);
  if (activeCols.length === 0) return rows;
  return rows.filter((row) =>
    activeCols.every((col) => rowPassesFilter(row, col, filterState[col.key])),
  );
}

export function filterPopoverInnerHTML(col, rows, filterState) {
  if (col.type === "string" && col.filterType === "checkbox") {
    const values = [
      ...new Set(
        rows
          .map((row) => row[col.key])
          .filter(
            (value) =>
              value !== null &&
              value !== undefined &&
              String(value).trim() !== "",
          ),
      ),
    ].map((value) => String(value));

    const orderedValues = values.sort((a, b) => {
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
      const av = parseTournamentValue(a);
      const bv = parseTournamentValue(b);
      if (av.year !== bv.year) return bv.year - av.year;
      if (av.seasonRank !== bv.seasonRank) return av.seasonRank - bv.seasonRank;
      return String(av.raw).localeCompare(String(bv.raw));
    });

    const optionsHtml = orderedValues.length
      ? orderedValues
          .map((value) => {
            const checked = filterState[col.key]?.values?.includes(value)
              ? "checked"
              : "";
            return `<label class="filter-option"><input type="checkbox" class="filter-checkbox-option" value="${escapeHtml(value)}" ${checked} /> ${escapeHtml(value)}</label>`;
          })
          .join("")
      : '<div class="filter-empty">No values</div>';

    return `
      <label>Select values</label>
      <div class="filter-checkbox-list">${optionsHtml}</div>
      <div class="filter-popover-actions">
        <button type="button" class="filter-clear-btn">Clear</button>
      </div>`;
  }
  if (col.type === "string") {
    const existing = filterState[col.key]?.pattern || "";
    return `
      <label>Filter (regex, case-insensitive)</label>
      <input type="text" class="filter-regex-input" placeholder="e.g. voidliss" value="${escapeHtml(existing)}" />
      <div class="filter-popover-actions">
        <button type="button" class="filter-clear-btn">Clear</button>
      </div>`;
  }
  const placeholder = col.percentage ? "e.g. 50 for 50%" : "value";
  const minPlaceholder = col.percentage ? "min %" : "min";
  const maxPlaceholder = col.percentage ? "max %" : "max";
  return `
    <label>Filter${col.percentage ? " (enter as a percentage, e.g. 50 for 50%)" : ""}</label>
    <select class="filter-op-select">
      <option value="gt">Greater than</option>
      <option value="lt">Less than</option>
      <option value="between">Between</option>
    </select>
    <div class="filter-value-single">
      <input type="number" step="any" class="filter-value-input" placeholder="${placeholder}" />
    </div>
    <div class="filter-value-between between-inputs hidden">
      <input type="number" step="any" class="filter-min-input" placeholder="${minPlaceholder}" />
      <input type="number" step="any" class="filter-max-input" placeholder="${maxPlaceholder}" />
    </div>
    <div class="filter-popover-actions">
      <button type="button" class="filter-clear-btn">Clear</button>
    </div>`;
}

export function wireFilterPopover(
  th,
  col,
  popover,
  filterState,
  onChange,
  closeAllPopovers,
) {
  const icon = th.querySelector(".filter-icon");

  icon.addEventListener("click", (e) => {
    e.stopPropagation();
    const isHidden = popover.classList.contains("hidden");
    closeAllPopovers();
    if (isHidden) {
      const rect = th.getBoundingClientRect();
      const popoverWidth = 240;
      const clampedLeft = Math.min(rect.left, window.innerWidth - popoverWidth - 12);
      popover.style.top = `${rect.bottom + 4}px`;
      popover.style.left = `${Math.max(8, clampedLeft)}px`;
      popover.classList.remove("hidden");
    }
  });
  popover.addEventListener("click", (e) => e.stopPropagation());

  function setActive(isActive) {
    icon.classList.toggle("active", isActive);
  }

  if (col.type === "string" && col.filterType === "checkbox") {
    const checkboxes = [...popover.querySelectorAll(".filter-checkbox-option")];
    const clearBtn = popover.querySelector(".filter-clear-btn");

    function updateFromCheckboxes() {
      const values = checkboxes
        .filter((box) => box.checked)
        .map((box) => box.value);
      if (values.length > 0) {
        filterState[col.key] = { type: "checkbox", values };
        setActive(true);
      } else {
        delete filterState[col.key];
        setActive(false);
      }
      onChange();
    }

    checkboxes.forEach((box) => box.addEventListener("change", updateFromCheckboxes));
    clearBtn.addEventListener("click", () => {
      checkboxes.forEach((box) => {
        box.checked = false;
      });
      delete filterState[col.key];
      setActive(false);
      onChange();
    });
  } else if (col.type === "string") {
    const input = popover.querySelector(".filter-regex-input");
    const clearBtn = popover.querySelector(".filter-clear-btn");

    function updateFromInput() {
      const pattern = input.value.trim();
      if (pattern === "") {
        delete filterState[col.key];
        setActive(false);
        input.classList.remove("invalid");
        onChange();
        return;
      }
      try {
        new RegExp(pattern, "i");
        filterState[col.key] = { type: "regex", pattern };
        input.classList.remove("invalid");
        setActive(true);
      } catch {
        input.classList.add("invalid");
      }
      onChange();
    }

    input.addEventListener("input", updateFromInput);
    clearBtn.addEventListener("click", () => {
      input.value = "";
      delete filterState[col.key];
      setActive(false);
      input.classList.remove("invalid");
      onChange();
    });
  } else {
    const opSelect = popover.querySelector(".filter-op-select");
    const singleWrap = popover.querySelector(".filter-value-single");
    const betweenWrap = popover.querySelector(".filter-value-between");
    const valueInput = popover.querySelector(".filter-value-input");
    const minInput = popover.querySelector(".filter-min-input");
    const maxInput = popover.querySelector(".filter-max-input");
    const clearBtn = popover.querySelector(".filter-clear-btn");

    function updateFromInputs() {
      const scale = col.percentage ? 0.01 : 1;
      const op = opSelect.value;
      if (op === "between") {
        const min = minInput.value === "" ? null : parseFloat(minInput.value) * scale;
        const max = maxInput.value === "" ? null : parseFloat(maxInput.value) * scale;
        if (min !== null && max !== null) {
          filterState[col.key] = { type: "between", min, max };
          setActive(true);
        } else {
          delete filterState[col.key];
          setActive(false);
        }
      } else {
        const val = valueInput.value === "" ? null : parseFloat(valueInput.value) * scale;
        if (val !== null) {
          filterState[col.key] = { type: op, value: val };
          setActive(true);
        } else {
          delete filterState[col.key];
          setActive(false);
        }
      }
      onChange();
    }

    opSelect.addEventListener("change", () => {
      const isBetween = opSelect.value === "between";
      singleWrap.classList.toggle("hidden", isBetween);
      betweenWrap.classList.toggle("hidden", !isBetween);
      updateFromInputs();
    });
    valueInput.addEventListener("input", updateFromInputs);
    minInput.addEventListener("input", updateFromInputs);
    maxInput.addEventListener("input", updateFromInputs);
    clearBtn.addEventListener("click", () => {
      valueInput.value = "";
      minInput.value = "";
      maxInput.value = "";
      opSelect.value = "gt";
      singleWrap.classList.remove("hidden");
      betweenWrap.classList.add("hidden");
      delete filterState[col.key];
      setActive(false);
      onChange();
    });
  }
}

export function applyStickyColumns(headerRowEl, bodyEl, visibleColumns, hasToggleCol = false) {
  const runStart = visibleColumns.findIndex((c) => c.sticky);
  if (runStart === -1) return;

  let runEnd = runStart;
  while (runEnd + 1 < visibleColumns.length && visibleColumns[runEnd + 1].sticky) {
    runEnd++;
  }

  const headerCells = [...headerRowEl.children];
  const domOffset = hasToggleCol ? 1 : 0;
  const toggleIsSticky = hasToggleCol && runStart === 0;

  let cumulativeLeft = 0;
  if (toggleIsSticky && headerCells[0]) {
    headerCells[0].classList.add("sticky-col");
    headerCells[0].style.left = "0px";
    cumulativeLeft = headerCells[0].getBoundingClientRect().width;
  }

  for (let i = runStart; i <= runEnd; i++) {
    const th = headerCells[i + domOffset];
    if (!th) continue;
    th.classList.add("sticky-col");
    if (i === runEnd) th.classList.add("sticky-col-last");
    th.style.left = `${cumulativeLeft}px`;
    cumulativeLeft += th.getBoundingClientRect().width;
  }

  [...bodyEl.children].forEach((tr) => {
    if (tr.classList.contains("roster-detail-row")) return;
    const cells = [...tr.children];
    let left = 0;
    if (toggleIsSticky && cells[0]) {
      cells[0].classList.add("sticky-col");
      cells[0].style.left = "0px";
      left = cells[0].getBoundingClientRect().width;
    }
    for (let i = runStart; i <= runEnd; i++) {
      const td = cells[i + domOffset];
      if (!td) continue;
      td.classList.add("sticky-col");
      if (i === runEnd) td.classList.add("sticky-col-last");
      td.style.left = `${left}px`;
      left += td.getBoundingClientRect().width;
    }
  });
}

export function buildHeaderCell(
  col,
  sortColumn,
  sortDirection,
  filterState,
  onFilterChange,
  owner,
  rows,
  allPopovers,
  closeAllPopovers,
) {
  const th = document.createElement("th");
  th.dataset.sort = col.key;
  if (!col.sortable) th.classList.add("not-sortable");
  if (col.key === sortColumn) th.classList.add(sortDirection === "asc" ? "sorted-asc" : "sorted-desc");

  const labelSpan = document.createElement("span");
  labelSpan.textContent = col.label;
  th.appendChild(labelSpan);

  if (col.filterable !== false) {
    const icon = document.createElement("span");
    icon.className = "filter-icon";
    icon.textContent = "▾";
    if (filterState[col.key]) icon.classList.add("active");
    th.appendChild(icon);

    const popover = document.createElement("div");
    popover.className = "filter-popover hidden";
    popover.dataset.owner = owner;
    popover.innerHTML = filterPopoverInnerHTML(col, rows, filterState);
    document.body.appendChild(popover);
    allPopovers.push(popover);

    wireFilterPopover(th, col, popover, filterState, onFilterChange, closeAllPopovers);
  }

  return th;
}

export function createTabTable({
  columns,
  headerRowEl,
  bodyEl,
  columnsBtnEl,
  columnsPanelEl,
  ownerKey,
  defaultSortColumn,
  defaultSortDirection = "desc",
  emptyMessage = "No rows match the active filters",
  expandable,
}) {
  const allPopovers = [];
  const state = {
    data: [],
    sortColumn: defaultSortColumn,
    sortDirection: defaultSortDirection,
    hiddenColumns: new Set(columns.filter((c) => c.defaultHidden).map((c) => c.key)),
    filters: {},
    externalFilter: null,
  };

  function closeAllPopovers() {
    allPopovers.forEach((p) => p.classList.add("hidden"));
  }

  function removePopoversOwnedBy(owner) {
    for (let i = allPopovers.length - 1; i >= 0; i--) {
      if (allPopovers[i].dataset.owner === owner) {
        allPopovers[i].remove();
        allPopovers.splice(i, 1);
      }
    }
  }

  columns
    .filter((c) => c.hideable)
    .forEach((col) => {
      const label = document.createElement("label");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = !state.hiddenColumns.has(col.key);
      checkbox.dataset.col = col.key;
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) state.hiddenColumns.delete(col.key);
        else state.hiddenColumns.add(col.key);
        rebuildHeader();
        renderBody();
      });
      label.appendChild(checkbox);
      label.appendChild(document.createTextNode(col.label));
      columnsPanelEl.appendChild(label);
    });

  columnsBtnEl.addEventListener("click", (e) => {
    e.stopPropagation();
    const isHidden = columnsPanelEl.classList.contains("hidden");
    closeAllPopovers();
    columnsPanelEl.classList.toggle("hidden");
    if (isHidden) columnsPanelEl.classList.remove("hidden");
  });
  columnsPanelEl.addEventListener("click", (e) => e.stopPropagation());
  document.addEventListener("click", () => columnsPanelEl.classList.add("hidden"));

  function visibleColumns() {
    return columns.filter((c) => !state.hiddenColumns.has(c.key));
  }

  function updateSortIndicators() {
    [...headerRowEl.children].forEach((th) => {
      th.classList.remove("sorted-asc", "sorted-desc");
      if (th.dataset.sort === state.sortColumn) {
        th.classList.add(state.sortDirection === "asc" ? "sorted-asc" : "sorted-desc");
      }
    });
  }

  function refreshStickyColumns() {
    applyStickyColumns(headerRowEl, bodyEl, visibleColumns(), !!expandable);
  }

  function rebuildHeader() {
    removePopoversOwnedBy(ownerKey);
    headerRowEl.innerHTML = "";
    if (expandable) {
      const toggleTh = document.createElement("th");
      toggleTh.classList.add("not-sortable");
      headerRowEl.appendChild(toggleTh);
    }
    visibleColumns().forEach((col) => {
      const th = buildHeaderCell(
        col,
        state.sortColumn,
        state.sortDirection,
        state.filters,
        () => {
          renderBody();
        },
        ownerKey,
        state.data,
        allPopovers,
        closeAllPopovers,
      );
      th.addEventListener("click", () => {
        if (!col.sortable) return;
        if (state.sortColumn === col.key) {
          state.sortDirection = state.sortDirection === "asc" ? "desc" : "asc";
        } else {
          state.sortColumn = col.key;
          state.sortDirection = col.key === "group" ? "asc" : "desc";
        }
        updateSortIndicators();
        renderBody();
      });
      headerRowEl.appendChild(th);
    });
    refreshStickyColumns();
  }

  function renderBody() {
    const cols = visibleColumns();
    const colspan = cols.length + (expandable ? 1 : 0);
    let filtered = applyColumnFilters(state.data, columns, state.filters);
    if (state.externalFilter) filtered = filtered.filter(state.externalFilter);
    const sorted = sortRows(filtered, columns, state.sortColumn, state.sortDirection);

    if (sorted.length === 0) {
      bodyEl.innerHTML = `<tr><td colspan="${colspan}" class="empty">${escapeHtml(emptyMessage)}</td></tr>`;
      return;
    }

    bodyEl.innerHTML = sorted
      .map((row, i) => {
        const cells = cols
          .map((col) => {
            if (col.playerLink || col.key === "group") {
              const playerRow = col.playerLink
                ? {
                    group: row[col.key],
                    profileUrl: row._playerProfileUrl,
                    identityKey: row._playerIdentityKey,
                  }
                : row;
              return `<td class="group-name">${renderPlayerCell(playerRow)}</td>`;
            }
            const val = col.key === "rank" ? i + 1 : row[col.key];
            const cls = col.className
              ? ` class="${col.className}"`
              : col.key === "rank"
                ? ' class="rank"'
                : "";
            if (col.render) return `<td${cls}>${col.render(val, row)}</td>`;
            return `<td${cls}>${escapeHtml(formatCell(val, col))}</td>`;
          })
          .join("");

        if (!expandable) return `<tr>${cells}</tr>`;

        const detailId = `${ownerKey}-detail-${i}`;
        return `<tr>
          <td><button class="roster-toggle" data-target="${detailId}" aria-expanded="false">▶</button></td>
          ${cells}
        </tr>
        <tr id="${detailId}" class="roster-detail-row" hidden>
          <td colspan="${colspan}">${expandable.getDetailHtml(row)}</td>
        </tr>`;
      })
      .join("");
    refreshStickyColumns();
  }

  rebuildHeader();

  return {
    setData(newData) {
      state.data = newData;
      rebuildHeader();
      renderBody();
    },
    setExternalFilter(predicateFn) {
      state.externalFilter = predicateFn;
      renderBody();
    },
  };
}

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
        row[colName] =
          val === null || val === undefined || val === ""
            ? null
            : parseFloat(val);
      });
    }
  });
}
