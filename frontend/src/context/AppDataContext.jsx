import { createContext, useCallback, useContext, useRef, useState } from "react";
import { api } from "../api/client";
import { setRankTiers } from "../utils/format";

const AppDataContext = createContext(null);

export function AppDataProvider({ children }) {
  const [players, setPlayers] = useState([]);
  const [funFacts, setFunFacts] = useState({ staticCutoffs: [] });
  const [groupColName, setGroupColName] = useState("Player");
  const [loaded, setLoaded] = useState(false);
  const loadingPromise = useRef(null);

  const loadTrueskill = useCallback((forceRefresh = false) => {
    if (loaded && !forceRefresh) return Promise.resolve();
    if (loadingPromise.current && !forceRefresh) return loadingPromise.current;
    loadingPromise.current = api
      .trueskill()
      .then((data) => {
        const list = Array.isArray(data.players) ? data.players : [];
        const ff = data.funFacts || { staticCutoffs: [] };
        setPlayers(list);
        setFunFacts(ff);
        setRankTiers(ff.staticCutoffs || []);
        setLoaded(true);
      })
      .finally(() => {
        loadingPromise.current = null;
      });
    return loadingPromise.current;
  }, [loaded]);

  const loadMeta = useCallback(() => {
    api.meta().then((meta) => setGroupColName(meta.groupCol));
  }, []);

  const value = {
    players,
    funFacts,
    groupColName,
    loaded,
    loadTrueskill,
    loadMeta,
  };

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
}

export function useAppData() {
  const ctx = useContext(AppDataContext);
  if (!ctx) throw new Error("useAppData must be used within AppDataProvider");
  return ctx;
}
