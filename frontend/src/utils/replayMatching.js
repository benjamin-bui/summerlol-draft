// Everything about relating a parsed replay (roflReplay.js) to the matches and
// rosters in the database: picking the match, deciding which replay team is
// which side, pairing replay players with roster slots, and filling the editor
// form. All pure functions -- the UI just calls them.

import { championIconKey } from "./format";

// ---- names -------------------------------------------------------------------

// Accent-, case- and whitespace-insensitive ("Ène" == "Ene").
export function foldName(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

export function splitRiotId(value) {
  const text = String(value ?? "");
  const hash = text.indexOf("#");
  return hash === -1 ? { name: text, tag: "" } : { name: text.slice(0, hash), tag: text.slice(hash + 1) };
}

// How well a replay player's identity fits a roster name such as
// "Voidliss#NA1": 3 = same Name#Tag, 2 = same game name (the tag is missing on
// one side, as in older replays), 1 = same game name but a different tag,
// 0 = no relation.
export function nameMatchStrength(replayPlayer, rosterName) {
  if (!replayPlayer.gameName || !rosterName) return 0;
  const roster = splitRiotId(rosterName);
  if (foldName(replayPlayer.gameName) !== foldName(roster.name)) return 0;
  if (!replayPlayer.tagLine || !roster.tag) return 2;
  return foldName(replayPlayer.tagLine) === foldName(roster.tag) ? 3 : 1;
}

const bestStrength = (replayPlayer, names) =>
  names.reduce((best, name) => Math.max(best, nameMatchStrength(replayPlayer, name)), 0);

// ---- champions ---------------------------------------------------------------

const CHAMPION_DISPLAY_ALIASES = { MonkeyKing: "Wukong" };

// The replay stores internal ids ("MissFortune", "MonkeyKing"). Prefer the
// spelling already used in the data; otherwise make a readable one.
export function championDisplayName(internalName, knownSpellings = []) {
  const key = championIconKey(internalName);
  const known = knownSpellings.find((name) => championIconKey(name) === key);
  if (known) return known;
  if (CHAMPION_DISPLAY_ALIASES[internalName]) return CHAMPION_DISPLAY_ALIASES[internalName];
  return String(internalName).replace(/([a-z0-9])([A-Z])/g, "$1 $2");
}

// ---- choosing the match ------------------------------------------------------

const byText = (a, b) => a.localeCompare(b, undefined, { sensitivity: "base" });

export function captainOptions(rows) {
  return [...new Set(rows.flatMap((row) => [row.team1, row.team2]))].sort(byText);
}

// Captains `captain` has played against (all captains when none is chosen yet).
export function opponentOptions(rows, captain) {
  if (!captain) return captainOptions(rows);
  const opponents = new Set();
  for (const row of rows) {
    if (row.team1 === captain) opponents.add(row.team2);
    else if (row.team2 === captain) opponents.add(row.team1);
  }
  return [...opponents].sort(byText);
}

const seasonRank = (row) => (String(row.tournament).toLowerCase() === "summer" ? 1 : 0);

// Matches that fit the captains chosen so far, newest first. With both set,
// only their meetings (either way round); with one, that captain's matches.
export function matchOptions(rows, captain1, captain2) {
  return rows
    .filter((row) => {
      if (captain1 && captain2) {
        return (row.team1 === captain1 && row.team2 === captain2) || (row.team1 === captain2 && row.team2 === captain1);
      }
      const only = captain1 || captain2;
      return !only || row.team1 === only || row.team2 === only;
    })
    .sort(
      (a, b) =>
        Number(b.year) - Number(a.year) ||
        seasonRank(b) - seasonRank(a) ||
        Number(a.match_order) - Number(b.match_order),
    );
}

export function matchLabel(row) {
  return `${row.year} ${row.tournament} \u00b7 ${row.match_stage} \u00b7 ${row.team1} vs ${row.team2}`;
}

// Every name that appears in a match's two rosters (captains included).
function matchNames(row) {
  return [
    row.team1,
    row.team2,
    ...(row._team1Roster?.roster || []).map((member) => member.displayName),
    ...(row._team2Roster?.roster || []).map((member) => member.displayName),
  ];
}

// Matches whose rosters contain many of the replay's players, best first.
// Only worth offering when most of the ten are found.
export function suggestMatches(replay, rows, { minPlayers = 6 } = {}) {
  return rows
    .map((row) => {
      const names = matchNames(row);
      return { row, score: replay.players.filter((p) => bestStrength(p, names) > 0).length };
    })
    .filter((candidate) => candidate.score >= minPlayers)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}

// ---- pairing replay players with roster slots -----------------------------------

export const slotKey = (teamIndex, playerIndex) => `${teamIndex}:${playerIndex}`;

function assignSide(replayPlayers, teamIndex, slots) {
  const assign = {};
  const guessed = [];
  const taken = new Set();
  const pairs = [];
  for (const player of replayPlayers) {
    slots.forEach((slot, playerIndex) => {
      const strength = bestStrength(player, [slot.displayName, slot.player]);
      if (strength > 0) pairs.push({ player, key: slotKey(teamIndex, playerIndex), strength });
    });
  }
  pairs.sort((a, b) => b.strength - a.strength);
  for (const { player, key } of pairs) {
    if (assign[player.index] !== undefined || taken.has(key)) continue;
    assign[player.index] = key;
    taken.add(key);
  }
  replayPlayers.forEach((player) => {
    if (assign[player.index] === undefined) assign[player.index] = null;
  });

  // Exactly one player and one slot left over on a side: almost certainly each
  // other (an alt account or renamed player). Pair them, but flag the guess.
  const lonePlayers = replayPlayers.filter((p) => assign[p.index] === null);
  const loneSlots = slots.map((_, i) => slotKey(teamIndex, i)).filter((key) => !taken.has(key));
  if (lonePlayers.length === 1 && loneSlots.length === 1) {
    assign[lonePlayers[0].index] = loneSlots[0];
    guessed.push(lonePlayers[0].index);
  }
  return { assign, guessed };
}

// Works out how a replay lines up with one match (`state` is the editor's
// match state). `swap` forces which replay team is Team 1; leave it undefined
// to decide from the names, then from the recorded winner.
export function planReplayImport(replay, state, { swap } = {}) {
  const [teamA, teamB] = replay.teams;
  const playersOf = (team) => replay.players.filter((p) => p.team === team);
  const slotsOf = (teamIndex) => state.teams[teamIndex].players;

  const overlap = (replayTeam, teamIndex) =>
    playersOf(replayTeam).filter((p) => slotsOf(teamIndex).some((s) => bestStrength(p, [s.displayName, s.player]) > 0)).length;

  let useSwap = swap;
  let sideBasis = "manual";
  if (useSwap === undefined) {
    const straight = overlap(teamA, 0) + overlap(teamB, 1);
    const crossed = overlap(teamA, 1) + overlap(teamB, 0);
    if (straight !== crossed) {
      useSwap = crossed > straight;
      sideBasis = "names";
    } else if (state.winnerSide && replay.winnerTeam !== null) {
      useSwap = (replay.winnerTeam === teamA ? 0 : 1) !== state.winnerSide - 1;
      sideBasis = "winner";
    } else {
      useSwap = false;
      sideBasis = "assumed";
    }
  }

  const sideOf = (team) => ((team === teamA) !== useSwap ? 0 : 1);
  const assign = {};
  const guessed = [];
  for (const team of [teamA, teamB]) {
    const result = assignSide(playersOf(team), sideOf(team), slotsOf(sideOf(team)));
    Object.assign(assign, result.assign);
    guessed.push(...result.guessed);
  }

  const warnings = [];
  const assigned = Object.values(assign).filter(Boolean).length;
  const winningSide = replay.winnerTeam === null ? null : sideOf(replay.winnerTeam) + 1;
  if (state.winnerSide && winningSide && winningSide !== state.winnerSide) {
    warnings.push({
      level: "alert",
      text: `This replay's winning team is mapped to ${state.teams[winningSide - 1].name}, but the match is recorded as a win for ${state.teams[state.winnerSide - 1].name}. Check this is the right replay, or swap the teams.`,
    });
  }
  const namedMatches = Object.entries(assign).filter(([index, key]) => key && !guessed.includes(Number(index))).length;
  if (replay.hasNames && namedMatches === 0) {
    warnings.push({ level: "alert", text: "None of the replay's player names match this match's rosters. Check this is the right replay." });
  } else if (!replay.hasNames) {
    warnings.push({ level: "notice", text: "This replay doesn't include player names, so each player has to be assigned to a roster slot by hand." });
  } else if (assigned < replay.players.length) {
    warnings.push({ level: "notice", text: `${replay.players.length - assigned} replay player(s) couldn't be matched to a roster slot automatically. Assign them below.` });
  }
  if (!replay.hasRoles) {
    warnings.push({ level: "notice", text: "This replay has no role data (common for ARAM or non-draft games), so roles are left as they were." });
  }
  if (sideBasis === "assumed") {
    warnings.push({ level: "notice", text: "Couldn't tell which replay team is which side. Check the team mapping and swap if it's wrong." });
  }

  return { swap: useSwap, sideBasis, sideOf, assign, guessed, warnings };
}

// Fills the form's roster slots from the replay, per `assign`
// ({ replayPlayerIndex: slotKey | null }). Everything else is left untouched.
export function applyReplayToForm(form, replay, assign, knownChampions = []) {
  const byKey = new Map();
  for (const player of replay.players) {
    if (assign[player.index]) byKey.set(assign[player.index], player);
  }
  return {
    ...form,
    teams: form.teams.map((team, teamIndex) => ({
      ...team,
      players: team.players.map((slot, playerIndex) => {
        const player = byKey.get(slotKey(teamIndex, playerIndex));
        if (!player) return slot;
        const stat = (value) => (value === null ? "" : String(value));
        return {
          ...slot,
          champion: championDisplayName(player.champion, knownChampions),
          kills: stat(player.kills),
          deaths: stat(player.deaths),
          assists: stat(player.assists),
          role: player.role ?? slot.role,
        };
      }),
    })),
  };
}
