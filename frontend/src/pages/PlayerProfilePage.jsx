import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api/client";
import { useAppData } from "../context/AppDataContext";
import { NameWithTag, TrueSkillValue, SoloQueueRank } from "../components/shared/Cells";
import PlayerSearchBox from "../components/shared/PlayerSearchBox";
import ProfileChart from "../components/shared/ProfileChart";
import ProfileChampionsTable from "../components/shared/ProfileChampionsTable";
import ProfileHistoryTable from "../components/shared/ProfileHistoryTable";
import ProfileCoPlaySearch from "../components/shared/ProfileCoPlaySearch";
import { routeState } from "../utils/routeState";
import {
  average,
  buildCoPlayMaps,
  computeChampionDiversity,
  computeChampionStats,
  computeCoPlayRecords,
  historyHasBans,
  ofTotal,
  pickExtreme,
  pickPercentile,
  placementPercentile,
  seasonRankLocal,
  tournamentKey,
} from "../utils/profileCompute";
import { round3, buildPlayerSlug } from "../utils/format";

function SummaryPlayerLink({ rec }) {
  if (!rec) return <span className="profile-summary-coplay-value stat-formula">{"\u2013"}</span>;
  const pct = Math.round(rec.winRate * 100);
  const slug = buildPlayerSlug(rec.name) || rec.identityKey;
  return (
    <span className="profile-summary-coplay-value">
      <Link to={`/player/${slug}`} className="player-link">
        <NameWithTag fullName={rec.name} />
      </Link>{" "}
      <span className="stat-formula">
        ({pct}%, {rec.games}g)
      </span>
    </span>
  );
}

const ROLES = ["Top", "Jungle", "Mid", "Bot", "Supp"];
const ROLE_NAMES = { Top: "Top", Jungle: "Jungle", Mid: "Mid", Bot: "Bot", Supp: "Support" };

function RoleBreakdown({ history }) {
  const counts = new Map(ROLES.map((r) => [r, 0]));
  let total = 0;
  for (const entry of history) {
    const role = entry.playerDetails?.[0]?.role;
    if (!counts.has(role)) continue;
    counts.set(role, counts.get(role) + 1);
    total += 1;
  }
  if (!total) return null;
  return (
    <div className="profile-summary-roles">
      <h4>
        Role breakdown <span className="stat-formula">({total} {total === 1 ? "game" : "games"} with a role)</span>
      </h4>
      {ROLES.map((role) => {
        const games = counts.get(role);
        const pct = Math.round((games / total) * 100);
        return (
          <div className="role-row" title={`${games} of ${total} games`} key={role}>
            <span>{ROLE_NAMES[role]}</span>
            <span className="role-bar">
              <span style={{ width: `${(games / total) * 100}%` }} />
            </span>
            <strong>{pct}%</strong>
          </div>
        );
      })}
    </div>
  );
}

function SummaryBlock({ player, tournaments, championStats, history }) {
  const avgPick = average(tournaments.map(pickPercentile).filter((v) => v != null));
  const avgPlacement = average(tournaments.map(placementPercentile).filter((v) => v != null));
  const diversity = computeChampionDiversity(championStats);
  const { withMap, againstMap } = useMemo(() => computeCoPlayRecords(history, player?.identityKey), [history, player?.identityKey]);
  const bestWith = pickExtreme(withMap, "max");
  const worstWith = pickExtreme(withMap, "min");
  const bestAgainst = pickExtreme(againstMap, "max");
  const worstAgainst = pickExtreme(againstMap, "min");
  const fmtPct = (v) => (v != null ? `${Math.round(v)}%` : "\u2013");

  return (
    <section className="profile-block profile-summary-block">
      <h3>Summary</h3>
      <div className="profile-summary-stats">
        <div>
          <span>Average pick percentile</span>
          <strong>{fmtPct(avgPick)}</strong>
        </div>
        <div>
          <span>Average placement percentile</span>
          <strong>{fmtPct(avgPlacement)}</strong>
        </div>
        <div>
          <span title="Gini-Simpson index">Champion Diversity</span>
          <strong>{diversity != null ? diversity.toFixed(2) : "\u2013"}</strong>
        </div>
      </div>
      <RoleBreakdown history={history} />
      <div className="profile-summary-coplay">
        <div>
          <span>Highest win rate with</span>
          <SummaryPlayerLink rec={bestWith} />
        </div>
        <div>
          <span>Worst win rate with</span>
          <SummaryPlayerLink rec={worstWith} />
        </div>
        <div>
          <span>Best win rate against</span>
          <SummaryPlayerLink rec={bestAgainst} />
        </div>
        <div>
          <span>Worst win rate against</span>
          <SummaryPlayerLink rec={worstAgainst} />
        </div>
      </div>
    </section>
  );
}

