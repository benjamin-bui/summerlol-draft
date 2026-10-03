import { useEffect, useState } from "react";
import { Route, Routes, useSearchParams } from "react-router-dom";
import { AppDataProvider, useAppData } from "./context/AppDataContext";
import { useTheme } from "./hooks/useTheme";
import { routeState } from "./utils/routeState";
import TrueSkillTab from "./pages/TrueSkillTab";
import TournamentsTab from "./pages/TournamentsTab";
import ChampionsTab from "./pages/ChampionsTab";
import DraftIQTab from "./pages/DraftIQTab";
import TeamBalanceTab from "./pages/TeamBalanceTab";
import MockDraftTab from "./pages/MockDraftTab";
import UpcomingRosterTab from "./pages/UpcomingRosterTab";
import DraftDataTab from "./pages/DraftDataTab";
import MatchDataTab from "./pages/MatchDataTab";
import PlayerProfilePage from "./pages/PlayerProfilePage";
import SimpleProfilePage from "./pages/SimpleProfilePage";
import ChampionProfilePage from "./pages/ChampionProfilePage";

const TABS = [
  { key: "trueskill", label: "TrueSkill" },
  { key: "tournaments", label: "Tournaments" },
  { key: "champions", label: "Champions" },
  { key: "draftiq", label: "Draft vs. TrueSkill" },
  { key: "teambalance", label: "Team Balance" },
  { key: "mockdraft", label: "Mock Draft" },
  { key: "upcomingroster", label: null }, // label supplied once /api/upcoming-roster resolves; hidden until then
  { key: "draftdata", label: "Draft Data" },
  { key: "matchdata", label: "Match History" },
];

function ThemeToggle({ theme, toggle }) {
  return (
    <button className="theme-toggle" aria-label="Toggle dark/light mode" title="Toggle dark/light mode" onClick={toggle}>
      {theme === "light" ? "\u2600\ufe0f" : "\ud83c\udf19"}
    </button>
  );
}

function MainTabs({ theme, toggleTheme }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const { loadTrueskill, loadMeta } = useAppData();
  const [upcomingRosterTitle, setUpcomingRosterTitle] = useState(null);

  let tab = searchParams.get("tab") || "trueskill";
  if (tab === "rankings") tab = "tournaments";
  if (!TABS.some((t) => t.key === tab)) tab = "trueskill";

  useEffect(() => {
    loadMeta();
    loadTrueskill();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    routeState.lastKnownTab = tab;
  }, [tab]);

  function setTab(key) {
    const next = new URLSearchParams(searchParams);
    next.set("tab", key);
    if (key === "tournaments" && routeState.lastTournamentId) {
      next.set("tournament", routeState.lastTournamentId);
    }
    setSearchParams(next, { replace: true });
  }

  return (
    <div className="wrap">
      <header>
        <div>
          <h1>Williams College Player Rankings</h1>
        </div>
        <ThemeToggle theme={theme} toggle={toggleTheme} />
      </header>

      <section className="notes-section">
        <p>
          A mostly for-fun look at participant performance relative to draft order across the Williams College Summer
          and Winter LoL tournaments.
        </p>
      </section>

      <nav className="tabs">
        {TABS.map((t) => {
          if (t.key === "upcomingroster" && !upcomingRosterTitle) return null;
          return (
            <button key={t.key} className={`tab-btn${tab === t.key ? " active" : ""}`} onClick={() => setTab(t.key)}>
              {t.key === "upcomingroster" ? upcomingRosterTitle : t.label}
            </button>
          );
        })}
      </nav>

      <TournamentsTab
        active={tab === "tournaments"}
        selectedTournamentId={searchParams.get("tournament")}
        selectedMatchKey={searchParams.get("match")}
        onSelectionChange={(id) => {
          routeState.lastTournamentId = id;
          const next = new URLSearchParams(searchParams);
          if (id) next.set("tournament", id);
          setSearchParams(next, { replace: true });
        }}
      />
      <ChampionsTab active={tab === "champions"} />
      <TrueSkillTab active={tab === "trueskill"} />
      <DraftIQTab active={tab === "draftiq"} />
      <TeamBalanceTab active={tab === "teambalance"} />
      <MockDraftTab active={tab === "mockdraft"} />
      <UpcomingRosterTab active={tab === "upcomingroster"} onTitle={setUpcomingRosterTitle} />
      <DraftDataTab active={tab === "draftdata"} />
      <MatchDataTab active={tab === "matchdata"} />
    </div>
  );
}

export default function App() {
  const [theme, toggleTheme] = useTheme();
  return (
    <AppDataProvider>
      <Routes>
        <Route path="/" element={<MainTabs theme={theme} toggleTheme={toggleTheme} />} />
        <Route path="/player/:slug" element={<PlayerProfilePage />} />
        <Route path="/player/simple/:slug" element={<SimpleProfilePage />} />
        <Route path="/champion/:key" element={<ChampionProfilePage />} />
      </Routes>
      <footer>
        <a href="https://github.com/benjamin-bui/summerlol-draft" target="_blank" rel="noopener noreferrer">
          Source on GitHub
        </a>
      </footer>
    </AppDataProvider>
  );
}
