import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api/client";
import { useAppData } from "../context/AppDataContext";
import { ChampionIcon, ChampionLink } from "../components/shared/Cells";
import ChampionSearchBox from "../components/shared/ChampionSearchBox";
import ChampionMatchupTable from "../components/shared/ChampionMatchupTable";
import ChampionPlayersTable from "../components/shared/ChampionPlayersTable";
import ProfileHistoryTable from "../components/shared/ProfileHistoryTable";
import ProfileTournamentFilter from "../components/shared/ProfileTournamentFilter";
import RoleBreakdown from "../components/shared/RoleBreakdown";
import { useGoBack } from "../hooks/useGoBack";
import { ROLE_LABELS, ROLES } from "../utils/format";
import { computeChampionMatchupRows, computeChampionMatchups, computeChampionPlayers, computeChampionTournaments, pickExtreme, tournamentKey } from "../utils/profileCompute";

const byChampionName = (a, b) => a.champion.localeCompare(b.champion);

function SummaryChampionLink({ rec }) {
  if (!rec) return <span className="profile-summary-coplay-value stat-formula">{"\u2013"}</span>;
  const pct = Math.round(rec.winRate * 100);
  return (
    <span className="profile-summary-coplay-value">
      <ChampionLink champion={rec.champion} championKey={rec.key} />{" "}
      <span className="stat-formula">
        ({pct}%, {rec.games}g)
      </span>
    </span>
  );
}

function SummaryBlock({ history }) {
  const { withMap, againstMap, againstSameRoleByRole } = useMemo(() => computeChampionMatchups(history), [history]);
  const bestWith = pickExtreme(withMap, "max", byChampionName);
  const worstWith = pickExtreme(withMap, "min", byChampionName);
  const bestAgainst = pickExtreme(againstMap, "max", byChampionName);
  const worstAgainst = pickExtreme(againstMap, "min", byChampionName);
  const rolesPlayed = ROLES.filter((role) => history.some((entry) => entry.playerDetails?.[0]?.role === role));
  return (
    <section className="profile-block profile-summary-block champion-profile-summary">
      <h3>Summary</h3>
      <RoleBreakdown history={history} />
      <div className="profile-summary-coplay">
        <div>
          <span>Highest win rate with</span>
          <SummaryChampionLink rec={bestWith} />
        </div>
        <div>
          <span>Worst win rate with</span>
          <SummaryChampionLink rec={worstWith} />
        </div>
        <div>
          <span>Best win rate against overall</span>
          <SummaryChampionLink rec={bestAgainst} />
        </div>
        <div>
          <span>Worst win rate against overall</span>
          <SummaryChampionLink rec={worstAgainst} />
        </div>
        {rolesPlayed.flatMap((role) => {
          const matchups = againstSameRoleByRole.get(role) || new Map();
          return [
            <div key={`${role}-best`}>
              <span>Best win rate against ({ROLE_LABELS[role] || role})</span>
              <SummaryChampionLink rec={pickExtreme(matchups, "max", byChampionName)} />
            </div>,
            <div key={`${role}-worst`}>
              <span>Worst win rate against ({ROLE_LABELS[role] || role})</span>
              <SummaryChampionLink rec={pickExtreme(matchups, "min", byChampionName)} />
            </div>,
          ];
        })}
      </div>
    </section>
  );
}

