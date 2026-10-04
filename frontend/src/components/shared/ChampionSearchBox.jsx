import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../api/client";
import { ChampionIcon } from "./Cells";

export default function ChampionSearchBox({ placeholder = "Search for a champion..." }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [champions, setChampions] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const loadingRef = useRef(null);
  const boxRef = useRef(null);

  useEffect(() => {
    function handleClick(event) {
      if (boxRef.current && !boxRef.current.contains(event.target)) setOpen(false);
    }
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, []);

  function loadChampions() {
    if (loaded || loadingRef.current) return;
    setLoading(true);
    setLoadError(false);
    loadingRef.current = api
      .tournaments()
      .then((data) => {
        const byKey = new Map();
        for (const tournament of data.tournaments || []) {
          for (const match of tournament.matches || []) {
            for (const team of [match.team1, match.team2]) {
              for (const player of team?.roster || []) {
                if (player.championKey && player.champion && !byKey.has(player.championKey)) {
                  byKey.set(player.championKey, { key: player.championKey, champion: player.champion });
                }
              }
            }
          }
        }
        setChampions([...byKey.values()].sort((a, b) => a.champion.localeCompare(b.champion)));
        setLoaded(true);
      })
      .catch(() => setLoadError(true))
      .finally(() => {
        loadingRef.current = null;
        setLoading(false);
      });
  }

  const q = query.trim().toLowerCase();
  const matches = q ? champions.filter((champion) => champion.champion.toLowerCase().includes(q)).slice(0, 8) : [];

  function go(champion) {
    navigate(`/champion/${encodeURIComponent(champion.key)}`);
    setQuery("");
    setOpen(false);
  }

  return (
    <div className="profile-search-box" ref={boxRef}>
      <input
        type="text"
        className="profile-search-input"
        placeholder={placeholder}
        autoComplete="off"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          loadChampions();
        }}
        onFocus={() => {
          setOpen(true);
          loadChampions();
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
          if (event.key === "Enter" && matches[0]) {
            event.preventDefault();
            go(matches[0]);
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
          {loading ? (
            <div className="profile-search-empty">{"Loading champions\u2026"}</div>
          ) : loadError ? (
            <div className="profile-search-empty">Unable to load champions</div>
          ) : matches.length ? (
            matches.map((champion) => (
              <div key={champion.key} className="trueskill-search-suggestion" onClick={() => go(champion)}>
                <ChampionIcon champion={champion.champion} />
              </div>
            ))
          ) : (
            <div className="profile-search-empty">{loaded ? "No matches" : "Loading champions\u2026"}</div>
          )}
        </div>
      )}
    </div>
  );
}