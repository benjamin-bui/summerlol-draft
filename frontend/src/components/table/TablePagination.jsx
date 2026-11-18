import { useState } from "react";

export default function TablePagination({
  page,
  totalPages,
  pageSize,
  pageSizeOptions,
  onPageChange,
  onPageSizeChange,
}) {
  const [pageEntry, setPageEntry] = useState(null);
  const displayedPageEntry = pageEntry?.page === page ? pageEntry.value : String(page);

  function commitPage() {
    const value = displayedPageEntry.trim();
    if (!/^\d+$/.test(value)) {
      setPageEntry(null);
      return;
    }
    const requestedPage = Number(value);
    onPageChange(Math.min(totalPages, Math.max(1, requestedPage)));
  }

  return (
    <div className="table-footer">
      <div className="table-footer-spacer" />
      <div className="table-page-size">
        {pageSizeOptions.map((option) => (
          <button
            key={option}
            type="button"
            className={`page-size-btn ${(option === "all" ? pageSize === "all" : pageSize === option) ? "active" : ""}`}
            onClick={() => onPageSizeChange(option)}
          >
            {option === "all" ? "All" : option}
          </button>
        ))}
      </div>
      <div className="table-pagination">
        <button
          type="button"
          className="page-nav-btn"
          disabled={page <= 1}
          onClick={() => onPageChange(1)}
        >
          First
        </button>
        <button
          type="button"
          className="page-nav-btn"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          {"\u2039"} Prev
        </button>
        <label className="page-jump">
          Page
          <input
            className="page-jump-input"
            aria-label="Page number"
            type="text"
            inputMode="numeric"
            value={displayedPageEntry}
            onChange={(event) => setPageEntry({ page, value: event.target.value })}
            onBlur={commitPage}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                commitPage();
                event.currentTarget.blur();
              }
            }}
          />
          <span>of {totalPages}</span>
        </label>
        <button
          type="button"
          className="page-nav-btn"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          Next {"\u203a"}
        </button>
        <button
          type="button"
          className="page-nav-btn"
          disabled={page >= totalPages}
          onClick={() => onPageChange(totalPages)}
        >
          Last
        </button>
      </div>
    </div>
  );
}
