import { Fragment, useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { useAppData } from "../context/AppDataContext";
import { PlayerLink, ChampionLink, BanList, RoleIcon, TrueSkillValue } from "../components/shared/Cells";
import MatchDetailEditor from "../components/shared/MatchDetailEditor";
import TournamentStructureEditor from "../components/shared/TournamentStructureEditor";
import TournamentFunFacts from "../components/shared/TournamentFunFacts";
import { ordinal, pct, pctOrLessThanOne, sortByRole } from "../utils/format";
import { useAuth } from "../context/AuthContext";

function playerLinkProps(displayName, identityKey) {
  return { fullName: displayName || identityKey || "\u2013", identityKey };
}

const MAX_TIED_CHAMPIONS_SHOWN = 4;
function ChampionValue({ names, stat }) {
  const shown = names.slice(0, MAX_TIED_CHAMPIONS_SHOWN);
  const more = names.length > MAX_TIED_CHAMPIONS_SHOWN ? names.length - MAX_TIED_CHAMPIONS_SHOWN : 0;
  return (
    <span className="tournament-champion-value">
      <span className="tournament-champion-list">
        {shown.map((n) => (
          <ChampionLink champion={n} key={n} />
        ))}
        {more > 0 && <span className="stat-formula">+{more} more</span>}
      </span>
      <span className="stat-formula">{stat}</span>
    </span>
  );
}

function hasBanData(t) {
  return (t.championCoverage.gamesWithBans || 0) > 0;
}

function summaryRow(key, label, valueNode, title) {
  return (
    <div key={key}>
      <span title={title}>{label}</span>
      <span className="profile-summary-coplay-value">{valueNode}</span>
    </div>
  );
}

function UpsetRow({ u, onJump }) {
  if (!u) {
    return (
      <div className="tournament-stack">
        <span>Biggest upset</span>
        <div className="stat-formula">No decisive games recorded.</div>
      </div>
    );
  }
  const where = [u.matchStage || null, u.matchOrder != null ? `match ${u.matchOrder}` : null].filter(Boolean).join(" \u00b7 ");
  const avgs = u.winnerAvg != null && u.loserAvg != null ? ` (avg TrueSkill ${Math.round(u.winnerAvg)} vs ${Math.round(u.loserAvg)})` : "";
  return (
    <div className="tournament-stack">
      <span>Biggest upset</span>
      <div className="tournament-upset-line">
        <PlayerLink {...playerLinkProps(u.winnerName, u.winnerKey)} /> <span className="stat-formula">over</span>{" "}
        <PlayerLink {...playerLinkProps(u.loserName, u.loserKey)} />
      </div>
      <div className="stat-formula">
        {where ? `${where}: ` : ""}only a {pctOrLessThanOne(u.predictedWinProbForWinner)} predicted chance{avgs}.{" "}
        <button type="button" className="tournament-jump" onClick={() => onJump(u.matchKey)}>
          View match {"\u2193"}
        </button>
      </div>
    </div>
  );
}

function SummaryBlock({ t, onJump }) {
  const s = t.summary;
  const hasChampionData = t.championCoverage.gamesWithDetails > 0;
  const min = s.minGamesForWinRateCallouts;
  const rows = [];

  if (hasChampionData) {
    const mp = s.mostPicked;
    if (mp) {
      rows.push(
        summaryRow(
          "mostPicked",
          "Most picked champion",
          <ChampionValue names={mp.champions} stat={`(${mp.games} games${mp.champions.length > 1 ? " each" : ""} \u00b7 ${pct(mp.pickRate)} pick rate)`} />,
        ),
      );
    }
    if (hasBanData(t)) {
      const mb = s.mostBanned;
      if (mb) {
        rows.push(
          summaryRow(
            "mostBanned",
            "Most banned champion",
            <ChampionValue
              names={mb.champions}
              stat={`(${mb.bans} ${mb.bans === 1 ? "game" : "games"}${mb.champions.length > 1 ? " each" : ""} \u00b7 ${pct(mb.banRate)} ban rate)`}
            />,
            "Champion banned in the most games (ban rate is out of games with bans recorded)",
          ),
        );
      }
      const mc = s.mostContested;
      if (mc) {
        rows.push(
          summaryRow(
            "mostContested",
            "Most contested champion",
            <ChampionValue
              names={mc.champions}
              stat={`(${mc.contested} ${mc.contested === 1 ? "game" : "games"}${mc.champions.length > 1 ? " each" : ""} \u00b7 ${pct(mc.contestRate)} contest rate)`}
            />,
            "Contested = picked or banned in a game. Contest rate = contested games / games with champion data",
          ),
        );
      }
    }
    const recordRow = (key, label, entry) =>
      summaryRow(
        key,
        label,
        entry ? (
          <ChampionValue names={entry.champions} stat={`(${pct(entry.winRate)} \u00b7 ${entry.wins}-${entry.losses}${entry.champions.length > 1 ? " each" : ""})`} />
        ) : (
          <span className="stat-formula">None with {min}+ games</span>
        ),
        `Highest/lowest win rate among champions with at least ${min} games`,
      );
    rows.push(recordRow("winningest", `Best champion (${min}+ games)`, s.winningest));
    rows.push(recordRow("losingest", `Worst champion (${min}+ games)`, s.losingest));

    const d = s.diversity;
    rows.push(
      summaryRow(
        "diversity",
        "Champion Diversity (0-1)",
        d ? <strong>{d.diversity.toFixed(2)}</strong> : <span className="stat-formula">{"\u2013"}</span>,
        d
          ? d.championsBanned > 0
            ? `Champion diversity is 1 minus the Gini coefficient of contest rates across all ${d.poolSize} champions that could have been picked or banned in ${t.year} (released that year or earlier). A champion's contest rate is the share of games it was picked or banned in; ${d.championsContested} were picked or banned, and champions nobody picked or banned count as a 0% contest rate. 0 means every pick and ban went to a single champion; 1 means every available champion was contested equally often. Higher = more diverse.`
            : `Champion diversity is 1 minus the Gini coefficient of contest rates (share of games a champion was picked or banned in) across all ${d.poolSize} champions that could have been picked in ${t.year} (released that year or earlier). No bans are recorded for this tournament, so contest rate is just pick rate; ${d.championsPicked} champions were picked, and champions nobody picked count as a 0% rate. 0 means every pick went to a single champion; 1 means every available champion was picked equally often. Higher = more diverse.`
          : "Needs champion data for this tournament.",
      ),
    );
  }

  return (
    <section className="profile-block profile-summary-block">
      <h3>Summary</h3>
      <div className="profile-summary-coplay">
        {rows}
        <UpsetRow u={s.biggestUpset} onJump={onJump} />
      </div>
      {!hasChampionData && (
        <p className="stat-formula tournament-note">
          Champion stats aren{"\u2019"}t available {"\u2014"} no champion data has been recorded for this tournament.
        </p>
      )}
    </section>
  );
}

const CHAMPION_SORT_VALUE = {
  games: (c) => c.games,
  winRate: (c) => c.winRate ?? -1,
  kda: (c) => (c.games === 0 ? -1 : c.kda === null ? Infinity : c.kda),
  bans: (c) => c.bans ?? 0,
  contested: (c) => c.contested ?? c.games,
};
const CHAMPION_SORT_TIEBREAK = {
  games: ["winRate"],
  winRate: ["games"],
  kda: ["games"],
  bans: ["games"],
  contested: ["games"],
};

function sortedChampionStats(t, championSort) {
  const list = [...t.championStats];
  const { column, dir } = championSort;
  if (!column) return list;
  const cmp = (x, y) => (x === y ? 0 : x < y ? -1 : 1);
  const sign = dir === "asc" ? 1 : -1;
  return list.sort((a, b) => {
    const primary = cmp(CHAMPION_SORT_VALUE[column](a), CHAMPION_SORT_VALUE[column](b));
    if (primary) return sign * primary;
    for (const key of CHAMPION_SORT_TIEBREAK[column]) {
      const tie = cmp(CHAMPION_SORT_VALUE[key](b), CHAMPION_SORT_VALUE[key](a));
      if (tie) return tie;
    }
    return a.champion.localeCompare(b.champion);
  });
}

function ChampionSortHeader({ column, label, hint, championSort, onSort }) {
  const active = championSort.column === column;
  const asc = championSort.dir === "asc";
  const cls = active ? (asc ? "sorted-asc" : "sorted-desc") : "";
  const title = hint ? `${hint}. Click to sort` : `Sort by ${label.toLowerCase()}`;
  return (
    <th className={cls} onClick={() => onSort(column)} title={title} tabIndex={0}>
      {label}
    </th>
  );
}

function championRowOptions(t) {
  return hasBanData(t) ? { extras: ["bans", "contest"], contestGames: t.championCoverage.gamesWithChampionData } : {};
}

function ChampionRows({ stats, options = {} }) {
  const extras = options.extras || [];
  if (!stats.length) {
    return (
      <tr>
        <td colSpan={4 + extras.length} className="stat-formula">
          No champion data for this filter.
        </td>
      </tr>
    );
  }
  return (
    <>
      {stats.map((c) => {
        const played = c.games > 0;
        const winRate = played && c.winRate != null ? `${Math.round(c.winRate * 100)}%` : "\u2013";
        const kda = !played ? "\u2013" : c.kda == null ? "Perfect" : c.kda.toFixed(2);
        return (
          <tr
            key={c.key || c.champion}
            className={`tournament-champion-row${c.isSelected ? " is-selected" : ""}`}
            tabIndex={0}
            role="button"
            aria-pressed={c.isSelected ? "true" : "false"}
            onClick={c.onClick}
          >
            <td>
              <ChampionLink champion={c.champion} championKey={c.key} />
            </td>
            <td>{c.games}</td>
            <td>{winRate}</td>
            <td>{kda}</td>
            {extras.includes("bans") && <td>{String(c.bans ?? 0)}</td>}
            {extras.includes("contest") && (
              <td>{options.contestGames ? `${Math.round(((c.contested ?? c.games) / options.contestGames) * 100)}%` : "\u2013"}</td>
            )}
          </tr>
        );
      })}
    </>
  );
}

function ChampionsBlock({ t, championSort, setChampionSort, championFilterKey, onToggleChampion }) {
  if (!t.championStats.length) {
    return (
      <section className="profile-block">
        <h3>Champions</h3>
        <p className="stat-formula">No champion data recorded for this tournament.</p>
      </section>
    );
  }
  const { gamesWithDetails, gamesWithBans, totalGames } = t.championCoverage;
  const withBans = hasBanData(t);
  const notes = [];
  if (gamesWithDetails < totalGames) notes.push(`Champion data covers ${gamesWithDetails} of ${totalGames} games.`);
  if (withBans && gamesWithBans < totalGames) notes.push(`Ban data covers ${gamesWithBans} of ${totalGames} games.`);
  const playedCount = t.championStats.filter((c) => c.games > 0).length;
  const bannedOnlyCount = t.championStats.length - playedCount;
  const countLabel = withBans ? `${playedCount} played${bannedOnlyCount ? ` \u00b7 ${bannedOnlyCount} only banned` : ""}` : `${t.championStats.length} played`;
  if (t.unrecognizedChampions.length) {
    notes.push(`Not recognized as champions (check the match-details CSV for typos): ${t.unrecognizedChampions.join(", ")}.`);
  }

  const sorted = sortedChampionStats(t, championSort).map((c) => ({
    ...c,
    isSelected: c.key === championFilterKey,
    onClick: () => onToggleChampion(c.key),
  }));

  function onSort(column) {
    setChampionSort((prev) => (prev.column === column ? { column, dir: prev.dir === "desc" ? "asc" : "desc" } : { column, dir: "desc" }));
  }

  return (
    <section className="profile-block tournament-champions-block">
      <h3>
        Champions <span className="stat-formula">({countLabel} {"\u00b7"} click to filter)</span>
      </h3>
      <div className="tournament-champions-body">
        <div className="tournament-champions-scroll">
          <table className={`tournament-champions-table${withBans ? " has-bans" : ""}`}>
            <thead>
              <tr>
                <th className="not-sortable">Champion</th>
                <ChampionSortHeader column="games" label="Games" championSort={championSort} onSort={onSort} />
                <ChampionSortHeader column="winRate" label="Win rate" championSort={championSort} onSort={onSort} />
                <ChampionSortHeader column="kda" label="KDA" championSort={championSort} onSort={onSort} />
                {withBans && <ChampionSortHeader column="bans" label="Bans" championSort={championSort} onSort={onSort} />}
                {withBans && (
                  <ChampionSortHeader
                    column="contested"
                    label="Contest"
                    hint="Contest rate: share of games the champion was picked or banned in"
                    championSort={championSort}
                    onSort={onSort}
                  />
                )}
              </tr>
            </thead>
            <tbody>
              <ChampionRows stats={sorted} options={championRowOptions(t)} />
            </tbody>
          </table>
        </div>
      </div>
      {notes.map((n, i) => (
        <p className="stat-formula tournament-note" key={i}>
          {n}
        </p>
      ))}
    </section>
  );
}

function TeamCard({ team }) {
  const record = team.games ? `${team.wins}-${team.losses}${team.draws ? `-${team.draws}` : ""}` : "\u2013";
  return (
    <article className="tournament-team-card">
      <header className="tournament-team-head">
        {team.placement != null && (
          <span className="tournament-team-place" title="Final placement">
            {ordinal(team.placement)}
          </span>
        )}
        <span className="tournament-team-name">
          <PlayerLink {...playerLinkProps(team.captainName, team.captainKey)} />
        </span>
        <span className="stat-formula">
          {record}
          {team.winRate != null ? ` \u00b7 ${pct(team.winRate)}` : ""}
        </span>
      </header>
      <table>
        <thead>
          <tr>
            <th>Pick</th>
            <th>Player</th>
            <th>Entering rank</th>
          </tr>
        </thead>
        <tbody>
          {team.roster.map((m, i) => (
            <tr key={i} className={m.isCaptain ? "roster-captain-row" : ""}>
              <td>{m.isCaptain ? "Cap" : m.pickOrder != null ? `#${m.pickOrder}` : "\u2013"}</td>
              <td>
                <PlayerLink {...playerLinkProps(m.displayName, m.identityKey)} />
              </td>
              <td title={m.entryRank != null ? `TrueSkill entering the tournament: ${Math.round(m.entryRating)}` : undefined}>
                {m.entryRank != null ? `#${m.entryRank}` : "\u2013"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </article>
  );
}

function TeamsBlock({ t }) {
  const pool = t.entryRankPoolSize;
  const legend = pool
    ? `Pick = draft pick number (captains aren't picked). Entering rank = TrueSkill rank among all ${pool} players entering this tournament (#1 = best).`
    : `Pick = draft pick number (captains aren't picked). Entering rank isn't available \u2014 there were no earlier games to rate anyone from.`;
  return (
    <section className="profile-block">
      <h3>Team rosters</h3>
      <p className="stat-formula tournament-note">{legend}</p>
      <div className="tournament-teams">
        {t.teams.map((team, i) => (
          <TeamCard team={team} key={i} />
        ))}
      </div>
    </section>
  );
}

function resultStages(t) {
  if (Array.isArray(t.stages) && t.stages.length) return t.stages;

  const stages = new Map();
  for (const match of t.matches) {
    const name = match.stageName || match.stage || "Tournament";
    const id = match.stageId || `legacy:${name}`;
    if (!stages.has(id)) {
      stages.set(id, {
        stageId: id,
        name,
        format: match.stageFormat || "custom",
        order: match.stageOrder || match.order || 1,
        groups: new Map(),
      });
    }
    const stage = stages.get(id);
    const groupId = match.seriesId || `game:${match.matchKey}`;
    if (!stage.groups.has(groupId)) {
      stage.groups.set(groupId, {
        seriesId: match.seriesId || null,
        roundLabel: match.seriesRound || null,
        bestOf: match.bestOf || null,
        games: [],
      });
    }
    stage.groups.get(groupId).games.push(match);
  }
  return [...stages.values()].map((stage) => ({
    ...stage,
    groups: [...stage.groups.values()],
  }));
}

function formatStageFormat(format) {
  return format
    ?.replaceAll("-", " ")
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function resultTeamKey(team) {
  return team.key || team.name;
}

// Folds one round's results into `records` (the running W-L per team) and
// returns the round's series. Swiss rounds are re-sorted by the teams'
// standings; round-robin rounds keep their played order (`sort: false`).
function swissRoundResults(groups, records, { sort = true } = {}) {
  const outcomes = groups.map((entry) => {
    const { group } = entry;
    const games = [...group.games].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const first = games[0];
    if (!first) return null;

    const teams = [first.team1, first.team2];
    const wins = [0, 0];
    for (const game of games) {
      if (game.winner === "team1" || game.winner === "team2") {
        const winner = game.winner === "team1" ? game.team1 : game.team2;
        const side = teams.findIndex((team) => resultTeamKey(team) === resultTeamKey(winner));
        if (side >= 0) wins[side] += 1;
      }
    }

    return {
      ...entry,
      teams,
      winner: wins[0] === wins[1] ? null : wins[0] > wins[1] ? 0 : 1,
    };
  });

  for (const outcome of outcomes) {
    if (!outcome) continue;
    outcome.teams.forEach((team, side) => {
      const key = resultTeamKey(team);
      const record = records.get(key) || { wins: 0, losses: 0 };
      if (outcome.winner !== null) {
        records.set(key, {
          wins: record.wins + (outcome.winner === side ? 1 : 0),
          losses: record.losses + (outcome.winner === side ? 0 : 1),
        });
      } else if (!records.has(key)) {
        records.set(key, record);
      }
    });
  }

  const teamStanding = (team) => {
    const record = records.get(resultTeamKey(team)) || { wins: 0, losses: 0 };
    return {
      wins: record.wins,
      losses: record.losses,
      strength: team.avg ?? team.avgMu ?? 0,
    };
  };
  if (!sort) return { records: new Map(records), groups: outcomes.filter(Boolean) };
  const sortedGroups = outcomes
    .filter(Boolean)
    .sort((a, b) => {
      const aStandings = a.teams.map(teamStanding).sort((x, y) => y.wins - x.wins || x.losses - y.losses || y.strength - x.strength);
      const bStandings = b.teams.map(teamStanding).sort((x, y) => y.wins - x.wins || x.losses - y.losses || y.strength - x.strength);
      for (let side = 0; side < aStandings.length; side += 1) {
        const difference =
          bStandings[side].wins - aStandings[side].wins ||
          aStandings[side].losses - bStandings[side].losses ||
          bStandings[side].strength - aStandings[side].strength;
        if (difference) return difference;
      }
      return a.groupIndex - b.groupIndex;
    });

  return { records: new Map(records), groups: sortedGroups };
}

function SeriesResultCard({ group, index, records, onJump }) {
  const games = [...group.games].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const first = games[0];
  if (!first) return null;
  const teams = [
    { key: first.team1.key, name: first.team1.name },
    { key: first.team2.key, name: first.team2.name },
  ];
  const wins = [0, 0];
  let draws = 0;
  for (const game of games) {
    if (game.winner === "draw") {
      draws += 1;
    } else if (game.winner === "team1") {
      const winnerKey = game.team1.key || game.team1.name;
      wins[winnerKey === (teams[0].key || teams[0].name) ? 0 : 1] += 1;
    } else if (game.winner === "team2") {
      const winnerKey = game.team2.key || game.team2.name;
      wins[winnerKey === (teams[0].key || teams[0].name) ? 0 : 1] += 1;
    }
  }
  const label = group.roundLabel || (group.seriesId ? `Series ${index + 1}` : `Game ${first.order ?? index + 1}`);

  return (
    <article className="tournament-result-card">
      <header className="tournament-result-card-head">
        <strong>{label}</strong>
        {group.bestOf && <span className="stat-formula">Bo{group.bestOf}</span>}
      </header>
      <div className="tournament-result-teams">
        {teams.map((team, side) => (
          <div
            className={`tournament-result-team${wins[side] > wins[1 - side] ? " is-series-winner" : ""}`}
            key={team.key || team.name}
          >
            <PlayerLink {...playerLinkProps(team.name, team.key)} />
            {records?.has(team.key || team.name) && (
              <span className="stat-formula">
                {" "}({records.get(team.key || team.name).wins}W-{records.get(team.key || team.name).losses}L)
              </span>
            )}
            <strong>{wins[side]}</strong>
          </div>
        ))}
      </div>
      {draws > 0 && <div className="stat-formula tournament-result-draws">{draws} drawn {draws === 1 ? "game" : "games"}</div>}
      <div className="tournament-result-games">
        {games.map((game, gameIndex) => {
          const winner = game.winner === "team1" ? game.team1.name : game.winner === "team2" ? game.team2.name : "Draw";
          return (
            <button
              type="button"
              className="tournament-result-game"
              key={game.matchKey || gameIndex}
              onClick={() => onJump(game.matchKey)}
              disabled={!game.matchKey}
              title={`View match ${game.order ?? ""}`}
            >
              {games.length > 1 ? `Game ${game.gameNumber || gameIndex + 1}: ` : ""}
              {winner}
            </button>
          );
        })}
      </div>
    </article>
  );
}

// A stage's series laid out round by round (rounds are named by the series'
// round label, falling back to the game's stage text). `mode` decides what the
// cards show next to each team: "swiss" re-sorts every round by standing and
// shows each team's running record; "running" keeps played order but still
// shows the running record (round-robin); null shows no records.
function ResultRounds({ seriesGroups, mode = null, onJump }) {
  const rounds = new Map();
  const records = new Map();
  seriesGroups.forEach((group, groupIndex) => {
    const first = group.games[0];
    const roundName =
      group.roundLabel ||
      first?.stage ||
      (group.seriesId ? `Series ${groupIndex + 1}` : "Games");
    if (!rounds.has(roundName)) rounds.set(roundName, []);
    rounds.get(roundName).push({ group, groupIndex });
  });
  if (!rounds.size) return <p className="stat-formula tournament-results-empty">No games played yet.</p>;
  const roundsWithRecords = [...rounds.entries()].map(([roundName, groups]) => {
    if (!mode) return { roundName, groups, records: null };
    const result = swissRoundResults(groups, records, { sort: mode === "swiss" });
    return { roundName, groups: result.groups, records: result.records };
  });
  return (
    <div className="tournament-results-rounds">
      {roundsWithRecords.map(({ roundName, groups, records: roundRecords }) => (
        <section className="tournament-results-round" key={roundName}>
          <h5>{roundName}</h5>
          <div className="tournament-results-round-games">
            {groups.map(({ group, groupIndex }) => (
              <SeriesResultCard
                key={group.seriesId || group.games[0]?.matchKey || groupIndex}
                group={group}
                index={groupIndex}
                records={roundRecords}
                onJump={onJump}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function signedDiff(diff) {
  return diff > 0 ? `+${diff}` : diff < 0 ? `\u2212${Math.abs(diff)}` : "0";
}

// One round-robin group in the style of a Liquipedia group table: ranked
// standings (match record, game record, game difference) followed by a
// head-to-head grid whose cells are the game score against each opponent,
// tinted for a win, loss or draw. Teams are listed in standings order on both
// axes, so a team's row reads left to right against everyone else.
function RoundRobinTable({ group }) {
  const rows = group.standings;
  if (!rows.length) return <p className="stat-formula tournament-results-empty">No teams in this group.</p>;
  const record = (win, draw, loss, showDraw) =>
    showDraw ? `${win}\u2013${draw}\u2013${loss}` : `${win}\u2013${loss}`;
  return (
    <div className="rr-table-wrap">
      <table className="rr-table" aria-label={`${group.name} standings`}>
        <thead>
          <tr>
            <th className="rr-rank">#</th>
            <th className="rr-team">Team</th>
            <th title={group.hasDraws ? "Matches won\u2013drawn\u2013lost" : "Matches won\u2013lost"}>Matches</th>
            <th title="Games won\u2013lost">Games</th>
            <th title="Game difference">Diff</th>
            {rows.map((opponent) => (
              <th className="rr-vs-head" key={opponent.key} title={opponent.name}>
                <span>{opponent.name}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td className="rr-rank">{row.rank}</td>
              <td className="rr-team">
                <PlayerLink {...playerLinkProps(row.name, row.key)} />
              </td>
              <td>{record(row.matchWins, row.matchDraws, row.matchLosses, group.hasDraws)}</td>
              <td>{record(row.gameWins, row.gameDraws, row.gameLosses, row.gameDraws > 0)}</td>
              <td className={row.gameDiff > 0 ? "rr-diff-pos" : row.gameDiff < 0 ? "rr-diff-neg" : ""}>
                {signedDiff(row.gameDiff)}
              </td>
              {rows.map((opponent) => {
                if (opponent.key === row.key) return <td className="rr-vs rr-self" key={opponent.key} aria-label="same team" />;
                const cell = row.vs[opponent.key];
                if (!cell) return <td className="rr-vs rr-unplayed" key={opponent.key}>{"\u00b7"}</td>;
                return (
                  <td
                    className={`rr-vs rr-${cell.outcome}`}
                    key={opponent.key}
                    title={`${row.name} vs ${opponent.name}: ${cell.gamesFor}\u2013${cell.gamesAgainst}`}
                  >
                    {cell.gamesFor}{"\u2013"}{cell.gamesAgainst}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TournamentResultsBracket({ t, onJump }) {
  const stages = resultStages(t);
  if (!stages.length) {
    return (
      <section className="profile-block tournament-results">
        <h3>Tournament results</h3>
        <p className="stat-formula">No structured results are available.</p>
      </section>
    );
  }
  return (
    <section className="profile-block tournament-results">
      <h3>Tournament results</h3>
      <p className="stat-formula tournament-note">
        Results are grouped by the recorded stage and series. Click a game to see its roster and details below.
      </p>
      <div className="tournament-results-stages">
        {stages.map((stage, stageIndex) => {
          const isSwiss = /swiss/i.test(`${stage.format || ""} ${stage.name || ""}`);
          const roundRobinGroups = stage.roundRobin?.groups || [];
          return (
            <section className="tournament-results-stage" key={stage.stageId || stageIndex}>
              <header className="tournament-results-stage-head">
                <h4>{stage.name || "Tournament"}</h4>
                {stage.format && <span className="stat-formula">{formatStageFormat(stage.format)}</span>}
              </header>
              {roundRobinGroups.length > 0 ? (
                <div className="tournament-results-rr">
                  {roundRobinGroups.map((group) => (
                    <section className="tournament-results-rr-group" key={group.groupId}>
                      <h5 className="tournament-results-rr-title">{group.name}</h5>
                      <RoundRobinTable group={group} />
                      <ResultRounds seriesGroups={group.seriesGroups} mode="running" onJump={onJump} />
                    </section>
                  ))}
                  {stage.groups.length > 0 && (
                    <section className="tournament-results-rr-group">
                      <h5 className="tournament-results-rr-title">Other matches</h5>
                      <ResultRounds seriesGroups={stage.groups} onJump={onJump} />
                    </section>
                  )}
                </div>
              ) : (
                <ResultRounds seriesGroups={stage.groups} mode={isSwiss ? "swiss" : null} onJump={onJump} />
              )}
            </section>
          );
        })}
      </div>
    </section>
  );
}

function MatchRosterTable({ side, won, hasDetails, showBans, hasRoles, championFilterKey }) {
  const rows = sortByRole(side.roster, (p) => p.role);
  const result = won === null ? null : won ? <span className="outcome-win">Win</span> : <span className="outcome-loss">Loss</span>;
  return (
    <div className="match-roster">
      <strong className="match-roster-name">{side.name}</strong>
      {result && <> {result}</>} <span className="stat-formula">
        avg TrueSkill <TrueSkillValue rating={side.avg} mu={side.avgMu} />
      </span>
      {showBans && <BanList bans={side.bans} highlightKey={championFilterKey} />}
      <table className="match-details-table">
        <thead>
          <tr>
            <th>Player</th>
            <th>TrueSkill</th>
            {hasDetails && (
              <>
                <th>Champion</th>
                <th>K</th>
                <th>D</th>
                <th>A</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((p, i) => (
            <tr key={i} className={championFilterKey && p.championKey === championFilterKey ? "tournament-picked" : ""}>
              <td>
                <RoleIcon role={p.role} reserveSpace={hasRoles} />
                <PlayerLink {...playerLinkProps(p.displayName, p.identityKey)} />
              </td>
              <td>
                <TrueSkillValue rating={p.conservativeRating} />
              </td>
              {hasDetails && (
                <>
                  <td>{p.champion ? <ChampionLink champion={p.champion} championKey={p.championKey} /> : "\u2013"}</td>
                  <td>{p.kills ?? "\u2013"}</td>
                  <td>{p.deaths ?? "\u2013"}</td>
                  <td>{p.assists ?? "\u2013"}</td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function matchHasChampion(m, key) {
  return (
    m.team1.roster.some((p) => p.championKey === key) ||
    m.team2.roster.some((p) => p.championKey === key) ||
    m.team1.bans.some((b) => b.championKey === key) ||
    m.team2.bans.some((b) => b.championKey === key)
  );
}

function groupMatchesByStructure(shown) {
  const stages = new Map();
  for (const match of shown) {
    const stageId = match.m.stageId || `stage:${match.m.stageName || "Tournament"}`;
    if (!stages.has(stageId)) {
      stages.set(stageId, {
        id: stageId,
        name: match.m.stageName || "Tournament",
        format: match.m.stageFormat,
        order: match.m.stageOrder || 1,
        groups: new Map(),
      });
    }
    const stage = stages.get(stageId);
    const groupId = match.m.seriesId || `game:${match.m.matchKey || match.i}`;
    if (!stage.groups.has(groupId)) {
      stage.groups.set(groupId, {
        id: groupId,
        seriesId: match.m.seriesId,
        roundLabel: match.m.seriesRound,
        bestOf: match.m.bestOf,
        matches: [],
      });
    }
    stage.groups.get(groupId).matches.push(match);
  }
  return [...stages.values()]
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
    .map((stage) => ({
      ...stage,
      groups: [...stage.groups.values()].sort(
        (a, b) => (a.matches[0].m.order ?? 0) - (b.matches[0].m.order ?? 0),
      ),
    }));
}

function MatchesBlock({ t, championFilterKey, onClearFilter, expandedKeys, onToggleExpand, flashKey, canEdit, onSaved }) {
  const [editingMatch, setEditingMatch] = useState(null);
  if (!t.matches.length) {
    return (
      <section className="profile-block tournament-matches" id="tournamentMatches">
        <h3>Matches</h3>
        <p className="stat-formula">No matches recorded.</p>
      </section>
    );
  }
  const upsetKey = t.summary.biggestUpset?.matchKey;
  const shown = t.matches.map((m, i) => ({ m, i })).filter(({ m }) => !championFilterKey || matchHasChampion(m, championFilterKey));
  const groupedMatches = groupMatchesByStructure(shown);
  const filterChampion = championFilterKey ? t.championStats.find((c) => c.key === championFilterKey) : null;
  const count = championFilterKey ? `${shown.length} of ${t.matches.length}, in play order` : `${t.matches.length}, in play order`;

  return (
    <section className="profile-block tournament-matches" id="tournamentMatches">
      <h3>
        Matches <span className="stat-formula">({count})</span>
      </h3>
      {filterChampion && (
        <div className="tournament-filter-bar">
          <span>
            Matches with <ChampionLink champion={filterChampion.champion} championKey={filterChampion.key} />
            {hasBanData(t) && <span className="stat-formula"> (picked or banned)</span>}
          </span>
          <button type="button" className="tournament-clear-filter" onClick={onClearFilter}>
            Clear filter
          </button>
        </div>
      )}
      {shown.length ? (
        <div className="tournament-matches-scroll">
          <table className="tournament-matches-table">
            <thead>
              <tr>
                <th className="col-toggle">
                  <span className="sr-only">Expand</span>
                </th>
                <th className="col-narrow" title="Match Order from the match data">
                  #
                </th>
                <th className="col-narrow">Stage</th>
                <th>Team 1</th>
                <th>Team 2</th>
                <th>Winner</th>
                <th className="col-narrow" title="Pre-match predicted win probability of the winner">
                  Result Prob.
                </th>
              </tr>
            </thead>
            <tbody>
              {groupedMatches.map((stage) => (
                <Fragment key={stage.id}>
                  <tr className="tournament-stage-heading">
                    <th colSpan={7} scope="rowgroup">
                      {stage.name}
                      {stage.format && <span className="stat-formula">{" \u00b7 "}{formatStageFormat(stage.format)}</span>}
                    </th>
                  </tr>
                  {stage.groups.map((group) => (
                    <Fragment key={group.id}>
                      {group.seriesId && (
                        <tr className="tournament-series-heading">
                          <th colSpan={7} scope="rowgroup">
                            {group.roundLabel || "Series"}
                            {group.bestOf ? <span className="stat-formula">{" \u00b7 "}Best of {group.bestOf}</span> : null}
                            <span className="stat-formula">
                              {" \u00b7 "}
                              {group.matches[0].m.team1.name} vs {group.matches[0].m.team2.name}
                              {" \u00b7 "}
                              {group.matches.length} {group.matches.length === 1 ? "game" : "games"}
                            </span>
                          </th>
                        </tr>
                      )}
                      {group.matches.map(({ m, i }) => {
                        const matchHasRoles = [...m.team1.roster, ...m.team2.roster].some((p) => p.role);
                        const t1Won = m.winner === "team1";
                        const t2Won = m.winner === "team2";
                        const winnerSide = t1Won ? m.team1 : t2Won ? m.team2 : null;
                        const winProb = t1Won ? m.predictedWinProbTeam1 : t2Won ? 1 - m.predictedWinProbTeam1 : null;
                        const isUpset = upsetKey && m.matchKey === upsetKey;
                        const isOpen = expandedKeys.has(m.matchKey || i);
                        const isFlashing = flashKey === (m.matchKey || i);
                        return (
                          <Fragment key={m.matchKey || i}>
                            <tr
                              data-match-key={m.matchKey || i}
                              className={`${isUpset ? "tournament-upset-row" : ""}${isFlashing ? " tournament-row-flash" : ""}`}
                              title={isUpset ? "Biggest upset of the tournament" : undefined}
                            >
                              <td className="col-toggle">
                                <button
                                  className="roster-toggle"
                                  aria-expanded={isOpen}
                                  aria-label="Show match details"
                                  onClick={() => onToggleExpand(m.matchKey || i)}
                                >
                                  {isOpen ? "\u25bc" : "\u25b6"}
                                </button>
                              </td>
                              <td className="col-narrow">{m.order ?? "\u2013"}</td>
                              <td className="col-narrow">{m.gameNumber ? `Game ${m.gameNumber}` : m.stage || "\u2013"}</td>
                              <td className={t1Won ? "tournament-winner" : ""}>
                                <PlayerLink {...playerLinkProps(m.team1.name, m.team1.key)} />
                              </td>
                              <td className={t2Won ? "tournament-winner" : ""}>
                                <PlayerLink {...playerLinkProps(m.team2.name, m.team2.key)} />
                              </td>
                              <td>{winnerSide ? <PlayerLink {...playerLinkProps(winnerSide.name, winnerSide.key)} /> : "Draw"}</td>
                              <td className="col-narrow">{winProb != null ? pctOrLessThanOne(winProb) : "\u2013"}</td>
                            </tr>
                            {isOpen && (
                              <tr key={`${m.matchKey || i}-detail`} className="roster-detail-row">
                                <td colSpan={7}>
                                  <div className="match-rosters">
                                    {canEdit && m.matchKey && (
                                      <div className="match-editor-launch">
                                        <button type="button" className="columns-btn" onClick={() => setEditingMatch(m)}>
                                          Edit match details
                                        </button>
                                      </div>
                                    )}
                                    <div className="roster-detail match-rosters-grid">
                                      <MatchRosterTable
                                        side={m.team1}
                                        won={m.winner === "draw" ? null : t1Won}
                                        hasDetails={m.hasDetails}
                                        showBans={m.hasBans}
                                        hasRoles={matchHasRoles}
                                        championFilterKey={championFilterKey}
                                      />
                                      <MatchRosterTable
                                        side={m.team2}
                                        won={m.winner === "draw" ? null : t2Won}
                                        hasDetails={m.hasDetails}
                                        showBans={m.hasBans}
                                        hasRoles={matchHasRoles}
                                        championFilterKey={championFilterKey}
                                      />
                                    </div>
                                  </div>
                                  {editingMatch?.matchKey === m.matchKey && (
                                    <MatchDetailEditor
                                      matchKey={m.matchKey}
                                      title={`${m.team1.name} vs ${m.team2.name} \u00b7 ${t.label} \u00b7 ${m.stage || `Match ${m.order ?? ""}`}`}
                                      onClose={() => setEditingMatch(null)}
                                      onSaved={onSaved}
                                    />
                                  )}
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </Fragment>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="stat-formula">No matches with this champion.</p>
      )}
    </section>
  );
}

export default function TournamentsTab({ active, selectedTournamentId, selectedMatchKey, onSelectionChange }) {
  const { loadTrueskill } = useAppData();
  const { canEdit } = useAuth();
  const [tournaments, setTournaments] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [refreshError, setRefreshError] = useState(null);
  const [championFilterKey, setChampionFilterKey] = useState(null);
  const [championSort, setChampionSort] = useState({ column: null, dir: "desc" });
  const [flashKey, setFlashKey] = useState(null);
  const [expandedKeys, setExpandedKeys] = useState(() => new Set());
  const [editingStructure, setEditingStructure] = useState(false);
  const [mainTab, setMainTab] = useState("teams");
  const lastExternalMatchKey = useRef(null);

  useEffect(() => {
    if (!active || loaded) return;
    Promise.all([api.tournaments(), loadTrueskill(false)]).then(([data]) => {
      setTournaments(data.tournaments || []);
      setLoaded(true);
    });
  }, [active, loaded, loadTrueskill]);

  // The URL's ?tournament= param (selectedTournamentId, owned by the parent)
  // is the single source of truth for which tournament is selected -- no
  // local copy of it here. If it's missing or points at a tournament that no
  // longer exists once the list loads, default to the first one and tell the
  // parent, which updates the URL and flows the valid id back down as a prop.
  const validId = selectedTournamentId && tournaments.some((t) => t.id === selectedTournamentId) ? selectedTournamentId : null;
  const effectiveId = validId || (tournaments.length ? tournaments[0].id : null);

  useEffect(() => {
    if (effectiveId && effectiveId !== selectedTournamentId) onSelectionChange(effectiveId);
  }, [effectiveId, selectedTournamentId, onSelectionChange]);

  // Clear per-tournament UI state during render when the effective
  // selection changes, rather than in an effect.
  const [prevEffectiveId, setPrevEffectiveId] = useState(effectiveId);
  if (effectiveId !== prevEffectiveId) {
    setPrevEffectiveId(effectiveId);
    setChampionFilterKey(null);
    setExpandedKeys(new Set());
    setMainTab("teams");
  }

  const t = tournaments.find((x) => x.id === effectiveId);

  async function refreshTournaments() {
    try {
      const data = await api.tournaments();
      setTournaments(data.tournaments || []);
      setRefreshError(null);
    } catch (error) {
      setRefreshError(`Match was saved, but the tournament view could not refresh: ${error.message}`);
    }
  }

  useEffect(() => {
    if (!active) {
      lastExternalMatchKey.current = null;
      return;
    }
    if (!t || !selectedMatchKey || !t.matches.some((match) => match.matchKey === selectedMatchKey)) return;
    const selectionKey = `${t.id}::${selectedMatchKey}`;
    if (lastExternalMatchKey.current === selectionKey) return;
    lastExternalMatchKey.current = selectionKey;
    setMainTab("results");
    setExpandedKeys((previous) => new Set(previous).add(selectedMatchKey));
    setFlashKey(selectedMatchKey);
    const scrollTimer = setTimeout(() => {
      const row = [...document.querySelectorAll("tr[data-match-key]")].find((matchRow) => matchRow.dataset.matchKey === selectedMatchKey);
      row?.scrollIntoView?.({ behavior: "smooth", block: "center" });
    }, 80);
    const flashTimer = setTimeout(() => setFlashKey(null), 1600);
    return () => {
      clearTimeout(scrollTimer);
      clearTimeout(flashTimer);
    };
  }, [active, t, selectedMatchKey]);

  function toggleChampion(key) {
    const next = key === championFilterKey ? null : key;
    setChampionFilterKey(next);
  }

  function toggleExpand(key) {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function jumpToMatch(matchKey) {
    setChampionFilterKey(null);
    setMainTab("results");
    setExpandedKeys((prev) => new Set(prev).add(matchKey));
    setFlashKey(matchKey);
    setTimeout(() => {
      const row = [...document.querySelectorAll("tr[data-match-key]")].find((matchRow) => matchRow.dataset.matchKey === matchKey);
      row?.scrollIntoView?.({ behavior: "smooth", block: "center" });
    }, 50);
    setTimeout(() => setFlashKey(null), 1500);
  }

  return (
    <section className={`tab-panel${active ? " active" : ""}`} id="tab-tournaments">
      <TournamentFunFacts tournaments={tournaments} />

      <section className="profile-block profile-filter-block tournament-picker">
        <div className="profile-filter-row">
          <label>Tournament:</label>
          <select
            className="tournament-filter-select"
            disabled={!tournaments.length}
            value={effectiveId || ""}
            onChange={(e) => onSelectionChange(e.target.value)}
          >
            {tournaments.length === 0 ? (
              <option>{"Loading\u2026"}</option>
            ) : (
              tournaments.map((tt) => (
                <option value={tt.id} key={tt.id}>
                  {tt.label}
                </option>
              ))
            )}
          </select>
          {t && (
            <span className="stat-formula">
              {t.gamesPlayed} games {"\u00b7"} {t.teamCount} teams
            </span>
          )}
          {canEdit && t && (
            <button type="button" className="columns-btn" onClick={() => setEditingStructure(true)}>
              Manage tournament structure
            </button>
          )}
        </div>
      </section>

      {loaded && tournaments.length === 0 && <p className="stat-formula">No tournaments have been played yet.</p>}
      {refreshError && <p className="match-editor-error" role="alert">{refreshError}</p>}

      {t && (
        <div className={`profile-layout tournament-layout${hasBanData(t) ? " has-bans" : ""}`}>
          <aside className="profile-sidebar">
            <SummaryBlock t={t} onJump={jumpToMatch} />
            <ChampionsBlock
              t={t}
              championSort={championSort}
              setChampionSort={setChampionSort}
              championFilterKey={championFilterKey}
              onToggleChampion={toggleChampion}
            />
          </aside>
          <main className="profile-main">
            <div className="tournament-main-tabs" role="tablist" aria-label="Tournament overview">
              <button
                type="button"
                role="tab"
                id="tournament-teams-tab"
                aria-selected={mainTab === "teams"}
                aria-controls="tournament-teams-panel"
                className={mainTab === "teams" ? "active" : ""}
                onClick={() => setMainTab("teams")}
              >
                Teams
              </button>
              <button
                type="button"
                role="tab"
                id="tournament-results-tab"
                aria-selected={mainTab === "results"}
                aria-controls="tournament-results-panel"
                className={mainTab === "results" ? "active" : ""}
                onClick={() => setMainTab("results")}
              >
                Results
              </button>
            </div>
            {mainTab === "teams" ? (
              <div role="tabpanel" id="tournament-teams-panel" aria-labelledby="tournament-teams-tab">
                <TeamsBlock t={t} />
              </div>
            ) : (
              <div role="tabpanel" id="tournament-results-panel" aria-labelledby="tournament-results-tab">
                <TournamentResultsBracket t={t} onJump={jumpToMatch} />
              </div>
            )}
            <MatchesBlock
              t={t}
              championFilterKey={championFilterKey}
              onClearFilter={() => setChampionFilterKey(null)}
              expandedKeys={expandedKeys}
              onToggleExpand={toggleExpand}
              flashKey={flashKey}
              canEdit={canEdit}
              onSaved={refreshTournaments}
            />
          </main>
        </div>
      )}
      {canEdit && editingStructure && t && (
        <TournamentStructureEditor
          rows={t.matches.map((match) => ({
            year: t.year,
            tournament: t.tournament,
            match_key: match.matchKey,
            match_order: match.order,
            team1: match.team1.name,
            team2: match.team2.name,
          }))}
          onClose={() => setEditingStructure(false)}
          onChanged={refreshTournaments}
        />
      )}
    </section>
  );
}
