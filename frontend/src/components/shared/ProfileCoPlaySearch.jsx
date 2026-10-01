import { useEffect, useRef, useState } from "react";
import { NameWithTag } from "./Cells";

export default function ProfileCoPlaySearch({ mode, setMode, pool, selectedKey, onSelect, onClear }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);

  // Switching mode clears the search -- teammates and opponents are
  // different pools, so a selection in one isn't meaningful in the other.
  // Reset during render (not in an effect) to avoid an extra render pass;
  // see https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  const [prevMode, setPrevMode] = useState(mode);
  if (mode !== prevMode) {
    setPrevMode(mode);
    setQuery("");
    setOpen(false);
  }

  useEffect(() => {
    function handleClick(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, []);

  const q = query.trim().toLowerCase();
  const matches = q
    ? [...pool.entries()]
        .filter(([, name]) => name.toLowerCase().includes(q))
        .sort((a, b) => a[1].localeCompare(b[1]))
        .slice(0, 8)
    : [];

  function select(key, name) {
    setQuery(name);
    setOpen(false);
    onSelect(key);
  }

  return (
    <div className="profile-search">
      <select className="profile-search-mode" value={mode} onChange={(e) => setMode(e.target.value)}>
        <option value="with">Played with</option>
        <option value="against">Played Against</option>
      </select>
      <div className="profile-search-box" ref={boxRef}>
        <input
          type="text"
          className="profile-search-input"
          placeholder={mode === "against" ? "Search an opponent..." : "Search a teammate..."}
          autoComplete="off"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            if (selectedKey) onClear();
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
            if (e.key === "Enter" && matches[0]) {
              e.preventDefault();
              select(matches[0][0], matches[0][1]);
            }
          }}
        />
        {selectedKey && (
          <button
            className="profile-search-clear"
            type="button"
            aria-label="Clear search"
            onClick={() => {
              setQuery("");
              onClear();
            }}
          >
            {"\u00d7"}
          </button>
        )}
        {open && q && (
          <div className="profile-search-dropdown">
            {matches.length ? (
              matches.map(([key, name]) => (
                <div key={key} className="profile-search-suggestion" onClick={() => select(key, name)}>
                  <NameWithTag fullName={name} />
                </div>
              ))
            ) : (
              <div className="profile-search-empty">No matches</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