function TournamentsBlock({ tournaments }) {
  if (!tournaments.length) {
    return (
      <section className="profile-block">
        <h3>Tournaments</h3>
        <p className="stat-formula">No draft history recorded.</p>
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
            <th>Placement</th>
            <th>Pick</th>
          </tr>
        </thead>
        <tbody>
          {tournaments.map((t, i) => {
            const record = t.games ? `${t.wins}-${t.losses}` : "\u2013";
            const winRate = t.games && t.winRate != null ? `${Math.round(t.winRate * 100)}%` : "\u2013";
            const placement = t.finalPlacement != null ? `#${t.finalPlacement}${t.totalTeams ? `/${t.totalTeams}` : ""}` : "\u2013";
            const pick = t.pickOrder === "Captain" ? "Captain" : ofTotal(t.pickOrder, t.totalPicks);
            return (
              <tr key={i}>
                <td>
                  {t.tournament} {t.year}
                </td>
                <td>
                  {winRate} <span className="stat-formula">({record})</span>
                </td>
                <td>{placement}</td>
                <td>{pick}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function TrueSkillBlock({ player, tournaments }) {
  const withEntry = tournaments.filter((t) => t.entryConservativeRating != null);
  return (
    <section className="profile-block">
      <h3>TrueSkill</h3>
      <div className="profile-current-rank">
        <TrueSkillValue rating={player.conservativeRating} mu={player.mu} />
        <span className="stat-formula">
          #{player.overallRank ?? "\u2013"} of {player.totalPlayers ?? "\u2013"} overall
        </span>
      </div>
      {withEntry.length ? (
        <table>
          <thead>
            <tr>
              <th>Tournament</th>
              <th>Entering rank</th>
              <th>Entering rating</th>
            </tr>
          </thead>
          <tbody>
            {withEntry.map((t, i) => (
              <tr key={i}>
                <td>
                  {t.tournament} {t.year}
                </td>
                <td>{ofTotal(t.entryRank ? `#${t.entryRank}` : null, t.totalInDraft)}</td>
                <td>
                  <TrueSkillValue rating={t.entryConservativeRating} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="stat-formula">No entering-rank history yet (needs at least one prior tournament on record).</p>
      )}
    </section>
  );
}

function TournamentFilterBlock({ tournaments, value, onChange }) {
  if (!tournaments.length) return null;
  const sorted = [...tournaments].sort((a, b) => b.year - a.year || seasonRankLocal(b.tournament) - seasonRankLocal(a.tournament));
  return (
    <section className="profile-block profile-filter-block">
      <div className="profile-filter-row">
        <span>Filtered for:</span>
        <select className="tournament-filter-select" value={value || ""} onChange={(e) => onChange(e.target.value || null)}>
          <option value="">All</option>
          {sorted.map((t) => (
            <option value={tournamentKey(t)} key={tournamentKey(t)}>
              {t.tournament} {t.year}
            </option>
          ))}
        </select>
      </div>
    </section>
  );
}

function CoPlaySummary({ mode, otherName, filtered, tournaments, selectedKey, placements }) {
  const wins = filtered.filter((e) => e.outcome === "win").length;
  const losses = filtered.filter((e) => e.outcome === "loss").length;
  const games = filtered.length;
  const winRate = games ? round3(wins / games) : null;

  const byTournament = new Map();
  for (const entry of filtered) {
    const tKey = `${entry.year}::${entry.tournament}`;
    if (!byTournament.has(tKey)) byTournament.set(tKey, { year: entry.year, tournament: entry.tournament, wins: 0, losses: 0, games: 0 });
    const t = byTournament.get(tKey);
    t.games += 1;
    if (entry.outcome === "win") t.wins += 1;
    else if (entry.outcome === "loss") t.losses += 1;
  }
  const tournamentRows = [...byTournament.values()]
    .map((t) => {
      const tKey = `${t.year}::${t.tournament}`;
      const myPlacement = tournaments.find((s) => `${s.year}::${s.tournament}` === tKey)?.finalPlacement ?? null;
      const theirPlacement = placements[`${selectedKey}::${tKey}`] ?? null;
      return { ...t, myPlacement, theirPlacement };
    })
    .sort((a, b) => b.year - a.year || seasonRankLocal(b.tournament) - seasonRankLocal(a.tournament));

  const winRateLabel = winRate != null ? `${Math.round(winRate * 100)}%` : "\u2013";
  const heading = mode === "against" ? `Played against ${otherName}` : `Played with ${otherName}`;
  const overallLabel = mode === "against" ? `${winRateLabel} win rate against them (${wins}-${losses})` : `${winRateLabel} win rate together (${wins}-${losses})`;

  return (
    <section className="profile-block profile-search-summary-block">
      <h3>{heading}</h3>
      <div className="profile-current-rank">
        {overallLabel} <span className="stat-formula">({games} g)</span>
      </div>
      {tournamentRows.length ? (
        <table>
          <thead>
            <tr>
              <th>Tournament</th>
              <th>Record vs them</th>
              <th>Your placement</th>
              {mode === "against" && <th>Their placement</th>}
            </tr>
          </thead>
          <tbody>
            {tournamentRows.map((t, i) => (
              <tr key={i}>
                <td>
                  {t.tournament} {t.year}
                </td>
                <td>
                  {t.wins}-{t.losses}
                </td>
                <td>{t.myPlacement != null ? `#${t.myPlacement}` : "\u2013"}</td>
                {mode === "against" && <td>{t.theirPlacement != null ? `#${t.theirPlacement}` : "\u2013"}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="stat-formula">No shared tournaments recorded.</p>
      )}
    </section>
  );
}

export default function PlayerProfilePage() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const { loadTrueskill } = useAppData();
  const [player, setPlayer] = useState(null);
  const [error, setError] = useState(null);
  const [tournamentFilter, setTournamentFilter] = useState(null);
  const [mode, setMode] = useState("with");
  const [selectedKey, setSelectedKey] = useState(null);
  const [championSort, setChampionSort] = useState({ column: null, dir: "desc" });
  const [placements, setPlacements] = useState({});

  useEffect(() => {
    loadTrueskill(false);
  }, [loadTrueskill]);

  // Reset per-player UI state during render when the slug changes, rather
  // than in the fetch effect below -- avoids an extra render pass for what
  // is really just "adjust state when a prop changes".
  const [prevSlug, setPrevSlug] = useState(slug);
  if (slug !== prevSlug) {
    setPrevSlug(slug);
    setPlayer(null);
    setError(null);
    setTournamentFilter(null);
    setSelectedKey(null);
    setChampionSort({ column: null, dir: "desc" });
  }

  useEffect(() => {
    api
      .player(slug)
      .then((data) => {
        setPlayer(data);
        if (data.slug && data.slug !== slug) {
          navigate(`/player/${data.slug}`, { replace: true });
        }
      })
      .catch((err) => setError(err.message || "Unable to load player profile"));
  }, [slug]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (selectedKey) api.placements().then(setPlacements);
  }, [selectedKey]);

  function goBack() {
    const cameFromThisSite = document.referrer && document.referrer.startsWith(window.location.origin);
    if (cameFromThisSite && window.history.length > 1) {
      navigate(-1);
    } else {
      navigate(`/?tab=${routeState.lastKnownTab}`);
    }
  }

  if (error) {
    return (
      <div className="wrap">
        <div className="player-profile-header">
          <button className="player-profile-back" onClick={goBack}>
            {"\u2190"} Back
          </button>
        </div>
        <p>{error}</p>
      </div>
    );
  }
  if (!player) {
    return (
      <div className="wrap">
        <div className="player-profile-header">
          <button className="player-profile-back" onClick={goBack}>
            {"\u2190"} Back
          </button>
          <h2>{"Loading\u2026"}</h2>
        </div>
      </div>
    );
  }

  const tournaments = player.tournamentSummaries || [];
  const history = player.history || [];
  const baseHistory = tournamentFilter ? history.filter((h) => tournamentKey(h) === tournamentFilter) : history;
  const { teammates, opponents } = buildCoPlayMaps(history, player.identityKey);
  const pool = mode === "against" ? opponents : teammates;

  const filteredHistory = selectedKey
    ? baseHistory.filter((entry) => {
        const roster = mode === "against" ? entry.opponentTeam?.roster : entry.ownTeam?.roster;
        return (roster || []).some((m) => m.identityKey === selectedKey);
      })
    : baseHistory;

  const championExtras = historyHasBans(history) ? ["bannedAgainst"] : [];
  const championStats =
    selectedKey || tournamentFilter ? computeChampionStats(filteredHistory) : player.championStats || [];
  const historyDescending = [...filteredHistory].reverse();
  const showRole = history.some((e) => e.playerDetails?.[0]?.role);

  const title = player.group || player.identityKey || "Player";

  return (
    <div className="wrap">
      <div className="player-profile-header">
        <button className="player-profile-back" onClick={goBack}>
          {"\u2190"} Back
        </button>
        <PlayerSearchBox placeholder="Search for another player..." clearOnSelect />
      </div>
      <h2 className="player-profile-title">
        <NameWithTag fullName={title} />
      </h2>
      <div className="profile-header">
        <div className="profile-header-top">
          <div className="profile-identity">
            <div className="profile-summary">
              <span>{player.identified ? "Identified" : "Unidentified"}</span>
              {player.profileUrl && (
                <a href={player.profileUrl} target="_blank" rel="noopener noreferrer">
                  Open op.gg
                </a>
              )}
              <span>
                Games: {player.games ?? "\u2013"} {"\u00b7"} {player.wins ?? 0}-{player.losses ?? 0}
              </span>
              {player.soloQueueRank && <SoloQueueRank rank={player.soloQueueRank} />}
            </div>
          </div>
        </div>
      </div>
      <div className="profile-layout">
        <aside className="profile-sidebar">
          <SummaryBlock player={player} tournaments={tournaments} championStats={player.championStats || []} history={history} />
          <TournamentFilterBlock tournaments={tournaments} value={tournamentFilter} onChange={setTournamentFilter} />
          <TournamentsBlock tournaments={tournaments} />
          <TrueSkillBlock player={player} tournaments={tournaments} />
          <ProfileChampionsTable championStats={championStats} extras={championExtras} sort={championSort} setSort={setChampionSort} />
        </aside>
        <main className="profile-main">
          <div className="profile-header-chart">
            <ProfileChart history={history} />
          </div>
          <ProfileCoPlaySearch
            mode={mode}
            setMode={setMode}
            pool={pool}
            selectedKey={selectedKey}
            onSelect={setSelectedKey}
            onClear={() => setSelectedKey(null)}
          />
          {selectedKey && (
            <CoPlaySummary
              mode={mode}
              otherName={pool.get(selectedKey) || selectedKey}
              filtered={filteredHistory}
              tournaments={tournaments}
              selectedKey={selectedKey}
              placements={placements}
            />
          )}
          <div>
            <ProfileHistoryTable entries={historyDescending} showRole={showRole} />
          </div>
        </main>
      </div>
    </div>
  );
}