function TournamentsBlock({ tournaments }) {
  if (!tournaments.length) {
    return (
      <section className="profile-block">
        <h3>Tournaments</h3>
        <p className="stat-formula">Not picked in any recorded game.</p>
      </section>
    );
  }
  return (
    <section className="profile-block">
      <h3>Tournaments</h3>
      <table>
        <thead>
          <tr>
            <th>Tournament</th>
            <th>Win rate</th>
          </tr>
        </thead>
        <tbody>
          {tournaments.map((t) => (
            <tr key={tournamentKey(t)}>
              <td>
                {t.tournament} {t.year}
              </td>
              <td>
                {t.winRate != null ? `${Math.round(t.winRate * 100)}%` : "\u2013"}{" "}
                <span className="stat-formula">
                  ({t.wins}-{t.losses})
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export default function ChampionProfilePage() {
  const { key } = useParams();
  const navigate = useNavigate();
  const goBack = useGoBack();
  const { loadTrueskill } = useAppData();
  const [champion, setChampion] = useState(null);
  const [error, setError] = useState(null);
  const [tournamentFilter, setTournamentFilter] = useState(null);

  // Player names link to profiles and TrueSkill cells need the rank tiers, so
  // make sure the shared TrueSkill data is loaded (same as the player page).
  useEffect(() => {
    loadTrueskill(false);
  }, [loadTrueskill]);

  // Reset per-champion UI state during render when the route changes.
  const [prevKey, setPrevKey] = useState(key);
  if (key !== prevKey) {
    setPrevKey(key);
    setChampion(null);
    setError(null);
    setTournamentFilter(null);
  }

  useEffect(() => {
    let stale = false;
    api
      .champion(key)
      .then((data) => {
        if (stale) return;
        setChampion(data);
        // Old/hand-typed links ("Lee Sin") resolve server-side; show the canonical URL.
        if (data.key && data.key !== key) navigate(`/champion/${data.key}`, { replace: true });
      })
      .catch((err) => {
        if (!stale) setError(err.message || "Unable to load champion");
      });
    return () => {
      stale = true;
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const history = useMemo(() => champion?.history || [], [champion]);
  const tournaments = useMemo(() => computeChampionTournaments(history), [history]);
  const filteredHistory = useMemo(
    () => (tournamentFilter ? history.filter((entry) => tournamentKey(entry) === tournamentFilter) : history),
    [history, tournamentFilter],
  );
  const players = useMemo(() => computeChampionPlayers(filteredHistory), [filteredHistory]);
  const matchupRows = useMemo(() => computeChampionMatchupRows(filteredHistory), [filteredHistory]);
  const historyDescending = useMemo(() => [...filteredHistory].reverse(), [filteredHistory]);

  const backButton = (
    <button className="player-profile-back" onClick={goBack}>
      {"\u2190"} Back
    </button>
  );

  if (error) {
    return (
      <div className="wrap">
        <div className="player-profile-header">{backButton}</div>
        <p>{/\(404\)/.test(error) ? "Champion not found." : error}</p>
      </div>
    );
  }
  if (!champion) {
    return (
      <div className="wrap">
        <div className="player-profile-header">
          {backButton}
          <h2>{"Loading\u2026"}</h2>
        </div>
      </div>
    );
  }

  const showRole = history.some((entry) => entry.playerDetails?.[0]?.role);

  return (
    <div className="wrap">
      <div className="player-profile-topbar">
        {backButton}
        <ChampionSearchBox />
      </div>
      <h2 className="player-profile-title champion-profile-title">
        <ChampionIcon champion={champion.champion} />
      </h2>
      <div className="profile-header">
        <div className="profile-header-top">
          <div className="profile-identity">
            <div className="profile-summary">
              <span>
                Games: {champion.games} {"\u00b7"} {champion.wins}-{champion.losses}
                {champion.draws ? `-${champion.draws}` : ""}
              </span>
              {champion.gamesBanned > 0 && (
                <span>
                  Banned in {champion.gamesBanned} {champion.gamesBanned === 1 ? "game" : "games"}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
      <div className="profile-layout">
        <aside className="profile-sidebar">
          <SummaryBlock history={history} />
          <ProfileTournamentFilter tournaments={tournaments} value={tournamentFilter} onChange={setTournamentFilter} />
          <TournamentsBlock tournaments={tournaments} />
          <ChampionPlayersTable players={players} />
          <ChampionMatchupTable matchups={matchupRows} />
        </aside>
        <main className="profile-main">
          <div id="profileHistoryTableWrap">
            <ProfileHistoryTable entries={historyDescending} showRole={showRole} showPlayer />
          </div>
        </main>
      </div>
    </div>
  );
}
