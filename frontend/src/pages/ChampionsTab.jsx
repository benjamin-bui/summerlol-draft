import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import DataTable from "../components/table/DataTable";
import { ChampionIcon, RoleIcon } from "../components/shared/Cells";
import { ROLE_LABELS, ROLES } from "../utils/format";

function KdaLine({ player }) {
  if (!player) return "\u2013";
  return `${player.kills ?? 0} / ${player.deaths ?? 0} / ${player.assists ?? 0}`;
}

function ChampionGames({ row, onOpenMatch }) {
  if (!row.matchGames.length) {
    return <p className="stat-formula champions-no-games">No games with match details are available for this champion.</p>;
  }
  return (
    <div className="champions-games-scroll">
      <table className="champions-games-table">
        <thead>
          <tr>
            <th>Tournament</th>
            <th>Stage</th>
            <th>Teams</th>
            <th>Winner</th>
            <th>Role</th>
            <th>Champion</th>
            <th>K / D / A</th>
            <th>Opponent champion</th>
            <th>K / D / A</th>
          </tr>
        </thead>
        <tbody>
          {row.matchGames.map((game) => (
            <tr data-match-key={game.matchKey} key={game.matchKey} className={game.championWon ? "champions-game-win" : ""}>
              <td>{game.tournament}</td>
              <td className="champions-game-stage">
                <button type="button" onClick={() => onOpenMatch(game.tournamentId, game.matchKey)}>
                  {game.stage || "Match"}{game.order != null ? ` \u00b7 #${game.order}` : ""}
                </button>
              </td>
              <td className="champions-game-teams">
                <span>{game.team1}</span>
                <span className="champions-game-vs">vs</span>
                <span>{game.team2}</span>
              </td>
              <td className={game.winner ? "champions-game-winner" : ""}>{game.winner || "Draw"}</td>
              <td>{game.role ? <RoleIcon role={game.role} /> : "\u2013"}</td>
              <td><ChampionIcon champion={game.champion} /></td>
              <td className="champions-game-kda"><KdaLine player={game.player} /></td>
              <td>{game.opponent ? <ChampionIcon champion={game.opponent.champion} /> : "\u2013"}</td>
              <td className="champions-game-kda"><KdaLine player={game.opponent} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const CHAMPION_COLUMNS = [
  {
    key: "champion",
    label: "Champion",
    sortable: true,
    hideable: false,
    type: "string",
    className: "champions-name-cell",
    render: (value) => <ChampionIcon champion={value} />,
  },
  { key: "games", label: "Games", sortable: true, hideable: true, type: "number", decimals: 0 },
  {
    key: "winRate",
    label: "Win rate",
    sortable: true,
    hideable: true,
    type: "number",
    percentage: true,
    decimals: 0,
  },
  {
    key: "kda",
    label: "KDA",
    sortable: true,
    hideable: true,
    type: "number",
    decimals: 2,
    sortValue: (row) => (row.games ? (row.kda ?? Infinity) : null),
    render: (value, row) => (row.games ? (value == null ? "Perfect" : value.toFixed(2)) : "\u2013"),
  },
  { key: "bans", label: "Bans", sortable: true, hideable: true, type: "number", decimals: 0 },
  {
    key: "contestRate",
    label: "Contest rate",
    sortable: true,
    hideable: true,
    type: "number",
    percentage: true,
    decimals: 0,
    title: "Share of games where the champion was picked or banned",
  },
  {
    key: "roles",
    label: "Roles played",
    sortable: true,
    hideable: true,
    type: "string",
    sortValue: (row) => row.roles.map((role) => ROLES.indexOf(role)).join(","),
    render: (_, row) => (
      <span className="champions-role-list">
        {row.roles.length ? row.roles.map((role) => <RoleIcon role={role} key={role} />) : "\u2013"}
      </span>
    ),
  },
];

function aggregateChampions(tournaments) {
  const byKey = new Map();
  let gamesWithBans = 0;
  let gamesWithChampionData = 0;

  for (const tournament of tournaments) {
    gamesWithBans += tournament.championCoverage?.gamesWithBans || 0;
    gamesWithChampionData += tournament.championCoverage?.gamesWithChampionData || 0;
    for (const stat of tournament.championStats || []) {
      if (!byKey.has(stat.key)) {
        byKey.set(stat.key, {
          key: stat.key,
          champion: stat.champion,
          games: 0,
          wins: 0,
          losses: 0,
          draws: 0,
          bans: 0,
          contested: 0,
          kills: 0,
          deaths: 0,
          assists: 0,
          roles: new Set(),
          matchGames: [],
        });
      }
      const row = byKey.get(stat.key);
      row.bans += stat.bans || 0;
      row.contested += stat.contested || 0;
    }

    for (const match of tournament.matches || []) {
      for (const team of [match.team1, match.team2]) {
        for (const player of team?.roster || []) {
          if (!player.championKey || !player.champion) continue;
          let row = byKey.get(player.championKey);
          if (!row) {
            row = {
              key: player.championKey,
              champion: player.champion,
              games: 0,
              wins: 0,
              losses: 0,
              draws: 0,
              bans: 0,
              contested: 0,
              kills: 0,
              deaths: 0,
              assists: 0,
              roles: new Set(),
              matchGames: [],
            };
            byKey.set(player.championKey, row);
          }
          const opponentTeam = team === match.team1 ? match.team2 : match.team1;
          const opponent = player.role
            ? opponentTeam?.roster?.find((member) => member.role === player.role && member.champion)
            : null;
          const championSide = team === match.team1 ? "team1" : "team2";
          const winnerTeam = match.winner === "team1" ? match.team1 : match.winner === "team2" ? match.team2 : null;
          row.matchGames.push({
            tournamentId: tournament.id,
            tournament: tournament.label,
            matchKey: match.matchKey,
            order: match.order,
            stage: match.stage,
            team1: match.team1?.name || "Team 1",
            team2: match.team2?.name || "Team 2",
            winner: winnerTeam?.name || null,
            championWon: match.winner === championSide,
            role: player.role,
            champion: player.champion,
            player,
            opponent: opponent || null,
          });
          row.games += 1;
          if (match.winner === "draw") row.draws += 1;
          else if (match.winner === (team === match.team1 ? "team1" : "team2")) row.wins += 1;
          else row.losses += 1;
          row.kills += player.kills || 0;
          row.deaths += player.deaths || 0;
          row.assists += player.assists || 0;
          if (ROLES.includes(player.role)) row.roles.add(player.role);
        }
      }
    }
  }

  const rows = [...byKey.values()].map((row) => {
    const decidedGames = row.wins + row.losses + row.draws;
    return {
      ...row,
      winRate: decidedGames ? row.wins / decidedGames : null,
      kda: row.deaths ? (row.kills + row.assists) / row.deaths : null,
      contestRate: gamesWithChampionData ? row.contested / gamesWithChampionData : null,
      roles: [...row.roles].sort((a, b) => ROLES.indexOf(a) - ROLES.indexOf(b)),
    };
  });
  return { rows, gamesWithBans, gamesWithChampionData };
}

export default function ChampionsTab({ active, onOpenMatch }) {
  const [tournaments, setTournaments] = useState(null);
  const [selectedIds, setSelectedIds] = useState(null);
  const [selectedRoles, setSelectedRoles] = useState(() => new Set());
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    if (!active || tournaments) return;
    api.tournaments().then((data) => {
      const list = data.tournaments || [];
      setTournaments(list);
      setSelectedIds(new Set(list.map((tournament) => tournament.id)));
    });
  }, [active, tournaments]);

  const selectedTournaments = useMemo(
    () => (tournaments || []).filter((tournament) => selectedIds?.has(tournament.id)),
    [tournaments, selectedIds],
  );
  const { rows, gamesWithBans, gamesWithChampionData } = useMemo(
    () => aggregateChampions(selectedTournaments),
    [selectedTournaments],
  );
  const tournamentCount = selectedTournaments.length;
  const allSelected = !!tournaments?.length && tournamentCount === tournaments.length;
  const visibleRows = useMemo(
    () => rows.filter((row) => !selectedRoles.size || row.roles.some((role) => selectedRoles.has(role))),
    [rows, selectedRoles],
  );

  function toggleTournament(id) {
    setSelectedIds((previous) => {
      const next = new Set(previous || []);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleRole(role) {
    setSelectedRoles((previous) => {
      const next = new Set(previous);
      if (next.has(role)) next.delete(role);
      else next.add(role);
      return next;
    });
  }

  return (
    <section className={`tab-panel${active ? " active" : ""}`} id="tab-champions">
      <div className="champions-toolbar">
        <div className="champions-tournament-control">
          <button
            type="button"
            className="columns-btn"
            aria-expanded={pickerOpen}
            aria-haspopup="true"
            onClick={() => setPickerOpen((open) => !open)}
            disabled={!tournaments?.length}
          >
            {tournaments ? (allSelected ? "All tournaments" : `Tournaments (${tournamentCount})`) : "Loading tournaments\u2026"} {"\u25be"}
          </button>
          {pickerOpen && tournaments && (
            <div className="champions-tournament-menu" role="group" aria-label="Filter tournaments">
              <div className="champions-tournament-actions">
                <button type="button" onClick={() => setSelectedIds(new Set(tournaments.map((t) => t.id)))}>
                  Select all
                </button>
                <button type="button" onClick={() => setSelectedIds(new Set())}>
                  Clear
                </button>
              </div>
              {tournaments.map((tournament) => (
                <label key={tournament.id}>
                  <input
                    type="checkbox"
                    checked={selectedIds?.has(tournament.id) || false}
                    onChange={() => toggleTournament(tournament.id)}
                  />
                  {tournament.label}
                </label>
              ))}
            </div>
          )}
        </div>
        <span className="champions-result-count">
          {visibleRows.length} champions {tournamentCount ? `\u00b7 ${selectedTournaments.reduce((sum, t) => sum + t.gamesPlayed, 0)} games` : "\u00b7 no tournaments selected"}
        </span>
      </div>

      {tournaments?.length === 0 && <p className="stat-formula">No tournaments have been played yet.</p>}

      <div className="champions-layout">
        <aside className="champions-role-panel" aria-label="Filter by roles played">
          <h2>Roles played</h2>
          <p>Show champions played in any selected role.</p>
          {ROLES.map((role) => (
            <label key={role}>
              <input type="checkbox" checked={selectedRoles.has(role)} onChange={() => toggleRole(role)} />
              <RoleIcon role={role} />
              <span>{ROLE_LABELS[role]}</span>
            </label>
          ))}
          {selectedRoles.size > 0 && (
            <button type="button" className="champions-clear-roles" onClick={() => setSelectedRoles(new Set())}>
              Clear roles
            </button>
          )}
        </aside>

        <main className="champions-table-wrap">
          {tournaments === null ? (
            <p>Loading champion statistics\u2026</p>
          ) : (
            <DataTable
              columns={CHAMPION_COLUMNS}
              data={visibleRows}
              ownerKey="champions"
              defaultSortColumn="games"
              defaultSortDirection="desc"
              emptyMessage={tournamentCount ? "No champion data matches these filters" : "Select one or more tournaments"}
              pagination={{ pageSizeOptions: [40, 80, "all"], defaultPageSize: 40 }}
              expandable={{
                hideToggle: true,
                toggleColumn: "champion",
                getDetail: (row) => <ChampionGames row={row} onOpenMatch={onOpenMatch} />,
              }}
            />
          )}
          {!!gamesWithBans && !!gamesWithChampionData && (
            <p className="champions-table-note" title="Ban counts are games the champion was banned. Contest rate is games picked or banned divided by games with champion data.">
              {gamesWithBans} games with ban records \u00b7 contest rate uses {gamesWithChampionData} games with champion data
            </p>
          )}
        </main>
      </div>
    </section>
  );
}