import { useEffect, useRef, useState } from "react";
import { checkboxFilterValues } from "./tableLogic";

// One column's filter editor, rendered into a floating popover anchored to
// its header cell. Mirrors filterPopoverInnerHTML/wireFilterPopover from the
// old table-utils.js, but as local component state that commits back to the
// table's filter map on every change (so the body re-renders live, same as
// before).
export default function FilterPopover({ col, rows, filter, onChange, onClose, anchorRect }) {
  const popoverRef = useRef(null);

  useEffect(() => {
    function handleClick(e) {
      if (popoverRef.current && !popoverRef.current.contains(e.target)) onClose();
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  const style = {
    position: "fixed",
    top: anchorRect.bottom + 4,
    left: Math.max(8, Math.min(anchorRect.left, window.innerWidth - 240 - 12)),
  };

  const isCheckbox = col.type === "string" && col.filterType === "checkbox";
  const isString = col.type === "string" && !isCheckbox;

  return (
    <div className="filter-popover" ref={popoverRef} style={style} onClick={(e) => e.stopPropagation()}>
      {isCheckbox && <CheckboxFilter col={col} rows={rows} filter={filter} onChange={onChange} />}
      {isString && <RegexFilter col={col} filter={filter} onChange={onChange} />}
      {!isCheckbox && !isString && <NumericFilter col={col} filter={filter} onChange={onChange} />}
    </div>
  );
}

function CheckboxFilter({ col, rows, filter, onChange }) {
  const values = checkboxFilterValues(rows, col);
  const selected = new Set(filter?.values || []);
  const toggle = (value) => {
    const next = new Set(selected);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    onChange(next.size ? { type: "checkbox", values: [...next] } : null);
  };
  return (
    <>
      <label>Select values</label>
      <div className="filter-checkbox-list">
        {values.length ? (
          values.map((value) => (
            <label className="filter-option" key={value}>
              <input type="checkbox" checked={selected.has(value)} onChange={() => toggle(value)} /> {value}
            </label>
          ))
        ) : (
          <div className="filter-empty">No values</div>
        )}
      </div>
      <div className="filter-popover-actions">
        <button type="button" className="filter-clear-btn" onClick={() => onChange(null)}>
          Clear
        </button>
      </div>
    </>
  );
}

function RegexFilter({ col, filter, onChange }) {
  const [text, setText] = useState(filter?.pattern || "");
  const [invalid, setInvalid] = useState(false);

  const update = (value) => {
    setText(value);
    const pattern = value.trim();
    if (!pattern) {
      setInvalid(false);
      onChange(null);
      return;
    }
    try {
      new RegExp(pattern, "i");
      setInvalid(false);
      onChange({ type: "regex", pattern });
    } catch {
      setInvalid(true);
    }
  };

  return (
    <>
      <label>Filter (regex, case-insensitive)</label>
      <input
        type="text"
        className={`filter-regex-input${invalid ? " invalid" : ""}`}
        placeholder="e.g. voidliss"
        value={text}
        onChange={(e) => update(e.target.value)}
      />
      <div className="filter-popover-actions">
        <button
          type="button"
          className="filter-clear-btn"
          onClick={() => {
            setText("");
            setInvalid(false);
            onChange(null);
          }}
        >
          Clear
        </button>
      </div>
    </>
  );
}

function NumericFilter({ col, filter, onChange }) {
  const [op, setOp] = useState(filter?.type === "between" ? "between" : filter?.type || "gt");
  const scale = col.percentage ? 0.01 : 1;
  const unscale = (v) => (v === null || v === undefined ? "" : String(v / scale));
  const [value, setValue] = useState(filter?.type && filter.type !== "between" ? unscale(filter.value) : "");
  const [min, setMin] = useState(filter?.type === "between" ? unscale(filter.min) : "");
  const [max, setMax] = useState(filter?.type === "between" ? unscale(filter.max) : "");

  const commit = (nextOp, nextValue, nextMin, nextMax) => {
    if (nextOp === "between") {
      const minV = nextMin === "" ? null : parseFloat(nextMin) * scale;
      const maxV = nextMax === "" ? null : parseFloat(nextMax) * scale;
      onChange(minV !== null && maxV !== null ? { type: "between", min: minV, max: maxV } : null);
    } else {
      const v = nextValue === "" ? null : parseFloat(nextValue) * scale;
      onChange(v !== null ? { type: nextOp, value: v } : null);
    }
  };

  const placeholder = col.percentage ? "e.g. 50 for 50%" : "value";
  const minPlaceholder = col.percentage ? "min %" : "min";
  const maxPlaceholder = col.percentage ? "max %" : "max";

  return (
    <>
      <label>Filter{col.percentage ? " (enter as a percentage, e.g. 50 for 50%)" : ""}</label>
      <select
        className="filter-op-select"
        value={op}
        onChange={(e) => {
          setOp(e.target.value);
          commit(e.target.value, value, min, max);
        }}
      >
        <option value="gt">Greater than</option>
        <option value="lt">Less than</option>
        <option value="between">Between</option>
      </select>
      {op !== "between" ? (
        <div className="filter-value-single">
          <input
            type="number"
            step="any"
            className="filter-value-input"
            placeholder={placeholder}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              commit(op, e.target.value, min, max);
            }}
          />
        </div>
      ) : (
        <div className="filter-value-between between-inputs">
          <input
            type="number"
            step="any"
            className="filter-min-input"
            placeholder={minPlaceholder}
            value={min}
            onChange={(e) => {
              setMin(e.target.value);
              commit(op, value, e.target.value, max);
            }}
          />
          <input
            type="number"
            step="any"
            className="filter-max-input"
            placeholder={maxPlaceholder}
            value={max}
            onChange={(e) => {
              setMax(e.target.value);
              commit(op, value, min, e.target.value);
            }}
          />
        </div>
      )}
      <div className="filter-popover-actions">
        <button
          type="button"
          className="filter-clear-btn"
          onClick={() => {
            setValue("");
            setMin("");
            setMax("");
            setOp("gt");
            onChange(null);
          }}
        >
          Clear
        </button>
      </div>
    </>
  );
}
