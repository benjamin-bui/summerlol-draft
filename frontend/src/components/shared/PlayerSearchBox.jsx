import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppData } from "../../context/AppDataContext";
import { buildPlayerSlug } from "../../utils/format";
import { NameWithTag } from "./Cells";

// Autocomplete over every known player -- picking a result navigates
// straight to their profile. Used both by the TrueSkill tab's search box and
// the "jump to another player" search on the profile page itself
// (clearOnSelect=true there, since it stays on screen for the next search).
export default function PlayerSearchBox({ placeholder = "Search for a player...", clearOnSelect = false }) {
  const { players } = useAppData();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);

  useEffect(() => {
    function handleClick(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, []);

  const q = query.trim().toLowerCase();
  const matches = q
    ? players
        .filter((p) => (p.group || "").toLowerCase().includes(q))
        .sort((a, b) => (a.group || "").localeCompare(b.group || ""))
        .slice(0, 8)
    : [];

  function go(group) {
    const slug = buildPlayerSlug(group) || group;
    navigate(`/player/${slug}`);
    if (clearOnSelect) {
      setQuery("");
      setOpen(false);
    }
  }

  return (
    <div className="profile-search-box" ref={boxRef}>
      <input
        type="text"
        className="profile-search-input"
        placeholder={placeholder}
        autoComplete="off"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
          if (e.key === "Enter" && matches[0]) {
            e.preventDefault();
            go(matches[0].group);
          }
        }}
      />
      {query && (
        <button
          className="profile-search-clear"
          type="button"
          aria-label="Clear search"
          onClick={() => {
            setQuery("");
            setOpen(false);
          }}
        >
          {"\u00d7"}
        </button>
      )}
      {open && q && (
        <div className="profile-search-dropdown">
          {players.length === 0 ? (
            <div className="profile-search-empty">{"Loading players\u2026"}</div>
          ) : matches.length ? (
            matches.map((p) => (
              <div key={p.identityKey || p.group} className="trueskill-search-suggestion" onClick={() => go(p.group)}>
                <NameWithTag fullName={p.group} />
              </div>
            ))
          ) : (
            <div className="profile-search-empty">No matches</div>
          )}
        </div>
      )}
    </div>
  );
}
